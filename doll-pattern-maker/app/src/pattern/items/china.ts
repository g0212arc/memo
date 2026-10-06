// チャイナ服（トップス／スリットドレス）。布帛で体に沿わせる。
// 身頃原型の丈を延ばし、脇を「胸 → ウエスト（絞る）→ ヒップ → 裾」に引き直す。ウエストの絞りは脇と、ウエストのダーツ（印）で分ける。
// 前の打ち合わせは見た目だけ: 前は「わ」で裁ち、斜めの飾り線を印で描く。実際は背中で開ける（ドレスはヒップまで開き、その下は縫う）。
// 襟は立ち襟（前中心で突き合わせ、前の角を丸く）。

import { Vec, v, add, mul, polar, dist } from '../../geometry/vec';
import { CubicSeg, Seg, cubic, line, pathLength } from '../../geometry/path';
import { ResolvedBody } from '../../model/estimate';
import { MeasurementKey } from '../../model/schema';
import { CATEGORY_EASE } from '../../model/category';
import { draftBodice } from '../bodice';
import { extMarks, openingExtOf } from '../opening';
import { useBustDart } from '../bust';
import { defaultEase, scaleEase } from '../ease';
import { applyFit, Fit } from '../fit';
import { draftSleeve } from '../sleeve';
import { DraftResult, Edge, Fabric, Piece } from '../types';
import { MissingMeasurementsError, TSHIRT_REQUIREMENTS } from './tshirt';
import { SKIRT_REQUIREMENTS, skirtBase } from './skirt';

export type ChinaLength = 'top' | 'knee' | 'midi' | 'ankle' | 'custom';
export type ChinaSleeve = 'none' | 'french' | 'short' | 'long' | 'custom';
export type ChinaSlit = 'low' | 'normal' | 'deep' | 'custom';
export type ChinaCollar = 'low' | 'normal' | 'high' | 'custom';

export interface ChinaParams {
  /** 布帛で固定（胸ダーツの判定に使う） */
  fabric: Fabric;
  bustDart: boolean;
  fitBody: Fit;
  fitSleeve: Fit;
  length: ChinaLength;
  /** length が custom のときの丈（ウエストから裾まで cm） */
  lengthCustom: number | null;
  /** ドレスのスリットの深さ */
  slit: ChinaSlit;
  /** slit が custom のときのスリットの長さ（裾から cm） */
  slitCustom: number | null;
  /** トップスの脇に短いスリットを入れる */
  topSlit: boolean;
  sleeve: ChinaSleeve;
  /** sleeve が custom のときの袖丈（肩先から cm） */
  sleeveCustom: number | null;
  collar: ChinaCollar;
  /** collar が custom のときの襟の高さ（cm） */
  collarCustom: number | null;
  /** ドレスの裾: まっすぐ／少しすぼめる */
  hem: 'straight' | 'taper';
}

export const DEFAULT_CHINA: ChinaParams = {
  fabric: 'woven',
  bustDart: true,
  fitBody: 'normal',
  fitSleeve: 'normal',
  length: 'knee',
  lengthCustom: null,
  slit: 'normal',
  slitCustom: null,
  topSlit: true,
  sleeve: 'none',
  sleeveCustom: null,
  collar: 'normal',
  collarCustom: null,
  hem: 'straight',
};

export const CHINA_LENGTH_LABEL: Record<ChinaLength, string> = {
  top: 'トップス（腰丈）',
  knee: 'ドレス：膝丈',
  midi: 'ドレス：ミモレ',
  ankle: 'ドレス：足首',
  custom: 'ドレス：自分で入力',
};
export const CHINA_SLEEVE_LABEL: Record<ChinaSleeve, string> = {
  none: 'ノースリーブ',
  french: 'フレンチ袖（肩先が少し隠れる）',
  short: '半袖',
  long: '長袖',
  custom: '自分で入力',
};
export const CHINA_SLIT_LABEL: Record<ChinaSlit, string> = { low: '浅め（膝の上）', normal: '普通（太ももの中ほど）', deep: '深め', custom: '自分で入力' };
export const CHINA_COLLAR_LABEL: Record<ChinaCollar, string> = { low: '低め', normal: '普通', high: '高め', custom: '自分で入力' };
export const chinaIsDress = (p: { length: ChinaLength }) => p.length !== 'top';
export const chinaHasSleeve = (p: { sleeve: ChinaSleeve }) => p.sleeve !== 'none' && p.sleeve !== 'french';

