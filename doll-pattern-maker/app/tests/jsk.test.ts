import { describe, it, expect } from 'vitest';
import { SAMPLE_BODIES } from '../src/samples';
import { resolveBody } from '../src/model/estimate';
import { DEFAULT_JSK, draftJsk, JskParams } from '../src/pattern/items/jsk';
import { pathLength } from '../src/geometry/path';
import { dist } from '../src/geometry/vec';
import { pieceCutLine } from '../src/render/geometry';

const sa = { seam: 0.5, hem: 0.8, opening: 0.8 };
const sets: [string, Partial<JskParams>][] = [
  ['最初（丸・ウエスト・ギャザー・裏地）', {}],
  ['肩ひも型・スクエア・ハイウエスト・プリーツ', { bodice: 'strap', neck: 'square', waistLine: 'high', skirt: 'pleats' }],
  ['V・箱ひだ・前開き・裏地なし', { neck: 'v', skirt: 'pleats', pleat: 'box', opening: 'front', lining: false }],
  ['フレア・背中開き・リボン・足首', { skirt: 'flare', opening: 'back', sash: true, length: 'ankle' }],
  ['ティアード・前開き・ミニ', { skirt: 'tiered', opening: 'front', length: 'mini' }],
  ['肩ひも型・ハイウエスト・ティアード・背中開き', { bodice: 'strap', waistLine: 'high', skirt: 'tiered', opening: 'back' }],
];

describe('ジャンパースカート（サンプル全ボディ × 設定）', () => {
  for (const body of SAMPLE_BODIES) {
    for (const [label, q] of sets) {
      it(`${body.name} / ${label}`, () => {
        const r = resolveBody(body);
        const p = { ...DEFAULT_JSK, ...q };
        const res = draftJsk(r, p);
        for (const pc of res.pieces) {
          for (let i = 0; i < pc.edges.length; i++) {
            const a = pc.edges[i].segs.at(-1)!.to;
            const b = pc.edges[(i + 1) % pc.edges.length].segs[0].from;
            expect(dist(a, b), `${pc.name} ${pc.edges[i].name}`).toBeLessThan(1e-6);
          }
          for (const pt of pieceCutLine(pc, sa)) expect(Number.isFinite(pt.x) && Number.isFinite(pt.y)).toBe(true);
        }
        const ids = res.pieces.map((pc) => pc.id);
        expect(ids.includes('binding')).toBe(!p.lining);
        expect(ids.includes('sash')).toBe(p.sash);
        expect(ids).toContain('skirt-front');
        const front = res.pieces.find((pc) => pc.id === 'front')!;
        const back = res.pieces.find((pc) => pc.id === 'back')!;
        // 肩は前後同じ長さ・袖はない
        expect(Math.abs(pathLength(front.edges.find((e) => e.name === '肩')!.segs) - pathLength(back.edges.find((e) => e.name === '肩')!.segs))).toBeLessThan(0.05);
        expect(ids).not.toContain('sleeve');
        // 開きはスカートにも続く
        const frontOpen = front.edges.some((e) => e.kind === 'opening');
        const sk = res.pieces.find((pc) => pc.id === (frontOpen ? 'skirt-front' : 'skirt-back'))!;
        expect(sk.edges.some((e) => e.kind === 'opening')).toBe(true);
        if (p.lining) expect(front.cut).toContain('表と裏');
        if (p.skirt === 'pleats') expect(res.pieces.find((pc) => pc.id === 'skirt-back')!.marks!.length).toBeGreaterThanOrEqual(8);
      });
    }
  }
});
