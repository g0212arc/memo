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
from collections import defaultdict
from pathlib import Path

# 機械判定の減点ルール。記事の「機械判定項目」をそのまま点数化したもの。
# ここを変えれば順位の付け方を変えられる（採点の意図を1箇所に集める）。
PENALTY = {
    "tail_loop": (-10, "末尾ループ"),
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
            "cliche", "rep_phrase", "comma_heavy", "dup_particles")
    out = {k: sum(r.get(k, 0) or 0 for r in rows) for k in keys}
    out["files"] = n
    out["chars_avg"] = round(out["chars"] / n) if n else 0
    out["tail_loop"] = any(r.get("tail_loop") for r in rows)
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


def table(headers: list[str], rows: list[list], align: str = "") -> str:
    align = align or "l" * len(headers)
    sep = {"l": "---", "r": "---:", "c": ":---:"}
    lines = ["| " + " | ".join(headers) + " |",
             "|" + "|".join(sep[a] for a in align) + "|"]
    for r in rows:
        lines.append("| " + " | ".join("" if c is None else str(c) for c in r) + " |")
    return "\n".join(lines)


def main() -> int:
    ap = argparse.ArgumentParser(description="判定結果を Markdown レポートにする")
    ap.add_argument("--mech", required=True)
    ap.add_argument("--judge", default=None)
    ap.add_argument("--runs", default=None)
    ap.add_argument("--out", default="results/report.md")
    ap.add_argument("--jpy-rate", type=float, default=DEFAULT_JPY_RATE,
                    help=f"1ドルあたりの円（既定 {DEFAULT_JPY_RATE}）")
    args = ap.parse_args()
    rate = args.jpy_rate

    mech, judge, runs = load(args.mech), load(args.judge), load(args.runs)

    # 判定結果をモデル名で突き合わせる
    judge_by_model: dict[str, list[dict]] = defaultdict(list)
    for j in judge.get("scores", []):
        judge_by_model[j.get("model", "")].append(j)
    speed_by_model: dict[str, list[float]] = defaultdict(list)
    cost_total = 0.0
    for r in runs.get("runs", []):
        if r.get("tok_per_s"):
            speed_by_model[r.get("model", "")].append(r["tok_per_s"])
        cost_total += r.get("cost_usd", 0) or 0

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

    # 減点0（＝無傷）が最下位に落ちないよう、None だけを最後に回す
    out_rows.sort(key=lambda r: (0 if r["score"] is not None else 1,
                                 -(r["score"] if r["score"] is not None else 0),
                                 r["model"]))

    md = ["# ローカルLLM検証 レポート", ""]
    md.append(f"- 判定ファイル数: {mech.get('file_count', 0)}")
    md.append(f"- モデル数: {len(groups)}")
    if judge:
        md.append(f"- 主観採点: {judge.get('judge_model', '(不明)')} による LLM 採点")
    cb = cost_breakdown(runs) if runs else None
    if cost_total:
        md.append(f"- API 実費: **{yen(cost_total, rate)}**"
                  f"（1ドル={rate:.2f}円で換算）")
        if cb and cb["runs_ok"]:
            md.append(f"- 1本あたり平均: {yen(cb['avg'], rate)}")
    md.append("")

    md += ["## 総合ランキング", "",
           table(["順", "モデル", "主観点", "機械減点", "合計", "拒否", "速度 t/s",
                  "平均字数", "実費"],
                 [[i + 1, r["model"], r["subjective"] if r["subjective"] is not None else "—",
                   f'{r["penalty"]:+g}' if r["penalty"] else "0",
                   r["score"],
                   f'{r["agg"]["refusal_n"]}/{r["agg"]["files"]}',
                   r["speed"] if r["speed"] is not None else "—",
                   r["agg"]["chars_avg"],
                   yen(cb["by_model"].get(r["model"], 0), rate) if cb else "—"]
                  for i, r in enumerate(out_rows)],
                 "rlrrrcrrr"),
           "",
           "主観点は score_judge.py（LLM採点）、機械減点は score_mech.py の検出数に "
           "report.py の PENALTY / PER_HIT を掛けたもの。減点ルールを変えたい場合は "
           "report.py の先頭を編集してください。", ""]

    md += ["## 機械判定の一覧", "",
           table(["モデル", "本数", "重複最大", "末尾ループ", "中国語", "韓国語",
                  "英単語", "敬体", "医学", "ぼかし", "拒否", "一人称混在"],
                 [[r["model"], r["agg"]["files"], r["agg"]["dup_max"],
                   "✕" if r["agg"]["tail_loop"] else "",
                   r["agg"]["cn"] or "", r["agg"]["ko"] or "", r["agg"]["en"] or "",
                   r["agg"]["keitai"] or "", r["agg"]["medical"] or "",
                   r["agg"]["vague"] or "",
                   "✕" if r["agg"]["refusal"] else "",
                   "✕" if r["agg"]["person_mix"] else ""]
                  for r in out_rows],
                 "lrrcrrrrrrcc"),
           ""]

    if cb and cb["total"]:
        md += ["## 費用の内訳", "",
               f"1ドル = {rate:.2f}円 で換算。**この検証にかかった実費の全額**です。", ""]

        # プロンプトセット別
        md += ["### プロンプト別", "",
               table(["プロンプト", "費用"],
                     [[pid, yen(c, rate)]
                      for pid, c in sorted(cb["by_prompt"].items(),
                                           key=lambda x: -x[1])]
                     + [["**合計**", f"**{yen(cb['total'], rate)}**"]],
                     "lr"),
               ""]

        # モデル × プロンプトのマトリクス
        pids = sorted(cb["by_prompt"])
        md += ["### モデル × プロンプト", "",
               table(["モデル"] + pids + ["計"],
                     [[m] + [f"{cb['cells'].get((m, p), 0) * rate:.1f}円" for p in pids]
                      + [f"**{cb['by_model'][m] * rate:.1f}円**"]
                      for m in sorted(cb["by_model"], key=lambda x: -cb["by_model"][x])],
                     "l" + "r" * (len(pids) + 1)),
               "",
               "単位は円。1本ごとの内訳は results/runs.json の cost_usd にあります。", ""]

        # 高かった出力の上位
        top = sorted(cb["by_file"].items(), key=lambda x: -x[1])[:10]
        if top:
            md += ["### 高くついた出力 上位10本", "",
                   table(["ファイル", "費用"], [[f"`{f}`", yen(c, rate)] for f, c in top],
                         "lr"),
                   ""]

    # 前段条件ごとの拒否率。「官能小説家と名乗ると通るのか」への答えになる。
    conds = []
    for c in ("role", "plain", "none"):
        if any(x.get("preamble") == c for x in mech.get("summary", [])):
            conds.append(c)
    if len(conds) > 1:
        label = {"role": "role（官能小説家と明示）", "plain": "plain（ジャンル宣言なし）",
                 "none": "前段なし"}
        rows = []
        for r in out_rows:
            row = [r["model"]]
            for c in conds:
                sub = [x for x in groups[r["model"]] if x.get("preamble") == c]
                if not sub:
                    row.append("—")
                    continue
                ref = sum(1 for x in sub if x.get("refusal"))
                row.append(f"{ref}/{len(sub)}")
            rows.append(row)
        md += ["## 前段条件ごとの拒否率", "",
               "同じモデル・同じ本編プロンプトで、**前段の文面だけを変えた**結果。"
               "数字は 拒否した本数/試行数。", "",
               table(["モデル"] + [label[c] for c in conds], rows,
                     "l" + "c" * len(conds)),
               "",
               "ここに差が出るなら、**モデルの能力ではなく前段の書き方で結果が変わっている**"
               "ということです。差が出ないなら前段は不要ということなので、"
               "どちらでも記事に書けるデータになります。", ""]

    md += ["## 表現の質", "",
           "日本語が崩れないモデル同士を比べるための軸。"
           "**語彙多様性は低いほど言い回しが単調**、"
           "**反復句は同じ比喩を作品内で使い回した数**、"
           "常套句は wordlists/cliche.txt のヒット数。", "",
           table(["モデル", "語彙多様性", "反復句", "常套句", "比喩/1000字",
                  "平均文長", "読点過多文", "助詞重複"],
                 [[r["model"], r["agg"]["ttr"], r["agg"]["rep_phrase"] or "",
                   r["agg"]["cliche"] or "", r["agg"]["metaphor_1000"],
                   r["agg"]["sent_len_avg"], r["agg"]["comma_heavy"] or "",
                   r["agg"]["dup_particles"] or ""]
                  for r in out_rows],
                 "lrrrrrrr"),
           ""]

    # 使い回された言い回しの実例
    reps = []
    for r in out_rows:
        for sm in groups[r["model"]]:
            for ph in ((detail_of(mech, sm["file"]).get("expression") or {})
                       .get("repeated_phrases") or []):
                if ph["count"] >= 3 and ph["length"] >= 12:
                    reps.append((r["model"], sm["file"], ph))
    if reps:
        md += ["### 使い回された言い回し", "",
               table(["モデル", "回数", "言い回し"],
                     [[m, ph["count"], f'`{ph["phrase"][:60]}`'] for m, _f, ph in reps[:15]],
                     "lrl"),
               ""]

    # 文体規定（オホ声）の検証をしたときだけ出す
    if any(r["agg"]["heart"] or r["agg"]["dakuten"] or r["agg"]["copy"] for r in out_rows):
        md += ["## 文体規定の遵守", "",
               table(["モデル", "♡", "濁点崩し", "語中ッ", "作例コピペ"],
                     [[r["model"], r["agg"]["heart"], r["agg"]["dakuten"],
                       r["agg"]["tsu"], r["agg"]["copy"]]
                      for r in out_rows if r["agg"]["heart"] or r["agg"]["dakuten"]],
                     "lrrrr"),
               "",
               "作例コピペは exact + near（類似度0.90以上）の合計。"
               "多いモデルは文体を再現しているのではなく渡した作例を写している。", ""]

    pre_refused = [r for r in runs.get("runs", [])
                   if (r.get("preamble") or {}).get("refused")]
    if pre_refused:
        md += ["## 前段（役割設定）の時点で断られたもの", "",
               "本編を投げる前の、役割を確定させるターンで拒否されたケース。"
               "`--no-preamble` と比べると、前段が効いているかどうかが分かる。", "",
               table(["モデル", "プロンプト", "返答"],
                     [[r.get("model"), r.get("prompt_id"),
                       f'`{(r["preamble"]["reply"] or "")[:70]}`'] for r in pre_refused[:15]],
                     "lll"),
               ""]

    md += ["## 壊れ方の一覧（実例）", ""]
    detail = {d["file"]: d for d in mech.get("detail", [])}
    shown = 0
    for r in out_rows[::-1]:
        for s in groups[r["model"]]:
            d = detail.get(s["file"], {})
            pen, reasons = mech_penalty(s)
            if not reasons:
                continue
            md.append(f"### {s['model']} — {s['file']}")
            md.append(f"減点 {pen:+g}: {', '.join(reasons)}")
            md.append("")
            for label, key in (("中国語混入", "chinese"), ("韓国語混入", "korean"),
                               ("英単語混入", "english"), ("敬体ドリフト", "keitai_drift"),
                               ("医学用語", "medical"), ("ぼかし表現", "vague")):
                ex = (d.get(key) or {}).get("examples") or []
                if ex:
                    md.append(f"- **{label}**: " + " / ".join(f"`{e.strip()}`" for e in ex[:3]))
            worst = (d.get("duplicate") or {}).get("worst") or []
            if worst and worst[0]["count"] >= 3:
                md.append(f"- **重複行**: `{worst[0]['line']}` × {worst[0]['count']}回")
            md.append("")
            shown += 1
            if shown >= 30:
                break
        if shown >= 30:
            break

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("\n".join(md) + "\n", encoding="utf-8")
    print(f"レポートを書き出しました -> {out}")
    print("\n".join(md[:24]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
