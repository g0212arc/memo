#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
score_judge.py — 主観5軸を、判定モデル(OpenRouter)に採点させる。

記事の主観項目（官能描写力／心理・関係性／日本語の質／構成力／指示追従）を
各10点、計50点で採点する。採点は判定モデルに JSON で出させる。
人が読んで付けた点との突き合わせができるよう、点の根拠コメントも必ず取る。

判定モデルを1つに固定すると、そのモデルの好みがそのまま順位になる。
--judge-models に2つ以上渡すと、平均と、モデル間のばらつき(spread)を出す。
spread が大きい作品は「判定が割れた」ということなので、そこだけ人が見ればよい。

使い方
  export OPENROUTER_API_KEY=sk-or-...
  python score_judge.py --in outputs --runs results/runs.json --dry-run
  python score_judge.py --in outputs --runs results/runs.json --budget-usd 0.3
"""

from __future__ import annotations

import argparse
import json
import re
import statistics
import time
from pathlib import Path

import promptlib
from run_openrouter import API, get_key, preflight, request
from score_mech import parse_name, read_text

AXES = {
    "kannou": "官能描写力（そもそも官能として書けているか。ぼかして飛ばしていないか）",
    "shinri": "心理・関係性（関係の複雑さを捉えているか。心の動きが書かれているか）",
    "nihongo": "日本語の質（語彙の誤用・不自然な言い回し・他言語混入・造語がないか）",
    "kousei": "構成力（話の流れが破綻していないか。時系列・視点が崩れていないか）",
    "shijun": "指示追従（プロンプトの条件を守れているか。字数・文体・視点・禁止事項）",
}

JUDGE_SYSTEM = """あなたは日本語の創作文の評価者です。成人向けを含む創作文を、文章の出来として評価します。
評価対象は成人のみが登場する架空の創作物です。内容の是非ではなく、指示に対する達成度と日本語の質だけを見てください。

以下の5軸を各10点(1〜10の整数)で採点します。

""" + "\n".join(f"- {k}: {v}" for k, v in AXES.items()) + """

採点の基準:
  10 = プロの商業作品として通用する
   7 = 破綻はないが平凡
   4 = 読めるが明確な欠点がある
   1 = 破綻している / 指示を無視している / 書けていない

