// ラグラン袖シャツ = Tシャツの身頃原型から、首 → 袖ぐりへ斜めの線（ラグラン線）で肩の部分を切り取り、袖の上につなげる。
// 袖の座標: 肩先（SP）が原点、袖の中心線が y 軸（下向き）。前は左（x < 0）、後ろは右（x > 0）。
// 身頃の点は「袖の中心線の向きが下になるよう回す」だけで袖の座標へ移す（形と長さはそのまま）。
// 1枚袖: 前後の肩線のあいだの三角が肩ダーツになる。2枚袖: 肩線〜袖の中心線で前後に分けて縫う。

import { Vec, v, add, sub, mul, dist, normalize, lerp } from '../../geometry/vec';
import { CubicSeg, Seg, cubic, line, pathLength, mapSeg, reverseSeg } from '../../geometry/path';
import { rotate, splitCubic } from '../../geometry/transform';
import { ResolvedBody } from '../../model/estimate';
import { MeasurementKey } from '../../model/schema';
import { draftBodice } from '../bodice';
import { openingExtOf } from '../opening';
import { useBustDart } from '../bust';
import { defaultEase, scaleEase } from '../ease';
import { applyFit } from '../fit';
import { CATEGORY_EASE } from '../../model/category';
import { DraftResult, Edge, Piece } from '../types';
import { DEFAULT_TSHIRT, MissingMeasurementsError, TSHIRT_REQUIREMENTS, TshirtParams } from './tshirt';

export type RaglanSleeveLength = 'short' | 'three' | 'long' | 'custom';

export interface RaglanParams extends Omit<TshirtParams, 'sleeveRatio' | 'frontNeckDrop'> {
  /** 肩の作り: 1枚袖＋肩ダーツ／2枚袖 */
  shoulder: 'dart' | 'two';
  neck: 'crew' | 'v';
  sleeve: RaglanSleeveLength;
  /** sleeve が custom のときの袖丈（肩先から cm） */
  sleeveCustom: number | null;
  /** 前襟ぐりを下げる（cm）。Vネックでは V の深さに足す */
  frontNeckDrop: number;
}

const { sleeveRatio: _sr, ...TSHIRT_BASE } = DEFAULT_TSHIRT;
export const DEFAULT_RAGLAN: RaglanParams = {
  ...TSHIRT_BASE,
  shoulder: 'dart',
  neck: 'crew',
  sleeve: 'short',
  sleeveCustom: null,
};

export const RAGLAN_SLEEVE_LABEL: Record<RaglanSleeveLength, string> = { short: '半袖', three: '七分袖', long: '長袖', custom: '自分で入力' };
const SLEEVE_RATIO: Record<Exclude<RaglanSleeveLength, 'custom'>, number> = { short: 0.3, three: 0.75, long: 1 };
const HEM_RATIO: Record<Exclude<RaglanSleeveLength, 'custom'>, number> = { short: 0.95, three: 0.85, long: 0.78 };

export const RAGLAN_REQUIREMENTS: { key: MeasurementKey; hard: boolean }[] = TSHIRT_REQUIREMENTS;

const fmt = (x: number) => (Math.round(x * 10) / 10).toFixed(1);
const finite = (x: number | null): x is number => x !== null && Number.isFinite(x);
const lerpLine = (a: Vec, b: Vec, t: number) => lerp(a, b, t);

