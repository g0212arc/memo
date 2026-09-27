// 2次元の点・ベクトル。単位は cm。y は下向きが正（SVG と同じ向き）。

export interface Vec {
  x: number;
  y: number;
}

export const v = (x: number, y: number): Vec => ({ x, y });
export const add = (a: Vec, b: Vec): Vec => v(a.x + b.x, a.y + b.y);
export const sub = (a: Vec, b: Vec): Vec => v(a.x - b.x, a.y - b.y);
export const mul = (a: Vec, k: number): Vec => v(a.x * k, a.y * k);
export const dot = (a: Vec, b: Vec): number => a.x * b.x + a.y * b.y;
export const cross = (a: Vec, b: Vec): number => a.x * b.y - a.y * b.x;
export const len = (a: Vec): number => Math.hypot(a.x, a.y);
export const dist = (a: Vec, b: Vec): number => len(sub(a, b));
export const lerp = (a: Vec, b: Vec, t: number): Vec => v(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);

export function normalize(a: Vec): Vec {
  const l = len(a);
  return l === 0 ? v(0, 0) : mul(a, 1 / l);
}

/** 左手法線（進行方向に対して左）。y 下向き座標では、反時計回りに見える側。 */
export const perpLeft = (a: Vec): Vec => v(a.y, -a.x);

/** 点 p から角度 deg（x 軸から、y 下向き座標で時計回り）方向に長さ l 進んだ点 */
export function polar(p: Vec, deg: number, l: number): Vec {
  const r = (deg * Math.PI) / 180;
  return v(p.x + Math.cos(r) * l, p.y + Math.sin(r) * l);
}

/** 2直線（p1→p2 と p3→p4 を無限に延ばしたもの）の交点。平行なら null */
export function lineIntersect(p1: Vec, p2: Vec, p3: Vec, p4: Vec): Vec | null {
  const d1 = sub(p2, p1);
  const d2 = sub(p4, p3);
  const den = cross(d1, d2);
  if (Math.abs(den) < 1e-12) return null;
  const t = cross(sub(p3, p1), d2) / den;
  return add(p1, mul(d1, t));
}
