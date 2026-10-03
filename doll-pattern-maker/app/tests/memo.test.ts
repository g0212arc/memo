import { describe, it, expect } from 'vitest';
import { SAMPLE_BODIES } from '../src/samples';
import { resolveBody } from '../src/model/estimate';
import { ITEMS } from '../src/pattern/items';
import { sewingSteps } from '../src/pattern/steps';
import { layoutPieces, A4_PRINT_W, A4_PRINT_H } from '../src/render/layout';
import { placeMemo } from '../src/render/memo';
import { pieceBBox } from '../src/render/geometry';

const sa = { seam: 0.5, hem: 0.8, opening: 0.8 };

describe('作り方メモ', () => {
  for (const item of ITEMS) {
    for (const body of SAMPLE_BODIES) {
      it(`${item.id} / ${body.name}`, () => {
        const r = resolveBody(body);
        const res = item.draft(r, item.defaults);
        const lines = sewingSteps(item.id, item.defaults, res);
        expect(lines.length).toBeGreaterThanOrEqual(3);
        expect(lines.length).toBeLessThanOrEqual(8);
        // 記号を差し込んだ行が 1 行以上ある（空の「（）」は出さない）
        expect(lines.some((s) => /（[A-Z]/.test(s))).toBe(true);
        expect(lines.every((s) => !s.includes('（）'))).toBe(true);
        const layout = layoutPieces(res.pieces, sa);
        const pl = placeMemo(layout, sa, lines, 'タイトル');
        // ページの中に収まる
        const col = Math.floor(pl.at.x / A4_PRINT_W);
        const row = Math.floor(pl.at.y / A4_PRINT_H);
        expect(pl.at.x + pl.w).toBeLessThanOrEqual((col + 1) * A4_PRINT_W + 1e-9);
        expect(pl.at.y + pl.h).toBeLessThanOrEqual((row + 1) * A4_PRINT_H + 1e-9);
        // パーツと重ならない
        for (const p of layout.placed) {
          const b = pieceBBox(p.piece, sa);
          const x0 = b.minX + p.offset.x;
          const y0 = b.minY + p.offset.y;
          const sep = pl.at.x >= x0 + (b.maxX - b.minX) || x0 >= pl.at.x + pl.w || pl.at.y >= y0 + (b.maxY - b.minY) || y0 >= pl.at.y + pl.h;
          expect(sep).toBe(true);
        }
      });
    }
  }
});
