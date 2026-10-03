// ブラウザ内保存。プライベートブラウズなどで使えない場合も、保存されないだけで動くようにする。

import { Body } from './model/body';
import { VariantSelection } from './model/estimate';
import { SeamAllowance } from './pattern/types';

const BODIES_KEY = 'dpm.bodies.v1';
const STATE_KEY = 'dpm.state.v1';

export interface UiState {
  bodyId: string;
  variants: Record<string, VariantSelection>;
  /** ボディごとに選んだタイプ */
  types?: Record<string, number>;
  /** 選んでいるアイテム */
  item: string;
  /** アイテムごとの設定 */
  params: Record<string, Record<string, unknown>>;
  /** 旧形式（Tシャツだけの頃）の設定。読み込み時に params.tshirt へ移す */
  tshirt?: Record<string, unknown>;
  sa: SeamAllowance;
}

export function loadBodies(): Body[] {
  try {
    const raw = localStorage.getItem(BODIES_KEY);
    const arr = raw ? (JSON.parse(raw) as Body[]) : [];
    // カテゴリのないボディ（カテゴリを取り込みで決めるようになる前に保存したもの。画面では「（仮）」）は、
    // もうカテゴリを付けられないので読み込まない（次に保存したときに消える）。2026-10-03
    return Array.isArray(arr) ? arr.filter((b) => !!b && !!b.category) : [];
  } catch {
    return [];
  }
}

export function saveBodies(bodies: Body[]) {
  try {
    localStorage.setItem(BODIES_KEY, JSON.stringify(bodies.filter((b) => !b.sample)));
  } catch {
    /* 保存できない環境では何もしない */
  }
}

export function loadState(): Partial<UiState> {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    return raw ? (JSON.parse(raw) as Partial<UiState>) : {};
  } catch {
    return {};
  }
}

export function saveState(s: UiState) {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(s));
  } catch {
    /* 同上 */
  }
}
