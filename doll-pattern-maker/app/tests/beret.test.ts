import { describe, it, expect } from 'vitest';
import { SAMPLE_BODIES } from '../src/samples';
import { resolveBody } from '../src/model/estimate';
import { draftBeret, DEFAULT_BERET, BeretParams } from '../src/pattern/items/beret';
import { pathLength } from '../src/geometry/path';
import { dist } from '../src/geometry/vec';
import { pieceCutLine } from '../src/render/geometry';

const sa = { seam: 0.5, hem: 0.8, opening: 0.8 };
const r = resolveBody(SAMPLE_BODIES[0]);
const settings: [string, Partial<BeretParams>][] = [
  ['初期設定', {}],
  ['9〜10・大きめ・はぎ合わせ 8・ゴム', { head: '9-10', puff: 'large', top: 'panels', panels: '8', edge: 'elastic' }],
  ['6〜7・小さめ・きつめ・ヘタなし', { head: '6-7', puff: 'small', fit: 'tight', stem: false }],
  ['自分で入力', { head: 'custom', headCustom: 15, fit: 'custom', fitCustom: -0.5, puff: 'custom', puffCustom: 9, top: 'panels', panels: 'custom', panelsCustom: 5 }],
];

describe('ベレー帽', () => {
  for (const [label, params] of settings) {
    it(label, () => {
      const p = { ...DEFAULT_BERET, ...params };
      const res = draftBeret(r, p);
      for (const pc of res.pieces) {
        for (let i = 0; i < pc.edges.length; i++) {
          const a = pc.edges[i].segs.at(-1)!.to;
          const b = pc.edges[(i + 1) % pc.edges.length].segs[0].from;
          expect(dist(a, b)).toBeLessThan(1e-9);
        }
        for (const pt of pieceCutLine(pc, sa)) expect(Number.isFinite(pt.x) && Number.isFinite(pt.y)).toBe(true);
      }
      // トップの縁の合計 ＝ 下側の外まわり × 2
      const top = res.pieces.find((pc) => pc.id === 'beret-top')!;
      const n = Number(top.cut.match(/(\d+)枚/)![1]);
      const topLen = pathLength(top.edges.find((e) => e.name === '縁')!.segs) * n;
      const under = res.pieces.find((pc) => pc.id === 'beret-under')!;
      expect(pathLength(under.edges[0].segs) * 2).toBeCloseTo(topLen, 1); // 円弧の近似の誤差があるので 0.05cm まで
      // ベルト ＝ 頭の口（下側の内まわり × 2）
      const band = res.pieces.find((pc) => pc.id === 'beret-band');
      const inner = pathLength(under.edges[2].segs) * 2;
      if (band) expect(pathLength(band.edges[0].segs)).toBeCloseTo(inner, 2);
      else expect(inner).toBeGreaterThan(Number(res.info[0].match(/頭の口 ([\d.]+)cm/)![1]));
      expect(res.pieces.some((pc) => pc.id === 'beret-stem')).toBe(p.stem);
    });
  }
  it('頭囲が大きいほど頭の口が大きい（ボディに関係なく同じ）', () => {
    const o = (['6-7', '7-8', '8-9', '9-10'] as const).map((head) => Number(draftBeret(r, { ...DEFAULT_BERET, head }).info[0].match(/頭の口 ([\d.]+)cm/)![1]));
    for (let i = 1; i < o.length; i++) expect(o[i]).toBeGreaterThan(o[i - 1]);
    expect(draftBeret(resolveBody(SAMPLE_BODIES[3]), DEFAULT_BERET).info).toEqual(draftBeret(r, DEFAULT_BERET).info);
  });
});
