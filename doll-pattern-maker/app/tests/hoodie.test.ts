import { describe, it, expect } from 'vitest';
import { SAMPLE_BODIES } from '../src/samples';
import { resolveBody } from '../src/model/estimate';
import { draftHoodie, DEFAULT_HOODIE, HoodieParams } from '../src/pattern/items/hoodie';
import { pathLength } from '../src/geometry/path';
import { dist } from '../src/geometry/vec';
import { pieceCutLine } from '../src/render/geometry';
import { Piece } from '../src/pattern/types';

const sa = { seam: 0.5, hem: 0.8, opening: 0.8 };
const settings: [string, Partial<HoodieParams>][] = [
  ['初期設定（かぶり・自動）', {}],
  ['前ファスナー・9〜10インチ', { front: 'zip', headSize: '9-10' }],
  ['半袖・6〜7インチ・リブ/ポケット/ひもなし', { sleeve: 'half', headSize: '6-7', rib: false, pocket: false, strings: false }],
  ['7〜8インチ・短め', { headSize: '7-8', length: 'short' }],
  ['自分で入力（頭囲 24cm）', { headSize: 'custom', headCustom: 24, length: 'custom', lengthCustom: 2 }],
];
const len = (pc: Piece, name: string) => pathLength(pc.edges.filter((e) => e.name === name).flatMap((e) => e.segs));

describe('パーカー（サンプル全ボディ × 設定）', () => {
  for (const body of SAMPLE_BODIES) {
    for (const [label, params] of settings) {
      it(`${body.name} / ${label}`, () => {
        const r = resolveBody(body);
        const p = { ...DEFAULT_HOODIE, ...params };
        const res = draftHoodie(r, p);
        const by = (id: string) => res.pieces.find((x) => x.id === id);
        for (const id of ['front', 'back', 'sleeve', 'hood']) expect(by(id)).toBeTruthy();
        expect(!!by('string')).toBe(p.strings);
        expect(!!by('hem-rib')).toBe(p.rib);
        expect(!!by('cuff')).toBe(p.rib && p.sleeve === 'long');
        // 9 インチ以上は 3 枚はぎ
        const bigHead = p.headSize === '9-10' || (p.headSize === 'custom' && (p.headCustom ?? 0) >= 9 * 2.54);
        if (p.headSize !== 'auto') expect(!!by('hood-gusset')).toBe(bigHead);
        for (const piece of res.pieces) {
          for (let i = 0; i < piece.edges.length; i++) {
            const a = piece.edges[i].segs.at(-1)!.to;
            const b = piece.edges[(i + 1) % piece.edges.length].segs[0].from;
            expect(dist(a, b)).toBeLessThan(1e-9);
          }
          for (const pt of pieceCutLine(piece, sa)) expect(Number.isFinite(pt.x) && Number.isFinite(pt.y)).toBe(true);
        }
        // フードの襟付け ≒ 襟ぐり（半身）
        const neck = len(by('front')!, '襟ぐり') + len(by('back')!, '襟ぐり');
        expect(len(by('hood')!, '襟付け')).toBeGreaterThan(neck * 0.95);
        // 3 枚はぎのマチの長さ ＝ フードのマチ付け
        if (by('hood-gusset')) {
          expect(len(by('hood-gusset')!, 'マチ付け') / 2).toBeCloseTo(len(by('hood')!, 'マチ付け'), 6);
        }
        // 前ファスナーは前中心が開き
        expect(by('front')!.edges.some((e) => e.name === '前中心（ファスナー付け）')).toBe(p.front === 'zip');
      });
    }
  }
});
