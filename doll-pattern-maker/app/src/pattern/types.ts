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
  /** 合印（同じ記号の辺どうしを縫い合わせる）。match.ts が付ける */
  match?: string;
}

/** 型紙の中に書く文字（「持ち出し」など） */
export interface PieceNote {
  at: Vec;
  text: string;
  /** 縦書き（1 文字ずつ下へ） */
  vertical?: boolean;
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
  /** 内側の印（ダーツの線など）。折れ線ごと */
  marks?: Vec[][];
  /** 型紙の中に書く文字 */
  notes?: PieceNote[];
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
  /** 合印の一覧（例: A: 前身頃「肩」⇔ 後ろ身頃「肩」） */
  matches?: string[];
  /**
   * 設定の参考値（cm）。キーは設定の項目（fit・length など）で、値はこの作図で実際に使った数値。
   * 画面で選択肢ごとに作図して「普通（2.7cm）」のように出し、自分で入力の目安にする
   */
  refs?: Record<string, number>;
  /** 参考値の単位（書いていない項目は cm）。例: flare → '°'、count → '本'、puff → '倍' */
  refUnits?: Record<string, string>;
}
