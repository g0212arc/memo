#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
organize.py — 出力テキストを、モデル名のフォルダに振り分ける。

判定ツールはファイル名から条件を読むので outputs/ は平置きのままにしておき、
人が読むためのコピーを別ディレクトリに作る。元は消さない。

  outputs/01_tl__C_20years_seed12345__grok-4.6-xai-zdr.txt
    -> outputs_by_model/grok-4.6-xai-zdr/01_tl__C_20years_seed12345.txt

使い方
  python organize.py                          # モデル名で分ける
  python organize.py --by prompt              # プロンプトで分ける
  python organize.py --zip out.zip            # まとめて zip も作る
"""

from __future__ import annotations

import argparse
import shutil
import zipfile
from pathlib import Path

import promptlib
from score_mech import parse_name


def prompt_text(pset: dict, style: str) -> str:
    """そのプロンプトフォルダに同梱する、実際に投げた指示の全文。

    出力だけ渡されても何を頼んだか分からないので、テキストと同じ場所に置く。
    """
    out = [f"# {pset['seq']}. {pset['label']}  ({pset['id']})", ""]
    if pset.get("note"):
        out += [f"# {pset['note']}", ""]
    prm = pset.get("params") or {}
    out += ["# 生成パラメータ: " + " / ".join(
        f"{k}={v}" for k, v in prm.items() if v is not None), ""]

    pre = pset.get("preamble") or {}
    for name, v in (pre.get("variants") or {}).items():
        tag = "既定" if name == pre.get("default") else "対照条件"
        out += [f"===== 前段ターン: {name}（{tag}） =====", v["user"], ""]

    sys_text = pset.get("system")
    if sys_text:
        if promptlib.STYLE_PLACEHOLDER in sys_text and style:
            sys_text = sys_text.replace(promptlib.STYLE_PLACEHOLDER, style)
        out += ["===== システムプロンプト =====", sys_text, ""]
    else:
        out += ["===== システムプロンプト =====", "（なし）", ""]

    for sc in pset["scenarios"]:
        if sc.get("turns"):
            for i, t in enumerate(sc["turns"], 1):
                out += [f'===== ユーザープロンプト: {sc["id"]} / {i}ターン目 =====', t, ""]
        else:
            out += [f'===== ユーザープロンプト: {sc["id"]} =====', sc["user"], ""]
    return "\n".join(out) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser(description="出力をフォルダに振り分ける")
    ap.add_argument("--in", dest="inp", default="outputs")
    ap.add_argument("--out", default="outputs_by_model")
    ap.add_argument("--by", choices=("model", "prompt", "nested"), default="model",
                    help="model=モデル名 / prompt=プロンプト / "
                         "nested=モデル/プロンプト/試行 の3階層（既定 model）")
    ap.add_argument("--zip", default=None, help="この名前で zip も作る")
    ap.add_argument("--clean", action="store_true", help="出力先を作り直す")
    args = ap.parse_args()

    src, dst = Path(args.inp), Path(args.out)
    files = sorted(f for f in src.glob("*.txt") if f.is_file())
    if not files:
        print(f"対象がありません: {src}")
        return 1
    if args.clean and dst.exists():
        shutil.rmtree(dst)

    counts: dict[str, int] = {}
    seed_order: dict[str, list] = {}   # プロンプトごとの seed の登場順＝何回目か
    for f in sorted(files, key=lambda x: (parse_name(x.stem)["seq"],
                                          parse_name(x.stem)["seed"])):
        meta = parse_name(f.stem)
        prompt = f'{meta["seq"]}_{meta["condition"]}'
        if args.by == "nested":
            # モデル / プロンプト / 試行 の3階層。
            # 試行フォルダは「何回目か」で並べる。ただし再現に必要なので seed も残す。
            seed = meta["seed"]
            nth = seed_order.setdefault(prompt, [])
            if seed and seed not in nth:
                nth.append(seed)
            i = (nth.index(seed) + 1) if seed and seed in nth else 1
            trial = f"試行{i}_seed{seed}" if seed else "試行1"
            if meta["preamble"] not in ("role", ""):
                trial += f'_{meta["preamble"]}'
            folder = f'{meta["model"]}/{prompt}/{trial}'
            stem = meta["scenario"] or prompt
            if meta["turn"]:
                stem += f'_turn{meta["turn"]}'
        elif args.by == "model":
            folder = meta["model"]
            stem = f.stem.rsplit("__", 1)[0]
            if meta["turn"]:
                stem += f'_turn{meta["turn"]}'
        else:
            folder = prompt
            stem = f.stem.split("__", 1)[-1]
        out = dst / folder
        out.mkdir(parents=True, exist_ok=True)
        shutil.copy2(f, out / f"{stem}.txt")
        top = folder.split("/")[0]
        counts[top] = counts.get(top, 0) + 1

    # 各プロンプトフォルダに、実際に投げた指示の全文を置く
    if args.by == "nested":
        style = promptlib.load_style_examples(Path("wordlists/style_examples.txt"))
        sets = {f'{x["seq"]}_{x["id"].split("_", 1)[-1]}': x for x in promptlib.load_sets()}
        placed = 0
        for d in dst.glob("*/*"):
            if not d.is_dir():
                continue
            pset = sets.get(d.name)
            if pset:
                own = pset.get("style_examples_file")
                st = promptlib.load_style_examples(Path(own)) if own else style
                (d / "_プロンプト.txt").write_text(prompt_text(pset, st), encoding="utf-8")
                placed += 1
        print(f"プロンプト全文を {placed} フォルダに同梱しました")

    print(f"{len(files)} 本を {len(counts)} フォルダに振り分けました -> {dst}")
    for k in sorted(counts):
        print(f"  {k:<40}{counts[k]:>4} 本")

    if args.zip:
        z = Path(args.zip)
        with zipfile.ZipFile(z, "w", zipfile.ZIP_DEFLATED) as zf:
            for f in sorted(dst.rglob("*.txt")):
                zf.write(f, f.relative_to(dst.parent))
        print(f"\nzip: {z} ({z.stat().st_size / 1024 / 1024:.1f} MB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
