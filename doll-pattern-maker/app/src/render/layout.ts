// パーツを並べる（単位 cm）。幅を A4 の印刷幅の整数倍にそろえ、PDF で分割しやすくする。

import { Vec, v } from '../geometry/vec';
import { Piece, SeamAllowance } from '../pattern/types';
import { pieceBBox } from './geometry';

export const A4_PRINT_W = 19; // cm（A4 210mm − 余白 10mm × 2）
export const A4_PRINT_H = 27.7; // cm（297mm − 余白 10mm × 2）

/** パーツの上に確保するラベル欄の高さ（cm）。1行目にパーツ名、2行目に裁ち方 */
export const LABEL_H = 1.1;
/** ラベルの文字の大きさ（mm） */
export const LABEL_NAME_SIZE = 3.2;
export const LABEL_CUT_SIZE = 2.6;

/** ラベルのおおよその幅（cm）。全角1文字 ≒ 文字の大きさ */
export function labelWidth(piece: Piece): number {
  const w = (s: string, size: number) => ([...s].length * size) / 10;
  return Math.max(w(piece.name, LABEL_NAME_SIZE), w(piece.cut, LABEL_CUT_SIZE));
}
const GAP = 0.8;
const MARGIN = 0.5;
/** 左上のタイトル行の高さ（cm） */
export const TITLE_H = 0.7;
/** 1ページ目の左上に置く確認用の正方形（cm） */
export const TEST_SQUARE = 3;

export interface Placed {
  piece: Piece;
  /** パーツ座標に足すと配置後の座標になる */
  offset: Vec;
  /** ラベルの左上 */
  labelAt: Vec;
}

export interface Layout {
  placed: Placed[];
  width: number;
  height: number;
  testSquareAt: Vec;
}

export function layoutPieces(pieces: Piece[], sa: SeamAllowance): Layout {
  const boxes = pieces.map((p) => ({ piece: p, box: pieceBBox(p, sa) }));
  const widest = Math.max(...boxes.map((b) => b.box.maxX - b.box.minX), TEST_SQUARE) + MARGIN * 2;
  const width = Math.ceil(widest / A4_PRINT_W) * A4_PRINT_W;

  const placed: Placed[] = [];
  const top = MARGIN + TITLE_H;
  const testSquareAt = v(MARGIN, top + LABEL_H);
  let x = MARGIN + TEST_SQUARE + GAP;
  let y = top;
  let rowH = TEST_SQUARE + LABEL_H + 0.6; // 正方形の下の注記の分

  for (const { piece, box } of boxes) {
    const boxW = box.maxX - box.minX;
    // ラベルが隣のパーツに重ならないよう、ラベルの幅も確保する
    const w = Math.max(boxW, labelWidth(piece));
    const h = box.maxY - box.minY + LABEL_H;
    if (x + w > width - MARGIN && x > MARGIN) {
      x = MARGIN;
      y += rowH + GAP;
      rowH = 0;
    }
    placed.push({
      piece,
      offset: v(x - box.minX, y + LABEL_H - box.minY),
      labelAt: v(x, y),
    });
    x += w + GAP;
    rowH = Math.max(rowH, h);
  }
  return { placed, width, height: y + rowH + MARGIN, testSquareAt };
}
