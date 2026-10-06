// ケモミミ（カチューシャに付ける耳）。耳 1 つ ＝ 表と裏の 2 枚を中表に縫って返す。根元にタックを入れて少し丸める。
// マグネットのときは根元に楕円の底布を付けて、中に磁石を入れる。
// 大きさの基準はボディではなく、選んだ頭囲（ウィッグサイズのインチ）。範囲の真ん中の値で作る。
// 座標: 耳の先が (0, 0)、根元が y = h（下向き）。左右対称。

import { Vec, v } from '../../geometry/vec';
import { Seg, cubic, line, pathLength } from '../../geometry/path';
import { ResolvedBody } from '../../model/estimate';
import { MeasurementKey } from '../../model/schema';
import { DraftResult, Piece } from '../types';

export type EarShape = 'cat' | 'fox' | 'dog' | 'dogDrop' | 'rabbit' | 'bear';
export type EarSize = 'small' | 'normal' | 'large' | 'custom';
export type MagnetSize = '0.5' | '0.6' | '0.8' | '1' | 'custom';
export type EarHead = '9-10' | '7-8' | '6-7' | 'custom';

export interface EarsParams {
  /** 頭囲（ウィッグサイズ）。ボディには関係なく選ぶ */
  head: EarHead;
  /** head が custom のときの頭囲（cm） */
  headCustom: number | null;
  shape: EarShape;
  size: EarSize;
  /** size が custom のときの耳の高さ（cm） */
  sizeCustom: number | null;
  attach: 'headband' | 'magnet';
  /** 磁石の直径（cm） */
  magnet: MagnetSize;
  magnetCustom: number | null;
  inner: 'same' | 'small';
}

export const DEFAULT_EARS: EarsParams = { head: '7-8', headCustom: null, shape: 'cat', size: 'normal', sizeCustom: null, attach: 'headband', magnet: '0.6', magnetCustom: null, inner: 'small' };

export const EAR_SHAPE_LABEL: Record<EarShape, string> = { cat: '猫', fox: '狐', dog: '犬（立ち耳）', dogDrop: '犬（垂れ耳）', rabbit: 'うさぎ', bear: 'くま' };
export const EAR_SIZE_LABEL: Record<EarSize, string> = { small: '小さめ', normal: '普通', large: '大きめ', custom: '自分で入力' };
export const MAGNET_LABEL: Record<MagnetSize, string> = { '0.5': '5mm', '0.6': '6mm', '0.8': '8mm', '1': '10mm', custom: '自分で入力' };

export const EAR_HEAD_LABEL: Record<EarHead, string> = { '9-10': '9〜10インチ', '7-8': '7〜8インチ', '6-7': '6〜7インチ', custom: '自分で入力' };
/** 範囲の真ん中（インチ） */
const HEAD_INCH: Record<Exclude<EarHead, 'custom'>, number> = { '9-10': 9.5, '7-8': 7.5, '6-7': 6.5 };
const INCH = 2.54;

/** ボディの採寸値は使わない */
export const EARS_REQUIREMENTS: { key: MeasurementKey; hard: boolean }[] = [];

/** 形ごとの 耳の高さ ÷ 頭囲、幅 ÷ 高さ、先の形 */
const SHAPE: Record<EarShape, { h: number; w: number; tip: 'point' | 'round' | 'circle' }> = {
  cat: { h: 0.11, w: 0.95, tip: 'point' },
  fox: { h: 0.15, w: 0.75, tip: 'point' },
  dog: { h: 0.12, w: 0.8, tip: 'round' },
  dogDrop: { h: 0.15, w: 0.6, tip: 'round' },
  rabbit: { h: 0.28, w: 0.32, tip: 'round' },
  bear: { h: 0.065, w: 1.6, tip: 'circle' },
};
const SIZE_K: Record<Exclude<EarSize, 'custom'>, number> = { small: 0.8, normal: 1, large: 1.25 };

