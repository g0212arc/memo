import { describe, it, expect } from 'vitest';
import { SAMPLE_BODIES } from '../src/samples';
import { resolveBody } from '../src/model/estimate';
import { draftChina, DEFAULT_CHINA, ChinaParams } from '../src/pattern/items/china';
import { pathLength } from '../src/geometry/path';
import { dist } from '../src/geometry/vec';
import { pieceCutLine } from '../src/render/geometry';

const sa = { seam: 0.5, hem: 0.8, opening: 0.8 };
const settings: [string, Partial<ChinaParams>][] = [
  ['ドレス膝丈・ノースリーブ・普通スリット', {}],
  ['トップス・半袖・スリットあり', { length: 'top', sleeve: 'short' }],
  ['トップス・長袖・スリットなし・高い襟', { length: 'top', sleeve: 'long', topSlit: false, collar: 'high' }],
  ['ドレス足首・フレンチ・深め・すぼめる', { length: 'ankle', sleeve: 'french', slit: 'deep', hem: 'taper' }],
  ['ドレス ミモレ・浅め・タイト', { length: 'midi', slit: 'low', fitBody: 'tight' }],
  ['ドレス 自分で入力', { length: 'custom', lengthCustom: 10, slit: 'custom', slitCustom: 3, sleeve: 'custom', sleeveCustom: 3, collar: 'custom', collarCustom: 0.8 }],
];

describe('チャイナ服（サンプル全ボディ × 設定）', () => {
  for (const body of SAMPLE_BODIES) {
    for (const [label, params] of settings) {
      it(`${body.name} / ${label}`, () => {
        const r = resolveBody(body);
        const p = { ...DEFAULT_CHINA, ...params };
        const res = draftChina(r, p);
        for (const pc of res.pieces) {
          for (let i = 0; i < pc.edges.length; i++) {
            const a = pc.edges[i].segs.at(-1)!.to;
            const b = pc.edges[(i + 1) % pc.edges.length].segs[0].from;
            expect(dist(a, b)).toBeLessThan(1e-9);
          }
          for (const pt of pieceCutLine(pc, sa)) expect(Number.isFinite(pt.x) && Number.isFinite(pt.y)).toBe(true);
        }
        const [front, back] = res.pieces;
        // 前の打ち合わせは見た目だけ: 前は「わ」、後ろは開き
        expect(front.edges.some((e) => e.kind === 'fold')).toBe(true);
        expect(back.edges.some((e) => e.kind === 'opening' && e.name === '後ろ開き')).toBe(true);
        // スリットは前後とも同じ長さ
        const slit = (pc: typeof front) => pc.edges.filter((e) => e.name === 'スリット').reduce((a, e) => a + pathLength(e.segs), 0);
        expect(slit(front)).toBeCloseTo(slit(back), 6);
        // 襟付けの長さ ＝ 襟ぐり（半身）
        const collar = res.pieces.find((pc) => pc.id === 'collar')!;
        const neck = pathLength(front.edges.find((e) => e.name === '襟ぐり')!.segs) + pathLength(back.edges.find((e) => e.name === '襟ぐり')!.segs);
        expect(pathLength(collar.edges[0].segs)).toBeCloseTo(neck, 3);
        expect(res.pieces.some((pc) => pc.id === 'sleeve')).toBe(p.sleeve === 'short' || p.sleeve === 'long' || p.sleeve === 'custom');
      });
    }
  }
});
