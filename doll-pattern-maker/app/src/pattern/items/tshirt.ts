// Tシャツ = 身頃原型 ＋ 袖原型 ＋ 襟ぐりの縁取り布。

import { v } from '../../geometry/vec';
import { line, pathLength } from '../../geometry/path';
import { ResolvedBody } from '../../model/estimate';
import { MeasurementKey } from '../../model/schema';
import { draftBodice } from '../bodice';
import { draftSleeve } from '../sleeve';
import { defaultEase } from '../ease';
import { DraftResult, Fabric, Piece } from '../types';

export interface TshirtParams {
  fabric: Fabric;
  /** ニットの伸び率（%）。縁取り布の長さに使う */
  stretch: number;
  backOpening: boolean;
  /** 着丈（ウエストから下へ cm）。null なら腰丈の 8 割 */
  hemBelowWaist: number | null;
  /** 袖丈 = 腕の長さ × この値 */
  sleeveRatio: number;
  /** 胸のゆとりの上乗せ（cm、マイナス可） */
  extraChestEase: number;
  /** 前襟ぐりの下げ（cm） */
  frontNeckDrop: number;
}

export const DEFAULT_TSHIRT: TshirtParams = {
  fabric: 'knit',
  stretch: 20,
  backOpening: true,
  hemBelowWaist: null,
  sleeveRatio: 0.3,
  extraChestEase: 0,
  frontNeckDrop: 0,
};

/** Tシャツに必要な採寸項目。hard は推定できない（ないと作図できない）もの */
export const TSHIRT_REQUIREMENTS: { key: MeasurementKey; hard: boolean }[] = [
  { key: 'chest_circ', hard: true },
  { key: 'waist_circ', hard: true },
  { key: 'hip_circ', hard: true },
  { key: 'neck_circ', hard: true },
  { key: 'shoulder_width', hard: true },
  { key: 'arm_length', hard: true },
  { key: 'back_length', hard: false },
  { key: 'front_length', hard: false },
  { key: 'armhole_circ', hard: false },
  { key: 'upper_arm_circ', hard: false },
  { key: 'waist_to_hip', hard: false },
];

export function draftTshirt(r: ResolvedBody, p: TshirtParams): DraftResult {
  const missing = TSHIRT_REQUIREMENTS.filter((q) => r.values[q.key] === undefined).map((q) => q.key);
  if (missing.length > 0) {
    throw new MissingMeasurementsError(missing);
  }
  const val = (k: MeasurementKey) => r.values[k] as number;
  const woven = p.fabric === 'woven';

  const ease = defaultEase(p.fabric, { chest: val('chest_circ'), hip: val('hip_circ'), upperArm: val('upper_arm_circ') });
  ease.chest += p.extraChestEase;

  const chest = val('chest_circ');
  const openingExt = Math.min(1.5, Math.max(0.6, chest * 0.05));
  const bodice = draftBodice(
    {
      chest,
      waist: val('waist_circ'),
      hip: val('hip_circ'),
      neck: val('neck_circ'),
      shoulder: val('shoulder_width'),
      backLength: val('back_length'),
      frontLength: val('front_length'),
      armhole: val('armhole_circ'),
      waistToHip: val('waist_to_hip'),
    },
    {
      ease,
      woven,
      neckWiden: 0.02,
      frontNeckDrop: p.frontNeckDrop,
      shoulderExtend: val('shoulder_width') * 0.03,
      hemBelowWaist: p.hemBelowWaist ?? val('waist_to_hip') * 0.8,
      armholeEase: woven ? 0.1 : 0.03,
      backOpening: p.backOpening,
      openingExt,
    },
  );

  const frontAH = pathLength(bodice.frontArmhole);
  const backAH = pathLength(bodice.backArmhole);
  const sleeve = draftSleeve({
    frontArmholeLength: frontAH,
    backArmholeLength: backAH,
    upperArm: val('upper_arm_circ'),
    armEase: ease.arm,
    armLength: val('arm_length'),
    lengthRatio: p.sleeveRatio,
    widthRatio: woven ? 0.7 : 0.82,
    capEase: woven ? 0.03 : 0,
    hemRatio: 0.95,
  });

  // 襟ぐりの縁取り布
  const neckTotal = 2 * (bodice.backNeckLength + bodice.frontNeckLength) + (p.backOpening ? 2 * openingExt : 0);
  const bindRatio = woven ? 0.95 : Math.max(0.75, 1 - p.stretch / 100 * 0.75);
  const bindLen = neckTotal * bindRatio;
  const finished = Math.min(0.6, Math.max(0.25, val('neck_circ') * 0.05));
  const bw = finished * 2;
  const binding: Piece = {
    id: 'binding',
    name: woven ? '襟ぐり縁取り（バイアス）' : '襟ぐり縁取り',
    cut: woven ? '1枚（バイアス）' : '1枚（よく伸びる向きを長さ方向に）',
    edges: [
      { segs: [line(v(0, 0), v(bindLen, 0))], kind: 'seam', name: '縁取り' },
      { segs: [line(v(bindLen, 0), v(bindLen, bw))], kind: 'seam', name: '端' },
      { segs: [line(v(bindLen, bw), v(0, bw))], kind: 'seam', name: '縁取り' },
      { segs: [line(v(0, bw), v(0, 0))], kind: 'seam', name: '端' },
    ],
    grain: woven
      ? [v(bindLen * 0.5 - bw * 0.35, bw * 0.85), v(bindLen * 0.5 + bw * 0.35, bw * 0.15)]
      : [v(bindLen * 0.5, bw * 0.9), v(bindLen * 0.5, bw * 0.1)],
  };

  const info = [
    `袖ぐり ${fmt(frontAH + backAH)}cm ／ 袖山 ${fmt(sleeve.capLength)}cm（いせ ${fmt(sleeve.capLength - (frontAH + backAH))}cm）`,
    `袖幅 ${fmt(sleeve.width)}cm ／ 袖山の高さ ${fmt(sleeve.capHeight)}cm`,
    `襟ぐり ${fmt(neckTotal)}cm ／ 縁取り布 ${fmt(bindLen)}cm × 仕上がり幅 ${fmt(finished)}cm`,
    `胸のゆとり ${fmt(ease.chest)}cm（${woven ? '布帛' : 'ニット'}）`,
  ];
  if (p.backOpening) info.push(`背中開きの持ち出し ${fmt(openingExt)}cm`);

  return {
    pieces: [bodice.front, bodice.back, sleeve.piece, binding],
    warnings: [...bodice.warnings, ...sleeve.warnings],
    info,
  };
}

const fmt = (x: number) => (Math.round(x * 10) / 10).toFixed(1);

export class MissingMeasurementsError extends Error {
  constructor(public keys: MeasurementKey[]) {
    super(`作図に必要な採寸値がありません: ${keys.join(', ')}`);
  }
}
