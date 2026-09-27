// 袖原型。袖山の曲線の長さが、前後の袖ぐりの長さ（＋いせ分）に一致するよう袖山の高さを自動で決める。
// 中心線 x = 0、袖山の頂点が原点、y は下向き。前は左（x < 0）、後ろは右（x > 0）。

import { v } from '../geometry/vec';
import { cubic, line, pathLength, CubicSeg } from '../geometry/path';
import { Piece } from './types';

export interface SleeveInput {
  frontArmholeLength: number;
  backArmholeLength: number;
  upperArm: number;
  armEase: number;
  armLength: number;
  /** 袖丈 = 腕の長さ × この値 */
  lengthRatio: number;
  /** 袖幅の下限 = 袖ぐり全体の長さ × この値（ニットは大きめで袖山が低くなる） */
  widthRatio: number;
  /** いせ分（袖山を袖ぐりより長くする割合） */
  capEase: number;
  /** 袖口の幅 = 袖幅 × この値 */
  hemRatio: number;
}

export interface SleeveDraft {
  piece: Piece;
  capHeight: number;
  width: number;
  capLength: number;
  targetCapLength: number;
  warnings: string[];
}

function capCurves(wf: number, wb: number, h: number): [CubicSeg, CubicSeg] {
  // 後ろ: 頂点 → 右の袖幅端 / 前: 左の袖幅端 → 頂点（前の方がえぐりが深い）
  const back = cubic(v(0, 0), v(wb * 0.5, 0), v(wb * 0.62, h), v(wb, h));
  const front = cubic(v(-wf, h), v(-wf * 0.68, h), v(-wf * 0.45, 0), v(0, 0));
  return [back, front];
}

export function draftSleeve(s: SleeveInput): SleeveDraft {
  const warnings: string[] = [];
  const armholeTotal = s.frontArmholeLength + s.backArmholeLength;
  const target = armholeTotal * (1 + s.capEase);
  const width = Math.max(s.upperArm + s.armEase, armholeTotal * s.widthRatio);
  const wb = width / 2 + width * 0.02;
  const wf = width / 2 - width * 0.02;

  const capLen = (h: number) => {
    const [b, f] = capCurves(wf, wb, h);
    return pathLength([b]) + pathLength([f]);
  };

  // 袖山の高さを二分法で求める（高くするほど曲線は長くなる）
  let lo = 0.05;
  let hi = target / 2;
  if (capLen(lo) > target) {
    warnings.push('袖幅が袖ぐりに対して広すぎて、袖山の長さを合わせられません。袖ぐりの推定値（腕の付け根回り）を確認してください。');
    hi = lo;
  }
  for (let i = 0; i < 60 && hi - lo > 1e-5; i++) {
    const mid = (lo + hi) / 2;
    if (capLen(mid) < target) lo = mid;
    else hi = mid;
  }
  const h = (lo + hi) / 2;
  const [backCap, frontCap] = capCurves(wf, wb, h);

  let len = s.armLength * s.lengthRatio;
  if (len < h + 0.5) {
    len = h + 0.5;
    warnings.push('袖丈が袖山より短いため、袖山の下 0.5cm まで延ばしました。');
  }
  const hb = wb * s.hemRatio;
  const hf = wf * s.hemRatio;

  const piece: Piece = {
    id: 'sleeve',
    name: '袖',
    cut: '2枚（左右反転）',
    edges: [
      { segs: [backCap], kind: 'seam', name: '袖山（後ろ）' },
      { segs: [line(v(wb, h), v(hb, len))], kind: 'seam', name: '袖下' },
      { segs: [line(v(hb, len), v(-hf, len))], kind: 'hem', name: '袖口' },
      { segs: [line(v(-hf, len), v(-wf, h))], kind: 'seam', name: '袖下' },
      { segs: [frontCap], kind: 'seam', name: '袖山（前）' },
    ],
    grain: [v(0, h * 0.6 + 0.2), v(0, len - (len - h) * 0.25)],
  };

  return { piece, capHeight: h, width, capLength: capLen(h), targetCapLength: target, warnings };
}
