// 作り方メモ（印刷の余白に入れる、縫う順番の簡単なメモ）。合印の記号を差し込む。
// メモ程度でよい（2026-10-03）。設定で出ない部分（袖なしの袖など）の行は出さない。

import { DraftResult } from './types';

type P = Record<string, unknown>;

interface H {
  p: P;
  /** その名前の辺に付いた合印（なければ空文字）。「パーツの id/辺の名前」でパーツも指定できる */
  l: (...names: string[]) => string;
  /** パーツがあるか */
  has: (id: string) => boolean;
}

/** 「（A）」「（A・B）」。記号がなければ空 */
const paren = (s: string) => (s ? `（${s}）` : '');

function helper(r: DraftResult, p: P): H {
  return {
    p,
    has: (id) => r.pieces.some((pc) => pc.id === id),
    l: (...names) => {
      // 「辺の名前」か「パーツの id/辺の名前」
      const hit = (pid: string, name: string) => names.some((n) => n === name || n === `${pid}/${name}`);
      const out: string[] = [];
      for (const pc of r.pieces) for (const e of pc.edges) if (e.match && hit(pc.id, e.name) && !out.includes(e.match)) out.push(e.match);
      return out.sort((a, b) => a.length - b.length || a.localeCompare(b)).join('・');
    },
  };
}

/** ブラウス（ワンピースは dress = true で裾の行を出さない） */
function blouseSteps(h: H, dress = false): string[] {
  const s: string[] = [`肩を縫う${paren(h.l('肩'))}`];
  if (h.has('jabot')) s.unshift('胸元のフリルにギャザーを寄せ、印に縫い付ける');
  if (h.has('sleeve')) {
    const gathered = h.l('sleeve/袖山（前・ギャザー）', 'sleeve/袖山（後ろ・ギャザー）');
    s.push(`${gathered ? '袖山に粗ミシンでギャザーを寄せて' : ''}袖を付ける${paren(gathered || h.l('袖山（前）', '袖山（後ろ）'))}`);
    s.push(`袖下から脇まで続けて縫う${paren([h.l('袖下'), h.l('脇')].filter(Boolean).join('→'))}`);
  } else {
    s.push(`脇を縫う${paren(h.l('脇'))}`);
    if (h.has('armhole-binding')) s.push(`袖ぐりを縁取り布で始末する${paren(h.l('armhole-binding/縁取り'))}`);
  }
  if (h.has('frill-collar')) s.push(`フリル襟にギャザーを寄せて襟ぐりに仮止めし、縁取り布で始末する${paren(h.l('襟付け（ギャザー）'))}`);
  else if (h.has('binding')) s.push(`襟ぐりを縁取り布で始末する${paren(h.l('binding/縁取り'))}`);
  else if (h.has('bow')) s.push(`${h.has('ribbon') ? '襟ぐりの帯を付け、リボンを結んで前中心に縫い付ける' : 'ボウタイの印のあいだを襟ぐりに付ける'}${paren(h.l('bow/襟付け'))}`);
  else s.push(`襟を作って付ける${paren(h.l('襟付け'))}`);
  if (h.has('cuff')) s.push(`袖口にギャザーを寄せてカフスを付ける${paren(h.l('袖口側'))}`);
  else if (h.has('sleeve') && h.p.sleeve === 'puff-short' && h.p.cuff === 'frill') s.push('袖口を三つ折りし、印にゴムを縫い付ける');
  else if (h.has('sleeve') && h.p.sleeve === 'puff-short') s.push('袖口を三つ折りしてゴムを通す');
  else if (h.has('sleeve')) s.push('袖口を三つ折り');
  if (!dress) s.push('前立て・裾を始末し、ボタン（スナップ）を付ける');
  return s;
}

