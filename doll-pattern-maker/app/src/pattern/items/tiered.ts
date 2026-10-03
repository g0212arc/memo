// ティアードスカート。段（長方形）を縦に重ね、下の段ほど長くしてギャザーで上の段に付ける。
// 一番上の段は「ヨーク（ギャザーなし）」か「ギャザー」。ヨークはゴムなら長方形（ヒップが通る周り）、ベルトならウエスト→ヒップに沿った形。
// どの段もヒップが通る周り以上にする（ベルトの後ろ開きは一番上の段だけ）。
// 前・後ろとも中心を「わ」にした 1/4 で作図（ベルト付きの 1 段目の後ろは後ろ中心で開く）。たたんだ布（55cm）に入らない段は、はぎ合わせる枚数を増やす。
// 座標: x は中心が 0 で脇へ正、y は段の上が 0 で下向き。

import { v, Vec } from '../../geometry/vec';
import { Seg, cubic, line } from '../../geometry/path';
import { ResolvedBody } from '../../model/estimate';
import { DraftResult, Edge, EdgeKind, Piece } from '../types';
import { extMarks, ExtParams, openingExtOf } from '../opening';
import { bandHeight, centerEdges, extWaistEdge, openingLength, SKIRT_LENGTH_LABEL, SKIRT_REQUIREMENTS, SkirtLength, SkirtWaist, skirtBase, waistbandPiece } from './skirt';

export type TieredGather = 'light' | 'normal' | 'full' | 'custom';

export interface TieredParams extends ExtParams {
  /** 段の数（プルダウンの値は文字列） */
  tiers: '2' | '3' | '4' | 'custom';
  tiersCustom: number | null;
  heights: 'equal' | 'graded';
  gather: TieredGather;
  /** gather が custom のときの倍率（下の段 ÷ 上の段） */
  gatherCustom: number | null;
  top: 'yoke' | 'gather';
  waist: SkirtWaist;
  length: SkirtLength;
  lengthCustom: number | null;
  hem: 'fold' | 'lace';
}

export const DEFAULT_TIERED: TieredParams = {
  tiers: '3',
  tiersCustom: null,
  heights: 'equal',
  gather: 'normal',
  gatherCustom: null,
  top: 'yoke',
  waist: 'elastic',
  length: 'knee',
  lengthCustom: null,
  hem: 'fold',
};

export const TIERED_GATHER_LABEL: Record<TieredGather, string> = { light: '控えめ（1.3 倍）', normal: '普通（1.5 倍）', full: 'たっぷり（2 倍）', custom: '自分で入力' };
const GATHER_RATIO: Record<Exclude<TieredGather, 'custom'>, number> = { light: 1.3, normal: 1.5, full: 2 };
export const TIERED_HEIGHTS_LABEL = { equal: '同じ高さ', graded: '下ほど高く' };
export const TIERED_TOP_LABEL = { yoke: 'ヨーク（ギャザーなし）', gather: 'ギャザー' };
export const TIERED_REQUIREMENTS = SKIRT_REQUIREMENTS;
/** 「下ほど高く」の 1 段ごとの比 */
const GRADE = 1.25;
/** たたんだ布の幅。これに入らない段は、はぎ合わせる枚数を増やす */
const FOLDED_FABRIC = 55;

const fmt = (x: number) => (Math.round(x * 10) / 10).toFixed(1);
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const finite = (x: number | null): x is number => x !== null && Number.isFinite(x);

export const tierCount = (p: Pick<TieredParams, 'tiers' | 'tiersCustom'>) =>
  p.tiers === 'custom' ? clamp(Math.round(finite(p.tiersCustom) ? p.tiersCustom : 3), 2, 6) : Number(p.tiers);
export const gatherRatio = (p: Pick<TieredParams, 'gather' | 'gatherCustom'>) =>
  p.gather === 'custom' ? clamp(finite(p.gatherCustom) ? p.gatherCustom : 1.5, 1, 4) : GATHER_RATIO[p.gather];

/** 辺の真ん中の小さな印（ギャザーを均等に寄せる合わせ目） */
const tick = (x: number, y: number, down: boolean): Vec[] => [v(x, y), v(x, y + (down ? 0.3 : -0.3))];

