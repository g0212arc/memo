// ベレー帽 = トップ（円、またははぎ合わせの扇形）＋ 下側（頭の口をあけたドーナツ形。半分ずつ 2 枚）＋ 頭の口のベルト。
// 大きさの基準はボディではなく、選んだ頭囲（ウィッグサイズのインチ）。かぶる物なので範囲の大きい方で作る。
// 座標: 円の中心が (0, 0)。

import { v } from '../../geometry/vec';
import { Seg, cubic, line, pathLength } from '../../geometry/path';
import { ResolvedBody } from '../../model/estimate';
import { MeasurementKey } from '../../model/schema';
import { DraftResult, Piece } from '../types';

export type BeretHead = '9-10' | '8-9' | '7-8' | '6-7' | 'custom';
export type BeretFit = 'tight' | 'normal' | 'loose' | 'custom';
export type BeretPuff = 'small' | 'normal' | 'large' | 'custom';

export interface BeretParams {
  head: BeretHead;
  /** head が custom のときの頭囲（cm） */
  headCustom: number | null;
  fit: BeretFit;
  /** fit が custom のときの頭の口のゆとり（cm、マイナス可） */
  fitCustom: number | null;
  puff: BeretPuff;
  /** puff が custom のときのトップの直径（cm） */
  puffCustom: number | null;
  top: 'circle' | 'panels';
  /** はぎ合わせの枚数（プルダウンの値は文字列） */
  panels: '6' | '8' | 'custom';
  panelsCustom: number | null;
  edge: 'band' | 'elastic';
  stem: boolean;
}

export const DEFAULT_BERET: BeretParams = {
  head: '7-8',
  headCustom: null,
  fit: 'normal',
  fitCustom: null,
  puff: 'normal',
  puffCustom: null,
  top: 'circle',
  panels: '6',
  panelsCustom: null,
  edge: 'band',
  stem: true,
};

export const BERET_HEAD_LABEL: Record<BeretHead, string> = { '9-10': '9〜10インチ', '8-9': '8〜9インチ', '7-8': '7〜8インチ', '6-7': '6〜7インチ', custom: '自分で入力' };
export const BERET_FIT_LABEL: Record<BeretFit, string> = { tight: 'きつめ', normal: '普通', loose: 'ゆるめ', custom: '自分で入力' };
export const BERET_PUFF_LABEL: Record<BeretPuff, string> = { small: '小さめ（ちょこんと乗る）', normal: '普通', large: '大きめ（ふんわり）', custom: '自分で入力' };
/** 範囲の大きい方（インチ） */
const HEAD_INCH: Record<Exclude<BeretHead, 'custom'>, number> = { '9-10': 10, '8-9': 9, '7-8': 8, '6-7': 7 };
const INCH = 2.54;
const FIT_RATIO: Record<Exclude<BeretFit, 'custom'>, number> = { tight: 0, normal: 0.02, loose: 0.05 };
/** トップの直径 ÷ 頭の口の直径 */
const PUFF_RATIO: Record<Exclude<BeretPuff, 'custom'>, number> = { small: 1.15, normal: 1.45, large: 1.8 };

/** ボディの採寸値は使わない */
export const BERET_REQUIREMENTS: { key: MeasurementKey; hard: boolean }[] = [];

