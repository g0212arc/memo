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
export OPENROUTER_API_KEY=sk-or-...        # Windows: set OPENROUTER_API_KEY=sk-or-...
python run_openrouter.py --models models.txt --dry-run
python run_openrouter.py --models models.txt --budget-usd 1.0
python score_judge.py --in outputs --runs results/runs.json --dry-run
python score_judge.py --in outputs --runs results/runs.json --budget-usd 0.3
python report.py --mech results/mech.json --judge results/judge.json --runs results/runs.json
```

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
| 拒否・途中切れ・空応答 | 冒頭300字の拒否文言／末尾が文末記号でない／本文0字 |
| JSON構造化出力 | `06_json` の形式違反（コードブロック囲み・鍵カッコ混入・話者名の書き込み） |

**数字だけでなく必ず実例（前後20字）も一緒に出します。** 数だけ見せられても直せないので。

### 主観5軸（`score_judge.py`・キー要）

官能描写力／心理・関係性／日本語の質／構成力／指示追従 を各10点、計50点。

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

### 減点ルールを変えたいとき

`report.py` の先頭にある `PENALTY` / `PER_HIT` が、機械判定の検出数を点数に変える定義です。
順位の付け方を変えたい場合はここだけ触ってください。
