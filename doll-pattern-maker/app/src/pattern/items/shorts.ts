// ショーツ = 伸びる布で、ヒップに合わせて少し小さく作る（タイツと同じ考え方）。
// 前中心をわにした半分で作図。クロッチ一続きなら、前 → 股 → 後ろ が縦につながった 1 枚（縫うのは脇だけ）。
// 別に裁つなら、前・後ろ・クロッチ（股の当て布）の 3 つに分ける。
// 座標: x は中心を 0 として脇へ正、y は前のウエストが 0 で下向き（後ろのウエストが一番下）。

import { v } from '../../geometry/vec';
import { cubic, line, pathLength } from '../../geometry/path';
import { ResolvedBody } from '../../model/estimate';
import { MeasurementKey } from '../../model/schema';
import { DraftResult, Edge, EdgeKind, Piece } from '../types';
import { Snug, tightsReduction } from './tights';
import { MissingMeasurementsError } from './tshirt';

export type ShortsShape = 'bikini' | 'boyleg' | 'highleg';
export type ShortsRise = 'low' | 'normal' | 'high' | 'custom';

export interface ShortsParams {
  stretch: number;
  shape: ShortsShape;
  rise: ShortsRise;
  /** rise が custom のときの股上（ウエストラインから股まで cm） */
  riseCustom: number | null;
  crotch: 'integrated' | 'separate';
  edge: 'elastic' | 'hem';
  snug: Snug;
  reduceCustom: number | null;
}

export const DEFAULT_SHORTS: ShortsParams = {
  stretch: 40,
  shape: 'bikini',
  rise: 'normal',
  riseCustom: null,
  crotch: 'integrated',
  edge: 'elastic',
  snug: 'normal',
  reduceCustom: null,
};

export const SHORTS_SHAPE_LABEL: Record<ShortsShape, string> = { bikini: 'ノーマル（ビキニ）', boyleg: 'ボーイレッグ', highleg: 'ハイレグ' };
export const SHORTS_RISE_LABEL: Record<ShortsRise, string> = { low: '浅め', normal: '普通', high: '深め（ウエストまで）', custom: '自分で入力' };

export const SHORTS_REQUIREMENTS: { key: MeasurementKey; hard: boolean }[] = [
  { key: 'waist_circ', hard: true },
  { key: 'hip_circ', hard: true },
  { key: 'rise', hard: false },
];

const fmt = (x: number) => (Math.round(x * 10) / 10).toFixed(1);
const finite = (x: number | null): x is number => x !== null && Number.isFinite(x);
const LOW: Record<Exclude<ShortsRise, 'custom'>, number> = { low: 0.35, normal: 0.15, high: 0 };
const SIDE: Record<ShortsShape, number> = { bikini: 0.45, highleg: 0.2, boyleg: 0.75 };

