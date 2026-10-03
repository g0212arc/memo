// 前開きか背中開きか。「自動」は小さいボディ（前にボタンホールを作るのが大変）を背中開きにする。

import { Category } from '../model/category';
import { Vec, v } from '../geometry/vec';
import { PieceNote } from './types';

export type OpeningChoice = 'auto' | 'front' | 'back';

/** 「自動」のとき背中開きにするカテゴリ */
export const BACK_OPENING_CATEGORIES: readonly Category[] = ['特六', '小六', '1/6', '棍六'];

export function resolveOpening(category: Category | null, opening: OpeningChoice): 'front' | 'back' {
  if (opening !== 'auto') return opening;
  return category !== null && BACK_OPENING_CATEGORIES.includes(category) ? 'back' : 'front';
}

/** 背中開きの持ち出しの幅（片側）。閉じると左右が重なる幅はこの 2 倍 */
export type ExtChoice = 'auto' | '0.5' | '0.8' | '1' | 'custom';
export interface ExtParams {
  extWidth?: ExtChoice;
  /** extWidth が custom のときの幅（cm） */
  extWidthCustom?: number | null;
}
export const EXT_DEFAULTS: Required<ExtParams> = { extWidth: 'auto', extWidthCustom: null };
export const EXT_LABEL: Record<ExtChoice, string> = { auto: '自動', '0.5': '0.5cm', '0.8': '0.8cm', '1': '1cm', custom: '自分で入力' };

/** 持ち出しの幅（cm）。自動は 胸囲 × 5%（0.6〜1.5cm） */
export function openingExtOf(p: unknown, chest: number): number {
  const q = (p ?? {}) as ExtParams;
  const auto = Math.min(1.5, Math.max(0.6, chest * 0.05));
  if (q.extWidth === 'custom') return q.extWidthCustom !== null && q.extWidthCustom !== undefined && Number.isFinite(q.extWidthCustom) && q.extWidthCustom > 0 ? q.extWidthCustom : auto;
  if (q.extWidth && q.extWidth !== 'auto') return Number(q.extWidth);
  return auto;
}

/**
 * 持ち出しの印: 後ろ中心（x = 0）の線と、持ち出しの帯（x = −ext〜0）の中の「持ち出し」の文字（縦書き）
 */
export function extMarks(top: number, bottom: number, ext: number): { marks: Vec[][]; notes: PieceNote[] } {
  const mid = top + (bottom - top) * 0.5;
  return { marks: [[v(0, top), v(0, bottom)]], notes: [{ at: v(-ext / 2, mid), text: '持ち出し', vertical: true }] };
}
