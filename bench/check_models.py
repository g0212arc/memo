#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
check_models.py — models.txt の全モデルが、そのキーで実際に使えるか確かめる。

本番を回してから「このモデルだけ弾かれていた」と気づくのを防ぐための事前点検。
1モデルにつき出力1トークンだけ要求するので、費用はほぼゼロ（合計で$0.001未満）。

見るのは3つ:
  - そのキー／アカウントで呼べるか（データポリシーやガードレールで弾かれないか）
  - @プロバイダ で固定した指定が通るか
  - 実際にどの提供元が応答したか（固定していないモデルの確認用）

使い方
  python check_models.py --key-file ~/or.key --models models.txt
"""

from __future__ import annotations

import argparse
import json
import time
import urllib.error
import urllib.request
from pathlib import Path

import promptlib
from run_openrouter import API, get_key, preflight, request

PROVIDERS_API = "https://openrouter.ai/api/frontend/v1/all-providers"


def fetch_provider_policies() -> dict[str, dict]:
    """提供元ごとの「学習に使うか」「プロンプトを保持するか」を取る。

    NSFW を投げる以上、行き先がどういうポリシーかは知っておきたい。
    取得できなくても点検自体は続ける（付加情報なので落とさない）。
    """
    try:
        d = json.load(urllib.request.urlopen(PROVIDERS_API, timeout=30))["data"]
    except Exception:  # noqa: BLE001
        return {}
    return {p.get("displayName", ""): (p.get("dataPolicy") or {}) for p in d}


def policy_label(pol: dict) -> str:
    if not pol:
        return "ポリシー不明"
    train = "学習する" if pol.get("training") else "学習しない"
    if pol.get("retainsPrompts"):
        days = pol.get("retentionDays")
        keep = f"保持{days}日" if days else "保持あり"
    else:
        keep = "保持なし"
    return f"{train}/{keep}"


def check(spec: str, key: str, retry_429: bool = True) -> dict:
    model_id, provider = promptlib.parse_model(spec)
    body = {
        "model": model_id,
        "messages": [{"role": "user", "content": "こんにちは"}],
        # 1 にすると弾く提供元がある（Meta は max_output_tokens >= 16 を要求）。
        # 点検で落ちて「使えないモデル」と誤判定するので、通る最小値にしておく。
        "max_tokens": 16,
        "usage": {"include": True},
    }
    if provider:
        body["provider"] = {"only": [provider], "allow_fallbacks": False}
    try:
        res = request(f"{API}/chat/completions", key, body, timeout=90)
    except urllib.error.HTTPError as e:
        if e.code == 429 and retry_429:
            # 点検で429、本番では通る…という紛らわしさを避けるため、一度だけ待って確認する
            time.sleep(20)
            return check(spec, key, retry_429=False)
        raw = e.read().decode("utf-8", "replace")
        try:
            msg = json.loads(raw)["error"]["message"]
        except Exception:  # noqa: BLE001
            msg = raw[:200]
        return {"spec": spec, "ok": False, "code": e.code, "reason": msg.strip()}
    except Exception as e:  # noqa: BLE001
        return {"spec": spec, "ok": False, "code": None, "reason": str(e)[:200]}
    return {
        "spec": spec,
        "ok": True,
        "served_by": res.get("provider"),
        "cost_usd": (res.get("usage") or {}).get("cost") or 0,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="モデルの利用可否を事前点検する")
    ap.add_argument("--models", required=True)
    ap.add_argument("--key-file", default=None)
    ap.add_argument("--out", default="results/model_check.json")
    args = ap.parse_args()

    key = get_key(args.key_file)
    preflight(key)

    specs = promptlib.load_models(args.models)
    policies = fetch_provider_policies()
    print(f"\n{len(specs)} モデルを点検します（出力1トークンずつ）\n")
    rows, spent = [], 0.0
    for spec in specs:
        r = check(spec, key)
        rows.append(r)
        spent += r.get("cost_usd") or 0
        if r["ok"]:
            pol = policy_label(policies.get(r.get("served_by") or "", {}))
            r["data_policy"] = pol
            print(f"  OK   {spec:<44} 提供元={str(r.get('served_by')):<16} {pol}")
        else:
            # 理由は1行に潰す。長い説明でも「なぜ弾かれたか」の先頭が読めればよい。
            reason = " ".join((r["reason"] or "").split())[:150]
            print(f"  NG   {spec:<44} [{r.get('code')}] {reason}")

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"cost_usd_total": round(spent, 6), "results": rows},
                              ensure_ascii=False, indent=2), encoding="utf-8")
    ok = sum(1 for r in rows if r["ok"])
    print(f"\n使えるモデル {ok}/{len(rows)} / 点検の実費 ${spent:.5f} -> {out}")
    trains = [r["spec"] for r in rows if r.get("data_policy", "").startswith("学習する")]
    if trains:
        print("\n注意: 送った内容が学習に使われる提供元:")
        for t in trains:
            print(f"  {t}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
