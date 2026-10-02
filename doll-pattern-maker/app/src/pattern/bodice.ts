// 身頃原型（前・後ろ）。半身で作図し、中心線は x = 0、y は下向き。
// 原点の高さは首の付け根の横（SNP）。作図手順は 05-design.md §5。

import { Vec, v, add, mul, polar } from '../geometry/vec';
import { Seg, line, cubic, pathLength } from '../geometry/path';
import { Edge, Piece } from './types';
import { EaseSet } from './ease';

export interface BodiceMeasurements {
  chest: number;
  waist: number;
  hip: number;
  neck: number;
  shoulder: number;
  backLength: number;
  frontLength: number;
  armhole: number;
  waistToHip: number;
}

export interface BodiceOptions {
  ease: EaseSet;
  woven: boolean;
  /** 襟ぐりの幅を首回りの何割広げるか（0.19 が首に沿う幅） */
  neckWiden: number;
  /** 前襟ぐりをさらに下げる量（cm） */
  frontNeckDrop: number;
  /** 肩先を延ばす量（cm） */
  shoulderExtend: number;
  /** 裾の位置（ウエストから下へ cm。マイナスで短くなる） */
  hemBelowWaist: number;
  /** 袖ぐりのゆとり（腕の付け根回りに足す長さ cm） */
  armholeEase: number;
  /** 背中開き */
  backOpening: boolean;
  /** 背中開きの持ち出し幅（cm） */
  openingExt: number;
}

export interface BodiceDraft {
  back: Piece;
  front: Piece;
  backArmhole: Seg[];
  frontArmhole: Seg[];
  /** 襟ぐりの長さ（半身、持ち出し分は含まない） */
  backNeckLength: number;
  frontNeckLength: number;
  warnings: string[];
}

const BACK_SLOPE = 18;
const FRONT_SLOPE = 22;

