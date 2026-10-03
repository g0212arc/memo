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
import { DEFAULT_YSHIRT, draftYshirt, SHIRT_COLLAR_LABEL, SHIRT_LENGTH_LABEL, YSHIRT_REQUIREMENTS, YshirtParams } from './yshirt';

type Params = Record<string, unknown>;

/** 設定欄を出すときに参照するボディの情報 */
export interface FieldCtx {
  category: Category | null;
  /** 胸ダーツを選べるボディか */
  bustLarge: boolean;
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

export const ITEMS: ItemDef[] = [
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
];

export const ITEM_BY_ID: Record<string, ItemDef> = Object.fromEntries(ITEMS.map((i) => [i.id, i]));
