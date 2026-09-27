// Claude アプリに貼る定型プロンプトを、採寸項目の定義から組み立てる。

import { MEASUREMENTS } from './schema';

export function buildImportPrompt(): string {
  const table = MEASUREMENTS.filter((d) => !d.toolOnly)
    .map((d) => `${d.key}: ${d.aliases.join(', ')}${d.promptNote ? ` ※${d.promptNote}` : ''}`)
    .join('\n');

  return `添付したドール（BJD）の採寸画像（メーカーの画像、または手書き・スマホの採寸メモ）を、下の形式の JSON に書き写してください。

# ルール
- 書き写しだけを行い、画像にない値は推測しない。項目ごと省略する
- 単位は cm の数値。「≈」「约」などは外して数値にし、外したことを ambiguities に書く
- 1つの項目に複数の値がある場合（例: 胸围 15.2/14.1、大脚/小脚、平底脚/高跟脚）は variants に全部入れ、value には最初の値を入れる
- raw_label には画像の表記をそのまま入れる
- 下の対応表にない項目は unmapped に入れる
- 曖昧な点（頭込みか不明、測る位置が不明など）は ambiguities に日本語で書く
- 1枚の画像に複数のボディやサイズがある場合は、ボディごとに JSON を分けて返す
- 返答は JSON のコードブロックだけにする

# 対応表（キー: 表記の例）
${table}

# 形式
{
  "schema": "doll-body/v1",
  "name": "ボディ名",
  "maker": "メーカー名（わかれば）",
  "source": "画像の出どころ（わかれば）",
  "measurements": {
    "<キー>": { "value": 0.0, "raw_label": "表記", "variants": [{ "label": "…", "value": 0.0 }] }
  },
  "unmapped": [{ "raw_label": "…", "value": 0.0, "note": "…" }],
  "ambiguities": ["…"]
}`;
}
