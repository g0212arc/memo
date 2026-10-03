import { describe, it, expect } from 'vitest';
import { SAMPLE_BODIES } from '../src/samples';
import { resolveBody } from '../src/model/estimate';
import { draftTights, DEFAULT_TIGHTS, TightsParams, tightsReduction } from '../src/pattern/items/tights';
import { pathLength } from '../src/geometry/path';
import { dist } from '../src/geometry/vec';
import { pieceCutLine } from '../src/render/geometry';
import { Piece } from '../src/pattern/types';
import { ITEM_BY_ID } from '../src/pattern/items';

const sa = { seam: 0.5, hem: 0.8, opening: 0.8 };
const settings: [string, Partial<TightsParams>][] = [
  ['初期設定（全身・タートル・開きなし）', {}],
  ['レオタード・背中ファスナー・襟ぐり・袖なし', { coverage: 'leotard', opening: 'zip', neck: 'scoop', sleeve: 'none' }],
  ['足先まで・半袖・きつめ', { coverage: 'feet', sleeve: 'half', snug: 'tight' }],
  ['全身・自分で入力 15%', { snug: 'custom', reduceCustom: 15, opening: 'zip' }],
];
const len = (pc: Piece, name: string) => pathLength(pc.edges.filter((e) => e.name === name).flatMap((e) => e.segs));

describe('色移り防止タイツ（サンプル全ボディ × 設定）', () => {
  for (const body of SAMPLE_BODIES) {
    for (const [label, params] of settings) {
      it(`${body.name} / ${label}`, () => {
        const r = resolveBody(body);
        const p = { ...DEFAULT_TIGHTS, ...params };
        const res = draftTights(r, p);
        const by = (id: string) => res.pieces.find((x) => x.id === id);
        expect(by('front') && by('back')).toBeTruthy();
        expect(!!by('sleeve')).toBe(p.sleeve !== 'none');
        expect(!!by('foot')).toBe(p.coverage === 'feet');
        for (const piece of res.pieces) {
          for (let i = 0; i < piece.edges.length; i++) {
            const a = piece.edges[i].segs.at(-1)!.to;
            const b = piece.edges[(i + 1) % piece.edges.length].segs[0].from;
            expect(dist(a, b)).toBeLessThan(1e-9);
          }
          for (const pt of pieceCutLine(piece, sa)) expect(Number.isFinite(pt.x) && Number.isFinite(pt.y)).toBe(true);
        }
        const front = by('front')!;
        const back = by('back')!;
        // 前後で縫い合わせる辺の長さ（ダーツなし）
        expect(len(front, '肩')).toBeCloseTo(len(back, '肩'), 6);
        if (p.coverage !== 'leotard') {
          expect(len(front, '股下')).toBeCloseTo(len(back, '股下'), 1);
          // 足首の口は、伸ばすと足が通る
          const ankle = front.edges.find((e) => e.name.startsWith('足首'))!.segs[0];
          const ankleB = back.edges.find((e) => e.name.startsWith('足首'))!.segs[0];
          const open = (Math.abs(ankle.to.x - ankle.from.x) + Math.abs(ankleB.to.x - ankleB.from.x)) * 2;
          expect(open * (1 + p.stretch / 100)).toBeGreaterThanOrEqual(r.values.foot_pass_circ! - 1e-6);
        }
        expect(back.edges.some((e) => e.name === '後ろ中心（ファスナー付け）')).toBe(p.opening === 'zip');
      });
    }
  }
});

describe('タイツのサイズ感と胸ダーツ', () => {
  it('開きなしはファスナーより小さく、ゆるめ < 普通 < きつめ', () => {
    const base = { stretch: 40, reduceCustom: null } as const;
    expect(tightsReduction({ ...base, opening: 'none', snug: 'normal' })).toBeGreaterThan(tightsReduction({ ...base, opening: 'zip', snug: 'normal' }));
    expect(tightsReduction({ ...base, opening: 'none', snug: 'loose' })).toBeLessThan(tightsReduction({ ...base, opening: 'none', snug: 'normal' }));
    expect(tightsReduction({ ...base, opening: 'none', snug: 'tight' })).toBeGreaterThan(tightsReduction({ ...base, opening: 'none', snug: 'normal' }));
    expect(tightsReduction({ stretch: 40, opening: 'none', snug: 'custom', reduceCustom: 12 })).toBeCloseTo(0.12, 9);
  });

  it('胸囲 ÷ ウエスト が 1.5 以上だけダーツの欄が出て、ダーツ分だけ前の脇が長い', () => {
    const field = ITEM_BY_ID.tights.fields.find((f) => f.key === 'bustDart')!;
    expect(field.show!({}, { category: null, bustLarge: true, bustRatio: 1.45 })).toBe(false);
    expect(field.show!({}, { category: null, bustLarge: true, bustRatio: 1.55 })).toBe(true);
    const r = resolveBody(SAMPLE_BODIES.find((b) => b.name === '大福体 四分')!);
    r.values.waist_circ = r.values.chest_circ! / 1.6;
    const withDart = draftTights(r, { ...DEFAULT_TIGHTS });
    const front = withDart.pieces.find((x) => x.id === 'front')!;
    const back = withDart.pieces.find((x) => x.id === 'back')!;
    expect(front.marks?.length).toBe(1);
    expect(len(front, '脇') - len(back, '脇')).toBeGreaterThan(0.1);
    const noDart = draftTights(r, { ...DEFAULT_TIGHTS, bustDart: false });
    expect(noDart.pieces.find((x) => x.id === 'front')!.marks).toBeUndefined();
  });
});
