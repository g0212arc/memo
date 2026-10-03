// 色移り防止タイツ（全身タイツ）= 前・後ろ（胴と脚が一続き、各左右 2 枚）＋ 袖 ＋（足先のパーツ）。
// 伸びる布で、採寸値より小さく裁って伸ばして着せる。小さくする量は布の伸び率と開きの有無から決める。
// 座標: x は前（後ろ）中心を 0 として脇へ正、y は首の付け根（SNP）の高さを 0 として下へ正。

import { Vec, v } from '../../geometry/vec';
import { cubic, line, mapSeg, pathLength, Seg } from '../../geometry/path';
import { bustLarge, TIGHTS_BUST_DART_RATIO } from '../bust';
import { ResolvedBody } from '../../model/estimate';
import { MeasurementKey } from '../../model/schema';
import { draftSleeve } from '../sleeve';
import { DraftResult, Edge, EdgeKind, Piece } from '../types';
import { MissingMeasurementsError } from './tshirt';

export type TightsCoverage = 'leotard' | 'full' | 'feet';
export type Snug = 'loose' | 'normal' | 'tight' | 'custom';

export interface TightsParams {
  stretch: number;
  coverage: TightsCoverage;
  sleeve: 'long' | 'half' | 'none';
  neck: 'turtle' | 'scoop';
  opening: 'none' | 'zip';
  snug: Snug;
  /** snug が custom のときに周りを何％小さくするか */
  reduceCustom: number | null;
  /** 胸ダーツ（胸囲 ÷ ウエスト が 1.5 以上のときだけ効く） */
  bustDart: boolean;
}

export const DEFAULT_TIGHTS: TightsParams = {
  stretch: 40,
  coverage: 'full',
  sleeve: 'long',
  neck: 'turtle',
  opening: 'none',
  snug: 'normal',
  reduceCustom: null,
  bustDart: true,
};

export const COVERAGE_LABEL: Record<TightsCoverage, string> = {
  leotard: '胴だけ（レオタード型）',
  full: '全身（首〜手首・足首）',
  feet: '全身＋足先（靴下のように足も包む）',
};
export const SNUG_LABEL: Record<Snug, string> = { loose: 'ゆるめ', normal: '普通', tight: 'きつめ', custom: '自分で入力' };

export const TIGHTS_REQUIREMENTS: { key: MeasurementKey; hard: boolean }[] = [
  { key: 'chest_circ', hard: true },
  { key: 'waist_circ', hard: true },
  { key: 'hip_circ', hard: true },
  { key: 'neck_circ', hard: false },
  { key: 'neck_length', hard: false },
  { key: 'shoulder_width', hard: false },
  { key: 'back_length', hard: false },
  { key: 'waist_to_hip', hard: false },
  { key: 'rise', hard: false },
  { key: 'armhole_circ', hard: false },
  { key: 'arm_length', hard: false },
  { key: 'upper_arm_circ', hard: false },
  { key: 'elbow_pass_circ', hard: false },
  { key: 'inseam', hard: false },
  { key: 'thigh_circ', hard: false },
  { key: 'calf_circ', hard: false },
  { key: 'knee_height', hard: false },
  { key: 'foot_length', hard: false },
  { key: 'foot_pass_circ', hard: false },
];

/** 周りを小さくする割合（0〜1） */
export function tightsReduction(p: Pick<TightsParams, 'stretch' | 'opening' | 'snug' | 'reduceCustom'>): number {
  if (p.snug === 'custom' && p.reduceCustom !== null && Number.isFinite(p.reduceCustom)) return Math.min(0.5, Math.max(0, p.reduceCustom / 100));
  const base = (p.stretch / 100) * (p.opening === 'none' ? 0.25 : 0.08);
  return Math.min(0.5, base * { loose: 0.5, normal: 1, tight: 1.5, custom: 1 }[p.snug]);
}

const fmt = (x: number) => (Math.round(x * 10) / 10).toFixed(1);
const poly = (pts: Vec[]): Seg[] => pts.slice(1).map((q, i) => line(pts[i], q));