const fmt = (x: number) => (Math.round(x * 10) / 10).toFixed(1);
const finite = (x: number | null): x is number => x !== null && Number.isFinite(x);
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** 中心 (0,0)・半径 r の円弧（角度 a0 → a1、ラジアン。0 が右、y 下向きで時計回り）。90° ごとに 3 次ベジェ */
function arc(r: number, a0: number, a1: number): Seg[] {
  const pt = (a: number) => v(r * Math.cos(a), r * Math.sin(a));
  const tan = (a: number) => v(-Math.sin(a), Math.cos(a));
  const n = Math.max(1, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 2) - 1e-9));
  const segs: Seg[] = [];
  for (let i = 0; i < n; i++) {
    const s = a0 + ((a1 - a0) * i) / n;
    const e = a0 + ((a1 - a0) * (i + 1)) / n;
    const k = (4 / 3) * Math.tan((e - s) / 4) * r;
    const p0 = pt(s);
    const p1 = pt(e);
    segs.push(cubic(p0, v(p0.x + tan(s).x * k, p0.y + tan(s).y * k), v(p1.x - tan(e).x * k, p1.y - tan(e).y * k), p1));
  }
  return segs;
}
const reverseSegs = (segs: Seg[]): Seg[] => [...segs].reverse().map((s) => (s.kind === 'line' ? line(s.to, s.from) : cubic(s.to, s.c2, s.c1, s.from)));

