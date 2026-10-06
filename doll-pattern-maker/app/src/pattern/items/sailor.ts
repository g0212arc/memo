// セーラートップス（セーラー襟のショートジャケット）= 身頃原型 ＋ セーラー襟 ＋ 袖（＋カフス）＋ スカーフ。
// 前は V 字の襟ぐり。前開き（重なり＋見返し）か、背中開き（前は飾りボタン）を選ぶ。
// セーラー襟は、前後の身頃を肩線で合わせた状態で、後ろ襟ぐり → 前の V 字に沿って引く。

import { Vec, v, add, sub, mul, normalize, polar } from '../../geometry/vec';
import { angleOf, frontToBack, insetPolyline } from '../../geometry/transform';
import { cubic, flatten, line, pathLength, Seg } from '../../geometry/path';
import { ResolvedBody } from '../../model/estimate';
import { MeasurementKey } from '../../model/schema';
import { CATEGORY_EASE } from '../../model/category';
import { BACK_OPENING_CATEGORIES, OpeningChoice, openingExtOf, resolveOpening } from '../opening';
import { draftBodice } from '../bodice';
import { useBustDart } from '../bust';
import { draftSleeve } from '../sleeve';
import { defaultEase, scaleEase } from '../ease';
import { applyFit, Fit } from '../fit';
import { DraftResult, Edge, Fabric, Piece } from '../types';
import { MissingMeasurementsError } from './tshirt';

export type SailorLength = 'short' | 'waist' | 'hip' | 'custom';
export type CollarShape = 'square' | 'round' | 'cut';
export type Size3 = 'small' | 'normal' | 'large' | 'custom';
export type SailorOpening = OpeningChoice;

export interface SailorParams {
  fabric: Fabric;
  stretch: number;
  bustDart: boolean;
  opening: SailorOpening;
  fit: Fit | 'custom';
  chestEaseCustom: number | null;
  length: SailorLength;
  /** length が custom のときの着丈（ウエストから下へ cm。マイナスで短く） */
  lengthCustom: number | null;
  collarShape: CollarShape;
  collarSize: Size3;
  /** collarSize が custom のときの後ろ襟の深さ（後ろ襟ぐりから cm） */
  collarDepthCustom: number | null;
  vDepth: Size3;
  /** vDepth が custom のときの V の深さ（首の付け根の高さから cm） */
  vDepthCustom: number | null;
  sleeve: 'long' | 'half';
  cuff: boolean;
  scarf: 'triangle' | 'long';
  lining: boolean;
}

export const DEFAULT_SAILOR: SailorParams = {
  fabric: 'woven',
  stretch: 20,
  bustDart: true,
  opening: 'auto',
  fit: 'loose',
  chestEaseCustom: null,
  length: 'short',
  lengthCustom: null,
  collarShape: 'square',
  collarSize: 'normal',
  collarDepthCustom: null,
  vDepth: 'normal',
  vDepthCustom: null,
  sleeve: 'half',
  cuff: true,
  scarf: 'triangle',
  lining: true,
};

export { BACK_OPENING_CATEGORIES };
export const sailorOpening = resolveOpening;

export const SAILOR_LENGTH_LABEL: Record<SailorLength, string> = {
  short: 'ショート（胸下〜ウエスト）',
  waist: 'ウエスト',
  hip: '腰まで',
  custom: '自分で入力',
};
export const COLLAR_SHAPE_LABEL: Record<CollarShape, string> = { square: '四角', round: '丸', cut: '角を斜めに切る' };
export const COLLAR_SIZE_LABEL: Record<Size3, string> = { small: '小さめ', normal: '普通', large: '大きめ', custom: '自分で入力' };
export const V_DEPTH_LABEL: Record<Size3, string> = { small: '浅め', normal: '普通', large: '深め', custom: '自分で入力' };

export const SAILOR_REQUIREMENTS: { key: MeasurementKey; hard: boolean }[] = [
  { key: 'chest_circ', hard: true },
  { key: 'waist_circ', hard: true },
  { key: 'hip_circ', hard: true },
  { key: 'neck_circ', hard: false },
  { key: 'shoulder_width', hard: false },
  { key: 'arm_length', hard: false },
  { key: 'back_length', hard: false },
  { key: 'front_length', hard: false },
  { key: 'armhole_circ', hard: false },
  { key: 'upper_arm_circ', hard: false },
  { key: 'elbow_pass_circ', hard: false },
  { key: 'waist_to_hip', hard: false },
];

