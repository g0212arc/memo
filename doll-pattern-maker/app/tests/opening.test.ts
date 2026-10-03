import { describe, it, expect } from 'vitest';
import { SAMPLE_BODIES } from '../src/samples';
import { resolveBody } from '../src/model/estimate';
import { ITEM_BY_ID } from '../src/pattern/items';
import { pathLength } from '../src/geometry/path';

// 後ろ開きのある設定
const cases: [string, Record<string, unknown>][] = [
  ['tshirt', { backOpening: true }],
  ['raglan', { backOpening: true }],
  ['turtleneck', { backOpening: true }],
  ['camisole', {}],
  ['china', {}],
  ['china', { length: 'top' }],
  ['sailor', { opening: 'back' }],
  ['yshirt', { opening: 'back' }],
  ['yshirt', { opening: 'back', yoke: false }],
  ['skirt', { waist: 'belt' }],
  ['skirt', { waist: 'belt', flare: 'half' }],
  ['pleats', { waist: 'belt' }],
  ['pleats', { waist: 'belt', pleat: 'inverted' }],
];

describe('背中開きの持ち出し', () => {
  for (const body of SAMPLE_BODIES) {
    for (const [id, params] of cases) {
      it(`${id} ${JSON.stringify(params)} / ${body.name}`, () => {
        const item = ITEM_BY_ID[id];
        const r = resolveBody(body);
        for (const ext of ['auto', '1', 'custom'] as const) {
          const p = { ...item.defaults, ...params, extWidth: ext, extWidthCustom: 0.7 };
          const res = item.draft(r, p);
          const backs = res.pieces.filter((pc) => pc.edges.some((e) => e.kind === 'opening' && e.name === '後ろ開き'));
          expect(backs.length).toBeGreaterThan(0);
          for (const pc of backs) {
            const op = pc.edges.find((e) => e.name === '後ろ開き')!;
            const x = op.segs[0].from.x;
            // 持ち出しの分だけ後ろ中心（x = 0）より外にあり、「持ち出し」と書いてある
            expect(x).toBeLessThan(-0.1);
            if (ext === '1') expect(x).toBeCloseTo(-1, 6);
            if (ext === 'custom') expect(x).toBeCloseTo(-0.7, 6);
            expect(pc.notes?.some((n) => n.text === '持ち出し')).toBe(true);
          }
          // スカート: ベルトの重なり ＝ 持ち出し × 2
          const band = res.pieces.find((pc) => pc.id === 'waistband');
          if (band && (id === 'skirt' || id === 'pleats')) {
            const bandLen = pathLength(band.edges[0].segs);
            const waist = Number(res.info.find((s) => s.startsWith('ウエスト '))?.match(/ウエスト ([\d.]+)cm/)?.[1] ?? NaN);
            const extW = -backs[0].edges.find((e) => e.name === '後ろ開き')!.segs[0].from.x;
            if (Number.isFinite(waist)) expect(bandLen - waist).toBeCloseTo(2 * extW, 0);
          }
        }
      });
    }
  }
});
