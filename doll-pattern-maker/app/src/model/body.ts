// ボディの型と、Claude アプリの返答（貼り付け文）からの取り込み。

import { isMeasurementKey, MeasurementKey, DEF_BY_KEY } from './schema';

export type ValueSource = 'maker' | 'measured' | 'estimated';

export interface Variant {
  label: string;
  value: number;
}

export interface Measurement {
  value: number;
  raw_label?: string;
  variants?: Variant[];
  /** 取り込み時は maker。画面で書き換えると measured */
  source?: 'maker' | 'measured';
}

export interface Unmapped {
  raw_label: string;
  value?: number;
  note?: string;
}

export interface Body {
  schema: 'doll-body/v1';
  id: string;
  name: string;
  maker?: string;
  source?: string;
  measurements: Partial<Record<MeasurementKey, Measurement>>;
  unmapped: Unmapped[];
  ambiguities: string[];
  /** 組み込みサンプル（編集不可） */
  sample?: boolean;
}

export interface ImportResult {
  bodies: Body[];
  /** 取り込めなかった理由 */
  errors: string[];
  /** 取り込めたが確認してほしい点（ボディ名付き） */
  warnings: string[];
}

export function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `body-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** 貼り付け文から JSON の候補文字列を取り出す。コードブロックを優先し、なければ { } の対応で探す */
export function extractJsonCandidates(text: string): string[] {
  const blocks = [...text.matchAll(/```(?:json|jsonc)?\s*\n?([\s\S]*?)```/g)].map((m) => m[1].trim());
  if (blocks.length > 0) return blocks;

  const out: string[] = [];
  let depth = 0;
  let start = -1;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}' && depth > 0) {
      depth--;
      if (depth === 0 && start >= 0) out.push(text.slice(start, i + 1));
    }
  }
  return out;
}

/** "≈15.2" や "15.2cm" のような表記も数値にする */
export function toNumber(x: unknown): number | null {
  if (typeof x === 'number') return Number.isFinite(x) ? x : null;
  if (typeof x === 'string') {
    const m = x.replace(/,/g, '.').match(/-?\d+(?:\.\d+)?/);
    return m ? Number(m[0]) : null;
  }
  return null;
}

function stripJsonComments(s: string): string {
  // jsonc の行コメントを外す（文字列中の // は対象外になるよう、行頭か空白の後のみ）
  return s.replace(/(^|\s)\/\/.*$/gm, '$1');
}

export function parseImport(text: string): ImportResult {
  const res: ImportResult = { bodies: [], errors: [], warnings: [] };
  const candidates = extractJsonCandidates(text);
  if (candidates.length === 0) {
    res.errors.push('JSON が見つかりませんでした。Claude アプリの返答をそのまま全部貼り付けてください。');
    return res;
  }

  for (const c of candidates) {
    let data: unknown;
    try {
      data = JSON.parse(stripJsonComments(c));
    } catch (e) {
      res.errors.push(`JSON として読めない部分がありました: ${(e as Error).message}`);
      continue;
    }
    const items = Array.isArray(data) ? data : [data];
    for (const item of items) {
      const r = normalizeBody(item);
      if (typeof r === 'string') res.errors.push(r);
      else {
        res.bodies.push(r.body);
        res.warnings.push(...r.warnings.map((w) => `【${r.body.name}】${w}`));
      }
    }
  }
  return res;
}

export function normalizeBody(raw: unknown): { body: Body; warnings: string[] } | string {
  if (!raw || typeof raw !== 'object') return 'ボディのデータ形式ではありません。';
  const o = raw as Record<string, unknown>;
  const warnings: string[] = [];
  const mRaw = o.measurements;
  if (!mRaw || typeof mRaw !== 'object') return 'measurements（採寸値）がありません。';

  const body: Body = {
    schema: 'doll-body/v1',
    id: typeof o.id === 'string' && o.id ? o.id : newId(),
    name: typeof o.name === 'string' && o.name.trim() ? o.name.trim() : '名称未設定',
    maker: typeof o.maker === 'string' && o.maker ? o.maker : undefined,
    source: typeof o.source === 'string' && o.source ? o.source : undefined,
    measurements: {},
    unmapped: [],
    ambiguities: Array.isArray(o.ambiguities) ? o.ambiguities.filter((a): a is string => typeof a === 'string') : [],
  };

  if (Array.isArray(o.unmapped)) {
    for (const u of o.unmapped) {
      if (u && typeof u === 'object' && typeof (u as Unmapped).raw_label === 'string') {
        const uu = u as Record<string, unknown>;
        body.unmapped.push({
          raw_label: uu.raw_label as string,
          value: toNumber(uu.value) ?? undefined,
          note: typeof uu.note === 'string' ? uu.note : undefined,
        });
      }
    }
  }

  for (const [key, val] of Object.entries(mRaw as Record<string, unknown>)) {
    if (!isMeasurementKey(key)) {
      const n = val && typeof val === 'object' ? toNumber((val as Record<string, unknown>).value) : toNumber(val);
      body.unmapped.push({ raw_label: key, value: n ?? undefined, note: '未知のキー' });
      warnings.push(`未知の項目「${key}」は取り込まず、その他の項目に回しました。`);
      continue;
    }
    const m = normalizeMeasurement(val);
    if (!m) {
      warnings.push(`「${DEF_BY_KEY[key].ja}」の値が数値として読めませんでした。`);
      continue;
    }
    if (m.value <= 0) {
      warnings.push(`「${DEF_BY_KEY[key].ja}」が 0 以下なので取り込みませんでした。`);
      continue;
    }
    body.measurements[key] = m;
  }

  warnings.push(...plausibilityWarnings(body));
  warnings.push(...body.ambiguities.map((a) => `曖昧な点: ${a}`));
  return { body, warnings };
}

function normalizeMeasurement(val: unknown): Measurement | null {
  if (typeof val === 'number' || typeof val === 'string') {
    const n = toNumber(val);
    return n === null ? null : { value: n, source: 'maker' };
  }
  if (!val || typeof val !== 'object') return null;
  const o = val as Record<string, unknown>;
  const variants: Variant[] = [];
  if (Array.isArray(o.variants)) {
    for (const vr of o.variants) {
      if (!vr || typeof vr !== 'object') continue;
      const n = toNumber((vr as Record<string, unknown>).value);
      if (n === null || n <= 0) continue;
      const label = (vr as Record<string, unknown>).label;
      variants.push({ label: typeof label === 'string' && label ? label : String(n), value: n });
    }
  }
  const value = toNumber(o.value) ?? variants[0]?.value ?? null;
  if (value === null) return null;
  const m: Measurement = { value, source: o.source === 'measured' ? 'measured' : 'maker' };
  if (typeof o.raw_label === 'string') m.raw_label = o.raw_label;
  if (variants.length > 1 || (variants.length === 1 && variants[0].value !== value)) m.variants = variants;
  return m;
}

/** あり得ない値の組み合わせを探す */
export function plausibilityWarnings(body: Body): string[] {
  const w: string[] = [];
  const g = (k: MeasurementKey) => body.measurements[k]?.value;
  const height = g('height') ?? g('height_with_head');
  if (height) {
    for (const k of ['chest_circ', 'waist_circ', 'hip_circ', 'inseam', 'arm_length', 'shoulder_width'] as MeasurementKey[]) {
      const x = g(k);
      if (x && x >= height) w.push(`「${DEF_BY_KEY[k].ja}」(${x}cm) が身長 (${height}cm) 以上です。値を確認してください。`);
    }
  }
  const neck = g('neck_circ');
  const chest = g('chest_circ');
  if (neck && chest && neck >= chest) w.push(`首回り (${neck}cm) が胸囲 (${chest}cm) 以上です。値を確認してください。`);
  const waist = g('waist_circ');
  if (waist && chest && waist > chest * 1.5) w.push(`ウエスト (${waist}cm) が胸囲 (${chest}cm) に比べて大きすぎます。「腰围」をヒップと取り違えていないか確認してください。`);
  const hw = g('height_with_head');
  const h = g('height');
  if (hw && h && h >= hw) w.push('身長（頭なし）が身長（頭込み）以上です。');
  return w;
}
