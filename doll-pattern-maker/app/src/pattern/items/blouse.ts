// ブラウスとブラウスワンピース。身頃・前開き/背中開き・丸襟・スタンドカラー・丸い裾は Yシャツの作図を使い、
// 袖（パフスリーブ・ビショップスリーブ）・フリル襟・ボウタイ・縁取り・胸元のフリルをここで足す。
// パフスリーブ: 普通の袖の袖山を横に広げて上へ高くし（ふくらみ）、袖ぐりにはギャザーで縮めて付ける。
// ワンピース: ウエスト切り替え（身頃の裾をウエストにして、スカートを付ける）か、切り替えなし（身頃をそのまま裾まで延ばす）。
//   着るときヒップが通るよう、開きはスカートの途中（ヒップの下）まで延ばす。

import { v, Vec } from '../../geometry/vec';
import { CubicSeg, cubic, line, pathLength } from '../../geometry/path';
import { ResolvedBody } from '../../model/estimate';
import { MeasurementKey } from '../../model/schema';
import { CATEGORY_EASE } from '../../model/category';
import { draftSleeve } from '../sleeve';
import { defaultEase, scaleEase } from '../ease';
import { applyFit } from '../fit';
import { extMarks, ExtParams, OpeningChoice, openingExtOf, resolveOpening } from '../opening';
import { DraftResult, Edge, EdgeKind, Piece } from '../types';
import { DEFAULT_YSHIRT, draftYshirt, YSHIRT_REQUIREMENTS } from './yshirt';
import { openingLength, SKIRT_LENGTH_LABEL, SKIRT_REQUIREMENTS, SkirtLength, skirtBase } from './skirt';
import { dressSkirt, GATHER, rect } from './dress-skirt';

export type BlouseSleeve = 'puff-short' | 'puff-long' | 'bishop' | 'short' | 'long' | 'none';
export type BlousePuff = 'small' | 'normal' | 'large' | 'custom';
export type BlouseCuff = 'elastic' | 'band' | 'frill';
export type BlouseCollar = 'round' | 'frill' | 'bow' | 'stand' | 'none';
export type BlouseLength = 'waist' | 'hip' | 'tunic' | 'custom';

export interface BlouseCommon extends ExtParams {
  bustDart: boolean;
  opening: OpeningChoice;
  sleeve: BlouseSleeve;
  puff: BlousePuff;
  /** puff が custom のときの倍率（袖幅を何倍に広げるか） */
  puffCustom: number | null;
  cuff: BlouseCuff;
  collar: BlouseCollar;
  jabot: boolean;
  fit: 'normal' | 'loose';
}
export interface BlouseParams extends BlouseCommon {
  length: BlouseLength;
  lengthCustom: number | null;
  hem: 'straight' | 'round';
}
export interface BlouseDressParams extends BlouseCommon {
  shape: 'waist' | 'none';
  skirt: 'gather' | 'flare' | 'tiered';
  silhouette: 'straight' | 'aline';
  length: SkirtLength;
  lengthCustom: number | null;
  sash: boolean;
}

export const COMMON_DEFAULTS: BlouseCommon = {
  bustDart: true,
  opening: 'auto',
  sleeve: 'puff-short',
  puff: 'normal',
  puffCustom: null,
  cuff: 'elastic',
  collar: 'round',
  jabot: false,
  fit: 'normal',
};
export const DEFAULT_BLOUSE: BlouseParams = { ...COMMON_DEFAULTS, length: 'hip', lengthCustom: null, hem: 'straight' };
export const DEFAULT_BLOUSE_DRESS: BlouseDressParams = { ...COMMON_DEFAULTS, shape: 'waist', skirt: 'gather', silhouette: 'straight', length: 'knee', lengthCustom: null, sash: false };

