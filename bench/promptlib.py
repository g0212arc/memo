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


def parse_model(spec: str) -> tuple[str, str | None]:
    """"モデルID@プロバイダ" を (モデルID, プロバイダタグ) に分ける。

    同じモデルでも提供元によって量子化(fp8/fp4)が違い、出力も変わる。
    固定しないと呼び出しごとに提供元が変わって比較にならないので、
    models.txt で "deepseek/deepseek-v4-pro-0813@streamlake" と書けるようにしている。
    """
    if "@" in spec:
        mid, prov = spec.split("@", 1)
        return mid.strip(), prov.strip() or None
    return spec.strip(), None


def slug(s: str) -> str:
    """モデル指定をファイル名に使える形にする。

    deepseek/deepseek-v4-pro-0813@streamlake -> deepseek-v4-pro-0813-streamlake
    提供元を名前に残さないと、比較用に分けた2本が同じファイル名で衝突する。
    """
    mid, prov = parse_model(s)
    name = mid.split("/")[-1]
    if prov:
        name = f"{name}-{prov}"
    return re.sub(r"[^0-9A-Za-z._\-]+", "-", name).strip("-")


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


# 繰り返し実行で seed をずらす幅。連番だと近い分布を引くことがあるので離す。
SEED_STEP = 1111


def expand_jobs(sets: list[dict], models: list[str], style_examples: str = "",
                seed_override: int | None = None, repeat: int = 1,
                use_preamble: bool = True,
                preamble_variant: str | None = None,
                scenarios: list[str] | None = None) -> list[dict]:
    """プロンプトセット × シナリオ × モデル × seed を、実行単位に展開する。

    repeat: 同じ条件を何回引くか。拒否は運で変わるので、1回で「拒否した」と
            結論づけないための回数。seed をずらして引き直す。
            seeds が宣言済みのセット（05_light）は既に3回引いているので対象外。
    use_preamble: 役割を確定させる前段ターンを入れるか。
            前段あり/なしで拒否率が変わるかどうか自体が検証データになるので、
            既定は入れるが、外して比較できるようにしてある。
    """
    jobs: list[dict] = []
    for s in sets:
        system = s.get("system")
        if system and STYLE_PLACEHOLDER in system:
            # セット自身が作例ファイルを指定していればそれを使う。
            # 「解説つきの作例」と「音の一覧だけ」を同じ実行で比べたいため。
            own = s.get("style_examples_file")
            if own:
                style_examples = load_style_examples(HERE / own)
            if not style_examples:
                # 作例が無いままだとプレースホルダのまま送ってしまう。黙って壊れるより落とす。
                raise SystemExit(
                    f"[{s['id']}] は作例が必要です。"
                    "wordlists/style_examples.txt を用意して --style-examples で渡してください。"
                )
            system = system.replace(STYLE_PLACEHOLDER, style_examples)

        declared = s.get("seeds")
        base = seed_override if seed_override is not None else s.get("params", {}).get("seed", 12345)
        if declared:
            seeds = [seed_override] * len(declared) if seed_override is not None else list(declared)
        else:
            seeds = [base + i * SEED_STEP for i in range(max(1, repeat))]

        preamble, pre_tag = None, "none"
        if use_preamble and s.get("preamble"):
            pre = s["preamble"]
            default = pre.get("default", "role")
            want = preamble_variant or default
            v = (pre.get("variants") or {}).get(want)
            if v is None:
                raise SystemExit(
                    f"[{s['id']}] に前段の変種 {want!r} がありません。"
                    f"使えるのは: {', '.join(pre.get('variants', {}))}"
                )
            preamble = {"user": v["user"], "max_tokens": pre.get("max_tokens", 128),
                        "variant": want}
            pre_tag = want if want != default else ""

        for sc in s["scenarios"]:
            # 条件を1つだけ変えて比べたいとき、シナリオ3本すべてを回す必要はない。
            # 前段の効果測定のような予備実験を安く済ませるための絞り込み。
            if scenarios and sc["id"] not in scenarios:
                continue
            for seed in seeds:
                turns = sc.get("turns") or [sc["user"]]
                name = f"{s['seq']}_{s['id'].split('_', 1)[-1]}__{sc['id']}"
                if len(seeds) > 1 or declared:
                    name += f"_seed{seed}"
                # 既定の変種はファイル名に出さない（前回と同じ名前を保つため）。
                # 対照条件だけ名前に出して、混ざらないようにする。
                if not use_preamble:
                    name += "_nopre"
                elif pre_tag:
                    name += f"_pre{pre_tag}"
                jobs.append({
                    "prompt_id": s["id"],
                    "seq": s["seq"],
                    "label": s["label"],
                    "scenario": sc["id"],
                    "system": system,
                    "preamble": preamble,
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
