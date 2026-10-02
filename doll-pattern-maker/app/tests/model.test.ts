import { describe, it, expect } from 'vitest';
import { parseImport, extractJsonCandidates } from '../src/model/body';
import { resolveBody } from '../src/model/estimate';
import { buildImportPrompt } from '../src/model/prompt';
import { SAMPLE_BODIES } from '../src/samples';
import { MEASUREMENTS } from '../src/model/schema';

describe('取り込み', () => {
  it('前後に説明文がある返答から JSON を取り出せる', () => {
    const text = 'はい、書き写しました。\n```json\n{"schema":"doll-body/v1","name":"A","measurements":{"chest_circ":{"value":"≈15.2","raw_label":"胸围"}}}\n```\n以上です。';
    const r = parseImport(text);
    expect(r.errors).toEqual([]);
    expect(r.bodies).toHaveLength(1);
    expect(r.bodies[0].measurements.chest_circ?.value).toBe(15.2);
  });

  it('コードブロックがなくても { } を探して複数ボディを取り込める', () => {
    const text = '{"name":"A","measurements":{"neck_circ":4}} と {"name":"B","measurements":{"neck_circ":6.6}}';
    expect(extractJsonCandidates(text)).toHaveLength(2);
    const r = parseImport(text);
    expect(r.bodies.map((b) => b.name)).toEqual(['A', 'B']);
  });

  it('未知のキーはその他に回して警告する', () => {
    const r = parseImport('{"name":"A","measurements":{"foo":1,"chest_circ":10}}');
    expect(r.bodies[0].unmapped[0].raw_label).toBe('foo');
    expect(r.warnings.some((w) => w.includes('foo'))).toBe(true);
  });

  it('ウエストがヒップと取り違えられていそうなら警告する', () => {
    const r = parseImport('{"name":"A","measurements":{"chest_circ":10,"waist_circ":20}}');
    expect(r.warnings.some((w) => w.includes('取り違え'))).toBe(true);
  });

  it('JSON がなければエラー', () => {
    expect(parseImport('こんにちは').errors.length).toBe(1);
  });
});

describe('プロンプト', () => {
  it('ツールが推定するだけの項目以外、全項目が対応表に入っている', () => {
    const p = buildImportPrompt();
    for (const d of MEASUREMENTS.filter((d) => !d.toolOnly)) expect(p).toContain(`${d.key}:`);
  });
});

describe('推定（サンプル5体）', () => {
  for (const body of SAMPLE_BODIES) {
    it(`${body.name}: Tシャツに必要な項目が埋まり、背丈が胸囲の 30〜75% に収まる`, () => {
      const r = resolveBody(body);
      for (const k of ['back_length', 'front_length', 'armhole_circ', 'upper_arm_circ', 'waist_to_hip'] as const) {
        expect(r.values[k]).toBeGreaterThan(0);
      }
      const ratio = r.values.back_length! / r.values.chest_circ!;
      expect(ratio).toBeGreaterThanOrEqual(0.3);
      expect(ratio).toBeLessThanOrEqual(0.75);
    });
  }

  it('メーカー値は推定で上書きしない', () => {
    const r = resolveBody(SAMPLE_BODIES.find((b) => b.name === '甜瓜体')!);
    expect(r.sources.upper_arm_circ).toBe('maker');
    expect(r.values.upper_arm_circ).toBe(4.2);
  });

  it('甘蔗三代は外脚長−股下が短すぎるので股上をヒップから推定し、警告する', () => {
    const r = resolveBody(SAMPLE_BODIES.find((b) => b.name === '甘蔗三代')!);
    expect(r.notes.rise).toBe('ヒップ × 0.25');
    expect(r.warnings.some((w) => w.includes('股上'))).toBe(true);
  });

  it('バリエーションを選ぶとその値が使われる', () => {
    const d = SAMPLE_BODIES.find((b) => b.name === '大福体 四分')!;
    expect(resolveBody(d, { chest_circ: 3 }).values.chest_circ).toBe(17.7);
  });
});

describe('カテゴリ', async () => {
  const { normalizeCategory, guessCategory, CATEGORIES } = await import('../src/model/category');

  it('サンプルは全部カテゴリが決まっている', () => {
    for (const b of SAMPLE_BODIES) expect(CATEGORIES).toContain(b.category);
  });

  it('表記ゆれを正規化する', () => {
    expect(normalizeCategory('四分')).toBe('1/4');
    expect(normalizeCategory('六分')).toBe('1/6');
    expect(normalizeCategory('1／3')).toBe('1/3');
    expect(normalizeCategory('特六')).toBe('特六');
    expect(normalizeCategory('叔体')).toBe('叔体');
    expect(normalizeCategory('なにか')).toBeNull();
  });

  it('取り込み時にカテゴリを読む。分からない表記は警告して身長から仮にする', () => {
    const ok = parseImport('{"name":"A","category":"四分","measurements":{"chest_circ":20}}');
    expect(ok.bodies[0].category).toBe('1/4');
    const ng = parseImport('{"name":"B","category":"謎","measurements":{"height_with_head":30,"chest_circ":12}}');
    expect(ng.bodies[0].category).toBeUndefined();
    expect(ng.warnings.some((w) => w.includes('カテゴリ'))).toBe(true);
    const r = resolveBody(ng.bodies[0]);
    expect(r.category).toBe('1/6');
    expect(r.categoryGuessed).toBe(true);
  });

  it('身長から仮のカテゴリを出す', () => {
    const mk = (m: Record<string, number>) => parseImport(JSON.stringify({ name: 'x', measurements: m })).bodies[0];
    expect(guessCategory(mk({ height_with_head: 45 }))).toBe('1/4');
    expect(guessCategory(mk({ height: 48 }))).toBe('1/3');
    expect(guessCategory(mk({ chest_circ: 10 }))).toBeNull();
  });

  it('プロンプトにカテゴリの説明が入っている', () => {
    expect(buildImportPrompt()).toContain('category');
  });
});

describe('タイプ（同じボディの別タイプ）', () => {
  it('MDD は 標準 と もちあし を選べ、もちあしでは上書きした値が使われる', () => {
    const mdd = SAMPLE_BODIES.find((b) => b.name === 'MDD')!;
    expect(mdd.types?.map((t) => t.label)).toEqual(['標準（S胸）', 'もちあし（L胸）']);
    const std = resolveBody(mdd, {}, 0);
    const mochi = resolveBody(mdd, {}, 1);
    expect(std.values.hip_circ).toBe(19);
    expect(mochi.values.hip_circ).toBe(22);
    expect(mochi.values.chest_circ).toBe(18.8);
    // 上書きしていない値はそのまま
    expect(mochi.values.neck_circ).toBe(8);
  });

  it('取り込み時にタイプを読む（1つしかなければタイプなし扱い）', () => {
    const r = parseImport('{"name":"A","measurements":{"chest_circ":15},"types":[{"label":"標準","measurements":{}},{"label":"L","measurements":{"chest_circ":18}}]}');
    expect(r.bodies[0].types).toHaveLength(2);
    expect(resolveBody(r.bodies[0], {}, 1).values.chest_circ).toBe(18);
    const one = parseImport('{"name":"B","measurements":{"chest_circ":15},"types":[{"label":"標準","measurements":{}}]}');
    expect(one.bodies[0].types).toBeUndefined();
  });
});
