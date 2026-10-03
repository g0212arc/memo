import { describe, it, expect } from 'vitest';
import { SAMPLE_BODIES } from '../src/samples';
import { resolveBody } from '../src/model/estimate';
import { draftTiered, DEFAULT_TIERED, TieredParams, tierCount } from '../src/pattern/items/tiered';
import { skirtBase } from '../src/pattern/items/skirt';
import { pathLength } from '../src/geometry/path';
import { dist } from '../src/geometry/vec';
import { pieceCutLine } from '../src/render/geometry';

const sa = { seam: 0.5, hem: 0.8, opening: 0.8 };
const settings: [string, Partial<TieredParams>][] = [
  ['3 段・ヨーク・ゴム・膝丈', {}],
  ['2 段・ギャザー・ゴム・ミニ', { tiers: '2', top: 'gather', length: 'mini' }],
  ['4 段・下ほど高く・たっぷり・足首', { tiers: '4', heights: 'graded', gather: 'full', length: 'ankle' }],
  ['3 段・ヨーク・ベルト', { waist: 'belt' }],
  ['3 段・ギャザー・ベルト・レース', { top: 'gather', waist: 'belt', hem: 'lace' }],
  ['6 段（自分で入力）・2.5 倍', { tiers: 'custom', tiersCustom: 6, gather: 'custom', gatherCustom: 2.5, length: 'ankle' }],
  ['ベルト・ヨーク・ミニ', { waist: 'belt', length: 'mini' }],
];
const len = (pc: { edges: { name: string; segs: Parameters<typeof pathLength>[0] }[] }, name: string) => pathLength(pc.edges.find((e) => e.name === name)!.segs);

describe('ティアードスカート（サンプル全ボディ × 設定）', () => {
  for (const body of SAMPLE_BODIES) {
    for (const [label, params] of settings) {
      it(`${body.name} / ${label}`, () => {
        const r = resolveBody(body);
        const p = { ...DEFAULT_TIERED, ...params };
        const res = draftTiered(r, p);
        const n = tierCount(p);
        const b = skirtBase(r, p.length, p.lengthCustom);
        const belt = p.waist === 'belt';
        expect(res.pieces).toHaveLength(2 * n + (belt ? 1 : 0));
        for (const pc of res.pieces) {
          for (let i = 0; i < pc.edges.length; i++) {
            const a = pc.edges[i].segs.at(-1)!.to;
            const c = pc.edges[(i + 1) % pc.edges.length].segs[0].from;
            expect(dist(a, c)).toBeLessThan(1e-9);
          }
          for (const pt of pieceCutLine(pc, sa)) expect(Number.isFinite(pt.x) && Number.isFinite(pt.y)).toBe(true);
        }
        // 段の高さの合計 ＝ 丈 − ベルト
        const heights = Array.from({ length: n }, (_, k) => len(res.pieces.find((pc) => pc.id === `tier${k + 1}-front`)!, '脇'));
        const bandH = belt ? res.pieces.find((pc) => pc.id === 'waistband')!.edges[1].segs[0].to.y / 2 : 0;
        // ヨークの脇はカーブなので、高さは y で測る
        const H = Array.from({ length: n }, (_, k) => {
          const pc = res.pieces.find((q) => q.id === `tier${k + 1}-front`)!;
          return Math.max(...pc.edges.flatMap((e) => e.segs.map((s) => s.to.y)));
        });
        expect(H.reduce((a, x) => a + x, 0)).toBeCloseTo(b.length - bandH, 6);
        expect(heights.every((x) => x > 0)).toBe(true);
        // 周り: 前後の下の辺 ×（わなら 2・枚数）。どの段もヒップ以上、下の段ほど長い
        const around = (k: number) =>
          res.pieces
            .filter((pc) => pc.id.startsWith(`tier${k + 1}-`))
            .reduce((a, pc) => {
              const e = pc.edges.find((x) => x.name === '段の下' || x.name.startsWith('裾'))!;
              const m = Number(pc.cut.match(/^(\d+)/)![1]);
              return a + pathLength(e.segs) * (pc.cut.includes('（わ）') ? 2 : m);
            }, 0);
        for (let k = 0; k < n; k++) {
          if (!(k === 0 && p.top === 'yoke' && belt)) expect(around(k)).toBeGreaterThanOrEqual(b.hipF - 1e-6);
          if (k > 0) expect(around(k)).toBeGreaterThan(around(k - 1) - 1e-6);
        }
        // 裾の始末
        const hem = res.pieces.find((pc) => pc.id === `tier${n}-front`)!.edges.find((e) => e.name.startsWith('裾'))!;
        expect(hem.kind).toBe(p.hem === 'lace' ? 'seam' : 'hem');
        // ベルト付きは 1 段目の後ろだけ開く
        if (belt) {
          expect(res.pieces.find((pc) => pc.id === 'tier1-back')!.edges.some((e) => e.kind === 'opening')).toBe(true);
          expect(res.pieces.filter((pc) => pc.id !== 'tier1-back').every((pc) => pc.edges.every((e) => e.kind !== 'opening'))).toBe(true);
        }
      });
    }
  }
});
