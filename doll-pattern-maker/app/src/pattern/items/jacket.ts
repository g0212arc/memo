// ジャケット = 身頃原型（ゆとり多め）＋ ラペル・襟 ＋ 袖 ＋ 見返し・裏地 ＋ ポケット。
// ラペルは前身頃の前端から外へ描く。返り止まり（前端の折り返し始め）と、肩線を首側へ延ばした点を結ぶ線が返り線。
// 襟: テーラード／ピークドラペル／ショールカラー（ラペルと襟を続けて前身頃と一緒に裁つ）／ノーカラー。
// 作り: 普通は見返しあり。薄い作りは見返しを付けず、前端を三つ折りで始末する（小さいボディ向け）。

import { Vec, v, add, sub, mul, normalize, perpLeft, dist } from '../../geometry/vec';
import { cubic, line, pathLength, Seg } from '../../geometry/path';
import { ResolvedBody } from '../../model/estimate';
import { MeasurementKey } from '../../model/schema';
import { CATEGORY_EASE } from '../../model/category';
import { draftBodice } from '../bodice';
import { useBustDart } from '../bust';
import { clipPieceX } from '../clip';
import { draftSleeve } from '../sleeve';
import { defaultEase, scaleEase } from '../ease';
import { applyFit, Fit } from '../fit';
import { BACK_OPENING_CATEGORIES } from '../opening';
import { DraftResult, Edge, EdgeKind, Fabric, Piece } from '../types';
import { MissingMeasurementsError } from './tshirt';

export type JacketCollar = 'notch' | 'peak' | 'shawl' | 'none';
export type JacketLength = 'short' | 'normal' | 'long' | 'custom';
export type Size3 = 'small' | 'normal' | 'large' | 'custom';

export interface JacketParams {
  fabric: Fabric;
  stretch: number;
  bustDart: boolean;
  build: 'auto' | 'normal' | 'thin';
  collar: JacketCollar;
  breast: 'single' | 'double';
  buttons: number;
  fit: Fit | 'custom';
  chestEaseCustom: number | null;
  length: JacketLength;
  lengthCustom: number | null;
  lapel: Size3;
  /** lapel が custom のときのラペルの幅（cm） */
  lapelCustom: number | null;
  roll: Size3;
  /** roll が custom のときの返り止まりの深さ（首の付け根の高さから cm） */
  rollCustom: number | null;
  hemShape: 'square' | 'round' | 'point';
  cuff: boolean;
  pocket: boolean;
  chestPocket: boolean;
  lining: boolean;
}

export const DEFAULT_JACKET: JacketParams = {
  fabric: 'woven',
  stretch: 20,
  bustDart: true,
  build: 'auto',
  collar: 'notch',
  breast: 'single',
  buttons: 2,
  fit: 'normal',
  chestEaseCustom: null,
  length: 'normal',
  lengthCustom: null,
  lapel: 'normal',
  lapelCustom: null,
  roll: 'normal',
  rollCustom: null,
  hemShape: 'round',
  cuff: true,
  pocket: true,
  chestPocket: true,
  lining: true,
};

export const JACKET_COLLAR_LABEL: Record<JacketCollar, string> = {
  notch: 'テーラード',
  peak: 'ピークドラペル',
  shawl: 'ショールカラー',
  none: 'ノーカラー',
};
export const JACKET_LENGTH_LABEL: Record<JacketLength, string> = {
  short: 'ショート（ウエスト）',
  normal: '普通（腰まで）',
  long: '長め（お尻が隠れる）',
  custom: '自分で入力',
};
export const LAPEL_LABEL: Record<Size3, string> = { small: '細め', normal: '普通', large: '太め', custom: '自分で入力' };
export const ROLL_LABEL: Record<Size3, string> = { small: '浅め', normal: '普通', large: '深め', custom: '自分で入力' };

export const JACKET_REQUIREMENTS: { key: MeasurementKey; hard: boolean }[] = [
  { key: 'chest_circ', hard: true },
  { key: 'waist_circ', hard: true },
  { key: 'hip_circ', hard: true },
  { key: 'neck_circ', hard: false },
  { key: 'neck_length', hard: false },
  { key: 'shoulder_width', hard: false },
  { key: 'arm_length', hard: false },
  { key: 'back_length', hard: false },
  { key: 'front_length', hard: false },
  { key: 'armhole_circ', hard: false },
  { key: 'upper_arm_circ', hard: false },
  { key: 'elbow_pass_circ', hard: false },
  { key: 'waist_to_hip', hard: false },
];