export function draftBeret(_r: ResolvedBody, p: BeretParams): DraftResult {
  const warnings: string[] = [];
  const info: string[] = [];
  const head = p.head === 'custom' && finite(p.headCustom) && p.headCustom > 0 ? p.headCustom : HEAD_INCH[p.head === 'custom' ? '7-8' : p.head] * INCH;
  const ease = p.fit === 'custom' && finite(p.fitCustom) ? p.fitCustom : head * FIT_RATIO[p.fit === 'custom' ? 'normal' : p.fit];
  const opening = Math.max(head * 0.6, head + ease); // 仕上がりの頭の口
  const elastic = p.edge === 'elastic';
  // ゴム入りは 1 割大きく裁ってゴムで縮める
  const openCut = elastic ? opening * 1.1 : opening;
  const rIn = openCut / (2 * Math.PI);
  let D = p.puff === 'custom' && finite(p.puffCustom) ? p.puffCustom : (opening / Math.PI) * PUFF_RATIO[p.puff === 'custom' ? 'normal' : p.puff];
  const minD = rIn * 2 + 1;
  if (D < minD) {
    D = minD;
    warnings.push(`トップの直径が頭の口より小さいため、${fmt(minD)}cm にしました。`);
  }
  const R = D / 2;
  const pieces: Piece[] = [];

  // ---- トップ ----
  const nPanels = p.top === 'panels' ? clamp(Math.round(p.panels === 'custom' ? (finite(p.panelsCustom) ? p.panelsCustom : 6) : Number(p.panels)), 3, 16) : 1;
  if (nPanels === 1) {
    pieces.push({
      id: 'beret-top',
      name: 'トップ',
      cut: '1枚',
      edges: [{ segs: arc(R, 0, 2 * Math.PI), kind: 'seam', name: '縁' }],
      grain: [v(0, -R * 0.6), v(0, R * 0.6)],
      marks: p.stem ? [[v(-0.2, 0), v(0.2, 0)], [v(0, -0.2), v(0, 0.2)]] : undefined,
    });
  } else {
    // 扇形（先が中心）。左右の辺を隣と縫い合わせる
    const a = (2 * Math.PI) / nPanels;
    const a0 = Math.PI / 2 - a / 2; // 下向きに開いた扇
    const a1 = Math.PI / 2 + a / 2;
    const P0 = v(R * Math.cos(a0), R * Math.sin(a0));
    const P1 = v(R * Math.cos(a1), R * Math.sin(a1));
    pieces.push({
      id: 'beret-top',
      name: `トップ（はぎ合わせ ${nPanels} 枚）`,
      cut: `${nPanels}枚`,
      edges: [
        { segs: [line(v(0, 0), P0)], kind: 'seam', name: 'はぎ目' },
        { segs: arc(R, a0, a1), kind: 'seam', name: '縁' },
        { segs: [line(P1, v(0, 0))], kind: 'seam', name: 'はぎ目' },
      ],
      grain: [v(0, R * 0.25), v(0, R * 0.85)],
    });
  }

  // ---- 下側（ドーナツ形を半分ずつ） ----
  // 外まわり（右 → 下 → 左）、左の切れ目、頭の口（左 → 下 → 右）、右の切れ目
  pieces.push({
    id: 'beret-under',
    name: '下側（半分）',
    cut: '2枚',
    edges: [
      { segs: arc(R, 0, Math.PI), kind: 'seam', name: '外まわり' },
      { segs: [line(v(-R, 0), v(-rIn, 0))], kind: 'seam', name: '切れ目' },
      { segs: reverseSegs(arc(rIn, 0, Math.PI)), kind: elastic ? 'hem' : 'seam', name: elastic ? '頭の口（三つ折りでゴム通し）' : '頭の口' },
      { segs: [line(v(rIn, 0), v(R, 0))], kind: 'seam', name: '切れ目' },
    ],
    grain: [v(0, rIn + (R - rIn) * 0.2), v(0, rIn + (R - rIn) * 0.8)],
  });

  // ---- 頭の口のベルト（二つ折り） ----
  const bandH = clamp(head * 0.04, 0.5, 1.2);
  if (!elastic) {
    pieces.push({
      id: 'beret-band',
      name: 'ベルト（高さ方向に二つ折り・輪にする）',
      cut: '1枚',
      edges: [
        { segs: [line(v(0, 0), v(opening, 0))], kind: 'seam', name: '頭の口側' },
        { segs: [line(v(opening, 0), v(opening, bandH * 2))], kind: 'seam', name: '端' },
        { segs: [line(v(opening, bandH * 2), v(0, bandH * 2))], kind: 'seam', name: '頭の口側' },
        { segs: [line(v(0, bandH * 2), v(0, 0))], kind: 'seam', name: '端' },
      ],
      grain: [v(opening * 0.5 - Math.min(opening * 0.3, 3), bandH), v(opening * 0.5 + Math.min(opening * 0.3, 3), bandH)],
    });
  }

  // ---- ヘタ ----
  if (p.stem) {
    const sw = Math.max(1, head * 0.08);
    const sh = Math.max(0.6, head * 0.035);
    pieces.push({
      id: 'beret-stem',
      name: 'ヘタ（細く巻いて筒にする）',
      cut: '1枚',
      edges: [
        { segs: [line(v(0, 0), v(sw, 0))], kind: 'seam', name: '付け側' },
        { segs: [line(v(sw, 0), v(sw, sh))], kind: 'seam', name: '端' },
        { segs: [line(v(sw, sh), v(0, sh))], kind: 'hem', name: '先' },
        { segs: [line(v(0, sh), v(0, 0))], kind: 'seam', name: '端' },
      ],
      grain: [v(sw * 0.5, sh * 0.85), v(sw * 0.5, sh * 0.15)],
    });
  }

  info.unshift(
    `頭囲 ${fmt(head)}cm（${BERET_HEAD_LABEL[p.head]}）／ 頭の口 ${fmt(opening)}cm（ゆとり ${fmt(ease)}cm・${BERET_FIT_LABEL[p.fit]}）`,
    `トップの直径 ${fmt(D)}cm（${BERET_PUFF_LABEL[p.puff]}）／ 縁の周り ${fmt(pathLength(arc(R, 0, 2 * Math.PI)))}cm`,
  );
  if (nPanels > 1) info.push(`トップは ${nPanels} 枚の扇形を縫い合わせます`);
  if (elastic) info.push(`頭の口: 三つ折りにしてゴムを通します（裁つ周り ${fmt(openCut)}cm・ゴムの長さの目安 ${fmt(opening * 0.9)}cm）`);
  else info.push(`ベルト ${fmt(opening)}cm × 仕上がりの高さ ${fmt(bandH)}cm（端を縫って輪にしてから付けます）`);
  if (p.stem) info.push('ヘタ: 細く巻いて筒にし、トップの中心の印に縫い付けます');
  return { pieces, warnings, info, refs: { fit: ease } };
}
