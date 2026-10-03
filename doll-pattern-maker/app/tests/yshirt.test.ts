import { describe, it, expect } from 'vitest';
import { SAMPLE_BODIES } from '../src/samples';
import { resolveBody } from '../src/model/estimate';
import { draftYshirt, DEFAULT_YSHIRT, YshirtParams } from '../src/pattern/items/yshirt';
import { resolveOpening } from '../src/pattern/opening';
import { pathLength } from '../src/geometry/path';
import { dist } from '../src/geometry/vec';
import { pieceCutLine } from '../src/render/geometry';
import { Piece } from '../src/pattern/types';

const sa = { seam: 0.5, hem: 0.8, opening: 0.8 };
const settings: [string, Partial<YshirtParams>][] = [
  ['初期設定', {}],
  ['丸襟・半袖・まっすぐ・ヨークなし', { collar: 'round', sleeve: 'half', hem: 'straight', yoke: false }],
  ['スタンドカラー・背中開き・ポケットなし', { collar: 'stand', opening: 'back', pocket: false }],
  ['シャツ襟・背中開き・長め', { opening: 'back', length: 'long' }],
  ['シャツ襟・前開き・自分で入力', { opening: 'front', length: 'custom', lengthCustom: 1, fit: 'custom', chestEaseCustom: 1.5 }],
];
const len = (pc: Piece, name: string) => pathLength(pc.edges.filter((e) => e.name === name).flatMap((e) => e.segs));

describe('Yシャツ（サンプル全ボディ × 設定）', () => {
  for (const body of SAMPLE_BODIES) {
    for (const [label, params] of settings) {
      it(`${body.name} / ${label}`, () => {
        const r = resolveBody(body);
        const p = { ...DEFAULT_YSHIRT, ...params };
        const res = draftYshirt(r, p);
        const by = (id: string) => res.pieces.find((x) => x.id === id);
        const opening = resolveOpening(r.category, p.opening);
        for (const id of ['front', 'back', 'sleeve']) expect(by(id)).toBeTruthy();
        expect(!!by('yoke')).toBe(p.yoke);
        expect(!!by('pocket')).toBe(p.pocket);
        expect(!!by('cuff')).toBe(p.sleeve === 'long');
        expect(!!by('placket')).toBe(opening === 'back');
        // 襟の部品
        if (p.collar === 'stand') expect(by('stand') && !by('collar')).toBeTruthy();
        else if (p.collar === 'shirt' && opening === 'front') expect(by('stand') && by('collar')).toBeTruthy();
        else expect(!by('stand') && by('collar')).toBeTruthy();
        for (const piece of res.pieces) {
          for (let i = 0; i < piece.edges.length; i++) {
            const a = piece.edges[i].segs.at(-1)!.to;
            const b = piece.edges[(i + 1) % piece.edges.length].segs[0].from;
            expect(dist(a, b)).toBeLessThan(1e-9);
          }
          for (const pt of pieceCutLine(piece, sa)) expect(Number.isFinite(pt.x) && Number.isFinite(pt.y)).toBe(true);
        }
        // 前後の脇の差 ＝ 胸の分（前丈 − 背丈）。シャツテールでも前後同じだけ上げる
        const front = by('front')!;
        const back = by('back')!;
        const hemY = (pc: Piece) => Math.max(...pc.edges.find((e) => e.name === '裾')!.segs.map((s) => Math.max(s.from.y, s.to.y)));
        expect(Math.abs(len(front, '脇') - len(back, '脇') - (hemY(front) - hemY(back)))).toBeLessThan(0.4);
        // 台襟（前開き）の襟付け ＝ 襟ぐり（半身）＋ 前立て
        if (opening === 'front' && p.collar !== 'round') {
          const neck = len(front, '襟ぐり') + len(p.yoke ? by('yoke')! : back, '襟ぐり');
          const pw = len(front, '襟ぐり（前立て）');
          expect(len(by('stand')!, '襟付け')).toBeCloseTo(neck + pw, 2);
        }
        // 丸襟の襟付け ＝ 襟ぐり（半身）
        if (p.collar === 'round') {
          const neck = len(front, '襟ぐり') + len(p.yoke ? by('yoke')! : back, '襟ぐり');
          expect(len(by('collar')!, '襟付け')).toBeCloseTo(neck, 1);
        }
      });
    }
  }
});
