#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
score_mech.py — ローカルLLM検証の「機械判定」を自動化するスコアラ。

前回の検証記事で目視でやっていた機械判定項目を、そのまま自動化したもの。
API キーは不要。出力テキストのファイル／ディレクトリを渡すだけで動く。

判定する軸（記事の機械判定項目に対応）
  1. 重複行        同じ段落の繰り返し・末尾ループ
  2. 中国語混入    日本語に無い字形（cp932 に無い漢字）＋中国語文法マーカー
  3. 韓国語混入    ハングル
  4. 英単語混入    地の文に紛れた英単語（許可リストで除外）
  5. 敬体ドリフト  常体で書くべき地の文が「〜しました」に崩れた箇所
  6. 医学用語      官能から浮く分析的・医学的語彙
  7. ぼかし表現    「結ばれた」の一言で行為を飛ばしていないか

おまけの軸（男性向け・文体規定の検証用）
  8. ♡ の数 / 濁点崩し / 語中への「ッ」挿入 / 指定語彙のヒット数
  9. 作例のコピペ検出（--style-examples を渡したときだけ）
 10. 一人称の混在 / 拒否 / 途中切れ / 字数

使い方
  python score_mech.py --in ~/.ollama/_bench_outputs --out results/mech.json
  python score_mech.py --in outputs/ --out results/mech.json --style-examples wordlists/style_examples.txt

ファイル名の規約（記事と同じ）
  連番_条件__シナリオ__モデル.txt   例) 08_ShadowSiren__C_20years__siren-tl.txt
  連番_条件__モデル.txt             例) 19_男性向け_文体規定__melody-tl.txt
  規約から外れていても動く（その場合はモデル名にファイル名がそのまま入る）
"""

from __future__ import annotations

import argparse
import difflib
import json
import re
import sys
import unicodedata
from collections import Counter
from pathlib import Path

# ---------------------------------------------------------------- 読み込み

ENCODINGS = ("utf-8", "utf-8-sig", "cp932", "euc-jp")


def read_text(path: Path) -> str:
    """Windows で作られたファイルも読めるように、文字コードを順に試す。"""
    raw = path.read_bytes()
    for enc in ENCODINGS:
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def load_wordlist(path: Path | None) -> list[str]:
    """1行1語のリストを読む。# 始まりと空行は無視。"""
    if path is None or not path.exists():
        return []
    out = []
    for line in read_text(path).splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            out.append(line)
    return out


# ---------------------------------------------------- 台詞と地の文の切り分け

QUOTE_PAIRS = (("「", "」"), ("『", "』"), ("（", "）"), ("(", ")"))
DIALOGUE_RE = re.compile(r"[「『]([^「」『』]*)[」』]")


def extract_dialogue(text: str) -> list[str]:
    """「」『』で囲まれた台詞を取り出す。"""
    return [m.group(1) for m in DIALOGUE_RE.finditer(text)]


def strip_dialogue(text: str) -> str:
    """台詞を除いた地の文だけを返す。

    敬体ドリフトや一人称の混在は「地の文」だけで判定しないと意味がない。
    台詞は敬語でもよいので、混ぜると全モデルが真っ赤になる。
    """
    return DIALOGUE_RE.sub("　", text)


# ---------------------------------------------------------- 1. 重複行

def check_duplicate_lines(text: str, min_len: int = 12) -> dict:
    """同じ行の繰り返しと、末尾ループを検出する。

    min_len 未満の短い行（「……」「はい」など）は数えない。台詞の
    やり取りは自然に短くなるので、そこを数えると誤検知になる。
    """
    def norm(s: str) -> str:
        return re.sub(r"\s+", "", s).strip()

    lines = [norm(l) for l in text.splitlines()]
    target = [l for l in lines if len(l) >= min_len]
    counts = Counter(target)
    repeated = {k: v for k, v in counts.items() if v >= 2}

    # 末尾ループ: 後ろ20%の範囲に5回以上出る行があるか
    tail = target[int(len(target) * 0.8):] if target else []
    tail_counts = Counter(tail)
    tail_max = max(tail_counts.values(), default=0)

    return {
        "unique_lines_counted": len(target),
        "repeated_line_kinds": len(repeated),
        "repeated_line_total": sum(repeated.values()),
        "max_repeat": max(counts.values(), default=0),
        "tail_loop": tail_max >= 5,
        "tail_max_repeat": tail_max,
        "worst": [
            {"count": c, "line": l[:80]}
            for l, c in counts.most_common(3) if c >= 2
        ],
    }


# ------------------------------------------------ 2-4. 他言語の混入

CJK_RE = re.compile(r"[㐀-䶿一-鿿豈-﫿]")
HANGUL_RE = re.compile(r"[가-힣ᄀ-ᇿ㄰-㆏]+")
LATIN_RE = re.compile(r"[A-Za-z][A-Za-z'\-]{1,}")

