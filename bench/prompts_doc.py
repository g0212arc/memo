#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
prompts_doc.py — 検証に使ったプロンプト一式を、公開用の HTML / Markdown にする。

「どんな指示で書かせたか」が分からないと、結果の数字は読めない。
記事と一緒にプロンプトを出すためのページを、prompts/*.json から生成する。

使い方
  python prompts_doc.py --out results/prompts.html
  python prompts_doc.py --out results/prompts.md
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import promptlib
from report import Doc
from score_mech import read_text

HERE = Path(__file__).resolve().parent


def block(doc: Doc, title: str, text: str) -> None:
    """見出し＋本文。プロンプトは整形済みの塊で、そのまま読めるように出す。"""
    doc.h(4, title)
    doc.pre(text)


def main() -> int:
    ap = argparse.ArgumentParser(description="プロンプト一式を公開用ページにする")
    ap.add_argument("--out", default="results/prompts.html")
    ap.add_argument("--title", default="検証に使ったプロンプト一式")
    ap.add_argument("--style-examples", default="wordlists/style_examples.txt")
    ap.add_argument("--with-outputs", default=None,
                    help="生成された文章の全文も載せる（有料記事の付録用）。"
                         "出力ディレクトリを指定する")
    ap.add_argument("--outputs-limit", type=int, default=0,
                    help="載せる本数の上限（0で全部）")
    args = ap.parse_args()

    style = promptlib.load_style_examples(Path(args.style_examples))
    sets = promptlib.load_sets()

    d = Doc()
    d.h(1, args.title)
    d.p("検証で実際に投げた指示の全文。数字だけ見ても何を測ったか分からないので、"
        "プロンプトはセットで公開する。**そのままコピーして再現できる**。")
    d.table(["ID", "内容", "シナリオ", "1本あたりの上限トークン"],
            [[s["id"], s["label"], len(s["scenarios"]), s.get("max_tokens", "-")]
             for s in sets], "llrr")
    d.p("生成パラメータは全セット共通で "
        "temperature 0.9（④のみ0.95、⑥は0.7）/ top_p 0.95 / top_k 50 / min_p 0.05 / "
        "repetition_penalty 1.08 / think false。"
        "`repeat_last_n` は ollama 固有のため、クラウド側には送れていない。")

    for s in sets:
        d.h(2, f'{s["seq"]}. {s["label"]}（`{s["id"]}`）')
        if s.get("note"):
            d.p(s["note"])
        if s.get("requirements"):
            d.h(4, "このプロンプトが満たすべき要件")
            d.ul(s["requirements"])

        pre = s.get("preamble") or {}
        for name, v in (pre.get("variants") or {}).items():
            tag = "既定" if name == pre.get("default") else "対照条件"
            block(d, f"前段ターン: {name}（{tag}）", v["user"])

        if s.get("system"):
            sys_text = s["system"]
            if promptlib.STYLE_PLACEHOLDER in sys_text and style:
                sys_text = sys_text.replace(promptlib.STYLE_PLACEHOLDER, style)
            block(d, "システムプロンプト", sys_text)
        else:
            d.p("システムプロンプトなし（軽い指示との差を見るため）。")

        for sc in s["scenarios"]:
            mark = "（今回書き起こしたもの）" if sc.get("restored") else ""
            if sc.get("turns"):
                for i, t in enumerate(sc["turns"], 1):
                    block(d, f'シナリオ `{sc["id"]}` — {i}ターン目{mark}', t)
            else:
                block(d, f'シナリオ `{sc["id"]}`{mark}', sc["user"])

    if args.with_outputs:
        outdir = Path(args.with_outputs)
        files = sorted(f for f in outdir.glob("*.txt") if f.is_file())
        if args.outputs_limit:
            files = files[:args.outputs_limit]
        d.h(2, "生成された文章（全文）")
        d.p(f"上のプロンプトを投げて実際に返ってきたもの。**{len(files)} 本**。"
            "판定の数字がどの文章から出たのかを、そのまま確認できる。")
        # プロンプトごとにまとめる。ファイル名は「連番_条件__シナリオ__モデル」。
        groups: dict[str, list[Path]] = {}
        for f in files:
            groups.setdefault(f.stem.split("__")[0], []).append(f)
        for head in sorted(groups):
            d.h(3, head)
            for f in groups[head]:
                d.h(4, f.stem.split("__", 1)[-1])
                d.pre(read_text(f).rstrip())

    d.h(2, "注記")
    d.ul([
        "**01_tl のシナリオ A / B は今回書き起こしたもの**。"
        "C_20years は前回の検証と同じ原文。",
        "**03 の作例も今回書き起こしたもの**。"
        "検証の目的は「渡した様式どおりの発話が出るか」なので、"
        "作例が原文と同一である必要はなく、規定を全種類ふくむことだけが要件。",
        "登場人物はすべて成人（20歳以上）の架空のオリジナルキャラクター。",
    ])

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    if out.suffix.lower() == ".md":
        out.write_text(d.to_markdown(), encoding="utf-8")
    else:
        out.write_text(d.to_html(args.title), encoding="utf-8")
    print(f"プロンプト集を書き出しました -> {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
