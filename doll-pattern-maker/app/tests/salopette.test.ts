import { describe, it, expect } from 'vitest';
import { SAMPLE_BODIES } from '../src/samples';
import { resolveBody } from '../src/model/estimate';
import { DEFAULT_SALOPETTE, draftSalopette, SalopetteParams } from '../src/pattern/items/salopette';
import { pathLength } from '../src/geometry/path';
import { dist } from '../src/geometry/vec';
import { pieceCutLine } from '../src/render/geometry';

const sa = { seam: 0.5, hem: 0.8, opening: 0.8 };
const sets: [string, Partial<SalopetteParams>][] = [
  ['最初（長ズボン・胸当て・クロス・脇開き）', {}],
  ['ハーフ・後ろ開き・まっすぐ・縫い付け・後ろポケット', { bottom: 'half', opening: 'back', straps: 'straight', strapFix: 'sewn', backPocket: true }],
  ['ショート・胸当てなし・ロールアップ・普通', { bottom: 'short', bib: false, hem: 'rollup', fit: 'normal' }],
  ['スカート', { bottom: 'skirt' }],
  ['長ズボン・ロールアップ・後ろ開き', { hem: 'rollup', opening: 'back' }],
];

describe('サロペット（サンプル全ボディ × 設定）', () => {
  for (const body of SAMPLE_BODIES) {
    for (const [label, q] of sets) {
      it(`${body.name} / ${label}`, () => {
        const r = resolveBody(body);
        const p = { ...DEFAULT_SALOPETTE, ...q };
        const res = draftSalopette(r, p);
        for (const pc of res.pieces) {
          for (let i = 0; i < pc.edges.length; i++) {
            const a = pc.edges[i].segs.at(-1)!.to;
            const b = pc.edges[(i + 1) % pc.edges.length].segs[0].from;
            expect(dist(a, b), `${pc.name} ${pc.edges[i].name}`).toBeLessThan(1e-6);
          }
          for (const pt of pieceCutLine(pc, sa)) expect(Number.isFinite(pt.x) && Number.isFinite(pt.y)).toBe(true);
        }
        const ids = res.pieces.map((pc) => pc.id);
        expect(ids.includes('bib')).toBe(p.bib);
        expect(ids.includes('front-band')).toBe(!p.bib);
        expect(ids).toContain('strap');
        expect(ids).toContain('back-band');
        if (p.bottom !== 'skirt') {
          const front = res.pieces.find((pc) => pc.id === 'front-pants')!;
          const back = res.pieces.find((pc) => pc.id === 'back-pants')!;
          // 開きがある
          const pc = p.opening === 'side' ? front : back;
          expect(pc.edges.some((e) => e.kind === 'opening')).toBe(true);
          // 脇（開きの下）の長さは前後で同じ
          const fs = pathLength(front.edges.find((e) => e.name === '脇')!.segs);
          const bs = pathLength(back.edges.find((e) => e.name === '脇')!.segs);
          expect(Math.abs(fs - bs)).toBeLessThan(Math.max(0.05, fs * 0.03));
          // 開けたときにヒップが通る: ウエスト ＋ 開き × 開きの数 × 2
          const waist = 2 * res.pieces.filter((x) => x.id.endsWith('pants')).reduce((a, x) => a + pathLength(x.edges.find((e) => e.name === 'ウエスト')!.segs), 0);
          const op = res.pieces.flatMap((x) => x.edges.filter((e) => e.kind === 'opening')).reduce((a, e) => a + pathLength(e.segs), 0);
          expect(waist + op * 2).toBeGreaterThan(r.values.hip_circ!);
        } else {
          expect(ids).toContain('skirt-front');
        }
      });
    }
  }
});
