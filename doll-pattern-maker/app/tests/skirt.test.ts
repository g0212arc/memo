import { describe, it, expect } from 'vitest';
import { SAMPLE_BODIES } from '../src/samples';
import { resolveBody } from '../src/model/estimate';
import { draftSkirt, DEFAULT_SKIRT, SkirtParams } from '../src/pattern/items/skirt';
import { pathLength } from '../src/geometry/path';
import { dist } from '../src/geometry/vec';
import { pieceCutLine } from '../src/render/geometry';

const sa = { seam: 0.5, hem: 0.8, opening: 0.8 };
const settings: [string, Partial<SkirtParams>][] = [
  ['Aライン・膝丈・ゴム', {}],
  ['タイト・ミニ・ベルト・スリット', { flare: 'tight', length: 'mini', waist: 'belt', slit: true }],
  ['セミタイト・ミモレ・ゴム・スリット', { flare: 'semi', length: 'midi', slit: true }],
  ['半円・足首・ベルト', { flare: 'half', length: 'ankle', waist: 'belt' }],
  ['全円・膝丈・ゴム', { flare: 'full' }],
  ['自分で入力 120°・ベルト', { flare: 'custom', flareCustom: 120, waist: 'belt', length: 'custom', lengthCustom: 8 }],
];

describe('スカート（サンプル全ボディ × 設定）', () => {
  for (const body of SAMPLE_BODIES) {
    for (const [label, params] of settings) {
      it(`${body.name} / ${label}`, () => {
        const r = resolveBody(body);
        const p = { ...DEFAULT_SKIRT, ...params };
        const res = draftSkirt(r, p);
        expect(res.pieces).toHaveLength(p.waist === 'belt' ? 3 : 2);
        for (const pc of res.pieces) {
          for (let i = 0; i < pc.edges.length; i++) {
            const a = pc.edges[i].segs.at(-1)!.to;
            const b = pc.edges[(i + 1) % pc.edges.length].segs[0].from;
            expect(dist(a, b)).toBeLessThan(1e-9);
          }
          for (const pt of pieceCutLine(pc, sa)) expect(Number.isFinite(pt.x) && Number.isFinite(pt.y)).toBe(true);
        }
        const [f, bk] = res.pieces;
        // 前後の脇の長さがそろう
        const side = (pc: typeof f) => pathLength(pc.edges.find((e) => e.name === '脇')!.segs);
        expect(side(f)).toBeCloseTo(side(bk), 6);
        // ウエスト（ダーツを除く）: ゴムはヒップが通る周り、ベルト付きはウエスト以上
        const waist = 2 * [f, bk].reduce((a, pc) => a + pc.edges.filter((e) => e.name === 'ウエスト').reduce((s, e) => s + pathLength(e.segs), 0), 0);
        const hip = r.values.hip_circ!;
        if (p.waist === 'elastic') expect(waist).toBeGreaterThan(hip);
        else expect(waist).toBeGreaterThanOrEqual(r.values.waist_circ! - 1e-6);
        // スリットは後ろだけ、タイトに近い形だけ
        const hasSlit = bk.edges.some((e) => e.name === 'スリット');
        if (p.flare === 'half' || p.flare === 'full' || p.flare === 'aline') expect(hasSlit).toBe(false);
      });
    }
  }
});

describe('スカートの丈と広がり', () => {
  const r = resolveBody(SAMPLE_BODIES.find((b) => b.name === 'MDD')!);
  it('ミニ < 膝丈 < ミモレ < 足首', () => {
    const l = (['mini', 'knee', 'midi', 'ankle'] as const).map((length) => Number(draftSkirt(r, { ...DEFAULT_SKIRT, length }).info[0].match(/ウエストから ([\d.]+)cm/)![1]));
    for (let i = 1; i < l.length; i++) expect(l[i]).toBeGreaterThan(l[i - 1]);
  });
  it('広がるほど裾周りが長い', () => {
    const h = (['tight', 'semi', 'aline', 'half', 'full'] as const).map((flare) => Number(draftSkirt(r, { ...DEFAULT_SKIRT, flare }).info[1].match(/裾周り ([\d.]+)cm/)![1]));
    for (let i = 1; i < h.length; i++) expect(h[i]).toBeGreaterThan(h[i - 1]);
  });
});
