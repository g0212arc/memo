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

from score_mech import parse_name


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
    for f in files:
        meta = parse_name(f.stem)
        prompt = f'{meta["seq"]}_{meta["condition"]}'
        if args.by == "nested":
            # モデル / プロンプト / 試行 の3階層。
            # 試行は seed（05は宣言済みseed、他は引き直しのseed）で分ける。
            trial = f'seed{meta["seed"]}' if meta["seed"] else "seed_default"
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
