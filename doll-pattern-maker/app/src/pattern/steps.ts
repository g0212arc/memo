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