# cp932（日本語 Windows の標準文字集合）に無い漢字は、日本語では使わない字形。
# 简体字（们/这/说/时/间…）や一部の繁体字（對/裡…）はここで落ちる。
# 辞書を持たずに「日本語に無い字形」を判定できるので、設定ファイル不要。
_cp932_cache: dict[str, bool] = {}


def is_non_japanese_cjk(ch: str) -> bool:
    hit = _cp932_cache.get(ch)
    if hit is None:
        try:
            ch.encode("cp932")
            hit = False
        except UnicodeEncodeError:
            hit = True
        _cp932_cache[ch] = hit
    return hit


# cp932 には有るが、日本語の文中に出たら中国語混入とみなすマーカー。
# 「的」は 〜的 という日本語用法があるので、漢字に挟まれた場合だけ拾う。
CN_PHRASES = [
    "之間", "之间", "我們", "我们", "你們", "他們", "是的", "不是", "沒有",
    "什麼", "怎麼", "已經", "因為", "所以", "這個", "那個", "可以", "知道",
    "時候", "現在", "一個", "沈默", "沉默",
]
CN_DE_PHRASES = ("我的", "你的", "他的", "她的", "它的", "的時候", "的时候", "的距离", "的距離")


def count_cn_de(text: str) -> int:
    """中国語の所有格「的」だけを数える。

    日本語の「解剖学的知識」「一般的な」は正当な用法なので、
    前後に日本語に無い字形が来る場合と、我的/的時候 等の定型だけを拾う。
    """
    n = sum(text.count(p) for p in CN_DE_PHRASES)
    for m in re.finditer("的", text):
        prev = text[m.start() - 1] if m.start() else ""
        nxt = text[m.end()] if m.end() < len(text) else ""
        if (prev and CJK_RE.match(prev) and is_non_japanese_cjk(prev)) or \
           (nxt and CJK_RE.match(nxt) and is_non_japanese_cjk(nxt)):
            n += 1
    return n


def check_chinese(text: str) -> dict:
    non_jp = Counter(ch for ch in CJK_RE.findall(text) if is_non_japanese_cjk(ch))
    phrases = Counter(p for p in CN_PHRASES if p in text)
    de_hits = count_cn_de(text)
    return {
        "non_japanese_char_total": sum(non_jp.values()),
        "non_japanese_chars": "".join(sorted(non_jp)),
        "phrase_hits": dict(phrases),
        "de_pattern_hits": de_hits,
        "examples": contexts(text, list(non_jp) + list(phrases), limit=5),
    }


def check_korean(text: str) -> dict:
    hits = HANGUL_RE.findall(text)
    return {
        "hangul_runs": len(hits),
        "hangul_chars": sum(len(h) for h in hits),
        "examples": [h for h in hits[:5]],
    }


def check_english(text: str, allow: set[str]) -> dict:
    """地の文に紛れた英単語。型番・単位は許可リストで除外する。"""
    narration = strip_dialogue(text)
    hits = Counter(
        w for w in LATIN_RE.findall(narration)
        if w.lower() not in allow and len(w) >= 2
    )
    return {
        "english_word_total": sum(hits.values()),
        "english_words": dict(hits.most_common(20)),
        "examples": contexts(narration, list(hits)[:10], limit=5),
    }


# ---------------------------------------------------------- 5. 敬体ドリフト

# 「〜ました。」「〜です。」など、地の文が敬体に崩れた語尾。
KEITAI_RE = re.compile(
    r"(?<![覚冷澄励])(ました|ませんでした|ません|まして|ましょう|でした|です|ます)"
    r"(?=[。、！？\s」』]|$)"
)
# 常体の語尾。比率を出すために数える（絶対数だけでは長文が不利になる）。
JOTAI_RE = re.compile(r"(だった|であった|である|かった|ていた|した|た|だ)(?=[。、！？\s]|$)")


def check_keitai_drift(text: str) -> dict:
    narration = strip_dialogue(text)
    keitai = list(KEITAI_RE.finditer(narration))
    # 敬体として数えた箇所を潰してから常体を数える（「ました」の「た」の二重計上を防ぐ）
    masked = KEITAI_RE.sub("　", narration)
    jotai = list(JOTAI_RE.finditer(masked))
    total = len(keitai) + len(jotai)
    return {
        "keitai_count": len(keitai),
        "jotai_count": len(jotai),
        "keitai_ratio": round(len(keitai) / total, 4) if total else 0.0,
        "examples": [
            narration[max(0, m.start() - 24):m.end() + 2].replace("\n", " ")
            for m in keitai[:5]
        ],
    }


# ------------------------------------------- 6-7. 語彙のブラックリスト

def check_wordlist(text: str, words: list[str], label: str) -> dict:
    hits = Counter(w for w in words for _ in re.finditer(re.escape(w), text))
    return {
        f"{label}_total": sum(hits.values()),
        f"{label}_hits": dict(hits.most_common(20)),
        "examples": contexts(text, list(hits)[:10], limit=5),
    }