export const CHINA_REQUIREMENTS: { key: MeasurementKey; hard: boolean }[] = [
  ...TSHIRT_REQUIREMENTS,
  ...SKIRT_REQUIREMENTS.filter((q) => !TSHIRT_REQUIREMENTS.some((t) => t.key === q.key)),
  { key: 'neck_length', hard: false },
];

const fmt = (x: number) => (Math.round(x * 10) / 10).toFixed(1);
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const finite = (x: number | null): x is number => x !== null && Number.isFinite(x);
const polyline = (pts: Vec[]): Seg[] => pts.slice(1).map((q, i) => line(pts[i], q));

/** 折れ線で、高さ y のときの x */
function xAtY(pts: Vec[], y: number): number {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (y <= b.y + 1e-9 || i === pts.length - 1) {
      if (Math.abs(b.y - a.y) < 1e-9) return b.x;
      const t = clamp((y - a.y) / (b.y - a.y), 0, 1);
      return a.x + (b.x - a.x) * t;
    }
  }
  return pts[pts.length - 1].x;
}
/** 折れ線を高さ y で上下に分ける */
function splitAtY(pts: Vec[], y: number): [Vec[], Vec[]] {
  const m = v(xAtY(pts, y), y);
  return [[...pts.filter((q) => q.y < y - 1e-9), m], [m, ...pts.filter((q) => q.y > y + 1e-9)]];
}

