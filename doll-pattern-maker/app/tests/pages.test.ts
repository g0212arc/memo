import { describe, it, expect } from 'vitest';
import { SAMPLE_BODIES } from '../src/samples';
import { resolveBody } from '../src/model/estimate';
import { groupOf, ITEM_GROUPS, ITEMS } from '../src/pattern/items';
import { A4_PRINT_H, A4_PRINT_W, layoutPieces, parsePages } from '../src/render/layout';
import { pieceCutLine } from '../src/render/geometry';
import { bbox } from '../src/geometry/path';
import { add } from '../src/geometry/vec';

const sa = { seam: 0.5, hem: 0.8, opening: 0.8 };

describe('ページに収まるように並べる（全アイテム × サンプル全ボディ）', () => {
  for (const item of ITEMS) {
    for (const body of SAMPLE_BODIES) {
      it(`${item.label} / ${body.name}`, () => {
        const res = item.draft(resolveBody(body), item.defaults);
        const L = layoutPieces(res.pieces, sa);
        expect(L.width).toBeCloseTo(L.cols * A4_PRINT_W, 9);
        expect(L.height).toBeCloseTo(L.rows * A4_PRINT_H, 9);
        for (const pl of L.placed) {
          const b = bbox(pieceCutLine(pl.piece, sa).map((q) => add(q, pl.offset)));
          const w = b.maxX - b.minX;
          const h = b.maxY - b.minY;
          // 全体の中に収まる
          expect(b.minX).toBeGreaterThanOrEqual(-1e-6);
          expect(b.maxX).toBeLessThanOrEqual(L.width + 1e-6);
          expect(b.maxY).toBeLessThanOrEqual(L.height + 1e-6);
          // A4 に収まる大きさなら、ページの境目にかからない
          if (w <= A4_PRINT_W - 1 && h <= A4_PRINT_H - 2) {
            expect(Math.floor(b.minX / A4_PRINT_W)).toBe(Math.floor((b.maxX - 1e-6) / A4_PRINT_W));
            expect(Math.floor(b.minY / A4_PRINT_H)).toBe(Math.floor((b.maxY - 1e-6) / A4_PRINT_H));
          }
        }
      });
    }
  }
});

describe('印刷するページの指定', () => {
  it('空欄は全部', () => expect(parsePages('', 3)).toEqual({ pages: [1, 2, 3] }));
  it('番号と範囲（全角・読点も可）', () => {
    expect(parsePages('1,3-4', 5)).toEqual({ pages: [1, 3, 4] });
    expect(parsePages('２、４〜５', 5)).toEqual({ pages: [2, 4, 5] });
  });
  it('範囲外・読めない指定はエラー', () => {
    expect('error' in parsePages('6', 5)).toBe(true);
    expect('error' in parsePages('a', 5)).toBe(true);
    expect('error' in parsePages('3-1', 5)).toBe(true);
  });
});

describe('アイテムの並び順', () => {
  it('色移り防止タイツは常に一番下', () => {
    expect(ITEMS[ITEMS.length - 1].id).toBe('tights');
    expect(new Set(ITEMS.map((i) => i.id)).size).toBe(ITEMS.length);
  });
});

describe('アイテムの種類の並び', () => {
  it('トップス → ボトムス → アウター → その他 → 小物 の順', () => {
    const order = ITEMS.map((i) => ITEM_GROUPS.indexOf(groupOf(i.id)));
    for (let k = 1; k < order.length; k++) expect(order[k]).toBeGreaterThanOrEqual(order[k - 1]);
  });
});
