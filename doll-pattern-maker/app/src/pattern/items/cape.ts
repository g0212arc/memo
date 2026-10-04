// マント・ケープ = 円の一部（首回りを内側の円にしたドーナツ形）＋ 襟（なし／スタンド／丸い折り襟／フード）。
// 型紙は後ろ中心をわにした半分。中心は (0, 0)、後ろ中心は真下（+y）、前端は後ろ中心から角度 α の方向。
// 丈は首の付け根からの長さ。広がり（円の割合）を決めると、首回りの長さから内側の半径が決まる。

import { Vec, v } from '../../geometry/vec';
import { cubic, line, pathLength, Seg } from '../../geometry/path';
import { ResolvedBody } from '../../model/estimate';
import { MeasurementKey } from '../../model/schema';
import { DraftResult, EdgeKind, Fabric, Piece } from '../types';
import { draftHood, THREE_PANEL_HEAD } from '../hood';
import { MissingMeasurementsError } from './tshirt';

export type CapeLength = 'shoulder' | 'elbow' | 'waist' | 'knee' | 'ankle' | 'custom';
export type CapeFlare = 'quarter' | 'half' | 'three' | 'full';
export type CapeCollar = 'none' | 'stand' | 'round' | 'hood';

export interface CapeParams {
  fabric: Fabric;
  stretch: number;
  length: CapeLength;
  /** length が custom のときの丈（首の付け根から cm） */
  lengthCustom: number | null;
  flare: CapeFlare;
  collar: CapeCollar;
  closure: 'ribbon' | 'snap';
  slit: boolean;
  lining: boolean;
}

export const DEFAULT_CAPE: CapeParams = {
  fabric: 'woven',
  stretch: 20,
  length: 'waist',
  lengthCustom: null,
  flare: 'half',
  collar: 'round',
  closure: 'ribbon',
  slit: true,
  lining: true,
};

export const CAPE_LENGTH_LABEL: Record<CapeLength, string> = {
  shoulder: '肩まで',
  elbow: '肘まで',
  waist: '腰まで',
  knee: '膝まで',
  ankle: '足首まで',
  custom: '自分で入力',
};
export const CAPE_FLARE_LABEL: Record<CapeFlare, string> = { quarter: '1/4 円', half: '半円', three: '3/4 円', full: '全円' };
export const CAPE_COLLAR_LABEL: Record<CapeCollar, string> = { none: 'なし', stand: 'スタンド', round: '丸い折り襟', hood: 'フード' };
const FLARE_FRACTION: Record<CapeFlare, number> = { quarter: 0.25, half: 0.5, three: 0.75, full: 1 };

export const CAPE_REQUIREMENTS: { key: MeasurementKey; hard: boolean }[] = [
  { key: 'chest_circ', hard: true },
  { key: 'neck_circ', hard: false },
  { key: 'neck_length', hard: false },
  { key: 'shoulder_width', hard: false },
  { key: 'back_length', hard: false },
  { key: 'waist_to_hip', hard: false },
  { key: 'arm_length', hard: false },
  { key: 'upper_arm_circ', hard: false },
  { key: 'armhole_circ', hard: false },
  { key: 'rise', hard: false },
  { key: 'inseam', hard: false },
  { key: 'knee_height', hard: false },
];

/** スリットを選べる長い丈か（画面の表示と作図で同じ判定を使う） */
export const capeIsLong = (p: { length: CapeLength }) => p.length === 'knee' || p.length === 'ankle' || p.length === 'custom';

const fmt = (x: number) => (Math.round(x * 10) / 10).toFixed(1);
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const finite = (x: number | null): x is number => x !== null && Number.isFinite(x);
const dir = (a: number) => v(Math.sin(a), Math.cos(a)); // 後ろ中心（真下）から角度 a 回した向き
const pt = (r: number, a: number) => v(r * Math.sin(a), r * Math.cos(a));

/** 中心 (0,0)・半径 r の円弧（角度 a0 → a1）を 3 次ベジェで（90° ごとに分ける） */
function arc(r: number, a0: number, a1: number): Seg[] {
  const n = Math.max(1, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 2) - 1e-9));
  const segs: Seg[] = [];
  for (let i = 0; i < n; i++) {
    const s = a0 + ((a1 - a0) * i) / n;
    const e = a0 + ((a1 - a0) * (i + 1)) / n;
    const k = (4 / 3) * Math.tan((e - s) / 4) * r;
    // 接線の向き（角度が増える向き）: d/da (sin a, cos a) = (cos a, −sin a)
    const t = (a: number) => v(Math.cos(a), -Math.sin(a));
    const p0 = pt(r, s);
    const p1 = pt(r, e);
    segs.push(cubic(p0, v(p0.x + t(s).x * k, p0.y + t(s).y * k), v(p1.x - t(e).x * k, p1.y - t(e).y * k), p1));
  }
  return segs;
}
const reverse = (segs: Seg[]): Seg[] =>
  [...segs].reverse().map((s) => (s.kind === 'line' ? line(s.to, s.from) : cubic(s.to, s.c2, s.c1, s.from)));

