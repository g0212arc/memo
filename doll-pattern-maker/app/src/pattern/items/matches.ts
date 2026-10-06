// アイテムごとの合印の対応表（どの辺とどの辺を縫い合わせるか）。書き方は ../match.ts。
// 縫わない辺（裾・開き・わ）とダーツ（印のとおりに縫う）には付けない。
// 辺の名前を変えたら、ここも直す（tests/match.test.ts で、全部の辺が見つかるかを確かめている）。

import { MatchRule } from '../match';

/** 前身頃・後ろ身頃・袖（袖原型）に共通 */
const BODICE: MatchRule[] = [
  { a: ['front/肩'], b: ['back/肩'] },
  { a: ['front/脇'], b: ['back/脇'] },
  { a: ['front/袖ぐり'], b: ['sleeve/袖山（前）'], check: 'ease' },
  { a: ['back/袖ぐり'], b: ['sleeve/袖山（後ろ）'], check: 'ease' },
  { a: ['sleeve/袖下'] },
];
const NECK = ['front/襟ぐり', 'back/襟ぐり', 'back/襟ぐり（持ち出し）'];

/** ブラウス・ブラウスワンピースの身頃・袖・襟 */
const BLOUSE: MatchRule[] = [
  { a: ['front/肩'], b: ['back/肩'] },
  { a: ['front/脇'], b: ['back/脇'] },
  { a: ['front/袖ぐり'], b: ['sleeve/袖山（前）'], check: 'ease' },
  { a: ['back/袖ぐり'], b: ['sleeve/袖山（後ろ）'], check: 'ease' },
  { a: ['front/袖ぐり'], b: ['sleeve/袖山（前・ギャザー）'], check: 'none', note: '（ギャザーを寄せて）' },
  { a: ['back/袖ぐり'], b: ['sleeve/袖山（後ろ・ギャザー）'], check: 'none', note: '（ギャザーを寄せて）' },
  { a: ['front/袖ぐり', 'back/袖ぐり'], b: ['armhole-binding/縁取り#0'], check: 'none' },
  { a: ['sleeve/袖下'] },
  { a: ['sleeve/袖口（カフス付け）'], b: ['cuff/袖口側#0'], check: 'none' },
  {
    a: ['front/襟ぐり', 'front/襟ぐり（前立て）', 'back/襟ぐり', 'back/襟ぐり（持ち出し）'],
    b: ['stand/襟付け', 'collar/襟付け', 'frill-collar/襟付け（ギャザー）#0', 'binding/縁取り#0', 'bow/襟付け#0'],
    check: 'none',
  },
];

