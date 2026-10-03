import { describe, it, expect } from 'vitest';
import { SAMPLE_BODIES } from '../src/samples';
import { resolveBody } from '../src/model/estimate';
import { draftTrench, DEFAULT_TRENCH, TrenchParams } from '../src/pattern/items/trench';
import { dist } from '../src/geometry/vec';
import { pieceCutLine } from '../src/render/geometry';

const sa = { seam: 0.5, hem: 0.8, opening: 0.8 };
const settings: [string, Partial<TrenchParams>][] = [
  ['初期設定', {}],
  ['普通の袖・シングル・折り襟・ロング・裏地', { sleeveType: 'set', front: 'single', collar: 'collar', length: 'long', lining: true }],
  ['ハーフ・全部のディテール', { length: 'half', gunFlap: true, cape: true, lining: true }],
  ['ディテールなし・自分で入力', { epaulette: false, belt: false, sleeveStrap: false, pocket: false, length: 'custom', lengthCustom: 3, buttons: 'custom', buttonsCustom: 2 }],
];

describe('トレンチ（サンプル全ボディ × 設定）', () => {
  for (const body of SAMPLE_BODIES) {
    for (const [label, params] of settings) {
      it(`${body.name} / ${label}`, () => {
        const r = resolveBody(body);
        const p = { ...DEFAULT_TRENCH, ...params };
        const res = draftTrench(r, p);
        for (const pc of res.pieces) {
          for (let i = 0; i < pc.edges.length; i++) {
            const a = pc.edges[i].segs.at(-1)!.to;
            const b = pc.edges[(i + 1) % pc.edges.length].segs[0].from;
            expect(dist(a, b)).toBeLessThan(1e-6);
          }
          for (const pt of pieceCutLine(pc, sa)) expect(Number.isFinite(pt.x) && Number.isFinite(pt.y)).toBe(true);
        }
        const ids = res.pieces.map((pc) => pc.id);
        expect(ids).toContain('front-facing');
        expect(ids.includes('throat-tab')).toBe(p.collar === 'stand');
        expect(ids.includes('collar')).toBe(p.collar === 'collar');
        expect(ids.includes('epaulette')).toBe(p.epaulette);
        expect(ids.includes('belt')).toBe(p.belt);
        expect(ids.includes('sleeve-strap')).toBe(p.sleeveStrap);
        expect(ids.includes('pocket-flap')).toBe(p.pocket);
        expect(ids.includes('gun-flap')).toBe(p.gunFlap);
        expect(ids.includes('back-cape')).toBe(p.cape);
        expect(ids.includes('front-lining')).toBe(p.lining);
        const front = res.pieces.find((pc) => pc.id === 'front')!;
        expect(front.edges.some((e) => e.kind === 'fold')).toBe(false);
      });
    }
  }
});
