// フード（パーカー・マントで共通）。2枚はぎ（左右）か 3枚はぎ（左右 ＋ 真ん中のマチ）。
// 横から見た形: 下の辺が襟付け（首側）、左の辺が顔まわり、右上の曲線が後ろ〜頭頂の縫い目。

import { v } from '../geometry/vec';
import { cubic, line, pathLength } from '../geometry/path';
import { EdgeKind, Piece } from './types';

/** ウィッグサイズ（インチ ＝ 頭囲）の選択肢。フードが入るよう範囲の大きいほうで作る */
export const HEAD_SIZES = {
  '6-7': { label: '6〜7インチ', inch: 7 },
  '7-8': { label: '7〜8インチ', inch: 8 },
  '8-9': { label: '8〜9インチ', inch: 9 },
  '9-10': { label: '9〜10インチ', inch: 10 },
} as const;
export type HeadSize = keyof typeof HEAD_SIZES;
export const INCH = 2.54;
/** これ以上の頭囲（9インチ）は 3枚はぎにする */
export const THREE_PANEL_HEAD = 9 * INCH;

export interface HoodInput {
  /** 襟付けの長さ（片側） */
  neckHalf: number;
  head: number;
  neckLength: number;
  panels: 2 | 3;
  lined: boolean;
  /** 顔まわりの始末（ひもを通すなら hem で三つ折り） */
  faceKind?: EdgeKind;
}

export interface HoodDraft {
  pieces: Piece[];
  height: number;
  depth: number;
  /** 顔まわりの長さ（片側） */
  faceLen: number;
}

export function draftHood(h: HoodInput): HoodDraft {
  const gw = h.panels === 3 ? h.head * 0.12 : 0; // マチの幅
  const H = h.head * 0.42 + h.neckLength - gw * 0.5;
  const D = Math.max(h.neckHalf, h.head * 0.34 - gw * 0.5);
  const B = v(D, H - D * 0.12);
  const T = v(D * 0.45, 0);
  const faceKind = h.faceKind ?? (h.lined ? 'seam' : 'hem');
  const backSegs = [cubic(B, v(D * 1.18, H * 0.55), v(D * 0.98, 0), T), line(T, v(0, 0))];
  // 顔まわりは少し前へふくらませる
  const face = cubic(v(0, 0), v(-H * 0.06, H * 0.3), v(-H * 0.04, H * 0.7), v(0, H));
  const side: Piece = {
    id: 'hood',
    name: h.panels === 3 ? 'フード（横）' : 'フード',
    cut: h.lined ? '4枚（左右反転・表と裏）' : '2枚（左右反転）',
    edges: [
      { segs: [cubic(v(0, H), v(D * 0.4, H), v(D * 0.75, H - D * 0.05), B)], kind: 'seam', name: '襟付け' },
      { segs: backSegs, kind: 'seam', name: h.panels === 3 ? 'マチ付け' : '後ろの縫い目' },
      { segs: [face], kind: faceKind, name: '顔まわり' },
    ],
    grain: [v(D * 0.35, H * 0.2), v(D * 0.35, H * 0.8)],
  };
  const pieces: Piece[] = [side];
  if (h.panels === 3) {
    const len = pathLength(backSegs);
    pieces.push({
      id: 'hood-gusset',
      name: 'フードのマチ',
      cut: h.lined ? '2枚（表と裏）' : '1枚',
      edges: [
        { segs: [line(v(0, 0), v(gw, 0))], kind: faceKind, name: '顔まわり' },
        { segs: [line(v(gw, 0), v(gw, len))], kind: 'seam', name: 'マチ付け' },
        { segs: [line(v(gw, len), v(0, len))], kind: 'seam', name: '襟付け' },
        { segs: [line(v(0, len), v(0, 0))], kind: 'seam', name: 'マチ付け' },
      ],
      grain: [v(gw * 0.5, len * 0.15), v(gw * 0.5, len * 0.85)],
    });
  }
  return { pieces, height: H, depth: D, faceLen: pathLength([face]) };
}
