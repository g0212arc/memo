// トレンチ。身頃と袖はラグラン袖シャツ（または Tシャツ）の作図を使い、前開き・襟・ディテールを足す。
// 前: 前中心の外へ重なり（ダブルは広く、シングルは狭く）を出し、見返しで始末する。ボタンの位置は印。
// 襟: 立ち襟＋のど元のタブ、または台襟付きの折り襟。
// ディテール: 肩章・ウエストベルト（ベルト通し）・袖ベルト・フラップポケット・ガンフラップ・背中のケープ。

import { Vec, v } from '../../geometry/vec';
import { Seg, cubic, line, pathLength } from '../../geometry/path';
import { ResolvedBody } from '../../model/estimate';
import { MeasurementKey } from '../../model/schema';
import { clipPieceX } from '../clip';
import { Fit } from '../fit';
import { DraftResult, Edge, EdgeKind, Piece } from '../types';
import { draftRaglan, DEFAULT_RAGLAN, RAGLAN_REQUIREMENTS } from './raglan';
import { draftTshirt, DEFAULT_TSHIRT, MissingMeasurementsError } from './tshirt';

export type TrenchLength = 'short' | 'half' | 'long' | 'custom';

export interface TrenchParams {
  sleeveType: 'raglan' | 'set';
  front: 'double' | 'single';
  collar: 'stand' | 'collar';
  length: TrenchLength;
  /** length が custom のときの着丈（ウエストから下へ cm） */
  lengthCustom: number | null;
  buttons: 'auto' | 'custom';
  /** ボタンの数（ダブルは 1 列の数） */
  buttonsCustom: number | null;
  epaulette: boolean;
  belt: boolean;
  sleeveStrap: boolean;
  pocket: boolean;
  gunFlap: boolean;
  cape: boolean;
  lining: boolean;
  bustDart: boolean;
  fitBody: Fit;
  fitSleeve: Fit;
}

export const DEFAULT_TRENCH: TrenchParams = {
  sleeveType: 'raglan',
  front: 'double',
  collar: 'stand',
  length: 'short',
  lengthCustom: null,
  buttons: 'auto',
  buttonsCustom: null,
  epaulette: true,
  belt: true,
  sleeveStrap: true,
  pocket: true,
  gunFlap: false,
  cape: false,
  lining: false,
  bustDart: true,
  fitBody: 'normal',
  fitSleeve: 'normal',
};

export const TRENCH_LENGTH_LABEL: Record<TrenchLength, string> = { short: 'ショート（腰）', half: 'ハーフ（太もも）', long: 'ロング（膝）', custom: '自分で入力' };
export const TRENCH_REQUIREMENTS: { key: MeasurementKey; hard: boolean }[] = [
  ...RAGLAN_REQUIREMENTS,
  { key: 'neck_length', hard: false },
  { key: 'rise', hard: false },
  { key: 'inseam', hard: false },
  { key: 'knee_height', hard: false },
];

const fmt = (x: number) => (Math.round(x * 10) / 10).toFixed(1);
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const finite = (x: number | null): x is number => x !== null && Number.isFinite(x);
const cross = (c: Vec, r: number): Vec[][] => [[v(c.x - r, c.y), v(c.x + r, c.y)], [v(c.x, c.y - r), v(c.x, c.y + r)]];

