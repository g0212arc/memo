import { describe, it, expect } from 'vitest';
import { SAMPLE_BODIES } from '../src/samples';
import { resolveBody } from '../src/model/estimate';
import { draftRaglan, DEFAULT_RAGLAN, RaglanParams } from '../src/pattern/items/raglan';
import { pathLength } from '../src/geometry/path';
import { dist } from '../src/geometry/vec';
import { pieceCutLine } from '../src/render/geometry';
import { Piece } from '../src/pattern/types';

const sa = { seam: 0.5, hem: 0.8, opening: 0.8 };
const settings: [string, Partial<RaglanParams>][] = [
  ['1枚袖・クルー・半袖', {}],
  ['2枚袖・Vネック・長袖', { shoulder: 'two', neck: 'v', sleeve: 'long' }],
  ['1枚袖・Vネック・七分・布帛', { neck: 'v', sleeve: 'three', fabric: 'woven', backOpening: false }],
  ['2枚袖・自分で入力', { shoulder: 'two', sleeve: 'custom', sleeveCustom: 4 }],
];
const len = (pcs: Piece[], name: string) => pcs.flatMap((pc) => pc.edges).filter((e) => e.name === name).reduce((a, e) => a + pathLength(e.segs), 0);

describe('ラグラン袖シャツ（サンプル全ボディ × 設定）', () => {
  for (const body of SAMPLE_BODIES) {
    for (const [label, params] of settings) {
      it(`${body.name} / ${label}`, () => {
        const r = resolveBody(body);
        const p = { ...DEFAULT_RAGLAN, ...params };
        const res = draftRaglan(r, p);
        expect(res.pieces).toHaveLength(p.shoulder === 'dart' ? 4 : 5);
        for (const pc of res.pieces) {
          for (let i = 0; i < pc.edges.length; i++) {
            const a = pc.edges[i].segs.at(-1)!.to;
            const b = pc.edges[(i + 1) % pc.edges.length].segs[0].from;
            expect(dist(a, b)).toBeLessThan(1e-9);
          }
          for (const pt of pieceCutLine(pc, sa)) expect(Number.isFinite(pt.x) && Number.isFinite(pt.y)).toBe(true);
        }
        const body2 = res.pieces.filter((pc) => pc.id === 'front' || pc.id === 'back');
        const sleeves = res.pieces.filter((pc) => pc.id.startsWith('sleeve'));
        // 縫い合わせる辺の長さが身頃と袖でそろう
        expect(len(sleeves, 'ラグラン線（前）')).toBeCloseTo(pathLength(body2[0].edges.find((e) => e.name === 'ラグラン線')!.segs), 6);
        expect(len(sleeves, 'ラグラン線（後ろ）')).toBeCloseTo(pathLength(body2[1].edges.find((e) => e.name === 'ラグラン線')!.segs), 6);
        expect(len(sleeves, '袖下カーブ（前）')).toBeCloseTo(pathLength(body2[0].edges.find((e) => e.name === '袖ぐり（袖下）')!.segs), 3);
        expect(len(sleeves, '袖下カーブ（後ろ）')).toBeCloseTo(pathLength(body2[1].edges.find((e) => e.name === '袖ぐり（袖下）')!.segs), 3);
        // 1枚袖の肩ダーツは左右の辺が同じ長さ
        if (p.shoulder === 'dart') {
          const d = sleeves[0].edges.find((e) => e.name === '肩ダーツ')!.segs;
          expect(pathLength([d[0]])).toBeCloseTo(pathLength([d[1]]), 6);
        }
      });
    }
  }
});

describe('ラグラン袖の袖丈', () => {
  it('半袖 < 七分袖 < 長袖', () => {
    const r = resolveBody(SAMPLE_BODIES.find((b) => b.name === 'MDD')!);
    const l = (['short', 'three', 'long'] as const).map((sleeve) => Number(draftRaglan(r, { ...DEFAULT_RAGLAN, sleeve }).info[0].match(/袖丈 ([\d.]+)cm/)![1]));
    expect(l[0]).toBeLessThan(l[1]);
    expect(l[1]).toBeLessThan(l[2]);
  });
});
