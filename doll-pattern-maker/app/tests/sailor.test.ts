import { describe, it, expect } from 'vitest';
import { SAMPLE_BODIES } from '../src/samples';
import { resolveBody } from '../src/model/estimate';
import { draftSailor, DEFAULT_SAILOR, SailorParams, sailorOpening } from '../src/pattern/items/sailor';
import { pathLength } from '../src/geometry/path';
import { dist } from '../src/geometry/vec';
import { pieceCutLine } from '../src/render/geometry';
import { Piece } from '../src/pattern/types';

const sa = { seam: 0.5, hem: 0.8, opening: 0.8 };
const settings: [string, Partial<SailorParams>][] = [
  ['初期設定', {}],
  ['丸襟・長袖・背中開き・長方形スカーフ・裏地なし', { collarShape: 'round', sleeve: 'long', opening: 'back', scarf: 'long', lining: false, length: 'waist' }],
  ['角を切る・大きい襟・深いV・カフスなし・腰まで', { collarShape: 'cut', collarSize: 'large', vDepth: 'large', cuff: false, length: 'hip', opening: 'front' }],
  ['自分で入力', { collarSize: 'custom', collarDepthCustom: 2, vDepth: 'custom', vDepthCustom: 3, length: 'custom', lengthCustom: -1, fit: 'custom', chestEaseCustom: 2 }],
];
const len = (pc: Piece, prefix: string) => pathLength(pc.edges.filter((e) => e.name.startsWith(prefix)).flatMap((e) => e.segs));

describe('セーラートップス（サンプル全ボディ × 設定）', () => {
  for (const body of SAMPLE_BODIES) {
    for (const [label, params] of settings) {
      it(`${body.name} / ${label}`, () => {
        const r = resolveBody(body);
        const p = { ...DEFAULT_SAILOR, ...params };
        const res = draftSailor(r, p);
        const by = (id: string) => res.pieces.find((x) => x.id === id);
        const opening = sailorOpening(r.category, p.opening);
        for (const id of ['front', 'back', 'collar', 'sleeve', 'scarf']) expect(by(id)).toBeTruthy();
        expect(!!by('front-facing')).toBe(opening === 'front');
        expect(!!by('cuff')).toBe(p.cuff);
        expect(!!by('front-lining')).toBe(p.lining);
        for (const piece of res.pieces) {
          for (let i = 0; i < piece.edges.length; i++) {
            const a = piece.edges[i].segs.at(-1)!.to;
            const b = piece.edges[(i + 1) % piece.edges.length].segs[0].from;
            expect(dist(a, b)).toBeLessThan(1e-9);
          }
          for (const pt of pieceCutLine(piece, sa)) expect(Number.isFinite(pt.x) && Number.isFinite(pt.y)).toBe(true);
        }
        // 襟の付け側 ＝ 身頃の襟ぐり（後ろ＋前の V）
        const collar = by('collar')!;
        const neck = len(by('front')!, '襟ぐり') + len(by('back')!, '襟ぐり') - len(by('back')!, '襟ぐり（持ち出し）');
        expect(len(collar, '襟ぐり')).toBeCloseTo(neck, 6);
        // ラインの目安が 2 本
        expect(collar.marks?.length).toBe(2);
        // カフスの長さ ＝ 袖口
        if (p.cuff) {
          const sleeve = by('sleeve')!;
          const hem = sleeve.edges.find((e) => e.name.startsWith('袖口'))!.segs[0];
          const cuff = by('cuff')!.edges[0].segs[0];
          expect(Math.abs(cuff.to.x - cuff.from.x)).toBeCloseTo(Math.abs(hem.to.x - hem.from.x), 6);
        }
      });
    }
  }
});

describe('セーラートップスの開き', () => {
  it('自動のときは棍六以下が背中開き、1/4 以上は前開き', () => {
    expect(sailorOpening('棍六', 'auto')).toBe('back');
    expect(sailorOpening('小六', 'auto')).toBe('back');
    expect(sailorOpening('1/4', 'auto')).toBe('front');
    expect(sailorOpening('大四', 'auto')).toBe('front');
    expect(sailorOpening('棍六', 'front')).toBe('front');
    expect(sailorOpening('1/4', 'back')).toBe('back');
  });
});
