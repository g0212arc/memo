#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
report.py — 判定結果を、記事にそのまま貼れる Markdown 表にする。

入力（あるものだけ渡せばよい）
  --mech   score_mech.py の出力（機械判定）
  --judge  score_judge.py の出力（主観5軸のLLM採点）
  --runs   run_*.py の出力（速度 tok/s・トークン数・コスト）

出力
  1. 総合ランキング表（点・速度・機械判定の減点）
  2. 機械判定の一覧表
  3. 壊れ方の一覧（実例つき）— 記事の「壊れ方の見本市」に使う
"""

from __future__ import annotations

import argparse
import json
import re
from collections import defaultdict
from pathlib import Path

# 機械判定の減点ルール。記事の「機械判定項目」をそのまま点数化したもの。
# ここを変えれば順位の付け方を変えられる（採点の意図を1箇所に集める）。
PENALTY = {
    "tail_loop": (-10, "末尾ループ"),
    "phrase_loop": (-10, "同一句のループ"),
    "refusal": (-10, "拒否"),
    "empty": (-10, "空応答"),
    "person_mix": (-3, "一人称の混在"),
    "truncated": (-2, "途中切れ"),
}
PER_HIT = {
    "cn": (-0.5, "中国語混入", 6),
    "ko": (-0.5, "韓国語混入", 6),
    "en": (-0.2, "英単語混入", 4),
    "keitai": (-0.1, "敬体ドリフト", 6),
    "medical": (-0.5, "医学用語", 4),
    "vague": (-1.0, "ぼかし表現", 4),
}


def load(path: str | None) -> dict:
    return json.loads(Path(path).read_text(encoding="utf-8")) if path else {}


def mech_penalty(s: dict) -> tuple[float, list[str]]:
    """機械判定の減点と、その理由を返す。"""
    total, reasons = 0.0, []
    for key, (pt, label) in PENALTY.items():
        if s.get(key):
            total += pt
            reasons.append(f"{label}{pt:+g}")
    for key, (pt, label, cap) in PER_HIT.items():
        n = s.get(key, 0) or 0
        if n:
            d = max(pt * n, -abs(cap))
            total += d
            reasons.append(f"{label}×{n}{d:+.1f}")
    return round(total, 1), reasons


def by_model(mech: dict) -> dict[str, list[dict]]:
    groups = defaultdict(list)
    for s in mech.get("summary", []):
        groups[s["model"]].append(s)
    return groups


def agg(rows: list[dict]) -> dict:
    n = len(rows)
    keys = ("chars", "cn", "ko", "en", "keitai", "medical", "vague",
            "direct", "heart", "dakuten", "tsu", "copy", "dup_max",
            "cliche", "rep_phrase", "comma_heavy", "dup_particles", "moan_lines")
    out = {k: sum(r.get(k, 0) or 0 for r in rows) for k in keys}
    out["files"] = n
    out["chars_avg"] = round(out["chars"] / n) if n else 0
    out["tail_loop"] = any(r.get("tail_loop") for r in rows)
    out["phrase_loop"] = any(r.get("phrase_loop") for r in rows)
    out["loop_ratio"] = max((r.get("loop_ratio") or 0) for r in rows) if rows else 0
    out["person_mix"] = any(r.get("person_mix") for r in rows)
    out["truncated"] = any(r.get("truncated") for r in rows)
    out["dup_max"] = max((r.get("dup_max", 0) or 0) for r in rows) if n else 0

    # 拒否は減点である前に測定値。何回中何回断られたかを残す。
    out["refusal_n"] = sum(1 for r in rows if r.get("refusal"))
    out["refusal_rate"] = round(out["refusal_n"] / n, 2) if n else 0
    out["refusal"] = out["refusal_n"] > 0

    # 表現系は合計ではなく平均で見る（長さに引きずられないように）
    for k in ("ttr", "sent_len_avg", "metaphor_1000"):
        vals = [r.get(k) for r in rows if r.get(k) is not None]
        out[k] = round(sum(vals) / len(vals), 3) if vals else 0
    return out


# 1ドルあたりの円。実行時に --jpy-rate で上書きできる。
# 既定値は open.er-api.com から取得した 2026-09-03 時点のレート。
DEFAULT_JPY_RATE = 159.09


def yen(usd: float, rate: float) -> str:
    """ドルと円を併記する。記事に「いくらかかったか」を書くための形。"""
    y = usd * rate
    if y < 1:
        return f"${usd:.5f}（約{y:.2f}円）"
    if y < 100:
        return f"${usd:.4f}（約{y:.1f}円）"
    return f"${usd:.3f}（約{y:,.0f}円）"


def cost_breakdown(runs: dict) -> dict:
    """実行記録から、モデル別・プロンプト別・1本あたりの費用を出す。"""
    by_model: dict[str, float] = defaultdict(float)
    by_prompt: dict[str, float] = defaultdict(float)
    by_file: dict[str, float] = {}
    cells: dict[tuple[str, str], float] = defaultdict(float)
    n_ok = 0
    for r in runs.get("runs", []):
        c = r.get("cost_usd") or 0
        if r.get("error"):
            continue
        n_ok += 1
        m, pid = r.get("model", "?"), r.get("prompt_id", "?")
        by_model[m] += c
        by_prompt[pid] += c
        cells[(m, pid)] += c
        # 1ジョブが複数ファイル（RPの2ターン）になる場合は等分する
        files = r.get("files") or []
        for f in files:
            by_file[f] = c / len(files)
    total = sum(by_model.values())
    return {"by_model": dict(by_model), "by_prompt": dict(by_prompt),
            "by_file": by_file, "cells": cells, "total": total,
            "runs_ok": n_ok, "avg": total / n_ok if n_ok else 0}


def detail_of(mech: dict, filename: str) -> dict:
    for d in mech.get("detail", []):
        if d["file"] == filename:
            return d
    return {}


ALIGN_CSS = {"l": "left", "r": "right", "c": "center"}


class Doc:
    """レポートの中身を、出力形式に依存しない形で組み立てる。

    同じ内容を Markdown と HTML の両方で出したいので、
    見出し・段落・表・箇条書きを一度データとして持ってから、最後に描画する。
    """

    def __init__(self) -> None:
        self.blocks: list[tuple] = []

    def h(self, level: int, text: str) -> "Doc":
        self.blocks.append(("h", level, text))
        return self

    def p(self, text: str) -> "Doc":
        self.blocks.append(("p", text))
        return self

    def ul(self, items: list[str]) -> "Doc":
        if items:
            self.blocks.append(("ul", items))
        return self

    def pre(self, text: str) -> "Doc":
        """整形済みの塊。プロンプト本文のように、そのまま読ませたいものに使う。"""
        self.blocks.append(("pre", text))
        return self

    def table(self, headers: list[str], rows: list[list], align: str = "") -> "Doc":
        self.blocks.append(("table", headers, rows, align or "l" * len(headers)))
        return self

    # ---- 描画 ----

    @staticmethod
    def _cell(c) -> str:
        return "" if c is None else str(c)

    def to_markdown(self) -> str:
        out: list[str] = []
        sep = {"l": "---", "r": "---:", "c": ":---:"}
        for b in self.blocks:
            if b[0] == "h":
                out += ["#" * b[1] + " " + b[2], ""]
            elif b[0] == "p":
                out += [b[1], ""]
            elif b[0] == "ul":
                out += [f"- {i}" for i in b[1]] + [""]
            elif b[0] == "pre":
                out += ["```text", b[1], "```", ""]
            elif b[0] == "table":
                _, headers, rows, align = b
                out.append("| " + " | ".join(headers) + " |")
                out.append("|" + "|".join(sep[a] for a in align) + "|")
                for r in rows:
                    out.append("| " + " | ".join(self._cell(c) for c in r) + " |")
                out.append("")
        return "\n".join(out) + "\n"

    @staticmethod
    def _inline_html(text: str) -> str:
        """**強調** と `コード` だけ HTML に変換する。他の記号はそのまま。"""
        t = (text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))
        t = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", t)
        t = re.sub(r"`(.+?)`", r"<code>\1</code>", t)
        return t

    def to_html(self, title: str) -> str:
        out = [
            "<!DOCTYPE html>", '<html lang="ja">', "<head>",
            '<meta charset="utf-8">',
            '<meta name="viewport" content="width=device-width, initial-scale=1">',
            f"<title>{self._inline_html(title)}</title>",
            "<style>",
            "body{font-family:-apple-system,BlinkMacSystemFont,'Hiragino Sans',"
            "'Yu Gothic UI',Meiryo,sans-serif;line-height:1.7;max-width:1100px;"
            "margin:0 auto;padding:24px 16px;color:#222}",
            "h1{font-size:1.6rem;border-bottom:2px solid #333;padding-bottom:.3em}",
            "h2{font-size:1.3rem;margin-top:2em;border-bottom:1px solid #ccc;padding-bottom:.2em}",
            "h3{font-size:1.1rem;margin-top:1.6em}",
            "table{border-collapse:collapse;margin:1em 0;font-size:.92rem;"
            "display:block;overflow-x:auto;max-width:100%}",
            "th,td{border:1px solid #ccc;padding:6px 10px;white-space:nowrap}",
            "th{background:#f2f2f2;font-weight:600}",
            "tr:nth-child(even) td{background:#fafafa}",
            "pre{background:#f6f6f6;border:1px solid #ddd;border-left:4px solid #999;"
            "padding:12px 14px;white-space:pre-wrap;word-break:break-word;"
            "font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.86rem;"
            "line-height:1.6;overflow-x:auto}",
            "code{background:#f0f0f0;padding:1px 5px;border-radius:3px;"
            "font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.9em;"
            "white-space:normal}",
            ".note{background:#fffbe6;border-left:4px solid #e6c200;padding:10px 14px;"
            "margin:1em 0;font-size:.92rem}",
            "@media (prefers-color-scheme:dark){",
            "body{background:#1b1b1b;color:#e6e6e6}",
            "h1{border-color:#666}h2{border-color:#444}",
            "th,td{border-color:#444}th{background:#2a2a2a}",
            "tr:nth-child(even) td{background:#232323}",
            "code{background:#2a2a2a}pre{background:#242424;border-color:#444;"
            "border-left-color:#777}",
            ".note{background:#332d10;border-color:#8a7500}}",
            "</style>", "</head>", "<body>",
            '<div class="note">はてなブログに貼るときは、<strong>HTML編集モード</strong>で '
            '&lt;table&gt; 以下をそのままコピーしてください。'
            'ここの CSS は貼り付け先には付いていかないので、ブログ側のデザインが適用されます。</div>',
        ]
        for b in self.blocks:
            if b[0] == "h":
                out.append(f"<h{b[1]}>{self._inline_html(b[2])}</h{b[1]}>")
            elif b[0] == "p":
                out.append(f"<p>{self._inline_html(b[1])}</p>")
            elif b[0] == "ul":
                out.append("<ul>")
                out += [f"<li>{self._inline_html(i)}</li>" for i in b[1]]
                out.append("</ul>")
            elif b[0] == "pre":
                esc = (b[1].replace("&", "&amp;").replace("<", "&lt;")
                       .replace(">", "&gt;"))
                out.append(f"<pre>{esc}</pre>")
            elif b[0] == "table":
                _, headers, rows, align = b
                out.append("<table>")
                out.append("<thead><tr>" + "".join(
                    f'<th style="text-align:{ALIGN_CSS[a]}">{self._inline_html(h)}</th>'
                    for h, a in zip(headers, align)) + "</tr></thead>")
                out.append("<tbody>")
                for r in rows:
                    out.append("<tr>" + "".join(
                        f'<td style="text-align:{ALIGN_CSS[a]}">'
                        f'{self._inline_html(self._cell(c))}</td>'
                        for c, a in zip(r, align)) + "</tr>")
                out += ["</tbody>", "</table>"]
        out += ["</body>", "</html>"]
        return "\n".join(out) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser(description="判定結果を HTML / Markdown のレポートにする")
    ap.add_argument("--mech", required=True)
    ap.add_argument("--judge", default=None)
    ap.add_argument("--runs", default=None)
    ap.add_argument("--out", default="results/report.html",
                    help="出力先。拡張子で形式が決まる（.html / .md）")
    ap.add_argument("--also-markdown", action="store_true",
                    help="HTML と同じ内容の .md も並べて出す")
    ap.add_argument("--title", default="ローカルLLM検証 レポート")
    ap.add_argument("--jpy-rate", type=float, default=DEFAULT_JPY_RATE,
                    help=f"1ドルあたりの円（既定 {DEFAULT_JPY_RATE}）")
    args = ap.parse_args()
    rate = args.jpy_rate

    mech, judge, runs = load(args.mech), load(args.judge), load(args.runs)

    judge_by_model: dict[str, list[dict]] = defaultdict(list)
    for j in judge.get("scores", []):
        judge_by_model[j.get("model", "")].append(j)
    speed_by_model: dict[str, list[float]] = defaultdict(list)
    for r in runs.get("runs", []):
        if r.get("tok_per_s"):
            speed_by_model[r.get("model", "")].append(r["tok_per_s"])

    cb = cost_breakdown(runs) if runs else None
    groups = by_model(mech)

    out_rows = []
    for model, rows in groups.items():
        a = agg(rows)
        pen, reasons = mech_penalty(a)
        js = judge_by_model.get(model, [])
        subj = round(sum(j.get("total", 0) for j in js) / len(js), 1) if js else None
        spd = speed_by_model.get(model, [])
        out_rows.append({
            "model": model, "agg": a, "penalty": pen, "reasons": reasons,
            "subjective": subj,
            "score": round((subj or 0) + pen, 1) if subj is not None else pen,
            "speed": round(sum(spd) / len(spd), 1) if spd else None,
        })
    out_rows.sort(key=lambda r: (0 if r["score"] is not None else 1,
                                 -(r["score"] if r["score"] is not None else 0),
                                 r["model"]))

    d = Doc()
    d.h(1, args.title)
    info = [f"判定ファイル数: {mech.get('file_count', 0)}", f"モデル数: {len(groups)}"]
    if judge:
        info.append(f"主観採点: {judge.get('judge_model', '(不明)')}"
                    f"（{judge.get('axes_id', 'base')} 軸・{judge.get('max_score', 50)}点満点）")
    if cb and cb["total"]:
        info.append(f"API 実費: **{yen(cb['total'], rate)}**（1ドル={rate:.2f}円で換算）")
        info.append(f"1本あたり平均: {yen(cb['avg'], rate)}")
    d.ul(info)

    # ---- 総合ランキング ----
    d.h(2, "総合ランキング")
    d.table(["順", "モデル", "主観点", "機械減点", "合計", "拒否", "速度 t/s", "平均字数", "実費"],
            [[i + 1, r["model"],
              r["subjective"] if r["subjective"] is not None else "—",
              f'{r["penalty"]:+g}' if r["penalty"] else "0",
              r["score"],
              f'{r["agg"]["refusal_n"]}/{r["agg"]["files"]}',
              r["speed"] if r["speed"] is not None else "—",
              r["agg"]["chars_avg"],
              yen(cb["by_model"].get(r["model"], 0), rate) if cb else "—"]
             for i, r in enumerate(out_rows)],
            "rlrrrcrrr")
    d.p("主観点は score_judge.py（LLM採点）、機械減点は score_mech.py の検出数に "
        "report.py の PENALTY / PER_HIT を掛けたもの。"
        "減点ルールを変えたい場合は report.py の先頭を編集してください。")

    # ---- 機械判定の一覧 ----
    d.h(2, "機械判定の一覧")
    d.table(["モデル", "本数", "重複最大", "ループ", "中国語", "韓国語",
             "英単語", "敬体", "医学", "ぼかし", "拒否", "一人称混在"],
            [[r["model"], r["agg"]["files"], r["agg"]["dup_max"],
              "✕" if (r["agg"]["tail_loop"] or r["agg"]["phrase_loop"]) else "",
              r["agg"]["cn"] or "", r["agg"]["ko"] or "", r["agg"]["en"] or "",
              r["agg"]["keitai"] or "", r["agg"]["medical"] or "",
              r["agg"]["vague"] or "",
              f'{r["agg"]["refusal_n"]}' if r["agg"]["refusal_n"] else "",
              "✕" if r["agg"]["person_mix"] else ""]
             for r in out_rows],
            "lrrcrrrrrrcc")

    # ---- 前段条件ごとの拒否率 ----
    conds = [c for c in ("role", "plain", "none")
             if any(x.get("preamble") == c for x in mech.get("summary", []))]
    if len(conds) > 1:
        label = {"role": "role（官能小説家と明示）", "plain": "plain（ジャンル宣言なし）",
                 "none": "前段なし"}
        rows = []
        for r in out_rows:
            row = [r["model"]]
            for c in conds:
                sub = [x for x in groups[r["model"]] if x.get("preamble") == c]
                row.append(f'{sum(1 for x in sub if x.get("refusal"))}/{len(sub)}'
                           if sub else "—")
            rows.append(row)
        d.h(2, "前段条件ごとの拒否率")
        d.p("同じモデル・同じ本編プロンプトで、**前段の文面だけを変えた**結果。"
            "数字は 拒否した本数/試行数。")
        d.table(["モデル"] + [label[c] for c in conds], rows, "l" + "c" * len(conds))
        d.p("ここに差が出るなら、**モデルの能力ではなく前段の書き方で結果が変わっている**"
            "ということです。差が出ないなら前段は不要ということなので、"
            "どちらでも記事に書けるデータになります。")

    # ---- 表現の質 ----
    d.h(2, "表現の質")
    d.p("日本語が崩れないモデル同士を比べるための軸。"
        "**語彙多様性は低いほど言い回しが単調**、"
        "**反復句は同じ比喩を作品内で使い回した数**、"
        "常套句は wordlists/cliche.txt のヒット数。")
    d.table(["モデル", "語彙多様性", "反復句", "ループ率", "常套句", "比喩/1000字",
             "平均文長", "読点過多文", "助詞重複"],
            [[r["model"], r["agg"]["ttr"], r["agg"]["rep_phrase"] or "",
              f'{r["agg"]["loop_ratio"]:.0%}' if r["agg"]["loop_ratio"] else "",
              r["agg"]["cliche"] or "", r["agg"]["metaphor_1000"],
              r["agg"]["sent_len_avg"], r["agg"]["comma_heavy"] or "",
              r["agg"]["dup_particles"] or ""]
             for r in out_rows],
            "lrrrrrrrr")

    reps = []
    for r in out_rows:
        for sm in groups[r["model"]]:
            for ph in ((detail_of(mech, sm["file"]).get("expression") or {})
                       .get("repeated_phrases") or []):
                if ph["count"] >= 3 and ph["length"] >= 12:
                    reps.append((r["model"], ph))
    if reps:
        d.h(3, "使い回された言い回し")
        d.table(["モデル", "回数", "言い回し"],
                [[m, ph["count"], f'`{ph["phrase"][:60]}`'] for m, ph in reps[:15]], "lrl")

    # ---- 文体規定 ----
    if any(r["agg"]["heart"] or r["agg"]["dakuten"] for r in out_rows):
        d.h(2, "文体規定の遵守")
        d.table(["モデル", "喘ぎ声の台詞行", "♡", "濁点崩し", "語中ッ", "作例コピペ"],
                [[r["model"], r["agg"]["moan_lines"], r["agg"]["heart"],
                  r["agg"]["dakuten"], r["agg"]["tsu"], r["agg"]["copy"]]
                 for r in out_rows if r["agg"]["heart"] or r["agg"]["dakuten"]],
                "lrrrrr")
        d.p("**喘ぎ声の台詞行**が③の要件そのもの（指定した発話が実際に出るか）。台詞行のうち ♡・濁点崩し・指定語彙のいずれかを含むものを数えている。作例コピペは exact + near（類似度0.90以上）の合計。"
            "多いモデルは文体を再現しているのではなく渡した作例を写している。")

    # ---- 費用 ----
    if cb and cb["total"]:
        d.h(2, "費用の内訳")
        d.p(f"1ドル = {rate:.2f}円 で換算。**この検証にかかった実費の全額**です。"
            "金額は OpenRouter が実際に課金した額で、概算ではありません。")
        d.h(3, "プロンプト別")
        d.table(["プロンプト", "費用"],
                [[pid, yen(c, rate)] for pid, c in
                 sorted(cb["by_prompt"].items(), key=lambda x: -x[1])]
                + [["**合計**", f"**{yen(cb['total'], rate)}**"]], "lr")
        pids = sorted(cb["by_prompt"])
        d.h(3, "モデル × プロンプト（単位: 円）")
        d.table(["モデル"] + pids + ["計"],
                [[m] + [f"{cb['cells'].get((m, p), 0) * rate:.1f}" for p in pids]
                 + [f"**{cb['by_model'][m] * rate:.1f}**"]
                 for m in sorted(cb["by_model"], key=lambda x: -cb["by_model"][x])],
                "l" + "r" * (len(pids) + 1))
        top = sorted(cb["by_file"].items(), key=lambda x: -x[1])[:10]
        if top:
            d.h(3, "高くついた出力 上位10本")
            d.table(["ファイル", "費用"], [[f"`{f}`", yen(c, rate)] for f, c in top], "lr")

    # ---- 前段で断られたもの ----
    pre_refused = [r for r in runs.get("runs", [])
                   if (r.get("preamble") or {}).get("refused")]
    if pre_refused:
        d.h(2, "前段（役割設定）の時点で断られたもの")
        d.p("本編を投げる前の、役割を確定させるターンで拒否されたケース。")
        d.table(["モデル", "プロンプト", "返答"],
                [[r.get("model"), r.get("prompt_id"),
                  f'`{(r["preamble"]["reply"] or "")[:70]}`'] for r in pre_refused[:15]],
                "lll")

    # ---- 壊れ方の実例 ----
    d.h(2, "壊れ方の一覧（実例）")
    shown = 0
    for r in out_rows[::-1]:
        for sm in groups[r["model"]]:
            det = detail_of(mech, sm["file"])
            pen, reasons = mech_penalty(sm)
            if not reasons:
                continue
            d.h(3, f'{sm["model"]} — {sm["file"]}')
            d.p(f"減点 {pen:+g}: {', '.join(reasons)}")
            items = []
            for lbl, key in (("中国語混入", "chinese"), ("韓国語混入", "korean"),
                             ("英単語混入", "english"), ("敬体ドリフト", "keitai_drift"),
                             ("医学用語", "medical"), ("ぼかし表現", "vague")):
                ex = (det.get(key) or {}).get("examples") or []
                if ex:
                    items.append(f"**{lbl}**: " + " / ".join(f"`{e.strip()}`" for e in ex[:3]))
            worst = (det.get("duplicate") or {}).get("worst") or []
            if worst and worst[0]["count"] >= 3:
                items.append(f'**重複行**: `{worst[0]["line"]}` × {worst[0]["count"]}回')
            d.ul(items)
            shown += 1
            if shown >= 30:
                break
        if shown >= 30:
            break

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    if out.suffix.lower() == ".md":
        out.write_text(d.to_markdown(), encoding="utf-8")
    else:
        out.write_text(d.to_html(args.title), encoding="utf-8")
    written = [out]
    if args.also_markdown and out.suffix.lower() != ".md":
        md_path = out.with_suffix(".md")
        md_path.write_text(d.to_markdown(), encoding="utf-8")
        written.append(md_path)

    print("レポートを書き出しました:")
    for w in written:
        print(f"  {w}")
    if cb and cb["total"]:
        print(f"実費合計: {yen(cb['total'], rate)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
