import { describe, it, expect } from 'vitest';
import { SAMPLE_BODIES } from '../src/samples';
import { resolveBody } from '../src/model/estimate';
import { draftEars, DEFAULT_EARS, EarShape } from '../src/pattern/items/ears';
import { pathLength } from '../src/geometry/path';
import { dist } from '../src/geometry/vec';
import { pieceCutLine } from '../src/render/geometry';

const sa = { seam: 0.5, hem: 0.8, opening: 0.8 };
const shapes: EarShape[] = ['cat', 'fox', 'dog', 'dogDrop', 'rabbit', 'bear'];

describe('ケモミミ（サンプル全ボディ × 形 × 付け方）', () => {
  for (const body of SAMPLE_BODIES) {
    for (const shape of shapes) {
      for (const attach of ['headband', 'magnet'] as const) {
        for (const inner of ['small', 'same'] as const) {
          it(`${body.name} / ${shape} / ${attach} / ${inner}`, () => {
            const r = resolveBody(body);
            const res = draftEars(r, { ...DEFAULT_EARS, shape, attach, inner, magnet: '0.5' });
            expect(res.pieces.length).toBe(2 + (inner === 'small' ? 1 : 0) + (attach === 'magnet' ? 1 : 0));
            for (const pc of res.pieces) {
              for (let i = 0; i < pc.edges.length; i++) {
                const a = pc.edges[i].segs.at(-1)!.to;
                const b = pc.edges[(i + 1) % pc.edges.length].segs[0].from;
                expect(dist(a, b)).toBeLessThan(1e-9);
              }
              for (const pt of pieceCutLine(pc, sa)) expect(Number.isFinite(pt.x) && Number.isFinite(pt.y)).toBe(true);
            }
            if (attach === 'magnet') {
              // 底布の周り ＝ 根元の周り（表と裏、タックを引いた分）
              const front = res.pieces.find((pc) => pc.id === 'ear-front')!;
              const baseLen = pathLength(front.edges[0].segs);
              const tack = front.marks![0];
              const tw = tack[2].x - tack[0].x;
              const ring = pathLength(res.pieces.find((pc) => pc.id === 'ear-base')!.edges[0].segs);
              expect(ring).toBeCloseTo(2 * (baseLen - tw), 1);
            }
          });
        }
      }
    }
  }
});

describe('ケモミミの大きさ', () => {
  const r = resolveBody(SAMPLE_BODIES.find((b) => b.name === 'MDD')!);
  it('小さめ < 普通 < 大きめ', () => {
    const h = (['small', 'normal', 'large'] as const).map((size) => Number(draftEars(r, { ...DEFAULT_EARS, size }).info[0].match(/耳の高さ ([\d.]+)cm/)![1]));
    expect(h[0]).toBeLessThan(h[1]);
    expect(h[1]).toBeLessThan(h[2]);
  });
  it('頭囲 6〜7 < 7〜8 < 9〜10 インチ（ボディに関係なく同じ）', () => {
    const h = (['6-7', '7-8', '9-10'] as const).map((head) => Number(draftEars(r, { ...DEFAULT_EARS, head }).info[0].match(/耳の高さ ([\d.]+)cm/)![1]));
    expect(h[0]).toBeLessThan(h[1]);
    expect(h[1]).toBeLessThan(h[2]);
    const other = resolveBody(SAMPLE_BODIES.find((b) => b.name !== 'MDD')!);
    expect(draftEars(other, DEFAULT_EARS).info[0]).toBe(draftEars(r, DEFAULT_EARS).info[0]);
  });
  it('磁石が大きすぎると警告', () => {
    const res = draftEars(r, { ...DEFAULT_EARS, attach: 'magnet', magnet: 'custom', magnetCustom: 5 });
    expect(res.warnings.some((w) => w.includes('磁石が入りません'))).toBe(true);
  });
});
