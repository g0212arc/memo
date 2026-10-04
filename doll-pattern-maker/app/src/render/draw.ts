// 配置済みのパーツを「描く命令」に変換する。SVG と PDF はこの命令を描くだけにして、見た目をそろえる。
// 単位はここで mm に変換する。

import { Vec, add, mul, sub, normalize, perpLeft, v, lerp } from '../geometry/vec';
import { flatten } from '../geometry/path';
import { SeamAllowance } from '../pattern/types';
import { Layout, TEST_SQUARE, LABEL_NAME_SIZE, LABEL_CUT_SIZE } from './layout';
import { pieceCutLine, pieceOutline } from './geometry';

export type Stroke = 'cut' | 'finish' | 'fold' | 'grain' | 'guide' | 'mark';

export type Cmd =
  | { t: 'poly'; pts: Vec[]; closed: boolean; stroke: Stroke }
  | { t: 'text'; at: Vec; text: string; size: number; anchor: 'start' | 'middle' }
  | { t: 'rect'; at: Vec; w: number; h: number; stroke: Stroke };

const MM = 10;
const mm = (p: Vec): Vec => mul(p, MM);

/** subtitle: タイトルの下に書く行（設定の行） */
/** 設定の行の文字の大きさ・行の間隔（mm）。1 行目のタイトルの下から */
export const SUB_SIZE = 2.4;
export const SUB_LINE = 3.1;
const SUB_GAP = 4;
/** 設定の行のために、タイトルの下に足す高さ（cm） */
export const subtitleHeight = (lines: number) => (lines > 0 ? (SUB_GAP - 1 + lines * SUB_LINE) / 10 : 0);