export const BLOUSE_SLEEVE_LABEL: Record<BlouseSleeve, string> = {
  'puff-short': 'パフスリーブ半袖',
  'puff-long': 'パフスリーブ長袖（カフス付き）',
  bishop: 'ビショップスリーブ（袖口ギャザー）',
  short: '普通の半袖',
  long: '普通の長袖（カフス付き）',
  none: 'ノースリーブ',
};
export const BLOUSE_PUFF_LABEL: Record<BlousePuff, string> = { small: '控えめ', normal: '普通', large: 'たっぷり', custom: '自分で入力' };
export const BLOUSE_CUFF_LABEL: Record<BlouseCuff, string> = { elastic: 'ゴム', band: 'カフス（細い帯）', frill: 'フリル' };
export const BLOUSE_COLLAR_LABEL: Record<BlouseCollar, string> = { round: '丸襟', frill: 'フリル襟', bow: 'ボウタイ', stand: 'スタンドカラー', none: '襟なし（縁取り）' };
export const BLOUSE_LENGTH_LABEL: Record<BlouseLength, string> = { waist: 'ウエスト丈（スカートに入れる）', hip: '腰丈', tunic: 'チュニック（太もも）', custom: '自分で入力' };
export const DRESS_SKIRT_LABEL = { gather: 'ギャザー', flare: 'フレア（半円）', tiered: 'ティアード' };
export const DRESS_SILHOUETTE_LABEL = { straight: 'ストン', aline: 'Aライン' };
/** 袖幅を何倍に広げるか */
const PUFF_RATIO: Record<Exclude<BlousePuff, 'custom'>, number> = { small: 1.3, normal: 1.6, large: 2 };
/** ウエストからの着丈 ÷ ウエスト〜ヒップ */
const LENGTH_RATIO: Record<Exclude<BlouseLength, 'custom'>, number> = { waist: 0.4, hip: 0.9, tunic: 1.8 };
const FRILL = 1.8;

export const BLOUSE_REQUIREMENTS = YSHIRT_REQUIREMENTS;
export const BLOUSE_DRESS_REQUIREMENTS: { key: MeasurementKey; hard: boolean }[] = [
  ...YSHIRT_REQUIREMENTS,
  ...SKIRT_REQUIREMENTS.filter((q) => !YSHIRT_REQUIREMENTS.some((y) => y.key === q.key)),
];

const fmt = (x: number) => (Math.round(x * 10) / 10).toFixed(1);
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const finite = (x: number | null): x is number => x !== null && Number.isFinite(x);
const edgeLen = (pc: Piece | undefined, pred: (e: Edge) => boolean) => (pc ? pc.edges.filter(pred).reduce((a, e) => a + pathLength(e.segs), 0) : 0);

export const puffRatio = (p: Pick<BlouseCommon, 'puff' | 'puffCustom'>) =>
  p.puff === 'custom' ? clamp(finite(p.puffCustom) ? p.puffCustom : 1.6, 1, 3) : PUFF_RATIO[p.puff];
export const isPuffy = (s: BlouseSleeve) => s === 'puff-short' || s === 'puff-long' || s === 'bishop';

/** バイアスの縁取り布（仕上がり幅 finished の二つ折り） */
function bias(id: string, name: string, cut: string, len: number, finished: number): Piece {
  const bw = finished * 2;
  return { ...rect(id, name, cut, len, bw, ['縁取り', '端', '縁取り', '端']), grain: [v(len * 0.5 - bw * 0.35, bw * 0.85), v(len * 0.5 + bw * 0.35, bw * 0.15)] };
}

interface Core {
  pieces: Piece[];
  warnings: string[];
  info: string[];
  frontOpen: boolean;
  /** 前立て（前開きの重なり）の幅・背中開きの持ち出しの幅 */
  pw: number;
  ext: number;
  /** 身幅の参考値（胸のゆとり） */
  fitRef: number;
}

