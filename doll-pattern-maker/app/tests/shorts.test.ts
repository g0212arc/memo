import { describe, it, expect } from 'vitest';
import { SAMPLE_BODIES } from '../src/samples';
import { resolveBody } from '../src/model/estimate';
import { draftShorts, DEFAULT_SHORTS, ShortsParams } from '../src/pattern/items/shorts';
import { pathLength } from '../src/geometry/path';
import { dist } from '../src/geometry/vec';
import { pieceCutLine } from '../src/render/geometry';

const sa = { seam: 0.5, hem: 0.8, opening: 0.8 };
const settings: [string, Partial<ShortsParams>][] = [
  ['ビキニ・普通・一続き', {}],
  ['ボーイレッグ・深め・別裁ち', { shape: 'boyleg', rise: 'high', crotch: 'separate' }],
  ['ハイレグ・浅め・三つ折り', { shape: 'highleg', rise: 'low', edge: 'hem' }],
  ['ビキニ・自分で入力・きつめ', { rise: 'custom', riseCustom: 3, snug: 'tight', crotch: 'separate' }],
];

describe('ショーツ（サンプル全ボディ × 設定）', () => {
  for (const body of SAMPLE_BODIES) {
    for (const [label, params] of settings) {
      it(`${body.name} / ${label}`, () => {
        const r = resolveBody(body);
        const p = { ...DEFAULT_SHORTS, ...params };
        const res = draftShorts(r, p);
        expect(res.pieces).toHaveLength(p.crotch === 'integrated' ? 1 : 3);
        for (const pc of res.pieces) {
          for (let i = 0; i < pc.edges.length; i++) {
            const a = pc.edges[i].segs.at(-1)!.to;
            const b = pc.edges[(i + 1) % pc.edges.length].segs[0].from;
            expect(dist(a, b)).toBeLessThan(1e-9);
          }
          for (const pt of pieceCutLine(pc, sa)) expect(Number.isFinite(pt.x) && Number.isFinite(pt.y)).toBe(true);
        }
        // 前と後ろの脇の長さがそろっている（縫い合わせる辺）
        const all = res.pieces.flatMap((pc) => pc.edges);
        const sf = pathLength(all.find((e) => e.name === '脇（前）')!.segs);
        const sb = pathLength(all.find((e) => e.name === '脇（後ろ）')!.segs);
        expect(Math.abs(sf - sb)).toBeLessThan(Math.max(sf, sb) * 0.1);
        // 別に裁つとき、クロッチの付け寸法が前後とそろう
        if (p.crotch === 'separate') {
          const g = res.pieces.find((pc) => pc.id === 'gusset')!;
          const front = res.pieces.find((pc) => pc.id === 'shorts-front')!;
          expect(pathLength(g.edges[0].segs)).toBeCloseTo(pathLength(front.edges.find((e) => e.name === 'クロッチ付け')!.segs), 6);
        }
      });
    }
  }
});

describe('ショーツの股上', () => {
  it('浅め < 普通 < 深め（全体の縦の長さ）', () => {
    const r = resolveBody(SAMPLE_BODIES.find((b) => b.name === 'MDD')!);
    const h = (['low', 'normal', 'high'] as const).map((rise) => {
      const pc = draftShorts(r, { ...DEFAULT_SHORTS, rise }).pieces[0];
      return Math.max(...pc.edges.flatMap((e) => e.segs.map((s) => s.to.y)));
    });
    expect(h[0]).toBeLessThan(h[1]);
    expect(h[1]).toBeLessThan(h[2]);
  });
});
