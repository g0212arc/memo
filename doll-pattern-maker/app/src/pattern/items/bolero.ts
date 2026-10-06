// ボレロ = 丈の短い前開きの上着（布帛・ワンピースの上に着るゆとり）。身頃は総裏で縫い返す。
// 前は重ねずに前中心で突き合わせ、丸くカットするときは前端を前中心から脇へ曲線で切り上げる。
// 袖は普通の袖（長袖・半袖）か、ブラウスのパフスリーブ。ノースリーブは袖ぐりも裏地と縫い返す。
// 座標: x は中心が 0 で脇へ正、y は首の付け根の高さが 0 で下向き。

import { v } from '../../geometry/vec';
import { cubic, line, pathLength, Seg } from '../../geometry/path';
import { ResolvedBody } from '../../model/estimate';
import { MeasurementKey } from '../../model/schema';
import { CATEGORY_EASE } from '../../model/category';
import { draftBodice } from '../bodice';
import { useBustDart } from '../bust';
import { draftSleeve } from '../sleeve';
import { defaultEase, scaleEase } from '../ease';
import { applyFit } from '../fit';
import { DraftResult, EdgeKind, Piece } from '../types';
import { MissingMeasurementsError, TSHIRT_REQUIREMENTS } from './tshirt';
import { COMMON_DEFAULTS, puffSleeve } from './blouse';
import { rect } from './dress-skirt';

export type BoleroSleeve = 'long' | 'short' | 'puff' | 'none';

export interface BoleroParams {
  bustDart: boolean;
  sleeve: BoleroSleeve;
  length: 'under' | 'waist';
  front: 'round' | 'straight';
  closure: 'none' | 'ribbon';
  frill: boolean;
}

export const DEFAULT_BOLERO: BoleroParams = { bustDart: true, sleeve: 'long', length: 'under', front: 'round', closure: 'none', frill: false };
export const BOLERO_SLEEVE_LABEL: Record<BoleroSleeve, string> = { long: '長袖', short: '半袖', puff: 'パフスリーブ半袖', none: 'ノースリーブ' };
export const BOLERO_LENGTH_LABEL = { under: '胸の下', waist: 'ウエスト' };
export const BOLERO_REQUIREMENTS = TSHIRT_REQUIREMENTS;

