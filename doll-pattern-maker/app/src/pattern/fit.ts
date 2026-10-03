// フィット感（タイト／普通／余裕あり）と丈（短め／普通／長め）。全アイテム共通。
// フィット感はゆとりにかける掛け率。肘・手が通る余裕（pass）には効かせない（着られなくなるため）。

import { EaseSet } from './ease';

export type Fit = 'tight' | 'normal' | 'loose';
export type LengthPreset = 'short' | 'normal' | 'long';

export const FIT_FACTOR: Record<Fit, number> = { tight: 0.5, normal: 1.0, loose: 1.6 };
export const FIT_LABEL: Record<Fit, string> = { tight: 'タイト', normal: '普通', loose: '余裕あり' };
export const LENGTH_LABEL: Record<LengthPreset, string> = { short: '短め', normal: '普通', long: '長め' };

export function applyFit(e: EaseSet, body: Fit, sleeve: Fit): EaseSet {
  const b = FIT_FACTOR[body];
  const s = FIT_FACTOR[sleeve];
  return { chest: e.chest * b, hip: e.hip * b, arm: e.arm * s, armhole: e.armhole * s, pass: e.pass };
}
