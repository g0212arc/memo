// タートルネック = 身頃原型（襟ぐりを首に沿わせる）＋ 袖原型（長袖 or なし）＋ タートル部分。
// 袖なしのときはノースリーブ: 肩を少し内側に入れ、袖ぐりは縁取り布で始末する。

import { v } from '../../geometry/vec';
import { line, pathLength } from '../../geometry/path';
import { ResolvedBody } from '../../model/estimate';
import { MeasurementKey } from '../../model/schema';
import { CATEGORY_EASE } from '../../model/category';
import { draftBodice } from '../bodice';
import { draftSleeve } from '../sleeve';
import { defaultEase, scaleEase } from '../ease';
import { applyFit, Fit, LengthPreset } from '../fit';
import { DraftResult, Fabric, Piece } from '../types';
import { MissingMeasurementsError } from './tshirt';

export interface TurtleneckParams {
  fabric: Fabric;
  /** ニットの伸び率（%）。頭が通るかの確認と、縁取り布の長さに使う */
  stretch: number;
  backOpening: boolean;
  sleeve: 'long' | 'none';
  fitBody: Fit;
  fitSleeve: Fit;
  length: LengthPreset;
  /** タートルの高さ = 首の長さ × この値（二つ折りにした仕上がりの高さ） */
  turtleRatio: number;
  extraChestEase: number;
  extraSleeveWidth: number;
  extraArmholeEase: number;
}

export const DEFAULT_TURTLENECK: TurtleneckParams = {
  fabric: 'knit',
  stretch: 20,
  backOpening: true,
  sleeve: 'long',
  fitBody: 'normal',
  fitSleeve: 'normal',
  length: 'normal',
  turtleRatio: 1.0,
  extraChestEase: 0,
  extraSleeveWidth: 0,
  extraArmholeEase: 0,
};

export const TURTLENECK_REQUIREMENTS: { key: MeasurementKey; hard: boolean }[] = [
  { key: 'chest_circ', hard: true },
  { key: 'waist_circ', hard: true },
  { key: 'hip_circ', hard: true },
  { key: 'neck_circ', hard: false },
  { key: 'neck_length', hard: false },
  { key: 'shoulder_width', hard: false },
  { key: 'arm_length', hard: false },
  { key: 'back_length', hard: false },
  { key: 'front_length', hard: false },
  { key: 'armhole_circ', hard: false },
  { key: 'upper_arm_circ', hard: false },
  { key: 'elbow_pass_circ', hard: false },
  { key: 'waist_to_hip', hard: false },
];

const fmt = (x: number) => (Math.round(x * 10) / 10).toFixed(1);

function bindingPiece(id: string, name: string, cut: string, len: number, w: number, bias: boolean): Piece {
  return {
    id,
    name,
    cut,
    edges: [
      { segs: [line(v(0, 0), v(len, 0))], kind: 'seam', name: '縁' },
      { segs: [line(v(len, 0), v(len, w))], kind: 'seam', name: '端' },
      { segs: [line(v(len, w), v(0, w))], kind: 'seam', name: '縁' },
      { segs: [line(v(0, w), v(0, 0))], kind: 'seam', name: '端' },
    ],
    grain: bias
      ? [v(len * 0.5 - w * 0.35, w * 0.85), v(len * 0.5 + w * 0.35, w * 0.15)]
      : [v(len * 0.5, w * 0.9), v(len * 0.5, w * 0.1)],
  };
}

