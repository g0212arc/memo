// 前開きか背中開きか。「自動」は小さいボディ（前にボタンホールを作るのが大変）を背中開きにする。

import { Category } from '../model/category';

export type OpeningChoice = 'auto' | 'front' | 'back';

/** 「自動」のとき背中開きにするカテゴリ */
export const BACK_OPENING_CATEGORIES: readonly Category[] = ['特六', '小六', '1/6', '棍六'];

export function resolveOpening(category: Category | null, opening: OpeningChoice): 'front' | 'back' {
  if (opening !== 'auto') return opening;
  return category !== null && BACK_OPENING_CATEGORIES.includes(category) ? 'back' : 'front';
}
