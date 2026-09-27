# 03. 採寸画像を JSON にする定型プロンプト

採寸画像を Claude アプリ（通常のチャット）に貼り付け、下のプロンプトを一緒に送る。
返ってきた返答を**全文そのまま**ツールに貼り付ければよい（前後の説明文はツールが取り除く）。

- 料金: サブスクの範囲内（API は使わない）
- 画像は複数枚まとめて貼ってよい。ただし1回の送信で1ボディにする（大福体のように1枚に2サイズある場合は、JSON を2つ返してもらう）

---

## プロンプト本文（ここからコピー）

````text
添付したドール（BJD）の採寸画像を、下の形式の JSON に書き写してください。

# ルール
- 書き写しだけを行い、画像にない値は推測しない。項目ごと省略する
- 単位は cm の数値。「≈」「约」などは外して数値にし、外したことを ambiguities に書く
- 1つの項目に複数の値がある場合（例: 胸围 15.2/14.1、大脚/小脚、平底脚/高跟脚）は variants に全部入れ、value には最初の値を入れる
- raw_label には画像の表記をそのまま入れる
- 下の対応表にない項目は unmapped に入れる
- 曖昧な点（頭込みか不明、測る位置が不明など）は ambiguities に日本語で書く
- 1枚の画像に複数のボディやサイズがある場合は、ボディごとに JSON を分けて返す
- 返答は JSON のコードブロックだけにする

# 対応表（キー: 中国語の表記例）
height_with_head: 含头身高, 身高(含头)
height: 不含头身高, 身高(不含头), 身高不含头 ※頭込みか不明な「身高」は height に入れ ambiguities に書く
head_circ: 头围
neck_circ: 脖围
shoulder_width: 肩宽
chest_circ: 胸围
waist_circ: 腰围 ※ウエストのこと
hip_circ: 臀围
back_length: 背长
front_length: 前长
armhole_circ: 袖窿围, 臂根围
arm_length: 臂长, 手臂长
upper_arm_circ: 上臂围, 大臂围, 手臂围
forearm_circ: 小臂围
wrist_circ: 手腕围
hand_length: 手长
wrist_joint_diam: 手球, 手球直径
wrist_joint_circ: 手球圆周长
outer_leg_length: 外腿长, 腿长含脚
inseam: 内腿长, 裆至脚底, 裆到脚底腿长
navel_to_sole: 肚脐至脚底
thigh_circ: 大腿围
calf_circ: 小腿围
ankle_circ: 脚踝围
foot_length: 脚长
foot_width: 脚宽
foot_height: 脚高
ankle_joint_diam: 脚球, 脚球直径
ankle_joint_circ: 脚球圆周长

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
}
````

## プロンプト本文（ここまで）

---

## メモ
- 対応表は [02-measurement-schema.md](02-measurement-schema.md) と常に一致させる（実装時はツールがこのプロンプトを生成し、ずれが起きないようにする）
- [samples/bodies/](samples/bodies/) の5体は、このルールで手作業で書き写したもの。プロンプトの出力と比べる正解データとしても使う