function rectPiece(id: string, name: string, cut: string, w: number, h: number, kinds: [EdgeKind, EdgeKind, EdgeKind, EdgeKind], names: [string, string, string, string]): Piece {
  return {
    id,
    name,
    cut,
    edges: [
      { segs: [line(v(0, 0), v(w, 0))], kind: kinds[0], name: names[0] },
      { segs: [line(v(w, 0), v(w, h))], kind: kinds[1], name: names[1] },
      { segs: [line(v(w, h), v(0, h))], kind: kinds[2], name: names[2] },
      { segs: [line(v(0, h), v(0, 0))], kind: kinds[3], name: names[3] },
    ],
    grain: w > h ? [v(w * 0.2, h * 0.5), v(w * 0.8, h * 0.5)] : [v(w * 0.5, h * 0.2), v(w * 0.5, h * 0.8)],
  };
}

export function draftCape(r: ResolvedBody, p: CapeParams): DraftResult {
  const missing = CAPE_REQUIREMENTS.filter((q) => r.values[q.key] === undefined).map((q) => q.key);
  if (missing.length > 0) throw new MissingMeasurementsError(missing);
  const val = (k: MeasurementKey) => r.values[k] as number;
  const warnings: string[] = [];
  const info: string[] = [];

  const neck = val('neck_circ');
  const neckLen = neck + clamp(neck * 0.08, 0.3, 1.5); // 首回り＋ゆとり（全体）
  const shoulderLen = Math.max(0.5, val('shoulder_width') / 2 - neck / (2 * Math.PI));
  const bl = val('back_length');
  const ankleH = r.values.foot_height ?? val('inseam') * 0.06;
  const L =
    p.length === 'custom' && finite(p.lengthCustom)
      ? Math.max(p.lengthCustom, 0.5)
      : {
          shoulder: shoulderLen * 1.15,
          // 腕を下ろしたときの肘の高さ、腰（ヒップ）の高さ
          elbow: shoulderLen + val('arm_length') * 0.45,
          waist: bl + val('waist_to_hip'),
          knee: bl + val('rise') + (val('inseam') - val('knee_height')),
          ankle: bl + val('rise') + val('inseam') - ankleH,
          custom: bl,
        }[p.length];

  // ---- 身頃（円の一部） ----
  const theta = 2 * Math.PI * FLARE_FRACTION[p.flare]; // 全体の角度
  const alpha = theta / 2; // 半分（型紙）の角度
  const rIn = neckLen / theta;
  const R = rIn + L;
  const lined = p.lining;
  const edgeKind: EdgeKind = lined ? 'seam' : 'hem';
  const neckArc = reverse(arc(rIn, 0, alpha)); // 前端 → 後ろ中心
  const body: Piece = {
    id: 'cape',
    name: L <= bl + val('waist_to_hip') + 0.01 ? 'ケープ' : 'マント',
    cut: '1枚（わ）',
    edges: [
      { segs: [line(pt(rIn, 0), pt(R, 0))], kind: 'fold', name: '後ろ中心（わ）' },
      { segs: arc(R, 0, alpha), kind: edgeKind, name: '裾' },
      { segs: [line(pt(R, alpha), pt(rIn, alpha))], kind: lined ? 'seam' : 'opening', name: '前端' },
      { segs: neckArc, kind: 'seam', name: '襟ぐり' },
    ],
    // 布目は後ろ中心と平行（わの少し内側）
    grain: [v(0.6, rIn + L * 0.15), v(0.6, rIn + L * 0.85)],
  };
  const marks: Vec[][] = [];
  // 首元の留め位置（前端の、襟ぐりから少し下）
  const rc = 0.2;
  const closeAt = pt(rIn + Math.min(0.6, L * 0.2), alpha - Math.min(0.4 / Math.max(rIn, 0.5), alpha * 0.2));
  marks.push([v(closeAt.x - rc, closeAt.y), v(closeAt.x + rc, closeAt.y)], [v(closeAt.x, closeAt.y - rc), v(closeAt.x, closeAt.y + rc)]);

  // ---- 腕が動かせるか（脇の高さでの周り） ----
  const underarm = shoulderLen + val('armhole_circ') * 0.25;
  if (L > underarm) {
    const around = (rIn + underarm) * theta;
    const need = val('chest_circ') + val('upper_arm_circ') + 0.5;
    if (around < need) {
      warnings.push(`脇の高さでの周り（約 ${fmt(around)}cm）が、胸囲＋上腕回り（約 ${fmt(need)}cm）より小さいので、腕を動かしにくくなります。広がりを半円以上にするのがおすすめです。`);
    }
  }

  // ---- 腕のスリット（長い丈のとき） ----
  const long = capeIsLong(p) && L > bl + val('waist_to_hip') + 0.1;
  if (p.slit && long) {
    const top = shoulderLen + val('arm_length') * 0.55;
    const slitLen = clamp(val('upper_arm_circ') * 0.6, 1, L * 0.4);
    if (top + slitLen < L - 1) {
      const a = alpha * 0.62;
      marks.push([pt(rIn + top, a), pt(rIn + top + slitLen, a)]);
      info.push(`腕のスリット: 首の付け根から ${fmt(top)}cm の位置に長さ ${fmt(slitLen)}cm（縁はパイピングで始末）`);
    }
  }
  body.marks = marks;
  const pieces: Piece[] = [body];
  if (lined) pieces.push({ ...body, id: 'cape-lining', name: `${body.name}（裏地）`, cut: '1枚（わ・裏地）', marks: undefined });

  // ---- 襟 ----
  const neckHalf = pathLength(neckArc);
  if (p.collar === 'none') {
    const w = clamp(neck * 0.06, 0.3, 0.8);
    pieces.push(rectPiece('binding', '襟ぐりのバイアステープ', '1枚（バイアス）', neckHalf * 2, w * 2, ['seam', 'seam', 'seam', 'seam'], ['縁', '端', '縁', '端']));
  } else if (p.collar === 'stand') {
    const h = clamp(val('neck_length') * 0.6, 0.4, 2);
    pieces.push(rectPiece('collar', 'スタンドカラー（高さ方向に二つ折り）', '1枚', neckHalf * 2, h * 2, ['seam', 'seam', 'seam', 'seam'], ['襟付け', '前端', '襟付け', '前端']));
  } else if (p.collar === 'round') {
    // 半円のドーナツ形（全体）。肩に平らに乗る。型紙は後ろ中心わの半分（1/4 円）
    const w = clamp(neck * 0.2, 0.8, 4);
    const rc0 = (neckHalf * 2) / Math.PI;
    const a1 = Math.PI / 2;
    const outer = arc(rc0 + w, 0, a1);
    const fo = pt(rc0 + w, a1);
    const fi = pt(rc0, a1);
    // 前端は丸く（外へふくらむ）
    const bulge = w * 0.55;
    const d = dir(a1 + Math.PI / 2);
    pieces.push({
      id: 'collar',
      name: '丸い折り襟',
      cut: '2枚（わ・表と裏）',
      edges: [
        { segs: [line(pt(rc0, 0), pt(rc0 + w, 0))], kind: 'fold', name: '後ろ中心（わ）' },
        { segs: outer, kind: 'seam', name: '外まわり' },
        { segs: [cubic(fo, v(fo.x + d.x * bulge, fo.y + d.y * bulge), v(fi.x + d.x * bulge, fi.y + d.y * bulge), fi)], kind: 'seam', name: '襟先' },
        { segs: reverse(arc(rc0, 0, a1)), kind: 'seam', name: '襟付け' },
      ],
      grain: [v(0.3, rc0 + w * 0.15), v(0.3, rc0 + w * 0.85)],
    });
  } else {
    // フード（左右 2 枚）。首側の長さ ＝ 襟ぐり（半分）
    let head = r.values.head_circ;
    if (head === undefined) {
      head = neck * 2.4;
      warnings.push(`頭囲がないので、首回りから約 ${fmt(head)}cm と推定してフードを作りました。頭囲を入れると正確になります。`);
    }
    const hood = draftHood({ neckHalf, head, neckLength: val('neck_length'), panels: head >= THREE_PANEL_HEAD ? 3 : 2, lined });
    pieces.push(...hood.pieces);
    const H = hood.height;
    const D = hood.depth;
    info.push(`フード 高さ ${fmt(H)}cm ／ 奥行き ${fmt(D)}cm（頭囲 ${fmt(head)}cm から）`);
  }

  const hemAround = R * theta;
  info.unshift(
    `${body.name}: ${CAPE_FLARE_LABEL[p.flare]} ／ 丈 ${fmt(L)}cm（首の付け根から）／ 裾まわり ${fmt(hemAround)}cm`,
    `襟ぐり ${fmt(neckHalf * 2)}cm ／ 内側の半径 ${fmt(rIn)}cm ／ 首元は${p.closure === 'ribbon' ? 'リボン（印の位置に左右 1 本ずつ）' : 'スナップ（印の位置）'}で留めます`,
  );
  if (lined) info.push('裏地: 表と同じ形。前端と裾を中表に縫って返します');
  info.push(`カテゴリ ${r.category ?? '未分類'}${r.categoryGuessed ? '（仮）' : ''}`);
  return { pieces, warnings, info, refs: { length: L } };
}
