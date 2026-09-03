#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
estimate.py — 実行前に、全ジョブの費用を見積もる。APIキー不要。

OpenRouter の公開モデル一覧（認証不要）から単価を取り、prompts/*.json の
実際の文字数からトークン数を概算して、モデルごとの費用を出す。

トークン換算は概算です。日本語は 1トークン ≒ 1.2文字 前後を仮定しています
（モデルのトークナイザで変わるため、±50%は見ておいてください）。
確定値がほしい場合は run_openrouter.py --dry-run で1件だけ実測してください。

使い方
  python estimate.py --models models.txt --repeat 3
  python estimate.py --models models.txt --repeat 3 --prompts 01_tl,05_light
"""

from __future__ import annotations

import argparse
import json
import urllib.request
from pathlib import Path

import promptlib

MODELS_API = "https://openrouter.ai/api/v1/models"
CHARS_PER_TOKEN = 1.2      # 日本語の概算
PREAMBLE_OUT_TOKENS = 20   # 「準備できました」程度


def fetch_pricing() -> dict[str, dict]:
    d = json.load(urllib.request.urlopen(MODELS_API, timeout=30))["data"]
    return {m["id"]: m for m in d}


def fetch_endpoint_pricing(model_id: str, provider_tag: str) -> tuple[float, float, str] | None:
    """@プロバイダ で固定したときの、その提供元の単価と量子化を取る。

    モデル一覧の単価は代表値なので、提供元を固定すると実額がずれる
    （Gemini の flex は半額、Kimi の fp4 と bf16 は別単価、など）。
    """
    url = f"{MODELS_API}/{model_id}/endpoints"
    try:
        d = json.load(urllib.request.urlopen(url, timeout=30))["data"]
    except Exception:  # noqa: BLE001
        return None
    for ep in d.get("endpoints", []):
        if ep.get("tag") == provider_tag:
            pr = ep.get("pricing", {})
            return (float(pr.get("prompt", 0)), float(pr.get("completion", 0)),
                    str(ep.get("quantization")))
    return None


def toks(text: str) -> int:
    return int(len(text) / CHARS_PER_TOKEN)


def job_tokens(job: dict, out_ratio: float) -> tuple[int, int]:
    """1ジョブの入力・出力トークンを概算する。

    マルチターン（RP）は、前のやり取りを毎回送り直すので入力が累積する。
    そこを無視すると見積りが実額より低く出るので、累積で数える。
    """
    ctx = toks(job["system"] or "")
    tin = tout = 0

    if job.get("preamble"):
        ctx += toks(job["preamble"]["user"])
        tin += ctx
        tout += PREAMBLE_OUT_TOKENS
        ctx += PREAMBLE_OUT_TOKENS

    per_turn_out = int(job["max_tokens"] * out_ratio)
    for turn in job["turns"]:
        ctx += toks(turn)
        tin += ctx
        tout += per_turn_out
        ctx += per_turn_out
    return tin, tout


def main() -> int:
    ap = argparse.ArgumentParser(description="実行前の費用見積り（キー不要）")
    ap.add_argument("--models", required=True)
    ap.add_argument("--prompts", default=None)
    ap.add_argument("--repeat", type=int, default=1)
    ap.add_argument("--no-preamble", action="store_true")
    ap.add_argument("--preamble-variant", default=None,
                    help="role（既定・官能小説家を明示） / plain（ジャンル宣言なし）")
    ap.add_argument("--out-ratio", type=float, default=0.6,
                    help="max_tokens のうち実際に書かれる割合の仮定（既定 0.6）")
    ap.add_argument("--judge-model", default=None,
                    help="指定すると主観採点(score_judge.py)の費用も足す")
    args = ap.parse_args()

    pricing = fetch_pricing()
    raw_models = promptlib.load_models(args.models)
    only = [x.strip() for x in args.prompts.split(",")] if args.prompts else None
    sets = promptlib.load_sets(only=only)

    # models.txt の "モデルID@プロバイダ" 記法から、単価引き用のIDだけ取り出す
    ids = [m.split("@")[0] for m in raw_models]
    jobs = promptlib.expand_jobs(sets, ["_"], style_examples="(作例)",
                                 repeat=args.repeat,
                                 use_preamble=not args.no_preamble,
                                 preamble_variant=args.preamble_variant)

    tin = tout = 0
    per_set: dict[str, list[int]] = {}
    for j in jobs:
        a, b = job_tokens(j, args.out_ratio)
        tin += a
        tout += b
        s = per_set.setdefault(j["prompt_id"], [0, 0, 0])
        s[0] += 1
        s[1] += a
        s[2] += b

    print(f"プロンプトセット {len(sets)} 種 / 1モデルあたり {len(jobs)} ジョブ")
    print(f"1モデルあたりの概算トークン: 入力 {tin:,} / 出力 {tout:,}\n")

    print(f"{'プロンプト':<16}{'件数':>5}{'入力tok':>10}{'出力tok':>10}")
    for pid, (n, a, b) in sorted(per_set.items()):
        print(f"{pid:<16}{n:>5}{a:>10,}{b:>10,}")
    print()

    rows, total = [], 0.0
    for raw in raw_models:
        mid, prov = promptlib.parse_model(raw)
        m = pricing.get(mid)
        if not m:
            rows.append((raw, None, None, None, ""))
            continue
        quant = ""
        ep = fetch_endpoint_pricing(mid, prov) if prov else None
        if ep:
            pin, pout, quant = ep
        else:
            p = m.get("pricing", {})
            pin, pout = float(p.get("prompt", 0)), float(p.get("completion", 0))
            if prov:
                quant = "(タグ不一致)"
        cost = tin * pin + tout * pout
        total += cost
        rows.append((raw, pin * 1e6, pout * 1e6, cost, quant))

    print(f"{'モデル':<44}{'入$/M':>8}{'出$/M':>8}{'量子化':>10}{'概算':>10}")
    for raw, pin, pout, cost, quant in rows:
        if cost is None:
            print(f"{raw:<44}{'':>8}{'':>8}{'':>10}{'見つからない':>10}")
        else:
            print(f"{raw:<44}{pin:>8.3f}{pout:>8.3f}{quant:>10}{'$%.3f' % cost:>10}")
    print(f"{'':<44}{'':>8}{'':>8}{'合計':>10}{'$%.3f' % total:>10}")

    if args.judge_model:
        jm = pricing.get(args.judge_model)
        if jm:
            p = jm.get("pricing", {})
            # 採点は「指示＋出力」を読ませて、JSONを400トークンほど返させる
            n_files = len(jobs) * len(ids)
            j_in = tin + tout  # 出力を読ませるぶん
            j_out = 400 * n_files
            jcost = j_in * float(p.get("prompt", 0)) * len(ids) + j_out * float(p.get("completion", 0))
            print(f"\n主観採点（{args.judge_model}・{n_files}ファイル）: 約 ${jcost:.3f}")
            print(f"合計（生成＋採点）: 約 ${total + jcost:.3f}")

    print("\n※ 日本語1トークン≒1.2文字、出力は max_tokens の "
          f"{args.out_ratio:.0%} と仮定した概算です。上下2倍は見ておいてください。")
    print("※ 確定値は run_openrouter.py --dry-run で1件だけ実測できます。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