/** 身頃＋袖＋襟（ブラウスとワンピースで共通） */
function draftCore(r: ResolvedBody, p: BlouseCommon, hemBelowWaist: number, opts: { hem: 'straight' | 'tail'; waistTaper: boolean }): Core {
  const val = (k: MeasurementKey) => r.values[k] as number;
  const chest = val('chest_circ');
  const pw = clamp(chest * 0.04, 0.5, 1.2);
  const frontOpen = resolveOpening(r.category, p.opening) === 'front';
  const ext = frontOpen ? pw : openingExtOf(p, chest);
  const normalSleeve = p.sleeve === 'short' || p.sleeve === 'long';
  const base = draftYshirt(r, {
    ...DEFAULT_YSHIRT,
    fabric: 'woven',
    bustDart: p.bustDart,
    opening: p.opening,
    fit: p.fit === 'loose' ? 'loose' : 'normal',
    chestEaseCustom: null,
    length: 'custom',
    lengthCustom: hemBelowWaist,
    hem: opts.hem,
    collar: p.collar === 'stand' ? 'stand' : 'round',
    sleeve: p.sleeve === 'long' ? 'long' : 'half',
    yoke: false,
    pocket: false,
    extWidth: p.extWidth,
    extWidthCustom: p.extWidthCustom,
    waistTaper: opts.waistTaper,
  });
  const warnings = [...base.warnings];
  const keep = (s: string) =>
    ['胸のゆとり', '胸ダーツ', 'カテゴリ'].some((k) => s.startsWith(k)) ||
    (normalSleeve && (s.startsWith('袖ぐり') || s.startsWith('肘が通る'))) ||
    (p.collar === 'round' && s.startsWith('丸襟')) ||
    (p.collar === 'stand' && s.startsWith('スタンドカラー'));
  const info = [base.info[0], ...base.info.slice(1).filter(keep)];
  let pieces = base.pieces.filter((pc) => !(pc.id === 'collar' && p.collar !== 'round') && !(!normalSleeve && (pc.id === 'sleeve' || pc.id === 'cuff')));
  const front = pieces.find((pc) => pc.id === 'front')!;
  const back = pieces.find((pc) => pc.id === 'back')!;

  // ---- 襟ぐりの長さ（前端〜前端、または後ろ中心〜後ろ中心） ----
  const neckTotal = 2 * (edgeLen(front, (e) => e.name.startsWith('襟ぐり')) + edgeLen(back, (e) => e.name.startsWith('襟ぐり')));
  const neck = val('neck_circ');
  const bindFinished = clamp(neck * 0.05, 0.25, 0.6);
  if (p.collar === 'none' || p.collar === 'frill') {
    pieces.push(bias('binding', '襟ぐり縁取り（バイアス）', '1枚（バイアス）', neckTotal * 0.95, bindFinished));
  }
  if (p.collar === 'none') info.push(`襟ぐり ${fmt(neckTotal)}cm ／ 縁取り布 ${fmt(neckTotal * 0.95)}cm × 仕上がり幅 ${fmt(bindFinished)}cm`);
  if (p.collar === 'frill') {
    const fw = clamp(neck * 0.12, 0.6, 2.5);
    pieces.push(rect('frill-collar', 'フリル襟（高さ方向に二つ折り・ギャザーを寄せる）', '1枚', neckTotal * FRILL, fw * 2, ['襟付け（ギャザー）', '端', '襟付け（ギャザー）', '端']));
    info.push(`フリル襟 ${fmt(neckTotal * FRILL)}cm × 仕上がりの幅 ${fmt(fw)}cm（襟ぐり ${fmt(neckTotal)}cm に寄せ、縁取り布で始末）`);
  }
  if (p.collar === 'bow') {
    const bh = clamp(neck * 0.06, 0.4, 1.5);
    const tie = clamp(chest * 0.3, 3, 25);
    if (frontOpen) {
      const L = neckTotal + tie * 2;
      const bow = rect('bow', 'ボウタイ（高さ方向に二つ折り。真ん中を襟ぐりに付けて前で結ぶ）', '1枚', L, bh * 2, ['襟付け', '端', '襟付け', '端']);
      bow.marks = [[v(tie, 0), v(tie, 0.3)], [v(tie + neckTotal, 0), v(tie + neckTotal, 0.3)]];
      pieces.push(bow);
      info.push(`ボウタイ ${fmt(L)}cm × 仕上がりの高さ ${fmt(bh)}cm（印のあいだ ${fmt(neckTotal)}cm を襟ぐりに付ける）`);
    } else {
      pieces.push(rect('bow', '襟ぐりの帯（高さ方向に二つ折り）', '1枚', neckTotal, bh * 2, ['襟付け', '端', '襟付け', '端']));
      pieces.push(rect('ribbon', 'リボン（筒に縫って返し、結んで前中心に縫い付ける）', '1枚', tie * 2.2, bh * 2, ['縁', '端', '縁', '端']));
      info.push(`襟ぐりの帯 ${fmt(neckTotal)}cm × 高さ ${fmt(bh)}cm ／ リボン ${fmt(tie * 2.2)}cm（背中開きなので、リボンは前に縫い付け）`);
    }
  }

  // ---- 胸元のフリル（ジャボ風） ----
  const fArm = front.edges.find((e) => e.name === '袖ぐり')!;
  const chestY = fArm.segs[fArm.segs.length - 1].to.y;
  const fnd = front.edges.find((e) => e.name === '襟ぐり')!.segs[0].from.y;
  if (p.jabot) {
    const jl = Math.max(1, (chestY - fnd) * 1.4);
    const jh = clamp(chest * 0.05, 0.5, 2);
    const x = pw * 1.3;
    front.marks = [...(front.marks ?? []), [v(x, fnd + 0.3), v(x, fnd + 0.3 + jl)]];
    pieces.push(rect('jabot', '胸元のフリル（高さ方向に二つ折り・ギャザーを寄せる）', '2枚', jl * GATHER, jh * 2, ['付け側（ギャザー）', '端', '付け側（ギャザー）', '端']));
    info.push(`胸元のフリル ${fmt(jl * GATHER)}cm × 仕上がりの幅 ${fmt(jh)}cm（前立ての横の印 ${fmt(jl)}cm に寄せて付ける）`);
  }

  // ---- 袖 ----
  if (!normalSleeve) {
    const frontAH = edgeLen(front, (e) => e.name === '袖ぐり');
    const backAH = edgeLen(back, (e) => e.name === '袖ぐり');
    if (p.sleeve === 'none') {
      pieces.push(bias('armhole-binding', '袖ぐり縁取り（バイアス）', '2枚（バイアス）', (frontAH + backAH) * 0.95, bindFinished));
      info.push(`ノースリーブ: 袖ぐり ${fmt(frontAH + backAH)}cm を縁取り布で始末`);
    } else {
      const s = puffSleeve(r, p, frontAH, backAH);
      pieces.push(...s.pieces);
      info.push(...s.info);
      warnings.push(...s.warnings);
    }
  }
  pieces = pieces.map((pc) => (pc.id === 'front' ? front : pc));
  return { pieces, warnings, info, frontOpen, pw, ext, fitRef: base.refs?.fit ?? 0 };
}

