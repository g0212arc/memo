// 配置済みのパーツを「描く命令」に変換する。SVG と PDF はこの命令を描くだけにして、見た目をそろえる。
// 単位はここで mm に変換する。

import { Vec, add, mul, sub, normalize, perpLeft, v, lerp } from '../geometry/vec';
import { flatten } from '../geometry/path';
import { SeamAllowance } from '../pattern/types';
import { Layout, TEST_SQUARE } from './layout';
import { pieceCutLine, pieceOutline } from './geometry';

export type Stroke = 'cut' | 'finish' | 'fold' | 'grain' | 'guide';

export type Cmd =
  | { t: 'poly'; pts: Vec[]; closed: boolean; stroke: Stroke }
  | { t: 'text'; at: Vec; text: string; size: number; anchor: 'start' | 'middle' }
  | { t: 'rect'; at: Vec; w: number; h: number; stroke: Stroke };

const MM = 10;
const mm = (p: Vec): Vec => mul(p, MM);

export function drawCommands(layout: Layout, sa: SeamAllowance, title: string): Cmd[] {
  const cmds: Cmd[] = [];

  // 確認用の正方形
  const sq = mm(layout.testSquareAt);
  cmds.push({ t: 'rect', at: sq, w: TEST_SQUARE * MM, h: TEST_SQUARE * MM, stroke: 'cut' });
  cmds.push({ t: 'text', at: v(sq.x + (TEST_SQUARE * MM) / 2, sq.y + (TEST_SQUARE * MM) / 2 + 1.5), text: `${TEST_SQUARE}cm`, size: 4, anchor: 'middle' });
  cmds.push({ t: 'text', at: v(sq.x, sq.y + TEST_SQUARE * MM + 4), text: '定規で測って確認', size: 2.5, anchor: 'start' });
  cmds.push({ t: 'text', at: v(5, 8), text: title, size: 3.5, anchor: 'start' });

  for (const pl of layout.placed) {
    const tr = (p: Vec) => mm(add(p, pl.offset));
    const piece = pl.piece;

    cmds.push({ t: 'poly', pts: pieceCutLine(piece, sa).map(tr), closed: true, stroke: 'cut' });
    cmds.push({ t: 'poly', pts: pieceOutline(piece).map(tr), closed: true, stroke: 'finish' });

    // わ の辺は一点鎖線で重ね、「わ」と書く
    for (const e of piece.edges) {
      if (e.kind !== 'fold') continue;
      const pts = flatten(e.segs).map(tr);
      cmds.push({ t: 'poly', pts, closed: false, stroke: 'fold' });
      const a = pts[0];
      const b = pts[pts.length - 1];
      const mid = lerp(a, b, 0.5);
      // 辺の内側（輪郭の内側）に文字を置く: 右回りの輪なので進行方向の右が内側
      const inward = mul(perpLeft(normalize(sub(b, a))), -1);
      cmds.push({ t: 'text', at: add(mid, mul(inward, 3)), text: 'わ', size: 3.5, anchor: 'middle' });
    }

    // 布目線（両矢印）
    const [g0, g1] = piece.grain.map(tr);
    cmds.push({ t: 'poly', pts: [g0, g1], closed: false, stroke: 'grain' });
    const dir = normalize(sub(g1, g0));
    const n = perpLeft(dir);
    const head = (tip: Vec, d: Vec) => [add(sub(tip, mul(d, 2)), mul(n, 1)), tip, sub(sub(tip, mul(d, 2)), mul(n, 1))];
    cmds.push({ t: 'poly', pts: head(g1, dir), closed: false, stroke: 'grain' });
    cmds.push({ t: 'poly', pts: head(g0, mul(dir, -1)), closed: false, stroke: 'grain' });

    const la = mm(pl.labelAt);
    cmds.push({ t: 'text', at: v(la.x, la.y + 4), text: `${piece.name}　${piece.cut}`, size: 3.2, anchor: 'start' });
  }
  return cmds;
}

export const STROKE_STYLE: Record<Stroke, { width: number; color: string; dash?: number[] }> = {
  cut: { width: 0.35, color: '#222222' },
  finish: { width: 0.2, color: '#666666', dash: [1.5, 1] },
  fold: { width: 0.3, color: '#b03060', dash: [4, 1, 0.6, 1] },
  grain: { width: 0.25, color: '#2060b0' },
  guide: { width: 0.15, color: '#aaaaaa' },
};
