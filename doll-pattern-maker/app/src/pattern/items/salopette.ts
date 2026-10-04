// サロペット／オーバーオール = パンツ（ゴムウエストの形）またはスカート ＋ 胸当て ＋ 肩ひも ＋ ウエストのベルト。
// パンツはウエストを脇で細くし、着るときヒップが通るよう 脇（または後ろ中心）をヒップの下まで開けて持ち出しを付ける。
// 胸当ては前パンツのウエストに直接付け、後ろはベルトで始末して肩ひもを付ける。胸当てなしは前にもベルト（サスペンダー）。
// スカートは「スカート」の作図（Aライン・ベルト付きの後ろ開き）を使う。
// パンツの座標: x は脇を 0 として股側へ正、y はウエストが 0 で下向き。

import { v } from '../../geometry/vec';
import { cubic, line, pathLength } from '../../geometry/path';
import { splitSegsAtY } from '../../geometry/transform';
import { ResolvedBody } from '../../model/estimate';
import { MeasurementKey } from '../../model/schema';
import { DraftResult, Edge, Piece } from '../types';
import { MissingMeasurementsError } from './tshirt';
import { DEFAULT_PANTS, draftPants, PANTS_REQUIREMENTS } from './pants';
import { draftSkirt, SKIRT_REQUIREMENTS } from './skirt';
import { rect } from './dress-skirt';

export type SalopetteBottom = 'long' | 'half' | 'short' | 'skirt';

export interface SalopetteParams {
  bottom: SalopetteBottom;
  bib: boolean;
  straps: 'cross' | 'straight';
  strapFix: 'button' | 'sewn';
  opening: 'side' | 'back';
  bibPocket: boolean;
  frontPocket: boolean;
  backPocket: boolean;
  hem: 'fold' | 'rollup';
  fit: 'normal' | 'loose';
}

export const DEFAULT_SALOPETTE: SalopetteParams = {
  bottom: 'long',
  bib: true,
  straps: 'cross',
  strapFix: 'button',
  opening: 'side',
  bibPocket: true,
  frontPocket: true,
  backPocket: false,
  hem: 'fold',
  fit: 'loose',
};

export const SALOPETTE_BOTTOM_LABEL: Record<SalopetteBottom, string> = { long: '長ズボン', half: 'ハーフ（膝上）', short: 'ショート', skirt: 'スカート' };
export const SALOPETTE_REQUIREMENTS: { key: MeasurementKey; hard: boolean }[] = [
  ...PANTS_REQUIREMENTS,
  ...SKIRT_REQUIREMENTS.filter((q) => !PANTS_REQUIREMENTS.some((x) => x.key === q.key)),
  { key: 'back_length', hard: false },
  { key: 'front_length', hard: false },
  { key: 'chest_circ', hard: false },
  { key: 'shoulder_width', hard: false },
];

const fmt = (x: number) => (Math.round(x * 10) / 10).toFixed(1);
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const lenOf = (e: Edge | undefined) => (e ? pathLength(e.segs) : 0);

/** パンツのウエストを脇で詰める（脇の上端を内側へ dx 寄せる） */
function narrowWaist(pc: Piece, target: number): Piece {
  const edges = pc.edges.map((e) => ({ ...e, segs: [...e.segs] }));
  const waist = edges[0];
  const cTop = waist.segs[0].to;
  const dx = clamp(cTop.x - target, 0, cTop.x * 0.35);
  if (dx < 0.05) return pc;
  const side = edges[edges.length - 1];
  const last = side.segs[side.segs.length - 1];
  const hip = last.from;
  side.segs[side.segs.length - 1] = cubic(hip, v(hip.x, hip.y * 0.5), v(dx * 0.6, hip.y * 0.2), v(dx, 0));
  edges[0] = { ...waist, segs: [line(v(dx, 0), cTop)] };
  return { ...pc, edges };
}

