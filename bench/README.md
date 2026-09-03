# bench — ローカルLLM検証ハーネス

RTX 3060 12GB でのローカルLLM検証（NSFW用途）で行った採点を、**再実行できる形**にしたもの。
前回は目視でやっていた機械判定を自動化し、モデルを1本足すたびの作業を数分に落とすのが目的。

## 何ができるか

| やること | コマンド | APIキー |
|---|---|:---:|
| 手元の ollama で全モデルを回す | `run_ollama.py` | 不要 |
| OpenRouter のクラウドモデルを同じ条件で回す | `run_openrouter.py` | 要 |
| **機械判定（重複・他言語混入・敬体ドリフト等）** | `score_mech.py` | **不要** |
| 主観5軸をLLMに採点させる | `score_judge.py` | 要 |
| 記事に貼れる Markdown 表を作る | `report.py` | 不要 |
| **実行前に費用を見積もる** | `estimate.py` | **不要** |

Python 3.9+ のみ。**外部ライブラリは使っていません**（`pip install` 不要）。

---

## 最短の使い方

### 1. 手元にある既存の出力を、そのまま機械判定にかける

キーも要らず、これだけで動きます。

```bash
python score_mech.py --in "%USERPROFILE%\.ollama\_bench_outputs" --out results/mech.json
python report.py --mech results/mech.json --out results/report.md
```

Windows のファイル（cp932）でもそのまま読めます。

### 2. 新しいモデルを ollama で回して判定する

```bash
python run_ollama.py --models models_local.txt
python score_mech.py --in outputs --out results/mech.json
python report.py --mech results/mech.json --runs results/runs_local.json --out results/report.md
```

### 3. OpenRouter のクラウドモデルと比べる

**必ず `--dry-run` から。** 1件だけ実行して、全件の実費を見積もってから本実行します。

```bash
cp models.example.txt models.txt           # 回すモデルを書く
python estimate.py --models models.txt --repeat 3   # キー不要。先に総額を見る

export OPENROUTER_API_KEY=sk-or-...        # Windows: set OPENROUTER_API_KEY=sk-or-...
python run_openrouter.py --models models.txt --dry-run
python run_openrouter.py --models models.txt --repeat 3 --budget-usd 1.0
python score_mech.py --in outputs --out results/mech.json
python score_judge.py --in outputs --runs results/runs.json --axes cloud --dry-run
python score_judge.py --in outputs --runs results/runs.json --axes cloud --budget-usd 0.3
python report.py --mech results/mech.json --judge results/judge.json --runs results/runs.json
```

---

## クラウドモデルを測るときの3つの前提

### 拒否は減点ではなく、測定値

「書けなかった」ことも検証結果です。`--repeat 3` で同じ条件を seed を変えて3回引き、
レポートには **拒否率（1/3、3/3 …）** が出ます。1回断られただけで「このモデルは書けない」
とは結論づけません。

拒否は次の3段階で記録されます。

| どこで断られたか | どこに出るか |
|---|---|
| 前段（役割設定）の時点 | レポートの「前段の時点で断られたもの」に返答つきで載る |
| 本編の冒頭 | `score_mech.py` の `refusal`（冒頭300字の拒否文言） |
| 書き始めたが行為に到達しない | `vague`（ぼかし表現）と主観採点の「官能描写力」 |

### 前段（役割設定ターン）は、入れる／入れないを選べる

本編を投げる前に「あなたは〜の小説家です。準備ができたら返答してください」という
1ターンを挟みます。クラウドモデルは会話の流れで受け入れ方が変わるためです。

ただし**常に入れると「前段があったから書けた」のか「素で書けた」のか分からなくなる**ので、
`--no-preamble` で外せるようにしてあります。出力ファイル名に `_nopre` が付くので、
両方回して並べれば **前段の効果そのものが検証データになります。**

```bash
python run_openrouter.py --models models.txt --repeat 3 --budget-usd 1.0
python run_openrouter.py --models models.txt --repeat 3 --no-preamble --budget-usd 1.0
```

前段の文面は `prompts/*.json` の `preamble.user` にあります。

### 提供元（プロバイダ）を固定しないと、比較にならないことがある

OpenRouter は同じモデルを複数の会社が配信していて、**提供元によって量子化が違います**
（fp8 / fp4 / 無指定）。固定しないと呼び出しごとに別の提供元へ流れることがあり、
そうなると「モデルの差」なのか「量子化の差」なのか分かりません。前回の検証で
量子化を揃えたのと同じ問題です。

`models.txt` で `モデルID@プロバイダ` と書くと固定できます。

```
deepseek/deepseek-v4-pro-0813@deepseek      # 本家
deepseek/deepseek-v4-pro-0813@streamlake    # 別提供元。同じ単価で比較できる
```

固定しなかったモデルについては、実行後に**提供元が途中で変わっていたら警告します**。
各出力がどこで生成されたかは `results/runs.json` の `provider` に残ります。

### 見る軸が、ローカルとは変わる

クラウドモデルでは中国語混入や日本語崩壊はまず起きません。差が出るのは
**比喩・語彙・誤字**のほうなので、そちら向けの軸を用意してあります。

- 機械判定: 語彙多様性／反復句（同じ比喩の使い回し）／常套句／比喩密度／平均文長／読点過多／助詞重複
- 主観採点: `--axes cloud` で「日本語の質」を **「表現の独自性」** に差し替え
  （既視感まみれの比喩・常套句への逃げ・誤用を見る）。5軸50点のままなので、
  ローカル検証（`--axes base`）の点数と同じ表に並べられます

