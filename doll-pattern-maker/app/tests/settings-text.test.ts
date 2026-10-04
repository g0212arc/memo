import { describe, it, expect } from 'vitest';
import { SAMPLE_BODIES } from '../src/samples';
import { resolveBody } from '../src/model/estimate';
import { ITEMS, ITEM_BY_ID } from '../src/pattern/items';
import { settingsEntries, wrapEntries } from '../src/pattern/settings-text';
import { bustLarge, bustRatio } from '../src/pattern/bust';
import { layoutPieces } from '../src/render/layout';
import { pieceCutLine } from '../src/render/geometry';
import { bbox } from '../src/geometry/path';
import { add } from '../src/geometry/vec';
import { subtitleHeight } from '../src/render/draw';

const sa = { seam: 0.5, hem: 0.8, opening: 0.8 };
const ctxOf = (name: string) => {
  const r = resolveBody(SAMPLE_BODIES.find((b) => b.name.startsWith(name))!);
  return { r, ctx: { category: r.category, bustLarge: bustLarge(r.values), bustRatio: bustRatio(r.values) } };
};

describe('設定の行', () => {
  it('Tシャツ: 布・背中開き・縫い代', () => {
    const { ctx } = ctxOf('MDD');
    const item = ITEM_BY_ID.tshirt;
    const e = settingsEntries(item.fields, item.defaults, ctx, sa);
    expect(e[0]).toBe('布：ニット（伸びる布）');
    expect(e).toContain('伸び率：20%');
    expect(e).toContain('背中開き');
    expect(e.at(-1)).toBe('縫い代：0.5cm・裾 0.8cm・開き 0.8cm');
  });
  it('自分で入力の数値は前の項目に付く・出ていない項目は書かない', () => {
    const { ctx } = ctxOf('MDD');
    const item = ITEM_BY_ID.skirt;
    const e = settingsEntries(item.fields, { ...item.defaults, length: 'custom', lengthCustom: 12 }, ctx, sa);
    expect(e).toContain('丈：自分で入力（12cm）');
    expect(e.some((x) => x.startsWith('持ち出し'))).toBe(false); // ゴムのときは出ない
  });
  it('開きの自動は、実際の開きも書く', () => {
    const item = ITEM_BY_ID.yshirt;
    expect(settingsEntries(item.fields, item.defaults, ctxOf('MDD').ctx, sa).find((x) => x.startsWith('開き'))).toBe('開き：自動→前開き');
    expect(settingsEntries(item.fields, item.defaults, ctxOf('苹苹').ctx, sa).find((x) => x.startsWith('開き'))).toBe('開き：自動→背中開き');
  });
  it('折り返し: 幅を超えない・項目の途中で切らない', () => {
    const lines = wrapEntries(['あいうえお', 'かきくけこ', 'さしすせそ'], 13);
    expect(lines).toEqual(['あいうえお ／ かきくけこ', 'さしすせそ']);
  });
  it('全アイテム: 設定の行の下から型紙を並べる', () => {
    const { r, ctx } = ctxOf('MDD');
    for (const item of ITEMS) {
      const lines = wrapEntries(settingsEntries(item.fields, item.defaults, ctx, sa), 75);
      expect(lines.length).toBeGreaterThan(0);
      const L = layoutPieces(item.draft(r, item.defaults).pieces, sa, subtitleHeight(lines.length));
      for (const pl of L.placed) {
        const b = bbox(pieceCutLine(pl.piece, sa).map((q) => add(q, pl.offset)));
        expect(Math.min(b.minY, pl.labelAt.y)).toBeGreaterThanOrEqual(L.headerH - 1e-6);
      }
    }
  });
});
