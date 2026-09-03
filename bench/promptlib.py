#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
promptlib.py — prompts/*.json を読み、実行ジョブに展開する共通処理。

run_openrouter.py と run_ollama.py の両方から使う。ここを1箇所にしておくと、
「クラウドとローカルで違うプロンプトを投げていた」という事故が起きない。
"""

from __future__ import annotations

import json
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
STYLE_PLACEHOLDER = "{{STYLE_EXAMPLES}}"


def slug(s: str) -> str:
    """モデルIDをファイル名に使える形にする。deepseek/deepseek-chat -> deepseek-chat"""
    s = s.split("/")[-1]
    return re.sub(r"[^0-9A-Za-z._\-]+", "-", s).strip("-")


def load_style_examples(path: Path | None) -> str:
    if path is None or not path.exists():
        return ""
    lines = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            lines.append(line)
    return "\n".join(lines)


def load_sets(prompt_dir: Path | None = None, only: list[str] | None = None) -> list[dict]:
    d = prompt_dir or HERE / "prompts"
    sets = []
    for p in sorted(d.glob("*.json")):
        s = json.loads(p.read_text(encoding="utf-8"))
        if only and s["id"] not in only and s["seq"] not in only:
            continue
        sets.append(s)
    return sets


def expand_jobs(sets: list[dict], models: list[str], style_examples: str = "",
                seed_override: int | None = None) -> list[dict]:
    """プロンプトセット × シナリオ × モデル × seed を、実行単位に展開する。"""
    jobs: list[dict] = []
    for s in sets:
        system = s.get("system")
        if system and STYLE_PLACEHOLDER in system:
            if not style_examples:
                # 作例が無いままだとプレースホルダのまま送ってしまう。黙って壊れるより落とす。
                raise SystemExit(
                    f"[{s['id']}] は作例が必要です。"
                    "wordlists/style_examples.txt を用意して --style-examples で渡してください。"
                )
            system = system.replace(STYLE_PLACEHOLDER, style_examples)

        seeds = s.get("seeds") or [seed_override or s.get("params", {}).get("seed", 12345)]
        if seed_override is not None:
            seeds = [seed_override] * len(seeds) if s.get("seeds") else [seed_override]

        for sc in s["scenarios"]:
            for seed in seeds:
                turns = sc.get("turns") or [sc["user"]]
                name = f"{s['seq']}_{s['id'].split('_', 1)[-1]}__{sc['id']}"
                if len(seeds) > 1 or s.get("seeds"):
                    name += f"_seed{seed}"
                jobs.append({
                    "prompt_id": s["id"],
                    "seq": s["seq"],
                    "label": s["label"],
                    "scenario": sc["id"],
                    "system": system,
                    "turns": turns,
                    "params": {**s.get("params", {}), "seed": seed},
                    "max_tokens": s.get("max_tokens", 4000),
                    "expect_chars": s.get("expect_chars"),
                    "format": s.get("format"),
                    "name_base": name,
                })
    # モデルを最後に掛ける（同じジョブを全モデルで回すほうが比較しやすい）
    out = []
    for m in models:
        for j in jobs:
            out.append({**j, "model": m, "out_name": f"{j['name_base']}__{slug(m)}.txt"})
    return out


def load_models(path_or_list: str) -> list[str]:
    """モデル一覧を、ファイル（1行1モデル）かカンマ区切りで受け取る。"""
    p = Path(path_or_list)
    if p.exists():
        out = []
        for line in p.read_text(encoding="utf-8").splitlines():
            line = line.split("#")[0].strip()
            if line:
                out.append(line)
        return out
    return [x.strip() for x in path_or_list.split(",") if x.strip()]
