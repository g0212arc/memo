// 設定の選択肢の参考値（2026-10-04）。選択肢ごとに作図して、作図が記録した実際の数値（DraftResult.refs）を集める。
// 画面では「普通（ゆとり 2.7cm）」のように選択肢に付け、自分で入力の欄には目安とプレースホルダーに使う。

import { ResolvedBody } from '../model/estimate';
import { FieldCtx, FieldSpec, ItemDef } from './items';

type Params = Record<string, unknown>;
/** 項目 → 選択肢 → 数値（cm） */
export type OptionRefs = Record<string, Record<string, number>>;

const fmt = (x: number) => (Math.round(x * 10) / 10).toFixed(1);
/** ゆとりの項目は「ゆとり」と書く */
const isEase = (key: string) => key === 'fit' || key === 'fitBody' || key === 'fitSleeve';
export const refText = (key: string, x: number) => `${isEase(key) ? 'ゆとり ' : ''}${fmt(x)}cm`;

/** 選択肢の表示名に参考値を付ける（カッコで終わる名前はカッコの中に足す） */
export function withRef(label: string, key: string, x: number | undefined): string {
  if (x === undefined) return label;
  const t = refText(key, x);
  return label.endsWith('）') ? `${label.slice(0, -1)}・${t}）` : `${label}（${t}）`;
}

export function optionRefs(item: ItemDef, r: ResolvedBody, p: Params, ctx: FieldCtx): OptionRefs {
  let base;
  try {
    base = item.draft(r, p);
  } catch {
    return {};
  }
  const keys = Object.keys(base.refs ?? {});
  const out: OptionRefs = {};
  for (const f of item.fields) {
    if ((f.kind !== 'radio' && f.kind !== 'select') || !keys.includes(f.key)) continue;
    if (f.show && !f.show(p, ctx)) continue;
    const m: Record<string, number> = {};
    for (const [v] of f.options) {
      if (v === 'custom') continue;
      if (f.available && !f.available(v, ctx)) continue;
      try {
        const x = item.draft(r, { ...p, [f.key]: v }).refs?.[f.key];
        if (x !== undefined && Number.isFinite(x)) m[v] = x;
      } catch {
        /* その選択肢では作図できない */
      }
    }
    if (Object.keys(m).length) out[f.key] = m;
  }
  return out;
}

/**
 * 数値の欄が、どの選択肢の項目の「自分で入力」か。
 * 「その項目が自分で入力のときだけ出る欄」をその項目のものとみなす（着丈の欄 hemBelowWaist は丈）
 */
export function refFieldOf(fields: FieldSpec[], f: FieldSpec, p: Params, ctx: FieldCtx): FieldSpec | undefined {
  if (f.kind !== 'number') return undefined;
  if (f.key === 'hemBelowWaist') return fields.find((x) => x.key === 'length');
  if (!f.show) return undefined;
  for (const g of fields) {
    if ((g.kind !== 'radio' && g.kind !== 'select') || !g.options.some(([v]) => v === 'custom')) continue;
    const other = g.options.find(([v]) => v !== 'custom')?.[0];
    if (other !== undefined && f.show({ ...p, [g.key]: 'custom' }, ctx) && !f.show({ ...p, [g.key]: other }, ctx)) return g;
  }
  return undefined;
}
