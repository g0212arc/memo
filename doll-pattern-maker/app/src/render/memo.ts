// 作り方メモを、印刷のページの空いているところに置く（PDF だけ）。
// パーツ・ラベル・確認用の正方形・タイトルを避けて、ページの左上から順に入る場所を探す。どこにも入らなければページを 1 段足す。

import { Vec, v } from '../geometry/vec';
import { DraftResult, SeamAllowance } from '../pattern/types';
import { sewingSteps } from '../pattern/steps';
import { Cmd } from './draw';
import { pieceBBox } from './geometry';
import { A4_PRINT_H, A4_PRINT_W, LABEL_H, Layout, TEST_SQUARE, TITLE_H, labelWidth } from './layout';

/** メモの文字の大きさ（mm）。型紙名と同じくらい */
export const MEMO_SIZE = 3;
const LINE = 0.5; // 行の間隔（cm）
const PAD = 0.3;
const GAP = 0.4; // ほかのものとの間
const MARGIN = 0.5;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w + GAP && b.x < a.x + a.w + GAP && a.y < b.y + b.h + GAP && b.y < a.y + a.h + GAP;

export interface MemoPlacement {
  /** 左上（cm） */
  at: Vec;
  w: number;
  h: number;
  /** ページを足した段の数（0 か 1） */
  extraRows: number;
}

/** メモの大きさ（cm）。全角 1 文字 ≒ 文字の大きさ */
export function memoSize(lines: string[], title: string): { w: number; h: number } {
  const chars = Math.max(...[title, ...lines].map((s) => [...s].length));
  return { w: Math.min(A4_PRINT_W - MARGIN * 2, (chars * MEMO_SIZE) / 10 + PAD * 2), h: (lines.length + 1) * LINE + PAD * 2 };
}

export function placeMemo(layout: Layout, sa: SeamAllowance, lines: string[], title: string): MemoPlacement {
  const { w, h } = memoSize(lines, title);
  const used: Rect[] = [];
  used.push({ x: 0, y: 0, w: layout.width, h: MARGIN + TITLE_H }); // タイトル
  used.push({ x: layout.testSquareAt.x, y: layout.testSquareAt.y - LABEL_H, w: TEST_SQUARE, h: TEST_SQUARE + LABEL_H + 0.8 });
  for (const pl of layout.placed) {
    const b = pieceBBox(pl.piece, sa);
    used.push({ x: b.minX + pl.offset.x, y: b.minY + pl.offset.y, w: b.maxX - b.minX, h: b.maxY - b.minY });
    used.push({ x: pl.labelAt.x, y: pl.labelAt.y, w: labelWidth(pl.piece), h: LABEL_H });
  }
  const step = 0.25;
  for (let r = 0; r < layout.rows; r++) {
    for (let c = 0; c < layout.cols; c++) {
      const x0 = c * A4_PRINT_W + MARGIN;
      const y0 = r * A4_PRINT_H + MARGIN;
      for (let y = y0; y + h <= (r + 1) * A4_PRINT_H - MARGIN + 1e-9; y += step) {
        for (let x = x0; x + w <= (c + 1) * A4_PRINT_W - MARGIN + 1e-9; x += step) {
          const rect = { x, y, w, h };
          if (!used.some((u) => overlaps(rect, u))) return { at: v(x, y), w, h, extraRows: 0 };
        }
      }
    }
  }
  return { at: v(MARGIN, layout.rows * A4_PRINT_H + MARGIN), w, h, extraRows: 1 };
}

/** メモを描く命令（単位 mm） */
export function memoCommands(pl: MemoPlacement, lines: string[], title: string): Cmd[] {
  const x = pl.at.x * 10;
  const y = pl.at.y * 10;
  const cmds: Cmd[] = [{ t: 'rect', at: v(x, y), w: pl.w * 10, h: pl.h * 10, stroke: 'guide' }];
  cmds.push({ t: 'text', at: v(x + PAD * 10, y + PAD * 10 + MEMO_SIZE), text: title, size: MEMO_SIZE, anchor: 'start' });
  lines.forEach((s, i) => cmds.push({ t: 'text', at: v(x + PAD * 10, y + PAD * 10 + MEMO_SIZE + (i + 1) * LINE * 10), text: s, size: MEMO_SIZE, anchor: 'start' }));
  return cmds;
}

/** PDF 用: 描く命令にメモを足す。ページを足したときは高さ（mm）も増える */
export function withMemo(
  layout: Layout,
  sa: SeamAllowance,
  cmds: Cmd[],
  itemId: string,
  params: Record<string, unknown>,
  draft: DraftResult,
): { cmds: Cmd[]; heightMm: number; extraPage: boolean } {
  const lines = sewingSteps(itemId, params, draft);
  if (lines.length === 0) return { cmds, heightMm: layout.height * 10, extraPage: false };
  const title = '作り方メモ（同じ記号の辺どうしを縫う）';
  const pl = placeMemo(layout, sa, lines, title);
  return { cmds: [...cmds, ...memoCommands(pl, lines, title)], heightMm: (layout.height + pl.extraRows * A4_PRINT_H) * 10, extraPage: pl.extraRows > 0 };
}
