// ジャンパースカート = 袖なしの身頃（ブラウスの上に着るゆとり）＋ スカート（dress-skirt.ts）。
// 襟ぐり: 丸は大きめに開け、スクエア・V は前の襟ぐりを直線で引き直す。肩ひも型は肩を細い帯にして袖ぐりを大きくえぐる。
// 裏地ありは身頃を表と裏の 2 枚ずつ裁ち、中表で襟ぐり・袖ぐりを縫って返す。なしは縁取り布で始末。
// ハイウエストは身頃の裾を胸の下に上げ、その分スカートを長くする。

import { v, Vec } from '../../geometry/vec';
import { cubic, line, pathLength, Seg } from '../../geometry/path';
import { ResolvedBody } from '../../model/estimate';
import { MeasurementKey } from '../../model/schema';
import { CATEGORY_EASE } from '../../model/category';
import { draftBodice } from '../bodice';
import { useBustDart } from '../bust';
import { defaultEase, scaleEase } from '../ease';
import { applyFit } from '../fit';
import { ExtParams, OpeningChoice, openingExtOf, resolveOpening } from '../opening';
import { DraftResult, Edge, EdgeKind, Piece } from '../types';
import { MissingMeasurementsError } from './tshirt';
import { BLOUSE_DRESS_REQUIREMENTS } from './blouse';
import { DressPleat, DressSkirtKind, dressSkirt, rect } from './dress-skirt';
import { openingLength, SKIRT_LENGTH_LABEL, SkirtLength, skirtBase } from './skirt';

export interface JskParams extends ExtParams {
  bustDart: boolean;
  bodice: 'normal' | 'strap';
  neck: 'round' | 'square' | 'v';
  waistLine: 'waist' | 'high';
  skirt: DressSkirtKind;
  pleat: DressPleat;
  opening: OpeningChoice;
  lining: boolean;
  length: SkirtLength;
  lengthCustom: number | null;
  sash: boolean;
}

export const DEFAULT_JSK: JskParams = {
  bustDart: true,
  bodice: 'normal',
  neck: 'round',
  waistLine: 'waist',
  skirt: 'gather',
  pleat: 'knife',
  opening: 'auto',
  lining: true,
  length: 'knee',
  lengthCustom: null,
  sash: false,
};

export const JSK_BODICE_LABEL = { normal: '袖なしの身頃', strap: '肩ひも型' };
export const JSK_NECK_LABEL = { round: '丸', square: 'スクエア', v: 'V' };
export const JSK_WAIST_LABEL = { waist: 'ウエスト', high: 'ハイウエスト（胸の下）' };
export const JSK_SKIRT_LABEL: Record<DressSkirtKind, string> = { gather: 'ギャザー', pleats: 'プリーツ', flare: 'フレア（半円）', tiered: 'ティアード' };
export const JSK_REQUIREMENTS = BLOUSE_DRESS_REQUIREMENTS;

const fmt = (x: number) => (Math.round(x * 10) / 10).toFixed(1);
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const edgeLen = (pc: Piece, pred: (e: Edge) => boolean) => pc.edges.filter(pred).reduce((a, e) => a + pathLength(e.segs), 0);

