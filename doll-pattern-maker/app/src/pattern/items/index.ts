// アイテムの一覧。画面の設定欄はここの fields から自動で作る（アイテムを足すときはここに登録する）。

import { ResolvedBody } from '../../model/estimate';
import { MeasurementKey } from '../../model/schema';
import { DraftResult } from '../types';
import { FIT_LABEL, LENGTH_LABEL } from '../fit';
import { DEFAULT_TSHIRT, draftTshirt, TSHIRT_REQUIREMENTS, TshirtParams } from './tshirt';
import { DEFAULT_TURTLENECK, draftTurtleneck, TURTLENECK_REQUIREMENTS, TurtleneckParams } from './turtleneck';
import { DEFAULT_PANTS, draftPants, flyAvailable, FLY_CATEGORIES, PANTS_LENGTH_LABEL, PANTS_REQUIREMENTS, PantsParams } from './pants';
import { Category } from '../../model/category';
import {
  CAMISOLE_REQUIREMENTS,
  CamisoleParams,
  DEFAULT_CAMISOLE,
  draftCamisole,
  SKIRT_LABEL,
  SKIRT_LENGTH_LABEL,
  STRAP_LABEL,
} from './camisole';
import {
  BACK_OPENING_CATEGORIES,
  COLLAR_SHAPE_LABEL,
  COLLAR_SIZE_LABEL,
  DEFAULT_SAILOR,
  draftSailor,
  SAILOR_LENGTH_LABEL,
  SAILOR_REQUIREMENTS,
  SailorParams,
  V_DEPTH_LABEL,
} from './sailor';
import {
  DEFAULT_JACKET,
  draftJacket,
  JACKET_COLLAR_LABEL,
  JACKET_LENGTH_LABEL,
  JACKET_REQUIREMENTS,
  JacketParams,
  LAPEL_LABEL,
  ROLL_LABEL,
} from './jacket';
import { CAPE_COLLAR_LABEL, CAPE_FLARE_LABEL, CAPE_LENGTH_LABEL, CAPE_REQUIREMENTS, CapeParams, capeIsLong, DEFAULT_CAPE, draftCape } from './cape';
import { DEFAULT_HOODIE, draftHoodie, HOODIE_LENGTH_LABEL, HOODIE_REQUIREMENTS, HoodieParams } from './hoodie';
import { HEAD_SIZES } from '../hood';
import { DEFAULT_YUKATA, draftYukata, SLEEVE_LEN_LABEL, YUKATA_REQUIREMENTS, YukataParams } from './yukata';
import { TIGHTS_BUST_DART_RATIO } from '../bust';
import { DEFAULT_RAGLAN, draftRaglan, RAGLAN_REQUIREMENTS, RAGLAN_SLEEVE_LABEL, RaglanParams } from './raglan';
import { DEFAULT_SKIRT, draftSkirt, SKIRT_FLARE_LABEL, SKIRT_LENGTH_LABEL as SKIRT_ITEM_LENGTH_LABEL, SKIRT_REQUIREMENTS, SkirtParams, slitAvailable, SLIT_MAX_ANGLE } from './skirt';
import { DEFAULT_PLEATS, draftPleats, PLEAT_LABEL, PLEATS_REQUIREMENTS, PleatsParams } from './pleats';
import { CHINA_COLLAR_LABEL, CHINA_LENGTH_LABEL, CHINA_REQUIREMENTS, CHINA_SLEEVE_LABEL, CHINA_SLIT_LABEL, ChinaParams, chinaHasSleeve, chinaIsDress, DEFAULT_CHINA, draftChina } from './china';
import { DEFAULT_SHORTS, draftShorts, SHORTS_REQUIREMENTS, SHORTS_RISE_LABEL, SHORTS_SHAPE_LABEL, ShortsParams } from './shorts';
import { DEFAULT_SOCKS, draftSocks, SOCK_LENGTH_LABEL, SOCKS_REQUIREMENTS, SocksParams } from './socks';
import { COVERAGE_LABEL, DEFAULT_TIGHTS, draftTights, SNUG_LABEL, TIGHTS_REQUIREMENTS, TightsParams } from './tights';
import { DEFAULT_YSHIRT, draftYshirt, SHIRT_COLLAR_LABEL, SHIRT_LENGTH_LABEL, YSHIRT_REQUIREMENTS, YshirtParams } from './yshirt';

type Params = Record<string, unknown>;

/** 設定欄を出すときに参照するボディの情報 */
export interface FieldCtx {
  category: Category | null;
  /** 胸ダーツを選べるボディか */
  bustLarge: boolean;
  /** 胸囲 ÷ ウエスト（アイテムごとに基準を変えるとき用） */
  bustRatio: number;
}

/** 選択肢を、ボディによって出したり隠したりする */
type Available = (value: string, ctx: FieldCtx) => boolean;

export type FieldSpec =
  | {
      kind: 'radio';
      key: string;
      label: string;
      options: [string, string][];
      available?: Available;
      help?: string;
      show?: (p: Params, ctx: FieldCtx) => boolean;
    }
  | {
      kind: 'select';
      key: string;
      label: string;
      options: [string, string][];
      available?: Available;
      help?: string;
      show?: (p: Params, ctx: FieldCtx) => boolean;
    }
  | {
      kind: 'number';
      key: string;
      label: string;
      step: number;
      min?: number;
      max?: number;
      unit?: string;
      /** 空欄を許す（null を入れる） */
      nullable?: boolean;
      placeholder?: string;
      help?: string;
      show?: (p: Params, ctx: FieldCtx) => boolean;
    }
  | { kind: 'checkbox'; key: string; label: string; help?: string; show?: (p: Params, ctx: FieldCtx) => boolean };