const fmt = (x: number) => (Math.round(x * 10) / 10).toFixed(1);
const finite = (x: number | null): x is number => x !== null && Number.isFinite(x);
const mirror = (s: Seg): Seg => (s.kind === 'line' ? line(v(-s.to.x, s.to.y), v(-s.from.x, s.from.y)) : cubic(v(-s.to.x, s.to.y), v(-s.c2.x, s.c2.y), v(-s.c1.x, s.c1.y), v(-s.from.x, s.from.y)));

/** 根元の右端 → 耳の先 の曲線（右半分） */
function rightSide(w: number, h: number, shape: EarShape): Seg {
  const r = w / 2;
  switch (SHAPE[shape].tip) {
    case 'point':
      return shape === 'fox'
        ? cubic(v(r, h), v(r * 0.95, h * 0.5), v(w * 0.08, h * 0.15), v(0, 0))
        : cubic(v(r, h), v(r * 1.05, h * 0.55), v(w * 0.12, h * 0.12), v(0, 0));
    case 'round':
      return shape === 'rabbit'
        ? cubic(v(r, h), v(r * 1.15, h * 0.5), v(r * 0.6, 0), v(0, 0))
        : shape === 'dogDrop'
          ? cubic(v(r, h), v(r * 1.2, h * 0.55), v(r * 0.7, 0), v(0, 0))
          : cubic(v(r, h), v(r, h * 0.4), v(r * 0.5, 0), v(0, 0));
    default:
      return cubic(v(r, h), v(r, h * 0.45), v(r * 0.55, 0), v(0, 0));
  }
}

/** 楕円の周りの長さ（ラマヌジャンの近似） */
const ellipsePerimeter = (a: number, b: number) => Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));

/** 中心 (0, 0)・半径 a × b の楕円（4 つの 3 次ベジェ） */
function ellipse(a: number, b: number): Seg[] {
  const k = 0.5523;
  return [
    cubic(v(a, 0), v(a, b * k), v(a * k, b), v(0, b)),
    cubic(v(0, b), v(-a * k, b), v(-a, b * k), v(-a, 0)),
    cubic(v(-a, 0), v(-a, -b * k), v(-a * k, -b), v(0, -b)),
    cubic(v(0, -b), v(a * k, -b), v(a, -b * k), v(a, 0)),
  ];
}

