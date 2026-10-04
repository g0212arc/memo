// ボディのカテゴリ（ドール界隈で使われるサイズ・体型の呼び名）。この順に表示する。
// 特六・棍六・特四・叔体などは身長だけでは区別できないので、基本はボディごとに手で決める。

import type { Body } from './body';

export const CATEGORIES = ['特六', '小六', '1/6', '棍六', '1/4', '大四', '特四', '1/3', '叔体'] as const;
export type Category = (typeof CATEGORIES)[number];

/**
 * カテゴリごとのゆとりの掛け率。ゆとり ＝（採寸値 × 割合 ＋ 固定分）× 掛け率。
 * 初期値は全部 1.0。試作の感想が集まったらカテゴリ単位で調整する。
 */
export const CATEGORY_EASE: Record<Category, number> = {
  特六: 1.0,
  小六: 1.0,
  '1/6': 1.0,
  棍六: 1.0,
  '1/4': 1.0,
  大四: 1.0,
  特四: 1.0,
  '1/3': 1.0,
  叔体: 1.0,
};

/**
 * 腕まわりを胸囲から推定するときの割合。小さいドールほど胸に対して腕が太い（2026-10-03。
 * 実測のある小六は 上腕 ÷ 胸囲 ＝ 0.41〜0.45、甘蔗三代の実測は 胸囲 12・上腕 5・腕の付け根回り 6）。
 * 大きいドールは人間に近い（0.30〜0.38）
 */
export const SMALL_ARM_CATEGORIES: readonly Category[] = ['小六', '棍六', '1/6'];
export function armRatios(category: Category | null): { upperArm: number; armholeFromArm: number; armholeFromChest: number } {
  return category && SMALL_ARM_CATEGORIES.includes(category)
    ? { upperArm: 0.41, armholeFromArm: 1.2, armholeFromChest: 0.5 }
    : { upperArm: 0.32, armholeFromArm: 1.4, armholeFromChest: 0.42 };
}

/** 採寸画像の表記ゆれ → カテゴリ */
const ALIASES: Record<string, Category> = {
  特六: '特六',
  小六: '小六',
  棍六: '棍六',
  大四: '大四',
  特四: '特四',
  叔体: '叔体',
  '1/6': '1/6',
  六分: '1/6',
  '1/4': '1/4',
  四分: '1/4',
  '1/3': '1/3',
  三分: '1/3',
};

export function isCategory(x: unknown): x is Category {
  return typeof x === 'string' && (CATEGORIES as readonly string[]).includes(x);
}

export function normalizeCategory(raw: unknown): Category | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim().replace(/[／]/g, '/').replace(/体$/, '');
  if (isCategory(s)) return s;
  return ALIASES[s] ?? ALIASES[raw.trim()] ?? null;
}

/** カテゴリがないボディに、身長から仮のカテゴリを出す（1/6・1/4・1/3 のどれか） */
export function guessCategory(body: Body): Category | null {
  const withHead = body.measurements.height_with_head?.value;
  const headless = body.measurements.height?.value;
  const total = withHead ?? (headless !== undefined ? headless / 0.8 : undefined);
  if (total === undefined) return null;
  if (total <= 33) return '1/6';
  if (total <= 50) return '1/4';
  return '1/3';
}

/**
 * 頭なし身長 ÷ 頭込み身長（頭込みの身長しか分からないときの推定に使う）。
 * 大きいボディほど頭の割合が小さい。サンプルの実測（2026-10-04）: 小六 0.76〜0.78・棍六 0.84・1/4 0.86〜0.88・大四 0.88〜0.91・叔体 0.91〜0.92
 */
export const HEADLESS_RATIO: Record<Category, number> = {
  特六: 0.77,
  小六: 0.77,
  '1/6': 0.77,
  棍六: 0.84,
  '1/4': 0.87,
  大四: 0.9,
  特四: 0.9,
  '1/3': 0.91,
  叔体: 0.91,
};
export const headlessRatio = (c: Category | null) => (c ? HEADLESS_RATIO[c] : 0.85);