# ------------------------------------------- 8. 文体規定（オホ声）の遵守

DAKUTEN_RE = re.compile(r"[゙゛]")           # 濁点崩し「お゛」「ぁ゛」
HEART_RE = re.compile(r"[♡♥❤]")
KATA_TSU_IN_HIRAGANA_RE = re.compile(r"[ぁ-ん]ッ")    # ひらがなの語中への「ッ」挿入


def check_style_marks(text: str, vocab: list[str]) -> dict:
    dialogue = extract_dialogue(text)

    # ②は作例を渡さないので ♡ も濁点も出ない。素の喘ぎ声も数えられるようにする。
    # 漢字を含まず、母音・小書き仮名・伸ばし・感嘆で占められた短い台詞行を
    # 「非言語的な発話」とみなす。「あっ……んっ」「はぁ、ぁ……っ」など。
    voice_lines = 0
    for line in text.splitlines():
        t = line.strip().strip("「」『』")
        if not t or len(t) > 40 or re.search(r"[一-鿿]", t):
            continue
        vocal = len(re.findall(r"[ぁ-んァ-ヶーッっ゛♡～〜…‥、。！？!?\s]", t))
        if vocal / len(t) >= 0.9 and re.search(r"[あぁいぃうぅえぇおぉんっッ]", t):
            voice_lines += 1

    # 「指定した発話がちゃんと出るか」が③の要件そのものなので直接数える。
    # 地の文に混ぜず、独立した台詞行として出ているかを見たいので、行単位で判定する。
    moan_lines = 0
    for line in text.splitlines():
        line = line.strip()
        if not line.startswith(("「", "『")):
            continue
        if (HEART_RE.search(line) or DAKUTEN_RE.search(line)
                or any(w in line for w in vocab)):
            moan_lines += 1

    return {
        "moan_lines": moan_lines,
        "voice_lines": voice_lines,
        "heart_count": len(HEART_RE.findall(text)),
        "dakuten_break_count": len(DAKUTEN_RE.findall(text)),
        "kata_tsu_insert_count": len(KATA_TSU_IN_HIRAGANA_RE.findall(text)),
        "vocab_hits": {w: text.count(w) for w in vocab if w in text},
        "dialogue_count": len(dialogue),
    }


def check_style_copy(text: str, examples: list[str], threshold: float = 0.90) -> dict:
    """渡した作例を、台詞がそのままコピペしていないか。

    完全一致だけでなく、difflib で類似度 threshold 以上も「ほぼコピペ」として拾う。
    記事の「台詞4件中3件が作例と完全一致」を自動で出すのがこの関数。
    """
    if not examples:
        return {"checked": False}
    dialogue = extract_dialogue(text)
    exact, near = [], []
    for d in dialogue:
        d_n = d.strip()
        if not d_n:
            continue
        if any(d_n == e.strip() for e in examples):
            exact.append(d_n[:60])
            continue
        best = max(
            (difflib.SequenceMatcher(None, d_n, e.strip()).ratio() for e in examples),
            default=0.0,
        )
        if best >= threshold:
            near.append({"ratio": round(best, 3), "text": d_n[:60]})
    n = max(len(dialogue), 1)
    return {
        "checked": True,
        "dialogue_count": len(dialogue),
        "exact_copy": len(exact),
        "near_copy": len(near),
        "copy_ratio": round((len(exact) + len(near)) / n, 3),
        "exact_examples": exact[:5],
        "near_examples": near[:5],
    }


# --------------------------------------- 9-10. 一人称・拒否・途中切れ・字数

# 「自分」は再帰代名詞で、どの語り手も使う（「自分の手を見た」）。
# 一人称の取り違えを見る目的には邪魔なので入れない。
FIRST_PERSON = ("私", "僕", "俺", "わたし", "ぼく", "おれ", "あたし")
# 拒否の判定は、単語ではなく「断りの構文」で見る。
# 作中の「すみません……」「申し訳なさそうに俯く」を拒否と数えてしまうと、
# ちゃんと書けているモデルほど拒否率が上がるという逆転が起きる（実際に起きた）。
REFUSAL_RE = re.compile(
    r"(申し訳(ありません|ございません|ないの)|恐れ入りま|残念ですが)[^。]{0,40}"
    r"(できません|いたしかねます|応じ(られません|ることができません)|お受けできません)"
    r"|(お応え|お手伝い|ご要望にお応え|執筆|生成|作成)[^。]{0,10}"
    r"(できません|いたしかねます|応じることができません)"
    r"|I (cannot|can't|won't) (help|assist|comply|write|create)"
    r"|I'm (sorry|unable)[^.]{0,40}(cannot|can't|unable)"
    r"|as an AI[^.]{0,40}(cannot|can't)"
)
SENTENCE_END = "。」』！？….!?\")"


