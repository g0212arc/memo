import { describe, it, expect } from 'vitest';
import { SAMPLE_BODIES } from '../src/samples';
import { resolveBody } from '../src/model/estimate';
import { BlouseDressParams, BlouseParams, DEFAULT_BLOUSE, DEFAULT_BLOUSE_DRESS, draftBlouse, draftBlouseDress } from '../src/pattern/items/blouse';
import { pathLength } from '../src/geometry/path';
import { dist } from '../src/geometry/vec';
import { pieceCutLine } from '../src/render/geometry';
import { DraftResult } from '../src/pattern/types';

const sa = { seam: 0.5, hem: 0.8, opening: 0.8 };
const blouseSets: [string, Partial<BlouseParams>][] = [
  ['最初（パフ半袖・丸襟）', {}],
  ['パフ長袖・フリル襟・前開き・ジャボ', { sleeve: 'puff-long', collar: 'frill', opening: 'front', jabot: true }],
  ['ビショップ・ボウタイ・背中開き', { sleeve: 'bishop', collar: 'bow', opening: 'back' }],
  ['ボウタイ・前開き・たっぷり・カフス', { collar: 'bow', opening: 'front', puff: 'large', cuff: 'band' }],
  ['袖口フリル・スタンド・丸い裾・チュニック', { cuff: 'frill', collar: 'stand', hem: 'round', length: 'tunic' }],
  ['普通の半袖・襟なし・ウエスト丈・ゆったり', { sleeve: 'short', collar: 'none', length: 'waist', fit: 'loose' }],
  ['普通の長袖', { sleeve: 'long' }],
  ['ノースリーブ・ふくらみ 2.5 倍', { sleeve: 'none', puff: 'custom', puffCustom: 2.5 }],
];
const dressSets: [string, Partial<BlouseDressParams>][] = [
  ['最初（切り替え・ギャザー）', {}],
  ['フレア・背中開き・サッシュ', { skirt: 'flare', opening: 'back', sash: true }],
  ['フレア・前開き・足首', { skirt: 'flare', opening: 'front', length: 'ankle' }],
  ['ティアード・背中開き', { skirt: 'tiered', opening: 'back' }],
  ['ティアード・前開き・ミニ', { skirt: 'tiered', opening: 'front', length: 'mini' }],
  ['切り替えなし・ストン・前開き', { shape: 'none', opening: 'front' }],
  ['切り替えなし・Aライン・背中開き・ミモレ', { shape: 'none', silhouette: 'aline', opening: 'back', length: 'midi' }],
];

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
const ids = (res: DraftResult) => res.pieces.map((pc) => pc.id);

describe('ブラウス（サンプル全ボディ × 設定）', () => {
  for (const body of SAMPLE_BODIES) {
    for (const [label, q] of blouseSets) {
      it(`${body.name} / ${label}`, () => {
        const r = resolveBody(body);
        const p = { ...DEFAULT_BLOUSE, ...q };
        const res = draftBlouse(r, p);
        checkClosed(res);
        const has = ids(res);
        expect(has.includes('sleeve')).toBe(p.sleeve !== 'none');
        expect(has.includes('armhole-binding')).toBe(p.sleeve === 'none');
        expect(has.includes('collar')).toBe(p.collar === 'round');
        expect(has.includes('stand')).toBe(p.collar === 'stand');
        expect(has.includes('frill-collar')).toBe(p.collar === 'frill');
        expect(has.includes('bow')).toBe(p.collar === 'bow');
        expect(has.includes('jabot')).toBe(p.jabot);
        if (p.sleeve.startsWith('puff')) {
          // パフ: 袖山は袖ぐりより長く（ギャザー）、袖下は前後同じ
          const sl = res.pieces.find((pc) => pc.id === 'sleeve')!;
          const cap = sl.edges.filter((e) => e.name.startsWith('袖山')).reduce((a, e) => a + pathLength(e.segs), 0);
          const ah = res.pieces.filter((pc) => pc.id === 'front' || pc.id === 'back').reduce((a, pc) => a + pathLength(pc.edges.find((e) => e.name === '袖ぐり')!.segs), 0);
          expect(cap).toBeGreaterThan(ah * 1.15);
          const under = sl.edges.filter((e) => e.name === '袖下').map((e) => pathLength(e.segs));
          expect(Math.abs(under[0] - under[1])).toBeLessThan(0.05);
        }
        if (p.sleeve === 'puff-long' || p.sleeve === 'bishop' || p.sleeve === 'long' || (p.sleeve === 'puff-short' && p.cuff === 'band')) expect(has).toContain('cuff');
      });
    }
  }
});

describe('ブラウスワンピース（サンプル全ボディ × 設定）', () => {
  for (const body of SAMPLE_BODIES) {
    for (const [label, q] of dressSets) {
      it(`${body.name} / ${label}`, () => {
        const r = resolveBody(body);
        const p = { ...DEFAULT_BLOUSE_DRESS, ...q };
        const res = draftBlouseDress(r, p);
        checkClosed(res);
        const has = ids(res);
        expect(has.includes('sash')).toBe(p.sash);
        if (p.shape === 'waist') {
          expect(has).toContain('skirt-front');
          expect(has).toContain('skirt-back');
          // 開きはスカートにも続く（前開きは前スカート、背中開きは後ろスカート）
          const front = res.pieces.find((pc) => pc.id === 'front')!;
          const frontOpen = front.cut.startsWith('2');
          const opened = res.pieces.find((pc) => pc.id === (frontOpen ? 'skirt-front' : 'skirt-back'))!;
          expect(opened.edges.some((e) => e.kind === 'opening')).toBe(true);
          expect(res.pieces.find((pc) => pc.id === 'front')!.edges.some((e) => e.name === 'ウエスト')).toBe(true);
        } else {
          expect(has).not.toContain('skirt-front');
          const back = res.pieces.find((pc) => pc.id === 'back')!;
          if (back.cut.startsWith('2')) {
            // 背中開きは途中で止めて、下は縫う
            expect(back.edges.some((e) => e.name === '後ろ中心')).toBe(true);
            expect(back.edges.some((e) => e.kind === 'opening')).toBe(true);
          }
        }
      });
    }
  }
});
