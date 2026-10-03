import { describe, it, expect } from 'vitest';
import { SAMPLE_BODIES } from '../src/samples';
import { resolveBody } from '../src/model/estimate';
import { draftCamisole, DEFAULT_CAMISOLE, CamisoleParams } from '../src/pattern/items/camisole';
import { draftTshirt, DEFAULT_TSHIRT } from '../src/pattern/items/tshirt';
import { bustLarge } from '../src/pattern/bust';
import { pathLength } from '../src/geometry/path';
import { dist } from '../src/geometry/vec';
import { pieceCutLine } from '../src/render/geometry';
import { Piece } from '../src/pattern/types';

const sa = { seam: 0.5, hem: 0.8, opening: 0.8 };
const settings: [string, Partial<CamisoleParams>][] = [
  ['Aライン・膝丈・裏地あり', {}],
  ['ストレート・足首・裏地なし', { skirt: 'straight', length: 'ankle', lining: false }],
  ['ギャザー・短め・太い肩ひも', { skirt: 'gather', length: 'short', strap: 'wide' }],
  ['タイト・ダーツなし・ニット', { fit: 'tight', bustDart: false, fabric: 'knit' }],
];
const len = (pc: Piece, name: string) => pathLength(pc.edges.filter((e) => e.name === name).flatMap((e) => e.segs));
const waistWidth = (pc: Piece) => {
  const e = pc.edges.find((x) => x.name.startsWith('ウエスト'))!;
  const s = e.segs[0];
  return Math.max(s.from.x, s.to.x);
};

describe('キャミソールワンピース（サンプル全ボディ × 設定）', () => {
  for (const body of SAMPLE_BODIES) {
    for (const [label, params] of settings) {
      it(`${body.name} / ${label}`, () => {
        const r = resolveBody(body);
        const p = { ...DEFAULT_CAMISOLE, ...params };
        const res = draftCamisole(r, p);
        const by = (id: string) => res.pieces.find((x) => x.id === id);
        for (const id of ['front', 'back', 'strap', 'front-skirt', 'back-skirt']) expect(by(id)).toBeTruthy();
        expect(!!by('front-lining')).toBe(p.lining);
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
        // 身頃とスカートのウエストがそろう（ギャザーはスカートのほうが長い）
        for (const [bod, sk] of [[front, by('front-skirt')!], [back, by('back-skirt')!]] as const) {
          if (p.skirt === 'gather') expect(waistWidth(sk)).toBeGreaterThan(waistWidth(bod));
          else expect(waistWidth(sk)).toBeCloseTo(waistWidth(bod), 6);
        }
        // 前の脇 ＝ 後ろの脇 ＋ 胸の分（前丈 − 背丈）。ダーツありならダーツを縫うと後ろと同じ長さになる
        const dart = res.info.some((x) => x.startsWith('胸ダーツ'));
        const wy = (pc: Piece) => pc.edges.find((e) => e.name === 'ウエスト')!.segs[0].from.y;
        const delta = wy(front) - wy(back);
        expect(Math.abs(len(front, '脇') - len(back, '脇') - delta)).toBeLessThan(dart ? 0.05 : 0.4);
        // Aラインの脇の長さはスカート丈と同じ
        if (p.skirt === 'aline') {
          const sk = by('front-skirt')!;
          const cf = len(sk, '前中心（わ）');
          expect(len(sk, '脇')).toBeCloseTo(cf, 6);
        }
        if (p.fabric === 'knit') expect(dart).toBe(false);
      });
    }
  }
});

describe('胸ダーツ', () => {
  const large = SAMPLE_BODIES.find((b) => b.name === '大福体 四分')!;
  const small = SAMPLE_BODIES.find((b) => b.name === 'MDD')!;

  it('胸囲 ÷ ウエスト が 1.35 以上のボディだけ対象', () => {
    expect(bustLarge(resolveBody(large).values)).toBe(true);
    expect(bustLarge(resolveBody(small).values)).toBe(false);
  });

  it('布帛でダーツありなら、前身頃にダーツの印が入り、脇の長さは後ろ＋ダーツ分', () => {
    const r = resolveBody(large);
    const res = draftTshirt(r, { ...DEFAULT_TSHIRT, fabric: 'woven', bustDart: true });
    const front = res.pieces.find((x) => x.id === 'front')!;
    const back = res.pieces.find((x) => x.id === 'back')!;
    expect(front.marks?.length).toBe(1);
    const delta = r.values.front_length! - r.values.back_length!;
    expect(len(front, '脇') - len(back, '脇')).toBeCloseTo(delta, 1);
  });

  it('ダーツなし・ニット・胸が小さいボディでは入らない', () => {
    for (const [body, p] of [
      [large, { fabric: 'woven', bustDart: false }],
      [large, { fabric: 'knit', bustDart: true }],
      [small, { fabric: 'woven', bustDart: true }],
    ] as const) {
      const res = draftTshirt(resolveBody(body), { ...DEFAULT_TSHIRT, ...p });
      expect(res.pieces.find((x) => x.id === 'front')!.marks).toBeUndefined();
    }
  });
});
