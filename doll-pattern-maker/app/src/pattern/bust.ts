// 胸ダーツを入れるかどうか。胸囲とウエストの差が大きいボディだけ「胸ダーツ あり／なし」を選べる。

import { ResolvedBody } from '../model/estimate';
import { Fabric } from './types';

/** 胸囲 ÷ ウエスト がこれ以上なら「胸が大きい」とみなす */
export const BUST_DART_RATIO = 1.35;

export function bustLarge(values: ResolvedBody['values']): boolean {
  const c = values.chest_circ;
  const w = values.waist_circ;
  return c !== undefined && w !== undefined && w > 0 && c / w >= BUST_DART_RATIO;
}

/** 実際にダーツを入れるか（布帛で、胸が大きく、ダーツありを選んでいる） */
export function useBustDart(r: ResolvedBody, p: { fabric: Fabric; bustDart?: boolean }): boolean {
  return p.fabric === 'woven' && p.bustDart !== false && bustLarge(r.values);
}
