// 靴下 = 伸びる布で、脚と足に合わせて少し小さく作る（タイツと同じ考え方）。
// 縫い目 2 本: 脚を横から見た形の左右 2 枚（前の縫い目 ＝ すね〜足の甲〜つま先、後ろの縫い目 ＝ ふくらはぎ〜かかと〜足裏）。
// 縫い目 1 本: 前を「わ」にした 1 枚。両側の辺が縫い合わさって、脚の後ろ〜かかと〜足裏〜つま先の 1 本になる。
// 高さは足裏を 0 として上へ測る（型紙の座標では y を下向きにする）。

import { Vec, v } from '../../geometry/vec';
import { cubic, line, pathLength, Seg } from '../../geometry/path';
import { ResolvedBody } from '../../model/estimate';
import { MeasurementKey } from '../../model/schema';
import { DraftResult, EdgeKind, Piece } from '../types';
import { Snug, tightsReduction } from './tights';
import { MissingMeasurementsError } from './tshirt';

export type SockLength = 'ankle' | 'crew' | 'high' | 'knee' | 'over' | 'custom';

export interface SocksParams {
  stretch: number;
  seams: 1 | 2;
  length: SockLength;
  /** length が custom のときの丈（足裏から履き口まで cm） */
  lengthCustom: number | null;
  top: 'hem' | 'fold' | 'elastic';
  snug: Snug;
  reduceCustom: number | null;
}

export const DEFAULT_SOCKS: SocksParams = {
  stretch: 40,
  seams: 2,
  length: 'crew',
  lengthCustom: null,
  top: 'hem',
  snug: 'normal',
  reduceCustom: null,
};

export const SOCK_LENGTH_LABEL: Record<SockLength, string> = {
  ankle: 'くるぶし',
  crew: 'クルー（ふくらはぎの下）',
  high: 'ハイソックス（膝下）',
  knee: 'ニーハイ',
  over: 'オーバーニー',
  custom: '自分で入力',
};

export const SOCKS_REQUIREMENTS: { key: MeasurementKey; hard: boolean }[] = [
  { key: 'foot_length', hard: true },
  { key: 'calf_circ', hard: false },
  { key: 'thigh_circ', hard: false },
  { key: 'knee_height', hard: false },
  { key: 'inseam', hard: false },
  { key: 'foot_pass_circ', hard: false },
];

const fmt = (x: number) => (Math.round(x * 10) / 10).toFixed(1);
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const finite = (x: number | null): x is number => x !== null && Number.isFinite(x);
const poly = (pts: Vec[]): Seg[] => pts.slice(1).map((q, i) => line(pts[i], q));

