# Underdog Saluki 27B 1.0（気になりメモ）

2026-10-08 記録。発表当日なので第三者の検証はまだない。

## 何か

- 発表：@underdogai の X ポスト（2026-10-08 11:27、18万表示）
- 配布：[ConwayResearch/Underdog-Saluki-27B-1.0](https://huggingface.co/ConwayResearch/Underdog-Saluki-27B-1.0)（Apache-2.0、gated なし、公開当日の DL は 142）
- 中身：**Qwen3.8-27B を 2bit に量子化したもの（`IQ2-mix`）**
  - HF の `base_model` は **`ISTA-DASLab/Qwen3.8-27B-GSQ-RCO-GGUF`** で、relation は `quantized`
  - つまりファインチューンではなく、GSQ-RCO 版から作った量子化の派生。「tool calling を残すよう調整した」とカードに書いてあるのは、配分のことだと読める（推測）
- **普通の llama.cpp で動く**。Bonsai のような fork は要らない
- thinking は既定でオン。リクエストごとに切り替えられる（Qwen3.8 と同じ）

## ファイルサイズ（HF API で実測）

| ファイル | GB | **GiB** |
|---|---:|---:|
| `Underdog-Saluki-27B-1.0-IQ2-mix.gguf` | 7.90 | **7.36** |
| `mmproj-...-F16.gguf`（vision） | 0.93 | 0.86 |
| `mmproj-...-Q8_0.gguf`（vision） | 0.63 | 0.59 |

## RTX 3060 12GB に載せた場合

12 GiB から Windows の分（約 0.8 GiB）を引いて、使えるのは約 11.2 GiB。

| 候補 | 重み | KV などに残る分 |
|---|---:|---:|
| **Saluki** | 7.36 GiB | **約 3.8 GiB** |
| Saluki + vision Q8 | 7.95 GiB | 約 3.2 GiB |
| GSQ-RCO IQ2_XS | 7.84 GiB | 約 3.4 GiB |
| GSQ-RCO IQ2_S | 8.62 GiB | 約 2.6 GiB |
| GSQ-RCO IQ3_XXS | 9.40 GiB | 約 1.8 GiB |

カードの推奨は `-c 32768`。3060 なら 32K 文脈と vision を両方使っても収まりそう。

## ベンチ（作者の公表値）

| ベンチ | Saluki | フルサイズ | 条件 |
|---|---:|---:|---|
| Tool calling（Underdog Bench、120問） | **88** | 84 | 同じハーネス |
| 並列 tool call（BFCL v4、100問） | **42** | 35 | 同じハーネス |
| SWE-bench Verified（50問） | 30 | 33 | 同じハーネス |
| IFEval | 93.5 | 91.5 | フルサイズ側は public |
| IFBench | 72.7 | 71.0 | 〃 |
| MBPP+ | 78.0 | 83.9 | 〃 |
| MuSR | 67.5 | 79.6 | 〃 |
| AIME 2025（avg@4） | 79.2 | 96.7 | 〃 |
| AIME 2026（avg@4） | 80.0 | 94.6 | 〃 |
| 参考：Bonsai 2（5.95 GB） | 70 / 120 | — | Tool calling |

## 引っかかる点

1. **「tool calling で Qwen に勝つ」は 120問中 88 対 84、4問差でしかない。** カード自身も「数問の差は試行ごとのばらつき」と書いている。量子化版が元モデルを上回るのは誤差と読むのが妥当
2. **Underdog Bench は自前のセット**（BFCL v4 から 120問を抜き出したもの）
3. **フルサイズ側の数字の多くは別ハーネスの public 値。** 条件が揃っているのは tool calling・並列・SWE-bench の3つだけ
4. **数学が落ちる。** AIME 2025 は 79.2 対 96.7。作者自身も「競技数学は 82〜85% 保持」と書いている
   - ISTA の GSQ-RCO IQ2_XS（2.50bpw、8.4 GB）は AIME25 で 96.67 対 100（ISTA 自身の測定）
   - ハーネスが違うので直接は比べられない。ただ、数学を削って tool calling 寄りに配分した可能性はある（推測）
5. **X の画像の「96%」は、100% を超える項目（120% など）込みの平均。** 平均で見ると強く見える
6. 並列呼び出しの返答の約 1/5 で、書式に小さな崩れがある（作者記載）
7. thinking オンだと答える前の推論が長い（作者記載）

## 試すなら

```bash
huggingface-cli download ConwayResearch/Underdog-Saluki-27B-1.0 \
  Underdog-Saluki-27B-1.0-IQ2-mix.gguf --local-dir .
llama-server -m Underdog-Saluki-27B-1.0-IQ2-mix.gguf --jinja -ngl 99 -fa on -c 32768
```

- 一般用途：thinking オン、temperature 0.6 / top_p 0.95 / top_k 20
- tool call を速く：`"chat_template_kwargs": {"enable_thinking": false}`、temperature 0

**ブログの検証ネタ候補：** 3060 12GB で Saluki（7.36 GiB）と GSQ-RCO IQ3_XXS（9.40 GiB）を並べる。

- tok/s（`llama-bench`）
- 同じ tool call タスクを数十問
- 数学・日本語の落ち方

作者の数字をそのまま信じずに自分で測る価値がある。

---

## 今夜あわせて調べたこと（前提メモ）

- **Qwen3.8-27B は実在**：公式 [Qwen/Qwen3.8-27B](https://huggingface.co/Qwen/Qwen3.8-27B)（2026-08-05、DL 675万、Apache-2.0、VLM）
- **GSQ-RCO GGUF も実在**：[ISTA-DASLab/Qwen3.8-27B-GSQ-RCO-GGUF](https://huggingface.co/ISTA-DASLab/Qwen3.8-27B-GSQ-RCO-GGUF)（DL 155万）
  - 引用されている論文2本を arXiv で確認した：[GSQ 2604.18556](https://arxiv.org/abs/2604.18556)、[RCO 2605.00649](https://arxiv.org/abs/2605.00649)。RCO の著者に GPTQ の Dan Alistarh が入っている
  - 実サイズ：IQ2_XS 7.84 / IQ2_S 8.62 / **IQ3_XXS 9.40** / IQ3_S 10.96 GiB
  - 作者の公表値では IQ3_XXS（3.00bpw）が AIME25 で BF16 と同点。普通の Q3_K（一様量子化）とは別物
  - 注意：AIME25 は 30問しかなく、1問で 3.33点動く。ZS recovery の 100% 超えは誤差。README はテンプレートのまま公開されている
- **3060 12GB の本命は GSQ-RCO IQ3_XXS**。vision も使うなら IQ2_S。Saluki は tool call 用途の対抗馬
- 友人の PC（i7-4771 / DDR3 16GB / GTX 1050 Ti 4GB）：DDR3 の帯域が約 25.6 GB/s しかないので、VRAM からあふれた瞬間に遅くなる。LFM2.5-2.6B や 4B 級を VRAM に全部載せる。Pascal なので CUDA 12 ビルドを使い、K-quants を選ぶ
