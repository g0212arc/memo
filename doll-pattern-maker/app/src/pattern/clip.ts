// パーツを縦の線（x = 一定）で切って、片側だけ残す。見返しや裏地を、身頃と同じ形から作るときに使う。
// 曲線は細かい線分にしてから切る。切り口は新しい辺（kind・name を指定）になる。

import { Vec, v } from '../geometry/vec';
import { flattenSeg, line, Seg } from '../geometry/path';
import { Edge, EdgeKind, Piece } from './types';

interface Tagged {
  a: Vec;
  b: Vec;
  /** 元の辺の番号。切り口は -1 */
  tag: number;
}

export function clipPieceX(
  piece: Piece,
  side: 'left' | 'right',
  x: number,
  cut: { kind: EdgeKind; name: string },
): Edge[] {
  const inside = (p: Vec) => (side === 'left' ? p.x <= x + 1e-9 : p.x >= x - 1e-9);
  const at = (a: Vec, b: Vec): Vec => {
    const t = (x - a.x) / (b.x - a.x);
    return v(x, a.y + (b.y - a.y) * t);
  };
  let ring: Tagged[] = [];
  piece.edges.forEach((e, i) =>
    e.segs.forEach((s: Seg) => {
      const pts = flattenSeg(s, 24);
      for (let k = 1; k < pts.length; k++) ring.push({ a: pts[k - 1], b: pts[k], tag: i });
    }),
  );
  const start = ring.findIndex((s) => inside(s.a));
  if (start < 0) return [];
  ring = [...ring.slice(start), ...ring.slice(0, start)];

  const out: Tagged[] = [];
  let exit: Vec | null = null;
  for (const s of ring) {
    const ia = inside(s.a);
    const ib = inside(s.b);
    if (ia && ib) out.push(s);
    else if (ia && !ib) {
      const p = at(s.a, s.b);
      out.push({ a: s.a, b: p, tag: s.tag });
      exit = p;
    } else if (!ia && ib) {
      const p = at(s.a, s.b);
      if (exit) out.push({ a: exit, b: p, tag: -1 });
      out.push({ a: p, b: s.b, tag: s.tag });
      exit = null;
    }
  }
  // 同じ辺から来た線分をまとめる
  const groups: Tagged[][] = [];
  for (const s of out) {
    if (Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y) < 1e-9) continue;
    const g = groups[groups.length - 1];
    if (g && g[0].tag === s.tag) g.push(s);
    else groups.push([s]);
  }
  if (groups.length > 1 && groups[0][0].tag === groups[groups.length - 1][0].tag) {
    groups[0] = [...groups.pop()!, ...groups[0]];
  }
  return groups.map((g) => {
    const tag = g[0].tag;
    const segs = g.map((s) => line(s.a, s.b));
    if (tag < 0) return { segs, kind: cut.kind, name: cut.name };
    const e = piece.edges[tag];
    return { segs, kind: e.kind, name: e.name };
  });
}