def check_person_mix(text: str) -> dict:
    """地の文の一人称が混在していないか（nsfwjp で出た「僕/私」の混在）。"""
    narration = strip_dialogue(text)
    counts = {p: narration.count(p) for p in FIRST_PERSON}
    used = {p: c for p, c in counts.items() if c >= 2}
    # 主たる一人称に対して、別の一人称が2割以上使われていたら「混在」とみなす。
    # 1〜2回の紛れ込み（他人の台詞の引用など）で赤くしない。
    mixed = False
    if len(used) >= 2:
        top = max(used.values())
        mixed = sorted(used.values())[-2] >= max(2, top * 0.2)
    return {
        "narration_first_person": used,
        "mixed": mixed,
        "reflexive_jibun": narration.count("自分"),
    }


def check_integrity(text: str, expect_chars: int | None = None) -> dict:
    body = text.strip()
    visible = re.sub(r"\s", "", body)

    # 台詞を外した地の文の冒頭だけを見る。作中の謝罪を拾わないため。
    head = re.sub(r"\s+", "", strip_dialogue(body))[:200]
    m = REFUSAL_RE.search(head)
    # 断ったうえで4000字書く、ということは無い。短いことも条件にする。
    refused = bool(m) and len(visible) < 1000
    result = {
        "char_count": len(visible),
        "line_count": len([l for l in body.splitlines() if l.strip()]),
        "refusal": [m.group(0)[:60]] if refused else [],
        # 断り文句はあるが本文も書いた場合。条件を緩めた別物として記録する。
        "declined_but_wrote": bool(m) and not refused,
        "truncated": bool(body) and body[-1] not in SENTENCE_END,
        "empty": len(visible) == 0,
    }
    if expect_chars:
        result["expected_chars"] = expect_chars
        result["char_ratio"] = round(len(visible) / expect_chars, 3)
    return result


# ----------------------------------------- 13. ロールプレイの禁止事項

# 演技から出てしまった発言。プロンプトで明示的に禁じている。
META_PATTERNS = (
    "いかがでしょうか", "いかがですか", "という展開", "展開はいかが",
    "続けますか", "続けましょうか", "どうしますか", "ご希望", "ご要望",
    "ロールプレイ", "アシスタント", "AIとして", "（※", "(※",
    "お聞かせください", "次のターン",
)
# 場面を勝手に畳んだ痕跡
CLOSING_PATTERNS = (
    "こうして二人は", "こうして、二人は", "そして二人は", "幕を閉じ",
    "翌朝", "その後、二人", "永遠に", "〜完〜", "（完）",
)
HEADING_RE = re.compile(r"^\s{0,3}#{1,6}\s", re.M)


def check_roleplay(text: str, cfg: dict) -> dict:
    """RP で禁じた振る舞いを数える。

    一番効くのは「ユーザーが演じるキャラを勝手に動かす」。
    相手役の一人称が台詞に出てきたら、その台詞は本来ユーザーが書くもの。
    """
    user = cfg.get("user_character") or {}
    u_names = [n for n in ([user.get("name", "")] + list(user.get("aliases") or [])) if n]
    u_first = user.get("first_person") or ""
    narration = strip_dialogue(text)

    # 1) ユーザー側キャラの台詞を書いてしまった
    stolen, stolen_ex = 0, []
    for line in text.splitlines():
        t = line.strip()
        if not t:
            continue
        named = any(t.startswith(n) and "「" in t for n in u_names)
        # 悠真の一人称は「俺」。台詞に「私」が出たら、それは澪の台詞。
        spoken = t.startswith("「") and bool(u_first) and u_first in t
        if named or spoken:
            stolen += 1
            if len(stolen_ex) < 3:
                stolen_ex.append(t[:60])

    # 2) ユーザー側キャラの内心を地の文で書いた
    inner_verbs = ("と思った", "と感じた", "胸が", "心臓が", "気づいた", "悟った",
                   "嬉しかった", "不安だった", "恥ずかし", "安堵")
    inner, inner_ex = 0, []
    for sent in re.split(r"[。\n]", narration):
        if any(n in sent for n in u_names) and any(v in sent for v in inner_verbs):
            inner += 1
            if len(inner_ex) < 3:
                inner_ex.append(sent.strip()[:60])

    lo, hi = (cfg.get("reply_chars") or [200, 600])[:2]
    n = len(re.sub(r"\s+", "", text))

    return {
        "chars": n,
        "target_chars": [lo, hi],
        "length_ok": lo <= n <= hi,
        "stole_user_lines": stolen,
        "stole_user_examples": stolen_ex,
        "wrote_user_inner": inner,
        "wrote_user_inner_examples": inner_ex,
        "meta_hits": [m for m in META_PATTERNS if m in text],
        "closed_the_scene": [c for c in CLOSING_PATTERNS if c in text],
        "headings": len(HEADING_RE.findall(text)),
        "possessed": bool(stolen or inner),
    }


