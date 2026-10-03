// パーカー = 身頃原型（ニット・襟ぐり広め）＋ フード ＋ 袖 ＋ 袖口リブ・裾リブ ＋ カンガルーポケット。
// 前は かぶり か 前ファスナー。開きは作らない（かぶりで頭が通らないときは、頭を外して着せる前提）。
// フードは頭のサイズ（ウィッグのインチ）か、ボディの頭囲から作る。9インチ以上は 3枚はぎ。

import { v } from '../../geometry/vec';
import { cubic, line, pathLength } from '../../geometry/path';
import { ResolvedBody } from '../../model/estimate';
import { MeasurementKey } from '../../model/schema';
import { CATEGORY_EASE } from '../../model/category';
import { draftBodice } from '../bodice';
import { useBustDart } from '../bust';
import { draftSleeve } from '../sleeve';
import { defaultEase, scaleEase } from '../ease';
import { applyFit, Fit } from '../fit';
import { draftHood, HEAD_SIZES, HeadSize, INCH, THREE_PANEL_HEAD } from '../hood';
import { DraftResult, Edge, EdgeKind, Fabric, Piece } from '../types';
import { MissingMeasurementsError } from './tshirt';

export type HoodieLength = 'short' | 'normal' | 'long' | 'custom';

export interface HoodieParams {
  fabric: Fabric;
  stretch: number;
  bustDart: boolean;
  front: 'pullover' | 'zip';
  headSize: 'auto' | HeadSize | 'custom';
  /** headSize が custom のときの頭囲（cm） */
  headCustom: number | null;
  sleeve: 'long' | 'half';
  fit: Fit | 'custom';
  chestEaseCustom: number | null;
  length: HoodieLength;
  lengthCustom: number | null;
  strings: boolean;
  pocket: boolean;
  rib: boolean;
}

export const DEFAULT_HOODIE: HoodieParams = {
  fabric: 'knit',
  stretch: 20,
  bustDart: true,
  front: 'pullover',
  headSize: 'auto',
  headCustom: null,
  sleeve: 'long',
  fit: 'loose',
  chestEaseCustom: null,
  length: 'normal',
  lengthCustom: null,
  strings: true,
  pocket: true,
  rib: true,
};

export const HOODIE_LENGTH_LABEL: Record<HoodieLength, string> = {
  short: '短め',
  normal: '普通（腰まで）',
  long: '長め（お尻が隠れる）',
  custom: '自分で入力',
};

