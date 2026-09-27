// 不足している採寸値の推定。推定式はすべてここに集める。
// 係数はサンプル5体で不自然にならないよう置いた仮の値（05-design.md §4）。実測値が集まったら見直す。

import { Body, ValueSource } from './body';
import { MeasurementKey } from './schema';

export type VariantSelection = Partial<Record<MeasurementKey, number>>;

export interface ResolvedBody {
  name: string;
  values: Partial<Record<MeasurementKey, number>>;
  sources: Partial<Record<MeasurementKey, ValueSource>>;
  /** 推定値の出し方の説明 */
  notes: Partial<Record<MeasurementKey, string>>;
  warnings: string[];
}

const r2 = (x: number) => Math.round(x * 100) / 100;

export function resolveBody(body: Body, sel: VariantSelection = {}): ResolvedBody {
  const res: ResolvedBody = { name: body.name, values: {}, sources: {}, notes: {}, warnings: [] };

  for (const [k, m] of Object.entries(body.measurements) as [MeasurementKey, NonNullable<Body['measurements'][MeasurementKey]>][]) {
    const idx = sel[k];
    const vv = idx !== undefined && m.variants?.[idx] ? m.variants[idx].value : m.value;
    res.values[k] = vv;
    res.sources[k] = m.source === 'measured' ? 'measured' : 'maker';
  }

  const has = (k: MeasurementKey) => res.values[k] !== undefined;
  const val = (k: MeasurementKey) => res.values[k] as number;
  const est = (k: MeasurementKey, value: number, note: string) => {
    if (has(k)) return;
    res.values[k] = r2(value);
    res.sources[k] = 'estimated';
    res.notes[k] = note;
  };

  // 身長（頭なし）
  if (!has('height') && has('height_with_head')) {
    est('height', val('height_with_head') * 0.8, '頭込み身長 × 0.8');
  }

  // 首の長さ
  if (has('height')) est('neck_length', val('height') * 0.055, '頭なし身長 × 0.055');

  // 股上
  if (!has('rise') && has('hip_circ')) {
    const fallback = val('hip_circ') * 0.25;
    if (has('outer_leg_length') && has('inseam')) {
      const diff = val('outer_leg_length') - val('inseam');
      if (diff >= val('hip_circ') * 0.15) {
        est('rise', diff, '外脚長 − 股下');
      } else {
        est('rise', fallback, 'ヒップ × 0.25');
        res.warnings.push(
          `外脚長 − 股下 = ${r2(diff)}cm は股上としては短すぎるため、ヒップから推定しました。外脚長の測り始めがウエストではない可能性があります。股上は実測をおすすめします。`,
        );
      }
    } else if (has('navel_to_sole') && has('inseam')) {
      est('rise', val('navel_to_sole') - val('inseam'), 'へそ〜足裏 − 股下');
    } else {
      est('rise', fallback, 'ヒップ × 0.25');
    }
  }

  // ウエストの高さ（背丈の推定にだけ使う。採寸項目ではない）
  let waistHeight: number | undefined;
  if (has('navel_to_sole')) waistHeight = val('navel_to_sole');
  else if (has('inseam') && has('rise')) waistHeight = val('inseam') + val('rise');

  // 背丈
  if (!has('back_length') && has('chest_circ')) {
    const chest = val('chest_circ');
    if (has('height') && has('neck_length') && waistHeight !== undefined) {
      const bl = val('height') - val('neck_length') - waistHeight;
      if (bl >= chest * 0.3 && bl <= chest * 0.75) {
        est('back_length', bl, '頭なし身長 − 首の長さ − ウエストの高さ');
      } else {
        est('back_length', chest * 0.45, '胸囲 × 0.45');
        res.warnings.push(
          `身長から出した背丈 (${r2(bl)}cm) が胸囲に対して不自然なため、胸囲から推定しました。身長が頭込みかどうか、背丈の実測をおすすめします。`,
        );
      }
    } else {
      est('back_length', chest * 0.45, '胸囲 × 0.45');
    }
  }

  // 前丈
  if (has('back_length')) {
    const bl = val('back_length');
    if (has('chest_circ') && has('waist_circ') && val('chest_circ') / val('waist_circ') > 1.3) {
      est('front_length', bl * 1.02 + (val('chest_circ') - val('waist_circ')) * 0.08, '背丈 × 1.02 ＋ (胸囲 − ウエスト) × 0.08');
    } else {
      est('front_length', bl * 1.02, '背丈 × 1.02');
    }
  }

  // 腕まわり
  if (has('chest_circ')) est('upper_arm_circ', val('chest_circ') * 0.32, '胸囲 × 0.32');
  if (has('upper_arm_circ') && res.sources.upper_arm_circ !== 'estimated') {
    est('armhole_circ', val('upper_arm_circ') * 1.4, '上腕回り × 1.4');
  } else if (has('chest_circ')) {
    est('armhole_circ', val('chest_circ') * 0.42, '胸囲 × 0.42');
  }

  // 腰丈
  if (has('back_length')) est('waist_to_hip', val('back_length') * 0.45, '背丈 × 0.45');

  return res;
}
