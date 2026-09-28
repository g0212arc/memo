# VPS へのデプロイ（docker compose + nginx:alpine）

| 項目 | 値 |
|---|---|
| 公開 URL | https://tcpattern.duckdns.org |
| 置き場所 | `/home/deploy/apps/doll-pattern-maker`（リポジトリ全体を clone） |
| 待ち受け | `127.0.0.1:8200`（外からはホストの nginx 経由のみ） |
| コンテナ | nginx:alpine 1つ。メモリ上限 64MB（実測 約5MB）、CPU 0.5 |
| ホスト nginx | `/etc/nginx/sites-available/tcpattern` |
| デプロイするブランチ | `claude/pattern-maker-doll-support-ee7mua`（`BRANCH=... deploy.sh` で変更可） |

## しくみ

```
ブラウザ ─HTTPS→ ホストの nginx (443, certbot) ─proxy_pass→ 127.0.0.1:8200 ─→ コンテナの nginx ─→ dist/（HTML/JS/CSS）
```

- `Dockerfile` の1段目（node:22-alpine）でテストとビルドを行い、2段目（nginx:alpine）には `dist/` だけを入れる。本番には Node が残らない
- ビルド中だけ Node が一時的に約 300MB 使う（`NODE_OPTIONS=--max-old-space-size=384` で上限を付けている）
- アプリはサーバー側で何も保存しない（データは各ブラウザの中）。バックアップ対象はない

## ファイル

| ファイル | 役割 |
|---|---|
| `Dockerfile` | 2段階ビルド |
| `nginx.conf` | コンテナ内の nginx（`/assets/` は長期キャッシュ、`index.html` は毎回確認） |
| `compose.yaml` | ポート・メモリ上限・読み取り専用・ヘルスチェック・ログの上限 |
| `nginx-site.conf` | ホストの nginx 用の見本（初回に1回だけコピーする） |
| `deploy.sh` | 更新用。取得 → ビルド → 入れ替え → 動作確認 → 古いイメージ削除 |

---

## 初回セットアップ

`ssh vps "..."` は deploy ユーザーで実行できるもの、`! ssh -t vps "sudo ..."` は sudo のパスワード入力が必要なもの。

### 1. VPS からリポジトリを取得できるか確認

```bash
ssh vps "git ls-remote https://github.com/g0212arc/memo.git HEAD"
```

- ハッシュが表示されれば公開リポジトリ → 2 へ
- 認証を求められる／失敗する場合は非公開リポジトリ → 読み取り専用の Deploy key を作る

```bash
ssh vps 'ssh-keygen -t ed25519 -f ~/.ssh/memo_deploy -N "" -C "vps-deploy-memo" && cat ~/.ssh/memo_deploy.pub'
# 表示された公開鍵を GitHub の g0212arc/memo → Settings → Deploy keys → Add deploy key に登録（Allow write access はオフ）
ssh vps 'printf "\nHost github-memo\n  HostName github.com\n  User git\n  IdentityFile ~/.ssh/memo_deploy\n  IdentitiesOnly yes\n" >> ~/.ssh/config && ssh -o StrictHostKeyChecking=accept-new -T github-memo; true'
```

非公開の場合、下の clone の URL は `github-memo:g0212arc/memo.git` に置き換える。

### 2. clone とポートの確認

```bash
ssh vps 'ss -tln | grep -q ":8200 " && echo "8200 は使用中" || echo "8200 は空き"'
ssh vps 'mkdir -p ~/apps && git clone -b claude/pattern-maker-doll-support-ee7mua https://github.com/g0212arc/memo.git ~/apps/doll-pattern-maker'
```

### 3. 初回デプロイ

```bash
ssh vps '~/apps/doll-pattern-maker/doll-pattern-maker/deploy/deploy.sh'
```

最後に `OK: http://127.0.0.1:8200/ が応答しました` と出れば成功。

### 4. ホストの nginx に追加

```bash
! ssh -t vps "sudo cp /home/deploy/apps/doll-pattern-maker/doll-pattern-maker/deploy/nginx-site.conf /etc/nginx/sites-available/tcpattern && sudo ln -s /etc/nginx/sites-available/tcpattern /etc/nginx/sites-enabled/tcpattern && sudo nginx -t && sudo systemctl reload nginx"
```

`nginx -t` が失敗した場合は reload されないので、既存サイトには影響しない。

### 5. DNS の確認と HTTPS 化

```bash
ssh vps 'getent hosts tcpattern.duckdns.org'   # 160.251.176.139 が出ること
! ssh -t vps "sudo certbot --nginx -d tcpattern.duckdns.org"
```

ブラウザで https://tcpattern.duckdns.org を開いて確認。

> certbot は `/etc/nginx/sites-available/tcpattern` に 443 の設定を書き足す。
> **以降はリポジトリの `nginx-site.conf` で上書きしないこと**（HTTPS の設定が消える）。変更はサーバー上のファイルを直接編集する。

### 6. （任意）Basic 認証

```bash
# ユーザー名は好きなものに変える。パスワードは2回聞かれる
! ssh -t vps "printf 'tc:%s\n' \"\$(openssl passwd -apr1)\" | sudo tee /etc/nginx/.htpasswd-tcpattern >/dev/null && sudo chown root:www-data /etc/nginx/.htpasswd-tcpattern && sudo chmod 640 /etc/nginx/.htpasswd-tcpattern"
! ssh -t vps "sudo sed -i 's|# auth_basic|auth_basic|' /etc/nginx/sites-available/tcpattern && sudo nginx -t && sudo systemctl reload nginx"
```

certbot の後に行った場合、443 側の server ブロックにも `auth_basic` の2行が入っているか確認する（certbot は元の server ブロックを 443 用に書き換えるので、通常はそのまま引き継がれる）。

---

## 更新

push した後、VPS で:

```bash
ssh vps '~/apps/doll-pattern-maker/doll-pattern-maker/deploy/deploy.sh'
```

## よく使うコマンド

```bash
ssh vps 'cd ~/apps/doll-pattern-maker/doll-pattern-maker/deploy && docker compose ps'
ssh vps 'cd ~/apps/doll-pattern-maker/doll-pattern-maker/deploy && docker compose logs --tail 50'
ssh vps 'docker stats --no-stream doll-pattern-maker-web-1'
```

## 前のバージョンに戻す

```bash
ssh vps 'cd ~/apps/doll-pattern-maker && git log --oneline -5'
ssh vps 'cd ~/apps/doll-pattern-maker && git checkout <戻したいコミット> && cd doll-pattern-maker/deploy && docker compose up -d --build'
# 元に戻すときは deploy.sh を実行（ブランチの最新に戻る）
```

## 撤去

```bash
ssh vps 'cd ~/apps/doll-pattern-maker/doll-pattern-maker/deploy && docker compose down --rmi all'
! ssh -t vps "sudo rm /etc/nginx/sites-enabled/tcpattern && sudo nginx -t && sudo systemctl reload nginx"
```
