// ワンピース・ジャンパースカートの、身頃に付けるスカート（ギャザー・プリーツ・フレア（半円）・ティアード）。
// 前後とも中心「わ」の 1/4 で作る。着るときヒップが通るよう、開き（前か後ろ）はスカートのウエストから yOpen まで続ける。
// 座標: x は中心が 0 で脇へ正、y はウエストが 0 で下向き（フレアは扇の中心が原点）。

import { v, Vec } from '../../geometry/vec';
import { cubic, line, Seg } from '../../geometry/path';
import { ResolvedBody } from '../../model/estimate';
import { extMarks } from '../opening';
import { Edge, EdgeKind, Piece } from '../types';
import { centerEdges, extWaistEdge } from './skirt';
import { DEFAULT_TIERED, draftTiered } from './tiered';

export type DressSkirtKind = 'gather' | 'pleats' | 'flare' | 'tiered';
export type DressPleat = 'knife' | 'box';

/** ギャザースカート・フリルの寄せ分（倍） */
export const GATHER = 1.6;
/** プリーツの 1/4 あたりのひだの数 */
const PLEATS_PER_QUARTER = 4;

const fmt = (x: number) => (Math.round(x * 10) / 10).toFixed(1);

export function rect(id: string, name: string, cut: string, w: number, h: number, names: [string, string, string, string], kinds: EdgeKind[] = ['seam', 'seam', 'seam', 'seam']): Piece {
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
    grain: w > h ? [v(w * 0.5 - Math.min(w * 0.3, 3), h * 0.5), v(w * 0.5 + Math.min(w * 0.3, 3), h * 0.5)] : [v(w * 0.5, h * 0.2), v(w * 0.5, h * 0.8)],
  };
}

/**
 * 中心が「わ」の最後の辺（下 → 上）を、開き（上から yOpen）＋縫い目に変える。持ち出し ext は中心の外へ。
 * front なら名前の「後ろ」を「前」にする
 */
export function openCenter(pc: Piece, front: boolean, yOpen: number, ext: number): Piece {
  const c = pc.edges[pc.edges.length - 1];
  if (c.kind !== 'fold') return pc;
  const bottom = c.segs[0].from.y;
  const top = c.segs[c.segs.length - 1].to.y;
  const yo = Math.min(yOpen, bottom - top - 0.3);
  const rename = (e: Edge): Edge => (front ? { ...e, name: e.name.replace('後ろ', '前') } : e);
  const em = extMarks(top, top + yo, ext);
  return {
    ...pc,
    cut: '2枚（左右反転）',
    edges: [extWaistEdge(ext, top, 'seam'), ...pc.edges.slice(0, -1), ...centerEdges(bottom, false, true, 0, yo, top, ext).map(rename)],
    marks: [...(pc.marks ?? []), ...em.marks],
    notes: [...(pc.notes ?? []), ...em.notes],
  };
}

export interface DressSkirtInput {
  kind: DressSkirtKind;
  pleat?: DressPleat;
  /** スカートの丈（ウエストから） */
  L: number;
  /** ウエスト〜ヒップ・ヒップ（ゆとり込み） */
  wh: number;
  hipF: number;
  /** 身頃のウエスト（1/4。持ち出し・前立ての分は除く） */
  fHalf: number;
  bHalf: number;
  frontOpen: boolean;
  /** 前開きの重なり・背中開きの持ち出し */
  pw: number;
  extB: number;
  yOpen: number;
}

