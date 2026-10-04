// ベスト = 身頃原型（布帛・シャツの上に着るゆとり・深い袖ぐり）を前開きにして、総裏で縫い返す。
// V の襟ぐりは首の付け根の横から前端へ直線、裾は前の先をとがらせる（まっすぐも選べる）。
// 座標: x は中心が 0 で脇へ正（前端は前中心の外 x = −重なり）、y は首の付け根の高さが 0 で下向き。

import { v, Vec } from '../../geometry/vec';
import { line, pathLength } from '../../geometry/path';
import { ResolvedBody } from '../../model/estimate';
import { MeasurementKey } from '../../model/schema';
import { CATEGORY_EASE } from '../../model/category';
import { draftBodice } from '../bodice';
import { useBustDart } from '../bust';
import { defaultEase, scaleEase } from '../ease';
import { applyFit } from '../fit';
import { DraftResult, Edge, Piece } from '../types';
import { MissingMeasurementsError, TSHIRT_REQUIREMENTS } from './tshirt';
import { rect } from './dress-skirt';

export type VestLength = 'waist' | 'hip' | 'custom';

export interface VestParams {
  bustDart: boolean;
  front: 'single' | 'double';
  /** ボタンの数（プルダウンの値は文字列） */
  buttons: 'auto' | 'custom';
  buttonsCustom: number | null;
  neck: 'v' | 'round';
  length: VestLength;
  lengthCustom: number | null;
  hem: 'point' | 'straight';
  backFabric: 'same' | 'lining';
  backBelt: boolean;
  pocket: boolean;
}

export const DEFAULT_VEST: VestParams = {
  bustDart: true,
  front: 'single',
  buttons: 'auto',
  buttonsCustom: null,
  neck: 'v',
  length: 'waist',
  lengthCustom: null,
  hem: 'point',
  backFabric: 'same',
  backBelt: false,
  pocket: false,
};

export const VEST_LENGTH_LABEL: Record<VestLength, string> = { waist: 'ウエスト丈', hip: '腰丈', custom: '自分で入力' };
export const VEST_REQUIREMENTS = TSHIRT_REQUIREMENTS;

const fmt = (x: number) => (Math.round(x * 10) / 10).toFixed(1);
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const finite = (x: number | null): x is number => x !== null && Number.isFinite(x);
const cross = (c: Vec, r: number): Vec[][] => [[v(c.x - r, c.y), v(c.x + r, c.y)], [v(c.x, c.y - r), v(c.x, c.y + r)]];