軸の定義は `judge_axes/base.json` と `judge_axes/cloud.json` にあります。編集可能です。

---

## 判定している軸

### 機械判定（`score_mech.py`・キー不要）

| 軸 | 検出方法 |
|---|---|
| 重複行・末尾ループ | 12字以上の行の重複数。後ろ20%に5回以上出たら「末尾ループ」 |
| 中国語混入 | **cp932（日本語Windowsの文字集合）に無い漢字**を検出。辞書不要で簡体字・一部繁体字が落ちる。加えて中国語の定型句と、所有格の「的」 |
| 韓国語混入 | ハングルの検出 |
| 英単語混入 | 地の文の英単語。型番・単位は `wordlists/allow_english.txt` で除外 |
| 敬体ドリフト | **台詞を除いた地の文だけ**を見て「〜ました/です」を数える。常体との比率も出す |
| 医学用語 | `wordlists/medical.txt`。「神経末梢」「観測」等 |
| ぼかし表現 | `wordlists/vague.txt`。「結ばれた」で行為を飛ばす類型 |
| 文体規定の遵守 | ♡の数／濁点崩し／語中への「ッ」挿入／指定語彙のヒット数 |
| 作例のコピペ | 台詞と作例を突き合わせ、完全一致＋類似度0.90以上を数える |
| 一人称の混在 | 地の文の「私／僕／俺」が2種以上出ていないか |
| **語彙多様性** | 文字2-gramの異なり数÷延べ数。**低いほど言い回しが単調**。形態素解析なしの代理指標 |
| **反復句** | 同じ言い回しの使い回し。出現回数が変わらない限り左右に伸ばし、最長の反復句にまとめて報告 |
| **常套句** | `wordlists/cliche.txt`。「静寂が支配」「電流が走る」など、クラウドモデルが逃げがちな定型 |
| **比喩密度** | 「まるで／ような／かのよう」等の1000字あたり出現数 |
| **文のリズム** | 平均文長・最長文・1文の読点数（読点5個以上の文を数える） |
| **助詞重複** | 「がが」「をを」等。誤字の機械的な兆候 |
| 拒否・途中切れ・空応答 | 冒頭300字の拒否文言／末尾が文末記号でない／本文0字 |
| JSON構造化出力 | `06_json` の形式違反（コードブロック囲み・鍵カッコ混入・話者名の書き込み） |

**数字だけでなく必ず実例（前後20字）も一緒に出します。** 数だけ見せられても直せないので。

### 主観5軸（`score_judge.py`・キー要）

`--axes base`（既定・記事と同じ）… 官能描写力／心理・関係性／日本語の質／構成力／指示追従
`--axes cloud`（クラウド比較用）… 「日本語の質」を「表現の独自性」に差し替え

どちらも各10点、計50点。

判定モデルを1つに固定すると、そのモデルの好みが順位になります。
`--judge-models` に2つ以上渡すと平均と **spread（判定のばらつき）** が出るので、
**spread が大きいものだけ人が読めばよい**という使い方ができます。

---

## プロンプト（`prompts/`）

| ID | 内容 |
|---|---|
| `01_tl` | 女性向け(TL)小説・4000字指定。シナリオ3種。**総合ランキングはこれで採点** |
| `02_male_plain` | 男性向け・文体規定なし |
| `03_male_style` | 男性向け・文体規定あり（作例は外部ファイル、下記） |
| `04_rp` | キャラRP 2ターン。ユーザー側キャラへの憑依・場面の勝手な完結を見る |
| `05_light` | 1行だけの軽い指示。seed 101/202/303。重い指示との差を見る |
| `06_json` | JSON構造化出力テスト。文章力とは別の能力 |

`01_tl` のシナリオ A / B は元の記事に本文が無かったため、記載された設定から
同じ書式で復元したものです（`"restored": true` を付けてあります）。
前回の原文があれば差し替えてください。

### 作例ファイル（`03_male_style` を回す場合のみ）

`wordlists/style_examples.txt.example` を `style_examples.txt` にコピーし、作例を1行1件で置いてください。
プロンプト中の `{{STYLE_EXAMPLES}}` がその内容に置換されます。
**このファイルは `.gitignore` 済みで、リポジトリには入りません。**

---

## 注意点

### クラウドとローカルは完全に同一条件にはできない

`repeat_last_n` と `think` は **ollama 固有の設定で、OpenRouter には送れません**。
記事の「`repeat_last_n` を既定の64にすると末尾ループする」という検証は、ローカル推論の話です。
`run_openrouter.py` は実行時にこれを警告します。記事にするときは明記してください。

その他のパラメータは対応しています（OpenRouter では `repeat_penalty` → `repetition_penalty`）。

### APIキーの扱い

- **コマンドライン引数では受け取りません。**シェル履歴とプロセス一覧に残るためです
- 環境変数 `OPENROUTER_API_KEY`、または `--key-file <path>` を使ってください
- `*.key` と `.env` は `.gitignore` 済みです

### コストの止め方

- `--dry-run` … 1件だけ実行して全件を見積もる。**必ず最初にこれ**
- `--budget-usd` … 上限。**超えてからではなく、次の1件で超えそうな手前で止まります**
- `--limit N` … 先頭N件だけ
- `--prompts 01_tl` … プロンプトセットを絞る
- `--repeat 3` … 同じ条件を3回引く（コストも3倍になる点に注意）
- `estimate.py` … 投げる前に総額を出す（キー不要）

### 減点ルールを変えたいとき

`report.py` の先頭にある `PENALTY` / `PER_HIT` が、機械判定の検出数を点数に変える定義です。
順位の付け方を変えたい場合はここだけ触ってください。
