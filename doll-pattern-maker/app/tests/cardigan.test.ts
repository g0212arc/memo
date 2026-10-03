import { describe, it, expect } from 'vitest';
import { SAMPLE_BODIES } from '../src/samples';
import { resolveBody } from '../src/model/estimate';
import { draftCardigan, DEFAULT_CARDIGAN, CardiganParams } from '../src/pattern/items/cardigan';
import { pathLength } from '../src/geometry/path';
import { dist } from '../src/geometry/vec';
import { pieceCutLine } from '../src/render/geometry';

const sa = { seam: 0.5, hem: 0.8, opening: 0.8 };
const settings: [string, Partial<CardiganParams>][] = [
  ['初期設定（V・リブ前立て・ボタン）', {}],
  ['クルー・見返し・スナップ・ポケット', { neck: 'crew', band: 'facing', closure: 'snap', pocket: true }],
  ['V・見返し・三つ折り・半袖・短め', { band: 'facing', edge: 'hem', sleeve: 'short', length: 'short' }],
  ['クルー・リブ・なし・長め・七分・布帛', { neck: 'crew', closure: 'none', length: 'long', sleeve: 'three', fabric: 'woven' }],
  ['自分で入力', { length: 'custom', lengthCustom: 2, sleeve: 'custom', sleeveCustom: 5, buttons: 'custom', buttonsCustom: 4 }],
];

describe('カーディガン（サンプル全ボディ × 設定）', () => {
  for (const body of SAMPLE_BODIES) {
    for (const [label, params] of settings) {
      it(`${body.name} / ${label}`, () => {
        const r = resolveBody(body);
        const p = { ...DEFAULT_CARDIGAN, ...params };
        const res = draftCardigan(r, p);
        for (const pc of res.pieces) {
          for (let i = 0; i < pc.edges.length; i++) {
            const a = pc.edges[i].segs.at(-1)!.to;
            const b = pc.edges[(i + 1) % pc.edges.length].segs[0].from;
            expect(dist(a, b)).toBeLessThan(1e-6);
          }
          for (const pt of pieceCutLine(pc, sa)) expect(Number.isFinite(pt.x) && Number.isFinite(pt.y)).toBe(true);
        }
        const front = res.pieces.find((pc) => pc.id === 'front')!;
        // 前は前開き（わではない）
        expect(front.edges.some((e) => e.kind === 'fold')).toBe(false);
        expect(front.cut.startsWith('2枚')).toBe(true);
        expect(res.pieces.some((pc) => pc.id === (p.band === 'rib' ? 'front-band' : 'front-facing'))).toBe(true);
        expect(res.pieces.some((pc) => pc.id === 'hem-rib')).toBe(p.edge === 'rib');
        expect(res.pieces.some((pc) => pc.id === 'pocket')).toBe(p.pocket);
        // 前立てリブ: 長さ ≥ 前端 × 2
        if (p.band === 'rib') {
          const band = res.pieces.find((pc) => pc.id === 'front-band')!;
          const fEdge = pathLength(front.edges.find((e) => e.name === '前端（前立て付け）')!.segs);
          expect(pathLength(band.edges[0].segs)).toBeGreaterThan(2 * fEdge);
        }
      });
    }
  }
});
