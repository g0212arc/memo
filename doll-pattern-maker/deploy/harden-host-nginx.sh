#!/usr/bin/env bash
# ホストの nginx の守りを固める（2026-10-04）。VPS 上で sudo で1回実行する。何回実行しても同じ結果になる。
#   sudo bash /home/deploy/apps/doll-pattern-maker/doll-pattern-maker/deploy/harden-host-nginx.sh
#
# やること
#   1. nginx のバージョンを出さない（server_tokens off。この VPS の nginx 全体に効く）
#   2. HTTPS を強制する（HSTS: 一度来たブラウザは 1 年間 https でだけ開く）
#   3. アクセス回数の制限（同じ IP から 1 秒に 20 回まで。まとめて 60 回までは待たずに通す。超えたら 429）
#
# certbot が書き足した HTTPS の設定を消さないよう、サイトの設定ファイルは置き換えず、
# server_name の行の下に include を 1 行足すだけにする。設定のチェック（nginx -t）に失敗したら元に戻す。
set -euo pipefail

SITE=/etc/nginx/sites-available/tcpattern
HTTP_CONF=/etc/nginx/conf.d/tcpattern-hardening.conf
SNIPPET=/etc/nginx/snippets/tcpattern-security.conf
INCLUDE_LINE='    include snippets/tcpattern-security.conf;'

if [ "$(id -u)" -ne 0 ]; then
  echo "sudo で実行してください: sudo bash $0" >&2
  exit 1
fi
if [ ! -f "$SITE" ]; then
  echo "$SITE がありません（初回セットアップの「4. ホストの nginx に追加」が先です）" >&2
  exit 1
fi

stamp=$(date +%Y%m%d-%H%M%S)
backup="$SITE.bak-$stamp"
cp -p "$SITE" "$backup"
echo "==> 控えを取りました: $backup"
had_http_conf=0; [ -f "$HTTP_CONF" ] && had_http_conf=1 && cp -p "$HTTP_CONF" "$HTTP_CONF.bak-$stamp"
had_snippet=0; [ -f "$SNIPPET" ] && had_snippet=1 && cp -p "$SNIPPET" "$SNIPPET.bak-$stamp"

restore() {
  echo "!! 設定のチェックに失敗したので元に戻します" >&2
  cp -p "$backup" "$SITE"
  if [ "$had_http_conf" = 1 ]; then cp -p "$HTTP_CONF.bak-$stamp" "$HTTP_CONF"; else rm -f "$HTTP_CONF"; fi
  if [ "$had_snippet" = 1 ]; then cp -p "$SNIPPET.bak-$stamp" "$SNIPPET"; else rm -f "$SNIPPET"; fi
  nginx -t >&2 || true
  exit 1
}

echo "==> http 全体の設定: $HTTP_CONF"
cat > "$HTTP_CONF" <<'EOF'
# harden-host-nginx.sh が作成（tcpattern.duckdns.org 用）
# バージョンを出さない（この nginx の全サイトに効く）
server_tokens off;
# アクセス回数を数える場所（IP ごと。10MB で約 16 万 IP 分）
limit_req_zone $binary_remote_addr zone=tcpattern:10m rate=20r/s;
EOF

echo "==> サイト用の設定: $SNIPPET"
mkdir -p "$(dirname "$SNIPPET")"
cat > "$SNIPPET" <<'EOF'
# harden-host-nginx.sh が作成（/etc/nginx/sites-available/tcpattern の server から include）
# HTTPS を強制する（1 年。サブドメインには広げない）
add_header Strict-Transport-Security "max-age=31536000" always;
# 同じ IP から 1 秒に 20 回まで。ページを開くと一度に数ファイル読むので、まとめて 60 回までは待たずに通す
limit_req zone=tcpattern burst=60 nodelay;
limit_req_status 429;
EOF

echo "==> サイトの設定に include を足す"
if grep -q 'snippets/tcpattern-security.conf' "$SITE"; then
  echo "    もう入っています（変更なし）"
else
  # server_name tcpattern.duckdns.org の行（80 と 443 の server それぞれ）の下に 1 行足す
  sed -i "/server_name[[:space:]]\+tcpattern\.duckdns\.org;/a\\
$INCLUDE_LINE" "$SITE"
  n=$(grep -c 'snippets/tcpattern-security.conf' "$SITE" || true)
  echo "    $n か所に足しました"
  if [ "$n" -lt 1 ]; then
    echo "!! server_name tcpattern.duckdns.org; の行が見つかりませんでした" >&2
    restore
  fi
fi

echo "==> 設定のチェック"
nginx -t || restore
systemctl reload nginx
echo "==> 反映しました"
echo
echo "確認（手元の PC で）:"
echo "  curl -sI https://tcpattern.duckdns.org/ | grep -iE 'server|strict-transport'"
echo "  → Server: nginx（バージョンなし）と Strict-Transport-Security が出れば OK"
echo
echo "元に戻すとき:"
echo "  sudo cp -p $backup $SITE && sudo rm -f $HTTP_CONF $SNIPPET && sudo nginx -t && sudo systemctl reload nginx"