export function draftTiered(r: ResolvedBody, p: TieredParams): DraftResult {
  const b = skirtBase(r, p.length, p.lengthCustom);
  const warnings = [...b.warnings];
  const info: string[] = [];
  const belt = p.waist === 'belt';
  const yoke = p.top === 'yoke';
  const bandH = belt ? bandHeight(b.wh) : 0;
  const L = b.length - bandH;
  const n = tierCount(p);
  const ratio = gatherRatio(p);
  const lace = p.hem === 'lace';

  // ---- 段の高さ ----
  const weights = Array.from({ length: n }, (_, i) => (p.heights === 'graded' ? GRADE ** i : 1));
  const wSum = weights.reduce((a, x) => a + x, 0);
  let h = weights.map((w) => (L * w) / wSum);
  // ベルト付きのヨークは、ヒップまで沿わせて後ろ開きが入る高さにする
  const yokeMin = belt && yoke ? Math.min(b.wh * 1.25, L * 0.5) : 0;
  if (h[0] < yokeMin) {
    const restW = wSum - weights[0];
    h = [yokeMin, ...weights.slice(1).map((w) => ((L - yokeMin) * w) / restW)];
    info.push(`ヨークはヒップが入るよう ${fmt(yokeMin)}cm にし、残りを下の段に分けました`);
  }

  // ---- 段の周り（下の辺の長さ） ----
  // ベルト付きのヨーク: ウエスト → ヒップ（ヨークがヒップより短いときは途中まで）
  const yokeBottom = b.waistF + (b.hipF - b.waistF) * Math.min(1, h[0] / b.wh);
  const W: number[] = [];
  W[0] = yoke ? (belt ? yokeBottom : b.hipF) : Math.max(b.hipF, b.waistF * ratio);
  for (let k = 1; k < n; k++) W[k] = Math.max(b.hipF, W[k - 1] * ratio);

  if (W[n - 1] > b.hipF * 15) warnings.push(`裾の周りが ${fmt(W[n - 1])}cm（ヒップの ${Math.round(W[n - 1] / b.hipF)} 倍）と長くなっています。段の数かギャザーの量を減らすと縫いやすくなります。`);

  const yOpen = belt ? Math.min(openingLength(b.wh, L), h[0] - Math.min(0.3, h[0] * 0.1)) : 0;
  const ext = belt ? openingExtOf(p, b.hipF) : 0;
  const pieces: Piece[] = [];

  for (let k = 0; k < n; k++) {
    const H = h[k];
    const last = k === n - 1;
    const topEdge = (x0: number, x1: number): Edge =>
      k === 0
        ? { segs: [line(v(x0, 0), v(x1, 0))], kind: (belt ? 'seam' : 'hem') as EdgeKind, name: 'ウエスト' }
        : { segs: [line(v(x0, 0), v(x1, 0))], kind: 'seam', name: '段の上（ギャザー）' };
    const bottomEdge = (x1: number, x0: number): Edge =>
      last
        ? { segs: [line(v(x1, H), v(x0, H))], kind: lace ? 'seam' : 'hem', name: lace ? '裾（レース付け）' : '裾' }
        : { segs: [line(v(x1, H), v(x0, H))], kind: 'seam', name: '段の下' };
    const label = k === 0 && yoke ? 'ヨーク' : `${k + 1}段目`;

    for (const isFront of [true, false]) {
      const id = `tier${k + 1}-${isFront ? 'front' : 'back'}`;
      const name = `${label}（${isFront ? '前' : '後ろ'}）`;
      const opening = belt && k === 0 && !isFront;

      if (k === 0 && yoke && belt) {
        // ウエスト → ヒップに沿った形（脇のカーブだけで詰める）
        const wq = b.waistF / 4;
        const bq = yokeBottom / 4;
        const yH = Math.min(b.wh, H);
        const side: Seg[] = [cubic(v(wq, 0), v(wq + (bq - wq) * 0.35, yH * 0.25), v(bq, yH * 0.55), v(bq, yH))];
        if (H > yH + 1e-9) side.push(line(v(bq, yH), v(bq, H)));
        const edges: Edge[] = [
          ...(opening && ext > 0 ? [extWaistEdge(ext, 0, 'seam')] : []),
          topEdge(0, wq),
          { segs: side, kind: 'seam', name: '脇' },
          bottomEdge(bq, 0),
          ...centerEdges(H, isFront, opening, 0, yOpen, 0, opening ? ext : 0),
        ];
        const em = opening && ext > 0 ? extMarks(0, yOpen, ext) : null;
        pieces.push({
          id,
          name,
          cut: opening ? '2枚（左右反転）' : '1枚（わ）',
          edges,
          grain: [v(bq * 0.45, H * 0.2), v(bq * 0.45, H * 0.8)],
          marks: [tick(bq / 2, H, false), ...(em?.marks ?? [])],
          notes: em?.notes,
        });
        continue;
      }

      // 長方形。たたんだ布に入るなら 1/4（中心わ）、入らなければ はぎ合わせる枚数を増やす
      const half = W[k] / 2;
      const m = opening ? 1 : Math.max(1, Math.ceil(half / FOLDED_FABRIC - 1e-9));
      const w = m === 1 ? half / 2 : half / m;
      const marks: Vec[][] = [tick(w / 2, 0, true), tick(w / 2, H, false)];
      let edges: Edge[];
      let cut: string;
      let notes = undefined;
      if (m === 1) {
        edges = [
          ...(opening && ext > 0 ? [extWaistEdge(ext, 0, 'seam')] : []),
          topEdge(0, w),
          { segs: [line(v(w, 0), v(w, H))], kind: 'seam', name: '脇' },
          bottomEdge(w, 0),
          ...centerEdges(H, isFront, opening, 0, yOpen, 0, opening ? ext : 0),
        ];
        cut = opening ? '2枚（左右反転）' : '1枚（わ）';
        if (opening && ext > 0) {
          const em = extMarks(0, yOpen, ext);
          marks.push(...em.marks);
          notes = em.notes;
        }
      } else {
        edges = [topEdge(0, w), { segs: [line(v(w, 0), v(w, H))], kind: 'seam', name: '脇' }, bottomEdge(w, 0), { segs: [line(v(0, H), v(0, 0))], kind: 'seam', name: '脇' }];
        cut = `${m}枚（はぎ合わせて輪にする）`;
      }
      pieces.push({ id, name, cut, edges, grain: [v(w * 0.3, H * 0.2), v(w * 0.3, H * 0.8)], marks, notes });
    }
  }

  // ---- 説明 ----
  info.unshift(
    `${n} 段（${TIERED_HEIGHTS_LABEL[p.heights]}）／ ${SKIRT_LENGTH_LABEL[p.length]} ウエストから ${fmt(b.length)}cm ／ ${belt ? 'ベルト付き（後ろ開き）' : 'ゴム'}`,
    `ギャザー ${TIERED_GATHER_LABEL[p.gather]}${p.gather === 'custom' ? `（${fmt(ratio)} 倍）` : ''} ／ 一番上 ${TIERED_TOP_LABEL[p.top]} ／ ヒップ ${fmt(b.hipF)}cm（ゆとり込み）`,
  );
  for (let k = 0; k < n; k++) {
    const label = k === 0 && yoke ? 'ヨーク' : `${k + 1}段目`;
    const shape = k === 0 && yoke && belt ? `ウエスト ${fmt(b.waistF)}cm → 下 ${fmt(W[0])}cm` : `周り ${fmt(W[k])}cm（前・後ろ 各 ${fmt(W[k] / 2)}cm）`;
    info.push(`${label}: ${shape} × 高さ ${fmt(h[k])}cm`);
  }
  info.push('段の上の辺は粗い 2 本ミシンでギャザーを寄せ、真ん中の印・脇を上の段の印・脇に合わせて付けます');
  if (pieces.some((pc) => pc.cut.includes('はぎ合わせて'))) info.push(`たたんだ布（${FOLDED_FABRIC}cm）に入らない段は、同じ長方形を何枚かはぎ合わせて輪にします`);
  if (belt) {
    const overlap = 2 * ext;
    pieces.push(waistbandPiece(b.waistF + overlap, bandH));
    if (!yoke) info.push(`1 段目のウエストを ${fmt(W[0] - b.waistF)}cm 縮めて（ギャザー）ベルトに付けます`);
    info.push(`ベルト ${fmt(b.waistF + overlap)}cm × 仕上がりの高さ ${fmt(bandH)}cm（重なり ${fmt(overlap)}cm）／ 後ろ開き ${fmt(yOpen)}cm・持ち出し ${fmt(ext)}cm`);
  } else {
    info.push(`ウエスト: 三つ折りにしてゴムを通します（裁つ周り ${fmt(W[0])}cm・ゴムの長さの目安 ${fmt(b.waist * 0.95)}cm）`);
  }
  if (lace) info.push(`裾: レースを付けます（裾の周り ${fmt(W[n - 1])}cm ＋ 重なり分）。型紙の裾は縫い代だけです`);
  info.push(`カテゴリ ${r.category ?? '未分類'}${r.categoryGuessed ? '（仮）' : ''}`);
  return { pieces, warnings, info };
}
