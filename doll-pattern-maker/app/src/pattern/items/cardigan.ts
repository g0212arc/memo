// カーディガン = 身頃原型（前開き）＋ 袖原型 ＋ 前立て（リブ、または見返し）＋ 裾・袖口のリブ。重ね着の分だけゆとりを足す。
// リブの前立て: 前身頃は前中心から前立ての幅の半分だけ内側で切る（左右の前立てを重ねると前中心にそろう）。
// 見返し: 前中心の外へ持ち出しを出し、見返しで始末する。襟ぐりは縁取り布。

import { Vec, v } from '../../geometry/vec';
import { Seg, line, pathLength } from '../../geometry/path';
import { ResolvedBody } from '../../model/estimate';
import { MeasurementKey } from '../../model/schema';
import { CATEGORY_EASE } from '../../model/category';
import { draftBodice } from '../bodice';
import { useBustDart } from '../bust';
import { clipPieceX } from '../clip';
import { defaultEase, scaleEase } from '../ease';
import { applyFit, Fit } from '../fit';
import { draftSleeve } from '../sleeve';
import { DraftResult, EdgeKind, Fabric, Piece } from '../types';
import { MissingMeasurementsError, TSHIRT_REQUIREMENTS } from './tshirt';

export type CardiganLength = 'short' | 'normal' | 'long' | 'custom';
export type CardiganSleeve = 'long' | 'three' | 'short' | 'custom';

export interface CardiganParams {
  fabric: Fabric;
  stretch: number;
  bustDart: boolean;
  neck: 'v' | 'crew';
  band: 'rib' | 'facing';
  closure: 'button' | 'snap' | 'none';
  /** ボタンの数（プルダウンの値は文字列） */
  buttons: 'auto' | 'custom';
  buttonsCustom: number | null;
  length: CardiganLength;
  /** length が custom のときの丈（ウエストから下へ cm。マイナスで短く） */
  lengthCustom: number | null;
  sleeve: CardiganSleeve;
  /** sleeve が custom のときの袖丈（肩先から cm） */
  sleeveCustom: number | null;
  edge: 'rib' | 'hem';
  fitBody: Fit;
  fitSleeve: Fit;
  pocket: boolean;
}

export const DEFAULT_CARDIGAN: CardiganParams = {
  fabric: 'knit',
  stretch: 30,
  bustDart: true,
  neck: 'v',
  band: 'rib',
  closure: 'button',
  buttons: 'auto',
  buttonsCustom: null,
  length: 'normal',
  lengthCustom: null,
  sleeve: 'long',
  sleeveCustom: null,
  edge: 'rib',
  fitBody: 'normal',
  fitSleeve: 'normal',
  pocket: false,
};

export const CARDIGAN_LENGTH_LABEL: Record<CardiganLength, string> = { short: '短め（ウエスト）', normal: '普通（腰）', long: '長め（お尻が隠れる）', custom: '自分で入力' };
export const CARDIGAN_SLEEVE_LABEL: Record<CardiganSleeve, string> = { long: '長袖', three: '七分袖', short: '半袖', custom: '自分で入力' };
export const CARDIGAN_REQUIREMENTS: { key: MeasurementKey; hard: boolean }[] = TSHIRT_REQUIREMENTS;

const fmt = (x: number) => (Math.round(x * 10) / 10).toFixed(1);
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const finite = (x: number | null): x is number => x !== null && Number.isFinite(x);