export function draftJsk(r: ResolvedBody, p: JskParams): DraftResult {
  const missing = JSK_REQUIREMENTS.filter((q) => q.hard && r.values[q.key] === undefined).map((q) => q.key);
  if (missing.length > 0) throw new MissingMeasurementsError(missing);
  const val = (k: MeasurementKey) => r.values[k] as number;
  const chest = val('chest_circ');
  const neck = val('neck_circ');
  const warnings: string[] = [];
  const info: string[] = [];
  const k = r.category ? CATEGORY_EASE[r.category] : 1;
  const ease = applyFit(scaleEase(defaultEase('woven', { chest, hip: val('hip_circ'), upperArm: val('upper_arm_circ'), armhole: val('armhole_circ') }), k), 'normal', 'normal');
  // ブラウスの上に着る分
  ease.chest += chest * 0.04 + 0.2;
  ease.armhole += val('armhole_circ') * 0.06;
  const frontOpen = resolveOpening(r.category, p.opening) === 'front';
  const pw = clamp(chest * 0.04, 0.5, 1.2);
  const ext = frontOpen ? pw : openingExtOf(p, chest);
  const high = p.waistLine === 'high';

  const bodice = draftBodice(
    {
      chest,
      waist: val('waist_circ'),
      hip: val('hip_circ'),
      neck,
      shoulder: val('shoulder_width'),
      backLength: val('back_length'),
      frontLength: val('front_length'),
      armhole: val('armhole_circ'),
      waistToHip: val('waist_to_hip'),
    },
    {
      ease,
      woven: true,
      neckWiden: p.bodice === 'strap' ? 0.16 : 0.1,
      frontNeckDrop: neck * { round: 0.1, square: 0.16, v: 0.28 }[p.neck],
      shoulderExtend: 0,
      hemBelowWaist: high ? -val('back_length') * 0.22 : 0,
      armholeEase: ease.armhole,
      backOpening: !frontOpen,
      openingExt: ext,
      bustDart: useBustDart(r, { fabric: 'woven', bustDart: p.bustDart }),
      waistTaper: true,
    },
  );
  warnings.push(...bodice.warnings);
  const g = bodice.geom;

  /** 身頃を作り変える: 襟ぐりの形・肩ひも型・裾をウエスト（切り替え）に */
  const reshape = (pc: Piece, isFront: boolean): Piece => {
    const sp = isFront ? g.frontSP : g.backSP;
    const sw = Math.min(clamp(val('shoulder_width') * 0.1, 0.6, 3), Math.hypot(sp.x - g.snp.x, sp.y - g.snp.y) * 0.7);
    const Q = v(g.snp.x + ((sp.x - g.snp.x) * sw) / Math.hypot(sp.x - g.snp.x, sp.y - g.snp.y), g.snp.y + ((sp.y - g.snp.y) * sw) / Math.hypot(sp.x - g.snp.x, sp.y - g.snp.y));
    const edges = pc.edges.map((e): Edge => {
      if (isFront && e.name === '襟ぐり' && p.neck !== 'round') {
        const fnd = g.frontNeckDepth;
        const segs: Seg[] = p.neck === 'v' ? [line(v(0, fnd), g.snp)] : [line(v(0, fnd), v(g.snp.x, fnd)), line(v(g.snp.x, fnd), g.snp)];
        return { ...e, segs };
      }
      if (p.bodice === 'strap' && e.name === '肩') return { ...e, segs: [line(g.snp, Q)] };
      if (p.bodice === 'strap' && e.name === '袖ぐり') {
        const side = e.segs[e.segs.length - 1].to;
        return { ...e, segs: [cubic(Q, v(Q.x, Q.y + (side.y - Q.y) * 0.55), v(side.x - (side.x - Q.x) * 0.6, side.y), side)] };
      }
      if (e.name === '裾') return { ...e, kind: 'seam' as EdgeKind, name: 'ウエスト' };
      return e;
    });
    return { ...pc, edges };
  };
  let front = reshape(bodice.front, true);
  const back = reshape(bodice.back, false);

  // ---- 前開き: 前中心の外へ重なりを付け、ボタンの印 ----
  if (frontOpen) {
    const fnd = g.frontNeckDepth;
    const fold = front.edges[front.edges.length - 1];
    const hemY = fold.segs[0].from.y;
    const edges = front.edges.slice(0, -1).map((e) => (e.name === 'ウエスト' ? { ...e, segs: [...e.segs, line(v(0, hemY), v(-pw, hemY))] } : e));
    const n = clamp(Math.round((hemY - fnd) / Math.max(chest * 0.11, 0.8)), 2, 6);
    const r0 = Math.min(0.2, pw * 0.3);
    const marks: Vec[][] = [...(front.marks ?? [])];
    for (let i = 0; i < n; i++) {
      const y = fnd + pw * 0.8 + ((hemY - fnd - pw * 1.6) * i) / Math.max(1, n - 1);
      marks.push([v(-r0, y), v(r0, y)], [v(0, y - r0), v(0, y + r0)]);
    }
    front = {
      ...front,
      edges: [{ segs: [line(v(-pw, fnd), v(0, fnd))], kind: 'seam', name: '襟ぐり（前立て）' }, ...edges, { segs: [line(v(-pw, hemY), v(-pw, fnd))], kind: 'opening', name: '前端' }],
      marks,
    };
    info.push(`前開き（重なり ${fmt(pw)}cm・ボタン ${n} 個）`);
  } else {
    info.push(`背中開き（持ち出し ${fmt(ext)}cm）`);
  }
  front = { ...front, cut: frontOpen ? (p.lining ? '4枚（左右反転・表と裏）' : '2枚（左右反転）') : p.lining ? '2枚（わ・表と裏）' : '1枚（わ）' };
  const backPc: Piece = { ...back, cut: frontOpen ? (p.lining ? '2枚（わ・表と裏）' : '1枚（わ）') : p.lining ? '4枚（左右反転・表と裏）' : '2枚（左右反転）' };
  const pieces: Piece[] = [front, backPc];

  // ---- 裏地なし: 縁取り布 ----
  const neckTotal = 2 * (edgeLen(front, (e) => e.name.startsWith('襟ぐり')) + edgeLen(backPc, (e) => e.name.startsWith('襟ぐり')));
  const armhole = edgeLen(front, (e) => e.name === '袖ぐり') + edgeLen(backPc, (e) => e.name === '袖ぐり');
  if (!p.lining) {
    const fin = clamp(neck * 0.05, 0.25, 0.6);
    const bias = (id: string, name: string, cut: string, len: number): Piece => ({
      ...rect(id, name, cut, len, fin * 2, ['縁取り', '端', '縁取り', '端']),
      grain: [v(len * 0.5 - fin * 0.7, fin * 1.7), v(len * 0.5 + fin * 0.7, fin * 0.3)],
    });
    pieces.push(bias('binding', '襟ぐり縁取り（バイアス）', '1枚（バイアス）', neckTotal * 0.95), bias('armhole-binding', '袖ぐり縁取り（バイアス）', '2枚（バイアス）', armhole * 0.95));
    info.push(`襟ぐり ${fmt(neckTotal)}cm・袖ぐり ${fmt(armhole)}cm を縁取り布（仕上がり幅 ${fmt(fin)}cm）で始末`);
  } else {
    info.push('身頃は表と裏を裁ち、中表にして襟ぐり・袖ぐり（開き）を縫って返します');
  }

  // ---- スカート ----
  const b = skirtBase(r, p.length, p.lengthCustom);
  warnings.push(...b.warnings);
  const rise = Math.max(0, g.waistY - g.backHemY); // ハイウエストで上げた分
  const L = b.length + rise;
  const fHalf = edgeLen(front, (e) => e.name === 'ウエスト') - (frontOpen ? pw : 0);
  const bHalf = edgeLen(backPc, (e) => e.name === 'ウエスト') - (frontOpen ? 0 : ext);
  const sk = dressSkirt(r, { kind: p.skirt, pleat: p.pleat, L, wh: b.wh + rise, hipF: b.hipF, fHalf, bHalf, frontOpen, pw, extB: frontOpen ? 0 : ext, yOpen: openingLength(b.wh, b.length) + rise });
  pieces.push(...sk.pieces);
  info.push(...sk.info);

  if (p.sash) {
    const sw = clamp(val('back_length') * 0.12, 0.5, 2);
    const sl = val('waist_circ') * 0.25 + clamp(chest * 0.45, 3, 35);
    pieces.push(rect('sash', 'リボン（筒に縫って返し、脇の切り替えに挟んで後ろで結ぶ）', '2枚', sl, sw * 2, ['縁', '端', '縁', '端']));
    info.push(`リボン ${fmt(sl)}cm × 仕上がりの幅 ${fmt(sw)}cm × 2 本`);
  }
  info.unshift(
    `ジャンパースカート ${JSK_BODICE_LABEL[p.bodice]}・襟ぐり ${JSK_NECK_LABEL[p.neck]} ／ ${JSK_WAIST_LABEL[p.waistLine]}切り替え ／ ${JSK_SKIRT_LABEL[p.skirt]} ／ ${SKIRT_LENGTH_LABEL[p.length]} ウエストから ${fmt(b.length)}cm`,
  );
  if (g.dartApplied) info.push(`胸ダーツ ${fmt(g.bustDelta)}cm`);
  info.push(`胸のゆとり ${fmt(ease.chest)}cm（ブラウスの上に着る分を含む）`, `カテゴリ ${r.category ?? '未分類'}${r.categoryGuessed ? '（仮）' : ''}`);
  return { pieces, warnings, info, refs: { length: b.length } };
}
