// スカート（オーソドックス）。前・後ろとも中心を「わ」（ベルト付きは後ろ中心を開き）にした半身で作図。
// 広がりは「スカート全体を円に見たときの角度」で考える（タイト 0°・セミタイト 20°・Aライン 48°・半円 180°・全円 360°）。
// 90° 未満: ヒップに合わせた形（ウエストは脇のカーブとダーツで詰める）＋脇で裾を広げる（1 枚あたり 角度÷4）。
// 90° 以上: 円の一部（扇形）。ヒップが入らないときはウエストの円を大きくして、余りをギャザーで寄せる。
// 座標: x は中心が 0 で脇へ正、y はウエストが 0 で下向き。

import { v, add, mul } from '../../geometry/vec';
import { Seg, cubic, line, pathLength } from '../../geometry/path';
import { ResolvedBody } from '../../model/estimate';
import { MeasurementKey } from '../../model/schema';
import { CATEGORY_EASE } from '../../model/category';
import { DraftResult, Edge, EdgeKind, Piece } from '../types';
import { MissingMeasurementsError } from './tshirt';
import { extMarks, ExtParams, openingExtOf } from '../opening';

export type SkirtFlare = 'tight' | 'semi' | 'aline' | 'half' | 'full' | 'custom';
export type SkirtLength = 'mini' | 'knee' | 'midi' | 'ankle' | 'custom';
export type SkirtWaist = 'elastic' | 'belt';

export interface SkirtParams extends ExtParams {
  flare: SkirtFlare;
  /** flare が custom のときの角度（スカート全体で何度の円か。0〜360） */
  flareCustom: number | null;
  length: SkirtLength;
  /** length が custom のときの丈（ウエストから裾まで cm） */
  lengthCustom: number | null;
  waist: SkirtWaist;
  /** 後ろのスリット（タイトに近い形のとき） */
  slit: boolean;
}

export const DEFAULT_SKIRT: SkirtParams = { flare: 'aline', flareCustom: null, length: 'knee', lengthCustom: null, waist: 'elastic', slit: false };

export const SKIRT_FLARE_LABEL: Record<SkirtFlare, string> = {
  tight: 'タイト',
  semi: 'セミタイト',
  aline: 'Aライン',
  half: 'フレア（半円）',
  full: 'サーキュラー（全円）',
  custom: '自分で入力（角度）',
};
export const SKIRT_LENGTH_LABEL: Record<SkirtLength, string> = { mini: 'ミニ', knee: '膝丈', midi: 'ミモレ（ふくらはぎ）', ankle: '足首', custom: '自分で入力' };
const FLARE_ANGLE: Record<Exclude<SkirtFlare, 'custom'>, number> = { tight: 0, semi: 20, aline: 48, half: 180, full: 360 };
/** これ以上の角度は扇形で作る */
const CONE_FROM = 90;
/** スリットを選べる角度（これ以下） */
export const SLIT_MAX_ANGLE = 24;

export const SKIRT_REQUIREMENTS: { key: MeasurementKey; hard: boolean }[] = [
  { key: 'waist_circ', hard: true },
  { key: 'hip_circ', hard: true },
  { key: 'waist_to_hip', hard: false },
  { key: 'rise', hard: false },
  { key: 'inseam', hard: false },
  { key: 'knee_height', hard: false },
  { key: 'foot_length', hard: false },
];

const fmt = (x: number) => (Math.round(x * 10) / 10).toFixed(1);
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const finite = (x: number | null): x is number => x !== null && Number.isFinite(x);
const rad = (d: number) => (d * Math.PI) / 180;

export const skirtAngle = (p: Pick<SkirtParams, 'flare' | 'flareCustom'>) =>
  p.flare === 'custom' ? clamp(finite(p.flareCustom) ? p.flareCustom : FLARE_ANGLE.aline, 0, 360) : FLARE_ANGLE[p.flare];
export const slitAvailable = (p: Pick<SkirtParams, 'flare' | 'flareCustom'>) => skirtAngle(p) <= SLIT_MAX_ANGLE;

export interface SkirtBase {
  waist: number;
  hip: number;
  /** ゆとりを入れたウエスト・ヒップ */
  waistF: number;
  hipF: number;
  /** ウエストからヒップまで */
  wh: number;
  /** ウエストから裾まで（ベルトの高さ込み） */
  length: number;
  warnings: string[];
}