/** 身頃＋袖の共通の流れ（肩 → 袖付け → 袖下〜脇） */
function bodice(h: H, opt: { neck?: string; sleeveless?: string } = {}): string[] {
  const s: string[] = [`肩を縫う${paren(h.l('肩'))}`];
  if (h.has('sleeve')) {
    s.push(`袖を付ける${paren(h.l('袖山（前）', '袖山（後ろ）'))}`);
    s.push(`袖下から脇まで続けて縫う${paren([h.l('袖下'), h.l('脇')].filter(Boolean).join('→'))}`);
  } else {
    if (opt.sleeveless) s.push(opt.sleeveless);
    s.push(`脇を縫う${paren(h.l('脇'))}`);
  }
  if (opt.neck) s.push(opt.neck);
  return s;
}

const STEPS: Record<string, (h: H) => string[]> = {
  tshirt: (h) => [...bodice(h, { neck: `襟ぐりを縁取る${paren(h.l('縁取り'))}` }), h.p.backOpening ? '背中開きを始末して面ファスナー・スナップ' : '', '裾・袖口を三つ折り'],
  raglan: (h) => [
    `袖を前後の身頃に付ける${paren(h.l('ラグラン線', 'ラグラン線（前）', 'ラグラン線（後ろ）', '袖ぐり（袖下）'))}`,
    h.has('sleeve-front') ? `2枚袖は先に肩〜袖の外側を縫う${paren(h.l('肩・袖の外側'))}` : '1枚袖は先に肩ダーツを縫う',
    `袖下から脇まで続けて縫う${paren([h.l('袖下'), h.l('脇')].filter(Boolean).join('→'))}`,
    `襟ぐりを縁取る${paren(h.l('縁取り'))}`,
    h.p.backOpening ? '背中開きを始末して面ファスナー・スナップ' : '',
    '裾・袖口を三つ折り',
  ],
  cardigan: (h) => [
    h.has('pocket') ? 'ポケットを前身頃の印に縫い付ける' : '',
    ...bodice(h),
    h.has('hem-rib') ? `裾リブ・袖口リブを付ける${paren([h.l('裾側'), h.l('袖口側')].filter(Boolean).join('・'))}` : '裾・袖口を三つ折り',
    h.has('front-band') ? `前立てリブを裾から襟ぐりまで付ける${paren(h.l('前端・襟ぐり側'))}` : `見返しを付けて返し、襟ぐりを縁取る${paren([h.l('前端（見返しと縫う）'), h.l('縁取り')].filter(Boolean).join('・'))}`,
    h.p.closure === 'none' ? '' : h.p.closure === 'button' ? '印の位置にボタンホールとボタン' : '印の位置にスナップ',
  ],
  trench: (h) => [
    h.has('pocket-flap') ? 'フラップを作って印の線に付ける（肩章・袖ベルト・タブも作っておく）' : '肩章・袖ベルト・タブを作っておく',
    h.has('sleeve-front') || h.has('sleeve-back')
      ? `袖を身頃に付け、袖下から脇まで縫う${paren([h.l('ラグラン線'), h.l('袖下'), h.l('脇')].filter(Boolean).join('→'))}`
      : `肩・袖付け・袖下〜脇を縫う${paren([h.l('肩'), h.l('袖山（前）', '袖山（後ろ）'), h.l('脇')].filter(Boolean).join('→'))}`,
    `襟を作って付ける${paren(h.l('襟付け'))}`,
    `見返し${h.has('front-lining') ? '・裏地' : ''}を付けて返す${paren(h.l('前端（見返しと縫う）'))}`,
    '裾・袖口を始末し、ボタン（スナップ）・ベルト通しを付ける',
  ],
  turtleneck: (h) => [
    ...bodice(h, { sleeveless: `袖ぐりを縁取る${paren(h.l('縁'))}` }),
    `タートルを二つ折りにして襟ぐりに付ける${paren(h.l('襟ぐり側'))}`,
    h.p.backOpening ? '背中開きを始末して面ファスナー・スナップ' : '',
    '裾・袖口を三つ折り',
  ],
  sailor: (h) => [
    '身頃と裏地をそれぞれ肩・脇を縫う',
    `襟を作り、身頃と裏地（見返し）で挟んで付ける${paren(h.l('襟ぐり（前）', '襟ぐり（後ろ）'))}`,
    `袖を付けて袖下を縫う${paren([h.l('袖山（前）', '袖山（後ろ）'), h.l('袖下')].filter(Boolean).join('→'))}`,
    h.has('cuff') ? `カフスを付ける${paren(h.l('袖口側'))}` : '袖口を三つ折り',
    '裾を始末し、スカーフ・ボタンを付ける',
  ],
  yshirt: (h) => [
    h.has('yoke') ? `ヨークを付ける${paren(h.l('ヨーク切り替え'))}` : '',
    `肩を縫う${paren(h.l('肩'))}`,
    `袖を付けて、袖下から脇まで続けて縫う${paren([h.l('袖山（前）', '袖山（後ろ）'), h.l('袖下'), h.l('脇')].filter(Boolean).join('→'))}`,
    `襟を作って付ける${paren(h.l('襟付け'))}`,
    h.has('cuff') ? `カフスを付ける${paren(h.l('袖口側'))}` : '袖口を三つ折り',
    '前立て・裾を始末し、ボタン（スナップ）を付ける',
  ],
  blouse: (h) => blouseSteps(h),
  'blouse-dress': (h) => [
    ...blouseSteps(h, true),
    h.has('skirt-front')
      ? `スカートの脇（と開きの下）を縫い、ウエストを身頃に付ける${paren([h.l('skirt-front/脇'), h.l('front/ウエスト', 'back/ウエスト')].filter(Boolean).join('→'))}`
      : '',
    h.has('tier2-front') ? `スカートの段を上から順にギャザーを寄せて付ける${paren(h.l('段の下'))}` : '',
    h.has('skirt-front') ? '' : '後ろ中心を開きの下から裾まで縫う（背中開きのとき）',
    '開き・裾を始末し、ボタン（スナップ）を付ける',
    h.has('sash') ? 'サッシュベルトを筒に縫って返す' : '',
  ],
  jsk: (h) => [
    h.has('binding')
      ? `肩・脇を縫い、襟ぐりと袖ぐりを縁取り布で始末する${paren([h.l('front/肩'), h.l('front/脇')].filter(Boolean).join('→'))}`
      : `表と裏をそれぞれ肩を縫い${paren(h.l('front/肩'))}、中表で襟ぐり・袖ぐり・開きを縫って返し、脇を続けて縫う${paren(h.l('front/脇'))}`,
    h.has('tier2-front') ? `スカートの段を上から順にギャザーを寄せて付ける${paren(h.l('段の下'))}` : '',
    h.p.skirt === 'pleats' ? '印どおりにひだをたたんでアイロン、ウエストを縫い止める' : '',
    `スカートの脇（と開きの下）を縫い、身頃に付ける${paren([h.l('skirt-front/脇'), h.l('front/ウエスト', 'back/ウエスト')].filter(Boolean).join('→'))}${h.has('sash') ? '（脇にリボンを挟む）' : ''}`,
    '開き・裾を始末し、ボタン（スナップ）を付ける',
  ],
  jacket: (h) => [
    `背中心・肩・脇を縫う${paren(h.l('back/背中心', 'front/肩', 'front/脇'))}`,
    `袖を作って付ける${paren([h.l('sleeve/袖下'), h.l('sleeve/袖山（前）', 'sleeve/袖山（後ろ）')].filter(Boolean).join('→'))}`,
    h.has('collar') ? `襟を作って付ける${paren(h.l('襟付け'))}` : '',
    h.has('front-lining') ? `裏地も同じように縫い、見返しと合わせる${paren(h.l('見返し端'))}` : '',
    '表と裏を中表で前端・裾を縫って返す',
    'ポケット・ボタンを付ける',
  ],
  hoodie: (h) => [
    h.has('pocket') ? 'ポケットを前身頃に仮止め' : '',
    ...bodice(h),
    `フードを作って襟ぐりに付ける${paren(h.l('襟付け'))}`,
    h.has('cuff') ? `袖口リブを付ける${paren(h.l('袖口側'))}` : '袖口を三つ折り',
    h.has('hem-rib') ? `裾リブを付ける${paren(h.l('裾側'))}` : '裾を三つ折り',
  ],
  pants: (h) => [
    `前の股ぐりを縫い合わせる${paren(h.l('front-pants/前中心', 'front-pants/股ぐり'))}（前開きは前立てを作る）`,
    `後ろの股ぐりを縫い合わせる${paren(h.l('back-pants/後ろ中心', 'back-pants/股ぐり'))}`,
    `脇を縫う${paren(h.l('脇'))}`,
    `股下を続けて縫う${paren(h.l('股下'))}`,
    h.has('waistband') ? `ウエストベルトを付ける${paren(h.l('ウエスト側'))}` : 'ウエストを三つ折りしてゴムを通す',
    '裾を三つ折り',
  ],
  skirt: (h) => [
    'ダーツがあれば縫う',
    `脇を縫う${paren(h.l('脇'))}`,
    h.l('後ろ中心') ? `後ろ中心を縫う${paren(h.l('後ろ中心'))}（開き・スリットは残す）` : '',
    h.has('waistband') ? `ウエストベルトを付ける${paren(h.l('ウエスト側'))}` : 'ウエストを三つ折りしてゴムを通す',
    '裾を三つ折り',
  ],
  pleats: (h) => [
    '裾を先に始末する',
    `脇を縫う${paren(h.l('脇'))}`,
    h.l('後ろ中心') ? `後ろ中心を縫う${paren(h.l('後ろ中心'))}（開きは残す）` : '',
    '印どおりにひだをたたんでアイロン、ウエストを縫い止める',
    h.has('waistband') ? `ウエストベルトを付ける${paren(h.l('ウエスト側'))}` : 'ウエストを三つ折りしてゴムを通す',
  ],
  tiered: (h) => [
    `段ごとに脇を縫って輪にする${paren(h.l('脇'))}${h.l('後ろ中心') ? `（1 段目の後ろ中心${paren(h.l('後ろ中心'))}は開きを残す）` : ''}`,
    '下の段の上の辺に粗ミシンを 2 本かけ、ギャザーを寄せる',
    `上の段から順に、印と脇を合わせて付ける${paren(h.l('段の下'))}`,
    h.has('waistband') ? `ウエストベルトを付ける${paren(h.l('ウエスト側'))}` : 'ウエストを三つ折りしてゴムを通す',
    h.p.hem === 'lace' ? '裾にレースを付ける' : '裾を三つ折り',
  ],
  camisole: (h) => [
    `身頃と裏地をそれぞれ脇を縫う${paren(h.l('front/脇', 'front-lining/脇'))}`,
    `肩ひもを挟んで胸元を縫い、返す${paren(h.l('胸元'))}`,
    `スカートの脇・後ろ中心を縫う${paren(h.l('front-skirt/脇', 'back-skirt/後ろ中心'))}`,
    `スカートにギャザーを寄せて身頃に付ける${paren(h.l('ウエスト'))}`,
    '背中開きを始末し、裾を三つ折り',
  ],
  cape: (h) => [
    h.has('hood') ? `フードを作る${paren(h.l('後ろの縫い目'))}` : '',
    h.has('collar') ? '襟を作る（表と裏を縫って返す）' : '',
    `襟（フード）を挟んで、表と裏地を縫う${paren([h.l('襟付け'), h.l('裾'), h.l('前端')].filter(Boolean).join('・'))}`,
    '返して形を整え、ひも・ボタンを付ける',
  ],
  yukata: (h) => [
    `背縫いをする${paren(h.l('背縫い'))}`,
    h.l('衽付け') ? `衽を付ける${paren(h.l('衽付け'))}` : '',
    `袖を作る${paren(h.l('袂', '袖口下'))}・袖を付ける${paren(h.l('袖付け'))}`,
    `脇を縫う${paren(h.l('脇（後ろ）', '脇（前）'))}`,
    `衿を付ける${paren(h.l('衿付け'))}`,
    '裾・衿下を三つ折り、帯を作る',
  ],
  china: (h) => [
    'ダーツを縫う',
    ...bodice(h, { sleeveless: h.p.sleeve === 'french' ? '袖口を縁取る' : '袖ぐりを縁取る' }),
    h.l('後ろ中心') ? `後ろ中心の下を縫う${paren(h.l('後ろ中心'))}` : '',
    `立ち襟を作って付ける${paren(h.l('襟付け'))}`,
    '背中開き・スリット・裾を始末し、飾りの線とチャイナボタン',
  ],
  socks: (h) => [
    '履き口を先に始末する',
    `縫い目を縫う${paren(h.l('前の縫い目', '後ろの縫い目', '縫い目（脚の後ろ〜かかと〜足裏〜つま先）'))}`,
    '表に返す',
  ],
  shorts: (h) => [
    h.has('gusset') ? `クロッチを前後に付ける${paren(h.l('クロッチ付け'))}` : '',
    `脇を縫う${paren(h.l('脇（前）'))}`,
    h.p.edge === 'elastic' ? 'ウエスト・脚ぐりにゴムを縫い付ける' : 'ウエスト・脚ぐりを三つ折り',
    '表に返して形を整える',
  ],
  beret: (h) => [
    h.l('はぎ目') ? `トップの扇形を縫い合わせる${paren(h.l('はぎ目'))}` : '',
    `下側 2 枚の切れ目を縫って輪にする${paren(h.l('切れ目'))}`,
    `トップと下側を中表に縫い、返す${paren(h.l('縁'))}`,
    h.has('beret-band') ? `ベルトを輪にして二つ折りし、頭の口に付ける${paren(h.l('頭の口'))}` : '頭の口を三つ折りにしてゴムを通す',
    h.has('beret-stem') ? 'ヘタを巻いて筒にし、てっぺんに縫い付ける' : '',
  ],
  ears: (h) => [
    h.has('ear-inner') ? '内側の布を表の印の位置にまつり付ける' : '',
    `表と裏を中表に縫う${paren(h.l('縁'))}（根元は開けておく）`,
    '縫い代を細く切って表に返し、綿を少し入れる',
    '根元の V の印をつまんでタックを縫う',
    h.has('ear-base') ? `底布に磁石を貼り、根元に縫い付ける${paren(h.l('底布付け'))}` : 'カチューシャに縫い付けるかボンドで貼る',
  ],
  tights: (h) => [
    `肩・脇を縫う${paren([h.l('肩'), h.l('脇')].filter(Boolean).join('・'))}`,
    h.has('sleeve') ? `袖を付けて袖下を縫う${paren([h.l('袖山（前）', '袖山（後ろ）'), h.l('袖下')].filter(Boolean).join('→'))}` : '',
    `前・後ろの中心を縫う${paren([h.l('前中心'), h.l('後ろ中心')].filter(Boolean).join('・'))}`,
    `股下を縫う${paren([h.l('股下'), h.l('股（前後を縫う）')].filter(Boolean).join('・'))}`,
    h.has('foot') ? `足先を作って付ける${paren(h.l('足首（脚と縫う）'))}` : '',
    '首・袖口・足首を始末する',
  ],
};

/** 作り方メモの行（① から番号付き）。登録のないアイテムは空 */
export function sewingSteps(itemId: string, params: P, result: DraftResult): string[] {
  const f = STEPS[itemId];
  if (!f) return [];
  const nums = '①②③④⑤⑥⑦⑧⑨⑩';
  return f(helper(result, params))
    .filter((s) => s)
    .map((s, i) => `${nums[i] ?? `${i + 1}.`} ${s}`);
}
