// 縫い代の線。閉じた輪の各辺を、辺ごとの幅で外側へ平行移動し、角は隣どうしの交点でつなぐ。

import { Vec, add, sub, mul, normalize, perpLeft, lineIntersect, dist, v, cross } from './vec';
import { signedArea } from './path';

export interface OffsetInput {
  /** 辺を折れ線にしたもの（前の辺の終点 = 次の辺の始点） */
  pts: Vec[];
  /** 外側へずらす幅（0 なら元の線のまま） */
  d: number;
}

interface OffSeg {
  a: Vec;
  b: Vec;
}

function offsetPolyline(pts: Vec[], d: number, outwardLeft: boolean): OffSeg[] {
  const segs: OffSeg[] = [];
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1];
    const q = pts[i];
    if (dist(p, q) < 1e-9) continue;
    const n = perpLeft(normalize(sub(q, p)));
    const o = mul(outwardLeft ? n : v(-n.x, -n.y), d);
    segs.push({ a: add(p, o), b: add(q, o) });
  }
  return segs;
}

/** 2本の平行移動した線分をつなぐ点。交点が遠すぎる（鋭い角）ときは両端を直接つなぐ */
function join(s1: OffSeg, s2: OffSeg, limit: number): Vec[] {
  const x = lineIntersect(s1.a, s1.b, s2.a, s2.b);
  if (!x) return [s1.b, s2.a];
  if (dist(x, s1.b) > limit || dist(x, s2.a) > limit) return [s1.b, s2.a];
  return [x];
}

export function offsetLoop(edges: OffsetInput[]): Vec[] {
  const all: Vec[] = [];
  for (const e of edges) {
    const pts = all.length ? e.pts.slice(1) : e.pts;
    all.push(...pts);
  }
  // y 下向き座標で面積が正 = 画面上で時計回り → 進行方向の左が外側
  const outwardLeft = signedArea(all) > 0;
  const maxD = Math.max(...edges.map((e) => e.d), 0.1);
  // 角の交点がこれより遠い（鋭い角）ときは角を切り落とす
  const limit = maxD * 2;

  const flat = edges.flatMap((e) => offsetPolyline(e.pts, e.d, outwardLeft));
  const out: Vec[] = [];
  for (let i = 0; i < flat.length; i++) {
    const cur = flat[i];
    const next = flat[(i + 1) % flat.length];
    // 同じ辺の中の曲線はそのまま交点で、辺どうしの角も交点でつなぐ
    out.push(...join(cur, next, limit));
  }
  // 半径が縫い代より小さいカーブでは、ずらした線が自分と交差して小さな輪ができるので取り除く
  // 始点をまたぐ輪も取れるよう、始点を半周ずらしてもう一度かける
  const once = removeLoops(out);
  const half = Math.floor(once.length / 2);
  return removeLoops([...once.slice(half), ...once.slice(0, half)]);
}

/** 線分 p1-p2 と p3-p4 が交わっていれば交点を返す（端点どうしの接触は除く） */
function segIntersect(p1: Vec, p2: Vec, p3: Vec, p4: Vec): Vec | null {
  const d1 = sub(p2, p1);
  const d2 = sub(p4, p3);
  const den = cross(d1, d2);
  if (Math.abs(den) < 1e-12) return null;
  const t = cross(sub(p3, p1), d2) / den;
  const u = cross(sub(p3, p1), d1) / den;
  const e = 1e-9;
  if (t <= e || t >= 1 - e || u <= e || u >= 1 - e) return null;
  return add(p1, mul(d1, t));
}

/** 近くの（window 本以内の）線分どうしの交差を見つけ、その間の輪を切り取る */
export function removeLoops(pts: Vec[], window = 80): Vec[] {
  const res = pts.slice();
  let i = 0;
  while (i < res.length - 3) {
    let cut = false;
    const jMax = Math.min(res.length - 2, i + window);
    for (let j = jMax; j >= i + 2; j--) {
      const x = segIntersect(res[i], res[i + 1], res[j], res[j + 1]);
      if (x) {
        res.splice(i + 1, j - i, x);
        cut = true;
        break;
      }
    }
    if (!cut) i++;
  }
  return res;
}