export interface ItemDef {
  id: string;
  label: string;
  defaults: Params;
  requirements: { key: MeasurementKey; hard: boolean }[];
  fields: FieldSpec[];
  draft: (r: ResolvedBody, p: Params) => DraftResult;
}

const fitOptions = Object.entries(FIT_LABEL) as [string, string][];
const lengthOptions = Object.entries(LENGTH_LABEL) as [string, string][];

/** どのアイテムにも共通の設定 */
const fabricFields: FieldSpec[] = [
  { kind: 'radio', key: 'fabric', label: '布', options: [['knit', 'ニット（伸びる布）'], ['woven', '布帛（伸びない布）']] },
  {
    kind: 'number',
    key: 'stretch',
    label: '伸び率',
    step: 5,
    min: 0,
    max: 100,
    unit: '%',
    help: '横に引っぱったとき何％伸びるか。縁取り布の長さなどに使います。',
    show: (p) => p.fabric === 'knit',
  },
  { kind: 'checkbox', key: 'backOpening', label: '背中開き（面ファスナー・スナップ）' },
];
/** 胸が大きいボディで布帛のときだけ出す */
const dartField: FieldSpec = {
  kind: 'checkbox',
  key: 'bustDart',
  label: '胸ダーツを入れる',
  help: '胸囲とウエストの差が大きいボディ向け。脇から胸へダーツを入れて、前身頃を胸に沿わせます。',
  show: (p, ctx) => ctx.bustLarge && p.fabric === 'woven',
};
const fitFields = (withSleeve: (p: Params) => boolean = () => true): FieldSpec[] => [
  { kind: 'radio', key: 'fitBody', label: '身幅', options: fitOptions },
  { kind: 'radio', key: 'fitSleeve', label: '袖', options: fitOptions, show: withSleeve },
  { kind: 'radio', key: 'length', label: '丈', options: lengthOptions },
];
const fineFields = (withSleeve: (p: Params) => boolean = () => true): FieldSpec[] => [
  { kind: 'number', key: 'extraChestEase', label: '胸のゆとりを足す', step: 0.1, unit: 'cm' },
  {
    kind: 'number',
    key: 'extraSleeveWidth',
    label: '袖幅を足す',
    step: 0.1,
    unit: 'cm',
    help: '袖がきついときに。肘が通る周りより細くはなりません。',
    show: withSleeve,
  },
  { kind: 'number', key: 'extraArmholeEase', label: '袖ぐりのゆとりを足す', step: 0.1, unit: 'cm' },
];

