// ブラウザ内保存。プライベートブラウズなどで使えない場合も、保存されないだけで動くようにする。

import { Body } from './model/body';
import { VariantSelection } from './model/estimate';
import { TshirtParams } from './pattern/items/tshirt';
import { SeamAllowance } from './pattern/types';

const BODIES_KEY = 'dpm.bodies.v1';
const STATE_KEY = 'dpm.state.v1';

export interface UiState {
  bodyId: string;
  variants: Record<string, VariantSelection>;
  /** ボディごとに選んだタイプ */
  types?: Record<string, number>;
  tshirt: TshirtParams;
  sa: SeamAllowance;
}

export function loadBodies(): Body[] {
  try {
    const raw = localStorage.getItem(BODIES_KEY);
    const arr = raw ? (JSON.parse(raw) as Body[]) : [];
    return Array.isArray(arr) ? arr : [];
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
