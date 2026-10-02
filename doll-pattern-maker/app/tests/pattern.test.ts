import { describe, it, expect } from 'vitest';
import { SAMPLE_BODIES } from '../src/samples';
import { resolveBody } from '../src/model/estimate';
import { draftTshirt, DEFAULT_TSHIRT, TshirtParams } from '../src/pattern/items/tshirt';
import { flatten, pathLength } from '../src/geometry/path';
import { dist } from '../src/geometry/vec';
import { pieceOutline, pieceCutLine } from '../src/render/geometry';

const variants: [string, Partial<TshirtParams>][] = [
  ['ニット・背中開き', {}],
  ['布帛・開きなし', { fabric: 'woven', backOpening: false }],
];

describe('Tシャツ（サンプル5体 × 設定）', () => {
  for (const body of SAMPLE_BODIES) {
    for (const [label, params] of variants) {
      it(`${body.name} / ${label}`, () => {
        const r = resolveBody(body);
        const res = draftTshirt(r, { ...DEFAULT_TSHIRT, ...params });
        expect(res.pieces.map((p) => p.id)).toEqual(['front', 'back', 'sleeve', 'binding']);

        for (const piece of res.pieces) {
          // 辺がつながって閉じた輪になっている
          for (let i = 0; i < piece.edges.length; i++) {
            const a = piece.edges[i].segs.at(-1)!.to;
            const b = piece.edges[(i + 1) % piece.edges.length].segs[0].from;
            expect(dist(a, b)).toBeLessThan(1e-9);
          }
          const pts = pieceOutline(piece);
          for (const p of pts) {
            expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
          }
          // 縫い代線はできあがり線を囲む
          const cut = pieceCutLine(piece, { seam: 0.5, hem: 0.8, opening: 0.8 });
          expect(cut.length).toBeGreaterThan(3);
          for (const p of cut) expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
        }

        // 袖山の長さ ≒ 袖ぐりの長さ（＋いせ）
        const front = res.pieces[0];
        const back = res.pieces[1];
        const sleeve = res.pieces[2];
        const ah = (p: typeof front) => pathLength(p.edges.find((e) => e.name === '袖ぐり')!.segs);
        const cap = pathLength(sleeve.edges.filter((e) => e.name.startsWith('袖山')).flatMap((e) => e.segs));
        const capEase = params.fabric === 'woven' ? 0.03 : 0;
        expect(cap).toBeCloseTo((ah(front) + ah(back)) * (1 + capEase), 2);

        // 前後の肩の長さ・脇の長さがそろっている（縫い合わせる辺）
        const edgeLen = (p: typeof front, name: string) => pathLength(p.edges.find((e) => e.name === name)!.segs);
        expect(edgeLen(front, '肩')).toBeCloseTo(edgeLen(back, '肩'), 6);
        expect(Math.abs(edgeLen(front, '脇') - edgeLen(back, '脇'))).toBeLessThan(
          r.values.front_length! - r.values.back_length! + 0.05,
        );

        // 肘が通る: 袖幅・袖口とも「肘が通る周り」以上
        const hem = sleeve.edges.find((e) => e.kind === 'hem')!.segs[0];
        const hemWidth = Math.abs(hem.to.x - hem.from.x);
        expect(hemWidth).toBeGreaterThanOrEqual(r.values.elbow_pass_circ! - 1e-9);

        // 身頃の幅（半身×4）が胸囲以上
        const chestHalf = Math.max(...flatten(front.edges.flatMap((e) => e.segs)).map((p) => p.x));
        expect(chestHalf * 4).toBeGreaterThanOrEqual(r.values.chest_circ!);
      });
    }
  }
});
