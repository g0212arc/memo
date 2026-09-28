#!/usr/bin/env bash
# VPS 上で deploy ユーザーとして実行する（sudo 不要）。
#   ~/apps/doll-pattern-maker/doll-pattern-maker/deploy/deploy.sh
# 最新のコードを取得 → イメージをビルド → コンテナを入れ替え → 動作確認 → 古いイメージを掃除
set -euo pipefail

BRANCH="${BRANCH:-claude/pattern-maker-doll-support-ee7mua}"
PORT="${PORT:-8200}"
REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_DIR"

echo "==> コードを取得（$BRANCH）"
git fetch origin "$BRANCH"
if [ -n "$(git status --porcelain)" ]; then
  echo "VPS 上のリポジトリに未コミットの変更があります。確認してから再実行してください。" >&2
  git status --short >&2
  exit 1
fi
git checkout -q "$BRANCH" 2>/dev/null || git checkout -q -b "$BRANCH" "origin/$BRANCH"
git merge --ff-only "origin/$BRANCH"
echo "    $(git log -1 --format='%h %s')"

# ビルド中は Node が一時的に 300MB ほど使う。空きが少ないときは知らせる
avail_mb=$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo)
if [ "$avail_mb" -lt 450 ]; then
  echo "注意: 空きメモリが ${avail_mb}MB です。ビルドが失敗する場合は他のサービスの負荷が低いときに再実行してください。" >&2
fi

cd doll-pattern-maker/deploy
echo "==> ビルド"
PORT="$PORT" docker compose build
echo "==> 起動"
PORT="$PORT" docker compose up -d

echo "==> 動作確認"
for i in $(seq 1 10); do
  if curl -fsS -o /dev/null "http://127.0.0.1:${PORT}/" 2>/dev/null; then
    echo "    OK: http://127.0.0.1:${PORT}/ が応答しました"
    docker image prune -f >/dev/null
    exit 0
  fi
  sleep 1
done
echo "応答がありません。docker compose logs を確認してください。" >&2
PORT="$PORT" docker compose logs --tail 30 >&2
exit 1
