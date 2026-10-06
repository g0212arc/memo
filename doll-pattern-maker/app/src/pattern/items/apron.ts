// エプロン = スカート部（ギャザーか台形）＋ 腰ひも付きのベルト ＋（胸当て付きなら）胸当て・肩ひも ＋ フリル・ポケット。
// 前だけを覆うので、スカート部の幅はヒップの 55%（ギャザーはその 1.6 倍）。丈はスカートと同じ決め方。
// 座標: x は中心が 0 で脇へ正（中心わの半分で作図）、y はウエストが 0 で下向き。

import { v, Vec } from '../../geometry/vec';
import { line, pathLength } from '../../geometry/path';
import { ResolvedBody } from '../../model/estimate';
import { MeasurementKey } from '../../model/schema';
import { DraftResult, Edge, Piece } from '../types';
import { MissingMeasurementsError } from './tshirt';
import { rect, GATHER } from './dress-skirt';
import { SKIRT_LENGTH_LABEL, SKIRT_REQUIREMENTS, SkirtLength, skirtBase } from './skirt';

export interface ApronParams {
  type: 'bib' | 'waist';
  skirt: 'gather' | 'flat';
  length: SkirtLength;
  lengthCustom: number | null;
  frill: boolean;
  straps: 'cross' | 'neck';
  pocket: boolean;
}

export const DEFAULT_APRON: ApronParams = { type: 'bib', skirt: 'gather', length: 'knee', lengthCustom: null, frill: true, straps: 'cross', pocket: false };
export const APRON_TYPE_LABEL = { bib: '胸当て付き（メイド風）', waist: '腰エプロン' };
export const APRON_REQUIREMENTS: { key: MeasurementKey; hard: boolean }[] = [
  ...SKIRT_REQUIREMENTS,
  { key: 'chest_circ', hard: false },
  { key: 'neck_circ', hard: false },
  { key: 'back_length', hard: false },
  { key: 'front_length', hard: false },
];

