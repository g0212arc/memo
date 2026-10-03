// プリーツスカート。車ひだ・箱ひだ: 長方形の布に折り線の印を付け、たたむとヒップ（ゆとり込み）の周りになる。
// 脇の縫い目は、たたむと外から見えない位置（ひだの奥）に置く。
// インバーテッド（前だけ）: スカートのセミタイトを土台に、前中心にひだ分を足す。後ろはひだなし。
// 座標: x は左端が 0 で右へ、y はウエストが 0 で下向き。

import { v, Vec } from '../../geometry/vec';
import { line, mapSeg } from '../../geometry/path';
import { ResolvedBody } from '../../model/estimate';
import { DraftResult, Edge, EdgeKind, Piece } from '../types';
import {
  bandHeight,
  bandOverlap,
  centerEdges,
  draftSkirt,
  openingLength,
  SKIRT_LENGTH_LABEL,
  SKIRT_REQUIREMENTS,
  SkirtLength,
  SkirtWaist,
  skirtBase,
  waistbandPiece,
} from './skirt';

export type PleatType = 'knife' | 'box' | 'inverted';

export interface PleatsParams {
  pleat: PleatType;
  /** ひだの数（プルダウンの値は文字列。custom なら countCustom） */
  count: '8' | '12' | '16' | 'custom';
  countCustom: number | null;
  length: SkirtLength;
  lengthCustom: number | null;
  waist: SkirtWaist;
}

export const DEFAULT_PLEATS: PleatsParams = { pleat: 'knife', count: '12', countCustom: null, length: 'knee', lengthCustom: null, waist: 'elastic' };
export const PLEAT_LABEL: Record<PleatType, string> = { knife: '車ひだ（一方向）', box: '箱ひだ（ボックス）', inverted: 'インバーテッド（前だけ）' };
export const PLEATS_REQUIREMENTS = SKIRT_REQUIREMENTS;
/** ひだの深さ ÷ ひだの間隔 */
const KNIFE_DEPTH = 0.7;
const BOX_DEPTH = 0.25;

const fmt = (x: number) => (Math.round(x * 10) / 10).toFixed(1);
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export const pleatCount = (p: Pick<PleatsParams, 'count' | 'countCustom'>) =>
  p.count === 'custom' ? clamp(Math.round(p.countCustom !== null && Number.isFinite(p.countCustom) ? p.countCustom : 12), 4, 60) : Number(p.count);

export function draftPleats(r: ResolvedBody, p: PleatsParams): DraftResult {
  if (p.pleat === 'inverted') return draftInverted(r, p);
  const b = skirtBase(r, p.length, p.lengthCustom);
  const warnings = [...b.warnings];
  const info: string[] = [];
  const belt = p.waist === 'belt';
  const bandH = belt ? bandHeight(b.wh) : 0;
  const L = b.length - bandH;
  const n = pleatCount(p);
  const s = b.hipF / n; // ひだの間隔（たたんだときの表の幅）
  const knife = p.pleat === 'knife';
  const d = s * (knife ? KNIFE_DEPTH : BOX_DEPTH); // ひだの深さ
  const unit = s + 2 * d * (knife ? 1 : 2); // ひだ 1 つ分の布の幅
  const waistKind: EdgeKind = belt ? 'seam' : 'hem';
  const yOpen = openingLength(b.wh, L);

  // 1 枚の布（units 個のひだ）。左右の端はひだの奥（縫い目が隠れる位置）
  const panel = (id: string, name: string, cut: string, units: number, leftCB: boolean): Piece => {
    const w = units * unit;
    const marks: Vec[][] = [];
    for (let k = 0; k < units; k++) {
      const u0 = k * unit;
      const xs = knife ? [u0 + d, u0 + d + s] : [u0 + 2 * d, u0 + 2 * d + s];
      for (const x of xs) marks.push([v(x, 0), v(x, L)]);
    }
    // 左端: 後ろ中心（ベルト付きの後ろ開き）か脇
    const left: Edge[] = leftCB
      ? centerEdges(L, false, true, 0, yOpen)
      : [{ segs: [line(v(0, L), v(0, 0))], kind: 'seam', name: '脇' }];
    return {
      id,
      name,
      cut,
      edges: [
        { segs: [line(v(0, 0), v(w, 0))], kind: waistKind, name: 'ウエスト' },
        { segs: [line(v(w, 0), v(w, L))], kind: 'seam', name: '脇' },
        { segs: [line(v(w, L), v(0, L))], kind: 'hem', name: '裾' },
        ...left,
      ],
      grain: [v(Math.min(w * 0.5, unit * 0.5), L * 0.15), v(Math.min(w * 0.5, unit * 0.5), L * 0.85)],
      marks,
    };
  };

  const pieces: Piece[] = [];
  if (belt) {
    // 後ろは後ろ中心で左右に分ける（上を開く）
    const backHalf = Math.max(1, Math.floor(n / 4));
    const frontUnits = n - 2 * backHalf;
    pieces.push(panel('pleats-front', '前スカート（プリーツ）', '1枚', frontUnits, false));
    pieces.push(panel('pleats-back', '後ろスカート（プリーツ）', '2枚（左右反転）', backHalf, true));
    if (frontUnits !== 2 * backHalf) info.push(`ひだの数が 4 で割り切れないため、前 ${frontUnits}・後ろ ${backHalf}×2 に分けました`);
  } else {
    const frontUnits = Math.ceil(n / 2);
    const backUnits = n - frontUnits;
    pieces.push(panel('pleats-front', '前スカート（プリーツ）', '1枚', frontUnits, false));
    pieces.push(panel('pleats-back', '後ろスカート（プリーツ）', '1枚', backUnits, false));
  }

  info.unshift(
    `${PLEAT_LABEL[p.pleat]} ${n} 本 ／ ${SKIRT_LENGTH_LABEL[p.length]} ウエストから ${fmt(b.length)}cm ／ ${belt ? 'ベルト付き（後ろ開き）' : 'ゴム'}`,
    `ひだの間隔 ${fmt(s)}cm ／ 深さ ${fmt(d)}cm ／ 布の幅 合計 ${fmt(n * unit)}cm（たたむとヒップ ${fmt(b.hipF)}cm）`,
  );
  info.push(
    knife
      ? 'たたみ方: 印は 2 本で 1 組。右の線で山折りにして、右隣の組の左の線に重ねます（全部同じ向き）。脇の縫い目はひだの奥に隠れます'
      : 'たたみ方: 印の線はすべて箱の端です。全部山折りにして、印と印のあいだを 1 つおきに裏へたたみ、隣の箱のひだ山と表で突き合わせます。脇の縫い目は裏の奥に隠れます',
  );
  if (belt) {
    const overlap = bandOverlap(b.waistF);
    const take = (b.hipF - b.waistF) / n;
    pieces.push(waistbandPiece(b.waistF + overlap, bandH));
    info.push(`ウエストでは、ひだを 1 本あたり ${fmt(take)}cm ずつ深く重ねてウエスト ${fmt(b.waistF)}cm にし、ヒップまで縫い止めます`);
    info.push(`ベルト ${fmt(b.waistF + overlap)}cm × 仕上がりの高さ ${fmt(bandH)}cm（重なり ${fmt(overlap)}cm）／ 後ろ開き ${fmt(yOpen)}cm`);
  } else {
    info.push(`ウエスト: ひだをたたんで縫い止め（ヒップ ${fmt(b.hipF)}cm）、三つ折りにしてゴムを通します（ゴムの長さの目安 ${fmt(b.waist * 0.95)}cm）`);
  }
  info.push('裾は先に始末してから、ひだをたたんでアイロンで押さえます');
  info.push(`カテゴリ ${r.category ?? '未分類'}${r.categoryGuessed ? '（仮）' : ''}`);
  return { pieces, warnings, info };
}

