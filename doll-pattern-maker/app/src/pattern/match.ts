// 合印（同じ記号の辺どうしを縫い合わせる）。作図の結果に、対応表（items/matches.ts）から A・B・C… を付ける。
// 作図そのものは変えない。対応表にない辺には何も付かない。
//
// 辺の指定は「パーツの id/辺の名前」。同じ名前の辺が複数あれば全部（「#0」のように付けると何番目かだけ）。
// - a と b: a の辺と b の辺を縫い合わせる
// - a だけ: その辺どうし（同じ名前の辺がパーツに 2 本ある・左右 2 枚を裁って縫い合わせる）を縫い合わせる
// オプションで辺がないときは、a か b が 1 本も見つからなければその行を飛ばす（記号を使わない）。

import { pathLength } from '../geometry/path';
import { DraftResult, Edge, Piece } from './types';

export interface MatchRule {
  a: string[];
  b?: string[];
  /**
   * 長さの確認。equal: 同じ（既定）／ease: b がいせの分だけ長くてよい（袖山など）／none: 確かめない（ギャザー・縁取り布など）
   * a だけの行は、全部の辺の名前が同じときだけ equal で確かめる
   */
  check?: 'equal' | 'ease' | 'none';
  /** 縫い方の補足（一覧に出す） */
  note?: string;
}

export interface MatchProblem {
  letter: string;
  message: string;
}

interface Hit {
  piece: Piece;
  index: number;
  edge: Edge;
}

/** A, B, …, Z, AA, AB, … */
export function letterOf(i: number): string {
  let s = '';
  let n = i;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

function resolve(pieces: Piece[], ref: string): Hit[] {
  const slash = ref.indexOf('/');
  const pid = ref.slice(0, slash);
  let name = ref.slice(slash + 1);
  let nth: number | null = null;
  const m = name.match(/^(.*)#(\d+)$/);
  if (m) {
    name = m[1];
    nth = Number(m[2]);
  }
  const piece = pieces.find((pc) => pc.id === pid);
  if (!piece) return [];
  const hits = piece.edges.map((edge, index) => ({ piece, index, edge })).filter((h) => h.edge.name === name);
  return nth === null ? hits : hits.slice(nth, nth + 1);
}

const fmt = (x: number) => (Math.round(x * 10) / 10).toFixed(1);
const near = (p: { x: number; y: number }, q: { x: number; y: number }) => Math.abs(p.x - q.x) < 1e-6 && Math.abs(p.y - q.y) < 1e-6;
/** 辺の長さ。脇に入れた胸ダーツの口（印の両端を結ぶ線）は縫うと閉じるので数えない */
function edgeLength(h: Hit): number {
  const darts = (h.piece.marks ?? []).filter((m) => m.length === 3);
  return h.edge.segs.reduce((a, sg) => {
    const isDart = sg.kind === 'line' && darts.some((m) => (near(sg.from, m[0]) && near(sg.to, m[2])) || (near(sg.from, m[2]) && near(sg.to, m[0])));
    return a + (isDart ? 0 : pathLength([sg]));
  }, 0);
}
const lenOf = (hs: Hit[]) => hs.reduce((a, h) => a + edgeLength(h), 0);
const describe = (hs: Hit[]) => {
  const names: string[] = [];
  for (const h of hs) {
    const s = `${h.piece.name}「${h.edge.name}」`;
    if (!names.includes(s)) names.push(s);
  }
  return names.join('・');
};

/** 対応表に書いた辺のうち、この作図で見つかったもの（テスト用） */
export function resolvedRefs(result: DraftResult, rules: MatchRule[]): Set<string> {
  const out = new Set<string>();
  for (const rule of rules) for (const ref of [...rule.a, ...(rule.b ?? [])]) if (resolve(result.pieces, ref).length) out.add(ref);
  return out;
}

export function applyMatches(result: DraftResult, rules: MatchRule[]): { result: DraftResult; problems: MatchProblem[] } {
  if (rules.length === 0) return { result, problems: [] };
  // 辺に記号を書き込むので、パーツと辺は写しを作る
  const pieces: Piece[] = result.pieces.map((pc) => ({ ...pc, edges: pc.edges.map((e) => ({ ...e })) }));
  const problems: MatchProblem[] = [];
  const list: string[] = [];
  let n = 0;
  for (const rule of rules) {
    const a = rule.a.flatMap((r) => resolve(pieces, r));
    const b = (rule.b ?? []).flatMap((r) => resolve(pieces, r));
    if (a.length === 0 || (rule.b && b.length === 0)) continue;
    // 同じ辺が 2 つの行に入っていたら、先の記号を残す（対応表の書き間違い）
    const letter = letterOf(n++);
    for (const h of [...a, ...b]) {
      if (h.edge.match) problems.push({ letter, message: `${h.piece.name}「${h.edge.name}」にはすでに ${h.edge.match} が付いています` });
      else h.edge.match = letter;
    }
    const tol = (x: number) => Math.max(0.05, x * 0.03);
    if (rule.b) {
      const la = lenOf(a);
      const lb = lenOf(b);
      const check = rule.check ?? 'equal';
      if (check === 'equal' && Math.abs(la - lb) > tol(Math.max(la, lb))) {
        problems.push({ letter, message: `長さが合いません: ${describe(a)} ${fmt(la)}cm ⇔ ${describe(b)} ${fmt(lb)}cm` });
      }
      if (check === 'ease' && (lb < la - tol(la) || lb > la * 1.15 + 0.05)) {
        problems.push({ letter, message: `いせの分を超えています: ${describe(a)} ${fmt(la)}cm ⇔ ${describe(b)} ${fmt(lb)}cm` });
      }
      list.push(`${letter}: ${describe(a)} ⇔ ${describe(b)}${check === 'none' ? '' : `（${fmt(la)} ⇔ ${fmt(lb)}cm）`}${rule.note ? ` ${rule.note}` : ''}`);
    } else {
      const sameName = a.every((h) => h.edge.name === a[0].edge.name);
      const check = rule.check ?? (sameName ? 'equal' : 'none');
      if (check === 'equal' && a.length > 1) {
        const ls = a.map(edgeLength);
        const mx = Math.max(...ls);
        const mn = Math.min(...ls);
        if (mx - mn > tol(mx)) problems.push({ letter, message: `長さが合いません: ${describe(a)}（${ls.map(fmt).join(' ⇔ ')}cm）` });
      }
      list.push(`${letter}: ${describe(a)} どうし${rule.note ? ` ${rule.note}` : ''}`);
    }
  }
  return { result: { ...result, pieces, matches: list }, problems };
}
