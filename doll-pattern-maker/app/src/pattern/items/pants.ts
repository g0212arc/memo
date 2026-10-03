// パンツ（オーソドックスな1型）= 前パンツ・後ろパンツ（各2枚）＋ 前開きのときはウエストベルト。
// 片脚ぶんを作図する。x は脇を 0 として股側へ正、y は下向きでウエストの高さが 0。
// フィット感で脚の形が変わる: タイト＝裾へ細く（スキニー寄り）、普通＝ストレート、余裕あり＝ワイド寄り。

import { Vec, v } from '../../geometry/vec';
import { Seg, line, cubic, pathLength } from '../../geometry/path';
import { ResolvedBody } from '../../model/estimate';
import { MeasurementKey } from '../../model/schema';
import { Category, CATEGORY_EASE } from '../../model/category';
import { FIT_FACTOR, Fit } from '../fit';
import { DraftResult, Edge, Fabric, Piece } from '../types';
import { MissingMeasurementsError } from './tshirt';

export type PantsLength = 'short' | 'normal' | 'long' | 'custom';
export type PantsWaist = 'elastic' | 'fly';

export interface PantsParams {
  fabric: Fabric;
  stretch: number;
  waist: PantsWaist;
  /** フィット感。custom のときは hipEaseCustom を使う（脚の形は「普通」） */
  fit: Fit | 'custom';
  hipEaseCustom: number | null;
  length: PantsLength;
  /** length が custom のときの股下（cm、股から裾まで） */
  inseamCustom: number | null;
  /** 裾の周り（片脚、cm）。空欄ならフィット感で決まる */
  hemCustom: number | null;
}

export const DEFAULT_PANTS: PantsParams = {
  fabric: 'woven',
  stretch: 20,
  waist: 'elastic',
  fit: 'normal',
  hipEaseCustom: null,
  length: 'long',
  inseamCustom: null,
  hemCustom: null,
};

/** 前開きを選べるカテゴリ（小六・1/6 は小さすぎるのでゴムのみ）。変えるときはここだけ直す */
export const FLY_CATEGORIES: readonly Category[] = ['特六', '棍六', '1/4', '大四', '特四', '1/3', '叔体'];

export function flyAvailable(category: Category | null): boolean {
  return category === null || FLY_CATEGORIES.includes(category);
}

export const PANTS_LENGTH_LABEL: Record<PantsLength, string> = {
  short: '短め（短パン）',
  normal: '普通（膝丈）',
  long: '長い（くるぶし丈）',
  custom: '自分で入力',
};

export const PANTS_REQUIREMENTS: { key: MeasurementKey; hard: boolean }[] = [
  { key: 'waist_circ', hard: true },
  { key: 'hip_circ', hard: true },
  { key: 'rise', hard: false },
  { key: 'waist_to_hip', hard: false },
  { key: 'inseam', hard: false },
  { key: 'crotch_to_ankle', hard: false },
  { key: 'thigh_circ', hard: false },
  { key: 'calf_circ', hard: false },
  { key: 'knee_height', hard: false },
  { key: 'foot_pass_circ', hard: false },
];

const fmt = (x: number) => (Math.round(x * 10) / 10).toFixed(1);
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** 脚の形（片脚の周りに対する比率）。股の高さの周りを 1 とする */
const LEG_SHAPE: Record<Fit, { knee: number; ankle: number }> = {
  tight: { knee: 0.72, ankle: 0.6 },
  normal: { knee: 0.84, ankle: 0.8 },
  loose: { knee: 0.97, ankle: 0.97 },
};

interface Half {
  /** ヒップ線での幅（脇〜中心） */
  hipW: number;
  /** 股のまち（中心から股の先まで） */
  ext: number;
  /** 脚の周りのうち、この身頃が受け持つ割合 */
  share: number;
}

