import { describe, it, expect } from 'vitest';
import { SAMPLE_BODIES } from '../src/samples';
import { resolveBody } from '../src/model/estimate';
import { draftPleats, DEFAULT_PLEATS, PleatsParams } from '../src/pattern/items/pleats';
import { pathLength } from '../src/geometry/path';
import { dist } from '../src/geometry/vec';
import { pieceCutLine } from '../src/render/geometry';

const sa = { seam: 0.5, hem: 0.8, opening: 0.8 };
const settings: [string, Partial<PleatsParams>][] = [
  ['車ひだ 12・膝丈・ゴム', {}],
  ['車ひだ 16・ミニ・ベルト', { count: '16', length: 'mini', waist: 'belt' }],
  ['箱ひだ 8・ミモレ・ゴム', { pleat: 'box', count: '8', length: 'midi' }],
  ['箱ひだ 10（自分で入力）・ベルト', { pleat: 'box', count: 'custom', countCustom: 10, waist: 'belt' }],
  ['インバーテッド・ゴム', { pleat: 'inverted' }],
  ['インバーテッド・ベルト・足首', { pleat: 'inverted', waist: 'belt', length: 'ankle' }],
];

describe('プリーツスカート（サンプル全ボディ × 設定）', () => {
  for (const body of SAMPLE_BODIES) {
    for (const [label, params] of settings) {
      it(`${body.name} / ${label}`, () => {
        const r = resolveBody(body);
        const p = { ...DEFAULT_PLEATS, ...params };
        const res = draftPleats(r, p);
        expect(res.pieces).toHaveLength(p.waist === 'belt' ? 3 : 2);
        for (const pc of res.pieces) {
          for (let i = 0; i < pc.edges.length; i++) {
            const a = pc.edges[i].segs.at(-1)!.to;
            const b = pc.edges[(i + 1) % pc.edges.length].segs[0].from;
            expect(dist(a, b)).toBeLessThan(1e-9);
          }
          for (const pt of pieceCutLine(pc, sa)) expect(Number.isFinite(pt.x) && Number.isFinite(pt.y)).toBe(true);
        }
        if (p.pleat !== 'inverted') {
          // たたむとヒップ（ゆとり込み）になる: 布の幅 − ひだに使う分 ＝ ヒップ
          const m = res.info[1].match(/布の幅 合計 ([\d.]+)cm（たたむとヒップ ([\d.]+)cm/)!;
          expect(Number(m[1])).toBeGreaterThan(Number(m[2]) * 1.8);
          const marks = res.pieces.filter((pc) => pc.id.startsWith('pleats')).reduce((a, pc) => a + (pc.marks?.filter((m) => m[0].x > 1e-9).length ?? 0) * (pc.cut.startsWith('2') ? 2 : 1), 0); // 持ち出しの境目（x = 0）は数えない
          expect(marks).toBe(2 * (p.count === 'custom' ? p.countCustom! : Number(p.count)));
          // 前後の脇の長さがそろう
          const sides = res.pieces.filter((pc) => pc.id.startsWith('pleats')).flatMap((pc) => pc.edges.filter((e) => e.name === '脇').map((e) => pathLength(e.segs)));
          for (const l of sides) expect(l).toBeCloseTo(sides[0], 6);
        } else {
          expect(res.pieces[0].edges.some((e) => e.name === 'ウエスト（ひだ）')).toBe(true);
        }
      });
    }
  }
});
