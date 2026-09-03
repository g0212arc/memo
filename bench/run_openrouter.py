#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
run_openrouter.py — OpenRouter 経由で、検証プロンプト一式を各モデルに投げる。

設計の主眼はコスト管理。クレジット制限のあるキーで回す前提なので、
「投げる前に必ず見積もる」「上限を超えたら止まる」を仕組みで担保する。

  1. 実行前に GET /api/v1/key で残クレジットと上限を表示する
  2. --dry-run で1件だけ実行し、実測コストから全件の見積りを出して終了する
  3. --budget-usd を超えそうになったら、その手前で止める（超えてからではなく手前）
  4. 出力は score_mech.py がそのまま読めるファイル名で保存する

キーはコマンドライン引数では受け取らない（シェル履歴とプロセス一覧に残るため）。
  環境変数 OPENROUTER_API_KEY か、--key-file <path> を使う。

使い方
  export OPENROUTER_API_KEY=sk-or-...
  python run_openrouter.py --models models.txt --dry-run
  python run_openrouter.py --models models.txt --budget-usd 1.0
  python run_openrouter.py --models models.txt --prompts 01_tl,04_rp --budget-usd 0.5
"""

from __future__ import annotations

import argparse
import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

import promptlib

API = "https://openrouter.ai/api/v1"
HERE = Path(__file__).resolve().parent

# ollama 固有で、OpenRouter に送れないパラメータ。
# 記事の repeat_last_n 256 はローカル推論の設定なので、クラウド側では再現できない。
# 黙って落とすと「同じ条件で比較した」と誤解するので、実行時に明示する。
OLLAMA_ONLY = ("repeat_last_n", "think")

# 前段の返答が拒否だった場合の目印。本編を投げる前に分かるので、記録して先へ進む。
# 「断られた」こと自体が検証結果なので、エラーにはしない。
PREAMBLE_REFUSAL = (
    "申し訳", "できません", "お応えできません", "I cannot", "I can't", "I'm sorry",
    "不適切", "お手伝いできません",
)


def get_key(key_file: str | None) -> str:
    if key_file:
        k = Path(key_file).read_text(encoding="utf-8").strip()
        if k:
            return k
    k = os.environ.get("OPENROUTER_API_KEY", "").strip()
    if not k:
        sys.exit("APIキーがありません。export OPENROUTER_API_KEY=... か --key-file を指定してください。")
    return k


def request(url: str, key: str, payload: dict | None = None, timeout: int = 300) -> dict:
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(
        url, data=data,
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            # OpenRouter が推奨するアプリ識別ヘッダ。無くても動く。
            "X-Title": "local-llm-bench",
        },
        method="POST" if data else "GET",
    )
    ctx = ssl.create_default_context()
    with urllib.request.urlopen(req, timeout=timeout, context=ctx) as r:
        return json.loads(r.read().decode("utf-8"))


def preflight(key: str) -> dict:
    """残クレジットと上限を出す。ここで落ちるなら、キーが無効か期限切れ。"""
    try:
        info = request(f"{API}/key", key).get("data", {})
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")[:300]
        sys.exit(f"キーの確認に失敗しました (HTTP {e.code}): {body}")
    limit, usage = info.get("limit"), info.get("usage", 0)
    remaining = info.get("limit_remaining")
    if remaining is None and limit is not None:
        remaining = limit - usage
    print("--- キー情報 ---")
    print(f"  ラベル      : {info.get('label') or '(なし)'}")
    print(f"  使用済み    : ${usage:.4f}" if isinstance(usage, (int, float)) else f"  使用済み: {usage}")
    print(f"  上限        : {'$%.4f' % limit if isinstance(limit, (int, float)) else '無制限'}")
    print(f"  残り        : {'$%.4f' % remaining if isinstance(remaining, (int, float)) else '不明'}")
    print(f"  無料枠のみ  : {info.get('is_free_tier')}")
    return info


# reasoning の送り方。左から順に試して、通ったものを使う。
#   off     … 思考を無効化（記事の think:false 相当）
#   exclude … 思考は動くが本文には出さない（無効化を拒むモデル向け）
#   none    … reasoning を一切指定しない
REASONING_MODES = ("off", "exclude", "none")


def build_body(job: dict, messages: list[dict], max_tokens: int,
               reasoning_mode: str = "off") -> dict:
    p = job["params"]
    model_id, provider = promptlib.parse_model(job["model"])
    body = {
        "model": model_id,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": p.get("temperature"),
        "top_p": p.get("top_p"),
        "top_k": p.get("top_k"),
        "min_p": p.get("min_p"),
        # OpenRouter でのパラメータ名は repetition_penalty（ollama の repeat_penalty 相当）
        "repetition_penalty": p.get("repeat_penalty"),
        "seed": p.get("seed"),
        # 実費をレスポンスに含めてもらう。見積りの根拠になる。
        "usage": {"include": True},
    }
    if p.get("think") is False and reasoning_mode != "none":
        # 思考トークンで本文が空になる事故（記事の think false）をクラウド側でも防ぐ。
        # ただし思考を必須にしているモデルがあるので、その場合は exclude だけに落とす。
        # 無効化できないモデルは、せめて思考量を最小にする
        body["reasoning"] = ({"exclude": True, "enabled": False} if reasoning_mode == "off"
                             else {"exclude": True, "effort": "low"})
    if job.get("format") == "json":
        body["response_format"] = {"type": "json_object"}
    if provider:
        # 提供元を固定する。フォールバックを許すと別の量子化に流れて比較が崩れる。
        body["provider"] = {"only": [provider], "allow_fallbacks": False}
    return {k: v for k, v in body.items() if v is not None}


# 429（提供元の混雑）は待てば通ることが多いので、長めに粘る。
# 提供元が1社しかないモデル（qwen3.8-flash など）は特にここで決まる。
RETRY_WAITS_429 = (15, 45, 120, 240)
RETRY_WAITS_5XX = (5, 15, 45)


def call(job: dict, messages: list[dict], key: str, max_tokens: int,
         retries: int | None = None) -> dict:
    # モデルごとに、一度通った reasoning の送り方を覚えて使い回す
    mode = job.setdefault("_reasoning_mode", "off")
    # 思考を止められないモデルは、思考トークンが max_tokens を食い尽くして
    # 本文が途中で切れる（実測: 1628tok 中 1419tok が思考、本文393字で打ち切り）。
    # 止められなかった場合だけ、その分の余裕を足す。
    budget = max_tokens + (job.get("_reasoning_headroom", 0) if mode != "off" else 0)
    body = build_body(job, messages, budget, mode)
    max_attempts = (retries + 1) if retries is not None else len(RETRY_WAITS_429) + 1
    last = None
    for attempt in range(max_attempts):
        t0 = time.time()
        try:
            res = request(f"{API}/chat/completions", key, body)
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")[:300]
            last = f"HTTP {e.code}: {detail}"
            # 429（混雑）と5xxだけ待って再試行。400番台の設定ミスは即諦める。
            # 思考の無効化を拒むモデルは、送り方を1段落として即やり直す。
            # 「無効化できなかった」は条件の違いなので、記録に残す。
            if e.code == 400 and "reasoning" in detail.lower():
                i = REASONING_MODES.index(job.get("_reasoning_mode", "off"))
                if i + 1 < len(REASONING_MODES):
                    job["_reasoning_mode"] = REASONING_MODES[i + 1]
                    print(f"    思考を無効化できないモデル "
                          f"-> reasoning={job['_reasoning_mode']} で再試行")
                    budget = max_tokens + (job.get("_reasoning_headroom", 0)
                                           if job["_reasoning_mode"] != "off" else 0)
                    body = build_body(job, messages, budget, job["_reasoning_mode"])
                    continue
                return {"error": last}
            if e.code == 429:
                waits = RETRY_WAITS_429
            elif 500 <= e.code < 600:
                waits = RETRY_WAITS_5XX
            else:
                return {"error": last}
            if attempt >= len(waits):
                return {"error": last}
            wait = waits[attempt]
            print(f"    混雑のため {wait}s 待って再試行 ({attempt + 1}/{len(waits)})")
            time.sleep(wait)
            continue
        except (urllib.error.URLError, TimeoutError) as e:
            last = f"network: {e}"
            if attempt >= len(RETRY_WAITS_5XX):
                return {"error": last}
            time.sleep(RETRY_WAITS_5XX[attempt])
            continue

        elapsed = time.time() - t0
        choice = (res.get("choices") or [{}])[0]
        text = (choice.get("message") or {}).get("content") or ""
        usage = res.get("usage") or {}
        ct = usage.get("completion_tokens") or 0
        return {
            "text": text,
            "elapsed_s": round(elapsed, 2),
            "prompt_tokens": usage.get("prompt_tokens"),
            "completion_tokens": ct,
            "cost_usd": usage.get("cost"),
            "tok_per_s": round(ct / elapsed, 1) if ct and elapsed else None,
            "finish_reason": choice.get("finish_reason"),
            "provider": res.get("provider"),
            "reasoning_mode": job.get("_reasoning_mode", "off"),
            "reasoning_tokens": (usage.get("completion_tokens_details") or {})
                                .get("reasoning_tokens"),
        }
    return {"error": last or "unknown"}


def run_job(job: dict, key: str, out_dir: Path) -> dict:
    """1ジョブ（RPは複数ターン）を実行して、テキストを保存する。"""
    messages = [{"role": "system", "content": job["system"]}] if job["system"] else []
    turn_results, texts = [], []
    preamble_info = None

    # 役割を確定させる前段ターン。ここで断られたら本編を投げる前に分かる。
    pre = job.get("preamble")
    if pre:
        messages.append({"role": "user", "content": pre["user"]})
        r = call(job, messages, key, pre.get("max_tokens", 128))
        if r.get("error"):
            return {**job_meta(job), "error": f"前段で失敗: {r['error']}", "turns_done": 0}
        messages.append({"role": "assistant", "content": r["text"]})
        preamble_info = {
            "reply": r["text"][:200],
            "refused": any(w in r["text"] for w in PREAMBLE_REFUSAL),
            "cost_usd": r.get("cost_usd") or 0,
        }
        turn_results.append(r)
    for i, turn in enumerate(job["turns"], 1):
        messages.append({"role": "user", "content": turn})
        r = call(job, messages, key, job["max_tokens"])
        if r.get("error"):
            return {**job_meta(job), "error": r["error"], "turns_done": i - 1}
        messages.append({"role": "assistant", "content": r["text"]})
        turn_results.append(r)
        texts.append(r["text"])

    # RP は 1ターン目/2ターン目を別ファイルにする（記事の *_turn2.txt と同じ形）
    written = []
    if len(texts) > 1:
        for i, t in enumerate(texts, 1):
            p = out_dir / job["out_name"].replace(".txt", f"_turn{i}.txt")
            p.write_text(t, encoding="utf-8")
            written.append(p.name)
    else:
        p = out_dir / job["out_name"]
        p.write_text(texts[0], encoding="utf-8")
        written.append(p.name)

    if preamble_info:
        turn_results = turn_results[1:] + [turn_results[0]]  # 集計には含めるが本文には出さない
    total_cost = sum(r.get("cost_usd") or 0 for r in turn_results)
    total_ct = sum(r.get("completion_tokens") or 0 for r in turn_results)
    total_s = sum(r.get("elapsed_s") or 0 for r in turn_results)
    return {
        **job_meta(job),
        "files": written,
        "chars": sum(len(t) for t in texts),
        "completion_tokens": total_ct,
        "prompt_tokens": sum(r.get("prompt_tokens") or 0 for r in turn_results),
        "elapsed_s": round(total_s, 2),
        "tok_per_s": round(total_ct / total_s, 1) if total_ct and total_s else None,
        "cost_usd": round(total_cost, 6),
        "finish_reason": turn_results[0].get("finish_reason") if preamble_info
                         else turn_results[-1].get("finish_reason"),
        "provider": turn_results[-1].get("provider"),
        "reasoning_mode": turn_results[-1].get("reasoning_mode"),
        "reasoning_tokens": sum(r.get("reasoning_tokens") or 0 for r in turn_results) or None,
        "preamble": preamble_info,
    }


def job_meta(job: dict) -> dict:
    model_id, provider = promptlib.parse_model(job["model"])
    return {
        "model": promptlib.slug(job["model"]),
        "model_id": model_id,
        "provider_pinned": provider,
        "prompt_id": job["prompt_id"],
        "scenario": job["scenario"],
        "seed": job["params"].get("seed"),
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="OpenRouter で検証プロンプトを回す")
    ap.add_argument("--models", required=True,
                    help="モデル一覧ファイル(1行1モデル) か カンマ区切りのモデルID")
    ap.add_argument("--prompts", default=None, help="使うプロンプトセットID（カンマ区切り）")
    ap.add_argument("--out", default="outputs", help="出力テキストの保存先")
    ap.add_argument("--runs", default="results/runs.json", help="実行記録の保存先")
    ap.add_argument("--style-examples", default=None, help="作例ファイル（03を回すなら必須）")
    ap.add_argument("--budget-usd", type=float, default=0.50,
                    help="この金額に達したら止める（既定 $0.50）")
    ap.add_argument("--dry-run", action="store_true",
                    help="1件だけ実行して全件の見積りを出す")
    ap.add_argument("--limit", type=int, default=None, help="先頭N件だけ実行する")
    ap.add_argument("--seed", type=int, default=None, help="seed を上書きする")
    ap.add_argument("--sleep", type=float, default=1.0, help="呼び出し間隔の秒数")
    ap.add_argument("--reasoning-headroom", type=int, default=4000,
                    help="思考を無効化できないモデルに足す max_tokens の余裕（既定 4000）")
    ap.add_argument("--repeat", type=int, default=1,
                    help="同じ条件を何回引くか（seedをずらして引き直す）。既定1、記事どおりなら3")
    ap.add_argument("--scenarios", default=None,
                    help="シナリオIDを絞る（カンマ区切り）。例: C_20years")
    ap.add_argument("--preamble-variant", default=None,
                    help='前段の変種。role=「官能小説家」を明示（既定） / '
                         'plain=ジャンルを宣言しない対照条件')
    ap.add_argument("--no-preamble", action="store_true",
                    help="役割を確定させる前段ターンを入れない（前段の効果を測るとき用）")
    ap.add_argument("--key-file", default=None)
    args = ap.parse_args()

    key = get_key(args.key_file)
    info = preflight(key)

    models = promptlib.load_models(args.models)
    only = [x.strip() for x in args.prompts.split(",")] if args.prompts else None
    sets = promptlib.load_sets(only=only)
    style = promptlib.load_style_examples(Path(args.style_examples)) if args.style_examples else ""
    jobs = promptlib.expand_jobs(sets, models, style, args.seed,
                                 repeat=args.repeat, use_preamble=not args.no_preamble,
                                 preamble_variant=args.preamble_variant,
                                 scenarios=[x.strip() for x in args.scenarios.split(",")]
                                 if args.scenarios else None)

    dropped = sorted({k for s in sets for k in s.get("params", {}) if k in OLLAMA_ONLY})
    if dropped:
        print(f"\n注意: {', '.join(dropped)} は ollama 固有の設定で、OpenRouter には送れません。")
        print("      ローカル検証と完全に同一条件ではない点を、記事に書くときは明記してください。")

    print(f"\nモデル {len(models)} 種 × プロンプト {len(sets)} セット = ジョブ {len(jobs)} 件")
    if args.dry_run:
        jobs = jobs[:1]
        print("--- ドライラン: 1件だけ実行します ---")
    elif args.limit:
        jobs = jobs[:args.limit]

    out_dir, runs_path = Path(args.out), Path(args.runs)
    out_dir.mkdir(parents=True, exist_ok=True)
    runs_path.parent.mkdir(parents=True, exist_ok=True)

    records, spent = [], 0.0
    total = len(jobs)
    for i, job in enumerate(jobs, 1):
        # 手前で止める: 1件の平均実費を使って、次の1件で超えるなら実行しない
        if records and spent > 0:
            avg = spent / len([r for r in records if not r.get("error")] or [1])
            if spent + avg > args.budget_usd:
                print(f"\n予算上限 ${args.budget_usd} に達するため、ここで停止します"
                      f"（使用 ${spent:.4f} / 残ジョブ {total - i + 1} 件）")
                break
        job["_reasoning_headroom"] = args.reasoning_headroom
        print(f"[{i}/{total}] {job['model']} <- {job['prompt_id']}/{job['scenario']} "
              f"seed={job['params'].get('seed')}")
        r = run_job(job, key, out_dir)
        records.append(r)
        if r.get("error"):
            print(f"    失敗: {r['error']}")
        else:
            spent += r.get("cost_usd") or 0
            pre = r.get("preamble") or {}
            mark = " [前段で拒否]" if pre.get("refused") else ""
            if r.get("reasoning_mode") and r["reasoning_mode"] != "off":
                mark += f" [思考{r.get('reasoning_tokens') or 0}tok]"
            print(f"    {r['chars']}字 / {r['completion_tokens']}tok / "
                  f"{r['tok_per_s']}t/s / ${r.get('cost_usd') or 0:.5f} "
                  f"/ finish={r.get('finish_reason')}{mark}")
        time.sleep(args.sleep)

    payload = {
        "provider": "openrouter",
        "key_label": info.get("label"),
        "models": models,
        "prompt_sets": [s["id"] for s in sets],
        "repeat": args.repeat,
        "preamble": not args.no_preamble,
        "preamble_variant": args.preamble_variant,
        "job_total": total,
        "job_done": len(records),
        "cost_usd_total": round(spent, 6),
        "ollama_only_params_dropped": dropped,
        "runs": records,
    }
    runs_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"\n実行 {len(records)} 件 / 実費 ${spent:.4f} -> {runs_path}")

    # 固定していないモデルは、呼び出しごとに提供元（＝量子化）が変わりうる。
    # 変わっていたら比較の前提が崩れるので、必ず知らせる。
    served: dict[str, set] = {}
    for r in records:
        if r.get("provider"):
            served.setdefault(r["model"], set()).add(r["provider"])
    mixed = {m: v for m, v in served.items() if len(v) > 1}
    if mixed:
        print("\n注意: 呼び出し中に提供元が変わったモデルがあります（量子化が違う可能性）:")
        for m, v in mixed.items():
            print(f"  {m}: {', '.join(sorted(v))}")
        print("  比較の前提を揃えるなら models.txt で モデルID@プロバイダ と固定してください。")
    if args.dry_run and records and not records[0].get("error"):
        one = records[0].get("cost_usd") or 0
        full = one * total
        print("\n--- 見積り ---")
        print(f"  1件の実費        : ${one:.5f}")
        print(f"  全 {total} 件の概算 : ${full:.4f}")
        print("  ※プロンプト長・出力長・モデル単価で件ごとに変わります。上下2倍は見ておいてください。")
        print(f"\n  本実行するなら: python run_openrouter.py --models {args.models} "
              f"--budget-usd {max(0.1, round(full * 1.5, 2))}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
