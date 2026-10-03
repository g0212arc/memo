// 共通採寸項目の定義。メーカー表記との対応表と、定型プロンプトはここから作る（唯一の元）。
// 内容は docs の 02-measurement-schema.md と一致させること。

export const MEASUREMENT_KEYS = [
  'height_with_head',
  'height',
  'head_circ',
  'neck_circ',
  'neck_length',
  'shoulder_width',
  'chest_circ',
  'waist_circ',
  'hip_circ',
  'back_length',
  'front_length',
  'armhole_circ',
  'waist_to_hip',
  'rise',
  'arm_length',
  'upper_arm_circ',
  'forearm_circ',
  'elbow_pass_circ',
  'wrist_circ',
  'hand_length',
  'wrist_joint_diam',
  'wrist_joint_circ',
  'hand_pass_circ',
  'outer_leg_length',
  'inseam',
  'crotch_to_ankle',
  'navel_to_sole',
  'thigh_circ',
  'calf_circ',
  'knee_height',
  'ankle_circ',
  'foot_length',
  'foot_width',
  'foot_height',
  'ankle_joint_diam',
  'ankle_joint_circ',
  'foot_pass_circ',
] as const;

export type MeasurementKey = (typeof MEASUREMENT_KEYS)[number];

export type Group = 'torso' | 'arm' | 'leg';

export interface MeasurementDef {
  key: MeasurementKey;
  ja: string;
  /** メーカー表記の例（中国語・日本語）。プロンプトの対応表に使う */
  aliases: string[];
  group: Group;
  /** 測り方（画面に表示する） */
  howTo: string;
  /** プロンプトに添える注意書き */
  promptNote?: string;
  /** ツールが推定するだけで、画像から読み取る対象ではない */
  toolOnly?: boolean;
}