function rect(id: string, name: string, cut: string, w: number, h: number, names: [string, string, string, string], kinds: EdgeKind[] = ['seam', 'seam', 'seam', 'seam']): Piece {
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

/** 片方の端がとがった帯（肩章・袖ベルト・タブ）。とがった先にボタンの印 */
function strap(id: string, name: string, cut: string, L: number, w: number): Piece {
  const tip = w * 0.5;
  return {
    id,
    name,
    cut,
    edges: [
      { segs: [line(v(0, 0), v(L - tip, 0)), line(v(L - tip, 0), v(L, w / 2)), line(v(L, w / 2), v(L - tip, w)), line(v(L - tip, w), v(0, w))], kind: 'seam', name: '縁' },
      { segs: [line(v(0, w), v(0, 0))], kind: 'seam', name: '付け側' },
    ],
    grain: [v(L * 0.15, w / 2), v(L * 0.6, w / 2)],
    marks: cross(v(L - tip * 1.6, w / 2), Math.min(0.2, w * 0.25)),
  };
}

export function draftTrench(r: ResolvedBody, p: TrenchParams): DraftResult {
  const missing = TRENCH_REQUIREMENTS.filter((q) => r.values[q.key] === undefined).map((q) => q.key);
  if (missing.length > 0) throw new MissingMeasurementsError(missing);
  const val = (k: MeasurementKey) => r.values[k] as number;
  const info: string[] = [];
  const chest = val('chest_circ');
  const wh = val('waist_to_hip');
  const hemBelowWaist =
    p.length === 'custom' && finite(p.lengthCustom)
      ? p.lengthCustom
      : { short: wh * 0.9, half: val('rise') + val('inseam') * 0.35, long: val('inseam') + val('rise') - val('knee_height') * 0.95, custom: wh * 0.9 }[p.length];
  // コートなので重ね着の分を足す
  const common = {
    fabric: 'woven' as const,
    stretch: 0,
    bustDart: p.bustDart,
    backOpening: false,
    hemBelowWaist,
    fitBody: p.fitBody,
    fitSleeve: p.fitSleeve,
    length: 'normal' as const,
    extraChestEase: chest * 0.08 + 0.3,
    frontNeckDrop: 0,
    extraSleeveWidth: val('upper_arm_circ') * 0.12,
    extraArmholeEase: val('armhole_circ') * 0.06,
  };
  const base =
    p.sleeveType === 'raglan'
      ? draftRaglan(r, { ...DEFAULT_RAGLAN, ...common, neck: 'crew', sleeve: 'long', shoulder: 'two' })
      : draftTshirt(r, { ...DEFAULT_TSHIRT, ...common, sleeveRatio: 1 });
  const warnings = [...base.warnings];
  const pieces: Piece[] = base.pieces.filter((pc) => pc.id !== 'binding').map((pc) => ({ ...pc, edges: [...pc.edges] }));
  const front0 = pieces.find((pc) => pc.id === 'front')!;
  const back = pieces.find((pc) => pc.id === 'back')!;

  // ---- 前身頃: 前中心の外へ重なり ----
  const armEnd = front0.edges.find((e) => e.name === '袖ぐり' || e.name === '袖ぐり（袖下）')!.segs.at(-1)!.to;
  const chestQ = armEnd.x;
  const chestY = armEnd.y;
  const neckE = front0.edges.find((e) => e.name === '襟ぐり')!;
  const fnd = neckE.segs[0].from.y;
  const hemY = front0.edges.find((e) => e.kind === 'fold')!.segs[0].from.y;
  const ext = p.front === 'double' ? clamp(chestQ * 0.35, 0.8, 4) : clamp(chest * 0.05, 0.6, 1.6);
  const frontEdges: Edge[] = [];
  for (const e of front0.edges) {
    if (e.name === '襟ぐり') frontEdges.push({ ...e, segs: [line(v(-ext, fnd), v(0, fnd)), ...e.segs] });
    else if (e.name === '裾') frontEdges.push({ ...e, segs: [...e.segs, line(v(0, hemY), v(-ext, hemY))] });
    else if (e.kind === 'fold') frontEdges.push({ segs: [line(v(-ext, hemY), v(-ext, fnd))], kind: 'seam', name: '前端（見返しと縫う）' });
    else frontEdges.push(e);
  }
  const front: Piece = { ...front0, cut: '2枚（左右反転）', edges: frontEdges, marks: [...(front0.marks ?? [])] };
  pieces[pieces.indexOf(front0)] = front;

  // ボタンの位置
  const rowsAuto = p.front === 'double' ? clamp(Math.round((hemY - fnd) / Math.max(chest * 0.18, 1)), 2, 4) : clamp(Math.round((hemY - fnd) / Math.max(chest * 0.11, 1)), 3, 7);
  const rows = p.buttons === 'custom' && finite(p.buttonsCustom) ? clamp(Math.round(p.buttonsCustom), 1, 10) : rowsAuto;
  const bTop = fnd + Math.max(0.4, ext * 0.25);
  const bBottom = p.front === 'double' ? Math.min(hemY - 0.6, chestY + (hemY - chestY) * 0.55) : hemY - 0.6;
  const cols = p.front === 'double' ? [-ext * 0.65, ext * 0.65] : [0];
  const br = Math.min(0.25, ext * 0.2);
  for (let i = 0; i < rows; i++) {
    const y = rows === 1 ? bTop : bTop + ((bBottom - bTop) * i) / (rows - 1);
    for (const x of cols) front.marks!.push(...cross(v(x, y), br));
  }
  info.push(`${p.front === 'double' ? 'ダブル' : 'シングル'}（重なり ${fmt(ext)}cm）／ ボタン ${rows} ${p.front === 'double' ? '段 × 2 列' : '個'}（印の位置。スナップでも可）`);

  // 見返し
  const fw = ext + clamp(chestQ * 0.3, 0.8, 4);
  const facingSrc: Piece = { ...front, edges: front.edges.map((e) => (e.name === '裾' ? { ...e, kind: 'hem' as EdgeKind } : e)) };
  pieces.push({
    id: 'front-facing',
    name: '前見返し',
    cut: '2枚（左右反転）',
    edges: clipPieceX(facingSrc, 'left', fw - ext, { kind: 'hem', name: '見返し端' }),
    grain: [v((fw - 2 * ext) / 2, fnd + 0.6), v((fw - 2 * ext) / 2, hemY - 0.6)],
  });

  // ---- 襟 ----
  const neckEdges = pieces.flatMap((pc) => (['front', 'back', 'sleeve', 'sleeve-front', 'sleeve-back'].includes(pc.id) ? pc.edges.filter((e) => e.name.startsWith('襟ぐり')) : []));
  const neckHalf = neckEdges.reduce((a, e) => a + pathLength(e.segs), 0);
  const ch = clamp(val('neck_length') * 0.55, 0.5, 2.2); // 立ち襟の高さ
  const rise = ch * 0.3;
  const lowerAt = (Lx: number): Seg => cubic(v(0, ch), v(Lx * 0.5, ch), v(Lx * 0.8, ch - rise * 0.5), v(Lx, ch - rise));
  let lo = neckHalf * 0.6;
  let hi = neckHalf * 1.2;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (pathLength([lowerAt(mid)]) < neckHalf) lo = mid;
    else hi = mid;
  }
  const Lc = (lo + hi) / 2;
  const topSeg = cubic(v(Lc - ch * 0.05, -rise), v(Lc * 0.8, -rise * 0.5), v(Lc * 0.5, 0), v(0, 0));
  const stand: Piece = {
    id: 'stand',
    name: p.collar === 'stand' ? '立ち襟' : '台襟',
    cut: '2枚（わ・表と裏）',
    edges: [
      { segs: [lowerAt(Lc)], kind: 'seam', name: '襟付け' },
      { segs: [line(v(Lc, ch - rise), v(Lc - ch * 0.05, -rise))], kind: 'seam', name: '前端' },
      { segs: [topSeg], kind: 'seam', name: p.collar === 'stand' ? '襟の上端' : '上襟付け' },
      { segs: [line(v(0, 0), v(0, ch))], kind: 'fold', name: '後ろ中心（わ）' },
    ],
    grain: [v(Lc * 0.15, ch * 0.45), v(Lc * 0.6, ch * 0.45)],
  };
  pieces.push(stand);
  if (p.collar === 'stand') {
    pieces.push(strap('throat-tab', 'のど元のタブ（立ち襟の前に留める）', '2枚（表と裏）', ch * 3, ch * 0.7));
    info.push(`立ち襟 高さ ${fmt(ch)}cm ／ のど元のタブはボタン（スナップ）で留めます`);
  } else {
    const Lt = pathLength([topSeg]);
    const cH = ch * 1.8;
    pieces.push({
      id: 'collar',
      name: '上襟',
      cut: '2枚（わ・表と裏）',
      edges: [
        { segs: [line(v(0, cH), v(Lt, cH))], kind: 'seam', name: '台襟付け' },
        { segs: [line(v(Lt, cH), v(Lt + cH * 0.45, 0))], kind: 'seam', name: '襟先' },
        { segs: [cubic(v(Lt + cH * 0.45, 0), v(Lt * 0.75, -cH * 0.05), v(Lt * 0.3, 0), v(0, 0))], kind: 'seam', name: '外まわり' },
        { segs: [line(v(0, 0), v(0, cH))], kind: 'fold', name: '後ろ中心（わ）' },
      ],
      grain: [v(Lt * 0.15, cH * 0.5), v(Lt * 0.6, cH * 0.5)],
    });
    info.push(`台襟 高さ ${fmt(ch)}cm ／ 上襟 幅 ${fmt(cH)}cm`);
  }

  // ---- ディテール ----
  const beltW = clamp(val('back_length') * 0.1, 0.5, 1.5);
  if (p.epaulette) {
    const eL = clamp(val('shoulder_width') * 0.32, 1.2, 8);
    pieces.push(strap('epaulette', '肩章（肩線に沿って付け、先をボタンで留める）', '4枚（表と裏）', eL, clamp(eL * 0.28, 0.5, 1.6)));
  }
  if (p.belt) {
    const garmentWaist = (chest + common.extraChestEase) * 1.05;
    const bL = garmentWaist * 1.35;
    pieces.push(rect('belt', 'ウエストベルト（幅方向に二つ折り・片端にバックル）', '1枚', bL, beltW * 2, ['縁', '端', '縁', '端']));
    pieces.push(rect('belt-loop', 'ベルト通し（細く折って脇に付ける）', '2枚', beltW * 0.8 * 3, beltW * 1.6, ['縁', '端', '縁', '端']));
    front.marks!.push([v(chestQ - 0.1, chestY + (hemY - chestY) * 0.35 - beltW * 0.8), v(chestQ - 0.1, chestY + (hemY - chestY) * 0.35 + beltW * 0.8)]);
    info.push(`ウエストベルト ${fmt(bL)}cm × 仕上がり幅 ${fmt(beltW)}cm（バックルの内径 ${fmt(beltW)}cm くらい）`);
  }
  const sleeves = pieces.filter((pc) => pc.id.startsWith('sleeve'));
  if (p.sleeveStrap) {
    const hemLen = sleeves.reduce((a, pc) => a + pc.edges.filter((e) => e.kind === 'hem').reduce((s, e) => s + pathLength(e.segs), 0), 0);
    pieces.push(strap('sleeve-strap', '袖ベルト（袖口の少し上に巻いて留める）', '4枚（表と裏）', hemLen * 0.75, beltW * 0.75));
  }
  if (p.pocket) {
    const fW = clamp(chestQ * 0.42, 1, 6);
    const fH = fW * 0.4;
    const py = Math.min(hemY - fH - 0.6, chestY + (hemY - chestY) * 0.55);
    const px = chestQ * 0.35;
    front.marks!.push([v(px, py), v(px + fW, py)]);
    // 布目線はポケットの印と重ならないよう脇側（入らなければ前側）へ
    const gx = px + fW + 0.35 < chestQ - 0.2 ? px + fW + 0.35 : Math.max(0.2, px - 0.35);
    front.grain = [v(gx, front.grain[0].y), v(gx, front.grain[1].y)];
    pieces.push(rect('pocket-flap', 'ポケットのフラップ（印の線に付ける）', '4枚（表と裏）', fW, fH, ['付け側', '端', '下', '端']));
  }
  if (p.gunFlap) {
    const gW = chestQ * 0.75;
    const gH = (chestY - fnd) * 0.85;
    pieces.push({
      id: 'gun-flap',
      name: 'ガンフラップ（右胸に重ねる当て布。形は目安）',
      cut: '2枚（表と裏）',
      edges: [
        { segs: [line(v(0, 0), v(gW, 0))], kind: 'seam', name: '肩・襟ぐり側' },
        { segs: [line(v(gW, 0), v(gW, gH * 0.75)), line(v(gW, gH * 0.75), v(gW * 0.8, gH)), line(v(gW * 0.8, gH), v(0, gH))], kind: 'seam', name: '縁' },
        { segs: [line(v(0, gH), v(0, 0))], kind: 'seam', name: '前端側' },
      ],
      grain: [v(gW * 0.5, gH * 0.2), v(gW * 0.5, gH * 0.8)],
    });
  }
  if (p.cape) {
    const cW = chestQ * 1.05;
    const cH = (chestY - fnd) * 1.1;
    pieces.push({
      id: 'back-cape',
      name: '背中のケープ（肩の後ろに重ねる当て布。形は目安）',
      cut: '2枚（わ・表と裏）',
      edges: [
        { segs: [line(v(0, 0), v(cW, 0))], kind: 'seam', name: '肩・襟ぐり側' },
        { segs: [line(v(cW, 0), v(cW, cH * 0.85)), cubic(v(cW, cH * 0.85), v(cW * 0.9, cH), v(cW * 0.5, cH), v(0, cH))], kind: 'seam', name: '縁' },
        { segs: [line(v(0, cH), v(0, 0))], kind: 'fold', name: '後ろ中心（わ）' },
      ],
      grain: [v(cW * 0.3, cH * 0.2), v(cW * 0.3, cH * 0.8)],
    });
  }

  // ---- 裏地 ----
  if (p.lining) {
    pieces.push({
      ...front,
      id: 'front-lining',
      name: '前身頃（裏地）',
      cut: '2枚（左右反転・裏地）',
      edges: clipPieceX(front, 'right', fw - ext, { kind: 'seam', name: '見返し付け' }),
      marks: front.marks?.filter((m) => m.length === 3),
    });
    pieces.push({ ...back, id: 'back-lining', name: '後ろ身頃（裏地）', cut: back.cut.replace('）', '・裏地）') });
    for (const s of sleeves) pieces.push({ ...s, id: `${s.id}-lining`, name: `${s.name}（裏地）`, cut: s.cut.replace('）', '・裏地）') });
  }

  info.unshift(`${p.sleeveType === 'raglan' ? 'ラグラン袖' : '普通の袖'} ／ ${TRENCH_LENGTH_LABEL[p.length]} ウエストから ${fmt(hemBelowWaist)}cm ／ ${p.collar === 'stand' ? '立ち襟＋タブ' : '台襟付きの折り襟'}`);
  info.push(`重ね着の分のゆとり 胸 ＋${fmt(common.extraChestEase)}cm`);
  info.push(...base.info.filter((s) => s.startsWith('カテゴリ')));
  return { pieces, warnings, info };
}