/** インバーテッド（前だけ）: セミタイトのスカートの前中心に、ひだ分（深さ×2）を足す */
function draftInverted(r: ResolvedBody, p: PleatsParams): DraftResult {
  const base = draftSkirt(r, { flare: 'semi', flareCustom: null, length: p.length, lengthCustom: p.lengthCustom, waist: p.waist, slit: false });
  const b = skirtBase(r, p.length, p.lengthCustom);
  const front = base.pieces.find((pc) => pc.id === 'skirt-front')!;
  const fold = front.edges.find((e) => e.kind === 'fold')!;
  const L = fold.segs[0].from.y;
  const d = clamp(b.hipF * 0.08, 0.5, 4); // ひだの深さ
  const shift = (q: Vec) => v(q.x + 2 * d, q.y);
  const waistKind = front.edges[0].kind;
  const moved = front.edges.filter((e) => e !== fold).map((e) => ({ ...e, segs: e.segs.map((sg) => mapSeg(sg, shift)) }));
  const hemIdx = moved.findIndex((e) => e.name === '裾');
  const edges: Edge[] = [
    { segs: [line(v(0, 0), v(2 * d, 0))], kind: waistKind, name: 'ウエスト（ひだ）' },
    ...moved.slice(0, hemIdx + 1),
    { segs: [line(v(2 * d, L), v(0, L))], kind: 'hem', name: '裾（ひだ）' },
    { segs: [line(v(0, L), v(0, 0))], kind: 'fold', name: '前中心（わ）' },
  ];
  const pleatFront: Piece = {
    ...front,
    id: 'pleats-front',
    name: '前スカート（インバーテッドプリーツ）',
    edges,
    grain: front.grain.map(shift) as [Vec, Vec],
    marks: [...(front.marks ?? []).map((m) => m.map(shift)), [v(2 * d, 0), v(2 * d, L)], [v(d, 0), v(d, L)]],
  };
  const pieces = base.pieces.map((pc) => (pc === front ? pleatFront : pc));
  const info = [
    `${PLEAT_LABEL.inverted} ／ ${SKIRT_LENGTH_LABEL[p.length]} ウエストから ${fmt(b.length)}cm ／ ${p.waist === 'belt' ? 'ベルト付き（後ろ開き）' : 'ゴム'}`,
    `ひだの深さ ${fmt(d)}cm（前中心に ${fmt(2 * d)}cm 足しています）`,
    `たたみ方: 外側の印（前中心から ${fmt(2 * d)}cm）で山折りにして前中心に合わせ、内側の印（${fmt(d)}cm）が奥の折り山になります。ウエストからヒップの少し上まで縫い止めます`,
    ...base.info.slice(1),
  ];
  return { pieces, warnings: base.warnings, info };
}
