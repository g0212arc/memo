// Yシャツ = 身頃原型（首に沿う襟ぐり）＋ 襟 ＋ 袖（長袖はカフス付き）＋ ヨーク・胸ポケット（選べる）。
// 前開き: 前に重なりを付け、襟はシャツ襟なら台襟＋上襟。
// 背中開き: 前は飾りの前立てとボタンの印だけ。シャツ襟は台襟なしの 1 枚襟（厚みを減らすため）。

import { Vec, v, add, mul, normalize, sub } from '../../geometry/vec';
import { cubic, flatten, line, pathLength, Seg } from '../../geometry/path';
import { frontToBack, insetPolyline, mapSegs, splitSegsAtY } from '../../geometry/transform';
import { ResolvedBody } from '../../model/estimate';
import { MeasurementKey } from '../../model/schema';
import { CATEGORY_EASE } from '../../model/category';
import { draftBodice } from '../bodice';
import { useBustDart } from '../bust';
import { draftSleeve } from '../sleeve';
import { defaultEase, scaleEase } from '../ease';
import { applyFit, Fit } from '../fit';
import { extMarks, ExtParams, OpeningChoice, openingExtOf, resolveOpening } from '../opening';
import { DraftResult, Edge, EdgeKind, Fabric, Piece } from '../types';
import { MissingMeasurementsError } from './tshirt';

export type ShirtLength = 'short' | 'normal' | 'long' | 'custom';
export type ShirtCollar = 'shirt' | 'round' | 'stand';

export interface YshirtParams extends ExtParams {
  fabric: Fabric;
  stretch: number;
  bustDart: boolean;
  opening: OpeningChoice;
  fit: Fit | 'custom';
  chestEaseCustom: number | null;
  length: ShirtLength;
  /** length が custom のときの着丈（ウエストから下へ cm） */
  lengthCustom: number | null;
  hem: 'straight' | 'tail';
  collar: ShirtCollar;
  sleeve: 'long' | 'half';
  yoke: boolean;
  pocket: boolean;
  /** 裾がウエストのとき脇をウエストに向けて細くする（ブラウスワンピースの身頃用。画面には出さない） */
  waistTaper?: boolean;
}

export const DEFAULT_YSHIRT: YshirtParams = {
  fabric: 'woven',
  stretch: 20,
  bustDart: true,
  opening: 'auto',
  fit: 'normal',
  chestEaseCustom: null,
  length: 'normal',
  lengthCustom: null,
  hem: 'tail',
  collar: 'shirt',
  sleeve: 'long',
  yoke: true,
  pocket: true,
};

export const SHIRT_LENGTH_LABEL: Record<ShirtLength, string> = {
  short: '短め（腰の上）',
  normal: '普通（腰まで）',
  long: '長め（お尻が隠れる）',
  custom: '自分で入力',
};
export const SHIRT_COLLAR_LABEL: Record<ShirtCollar, string> = { shirt: 'シャツ襟', round: '丸襟', stand: 'スタンドカラー' };

