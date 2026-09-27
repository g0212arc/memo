// 線分・3次ベジェ曲線からなる「辺」と、その長さ・折れ線化。

import { Vec, dist, lerp, add, v } from './vec';

export interface LineSeg {
  kind: 'line';
  from: Vec;
  to: Vec;
}

export interface CubicSeg {
  kind: 'cubic';
  from: Vec;
  c1: Vec;
  c2: Vec;
  to: Vec;
}

export type Seg = LineSeg | CubicSeg;

export const line = (from: Vec, to: Vec): LineSeg => ({ kind: 'line', from, to });
export const cubic = (from: Vec, c1: Vec, c2: Vec, to: Vec): CubicSeg => ({ kind: 'cubic', from, c1, c2, to });

export function cubicPoint(s: CubicSeg, t: number): Vec {
  const a = lerp(s.from, s.c1, t);
  const b = lerp(s.c1, s.c2, t);
  const c = lerp(s.c2, s.to, t);
  const d = lerp(a, b, t);
  const e = lerp(b, c, t);
  return lerp(d, e, t);
}

/** 辺を折れ線にする（曲線は steps 分割） */
export function flattenSeg(s: Seg, steps = 48): Vec[] {
  if (s.kind === 'line') return [s.from, s.to];
  const pts: Vec[] = [];
  for (let i = 0; i <= steps; i++) pts.push(cubicPoint(s, i / steps));
  return pts;
}

/** 複数の辺をつないだ折れ線（つなぎ目の重複点は除く） */
export function flatten(segs: Seg[], steps = 48): Vec[] {
  const out: Vec[] = [];
  for (const s of segs) {
    const pts = flattenSeg(s, steps);
    if (out.length > 0) pts.shift();
    out.push(...pts);
  }
  return out;
}

export function polylineLength(pts: Vec[]): number {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += dist(pts[i - 1], pts[i]);
  return l;
}

export function segLength(s: Seg): number {
  return s.kind === 'line' ? dist(s.from, s.to) : polylineLength(flattenSeg(s, 200));
}

export function pathLength(segs: Seg[]): number {
  return segs.reduce((acc, s) => acc + segLength(s), 0);
}

export function reverseSeg(s: Seg): Seg {
  return s.kind === 'line' ? line(s.to, s.from) : cubic(s.to, s.c2, s.c1, s.from);
}

export function mapSeg(s: Seg, f: (p: Vec) => Vec): Seg {
  return s.kind === 'line' ? line(f(s.from), f(s.to)) : cubic(f(s.from), f(s.c1), f(s.c2), f(s.to));
}

/** x = 0 の線で左右反転 */
export const mirrorX = (p: Vec): Vec => v(-p.x, p.y);

export const translate = (d: Vec) => (p: Vec): Vec => add(p, d);

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function bbox(pts: Vec[]): BBox {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

/** 符号付き面積（y 下向き座標では、正 = 画面上で時計回り） */
export function signedArea(pts: Vec[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}
