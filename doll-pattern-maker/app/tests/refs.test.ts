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
  it('選択肢の表示名（単位・数えるもの・名前に同じ数値があるとき）', () => {
    expect(withRef('Aライン', 'flare', 48, '°')).toBe('Aライン（48°）');
    expect(withRef('自動（丈から）', 'buttons', 5.2, '個')).toBe('自動（丈から・5個）');
    expect(withRef('12 本', 'count', 12, '本')).toBe('12 本');
    expect(withRef('0.5cm', 'extWidth', 0.5)).toBe('0.5cm');
    expect(withRef('自動', 'extWidth', 0.93)).toBe('自動（0.9cm）');
  });
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
            // 型紙の大きさまで同じ。ただし身幅（胸のゆとりだけ変える）・セーラーの襟の大きさ（深さだけ変える。幅は普通）は、自分で入力が一部だけを変える仕様なので比べない
            if (g.key !== 'fit' && g.key !== 'collarSize') {
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
      skirt: ['length', 'flare'],
      pants: ['fit', 'length'],
      blouse: ['fit', 'length', 'puff'],
      'blouse-dress': ['fit', 'length'],
      jsk: ['length'],
      vest: ['length', 'buttons'],
      cardigan: ['fitBody', 'fitSleeve', 'length', 'buttons', 'sleeve'],
      trench: ['fitBody', 'fitSleeve', 'length', 'buttons'],
      yukata: ['sleeveLen'],
      shorts: ['rise'],
      beret: ['fit', 'head', 'puff'],
      // 第2段（2026-10-06）
      pleats: ['count'],
      tiered: ['tiers', 'gather'],
      camisole: ['strap'],
      jacket: ['roll', 'lapel'],
      sailor: ['vDepth', 'collarSize'],
      tights: ['snug'],
      ears: ['head', 'size'],
    };
    for (const [id, keys] of Object.entries(want)) {
      const item = ITEMS.find((i) => i.id === id)!;
      const refs = optionRefs(item, r, item.defaults, ctx);
      // ボタンの数は「自動」と「自分で入力」だけなので 1 つ。ほかは選択肢が 2 つ以上
      for (const k of keys) expect(Object.keys(refs[k] ?? {}).length, `${id}/${k}`).toBeGreaterThanOrEqual(k === 'buttons' ? 1 : 2);
    }
  });
});
