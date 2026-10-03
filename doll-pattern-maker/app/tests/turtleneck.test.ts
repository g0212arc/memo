import { describe, it, expect } from 'vitest';
import { SAMPLE_BODIES } from '../src/samples';
import { resolveBody } from '../src/model/estimate';
import { draftTurtleneck, DEFAULT_TURTLENECK, TurtleneckParams } from '../src/pattern/items/turtleneck';
import { pathLength } from '../src/geometry/path';
import { dist } from '../src/geometry/vec';
import { pieceCutLine } from '../src/render/geometry';
import { ITEMS } from '../src/pattern/items';

const sa = { seam: 0.5, hem: 0.8, opening: 0.8 };
const settings: [string, Partial<TurtleneckParams>][] = [
  ['長袖・ニット・背中開き', {}],
  ['袖なし・布帛・開きなし', { sleeve: 'none', fabric: 'woven', backOpening: false }],
  ['長袖・タイト・短め', { fitBody: 'tight', fitSleeve: 'tight', length: 'short' }],
];

describe('タートルネック（サンプル全ボディ × 設定）', () => {
  for (const body of SAMPLE_BODIES) {
    for (const [label, params] of settings) {
      it(`${body.name} / ${label}`, () => {
        const r = resolveBody(body);
        const p = { ...DEFAULT_TURTLENECK, ...params };
        const res = draftTurtleneck(r, p);
        const ids = res.pieces.map((x) => x.id);
        expect(ids).toContain('turtle');
        if (p.sleeve === 'none') {
          expect(ids).not.toContain('sleeve');
          expect(ids).toContain('armhole-binding');
        } else {
          expect(ids).toContain('sleeve');
        }
        for (const piece of res.pieces) {
          for (let i = 0; i < piece.edges.length; i++) {
            const a = piece.edges[i].segs.at(-1)!.to;
            const b = piece.edges[(i + 1) % piece.edges.length].segs[0].from;
            expect(dist(a, b)).toBeLessThan(1e-9);
          }
          for (const pt of pieceCutLine(piece, sa)) expect(Number.isFinite(pt.x) && Number.isFinite(pt.y)).toBe(true);
        }
        const front = res.pieces.find((x) => x.id === 'front')!;
        const back = res.pieces.find((x) => x.id === 'back')!;
        const neck = (pc: typeof front) => pathLength(pc.edges.filter((e) => e.name.startsWith('襟ぐり')).flatMap((e) => e.segs));
        // タートルの長さ ≒ 襟ぐり全体（ニットは 95%）
        const turtle = res.pieces.find((x) => x.id === 'turtle')!;
        const tl = Math.abs(turtle.edges[0].segs[0].to.x - turtle.edges[0].segs[0].from.x);
        expect(tl).toBeCloseTo(2 * (neck(front) + neck(back)) * (p.fabric === 'woven' ? 1 : 0.95), 6);
        // 長袖: 袖山 ＝ 袖ぐり、袖口は肘が通る周り以上、袖丈は腕の長さ
        if (p.sleeve === 'long') {
          const sleeve = res.pieces.find((x) => x.id === 'sleeve')!;
          const ah = (pc: typeof front) => pathLength(pc.edges.find((e) => e.name === '袖ぐり')!.segs);
          const cap = pathLength(sleeve.edges.filter((e) => e.name.startsWith('袖山')).flatMap((e) => e.segs));
          expect(cap).toBeCloseTo((ah(front) + ah(back)) * (p.fabric === 'woven' ? 1.03 : 1), 2);
          const hem = sleeve.edges.find((e) => e.kind === 'hem')!.segs[0];
          expect(Math.abs(hem.to.x - hem.from.x)).toBeGreaterThanOrEqual(r.values.elbow_pass_circ! - 1e-9);
          expect(hem.to.y).toBeCloseTo(r.values.arm_length!, 6);
        }
      });
    }
  }

  it('開きなしで頭が通らないときは警告する', () => {
    const melon = SAMPLE_BODIES.find((b) => b.name === '甜瓜体')!; // 頭囲 22.7cm
    const res = draftTurtleneck(resolveBody(melon), { ...DEFAULT_TURTLENECK, backOpening: false, fabric: 'woven' });
    expect(res.warnings.some((w) => w.includes('頭が通りません'))).toBe(true);
  });

  it('フィット感: タイトは身幅が狭く、余裕ありは広い', () => {
    const r = resolveBody(SAMPLE_BODIES.find((b) => b.name === 'MDD')!);
    const width = (fit: 'tight' | 'normal' | 'loose') => {
      const front = draftTurtleneck(r, { ...DEFAULT_TURTLENECK, fitBody: fit }).pieces[0];
      return Math.max(...front.edges.flatMap((e) => e.segs).map((s) => s.to.x));
    };
    expect(width('tight')).toBeLessThan(width('normal'));
    expect(width('normal')).toBeLessThan(width('loose'));
  });

  it('アイテム一覧の初期値に、設定欄の全項目がある', () => {
    for (const item of ITEMS) for (const f of item.fields) expect(item.defaults).toHaveProperty(f.key);
  });
});
