// 浴衣 = 身頃（前後が肩でつながった 1 枚）＋ 衽 ＋ 衿 ＋（共衿）＋ 袖 ＋ 帯。和裁の考え方で、ほとんどが直線のパーツ。
// 身頃の座標: x は背中心（前は衽付け）を 0 として脇へ正。y は後ろの裾が 0、肩山が身丈、前の裾が身丈×2。
// 女物はおはしょりの分だけ身丈を長くし、脇に身八つ口、袖に振りを開ける。男物はどちらも開けない。
// 本来の作り: 衽・共衿を別に裁つ。簡単な作り: 衽を前身頃と一緒に裁ち、共衿を省く（縫い目と厚みを減らす）。

import { Vec, v } from '../../geometry/vec';
import { cubic, line, pathLength } from '../../geometry/path';
import { ResolvedBody } from '../../model/estimate';
import { MeasurementKey } from '../../model/schema';
import { DraftResult, Edge, EdgeKind, Fabric, Piece } from '../types';
import { MissingMeasurementsError } from './tshirt';

export type SleeveLen = 'short' | 'normal' | 'long' | 'custom';

export interface YukataParams {
  fabric: Fabric;
  stretch: number;
  build: 'authentic' | 'simple';
  gender: 'women' | 'men';
  sleeveShape: 'square' | 'genroku';
  sleeveLen: SleeveLen;
  /** sleeveLen が custom のときの袖丈（cm） */
  sleeveLenCustom: number | null;
  obi: 'hanhaba' | 'heko';
  /** 作り帯（結んだ形を別に作って留める）にする */
  tsukuri: boolean;
}

export const DEFAULT_YUKATA: YukataParams = {
  fabric: 'woven',
  stretch: 0,
  build: 'simple',
  gender: 'women',
  sleeveShape: 'square',
  sleeveLen: 'normal',
  sleeveLenCustom: null,
  obi: 'hanhaba',
  tsukuri: true,
};

export const SLEEVE_LEN_LABEL: Record<SleeveLen, string> = { short: '短め', normal: '普通', long: '長め', custom: '自分で入力' };

export const YUKATA_REQUIREMENTS: { key: MeasurementKey; hard: boolean }[] = [
  { key: 'chest_circ', hard: true },
  { key: 'waist_circ', hard: true },
  { key: 'hip_circ', hard: true },
  { key: 'neck_circ', hard: false },
  { key: 'neck_length', hard: false },
  { key: 'shoulder_width', hard: false },
  { key: 'back_length', hard: false },
  { key: 'arm_length', hard: false },
  { key: 'upper_arm_circ', hard: false },
  { key: 'waist_to_hip', hard: false },
  { key: 'rise', hard: false },
  { key: 'inseam', hard: false },
];

const fmt = (x: number) => (Math.round(x * 10) / 10).toFixed(1);
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const finite = (x: number | null): x is number => x !== null && Number.isFinite(x);
const L = (a: Vec, b: Vec) => line(a, b);

function rectPiece(id: string, name: string, cut: string, w: number, h: number, kinds: [EdgeKind, EdgeKind, EdgeKind, EdgeKind], names: [string, string, string, string]): Piece {
  return {
    id,
    name,
    cut,
    edges: [
      { segs: [L(v(0, 0), v(w, 0))], kind: kinds[0], name: names[0] },
      { segs: [L(v(w, 0), v(w, h))], kind: kinds[1], name: names[1] },
      { segs: [L(v(w, h), v(0, h))], kind: kinds[2], name: names[2] },
      { segs: [L(v(0, h), v(0, 0))], kind: kinds[3], name: names[3] },
    ],
    grain: w > h ? [v(w * 0.2, h * 0.5), v(w * 0.8, h * 0.5)] : [v(w * 0.5, h * 0.2), v(w * 0.5, h * 0.8)],
  };
}

