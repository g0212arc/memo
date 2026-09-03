#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
run_ollama.py — 同じプロンプト一式を、手元の ollama で回す。

run_openrouter.py と同じ promptlib を使うので、クラウド側と同一のプロンプト・
同一のファイル名規約で出力される。速度(tok/s)は ollama が返す実測値をそのまま使う。

こちらは repeat_last_n と think を送れる（ollama 固有の設定なので、
クラウド側では落ちる。記事の検証条件を完全に再現できるのはこちら）。

使い方（あなたの PC で）
  python run_ollama.py --models models_local.txt
  python run_ollama.py --models melody:latest --prompts 01_tl
  python run_ollama.py --models models_local.txt --keep-alive 0   # 1本ごとにVRAMを解放
"""

from __future__ import annotations

import argparse
import json
import time
import urllib.error
import urllib.request
from pathlib import Path

import promptlib

DEFAULT_HOST = "http://localhost:11434"


def post(host: str, path: str, payload: dict, timeout: int = 1800) -> dict:
    req = urllib.request.Request(
        f"{host}{path}",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def build_options(job: dict) -> dict:
    p = job["params"]
    return {
        "temperature": p.get("temperature"),
        "top_p": p.get("top_p"),
        "top_k": p.get("top_k"),
        "min_p": p.get("min_p"),
        "repeat_penalty": p.get("repeat_penalty"),
        "repeat_last_n": p.get("repeat_last_n"),
        "seed": p.get("seed"),
        "num_predict": job.get("max_tokens"),
    }


def call(host: str, job: dict, messages: list[dict], keep_alive: str | None) -> dict:
    body = {
        "model": job["model"],
        "messages": messages,
        "stream": False,
        "options": {k: v for k, v in build_options(job).items() if v is not None},
    }
    if job["params"].get("think") is False:
        body["think"] = False
    if job.get("format") == "json":
        body["format"] = "json"
    if keep_alive is not None:
        body["keep_alive"] = keep_alive

    t0 = time.time()
    try:
        res = post(host, "/api/chat", body)
    except urllib.error.HTTPError as e:
        return {"error": f"HTTP {e.code}: {e.read().decode('utf-8', 'replace')[:300]}"}
    except (urllib.error.URLError, TimeoutError) as e:
        return {"error": f"network: {e}（ollama は起動していますか）"}

    elapsed = time.time() - t0
    text = (res.get("message") or {}).get("content") or ""
    ct = res.get("eval_count") or 0
    # ollama は生成にかかったナノ秒を返す。tok/s はこちらのほうが正確。
    ed = (res.get("eval_duration") or 0) / 1e9
    return {
        "text": text,
        "elapsed_s": round(elapsed, 2),
        "completion_tokens": ct,
        "prompt_tokens": res.get("prompt_eval_count"),
        "tok_per_s": round(ct / ed, 1) if ct and ed else None,
        "finish_reason": res.get("done_reason"),
    }


PREAMBLE_REFUSAL = (
    "申し訳", "できません", "お応えできません", "I cannot", "I can't", "I'm sorry",
    "不適切", "お手伝いできません",
)


def run_job(host: str, job: dict, out_dir: Path, keep_alive: str | None) -> dict:
    messages = [{"role": "system", "content": job["system"]}] if job["system"] else []
    results, texts = [], []
    preamble_info = None

    pre = job.get("preamble")
    if pre:
        messages.append({"role": "user", "content": pre["user"]})
        r = call(host, {**job, "max_tokens": pre.get("max_tokens", 128)}, messages, keep_alive)
        if r.get("error"):
            return {**meta(job), "error": f"前段で失敗: {r['error']}", "turns_done": 0}
        messages.append({"role": "assistant", "content": r["text"]})
        preamble_info = {"reply": r["text"][:200],
                         "refused": any(w in r["text"] for w in PREAMBLE_REFUSAL)}
    for i, turn in enumerate(job["turns"], 1):
        messages.append({"role": "user", "content": turn})
        r = call(host, job, messages, keep_alive)
        if r.get("error"):
            return {**meta(job), "error": r["error"], "turns_done": i - 1}
        messages.append({"role": "assistant", "content": r["text"]})
        results.append(r)
        texts.append(r["text"])

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

    ct = sum(r.get("completion_tokens") or 0 for r in results)
    sec = sum(r.get("elapsed_s") or 0 for r in results)
    spd = [r["tok_per_s"] for r in results if r.get("tok_per_s")]
    return {
        **meta(job),
        "files": written,
        "chars": sum(len(t) for t in texts),
        "completion_tokens": ct,
        "elapsed_s": round(sec, 2),
        "tok_per_s": round(sum(spd) / len(spd), 1) if spd else None,
        "cost_usd": 0.0,
        "finish_reason": results[-1].get("finish_reason"),
        "preamble": preamble_info,
    }


def meta(job: dict) -> dict:
    return {
        "model": promptlib.slug(job["model"]),
        "model_id": job["model"],
        "prompt_id": job["prompt_id"],
        "scenario": job["scenario"],
        "seed": job["params"].get("seed"),
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="手元の ollama で検証プロンプトを回す")
    ap.add_argument("--models", required=True, help="モデル一覧ファイル か カンマ区切り")
    ap.add_argument("--prompts", default=None, help="使うプロンプトセットID（カンマ区切り）")
    ap.add_argument("--host", default=DEFAULT_HOST)
    ap.add_argument("--out", default="outputs")
    ap.add_argument("--runs", default="results/runs_local.json")
    ap.add_argument("--style-examples", default=None)
    ap.add_argument("--seed", type=int, default=None)
    ap.add_argument("--keep-alive", default=None,
                    help='モデルの常駐時間。"0" にすると1本ごとにVRAMを解放する')
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--repeat", type=int, default=1,
                    help="同じ条件を何回引くか（seedをずらして引き直す）")
    ap.add_argument("--no-preamble", action="store_true",
                    help="役割を確定させる前段ターンを入れない")
    args = ap.parse_args()

    models = promptlib.load_models(args.models)
    only = [x.strip() for x in args.prompts.split(",")] if args.prompts else None
    sets = promptlib.load_sets(only=only)
    style = promptlib.load_style_examples(Path(args.style_examples)) if args.style_examples else ""
    jobs = promptlib.expand_jobs(sets, models, style, args.seed,
                                 repeat=args.repeat, use_preamble=not args.no_preamble)
    if args.limit:
        jobs = jobs[:args.limit]

    out_dir, runs_path = Path(args.out), Path(args.runs)
    out_dir.mkdir(parents=True, exist_ok=True)
    runs_path.parent.mkdir(parents=True, exist_ok=True)

    print(f"モデル {len(models)} 種 × プロンプト {len(sets)} セット = ジョブ {len(jobs)} 件")
    records = []
    for i, job in enumerate(jobs, 1):
        print(f"[{i}/{len(jobs)}] {job['model']} <- {job['prompt_id']}/{job['scenario']} "
              f"seed={job['params'].get('seed')}")
        r = run_job(args.host, job, out_dir, args.keep_alive)
        records.append(r)
        if r.get("error"):
            print(f"    失敗: {r['error']}")
        else:
            mark = " [前段で拒否]" if (r.get("preamble") or {}).get("refused") else ""
            print(f"    {r['chars']}字 / {r['completion_tokens']}tok / {r['tok_per_s']}t/s{mark}")

    runs_path.write_text(json.dumps({
        "provider": "ollama", "host": args.host, "models": models,
        "prompt_sets": [s["id"] for s in sets],
        "job_total": len(jobs), "job_done": len(records),
        "repeat": args.repeat, "preamble": not args.no_preamble,
        "cost_usd_total": 0.0, "runs": records,
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n実行 {len(records)} 件 -> {runs_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
