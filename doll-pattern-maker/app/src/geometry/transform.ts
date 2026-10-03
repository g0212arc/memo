// 点の回転・折り返し、折れ線の平行移動、曲線の分割。襟など、身頃を組み合わせて作るパーツ用。

import { Vec, v, add, sub, mul, dot, normalize, perpLeft, lineIntersect } from './vec';
import { CubicSeg, Seg, cubic, cubicPoint, line, mapSeg } from './path';

const rad = (d: number) => (d * Math.PI) / 180;

export function rotate(p: Vec, c: Vec, deg: number): Vec {
  const a = rad(deg);
  const d = sub(p, c);
  return add(c, v(d.x * Math.cos(a) - d.y * Math.sin(a), d.x * Math.sin(a) + d.y * Math.cos(a)));
}

/** 点 p を、c を通り角度 deg の直線で折り返す */
export function reflect(p: Vec, c: Vec, deg: number): Vec {
  const u = v(Math.cos(rad(deg)), Math.sin(rad(deg)));
  const d = sub(p, c);
  const along = mul(u, dot(d, u));
  return add(c, sub(mul(along, 2), d));
}

/** 2 点を結ぶ線の角度（度） */
export const angleOf = (a: Vec, b: Vec) => (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;

/**
 * 前身頃の点を後ろ身頃の座標へ移す。前の肩線が後ろの肩線と重なるよう SNP を中心に回し、肩線で折り返す
 * （前後の身頃を肩で突き合わせた状態。襟を引くときに使う）
 */
export function frontToBack(snp: Vec, frontSP: Vec, backSP: Vec, overlapDeg = 0): (q: Vec) => Vec {
  const bs = angleOf(snp, backSP);
  const fs = angleOf(snp, frontSP);
  // overlapDeg: 肩先を重ねる角度。平らな襟は少し重ねると、首まわりで襟が少し立ち上がる
  return (q) => rotate(reflect(rotate(q, snp, bs - fs), snp, bs), snp, overlapDeg);
}

export const mapSegs = (segs: Seg[], f: (p: Vec) => Vec) => segs.map((s) => mapSeg(s, f));

/** 折れ線を、toward の点の側へ d だけ平行移動した線。角は隣どうしの交点でつなぐ（d がマイナスなら反対側） */
export function insetPolyline(pts: Vec[], d: number, toward: Vec): Vec[] {
  const lines: [Vec, Vec][] = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    let n = perpLeft(normalize(sub(b, a)));
    const mid = mul(add(a, b), 0.5);
    if (dot(n, sub(toward, mid)) < 0) n = mul(n, -1);
    lines.push([add(a, mul(n, d)), add(b, mul(n, d))]);
  }
  const out: Vec[] = [lines[0][0]];
  for (let i = 1; i < lines.length; i++) {
    const x = lineIntersect(lines[i - 1][0], lines[i - 1][1], lines[i][0], lines[i][1]);
    out.push(x ?? lines[i][0]);
  }
  out.push(lines[lines.length - 1][1]);
  return out;
}

/** 3 次ベジェを t で 2 つに分ける */
export function splitCubic(c: CubicSeg, t: number): [CubicSeg, CubicSeg] {
  const l = (a: Vec, b: Vec) => v(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
  const a = l(c.from, c.c1);
  const b = l(c.c1, c.c2);
  const d = l(c.c2, c.to);
  const e = l(a, b);
  const f = l(b, d);
  const m = l(e, f);
  return [cubic(c.from, a, e, m), cubic(m, f, d, c.to)];
}

/** 上から下へ進む（y が増え続ける）辺を、高さ y で上下に分ける */
export function splitSegsAtY(segs: Seg[], y: number): [Seg[], Seg[]] {
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const y0 = s.from.y;
    const y1 = s.to.y;
    if (y < Math.min(y0, y1) - 1e-9 || y > Math.max(y0, y1) + 1e-9) continue;
    if (s.kind === 'line') {
      const t = Math.abs(y1 - y0) < 1e-12 ? 0 : (y - y0) / (y1 - y0);
      const m = v(s.from.x + (s.to.x - s.from.x) * t, y);
      return [[...segs.slice(0, i), line(s.from, m)], [line(m, s.to), ...segs.slice(i + 1)]];
    }
    let lo = 0;
    let hi = 1;
    const inc = y1 > y0;
    for (let k = 0; k < 60; k++) {
      const mid = (lo + hi) / 2;
      if (cubicPoint(s, mid).y < y === inc) lo = mid;
      else hi = mid;
    }
    const [a, b] = splitCubic(s, (lo + hi) / 2);
    return [[...segs.slice(0, i), a], [b, ...segs.slice(i + 1)]];
  }
  throw new Error('splitSegsAtY: 範囲外の高さです');
}