/** パフスリーブ（半袖・長袖）・ビショップスリーブ */
export function puffSleeve(r: ResolvedBody, p: BlouseCommon, frontAH: number, backAH: number): { pieces: Piece[]; info: string[]; warnings: string[] } {
  const val = (k: MeasurementKey) => r.values[k] as number;
  const k = r.category ? CATEGORY_EASE[r.category] : 1;
  const ease = applyFit(
    scaleEase(defaultEase('woven', { chest: val('chest_circ'), hip: val('hip_circ'), upperArm: val('upper_arm_circ'), armhole: val('armhole_circ') }), k),
    p.fit === 'loose' ? 'loose' : 'normal',
    'normal',
  );
  const armLen = val('arm_length');
  const minPass = val('elbow_pass_circ') + ease.pass;
  const short = p.sleeve === 'puff-short';
  const s0 = draftSleeve({
    frontArmholeLength: frontAH,
    backArmholeLength: backAH,
    upperArm: val('upper_arm_circ'),
    armEase: ease.arm,
    armLength: armLen,
    lengthRatio: 0.4,
    widthRatio: 0.75,
    capEase: 0.03,
    hemRatio: 1,
    minPass,
    extraWidth: 0,
  });
  const f = puffRatio(p);
  const h = s0.capHeight;
  const capB = s0.piece.edges[0].segs[0] as CubicSeg;
  const capF = s0.piece.edges[4].segs[0] as CubicSeg;
  const wb0 = capB.to.x;
  const wf0 = -capF.from.x;
  const bishop = p.sleeve === 'bishop';
  // 袖山: パフは横に f 倍・上へ dh 高く（袖下の端の高さ h はそのまま）。ビショップは普通の袖山
  const fx = bishop ? 1 : f;
  const dh = bishop ? 0 : h * (f - 1) * 0.6;
  const T = (q: Vec) => v(q.x * fx, q.y * (1 + dh / h) - dh);
  const tc = (c: CubicSeg) => cubic(T(c.from), T(c.c1), T(c.c2), T(c.to));
  const backCap = tc(capB);
  const frontCap = tc(capF);
  const wb = wb0 * fx;
  const wf = wf0 * fx;

  const pieces: Piece[] = [];
  const info: string[] = [];
  const warnings: string[] = [...s0.warnings];
  const cuffH = clamp(armLen * 0.12, 0.6, 3);
  const bandH = clamp(armLen * 0.06, 0.3, 1.2);
  // 袖口の高さ（袖山の頂点 y = −dh から）
  let len: number;
  let hb: number;
  let hf: number;
  if (short) {
    len = Math.max(h + 0.5, armLen * 0.35);
    hb = wb;
    hf = wf;
  } else {
    len = armLen - cuffH;
    // パフ長袖は袖幅のまま、ビショップは袖口へ f 倍に広げる
    const g = bishop ? f : 0.9;
    hb = wb * g;
    hf = wf * g;
  }
  const frillH = short && p.cuff === 'frill' ? clamp(armLen * 0.08, 0.4, 2) : 0;
  const H = len + frillH;
  const dip = Math.min((H - h) * 0.15, 0.8);
  const gatheredHem = !(short && p.cuff === 'frill');
  const hemSeg = gatheredHem
    ? cubic(v(hb, H), v(hb * 0.5, H + dip), v(-hf * 0.5, H + dip), v(-hf, H))
    : line(v(hb, H), v(-hf, H));
  const cuffSide = !short || p.cuff === 'band';
  const hemEdge: Edge = cuffSide
    ? { segs: [hemSeg], kind: 'seam', name: '袖口（カフス付け）' }
    : { segs: [hemSeg], kind: 'hem', name: p.cuff === 'elastic' ? '袖口（三つ折りでゴム通し）' : '袖口' };
  const capName = (side: string) => (bishop ? `袖山（${side}）` : `袖山（${side}・ギャザー）`);
  const sleeve: Piece = {
    id: 'sleeve',
    name: BLOUSE_SLEEVE_LABEL[p.sleeve].replace(/（.*）/, ''),
    cut: '2枚（左右反転）',
    edges: [
      { segs: [backCap], kind: 'seam', name: capName('後ろ') },
      { segs: [line(v(wb, h), v(hb, H))], kind: 'seam', name: '袖下' },
      hemEdge,
      { segs: [line(v(-hf, H), v(-wf, h))], kind: 'seam', name: '袖下' },
      { segs: [frontCap], kind: 'seam', name: capName('前') },
    ],
    grain: [v(0, h * 0.6 + 0.2), v(0, H - (H - h) * 0.25)],
  };
  if (frillH > 0) sleeve.marks = [[v(hb, len), v(-hf, len)]];
  pieces.push(sleeve);

  const capLen = pathLength([backCap]) + pathLength([frontCap]);
  const hemW = hb + hf;
  if (bishop) info.push(`ビショップスリーブ: 袖口 ${fmt(hemW)}cm（袖幅の ${fmt(f)} 倍）をカフスにギャザーで寄せる`);
  else info.push(`パフスリーブ: 袖幅 ${fmt(wb + wf)}cm（${fmt(f)} 倍）／ 袖山 ${fmt(capLen)}cm を袖ぐり ${fmt(frontAH + backAH)}cm にギャザーで寄せる`);
  if (cuffSide) {
    const cuffLen = short ? Math.max(val('upper_arm_circ') + ease.arm * 0.5, minPass) : Math.max(s0.width * 0.75, minPass);
    const ch = short ? bandH : cuffH;
    pieces.push(rect('cuff', 'カフス（高さ方向に二つ折り・輪にする）', '2枚', cuffLen, ch * 2, ['袖口側', '端', '袖口側', '端']));
    info.push(`カフス ${fmt(cuffLen)}cm × 仕上がりの高さ ${fmt(ch)}cm（袖口 ${fmt(hemW)}cm をギャザーで寄せる）`);
  } else if (p.cuff === 'elastic') {
    info.push(`袖口: 三つ折りにしてゴムを通す（ゴムの長さの目安 ${fmt(Math.max(val('upper_arm_circ') + ease.arm * 0.3, val('elbow_pass_circ') * 0.8))}cm）`);
  } else {
    info.push(`袖口のフリル: 裾を三つ折りし、印の線（裾から ${fmt(frillH)}cm）にゴムを縫い付ける`);
  }
  return { pieces, info, warnings };
}

