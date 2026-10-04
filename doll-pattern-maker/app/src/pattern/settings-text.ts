// 印刷する型紙に書く「設定の行」（2026-10-04）。画面に出ている設定を「項目：選んだもの」で並べ、ページの幅で折り返す。
// - 「自分で入力」の数値（key が …Custom の数値欄）は、ひとつ前の項目のうしろに（12.0cm）のように付ける
// - 開きの「自動」は、実際にどちらになったかも書く
// - チェックボックスはオンのものだけ、カッコの補足を省いて書く
// - 最後に縫い代

import { resolveOpening } from './opening';
import { FieldCtx, FieldSpec } from './items';
import { SeamAllowance } from './types';

type Params = Record<string, unknown>;

const short = (s: string) => s.replace(/（[^）]*）/g, '').trim();
const num = (x: number) => (Number.isInteger(x) ? String(x) : (Math.round(x * 10) / 10).toFixed(1));

/** 設定を「項目：値」の並びにする */
export function settingsEntries(fields: FieldSpec[], p: Params, ctx: FieldCtx, sa: SeamAllowance): string[] {
  const out: string[] = [];
  for (const f of fields) {
    if (f.show && !f.show(p, ctx)) continue;
    const val = p[f.key];
    if (f.kind === 'checkbox') {
      if (val === true) out.push(short(f.label));
      continue;
    }
    if (f.kind === 'number') {
      const text = typeof val === 'number' && Number.isFinite(val) ? `${num(val)}${f.unit ?? ''}` : null;
      if (f.key.endsWith('Custom') && out.length > 0) {
        if (text) out[out.length - 1] += `（${text}）`;
      } else if (text) {
        out.push(`${short(f.label)}：${text}`);
      }
      continue;
    }
    const opt = f.options.find(([k]) => k === val);
    if (!opt) continue;
    let label = opt[1];
    if (f.key === 'opening' && val === 'auto') {
      label = `自動→${resolveOpening(ctx.category, 'auto') === 'back' ? '背中開き' : '前開き'}`;
    }
    out.push(`${short(f.label)}：${label}`);
  }
  out.push(`縫い代：${num(sa.seam)}cm・裾 ${num(sa.hem)}cm・開き ${num(sa.opening)}cm`);
  return out;
}

/** 全角 1・半角 0.55 で数えた文字の幅 */
const widthOf = (s: string) => [...s].reduce((a, ch) => a + (/[\u0000-ÿ]/.test(ch) ? 0.55 : 1), 0);

/** 「 ／ 」でつなぎ、maxChars（全角の文字数）で折り返す。項目の途中では切らない（1 項目が長すぎるときだけ切る） */
export function wrapEntries(entries: string[], maxChars: number): string[] {
  const lines: string[] = [];
  let cur = '';
  for (const e of entries) {
    const next = cur ? `${cur} ／ ${e}` : e;
    if (widthOf(next) <= maxChars || !cur) {
      cur = next;
    } else {
      lines.push(cur);
      cur = e;
    }
    while (widthOf(cur) > maxChars) {
      // 1 項目だけで長すぎる
      let cut = 0;
      let w = 0;
      for (const ch of cur) {
        w += /[\u0000-ÿ]/.test(ch) ? 0.55 : 1;
        if (w > maxChars) break;
        cut += ch.length;
      }
      lines.push(cur.slice(0, cut));
      cur = cur.slice(cut);
    }
  }
  if (cur) lines.push(cur);
  return lines;
}