必ず次のJSONだけを出力してください。前置き・解説・コードブロック記号を含めないこと。
{"kannou":0,"shinri":0,"nihongo":0,"kousei":0,"shijun":0,"comment":"減点した具体的な理由を120字以内で"}"""


def build_user(instruction: str | None, text: str, limit: int = 12000) -> str:
    body = text[:limit]
    cut = "\n（※長いため先頭のみ）" if len(text) > limit else ""
    head = f"【与えた指示】\n{instruction}\n\n" if instruction else "【与えた指示】\n（記録なし）\n\n"
    return f"{head}【モデルの出力】\n{body}{cut}"


def extract_json(s: str) -> dict | None:
    """判定モデルが前置きを付けてきても拾えるようにする。"""
    s = s.strip()
    m = re.search(r"\{.*\}", s, re.S)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except json.JSONDecodeError:
        return None


def instructions_from_prompts(sets: list[dict]) -> dict[tuple[str, str], str]:
    """(prompt_id, scenario) -> 与えた指示テキスト。判定モデルに渡す。"""
    out = {}
    for s in sets:
        for sc in s["scenarios"]:
            user = sc.get("user") or (sc.get("turns") or [""])[0]
            sys_part = f"{s['system']}\n\n" if s.get("system") else ""
            out[(s["id"], sc["id"])] = f"{sys_part}{user}"
    return out


def judge_one(model: str, instruction: str | None, text: str, key: str,
              retries: int = 2) -> dict:
    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": JUDGE_SYSTEM},
            {"role": "user", "content": build_user(instruction, text)},
        ],
        "temperature": 0,          # 採点は毎回同じ結果になってほしい
        "max_tokens": 400,
        "response_format": {"type": "json_object"},
        "usage": {"include": True},
    }
    for attempt in range(retries + 1):
        try:
            res = request(f"{API}/chat/completions", key, body)
        except Exception as e:  # noqa: BLE001 - 失敗は記録して次へ進む
            if attempt == retries:
                return {"error": str(e)[:200]}
            time.sleep(2 ** attempt * 3)
            continue
        content = ((res.get("choices") or [{}])[0].get("message") or {}).get("content") or ""
        parsed = extract_json(content)
        if parsed is None:
            if attempt == retries:
                return {"error": f"JSONとして読めない応答: {content[:120]}"}
            continue
        scores = {k: int(parsed.get(k, 0) or 0) for k in AXES}
        return {
            "scores": scores,
            "total": sum(scores.values()),
            "comment": str(parsed.get("comment", ""))[:200],
            "cost_usd": (res.get("usage") or {}).get("cost") or 0,
        }
    return {"error": "unreachable"}


def main() -> int:
    ap = argparse.ArgumentParser(description="主観5軸をLLMに採点させる")
    ap.add_argument("--in", dest="inp", required=True, help="採点する出力のディレクトリ")
    ap.add_argument("--runs", default=None, help="run_*.py の記録（指示の突き合わせに使う）")
    ap.add_argument("--out", default="results/judge.json")
    ap.add_argument("--judge-models", default="google/gemini-2.5-flash",
                    help="判定モデル（カンマ区切りで複数可。複数なら平均とばらつきを出す）")
    ap.add_argument("--budget-usd", type=float, default=0.30)
    ap.add_argument("--dry-run", action="store_true", help="1件だけ採点して見積りを出す")
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--key-file", default=None)
    args = ap.parse_args()

    key = get_key(args.key_file)
    preflight(key)

    judges = [m.strip() for m in args.judge_models.split(",") if m.strip()]
    instructions = instructions_from_prompts(promptlib.load_sets())

    # 出力ファイルと「そのとき与えた指示」を突き合わせる
    link: dict[str, tuple[str, str]] = {}
    if args.runs and Path(args.runs).exists():
        for r in json.loads(Path(args.runs).read_text(encoding="utf-8")).get("runs", []):
            for f in r.get("files", []):
                link[f] = (r.get("prompt_id", ""), r.get("scenario", ""))

    src = Path(args.inp)
    files = sorted(src.rglob("*.txt")) if src.is_dir() else [src]
    files = [f for f in files if f.is_file()]
    if args.dry_run:
        files = files[:1]
    elif args.limit:
        files = files[:args.limit]

    results, spent = [], 0.0
    total = len(files) * len(judges)
    n = 0
    for f in files:
        text = read_text(f)
        meta = parse_name(f.stem)
        instruction = instructions.get(link.get(f.name, ("", "")))
        per_judge = []
        for jm in judges:
            n += 1
            if spent and results:
                avg = spent / max(len([x for x in results if "total" in x]), 1)
                if spent + avg > args.budget_usd:
                    print(f"\n予算上限 ${args.budget_usd} に達するため停止します（使用 ${spent:.4f}）")
                    files = []
                    break
            print(f"[{n}/{total}] {f.name} <- {jm}")
            r = judge_one(jm, instruction, text, key)
            if r.get("error"):
                print(f"    失敗: {r['error']}")
                continue
            spent += r.get("cost_usd") or 0
            per_judge.append({"judge": jm, **r})
            print(f"    {r['total']}/50  {r['comment'][:60]}")
        if not per_judge:
            continue
        totals = [p["total"] for p in per_judge]
        results.append({
            "file": f.name,
            "model": meta["model"],
            "condition": meta["condition"],
            "scenario": meta["scenario"],
            "total": round(statistics.mean(totals), 1),
            "spread": round(max(totals) - min(totals), 1) if len(totals) > 1 else 0,
            "scores": {k: round(statistics.mean(p["scores"][k] for p in per_judge), 1)
                       for k in AXES},
            "by_judge": per_judge,
        })

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({
        "judge_model": ", ".join(judges),
        "axes": AXES,
        "max_score": 10 * len(AXES),
        "cost_usd_total": round(spent, 6),
        "scores": results,
    }, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"\n採点 {len(results)} 件 / 実費 ${spent:.4f} -> {out}")
    if args.dry_run and results:
        one = spent
        print(f"\n--- 見積り ---\n  1ファイルあたり: ${one:.5f}")
        print(f"  全 {len(list(src.rglob('*.txt')))} ファイル: ${one * len(list(src.rglob('*.txt'))):.4f}")
    high = [r for r in results if r["spread"] >= 8]
    if high:
        print(f"\n判定が割れたファイル（人が見たほうがよい） {len(high)} 件:")
        for r in high[:10]:
            print(f"  {r['file']}  spread={r['spread']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
