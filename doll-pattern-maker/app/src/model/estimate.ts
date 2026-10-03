// 不足している採寸値の推定。推定式はすべてここに集める。
// 係数はサンプル5体で不自然にならないよう置いた仮の値（05-design.md §4）。実測値が集まったら見直す。

import { Body, ValueSource, measurementsOf } from './body';
import { MeasurementKey } from './schema';
import { armRatios, Category, guessCategory } from './category';

export type VariantSelection = Partial<Record<MeasurementKey, number>>;

export interface ResolvedBody {
  name: string;
  /** カテゴリ（ボディに書かれていなければ身長からの仮） */
  category: Category | null;
  categoryGuessed: boolean;
  values: Partial<Record<MeasurementKey, number>>;
  sources: Partial<Record<MeasurementKey, ValueSource>>;
  /** 推定値の出し方の説明 */
  notes: Partial<Record<MeasurementKey, string>>;
  warnings: string[];
}

const r2 = (x: number) => Math.round(x * 100) / 100;

export function resolveBody(body: Body, sel: VariantSelection = {}, typeIndex = 0): ResolvedBody {
  const measurements = measurementsOf(body, typeIndex);
  const guessed = body.category ? null : guessCategory({ ...body, measurements });
  const res: ResolvedBody = {
    name: body.name,
    category: body.category ?? guessed,
    categoryGuessed: !body.category && guessed !== null,
    values: {},
    sources: {},
    notes: {},
    warnings: [],
  };

  for (const [k, m] of Object.entries(measurements) as [MeasurementKey, NonNullable<Body['measurements'][MeasurementKey]>][]) {
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

  // 首回り（襟ぐりの大きさに直結するので、推定したら必ず実測をすすめる）
  if (!has('neck_circ') && has('chest_circ')) {
    // サンプル14体で胸囲の 0.26〜0.52 倍、中央値が約 0.36
    est('neck_circ', val('chest_circ') * 0.36, '胸囲 × 0.36');
    res.warnings.push('首回りを胸囲から推定しました。ボディによる差が大きく、襟ぐりの大きさに直結するので、実測をおすすめします。');
  }

  // 腕の長さ（サンプルで頭なし身長の 0.31〜0.35 倍に収まる）
  if (has('height')) est('arm_length', val('height') * 0.33, '頭なし身長 × 0.33');

  // 肩幅（サンプル12体で胸囲の 0.38〜0.57 倍、中央値約 0.53。肩線の長さに直結するので実測をすすめる）
  if (!has('shoulder_width') && has('chest_circ')) {
    est('shoulder_width', val('chest_circ') * 0.53, '胸囲 × 0.53');
    res.warnings.push('肩幅を胸囲から推定しました。肩線の長さに直結するので、実測をおすすめします（背中側で左右の肩先の間）。');
  }

  // 首の長さ
  if (has('height')) est('neck_length', val('height') * 0.055, '頭なし身長 × 0.055');

  // 股下（足裏まで）＝ 股から足首 ＋ 足の高さ（足を含まない「腿长」などから）
  if (!has('inseam') && has('crotch_to_ankle')) {
    if (has('foot_height')) est('inseam', val('crotch_to_ankle') + val('foot_height'), '股から足首 ＋ 足の高さ');
    else if (has('foot_length')) est('inseam', val('crotch_to_ankle') + val('foot_length') * 0.35, '股から足首 ＋ 足の長さ × 0.35');
    else est('inseam', val('crotch_to_ankle') * 1.12, '股から足首 × 1.12');
  }

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
  // 小さいカテゴリ（小六・棍六・1/6）は胸に対して腕が太いので、割合を変える
  const arm = armRatios(res.category);
  if (has('chest_circ')) est('upper_arm_circ', val('chest_circ') * arm.upperArm, `胸囲 × ${arm.upperArm}`);
  // 肘が通る周り（球体関節の出っ張りを見込む）
  if (has('upper_arm_circ')) {
    // 前腕のほうが太いボディ（デフォルメ体など）では、前腕が通る大きさを下回らないように
    const fromArm = val('upper_arm_circ') * 1.15 + 0.3;
    if (has('forearm_circ') && val('forearm_circ') + 0.2 > fromArm) {
      est('elbow_pass_circ', val('forearm_circ') + 0.2, '前腕回り ＋ 0.2（前腕が上腕より太いため）');
    } else {
      est('elbow_pass_circ', fromArm, '上腕回り × 1.15 ＋ 0.3');
    }
  }
  if (has('upper_arm_circ') && res.sources.upper_arm_circ !== 'estimated') {
    est('armhole_circ', val('upper_arm_circ') * arm.armholeFromArm, `上腕回り × ${arm.armholeFromArm}`);
  } else if (has('chest_circ')) {
    est('armhole_circ', val('chest_circ') * arm.armholeFromChest, `胸囲 × ${arm.armholeFromChest}`);
  }
  // 推定した腕の付け根回りは、肘が通る袖幅を付けられる大きさ（肘が通る周り ＋ 0.2）を下回らないように（前腕が太いボディ）
  if (res.sources.armhole_circ === 'estimated' && has('elbow_pass_circ') && val('armhole_circ') < val('elbow_pass_circ') + 0.2) {
    res.values.armhole_circ = r2(val('elbow_pass_circ') + 0.2);
    res.notes.armhole_circ = '肘が通る周り ＋ 0.2（推定が小さすぎるため。前腕が太いボディ）';
  }

  // 腰丈
  if (has('back_length')) est('waist_to_hip', val('back_length') * 0.45, '背丈 × 0.45');

  // 脚まわり（パンツ用）。背丈などの推定に影響しないよう、最後に出す
  if (!has('inseam') && has('rise')) {
    if (has('outer_leg_length') && val('outer_leg_length') - val('rise') > val('rise')) {
      est('inseam', val('outer_leg_length') - val('rise'), '外脚長 − 股上');
    } else if (has('navel_to_sole') && val('navel_to_sole') - val('rise') > val('rise')) {
      est('inseam', val('navel_to_sole') - val('rise'), 'へそ〜足裏 − 股上');
    } else if (has('height')) {
      est('inseam', val('height') * 0.58, '頭なし身長 × 0.58');
    }
  }
  if (has('hip_circ')) est('thigh_circ', val('hip_circ') * 0.6, 'ヒップ × 0.6');
  if (has('thigh_circ')) est('calf_circ', val('thigh_circ') * 0.7, '太もも回り × 0.7');
  if (has('inseam')) est('knee_height', val('inseam') * 0.52, '股下 × 0.52');
  if (has('height')) est('foot_length', val('height') * 0.15, '頭なし身長 × 0.15');
  else if (has('inseam')) est('foot_length', val('inseam') * 0.26, '股下 × 0.26');
  if (has('foot_length')) est('foot_pass_circ', val('foot_length') * 1.5, '足の長さ × 1.5');
  // 股から足首（ズボンのくるぶし丈）＝ 股下 − 足の高さ
  if (has('inseam')) {
    if (has('foot_height')) est('crotch_to_ankle', val('inseam') - val('foot_height'), '股下 − 足の高さ');
    else est('crotch_to_ankle', val('inseam') * 0.94, '股下 × 0.94');
  }

  return res;
}