export function draftShorts(r: ResolvedBody, p: ShortsParams): DraftResult {
  const missing = SHORTS_REQUIREMENTS.filter((q) => r.values[q.key] === undefined).map((q) => q.key);
  if (missing.length > 0) throw new MissingMeasurementsError(missing);
  const val = (k: MeasurementKey) => r.values[k] as number;
  const warnings: string[] = [];
  const info: string[] = [];
  const red = tightsReduction({ ...p, opening: 'none' });
  const W = 1 - red;
  const V = 1 - red * 0.3;

  const R = val('rise');
  // 股上: 浅いほどウエストラインを下げる（幅はヒップに近づく）
  const lowF = p.rise === 'custom' && finite(p.riseCustom) ? Math.min(0.8, Math.max(0, 1 - p.riseCustom / R)) : LOW[p.rise === 'custom' ? 'normal' : p.rise];
  const k = (1 - lowF) * V;
  const gl = Math.max(0.5, R * 0.3) * V; // 股の部分（クロッチ）の長さ
  const fc = Math.max(0.5, R * 0.95 * k - gl / 2); // 前中心: ウエストラインから股の部分まで
  const bc = Math.max(0.5, R * 1.15 * k - gl / 2); // 後ろ中心（お尻の分長い）
  const yC = fc; // 股の部分の上端
  const yB = fc + gl; // 股の部分の下端
  const L = yB + bc; // 後ろのウエストライン
  const waist = val('waist_circ');
  const hip = val('hip_circ');
  const wTop = ((waist + (hip - waist) * Math.min(1, lowF * 1.6)) * W) / 4; // ウエストラインの幅（半分の半分）
  const hipQ = (hip * W) / 4;
  const cw = Math.max(0.4, hip * 0.045 * W); // 股の部分の幅（半分）
  // 脚ぐりが股へ曲がる分（縦 1cm か前の股上の 3 割）は残す。急な曲がりは縫い代がとげになる
  const sideLen = Math.max(0.3, Math.min(fc * SIDE[p.shape], fc - Math.min(1, fc * 0.3)));
  // 脇は前後で縫い合わせるので、脇の点は前後同じ幅（後ろのお尻の分は脚ぐりのカーブで出す）
  const sxF = hipQ;
  const sxB = hipQ;
  const legKind: EdgeKind = 'hem';
  const boy = p.shape === 'boyleg';

  // 脚ぐりは股の部分へ縦向きに入る（前の脚ぐり → 股 → 後ろの脚ぐりが 1 本のなめらかな線になり、縫い代が重ならない）
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const hf = yC - sideLen;
  const hb = L - sideLen - yB;
  const frontLeg = cubic(v(sxF, sideLen), v(lerp(sxF, cw, boy ? 0.75 : 0.55), sideLen + hf * (boy ? 0.15 : 0.25)), v(cw, yC - hf * 0.45), v(cw, yC));
  const backLeg = cubic(v(cw, yB), v(cw, yB + hb * 0.4), v(lerp(sxB, cw, boy ? 0.6 : 0.35), L - sideLen - hb * (boy ? 0.1 : 0.3)), v(sxB, L - sideLen));
  const waistKind: EdgeKind = 'hem';
  const pieces: Piece[] = [];
  const frontEdges = (bottom: Edge[]): Edge[] => [
    { segs: [line(v(0, 0), v(wTop, 0))], kind: waistKind, name: 'ウエスト（前）' },
    { segs: [line(v(wTop, 0), v(sxF, sideLen))], kind: 'seam', name: '脇（前）' },
    { segs: [frontLeg], kind: legKind, name: '脚ぐり（前）' },
    ...bottom,
  ];
  if (p.crotch === 'integrated') {
    pieces.push({
      id: 'shorts',
      name: 'ショーツ（前・股・後ろ続き）',
      cut: '1枚（わ）',
      edges: [
        ...frontEdges([]),
        { segs: [line(v(cw, yC), v(cw, yB))], kind: legKind, name: '股' },
        { segs: [backLeg], kind: legKind, name: '脚ぐり（後ろ）' },
        { segs: [line(v(sxB, L - sideLen), v(wTop, L))], kind: 'seam', name: '脇（後ろ）' },
        { segs: [line(v(wTop, L), v(0, L))], kind: waistKind, name: 'ウエスト（後ろ）' },
        { segs: [line(v(0, L), v(0, 0))], kind: 'fold', name: '中心（わ）' },
      ],
      grain: [v(Math.max(0.3, cw * 0.5), fc * 0.2), v(Math.max(0.3, cw * 0.5), L - bc * 0.2)],
      marks: [[v(0, yC), v(cw, yC)], [v(0, yB), v(cw, yB)]],
    });
  } else {
    pieces.push({
      id: 'shorts-front',
      name: 'ショーツ（前）',
      cut: '1枚（わ）',
      edges: [
        ...frontEdges([{ segs: [line(v(cw, yC), v(0, yC))], kind: 'seam', name: 'クロッチ付け' }]),
        { segs: [line(v(0, yC), v(0, 0))], kind: 'fold', name: '前中心（わ）' },
      ],
      grain: [v(Math.max(0.3, cw * 0.5), fc * 0.15), v(Math.max(0.3, cw * 0.5), fc * 0.85)],
    });
    // 後ろは y を後ろのウエストが 0 になるよう上下を入れ替えずにそのまま（縫い合わせの向きが分かりやすいよう）
    pieces.push({
      id: 'shorts-back',
      name: 'ショーツ（後ろ）',
      cut: '1枚（わ）',
      edges: [
        { segs: [line(v(0, yB), v(cw, yB))], kind: 'seam', name: 'クロッチ付け' },
        { segs: [backLeg], kind: legKind, name: '脚ぐり（後ろ）' },
        { segs: [line(v(sxB, L - sideLen), v(wTop, L))], kind: 'seam', name: '脇（後ろ）' },
        { segs: [line(v(wTop, L), v(0, L))], kind: waistKind, name: 'ウエスト（後ろ）' },
        { segs: [line(v(0, L), v(0, yB))], kind: 'fold', name: '後ろ中心（わ）' },
      ],
      grain: [v(Math.max(0.3, cw * 0.5), yB + bc * 0.15), v(Math.max(0.3, cw * 0.5), L - bc * 0.15)],
    });
    pieces.push({
      id: 'gusset',
      name: 'クロッチ（股の当て布）',
      cut: '2枚（わ・表と裏）',
      edges: [
        { segs: [line(v(0, 0), v(cw, 0))], kind: 'seam', name: 'クロッチ付け（前）' },
        { segs: [line(v(cw, 0), v(cw, gl))], kind: legKind, name: '股' },
        { segs: [line(v(cw, gl), v(0, gl))], kind: 'seam', name: 'クロッチ付け（後ろ）' },
        { segs: [line(v(0, gl), v(0, 0))], kind: 'fold', name: '中心（わ）' },
      ],
      grain: [v(Math.max(0.2, cw * 0.5), gl * 0.15), v(Math.max(0.2, cw * 0.5), gl * 0.85)],
    });
  }

  const legLen = 2 * (pathLength([frontLeg]) + gl + pathLength([backLeg]));
  info.unshift(
    `${SHORTS_SHAPE_LABEL[p.shape]} ／ 股上 ${SHORTS_RISE_LABEL[p.rise]} ／ クロッチ ${p.crotch === 'integrated' ? '一続き' : '別に裁つ'}`,
    `周りを ${fmt(red * 100)}% 小さく（伸び率 ${p.stretch}%）／ ウエストライン ${fmt(wTop * 4)}cm ／ ヒップ ${fmt(hipQ * 4)}cm`,
  );
  if (p.edge === 'elastic') {
    info.push(`縁: 細いゴムを縫い付けます（ゴムの長さの目安 ウエスト ${fmt(wTop * 4 * 0.85)}cm・脚ぐり 片方 ${fmt((legLen / 2) * 0.85)}cm）`);
  } else {
    info.push('縁: 三つ折り（ゴムなし）');
  }
  if (p.crotch === 'integrated') info.push('真ん中の 2 本の線のあいだが股の部分です（脇だけを縫います）');
  info.push('布は伸びる薄手（ナイロンスムース・ストレッチ天竺など）を');
  info.push(`カテゴリ ${r.category ?? '未分類'}${r.categoryGuessed ? '（仮）' : ''}`);
  return { pieces, warnings, info, refs: { rise: R * (1 - lowF), snug: red * 100 }, refUnits: { snug: '%' } };
}