export const YSHIRT_REQUIREMENTS: { key: MeasurementKey; hard: boolean }[] = [
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

const fmt = (x: number) => (Math.round(x * 10) / 10).toFixed(1);
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const finite = (x: number | null): x is number => x !== null && Number.isFinite(x);
const polyline = (pts: Vec[]): Seg[] => pts.slice(1).map((q, i) => line(pts[i], q));

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

/** 曲線の長さが target になるよう、横幅 L を合わせる */
function fitLength(target: number, build: (L: number) => Seg[]): number {
  let L = target;
  for (let i = 0; i < 8; i++) L *= target / pathLength(build(L));
  return L;
}

export function draftYshirt(r: ResolvedBody, p: YshirtParams): DraftResult {
  const missing = YSHIRT_REQUIREMENTS.filter((q) => r.values[q.key] === undefined).map((q) => q.key);
  if (missing.length > 0) throw new MissingMeasurementsError(missing);
  const val = (k: MeasurementKey) => r.values[k] as number;
  const woven = p.fabric === 'woven';
  const warnings: string[] = [];
  const info: string[] = [];
  const opening = resolveOpening(r.category, p.opening);
  const front_open = opening === 'front';

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
  if (p.fit === 'custom' && finite(p.chestEaseCustom)) ease.chest = p.chestEaseCustom;

  const pw = clamp(chest * 0.04, 0.5, 1.2); // 前立て（重なり）の幅
  const hemBelowWaist =
    p.length === 'custom' && finite(p.lengthCustom) ? p.lengthCustom : wth * { short: 0.3, normal: 0.9, long: 1.4, custom: 0.9 }[p.length];
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
      neckWiden: 0.02,
      frontNeckDrop: 0,
      frontNeckDepthRatio: 1.0,
      shoulderExtend: 0,
      hemBelowWaist,
      armholeEase: ease.armhole,
      backOpening: !front_open,
      // 背中開きの持ち出しは「持ち出しの幅」から（前開きは前立ての幅）
      openingExt: front_open ? pw : openingExtOf(p, chest),
      bustDart: useBustDart(r, p),
      waistTaper: p.waistTaper,
    },
  );
  warnings.push(...bodice.warnings);
  const g = bodice.geom;

  // ---- 裾（シャツテールは脇を上げて丸くする） ----
  // 前後で脇の長さがそろうよう、上げる量は後ろの裾から決めて前後同じにする
  const up = p.hem === 'tail' ? Math.min(wth * 0.35, (g.backHemY - g.chestY) * 0.35) : 0;
  const shapeHem = (side: Edge, hemY: number, endX: number): { side: Edge; hem: Edge } => {
    const sideEnd = side.segs[side.segs.length - 1].to;
    if (up < 0.05) return { side, hem: { segs: [line(sideEnd, v(endX, hemY))], kind: 'hem', name: '裾' } };
    // 脇の下端（前は胸ダーツなしだと裾の前中心より上）から上げる
    const [above] = splitSegsAtY(side.segs, sideEnd.y - up);
    const s = above[above.length - 1].to;
    const curve = cubic(s, v(s.x * 0.9, hemY - up * 0.15), v(s.x * 0.45, hemY), v(Math.max(0, endX), hemY));
    const segs: Seg[] = endX < 0 ? [curve, line(v(0, hemY), v(endX, hemY))] : [curve];
    return { side: { ...side, segs: above }, hem: { segs, kind: 'hem', name: '裾' } };
  };

  // ---- 前身頃 ----
  const fe = bodice.front.edges;
  const fNeck = fe.find((e) => e.name === '襟ぐり')!;
  const fShoulder = fe.find((e) => e.name === '肩')!;
  const fArm = fe.find((e) => e.name === '袖ぐり')!;
  const fSide0 = fe.find((e) => e.name === '脇')!;
  const fHemY = g.frontHemY;
  const fnd = g.frontNeckDepth;
  const fShaped = shapeHem(fSide0, fHemY, front_open ? -pw : 0);
  const frontEdges: Edge[] = front_open
    ? [
        { segs: [line(v(-pw, fnd), v(0, fnd))], kind: 'seam', name: '襟ぐり（前立て）' },
        fNeck,
        fShoulder,
        fArm,
        fShaped.side,
        fShaped.hem,
        { segs: [line(v(-pw, fHemY), v(-pw, fnd))], kind: 'opening', name: '前端' },
      ]
    : [fNeck, fShoulder, fArm, fShaped.side, fShaped.hem, { segs: [line(v(0, fHemY), v(0, fnd))], kind: 'fold', name: '前中心（わ）' }];
  const front: Piece = { ...bodice.front, cut: front_open ? '2枚（左右反転）' : '1枚（わ）', edges: frontEdges };
  // ボタンの印
  const btnLen = fHemY - fnd;
  const nBtn = clamp(Math.round(btnLen / Math.max(chest * 0.11, 0.8)), 3, 7);
  const r0 = Math.min(0.2, pw * 0.3);
  const marks: Vec[][] = [...(front.marks ?? [])];
  for (let i = 0; i < nBtn; i++) {
    const y = fnd + pw * 0.8 + ((btnLen - pw * 0.8 - fHemY * 0.06) * i) / Math.max(1, nBtn - 1);
    marks.push([v(-r0, y), v(r0, y)], [v(0, y - r0), v(0, y + r0)]);
  }
  // 胸ポケットの位置（左前）
  const pocketW = g.chestQ * 0.36;
  const pocketH = pocketW * 1.15;
  const pocketX = g.chestQ * 0.3;
  const pocketY = g.chestY - (g.chestY - g.frontSP.y) * 0.15;
  if (p.pocket) {
    marks.push([v(pocketX, pocketY), v(pocketX + pocketW, pocketY), v(pocketX + pocketW, pocketY + pocketH), v(pocketX, pocketY + pocketH), v(pocketX, pocketY)]);
  }
  front.marks = marks;
  const pieces: Piece[] = [front];

  // ---- 後ろ身頃（ヨークで切り替え） ----
  const be = bodice.back.edges;
  const bExt = be.find((e) => e.name === '襟ぐり（持ち出し）');
  const bNeck = be.find((e) => e.name === '襟ぐり')!;
  const bShoulder = be.find((e) => e.name === '肩')!;
  const bArm = be.find((e) => e.name === '袖ぐり')!;
  const bSide0 = be.find((e) => e.name === '脇')!;
  const bCB = be[be.length - 1];
  const cbX = bCB.segs[0].from.x;
  const bHemY = g.backHemY;
  const bShaped = shapeHem(bSide0, bHemY, cbX);
  const backGrain = bodice.back.grain;
  if (p.yoke) {
    const yokeY = Math.max(g.backNeckDepth + 0.3, g.backSP.y + (g.chestY - g.backSP.y) * 0.35);
    const [armUp, armDown] = splitSegsAtY(bArm.segs, yokeY);
    const A = armUp[armUp.length - 1].to;
    const cbKind = bCB.kind;
    pieces.push({
      id: 'yoke',
      name: 'ヨーク',
      cut: front_open ? '2枚（わ・表と裏）' : '4枚（左右反転・表と裏）',
      edges: [
        ...(bExt ? [bExt] : []),
        bNeck,
        bShoulder,
        { segs: armUp, kind: 'seam', name: '袖ぐり' },
        { segs: [line(A, v(cbX, yokeY))], kind: 'seam', name: 'ヨーク切り替え' },
        { segs: [line(v(cbX, yokeY), v(cbX, g.backNeckDepth))], kind: cbKind, name: bCB.name },
      ],
      grain: [v(g.chestQ * 0.4, g.backNeckDepth + (yokeY - g.backNeckDepth) * 0.25), v(g.chestQ * 0.4, yokeY - (yokeY - g.backNeckDepth) * 0.15)],
      ...(front_open ? {} : extMarks(g.backNeckDepth, yokeY, -cbX)),
    });
    pieces.push({
      ...bodice.back,
      edges: [
        { segs: [line(v(cbX, yokeY), A)], kind: 'seam', name: 'ヨーク切り替え' },
        { segs: armDown, kind: 'seam', name: '袖ぐり' },
        bShaped.side,
        bShaped.hem,
        { segs: [line(v(cbX, bHemY), v(cbX, yokeY))], kind: cbKind, name: bCB.name },
      ],
      grain: [v(backGrain[0].x, Math.max(backGrain[0].y, yokeY + 0.3)), backGrain[1]],
      ...(front_open ? { marks: undefined, notes: undefined } : extMarks(yokeY, bHemY, -cbX)),
    });
  } else {
    pieces.push({
      ...bodice.back,
      edges: [...(bExt ? [bExt] : []), bNeck, bShoulder, bArm, bShaped.side, bShaped.hem, { ...bCB, segs: [line(v(cbX, bHemY), v(cbX, g.backNeckDepth))] }],
    });
  }

  // ---- 前立て（背中開きのときは飾り） ----
  if (!front_open) {
    pieces.push(rectPiece('placket', '前立て（飾り。前中心に縫い付ける）', '1枚', pw * 2, btnLen, ['seam', 'seam', 'hem', 'seam'], ['襟ぐり側', '端', '裾', '端']));
  }

  // ---- 襟 ----
  const neckHalf = bodice.backNeckLength + bodice.frontNeckLength;
  const sh = clamp(val('neck_length') * 0.45, 0.4, 1.3); // 台襟の高さ
  const collarCB = front_open; // 後ろ中心がわ（前開きのとき）
  const layerCut = (n: number) => (collarCB ? `${n}枚（わ・表と裏）` : `${n * 2}枚（左右反転・表と裏）`);
  const cbEdge = (top: Vec, bottom: Vec): Edge =>
    collarCB ? { segs: [line(top, bottom)], kind: 'fold', name: '後ろ中心（わ）' } : { segs: [line(top, bottom)], kind: 'seam', name: '後ろ端' };

  /** 台襟: 前開きは前に重なり分を延ばし、前に向けて少し上がる形。背中開きは前中心がわの長方形 */
  const standPiece = (name: string): { piece: Piece; topLen: number } => {
    if (!front_open) {
      const ext = pw * 0.6;
      const L = neckHalf + ext;
      return {
        piece: {
          id: 'stand',
          name,
          cut: '4枚（左右反転・表と裏）',
          edges: [
            { segs: [line(v(0, sh), v(L, sh))], kind: 'seam', name: '襟付け' },
            { segs: [line(v(L, sh), v(L, 0))], kind: 'seam', name: '後ろ端' },
            { segs: [line(v(L, 0), v(0, 0))], kind: 'seam', name: '上端' },
            { segs: [line(v(0, 0), v(0, sh))], kind: 'fold', name: '前中心（わ）' },
          ],
          grain: [v(L * 0.2, sh * 0.5), v(L * 0.8, sh * 0.5)],
        },
        topLen: neckHalf,
      };
    }
    const rise = sh * 0.5;
    const lower = (L: number) => [cubic(v(0, sh), v(L * 0.5, sh), v(L * 0.8, sh - rise * 0.4), v(L, sh - rise))];
    const L = fitLength(neckHalf + pw, lower);
    const tip = v(L - sh * 0.2, -rise);
    const top = cubic(tip, v(L * 0.8 - sh * 0.2, -rise * 0.4), v(L * 0.5, 0), v(0, 0));
    return {
      piece: {
        id: 'stand',
        name,
        cut: '2枚（わ・表と裏）',
        edges: [
          { segs: lower(L), kind: 'seam', name: '襟付け' },
          { segs: [cubic(v(L, sh - rise), v(L + sh * 0.3, sh - rise - sh * 0.3), v(L + sh * 0.05, -rise), tip)], kind: 'seam', name: '前端' },
          { segs: [top], kind: 'seam', name: '上端' },
          cbEdge(v(0, 0), v(0, sh)),
        ],
        grain: [v(L * 0.2, sh * 0.4), v(L * 0.7, sh * 0.4)],
      },
      topLen: pathLength([top]) - sh * 0.1,
    };
  };

  if (p.collar === 'stand') {
    const st = standPiece('スタンドカラー');
    st.piece.edges = st.piece.edges.map((e) => (e.name === '上端' ? { ...e, name: '襟の上端' } : e));
    pieces.push(st.piece);
    info.push(`スタンドカラー 高さ ${fmt(sh)}cm`);
  } else if (p.collar === 'shirt' && front_open) {
    // 台襟 ＋ 上襟
    const st = standPiece('台襟');
    st.piece.edges = st.piece.edges.map((e) => (e.name === '上端' ? { ...e, name: '上襟付け' } : e));
    pieces.push(st.piece);
    const ch = sh * 1.6;
    const r1 = sh * 0.3;
    const neckEdge = (L: number) => [cubic(v(0, 0), v(L * 0.5, 0), v(L * 0.8, -r1 * 0.4), v(L, -r1))];
    const Lc = fitLength(Math.max(st.topLen - pw, neckHalf * 0.95), neckEdge);
    const P = v(Lc + ch * 0.45, -r1 - ch * 1.15);
    pieces.push({
      id: 'collar',
      name: '上襟',
      cut: '2枚（わ・表と裏）',
      edges: [
        { segs: neckEdge(Lc), kind: 'seam', name: '台襟付け' },
        { segs: [line(v(Lc, -r1), P)], kind: 'seam', name: '襟先' },
        { segs: [cubic(P, v(Lc * 0.7, -ch * 1.05 - r1 * 0.5), v(Lc * 0.3, -ch), v(0, -ch))], kind: 'seam', name: '外まわり' },
        { segs: [line(v(0, -ch), v(0, 0))], kind: 'fold', name: '後ろ中心（わ）' },
      ],
      grain: [v(Lc * 0.15, -ch * 0.2), v(Lc * 0.15, -ch * 0.8)],
    });
    info.push(`台襟 高さ ${fmt(sh)}cm ／ 上襟 後ろの幅 ${fmt(ch)}cm`);
  } else if (p.collar === 'shirt') {
    // 背中開き: 台襟なしの 1 枚襟（前中心から後ろ端まで）
    const H = sh * 2.2;
    const L = neckHalf + pw * 0.6;
    const P = v(H * 0.15, -H * 1.2);
    pieces.push({
      id: 'collar',
      name: 'シャツ襟（台襟なし）',
      cut: '4枚（左右反転・表と裏）',
      edges: [
        { segs: [line(v(0, 0), v(L, 0))], kind: 'seam', name: '襟付け' },
        { segs: [line(v(L, 0), v(L, -H))], kind: 'seam', name: '後ろ端' },
        { segs: [cubic(v(L, -H), v(L * 0.6, -H), v(L * 0.25, -H * 1.05), P)], kind: 'seam', name: '外まわり' },
        { segs: [line(P, v(0, 0))], kind: 'seam', name: '襟先' },
      ],
      grain: [v(L * 0.2, -H * 0.4), v(L * 0.8, -H * 0.4)],
    });
    info.push(`1 枚襟 幅 ${fmt(H)}cm（台襟なし）`);
  } else {
    // 丸襟: 前後の身頃を肩で合わせて、襟ぐりに沿って引く
    const toBack = frontToBack(g.snp, g.frontSP, g.backSP, 10);
    const frontNeckToCF = bodice.front.edges.find((e) => e.name === '襟ぐり')!.segs.map((s) => s); // CF → SNP
    const mappedFront = mapSegs(frontNeckToCF, toBack); // CF' → SNP（後ろの座標）
    const neckPts = [...flatten(bNeck.segs, 24), ...flatten(mappedFront, 24).reverse().slice(1)]; // CB → SNP → CF'
    const w = clamp(val('neck_circ') * 0.16, 0.6, 3);
    const cx = neckPts.reduce((a, q) => a + q.x, 0) / neckPts.length;
    const cy = neckPts.reduce((a, q) => a + q.y, 0) / neckPts.length;
    const outer = insetPolyline(neckPts, -w, v(cx, cy));
    const cf = neckPts[neckPts.length - 1];
    const oEnd = outer[outer.length - 1];
    const t = normalize(sub(oEnd, outer[outer.length - 2]));
    const endCurve = cubic(cf, add(cf, mul(t, w * 0.55)), add(oEnd, mul(t, w * 0.55)), oEnd);
    const oStart = v(0, outer[0].y);
    const outerRev = [...outer.slice(1)].reverse();
    pieces.push({
      id: 'collar',
      name: '丸襟',
      cut: layerCut(2),
      edges: [
        { segs: polyline(neckPts), kind: 'seam', name: '襟付け' },
        { segs: [endCurve], kind: 'seam', name: '襟先' },
        { segs: polyline([oEnd, ...outerRev.slice(1), oStart]), kind: 'seam', name: '外まわり' },
        cbEdge(oStart, neckPts[0]),
      ],
      grain: [v(w * 0.3, neckPts[0].y + w * 0.2), v(w * 0.3, neckPts[0].y + w * 0.8)],
    });
    info.push(`丸襟 幅 ${fmt(w)}cm`);
  }

  // ---- 袖 ----
  const frontAH = pathLength(bodice.frontArmhole);
  const backAH = pathLength(bodice.backArmhole);
  const armLen = val('arm_length');
  const long = p.sleeve === 'long';
  const cuffH = long ? clamp(armLen * 0.12, 0.6, 3) : 0;
  const sleeve = draftSleeve({
    frontArmholeLength: frontAH,
    backArmholeLength: backAH,
    upperArm: val('upper_arm_circ'),
    armEase: ease.arm,
    armLength: armLen,
    lengthRatio: long ? 1.0 - cuffH / armLen : 0.4,
    widthRatio: woven ? 0.75 : 0.88,
    capEase: woven ? 0.03 : 0,
    hemRatio: long ? 0.75 : 0.95,
    minPass: val('elbow_pass_circ') + ease.pass,
    extraWidth: 0,
  });
  warnings.push(...sleeve.warnings);
  pieces.push(sleeve.piece);
  const hemSeg = sleeve.piece.edges.find((e) => e.kind === 'hem')!.segs[0];
  const hemW = Math.abs(hemSeg.to.x - hemSeg.from.x);
  if (long) {
    sleeve.piece.edges = sleeve.piece.edges.map((e) => (e.kind === 'hem' ? { ...e, kind: 'seam', name: '袖口（カフス付け）' } : e));
    pieces.push(rectPiece('cuff', 'カフス（高さ方向に二つ折り）', '2枚', hemW, cuffH * 2, ['seam', 'seam', 'seam', 'seam'], ['袖口側', '端', '袖口側', '端']));
  }

  // ---- 胸ポケット ----
  if (p.pocket) {
    pieces.push(rectPiece('pocket', '胸ポケット', '1枚', pocketW, pocketH, ['hem', 'seam', 'seam', 'seam'], ['ポケット口', '脇', '底', '脇']));
  }

  info.unshift(front_open ? `前開き（前立て ${fmt(pw)}cm・ボタン ${nBtn} 個）` : `背中開き（前は飾りの前立てとボタン ${nBtn} 個）`);
  info.push(
    `胸のゆとり ${fmt(ease.chest)}cm ／ 襟ぐり（半身）${fmt(neckHalf)}cm`,
    `袖ぐり ${fmt(frontAH + backAH)}cm ／ 袖山 ${fmt(sleeve.capLength)}cm ／ 袖口 ${fmt(hemW)}cm${long ? `（カフスの高さ ${fmt(cuffH)}cm）` : ''}`,
  );
  if (sleeve.widenedHem || sleeve.widenedWidth) info.push('肘が通るように袖口を広げました');
  if (g.dartApplied) info.push(`胸ダーツ ${fmt(g.bustDelta)}cm（前丈と背丈の差）`);
  info.push(`カテゴリ ${r.category ?? '未分類'}${r.categoryGuessed ? '（仮）' : ''}`);
  return { pieces, warnings, info };
}
