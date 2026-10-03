import { describe, it, expect } from 'vitest';
import { SAMPLE_BODIES } from '../src/samples';
import { resolveBody } from '../src/model/estimate';
import { draftSocks, DEFAULT_SOCKS, SocksParams } from '../src/pattern/items/socks';
import { pathLength } from '../src/geometry/path';
import { dist } from '../src/geometry/vec';
import { pieceCutLine } from '../src/render/geometry';

const sa = { seam: 0.5, hem: 0.8, opening: 0.8 };
const settings: [string, Partial<SocksParams>][] = [
  ['2本・クルー', {}],
  ['1本・ニーハイ・折り返し', { seams: 1, length: 'knee', top: 'fold' }],
  ['2本・オーバーニー・ゴム', { length: 'over', top: 'elastic' }],
  ['1本・くるぶし・きつめ', { seams: 1, length: 'ankle', snug: 'tight' }],
  ['2本・自分で入力', { length: 'custom', lengthCustom: 6 }],
];
const lengths = ['ankle', 'crew', 'high', 'knee', 'over'] as const;

describe('靴下（サンプル全ボディ × 設定）', () => {
  for (const body of SAMPLE_BODIES) {
    for (const [label, params] of settings) {
      it(`${body.name} / ${label}`, () => {
        const r = resolveBody(body);
        const p = { ...DEFAULT_SOCKS, ...params };
        const res = draftSocks(r, p);
        expect(res.pieces).toHaveLength(1);
        const sock = res.pieces[0];
        for (let i = 0; i < sock.edges.length; i++) {
          const a = sock.edges[i].segs.at(-1)!.to;
          const b = sock.edges[(i + 1) % sock.edges.length].segs[0].from;
          expect(dist(a, b)).toBeLessThan(1e-9);
        }
        for (const pt of pieceCutLine(sock, sa)) expect(Number.isFinite(pt.x) && Number.isFinite(pt.y)).toBe(true);
        const seams = sock.edges.filter((e) => e.kind === 'seam');
        expect(seams).toHaveLength(p.seams === 1 ? 1 : 2);
        expect(sock.edges.some((e) => e.kind === 'fold')).toBe(p.seams === 1);
        // 1本: 縫い目の足の部分（かかと＋足裏）の長さが、かかとの高さ＋足の長さ
        if (p.seams === 1) {
          const seam = seams[0].segs;
          const foot = seam[seam.length - 1];
          const fl = r.values.foot_length!;
          const fh = r.values.foot_height ?? fl * 0.4;
          expect(pathLength([foot])).toBeGreaterThan((fh * 0.9 + fl) * 0.85);
        }
      });
    }
  }
});

describe('靴下の丈', () => {
  it('くるぶし < クルー < ハイソックス < ニーハイ < オーバーニー', () => {
    const r = resolveBody(SAMPLE_BODIES.find((b) => b.name === 'MDD')!);
    const tops = lengths.map((length) => {
      const res = draftSocks(r, { ...DEFAULT_SOCKS, length });
      return Number(res.info[0].match(/足裏から ([\d.]+)cm/)![1]);
    });
    for (let i = 1; i < tops.length; i++) expect(tops[i]).toBeGreaterThan(tops[i - 1]);
  });
});