export function draftVest(r: ResolvedBody, p: VestParams): DraftResult {
  const missing = VEST_REQUIREMENTS.filter((q) => r.values[q.key] === undefined).map((q) => q.key);
  if (missing.length > 0) throw new MissingMeasurementsError(missing);
  const val = (k: MeasurementKey) => r.values[k] as number;
  const chest = val('chest_circ');
  const wth = val('waist_to_hip');
  const info: string[] = [];
  const k = r.category ? CATEGORY_EASE[r.category] : 1;
  const ease = applyFit(scaleEase(defaultEase('woven', { chest, hip: val('hip_circ'), upperArm: val('upper_arm_circ'), armhole: val('armhole_circ') }), k), 'normal', 'normal');
  // シャツの上に着る分・ベストらしい深い袖ぐり
  ease.chest += chest * 0.03 + 0.2;
  ease.armhole += val('armhole_circ') * 0.15;
  const hemBelowWaist = p.length === 'custom' && finite(p.lengthCustom) ? p.lengthCustom : wth * (p.length === 'hip' ? 0.8 : 0.15);

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
      waistToHip: wth,
    },
    {
      ease,
      woven: true,
      neckWiden: 0.05,
      frontNeckDrop: p.neck === 'round' ? val('neck_circ') * 0.12 : 0,
      shoulderExtend: 0,
      hemBelowWaist,
      armholeEase: ease.armhole,
      backOpening: false,
      openingExt: 0,
      bustDart: useBustDart(r, { fabric: 'woven', bustDart: p.bustDart }),
    },
  );
  const warnings = [...bodice.warnings];
  const g = bodice.geom;
  const double = p.front === 'double';
  const ext = double ? clamp(g.chestQ * 0.3, 0.8, 3.5) : clamp(chest * 0.04, 0.5, 1.2);

  // ---- 前身頃 ----
  const fe = bodice.front.edges;
  const shoulder = fe.find((e) => e.name === '肩')!;
  const arm = fe.find((e) => e.name === '袖ぐり')!;
  const side = fe.find((e) => e.name === '脇')!;
  const sideEnd = side.segs[side.segs.length - 1].to;
  const drop = p.hem === 'point' ? clamp(wth * 0.35, 0.3, 4) : 0;
  const hemB = g.frontHemY + drop; // 前端の裾
  const vY = Math.max(g.frontNeckDepth, g.chestY + (Math.min(g.waistY, g.frontHemY) - g.chestY) * 0.2); // V の先
  const hem: Edge = { segs: [line(sideEnd, v(-ext, hemB))], kind: 'seam', name: '裾' };
  const frontEdges: Edge[] =
    p.neck === 'v'
      ? [
          shoulder,
          arm,
          side,
          hem,
          { segs: [line(v(-ext, hemB), v(-ext, vY))], kind: 'seam', name: '前端' },
          { segs: [line(v(-ext, vY), g.snp)], kind: 'seam', name: '襟ぐり' },
        ]
      : [
          { segs: [line(v(-ext, g.frontNeckDepth), v(0, g.frontNeckDepth))], kind: 'seam', name: '襟ぐり（前端）' },
          fe.find((e) => e.name === '襟ぐり')!,
          shoulder,
          arm,
          side,
          hem,
          { segs: [line(v(-ext, hemB), v(-ext, g.frontNeckDepth))], kind: 'seam', name: '前端' },
        ];
  // ボタンの位置: シングルは前中心 1 列、ダブルは前中心の左右 2 列
  const top = (p.neck === 'v' ? vY : g.frontNeckDepth) + ext * 0.5 + 0.3;
  const bottom = g.frontHemY - Math.max(0.4, ext * 0.4);
  const rowsAuto = double ? clamp(Math.round((bottom - top) / Math.max(chest * 0.14, 1)), 2, 4) : clamp(Math.round((bottom - top) / Math.max(chest * 0.09, 0.8)) + 1, 3, 7);
  const rows = p.buttons === 'custom' && finite(p.buttonsCustom) ? clamp(Math.round(p.buttonsCustom), 1, 10) : rowsAuto;
  const cols = double ? [-ext * 0.6, ext * 0.6] : [0];
  const br = Math.min(0.2, ext * 0.25);
  const marks: Vec[][] = [...(bodice.front.marks ?? [])];
  for (let i = 0; i < rows; i++) {
    const y = rows === 1 ? top : top + ((bottom - top) * i) / (rows - 1);
    for (const x of cols) marks.push(...cross(v(x, y), br));
  }
  // 箱ポケット風の口布の位置（胸の下）
  const pw = clamp(g.chestQ * 0.4, 0.8, 5);
  const ph = clamp(pw * 0.25, 0.3, 1.2);
  const px = g.chestQ * 0.4;
  const py = g.chestY + (g.frontHemY - g.chestY) * 0.35;
  if (p.pocket) marks.push([v(px, py), v(px + pw, py - pw * 0.06), v(px + pw, py - pw * 0.06 + ph), v(px, py + ph), v(px, py)]);
  // 布目線はボタンの印とポケットの印のあいだ
  const gx = double ? (ext * 0.6 + br + px) / 2 : g.chestQ * 0.25;
  const front: Piece = {
    ...bodice.front,
    cut: '表布 2枚・裏地 2枚（左右反転）',
    edges: frontEdges,
    marks,
    grain: [v(gx, g.chestY * 0.9), v(gx, g.frontHemY - (g.frontHemY - g.chestY) * 0.25)],
  };
  const pieces: Piece[] = [front];

  // ---- 後ろ身頃（総裏。表と同じ布か、裏地の布で） ----
  const back: Piece = {
    ...bodice.back,
    cut: p.backFabric === 'lining' ? '裏地 2枚（わ・表と裏とも裏地の布）' : '表布 1枚・裏地 1枚（わ）',
    edges: bodice.back.edges.map((e) => (e.name === '裾' ? { ...e, kind: 'seam' } : e)),
  };
  if (p.backBelt) {
    const by = g.waistY - 0.2;
    back.marks = [...(back.marks ?? []), [v(g.chestQ * 0.78, by - 0.3), v(g.chestQ * 0.78, by + 0.3)]];
  }
  pieces.push(back);

  // ---- 背中のベルト・ポケットの口布 ----
  if (p.backBelt) {
    const bw = clamp(val('back_length') * 0.08, 0.4, 1.5);
    const bl = g.chestQ * 0.6;
    pieces.push(rect('back-belt', '背中のベルト（高さ方向に二つ折り。印に挟み、尾錠で留める）', '2枚', bl, bw * 2, ['縁', '端', '縁', '端']));
    info.push(`背中のベルト ${fmt(bl)}cm × 仕上がりの幅 ${fmt(bw)}cm × 2 本（脇寄りの印に挟む）`);
  }
  if (p.pocket) {
    pieces.push(rect('welt', '箱ポケットの口布（高さ方向に二つ折り。印に縫い付けて起こす）', '2枚', pw, ph * 2, ['付け側', '端', '付け側', '端']));
    info.push(`箱ポケット風の口布 ${fmt(pw)}cm × 高さ ${fmt(ph)}cm（飾り）`);
  }

  info.unshift(
    `ベスト ${double ? 'ダブル' : 'シングル'}（重なり ${fmt(ext)}cm・ボタン ${rows}${double ? ' 段 × 2 列' : ' 個'}）／ 襟ぐり ${p.neck === 'v' ? 'V' : '丸'} ／ ${VEST_LENGTH_LABEL[p.length]} ウエストから ${fmt(hemBelowWaist)}cm`,
    `裾 ${p.hem === 'point' ? `前の先をとがらせる（${fmt(drop)}cm 下げる）` : 'まっすぐ'} ／ 背中 ${p.backFabric === 'lining' ? '裏地の布' : '表と同じ布'}`,
    '表と裏をそれぞれ肩を縫い、中表で襟ぐり・前端・裾・袖ぐりを縫って、肩から引き出して返します。最後に脇を縫います',
  );
  info.push(`胸のゆとり ${fmt(ease.chest)}cm ／ 袖ぐり ${fmt(pathLength(arm.segs) + pathLength(bodice.back.edges.find((e) => e.name === '袖ぐり')!.segs))}cm`);
  if (g.dartApplied) info.push(`胸ダーツ ${fmt(g.bustDelta)}cm`);
  info.push(`カテゴリ ${r.category ?? '未分類'}${r.categoryGuessed ? '（仮）' : ''}`);
  return { pieces, warnings, info };
}