export function draftTurtleneck(r: ResolvedBody, p: TurtleneckParams): DraftResult {
  const missing = TURTLENECK_REQUIREMENTS.filter((q) => r.values[q.key] === undefined).map((q) => q.key);
  if (missing.length > 0) throw new MissingMeasurementsError(missing);
  const val = (k: MeasurementKey) => r.values[k] as number;
  const woven = p.fabric === 'woven';
  const sleeveless = p.sleeve === 'none';
  const warnings: string[] = [];

  const categoryEase = r.category ? CATEGORY_EASE[r.category] : 1;
  const ease = applyFit(
    scaleEase(
      defaultEase(p.fabric, {
        chest: val('chest_circ'),
        hip: val('hip_circ'),
        upperArm: val('upper_arm_circ'),
        armhole: val('armhole_circ'),
      }),
      categoryEase,
    ),
    p.fitBody,
    p.fitSleeve,
  );
  ease.chest += p.extraChestEase;
  // 袖なしは袖ぐりを体に沿わせる（深くしすぎない）
  ease.armhole = (sleeveless ? ease.armhole * 0.5 : ease.armhole) + p.extraArmholeEase;

  const chest = val('chest_circ');
  const shoulder = val('shoulder_width');
  const openingExt = Math.min(1.5, Math.max(0.6, chest * 0.05));
  const bodice = draftBodice(
    {
      chest,
      waist: val('waist_circ'),
      hip: val('hip_circ'),
      neck: val('neck_circ'),
      shoulder,
      backLength: val('back_length'),
      frontLength: val('front_length'),
      armhole: val('armhole_circ'),
      waistToHip: val('waist_to_hip'),
    },
    {
      ease,
      woven,
      // 首に沿わせる: 襟ぐりは首回りぴったりの幅、前の深さも浅く
      neckWiden: 0,
      frontNeckDrop: 0,
      frontNeckDepthRatio: 0.85,
      // 袖なしは肩先を内側へ（ノースリーブらしく）
      shoulderExtend: sleeveless ? -shoulder * 0.06 : 0,
      hemBelowWaist: val('waist_to_hip') * { short: 0.3, normal: 0.8, long: 1.3 }[p.length],
      armholeEase: ease.armhole,
      backOpening: p.backOpening,
      openingExt,
    },
  );
  warnings.push(...bodice.warnings);

  const frontAH = pathLength(bodice.frontArmhole);
  const backAH = pathLength(bodice.backArmhole);
  const pieces: Piece[] = [bodice.front, bodice.back];
  const info: string[] = [];

  if (!sleeveless) {
    const sleeve = draftSleeve({
      frontArmholeLength: frontAH,
      backArmholeLength: backAH,
      upperArm: val('upper_arm_circ'),
      armEase: ease.arm,
      armLength: val('arm_length'),
      lengthRatio: 1.0,
      widthRatio: woven ? 0.75 : 0.88,
      capEase: woven ? 0.03 : 0,
      // 長袖は手首に向けて細くする（肘・手が通る幅は下回らない）
      hemRatio: 0.75,
      minPass: val('elbow_pass_circ') + ease.pass,
      extraWidth: p.extraSleeveWidth,
    });
    warnings.push(...sleeve.warnings);
    pieces.push(sleeve.piece);
    const hem = sleeve.piece.edges.find((e) => e.kind === 'hem')!.segs[0];
    info.push(
      `袖ぐり ${fmt(frontAH + backAH)}cm ／ 袖山 ${fmt(sleeve.capLength)}cm ／ 袖幅 ${fmt(sleeve.width)}cm`,
      `袖口 ${fmt(Math.abs(hem.to.x - hem.from.x))}cm ／ 肘が通る周り ${fmt(val('elbow_pass_circ'))}cm`,
    );
    if (sleeve.widenedHem || sleeve.widenedWidth) info.push('肘が通るように袖口を広げました');
  }

  // タートル部分: 襟ぐりの長さの長方形を、高さ方向に二つ折りにする
  const neckTotal = 2 * (bodice.backNeckLength + bodice.frontNeckLength) + (p.backOpening ? 2 * openingExt : 0);
  const turtleLen = neckTotal * (woven ? 1.0 : 0.95);
  const turtleH = val('neck_length') * p.turtleRatio;
  pieces.push({
    id: 'turtle',
    name: 'タートル（高さ方向に二つ折り）',
    cut: woven ? '1枚（バイアス）' : '1枚（よく伸びる向きを長さ方向に）',
    edges: [
      { segs: [line(v(0, 0), v(turtleLen, 0))], kind: 'seam', name: '襟ぐり側' },
      { segs: [line(v(turtleLen, 0), v(turtleLen, turtleH * 2))], kind: 'seam', name: '端' },
      { segs: [line(v(turtleLen, turtleH * 2), v(0, turtleH * 2))], kind: 'seam', name: '襟ぐり側' },
      { segs: [line(v(0, turtleH * 2), v(0, 0))], kind: 'seam', name: '端' },
    ],
    grain: woven
      ? [v(turtleLen * 0.5 - turtleH * 0.6, turtleH * 1.7), v(turtleLen * 0.5 + turtleH * 0.6, turtleH * 0.3)]
      : [v(turtleLen * 0.5, turtleH * 1.8), v(turtleLen * 0.5, turtleH * 0.2)],
  });
  info.push(`襟ぐり ${fmt(neckTotal)}cm ／ タートル ${fmt(turtleLen)}cm × 仕上がりの高さ ${fmt(turtleH)}cm`);

  // 開きなしのとき、頭が通るか
  if (!p.backOpening) {
    const head = r.values.head_circ;
    const opening = turtleLen * (woven ? 1 : 1 + p.stretch / 100);
    if (head === undefined) {
      warnings.push('頭囲が分からないので、頭が通るか確認できません。背中開きにするか、頭を外して着せる前提で作ってください。');
    } else if (opening < head + 0.3) {
      warnings.push(
        `首の開き（伸ばして約 ${fmt(opening)}cm）が頭囲（${fmt(head)}cm）より小さく、頭が通りません。背中開きにするか、頭を外して着せてください。`,
      );
    }
  }

  // 袖なし: 袖ぐりの縁取り布
  if (sleeveless) {
    const finished = Math.min(0.6, Math.max(0.25, val('neck_circ') * 0.05));
    const bindRatio = woven ? 0.95 : Math.max(0.75, 1 - (p.stretch / 100) * 0.75);
    const len = (frontAH + backAH) * bindRatio;
    pieces.push(
      bindingPiece('armhole-binding', woven ? '袖ぐり縁取り（バイアス）' : '袖ぐり縁取り', '2枚', len, finished * 2, woven),
    );
    info.push(`袖ぐり ${fmt(frontAH + backAH)}cm ／ 縁取り布 ${fmt(len)}cm × 仕上がり幅 ${fmt(finished)}cm`);
  }

  info.push(`胸のゆとり ${fmt(ease.chest)}cm ／ 袖ぐりのゆとり ${fmt(ease.armhole)}cm（${woven ? '布帛' : 'ニット'}）`);
  if (p.backOpening) info.push(`背中開きの持ち出し ${fmt(openingExt)}cm`);
  info.push(`カテゴリ ${r.category ?? '未分類'}${r.categoryGuessed ? '（仮）' : ''} ／ ゆとりの掛け率 ×${categoryEase.toFixed(2)}`);

  return { pieces, warnings, info };
}