const ITEM_LIST: ItemDef[] = [
  {
    id: 'tshirt',
    label: 'Tシャツ',
    defaults: { ...DEFAULT_TSHIRT },
    requirements: TSHIRT_REQUIREMENTS,
    fields: [
      ...fabricFields,
      dartField,
      ...fitFields(),
      {
        kind: 'number',
        key: 'sleeveRatio',
        label: '袖丈（腕の長さに対して）',
        step: 0.05,
        min: 0.1,
        max: 1,
        help: '0.3 で半袖。1.0 で手首まで。',
      },
      {
        kind: 'number',
        key: 'hemBelowWaist',
        label: '着丈（ウエストから下へ）',
        step: 0.1,
        unit: 'cm',
        nullable: true,
        placeholder: '丈の選択',
        help: '空欄なら「丈」の選択で決まります。マイナスで短くなります。',
      },
      { kind: 'number', key: 'frontNeckDrop', label: '前襟ぐりを下げる', step: 0.1, unit: 'cm' },
      ...fineFields(),
    ],
    draft: (r, p) => draftTshirt(r, p as unknown as TshirtParams),
  },
  {
    id: 'raglan',
    label: 'ラグラン袖シャツ',
    defaults: { ...DEFAULT_RAGLAN },
    requirements: RAGLAN_REQUIREMENTS,
    fields: [
      ...fabricFields,
      dartField,
      {
        kind: 'radio',
        key: 'shoulder',
        label: '肩の作り',
        options: [['dart', '1枚袖＋肩ダーツ'], ['two', '2枚袖（肩から袖の外側に縫い目）']],
        help: '2枚袖は肩の丸みがきれいに出ます。1枚袖は袖の上の三角（ダーツ）を縫います。',
      },
      { kind: 'radio', key: 'neck', label: '首まわり', options: [['crew', 'クルーネック'], ['v', 'Vネック']] },
      { kind: 'select', key: 'sleeve', label: '袖丈', options: Object.entries(RAGLAN_SLEEVE_LABEL) as [string, string][] },
      {
        kind: 'number',
        key: 'sleeveCustom',
        label: '袖丈（肩先から）',
        step: 0.1,
        min: 0.5,
        unit: 'cm',
        nullable: true,
        placeholder: '半袖',
        show: (p) => p.sleeve === 'custom',
      },
      ...fitFields(),
      {
        kind: 'number',
        key: 'hemBelowWaist',
        label: '着丈（ウエストから下へ）',
        step: 0.1,
        unit: 'cm',
        nullable: true,
        placeholder: '丈の選択',
        help: '空欄なら「丈」の選択で決まります。マイナスで短くなります。',
      },
      { kind: 'number', key: 'frontNeckDrop', label: '前襟ぐりを下げる', step: 0.1, unit: 'cm', help: 'Vネックでは V が深くなります。' },
      ...fineFields(),
    ],
    draft: (r, p) => draftRaglan(r, p as unknown as RaglanParams),
  },
  {
    id: 'turtleneck',
    label: 'タートルネック',
    defaults: { ...DEFAULT_TURTLENECK },
    requirements: TURTLENECK_REQUIREMENTS,
    fields: [
      { kind: 'radio', key: 'sleeve', label: '袖', options: [['long', '長袖'], ['none', 'なし（ノースリーブ）']] },
      ...fabricFields,
      dartField,
      ...fitFields((p) => p.sleeve !== 'none'),
      {
        kind: 'number',
        key: 'turtleRatio',
        label: 'タートルの高さ（首の長さに対して）',
        step: 0.1,
        min: 0.3,
        max: 2,
        help: '1.0 で首の長さと同じ高さ。',
      },
      ...fineFields((p) => p.sleeve !== 'none'),
    ],
    draft: (r, p) => draftTurtleneck(r, p as unknown as TurtleneckParams),
  },
  {
    id: 'pants',
    label: 'パンツ',
    defaults: { ...DEFAULT_PANTS },
    requirements: PANTS_REQUIREMENTS,
    fields: [
      fabricFields[0],
      fabricFields[1],
      {
        kind: 'radio',
        key: 'waist',
        label: 'ウエスト',
        options: [['elastic', 'ゴム'], ['fly', '前開き（ベルト付き）']],
        available: (value, ctx) => value !== 'fly' || flyAvailable(ctx.category),
        help: `前開きは ${FLY_CATEGORIES.join('・')} で選べます。`,
      },
      { kind: 'select', key: 'fit', label: '身幅', options: [...fitOptions, ['custom', '自分で入力']], help: 'タイトは裾へ細く、余裕ありはワイド寄りになります。' },
      {
        kind: 'number',
        key: 'hipEaseCustom',
        label: 'ヒップのゆとり',
        step: 0.1,
        min: 0,
        unit: 'cm',
        nullable: true,
        placeholder: '普通と同じ',
        help: 'ヒップ周りに足す長さ。脚の形は「普通」になります。',
        show: (p) => p.fit === 'custom',
      },
      { kind: 'select', key: 'length', label: '丈', options: Object.entries(PANTS_LENGTH_LABEL) as [string, string][] },
      {
        kind: 'number',
        key: 'inseamCustom',
        label: '股下（股から裾まで）',
        step: 0.1,
        min: 0.5,
        unit: 'cm',
        nullable: true,
        placeholder: 'くるぶし丈',
        show: (p) => p.length === 'custom',
      },
      {
        kind: 'number',
        key: 'hemCustom',
        label: '裾の周り（片脚）',
        step: 0.1,
        min: 1,
        unit: 'cm',
        nullable: true,
        placeholder: '身幅で決まる',
        help: '空欄なら身幅の選択で決まります。',
      },
    ],
    draft: (r, p) => draftPants(r, p as unknown as PantsParams),
  },
  {
    id: 'skirt',
    label: 'スカート',
    defaults: { ...DEFAULT_SKIRT },
    requirements: SKIRT_REQUIREMENTS,
    fields: [
      { kind: 'select', key: 'flare', label: '広がり', options: Object.entries(SKIRT_FLARE_LABEL) as [string, string][] },
      {
        kind: 'number',
        key: 'flareCustom',
        label: '広がりの角度（スカート全体）',
        step: 5,
        min: 0,
        max: 360,
        unit: '°',
        nullable: true,
        placeholder: 'Aライン（48°）',
        help: 'スカートを広げて置いたとき何度の円になるか。タイト 0°・Aライン 48°・半円 180°・全円 360°。',
        show: (p) => p.flare === 'custom',
      },
      { kind: 'select', key: 'length', label: '丈', options: Object.entries(SKIRT_ITEM_LENGTH_LABEL) as [string, string][] },
      {
        kind: 'number',
        key: 'lengthCustom',
        label: '丈（ウエストから裾まで）',
        step: 0.1,
        min: 1,
        unit: 'cm',
        nullable: true,
        placeholder: '膝丈',
        show: (p) => p.length === 'custom',
      },
      { kind: 'radio', key: 'waist', label: 'ウエスト', options: [['elastic', 'ゴム'], ['belt', 'ベルト付き（後ろ開き）']] },
      {
        kind: 'checkbox',
        key: 'slit',
        label: '後ろにスリットを入れる',
        help: `広がりが ${SLIT_MAX_ANGLE}° 以下（タイト・セミタイト）のときに選べます。`,
        show: (p) => slitAvailable(p as unknown as SkirtParams),
      },
    ],
    draft: (r, p) => draftSkirt(r, p as unknown as SkirtParams),
  },
  {
    id: 'pleats',
    label: 'プリーツスカート',
    defaults: { ...DEFAULT_PLEATS },
    requirements: PLEATS_REQUIREMENTS,
    fields: [
      { kind: 'radio', key: 'pleat', label: 'ひだの種類', options: Object.entries(PLEAT_LABEL) as [string, string][] },
      {
        kind: 'select',
        key: 'count',
        label: 'ひだの数',
        options: [['8', '8 本'], ['12', '12 本'], ['16', '16 本'], ['custom', '自分で入力']],
        help: 'ひだの深さは、ひだの数とヒップから自動で決まります。',
        show: (p) => p.pleat !== 'inverted',
      },
      {
        kind: 'number',
        key: 'countCustom',
        label: 'ひだの数',
        step: 1,
        min: 4,
        max: 60,
        unit: '本',
        nullable: true,
        placeholder: '12',
        show: (p) => p.pleat !== 'inverted' && p.count === 'custom',
      },
      { kind: 'select', key: 'length', label: '丈', options: Object.entries(SKIRT_ITEM_LENGTH_LABEL) as [string, string][] },
      {
        kind: 'number',
        key: 'lengthCustom',
        label: '丈（ウエストから裾まで）',
        step: 0.1,
        min: 1,
        unit: 'cm',
        nullable: true,
        placeholder: '膝丈',
        show: (p) => p.length === 'custom',
      },
      { kind: 'radio', key: 'waist', label: 'ウエスト', options: [['elastic', 'ゴム'], ['belt', 'ベルト付き（後ろ開き）']] },
    ],
    draft: (r, p) => draftPleats(r, p as unknown as PleatsParams),
  },
  {
    id: 'camisole',
    label: 'キャミソールワンピース',
    defaults: { ...DEFAULT_CAMISOLE },
    requirements: CAMISOLE_REQUIREMENTS,
    fields: [
      fabricFields[0],
      fabricFields[1],
      dartField,
      { kind: 'select', key: 'fit', label: '身幅', options: [...fitOptions, ['custom', '自分で入力']] },
      {
        kind: 'number',
        key: 'chestEaseCustom',
        label: '胸のゆとり',
        step: 0.1,
        min: 0,
        unit: 'cm',
        nullable: true,
        placeholder: '普通と同じ',
        help: '胸囲に足す長さ。',
        show: (p) => p.fit === 'custom',
      },
      { kind: 'select', key: 'skirt', label: 'スカート', options: Object.entries(SKIRT_LABEL) as [string, string][] },
      { kind: 'select', key: 'length', label: '丈', options: Object.entries(SKIRT_LENGTH_LABEL) as [string, string][] },
      {
        kind: 'number',
        key: 'skirtLengthCustom',
        label: 'スカート丈（ウエストから）',
        step: 0.1,
        min: 1,
        unit: 'cm',
        nullable: true,
        placeholder: '膝丈',
        show: (p) => p.length === 'custom',
      },
      { kind: 'select', key: 'strap', label: '肩ひもの幅', options: Object.entries(STRAP_LABEL) as [string, string][] },
      {
        kind: 'number',
        key: 'strapCustom',
        label: '肩ひもの幅（仕上がり）',
        step: 0.05,
        min: 0.1,
        unit: 'cm',
        nullable: true,
        placeholder: '普通',
        show: (p) => p.strap === 'custom',
      },
      { kind: 'checkbox', key: 'lining', label: '身頃に裏地を付ける', help: '付けないときは、胸元と後ろ開きをバイアステープなどで始末します。' },
    ],
    draft: (r, p) => draftCamisole(r, p as unknown as CamisoleParams),
  },
  {
    id: 'sailor',
    label: 'セーラートップス',
    defaults: { ...DEFAULT_SAILOR },
    requirements: SAILOR_REQUIREMENTS,
    fields: [
      fabricFields[0],
      fabricFields[1],
      dartField,
      {
        kind: 'select',
        key: 'opening',
        label: '開き',
        options: [
          ['auto', `自動（${BACK_OPENING_CATEGORIES.join('・')}は背中開き）`],
          ['front', '前開き（ボタン）'],
          ['back', '背中開き（前は飾りボタン）'],
        ],
      },
      { kind: 'select', key: 'fit', label: '身幅', options: [...fitOptions, ['custom', '自分で入力']] },
      {
        kind: 'number',
        key: 'chestEaseCustom',
        label: '胸のゆとり',
        step: 0.1,
        min: 0,
        unit: 'cm',
        nullable: true,
        placeholder: '普通と同じ',
        show: (p) => p.fit === 'custom',
      },
      { kind: 'select', key: 'length', label: '丈', options: Object.entries(SAILOR_LENGTH_LABEL) as [string, string][] },
      {
        kind: 'number',
        key: 'lengthCustom',
        label: '着丈（ウエストから下へ）',
        step: 0.1,
        unit: 'cm',
        nullable: true,
        placeholder: 'ウエスト',
        help: 'マイナスでウエストより短くなります。',
        show: (p) => p.length === 'custom',
      },
      { kind: 'select', key: 'collarShape', label: '襟の形', options: Object.entries(COLLAR_SHAPE_LABEL) as [string, string][] },
      { kind: 'select', key: 'collarSize', label: '襟の大きさ', options: Object.entries(COLLAR_SIZE_LABEL) as [string, string][] },
      {
        kind: 'number',
        key: 'collarDepthCustom',
        label: '後ろ襟の深さ（襟ぐりから）',
        step: 0.1,
        min: 0.5,
        unit: 'cm',
        nullable: true,
        placeholder: '普通',
        show: (p) => p.collarSize === 'custom',
      },
      { kind: 'select', key: 'vDepth', label: '前のVの深さ', options: Object.entries(V_DEPTH_LABEL) as [string, string][] },
      {
        kind: 'number',
        key: 'vDepthCustom',
        label: 'Vの深さ（首の付け根から）',
        step: 0.1,
        min: 0.5,
        unit: 'cm',
        nullable: true,
        placeholder: '普通',
        show: (p) => p.vDepth === 'custom',
      },
      { kind: 'radio', key: 'sleeve', label: '袖', options: [['half', '半袖'], ['long', '長袖']] },
      { kind: 'checkbox', key: 'cuff', label: 'カフスを付ける' },
      { kind: 'radio', key: 'scarf', label: 'スカーフ', options: [['triangle', '三角'], ['long', '長方形']] },
      { kind: 'checkbox', key: 'lining', label: '身頃に裏地を付ける' },
    ],
    draft: (r, p) => draftSailor(r, p as unknown as SailorParams),
  },
  {
    id: 'yshirt',
    label: 'Yシャツ',
    defaults: { ...DEFAULT_YSHIRT },
    requirements: YSHIRT_REQUIREMENTS,
    fields: [
      fabricFields[0],
      fabricFields[1],
      dartField,
      {
        kind: 'select',
        key: 'opening',
        label: '開き',
        options: [
          ['auto', `自動（${BACK_OPENING_CATEGORIES.join('・')}は背中開き）`],
          ['front', '前開き（ボタン）'],
          ['back', '背中開き（前は飾り）'],
        ],
      },
      {
        kind: 'select',
        key: 'collar',
        label: '襟',
        options: Object.entries(SHIRT_COLLAR_LABEL) as [string, string][],
        help: 'シャツ襟は、前開きなら台襟付き、背中開きなら台襟なしの 1 枚襟になります。',
      },
      { kind: 'select', key: 'fit', label: '身幅', options: [...fitOptions, ['custom', '自分で入力']] },
      {
        kind: 'number',
        key: 'chestEaseCustom',
        label: '胸のゆとり',
        step: 0.1,
        min: 0,
        unit: 'cm',
        nullable: true,
        placeholder: '普通と同じ',
        show: (p) => p.fit === 'custom',
      },
      { kind: 'select', key: 'length', label: '丈', options: Object.entries(SHIRT_LENGTH_LABEL) as [string, string][] },
      {
        kind: 'number',
        key: 'lengthCustom',
        label: '着丈（ウエストから下へ）',
        step: 0.1,
        unit: 'cm',
        nullable: true,
        placeholder: '普通',
        show: (p) => p.length === 'custom',
      },
      { kind: 'radio', key: 'hem', label: '裾', options: [['tail', 'シャツテール'], ['straight', 'まっすぐ']] },
      { kind: 'radio', key: 'sleeve', label: '袖', options: [['long', '長袖（カフス付き）'], ['half', '半袖']] },
      { kind: 'checkbox', key: 'yoke', label: 'ヨーク（肩の切り替え）を付ける' },
      { kind: 'checkbox', key: 'pocket', label: '胸ポケットを付ける' },
    ],
    draft: (r, p) => draftYshirt(r, p as unknown as YshirtParams),
  },
  {
    id: 'jacket',
    label: 'ジャケット',
    // プルダウンの値は文字列なので、ボタンの数も文字列で持つ
    defaults: { ...DEFAULT_JACKET, buttons: '2' },
    requirements: JACKET_REQUIREMENTS,
    fields: [
      fabricFields[0],
      fabricFields[1],
      dartField,
      {
        kind: 'select',
        key: 'build',
        label: '作り',
        options: [
          ['auto', `自動（${BACK_OPENING_CATEGORIES.join('・')}は薄い作り）`],
          ['normal', '普通の作り（見返しあり）'],
          ['thin', '薄い作り（見返しなし）'],
        ],
      },
      { kind: 'select', key: 'collar', label: '襟', options: Object.entries(JACKET_COLLAR_LABEL) as [string, string][] },
      {
        kind: 'select',
        key: 'lapel',
        label: 'ラペルの太さ',
        options: Object.entries(LAPEL_LABEL) as [string, string][],
        show: (p) => p.collar !== 'none',
      },
      {
        kind: 'number',
        key: 'lapelCustom',
        label: 'ラペルの幅',
        step: 0.1,
        min: 0.2,
        unit: 'cm',
        nullable: true,
        placeholder: '普通',
        show: (p) => p.collar !== 'none' && p.lapel === 'custom',
      },
      { kind: 'select', key: 'roll', label: '前の開きの深さ', options: Object.entries(ROLL_LABEL) as [string, string][] },
      {
        kind: 'number',
        key: 'rollCustom',
        label: '前の開きの深さ（首の付け根から）',
        step: 0.1,
        min: 0.5,
        unit: 'cm',
        nullable: true,
        placeholder: '普通',
        show: (p) => p.roll === 'custom',
      },
      { kind: 'radio', key: 'breast', label: '打ち合わせ', options: [['single', 'シングル'], ['double', 'ダブル']] },
      { kind: 'select', key: 'buttons', label: 'ボタンの数', options: [['1', '1 つ'], ['2', '2 つ'], ['3', '3 つ']] },
      { kind: 'select', key: 'fit', label: '身幅', options: [...fitOptions, ['custom', '自分で入力']] },
      {
        kind: 'number',
        key: 'chestEaseCustom',
        label: '胸のゆとり',
        step: 0.1,
        min: 0,
        unit: 'cm',
        nullable: true,
        placeholder: '普通と同じ',
        show: (p) => p.fit === 'custom',
      },
      { kind: 'select', key: 'length', label: '丈', options: Object.entries(JACKET_LENGTH_LABEL) as [string, string][] },
      {
        kind: 'number',
        key: 'lengthCustom',
        label: '着丈（ウエストから下へ）',
        step: 0.1,
        unit: 'cm',
        nullable: true,
        placeholder: '普通',
        show: (p) => p.length === 'custom',
      },
      { kind: 'radio', key: 'hemShape', label: '前の裾', options: [['square', '角'], ['round', '丸くカット'], ['point', 'とがり']] },
      { kind: 'checkbox', key: 'cuff', label: '袖口にカフスを付ける' },
      { kind: 'checkbox', key: 'pocket', label: '腰ポケット（ふた付き）を付ける' },
      { kind: 'checkbox', key: 'chestPocket', label: '胸ポケットを付ける' },
      { kind: 'checkbox', key: 'lining', label: '裏地を付ける' },
    ],
    draft: (r, p) => draftJacket(r, { ...(p as unknown as JacketParams), buttons: Number(p.buttons) }),
  },
  {
    id: 'cape',
    label: 'マント・ケープ',
    defaults: { ...DEFAULT_CAPE },
    requirements: CAPE_REQUIREMENTS,
    fields: [
      fabricFields[0],
      { kind: 'select', key: 'length', label: '丈', options: Object.entries(CAPE_LENGTH_LABEL) as [string, string][] },
      {
        kind: 'number',
        key: 'lengthCustom',
        label: '丈（首の付け根から）',
        step: 0.1,
        min: 0.5,
        unit: 'cm',
        nullable: true,
        placeholder: '腰まで',
        show: (p) => p.length === 'custom',
      },
      { kind: 'select', key: 'flare', label: '広がり', options: Object.entries(CAPE_FLARE_LABEL) as [string, string][] },
      { kind: 'select', key: 'collar', label: '襟', options: Object.entries(CAPE_COLLAR_LABEL) as [string, string][] },
      { kind: 'radio', key: 'closure', label: '首元', options: [['ribbon', 'リボン'], ['snap', 'スナップ']] },
      {
        kind: 'checkbox',
        key: 'slit',
        label: '腕のスリットを付ける',
        help: '手を前に出すための切り込み。腰より長い丈のときだけ付きます。',
        show: (p) => capeIsLong(p as unknown as CapeParams),
      },
      { kind: 'checkbox', key: 'lining', label: '裏地を付ける' },
    ],
    draft: (r, p) => draftCape(r, p as unknown as CapeParams),
  },
  {
    id: 'hoodie',
    label: 'パーカー',
    defaults: { ...DEFAULT_HOODIE },
    requirements: HOODIE_REQUIREMENTS,
    fields: [
      ...fabricFields.slice(0, 2),
      dartField,
      { kind: 'radio', key: 'front', label: '前', options: [['pullover', 'かぶり'], ['zip', '前ファスナー']] },
      {
        kind: 'select',
        key: 'headSize',
        label: '頭のサイズ',
        options: [
          ['auto', '自動（ボディの頭囲）'],
          ...(Object.entries(HEAD_SIZES).map(([k, s]) => [k, s.label]) as [string, string][]),
          ['custom', '自分で入力'],
        ],
        help: 'フードの大きさを決めます。9〜10インチは 3枚はぎ、それより小さいと 2枚はぎになります。',
      },
      {
        kind: 'number',
        key: 'headCustom',
        label: '頭囲',
        step: 0.1,
        min: 5,
        unit: 'cm',
        nullable: true,
        placeholder: 'ボディの頭囲',
        show: (p) => p.headSize === 'custom',
      },
      { kind: 'radio', key: 'sleeve', label: '袖', options: [['long', '長袖'], ['half', '半袖']] },
      { kind: 'select', key: 'fit', label: '身幅', options: [...fitOptions, ['custom', '自分で入力']] },
      {
        kind: 'number',
        key: 'chestEaseCustom',
        label: '胸のゆとり',
        step: 0.1,
        min: 0,
        unit: 'cm',
        nullable: true,
        placeholder: '普通と同じ',
        show: (p) => p.fit === 'custom',
      },
      { kind: 'select', key: 'length', label: '丈', options: Object.entries(HOODIE_LENGTH_LABEL) as [string, string][] },
      {
        kind: 'number',
        key: 'lengthCustom',
        label: '着丈（ウエストから下へ。リブ込み）',
        step: 0.1,
        unit: 'cm',
        nullable: true,
        placeholder: '普通',
        show: (p) => p.length === 'custom',
      },
      { kind: 'checkbox', key: 'strings', label: 'フードのひもを付ける' },
      { kind: 'checkbox', key: 'pocket', label: 'カンガルーポケットを付ける' },
      { kind: 'checkbox', key: 'rib', label: '袖口・裾にリブを付ける' },
    ],
    draft: (r, p) => draftHoodie(r, p as unknown as HoodieParams),
  },
  {
    id: 'yukata',
    label: '浴衣',
    defaults: { ...DEFAULT_YUKATA },
    requirements: YUKATA_REQUIREMENTS,
    fields: [
      {
        kind: 'radio',
        key: 'build',
        label: '作り',
        options: [['simple', 'ドール向けの簡単な作り'], ['authentic', '本来の作り']],
        help: '簡単な作りは衽を前身頃と一緒に裁ち、共衿を省きます（縫い目と厚みが減ります）。',
      },
      { kind: 'radio', key: 'gender', label: '仕立て', options: [['women', '女物'], ['men', '男物']], help: '女物はおはしょり・身八つ口・振りがあります。' },
      { kind: 'radio', key: 'sleeveShape', label: '袖の形', options: [['square', '普通の袖'], ['genroku', '元禄袖']] },
      { kind: 'select', key: 'sleeveLen', label: '袖丈', options: Object.entries(SLEEVE_LEN_LABEL) as [string, string][] },
      {
        kind: 'number',
        key: 'sleeveLenCustom',
        label: '袖丈',
        step: 0.1,
        min: 1,
        unit: 'cm',
        nullable: true,
        placeholder: '普通',
        show: (p) => p.sleeveLen === 'custom',
      },
      { kind: 'radio', key: 'obi', label: '帯', options: [['hanhaba', '半幅帯'], ['heko', '兵児帯']] },
      { kind: 'checkbox', key: 'tsukuri', label: '作り帯にする（結んだ形を別に作って留める）' },
    ],
    draft: (r, p) => draftYukata(r, p as unknown as YukataParams),
  },
  {
    id: 'tights',
    label: '色移り防止タイツ',
    defaults: { ...DEFAULT_TIGHTS },
    requirements: TIGHTS_REQUIREMENTS,
    fields: [
      {
        kind: 'number',
        key: 'stretch',
        label: '伸び率',
        step: 5,
        min: 5,
        max: 200,
        unit: '%',
        help: '布を横に引っぱったとき何％伸びるか。小さくする量の計算に使います。',
      },
      { kind: 'select', key: 'coverage', label: '覆う範囲', options: Object.entries(COVERAGE_LABEL) as [string, string][] },
      { kind: 'radio', key: 'sleeve', label: '袖', options: [['long', '長袖'], ['half', '半袖'], ['none', 'なし']] },
      { kind: 'radio', key: 'neck', label: '首', options: [['turtle', 'タートル（首まで）'], ['scoop', '普通の襟ぐり']] },
      {
        kind: 'radio',
        key: 'opening',
        label: '開き',
        options: [['none', '開きなし'], ['zip', '背中ファスナー']],
        help: '開きなしは伸ばして着せるので小さめ、ファスナーありはほぼぴったりで作ります。',
      },
      { kind: 'select', key: 'snug', label: 'ぴったり具合', options: Object.entries(SNUG_LABEL) as [string, string][] },
      {
        kind: 'checkbox',
        key: 'bustDart',
        label: '胸ダーツを入れる',
        help: '胸囲とウエストの差が大きいボディ向け。伸びる布でも胸の下にすき間やしわが出ないよう、脇から胸へダーツを入れます。',
        show: (_p, ctx) => ctx.bustRatio >= TIGHTS_BUST_DART_RATIO,
      },
      {
        kind: 'number',
        key: 'reduceCustom',
        label: '周りを小さくする量',
        step: 1,
        min: 0,
        max: 50,
        unit: '%',
        nullable: true,
        placeholder: '普通',
        show: (p) => p.snug === 'custom',
      },
    ],
    draft: (r, p) => draftTights(r, p as unknown as TightsParams),
  },
  {
    id: 'socks',
    label: '靴下',
    // プルダウンの値は文字列なので、縫い目の本数も文字列で持つ
    defaults: { ...DEFAULT_SOCKS, seams: '2' },
    requirements: SOCKS_REQUIREMENTS,
    fields: [
      {
        kind: 'number',
        key: 'stretch',
        label: '伸び率',
        step: 5,
        min: 5,
        max: 200,
        unit: '%',
        help: '布を横に引っぱったとき何％伸びるか。小さくする量の計算に使います。',
      },
      {
        kind: 'radio',
        key: 'seams',
        label: '縫い目',
        options: [['2', '2本（内側・外側の 2 枚）'], ['1', '1本（前がわの 1 枚）']],
        help: '1本は、脚の後ろ〜かかと〜足裏〜つま先が 1 本の縫い目になります。',
      },
      { kind: 'select', key: 'length', label: '丈', options: Object.entries(SOCK_LENGTH_LABEL) as [string, string][] },
      {
        kind: 'number',
        key: 'lengthCustom',
        label: '丈（足裏から履き口まで）',
        step: 0.1,
        min: 1,
        unit: 'cm',
        nullable: true,
        placeholder: 'クルー',
        show: (p) => p.length === 'custom',
      },
      { kind: 'radio', key: 'top', label: '履き口', options: [['hem', '三つ折り'], ['fold', '折り返し'], ['elastic', 'ゴム入り']] },
      { kind: 'select', key: 'snug', label: 'ぴったり具合', options: Object.entries(SNUG_LABEL) as [string, string][] },
      {
        kind: 'number',
        key: 'reduceCustom',
        label: '周りを小さくする量',
        step: 1,
        min: 0,
        max: 50,
        unit: '%',
        nullable: true,
        placeholder: '普通',
        show: (p) => p.snug === 'custom',
      },
    ],
    draft: (r, p) => draftSocks(r, { ...(p as unknown as SocksParams), seams: Number(p.seams) === 1 ? 1 : 2 }),
  },
  {
    id: 'shorts',
    label: 'ショーツ',
    defaults: { ...DEFAULT_SHORTS },
    requirements: SHORTS_REQUIREMENTS,
    fields: [
      {
        kind: 'number',
        key: 'stretch',
        label: '伸び率',
        step: 5,
        min: 5,
        max: 200,
        unit: '%',
        help: '布を横に引っぱったとき何％伸びるか。小さくする量の計算に使います。',
      },
      { kind: 'select', key: 'shape', label: '形', options: Object.entries(SHORTS_SHAPE_LABEL) as [string, string][] },
      { kind: 'select', key: 'rise', label: '股上', options: Object.entries(SHORTS_RISE_LABEL) as [string, string][] },
      {
        kind: 'number',
        key: 'riseCustom',
        label: '股上（ウエストラインから股まで）',
        step: 0.1,
        min: 0.5,
        unit: 'cm',
        nullable: true,
        placeholder: '普通',
        show: (p) => p.rise === 'custom',
      },
      {
        kind: 'radio',
        key: 'crotch',
        label: 'クロッチ（股の部分）',
        options: [['integrated', '前・後ろと一続き'], ['separate', '別に裁つ（当て布）']],
        help: '別に裁つと、股の部分を 2 枚重ねにできます。',
      },
      { kind: 'radio', key: 'edge', label: '縁の始末', options: [['elastic', 'ゴム縫い付け'], ['hem', '三つ折り']] },
      { kind: 'select', key: 'snug', label: 'ぴったり具合', options: Object.entries(SNUG_LABEL) as [string, string][] },
      {
        kind: 'number',
        key: 'reduceCustom',
        label: '周りを小さくする量',
        step: 1,
        min: 0,
        max: 50,
        unit: '%',
        nullable: true,
        placeholder: '普通',
        show: (p) => p.snug === 'custom',
      },
    ],
    draft: (r, p) => draftShorts(r, p as unknown as ShortsParams),
  },
  {
    id: 'china',
    label: 'チャイナ服（トップス／スリットドレス）',
    defaults: { ...DEFAULT_CHINA },
    requirements: CHINA_REQUIREMENTS,
    fields: [
      { kind: 'select', key: 'length', label: '丈', options: Object.entries(CHINA_LENGTH_LABEL) as [string, string][] },
      {
        kind: 'number',
        key: 'lengthCustom',
        label: '丈（ウエストから裾まで）',
        step: 0.1,
        min: 1,
        unit: 'cm',
        nullable: true,
        placeholder: '膝丈',
        show: (p) => p.length === 'custom',
      },
      {
        kind: 'select',
        key: 'slit',
        label: 'スリットの深さ（両脇）',
        options: Object.entries(CHINA_SLIT_LABEL) as [string, string][],
        show: (p) => chinaIsDress(p as unknown as ChinaParams),
      },
      {
        kind: 'number',
        key: 'slitCustom',
        label: 'スリットの長さ（裾から）',
        step: 0.1,
        min: 0,
        unit: 'cm',
        nullable: true,
        placeholder: '普通',
        show: (p) => chinaIsDress(p as unknown as ChinaParams) && p.slit === 'custom',
      },
      { kind: 'checkbox', key: 'topSlit', label: '脇に短いスリットを入れる', show: (p) => !chinaIsDress(p as unknown as ChinaParams) },
      {
        kind: 'radio',
        key: 'hem',
        label: '裾',
        options: [['straight', 'まっすぐ'], ['taper', '少しすぼめる']],
        show: (p) => chinaIsDress(p as unknown as ChinaParams),
      },
      { kind: 'select', key: 'sleeve', label: '袖', options: Object.entries(CHINA_SLEEVE_LABEL) as [string, string][] },
      {
        kind: 'number',
        key: 'sleeveCustom',
        label: '袖丈（肩先から）',
        step: 0.1,
        min: 0.5,
        unit: 'cm',
        nullable: true,
        placeholder: '半袖',
        show: (p) => p.sleeve === 'custom',
      },
      { kind: 'select', key: 'collar', label: '立ち襟の高さ', options: Object.entries(CHINA_COLLAR_LABEL) as [string, string][] },
      {
        kind: 'number',
        key: 'collarCustom',
        label: '立ち襟の高さ',
        step: 0.1,
        min: 0.2,
        unit: 'cm',
        nullable: true,
        placeholder: '普通',
        show: (p) => p.collar === 'custom',
      },
      { ...dartField, show: (_p, ctx) => ctx.bustLarge },
      { kind: 'radio', key: 'fitBody', label: '身幅', options: fitOptions },
      { kind: 'radio', key: 'fitSleeve', label: '袖のフィット', options: fitOptions, show: (p) => chinaHasSleeve(p as unknown as ChinaParams) },
    ],
    draft: (r, p) => draftChina(r, { ...(p as unknown as ChinaParams), fabric: 'woven' }),
  },
];