function rect(id: string, name: string, cut: string, w: number, h: number, names: [string, string, string, string], kinds: EdgeKind[] = ['seam', 'seam', 'seam', 'seam']): Piece {
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
/** ボタンの位置の印（十字） */
const cross = (c: Vec, r: number): Vec[][] => [[v(c.x - r, c.y), v(c.x + r, c.y)], [v(c.x, c.y - r), v(c.x, c.y + r)]];

export function draftCardigan(r: ResolvedBody, p: CardiganParams): DraftResult {
  const missing = CARDIGAN_REQUIREMENTS.filter((q) => r.values[q.key] === undefined).map((q) => q.key);
  if (missing.length > 0) throw new MissingMeasurementsError(missing);
  const val = (k: MeasurementKey) => r.values[k] as number;
  const woven = p.fabric === 'woven';
  const warnings: string[] = [];
  const info: string[] = [];

  const categoryEase = r.category ? CATEGORY_EASE[r.category] : 1;
  const chest = val('chest_circ');
  const ease = applyFit(
    scaleEase(defaultEase(p.fabric, { chest, hip: val('hip_circ'), upperArm: val('upper_arm_circ'), armhole: val('armhole_circ') }), categoryEase),
    p.fitBody,
    p.fitSleeve,
  );
  // 重ね着の分（Tシャツの上に着られるくらい）
  ease.chest += chest * 0.06 + 0.3;
  ease.hip += val('hip_circ') * 0.04 + 0.2;
  ease.armhole += val('armhole_circ') * 0.05;
  ease.arm += val('upper_arm_circ') * 0.1;

  const wh = val('waist_to_hip');
  const rib = p.edge === 'rib';
  const ribK = woven ? 1 : Math.max(0.75, 1 - (p.stretch / 100) * 0.75); // リブは引いて付ける
  const ribH = rib ? clamp(wh * 0.25, 0.4, 2.5) : 0;
  const totalBelow = p.length === 'custom' && finite(p.lengthCustom) ? p.lengthCustom : wh * { short: 0, normal: 0.9, long: 1.4, custom: 0.9 }[p.length];
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
      waistToHip: wh,
    },
    {
      ease,
      woven,
      neckWiden: 0.04,
      frontNeckDrop: 0,
      shoulderExtend: val('shoulder_width') * 0.04,
      hemBelowWaist: totalBelow - ribH,
      armholeEase: ease.armhole,
      backOpening: false,
      bustDart: useBustDart(r, p),
      openingExt: 0,
    },
  );
  warnings.push(...bodice.warnings);
  const g = bodice.geom;
  const bw = clamp(chest * 0.05, 0.6, 1.6); // 前立ての仕上がり幅（重なり）
  const fe = bodice.front.edges;
  const edgeOf = (name: string) => fe.find((e) => e.name === name)!;
  const neckSeg = edgeOf('襟ぐり').segs[0];
  const hemEdge = edgeOf('裾');
  const hemKind: EdgeKind = rib ? 'seam' : 'hem';
  const hemName = rib ? '裾（リブ付け）' : '裾';
  // V の先: 胸の線の少し下
  const vY = g.chestY + (g.waistY - g.chestY) * 0.1;

  const pieces: Piece[] = [];
  let frontEdgeLen = 0; // 前端の長さ（裾から襟ぐりの始まりまで）
  let frontNeckLen = 0;
  const buttonMarks: Vec[][] = [];
  let front: Piece;
  const ys = (top: number, bottom: number, n: number) => Array.from({ length: n }, (_, i) => top + ((bottom - top) * (i + 0.5)) / n);

  if (p.band === 'rib') {
    const x0 = bw / 2;
    // 前中心まで延ばした形を作ってから、x0 で切る
    let neck: Seg;
    if (p.neck === 'v') {
      const k = (vY - g.snp.y) / (g.snp.x - x0);
      neck = line(v(0, vY + k * x0), g.snp);
    } else neck = neckSeg;
    const full: Piece = {
      ...bodice.front,
      edges: [
        { segs: [neck], kind: 'seam', name: '襟ぐり' },
        edgeOf('肩'),
        edgeOf('袖ぐり'),
        edgeOf('脇'),
        { ...hemEdge, kind: hemKind, name: hemName },
        { segs: [line(v(0, g.frontHemY), v(0, neck.from.y))], kind: 'seam', name: '前中心' },
      ],
    };
    const edges = clipPieceX(full, 'right', x0, { kind: 'seam', name: '前端（前立て付け）' });
    front = { ...bodice.front, cut: '2枚（左右反転）', edges, grain: bodice.front.grain.map((q) => v(Math.max(q.x, x0 + 0.3), q.y)) as [Vec, Vec] };
    const fEdge = edges.find((e) => e.name === '前端（前立て付け）')!;
    frontEdgeLen = pathLength(fEdge.segs);
    frontNeckLen = pathLength(edges.find((e) => e.name === '襟ぐり')!.segs);
  } else {
    // 見返し: 前中心の外へ持ち出し（重なりの半分）
    const ext = bw / 2;
    const neckStart = p.neck === 'v' ? v(-ext, vY) : v(-ext, g.frontNeckDepth);
    const neckSegs: Seg[] = p.neck === 'v' ? [line(neckStart, g.snp)] : [line(neckStart, neckSeg.from), neckSeg];
    const hemSegs = [...hemEdge.segs, line(v(0, g.frontHemY), v(-ext, g.frontHemY))];
    front = {
      ...bodice.front,
      cut: '2枚（左右反転）',
      edges: [
        { segs: neckSegs, kind: 'seam', name: '襟ぐり' },
        edgeOf('肩'),
        edgeOf('袖ぐり'),
        edgeOf('脇'),
        { segs: hemSegs, kind: hemKind, name: hemName },
        { segs: [line(v(-ext, g.frontHemY), neckStart)], kind: 'seam', name: '前端（見返しと縫う）' },
      ],
    };
    frontEdgeLen = g.frontHemY - neckStart.y;
    frontNeckLen = pathLength(neckSegs);
    if (p.closure !== 'none') {
      const n = p.buttons === 'custom' && finite(p.buttonsCustom) ? clamp(Math.round(p.buttonsCustom), 1, 12) : clamp(Math.round(frontEdgeLen / Math.max(chest * 0.12, 1)), 2, 7);
      for (const y of ys(neckStart.y + 0.3, g.frontHemY - 0.3, n)) buttonMarks.push(...cross(v(0, y), Math.min(0.25, ext * 0.5)));
    }
    const fw = clamp(g.chestQ * 0.3, ext + 0.8, g.chestQ * 0.6);
    pieces.push({
      id: 'front-facing',
      name: '前見返し',
      cut: '2枚（左右反転）',
      edges: clipPieceX({ ...front, edges: front.edges.map((e) => (e.name === hemName ? { ...e, kind: 'hem' as EdgeKind, name: '裾' } : e)) }, 'left', fw, { kind: 'hem', name: '見返し端' }),
      grain: [v((fw - ext) / 2, neckStart.y + 0.5), v((fw - ext) / 2, g.frontHemY - 0.5)],
    });
  }
  // ポケット（貼り付け）
  if (p.pocket) {
    const pw = g.chestQ * 0.45;
    const ph = pw * 0.9;
    const px = g.chestQ * 0.3;
    const pyBottom = g.frontHemY - Math.max(0.5, (g.frontHemY - g.chestY) * 0.12);
    const py = Math.max(g.chestY + 0.5, pyBottom - ph);
    buttonMarks.push([v(px, py), v(px + pw, py), v(px + pw, py + (pyBottom - py)), v(px, pyBottom), v(px, py)]);
    pieces.push(rect('pocket', 'ポケット（前に貼り付け）', '2枚', pw, pyBottom - py, ['ポケット口', '脇', '底', '脇'], ['hem', 'seam', 'seam', 'seam']));
    // 布目線はポケットの印と重ならないよう脇側へ
    const gx = px + pw + 0.35;
    front.grain = [v(gx, front.grain[0].y), v(gx, front.grain[1].y)];
  }
  front.marks = [...(front.marks ?? []), ...buttonMarks];
  const back: Piece = { ...bodice.back, edges: bodice.back.edges.map((e) => (e.name === '裾' ? { ...e, kind: hemKind, name: hemName } : e)) };
  pieces.unshift(front, back);

  // ---- 袖 ----
  const frontAH = pathLength(bodice.frontArmhole);
  const backAH = pathLength(bodice.backArmhole);
  const armLen = val('arm_length');
  const sleeveLen = p.sleeve === 'custom' && finite(p.sleeveCustom) ? p.sleeveCustom : armLen * { long: 1, three: 0.75, short: 0.3, custom: 1 }[p.sleeve];
  const cuffH = rib ? clamp(armLen * 0.08, 0.4, 2) : 0;
  const sleeve = draftSleeve({
    frontArmholeLength: frontAH,
    backArmholeLength: backAH,
    upperArm: val('upper_arm_circ'),
    armEase: ease.arm,
    armLength: armLen,
    lengthRatio: Math.max(0.1, (sleeveLen - cuffH) / armLen),
    widthRatio: woven ? 0.78 : 0.9,
    capEase: woven ? 0.03 : 0,
    hemRatio: sleeveLen / armLen > 0.6 ? 0.8 : 0.95,
    minPass: val('elbow_pass_circ') + ease.pass,
    extraWidth: 0,
  });
  warnings.push(...sleeve.warnings);
  const hemSeg = sleeve.piece.edges.find((e) => e.kind === 'hem')!.segs[0];
  const hemW = Math.abs(hemSeg.to.x - hemSeg.from.x);
  if (rib) {
    sleeve.piece.edges = sleeve.piece.edges.map((e) => (e.kind === 'hem' ? { ...e, kind: 'seam', name: '袖口（リブ付け）' } : e));
    const passLen = (val('elbow_pass_circ') + ease.pass) / (woven ? 1 : 1 + p.stretch / 100);
    pieces.push(rect('cuff', '袖口リブ（高さ方向に二つ折り・輪にする）', '2枚（リブ）', Math.min(hemW, Math.max(hemW * ribK, passLen)), cuffH * 2, ['袖口側', '端', '袖口側', '端']));
  }
  pieces.splice(2, 0, sleeve.piece);

  // ---- 裾リブ（前端から前端まで） ----
  const hemWidth = (pc: Piece) => pathLength(pc.edges.filter((e) => e.name === hemName).flatMap((e) => e.segs));
  const hemCirc = 2 * hemWidth(front) + 2 * hemWidth(back);
  if (rib) pieces.push(rect('hem-rib', '裾リブ（高さ方向に二つ折り・前端から前端まで）', '1枚（リブ）', hemCirc * ribK, ribH * 2, ['裾側', '端', '裾側', '端']));

  // ---- 前立て（リブ）か、襟ぐりの縁取り（見返し） ----
  const backNeckLen = bodice.backNeckLength;
  if (p.band === 'rib') {
    const edgeLen = frontEdgeLen + ribH;
    const neckLen = (frontNeckLen + backNeckLen) * (woven ? 1 : 0.9);
    const L = 2 * (edgeLen + neckLen);
    const band = rect('front-band', '前立てリブ（幅方向に二つ折り・裾から襟ぐりを通って反対の裾まで）', '1枚（リブ）', L, bw * 2, ['前端・襟ぐり側', '端', '前端・襟ぐり側', '端']);
    const marks: Vec[][] = [[v(L / 2, 0), v(L / 2, bw * 2)], [v(edgeLen, 0), v(edgeLen, bw * 0.4)], [v(L - edgeLen, 0), v(L - edgeLen, bw * 0.4)]];
    if (p.closure !== 'none') {
      const n = p.buttons === 'custom' && finite(p.buttonsCustom) ? clamp(Math.round(p.buttonsCustom), 1, 12) : clamp(Math.round(edgeLen / Math.max(chest * 0.12, 1)), 2, 7);
      for (const x of ys(ribH + 0.3, edgeLen - 0.3, n)) {
        marks.push(...cross(v(x, bw * 0.5), Math.min(0.25, bw * 0.3)), ...cross(v(L - x, bw * 0.5), Math.min(0.25, bw * 0.3)));
      }
      info.push(`${p.closure === 'button' ? 'ボタン' : 'スナップ'} ${n} 個（前立ての印。片側に${p.closure === 'button' ? 'ボタンホール' : 'スナップの凹'}、反対側に${p.closure === 'button' ? 'ボタン' : '凸'}）`);
    }
    band.marks = marks;
    pieces.push(band);
    info.push(`前立てリブ ${fmt(L)}cm × 仕上がり幅 ${fmt(bw)}cm（真ん中の印を後ろ中心に、短い印を襟ぐりの始まりに合わせる。襟ぐりは少し引いて付ける）`);
  } else {
    const neckTotal = 2 * (frontNeckLen + backNeckLen);
    const bindLen = neckTotal * (woven ? 0.95 : Math.max(0.75, 1 - (p.stretch / 100) * 0.75));
    const fin = Math.min(0.6, Math.max(0.25, val('neck_circ') * 0.05));
    pieces.push(rect('binding', woven ? '襟ぐり縁取り（バイアス）' : '襟ぐり縁取り', '1枚', bindLen, fin * 2, ['縁取り', '端', '縁取り', '端']));
    if (p.closure !== 'none') info.push(`${p.closure === 'button' ? 'ボタン' : 'スナップ'}: 前中心の印（重なり ${fmt(bw)}cm）`);
  }

  info.unshift(
    `${p.neck === 'v' ? 'Vネック' : 'クルーネック'} ／ ${p.band === 'rib' ? 'リブの前立て' : '見返し'} ／ ${CARDIGAN_LENGTH_LABEL[p.length]} ／ ${CARDIGAN_SLEEVE_LABEL[p.sleeve]} ${fmt(sleeveLen)}cm`,
    `胸のゆとり ${fmt(ease.chest)}cm（重ね着の分 ${fmt(chest * 0.06 + 0.3)}cm 込み）／ 袖幅 ${fmt(sleeve.width)}cm`,
  );
  if (rib) info.push(`裾リブ ${fmt(hemCirc * ribK)}cm × 仕上がりの高さ ${fmt(ribH)}cm ／ 袖口リブ 高さ ${fmt(cuffH)}cm`);
  info.push(`カテゴリ ${r.category ?? '未分類'}${r.categoryGuessed ? '（仮）' : ''} ／ ゆとりの掛け率 ×${categoryEase.toFixed(2)}`);
  return { pieces, warnings, info, refs: { fitBody: ease.chest, fitSleeve: ease.arm, length: totalBelow } };
}