const fmt = (x: number) => (Math.round(x * 10) / 10).toFixed(1);
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const finite = (x: number | null): x is number => x !== null && Number.isFinite(x);

export function draftSailor(r: ResolvedBody, p: SailorParams): DraftResult {
  const missing = SAILOR_REQUIREMENTS.filter((q) => r.values[q.key] === undefined).map((q) => q.key);
  if (missing.length > 0) throw new MissingMeasurementsError(missing);
  const val = (k: MeasurementKey) => r.values[k] as number;
  const woven = p.fabric === 'woven';
  const warnings: string[] = [];
  const info: string[] = [];
  const opening = sailorOpening(r.category, p.opening);

  const chest = val('chest_circ');
  const categoryEase = r.category ? CATEGORY_EASE[r.category] : 1;
  const shapeFit: Fit = p.fit === 'custom' ? 'normal' : p.fit;
  const ease = applyFit(
    scaleEase(
      defaultEase(p.fabric, { chest, hip: val('hip_circ'), upperArm: val('upper_arm_circ'), armhole: val('armhole_circ') }),
      categoryEase,
    ),
    shapeFit,
    p.sleeve === 'half' ? 'loose' : 'normal',
  );
  if (p.fit === 'custom' && finite(p.chestEaseCustom)) ease.chest = p.chestEaseCustom;

  const wth = val('waist_to_hip');
  // 背中開きの持ち出しは「持ち出しの幅」から（前開きの重なりは今まで通り自動）
  const openingExt = opening === 'back' ? openingExtOf(p, chest) : clamp(chest * 0.05, 0.6, 1.5);
  // 着丈（ウエストから）: ショートは胸の線とウエストの間（あとで胸の線の高さから決め直す）
  const hemFor = (chestToWaist: number) =>
    p.length === 'custom' && finite(p.lengthCustom)
      ? p.lengthCustom
      : { short: -chestToWaist * 0.35, waist: 0, hip: wth, custom: 0 }[p.length];
  const bodiceArgs = {
    chest,
    waist: val('waist_circ'),
    hip: val('hip_circ'),
    neck: val('neck_circ'),
    shoulder: val('shoulder_width'),
    backLength: val('back_length'),
    frontLength: val('front_length'),
    armhole: val('armhole_circ'),
    waistToHip: wth,
  };
  const opts = (hemBelowWaist: number) => ({
    ease,
    woven,
    neckWiden: 0.05,
    frontNeckDrop: 0,
    shoulderExtend: 0,
    hemBelowWaist,
    armholeEase: ease.armhole,
    backOpening: opening === 'back',
    openingExt,
    bustDart: useBustDart(r, p),
  });
  // 1回目で胸の線の高さを出し、ショート丈の位置を決める
  const probe = draftBodice(bodiceArgs, opts(0));
  const chestToWaist = probe.geom.waistY - probe.geom.chestY;
  const bodice = draftBodice(bodiceArgs, opts(hemFor(chestToWaist)));
  warnings.push(...bodice.warnings);
  const g = bodice.geom;
  const nw = g.snp.x;

  // ---- 前の V 字の襟ぐり ----
  const vY =
    p.vDepth === 'custom' && finite(p.vDepthCustom)
      ? p.vDepthCustom
      : g.chestY * { small: 0.65, normal: 0.9, large: 1.1, custom: 0.9 }[p.vDepth];
  const frontHemY = g.frontHemY;
  const vDepth = clamp(vY, g.frontNeckDepth * 0.8, frontHemY - 0.5);
  const vPt = v(0, vDepth);
  const vNeck = line(vPt, g.snp);

  const fe = bodice.front.edges;
  const iSide = fe.findIndex((e) => e.name === '脇');
  const frontMid = fe.slice(1, iSide + 1); // 肩・袖ぐり・脇
  const frontHem = fe[iSide + 1];
  const frontEdges: Edge[] = [];
  if (opening === 'front') {
    const hemSeg = frontHem.segs[0];
    frontEdges.push(
      { segs: [line(v(-openingExt, vDepth), vPt)], kind: 'seam', name: '前端（上）' },
      { segs: [vNeck], kind: 'seam', name: '襟ぐり' },
      ...frontMid,
      { ...frontHem, segs: [line(hemSeg.from, v(-openingExt, frontHemY))] },
      { segs: [line(v(-openingExt, frontHemY), v(-openingExt, vDepth))], kind: 'opening', name: '前端' },
    );
  } else {
    frontEdges.push(
      { segs: [vNeck], kind: 'seam', name: '襟ぐり' },
      ...frontMid,
      frontHem,
      { segs: [line(v(0, frontHemY), vPt)], kind: 'fold', name: '前中心（わ）' },
    );
  }
  const front: Piece = {
    ...bodice.front,
    cut: opening === 'front' ? '2枚（左右反転）' : '1枚（わ）',
    edges: frontEdges,
  };
  // ボタンの位置の印（前開きは本物、背中開きは飾り）
  const buttonMarks: Vec[][] = [];
  const btnTop = vDepth + (frontHemY - vDepth) * 0.25;
  const btnBottom = vDepth + (frontHemY - vDepth) * 0.7;
  const r0 = Math.min(0.25, openingExt * 0.3);
  for (const y of [btnTop, btnBottom]) {
    const c = v(opening === 'front' ? 0 : g.chestQ * 0.15, y);
    buttonMarks.push([v(c.x - r0, c.y), v(c.x + r0, c.y)], [v(c.x, c.y - r0), v(c.x, c.y + r0)]);
  }
  front.marks = [...(front.marks ?? []), ...buttonMarks];
  const back: Piece = { ...bodice.back };
  const pieces: Piece[] = [front, back];

  // ---- 前見返し（前開きのとき） ----
  if (opening === 'front') {
    const fw = clamp(g.chestQ * 0.3, openingExt + 0.5, g.chestQ * 0.5);
    const shoulderDir = normalize(sub(g.frontSP, g.snp));
    const shPt = add(g.snp, mul(shoulderDir, Math.min(pathLength([line(g.snp, g.frontSP)]) * 0.4, fw)));
    const innerTop = v(fw, Math.min(vDepth + fw, frontHemY - 0.2));
    pieces.push({
      id: 'front-facing',
      name: '前見返し',
      cut: '2枚（左右反転）',
      edges: [
        { segs: [line(v(-openingExt, vDepth), vPt)], kind: 'seam', name: '前端（上）' },
        { segs: [vNeck], kind: 'seam', name: '襟ぐり' },
        { segs: [line(g.snp, shPt)], kind: 'seam', name: '肩' },
        { segs: [line(shPt, innerTop), line(innerTop, v(fw, frontHemY))], kind: 'seam', name: '見返し端' },
        { segs: [line(v(fw, frontHemY), v(-openingExt, frontHemY))], kind: 'hem', name: '裾' },
        { segs: [line(v(-openingExt, frontHemY), v(-openingExt, vDepth))], kind: 'opening', name: '前端' },
      ],
      grain: [v(fw * 0.3, innerTop.y), v(fw * 0.3, frontHemY - 0.3)],
    });
  }

  // ---- セーラー襟 ----
  // 後ろ身頃の座標で作る。前身頃は、肩線が後ろの肩線と重なるよう回してから肩線で折り返す
  const backSlope = angleOf(g.snp, g.backSP);
  const toBack = frontToBack(g.snp, g.frontSP, g.backSP);
  const vInBack = toBack(vPt);
  const shoulderLen = pathLength([line(g.snp, g.backSP)]);
  const sizeK = { small: 0.75, normal: 0.9, large: 1.0, custom: 0.9 }[p.collarSize];
  const sOut = shoulderLen * sizeK;
  const S = polar(g.snp, backSlope, sOut);
  const collarDepth =
    p.collarSize === 'custom' && finite(p.collarDepthCustom)
      ? p.collarDepthCustom
      : (g.chestY - g.backNeckDepth) * { small: 0.6, normal: 0.85, large: 1.05, custom: 0.85 }[p.collarSize];
  const bottomY = g.backNeckDepth + Math.max(collarDepth, 0.5);
  const cw = S.x;
  const backNeckEdge = bodice.back.edges.find((e) => e.name === '襟ぐり')!.segs[0];
  // 角の形
  const corner = v(cw, bottomY);
  const cr = Math.min(cw, bottomY - S.y) * 0.35;
  let cornerSegs: Seg[];
  if (p.collarShape === 'round') {
    cornerSegs = [
      line(S, v(cw, bottomY - cr)),
      cubic(v(cw, bottomY - cr), v(cw, bottomY - cr * 0.45), v(cw - cr * 0.45, bottomY), v(cw - cr, bottomY)),
      line(v(cw - cr, bottomY), v(0, bottomY)),
    ];
  } else if (p.collarShape === 'cut') {
    cornerSegs = [line(S, v(cw, bottomY - cr)), line(v(cw, bottomY - cr), v(cw - cr, bottomY)), line(v(cw - cr, bottomY), v(0, bottomY))];
  } else {
    cornerSegs = [line(S, corner), line(corner, v(0, bottomY))];
  }
  const collarCB = opening === 'back';
  const collar: Piece = {
    id: 'collar',
    name: 'セーラー襟',
    cut: collarCB ? '4枚（左右反転・表襟と裏襟）' : '2枚（わ・表襟と裏襟）',
    edges: [
      { segs: [backNeckEdge], kind: 'seam', name: '襟ぐり（後ろ）' },
      { segs: [line(g.snp, vInBack)], kind: 'seam', name: '襟ぐり（前）' },
      { segs: [line(vInBack, S)], kind: 'seam', name: '襟の外まわり（前）' },
      { segs: cornerSegs, kind: 'seam', name: '襟の外まわり' },
      {
        segs: [line(v(0, bottomY), v(0, g.backNeckDepth))],
        kind: collarCB ? 'seam' : 'fold',
        name: collarCB ? '後ろ中心' : '後ろ中心（わ）',
      },
    ],
    grain: [v(cw * 0.3, g.backNeckDepth + (bottomY - g.backNeckDepth) * 0.3), v(cw * 0.3, bottomY - (bottomY - g.backNeckDepth) * 0.15)],
  };
  // ラインテープの目安（外まわりから内側へ 2 本）
  const outer = flatten([line(vInBack, S), ...cornerSegs], 12);
  const center = v(nw * 0.5, (g.backNeckDepth + bottomY) / 2);
  const collarW = Math.min(bottomY - g.backNeckDepth, cw - nw);
  collar.marks = [insetPolyline(outer, collarW * 0.12, center), insetPolyline(outer, collarW * 0.2, center)];
  pieces.push(collar);

  // ---- 袖 ----
  const frontAH = pathLength(bodice.frontArmhole);
  const backAH = pathLength(bodice.backArmhole);
  const armLen = val('arm_length');
  const cuffH = p.cuff ? clamp(armLen * (p.sleeve === 'long' ? 0.12 : 0.08), 0.6, 3) : 0;
  const totalRatio = p.sleeve === 'long' ? 1.0 : 0.45;
  const sleeve = draftSleeve({
    frontArmholeLength: frontAH,
    backArmholeLength: backAH,
    upperArm: val('upper_arm_circ'),
    armEase: ease.arm,
    armLength: armLen,
    lengthRatio: Math.max(0.15, totalRatio - cuffH / armLen),
    widthRatio: woven ? 0.75 : 0.88,
    capEase: woven ? 0.03 : 0,
    hemRatio: p.sleeve === 'long' ? 0.75 : 1.0,
    minPass: val('elbow_pass_circ') + ease.pass,
    extraWidth: 0,
  });
  warnings.push(...sleeve.warnings);
  pieces.push(sleeve.piece);
  const hem = sleeve.piece.edges.find((e) => e.kind === 'hem')!.segs[0];
  const hemW = Math.abs(hem.to.x - hem.from.x);
  if (p.cuff) {
    // カフスを付けるので、袖口は縫い代（hem）ではなく縫い合わせ（seam）
    sleeve.piece.edges = sleeve.piece.edges.map((e) => (e.kind === 'hem' ? { ...e, kind: 'seam', name: '袖口（カフス付け）' } : e));
    pieces.push({
      id: 'cuff',
      name: 'カフス（高さ方向に二つ折り）',
      cut: '2枚',
      edges: [
        { segs: [line(v(0, 0), v(hemW, 0))], kind: 'seam', name: '袖口側' },
        { segs: [line(v(hemW, 0), v(hemW, cuffH * 2))], kind: 'seam', name: '端' },
        { segs: [line(v(hemW, cuffH * 2), v(0, cuffH * 2))], kind: 'seam', name: '袖口側' },
        { segs: [line(v(0, cuffH * 2), v(0, 0))], kind: 'seam', name: '端' },
      ],
      grain: [v(hemW * 0.5, cuffH * 1.7), v(hemW * 0.5, cuffH * 0.3)],
    });
  }

  // ---- スカーフ ----
  const neck = val('neck_circ');
  if (p.scarf === 'triangle') {
    const L = neck * 2.4;
    pieces.push({
      id: 'scarf',
      name: 'スカーフ（三角）',
      cut: '1枚（バイアスになる向き）',
      edges: [
        { segs: [line(v(0, 0), v(L, 0))], kind: 'hem', name: '長い辺' },
        { segs: [line(v(L, 0), v(L / 2, L / 2))], kind: 'hem', name: '短い辺' },
        { segs: [line(v(L / 2, L / 2), v(0, 0))], kind: 'hem', name: '短い辺' },
      ],
      grain: [v(L * 0.38, L * 0.12), v(L * 0.5, L * 0.24)],
    });
  } else {
    const L = neck * 2.6;
    const W = clamp(neck * 0.28, 0.8, 6);
    pieces.push({
      id: 'scarf',
      name: 'スカーフ（長方形）',
      cut: '1枚',
      edges: [
        { segs: [line(v(0, 0), v(L, 0))], kind: 'hem', name: '縁' },
        { segs: [line(v(L, 0), v(L, W))], kind: 'hem', name: '端' },
        { segs: [line(v(L, W), v(0, W))], kind: 'hem', name: '縁' },
        { segs: [line(v(0, W), v(0, 0))], kind: 'hem', name: '端' },
      ],
      grain: [v(L * 0.3, W * 0.5), v(L * 0.7, W * 0.5)],
    });
  }

  // ---- 裏地 ----
  if (p.lining) {
    pieces.push(
      { ...front, id: 'front-lining', name: '前身頃（裏地）', cut: opening === 'front' ? '2枚（左右反転・裏地）' : '1枚（わ・裏地）', marks: front.marks?.filter((m) => !buttonMarks.includes(m)) },
      { ...back, id: 'back-lining', name: '後ろ身頃（裏地）', cut: opening === 'back' ? '2枚（左右反転・裏地）' : '1枚（わ・裏地）' },
    );
  }

  const neckLen = pathLength([vNeck]) + pathLength([backNeckEdge]);
  const collarNeck = pathLength([backNeckEdge]) + pathLength([line(g.snp, vInBack)]);
  info.push(
    `${opening === 'front' ? '前開き（重なり ' + fmt(openingExt) + 'cm・ボタン 2 つ）' : '背中開き（前のボタンは飾り）'}`,
    `着丈 前 ${fmt(frontHemY - vDepth)}cm（V の先から）／ 胸のゆとり ${fmt(ease.chest)}cm`,
    `襟ぐり（半身）${fmt(neckLen)}cm ／ 襟の付け側 ${fmt(collarNeck)}cm ／ 後ろ襟の深さ ${fmt(bottomY - g.backNeckDepth)}cm`,
    `袖ぐり ${fmt(frontAH + backAH)}cm ／ 袖山 ${fmt(sleeve.capLength)}cm ／ 袖口 ${fmt(hemW)}cm${p.cuff ? `（カフスの高さ ${fmt(cuffH)}cm）` : ''}`,
  );
  if (sleeve.widenedHem || sleeve.widenedWidth) info.push('肘が通るように袖口を広げました');
  if (g.dartApplied) info.push(`胸ダーツ ${fmt(g.bustDelta)}cm（前丈と背丈の差）`);
  info.push('襟の中の 2 本の線は、ラインテープを付ける位置の目安です');
  info.push(`カテゴリ ${r.category ?? '未分類'}${r.categoryGuessed ? '（仮）' : ''}`);
  return { pieces, warnings, info, refs: { fit: ease.chest, length: hemFor(chestToWaist), vDepth: vY, collarSize: collarDepth, ...(opening === 'back' ? { extWidth: openingExt } : {}) } };
}
