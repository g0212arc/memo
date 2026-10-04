import { describe, it, expect } from 'vitest';
import { SAMPLE_BODIES } from '../src/samples';
import { resolveBody } from '../src/model/estimate';
import { DEFAULT_VEST, draftVest, VestParams } from '../src/pattern/items/vest';
import { pathLength } from '../src/geometry/path';
import { dist } from '../src/geometry/vec';
import { pieceCutLine } from '../src/render/geometry';

const sa = { seam: 0.5, hem: 0.8, opening: 0.8 };
const sets: [string, Partial<VestParams>][] = [
  ['最初（シングル・V・ウエスト丈・とがる）', {}],
  ['ダブル・丸・腰丈・まっすぐ', { front: 'double', neck: 'round', length: 'hip', hem: 'straight' }],
  ['背中裏地・ベルト・ポケット・ボタン 5', { backFabric: 'lining', backBelt: true, pocket: true, buttons: 'custom', buttonsCustom: 5 }],
  ['ダブル・V・丈 自分で入力', { front: 'double', length: 'custom', lengthCustom: 3 }],
];

describe('ベスト（サンプル全ボディ × 設定）', () => {
  for (const body of SAMPLE_BODIES) {
    for (const [label, q] of sets) {
      it(`${body.name} / ${label}`, () => {
        const r = resolveBody(body);
        const p = { ...DEFAULT_VEST, ...q };
        const res = draftVest(r, p);
        for (const pc of res.pieces) {
          for (let i = 0; i < pc.edges.length; i++) {
            const a = pc.edges[i].segs.at(-1)!.to;
            const b = pc.edges[(i + 1) % pc.edges.length].segs[0].from;
            expect(dist(a, b), `${pc.name} ${pc.edges[i].name}`).toBeLessThan(1e-6);
          }
          for (const pt of pieceCutLine(pc, sa)) expect(Number.isFinite(pt.x) && Number.isFinite(pt.y)).toBe(true);
        }
        const front = res.pieces.find((pc) => pc.id === 'front')!;
        const back = res.pieces.find((pc) => pc.id === 'back')!;
        expect(Math.abs(pathLength(front.edges.find((e) => e.name === '肩')!.segs) - pathLength(back.edges.find((e) => e.name === '肩')!.segs))).toBeLessThan(0.05);
        // 前端は前中心の外。とがる裾は前端が脇より下
        const fe = front.edges.find((e) => e.name === '前端')!.segs[0];
        expect(fe.from.x).toBeLessThan(0);
        const sideEnd = front.edges.find((e) => e.name === '脇')!.segs.at(-1)!.to;
        if (p.hem === 'point') expect(fe.from.y).toBeGreaterThan(sideEnd.y);
        // ボタンの印（十字 2 本で 1 個）
        const crosses = (front.marks ?? []).filter((m) => m.length === 2).length / 2;
        const expected = p.buttons === 'custom' ? p.buttonsCustom! * (p.front === 'double' ? 2 : 1) : null;
        if (expected !== null) expect(crosses).toBeGreaterThanOrEqual(expected);
        expect(res.pieces.some((pc) => pc.id === 'back-belt')).toBe(p.backBelt);
        expect(res.pieces.some((pc) => pc.id === 'welt')).toBe(p.pocket);
      });
    }
  }
});
