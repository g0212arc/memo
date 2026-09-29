// 組み込みサンプル（../samples/bodies/*.json）。参考・テスト用。
// JSON を置くだけで読み込まれる。id は「sample-ファイル名」（保存済みの選択状態と対応させるため変えない）。

import { Body, normalizeBody } from './model/body';

const files = import.meta.glob('../../samples/bodies/*.json', { eager: true, import: 'default' });

/** 表示順。ここにないファイルは後ろに名前順で並ぶ */
const ORDER = [
  'falcon',
  'daifuku-1-4',
  'kansho3',
  'daifuku-1-6',
  'melon',
  'sdm-female',
  'mdd',
  'luyun',
  'dasi-male-slim',
  'torakujira',
  'sk43',
  'hiren-2',
  'kohaku',
  'kakoi-h',
];

const slugOf = (path: string) => path.split('/').pop()!.replace(/\.json$/, '');
const rank = (slug: string) => {
  const i = ORDER.indexOf(slug);
  return i < 0 ? ORDER.length : i;
};

export const SAMPLE_BODIES: Body[] = Object.entries(files)
  .map(([path, raw]) => ({ slug: slugOf(path), raw }))
  .sort((a, b) => rank(a.slug) - rank(b.slug) || a.slug.localeCompare(b.slug))
  .map(({ slug, raw }) => {
    const id = `sample-${slug}`;
    const r = normalizeBody({ ...(raw as object), id });
    if (typeof r === 'string') throw new Error(`サンプル ${id} が読めません: ${r}`);
    return { ...r.body, sample: true };
  });