export function draftRaglan(r: ResolvedBody, p: RaglanParams): DraftResult {
  const missing = RAGLAN_REQUIREMENTS.filter((q) => r.values[q.key] === undefined).map((q) => q.key);
  if (missing.length > 0) throw new MissingMeasurementsError(missing);
  const val = (k: MeasurementKey) => r.values[k] as number;
  const woven = p.fabric === 'woven';
  const warnings: string[] = [];

  const categoryEase = r.category ? CATEGORY_EASE[r.category] : 1;
  const ease = applyFit(
    scaleEase(
      defaultEase(p.fabric, { chest: val('chest_circ'), hip: val('hip_circ'), upperArm: val('upper_arm_circ'), armhole: val('armhole_circ') }),
      categoryEase,
    ),
    p.fitBody,
    p.fitSleeve,
  );
  const fitChest = ease.chest;
  ease.chest += p.extraChestEase;
  ease.armhole += p.extraArmholeEase;

  const chest = val('chest_circ');
  const openingExt = openingExtOf(p, chest); // 持ち出しの幅（片側）
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
      waistToHip: val('waist_to_hip'),
    },
    {
      ease,
      woven,
      neckWiden: 0.02,
      frontNeckDrop: p.neck === 'crew' ? p.frontNeckDrop : 0,
      shoulderExtend: val('shoulder_width') * 0.03,
      hemBelowWaist: p.hemBelowWaist ?? val('waist_to_hip') * { short: 0.4, normal: 0.8, long: 1.3 }[p.length],
      armholeEase: ease.armhole,
      backOpening: p.backOpening,
      bustDart: useBustDart(r, p),
      openingExt,
    },
  );
  warnings.push(...bodice.warnings);
  const g = bodice.geom;

  // ---- 身頃にラグラン線を引く ----
  const edgeOf = (pc: Piece, name: string) => pc.edges.find((e) => e.name === name)!;
  // Vネック: SNP から前中心へまっすぐ。深さは丸首の約 2 倍
  const vDepth = g.frontNeckDepth * 2 + p.frontNeckDrop;
  const NECK_T = 0.55; // 襟ぐりの、中心からこの割合の位置からラグラン線を引く
  interface Half {
    keep: Seg; // 身頃に残る襟ぐり（中心 → N）
    toSleeve: Seg; // 袖に移る襟ぐり（N → SNP）
    raglan: CubicSeg; // N → A
    lower: Seg[]; // 袖ぐりの下の部分 A → 脇
  }
  /** 袖ぐり（肩先 → 脇）を、脇から長さ lowLen のところで分ける */
  const splitArmhole = (ah: Seg[], lowLen: number): Seg[] => {
    const [s1, s2] = ah as CubicSeg[];
    const cut = (c: CubicSeg, want: number): CubicSeg => {
      let lo = 0;
      let hi = 1;
      for (let i = 0; i < 50; i++) {
        const mid = (lo + hi) / 2;
        if (pathLength([splitCubic(c, mid)[1]]) > want) lo = mid;
        else hi = mid;
      }
      return splitCubic(c, (lo + hi) / 2)[1];
    };
    const l2 = pathLength([s2]);
    if (lowLen <= l2) return [cut(s2, lowLen)];
    return [cut(s1, Math.min(lowLen - l2, pathLength([s1]) * 0.9)), s2];
  };
  const half = (pc: Piece, neck: Seg, lowFrac: number): Half => {
    let keep: Seg;
    let toSleeve: Seg;
    if (neck.kind === 'cubic') [keep, toSleeve] = splitCubic(neck, NECK_T);
    else {
      const m = lerpLine(neck.from, neck.to, NECK_T);
      keep = line(neck.from, m);
      toSleeve = line(m, neck.to);
    }
    const ah = edgeOf(pc, '袖ぐり').segs;
    const lower = splitArmhole(ah, pathLength(ah) * lowFrac);
    const first = lower[0] as CubicSeg;
    const N = keep.to;
    const A = first.from;
    const tA = dist(first.c1, A) > 1e-9 ? normalize(sub(first.c1, A)) : v(0, 1);
    const d = dist(N, A);
    const raglan = cubic(N, lerp(N, A, 1 / 3), sub(A, mul(tA, d / 3)), A);
    return { keep, toSleeve, raglan, lower };
  };
  const backNeck = edgeOf(bodice.back, '襟ぐり').segs[0];
  const frontNeck = p.neck === 'v' ? line(v(0, vDepth), g.snp) : edgeOf(bodice.front, '襟ぐり').segs[0];

  const reshape = (pc: Piece, h: Half, isFront: boolean): Piece => ({
    ...pc,
    edges: pc.edges.map((e): Edge => {
      if (e.name === '襟ぐり') return { ...e, segs: [h.keep] };
      if (e.name === '肩') return { segs: [h.raglan], kind: 'seam', name: 'ラグラン線' };
      if (e.name === '袖ぐり') return { segs: h.lower, kind: 'seam', name: '袖ぐり（袖下）' };
      if (isFront && p.neck === 'v' && e.name === '前中心（わ）') return { ...e, segs: [line(v(0, g.frontHemY), v(0, vDepth))] };
      return e;
    }),
  });
  // ---- 袖 ----
  // 袖の中心線の角度（水平から下へ）。小さいほど腕を上げた形で、肩ダーツが小さく、脇下にゆとりが出る
  const theta = woven ? 40 : 32;
  const toSleeve = (sp: Vec, mirror: boolean) => (q: Vec) => {
    const rq = rotate(sub(q, sp), v(0, 0), 90 - theta);
    return mirror ? v(-rq.x, rq.y) : rq;
  };
  const fB = toSleeve(g.backSP, true);
  const fF = toSleeve(g.frontSP, false);

  const minPass = val('elbow_pass_circ') + ease.pass;
  const baseWidth = val('upper_arm_circ') + ease.arm + p.extraSleeveWidth;
  const width = Math.max(baseWidth, minPass);
  const wb = width / 2 + width * 0.02;
  const wf = width / 2 - width * 0.02;

  // 袖下のカーブ（A' → 袖幅の点 W'）。長さが身頃の袖ぐりの下の部分と同じになる高さを二分法で求める
  const underarm = (A: Vec, dirA: Vec, wx: number, target: number) => {
    const make = (y: number) => {
      const W = v(wx, y);
      const k = dist(A, W) * 0.4;
      return cubic(A, add(A, mul(dirA, k)), v(W.x - (W.x - A.x) * 0.45, W.y), W);
    };
    let lo = A.y + 0.05;
    let hi = A.y + target;
    const ok = pathLength([make(lo)]) <= target;
    if (!ok) hi = lo;
    for (let i = 0; i < 60 && hi - lo > 1e-6; i++) {
      const mid = (lo + hi) / 2;
      if (pathLength([make(mid)]) < target) lo = mid;
      else hi = mid;
    }
    return { curve: make((lo + hi) / 2), ok };
  };
  const sleeveHalf = (h: Half, f: (q: Vec) => Vec, wx: number) => {
    const snp = f(g.snp);
    const neck = reverseSeg(mapSeg(h.toSleeve, f)); // SNP' → N'
    const raglan = mapSeg(h.raglan, f) as CubicSeg; // N' → A'
    const dirA = normalize(sub(raglan.to, raglan.c2));
    const { curve, ok } = underarm(raglan.to, dirA, wx, pathLength(h.lower)); // A' → W'
    return { snp, neck, raglan, curve, ok };
  };
  // ラグラン線の下端（袖ぐりの脇からの割合）。袖が太くて袖下のカーブが届かないときは上へずらす
  let hb!: Half;
  let hf!: Half;
  let sb!: ReturnType<typeof sleeveHalf>;
  let sf!: ReturnType<typeof sleeveHalf>;
  let lowFrac = 0.3;
  for (; lowFrac <= 0.6 + 1e-9; lowFrac += 0.05) {
    hb = half(bodice.back, backNeck, lowFrac);
    hf = half(bodice.front, frontNeck, lowFrac);
    sb = sleeveHalf(hb, fB, wb);
    sf = sleeveHalf(hf, fF, -wf);
    if (sb.ok && sf.ok) break;
  }
  // それでも届かない（腕の付け根に対して袖幅が太い。前腕が太いボディなど）ときは、脇下の袖幅を細くして袖口へ広げる
  let narrowed = false;
  if (!sb.ok || !sf.ok) {
    lowFrac = 0.6;
    hb = half(bodice.back, backNeck, lowFrac);
    hf = half(bodice.front, frontNeck, lowFrac);
    for (let k = 0.98; k > 0.05; k -= 0.02) {
      sb = sleeveHalf(hb, fB, wb * k);
      sf = sleeveHalf(hf, fF, -wf * k);
      if (sb.ok && sf.ok) break;
    }
    narrowed = true;
    if (!sb.ok || !sf.ok) warnings.push('袖幅が広く、袖下のカーブを袖ぐりの長さに合わせられません。袖幅か袖ぐりのゆとりを確認してください。');
  }
  // 前後の脇下の点（袖幅の点）の高さをそろえる（袖下を縫い合わせる長さがそろうように）。
  // 高い方は袖幅を少し細くすると、袖下のカーブの長さはそのままで下がる
  /** 袖幅の点の横の位置を変えて、高さ Y に合わせる（A' から離すほど上がる。袖下のカーブの長さはそのまま） */
  const toHeight = (s: typeof sb, h: Half, f: (q: Vec) => Vec, Y: number): typeof sb => {
    const ax = s.raglan.to.x;
    const dir = Math.sign(s.curve.to.x - ax) || (s.curve.to.x >= 0 ? 1 : -1);
    const dMax = Math.abs(s.curve.to.x - ax) * 3 + 1;
    const at = (d: number) => sleeveHalf(h, f, ax + dir * d);
    let lo = 0;
    let hi = dMax;
    if (at(lo).curve.to.y <= Y) return at(lo);
    if (at(hi).curve.to.y >= Y) return at(hi);
    for (let i = 0; i < 50; i++) {
      const mid = (lo + hi) / 2;
      if (at(mid).curve.to.y > Y) lo = mid;
      else hi = mid;
    }
    return at((lo + hi) / 2);
  };
  // 低い方に合わせる。高い方が下がりきらないときは、そこまで低い方を上げる
  {
    const bHigher = sb.curve.to.y < sf.curve.to.y;
    let Y = Math.max(sb.curve.to.y, sf.curve.to.y);
    if (bHigher) {
      sb = toHeight(sb, hb, fB, Y);
      if (sb.curve.to.y < Y - 1e-4) sf = toHeight(sf, hf, fF, (Y = sb.curve.to.y));
    } else {
      sf = toHeight(sf, hf, fF, Y);
      if (sf.curve.to.y < Y - 1e-4) sb = toHeight(sb, hb, fB, (Y = sf.curve.to.y));
    }
  }

  const back = reshape(bodice.back, hb, false);
  const front = reshape(bodice.front, hf, true);

  let len = p.sleeve === 'custom' && finite(p.sleeveCustom) ? p.sleeveCustom : val('arm_length') * SLEEVE_RATIO[p.sleeve === 'custom' ? 'short' : p.sleeve];
  const lowest = Math.max(sb.curve.to.y, sf.curve.to.y);
  if (len < lowest + 0.5) {
    len = lowest + 0.5;
    warnings.push('袖丈が脇下より短いため、脇下の 0.5cm 下まで延ばしました。');
  }
  const hemRatio = p.sleeve === 'custom' ? Math.max(0.78, 0.95 - Math.max(0, len / val('arm_length') - 0.3) * 0.25) : HEM_RATIO[p.sleeve];
  const hemTotal = Math.max(width * hemRatio, minPass);
  // 袖口の端: 袖口の幅（合計）はそのままで、前後の袖下の傾きを同じにする（袖下の長さがそろう）
  const dxB = (hemTotal / width) * wb - sb.curve.to.x;
  const dxF = sf.curve.to.x + (hemTotal / width) * wf;
  const dHem = (dxB + dxF) / 2;
  const hB = v(sb.curve.to.x + dHem, len);
  const hF = v(sf.curve.to.x - dHem, len);
  const O = v(0, 0);

  const sleeveSide = (s: typeof sb, hem: Vec, isBack: boolean): Edge[] => {
    const tag = isBack ? '後ろ' : '前';
    const edges: Edge[] = [
      { segs: [s.neck], kind: 'seam', name: `襟ぐり（${tag}）` },
      { segs: [s.raglan], kind: 'seam', name: `ラグラン線（${tag}）` },
      { segs: [s.curve], kind: 'seam', name: `袖下カーブ（${tag}）` },
      { segs: [line(s.curve.to, hem)], kind: 'seam', name: '袖下' },
    ];
    return edges;
  };
  // 前の辺は向きを逆にして（袖口 → 首）つなぐ
  const reversed = (es: Edge[]): Edge[] => [...es].reverse().map((e) => ({ ...e, segs: [...e.segs].reverse().map(reverseSeg) }));

  const pieces: Piece[] = [front, back];
  const grain: [Vec, Vec] = [v(0, Math.max(lowest, len * 0.2)), v(0, len - (len - lowest) * 0.2)];
  if (p.shoulder === 'dart') {
    pieces.push({
      id: 'sleeve',
      name: 'ラグラン袖（1枚袖・肩ダーツ）',
      cut: '2枚（左右反転）',
      edges: [
        { segs: [line(sf.snp, O), line(O, sb.snp)], kind: 'seam', name: '肩ダーツ' },
        ...sleeveSide(sb, hB, true),
        { segs: [line(hB, hF)], kind: 'hem', name: '袖口' },
        ...reversed(sleeveSide(sf, hF, false)),
      ],
      grain,
    });
  } else {
    pieces.push({
      id: 'sleeve-back',
      name: 'ラグラン袖（後ろ）',
      cut: '2枚（左右反転）',
      edges: [
        ...sleeveSide(sb, hB, true),
        { segs: [line(hB, v(0, len))], kind: 'hem', name: '袖口' },
        { segs: [line(v(0, len), O), line(O, sb.snp)], kind: 'seam', name: '肩・袖の外側' },
      ],
      grain: [v(wb * 0.4, grain[0].y), v(wb * 0.4, grain[1].y)],
    });
    pieces.push({
      id: 'sleeve-front',
      name: 'ラグラン袖（前）',
      cut: '2枚（左右反転）',
      edges: [
        { segs: [line(sf.snp, O), line(O, v(0, len))], kind: 'seam', name: '肩・袖の外側' },
        { segs: [line(v(0, len), hF)], kind: 'hem', name: '袖口' },
        ...reversed(sleeveSide(sf, hF, false)),
      ],
      grain: [v(-wf * 0.4, grain[0].y), v(-wf * 0.4, grain[1].y)],
    });
  }

  // 襟ぐりの縁取り布（Tシャツと同じ）
  const neckTotal = 2 * (pathLength([backNeck]) + pathLength([frontNeck])) + (p.backOpening ? 2 * openingExt : 0);
  const bindRatio = woven ? 0.95 : Math.max(0.75, 1 - (p.stretch / 100) * 0.75);
  const bindLen = neckTotal * bindRatio;
  const finished = Math.min(0.6, Math.max(0.25, val('neck_circ') * 0.05));
  const bw = finished * 2;
  pieces.push({
    id: 'binding',
    name: woven ? '襟ぐり縁取り（バイアス）' : '襟ぐり縁取り',
    cut: woven ? '1枚（バイアス）' : '1枚（よく伸びる向きを長さ方向に）',
    edges: [
      { segs: [line(v(0, 0), v(bindLen, 0))], kind: 'seam', name: '縁取り' },
      { segs: [line(v(bindLen, 0), v(bindLen, bw))], kind: 'seam', name: '端' },
      { segs: [line(v(bindLen, bw), v(0, bw))], kind: 'seam', name: '縁取り' },
      { segs: [line(v(0, bw), v(0, 0))], kind: 'seam', name: '端' },
    ],
    grain: woven
      ? [v(bindLen * 0.5 - bw * 0.35, bw * 0.85), v(bindLen * 0.5 + bw * 0.35, bw * 0.15)]
      : [v(bindLen * 0.5, bw * 0.9), v(bindLen * 0.5, bw * 0.1)],
  });

  const dartDeg = 2 * theta - (Math.atan2(g.backSP.y - g.snp.y, g.backSP.x - g.snp.x) + Math.atan2(g.frontSP.y - g.snp.y, g.frontSP.x - g.snp.x)) * (180 / Math.PI);
  const info = [
    `${p.shoulder === 'dart' ? '1枚袖＋肩ダーツ' : '2枚袖'} ／ ${p.neck === 'v' ? 'Vネック' : 'クルーネック'} ／ 袖丈 ${fmt(len)}cm（${RAGLAN_SLEEVE_LABEL[p.sleeve]}）`,
    `ラグラン線 前 ${fmt(pathLength([hf.raglan]))}cm・後ろ ${fmt(pathLength([hb.raglan]))}cm ／ 袖下カーブ 前 ${fmt(pathLength(hf.lower))}cm・後ろ ${fmt(pathLength(hb.lower))}cm`,
    `袖幅 ${fmt(width)}cm ／ 袖口 ${fmt(hemTotal)}cm ／ 肘が通る周り ${fmt(val('elbow_pass_circ'))}cm`,
    `襟ぐり ${fmt(neckTotal)}cm ／ 縁取り布 ${fmt(bindLen)}cm × 仕上がり幅 ${fmt(finished)}cm`,
    `胸のゆとり ${fmt(ease.chest)}cm ／ 袖ぐりのゆとり ${fmt(ease.armhole)}cm（${woven ? '布帛' : 'ニット'}）`,
  ];
  if (p.shoulder === 'dart') info.push(`肩ダーツ ${fmt(dartDeg)}°（袖の上の三角を縫い合わせます）`);
  if (minPass > baseWidth) info.push('肘が通るように袖幅を広げました');
  if (narrowed) info.push(`脇下の袖幅 ${fmt(Math.abs(sb.curve.to.x) + Math.abs(sf.curve.to.x))}cm（袖ぐりに合わせて細くし、袖口へ向けて広げました）`);
  if (p.neck === 'v') info.push('Vネック: 縁取り布は前中心で V の形に合わせて縫い合わせます');
  if (p.backOpening) info.push(`背中開きの持ち出し ${fmt(openingExt)}cm`);
  info.push(`カテゴリ ${r.category ?? '未分類'}${r.categoryGuessed ? '（仮）' : ''} ／ ゆとりの掛け率 ×${categoryEase.toFixed(2)}`);
  return { pieces, warnings, info, refs: { fitBody: fitChest, fitSleeve: ease.arm, length: p.hemBelowWaist ?? val('waist_to_hip') * { short: 0.4, normal: 0.8, long: 1.3 }[p.length] } };
}