export function draftBlouse(r: ResolvedBody, p: BlouseParams): DraftResult {
  const wth = r.values.waist_to_hip;
  const hemBelowWaist = p.length === 'custom' && finite(p.lengthCustom) ? p.lengthCustom : (wth ?? 0) * LENGTH_RATIO[p.length === 'custom' ? 'hip' : p.length];
  const c = draftCore(r, p, hemBelowWaist, { hem: p.hem === 'round' ? 'tail' : 'straight', waistTaper: false });
  c.info.splice(1, 0, `ブラウス ${BLOUSE_LENGTH_LABEL[p.length]} ウエストから ${fmt(hemBelowWaist)}cm ／ ${BLOUSE_SLEEVE_LABEL[p.sleeve]} ／ ${BLOUSE_COLLAR_LABEL[p.collar]}`);
  return { pieces: c.pieces, warnings: c.warnings, info: c.info, refs: { fit: c.fitRef, length: hemBelowWaist, puff: puffRatio(p), ...(c.frontOpen ? {} : { extWidth: c.ext }) }, refUnits: { puff: '倍' } };
}

export function draftBlouseDress(r: ResolvedBody, p: BlouseDressParams): DraftResult {
  const b = skirtBase(r, p.length, p.lengthCustom);
  const L = b.length;
  const yOpen = openingLength(b.wh, L);
  const waist = p.shape === 'waist';
  const c = draftCore(r, p, waist ? 0 : L, { hem: 'straight', waistTaper: waist });
  const warnings = [...c.warnings, ...b.warnings];
  const info = [...c.info];
  let pieces = c.pieces;
  const extB = c.frontOpen ? 0 : c.ext;

  if (!waist) {
    // ---- 切り替えなし: Aラインは脇の裾を外へ広げる。背中開きは開きをヒップの下で止め、下は縫う ----
    const flare = p.silhouette === 'aline' ? Math.max(0, L - b.wh) * 0.3 : 0;
    pieces = pieces.map((pc) => {
      if (pc.id !== 'front' && pc.id !== 'back') return pc;
      let edges = pc.edges.map((e) => ({ ...e, segs: [...e.segs] }));
      if (flare > 0) {
        const side = edges.find((e) => e.name === '脇')!;
        const hem = edges.find((e) => e.name === '裾')!;
        const last = side.segs[side.segs.length - 1];
        const P = v(last.to.x + flare, last.to.y);
        side.segs[side.segs.length - 1] = line(last.from, P);
        const h0 = hem.segs[0];
        hem.segs[0] = h0.kind === 'line' ? line(P, h0.to) : cubic(P, h0.c1, h0.c2, h0.to);
      }
      if (pc.id === 'back' && !c.frontOpen) {
        const cb = edges[edges.length - 1];
        const hem = edges.find((e) => e.name === '裾')!;
        const top = cb.segs[0].to.y;
        const bottom = cb.segs[0].from.y;
        const yO = Math.min(bottom - 0.5, top + (r.values.back_length ?? 0) + yOpen);
        const lastH = hem.segs[hem.segs.length - 1];
        if (Math.abs(lastH.from.x) < 1e-9) hem.segs.pop();
        else hem.segs[hem.segs.length - 1] = line(lastH.from, v(0, lastH.to.y));
        edges = [
          ...edges.slice(0, -1),
          { segs: [line(v(0, bottom), v(0, yO))], kind: 'seam', name: '後ろ中心' },
          { segs: [line(v(0, yO), v(-extB, yO))], kind: 'seam', name: '持ち出しの下端' },
          { segs: [line(v(-extB, yO), v(-extB, top))], kind: 'opening', name: '後ろ開き' },
        ];
        return { ...pc, edges, ...extMarks(top, yO, extB) };
      }
      return { ...pc, edges };
    });
    if (!c.frontOpen) {
      // 背中開き: 前の飾りの前立てとボタンの印は、身頃の部分（ウエストまで）だけにする
      const front = pieces.find((pc) => pc.id === 'front')!;
      const back = pieces.find((pc) => pc.id === 'back')!;
      const waistY = back.edges[back.edges.length - 1].segs[0].to.y + (r.values.back_length ?? 0);
      const fnd = front.edges.find((e) => e.name === '襟ぐり')!.segs[0].from.y;
      front.marks = (front.marks ?? []).filter((m) => !(m.every((q) => Math.abs(q.x) < 0.5) && m.some((q) => q.y > waistY)));
      pieces = pieces.map((pc) => {
        if (pc.id !== 'placket') return pc;
        const w = pc.edges[0].segs[0].to.x;
        return rect('placket', pc.name, pc.cut, w, Math.max(1, waistY - fnd), ['襟ぐり側', '端', '裾', '端'], ['seam', 'seam', 'hem', 'seam']);
      });
    }
    info.splice(1, 0, `ワンピース 切り替えなし（${DRESS_SILHOUETTE_LABEL[p.silhouette]}）／ ${SKIRT_LENGTH_LABEL[p.length]} ウエストから ${fmt(L)}cm ／ ${BLOUSE_SLEEVE_LABEL[p.sleeve]} ／ ${BLOUSE_COLLAR_LABEL[p.collar]}`);
    if (flare > 0) info.push(`Aライン: 脇の裾を ${fmt(flare)}cm 外へ広げています`);
    if (!c.frontOpen) info.push(`背中開きはウエストから ${fmt(yOpen)}cm 下まで。その下の後ろ中心は縫い合わせます`);
  } else {
    // ---- ウエスト切り替え: 身頃の裾をウエストにして、スカートを付ける ----
    pieces = pieces.map((pc) =>
      pc.id === 'front' || pc.id === 'back' ? { ...pc, edges: pc.edges.map((e) => (e.name === '裾' ? { ...e, kind: 'seam' as EdgeKind, name: 'ウエスト' } : e)) } : pc,
    );
    const front = pieces.find((pc) => pc.id === 'front')!;
    const back = pieces.find((pc) => pc.id === 'back')!;
    const fHalf = edgeLen(front, (e) => e.name === 'ウエスト') - (c.frontOpen ? c.pw : 0);
    const bHalf = edgeLen(back, (e) => e.name === 'ウエスト') - extB;
    const sk = dressSkirt(r, { kind: p.skirt, L, wh: b.wh, hipF: b.hipF, fHalf, bHalf, frontOpen: c.frontOpen, pw: c.pw, extB, yOpen });
    const skirt = sk.pieces;
    info.push(...sk.info);
    pieces.push(...skirt);
    info.splice(1, 0, `ワンピース ウエスト切り替え（${DRESS_SKIRT_LABEL[p.skirt]}）／ ${SKIRT_LENGTH_LABEL[p.length]} ウエストから ${fmt(L)}cm ／ ${BLOUSE_SLEEVE_LABEL[p.sleeve]} ／ ${BLOUSE_COLLAR_LABEL[p.collar]}`);
  }

  if (p.sash) {
    const sw = clamp((r.values.back_length ?? 10) * 0.12, 0.5, 2);
    const sl = (r.values.waist_circ ?? 10) + 2 * clamp((r.values.chest_circ ?? 10) * 0.5, 4, 40);
    pieces.push(rect('sash', 'サッシュベルト（高さ方向に二つ折りで筒に縫って返す）', '1枚', sl, sw * 2, ['縁', '端', '縁', '端']));
    info.push(`サッシュベルト ${fmt(sl)}cm × 仕上がりの幅 ${fmt(sw)}cm（ウエストで結ぶ）`);
  }
  return { pieces, warnings, info, refs: { fit: c.fitRef, length: L, puff: puffRatio(p), ...(c.frontOpen ? {} : { extWidth: c.ext }) }, refUnits: { puff: '倍' } };
}