PART_RE = re.compile(r"^[\s#*]*第\s*([1-4一二三四])\s*部", re.M)
KANJI_NUM = {"一": 1, "二": 2, "三": 3, "四": 4}


def check_structure(text: str, cfg: dict) -> dict:
    """字数指定と部構成をどれだけ守れたか。

    「4000字以上」「第3部を省略するな」と書いてあるのに従わないのは、
    書けなかったのではなく指示を無視したということ。両方を分けて測る。
    """
    body = re.sub(r"\s+", "", text)
    n = len(body)
    want = cfg.get("min_chars") or 0
    spec = cfg.get("parts") or []

    # 部の見出しを拾い、その位置で本文を区切る
    marks = []
    for m in PART_RE.finditer(text):
        g = m.group(1)
        marks.append((KANJI_NUM.get(g, int(g) if g.isdigit() else 0), m.start()))
    marks = [x for x in marks if x[0]]

    parts = []
    if marks:
        marks.sort(key=lambda x: x[1])
        for i, (num, pos) in enumerate(marks):
            end = marks[i + 1][1] if i + 1 < len(marks) else len(text)
            got = len(re.sub(r"\s+", "", text[pos:end]))
            spec_i = next((p for p in spec if p["name"] == f"第{num}部"), None)
            parts.append({
                "part": f"第{num}部",
                "label": (spec_i or {}).get("label", ""),
                "chars": got,
                "want": (spec_i or {}).get("chars"),
                "ok": got >= (spec_i or {}).get("chars", 0),
            })

    found = {p["part"] for p in parts}
    missing = [p["name"] for p in spec if p["name"] not in found]
    return {
        "chars": n,
        "min_chars": want,
        "chars_ratio": round(n / want, 2) if want else None,
        "chars_ok": n >= want if want else None,
        "parts_marked": len(parts),
        "parts_missing": missing,
        # 見出しを書かずに本文だけ返すモデルもいる。その場合は部の判定はできない
        "parts_measurable": bool(parts),
        "parts": parts,
        "short_parts": [p["part"] for p in parts if p["want"] and not p["ok"]],
    }