export function draftTights(r: ResolvedBody, p: TightsParams): DraftResult {
  const missing = TIGHTS_REQUIREMENTS.filter((q) => r.values[q.key] === undefined).map((q) => q.key);
  if (missing.length > 0) throw new MissingMeasurementsError(missing);
  const val = (k: MeasurementKey) => r.values[k] as number;
  const warnings: string[] = [];
  const info: string[] = [];
  const s = p.stretch / 100;
  const red = tightsReduction(p);
  const W = 1 - red; // 周り
  const V = 1 - red * 0.3; // 長さ
  const zip = p.opening === 'zip';

  // ---- 胴 ----
  const neck = val('neck_circ');
  const turtle = p.neck === 'turtle';
  const nw = turtle ? (neck * W) / 4 : neck * 0.2; // 首の付け根での半幅（前・後ろそれぞれ）
  const nh = turtle ? val('neck_length') * 0.8 * V : 0; // タートルの高さ
  const SP = v(Math.max(nw + 0.3, (val('shoulder_width') / 2) * (1 - red * 0.5)), val('shoulder_width') * 0.06);
  const cq = (val('chest_circ') * W) / 4;
  const wq = (val('waist_circ') * W) / 4;
  const hq = (val('hip_circ') * W) / 4;
  const yA = SP.y + val('armhole_circ') * 0.36 * V;
  const yW = val('back_length') * V;
  const yH = yW + val('waist_to_hip') * V;
  const yC = yW + val('rise') * V;

  // ---- 脚の周り（手首・足首の口は、伸ばして肘・足が通る大きさ以上） ----
  const thigh = val('thigh_circ') * W;
  const calf = val('calf_circ') * W;
  const knee = Math.max(calf, thigh * 0.72);
  let ankle = (r.values.ankle_circ ?? val('calf_circ') * 0.62) * W;
  const footNeed = val('foot_pass_circ') / (1 + s);
  if (p.coverage !== 'leotard' && ankle < footNeed) {
    ankle = footNeed;
    info.push('足が通るように足首を広げました');
  }
  const ankleH = r.values.foot_height ?? val('inseam') * 0.06;
  const yK = yC + (val('inseam') - val('knee_height')) * V;
  const yAnk = yC + (val('inseam') - ankleH) * V;
  const yCalf = yK + (yAnk - yK) * 0.3;

  // 胸ダーツ: 前を（前丈 − 背丈）だけ長くし、脇からのダーツで詰める
  const dartDelta =
    p.bustDart && bustLarge(r.values, TIGHTS_BUST_DART_RATIO) && r.values.front_length !== undefined
      ? Math.max(0, (r.values.front_length - val('back_length')) * V)
      : 0;
  const yU = yA + (yW - yA) * 0.3;

  // 肩が胸より広いボディでも袖ぐりの底が鉤形にならないよう、底の手前は脇へ向けて寝かせる
  const armholeFor = (): Seg[] => [
    cubic(SP, v(SP.x, SP.y + (yA - SP.y) * 0.55), v(SP.x > cq ? cq + (SP.x - cq) * 0.15 : cq - (cq - SP.x) * 0.6, yA), v(cq, yA)),
  ];
  const sleeveless = p.sleeve === 'none';

  const half = (isFront: boolean): { piece: Piece; armhole: Seg[]; neckLen: number } => {
    const edges: Edge[] = [];
    const cbKind: EdgeKind = 'seam';
    // 首
    let neckLen: number;
    if (turtle) {
      edges.push(
        { segs: [line(v(0, -nh), v(nw, -nh))], kind: 'hem', name: '首の口' },
        { segs: [line(v(nw, -nh), v(nw, 0))], kind: 'seam', name: 'タートルの脇' },
      );
      neckLen = nw;
    } else {
      const depth = isFront ? nw * 1.4 : nw * 0.35;
      const curve = cubic(v(0, depth), v(nw * 0.6, depth), v(nw, depth * 0.5), v(nw, 0));
      edges.push({ segs: [curve], kind: 'hem', name: '襟ぐり' });
      neckLen = pathLength([curve]);
    }
    const snp = v(nw, 0);
    const armhole = armholeFor();
    edges.push(
      { segs: [line(snp, SP)], kind: 'seam', name: '肩' },
      { segs: armhole, kind: sleeveless ? 'hem' : 'seam', name: '袖ぐり' },
    );
    // 股の位置: 後ろは座る分だけ股のまちを大きく
    const xi0 = hq - thigh / 2 - (isFront ? 0 : val('hip_circ') * 0.03);
    const c = (hq + xi0) / 2; // 脚の中心
    const yCF = yW + (yC - yW) * 0.5;
    const crotch = cubic(v(xi0, yC), v(xi0 * 0.5, yC), v(0, yCF + (yC - yCF) * 0.6), v(0, yCF));
    if (p.coverage === 'leotard') {
      // 脚ぐり: 脇（ヒップの少し下）→ 股
      const cw = Math.max(0.4, hq * 0.22);
      const legTop = v(hq, yW + (yC - yW) * 0.55);
      edges.push(
        { segs: poly([v(cq, yA), v(wq, yW), v(hq, Math.min(yH, legTop.y)), legTop]), kind: 'seam', name: '脇' },
        { segs: [cubic(legTop, v(hq * 0.75, legTop.y + (yC - legTop.y) * 0.2), v(cw * 1.2, yC), v(cw, yC))], kind: 'hem', name: '脚ぐり' },
        { segs: [line(v(cw, yC), v(0, yC))], kind: 'seam', name: '股（前後を縫う）' },
        { segs: [line(v(0, yC), v(0, isFront || !zip ? (turtle ? -nh : nw * (isFront ? 1.4 : 0.35)) : yW))], kind: cbKind, name: isFront ? '前中心' : '後ろ中心' },
      );
    } else {
      const tw = thigh / 4 + (isFront ? 0 : val('hip_circ') * 0.015);
      const kw = knee / 4;
      const calfw = calf / 4;
      const aw = ankle / 4;
      edges.push(
        { segs: poly([v(cq, yA), v(wq, yW), v(hq, yH), v(c + tw, yC), v(c + kw, yK), v(c + calfw, yCalf), v(c + aw, yAnk)]), kind: 'seam', name: '脇' },
        { segs: [line(v(c + aw, yAnk), v(c - aw, yAnk))], kind: p.coverage === 'feet' ? 'seam' : 'hem', name: p.coverage === 'feet' ? '足首（足先付け）' : '足首' },
        { segs: poly([v(c - aw, yAnk), v(c - calfw, yCalf), v(c - kw, yK), v(xi0, yC)]), kind: 'seam', name: '股下' },
        { segs: [crotch], kind: 'seam', name: '股ぐり' },
        { segs: [line(v(0, yCF), v(0, isFront || !zip ? (turtle ? -nh : nw * (isFront ? 1.4 : 0.35)) : yW))], kind: cbKind, name: isFront ? '前中心' : '後ろ中心' },
      );
    }
    // 背中ファスナー: 後ろ中心の上（首〜ウエスト）を開きにする
    if (!isFront && zip) {
      const top = turtle ? -nh : nw * 0.35;
      edges.push({ segs: [line(v(0, yW), v(0, top))], kind: 'opening', name: '後ろ中心（ファスナー付け）' });
    }
    let marks: Vec[][] | undefined;
    if (isFront && dartDelta > 0.1) {
      // ダーツより下を下へずらし、脇にダーツ分の縦線を入れる
      const down = (q: Vec) => (q.y > yU + 1e-9 ? v(q.x, q.y + dartDelta) : q);
      for (const e of edges) {
        if (e.name !== '脇') {
          e.segs = e.segs.map((sg) => mapSeg(sg, down));
          continue;
        }
        const pts = [e.segs[0].from, ...e.segs.map((sg) => sg.to)];
        const i = pts.findIndex((q) => q.y > yU);
        const a = pts[i - 1];
        const bq = pts[i];
        const U = v(a.x + ((bq.x - a.x) * (yU - a.y)) / (bq.y - a.y), yU);
        const Lp = v(U.x, yU + dartDelta);
        e.segs = poly([...pts.slice(0, i), U, Lp, ...pts.slice(i).map(down)]);
        const bpX = Math.min(val('chest_circ') * 0.1, cq * 0.6);
        const apex = v(Math.max(cq * 0.3, Math.min(bpX + cq * 0.12, U.x - dartDelta * 1.5)), yU + dartDelta / 2);
        marks = [[U, apex, Lp]];
      }
    }
    const piece: Piece = {
      marks,
      id: isFront ? 'front' : 'back',
      name: isFront ? '前（胴・脚続き）' : '後ろ（胴・脚続き）',
      cut: '2枚（左右反転）',
      edges,
      grain: [v(Math.max(0.5, cq * 0.4), yA), v(Math.max(0.5, cq * 0.4), Math.min(yC, yH))],
    };
    return { piece, armhole, neckLen };
  };

  const f = half(true);
  const b = half(false);
  const pieces: Piece[] = [f.piece, b.piece];

  // ---- 袖 ----
  if (!sleeveless) {
    const long = p.sleeve === 'long';
    const ah = pathLength(f.armhole);
    const sleeve = draftSleeve({
      frontArmholeLength: ah,
      backArmholeLength: ah,
      upperArm: val('upper_arm_circ') * W,
      armEase: 0,
      armLength: val('arm_length') * V,
      lengthRatio: long ? 1 : 0.4,
      widthRatio: 0.92,
      capEase: 0,
      hemRatio: long ? 0.62 : 0.95,
      // 伸ばして肘・手が通る
      minPass: val('elbow_pass_circ') / (1 + s),
      extraWidth: 0,
    });
    warnings.push(...sleeve.warnings.filter((w) => !w.includes('袖幅')));
    pieces.push(sleeve.piece);
    info.push(`袖: ${long ? '長袖（手首まで）' : '半袖'} ／ 袖山 ${fmt(sleeve.capLength)}cm`);
    if (sleeve.widenedHem || sleeve.widenedWidth) info.push('肘が通るように袖口を広げました');
  }

  // ---- 足先（靴下形。足ごとに内側・外側の 2 枚） ----
  if (p.coverage === 'feet') {
    const fl = val('foot_length') * V;
    const fh = (r.values.foot_height ?? fl * 0.42) * V;
    const aw2 = ankle / 2;
    const heel = cubic(v(0, 0), v(-fh * 0.15, fh * 0.5), v(-fh * 0.1, fh), v(fh * 0.35, fh));
    const toe = cubic(v(fl * 0.8, fh), v(fl * 1.02, fh), v(fl * 1.02, fh * 0.45), v(fl * 0.8, fh * 0.35));
    pieces.push({
      id: 'foot',
      name: '足先（内側・外側）',
      cut: '4枚（左右の足・内側と外側）',
      edges: [
        { segs: [line(v(aw2, 0), v(0, 0))], kind: 'seam', name: '足首（脚と縫う）' },
        { segs: [heel, line(v(fh * 0.35, fh), v(fl * 0.8, fh)), toe], kind: 'seam', name: 'かかと・足裏' },
        { segs: [cubic(v(fl * 0.8, fh * 0.35), v(fl * 0.55, fh * 0.2), v(aw2 * 1.1, fh * 0.1), v(aw2, 0))], kind: 'seam', name: '足の甲' },
      ],
      grain: [v(fl * 0.25, fh * 0.3), v(fl * 0.6, fh * 0.75)],
    });
  }

  // ---- 着せられるか（開きなし: 首の口から体を入れる） ----
  const neckOpen = 4 * (turtle ? nw : (f.neckLen + b.neckLen) / 2) * (1 + s);
  if (!zip && neckOpen < val('chest_circ') * 0.85) {
    warnings.push(
      `首の口（伸ばして約 ${fmt(neckOpen)}cm）が小さく、体が入らない可能性があります。普通の襟ぐりにするか、背中ファスナーにしてください。`,
    );
  }

  info.unshift(
    `${COVERAGE_LABEL[p.coverage]} ／ ${zip ? '背中ファスナー（ほぼぴったり）' : '開きなし（伸ばして着せるので小さめ）'}`,
    `周りを ${fmt(red * 100)}% 小さく（伸び率 ${p.stretch}%・${SNUG_LABEL[p.snug]}）、長さを ${fmt(red * 30)}% 短く`,
    `胸 ${fmt(cq * 4)}cm ／ ウエスト ${fmt(wq * 4)}cm ／ ヒップ ${fmt(hq * 4)}cm（でき上がり）`,
  );
  if (p.coverage !== 'leotard') info.push(`足首の口 ${fmt(ankle)}cm（伸ばして ${fmt(ankle * (1 + s))}cm ／ 足が通る周り ${fmt(val('foot_pass_circ'))}cm）`);
  if (dartDelta > 0.1) info.push(`胸ダーツ ${fmt(dartDelta)}cm（前丈と背丈の差）`);
  if (zip) info.push(`ファスナー: 後ろ中心 首〜ウエスト 約 ${fmt(yW + nh)}cm`);
  info.push('布は伸びる薄手（ナイロンスムース・パワーネットなど）を。色移りを防ぐなら白か淡い色がおすすめです');
  info.push(`カテゴリ ${r.category ?? '未分類'}${r.categoryGuessed ? '（仮）' : ''}`);
  return { pieces, warnings, info };
}
