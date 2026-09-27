// 組み込みサンプル（../samples/bodies の5体）。参考・テスト用。

import { Body, normalizeBody } from './model/body';
import falcon from '../../samples/bodies/falcon.json';
import daifuku4 from '../../samples/bodies/daifuku-1-4.json';
import kansho3 from '../../samples/bodies/kansho3.json';
import daifuku6 from '../../samples/bodies/daifuku-1-6.json';
import melon from '../../samples/bodies/melon.json';

const RAW: [string, unknown][] = [
  ['sample-falcon', falcon],
  ['sample-daifuku-1-4', daifuku4],
  ['sample-kansho3', kansho3],
  ['sample-daifuku-1-6', daifuku6],
  ['sample-melon', melon],
];

export const SAMPLE_BODIES: Body[] = RAW.map(([id, raw]) => {
  const r = normalizeBody({ ...(raw as object), id });
  if (typeof r === 'string') throw new Error(`サンプル ${id} が読めません: ${r}`);
  return { ...r.body, sample: true };
});