/** フリルの寄せ分（倍） */
const FRILL = 1.8;
const fmt = (x: number) => (Math.round(x * 10) / 10).toFixed(1);
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export function draftApron(r: ResolvedBody, p: ApronParams): DraftResult {
  const missing = APRON_REQUIREMENTS.filter((q) => q.hard && r.values[q.key] === undefined).map((q) => q.key);
  if (missing.length > 0) throw new MissingMeasurementsError(missing);
  const val = (k: MeasurementKey) => r.values[k] as number;
  const b = skirtBase(r, p.length, p.lengthCustom);
  const warnings = [...b.warnings];
  const info: string[] = [];
  const L = b.length;
  const pieces: Piece[] = [];
  const gather = p.skirt === 'gather';
  const bib = p.type === 'bib';

  // ---- スカート部（中心わの半分） ----
  const frontWaist = b.waistF * 0.5; // 前のウエスト（ベルトに付ける幅）
  const hemHalf = gather ? (b.hipF * 0.55 * GATHER) / 2 : (b.hipF * 0.55) / 2 + L * 0.12;
  const topHalf = gather ? hemHalf : frontWaist / 2;
  const hemName = p.frill ? '裾（フリル付け）' : '裾';
  const skirt: Piece = {
    id: 'apron-skirt',
    name: gather ? 'スカート部（ギャザー）' : 'スカート部（台形）',
    cut: '1枚（わ）',
    edges: [
      { segs: [line(v(0, 0), v(topHalf, 0))], kind: 'seam', name: gather ? 'ウエスト（ギャザーを寄せる）' : 'ウエスト' },
      { segs: [line(v(topHalf, 0), v(hemHalf, L))], kind: 'hem', name: '脇' },
      { segs: [line(v(hemHalf, L), v(0, L))], kind: p.frill ? 'seam' : 'hem', name: hemName },
      { segs: [line(v(0, L), v(0, 0))], kind: 'fold', name: '中心（わ）' },
    ],
    grain: [v(Math.min(hemHalf, topHalf) * 0.18, L * 0.15), v(Math.min(hemHalf, topHalf) * 0.18, L * 0.85)],
  };
  pieces.push(skirt);
  info.push(`スカート部 ${gather ? `周り ${fmt(hemHalf * 2)}cm（前のウエスト ${fmt(frontWaist)}cm に寄せる）` : `上 ${fmt(topHalf * 2)}cm・裾 ${fmt(hemHalf * 2)}cm`} × 丈 ${fmt(L)}cm`);

  // ---- 腰ひも付きのベルト ----
  const bw = clamp(val('waist_to_hip') * 0.3, 0.5, 2);
  const tie = clamp(b.waistF * 0.6, 4, 40);
  const bandLen = frontWaist + tie * 2;
  const band = rect('waistband', 'ベルトと腰ひも（高さ方向に二つ折り。真ん中をスカート部に付け、両端を後ろで結ぶ）', '1枚', bandLen, bw * 2, ['付け側', '端', '付け側', '端']);
  band.marks = [[v(tie, 0), v(tie, 0.3)], [v(tie + frontWaist, 0), v(tie + frontWaist, 0.3)]];
  pieces.push(band);
  info.push(`ベルト ${fmt(bandLen)}cm × 仕上がりの幅 ${fmt(bw)}cm（印のあいだ ${fmt(frontWaist)}cm にスカート部を付ける）`);

  // ---- フリル（裾） ----
  const frH = clamp(L * 0.12, 0.6, 3);
  if (p.frill) {
    const fl = hemHalf * 2 * FRILL;
    pieces.push(rect('frill', '裾のフリル（高さ方向に二つ折り・ギャザーを寄せる）', '1枚', fl, frH * 2, ['付け側', '端', '付け側', '端']));
    info.push(`裾のフリル ${fmt(fl)}cm × 仕上がりの高さ ${fmt(frH)}cm`);
  }

  // ---- 胸当て・肩ひも ----
  if (bib) {
    const bh = val('back_length') * 0.55;
    const tw = clamp(val('chest_circ') * 0.12, 1, 10);
    const bwid = Math.max(tw, frontWaist * 0.36);
    const edges: Edge[] = [
      { segs: [line(v(0, 0), v(tw, 0))], kind: 'seam', name: '上端' },
      { segs: [line(v(tw, 0), v(bwid, bh))], kind: 'seam', name: '脇' },
      { segs: [line(v(bwid, bh), v(0, bh))], kind: 'seam', name: 'ウエスト付け' },
      { segs: [line(v(0, bh), v(0, 0))], kind: 'fold', name: '中心（わ）' },
    ];
    pieces.push({ id: 'bib', name: '胸当て', cut: '2枚（わ・表と裏）', edges, grain: [v(tw * 0.3, bh * 0.2), v(tw * 0.3, bh * 0.8)] });
    if (p.frill) {
      const around = 2 * (pathLength(edges[1].segs) + tw); // 両脇 ＋ 上端（全体）
      pieces.push(rect('bib-frill', '胸当てのフリル（高さ方向に二つ折り。両脇と上端に付ける）', '1枚', around * FRILL, frH * 0.7 * 2, ['付け側', '端', '付け側', '端']));
      info.push(`胸当てのフリル ${fmt(around * FRILL)}cm × 仕上がりの高さ ${fmt(frH * 0.7)}cm`);
    }
    const sw = clamp(val('chest_circ') * 0.04, 0.5, 1.8);
    const rest = Math.max(val('front_length') - bh, val('front_length') * 0.3);
    if (p.straps === 'cross') {
      const sl = (rest + val('back_length')) * 1.12 + 1;
      pieces.push(rect('strap', '肩ひも（筒に縫って返す。胸当ての上の角から、背中でクロスしてベルトに付ける）', '2枚', sl, sw * 2, ['縁', '端', '縁', '端']));
      info.push(`肩ひも ${fmt(sl)}cm × 仕上がりの幅 ${fmt(sw)}cm × 2 本（背中でクロス）`);
    } else {
      const sl = rest * 2 + val('neck_circ') * 0.6 + 1;
      pieces.push(rect('strap', '首ひも（筒に縫って返す。胸当ての上の両角に付け、首にかける）', '1枚', sl, sw * 2, ['縁', '端', '縁', '端']));
      info.push(`首ひも ${fmt(sl)}cm × 仕上がりの幅 ${fmt(sw)}cm`);
    }
    info.push(`胸当て 上 ${fmt(tw * 2)}cm・下 ${fmt(bwid * 2)}cm × 高さ ${fmt(bh)}cm（ベルトの上に付ける）`);
  }

  // ---- ポケット ----
  if (p.pocket) {
    const pw = clamp(hemHalf * 0.45, 0.8, 6);
    const ph = pw * 0.85;
    const px = Math.min(hemHalf, topHalf) * 0.35;
    const py = L * 0.3;
    const m: Vec[] = [v(px, py), v(px + pw, py), v(px + pw, py + ph), v(px, py + ph), v(px, py)];
    skirt.marks = [m];
    pieces.push(rect('pocket', 'ポケット（印に貼る）', '2枚', pw, ph, ['ポケット口', '脇', '底', '脇'], ['hem', 'seam', 'seam', 'seam']));
  }

  info.unshift(`エプロン ${APRON_TYPE_LABEL[p.type]} ／ ${SKIRT_LENGTH_LABEL[p.length]} ウエストから ${fmt(L)}cm ／ ${p.frill ? 'フリルあり' : 'フリルなし'}`);
  info.push(`カテゴリ ${r.category ?? '未分類'}${r.categoryGuessed ? '（仮）' : ''}`);
  return { pieces, warnings, info, refs: { length: L } };
}