export function draftBodice(m: BodiceMeasurements, o: BodiceOptions): BodiceDraft {
  const warnings: string[] = [];
  const rad = (d: number) => (d * Math.PI) / 180;

  // できあがり寸法（1/4）
  const chestQ = (m.chest + o.ease.chest) / 4;
  const hipQ = (m.hip + o.ease.hip) / 4;

  // 襟ぐり
  const nw = m.neck * (0.19 + o.neckWiden);
  const backNeckDepth = nw / 3;
  const frontNeckDepth = nw * 1.1 + o.frontNeckDrop;

  // 肩
  const backSPx = Math.max(m.shoulder / 2 + o.shoulderExtend, nw + 0.3);
  const shoulderLen = (backSPx - nw) / Math.cos(rad(BACK_SLOPE));
  const snp = v(nw, 0);
  const backSP = polar(snp, BACK_SLOPE, shoulderLen);
  const frontSP = polar(snp, FRONT_SLOPE, shoulderLen);

  // 背幅・前幅
  // 脇の点まで横に余裕を残す（肩幅が胸幅より広いボディでも袖ぐりの底が滑らかになるように）
  const backWidth = Math.min(backSP.x - m.shoulder * 0.06, chestQ * 0.9);
  const frontWidth = Math.min(frontSP.x - m.shoulder * 0.09, chestQ * 0.88);

  const armholeAt = (chestY: number, sp: Vec, slope: number, widthX: number, midRatio: number): Seg[] => {
    const mid = v(widthX, sp.y + (chestY - sp.y) * midRatio);
    const side = v(chestQ, chestY);
    const down = v(-Math.sin(rad(slope)), Math.cos(rad(slope)));
    const k1 = (mid.y - sp.y) * 0.4;
    const s1 = cubic(sp, add(sp, mul(down, k1)), v(mid.x, mid.y - k1), mid);
    const k2 = (chestY - mid.y) * 0.55;
    const k3 = (side.x - mid.x) * 0.55;
    const s2 = cubic(mid, v(mid.x, mid.y + k2), v(side.x - k3, side.y), side);
    return [s1, s2];
  };
  const armholeTotal = (chestY: number) =>
    pathLength(armholeAt(chestY, backSP, BACK_SLOPE, backWidth, 0.55)) +
    pathLength(armholeAt(chestY, frontSP, FRONT_SLOPE, frontWidth, 0.6));

  // 胸の線の高さ: 前後の袖ぐりの長さが「腕の付け根回り＋ゆとり」になる深さを二分法で求める
  const waistY = backNeckDepth + m.backLength;
  const armholeTarget = m.armhole + o.armholeEase;
  let lo = Math.max(backSP.y, frontSP.y) + 0.3;
  let hi = backNeckDepth + m.backLength * 0.8;
  if (armholeTotal(hi) < armholeTarget) {
    warnings.push('袖ぐりを腕の付け根回りに合わせると背丈の 8 割より深くなるため、そこで止めました。背丈か腕の付け根回りを確認してください。');
    lo = hi;
  } else if (armholeTotal(lo) > armholeTarget) {
    hi = lo;
  }
  for (let i = 0; i < 60 && hi - lo > 1e-5; i++) {
    const mid = (lo + hi) / 2;
    if (armholeTotal(mid) < armholeTarget) lo = mid;
    else hi = mid;
  }
  const chestY = (lo + hi) / 2;

  const hipY = waistY + m.waistToHip;
  const backHemY = waistY + o.hemBelowWaist;
  // 前は胸のふくらみの分だけ丈を足す
  const frontHemY = backHemY + Math.max(0, m.frontLength - m.backLength);
  if (backHemY <= chestY + 0.5) warnings.push('着丈が短すぎて、袖ぐりより上に裾がきています。');

  const backArmhole = armholeAt(chestY, backSP, BACK_SLOPE, backWidth, 0.55);
  const frontArmhole = armholeAt(chestY, frontSP, FRONT_SLOPE, frontWidth, 0.6);

  // 脇線（胸の点から裾まで。裾がヒップより下で、ヒップが胸より大きければヒップまで広げる）
  const sideSegs = (hemY: number, hipLineY: number): Seg[] => {
    const top = v(chestQ, chestY);
    if (hemY > hipLineY && hipQ > chestQ) {
      const hipPt = v(hipQ, hipLineY);
      return [line(top, hipPt), line(hipPt, v(hipQ, hemY))];
    }
    let need = chestQ;
    if (hemY > waistY && hipQ > chestQ) {
      // ウエストとヒップの間に裾があるとき、その高さで必要な幅
      const waistQ = (m.waist + o.ease.hip) / 4;
      const t = Math.min(1, (hemY - waistY) / Math.max(m.waistToHip, 0.1));
      need = Math.max(chestQ, waistQ + (hipQ - waistQ) * t);
    }
    return [line(top, v(need, hemY))];
  };
  const frontHipY = hipY + (frontHemY - backHemY);

  // 後ろ襟ぐり: 後ろ中心（水平）→ SNP（肩線に直角）
  const backNeck = cubic(
    v(0, backNeckDepth),
    v(nw * 0.55, backNeckDepth),
    add(snp, mul(v(-Math.sin(rad(BACK_SLOPE)), Math.cos(rad(BACK_SLOPE))), backNeckDepth * 0.6)),
    snp,
  );
  const frontNeck = cubic(
    v(0, frontNeckDepth),
    v(nw * 0.6, frontNeckDepth),
    add(snp, mul(v(-Math.sin(rad(FRONT_SLOPE)), Math.cos(rad(FRONT_SLOPE))), frontNeckDepth * 0.55)),
    snp,
  );

  // ---- 後ろ身頃 ----
  const backSide = sideSegs(backHemY, hipY);
  const backHemX = (backSide[backSide.length - 1] as { to: Vec }).to.x;
  const cbX = o.backOpening ? -o.openingExt : 0;
  const backEdges: Edge[] = [];
  if (o.backOpening) backEdges.push({ segs: [line(v(cbX, backNeckDepth), v(0, backNeckDepth))], kind: 'seam', name: '襟ぐり（持ち出し）' });
  backEdges.push(
    { segs: [backNeck], kind: 'seam', name: '襟ぐり' },
    { segs: [line(snp, backSP)], kind: 'seam', name: '肩' },
    { segs: backArmhole, kind: 'seam', name: '袖ぐり' },
    { segs: backSide, kind: 'seam', name: '脇' },
    { segs: [line(v(backHemX, backHemY), v(cbX, backHemY))], kind: 'hem', name: '裾' },
    {
      segs: [line(v(cbX, backHemY), v(cbX, backNeckDepth))],
      kind: o.backOpening ? 'opening' : 'fold',
      name: o.backOpening ? '後ろ開き' : '後ろ中心（わ）',
    },
  );
  const back: Piece = {
    id: 'back',
    name: '後ろ身頃',
    cut: o.backOpening ? '2枚（左右反転）' : '1枚（わ）',
    edges: backEdges,
    grain: [v(chestQ * 0.5, chestY * 0.9), v(chestQ * 0.5, backHemY - (backHemY - chestY) * 0.2)],
  };

  // ---- 前身頃 ----
  const frontSide = sideSegs(frontHemY, frontHipY);
  const frontHemX = (frontSide[frontSide.length - 1] as { to: Vec }).to.x;
  const front: Piece = {
    id: 'front',
    name: '前身頃',
    cut: '1枚（わ）',
    edges: [
      { segs: [frontNeck], kind: 'seam', name: '襟ぐり' },
      { segs: [line(snp, frontSP)], kind: 'seam', name: '肩' },
      { segs: frontArmhole, kind: 'seam', name: '袖ぐり' },
      { segs: frontSide, kind: 'seam', name: '脇' },
      { segs: [line(v(frontHemX, frontHemY), v(0, frontHemY))], kind: 'hem', name: '裾' },
      { segs: [line(v(0, frontHemY), v(0, frontNeckDepth))], kind: 'fold', name: '前中心（わ）' },
    ],
    grain: [v(chestQ * 0.5, chestY * 0.9), v(chestQ * 0.5, frontHemY - (frontHemY - chestY) * 0.2)],
  };

  return {
    back,
    front,
    backArmhole,
    frontArmhole,
    backNeckLength: pathLength([backNeck]),
    frontNeckLength: pathLength([frontNeck]),
    warnings,
  };
}