const FRILL = 1.8;
const fmt = (x: number) => (Math.round(x * 10) / 10).toFixed(1);
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export function draftBolero(r: ResolvedBody, p: BoleroParams): DraftResult {
  const missing = BOLERO_REQUIREMENTS.filter((q) => r.values[q.key] === undefined).map((q) => q.key);
  if (missing.length > 0) throw new MissingMeasurementsError(missing);
  const val = (k: MeasurementKey) => r.values[k] as number;
  const chest = val('chest_circ');
  const info: string[] = [];
  const k = r.category ? CATEGORY_EASE[r.category] : 1;
  const ease = applyFit(scaleEase(defaultEase('woven', { chest, hip: val('hip_circ'), upperArm: val('upper_arm_circ'), armhole: val('armhole_circ') }), k), 'normal', 'normal');
  // ワンピースの上に着る分
  ease.chest += chest * 0.04 + 0.2;
  ease.armhole += val('armhole_circ') * 0.08;
  ease.arm += val('upper_arm_circ') * 0.08;
  const under = p.length === 'under';

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
      woven: true,
      neckWiden: 0.06,
      frontNeckDrop: val('neck_circ') * 0.06,
      shoulderExtend: 0,
      hemBelowWaist: under ? -val('back_length') * 0.3 : 0,
      armholeEase: ease.armhole,
      backOpening: false,
      openingExt: 0,
      bustDart: useBustDart(r, { fabric: 'woven', bustDart: p.bustDart }),
    },
  );
  const warnings = [...bodice.warnings];
  const g = bodice.geom;

  // ---- 前身頃: 前中心で突き合わせ、丸くカットするときは前端を曲線に ----
  const fe = bodice.front.edges;
  const neck = fe.find((e) => e.name === '襟ぐり')!;
  const shoulder = fe.find((e) => e.name === '肩')!;
  const arm = fe.find((e) => e.name === '袖ぐり')!;
  const side = fe.find((e) => e.name === '脇')!;
  const sideEnd = side.segs[side.segs.length - 1].to;
  const hemY = g.frontHemY;
  const fnd = g.frontNeckDepth;
  const round = p.front === 'round';
  const xR = round ? g.chestQ * 0.5 : 0; // 丸くカットした裾の端
  const yR = round ? fnd + (hemY - fnd) * 0.35 : hemY; // 前中心をまっすぐ下ろすところまで
  const frontEdge: Seg[] = round
    ? [cubic(v(xR, hemY), v(xR * 0.35, hemY), v(0, hemY - (hemY - yR) * 0.35), v(0, yR)), line(v(0, yR), v(0, fnd))]
    : [line(v(0, hemY), v(0, fnd))];
  const front: Piece = {
    ...bodice.front,
    cut: '表布 2枚・裏地 2枚（左右反転）',
    edges: [
      neck,
      shoulder,
      { ...arm, kind: 'seam' },
      side,
      { segs: [line(sideEnd, v(xR, hemY))], kind: 'seam', name: '裾' },
      { segs: frontEdge, kind: 'seam', name: '前端' },
    ],
    grain: [v(g.chestQ * 0.6, g.chestY * 0.9), v(g.chestQ * 0.6, hemY - (hemY - g.chestY) * 0.2)],
  };
  if (p.closure === 'ribbon') {
    const ry = fnd + (yR - fnd) * 0.5;
    front.marks = [...(front.marks ?? []), [v(0.15, ry - 0.3), v(0.15, ry + 0.3)]];
  }
  const back: Piece = {
    ...bodice.back,
    cut: '表布 1枚・裏地 1枚（わ）',
    edges: bodice.back.edges.map((e) => (e.kind === 'hem' ? { ...e, kind: 'seam' as EdgeKind } : e)),
  };
  const pieces: Piece[] = [front, back];

  // ---- 袖 ----
  const frontAH = pathLength(arm.segs);
  const backAH = pathLength(bodice.back.edges.find((e) => e.name === '袖ぐり')!.segs);
  if (p.sleeve === 'puff') {
    const s = puffSleeve(r, { ...COMMON_DEFAULTS, sleeve: 'puff-short', puff: 'normal', cuff: 'elastic', fit: 'normal' }, frontAH, backAH);
    pieces.push(...s.pieces);
    info.push(...s.info);
    warnings.push(...s.warnings);
  } else if (p.sleeve !== 'none') {
    const long = p.sleeve === 'long';
    const s = draftSleeve({
      frontArmholeLength: frontAH,
      backArmholeLength: backAH,
      upperArm: val('upper_arm_circ'),
      armEase: ease.arm,
      armLength: val('arm_length'),
      lengthRatio: long ? 1 : 0.4,
      widthRatio: 0.75,
      capEase: 0.03,
      hemRatio: long ? 0.85 : 0.95,
      minPass: val('elbow_pass_circ') + ease.pass,
      extraWidth: 0,
    });
    pieces.push(s.piece);
    warnings.push(...s.warnings);
    info.push(`${long ? '長袖' : '半袖'}: 袖ぐり ${fmt(frontAH + backAH)}cm ／ 袖山 ${fmt(s.capLength)}cm`);
  } else {
    info.push('ノースリーブ: 袖ぐりも表と裏を縫い返して始末します');
  }

  // ---- リボン・フリル ----
  if (p.closure === 'ribbon') {
    const rl = clamp(chest * 0.35, 3, 30);
    const rw = clamp(chest * 0.03, 0.4, 1.2);
    pieces.push(rect('ribbon', 'リボン（筒に縫って返す。前端の印に挟んで結ぶ）', '2枚', rl, rw * 2, ['縁', '端', '縁', '端']));
    info.push(`リボン ${fmt(rl)}cm × 仕上がりの幅 ${fmt(rw)}cm × 2 本`);
  }
  if (p.frill) {
    const edgeLen = pathLength(frontEdge) * 2 + 2 * (pathLength(neck.segs) + pathLength(bodice.back.edges.find((e) => e.name === '襟ぐり')!.segs));
    const fh = clamp(chest * 0.05, 0.5, 2);
    pieces.push(rect('frill', '縁のフリル（高さ方向に二つ折り・ギャザーを寄せて、前端と襟ぐりに挟む）', '1枚', edgeLen * FRILL, fh * 2, ['付け側', '端', '付け側', '端']));
    info.push(`縁のフリル ${fmt(edgeLen * FRILL)}cm × 仕上がりの幅 ${fmt(fh)}cm（前端 ＋ 襟ぐり ${fmt(edgeLen)}cm に寄せる）`);
  }

  info.unshift(
    `ボレロ ${BOLERO_LENGTH_LABEL[p.length]}丈 ／ 前 ${round ? '丸くカット' : 'まっすぐ'} ／ ${BOLERO_SLEEVE_LABEL[p.sleeve]}`,
    '身頃は表と裏をそれぞれ肩を縫い、中表で襟ぐり・前端・裾（ノースリーブは袖ぐりも）を縫って返します。最後に脇を縫います',
  );
  info.push(`胸のゆとり ${fmt(ease.chest)}cm（ワンピースの上に着る分を含む）`);
  if (g.dartApplied) info.push(`胸ダーツ ${fmt(g.bustDelta)}cm`);
  info.push(`カテゴリ ${r.category ?? '未分類'}${r.categoryGuessed ? '（仮）' : ''}`);
  return { pieces, warnings, info };
}
