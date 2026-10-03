// キャミソールワンピース = キャミソール型の身頃（ウエスト切り替え）＋ スカート ＋ 肩ひも（＋ 身頃の裏地）。
// 身頃は身頃原型の襟ぐり・肩・袖ぐりを、胸の上を通る「胸元」の線に置きかえて作る。背中で開けて着せる。

import { Vec, v } from '../../geometry/vec';
import { cubic, cubicPoint, line, pathLength, CubicSeg, Seg } from '../../geometry/path';
import { ResolvedBody } from '../../model/estimate';
import { MeasurementKey } from '../../model/schema';
import { CATEGORY_EASE } from '../../model/category';
import { draftBodice } from '../bodice';
import { extMarks, openingExtOf } from '../opening';
import { useBustDart } from '../bust';
import { defaultEase, scaleEase } from '../ease';
import { applyFit, Fit } from '../fit';
import { DraftResult, Edge, Fabric, Piece } from '../types';
import { MissingMeasurementsError } from './tshirt';

export type SkirtShape = 'straight' | 'aline' | 'gather';
export type SkirtLength = 'short' | 'knee' | 'ankle' | 'custom';
export type StrapWidth = 'thin' | 'normal' | 'wide' | 'custom';

export interface CamisoleParams {
  fabric: Fabric;
  stretch: number;
  bustDart: boolean;
  fit: Fit | 'custom';
  /** fit が custom のときの胸のゆとり（cm） */
  chestEaseCustom: number | null;
  skirt: SkirtShape;
  length: SkirtLength;
  /** length が custom のときのスカート丈（ウエストから cm） */
  skirtLengthCustom: number | null;
  strap: StrapWidth;
  /** strap が custom のときの肩ひもの仕上がり幅（cm） */
  strapCustom: number | null;
  lining: boolean;
}

export const DEFAULT_CAMISOLE: CamisoleParams = {
  fabric: 'woven',
  stretch: 20,
  bustDart: true,
  fit: 'normal',
  chestEaseCustom: null,
  skirt: 'aline',
  length: 'knee',
  skirtLengthCustom: null,
  strap: 'normal',
  strapCustom: null,
  lining: true,
};

export const SKIRT_LABEL: Record<SkirtShape, string> = { straight: 'ストレート', aline: 'Aライン', gather: 'ギャザー' };
export const SKIRT_LENGTH_LABEL: Record<SkirtLength, string> = {
  short: '短め（ひざ上）',
  knee: '膝丈',
  ankle: '足首',
  custom: '自分で入力',
};
export const STRAP_LABEL: Record<StrapWidth, string> = { thin: '細め', normal: '普通', wide: '太め', custom: '自分で入力' };

export const CAMISOLE_REQUIREMENTS: { key: MeasurementKey; hard: boolean }[] = [
  { key: 'chest_circ', hard: true },
  { key: 'waist_circ', hard: true },
  { key: 'hip_circ', hard: true },
  { key: 'neck_circ', hard: false },
  { key: 'shoulder_width', hard: false },
  { key: 'back_length', hard: false },
  { key: 'front_length', hard: false },
  { key: 'armhole_circ', hard: false },
  { key: 'upper_arm_circ', hard: false },
  { key: 'waist_to_hip', hard: false },
  { key: 'rise', hard: false },
  { key: 'inseam', hard: false },
  { key: 'knee_height', hard: false },
];

const fmt = (x: number) => (Math.round(x * 10) / 10).toFixed(1);
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const finite = (x: number | null): x is number => x !== null && Number.isFinite(x);

/** 曲線上で x が指定の値になる点（x が単調に変わる曲線用） */
function pointAtX(c: CubicSeg, x: number): Vec {
  let lo = 0;
  let hi = 1;
  const inc = c.to.x > c.from.x;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    const px = cubicPoint(c, mid).x;
    if (px < x === inc) lo = mid;
    else hi = mid;
  }
  return cubicPoint(c, (lo + hi) / 2);
}

/** 肩線（SNP → 肩先）上で x の高さ */
function yOnLine(a: Vec, b: Vec, x: number): number {
  return a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);
}

