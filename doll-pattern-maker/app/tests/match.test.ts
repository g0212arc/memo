import { describe, it, expect } from 'vitest';
import { SAMPLE_BODIES } from '../src/samples';
import { resolveBody } from '../src/model/estimate';
import { ITEMS } from '../src/pattern/items';
import { MATCH_RULES } from '../src/pattern/items/matches';
import { applyMatches, resolvedRefs, letterOf } from '../src/pattern/match';
import { DraftResult } from '../src/pattern/types';

type P = Record<string, unknown>;
/** 初期値 ＋ 選択肢を 1 つずつ変えた設定 */
function variants(item: (typeof ITEMS)[number]): P[] {
  const out: P[] = [item.defaults];
  for (const f of item.fields) {
    if (f.kind === 'radio' || f.kind === 'select') for (const [val] of f.options) out.push({ ...item.defaults, [f.key]: val });
    if (f.kind === 'checkbox') out.push({ ...item.defaults, [f.key]: !item.defaults[f.key] });
  }
  return out;
}

describe('合印の対応表', () => {
  it('letterOf', () => {
    expect([0, 1, 25, 26, 27].map(letterOf)).toEqual(['A', 'B', 'Z', 'AA', 'AB']);
  });
  for (const item of ITEMS) {
    const rules = MATCH_RULES[item.id];
    it(`${item.id}: 対応表がある`, () => expect(rules?.length ?? 0).toBeGreaterThan(0));
    if (!rules) continue;
    it(`${item.id}: 書いた辺が（どれかの設定で）全部見つかる`, () => {
      const found = new Set<string>();
      const r = resolveBody(SAMPLE_BODIES.find((b) => b.name === 'MDD')!);
      for (const p of variants(item)) {
        let res: DraftResult;
        try {
          res = item.draft(r, p);
        } catch {
          continue;
        }
        for (const ref of resolvedRefs(res, rules)) found.add(ref);
      }
      const all = rules.flatMap((x) => [...x.a, ...(x.b ?? [])]);
      expect(all.filter((ref) => !found.has(ref))).toEqual([]);
    });
    for (const body of SAMPLE_BODIES) {
      it(`${item.id} / ${body.name}: 長さが合う・記号は 2 か所以上`, () => {
        const r = resolveBody(body);
        const problems: string[] = [];
        for (const p of variants(item)) {
          let res: DraftResult;
          try {
            res = item.draft(r, p);
          } catch {
            continue;
          }
          // item.draft は記号付き。もう一度付け直して問題を集める
          const plain = { ...res, pieces: res.pieces.map((pc) => ({ ...pc, edges: pc.edges.map((e) => ({ ...e, match: undefined })) })) };
          const { result, problems: pr } = applyMatches(plain, rules);
          for (const x of pr) problems.push(`${JSON.stringify(p)} ${x.letter}: ${x.message}`);
          const count = new Map<string, number>();
          for (const pc of result.pieces) for (const e of pc.edges) if (e.match) count.set(e.match, (count.get(e.match) ?? 0) + 1);
          // a だけの行（左右 2 枚を縫い合わせる）は 1 本でもよい
          for (const [k, c] of count) if (c < 1) problems.push(`${k} が見つからない`);
        }
        expect(problems).toEqual([]);
      });
    }
  }
});