export const MATCH_RULES: Record<string, MatchRule[]> = {
  tshirt: [...BODICE, { a: NECK, b: ['binding/縁取り#0'], check: 'none', note: '（縁取り布は少し引きながら）' }],

  raglan: [
    { a: ['front/脇'], b: ['back/脇'] },
    { a: ['front/ラグラン線'], b: ['sleeve/ラグラン線（前）', 'sleeve-front/ラグラン線（前）'] },
    { a: ['back/ラグラン線'], b: ['sleeve/ラグラン線（後ろ）', 'sleeve-back/ラグラン線（後ろ）'] },
    { a: ['front/袖ぐり（袖下）'], b: ['sleeve/袖下カーブ（前）', 'sleeve-front/袖下カーブ（前）'] },
    { a: ['back/袖ぐり（袖下）'], b: ['sleeve/袖下カーブ（後ろ）', 'sleeve-back/袖下カーブ（後ろ）'] },
    { a: ['sleeve/袖下', 'sleeve-back/袖下', 'sleeve-front/袖下'] },
    { a: ['sleeve-back/肩・袖の外側'], b: ['sleeve-front/肩・袖の外側'] },
    {
      a: [...NECK, 'sleeve/襟ぐり（前）', 'sleeve/襟ぐり（後ろ）', 'sleeve-front/襟ぐり（前）', 'sleeve-back/襟ぐり（後ろ）'],
      b: ['binding/縁取り#0'],
      check: 'none',
      note: '（縁取り布は少し引きながら）',
    },
  ],

  cardigan: [
    ...BODICE,
    { a: ['sleeve/袖口（リブ付け）'], b: ['cuff/袖口側#0'], check: 'none' },
    { a: ['front/裾（リブ付け）', 'back/裾（リブ付け）'], b: ['hem-rib/裾側#0'], check: 'none' },
    { a: ['front/前端（前立て付け）', 'front/襟ぐり', 'back/襟ぐり'], b: ['front-band/前端・襟ぐり側#0'], check: 'none' },
    { a: ['front/襟ぐり', 'back/襟ぐり'], b: ['binding/縁取り#0'], check: 'none' },
    { a: ['front/前端（見返しと縫う）'], b: ['front-facing/前端（見返しと縫う）'] },
  ],

  trench: [
    { a: ['front/肩'], b: ['back/肩'] },
    { a: ['front/脇'], b: ['back/脇'] },
    { a: ['front/袖ぐり'], b: ['sleeve/袖山（前）'], check: 'ease' },
    { a: ['back/袖ぐり'], b: ['sleeve/袖山（後ろ）'], check: 'ease' },
    { a: ['front/ラグラン線'], b: ['sleeve-front/ラグラン線（前）'] },
    { a: ['back/ラグラン線'], b: ['sleeve-back/ラグラン線（後ろ）'] },
    { a: ['front/袖ぐり（袖下）'], b: ['sleeve-front/袖下カーブ（前）'] },
    { a: ['back/袖ぐり（袖下）'], b: ['sleeve-back/袖下カーブ（後ろ）'] },
    { a: ['sleeve-back/肩・袖の外側'], b: ['sleeve-front/肩・袖の外側'] },
    { a: ['sleeve/袖下', 'sleeve-back/袖下', 'sleeve-front/袖下'] },
    { a: ['front/前端（見返しと縫う）'], b: ['front-facing/前端（見返しと縫う）'] },
    {
      a: ['front/襟ぐり', 'back/襟ぐり', 'sleeve-front/襟ぐり（前）', 'sleeve-back/襟ぐり（後ろ）'],
      b: ['stand/襟付け'],
      check: 'none',
    },
    { a: ['stand/上襟付け'], b: ['collar/台襟付け'], check: 'none' },
    { a: ['front-lining/脇'], b: ['back-lining/脇'] },
  ],

  turtleneck: [
    ...BODICE,
    { a: NECK, b: ['turtle/襟ぐり側#0'], check: 'none' },
    { a: ['front/袖ぐり', 'back/袖ぐり'], b: ['armhole-binding/縁#0'], check: 'none' },
  ],

  sailor: [
    ...BODICE,
    { a: ['sleeve/袖口（カフス付け）'], b: ['cuff/袖口側#0'], check: 'none' },
    { a: ['front/前端（上）'], b: ['front-facing/前端（上）'] },
    { a: ['front/襟ぐり', 'back/襟ぐり', 'back/襟ぐり（持ち出し）'], b: ['collar/襟ぐり（前）', 'collar/襟ぐり（後ろ）'], check: 'none' },
    { a: ['collar/後ろ中心'] },
    { a: ['front-lining/肩'], b: ['back-lining/肩'] },
    { a: ['front-lining/脇'], b: ['back-lining/脇'] },
  ],

  yshirt: [
    { a: ['front/肩'], b: ['yoke/肩', 'back/肩'] },
    { a: ['yoke/ヨーク切り替え'], b: ['back/ヨーク切り替え'] },
    { a: ['front/脇'], b: ['back/脇'] },
    { a: ['front/袖ぐり'], b: ['sleeve/袖山（前）'], check: 'ease' },
    { a: ['yoke/袖ぐり', 'back/袖ぐり'], b: ['sleeve/袖山（後ろ）'], check: 'ease' },
    { a: ['sleeve/袖下'] },
    { a: ['sleeve/袖口（カフス付け）'], b: ['cuff/袖口側#0'], check: 'none' },
    {
      a: ['front/襟ぐり', 'front/襟ぐり（前立て）', 'yoke/襟ぐり', 'yoke/襟ぐり（持ち出し）', 'back/襟ぐり'],
      b: ['stand/襟付け', 'collar/襟付け'],
      check: 'none',
    },
    { a: ['stand/上襟付け'], b: ['collar/台襟付け'], check: 'none' },
  ],

  jacket: [
    { a: ['front/肩'], b: ['back/肩'] },
    { a: ['front/脇'], b: ['back/脇'] },
    { a: ['back/背中心'] },
    { a: ['front/袖ぐり'], b: ['sleeve/袖山（前）'], check: 'ease' },
    { a: ['back/袖ぐり'], b: ['sleeve/袖山（後ろ）'], check: 'ease' },
    { a: ['sleeve/袖下'] },
    { a: ['sleeve/袖口（カフス付け）'], b: ['cuff/袖口側#0'], check: 'none' },
    { a: ['collar/襟付け'], b: ['front/襟ぐり', 'back/襟ぐり'], check: 'none' },
    { a: ['front/襟の後ろ中心'] },
    { a: ['front/後ろ襟ぐり付け'], b: ['back/襟ぐり'], check: 'none' },
    { a: ['front-facing/見返し端'], b: ['front-lining/見返し付け'], check: 'none' },
    { a: ['front-lining/脇'], b: ['back-lining/脇'] },
    { a: ['back-lining/背中心'] },
    { a: ['sleeve-lining/袖下'] },
  ],

  hoodie: [
    ...BODICE,
    { a: ['sleeve/袖口（リブ付け）'], b: ['cuff/袖口側#0'], check: 'none' },
    { a: ['front/裾', 'back/裾'], b: ['hem-rib/裾側#0'], check: 'none' },
    { a: ['hood/後ろの縫い目'] },
    { a: ['hood/マチ付け'], b: ['hood-gusset/マチ付け'], check: 'none' },
    { a: ['front/襟ぐり', 'back/襟ぐり'], b: ['hood/襟付け', 'hood-gusset/襟付け'], check: 'none' },
  ],

  pants: [
    { a: ['front-pants/脇'], b: ['back-pants/脇'] },
    { a: ['front-pants/股下'], b: ['back-pants/股下'] },
    { a: ['front-pants/前中心', 'front-pants/股ぐり'], note: '（左右を縫い合わせる）' },
    { a: ['back-pants/後ろ中心', 'back-pants/股ぐり'], note: '（左右を縫い合わせる）' },
    { a: ['front-pants/ウエスト', 'front-pants/ウエスト（前立て）', 'back-pants/ウエスト'], b: ['waistband/ウエスト側#0'], check: 'none' },
  ],

  skirt: [
    { a: ['skirt-front/脇'], b: ['skirt-back/脇'] },
    { a: ['skirt-back/後ろ中心'], note: '（左右を縫い合わせる）' },
    { a: ['skirt-front/ウエスト', 'skirt-back/ウエスト', 'skirt-back/ウエスト（持ち出し）'], b: ['waistband/ウエスト側#0'], check: 'none' },
  ],

  pleats: [
    { a: ['pleats-front/脇', 'pleats-back/脇', 'skirt-back/脇'] },
    { a: ['pleats-back/後ろ中心'], note: '（左右を縫い合わせる）' },
    { a: ['pleats-front/ウエスト', 'pleats-front/ウエスト（ひだ）', 'pleats-back/ウエスト', 'pleats-back/ウエスト（持ち出し）', 'skirt-back/ウエスト'], b: ['waistband/ウエスト側#0'], check: 'none', note: '（ひだをたたんでから）' },
  ],

  tiered: [
    { a: ['tier1-back/後ろ中心'], note: '（左右を縫い合わせる）' },
    ...[1, 2, 3, 4].flatMap((k) => [
      { a: [`tier${k}-front/脇`, `tier${k}-back/脇`] },
      ...(k > 1 ? [{ a: [`tier${k - 1}-front/段の下`, `tier${k - 1}-back/段の下`], b: [`tier${k}-front/段の上（ギャザー）`, `tier${k}-back/段の上（ギャザー）`], check: 'none' as const, note: '（ギャザーを寄せて）' }] : []),
    ]),
    { a: ['tier1-front/ウエスト', 'tier1-back/ウエスト', 'tier1-back/ウエスト（持ち出し）'], b: ['waistband/ウエスト側#0'], check: 'none' },
  ],

  blouse: BLOUSE,

  'blouse-dress': [
    ...BLOUSE,
    { a: ['front/ウエスト'], b: ['skirt-front/ウエスト', 'skirt-front/ウエスト（ギャザーを寄せる）', 'skirt-front/ウエスト（持ち出し）'], check: 'none' },
    { a: ['back/ウエスト'], b: ['skirt-back/ウエスト', 'skirt-back/ウエスト（ギャザーを寄せる）', 'skirt-back/ウエスト（持ち出し）'], check: 'none' },
    { a: ['skirt-front/脇', 'skirt-back/脇'] },
    { a: ['skirt-front/前中心'], note: '（左右を縫い合わせる）' },
    { a: ['skirt-back/後ろ中心'], note: '（左右を縫い合わせる）' },
    { a: ['skirt-front/段の下', 'skirt-back/段の下'], b: ['tier2-front/段の上（ギャザー）', 'tier2-back/段の上（ギャザー）'], check: 'none', note: '（ギャザーを寄せて）' },
    { a: ['tier2-front/脇', 'tier2-back/脇'] },
    { a: ['tier2-front/段の下', 'tier2-back/段の下'], b: ['tier3-front/段の上（ギャザー）', 'tier3-back/段の上（ギャザー）'], check: 'none', note: '（ギャザーを寄せて）' },
    { a: ['tier3-front/脇', 'tier3-back/脇'] },
  ],

  vest: [
    { a: ['front/肩'], b: ['back/肩'] },
    { a: ['front/脇'], b: ['back/脇'] },
  ],

  salopette: [
    { a: ['front-pants/脇'], b: ['back-pants/脇'] },
    { a: ['front-pants/股下'], b: ['back-pants/股下'] },
    { a: ['front-pants/前中心', 'front-pants/股ぐり'], note: '（左右を縫い合わせる）' },
    { a: ['back-pants/後ろ中心', 'back-pants/股ぐり'], note: '（左右を縫い合わせる）' },
    { a: ['skirt-front/脇'], b: ['skirt-back/脇'] },
    { a: ['skirt-back/後ろ中心'], note: '（左右を縫い合わせる）' },
    { a: ['front-pants/ウエスト', 'skirt-front/ウエスト'], b: ['bib/ウエスト付け', 'front-band/ウエスト側#0'], check: 'none', note: '（胸当てはタックで合わせる）' },
    { a: ['back-pants/ウエスト', 'back-pants/ウエスト（持ち出し）', 'skirt-back/ウエスト', 'skirt-back/ウエスト（持ち出し）'], b: ['back-band/ウエスト側#0'], check: 'none' },
  ],

  bolero: [
    { a: ['front/肩'], b: ['back/肩'] },
    { a: ['front/脇'], b: ['back/脇'] },
    { a: ['front/袖ぐり'], b: ['sleeve/袖山（前）'], check: 'ease' },
    { a: ['back/袖ぐり'], b: ['sleeve/袖山（後ろ）'], check: 'ease' },
    { a: ['front/袖ぐり'], b: ['sleeve/袖山（前・ギャザー）'], check: 'none', note: '（ギャザーを寄せて）' },
    { a: ['back/袖ぐり'], b: ['sleeve/袖山（後ろ・ギャザー）'], check: 'none', note: '（ギャザーを寄せて）' },
    { a: ['sleeve/袖下'] },
  ],

  apron: [
    { a: ['apron-skirt/ウエスト', 'apron-skirt/ウエスト（ギャザーを寄せる）'], b: ['waistband/付け側#0'], check: 'none' },
    { a: ['apron-skirt/裾（フリル付け）'], b: ['frill/付け側#0'], check: 'none', note: '（ギャザーを寄せて）' },
    { a: ['bib/脇', 'bib/上端'], b: ['bib-frill/付け側#0'], check: 'none', note: '（ギャザーを寄せて）' },
  ],

  jsk: [
    { a: ['front/肩'], b: ['back/肩'] },
    { a: ['front/脇'], b: ['back/脇'] },
    { a: ['front/襟ぐり', 'front/襟ぐり（前立て）', 'back/襟ぐり', 'back/襟ぐり（持ち出し）'], b: ['binding/縁取り#0'], check: 'none' },
    { a: ['front/袖ぐり', 'back/袖ぐり'], b: ['armhole-binding/縁取り#0'], check: 'none' },
    { a: ['front/ウエスト'], b: ['skirt-front/ウエスト', 'skirt-front/ウエスト（ギャザーを寄せる）', 'skirt-front/ウエスト（ひだをたたむ）', 'skirt-front/ウエスト（持ち出し）'], check: 'none' },
    { a: ['back/ウエスト'], b: ['skirt-back/ウエスト', 'skirt-back/ウエスト（ギャザーを寄せる）', 'skirt-back/ウエスト（ひだをたたむ）', 'skirt-back/ウエスト（持ち出し）'], check: 'none' },
    { a: ['skirt-front/脇', 'skirt-back/脇'] },
    { a: ['skirt-front/前中心'], note: '（左右を縫い合わせる）' },
    { a: ['skirt-back/後ろ中心'], note: '（左右を縫い合わせる）' },
    { a: ['skirt-front/段の下', 'skirt-back/段の下'], b: ['tier2-front/段の上（ギャザー）', 'tier2-back/段の上（ギャザー）'], check: 'none', note: '（ギャザーを寄せて）' },
    { a: ['tier2-front/脇', 'tier2-back/脇'] },
    { a: ['tier2-front/段の下', 'tier2-back/段の下'], b: ['tier3-front/段の上（ギャザー）', 'tier3-back/段の上（ギャザー）'], check: 'none', note: '（ギャザーを寄せて）' },
    { a: ['tier3-front/脇', 'tier3-back/脇'] },
  ],

  camisole: [
    { a: ['front/脇'], b: ['back/脇'] },
    { a: ['front-lining/脇'], b: ['back-lining/脇'] },
    { a: ['front/胸元'], b: ['front-lining/胸元'] },
    { a: ['back/胸元'], b: ['back-lining/胸元'] },
    { a: ['front-skirt/脇'], b: ['back-skirt/脇'] },
    { a: ['back-skirt/後ろ中心'], note: '（左右を縫い合わせる）' },
    { a: ['front/ウエスト'], b: ['front-skirt/ウエスト', 'front-skirt/ウエスト（ギャザーを寄せる）'], check: 'none' },
    { a: ['back/ウエスト'], b: ['back-skirt/ウエスト', 'back-skirt/ウエスト（ギャザーを寄せる）'], check: 'none' },
  ],

  cape: [
    { a: ['cape/裾'], b: ['cape-lining/裾'] },
    { a: ['cape/前端'], b: ['cape-lining/前端'] },
    { a: ['cape/襟ぐり'], b: ['collar/襟付け', 'hood/襟付け'], check: 'none' },
    { a: ['hood/後ろの縫い目'] },
  ],

  yukata: [
    { a: ['body/脇（後ろ）'], b: ['body/脇（前）'] },
    { a: ['body/背縫い'], note: '（左右を縫い合わせる）' },
    { a: ['body/袖付け'], b: ['sode/袖付け'] },
    { a: ['body/衽付け'], b: ['okumi/衽付け'] },
    { a: ['body/衿付け', 'body/衿付け（後ろ）', 'okumi/衿付け'], b: ['eri/衿付け#0'], check: 'none' },
    { a: ['sode/袂', 'sode/袂（丸み）'] },
    { a: ['sode/袖口下'] },
    { a: ['sode/袖付け下（縫い閉じる）'] },
  ],

  china: [
    ...BODICE,
    { a: ['back/後ろ中心'], note: '（左右を縫い合わせる）' },
    { a: ['front/襟ぐり', 'back/襟ぐり'], b: ['collar/襟付け'] },
  ],

  socks: [{ a: ['sock/前の縫い目'] }, { a: ['sock/後ろの縫い目'] }, { a: ['sock/縫い目（脚の後ろ〜かかと〜足裏〜つま先）'] }],

  shorts: [
    { a: ['shorts/脇（前）', 'shorts-front/脇（前）'], b: ['shorts/脇（後ろ）', 'shorts-back/脇（後ろ）'] },
    { a: ['shorts-front/クロッチ付け'], b: ['gusset/クロッチ付け（前）'] },
    { a: ['shorts-back/クロッチ付け'], b: ['gusset/クロッチ付け（後ろ）'] },
  ],

  beret: [
    { a: ['beret-top/はぎ目'] },
    { a: ['beret-top/縁'], b: ['beret-under/外まわり'], check: 'none' },
    { a: ['beret-under/切れ目'], note: '（2 枚を縫い合わせて輪にする）' },
    { a: ['beret-under/頭の口'], b: ['beret-band/頭の口側#0'], check: 'none' },
  ],

  ears: [
    { a: ['ear-front/縁'], b: ['ear-back/縁'] },
    { a: ['ear-front/根元（底布付け）', 'ear-back/根元（底布付け）'], b: ['ear-base/底布付け'], check: 'none', note: '（タックを縫ってから）' },
  ],

  tights: [
    { a: ['front/肩'], b: ['back/肩'] },
    { a: ['front/タートルの脇'], b: ['back/タートルの脇'] },
    { a: ['front/脇'], b: ['back/脇'] },
    { a: ['front/股下'], b: ['back/股下'] },
    { a: ['front/股（前後を縫う）'], b: ['back/股（前後を縫う）'] },
    { a: ['front/前中心', 'front/股ぐり'], note: '（左右を縫い合わせる）' },
    { a: ['back/後ろ中心', 'back/股ぐり'], note: '（左右を縫い合わせる）' },
    { a: ['front/袖ぐり'], b: ['sleeve/袖山（前）'], check: 'ease' },
    { a: ['back/袖ぐり'], b: ['sleeve/袖山（後ろ）'], check: 'ease' },
    { a: ['sleeve/袖下'] },
    { a: ['front/足首（足先付け）', 'back/足首（足先付け）'], b: ['foot/足首（脚と縫う）'], check: 'none' },
    { a: ['foot/かかと・足裏'] },
    { a: ['foot/足の甲'] },
  ],
};
