// パーツの輪郭（できあがり線）と裁ち切り線（縫い代つき）を折れ線で求める。SVG と PDF で共通。

import { flatten, bbox, BBox } from '../geometry/path';
import { offsetLoop } from '../geometry/offset';
import { Vec } from '../geometry/vec';
import { EdgeKind, Piece, SeamAllowance } from '../pattern/types';

export function allowanceFor(kind: EdgeKind, sa: SeamAllowance): number {
  switch (kind) {
    case 'seam':
      return sa.seam;
    case 'hem':
      return sa.hem;
    case 'opening':
      return sa.opening;
    case 'fold':
      return 0;
  }
}

export function pieceOutline(piece: Piece): Vec[] {
  const pts = flatten(piece.edges.flatMap((e) => e.segs));
  pts.pop(); // 始点に戻る重複点
  return pts;
}

export function pieceCutLine(piece: Piece, sa: SeamAllowance): Vec[] {
  return offsetLoop(piece.edges.map((e) => ({ pts: flatten(e.segs), d: allowanceFor(e.kind, sa) })));
}

export function pieceBBox(piece: Piece, sa: SeamAllowance): BBox {
  return bbox([...pieceOutline(piece), ...pieceCutLine(piece, sa)]);
}