export function draftEars(_r: ResolvedBody, p: EarsParams): DraftResult {
  let magRef: number | undefined; // 磁石の直径の参考値
  const warnings: string[] = [];
  const info: string[] = [];
  const head =
    p.head === 'custom' && finite(p.headCustom) && p.headCustom > 0 ? p.headCustom : HEAD_INCH[p.head === 'custom' ? '7-8' : p.head] * INCH;
  const sh = SHAPE[p.shape];
  const h = p.size === 'custom' && finite(p.sizeCustom) ? p.sizeCustom : head * sh.h * SIZE_K[p.size === 'custom' ? 'normal' : p.size];
  const w = h * sh.w;
  const right = rightSide(w, h, p.shape);
  const outline: Seg[] = [right, mirror(right)];
  const base = (y: number, half: number) => line(v(-half, y), v(half, y));

  // 根元のタック（中央をつまむ）
  const tw = w * 0.18;
  const td = h * 0.18;
  const tack: Vec[] = [v(-tw / 2, h), v(0, h - td), v(tw / 2, h)];
  const magnet = p.attach === 'magnet';
  const baseName = magnet ? '根元（底布付け）' : '根元（返し口）';

  const earPiece = (id: string, name: string, cut: string, marks: Vec[][]): Piece => ({
    id,
    name,
    cut,
    edges: [
      { segs: [base(h, w / 2)], kind: 'seam', name: baseName },
      { segs: outline, kind: 'seam', name: '縁' },
    ],
    grain: [v(0, h * 0.2), v(0, h * 0.62)], // 根元のタックの印と重ならないよう上寄りに
    marks,
  });

  const pieces: Piece[] = [];
  if (p.inner === 'same') {
    pieces.push(earPiece('ear-front', '耳（内側の布）', '2枚（左右反転）', [tack]));
    pieces.push(earPiece('ear-back', '耳（外側の布）', '2枚（左右反転）', [tack]));
  } else {
    // 一回り小さい内側の布（アップリケ）。根元は表の根元にそろえ、縫い代に挟む
    const kx = 0.72;
    const ky = 0.8;
    const inset = (q: Vec) => v(q.x * kx, h - (h - q.y) * ky);
    const mapSeg = (s: Seg): Seg => (s.kind === 'line' ? line(inset(s.from), inset(s.to)) : cubic(inset(s.from), inset(s.c1), inset(s.c2), inset(s.to)));
    const inner: Seg[] = outline.map(mapSeg);
    const place: Vec[] = [];
    for (const s of inner) for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      if (s.kind === 'cubic') {
        const a = 1 - t;
        place.push(v(a * a * a * s.from.x + 3 * a * a * t * s.c1.x + 3 * a * t * t * s.c2.x + t * t * t * s.to.x, a * a * a * s.from.y + 3 * a * a * t * s.c1.y + 3 * a * t * t * s.c2.y + t * t * t * s.to.y));
      }
    }
    pieces.push(earPiece('ear-front', '耳（表）', '2枚（左右反転）', [tack, place]));
    pieces.push(earPiece('ear-back', '耳（裏）', '2枚（左右反転）', [tack]));
    pieces.push({
      id: 'ear-inner',
      name: '耳の内側（表にまつり付け）',
      cut: '2枚（左右反転・別布）',
      edges: [
        { segs: [base(h, (w / 2) * kx)], kind: 'seam', name: '根元（表と一緒に縫う）' },
        { segs: inner, kind: 'seam', name: '縁（折り込んでまつる）' },
      ],
      grain: [v(0, h - h * ky * 0.75), v(0, h - h * ky * 0.15)],
    });
  }

  // マグネット: 根元の周り（表と裏、タックを縫ったあと）に合わせた楕円の底布
  if (magnet) {
    const P = 2 * (w - tw);
    let lo = 0.01;
    let hi = P;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (ellipsePerimeter(mid, mid * 0.5) < P) lo = mid;
      else hi = mid;
    }
    const a = (lo + hi) / 2;
    const b = a * 0.5;
    const mag = p.magnet === 'custom' && finite(p.magnetCustom) ? p.magnetCustom : Number(p.magnet === 'custom' ? '0.6' : p.magnet);
    magRef = mag;
    pieces.push({
      id: 'ear-base',
      name: '底布（中に磁石）',
      cut: '2枚',
      edges: [{ segs: ellipse(a, b), kind: 'seam', name: '底布付け' }],
      grain: [v(-a * 0.5, 0), v(a * 0.5, 0)],
      marks: [[v(-mag / 2, 0), v(mag / 2, 0)], [v(0, -mag / 2), v(0, mag / 2)]],
    });
    info.push(`底布 ${fmt(a * 2)} × ${fmt(b * 2)}cm（根元の周り ${fmt(P)}cm）／ 磁石 直径 ${fmt(mag * 10)}mm`);
    if (b * 2 < mag + 0.1) warnings.push(`底布の短い方（${fmt(b * 2)}cm）が磁石（直径 ${fmt(mag * 10)}mm）より小さく、磁石が入りません。耳を大きくするか、小さい磁石にしてください。`);
    info.push('磁石は底布の内側にボンドで貼るか、薄い布で包んでから底布を縫い付けます（ウィッグや頭にも反対向きの磁石を付けます）');
  } else {
    info.push('根元から返して綿を少し入れ、タックを縫ってからカチューシャに縫い付けるかボンドで貼ります');
  }
  info.unshift(
    `${EAR_SHAPE_LABEL[p.shape]} ／ 耳の高さ ${fmt(h)}cm・根元の幅 ${fmt(w)}cm（頭囲 ${fmt(head)}cm・${EAR_HEAD_LABEL[p.head]}）`,
    `根元のタック 幅 ${fmt(tw)}cm（印の V を中表につまんで縫う）／ 縁の長さ ${fmt(pathLength(outline))}cm`,
  );
  if (p.inner === 'small') info.push('内側の布は縫い代を 0.3cm くらいに切ってから折り込み、表の印の位置にまつり付けます（根元は表と一緒に縫い代に挟む）');
  return { pieces, warnings, info, refs: { head, size: h, ...(magRef !== undefined ? { magnet: magRef } : {}) } };
}
