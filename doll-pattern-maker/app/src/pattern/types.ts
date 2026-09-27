// 型紙パーツの型。単位は cm。

import { Seg } from '../geometry/path';
import { Vec } from '../geometry/vec';

/** 辺の種類。縫い代の幅は種類ごとに決まる */
export type EdgeKind = 'seam' | 'hem' | 'fold' | 'opening';

export interface Edge {
  segs: Seg[];
  kind: EdgeKind;
  /** 画面に出す名前（例: 袖ぐり） */
  name: string;
}

export interface Piece {
  id: string;
  name: string;
  /** 裁ち方（例: 1枚（わ）） */
  cut: string;
  /** 閉じた輪になるよう、順番につながった辺 */
  edges: Edge[];
  /** 布目線（始点・終点） */
  grain: [Vec, Vec];
}

export interface SeamAllowance {
  seam: number;
  hem: number;
  opening: number;
}

export type Fabric = 'knit' | 'woven';

export interface DraftResult {
  pieces: Piece[];
  /** 作図上の注意（推定値の使用とは別） */
  warnings: string[];
  /** 縫い合わせる辺の長さの確認など */
  info: string[];
}