export function drawCommands(layout: Layout, sa: SeamAllowance, title: string, subtitle: string[] = []): Cmd[] {
  const cmds: Cmd[] = [];

  // 確認用の正方形
  const sq = mm(layout.testSquareAt);
  cmds.push({ t: 'rect', at: sq, w: TEST_SQUARE * MM, h: TEST_SQUARE * MM, stroke: 'cut' });
  cmds.push({ t: 'text', at: v(sq.x + (TEST_SQUARE * MM) / 2, sq.y + (TEST_SQUARE * MM) / 2 + 1.5), text: `${TEST_SQUARE}cm`, size: 4, anchor: 'middle' });
  cmds.push({ t: 'text', at: v(sq.x, sq.y + TEST_SQUARE * MM + 4), text: '定規で測って確認', size: 2.5, anchor: 'start' });
  cmds.push({ t: 'text', at: v(5, 8), text: title, size: 3.5, anchor: 'start' });
  subtitle.forEach((line, i) => cmds.push({ t: 'text', at: v(5, 8 + SUB_GAP + i * SUB_LINE), text: line, size: SUB_SIZE, anchor: 'start' }));

  for (const pl of layout.placed) {
    const tr = (p: Vec) => mm(add(p, pl.offset));
    const piece = pl.piece;

    cmds.push({ t: 'poly', pts: pieceCutLine(piece, sa).map(tr), closed: true, stroke: 'cut' });
    cmds.push({ t: 'poly', pts: pieceOutline(piece).map(tr), closed: true, stroke: 'finish' });

    const foldStart = cmds.length;
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

    // 合印: 辺の真ん中（長さの半分の位置）の、できあがり線の少し内側に記号を書く。
    // 布目線やほかの記号と重なるときは、辺の端の方へずらす
    const outline = pieceOutline(piece).map(tr);
    const [gA, gB] = piece.grain.map(tr);
    // 避けるもの: 「わ」の文字・ほかの記号（点）と布目線（線分）
    const placed: Vec[] = cmds.filter((c, i) => i >= foldStart && c.t === 'text' && c.text === 'わ').map((c) => (c as { at: Vec }).at);
    const room = (q: Vec) => Math.min(distToSeg(q, gA, gB) / 3, ...placed.map((o) => Math.hypot(o.x - q.x, o.y - q.y) / 4));
    for (const e of piece.edges) {
      if (!e.match) continue;
      const pts = flatten(e.segs).map(tr);
      let best: Vec | null = null;
      let bestRoom = -Infinity;
      for (const t of [0.5, 0.35, 0.65, 0.2, 0.8]) {
        const at = pointAt(pts, t);
        if (!at) continue;
        let n = mul(perpLeft(at.dir), 2.8);
        if (!insidePolygon(add(at.p, n), outline)) n = mul(n, -1);
        const q = add(at.p, n);
        const r = room(q);
        if (r > bestRoom) {
          best = q;
          bestRoom = r;
        }
        if (r >= 1) break; // 十分空いている（真ん中に近い順に試す）
      }
      if (!best) continue;
      placed.push(best);
      cmds.push({ t: 'text', at: add(best, v(0, 1.1)), text: e.match, size: MATCH_SIZE, anchor: 'middle' });
    }

    // ダーツなどの内側の印
    for (const m of piece.marks ?? []) cmds.push({ t: 'poly', pts: m.map(tr), closed: false, stroke: 'mark' });
    // 型紙の中の文字（「持ち出し」など）。縦書きは 1 文字ずつ下へ並べる
    for (const nt of piece.notes ?? []) {
      const at = tr(nt.at);
      if (nt.vertical) {
        const chars = [...nt.text];
        const step = NOTE_SIZE * 1.1;
        chars.forEach((ch, i) => cmds.push({ t: 'text', at: v(at.x, at.y + (i - (chars.length - 1) / 2) * step + NOTE_SIZE * 0.35), text: ch, size: NOTE_SIZE, anchor: 'middle' }));
      } else cmds.push({ t: 'text', at: v(at.x, at.y + NOTE_SIZE * 0.35), text: nt.text, size: NOTE_SIZE, anchor: 'middle' });
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
    cmds.push({ t: 'text', at: v(la.x, la.y + 4), text: piece.name, size: LABEL_NAME_SIZE, anchor: 'start' });
    cmds.push({ t: 'text', at: v(la.x, la.y + 8), text: piece.cut, size: LABEL_CUT_SIZE, anchor: 'start' });
  }
  return cmds;
}

const MATCH_SIZE = 3.2;
const NOTE_SIZE = 2.4;

/** 折れ線の、長さの割合 t の点と、そこでの向き */
function pointAt(pts: Vec[], t: number): { p: Vec; dir: Vec } | null {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  if (total < 1e-9) return null;
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (acc + d >= total * t && d > 1e-12) {
      const u = (total * t - acc) / d;
      return { p: lerp(pts[i - 1], pts[i], u), dir: normalize(sub(pts[i], pts[i - 1])) };
    }
    acc += d;
  }
  return null;
}

function distToSeg(q: Vec, a: Vec, b: Vec): number {
  const ab = sub(b, a);
  const L2 = ab.x * ab.x + ab.y * ab.y;
  const t = L2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((q.x - a.x) * ab.x + (q.y - a.y) * ab.y) / L2));
  return Math.hypot(q.x - (a.x + ab.x * t), q.y - (a.y + ab.y * t));
}

function insidePolygon(q: Vec, poly: Vec[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > q.y !== b.y > q.y && q.x < ((b.x - a.x) * (q.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export const STROKE_STYLE: Record<Stroke, { width: number; color: string; dash?: number[] }> = {
  cut: { width: 0.35, color: '#222222' },
  finish: { width: 0.2, color: '#666666', dash: [1.5, 1] },
  fold: { width: 0.3, color: '#b03060', dash: [4, 1, 0.6, 1] },
  grain: { width: 0.25, color: '#2060b0' },
  guide: { width: 0.15, color: '#aaaaaa' },
  mark: { width: 0.25, color: '#222222' },
};