/** 並び順で常に一番下にするアイテム（下着のように服の下に着るもの）。アイテムを足すときも、この順は自動で保たれる */
export const ALWAYS_LAST: readonly string[] = ['tights'];

/** アイテムの種類。画面ではこの順に見出しを付けて並べる */
export const ITEM_GROUPS = ['トップス', 'ボトムス', 'その他', '下着・小物'] as const;
export type ItemGroup = (typeof ITEM_GROUPS)[number];
/** アイテムごとの種類（ここにないアイテムは「その他」） */
export const ITEM_GROUP: Record<string, ItemGroup> = {
  tshirt: 'トップス',
  turtleneck: 'トップス',
  raglan: 'トップス',
  yshirt: 'トップス',
  sailor: 'トップス',
  hoodie: 'トップス',
  jacket: 'トップス',
  pants: 'ボトムス',
  skirt: 'ボトムス',
  pleats: 'ボトムス',
  camisole: 'その他',
  cape: 'その他',
  yukata: 'その他',
  china: 'その他',
  tights: '下着・小物',
  socks: '下着・小物',
  shorts: '下着・小物',
};
export const groupOf = (id: string): ItemGroup => ITEM_GROUP[id] ?? 'その他';

/** 画面のアイテム一覧の並び: 種類の順 → 登録順。ALWAYS_LAST のアイテムは常に最後 */
export const ITEMS: ItemDef[] = [
  ...ITEM_GROUPS.flatMap((g) => ITEM_LIST.filter((i) => groupOf(i.id) === g && !ALWAYS_LAST.includes(i.id))),
  ...ALWAYS_LAST.map((id) => ITEM_LIST.find((i) => i.id === id)).filter((i): i is ItemDef => !!i),
];

export const ITEM_BY_ID: Record<string, ItemDef> = Object.fromEntries(ITEMS.map((i) => [i.id, i]));
