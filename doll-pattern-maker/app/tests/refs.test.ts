import { describe, it, expect } from 'vitest';
import { SAMPLE_BODIES } from '../src/samples';
import { resolveBody } from '../src/model/estimate';
import { ITEMS } from '../src/pattern/items';
import { optionRefs, refFieldOf, withRef } from '../src/pattern/refs';
import { bustLarge, bustRatio } from '../src/pattern/bust';
import { pieceCutLine } from '../src/render/geometry';
import { bbox } from '../src/geometry/path';
import { DraftResult } from '../src/pattern/types';

const sa = { seam: 0.5, hem: 0.8, opening: 0.8 };
const size = (res: DraftResult) =>
  res.pieces.map((pc) => {
    const b = bbox(pieceCutLine(pc, sa));
    return `${pc.id}:${(b.maxX - b.minX).toFixed(2)}x${(b.maxY - b.minY).toFixed(2)}`;
  });

describe('設定の参考値', () => {
  it('選択肢の表示名', () => {
    expect(withRef('普通', 'fit', 2.66)).toBe('普通（ゆとり 2.7cm）');
    expect(withRef('膝丈', 'length', 17.94)).toBe('膝丈（17.9cm）');
    expect(withRef('短め（腰の上）', 'length', 3.1)).toBe('短め（腰の上・3.1cm）');
    expect(withRef('普通', 'length', undefined)).toBe('普通');
  });
  for (const name of ['MDD', '琉璃体', '苹苹体', '松柏体']) {
    const r = resolveBody(SAMPLE_BODIES.find((b) => b.name.startsWith(name))!);
    const ctx = { category: r.category, bustLarge: bustLarge(r.values), bustRatio: bustRatio(r.values) };
    for (const item of ITEMS) {
      it(`${name} / ${item.label}: 選択肢の数値 ＝ 自分で入力にその数値を入れたときと同じ型紙`, () => {
        const refs = optionRefs(item, r, item.defaults, ctx);
        for (const f of item.fields) {
          const g = refFieldOf(item.fields, f, { ...item.defaults }, ctx);
          if (!g || !refs[g.key] || f.kind !== 'number' || f.key === 'hemBelowWaist') continue;
          for (const [opt, x] of Object.entries(refs[g.key])) {
            const custom = item.draft(r, { ...item.defaults, [g.key]: 'custom', [f.key]: x });
            // 自分で入力に入れた数値が、そのまま同じ意味で使われる
            expect(custom.refs?.[g.key], `${g.key}=${opt}`).toBeCloseTo(x, 6);
            // 丈は型紙の大きさまで同じ（身幅の自分で入力は胸のゆとりだけを変える仕様なので比べない）
            if (g.key !== 'fit') {
              const preset = item.draft(r, { ...item.defaults, [g.key]: opt });
              expect(size(custom), `${g.key}=${opt}（${x}）`).toEqual(size(preset));
            }
          }
        }
      });
    }
  }
  it('身幅・丈の項目がある主なアイテムには参考値が出る', () => {
    const r = resolveBody(SAMPLE_BODIES.find((b) => b.name === 'MDD')!);
    const ctx = { category: r.category, bustLarge: bustLarge(r.values), bustRatio: bustRatio(r.values) };
    const want: Record<string, string[]> = {
      tshirt: ['fitBody', 'fitSleeve', 'length'],
      yshirt: ['fit', 'length'],
      skirt: ['length'],
      pants: ['fit', 'length'],
      blouse: ['fit', 'length'],
      'blouse-dress': ['fit', 'length'],
      jsk: ['length'],
      vest: ['length'],
      cardigan: ['fitBody', 'fitSleeve', 'length'],
      trench: ['fitBody', 'fitSleeve', 'length'],
      yukata: ['sleeveLen'],
      shorts: ['rise'],
      beret: ['fit'],
    };
    for (const [id, keys] of Object.entries(want)) {
      const item = ITEMS.find((i) => i.id === id)!;
      const refs = optionRefs(item, r, item.defaults, ctx);
      for (const k of keys) expect(Object.keys(refs[k] ?? {}).length, `${id}/${k}`).toBeGreaterThan(1);
    }
  });
});