export function draftPants(r: ResolvedBody, p: PantsParams): DraftResult {
  const missing = PANTS_REQUIREMENTS.filter((q) => r.values[q.key] === undefined).map((q) => q.key);
  if (missing.length > 0) throw new MissingMeasurementsError(missing);
  const val = (k: MeasurementKey) => r.values[k] as number;
  const woven = p.fabric === 'woven';
  const warnings: string[] = [];
  const info: string[] = [];

  let waistType = p.waist;
  if (waistType === 'fly' && !flyAvailable(r.category)) {
    waistType = 'elastic';
    warnings.push(`前開きは ${FLY_CATEGORIES.join('・')} だけで選べます。このボディ（${r.category}）はゴムで作図しました。`);
  }
  const fly = waistType === 'fly';

  const W = val('waist_circ');
  const H = val('hip_circ');
  const R = val('rise');
  const I = val('inseam');
  const T = val('thigh_circ');
  const C = val('calf_circ');
  const kneeH = val('knee_height');
  const footPass = val('foot_pass_circ');

  // ゆとり（フィット感の掛け率は脚の太さにも効かせる。足・ふくらはぎが通る余裕には効かせない）
  const shape: Fit = p.fit === 'custom' ? 'normal' : p.fit;
  const fitK = FIT_FACTOR[shape] * (r.category ? CATEGORY_EASE[r.category] : 1);
  const hipEase =
    p.fit === 'custom' && p.hipEaseCustom !== null && Number.isFinite(p.hipEaseCustom)
      ? p.hipEaseCustom
      : (woven ? H * 0.08 + 0.4 : H * 0.02 + 0.2) * fitK;
  const thighEase = (woven ? T * 0.12 + 0.4 : T * 0.03 + 0.2) * fitK;
  const passEase = woven ? 0.3 : 0.1;
  // ニットは伸びるぶん、足が通るのに必要な周りが小さくてすむ
  const stretchK = woven ? 1 : Math.max(0.7, 1 - (p.stretch / 100) * 0.5);

  // 股上（股の位置）。布帛は少し下げて、座ったときにきつくないように
  const D = R + (woven ? R * 0.04 + 0.1 : 0);
  const hipY = clamp(val('waist_to_hip'), R * 0.4, R * 0.85);

  // ヒップ・股のまち
  const Hq = (H + hipEase) / 4;
  const front: Half = { hipW: Hq * 0.94, ext: (H + hipEase) * 0.045, share: 0 };
  const back: Half = { hipW: Hq * 1.06, ext: (H + hipEase) * 0.1, share: 0 };
  // 太ももが入る周り（股の高さでの片脚の周り）が足りなければ、まちを広げる
  let thighFull = front.hipW + front.ext + back.hipW + back.ext;
  const thighNeed = T + thighEase;
  if (thighFull < thighNeed) {
    const k = (thighNeed - front.hipW - back.hipW) / (front.ext + back.ext);
    front.ext *= k;
    back.ext *= k;
    thighFull = thighNeed;
    info.push('太ももが入るように股のまちを広げました');
  }
  // 股の高さで脇が 0 になるよう、脚の周りを前後の股の幅の比で分ける
  front.share = (front.hipW + front.ext) / thighFull;
  back.share = (back.hipW + back.ext) / thighFull;

  // 脚の周り（片脚）
  const kneeY = D + Math.max(I - kneeH, I * 0.25);
  // くるぶし丈は「股から足首」（足を含まない長さ。腿长など）をそのまま使う
  const ankleY = D + Math.max(val('crotch_to_ankle'), I * 0.5);
  const kneeFull = Math.max(thighFull * LEG_SHAPE[shape].knee, C + passEase + thighEase * 0.5);
  const ankleFull = Math.max(thighFull * LEG_SHAPE[shape].ankle, footPass * stretchK + passEase);
  let widened = false;

  // 丈（股から裾までの長さ）
  let inseamLen: number;
  if (p.length === 'custom' && p.inseamCustom !== null && Number.isFinite(p.inseamCustom)) {
    inseamLen = p.inseamCustom;
  } else {
    const preset = p.length === 'custom' ? 'long' : p.length;
    inseamLen = { short: I * 0.15, normal: kneeY - D, long: ankleY - D }[preset];
  }
  inseamLen = Math.max(inseamLen, 0.5);
  const hemY = D + inseamLen;
  if (hemY > ankleY + 0.05 && p.length === 'custom') {
    warnings.push(`股下 ${fmt(inseamLen)}cm はくるぶしより長いので、裾が足にかかります。`);
  }

  /** 高さ y での片脚の周り（股〜膝〜くるぶしを結ぶ） */
  const fullAt = (y: number): number => {
    if (y <= kneeY) {
      const t = clamp((y - D) / (kneeY - D), 0, 1);
      return thighFull + (kneeFull - thighFull) * (1 - (1 - t) * (1 - t));
    }
    const t = (y - kneeY) / (ankleY - kneeY);
    return kneeFull + (ankleFull - kneeFull) * t;
  };
  let hemFull = fullAt(hemY);
  if (p.hemCustom !== null && Number.isFinite(p.hemCustom)) {
    hemFull = p.hemCustom;
  }
  // 裾から足・ふくらはぎが通るか
  const passNeed = hemY >= kneeY ? footPass * stretchK + passEase : Math.max(footPass * stretchK, 0) + passEase;
  if (hemFull < passNeed) {
    if (p.hemCustom !== null) {
      warnings.push(`裾の周り ${fmt(hemFull)}cm では足が通りません（足が通る周り ${fmt(footPass)}cm）。${fmt(passNeed)}cm 以上にしてください。`);
    } else {
      hemFull = passNeed;
      widened = true;
    }
  }

  // ウエスト
  const bandH = fly ? clamp(R * 0.14, 0.5, 1.5) : 0;
  const topY = bandH;
  const flyW = fly ? clamp(R * 0.15, 0.6, 1.5) : 0;
  const riseUp = R * 0.06;
  const waistEase = woven ? W * 0.04 + 0.2 : 0;
  const waistQ = (W + waistEase) / 4;

  // 股ぐりのカーブの始まり（股のまちが大きいほど上から曲げる。上端には近づけすぎない）
  const crotchStart = (ratio: number, h: Half, k: number) =>
    Math.max(topY + R * 0.35, D - Math.max((D - hipY) * ratio, h.ext * k));
  // 前開きの長さ: 開けたときにウエスト ＋ 開き × 2 がヒップを通るように（股ぐりにかからない範囲で）
  const flyNeed = (H + 0.3 - 4 * waistQ) / 2;
  // 前開きが長く要るときは、前の股ぐりの始まりを下げる（股の先から まち × 0.9 までは下げられる）
  const frontS = fly
    ? Math.min(Math.max(crotchStart(0.55, front, 1.6), topY + flyNeed + flyW * 0.8), Math.max(crotchStart(0.55, front, 1.6), D - front.ext * 0.9))
    : crotchStart(0.55, front, 1.6);
  const flyMax = Math.max(0.5, frontS - topY - flyW * 0.8);
  const flyLen = fly ? clamp(Math.max((frontS - topY) * 0.5, flyNeed), Math.min(0.5, flyMax), flyMax) : 0;
  // ゴムのときは、後ろ中心を傾けてもウエストがヒップより小さくならないように
  const maxSlant = Math.max(0, hipEase / 2 - 0.15);

  const buildHalf = (h: Half, isFront: boolean) => {
    // 中心線: 上端 → 股ぐりの始まり
    const sY = isFront ? frontS : crotchStart(0.75, h, 1.3);
    const slant = isFront ? 0 : fly ? h.hipW * 0.12 : Math.min(h.hipW * 0.08, maxSlant);
    const cTopY = isFront ? topY : topY - riseUp;
    // 中心線（前はまっすぐ、後ろは上を脇側へ傾け、ヒップ点を通って股ぐりの始まりまで延ばす）
    const dirX = isFront ? 0 : slant / (hipY - cTopY);
    const cx = (y: number) => h.hipW + dirX * (y - hipY);
    let cTop = isFront ? v(h.hipW, cTopY) : v(cx(cTopY), cTopY);
    const sPt = v(cx(sY), sY);
    const crotch = v(h.hipW + h.ext, D);

    // 前開き（ウエストを細くする）: 中心とウエスト脇で詰める
    let sideTop = v(0, topY);
    if (fly) {
      const excess = cTop.x - waistQ * (isFront ? 0.96 : 1.04);
      if (excess > 0) {
        const atCenter = isFront ? Math.min(excess * 0.25, h.hipW * 0.06) : 0;
        cTop = v(cTop.x - atCenter, cTopY);
        sideTop = v(Math.min(excess - atCenter, h.hipW * 0.35), topY);
      }
    }

    // 脇線・股下線（片脚の周り × share を、脇〜股下の幅にする）
    const crease = (h.hipW + h.ext) / 2;
    const halfWidth = (y: number) => {
      const full = y >= hemY - 1e-9 ? hemFull : fullAt(y);
      return (full * h.share) / 2;
    };
    const sideX = (y: number) => {
      if (y <= D) return 0 + (crease - halfWidth(D)) * Math.pow(clamp((y - hipY) / (D - hipY), 0, 1), 2);
      return crease - halfWidth(y);
    };
    const inX = (y: number) => crease + halfWidth(y);

    const sample = (f: (y: number) => number, y0: number, y1: number, n: number): Vec[] => {
      const pts: Vec[] = [];
      for (let i = 0; i <= n; i++) {
        const y = y0 + ((y1 - y0) * i) / n;
        pts.push(v(f(y), y));
      }
      return pts;
    };
    const toSegs = (pts: Vec[]): Seg[] => pts.slice(1).map((q, i) => line(pts[i], q));

    // 股下: 股の先からなめらかに脚の線へ
    const inPts = sample(
      (y) => {
        const target = inX(y);
        const t = clamp((y - D) / Math.max(0.01, Math.min(kneeY, hemY) - D), 0, 1);
        const blend = 1 - Math.pow(1 - t, 2);
        return crotch.x + (target - crotch.x) * (y <= kneeY ? blend : 1);
      },
      D,
      hemY,
      24,
    );
    const hemIn = inPts[inPts.length - 1];
    // 脇: 裾 → ヒップ線 → ウエスト
    const sidePts = sample(
      (y) => {
        if (y >= D) {
          const t = clamp((y - D) / Math.max(0.01, Math.min(kneeY, hemY) - D), 0, 1);
          const target = sideX(y);
          const atD = sideX(D);
          return y <= kneeY ? atD + (target - atD) * t : target;
        }
        return sideX(y);
      },
      hemY,
      hipY,
      24,
    );
    const hemSide = sidePts[0];

    const edges: Edge[] = [];
    // ウエスト（脇 → 中心）
    edges.push({ segs: [line(sideTop, cTop)], kind: fly ? 'seam' : 'hem', name: fly ? 'ウエスト' : 'ウエスト（ゴム通し）' });

    // 中心線
    if (isFront && fly) {
      const flyEnd = topY + flyLen;
      // 前中心の線（上端を詰めたあと）上の x
      const cfAt = (y: number) => cTop.x + ((sPt.x - cTop.x) * (y - cTop.y)) / (sPt.y - cTop.y);
      const ext1 = v(cTop.x + flyW, cTop.y);
      const ext2 = v(cfAt(flyEnd) + flyW, flyEnd);
      const back2 = v(cfAt(Math.min(sY, flyEnd + flyW * 0.8)), Math.min(sY, flyEnd + flyW * 0.8));
      edges.push({ segs: [line(cTop, ext1)], kind: 'seam', name: 'ウエスト（前立て）' });
      edges.push({ segs: [line(ext1, ext2)], kind: 'opening', name: '前立て' });
      edges.push({ segs: [line(ext2, back2)], kind: 'seam', name: '前立て下' });
      if (back2.y < sY - 1e-6) edges.push({ segs: [line(back2, sPt)], kind: 'seam', name: '前中心' });
    } else {
      edges.push({ segs: [line(cTop, sPt)], kind: 'seam', name: isFront ? '前中心' : '後ろ中心' });
    }
    // 股ぐり
    const depth = D - sY;
    const tangent = isFront ? v(0, 1) : v(dirX, 1);
    edges.push({
      segs: [
        cubic(
          sPt,
          v(sPt.x + tangent.x * depth * 0.55, sPt.y + depth * 0.55),
          v(crotch.x - h.ext * 0.45, D),
          crotch,
        ),
      ],
      kind: 'seam',
      name: '股ぐり',
    });
    edges.push({ segs: toSegs(inPts), kind: 'seam', name: '股下' });
    edges.push({ segs: [line(hemIn, hemSide)], kind: 'hem', name: '裾' });
    // 脇（裾 → ヒップ線）＋ ヒップ線 → ウエスト
    const sideSegs: Seg[] = toSegs(sidePts);
    const hipPt = sidePts[sidePts.length - 1];
    if (fly && sideTop.x > 1e-6) {
      sideSegs.push(cubic(hipPt, v(hipPt.x, hipPt.y - (hipY - topY) * 0.5), v(sideTop.x * 0.6, topY + (hipY - topY) * 0.2), sideTop));
    } else {
      sideSegs.push(line(hipPt, sideTop));
    }
    edges.push({ segs: sideSegs, kind: 'seam', name: '脇' });

    const grainX = crease;
    const piece: Piece = {
      id: isFront ? 'front-pants' : 'back-pants',
      name: isFront ? '前パンツ' : '後ろパンツ',
      cut: '2枚（左右対称）',
      edges,
      grain: [v(grainX, hipY + (hemY - hipY) * 0.2), v(grainX, hipY + (hemY - hipY) * 0.8)],
    };
    const waistLen = pathLength(edges[0].segs);
    const sideLen = pathLength(sideSegs);
    const inseamEdgeLen = pathLength(toSegs(inPts));
    return { piece, waistLen, sideLen, inseamEdgeLen, hemW: Math.abs(hemIn.x - hemSide.x) };
  };

  const f = buildHalf(front, true);
  const b = buildHalf(back, false);
  const pieces: Piece[] = [f.piece, b.piece];

  const waistTotal = 2 * (f.waistLen + b.waistLen);
  if (fly) {
    const len = waistTotal + flyW;
    pieces.push({
      id: 'waistband',
      name: 'ウエストベルト（高さ方向に二つ折り）',
      cut: '1枚',
      edges: [
        { segs: [line(v(0, 0), v(len, 0))], kind: 'seam', name: 'ウエスト側' },
        { segs: [line(v(len, 0), v(len, bandH * 2))], kind: 'seam', name: '端' },
        { segs: [line(v(len, bandH * 2), v(0, bandH * 2))], kind: 'seam', name: 'ウエスト側' },
        { segs: [line(v(0, bandH * 2), v(0, 0))], kind: 'seam', name: '端' },
      ],
      grain: [v(len * 0.5 - Math.min(len * 0.3, 3), bandH), v(len * 0.5 + Math.min(len * 0.3, 3), bandH)],
    });
    info.push(
      `ウエスト ${fmt(waistTotal)}cm ／ ベルト ${fmt(len)}cm × 仕上がりの高さ ${fmt(bandH)}cm（重なり ${fmt(flyW)}cm にスナップ・かぎホック）`,
    );
    // 前開きを開けたときにヒップが通るか
    info.push(`前開きの長さ ${fmt(flyLen)}cm ／ 前立て幅 ${fmt(flyW)}cm`);
    if (waistTotal + 2 * flyLen < H + 0.3) {
      warnings.push('前開きを開けてもヒップが通りにくい可能性があります。ゴムにするか、身幅を「余裕あり」にしてください。');
    }
  } else {
    const elastic = W * 0.9;
    info.push(
      `ウエスト ${fmt(waistTotal)}cm ／ ゴムの長さの目安 ${fmt(elastic)}cm（＋重ね 1cm）。ウエストの縫い代を三つ折りにしてゴムを通します`,
    );
    if (waistTotal < H + 0.2) warnings.push('ウエストの周りがヒップより小さいので、はくときにヒップが通りません。');
  }

  info.push(
    `ヒップのゆとり ${fmt(hipEase)}cm ／ 股上 ${fmt(D)}cm ／ 股下 ${fmt(hemY - D)}cm`,
    `裾の周り（片脚）${fmt(f.hemW + b.hemW)}cm ／ 足が通る周り ${fmt(footPass)}cm`,
    `脇の長さ 前 ${fmt(f.sideLen)}cm・後ろ ${fmt(b.sideLen)}cm ／ 股下の長さ 前 ${fmt(f.inseamEdgeLen)}cm・後ろ ${fmt(b.inseamEdgeLen)}cm`,
  );
  if (widened) info.push('足が通るように裾を広げました');
  info.push(`カテゴリ ${r.category ?? '未分類'}${r.categoryGuessed ? '（仮）' : ''}`);

  return { pieces, warnings, info };
}
