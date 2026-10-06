import { describe, it, expect } from 'vitest';
import { SAMPLE_BODIES } from '../src/samples';
import { resolveBody } from '../src/model/estimate';
import { ApronParams, DEFAULT_APRON, draftApron } from '../src/pattern/items/apron';
import { BoleroParams, DEFAULT_BOLERO, draftBolero } from '../src/pattern/items/bolero';
import { pathLength } from '../src/geometry/path';
import { dist } from '../src/geometry/vec';
import { pieceCutLine } from '../src/render/geometry';
import { DraftResult } from '../src/pattern/types';

const sa = { seam: 0.5, hem: 0.8, opening: 0.8 };
function checkClosed(res: DraftResult) {
  for (const pc of res.pieces) {
    for (let i = 0; i < pc.edges.length; i++) {
      const a = pc.edges[i].segs.at(-1)!.to;
      const b = pc.edges[(i + 1) % pc.edges.length].segs[0].from;
      expect(dist(a, b), `${pc.name} ${pc.edges[i].name}`).toBeLessThan(1e-6);
    }
    for (const pt of pieceCutLine(pc, sa)) expect(Number.isFinite(pt.x) && Number.isFinite(pt.y)).toBe(true);
  }
}
const apronSets: [string, Partial<ApronParams>][] = [
  ['最初（胸当て・ギャザー・フリル・クロス）', {}],
  ['腰エプロン・台形・フリルなし・ミニ', { type: 'waist', skirt: 'flat', frill: false, length: 'mini' }],
  ['首かけ・ポケット・足首', { straps: 'neck', pocket: true, length: 'ankle' }],
];
const boleroSets: [string, Partial<BoleroParams>][] = [
  ['最初（長袖・胸の下・丸く）', {}],
  ['半袖・ウエスト・まっすぐ・リボン', { sleeve: 'short', length: 'waist', front: 'straight', closure: 'ribbon' }],
  ['パフ・フリル', { sleeve: 'puff', frill: true }],
  ['ノースリーブ', { sleeve: 'none' }],
];

describe('エプロン（サンプル全ボディ × 設定）', () => {
  for (const body of SAMPLE_BODIES) {
    for (const [label, q] of apronSets) {
      it(`${body.name} / ${label}`, () => {
        const p = { ...DEFAULT_APRON, ...q };
        const res = draftApron(resolveBody(body), p);
        checkClosed(res);
        const ids = res.pieces.map((pc) => pc.id);
        expect(ids.includes('bib')).toBe(p.type === 'bib');
        expect(ids.includes('frill')).toBe(p.frill);
        expect(ids.includes('bib-frill')).toBe(p.frill && p.type === 'bib');
        expect(ids.includes('pocket')).toBe(p.pocket);
        // ベルトは前のウエスト ＋ 腰ひも 2 本ぶん、スカート部より長い
        const band = res.pieces.find((pc) => pc.id === 'waistband')!;
        const skirtTop = pathLength(res.pieces.find((pc) => pc.id === 'apron-skirt')!.edges[0].segs);
        expect(pathLength(band.edges[0].segs)).toBeGreaterThan(skirtTop);
      });
    }
  }
});

describe('ボレロ（サンプル全ボディ × 設定）', () => {
  for (const body of SAMPLE_BODIES) {
    for (const [label, q] of boleroSets) {
      it(`${body.name} / ${label}`, () => {
        const p = { ...DEFAULT_BOLERO, ...q };
        const res = draftBolero(resolveBody(body), p);
        checkClosed(res);
        const ids = res.pieces.map((pc) => pc.id);
        expect(ids.includes('sleeve')).toBe(p.sleeve !== 'none');
        expect(ids.includes('ribbon')).toBe(p.closure === 'ribbon');
        expect(ids.includes('frill')).toBe(p.frill);
        const front = res.pieces.find((pc) => pc.id === 'front')!;
        const back = res.pieces.find((pc) => pc.id === 'back')!;
        expect(Math.abs(pathLength(front.edges.find((e) => e.name === '肩')!.segs) - pathLength(back.edges.find((e) => e.name === '肩')!.segs))).toBeLessThan(0.05);
        // 前中心で突き合わせ（重なりなし）
        expect(Math.min(...front.edges.flatMap((e) => e.segs.map((s) => s.to.x)))).toBeGreaterThanOrEqual(-1e-6);
      });
    }
  }
});
