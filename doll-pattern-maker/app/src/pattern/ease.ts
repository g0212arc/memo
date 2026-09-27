// 布の種類ごとのゆとり量（cm）。値は仮置きで、試作して調整する。

import { Fabric } from './types';

export interface EaseSet {
  chest: number;
  hip: number;
  arm: number;
}

/**
 * 布帛（伸びない布）: 動くための余裕と布の厚みの分を足す。
 * ニット（伸びる布）: 体にほぼ沿わせる。伸び率は通過チェック（フェーズ2）と縁取り布の長さに使う。
 */
export function defaultEase(fabric: Fabric, m: { chest: number; hip: number; upperArm: number }): EaseSet {
  if (fabric === 'woven') {
    return {
      chest: m.chest * 0.1 + 0.5,
      hip: m.hip * 0.08 + 0.4,
      arm: m.upperArm * 0.2 + 0.3,
    };
  }
  return {
    chest: m.chest * 0.03,
    hip: m.hip * 0.02,
    arm: m.upperArm * 0.08,
  };
}