def load_prompt_checks() -> dict:
    """prompts/*.json の checks を読む。プロンプト固有の判定はそこに書いてある。"""
    out = {}
    for p in sorted((Path(__file__).resolve().parent / "prompts").glob("*.json")):
        try:
            j = json.loads(p.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if j.get("checks"):
            out[j["seq"]] = j["checks"]
    return out


# ------------------------------- 12. 表現の質（クラウドモデル向けの軸）

SENT_SPLIT_RE = re.compile(r"[。！？\n]+")
METAPHOR_MARKERS = ("まるで", "ような", "ように", "かのよう", "ごとく", "みたいに", "さながら")
DUP_PARTICLE_RE = re.compile(r"(がが|をを|にに|はは|のの|でで|とと|へへ)(?![ー〜])")


def sentences(text: str) -> list[str]:
    return [s.strip() for s in SENT_SPLIT_RE.split(text) if s.strip()]


def _occurrences(body: str, phrase: str) -> list[int]:
    """重なりも数える出現位置。「ああああ」中の「ああ」を3回として数えたい。"""
    return [m.start() for m in re.finditer(f"(?={re.escape(phrase)})", body)]


def repeated_phrases(text: str, n: int = 10, min_count: int = 3, top: int = 5) -> list[dict]:
    """同じ言い回しの使い回しを、文字N-gramで拾う。

    ローカルモデルの「同じ段落を190回」とは別物で、こちらは
    「気の利いた比喩を作品内で何度も再利用する」タイプの単調さを見る。
    クラウドモデルは日本語が崩れないぶん、単調さはここに出る。

    N-gramをそのまま返すと同じ一文が細切れで何度も報告されるので、
    出現回数が変わらない限り左右に伸ばして、最長の反復句にまとめる。
    """
    body = re.sub(r"\s+", "", text)
    if len(body) < n * 2:
        return []
    counts = Counter(body[i:i + n] for i in range(len(body) - n + 1))
    cands = [(p, c) for p, c in counts.items() if c >= min_count]
    cands.sort(key=lambda x: (-x[1], body.find(x[0])))

    picked: list[dict] = []
    consumed: set[int] = set()
    for seed, c in cands:
        pos = _occurrences(body, seed)
        if not pos or any(i in consumed for p0 in pos for i in range(p0, p0 + n)):
            continue
        # 出現回数が減らないところまで右へ、次に左へ伸ばす
        a, b = pos[0], pos[0] + n
        while b < len(body) and len(_occurrences(body, body[a:b + 1])) == c:
            b += 1
        while a > 0 and len(_occurrences(body, body[a - 1:b])) == c:
            a -= 1
        phrase = body[a:b]
        picked.append({"phrase": phrase, "count": c, "length": len(phrase)})
        for p0 in _occurrences(body, phrase):
            consumed.update(range(p0, p0 + len(phrase)))
        if len(picked) >= top:
            break
    return picked


def check_expression(text: str, cliches: list[str]) -> dict:
    """比喩・語彙・文のリズムを測る。日本語が崩れないモデル同士を比べるための軸。"""
    body = re.sub(r"\s+", "", text)
    sents = sentences(text)
    n_chars = max(len(body), 1)

    # 語彙の多様性: 文字2-gramの異なり数 / 延べ数。
    # 形態素解析なしで、表現の使い回しをおおまかに測る代理指標。
    grams = [body[i:i + 2] for i in range(len(body) - 1)]
    ttr = round(len(set(grams)) / len(grams), 4) if grams else 0.0

    comma_counts = [s.count("、") for s in sents]
    lengths = [len(s) for s in sents]

    metaphor = sum(text.count(m) for m in METAPHOR_MARKERS)
    cliche_hits = Counter(c for c in cliches for _ in re.finditer(re.escape(c), text))

    kanji = len(re.findall(r"[一-鿿]", body))
    hira = len(re.findall(r"[ぁ-ゖ]", body))
    kata = len(re.findall(r"[ァ-ヺ]", body))

    reps = repeated_phrases(text)
    # 改行のないループ（grok の "millimetre" × 1371 のような）は行単位では拾えない。
    # 最も長く繰り返された句が本文の何割を占めるかで、水増しを見る。
    loop_chars = max((r["count"] * r["length"] for r in reps), default=0)
    loop_ratio = round(min(loop_chars / n_chars, 1.0), 3)

    return {
        "vocab_diversity": ttr,
        "repeated_phrases": reps,
        "loop_ratio": loop_ratio,
        # 本文の4分の1以上が同じ句の繰り返しなら、文章ではなくループ
        "phrase_loop": loop_ratio >= 0.25,
        "sentence_count": len(sents),
        "sentence_len_avg": round(sum(lengths) / len(lengths), 1) if lengths else 0,
        "sentence_len_max": max(lengths, default=0),
        "comma_max": max(comma_counts, default=0),
        "comma_avg": round(sum(comma_counts) / len(comma_counts), 2) if comma_counts else 0,
        # 1文に読点5個以上は、記事の elyza（1文に読点6個）と同じ壊れ方
        "comma_heavy_sentences": sum(1 for c in comma_counts if c >= 5),
        "metaphor_markers": metaphor,
        "metaphor_per_1000": round(metaphor / n_chars * 1000, 1),
        "cliche_total": sum(cliche_hits.values()),
        "cliche_hits": dict(cliche_hits.most_common(10)),
        "dup_particles": len(DUP_PARTICLE_RE.findall(text)),
        "char_mix": {
            "kanji_pct": round(kanji / n_chars * 100, 1),
            "hiragana_pct": round(hira / n_chars * 100, 1),
            "katakana_pct": round(kata / n_chars * 100, 1),
        },
        "comma_examples": [s for s in sents if s.count("、") >= 5][:3],
    }


# ------------------------------------------ 11. JSON 構造化出力の遵守

def check_json_output(text: str) -> dict:
    """自作チャットアプリ用の JSON 形式を守れているか（記事のおまけ検証）。

    文章力とは別の能力なので、独立した軸として測る。
    """
    stripped = text.strip()
    # コードブロックで囲むのは形式違反だが、中身の検査は続ける
    fenced = stripped.startswith("```")
    if fenced:
        stripped = re.sub(r"^```[a-zA-Z]*\n?|\n?```$", "", stripped).strip()

    try:
        data = json.loads(stripped)
    except (json.JSONDecodeError, ValueError):
        return {"is_json": False, "fenced": fenced, "valid": False,
                "violations": ["JSON として解釈できない"]}

    v = []
    if fenced:
        v.append("コードブロック記号で囲んでいる")
    if not isinstance(data, dict):
        return {"is_json": True, "fenced": fenced, "valid": False,
                "violations": v + ["トップレベルがオブジェクトでない"]}
    if "turns" not in data:
        v.append("turns が無い")
    if "affection_deltas" not in data:
        v.append("affection_deltas が無い")

    names, seg_total = set(), 0
    for i, t in enumerate(data.get("turns") or []):
        if not isinstance(t, dict):
            v.append(f"turns[{i}] がオブジェクトでない")
            continue
        if not t.get("character"):
            v.append(f"turns[{i}].character が無い")
        names.add(str(t.get("character", "")))
        segs = t.get("segments")
        if not isinstance(segs, list):
            v.append(f"turns[{i}].segments が配列でない")
            continue
        for k, seg in enumerate(segs):
            seg_total += 1
            if not isinstance(seg, dict):
                v.append(f"turns[{i}].segments[{k}] がオブジェクトでない")
                continue
            typ, txt = seg.get("type"), str(seg.get("text", ""))
            if typ not in ("dialogue", "narration"):
                v.append(f"type が不正: {typ!r}")
            if typ == "dialogue" and re.search(r"[「」『』]", txt):
                v.append("セリフに鍵カッコが含まれている")
            if typ == "narration":
                for nm in names:
                    if nm and nm in txt and txt.strip().startswith(nm + "「"):
                        v.append("地の文に話者名が書き込まれている")
    return {
        "is_json": True,
        "fenced": fenced,
        "valid": not v,
        "turns": len(data.get("turns") or []),
        "segments": seg_total,
        "violations": sorted(set(v))[:10],
    }


# ---------------------------------------------------------------- 補助

def contexts(text: str, needles: list[str], limit: int = 5, width: int = 20) -> list[str]:
    """ヒット箇所の前後を切り出す。数字だけ見せられても直せないので、必ず現物を出す。"""
    out = []
    for n in needles:
        if not n:
            continue
        i = text.find(n)
        if i < 0:
            continue
        out.append(text[max(0, i - width):i + len(n) + width].replace("\n", " "))
        if len(out) >= limit:
            break
    return out


NAME_RE = re.compile(r"^(?P<seq>\d+)?_?(?P<rest>.+)$")


def parse_name(stem: str) -> dict:
    """連番_条件__シナリオ__モデル を分解する。規約外でも落ちない。

    シナリオ側に付く _seedN / _nopre / _preplain も切り出す。
    前段条件ごとの拒否率を比べるのに使う。
    """
    parts = stem.split("__")
    head = parts[0]
    m = re.match(r"^(\d+)[_-]?(.*)$", head)
    seq, cond = (m.group(1), m.group(2)) if m else ("", head)
    if len(parts) >= 3:
        scenario, model = parts[1], parts[-1]
    elif len(parts) == 2:
        scenario, model = "", parts[1]
    else:
        scenario, model = "", head

    preamble, seed = "role", ""
    if scenario.endswith("_nopre"):
        scenario, preamble = scenario[:-6], "none"
    else:
        mv = re.search(r"_pre([A-Za-z0-9]+)$", scenario)
        if mv:
            scenario, preamble = scenario[:mv.start()], mv.group(1)
    ms = re.search(r"_seed(\d+)$", scenario)
    if ms:
        scenario, seed = scenario[:ms.start()], ms.group(1)

    return {"seq": seq, "condition": cond or head, "scenario": scenario,
            "model": model, "preamble": preamble, "seed": seed}


# ---------------------------------------------------------------- 本体

def score_file(path: Path, cfg: dict) -> dict:
    text = unicodedata.normalize("NFC", read_text(path))
    meta = parse_name(path.stem)
    return {
        "file": path.name,
        **meta,
        "integrity": check_integrity(text, cfg.get("expect_chars")),
        "duplicate": check_duplicate_lines(text),
        "chinese": check_chinese(text),
        "korean": check_korean(text),
        "english": check_english(text, cfg["allow_english"]),
        "keitai_drift": check_keitai_drift(text),
        "medical": check_wordlist(text, cfg["medical"], "medical"),
        "vague": check_wordlist(text, cfg["vague"], "vague"),
        "direct": check_wordlist(text, cfg["direct"], "direct"),
        "style_marks": check_style_marks(text, cfg["style_vocab"]),
        "style_copy": check_style_copy(text, cfg["style_examples"]),
        "json_format": check_json_output(text),
        "expression": check_expression(text, cfg["cliche"]),
        "structure": (check_structure(text, cfg["prompt_checks"][meta["seq"]])
                      if (cfg.get("prompt_checks") or {}).get(meta["seq"], {})
                      .get("kind") == "structure" else None),
        "roleplay": (check_roleplay(text, cfg["prompt_checks"][meta["seq"]])
                     if (cfg.get("prompt_checks") or {}).get(meta["seq"], {})
                     .get("kind") == "roleplay" else None),
    }


def flag_summary(r: dict) -> dict:
    """記事のランキング表に載る形の、1行サマリ。"""
    return {
        "file": r["file"],
        "model": r["model"],
        "condition": r["condition"],
        "scenario": r["scenario"],
        "preamble": r["preamble"],
        "seed": r["seed"],
        "chars": r["integrity"]["char_count"],
        "dup_max": r["duplicate"]["max_repeat"],
        "tail_loop": r["duplicate"]["tail_loop"],
        "cn": r["chinese"]["non_japanese_char_total"] + r["chinese"]["de_pattern_hits"]
              + sum(r["chinese"]["phrase_hits"].values()),
        "ko": r["korean"]["hangul_chars"],
        "en": r["english"]["english_word_total"],
        "keitai": r["keitai_drift"]["keitai_count"],
        "medical": r["medical"]["medical_total"],
        "vague": r["vague"]["vague_total"],
        "direct": r["direct"]["direct_total"],
        "moan_lines": r["style_marks"]["moan_lines"],
        "voice_lines": r["style_marks"]["voice_lines"],
        "heart": r["style_marks"]["heart_count"],
        "dakuten": r["style_marks"]["dakuten_break_count"],
        "tsu": r["style_marks"]["kata_tsu_insert_count"],
        "copy": r["style_copy"].get("exact_copy", 0) + r["style_copy"].get("near_copy", 0),
        "json_ok": r["json_format"]["valid"] if r["json_format"]["is_json"] else None,
        "ttr": r["expression"]["vocab_diversity"],
        "rep_phrase": len(r["expression"]["repeated_phrases"]),
        "loop_ratio": r["expression"]["loop_ratio"],
        "phrase_loop": r["expression"]["phrase_loop"],
        "cliche": r["expression"]["cliche_total"],
        "comma_heavy": r["expression"]["comma_heavy_sentences"],
        "sent_len_avg": r["expression"]["sentence_len_avg"],
        "metaphor_1000": r["expression"]["metaphor_per_1000"],
        "dup_particles": r["expression"]["dup_particles"],
        "st_chars_ok": (r["structure"] or {}).get("chars_ok"),
        "st_ratio": (r["structure"] or {}).get("chars_ratio"),
        "st_parts": (r["structure"] or {}).get("parts_marked"),
        "st_missing": len((r["structure"] or {}).get("parts_missing") or []) or None,
        "st_short": len((r["structure"] or {}).get("short_parts") or []) or None,
        "rp_possessed": (r["roleplay"] or {}).get("possessed"),
        "rp_stolen": (r["roleplay"] or {}).get("stole_user_lines"),
        "rp_meta": len((r["roleplay"] or {}).get("meta_hits") or []) or None,
        "rp_closed": len((r["roleplay"] or {}).get("closed_the_scene") or []) or None,
        "rp_length_ok": (r["roleplay"] or {}).get("length_ok"),
        "refusal": bool(r["integrity"]["refusal"]),
        "truncated": r["integrity"]["truncated"],
        "person_mix": check_person_mix_flag(r),
    }


def check_person_mix_flag(r: dict) -> bool:
    return r.get("person_mix", {}).get("mixed", False)


def main() -> int:
    ap = argparse.ArgumentParser(description="ローカルLLM出力の機械判定スコアラ")
    ap.add_argument("--in", dest="inp", required=True, help="出力ファイル or ディレクトリ")
    ap.add_argument("--out", default="results/mech.json", help="JSON の出力先")
    ap.add_argument("--glob", default="*.txt", help="ディレクトリ内で拾うパターン")
    ap.add_argument("--wordlists", default=None, help="wordlists ディレクトリ（既定: このファイルの隣）")
    ap.add_argument("--style-examples", default=None, help="作例ファイル（1行1件）")
    ap.add_argument("--expect-chars", type=int, default=None, help="指定字数（達成率を出す）")
    args = ap.parse_args()

    here = Path(__file__).resolve().parent
    wl = Path(args.wordlists) if args.wordlists else here / "wordlists"
    cfg = {
        "medical": load_wordlist(wl / "medical.txt"),
        "cliche": load_wordlist(wl / "cliche.txt"),
        "vague": load_wordlist(wl / "vague.txt"),
        "direct": load_wordlist(wl / "direct.txt"),
        "style_vocab": load_wordlist(wl / "style_vocab.txt"),
        "allow_english": {w.lower() for w in load_wordlist(wl / "allow_english.txt")},
        "style_examples": load_wordlist(Path(args.style_examples)) if args.style_examples else [],
        "expect_chars": args.expect_chars,
        "prompt_checks": load_prompt_checks(),
    }

    src = Path(args.inp)
    files = sorted(src.rglob(args.glob)) if src.is_dir() else [src]
    files = [f for f in files if f.is_file()]
    if not files:
        print(f"対象ファイルが見つかりません: {src}", file=sys.stderr)
        return 1

    results = []
    for f in files:
        r = score_file(f, cfg)
        r["person_mix"] = check_person_mix(read_text(f))
        results.append(r)

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "source": str(src),
        "file_count": len(results),
        "wordlists": {k: len(v) for k, v in cfg.items() if isinstance(v, (list, set))},
        "summary": [flag_summary(r) for r in results],
        "detail": results,
    }
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"{len(results)} ファイルを判定 -> {out}")
    print(f"{'model':<22}{'chars':>7}{'dup':>5}{'cn':>5}{'ko':>4}{'en':>5}{'敬体':>5}{'医学':>5}{'ぼかし':>7}")
    for s in payload["summary"]:
        print(f"{s['model'][:22]:<22}{s['chars']:>7}{s['dup_max']:>5}{s['cn']:>5}"
              f"{s['ko']:>4}{s['en']:>5}{s['keitai']:>5}{s['medical']:>5}{s['vague']:>7}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
