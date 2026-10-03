import { describe, it, expect } from 'vitest';
import { SAMPLE_BODIES } from '../src/samples';
import { resolveBody } from '../src/model/estimate';
import { draftPants, DEFAULT_PANTS, PantsParams, flyAvailable } from '../src/pattern/items/pants';
import { pathLength } from '../src/geometry/path';
import { dist } from '../src/geometry/vec';
import { pieceCutLine } from '../src/render/geometry';
import { ITEM_BY_ID } from '../src/pattern/items';
import { Piece } from '../src/pattern/types';

const sa = { seam: 0.5, hem: 0.8, opening: 0.8 };
const settings: [string, Partial<PantsParams>][] = [
  ['普通・くるぶし丈・ゴム', {}],
  ['タイト・くるぶし丈・前開き', { fit: 'tight', waist: 'fly' }],
  ['余裕あり・膝丈・ニット', { fit: 'loose', length: 'normal', fabric: 'knit' }],
  ['短パン・前開き', { length: 'short', waist: 'fly' }],
  ['タイト・ゴム・ニット', { fit: 'tight', fabric: 'knit' }],
];
const edgeLen = (pc: Piece, name: string) => pathLength(pc.edges.filter((e) => e.name === name).flatMap((e) => e.segs));
const hemW = (pc: Piece) => {
  const s = pc.edges.find((e) => e.kind === 'hem' && e.name === '裾')!.segs[0];
  return Math.abs(s.to.x - s.from.x);
};

describe('パンツ（サンプル全ボディ × 設定）', () => {
  for (const body of SAMPLE_BODIES) {
    for (const [label, params] of settings) {
      it(`${body.name} / ${label}`, () => {
        const r = resolveBody(body);
        const p = { ...DEFAULT_PANTS, ...params };
        const res = draftPants(r, p);
        const front = res.pieces.find((x) => x.id === 'front-pants')!;
        const back = res.pieces.find((x) => x.id === 'back-pants')!;
        expect(front && back).toBeTruthy();
        const fly = p.waist === 'fly' && flyAvailable(r.category);
        expect(res.pieces.some((x) => x.id === 'waistband')).toBe(fly);
        for (const piece of res.pieces) {
          for (let i = 0; i < piece.edges.length; i++) {
            const a = piece.edges[i].segs.at(-1)!.to;
            const b = piece.edges[(i + 1) % piece.edges.length].segs[0].from;
            expect(dist(a, b)).toBeLessThan(1e-9);
          }
          for (const pt of pieceCutLine(piece, sa)) expect(Number.isFinite(pt.x) && Number.isFinite(pt.y)).toBe(true);
        }
        // 前後で縫い合わせる辺の長さがそろう
        expect(Math.abs(edgeLen(front, '脇') - edgeLen(back, '脇'))).toBeLessThan(0.4);
        expect(Math.abs(edgeLen(front, '股下') - edgeLen(back, '股下'))).toBeLessThan(0.3);
        // くるぶし丈は裾から足が通る
        if (p.length === 'long') {
          const k = p.fabric === 'woven' ? 1 : Math.max(0.7, 1 - (p.stretch / 100) * 0.5);
          expect(hemW(front) + hemW(back)).toBeGreaterThanOrEqual(r.values.foot_pass_circ! * k - 1e-6);
        }
        // ゴムのときはウエストがヒップより大きい（はける）
        if (!fly) {
          const waist = 2 * (edgeLen(front, 'ウエスト（ゴム通し）') + edgeLen(back, 'ウエスト（ゴム通し）'));
          expect(waist).toBeGreaterThan(r.values.hip_circ!);
        }
      });
    }
  }
});

describe('パンツの設定', () => {
  const body = SAMPLE_BODIES.find((b) => b.name === 'MDD')!;
  const melon = SAMPLE_BODIES.find((b) => b.category === '小六')!;

  it('前開きは小六では選べず、ゴムになる', () => {
    const res = draftPants(resolveBody(melon), { ...DEFAULT_PANTS, waist: 'fly' });
    expect(res.pieces.some((x) => x.id === 'waistband')).toBe(false);
    expect(res.warnings.join()).toContain('ゴムで作図');
    const field = ITEM_BY_ID.pants.fields.find((f) => f.key === 'waist')!;
    expect(field.kind === 'radio' && field.available!('fly', { category: '小六' })).toBe(false);
    expect(field.kind === 'radio' && field.available!('fly', { category: '特六' })).toBe(true);
  });

  it('自分で入力した股下・ヒップのゆとり・裾の周りが反映される', () => {
    const r = resolveBody(body);
    const res = draftPants(r, { ...DEFAULT_PANTS, length: 'custom', inseamCustom: 12.3, fit: 'custom', hipEaseCustom: 4, hemCustom: 15 });
    const front = res.pieces.find((x) => x.id === 'front-pants')!;
    const back = res.pieces.find((x) => x.id === 'back-pants')!;
    expect(res.info.join()).toContain('股下 12.3cm');
    expect(res.info.join()).toContain('ヒップのゆとり 4.0cm');
    expect(hemW(front) + hemW(back)).toBeCloseTo(15, 6);
  });

  it('丈は 短パン < 膝丈 < くるぶし丈', () => {
    const r = resolveBody(body);
    const len = (length: PantsParams['length']) => {
      const f = draftPants(r, { ...DEFAULT_PANTS, length }).pieces[0];
      return edgeLen(f, '股下');
    };
    expect(len('short')).toBeLessThan(len('normal'));
    expect(len('normal')).toBeLessThan(len('long'));
  });

  it('身幅はタイトほど裾が細い', () => {
    const r = resolveBody(body);
    const hem = (fit: PantsParams['fit']) => {
      const res = draftPants(r, { ...DEFAULT_PANTS, fit });
      return hemW(res.pieces[0]) + hemW(res.pieces[1]);
    };
    expect(hem('tight')).toBeLessThan(hem('normal'));
    expect(hem('normal')).toBeLessThan(hem('loose'));
  });
});