export function draftSalopette(r: ResolvedBody, p: SalopetteParams): DraftResult {
  const missing = SALOPETTE_REQUIREMENTS.filter((q) => q.hard && r.values[q.key] === undefined).map((q) => q.key);
  if (missing.length > 0) throw new MissingMeasurementsError(missing);
  const val = (k: MeasurementKey) => r.values[k] as number;
  const warnings: string[] = [];
  const info: string[] = [];
  const W = val('waist_circ');
  const ext = clamp(W * 0.06, 0.5, 1.5); // 開きの持ち出し
  const skirt = p.bottom === 'skirt';
  const opening = skirt ? 'back' : p.opening;
  const roll = p.hem === 'rollup' && !skirt ? clamp(val('inseam') * 0.06, 0.5, 3) : 0;
  let pieces: Piece[] = [];
  let frontWaist = 0; // 前のウエスト（半分）
  let backWaist = 0; // 後ろのウエスト（半分。持ち出しは除く）
  let wh: number;
  let fitRef: number | undefined; // ゆとりの参考値（パンツのヒップのゆとり）

  if (!skirt) {
    // ---- パンツ ----
    const base = { ...DEFAULT_PANTS, fabric: 'woven' as const, waist: 'elastic' as const, fit: p.fit };
    const preset = p.bottom === 'long' ? { length: 'long' as const } : p.bottom === 'short' ? { length: 'short' as const } : { length: 'custom' as const, inseamCustom: val('inseam') * 0.3 };
    let res = draftPants(r, { ...base, ...preset });
    fitRef = res.refs?.fit;
    if (roll > 0) {
      // ロールアップ: 股下に折り返す分（2 回折る）を足して作り直す
      const m = res.info.join(' ').match(/股下 ([\d.]+)cm/);
      const inseam = m ? Number(m[1]) : val('inseam');
      res = draftPants(r, { ...base, length: 'custom', inseamCustom: inseam + roll * 2 });
      info.push(`ロールアップ: 裾を ${fmt(roll)}cm 幅で 2 回折り返す分を足しています`);
    }
    warnings.push(...res.warnings.filter((w) => !w.includes('ヒップ')));
    wh = clamp(val('waist_to_hip'), val('rise') * 0.4, val('rise') * 0.85);
    const yo = Math.min(wh * 1.15, val('rise') * 0.9); // 開きの長さ
    // 後ろ開きは 1 か所で、後ろ中心のまっすぐな部分までしか開けられない。開けたときヒップが通る分はウエストを残す
    const rawBack = res.pieces.find((pc) => pc.id === 'back-pants')!;
    const cbLine = rawBack.edges.find((e) => e.name === '後ろ中心')!.segs[0];
    const backOpenLen = Math.min(yo, cbLine.to.y - 0.3);
    const minWaistQ = opening === 'back' ? (val('hip_circ') + 0.4 - 2 * backOpenLen) / 4 : 0;
    const waistQ = Math.max((W + W * 0.04 + 0.2) / 4, minWaistQ);
    let front = narrowWaist(res.pieces.find((pc) => pc.id === 'front-pants')!, waistQ * 0.96);
    let back = narrowWaist(rawBack, waistQ * 1.04);
    const rename = (pc: Piece, from: string, to: string): Piece => ({ ...pc, edges: pc.edges.map((e) => (e.name === from ? { ...e, name: to, kind: 'seam' } : e)) });
    front = rename(front, 'ウエスト（ゴム通し）', 'ウエスト');
    back = rename(back, 'ウエスト（ゴム通し）', 'ウエスト');
    if (opening === 'side') {
      // 脇の上を開ける: 前は開きの辺、後ろは脇の外へ持ち出し
      const fs = front.edges[front.edges.length - 1];
      const [fLow, fUp] = splitSegsAtY(fs.segs, yo);
      front = { ...front, edges: [...front.edges.slice(0, -1), { ...fs, segs: fLow }, { segs: fUp, kind: 'opening', name: '脇開き' }] };
      const bs = back.edges[back.edges.length - 1];
      const [bLow, bUp] = splitSegsAtY(bs.segs, yo);
      const o = bLow[bLow.length - 1].to;
      const top = bUp[bUp.length - 1].to;
      back = {
        ...back,
        edges: [
          ...back.edges.slice(0, -1),
          { ...bs, segs: bLow },
          { segs: [line(o, v(o.x - ext, o.y))], kind: 'seam', name: '持ち出しの下端' },
          { segs: [line(v(o.x - ext, o.y), v(top.x - ext, 0))], kind: 'opening', name: '脇開き' },
          { segs: [line(v(top.x - ext, 0), top)], kind: 'seam', name: 'ウエスト（持ち出し）' },
        ],
        notes: [{ at: v(Math.min(o.x, top.x) - ext / 2, yo * 0.5), text: '持ち出し', vertical: true }],
      };
      info.push(`脇開き ${fmt(yo)}cm（後ろに持ち出し ${fmt(ext)}cm、ボタンかスナップで留める）`);
    } else {
      // 後ろ中心の上を開ける（中心の外へ持ち出し）
      const ci = back.edges.findIndex((e) => e.name === '後ろ中心');
      const c = back.edges[ci].segs[0];
      const yy = Math.min(yo, c.to.y - 0.3);
      const t = (yy - c.from.y) / (c.to.y - c.from.y);
      const o = v(c.from.x + (c.to.x - c.from.x) * t, yy);
      back = {
        ...back,
        edges: [
          back.edges[0],
          { segs: [line(c.from, v(c.from.x + ext, c.from.y))], kind: 'seam', name: 'ウエスト（持ち出し）' },
          { segs: [line(v(c.from.x + ext, c.from.y), v(o.x + ext, o.y))], kind: 'opening', name: '後ろ開き' },
          { segs: [line(v(o.x + ext, o.y), o)], kind: 'seam', name: '持ち出しの下端' },
          { segs: [line(o, c.to)], kind: 'seam', name: '後ろ中心' },
          ...back.edges.slice(ci + 1),
        ],
        notes: [{ at: v(Math.max(c.from.x, o.x) + ext / 2, (c.from.y + yy) / 2), text: '持ち出し', vertical: true }],
      };
      info.push(`後ろ開き ${fmt(yy)}cm（持ち出し ${fmt(ext)}cm）`);
    }
    frontWaist = lenOf(front.edges.find((e) => e.name === 'ウエスト'));
    backWaist = lenOf(back.edges.find((e) => e.name === 'ウエスト'));
    pieces = [front, back];
    info.push(...res.info.filter((s) => s.startsWith('ヒップのゆとり') || s.startsWith('裾の周り')));
  } else {
    // ---- スカート（Aライン・後ろ開き） ----
    const res = draftSkirt(r, { flare: 'aline', flareCustom: null, length: 'knee', lengthCustom: null, waist: 'belt', slit: false, extWidth: 'custom', extWidthCustom: ext });
    warnings.push(...res.warnings);
    pieces = res.pieces.filter((pc) => pc.id !== 'waistband');
    const sf = pieces.find((pc) => pc.id === 'skirt-front')!;
    const sb = pieces.find((pc) => pc.id === 'skirt-back')!;
    frontWaist = lenOf(sf.edges.find((e) => e.name === 'ウエスト'));
    backWaist = lenOf(sb.edges.find((e) => e.name === 'ウエスト'));
    wh = val('waist_to_hip');
    info.push(res.info[0], 'スカートは後ろ開き（ベルトの後ろ中心で重ねる）です');
  }

  // ---- ウエストのベルト ----
  const bandH = clamp(val('rise') * 0.14, 0.5, 1.5);
  const backBandLen = 2 * backWaist + 2 * ext;
  pieces.push(rect('back-band', '後ろベルト（高さ方向に二つ折り。開きの分だけ長い）', '1枚', backBandLen, bandH * 2, ['ウエスト側', '端', 'ウエスト側', '端']));
  if (!p.bib) pieces.push(rect('front-band', '前ベルト（高さ方向に二つ折り）', '1枚', 2 * frontWaist, bandH * 2, ['ウエスト側', '端', 'ウエスト側', '端']));
  info.push(`後ろベルト ${fmt(backBandLen)}cm${p.bib ? '' : `・前ベルト ${fmt(2 * frontWaist)}cm`} × 仕上がりの高さ ${fmt(bandH)}cm`);

  // ---- 胸当て ----
  const bh = val('back_length') * 0.55;
  let tw = 0;
  if (p.bib) {
    const bw = frontWaist * (skirt ? 0.9 : 0.85);
    tw = Math.min(bw, clamp(val('chest_circ') * 0.14, 1, 12));
    const bib: Piece = {
      id: 'bib',
      name: '胸当て',
      cut: '2枚（わ・表と裏）',
      edges: [
        { segs: [line(v(0, 0), v(tw, 0))], kind: 'seam', name: '上端' },
        { segs: [line(v(tw, 0), v(bw, bh))], kind: 'seam', name: '脇' },
        { segs: [line(v(bw, bh), v(0, bh))], kind: 'seam', name: 'ウエスト付け' },
        { segs: [line(v(0, bh), v(0, 0))], kind: 'fold', name: '前中心（わ）' },
      ],
      grain: [v(tw * 0.3, bh * 0.2), v(tw * 0.3, bh * 0.8)],
      marks: [],
    };
    const br = Math.min(0.2, tw * 0.1);
    if (p.strapFix === 'button') bib.marks!.push([v(tw - 0.5 - br, 0.5), v(tw - 0.5 + br, 0.5)], [v(tw - 0.5, 0.5 - br), v(tw - 0.5, 0.5 + br)]);
    if (p.bibPocket) {
      const pw = tw * 0.8;
      const ph = Math.min(bh * 0.4, pw * 0.9);
      bib.marks!.push([v(tw * 0.15, bh * 0.25), v(tw * 0.15 + pw * 0.5, bh * 0.25)], [v(tw * 0.15 + pw * 0.5, bh * 0.25), v(tw * 0.15 + pw * 0.5, bh * 0.25 + ph)]);
      pieces.push(rect('bib-pocket', '胸当てのポケット（中心に合わせて貼る）', '1枚', pw, ph, ['ポケット口', '脇', '底', '脇'], ['hem', 'seam', 'seam', 'seam']));
    }
    pieces.push(bib);
    // 胸当てを前のウエストに合わせて詰めた分はタックで
    if (bw < frontWaist - 0.05) info.push(`胸当て 上 ${fmt(2 * tw)}cm・下 ${fmt(2 * bw)}cm × 高さ ${fmt(bh)}cm（前のウエスト ${fmt(2 * frontWaist)}cm との差は、ウエストにタックを入れて合わせる）`);
  }

  // ---- 肩ひも ----
  const cross = p.straps === 'cross';
  const frontRest = Math.max(val('front_length') - (p.bib ? bh : 0), val('front_length') * 0.3);
  const strapLen = (frontRest + val('back_length')) * (cross ? 1.12 : 1) + (p.strapFix === 'button' ? 1.5 : 0.6);
  const sw = clamp(val('shoulder_width') * 0.08, 0.5, 2);
  pieces.push(rect('strap', `肩ひも（筒に縫って返す。${cross ? '背中でクロス' : 'まっすぐ'}）`, '2枚', strapLen, sw * 2, ['縁', '端', '縁', '端']));
  info.push(`肩ひも ${fmt(strapLen)}cm × 仕上がりの幅 ${fmt(sw)}cm（${p.strapFix === 'button' ? '前はボタンで留める。長めなので着せて合わせる' : '前も縫い付ける'}）`);

  // ---- ポケット ----
  if (!skirt) {
    const front = pieces.find((pc) => pc.id === 'front-pants')!;
    const back = pieces.find((pc) => pc.id === 'back-pants')!;
    const fw = clamp(frontWaist * 0.45, 0.8, 6);
    if (p.frontPocket) {
      const x0 = frontWaist * 0.25;
      front.marks = [...(front.marks ?? []), [v(x0, wh * 0.3), v(x0 + fw, wh * 0.3), v(x0 + fw, wh * 0.3 + fw * 0.9), v(x0, wh * 0.3 + fw * 0.9), v(x0, wh * 0.3)]];
      pieces.push(rect('front-pocket', '前ポケット（印に貼る）', '2枚', fw, fw * 0.9, ['ポケット口', '脇', '底', '脇'], ['hem', 'seam', 'seam', 'seam']));
    }
    if (p.backPocket) {
      const x0 = backWaist * 0.3;
      back.marks = [...(back.marks ?? []), [v(x0, wh * 0.45), v(x0 + fw, wh * 0.45), v(x0 + fw, wh * 0.45 + fw), v(x0, wh * 0.45 + fw), v(x0, wh * 0.45)]];
      pieces.push(rect('back-pocket', '後ろポケット（印に貼る）', '2枚', fw, fw, ['ポケット口', '脇', '底', '脇'], ['hem', 'seam', 'seam', 'seam']));
    }
  }

  info.unshift(
    `サロペット ${SALOPETTE_BOTTOM_LABEL[p.bottom]} ／ ${p.bib ? '胸当てあり' : '胸当てなし（サスペンダー）'} ／ 肩ひも ${cross ? '背中でクロス' : 'まっすぐ'} ／ ${opening === 'side' ? '脇開き' : '後ろ開き'} ／ ${p.fit === 'loose' ? '余裕あり' : '普通'}`,
  );
  info.push(`カテゴリ ${r.category ?? '未分類'}${r.categoryGuessed ? '（仮）' : ''}`);
  return { pieces, warnings, info, refs: fitRef !== undefined ? { fit: fitRef } : undefined };
}
