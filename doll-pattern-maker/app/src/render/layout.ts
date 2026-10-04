// パーツを並べる（単位 cm）。A4 の印刷範囲を 1 ページとして、ページの境目にパーツがかからないように並べる。

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
  /** ページの高さの整数倍 */
  height: number;
  testSquareAt: Vec;
  /** ページの並び（横 cols × 縦 rows）。ページ番号は左上から右へ、行ごとに 1, 2, 3… */
  cols: number;
  rows: number;
}

/**
 * パーツを A4 の印刷範囲（ページ）ごとに並べる。
 * A4 に収まるパーツはページの境目にかからないよう、はみ出すなら次のページ（列）へ送る。
 * A4 より大きいパーツだけはページの頭から置き、複数ページにまたがる。
 */
export function layoutPieces(pieces: Piece[], sa: SeamAllowance): Layout {
  const PW = A4_PRINT_W;
  const PH = A4_PRINT_H;
  const boxes = pieces.map((p) => ({ piece: p, box: pieceBBox(p, sa) }));
  const widest = Math.max(...boxes.map((b) => Math.max(b.box.maxX - b.box.minX, labelWidth(b.piece))), TEST_SQUARE) + MARGIN * 2;
  const cols = Math.max(1, Math.ceil(widest / PW - 1e-9));
  const width = cols * PW;

  const placed: Placed[] = [];
  const top = MARGIN + TITLE_H;
  const testSquareAt = v(MARGIN, top + LABEL_H);
  let x = MARGIN + TEST_SQUARE + GAP;
  let y = top;
  let rowH = TEST_SQUARE + LABEL_H + 0.6; // 正方形の下の注記の分

  const pageBottom = (yy: number) => (Math.floor(yy / PH + 1e-9) + 1) * PH;
  const newRow = (atY?: number) => {
    y = atY ?? y + rowH + GAP;
    x = MARGIN;
    rowH = 0;
  };

  for (const { piece, box } of boxes) {
    const boxW = box.maxX - box.minX;
    // ラベルが隣のパーツに重ならないよう、ラベルの幅も確保する
    const w = Math.max(boxW, labelWidth(piece));
    const h = box.maxY - box.minY + LABEL_H;
    const fitsPageW = w <= PW - MARGIN * 2;
    const fitsPageH = h <= PH - MARGIN * 2;
    // 横: ページ（列）の境目にかかるなら次の列へ。右端を越えるなら次の行へ
    if (fitsPageW) {
      const colEnd = (Math.floor(x / PW + 1e-9) + 1) * PW;
      if (x + w > colEnd - MARGIN) x = colEnd + MARGIN;
    }
    if (x + w > width - MARGIN + 1e-9 && x > MARGIN + 1e-9) newRow();
    // 縦: ページの下の境目にかかるなら、次のページの頭から新しい行
    if (fitsPageH && y + h > pageBottom(y) - MARGIN + 1e-9) newRow(pageBottom(y) + MARGIN);
    // 型紙だけなら A4 に収まるが、ラベルを入れると収まらないパーツ: 次のページの頭に置き、ラベルは型紙の内側の上に書く
    const boxH = box.maxY - box.minY;
    if (!fitsPageH && boxH <= PH - MARGIN * 2) {
      if (x > MARGIN + 1e-9) newRow();
      const pageTop = Math.floor(y / PH + 1e-9) * PH;
      if (y > pageTop + MARGIN + 1e-9 || y + boxH > pageBottom(y) - MARGIN + 1e-9) newRow(pageBottom(y) + MARGIN);
      placed.push({ piece, offset: v(x - box.minX, y - box.minY), labelAt: v(x + 0.2, y + 0.2) });
      x += w + GAP;
      rowH = Math.max(rowH, boxH);
      continue;
    }
    // A4 より大きいパーツは、ページの頭から置く（途中から置くと余計に分かれるため）
    if (!fitsPageH && y > Math.floor(y / PH + 1e-9) * PH + MARGIN + TITLE_H + 1e-9) {
      if (x > MARGIN + 1e-9) newRow();
      newRow(pageBottom(y) + MARGIN);
    }
    placed.push({
      piece,
      offset: v(x - box.minX, y + LABEL_H - box.minY),
      labelAt: v(x, y),
    });
    x += w + GAP;
    rowH = Math.max(rowH, h);
  }
  const used = y + rowH + MARGIN;
  const rows = Math.max(1, Math.ceil(used / PH - 1e-9));
  return { placed, width, height: rows * PH, testSquareAt, cols, rows };
}

/**
 * 印刷するページの指定（例: 「1,3-4」）を、ページ番号の配列にする。空欄なら全部。
 * 読めない指定や範囲外のページは error を返す。
 */
export function parsePages(text: string, total: number): { pages: number[] } | { error: string } {
  const s = text.replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0)).replace(/[、，]/g, ',').replace(/[〜～ー−–]/g, '-').trim();
  if (s === '') return { pages: Array.from({ length: total }, (_, i) => i + 1) };
  const out = new Set<number>();
  for (const part of s.split(',').map((x) => x.trim()).filter(Boolean)) {
    const m = part.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!m) return { error: `「${part}」が読めません。例: 1,3-4` };
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    if (a < 1 || b > total || a > b) return { error: `ページは 1〜${total} の範囲で指定してください（「${part}」）` };
    for (let i = a; i <= b; i++) out.add(i);
  }
  return { pages: [...out].sort((x, y) => x - y) };
}
