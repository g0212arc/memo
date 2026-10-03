import { describe, it, expect } from 'vitest';
import { SAMPLE_BODIES } from '../src/samples';
import { resolveBody } from '../src/model/estimate';
import { draftJacket, DEFAULT_JACKET, JacketParams, jacketThin } from '../src/pattern/items/jacket';
import { pathLength } from '../src/geometry/path';
import { dist } from '../src/geometry/vec';
import { pieceCutLine } from '../src/render/geometry';
import { signedArea, flatten } from '../src/geometry/path';
import { Piece } from '../src/pattern/types';

const sa = { seam: 0.5, hem: 0.8, opening: 0.8 };
const settings: [string, Partial<JacketParams>][] = [
  ['初期設定（テーラード）', {}],
  ['ピークド・ダブル・角', { collar: 'peak', breast: 'double', hemShape: 'square', buttons: 3 }],
  ['ショール・とがり・裏地なし', { collar: 'shawl', hemShape: 'point', lining: false }],
  ['ノーカラー・薄い作り・ショート', { collar: 'none', build: 'thin', length: 'short', cuff: false }],
  ['普通の作り・自分で入力', { build: 'normal', lapel: 'custom', lapelCustom: 1, roll: 'custom', rollCustom: 4, length: 'custom', lengthCustom: 2 }],
];
const len = (pc: Piece, name: string) => pathLength(pc.edges.filter((e) => e.name === name).flatMap((e) => e.segs));
const area = (pc: Piece) => Math.abs(signedArea(flatten(pc.edges.flatMap((e) => e.segs))));

describe('ジャケット（サンプル全ボディ × 設定）', () => {
  for (const body of SAMPLE_BODIES) {
    for (const [label, params] of settings) {
      it(`${body.name} / ${label}`, () => {
        const r = resolveBody(body);
        const p = { ...DEFAULT_JACKET, ...params };
        const res = draftJacket(r, p);
        const by = (id: string) => res.pieces.find((x) => x.id === id);
        const thin = jacketThin(r.category, p.build);
        for (const id of ['front', 'back', 'sleeve']) expect(by(id)).toBeTruthy();
        expect(!!by('collar')).toBe(p.collar === 'notch' || p.collar === 'peak');
        expect(!!by('front-facing')).toBe(!thin);
        expect(!!by('front-lining')).toBe(p.lining);
        expect(!!by('cuff')).toBe(p.cuff);
        for (const piece of res.pieces) {
          for (let i = 0; i < piece.edges.length; i++) {
            const a = piece.edges[i].segs.at(-1)!.to;
            const b = piece.edges[(i + 1) % piece.edges.length].segs[0].from;
            expect(dist(a, b)).toBeLessThan(1e-6);
          }
          for (const pt of pieceCutLine(piece, sa)) expect(Number.isFinite(pt.x) && Number.isFinite(pt.y)).toBe(true);
        }
        // 襟付け ＝ 後ろ襟ぐり ＋ 前の襟ぐり（SNP 〜 ゴージ）
        if (by('collar')) {
          expect(len(by('collar')!, '襟付け')).toBeCloseTo(len(by('back')!, '襟ぐり') + len(by('front')!, '襟ぐり'), 2);
        }
        // 見返し ＋ 前身頃の裏地 ＝ 前身頃（面積）
        if (!thin && p.lining) {
          expect(area(by('front-facing')!) + area(by('front-lining')!)).toBeCloseTo(area(by('front')!), 1);
        }
        // ボタンの印（ダブルは 2 列）
        const crosses = (by('front')!.marks ?? []).filter((m) => m.length === 2).length / 2;
        expect(crosses).toBeGreaterThan(0);
        if (p.breast === 'double') expect(crosses % 2).toBe(0);
      });
    }
  }
});

describe('ジャケットの作り', () => {
  it('自動のときは棍六以下が薄い作り', () => {
    expect(jacketThin('棍六', 'auto')).toBe(true);
    expect(jacketThin('1/4', 'auto')).toBe(false);
    expect(jacketThin('1/4', 'thin')).toBe(true);
    expect(jacketThin('小六', 'normal')).toBe(false);
  });
});