/** スカートとプリーツスカートに共通の寸法（ゆとり・丈） */
export function skirtBase(r: ResolvedBody, length: SkirtLength, lengthCustom: number | null): SkirtBase {
  const missing = SKIRT_REQUIREMENTS.filter((q) => r.values[q.key] === undefined).map((q) => q.key);
  if (missing.length > 0) throw new MissingMeasurementsError(missing);
  const val = (k: MeasurementKey) => r.values[k] as number;
  const warnings: string[] = [];
  const k = r.category ? CATEGORY_EASE[r.category] : 1;
  const waist = val('waist_circ');
  const hip = val('hip_circ');
  const waistF = waist + Math.max(0.3, waist * 0.03) * k;
  const hipF = Math.max(waistF, hip + Math.max(0.6, hip * 0.06) * k);
  const R = val('rise');
  const I = val('inseam');
  const wh = clamp(val('waist_to_hip'), R * 0.4, R * 0.9);
  const Hw = I + R; // ウエストの高さ
  const kh = val('knee_height');
  const fh = r.values.foot_height ?? val('foot_length') * 0.4;
  let L =
    length === 'custom' && finite(lengthCustom)
      ? lengthCustom
      : { mini: R + I * 0.2, knee: Hw - kh * 0.95, midi: Hw - (fh + (kh - fh) * 0.45), ankle: Hw - fh * 1.3, custom: Hw - kh * 0.95 }[length];
  if (L < wh + 1) {
    L = wh + 1;
    warnings.push('丈がヒップより短いため、ヒップの 1cm 下まで延ばしました。');
  }
  return { waist, hip, waistF, hipF, wh, length: L, warnings };
}

/** ウエストベルト（高さ方向に二つ折り） */
export function waistbandPiece(len: number, bandH: number): Piece {
  return {
    id: 'waistband',
    name: 'ウエストベルト（高さ方向に二つ折り）',
    cut: '1枚',
    edges: [
      { segs: [line(v(0, 0), v(len, 0))], kind: 'seam', name: 'ウエスト側' },
      { segs: [line(v(len, 0), v(len, bandH * 2))], kind: 'seam', name: '端' },
      { segs: [line(v(len, bandH * 2), v(0, bandH * 2))], kind: 'seam', name: 'ウエスト側' },
      { segs: [line(v(0, bandH * 2), v(0, 0))], kind: 'seam', name: '端' },
    ],
    grain: [v(len * 0.5 - Math.min(len * 0.3, 3), bandH), v(len * 0.5 + Math.min(len * 0.3, 3), bandH)],
  };
}
export const bandHeight = (wh: number) => clamp(wh * 0.3, 0.5, 1.2);
export const bandOverlap = (waistF: number) => clamp(waistF * 0.08, 0.6, 1.5);
/** 後ろ開きの長さ（ウエストから） */
export const openingLength = (wh: number, L: number) => Math.min(wh * 1.2, L * 0.6);

/**
 * 中心の辺（裾 → ウエスト）。後ろ: ベルト付きは上を開き、スリットは下を開く。どちらもなければ「わ」
 */
export function centerEdges(L: number, isFront: boolean, belt: boolean, slitLen: number, yOpen: number, top = 0, ext = 0): Edge[] {
  if (isFront || (!belt && slitLen <= 0)) {
    return [{ segs: [line(v(0, L), v(0, top))], kind: 'fold', name: isFront ? '前中心（わ）' : '後ろ中心（わ）' }];
  }
  const edges: Edge[] = [];
  let y = L;
  if (slitLen > 0) {
    edges.push({ segs: [line(v(0, L), v(0, L - slitLen))], kind: 'opening', name: 'スリット' });
    y = L - slitLen;
  }
  const yO = belt ? top + yOpen : top;
  if (y > yO + 1e-9) edges.push({ segs: [line(v(0, y), v(0, yO))], kind: 'seam', name: '後ろ中心' });
  if (belt && ext > 0) {
    // 持ち出し: 開きの部分だけ後ろ中心の外へ ext 出す（下端は段）。ウエスト側の短い辺は extWaistEdge で足す
    edges.push(
      { segs: [line(v(0, yO), v(-ext, yO))], kind: 'seam', name: '持ち出しの下端' },
      { segs: [line(v(-ext, yO), v(-ext, top))], kind: 'opening', name: '後ろ開き' },
    );
  } else if (belt) edges.push({ segs: [line(v(0, yO), v(0, top))], kind: 'opening', name: '後ろ開き' });
  return edges;
}

/** 持ち出しのウエスト側の短い辺（後ろ中心の外 ext → 後ろ中心） */
export const extWaistEdge = (ext: number, top: number, kind: EdgeKind): Edge => ({ segs: [line(v(-ext, top), v(0, top))], kind, name: 'ウエスト（持ち出し）' });