export const MEASUREMENTS: MeasurementDef[] = [
  { key: 'height_with_head', ja: '身長（頭込み）', aliases: ['含头身高', '身高(含头)', '身長（頭込み）', '全高（ヘッド込み）'], group: 'torso', howTo: '頭のてっぺんから足裏まで。' },
  {
    key: 'height',
    ja: '身長（頭なし）',
    aliases: ['不含头身高', '身高(不含头)', '身高不含头', '身長（頭なし）', '身長（ヘッドなし）'],
    group: 'torso',
    howTo: '頭を外した状態で、首の上端から足裏まで。',
    promptNote: '頭込みか不明な「身高」「身長」は height に入れ ambiguities に書く',
  },
  { key: 'head_circ', ja: '頭囲', aliases: ['头围', '頭囲'], group: 'torso', howTo: '頭の一番太いところを一周。' },
  { key: 'neck_circ', ja: '首回り', aliases: ['脖围', '首回り', '首囲'], group: 'torso', howTo: '首の付け根を一周。' },
  { key: 'neck_length', ja: '首の長さ', aliases: ['脖长', '颈长', '首の長さ'], group: 'torso', howTo: '首の付け根（肩の線）から、首の上端（頭との境目）まで。' },
  { key: 'shoulder_width', ja: '肩幅', aliases: ['肩宽', '肩幅'], group: 'torso', howTo: '背中側で、左右の肩先（腕の付け根の上）の間をまっすぐ。' },
  { key: 'chest_circ', ja: '胸囲', aliases: ['胸围', 'バスト', '胸囲'], group: 'torso', howTo: '胸の一番高いところを水平に一周。' },
  { key: 'waist_circ', ja: 'ウエスト', aliases: ['腰围', 'ウエスト'], group: 'torso', howTo: '胴の一番細いところを一周。', promptNote: 'ウエストのこと。日本語の「腰囲」は、臀囲・ヒップが別にあればウエスト、なければヒップの可能性があるので ambiguities に書く' },
  { key: 'hip_circ', ja: 'ヒップ', aliases: ['臀围', 'ヒップ', '臀囲'], group: 'torso', howTo: 'お尻の一番太いところを水平に一周。' },
  { key: 'back_length', ja: '背丈', aliases: ['背长', '背丈'], group: 'torso', howTo: '首の後ろの付け根（背骨の出っ張り）から、ウエストの一番細いところまで。' },
  { key: 'front_length', ja: '前丈', aliases: ['前长'], group: 'torso', howTo: '首の前の付け根（鎖骨の間のくぼみ）から、胸を通ってウエストまで。' },
  { key: 'armhole_circ', ja: '腕の付け根回り', aliases: ['袖窿围', '臂根围'], group: 'torso', howTo: '腕の付け根を、肩先と脇の下を通って一周。' },
  { key: 'waist_to_hip', ja: '腰丈', aliases: ['腰臀距', '臀高差', '腰丈'], group: 'torso', howTo: '体の横で、ウエストからヒップの一番太いところまで。' },
  { key: 'rise', ja: '股上', aliases: ['立裆', '裆深', '股上'], group: 'torso', howTo: '体の横で、ウエストから股の高さまで（座った姿勢で座面まで測ってもよい）。' },
  { key: 'arm_length', ja: '腕の長さ', aliases: ['臂长', '手臂长', '腕の長さ', '袖丈', '腕長'], group: 'arm', howTo: '肩先から手首（手の関節の手前）まで。' },
  { key: 'upper_arm_circ', ja: '上腕回り', aliases: ['上臂围', '大臂围', '手臂围', '上腕囲'], group: 'arm', howTo: '二の腕の一番太いところを一周。' },
  {
    key: 'elbow_pass_circ',
    ja: '肘が通る周り',
    aliases: ['肘围', '肘周り', '肘回り'],
    group: 'arm',
    howTo: '肘を軽く曲げた状態で、関節の一番太いところを一周（袖口を通すときに必要）。',
  },
  { key: 'forearm_circ', ja: '前腕回り', aliases: ['小臂围', '前腕囲'], group: 'arm', howTo: '肘から先の一番太いところを一周。' },
  { key: 'wrist_circ', ja: '手首回り', aliases: ['手腕围', '手首囲'], group: 'arm', howTo: '手首の一番細いところを一周。' },
  { key: 'hand_length', ja: '手の長さ', aliases: ['手长', '手長'], group: 'arm', howTo: '手首から中指の先まで。' },
  { key: 'wrist_joint_diam', ja: '手首の球体関節の直径', aliases: ['手球', '手球直径'], group: 'arm', howTo: '手首の球体関節の直径。' },
  { key: 'wrist_joint_circ', ja: '手首の球体関節の周り', aliases: ['手球圆周长'], group: 'arm', howTo: '手首の球体関節を一周。' },
  { key: 'hand_pass_circ', ja: '手が通る周り', aliases: [], group: 'arm', howTo: '手をすぼめた状態で、一番太いところ（親指の付け根あたり）を一周。', toolOnly: true },
  { key: 'outer_leg_length', ja: '外脚長', aliases: ['外腿长', '腿长含脚', '脚長（足含む）'], group: 'leg', howTo: '体の横で、ウエストから足裏まで。' },
  { key: 'inseam', ja: '股下', aliases: ['内腿长', '裆至脚底', '裆到脚底腿长', '股下'], group: 'leg', howTo: '股から足裏まで。' },
  {
    key: 'crotch_to_ankle',
    ja: '股から足首',
    aliases: ['股から足首', '腿长（不含脚）', '腿长（从胯不含脚球）'],
    group: 'leg',
    howTo: '股から足首の関節まで（足は含まない）。ズボンのくるぶし丈の長さ。',
  },
  { key: 'navel_to_sole', ja: 'へそ〜足裏', aliases: ['肚脐至脚底', '臍〜足底'], group: 'leg', howTo: 'へその高さから足裏まで。' },
  { key: 'thigh_circ', ja: '太もも回り', aliases: ['大腿围', '太もも', '太腿囲'], group: 'leg', howTo: '太ももの一番太いところを一周。' },
  { key: 'calf_circ', ja: 'ふくらはぎ回り', aliases: ['小腿围', 'ふくらはぎ', 'ふくらはぎ囲'], group: 'leg', howTo: 'ふくらはぎの一番太いところを一周。' },
  { key: 'knee_height', ja: '膝の高さ', aliases: ['膝高', '膝の高さ'], group: 'leg', howTo: '膝の関節の中心から足裏まで。' },
  { key: 'ankle_circ', ja: '足首回り', aliases: ['脚踝围', '足首囲'], group: 'leg', howTo: '足首の一番細いところを一周。' },
  { key: 'foot_length', ja: '足の長さ', aliases: ['脚长', '足', '足の長さ', '足長'], group: 'leg', howTo: 'かかとからつま先まで。' },
  { key: 'foot_width', ja: '足の幅', aliases: ['脚宽', '足幅'], group: 'leg', howTo: '足の一番幅の広いところ。' },
  { key: 'foot_height', ja: '足の高さ', aliases: ['脚高'], group: 'leg', howTo: '足裏から足首の関節まで。' },
  { key: 'ankle_joint_diam', ja: '足首の球体関節の直径', aliases: ['脚球', '脚球直径', '足球直径'], group: 'leg', howTo: '足首の球体関節の直径。' },
  { key: 'ankle_joint_circ', ja: '足首の球体関節の周り', aliases: ['脚球圆周长'], group: 'leg', howTo: '足首の球体関節を一周。' },
  { key: 'foot_pass_circ', ja: '足が通る周り', aliases: [], group: 'leg', howTo: 'かかととつま先をぐるりと一周（ズボンの裾から足を通すときの周り）。', toolOnly: true },
];

export const DEF_BY_KEY: Record<MeasurementKey, MeasurementDef> = Object.fromEntries(
  MEASUREMENTS.map((d) => [d.key, d]),
) as Record<MeasurementKey, MeasurementDef>;

export function isMeasurementKey(k: string): k is MeasurementKey {
  return (MEASUREMENT_KEYS as readonly string[]).includes(k);
}