export function draftYukata(r: ResolvedBody, p: YukataParams): DraftResult {
  const missing = YUKATA_REQUIREMENTS.filter((q) => r.values[q.key] === undefined).map((q) => q.key);
  if (missing.length > 0) throw new MissingMeasurementsError(missing);
  const val = (k: MeasurementKey) => r.values[k] as number;
  const warnings: string[] = [];
  const info: string[] = [];
  const women = p.gender === 'women';
  const simple = p.build === 'simple';

  // ---- 寸法 ----
  const bl = val('back_length');
  const ankleH = r.values.foot_height ?? val('inseam') * 0.06;
  const toAnkle = bl + val('rise') + val('inseam') - ankleH; // 首の付け根から足首まで
  const ohashori = women ? bl * 0.35 : 0;
  const mitake = toAnkle + ohashori; // 身丈
  const hipE = Math.max(val('hip_circ'), val('chest_circ')) * 1.06 + 0.5;
  const ushiro = hipE * 0.31; // 後幅
  const mae = hipE * 0.25; // 前幅
  const okumi = hipE * 0.16; // 衽幅
  const aizuma = okumi * 0.9; // 合褄幅
  const katahaba = Math.max(ushiro, val('shoulder_width') * 0.55); // 肩幅
  const yuki = val('shoulder_width') / 2 + val('arm_length'); // 裄
  let sodehaba = yuki - katahaba; // 袖幅
  if (sodehaba < val('upper_arm_circ') * 0.6) {
    sodehaba = val('upper_arm_circ') * 0.6;
    info.push('肩幅が広いボディなので、袖幅は腕が隠れる最小の幅にしました（裄が少し長くなります）');
  }
  const sodetake =
    p.sleeveLen === 'custom' && finite(p.sleeveLenCustom)
      ? p.sleeveLenCustom
      : val('arm_length') * { short: 0.45, normal: 0.6, long: 0.8, custom: 0.6 }[p.sleeveLen]; // 袖丈
  const sodetsuke = women ? sodetake * 0.47 : sodetake * 0.8; // 袖付け
  const yatsu = women ? Math.min(sodetsuke * 0.6, bl * 0.4) : 0; // 身八つ口
  const sodeguchi = sodetake * 0.47; // 袖口
  const eriAki = val('neck_circ') * 0.24; // 衿肩明き（背中心から）
  const kurikoshi = women ? val('neck_circ') * 0.05 : 0; // 繰越
  const okumiSagari = bl * 0.6; // 衽下がり（肩山から衽の上端まで）
  const erishita = mitake * 0.48; // 衿下（前の裾から衿先まで）
  const eriW = clamp(val('neck_circ') * 0.08, 0.4, 1.5); // 衿の仕上がり幅

  // ---- 身頃 ----
  const M = mitake;
  const sideTopBack = M - sodetsuke - yatsu;
  const sideTopFront = M + sodetsuke + yatsu;
  const neckBack = cubic(v(eriAki, M), v(eriAki * 0.6, M - kurikoshi * 0.2), v(eriAki * 0.25, M - kurikoshi), v(0, M - kurikoshi));
  const edges: Edge[] = [
    { segs: [L(v(0, 0), v(ushiro, 0))], kind: 'hem', name: '裾（後ろ）' },
    { segs: [L(v(ushiro, 0), v(katahaba, sideTopBack))], kind: 'seam', name: '脇（後ろ）' },
  ];
  if (women) edges.push({ segs: [L(v(katahaba, sideTopBack), v(katahaba, M - sodetsuke))], kind: 'opening', name: '身八つ口（後ろ）' });
  edges.push({ segs: [L(v(katahaba, M - sodetsuke), v(katahaba, M + sodetsuke))], kind: 'seam', name: '袖付け' });
  if (women) edges.push({ segs: [L(v(katahaba, M + sodetsuke), v(katahaba, sideTopFront))], kind: 'opening', name: '身八つ口（前）' });
  let frontEdgeLen: number; // 衿を付ける長さ（身頃の分）
  if (simple) {
    // 衽を前身頃と一緒に裁つ: 前端は背中心の線から衽幅だけ外へ
    const tip = v(-aizuma, 2 * M - erishita);
    edges.push(
      { segs: [L(v(katahaba, sideTopFront), v(mae, 2 * M))], kind: 'seam', name: '脇（前）' },
      { segs: [L(v(mae, 2 * M), v(-okumi, 2 * M))], kind: 'hem', name: '裾（前）' },
      { segs: [L(v(-okumi, 2 * M), tip)], kind: 'opening', name: '前端（衿下）' },
      { segs: [L(tip, v(eriAki, M))], kind: 'seam', name: '衿付け' },
    );
    frontEdgeLen = pathLength([L(tip, v(eriAki, M))]);
  } else {
    const okumiTop = v(0, M + okumiSagari);
    edges.push(
      { segs: [L(v(katahaba, sideTopFront), v(mae, 2 * M))], kind: 'seam', name: '脇（前）' },
      { segs: [L(v(mae, 2 * M), v(0, 2 * M))], kind: 'hem', name: '裾（前）' },
      { segs: [L(v(0, 2 * M), okumiTop)], kind: 'seam', name: '衽付け' },
      { segs: [L(okumiTop, v(eriAki, M))], kind: 'seam', name: '衿付け' },
    );
    frontEdgeLen = pathLength([L(okumiTop, v(eriAki, M))]);
  }
  edges.push(
    { segs: [neckBack], kind: 'seam', name: '衿付け（後ろ）' },
    { segs: [L(v(0, M - kurikoshi), v(0, 0))], kind: 'seam', name: '背縫い' },
  );
  const body: Piece = {
    id: 'body',
    name: '身頃（前後続き。真ん中の線が肩山）',
    cut: '2枚（左右反転）',
    edges,
    grain: [v(Math.min(mae, ushiro) * 0.5, M * 0.3), v(Math.min(mae, ushiro) * 0.5, M * 1.7)],
    marks: [[v(eriAki + 0.2, M), v(katahaba - 0.2, M)]],
  };
  const pieces: Piece[] = [body];

  // ---- 衽（本来の作り） ----
  let okumiEdgeLen = 0;
  if (!simple) {
    const top = M - okumiSagari; // 衽の長さ（前の裾から上端まで）
    const okumiPiece: Piece = {
      id: 'okumi',
      name: '衽',
      cut: '2枚（左右反転）',
      edges: [
        { segs: [L(v(0, top), v(okumi, top))], kind: 'hem', name: '裾' },
        { segs: [L(v(okumi, top), v(aizuma, top - erishita))], kind: 'opening', name: '前端（衿下）' },
        { segs: [L(v(aizuma, top - erishita), v(0, 0))], kind: 'seam', name: '衿付け' },
        { segs: [L(v(0, 0), v(0, top))], kind: 'seam', name: '衽付け' },
      ],
      grain: [v(okumi * 0.4, top * 0.3), v(okumi * 0.4, top * 0.9)],
    };
    okumiEdgeLen = pathLength(okumiPiece.edges[2].segs);
    pieces.push(okumiPiece);
  }

  // ---- 衿・共衿 ----
  const eriLen = pathLength([neckBack]) + frontEdgeLen + okumiEdgeLen; // 背中心から衿先まで
  pieces.push(rectPiece('eri', '衿（幅方向に二つ折り）', '1枚（背中心わ）', eriLen, eriW * 2, ['seam', 'seam', 'seam', 'fold'], ['衿付け', '衿先', '衿付け', '背中心（わ）']));
  if (!simple) {
    const tomoLen = pathLength([neckBack]) + frontEdgeLen * 0.9;
    pieces.push(rectPiece('tomoeri', '共衿（衿の上に重ねる）', '1枚（背中心わ）', tomoLen, eriW * 2, ['seam', 'seam', 'seam', 'fold'], ['衿付け', '端', '衿付け', '背中心（わ）']));
  }

  // ---- 袖（肩山で二つ折り。上下の辺が袂の底） ----
  const H2 = sodetake * 2;
  const mid = sodetake;
  const rr = p.sleeveShape === 'genroku' ? Math.min(sodetake * 0.4, sodehaba * 0.45) : 0;
  // 袖口側（右の辺）: 上から 袖口下 → 袖口（開き）→ 袖口下
  const sodeEdges: Edge[] = [];
  const furiKind: EdgeKind = 'hem';
  // 上の辺（袂の底・後ろ側）: 袖付け側 (0,0) → 袖口側 (sodehaba, 0)
  if (rr > 0) {
    sodeEdges.push({
      segs: [L(v(0, 0), v(sodehaba - rr, 0)), cubic(v(sodehaba - rr, 0), v(sodehaba - rr * 0.45, 0), v(sodehaba, rr * 0.45), v(sodehaba, rr))],
      kind: 'seam',
      name: '袂（丸み）',
    });
  } else {
    sodeEdges.push({ segs: [L(v(0, 0), v(sodehaba, 0))], kind: 'seam', name: '袂' });
  }
  sodeEdges.push(
    { segs: [L(v(sodehaba, rr), v(sodehaba, mid - sodeguchi))], kind: 'seam', name: '袖口下' },
    { segs: [L(v(sodehaba, mid - sodeguchi), v(sodehaba, mid + sodeguchi))], kind: 'hem', name: '袖口' },
    { segs: [L(v(sodehaba, mid + sodeguchi), v(sodehaba, H2 - rr))], kind: 'seam', name: '袖口下' },
  );
  if (rr > 0) {
    sodeEdges.push({
      segs: [cubic(v(sodehaba, H2 - rr), v(sodehaba, H2 - rr * 0.45), v(sodehaba - rr * 0.45, H2), v(sodehaba - rr, H2)), L(v(sodehaba - rr, H2), v(0, H2))],
      kind: 'seam',
      name: '袂（丸み）',
    });
  } else {
    sodeEdges.push({ segs: [L(v(sodehaba, H2), v(0, H2))], kind: 'seam', name: '袂' });
  }
  // 袖付け側（左の辺）: 下から 振り → 袖付け → 振り（男物は振りなしで、袖付けの外は縫い閉じる）
  const tsukeTop = mid - sodetsuke;
  const tsukeBottom = mid + sodetsuke;
  sodeEdges.push(
    { segs: [L(v(0, H2), v(0, tsukeBottom))], kind: women ? furiKind : 'seam', name: women ? '振り' : '袖付け下（縫い閉じる）' },
    { segs: [L(v(0, tsukeBottom), v(0, tsukeTop))], kind: 'seam', name: '袖付け' },
    { segs: [L(v(0, tsukeTop), v(0, 0))], kind: women ? furiKind : 'seam', name: women ? '振り' : '袖付け下（縫い閉じる）' },
  );
  pieces.push({
    id: 'sode',
    name: `袖（真ん中の線が肩山）${p.sleeveShape === 'genroku' ? '・元禄袖' : ''}`,
    cut: '2枚',
    edges: sodeEdges,
    grain: [v(sodehaba * 0.4, sodetake * 0.3), v(sodehaba * 0.4, sodetake * 1.7)],
    marks: [[v(0.2, mid), v(sodehaba - 0.2, mid)]],
  });

  // ---- 帯 ----
  const waist = val('waist_circ');
  const bw = clamp(val('waist_to_hip') * 0.75, 0.6, 6); // 半幅帯の仕上がり幅
  const heko = p.obi === 'heko';
  if (!p.tsukuri) {
    if (heko) {
      const w = bw * 2.5;
      pieces.push(rectPiece('obi', '兵児帯（1 枚仕立て。端は三つ折り）', '1枚（長いので継いでもよい）', waist * 3, w, ['hem', 'hem', 'hem', 'hem'], ['縁', '端', '縁', '端']));
    } else {
      pieces.push(rectPiece('obi', '半幅帯（幅方向に二つ折り）', '1枚（長いので継いでもよい）', waist * 3.5, bw * 2, ['seam', 'seam', 'seam', 'seam'], ['縁', '端', '縁', '端']));
    }
    info.push(`帯: ${heko ? '兵児帯' : '半幅帯'}（結んで締める）／ 長さ ${fmt(heko ? waist * 3 : waist * 3.5)}cm`);
  } else {
    // 作り帯: 胴に巻く帯 ＋ 結んだ形（羽根・たれ・結び目）を別に作って留める
    const k = heko ? 1.4 : 1;
    const doLen = waist * 1.05 + bw * 1.2; // 重なり分を足す
    pieces.push(rectPiece('obi-do', '胴帯（幅方向に二つ折り。重なりに面ファスナー）', '1枚', doLen, bw * 2, ['seam', 'seam', 'seam', 'seam'], ['縁', '端', '縁', '端']));
    pieces.push(rectPiece('obi-hane', `羽根（${heko ? '蝶結び' : '文庫結び'}。輪にしてたたむ）`, heko ? '1枚（1 枚仕立て）' : '1枚', bw * 4 * k, bw * 2 * k, heko ? ['hem', 'hem', 'hem', 'hem'] : ['seam', 'seam', 'seam', 'seam'], ['縁', '端', '縁', '端']));
    pieces.push(rectPiece('obi-tare', 'たれ（結びの下に垂らす）', heko ? '1枚（1 枚仕立て）' : '1枚', bw * 2 * k, bw * 2 * k, heko ? ['hem', 'hem', 'hem', 'hem'] : ['seam', 'seam', 'seam', 'seam'], ['縁', '端', '縁', '端']));
    pieces.push(rectPiece('obi-musubi', '結び目（羽根の真ん中に巻く）', '1枚', bw * 1.6 * k, bw * 1.2, ['seam', 'seam', 'seam', 'seam'], ['縁', '端', '縁', '端']));
    info.push(`帯: ${heko ? '兵児帯' : '半幅帯'}の作り帯 ／ 胴帯 ${fmt(doLen)}cm × 幅 ${fmt(bw)}cm。結んだ形を後ろに付け、胴帯は面ファスナーやスナップで留めます`);
  }

  info.unshift(
    `${women ? '女物（おはしょり・身八つ口・振りあり）' : '男物'} ／ ${simple ? '簡単な作り（衽を前身頃と一緒に裁つ・共衿なし）' : '本来の作り（衽・衿・共衿を別に裁つ）'}`,
    `身丈 ${fmt(mitake)}cm${women ? `（おはしょり ${fmt(ohashori)}cm 込み）` : ''} ／ 裄 ${fmt(katahaba + sodehaba)}cm（肩幅 ${fmt(katahaba)}・袖幅 ${fmt(sodehaba)}）`,
    `後幅 ${fmt(ushiro)}cm ／ 前幅 ${fmt(mae)}cm ／ 衽幅 ${fmt(okumi)}cm ／ 袖丈 ${fmt(sodetake)}cm ／ 袖付け ${fmt(sodetsuke)}cm`,
    `衿 長さ ${fmt(eriLen * 2)}cm（衿先から衿先まで）× 幅 ${fmt(eriW)}cm`,
  );
  if (women) info.push(`おはしょり: 着せるときに腰で ${fmt(ohashori)}cm 分を折り上げて、腰ひもで留めます`);
  info.push('身頃と袖の真ん中の線は肩山（折り目）です。布を二つ折りにせず、1 枚の長い布として裁ちます');
  info.push(`カテゴリ ${r.category ?? '未分類'}${r.categoryGuessed ? '（仮）' : ''}`);
  return { pieces, warnings, info, refs: { sleeveLen: sodetake } };
}