export function draftChina(r: ResolvedBody, p: ChinaParams): DraftResult {
  const missing = CHINA_REQUIREMENTS.filter((q) => r.values[q.key] === undefined).map((q) => q.key);
  if (missing.length > 0) throw new MissingMeasurementsError(missing);
  const val = (k: MeasurementKey) => r.values[k] as number;
  const warnings: string[] = [];
  const info: string[] = [];
  const dress = chinaIsDress(p);
  const sleeveless = p.sleeve === 'none' || p.sleeve === 'french';

  const categoryEase = r.category ? CATEGORY_EASE[r.category] : 1;
  const ease = applyFit(
    scaleEase(
      defaultEase('woven', { chest: val('chest_circ'), hip: val('hip_circ'), upperArm: val('upper_arm_circ'), armhole: val('armhole_circ') }),
      categoryEase,
    ),
    p.fitBody,
    p.fitSleeve,
  );
  // 袖なし・フレンチ袖は袖ぐりを体に沿わせる
  if (sleeveless) ease.armhole *= 0.5;

  // 丈（ドレスはスカートと同じ高さの決め方）
  const sb = skirtBase(r, p.length === 'top' ? 'knee' : p.length, p.lengthCustom);
  const wh = val('waist_to_hip');
  const hemBelowWaist = dress ? sb.length : wh * 0.8;
  warnings.push(...(dress ? sb.warnings : []));

  const chest = val('chest_circ');
  const shoulder = val('shoulder_width');
  const openingExt = openingExtOf(p, chest); // 持ち出しの幅（片側）
  const bodice = draftBodice(
    {
      chest,
      waist: val('waist_circ'),
      hip: val('hip_circ'),
      neck: val('neck_circ'),
      shoulder,
      backLength: val('back_length'),
      frontLength: val('front_length'),
      armhole: val('armhole_circ'),
      waistToHip: wh,
    },
    {
      ease,
      woven: true,
      // 立ち襟なので首に沿わせる
      neckWiden: 0,
      frontNeckDrop: 0,
      frontNeckDepthRatio: 0.85,
      shoulderExtend: p.sleeve === 'none' ? -shoulder * 0.06 : 0,
      hemBelowWaist,
      armholeEase: ease.armhole,
      backOpening: true,
      bustDart: useBustDart(r, p),
      openingExt,
    },
  );
  warnings.push(...bodice.warnings);
  const g = bodice.geom;

  // ---- 脇の線（後ろ）: 胸 → ウエスト → ヒップ → 裾 ----
  const chestQ = g.chestQ;
  const hipQ = Math.max(chestQ * 0.9, (val('hip_circ') + ease.hip) / 4);
  const waistQ = Math.min(chestQ, hipQ, (val('waist_circ') + ease.hip * 0.8) / 4);
  const reduce = Math.max(0, Math.min(chestQ, hipQ) - waistQ);
  const sideTake = reduce <= 0.3 ? reduce : reduce * 0.5;
  const dartW = reduce - sideTake; // ウエストのダーツの幅（片側 1 本）
  const sideWaistX = Math.min(chestQ, hipQ) - sideTake;
  const hipY = g.waistY + wh;
  const bHemY = g.backHemY;
  const hemQ = dress && p.hem === 'taper' ? Math.max(hipQ * 0.92, sideWaistX) : hipQ;
  const profile: Vec[] = [v(chestQ, g.chestY)];
  if (bHemY > g.waistY + 0.2) profile.push(v(sideWaistX, g.waistY));
  if (bHemY > hipY + 0.2) profile.push(v(hipQ, hipY));
  const lastX = bHemY > hipY + 0.2 ? hemQ : xAtY([...profile, v(hipQ, hipY)], bHemY);
  profile.push(v(lastX, bHemY));
  const backSide = profile;

  // ---- スリット ----
  const hemHeight = val('inseam') + val('rise') - hemBelowWaist; // 裾の床からの高さ
  const kh = val('knee_height');
  let slitLen = 0;
  let slitRef: number | undefined; // スリットの長さの参考値（縮める前）
  if (dress) {
    const top = { low: kh * 1.15, normal: kh + (val('inseam') - kh) * 0.5, deep: kh + (val('inseam') - kh) * 0.8, custom: 0 }[p.slit];
    slitLen = p.slit === 'custom' ? (finite(p.slitCustom) ? p.slitCustom : 0) : top - hemHeight;
    slitRef = slitLen;
    const maxLen = bHemY - hipY - 0.5;
    if (slitLen > maxLen) {
      slitLen = Math.max(0, maxLen);
      warnings.push('スリットがヒップより上になるため、ヒップの 0.5cm 下で止めました。');
    }
    if (slitLen < 0.3) slitLen = 0;
  } else if (p.topSlit && bHemY > g.waistY + 0.6) {
    slitLen = (bHemY - g.waistY) * 0.5;
    if (slitLen < 0.3) slitLen = 0;
  }

  /** 脇の辺（スリットの上は縫う、下は開き） */
  const sideEdges = (pts: Vec[], hemY: number): Edge[] => {
    if (slitLen <= 0) return [{ segs: polyline(pts), kind: 'seam', name: '脇' }];
    const [upper, lower] = splitAtY(pts, hemY - slitLen);
    return [
      { segs: polyline(upper), kind: 'seam', name: '脇' },
      { segs: polyline(lower), kind: 'opening', name: 'スリット' },
    ];
  };

  // ---- 前の脇: 胸ダーツがあれば後ろの脇にダーツの分を挟む。なければ胸より下を前丈の差だけ下げる ----
  const delta = g.bustDelta;
  // frontHead: ダーツの段差まで（ダーツなしなら空）、frontLower: そこから裾までの折れ線
  let frontHead: Seg[] = [];
  let frontLower: Vec[];
  const frontMarks: Vec[][] = [];
  const shiftDown = (q: Vec) => v(q.x, q.y + delta);
  if (g.dartApplied) {
    const yU = g.chestY + (Math.min(g.waistY, bHemY) - g.chestY) * 0.3;
    const [upper, lower] = splitAtY(backSide, yU);
    const U = upper[upper.length - 1];
    const L = shiftDown(U);
    frontHead = [...polyline(upper), line(U, L)];
    frontLower = lower.map(shiftDown);
    const bpX = Math.min(chest * 0.1, chestQ * 0.6);
    const apexX = Math.min(bpX + chestQ * 0.12, U.x - delta * 1.5);
    frontMarks.push([U, v(Math.max(apexX, chestQ * 0.3), yU + delta / 2), L]);
  } else {
    // ダーツなし: 脇は後ろと同じ長さ。前丈の差は裾で前中心へ下げる（身頃原型と同じ）
    frontLower = backSide.map((q) => v(q.x, q.y));
  }
  const fHemY = g.frontHemY;

  // ---- ウエストのダーツ（印。ひし形） ----
  const waistDart = (x: number, top: number, waistY: number, bottom: number): Vec[] => [
    v(x, top),
    v(x - dartW / 2, waistY),
    v(x, bottom),
    v(x + dartW / 2, waistY),
    v(x, top),
  ];
  const hasWaistDart = dartW > 0.15 && bHemY > g.waistY + 0.5;
  if (hasWaistDart) {
    const fx = Math.min(chest * 0.1, chestQ * 0.55);
    const fw = g.waistY + delta;
    frontMarks.push(waistDart(fx, g.chestY + delta + (g.waistY - g.chestY) * 0.35, fw, Math.min(fw + wh * 0.7, fHemY - 0.3)));
  }

  // ---- 飾りの打ち合わせ線（印）: 前中心の襟ぐりから袖ぐりへ ----
  const fArm = bodice.frontArmhole;
  const A = (fArm[0] as CubicSeg).to; // 袖ぐりの前幅の点
  const N = v(0, g.frontNeckDepth);
  frontMarks.push(
    flattenCubic(cubic(N, v(chestQ * 0.4, g.frontNeckDepth + (A.y - g.frontNeckDepth) * 0.05), v(A.x - chestQ * 0.12, A.y - (A.y - g.frontNeckDepth) * 0.45), A)),
  );

  // ---- フレンチ袖: 肩を延ばし、袖口を脇まで引く ----
  const sleeveOpenings: Seg[] = [];
  const reshapeArm = (pc: Piece, sp: Vec, isFront: boolean): Edge[] => {
    if (p.sleeve !== 'french') return pc.edges.filter((e) => e.name === '肩' || e.name === '袖ぐり');
    const ext = clamp(shoulder * 0.12, 0.4, 2.5);
    const ang = (Math.atan2(sp.y - g.snp.y, sp.x - g.snp.x) * 180) / Math.PI;
    const sp2 = polar(g.snp, ang + 4, dist(g.snp, sp) + ext);
    const side = v(chestQ, g.chestY);
    const d = dist(sp2, side);
    const rad = ((ang + 4 + 90) * Math.PI) / 180;
    const down = v(Math.cos(rad), Math.sin(rad));
    const opening = cubic(sp2, add(sp2, mul(down, d * 0.45)), v(side.x - d * 0.35, side.y), side);
    sleeveOpenings.push(opening);
    return [
      { segs: [line(g.snp, sp2)], kind: 'seam', name: '肩' },
      { segs: [opening], kind: 'hem', name: isFront ? '袖口（前）' : '袖口（後ろ）' },
    ];
  };

  // ---- 身頃を組み直す ----
  const yOpen = dress ? hipY : bHemY; // 後ろ開きの下端（ドレスはヒップまで）
  const cbX = -openingExt;
  const rebuildBack = (): Piece => {
    const pc = bodice.back;
    const edges: Edge[] = [];
    for (const e of pc.edges) {
      if (e.name === '肩') edges.push(...reshapeArm(pc, g.backSP, false));
      else if (e.name === '袖ぐり') continue;
      else if (e.name === '脇') edges.push(...sideEdges(backSide, bHemY));
      else if (e.name === '裾') {
        if (dress) {
          edges.push(
            { segs: [line(v(backSide[backSide.length - 1].x, bHemY), v(0, bHemY))], kind: 'hem', name: '裾' },
            { segs: [line(v(0, bHemY), v(0, yOpen))], kind: 'seam', name: '後ろ中心' },
            { segs: [line(v(0, yOpen), v(cbX, yOpen))], kind: 'seam', name: '持ち出しの下端' },
          );
        } else edges.push({ segs: [line(v(backSide[backSide.length - 1].x, bHemY), v(cbX, bHemY))], kind: 'hem', name: '裾' });
      } else if (e.kind === 'opening') edges.push({ ...e, segs: [line(v(cbX, yOpen), v(cbX, g.backNeckDepth))] });
      else edges.push(e);
    }
    const marks: Vec[][] = [];
    if (hasWaistDart) {
      const bx = Math.min(chestQ * 0.38, sideWaistX - dartW); // 布目線（幅の半分）と重ならない位置
      marks.push(waistDart(bx, g.chestY + (g.waistY - g.chestY) * 0.2, g.waistY, Math.min(g.waistY + wh * 0.8, bHemY - 0.3)));
    }
    // 持ち出しは後ろ開きの範囲（ドレスはヒップまで）
    const ext = extMarks(g.backNeckDepth, yOpen, openingExt);
    return { ...pc, edges, marks: [...marks, ...ext.marks], notes: ext.notes };
  };
  const rebuildFront = (): Piece => {
    const pc = bodice.front;
    const edges: Edge[] = [];
    const lastF = frontLower[frontLower.length - 1];
    for (const e of pc.edges) {
      if (e.name === '肩') edges.push(...reshapeArm(pc, g.frontSP, true));
      else if (e.name === '袖ぐり') continue;
      else if (e.name === '脇') {
        if (slitLen <= 0) edges.push({ segs: [...frontHead, ...polyline(frontLower)], kind: 'seam', name: '脇' });
        else {
          const [up, low] = splitAtY(frontLower, frontLower[frontLower.length - 1].y - slitLen);
          edges.push({ segs: [...frontHead, ...polyline(up)], kind: 'seam', name: '脇' }, { segs: polyline(low), kind: 'opening', name: 'スリット' });
        }
      } else if (e.name === '裾') {
        const hemSeg: Seg =
          Math.abs(lastF.y - fHemY) < 1e-9 ? line(lastF, v(0, fHemY)) : cubic(lastF, v(lastF.x * 0.6, lastF.y), v(lastF.x * 0.4, fHemY), v(0, fHemY));
        edges.push({ segs: [hemSeg], kind: 'hem', name: '裾' });
      }
      else edges.push(e);
    }
    return { ...pc, edges, marks: frontMarks };
  };
  const front = rebuildFront();
  const back = rebuildBack();
  const pieces: Piece[] = [front, back];

  // ---- 袖 ----
  let sleeveRef: number | undefined; // 袖丈の参考値
  const frontAH = pathLength(bodice.frontArmhole);
  const backAH = pathLength(bodice.backArmhole);
  if (!sleeveless) {
    const ratio = p.sleeve === 'custom' && finite(p.sleeveCustom) ? p.sleeveCustom / val('arm_length') : p.sleeve === 'long' ? 1 : 0.3;
    sleeveRef = ratio * val('arm_length');
    const sleeve = draftSleeve({
      frontArmholeLength: frontAH,
      backArmholeLength: backAH,
      upperArm: val('upper_arm_circ'),
      armEase: ease.arm,
      armLength: val('arm_length'),
      lengthRatio: ratio,
      widthRatio: 0.75,
      capEase: 0.03,
      hemRatio: ratio > 0.6 ? 0.75 : 0.95,
      minPass: val('elbow_pass_circ') + ease.pass,
      extraWidth: 0,
    });
    warnings.push(...sleeve.warnings);
    pieces.push(sleeve.piece);
    info.push(`袖ぐり ${fmt(frontAH + backAH)}cm ／ 袖山 ${fmt(sleeve.capLength)}cm ／ 袖幅 ${fmt(sleeve.width)}cm`);
    if (sleeve.widenedHem || sleeve.widenedWidth) info.push('肘が通るように袖を広げました');
  } else {
    // 袖ぐり（フレンチ袖は袖口）の縁取り布
    const openLen = p.sleeve === 'french' ? pathLength(sleeveOpenings) : frontAH + backAH;
    const finished = Math.min(0.6, Math.max(0.25, val('neck_circ') * 0.05));
    pieces.push(bias('armhole-binding', p.sleeve === 'french' ? '袖口縁取り（バイアス）' : '袖ぐり縁取り（バイアス）', '2枚', openLen * 0.95, finished * 2));
    info.push(`${p.sleeve === 'french' ? '袖口' : '袖ぐり'} ${fmt(openLen)}cm ／ 縁取り布 ${fmt(openLen * 0.95)}cm × 仕上がり幅 ${fmt(finished)}cm`);
  }

  // ---- 立ち襟: 前中心で突き合わせ、前の角を丸く。下の辺は前へ少し上がる ----
  const neckHalf = bodice.backNeckLength + bodice.frontNeckLength;
  const ch =
    p.collar === 'custom' && finite(p.collarCustom)
      ? p.collarCustom
      : clamp(val('neck_length') * { low: 0.3, normal: 0.45, high: 0.6, custom: 0.45 }[p.collar], 0.3, 2);
  const rise = ch * 0.35;
  const lowerAt = (Lx: number): CubicSeg => cubic(v(Lx, ch), v(Lx * 0.5, ch), v(Lx * 0.2, ch - rise * 0.6), v(0, ch - rise));
  let lo = neckHalf * 0.5;
  let hi = neckHalf * 1.2;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (pathLength([lowerAt(mid)]) < neckHalf) lo = mid;
    else hi = mid;
  }
  const Lc = (lo + hi) / 2;
  const lower = lowerAt(Lc);
  const rr = Math.min(ch * 0.5, Lc * 0.2); // 前の角の丸み
  const topFront = v(rr, -rise);
  pieces.push({
    id: 'collar',
    name: '立ち襟',
    cut: '4枚（左右反転・表と裏）',
    edges: [
      { segs: [lower], kind: 'seam', name: '襟付け' },
      { segs: [cubic(v(0, ch - rise), v(-rr * 0.1, ch - rise - (ch - rr) * 0.5), v(0, -rise + rr * 0.45), v(rr * 0.05, -rise + rr * 0.6)), cubic(v(rr * 0.05, -rise + rr * 0.6), v(rr * 0.15, -rise + rr * 0.1), v(rr * 0.55, -rise), topFront)], kind: 'seam', name: '前端' },
      { segs: [cubic(topFront, v(Lc * 0.25, -rise), v(Lc * 0.5, 0), v(Lc, 0))], kind: 'seam', name: '襟の上端' },
      { segs: [line(v(Lc, 0), v(Lc, ch))], kind: 'seam', name: '後ろ端' },
    ],
    grain: [v(Lc * 0.35, ch * 0.45), v(Lc * 0.85, ch * 0.45)],
  });

  info.unshift(
    `${CHINA_LENGTH_LABEL[p.length]}${dress ? ` ウエストから ${fmt(hemBelowWaist)}cm` : ''} ／ ${CHINA_SLEEVE_LABEL[p.sleeve]} ／ 立ち襟 ${fmt(ch)}cm`,
    `胸 ${fmt(chestQ * 4)}cm ／ ウエスト ${fmt(waistQ * 4)}cm ／ ヒップ ${fmt(hipQ * 4)}cm（ゆとり込み）`,
  );
  if (hasWaistDart) info.push(`ウエストのダーツ 幅 ${fmt(dartW)}cm（前後とも片側 1 本。印のひし形を縫います）`);
  if (slitLen > 0) info.push(`脇のスリット 裾から ${fmt(slitLen)}cm（前後とも）`);
  info.push('前の打ち合わせは見た目だけです。印の曲線（着る人の右側だけ）にパイピングや縁取りを縫い付け、端にチャイナボタンを付けると本物らしくなります');
  info.push(`背中開き: ${dress ? `首からヒップまで（${fmt(yOpen - g.backNeckDepth)}cm）、その下は縫い合わせ` : '首から裾まで'} ／ 持ち出し ${fmt(openingExt)}cm`);
  info.push(`カテゴリ ${r.category ?? '未分類'}${r.categoryGuessed ? '（仮）' : ''} ／ ゆとりの掛け率 ×${categoryEase.toFixed(2)}`);
  return { pieces, warnings, info, refs: { fitBody: ease.chest, fitSleeve: ease.arm, length: dress ? hemBelowWaist : NaN, collar: ch, extWidth: openingExt, ...(slitRef !== undefined ? { slit: slitRef } : {}), ...(sleeveRef !== undefined ? { sleeve: sleeveRef } : {}) } }; // トップス丈は自分で入力（ドレスの丈）では作れないので目安に出さない
}

function flattenCubic(c: CubicSeg, n = 16): Vec[] {
  const out: Vec[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = 1 - t;
    out.push(
      v(
        a * a * a * c.from.x + 3 * a * a * t * c.c1.x + 3 * a * t * t * c.c2.x + t * t * t * c.to.x,
        a * a * a * c.from.y + 3 * a * a * t * c.c1.y + 3 * a * t * t * c.c2.y + t * t * t * c.to.y,
      ),
    );
  }
  return out;
}

function bias(id: string, name: string, cut: string, len: number, w: number): Piece {
  return {
    id,
    name,
    cut,
    edges: [
      { segs: [line(v(0, 0), v(len, 0))], kind: 'seam', name: '縁取り' },
      { segs: [line(v(len, 0), v(len, w))], kind: 'seam', name: '端' },
      { segs: [line(v(len, w), v(0, w))], kind: 'seam', name: '縁取り' },
      { segs: [line(v(0, w), v(0, 0))], kind: 'seam', name: '端' },
    ],
    grain: [v(len * 0.5 - w * 0.35, w * 0.85), v(len * 0.5 + w * 0.35, w * 0.15)],
  };
}