export const HOODIE_REQUIREMENTS: { key: MeasurementKey; hard: boolean }[] = [
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

export function draftHoodie(r: ResolvedBody, p: HoodieParams): DraftResult {
  const missing = HOODIE_REQUIREMENTS.filter((q) => r.values[q.key] === undefined).map((q) => q.key);
  if (missing.length > 0) throw new MissingMeasurementsError(missing);
  const val = (k: MeasurementKey) => r.values[k] as number;
  const woven = p.fabric === 'woven';
  const warnings: string[] = [];
  const info: string[] = [];
  const zip = p.front === 'zip';

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
    shapeFit,
  );
  // スウェットは厚みがあり、重ね着もするので、ゆとりを足す
  ease.chest += chest * 0.06 + 0.3;
  ease.hip += val('hip_circ') * 0.04;
  ease.armhole += 0.2;
  if (p.fit === 'custom' && finite(p.chestEaseCustom)) ease.chest = p.chestEaseCustom;
  // リブ（伸びる布）は、縫い付ける側より短くして引っぱりながら付ける
  const ribK = woven ? 1 : Math.max(0.75, 1 - (p.stretch / 100) * 0.75);

  const ribH = p.rib ? clamp(wth * 0.25, 0.4, 2.5) : 0;
  const hemBelowWaist =
    (p.length === 'custom' && finite(p.lengthCustom) ? p.lengthCustom : wth * { short: 0.3, normal: 0.9, long: 1.4, custom: 0.9 }[p.length]) - ribH;
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
      neckWiden: 0.12,
      frontNeckDrop: 0,
      shoulderExtend: val('shoulder_width') * 0.03,
      hemBelowWaist,
      armholeEase: ease.armhole,
      backOpening: false,
      openingExt: 0,
      bustDart: useBustDart(r, p),
    },
  );
  warnings.push(...bodice.warnings);
  const g = bodice.geom;

  // ---- 前身頃（前ファスナーなら前中心で分ける） ----
  const front: Piece = zip
    ? {
        ...bodice.front,
        cut: '2枚（左右反転）',
        edges: bodice.front.edges.map((e): Edge => (e.kind === 'fold' ? { ...e, kind: 'opening', name: '前中心（ファスナー付け）' } : e)),
      }
    : bodice.front;
  const pieces: Piece[] = [front, bodice.back];

  // ---- カンガルーポケット ----
  const hemY = g.frontHemY;
  if (p.pocket) {
    const ph = clamp((hemY - g.chestY) * 0.42, 1, 12);
    const top = hemY - ph - 0.1;
    if (top > g.chestY + 0.3) {
      const wTop = g.chestQ * 0.5;
      const wBot = g.chestQ * 0.72;
      // 前ファスナーのときは左右に分ける（前中心はファスナーの手前で止める）
      const x0 = zip ? 0.3 : 0;
      const opening = cubic(v(wTop, 0), v(wTop + (wBot - wTop) * 0.2, ph * 0.45), v(wBot - (wBot - wTop) * 0.1, ph * 0.75), v(wBot, ph));
      const edges: Edge[] = [
        { segs: [line(v(x0, 0), v(wTop, 0))], kind: 'seam', name: '上（縫い付け）' },
        { segs: [opening], kind: 'hem', name: 'ポケット口' },
        { segs: [line(v(wBot, ph), v(x0, ph))], kind: 'seam', name: '下（裾リブと一緒に縫う）' },
        { segs: [line(v(x0, ph), v(x0, 0))], kind: zip ? 'hem' : 'fold', name: zip ? '前中心側' : '前中心（わ）' },
      ];
      pieces.push({
        id: 'pocket',
        name: 'カンガルーポケット',
        cut: zip ? '2枚（左右反転）' : '1枚（わ）',
        edges,
        grain: [v(wTop * 0.5, ph * 0.2), v(wTop * 0.5, ph * 0.8)],
      });
      front.marks = [...(front.marks ?? []), [v(x0, top), v(wTop, top)], [v(wBot, hemY - 0.1), v(wTop, top)]];
    } else {
      info.push('丈が短いので、カンガルーポケットは付けませんでした');
    }
  }

  // ---- フード ----
  let head: number;
  let headLabel: string;
  if (p.headSize === 'custom' && finite(p.headCustom)) {
    head = p.headCustom;
    headLabel = `頭囲 ${fmt(head)}cm`;
  } else if (p.headSize !== 'auto' && p.headSize !== 'custom') {
    head = HEAD_SIZES[p.headSize].inch * INCH;
    headLabel = HEAD_SIZES[p.headSize].label;
  } else if (r.values.head_circ !== undefined) {
    head = r.values.head_circ;
    headLabel = `ボディの頭囲 ${fmt(head)}cm`;
  } else {
    head = val('neck_circ') * 2.4;
    headLabel = `頭囲 ${fmt(head)}cm（首回りから推定）`;
    warnings.push('頭囲がないので首回りから推定しました。頭のサイズ（インチ）を選ぶか、頭囲を入れると正確になります。');
  }
  const panels = head >= THREE_PANEL_HEAD - 1e-9 ? 3 : 2;
  const neckHalf = bodice.backNeckLength + bodice.frontNeckLength;
  const hood = draftHood({ neckHalf, head, neckLength: val('neck_length'), panels, lined: false, faceKind: 'hem' });
  pieces.push(...hood.pieces);
  info.push(`フード: ${headLabel} ／ ${panels === 3 ? '3枚はぎ（マチ付き）' : '2枚はぎ'} ／ 高さ ${fmt(hood.height)}cm`);
  if (p.strings) {
    const strLen = hood.faceLen * 2 + val('neck_circ') * 0.6;
    pieces.push(rectPiece('string', 'フードのひも（長さ方向に四つ折り）', '1枚', strLen, clamp(head * 0.03, 0.4, 1.2) * 4, ['seam', 'seam', 'seam', 'seam'], ['縁', '端', '縁', '端']));
    const hd = hood.pieces[0];
    const H = hood.height;
    const rr = 0.12;
    hd.marks = [[v(0.35 - rr, H - 0.5), v(0.35 + rr, H - 0.5)], [v(0.35, H - 0.5 - rr), v(0.35, H - 0.5 + rr)]];
    info.push('ひも: 顔まわりを三つ折りにしてひもを通し、印の位置に穴（ハトメ・ボタンホール）を開けます');
  }

  // ---- 袖 ----
  const frontAH = pathLength(bodice.frontArmhole);
  const backAH = pathLength(bodice.backArmhole);
  const armLen = val('arm_length');
  const long = p.sleeve === 'long';
  const cuffH = long && p.rib ? clamp(armLen * 0.1, 0.5, 2.5) : 0;
  const sleeve = draftSleeve({
    frontArmholeLength: frontAH,
    backArmholeLength: backAH,
    upperArm: val('upper_arm_circ'),
    armEase: ease.arm,
    armLength: armLen,
    lengthRatio: long ? 1.0 - cuffH / armLen : 0.4,
    widthRatio: woven ? 0.78 : 0.9,
    capEase: woven ? 0.03 : 0,
    hemRatio: long ? 0.8 : 0.95,
    minPass: val('elbow_pass_circ') + ease.pass,
    extraWidth: 0,
  });
  warnings.push(...sleeve.warnings);
  pieces.push(sleeve.piece);
  const hemSeg = sleeve.piece.edges.find((e) => e.kind === 'hem')!.segs[0];
  const hemW = Math.abs(hemSeg.to.x - hemSeg.from.x);
  if (cuffH > 0) {
    sleeve.piece.edges = sleeve.piece.edges.map((e) => (e.kind === 'hem' ? { ...e, kind: 'seam', name: '袖口（リブ付け）' } : e));
    // 肘・手が通るよう、伸ばしたときに肘が通る周りを下回らない
    const cuffLen = Math.max(hemW * ribK, (val('elbow_pass_circ') + ease.pass) / (woven ? 1 : 1 + p.stretch / 100));
    pieces.push(rectPiece('cuff', '袖口リブ（高さ方向に二つ折り）', '2枚（リブ）', Math.min(cuffLen, hemW), cuffH * 2, ['seam', 'seam', 'seam', 'seam'], ['袖口側', '端', '袖口側', '端']));
  }

  // ---- 裾リブ ----
  if (p.rib) {
    const hemCirc = 2 * (Math.abs(bodice.front.edges.find((e) => e.kind === 'hem')!.segs[0].from.x) + Math.abs(bodice.back.edges.find((e) => e.kind === 'hem')!.segs[0].from.x));
    const bandLen = hemCirc * ribK;
    pieces.push(
      rectPiece('hem-rib', zip ? '裾リブ（高さ方向に二つ折り。前中心で分ける）' : '裾リブ（高さ方向に二つ折り）', zip ? '2枚（リブ）' : '1枚（リブ・輪にする）', zip ? bandLen / 2 : bandLen, ribH * 2, ['seam', 'seam', 'seam', 'seam'], ['裾側', '端', '裾側', '端']),
    );
  }

  // ---- 頭が通るか（かぶり） ----
  if (!zip) {
    const neckOpen = 2 * neckHalf * (woven ? 1 : 1 + p.stretch / 100);
    if (neckOpen < head + 0.3) {
      warnings.push(`首の開き（伸ばして約 ${fmt(neckOpen)}cm）が頭囲（${fmt(head)}cm）より小さいので、頭が通りません。頭を外して着せてください（前ファスナーにすると着せやすくなります）。`);
    }
  }

  info.unshift(
    `${zip ? '前ファスナー' : 'かぶり'} ／ 胸のゆとり ${fmt(ease.chest)}cm（${woven ? '布帛' : 'ニット'}）`,
    `襟ぐり（半身）${fmt(neckHalf)}cm ／ 袖ぐり ${fmt(frontAH + backAH)}cm ／ 袖山 ${fmt(sleeve.capLength)}cm ／ 袖口 ${fmt(hemW)}cm`,
  );
  if (zip) info.push(`ファスナー: 前中心の長さ 約 ${fmt(hemY - g.frontNeckDepth + ribH)}cm（裾リブ込み）`);
  if (sleeve.widenedHem || sleeve.widenedWidth) info.push('肘が通るように袖口を広げました');
  if (g.dartApplied) info.push(`胸ダーツ ${fmt(g.bustDelta)}cm（前丈と背丈の差）`);
  info.push(`カテゴリ ${r.category ?? '未分類'}${r.categoryGuessed ? '（仮）' : ''}`);
  return { pieces, warnings, info };
}

