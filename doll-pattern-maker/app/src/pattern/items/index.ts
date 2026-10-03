// アイテムの一覧。画面の設定欄はここの fields から自動で作る（アイテムを足すときはここに登録する）。

import { ResolvedBody } from '../../model/estimate';
import { MeasurementKey } from '../../model/schema';
import { DraftResult } from '../types';
import { FIT_LABEL, LENGTH_LABEL } from '../fit';
import { DEFAULT_TSHIRT, draftTshirt, TSHIRT_REQUIREMENTS, TshirtParams } from './tshirt';
import { DEFAULT_TURTLENECK, draftTurtleneck, TURTLENECK_REQUIREMENTS, TurtleneckParams } from './turtleneck';

type Params = Record<string, unknown>;

export type FieldSpec =
  | { kind: 'radio'; key: string; label: string; options: [string, string][]; help?: string; show?: (p: Params) => boolean }
  | { kind: 'select'; key: string; label: string; options: [string, string][]; help?: string; show?: (p: Params) => boolean }
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
      show?: (p: Params) => boolean;
    }
  | { kind: 'checkbox'; key: string; label: string; help?: string; show?: (p: Params) => boolean };

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
];

export const ITEM_BY_ID: Record<string, ItemDef> = Object.fromEntries(ITEMS.map((i) => [i.id, i]));
