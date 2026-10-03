import { describe, it, expect } from 'vitest';
import { SAMPLE_BODIES } from '../src/samples';
import { resolveBody } from '../src/model/estimate';
import { draftYukata, DEFAULT_YUKATA, YukataParams } from '../src/pattern/items/yukata';
import { pathLength } from '../src/geometry/path';
import { dist } from '../src/geometry/vec';
import { pieceCutLine } from '../src/render/geometry';
import { Piece } from '../src/pattern/types';

const sa = { seam: 0.5, hem: 0.8, opening: 0.8 };
const settings: [string, Partial<YukataParams>][] = [
  ['初期設定（簡単・女物・半幅の作り帯）', {}],
  ['本来・男物・元禄袖・半幅帯', { build: 'authentic', gender: 'men', sleeveShape: 'genroku', tsukuri: false }],
  ['本来・女物・兵児帯の作り帯', { build: 'authentic', obi: 'heko', tsukuri: true }],
  ['簡単・男物・兵児帯・袖丈を入力', { gender: 'men', obi: 'heko', tsukuri: false, sleeveLen: 'custom', sleeveLenCustom: 4 }],
];
const len = (pc: Piece, prefix: string) => pathLength(pc.edges.filter((e) => e.name.startsWith(prefix)).flatMap((e) => e.segs));

describe('浴衣（サンプル全ボディ × 設定）', () => {
  for (const body of SAMPLE_BODIES) {
    for (const [label, params] of settings) {
      it(`${body.name} / ${label}`, () => {
        const r = resolveBody(body);
        const p = { ...DEFAULT_YUKATA, ...params };
        const res = draftYukata(r, p);
        const by = (id: string) => res.pieces.find((x) => x.id === id);
        for (const id of ['body', 'eri', 'sode']) expect(by(id)).toBeTruthy();
        expect(!!by('okumi')).toBe(p.build === 'authentic');
        expect(!!by('tomoeri')).toBe(p.build === 'authentic');
        expect(!!by('obi')).toBe(!p.tsukuri);
        expect(!!by('obi-do') && !!by('obi-hane') && !!by('obi-tare') && !!by('obi-musubi')).toBe(p.tsukuri);
        for (const piece of res.pieces) {
          for (let i = 0; i < piece.edges.length; i++) {
            const a = piece.edges[i].segs.at(-1)!.to;
            const b = piece.edges[(i + 1) % piece.edges.length].segs[0].from;
            expect(dist(a, b)).toBeLessThan(1e-9);
          }
          for (const pt of pieceCutLine(piece, sa)) expect(Number.isFinite(pt.x) && Number.isFinite(pt.y)).toBe(true);
        }
        const bd = by('body')!;
        const sode = by('sode')!;
        // 身頃と袖の袖付けの長さがそろう
        expect(len(bd, '袖付け')).toBeCloseTo(len(sode, '袖付け') - (p.gender === 'men' ? len(sode, '袖付け下') : 0), 6);
        // 女物だけ身八つ口・振り
        expect(bd.edges.some((e) => e.name.startsWith('身八つ口'))).toBe(p.gender === 'women');
        expect(sode.edges.some((e) => e.name === '振り')).toBe(p.gender === 'women');
        // 衿の長さ（片側）＝ 身頃の衿付け ＋ 衽の衿付け
        const eriTop = by('eri')!.edges[0].segs[0];
        const attach = len(bd, '衿付け') + (by('okumi') ? len(by('okumi')!, '衿付け') : 0);
        expect(Math.abs(eriTop.to.x - eriTop.from.x)).toBeCloseTo(attach, 6);
        // 本来の作り: 衽付けの長さが身頃と衽でそろう
        if (by('okumi')) expect(len(by('okumi')!, '衽付け')).toBeCloseTo(len(bd, '衽付け'), 6);
      });
    }
  }
});
