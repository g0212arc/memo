#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
compare.py — 2つのモデルを、測った全軸で並べて比べる。

「旧版と新版で何が変わったか」を見るためのもの。総合ランキングだと
順位しか分からないので、プロンプトごと・指標ごとに差分を出す。

使い方
  python compare.py --mech results/mech.json --a deepseek-v4-flash-0731 \
      --b deepseek-v4.1-flash --runs results/runs.json --judge results/judge.json \
      --out results/compare.html
"""

from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path

from report import Doc, cost_breakdown, fetch_jpy_rate, mech_penalty

# (キー, 表示名, 大きいほうが良いか, 小数点以下)
METRICS = [
    ("chars", "平均字数", None, 0),
    ("st_ratio", "字数達成率", True, 2),
    ("ttr", "語彙多様性", True, 3),
    ("cliche", "常套句", False, 0),
    ("loop_ratio", "ループ率", False, 2),
    ("rep_phrase", "反復句", False, 0),
    ("comma_heavy", "読点過多文", False, 0),
    ("sent_len_avg", "平均文長", None, 1),
    ("cn", "中国語混入", False, 0),
    ("en", "英単語混入", False, 0),
    ("keitai", "敬体ドリフト", False, 0),
    ("medical", "医学用語", False, 0),
    ("vague", "ぼかし表現", False, 0),
    ("moan_lines", "喘ぎ台詞(様式)", True, 1),
    ("voice_lines", "喘ぎ台詞(素)", True, 1),
    ("copy", "作例コピペ", False, 0),
]


def rows_for(mech: dict, model: str) -> list[dict]:
    return [s for s in mech.get("summary", []) if s.get("model") == model]


def avg(rows: list[dict], key: str):
    v = [r.get(key) for r in rows if r.get(key) is not None]
    return sum(v) / len(v) if v else None


def fmt(v, nd: int) -> str:
    if v is None:
        return "—"
    return f"{v:.{nd}f}" if nd else f"{v:.0f}"


def delta(a, b, higher_better, nd) -> str:
    """差分。良くなったか悪くなったかが一目で分かるように矢印を付ける。"""
    if a is None or b is None:
        return "—"
    d = b - a
    if abs(d) < 10 ** -(nd + 1):
        return "±0"
    arrow = ""
    if higher_better is not None:
        improved = (d > 0) if higher_better else (d < 0)
        arrow = " ◯" if improved else " ✕"
    sign = "+" if d > 0 else ""
    return f"{sign}{d:.{nd}f}{arrow}" if nd else f"{sign}{d:.0f}{arrow}"


def main() -> int:
    ap = argparse.ArgumentParser(description="2モデルを全軸で比較する")
    ap.add_argument("--mech", required=True)
    ap.add_argument("--a", required=True, help="比較元（旧）のモデル名")
    ap.add_argument("--b", required=True, help="比較先（新）のモデル名")
    ap.add_argument("--runs", default=None)
    ap.add_argument("--judge", default=None)
    ap.add_argument("--out", default="results/compare.html")
    ap.add_argument("--jpy-rate", type=float, default=None)
    args = ap.parse_args()

    mech = json.loads(Path(args.mech).read_text(encoding="utf-8"))
    runs = json.loads(Path(args.runs).read_text(encoding="utf-8")) if args.runs else {}
    judge = json.loads(Path(args.judge).read_text(encoding="utf-8")) if args.judge else {}
    rate = args.jpy_rate or fetch_jpy_rate()[0]

    A, B = rows_for(mech, args.a), rows_for(mech, args.b)
    if not A or not B:
        print(f"データがありません: A={len(A)}本 / B={len(B)}本")
        return 1

    d = Doc()
    d.h(1, f"{args.a} → {args.b}")
    d.p(f"**同じプロンプト・同じ設定・同じ判定**で並べたもの。"
        f"A={args.a}（{len(A)}本）、B={args.b}（{len(B)}本）。"
        "差分の **◯** は改善、**✕** は悪化。字数や文長のように"
        "良し悪しが一概に言えないものは矢印を付けていない。")

    # 速度とコスト
    if runs:
        cb = cost_breakdown(runs)
        spd: dict[str, list] = defaultdict(list)
        ch: dict[str, int] = defaultdict(int)
        for r in runs.get("runs", []):
            if r.get("error"):
                continue
            if r.get("tok_per_s"):
                spd[r["model"]].append(r["tok_per_s"])
            ch[r["model"]] += r.get("chars") or 0
        rows = []
        for label, m in (("速度 t/s", None), ("実費", None), ("円/1000字", None)):
            pass
        def per1k(m):
            c, n = cb["by_model"].get(m, 0), ch.get(m, 0)
            return c / n * 1000 * rate if n else None
        rows = [
            ["速度 t/s", fmt(avg([{"v": x} for x in spd[args.a]], "v"), 1),
             fmt(avg([{"v": x} for x in spd[args.b]], "v"), 1),
             delta(avg([{"v": x} for x in spd[args.a]], "v"),
                   avg([{"v": x} for x in spd[args.b]], "v"), True, 1)],
            ["円/1000字", fmt(per1k(args.a), 3), fmt(per1k(args.b), 3),
             delta(per1k(args.a), per1k(args.b), False, 3)],
        ]
        d.h(2, "速度とコスト")
        d.table(["指標", "A", "B", "差分"], rows, "lrrr")

    # 主観点
    if judge:
        js = defaultdict(list)
        for j in judge.get("scores", []):
            js[j.get("model")].append(j)
        if js.get(args.a) or js.get(args.b):
            axes = judge.get("axes", {})
            rows = []
            for k, label in [("total", "合計")] + [(k, v.split("（")[0]) for k, v in axes.items()]:
                va = [x["total"] if k == "total" else x["scores"].get(k)
                      for x in js.get(args.a, [])]
                vb = [x["total"] if k == "total" else x["scores"].get(k)
                      for x in js.get(args.b, [])]
                ma = sum(va) / len(va) if va else None
                mb = sum(vb) / len(vb) if vb else None
                rows.append([label, fmt(ma, 1), fmt(mb, 1), delta(ma, mb, True, 1)])
            d.h(2, f"主観点（{judge.get('max_score', 50)}点満点・{judge.get('judge_model', '')}）")
            d.table(["軸", "A", "B", "差分"], rows, "lrrr")

    # プロンプトごとの機械判定
    seqs = sorted({r.get("seq") for r in A + B if r.get("seq")})
    for seq in seqs:
        sa = [r for r in A if r.get("seq") == seq]
        sb = [r for r in B if r.get("seq") == seq]
        if not (sa and sb):
            continue
        rows = []
        for key, label, hb, nd in METRICS:
            ma, mb = avg(sa, key), avg(sb, key)
            if ma is None and mb is None:
                continue
            rows.append([label, fmt(ma, nd), fmt(mb, nd), delta(ma, mb, hb, nd)])
        pa = sum(mech_penalty(r)[0] for r in sa) / len(sa)
        pb = sum(mech_penalty(r)[0] for r in sb) / len(sb)
        rows.append(["**機械減点**", fmt(pa, 1), fmt(pb, 1), delta(pa, pb, True, 1)])
        ra = sum(1 for r in sa if r.get("refusal"))
        rb = sum(1 for r in sb if r.get("refusal"))
        rows.append(["拒否", f"{ra}/{len(sa)}", f"{rb}/{len(sb)}",
                     delta(ra, rb, False, 0)])
        d.h(2, f"プロンプト {seq}（A {len(sa)}本 / B {len(sb)}本）")
        d.table(["指標", "A", "B", "差分"], rows, "lrrr")

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    if out.suffix.lower() == ".md":
        out.write_text(d.to_markdown(), encoding="utf-8")
    else:
        out.write_text(d.to_html(f"{args.a} → {args.b}"), encoding="utf-8")
    print(f"比較を書き出しました -> {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