export function dressSkirt(r: ResolvedBody, s: DressSkirtInput): { pieces: Piece[]; info: string[] } {
  const { L, fHalf, bHalf } = s;
  const bodiceWaist = 2 * (fHalf + bHalf);
  const info: string[] = [];
  const open = (pc: Piece): Piece => {
    const isF = pc.id.endsWith('front');
    if (isF && s.frontOpen) return openCenter(pc, true, s.yOpen, s.pw);
    if (!isF && !s.frontOpen) return openCenter(pc, false, s.yOpen, s.extB);
    return pc;
  };
  const rectSkirt = (id: string, name: string, w: number, isF: boolean, waistName: string): Piece => ({
    ...rect(id, name, '1枚（わ）', w, L, [waistName, '脇', '裾', isF ? '前中心（わ）' : '後ろ中心（わ）'], ['seam', 'seam', 'hem', 'fold']),
    grain: [v(w * 0.4, L * 0.15), v(w * 0.4, L * 0.85)],
  });
  let pieces: Piece[];

  if (s.kind === 'tiered') {
    const t = draftTiered(r, { ...DEFAULT_TIERED, top: 'gather', waist: 'elastic', length: 'custom', lengthCustom: L });
    pieces = t.pieces.map((pc) => ({ ...pc, edges: pc.edges.map((e) => (e.name === 'ウエスト' ? { ...e, kind: 'seam' as EdgeKind, name: 'ウエスト（ギャザーを寄せる）' } : e)) }));
    // 1 段目はほかのスカートと同じ id にする（合印の対応表をそろえる）
    pieces = pieces.map((pc) => (pc.id.startsWith('tier1-') ? open({ ...pc, id: pc.id.replace('tier1-', 'skirt-') }) : pc));
    info.push(...t.info.filter((x) => /^(\d段目|ヨーク):/.test(x)), '段は粗ミシンでギャザーを寄せて上の段に付けます');
  } else if (s.kind === 'gather') {
    const fw = Math.max(s.hipF / 4, fHalf * GATHER);
    const bw = Math.max(s.hipF / 4, bHalf * GATHER);
    pieces = [rectSkirt('skirt-front', '前スカート', fw, true, 'ウエスト（ギャザーを寄せる）'), rectSkirt('skirt-back', '後ろスカート', bw, false, 'ウエスト（ギャザーを寄せる）')].map(open);
    info.push(`ギャザースカート: 周り ${fmt(2 * (fw + bw))}cm × 丈 ${fmt(L)}cm（身頃のウエスト ${fmt(bodiceWaist)}cm に寄せる）`);
  } else if (s.kind === 'pleats') {
    // 1/4 に PLEATS_PER_QUARTER 本。たたむと身頃のウエストになる（ヒップは開いたひだで通る）
    const knife = (s.pleat ?? 'knife') === 'knife';
    const mk = (id: string, name: string, half: number, isF: boolean): Piece => {
      const sp = half / PLEATS_PER_QUARTER;
      const d = sp * (knife ? 0.7 : 0.25);
      const unit = sp + 2 * d * (knife ? 1 : 2);
      const w = unit * PLEATS_PER_QUARTER;
      const marks: Vec[][] = [];
      for (let k = 0; k < PLEATS_PER_QUARTER; k++) {
        const u0 = k * unit;
        for (const x of knife ? [u0 + d, u0 + d + sp] : [u0 + 2 * d, u0 + 2 * d + sp]) marks.push([v(x, 0), v(x, L)]);
      }
      return { ...rectSkirt(id, name, w, isF, 'ウエスト（ひだをたたむ）'), marks, grain: [v(Math.min(unit * 0.5, w * 0.5), L * 0.15), v(Math.min(unit * 0.5, w * 0.5), L * 0.85)] };
    };
    pieces = [mk('skirt-front', '前スカート（プリーツ）', fHalf, true), mk('skirt-back', '後ろスカート（プリーツ）', bHalf, false)].map(open);
    info.push(
      `${knife ? '車ひだ' : '箱ひだ'} ${PLEATS_PER_QUARTER * 4} 本 × 丈 ${fmt(L)}cm（たたむと身頃のウエスト ${fmt(bodiceWaist)}cm）`,
      knife
        ? 'たたみ方: 印は 2 本で 1 組。前後とも中心から脇へ向けて、右の線で山折りにして隣の組の左の線に重ねます'
        : 'たたみ方: 印の線はすべて箱の端です。山折りにして、印と印のあいだを 1 つおきに裏へたたみます',
    );
  } else {
    // 半円（前後とも 1/4 円）。ヒップが通らなければウエストの円を大きくして、余りはギャザー
    let rIn = bodiceWaist / Math.PI;
    if ((rIn + s.wh) * Math.PI < s.hipF) rIn = s.hipF / Math.PI - s.wh;
    const R = rIn + L;
    const beta = Math.PI / 4;
    const pt = (rr: number, a: number) => v(rr * Math.sin(a), rr * Math.cos(a));
    const arc = (rr: number, a0: number, a1: number): Seg => {
      const k = (4 / 3) * Math.tan((a1 - a0) / 4) * rr;
      const p0 = pt(rr, a0);
      const p1 = pt(rr, a1);
      return cubic(p0, v(p0.x + Math.cos(a0) * k, p0.y - Math.sin(a0) * k), v(p1.x - Math.cos(a1) * k, p1.y + Math.sin(a1) * k), p1);
    };
    const gather = rIn * Math.PI - bodiceWaist;
    const mk = (id: string, name: string, isF: boolean): Piece => ({
      id,
      name,
      cut: '1枚（わ）',
      edges: [
        { segs: [arc(rIn, 0, beta)], kind: 'seam', name: 'ウエスト' },
        { segs: [line(pt(rIn, beta), pt(R, beta))], kind: 'seam', name: '脇' },
        { segs: [arc(R, beta, 0)], kind: 'hem', name: '裾' },
        { segs: [line(v(0, R), v(0, rIn))], kind: 'fold', name: isF ? '前中心（わ）' : '後ろ中心（わ）' },
      ],
      grain: [v(Math.min(1.5, rIn * 0.3), rIn + L * 0.15), v(Math.min(1.5, rIn * 0.3), R - L * 0.15)],
    });
    pieces = [mk('skirt-front', '前スカート', true), mk('skirt-back', '後ろスカート', false)].map(open);
    info.push(`フレアスカート（半円）: ウエストの半径 ${fmt(rIn)}cm ／ 裾の半径 ${fmt(R)}cm${gather > 0.05 ? `（ヒップが通るよう広げたので、ウエストを ${fmt(gather)}cm 寄せる）` : ''}`);
  }
  info.push(`${s.frontOpen ? '前' : '背中'}開きは、スカートのウエストから ${fmt(s.yOpen)}cm 下まで続けます（ヒップが通るように）`);
  return { pieces, info };
}