/** 「自動」のとき薄い作りにするか（背中開きにするカテゴリと同じ、小さいボディ） */
export function jacketThin(category: ResolvedBody['category'], build: JacketParams['build']): boolean {
  if (build !== 'auto') return build === 'thin';
  return category !== null && BACK_OPENING_CATEGORIES.includes(category);
}

const fmt = (x: number) => (Math.round(x * 10) / 10).toFixed(1);
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const finite = (x: number | null): x is number => x !== null && Number.isFinite(x);
const cross = (c: Vec, r: number): Vec[][] => [
  [v(c.x - r, c.y), v(c.x + r, c.y)],
  [v(c.x, c.y - r), v(c.x, c.y + r)],
];
const rectMark = (x: number, y: number, w: number, h: number): Vec[] => [v(x, y), v(x + w, y), v(x + w, y + h), v(x, y + h), v(x, y)];

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

export function draftJacket(r: ResolvedBody, p: JacketParams): DraftResult {
  const missing = JACKET_REQUIREMENTS.filter((q) => r.values[q.key] === undefined).map((q) => q.key);
  if (missing.length > 0) throw new MissingMeasurementsError(missing);
  const val = (k: MeasurementKey) => r.values[k] as number;
  const woven = p.fabric === 'woven';
  const warnings: string[] = [];
  const info: string[] = [];
  const thin = jacketThin(r.category, p.build);

  const chest = val('chest_circ');
  const wth = val('waist_to_hip');
  const categoryEase = r.category ? CATEGORY_EASE[r.category] : 1;
  const shapeFit: Fit = p.fit === 'custom' ? 'normal' : p.fit;
  const ease = applyFit(
    scaleEase(
      defaultEase(p.fabric, { chest, hip: val('hip_circ'), upperArm: val('upper_arm_circ'), armhole: val('armhole_circ') }),
      categoryEase,
    ),
    shapeFit,
    'normal',
  );
  // シャツの上に着る分を足す
  ease.chest += chest * 0.05 + 0.3;
  ease.hip += val('hip_circ') * 0.03;
  ease.armhole += 0.3;
  ease.arm += val('upper_arm_circ') * 0.05;
  if (p.fit === 'custom' && finite(p.chestEaseCustom)) ease.chest = p.chestEaseCustom;

  const hemBelowWaist =
    p.length === 'custom' && finite(p.lengthCustom) ? p.lengthCustom : wth * { short: 0, normal: 0.9, long: 1.6, custom: 0.9 }[p.length];
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
      woven,
      neckWiden: 0.06,
      frontNeckDrop: 0,
      shoulderExtend: val('shoulder_width') * 0.02,
      hemBelowWaist,
      armholeEase: ease.armhole,
      backOpening: false,
      openingExt: 0,
      bustDart: useBustDart(r, p),
    },
  );
  warnings.push(...bodice.warnings);
  const g = bodice.geom;
  const snp = g.snp;

  // ---- 打ち合わせ・返り止まり・返り線 ----
  const double = p.breast === 'double';
  const ext = double ? clamp(chest * 0.12, 1.2, 4) : clamp(chest * 0.05, 0.6, 1.5);
  const hemY = g.frontHemY;
  const breakY = clamp(
    p.roll === 'custom' && finite(p.rollCustom) ? p.rollCustom : g.chestY + (g.waistY - g.chestY) * { small: 0.05, normal: 0.35, large: 0.7, custom: 0.35 }[p.roll],
    g.chestY * 0.6,
    hemY - 1,
  );
  const BP = v(-ext, breakY);
  const standH = clamp(val('neck_length') * 0.4, 0.3, 1.0);
  const R = add(snp, mul(normalize(sub(snp, g.frontSP)), standH * 0.7));
  const L = dist(BP, R);
  const u = normalize(sub(R, BP));
  const n = perpLeft(u); // 返り線から外（ラペル側）
  const W =
    p.lapel === 'custom' && finite(p.lapelCustom) ? p.lapelCustom : g.chestQ * { small: 0.28, normal: 0.38, large: 0.48, custom: 0.38 }[p.lapel];
  const at = (k: number, w: number) => add(add(BP, mul(u, L * k)), mul(n, w));

  // ---- 前身頃の輪郭 ----
  const fe = bodice.front.edges;
  const fShoulder = fe.find((e) => e.name === '肩')!;
  const fArm = fe.find((e) => e.name === '袖ぐり')!;
  const fSide = fe.find((e) => e.name === '脇')!;
  const sideEnd = fSide.segs[fSide.segs.length - 1].to;

  // 裾（脇 → 前端の下）と前端の下の点
  let hemSegs: Seg[];
  let frontBottom: Vec;
  if (p.hemShape === 'round') {
    const rr = Math.min(g.chestQ * 0.45, (hemY - breakY) * 0.5);
    frontBottom = v(-ext, hemY - rr);
    hemSegs = [line(sideEnd, v(-ext + rr, hemY)), cubic(v(-ext + rr, hemY), v(-ext + rr * 0.45, hemY), v(-ext, hemY - rr * 0.45), frontBottom)];
  } else if (p.hemShape === 'point') {
    const drop = Math.min(g.chestQ * 0.35, wth * 0.5);
    const mid = v(Math.min(g.chestQ * 0.45, sideEnd.x * 0.6), hemY);
    frontBottom = v(-ext, hemY + drop);
    hemSegs = [line(sideEnd, mid), line(mid, frontBottom)];
  } else {
    frontBottom = v(-ext, hemY);
    hemSegs = [line(sideEnd, frontBottom)];
  }
  const frontEdgeKind: EdgeKind = thin ? 'hem' : 'opening';

  // 襟まわり（前端の上 → SNP）
  const upper: Edge[] = [];
  let neckFront = 0; // 襟を付ける前の襟ぐり（SNP まで）
  let gorge: Vec | null = null;
  const backNeckLen = bodice.backNeckLength;
  if (p.collar === 'notch' || p.collar === 'peak') {
    const peak = p.collar === 'peak';
    const Gn = at(0.78, W * 0.15);
    const Lp = peak ? at(0.82, W * 1.1) : at(0.7, W);
    upper.push(
      {
        segs: [cubic(BP, add(add(BP, mul(u, L * 0.25)), mul(n, W * 0.6)), add(sub(Lp, mul(u, L * 0.15)), mul(n, W * 0.05)), Lp)],
        kind: frontEdgeKind,
        name: 'ラペル',
      },
      { segs: [line(Lp, Gn)], kind: frontEdgeKind, name: 'ゴージ' },
      { segs: [line(Gn, snp)], kind: 'seam', name: '襟ぐり' },
    );
    neckFront = dist(Gn, snp);
    gorge = Gn;
  } else if (p.collar === 'shawl') {
    // ラペルと襟が続いた形。後ろ中心まで延ばし、背中心で左右を縫い合わせる
    const Cneck = add(snp, mul(u, backNeckLen));
    const Wc = Math.max(standH * 2.4, W * 0.7);
    const Ctop = add(Cneck, mul(n, Wc));
    upper.push(
      {
        segs: [cubic(BP, add(add(BP, mul(u, L * 0.35)), mul(n, W * 1.15)), add(sub(Ctop, mul(u, (L + backNeckLen) * 0.35)), mul(n, W * 0.1)), Ctop)],
        kind: frontEdgeKind,
        name: 'ショールカラーの外まわり',
      },
      { segs: [line(Ctop, Cneck)], kind: 'seam', name: '襟の後ろ中心' },
      { segs: [line(Cneck, snp)], kind: 'seam', name: '後ろ襟ぐり付け' },
    );
  } else {
    upper.push({
      segs: [cubic(BP, v(-ext + (snp.x + ext) * 0.55, breakY), v(snp.x, breakY * 0.45), snp)],
      kind: frontEdgeKind,
      name: '襟ぐり（ノーカラー）',
    });
  }

  const frontEdges: Edge[] = [
    fShoulder,
    fArm,
    fSide,
    { segs: hemSegs, kind: 'hem', name: '裾' },
    { segs: [line(frontBottom, BP)], kind: frontEdgeKind, name: '前端' },
    ...upper,
  ];
  // ボタン（飾り）とスナップの位置
  const sp = Math.max(chest * 0.09, 0.8);
  const nBtn = clamp(Math.round(p.buttons), 1, 3);
  const marks: Vec[][] = [...(bodice.front.marks ?? [])];
  const rb = Math.min(0.2, ext * 0.25);
  for (let i = 0; i < nBtn; i++) {
    const y = breakY + rb + i * sp;
    if (y > hemY - 0.3) break;
    const xs = double ? [-ext * 0.55, ext * 0.55] : [0];
    for (const x of xs) marks.push(...cross(v(x, y), rb));
  }
  // ポケットの位置
  const flapW = g.chestQ * 0.5;
  const flapH = Math.max(0.5, flapW * 0.33);
  const flapY = g.waistY + Math.min(wth * 0.35, (hemY - g.waistY) * 0.3);
  const hasPocket = p.pocket && hemY - flapY > flapH + 0.4;
  const pocketX = Math.max(g.chestQ * 0.3, ext * 0.6 + 0.3);
  if (hasPocket) marks.push(rectMark(pocketX, flapY, flapW, flapH));
  const weltW = g.chestQ * 0.32;
  const weltH = Math.max(0.35, weltW * 0.22);
  const weltX = g.chestQ * 0.42;
  const weltY = g.chestY - (g.chestY - g.frontSP.y) * 0.05 - weltH;
  if (p.chestPocket) marks.push(rectMark(weltX, weltY, weltW, weltH));

  const front: Piece = {
    ...bodice.front,
    cut: '2枚（左右反転）',
    edges: frontEdges,
    marks,
    grain: [v(g.chestQ * 0.55, g.chestY * 0.9), v(g.chestQ * 0.55, hemY - (hemY - g.chestY) * 0.15)],
  };
  // 後ろ: 背中心で縫い合わせる
  const back: Piece = {
    ...bodice.back,
    cut: '2枚（左右反転）',
    edges: bodice.back.edges.map((e) => (e.kind === 'fold' ? { ...e, kind: 'seam', name: '背中心' } : e)),
  };
  const pieces: Piece[] = [front, back];

  // ---- 襟（テーラード・ピークド） ----
  if (gorge) {
    const fallH = standH * 1.5;
    const H = standH + fallH;
    const rr = H * 0.55;
    const target = backNeckLen + neckFront;
    const neckEdge = (Ln: number) => [cubic(v(0, 0), v(Ln * 0.5, 0), v(Ln * 0.8, rr * 0.4), v(Ln, rr))];
    let Ln = target;
    for (let i = 0; i < 8; i++) Ln *= target / pathLength(neckEdge(Ln));
    const Cp = p.collar === 'peak' ? v(Ln + H * 0.1, rr - H * 0.8) : v(Ln + H * 0.25, rr - H * 0.95);
    pieces.push({
      id: 'collar',
      name: '襟',
      cut: thin ? '2枚（わ・表襟と裏襟。裏襟は薄い布で）' : '2枚（わ・表襟と裏襟）',
      edges: [
        { segs: neckEdge(Ln), kind: 'seam', name: '襟付け' },
        { segs: [line(v(Ln, rr), Cp)], kind: 'seam', name: '襟先' },
        { segs: [cubic(Cp, v(Ln * 0.75, -H * 0.9 + rr * 0.3), v(Ln * 0.35, -H), v(0, -H))], kind: 'seam', name: '外まわり' },
        { segs: [line(v(0, -H), v(0, 0))], kind: 'fold', name: '後ろ中心（わ）' },
      ],
      grain: [v(Ln * 0.12, -H * 0.15), v(Ln * 0.12, -H * 0.75)],
    });
    info.push(`襟 後ろの幅 ${fmt(H)}cm（台 ${fmt(standH)}cm）／ ラペル幅 ${fmt(W)}cm`);
  } else if (p.collar === 'shawl') {
    info.push(`ショールカラー: 前身頃と続けて裁ち、襟の後ろ中心で左右を縫い合わせます ／ 幅 ${fmt(W)}cm`);
  }

  // ---- 見返し・裏地 ----
  const xs = front.edges.flatMap((e) => e.segs.flatMap((s) => [s.from.x, s.to.x]));
  const collarMaxX = p.collar === 'shawl' ? Math.max(...upper.flatMap((e) => e.segs.flatMap((s) => [s.from.x, s.to.x]))) : snp.x;
  const fw = clamp(Math.max(ext + g.chestQ * 0.35, collarMaxX + 0.3), Math.min(...xs) + 0.5, g.frontSP.x - 0.3);
  if (!thin) {
    pieces.push({
      id: 'front-facing',
      name: '前見返し',
      cut: '2枚（左右反転）',
      edges: clipPieceX(front, 'left', fw, { kind: 'seam', name: '見返し端' }),
      grain: [v(Math.min(fw - 0.3, 0), breakY + 0.5), v(Math.min(fw - 0.3, 0), hemY - 0.5)],
    });
  }
  if (p.lining) {
    const frontLiningEdges = thin ? front.edges : clipPieceX(front, 'right', fw, { kind: 'seam', name: '見返し付け' });
    pieces.push(
      { ...front, id: 'front-lining', name: '前身頃（裏地）', cut: '2枚（左右反転・裏地）', edges: frontLiningEdges, marks: undefined },
      { ...back, id: 'back-lining', name: '後ろ身頃（裏地）', cut: '2枚（左右反転・裏地）' },
    );
  }

  // ---- 袖 ----
  const frontAH = pathLength(bodice.frontArmhole);
  const backAH = pathLength(bodice.backArmhole);
  const armLen = val('arm_length');
  const cuffH = p.cuff ? clamp(armLen * 0.12, 0.6, 3) : 0;
  const sleeve = draftSleeve({
    frontArmholeLength: frontAH,
    backArmholeLength: backAH,
    upperArm: val('upper_arm_circ'),
    armEase: ease.arm,
    armLength: armLen,
    lengthRatio: 1.02 - cuffH / armLen,
    widthRatio: woven ? 0.8 : 0.9,
    capEase: woven ? 0.04 : 0,
    hemRatio: 0.8,
    minPass: val('elbow_pass_circ') + ease.pass,
    extraWidth: 0,
  });
  warnings.push(...sleeve.warnings);
  pieces.push(sleeve.piece);
  const hemSeg = sleeve.piece.edges.find((e) => e.kind === 'hem')!.segs[0];
  const hemW = Math.abs(hemSeg.to.x - hemSeg.from.x);
  if (p.cuff) {
    sleeve.piece.edges = sleeve.piece.edges.map((e) => (e.kind === 'hem' ? { ...e, kind: 'seam', name: '袖口（カフス付け）' } : e));
    const cuff = rectPiece('cuff', 'カフス（高さ方向に二つ折り）', '2枚', hemW, cuffH * 2, ['seam', 'seam', 'seam', 'seam'], ['袖口側', '端', '袖口側', '端']);
    const rc = Math.min(0.2, cuffH * 0.25);
    cuff.marks = [...cross(v(hemW * 0.75, cuffH * 1.5), rc), ...cross(v(hemW * 0.88, cuffH * 1.5), rc)];
    pieces.push(cuff);
  }
  if (p.lining) {
    pieces.push({
      ...sleeve.piece,
      id: 'sleeve-lining',
      name: '袖（裏地）',
      cut: '2枚（左右反転・裏地）',
      edges: sleeve.piece.edges.map((e) => (e.kind === 'hem' ? { ...e, kind: 'seam' } : e)),
    });
  }

  // ---- ポケット ----
  if (hasPocket) pieces.push(rectPiece('flap', 'ポケットのふた', '4枚（左右・表と裏）', flapW, flapH, ['seam', 'seam', 'seam', 'seam'], ['付け側', '端', '下', '端']));
  else if (p.pocket) info.push('丈が短いので、腰ポケットは付けませんでした');
  if (p.chestPocket) pieces.push(rectPiece('welt', '胸ポケットの箱布（高さ方向に二つ折り）', '1枚（左前だけ）', weltW, weltH * 2, ['seam', 'seam', 'seam', 'seam'], ['付け側', '端', '付け側', '端']));

  info.unshift(
    `${JACKET_COLLAR_LABEL[p.collar]} ／ ${double ? 'ダブル' : 'シングル'}（打ち合わせ ${fmt(ext)}cm・ボタン ${nBtn}${double ? ' × 2 列' : ''}。スナップで留めます）`,
    thin ? '薄い作り: 見返しを付けず、前端とラペルは三つ折りで始末します' : `普通の作り: 見返し幅 ${fmt(fw + ext)}cm`,
  );
  info.push(
    `胸のゆとり ${fmt(ease.chest)}cm ／ 返り止まり 首の付け根から ${fmt(breakY)}cm`,
    `袖ぐり ${fmt(frontAH + backAH)}cm ／ 袖山 ${fmt(sleeve.capLength)}cm ／ 袖口 ${fmt(hemW)}cm${p.cuff ? `（カフスの高さ ${fmt(cuffH)}cm）` : ''}`,
  );
  if (sleeve.widenedHem || sleeve.widenedWidth) info.push('肘が通るように袖口を広げました');
  if (g.dartApplied) info.push(`胸ダーツ ${fmt(g.bustDelta)}cm（前丈と背丈の差）`);
  info.push(`カテゴリ ${r.category ?? '未分類'}${r.categoryGuessed ? '（仮）' : ''}`);
  return { pieces, warnings, info };
}
