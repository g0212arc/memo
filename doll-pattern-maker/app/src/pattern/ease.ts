// 布の種類ごとのゆとり量（cm）。値は仮置きで、試作して調整する。
//
// ゆとり ＝ 採寸値 × 割合 ＋ 固定分（布の厚み・関節の出っ張りの分）
// 固定分はドールの大きさに関係なく同じ長さなので、小さいドールほどゆとりの割合が自然に大きくなる。

import { Fabric } from './types';

export interface EaseSet {
  chest: number;
  hip: number;
  arm: number;
  /** 袖ぐり（腕の付け根回りに足す長さ） */
  armhole: number;
  /** 肘・手が通る周りに足す余裕 */
  pass: number;
}

/** カテゴリの掛け率などで、ゆとりをまとめて k 倍する */
export function scaleEase(e: EaseSet, k: number): EaseSet {
  return { chest: e.chest * k, hip: e.hip * k, arm: e.arm * k, armhole: e.armhole * k, pass: e.pass * k };
}

export function defaultEase(
  fabric: Fabric,
  m: { chest: number; hip: number; upperArm: number; armhole: number },
): EaseSet {
  if (fabric === 'woven') {
    return {
      chest: m.chest * 0.1 + 0.5,
      hip: m.hip * 0.08 + 0.4,
      arm: m.upperArm * 0.2 + 0.3,
      armhole: m.armhole * 0.1 + 0.4,
      pass: 0.3,
    };
  }
  return {
    chest: m.chest * 0.03 + 0.2,
    hip: m.hip * 0.02 + 0.2,
    arm: m.upperArm * 0.08 + 0.3,
    armhole: m.armhole * 0.06 + 0.3,
    pass: 0.1,
  };
}
