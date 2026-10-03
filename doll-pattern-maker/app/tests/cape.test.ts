import { describe, it, expect } from 'vitest';
import { SAMPLE_BODIES } from '../src/samples';
import { resolveBody } from '../src/model/estimate';
import { draftCape, DEFAULT_CAPE, CapeParams } from '../src/pattern/items/cape';
import { pathLength } from '../src/geometry/path';
import { dist } from '../src/geometry/vec';
import { pieceCutLine } from '../src/render/geometry';
import { Piece } from '../src/pattern/types';

const sa = { seam: 0.5, hem: 0.8, opening: 0.8 };
const settings: [string, Partial<CapeParams>][] = [
  ['初期設定（半円・腰まで・丸い折り襟）', {}],
  ['1/4 円・肩まで・スタンド・裏地なし', { flare: 'quarter', length: 'shoulder', collar: 'stand', lining: false }],
  ['全円・足首・フード・スリット', { flare: 'full', length: 'ankle', collar: 'hood', slit: true }],
  ['3/4 円・肘まで・襟なし・スナップ', { flare: 'three', length: 'elbow', collar: 'none', closure: 'snap' }],
  ['半円・自分で入力', { length: 'custom', lengthCustom: 12 }],
];
const len = (pc: Piece, name: string) => pathLength(pc.edges.filter((e) => e.name === name).flatMap((e) => e.segs));
const FR = { quarter: 0.25, half: 0.5, three: 0.75, full: 1 };

describe('マント・ケープ（サンプル全ボディ × 設定）', () => {
  for (const body of SAMPLE_BODIES) {
    for (const [label, params] of settings) {
      it(`${body.name} / ${label}`, () => {
        const r = resolveBody(body);
        const p = { ...DEFAULT_CAPE, ...params };
        const res = draftCape(r, p);
        const cape = res.pieces.find((x) => x.id === 'cape')!;
        expect(!!res.pieces.find((x) => x.id === 'cape-lining')).toBe(p.lining);
        for (const piece of res.pieces) {
          for (let i = 0; i < piece.edges.length; i++) {
            const a = piece.edges[i].segs.at(-1)!.to;
            const b = piece.edges[(i + 1) % piece.edges.length].segs[0].from;
            expect(dist(a, b)).toBeLessThan(1e-9);
          }
          for (const pt of pieceCutLine(piece, sa)) expect(Number.isFinite(pt.x) && Number.isFinite(pt.y)).toBe(true);
        }
        // 丈 ＝ 前端の長さ、裾まわり ＝ (内側の半径 ＋ 丈) × 角度
        const L = len(cape, '前端');
        if (p.length === 'custom') expect(L).toBeCloseTo(12, 6);
        const neckHalf = len(cape, '襟ぐり');
        const theta = 2 * Math.PI * FR[p.flare];
        const rIn = (neckHalf * 2) / theta;
        // 円弧は 3 次ベジェで近似しているので、0.05% までの差は許す
        expect(Math.abs(len(cape, '裾') * 2 - (rIn + L) * theta) / ((rIn + L) * theta)).toBeLessThan(5e-4);
        // 襟は襟ぐりの長さに合う
        const collar = res.pieces.find((x) => x.id === 'collar' || x.id === 'hood' || x.id === 'binding')!;
        if (p.collar === 'round') expect(len(collar, '襟付け')).toBeCloseTo(neckHalf, 2);
        if (p.collar === 'hood') expect(len(collar, '襟付け')).toBeGreaterThan(neckHalf * 0.9);
        if (p.collar === 'stand' || p.collar === 'none') {
          const top = collar.edges[0].segs[0];
          expect(Math.abs(top.to.x - top.from.x)).toBeCloseTo(neckHalf * 2, 6);
        }
      });
    }
  }
});

describe('マント・ケープの丈', () => {
  it('肩 < 肘 < 腰 < 膝 < 足首', () => {
    const r = resolveBody(SAMPLE_BODIES.find((b) => b.name === 'MDD')!);
    const L = (length: CapeParams['length']) => len(draftCape(r, { ...DEFAULT_CAPE, length }).pieces[0], '前端');
    const ls = (['shoulder', 'elbow', 'waist', 'knee', 'ankle'] as const).map(L);
    for (let i = 1; i < ls.length; i++) expect(ls[i]).toBeGreaterThan(ls[i - 1]);
  });
  it('1/4 円の長い丈で腕が動かしにくいときは警告', () => {
    const r = resolveBody(SAMPLE_BODIES.find((b) => b.name === 'MDD')!);
    const res = draftCape(r, { ...DEFAULT_CAPE, flare: 'quarter', length: 'knee' });
    expect(res.warnings.join()).toContain('半円以上');
  });
});