export function draftSocks(r: ResolvedBody, p: SocksParams): DraftResult {
  const missing = SOCKS_REQUIREMENTS.filter((q) => r.values[q.key] === undefined).map((q) => q.key);
  if (missing.length > 0) throw new MissingMeasurementsError(missing);
  const val = (k: MeasurementKey) => r.values[k] as number;
  const warnings: string[] = [];
  const info: string[] = [];
  const s = p.stretch / 100;
  const red = tightsReduction({ ...p, opening: 'none' });
  const W = 1 - red;
  const V = 1 - red * 0.3;

  // ---- 足 ----
  const fl = val('foot_length') * V;
  const fh = (r.values.foot_height ?? val('foot_length') * 0.4) * V; // 足裏から足首まで
  const fw = r.values.foot_width ?? val('foot_length') * 0.38;
  const instepH = ((fh + fw) / 1.0) * W * 0.95; // 足の甲の高さ（横から見た型紙の高さ）。2 枚で足の周りになる
  // ---- 脚の周り（高さ → 周り） ----
  const kh = val('knee_height');
  const calf = val('calf_circ');
  let ankle = r.values.ankle_circ ?? calf * 0.62;
  const footNeed = val('foot_pass_circ') / (1 + s);
  if (ankle * W < footNeed) {
    ankle = footNeed / W;
    info.push('足が通るように足首を広げました');
  }
  const knee = Math.max(calf, val('thigh_circ') * 0.72);
  const thighAt = val('inseam') * 0.92;
  const levels: [number, number][] = [
    [fh, ankle],
    [fh + (kh - fh) * 0.55, calf],
    [kh, knee],
    [thighAt, val('thigh_circ')],
  ];
  const circAt = (h: number) => {
    if (h <= levels[0][0]) return levels[0][1] * W;
    for (let i = 1; i < levels.length; i++) {
      const [h0, c0] = levels[i - 1];
      const [h1, c1] = levels[i];
      if (h <= h1) return (c0 + ((c1 - c0) * (h - h0)) / (h1 - h0)) * W;
    }
    return levels[levels.length - 1][1] * W;
  };
  const topH =
    p.length === 'custom' && finite(p.lengthCustom)
      ? Math.max(p.lengthCustom, fh * 1.2)
      : {
          ankle: fh * 1.35,
          crew: fh + (kh - fh) * 0.45,
          high: kh * 0.9,
          knee: kh + (val('inseam') - kh) * 0.15,
          over: kh + (val('inseam') - kh) * 0.45,
          custom: fh + (kh - fh) * 0.45,
        }[p.length] * V;
  const legLen = topH - fh; // 足首から履き口まで
  // 折り返しの履き口は、折る分だけ上に足す
  const cuff = p.top === 'fold' ? clamp(legLen * 0.25, 0.5, 3) : 0;
  const topKind: EdgeKind = 'hem';
  const sample = (n: number) => Array.from({ length: n + 1 }, (_, i) => fh + (legLen * i) / n);

  const pieces: Piece[] = [];
  if (p.seams === 2) {
    // 横から見た形。x は前向きが正、y は履き口が 0 で下向き。足首の高さで脚の中心を x = 0 にする
    const yOf = (h: number) => topH + cuff - h;
    const heights = sample(6).reverse(); // 上から下へ
    const half = (h: number) => circAt(h) / 4;
    // 折り返しの分（cuff）は履き口と同じ幅でまっすぐ上へ
    const withCuff = (pts: Vec[]) => (cuff > 0 ? [v(pts[0].x, 0), ...pts] : pts);
    const front: Vec[] = withCuff(heights.map((h) => v(half(h), yOf(h))));
    const back: Vec[] = withCuff(heights.map((h) => v(-half(h), yOf(h))));
    const ankF = front[front.length - 1];
    const ankB = back[back.length - 1];
    const sole = yOf(0);
    const heelX = ankB.x - fh * 0.25;
    const toeX = heelX + fl;
    const toeTop = v(toeX - instepH * 0.45, sole - instepH * 0.5);
    // 足首からは脚の線の向きのまま下りて、足の甲へなめらかに曲がる（縫い代が角で輪にならないように）
    const legDir = front.length > 1 ? front[front.length - 1].x - front[front.length - 2].x : 0;
    const drop = Math.max(0.2, (toeTop.y - ankF.y) * 0.55);
    const instep = cubic(ankF, v(ankF.x + legDir * 0.2, ankF.y + drop), v(Math.max(ankF.x + 0.05, toeTop.x - (toeTop.x - ankF.x) * 0.6), toeTop.y), toeTop);
    const toe = cubic(toeTop, v(toeX + instepH * 0.05, toeTop.y), v(toeX + instepH * 0.05, sole), v(toeX - instepH * 0.4, sole));
    const heel = cubic(v(heelX + fh * 0.35, sole), v(heelX - fh * 0.05, sole), v(heelX - fh * 0.1, ankB.y + (sole - ankB.y) * 0.4), ankB);
    pieces.push({
      id: 'sock',
      name: '靴下（横から見た形・内側と外側）',
      cut: '4枚（2 足分・内側と外側）',
      edges: [
        { segs: [line(back[0], front[0])], kind: topKind, name: '履き口' },
        { segs: [...poly(front), instep, toe], kind: 'seam', name: '前の縫い目' },
        { segs: [line(v(toeX - instepH * 0.4, sole), v(heelX + fh * 0.35, sole)), heel, ...poly([...back].reverse())], kind: 'seam', name: '後ろの縫い目' },
      ],
      grain: [v(0, cuff + legLen * 0.15), v(0, cuff + legLen * 0.85)],
      marks: cuff > 0 ? [[v(-half(topH), cuff), v(half(topH), cuff)]] : undefined,
    });
  } else {
    // 前を「わ」にした 1 枚（右半分を描く）。x は前中心が 0、y は履き口が 0 で下向き
    const yOf = (h: number) => topH + cuff - h;
    const heights = sample(6).reverse();
    const half = (h: number) => circAt(h) / 2;
    const edgeLeg = heights.map((h) => v(half(h), yOf(h)));
    const edge: Vec[] = cuff > 0 ? [v(edgeLeg[0].x, 0), ...edgeLeg] : edgeLeg;
    const ank = edge[edge.length - 1];
    const instepLen = Math.hypot(fl * 0.8, fh) * 1.0;
    const tip = v(0, ank.y + instepLen);
    // 辺（かかと ＋ 足裏）の長さが、かかとの高さ ＋ 足の長さ になるよう、外への張り出しを決める
    const target = fh * 0.9 + fl;
    const footW = instepH; // 足の周りの半分
    const build = (k: number) => cubic(ank, v(ank.x + footW * k, ank.y + instepLen * 0.35), v(footW * (0.6 + k * 0.5), tip.y - instepLen * 0.05), tip);
    let lo = 0;
    let hi = 6;
    for (let i = 0; i < 50; i++) {
      const mid = (lo + hi) / 2;
      if (pathLength([build(mid)]) < target) lo = mid;
      else hi = mid;
    }
    const footEdge = build((lo + hi) / 2);
    pieces.push({
      id: 'sock',
      name: '靴下（前がわ）',
      cut: '2枚（わ・2 足分）',
      edges: [
        { segs: [line(v(0, 0), edge[0])], kind: topKind, name: '履き口' },
        { segs: [...poly(edge), footEdge], kind: 'seam', name: '縫い目（脚の後ろ〜かかと〜足裏〜つま先）' },
        { segs: [line(tip, v(0, 0))], kind: 'fold', name: '前中心（わ）' },
      ],
      grain: [v(Math.max(0.3, ank.x * 0.4), cuff + legLen * 0.15), v(Math.max(0.3, ank.x * 0.4), cuff + legLen * 0.85)],
      marks: cuff > 0 ? [[v(0, cuff), v(half(topH), cuff)]] : undefined,
    });
  }

  info.unshift(
    `縫い目 ${p.seams} 本 ／ 丈 足裏から ${fmt(topH)}cm（${SOCK_LENGTH_LABEL[p.length]}）`,
    `周りを ${fmt(red * 100)}% 小さく（伸び率 ${p.stretch}%）／ 足首の口 ${fmt(ankle * W)}cm（伸ばして ${fmt(ankle * W * (1 + s))}cm・足が通る周り ${fmt(val('foot_pass_circ'))}cm）`,
  );
  if (p.top === 'fold') info.push(`履き口: ${fmt(cuff)}cm 折り返します（印の線で外へ折る）`);
  if (p.top === 'elastic') info.push('履き口: 縫い代にゴム（細いもの）を入れて三つ折りにします');
  if (p.top === 'hem') info.push('履き口: 三つ折り');
  info.push('布は伸びる薄手（ナイロンスムース・ストッキング生地など）を');
  info.push(`カテゴリ ${r.category ?? '未分類'}${r.categoryGuessed ? '（仮）' : ''}`);
  return { pieces, warnings, info, refs: { length: topH, snug: red * 100 }, refUnits: { snug: '%' } };
}
