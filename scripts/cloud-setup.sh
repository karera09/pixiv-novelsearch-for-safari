#!/usr/bin/env bash
# Claude Code クラウド実行(claude.ai/code)の「セットアップスクリプト」。
# 環境の初回作成時に root で一度だけ実行され、ディスク状態がスナップショットされて以後のセッションで再利用される。
# その時点ではリポジトリが checkout されていない(作業ディレクトリも不定)ので、リポジトリのファイルに一切依存しない。
# リポジトリ依存の処理(npm ci 等)は .claude/settings.json の SessionStart フック(scripts/session-start.sh)が毎セッション行う。
#
# 環境設定の「セットアップスクリプト」欄には次の 1 行を入れる(公開リポジトリなので raw.githubusercontent.com から取れる):
#   curl -fsSL https://raw.githubusercontent.com/karera09/pixiv-novelsearch-for-safari/main/scripts/cloud-setup.sh | bash
# 環境変数には PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright を入れる(下の BROWSERS と一致させる)。
#
# 必要なネットワーク許可(Trusted の既定に加えて): cdn.playwright.dev / playwright.download.prss.microsoft.com
# 制約: 非ゼロ終了するとセッションが起動しない。5 分以内に終える。
set -u

PW_VERSION="1.63.0"                       # package.json の @playwright/test と揃える(WebKit のリビジョンが版に紐づく)
BROWSERS="${PLAYWRIGHT_BROWSERS_PATH:-/opt/ms-playwright}"
export PLAYWRIGHT_BROWSERS_PATH="$BROWSERS"

echo "== cloud-setup: Playwright $PW_VERSION / WebKit -> $BROWSERS"
echo "== Node: $(node --version 2>/dev/null || echo なし) / npm: $(npm --version 2>/dev/null || echo なし)"

if [ "$(uname -s)" != "Linux" ]; then
  echo "!! Linux 以外では何もしません(手元では npm run e2e:install を使う)"
  exit 0
fi

mkdir -p "$BROWSERS"

# WebKit の OS 依存パッケージ(apt)と WebKit 本体。npx で版を固定して取得する(リポジトリ不要)
if npx --yes "playwright@$PW_VERSION" install --with-deps webkit; then
  echo "== WebKit を取得しました: $(ls "$BROWSERS" | tr '\n' ' ')"
else
  echo "!! WebKit の取得に失敗しました。ネットワーク許可に cdn.playwright.dev と playwright.download.prss.microsoft.com があるか確認してください。"
  echo "   セッションは起動させます(E2E 以外は使えます。あとから npm run e2e:install でも取得できます)。"
fi

# 誰でも読める権限にしておく(セッションが root 以外で動く場合に備える)
chmod -R a+rX "$BROWSERS" 2>/dev/null || true

echo "== cloud-setup 完了"
exit 0