/** 中心 (0,0)・半径 r の円弧（真下から角度 a0 → a1）。90° ごとに 3 次ベジェで */
function arc(r: number, a0: number, a1: number): Seg[] {
  const pt = (a: number) => v(r * Math.sin(a), r * Math.cos(a));
  const t = (a: number) => v(Math.cos(a), -Math.sin(a));
  const n = Math.max(1, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 2) - 1e-9));
  const segs: Seg[] = [];
  for (let i = 0; i < n; i++) {
    const s = a0 + ((a1 - a0) * i) / n;
    const e = a0 + ((a1 - a0) * (i + 1)) / n;
    const k = (4 / 3) * Math.tan((e - s) / 4) * r;
    const p0 = pt(s);
    const p1 = pt(e);
    segs.push(cubic(p0, add(p0, mul(t(s), k)), add(p1, mul(t(e), -k)), p1));
  }
  return segs;
}
const reverseSegs = (segs: Seg[]): Seg[] => [...segs].reverse().map((s) => (s.kind === 'line' ? line(s.to, s.from) : cubic(s.to, s.c2, s.c1, s.from)));

export function draftSkirt(r: ResolvedBody, p: SkirtParams): DraftResult {
  const b = skirtBase(r, p.length, p.lengthCustom);
  const warnings = [...b.warnings];
  const info: string[] = [];
  const belt = p.waist === 'belt';
  const bandH = belt ? bandHeight(b.wh) : 0;
  const L = b.length - bandH; // スカートの布の丈（ベルトの分を引く）
  const wh = Math.min(b.wh, L - 0.5);
  const A = skirtAngle(p);
  const waistKind: EdgeKind = belt ? 'seam' : 'hem';
  // ゴムはヒップが通る周りで裁ってゴムで縮める
  const waistCut = belt ? b.waistF : b.hipF;
  const yOpen = openingLength(wh, L);
  // 持ち出しの幅（片側）。ベルト付きの後ろ開きだけ
  const ext = belt ? openingExtOf(p, b.hipF) : 0;
  const pieces: Piece[] = [];
  let gather = 0;
  let slitLen = 0;
  if (p.slit && A <= SLIT_MAX_ANGLE) {
    slitLen = Math.min((L - wh) * 0.4, L - (belt ? yOpen : 0) - 0.5);
    if (slitLen < 0.5) {
      slitLen = 0;
      warnings.push('丈が短いため、スリットは入れませんでした。');
    }
  }

  if (A < CONE_FROM) {
    // ---- ヒップに合わせた形 ----
    const phi = rad(A / 4);
    for (const isFront of [true, false]) {
      const Hq = b.hipF / 4;
      const Wq = waistCut / 4;
      const diff = Math.max(0, Hq - Wq);
      // 脇は前後で縫い合わせるので、脇で詰める量は前後同じ（残りをダーツに）
      const sideTake = diff <= 0.6 ? diff : diff * 0.45;
      const dart = diff - sideTake;
      const waistSide = v(Hq - sideTake, 0);
      const hipPt = v(Hq, wh);
      const down = v(Math.sin(phi), Math.cos(phi));
      const sideUpper = cubic(waistSide, v(waistSide.x + sideTake * 0.3, wh * 0.35), add(hipPt, mul(down, -wh * 0.35)), hipPt);
      // 脇で詰めないとき（ゴムなど）は、ウエストからまっすぐ広げる
      const straight = sideTake < 0.05;
      const E = straight ? add(waistSide, mul(down, L)) : add(hipPt, mul(down, L - wh));
      const hem: Seg =
        phi < 1e-6 ? line(E, v(0, L)) : cubic(E, add(E, mul(v(-Math.cos(phi), Math.sin(phi)), E.x * 0.35)), v(E.x * 0.5, L), v(0, L));
      const edges: Edge[] = [];
      if (dart > 0.05) {
        const dx = Math.min(Hq * (isFront ? 0.45 : 0.5), waistSide.x - dart / 2 - 0.2);
        const dl = wh * (isFront ? 0.6 : 0.75);
        const a = v(dx - dart / 2, 0);
        const c = v(dx + dart / 2, 0);
        edges.push(
          { segs: [line(v(0, 0), a)], kind: waistKind, name: 'ウエスト' },
          { segs: [line(a, v(dx, dl)), line(v(dx, dl), c)], kind: 'seam', name: 'ダーツ' },
          { segs: [line(c, waistSide)], kind: waistKind, name: 'ウエスト' },
        );
      } else {
        edges.push({ segs: [line(v(0, 0), waistSide)], kind: waistKind, name: 'ウエスト' });
      }
      edges.push(
        { segs: straight ? [line(waistSide, E)] : [sideUpper, line(hipPt, E)], kind: 'seam', name: '脇' },
        { segs: [hem], kind: 'hem', name: '裾' },
        ...centerEdges(L, isFront, belt, isFront ? 0 : slitLen, yOpen, 0, isFront ? 0 : ext),
      );
      if (!isFront && ext > 0) edges.unshift(extWaistEdge(ext, 0, waistKind));
      const onFold = isFront || (!belt && slitLen <= 0);
      pieces.push({
        id: isFront ? 'skirt-front' : 'skirt-back',
        name: isFront ? '前スカート' : '後ろスカート',
        cut: onFold ? '1枚（わ）' : '2枚（左右反転）',
        edges,
        grain: [v(Hq * 0.3, wh * 0.6), v(Hq * 0.3, L - (L - wh) * 0.15)],
        ...(!isFront && ext > 0 ? extMarks(0, yOpen, ext) : {}),
      });
      if (isFront) info.push(`ダーツ 前 ${fmt(dart)}cm`);
      else info[info.length - 1] += `・後ろ ${fmt(dart)}cm（片側 1 本）`;
    }
  } else {
    // ---- 扇形 ----
    const total = rad(A);
    let rIn = waistCut / total;
    if (belt && (rIn + wh) * total < b.hipF) {
      rIn = b.hipF / total - wh;
      gather = rIn * total - b.waistF;
    }
    const beta = total / 4;
    const R = rIn + L;
    const pt = (rr: number, a: number) => v(rr * Math.sin(a), rr * Math.cos(a));
    const gx = Math.min(1.5, (rIn + L * 0.15) * Math.sin(Math.min(beta, Math.PI / 2)) * 0.4);
    for (const isFront of [true, false]) {
      // 中心の辺は扇の中心線（真下）。centerEdges の座標（x=0、y は rIn から下へ）に合わせる
      const center = centerEdges(R, isFront, belt, 0, yOpen, rIn, isFront ? 0 : ext);
      const onFold = isFront || !belt;
      pieces.push({
        id: isFront ? 'skirt-front' : 'skirt-back',
        name: isFront ? '前スカート' : '後ろスカート',
        cut: onFold ? '1枚（わ）' : '2枚（左右反転）',
        edges: [
          ...(!isFront && ext > 0 ? [extWaistEdge(ext, rIn, waistKind)] : []),
          { segs: arc(rIn, 0, beta), kind: waistKind, name: 'ウエスト' },
          { segs: [line(pt(rIn, beta), pt(R, beta))], kind: 'seam', name: '脇' },
          { segs: reverseSegs(arc(R, 0, beta)), kind: 'hem', name: '裾' },
          ...center,
        ],
        // 布目は中心（わ）と平行
        grain: [v(gx, rIn + L * 0.15), v(gx, R - L * 0.15)],
        ...(!isFront && ext > 0 ? extMarks(rIn, rIn + yOpen, ext) : {}),
      });
    }
    info.push(`扇形: ウエストの半径 ${fmt(rIn)}cm ／ 裾の半径 ${fmt(R)}cm（1 枚あたり ${fmt(A / 4)}°）`);
  }

  if (belt) {
    // ベルトの重なりは、スカートの持ち出しの重なり（片側 × 2）にそろえる
    const overlap = 2 * ext;
    pieces.push(waistbandPiece(b.waistF + overlap, bandH));
    info.push(`ベルト ${fmt(b.waistF + overlap)}cm × 仕上がりの高さ ${fmt(bandH)}cm（重なり ${fmt(overlap)}cm にスナップ・かぎホック）／ 後ろ開き ${fmt(yOpen)}cm・持ち出し ${fmt(ext)}cm`);
    if (gather > 0.05) info.push(`ヒップが入るようにウエストを広げたので、ウエストを ${fmt(gather)}cm 縮めて（ギャザー）ベルトに付けます`);
  } else {
    info.push(`ウエスト: 三つ折りにしてゴムを通します（裁つ周り ${fmt(waistCut)}cm・ゴムの長さの目安 ${fmt(b.waist * 0.95)}cm）`);
  }
  const hemLen = 2 * pieces.filter((pc) => pc.id.startsWith('skirt')).reduce((a, pc) => a + pathLength(pc.edges.find((e) => e.name === '裾')!.segs), 0);
  info.unshift(
    `${SKIRT_FLARE_LABEL[p.flare]}（${fmt(A)}°）／ ${SKIRT_LENGTH_LABEL[p.length]} ウエストから ${fmt(b.length)}cm ／ ${belt ? 'ベルト付き（後ろ開き）' : 'ゴム'}`,
    `ウエスト ${fmt(b.waistF)}cm ／ ヒップ ${fmt(b.hipF)}cm（ゆとり込み）／ 裾周り ${fmt(hemLen)}cm`,
  );
  if (slitLen > 0) info.push(`後ろスリット ${fmt(slitLen)}cm`);
  info.push(`カテゴリ ${r.category ?? '未分類'}${r.categoryGuessed ? '（仮）' : ''}`);
  return { pieces, warnings, info };
}