function rect(id: string, name: string, cut: string, w: number, h: number, edgeNames: [string, string, string, string]): Piece {
  return {
    id,
    name,
    cut,
    edges: [
      { segs: [line(v(0, 0), v(w, 0))], kind: 'seam', name: edgeNames[0] },
      { segs: [line(v(w, 0), v(w, h))], kind: 'seam', name: edgeNames[1] },
      { segs: [line(v(w, h), v(0, h))], kind: 'seam', name: edgeNames[2] },
      { segs: [line(v(0, h), v(0, 0))], kind: 'seam', name: edgeNames[3] },
    ],
    grain: [v(w * 0.5, h * 0.15), v(w * 0.5, h * 0.85)],
  };
}

export function draftCamisole(r: ResolvedBody, p: CamisoleParams): DraftResult {
  const missing = CAMISOLE_REQUIREMENTS.filter((q) => r.values[q.key] === undefined).map((q) => q.key);
  if (missing.length > 0) throw new MissingMeasurementsError(missing);
  const val = (k: MeasurementKey) => r.values[k] as number;
  const woven = p.fabric === 'woven';
  const warnings: string[] = [];
  const info: string[] = [];

  const chest = val('chest_circ');
  const hip = val('hip_circ');
  const categoryEase = r.category ? CATEGORY_EASE[r.category] : 1;
  const shapeFit: Fit = p.fit === 'custom' ? 'normal' : p.fit;
  const ease = applyFit(
    scaleEase(defaultEase(p.fabric, { chest, hip, upperArm: val('upper_arm_circ'), armhole: val('armhole_circ') }), categoryEase),
    shapeFit,
    'normal',
  );
  if (p.fit === 'custom' && finite(p.chestEaseCustom)) ease.chest = p.chestEaseCustom;

  const openingExt = openingExtOf(p, chest); // 持ち出しの幅（片側）
  const dart = useBustDart(r, p);
  const bodice = draftBodice(
    {
      chest,
      waist: val('waist_circ'),
      hip,
      neck: val('neck_circ'),
      shoulder: val('shoulder_width'),
      backLength: val('back_length'),
      frontLength: val('front_length'),
      armhole: val('armhole_circ'),
      waistToHip: val('waist_to_hip'),
    },
    {
      ease,
      woven,
      neckWiden: 0,
      frontNeckDrop: 0,
      shoulderExtend: 0,
      hemBelowWaist: 0,
      // 袖がないので、袖ぐり（脇の高さ）は体に沿わせる
      armholeEase: ease.armhole * 0.5,
      backOpening: true,
      openingExt,
      bustDart: dart,
      waistTaper: true,
    },
  );
  warnings.push(...bodice.warnings.filter((w) => !w.includes('着丈')));
  const g = bodice.geom;

  // ---- 胸元の線 ----
  // 前は中心を少し高く、後ろは脇の高さに近く。脇は袖ぐりの底（胸の線）で終わる
  const side = v(g.chestQ, g.chestY);
  const frontTopY = g.chestY - (g.chestY - g.frontSP.y) * 0.35;
  const backTopY = g.chestY - (g.chestY - g.backSP.y) * 0.15;
  const frontTop = cubic(v(0, frontTopY), v(g.chestQ * 0.35, frontTopY), v(g.chestQ * 0.7, g.chestY), side);
  const backTop = cubic(v(0, backTopY), v(g.chestQ * 0.4, backTopY), v(g.chestQ * 0.75, g.chestY), side);
  const cbX = -openingExt;

  const sideEdges = (pc: Piece) => {
    const i = pc.edges.findIndex((e) => e.name === '脇');
    return pc.edges.slice(i, i + 2); // 脇・裾（ウエスト）
  };
  const asWaist = (e: Edge): Edge => (e.kind === 'hem' ? { ...e, kind: 'seam', name: 'ウエスト' } : e);
  const [fSide, fWaist] = sideEdges(bodice.front).map(asWaist);
  const [bSide, bWaist] = sideEdges(bodice.back).map(asWaist);
  const frontWaistY = fWaist.segs[0].to.y;
  const backWaistY = bWaist.segs[0].to.y;

  const front: Piece = {
    ...bodice.front,
    edges: [
      { segs: [frontTop], kind: 'seam', name: '胸元' },
      fSide,
      fWaist,
      { segs: [line(v(0, frontWaistY), v(0, frontTopY))], kind: 'fold', name: '前中心（わ）' },
    ],
    grain: [v(g.chestQ * 0.5, frontTopY + (frontWaistY - frontTopY) * 0.25), v(g.chestQ * 0.5, frontWaistY - (frontWaistY - frontTopY) * 0.1)],
  };
  const back: Piece = {
    ...bodice.back,
    edges: [
      { segs: [line(v(cbX, backTopY), v(0, backTopY)), backTop], kind: 'seam', name: '胸元' },
      bSide,
      { ...bWaist, segs: [line(bWaist.segs[0].from, v(cbX, backWaistY))] },
      { segs: [line(v(cbX, backWaistY), v(cbX, backTopY))], kind: 'opening', name: '後ろ開き' },
    ],
    grain: [v(g.chestQ * 0.5, backTopY + (backWaistY - backTopY) * 0.2), v(g.chestQ * 0.5, backWaistY - (backWaistY - backTopY) * 0.15)],
    ...extMarks(backTopY, backWaistY, openingExt),
  };
  const pieces: Piece[] = [front, back];
  if (p.lining) {
    pieces.push(
      { ...front, id: 'front-lining', name: '前身頃（裏地）', cut: '1枚（わ・裏地）' },
      { ...back, id: 'back-lining', name: '後ろ身頃（裏地）', cut: '2枚（左右反転・裏地）' },
    );
  }

  // ---- 肩ひも ----
  // 付ける位置は肩線のまん中の真下。長さは前の胸元 → 肩線 → 後ろの胸元
  const strapX = (g.snp.x + g.backSP.x) / 2;
  const fAt = pointAtX(frontTop, Math.min(strapX, g.chestQ * 0.95));
  const bAt = pointAtX(backTop, Math.min(strapX, g.chestQ * 0.95));
  const strapLen = fAt.y - yOnLine(g.snp, g.frontSP, strapX) + (bAt.y - yOnLine(g.snp, g.backSP, strapX));
  const strapW = p.strap === 'custom' && finite(p.strapCustom) ? p.strapCustom : clamp(chest * { thin: 0.015, normal: 0.03, wide: 0.05, custom: 0.03 }[p.strap], 0.2, 2);
  const strap = rect('strap', '肩ひも（長さ方向に二つ折り）', '2枚', strapLen, strapW * 2, ['縁', '端', '縁', '端']);
  strap.grain = [v(strapLen * 0.2, strapW), v(strapLen * 0.8, strapW)];
  pieces.push(strap);
  // 印: 肩ひもを付ける位置
  front.marks = [...(front.marks ?? []), [v(fAt.x, fAt.y), v(fAt.x, fAt.y + Math.min(0.5, strapW * 1.5))]];
  back.marks = [...(back.marks ?? []), [v(bAt.x, bAt.y), v(bAt.x, bAt.y + Math.min(0.5, strapW * 1.5))]];

  // ---- スカート ----
  const R = val('rise');
  const I = val('inseam');
  const ankleH = r.values.foot_height ?? I * 0.06;
  let skirtLen: number;
  if (p.length === 'custom' && finite(p.skirtLengthCustom)) skirtLen = p.skirtLengthCustom;
  else {
    const preset = p.length === 'custom' ? 'knee' : p.length;
    skirtLen = { short: R + I * 0.25, knee: R + (I - val('knee_height')), ankle: R + I - ankleH }[preset];
  }
  skirtLen = Math.max(skirtLen, 1);
  const hipY = Math.min(val('waist_to_hip'), skirtLen);
  const hipQ = (hip + ease.hip) / 4;
  const fwq = fWaist.segs[0].from.x;
  const bwq = bWaist.segs[0].from.x;
  // 後ろの開きはヒップが通るところまで
  const openEnd = Math.min(skirtLen * 0.7, val('waist_to_hip') + 1);

  const skirtPiece = (isFront: boolean): Piece => {
    const wq = isFront ? fwq : bwq;
    const hq = Math.max(hipQ, wq);
    let topX = wq;
    let sideSegs: Seg[];
    let hemX: number;
    let hemY = skirtLen;
    let hemSeg: Seg | null = null;
    if (p.skirt === 'gather') {
      topX = Math.max(wq * 1.6, hq * 1.15);
      hemX = topX;
      sideSegs = [line(v(topX, 0), v(hemX, skirtLen))];
    } else if (p.skirt === 'aline') {
      // ヒップの線で、ヒップの幅より外を通る直線
      const flareX = Math.max(wq + skirtLen * 0.2, wq + ((hq - wq) * skirtLen) / Math.max(hipY, 0.1));
      // 脇は斜めなので、脇の長さもスカート丈になるよう裾を曲線にする（脇で少し上がる）
      const dx = flareX - wq;
      const k = skirtLen / Math.hypot(dx, skirtLen);
      hemX = wq + dx * k;
      hemY = skirtLen * k;
      sideSegs = [line(v(wq, 0), v(hemX, hemY))];
      // 裾は脇線に直角に出て、前（後ろ）中心で水平になる
      const n = Math.hypot(dx, skirtLen);
      const h = hemX * 0.4;
      hemSeg = cubic(v(hemX, hemY), v(hemX - (skirtLen / n) * h, hemY + (dx / n) * h), v(hemX * 0.4, skirtLen), v(0, skirtLen));
    } else {
      hemX = hq;
      const hipPt = v(hq, hipY);
      sideSegs = [cubic(v(wq, 0), v(wq + (hq - wq) * 0.6, hipY * 0.25), v(hq, hipY * 0.6), hipPt)];
      if (skirtLen > hipY + 1e-6) sideSegs.push(line(hipPt, v(hq, skirtLen)));
    }
    const waistName = p.skirt === 'gather' ? 'ウエスト（ギャザーを寄せる）' : 'ウエスト';
    const edges: Edge[] = [];
    if (isFront) {
      edges.push(
        { segs: [line(v(0, 0), v(topX, 0))], kind: 'seam', name: waistName },
        { segs: sideSegs, kind: 'seam', name: '脇' },
        { segs: [hemSeg ?? line(v(hemX, hemY), v(0, skirtLen))], kind: 'hem', name: '裾' },
        { segs: [line(v(0, skirtLen), v(0, 0))], kind: 'fold', name: '前中心（わ）' },
      );
    } else {
      edges.push(
        { segs: [line(v(cbX, 0), v(topX, 0))], kind: 'seam', name: waistName },
        { segs: sideSegs, kind: 'seam', name: '脇' },
        { segs: [hemSeg ?? line(v(hemX, hemY), v(0, skirtLen))], kind: 'hem', name: '裾' },
        { segs: [line(v(0, skirtLen), v(0, openEnd))], kind: 'seam', name: '後ろ中心' },
        { segs: [line(v(0, openEnd), v(cbX, openEnd))], kind: 'seam', name: '開き止まり' },
        { segs: [line(v(cbX, openEnd), v(cbX, 0))], kind: 'opening', name: '後ろ開き' },
      );
    }
    return {
      id: isFront ? 'front-skirt' : 'back-skirt',
      name: isFront ? '前スカート' : '後ろスカート',
      cut: isFront ? '1枚（わ）' : '2枚（左右反転）',
      edges,
      ...(isFront ? {} : extMarks(0, openEnd, openingExt)),
      grain: [v(Math.min(topX, hemX) * 0.5, skirtLen * 0.15), v(Math.min(topX, hemX) * 0.5, skirtLen * 0.85)],
    };
  };
  pieces.push(skirtPiece(true), skirtPiece(false));

  // ---- 確認 ----
  const bodiceWaist = 2 * (pathLength(fWaist.segs) + pathLength([line(bWaist.segs[0].from, v(0, backWaistY))]));
  info.push(
    `胸のゆとり ${fmt(ease.chest)}cm ／ 身頃のウエスト ${fmt(bodiceWaist)}cm（${woven ? '布帛' : 'ニット'}）`,
    `スカート: ${SKIRT_LABEL[p.skirt]} ／ 丈 ${fmt(skirtLen)}cm（ウエストから）／ 後ろ開きはウエストから ${fmt(openEnd)}cm まで`,
    `肩ひも 仕上がり ${fmt(strapLen)}cm × 幅 ${fmt(strapW)}cm（長さは試着して調整してください）`,
  );
  if (p.skirt === 'gather') info.push(`ギャザー: スカートのウエスト ${fmt(4 * Math.max(fwq * 1.6, Math.max(hipQ, fwq) * 1.15))}cm を身頃のウエストまで縮めます`);
  if (g.dartApplied) info.push(`胸ダーツ ${fmt(g.bustDelta)}cm（前丈と背丈の差）`);
  if (p.lining) info.push('身頃の裏地: 表と同じ形。胸元と後ろ開きを中表に縫って返します');
  info.push(`カテゴリ ${r.category ?? '未分類'}${r.categoryGuessed ? '（仮）' : ''}`);

  return { pieces, warnings, info };
}
