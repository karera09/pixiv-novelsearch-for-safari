#!/usr/bin/env bash
# .claude/settings.json の SessionStart フックから毎セッション呼ばれる。
# クラウド実行(CLAUDE_CODE_REMOTE=true)のときだけ、リポジトリ依存の準備を行う。手元では何もしない。
#   - npm ci(node_modules が無ければ)
#   - WebKit が無ければバックグラウンドで取得(フックの時間制限を避けるため待たない)
# OS パッケージや WebKit 本体の事前取得は scripts/cloud-setup.sh(環境作成時に一度)が担当。
set -u
[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0
cd "$(dirname "$0")/.." || exit 0

if [ ! -d node_modules/@playwright/test ]; then
  echo "[session-start] npm ci を実行します" >&2
  npm ci --no-audit --no-fund >/dev/null 2>&1 || echo "[session-start] npm ci に失敗しました。手動で npm ci を実行してください" >&2
fi

# ブラウザの保存先: 環境変数(cloud-setup.sh と揃えて /opt/ms-playwright)か、既定のプロジェクト内
BROWSERS="${PLAYWRIGHT_BROWSERS_PATH:-.playwright/browsers}"
if ! ls "$BROWSERS" 2>/dev/null | grep -q '^webkit-'; then
  mkdir -p .playwright
  echo "[session-start] WebKit が $BROWSERS に無いのでバックグラウンドで取得します(ログ: .playwright/install.log)。完了まで npm run e2e は失敗します" >&2
  nohup node e2e/cli.js install --with-deps > .playwright/install.log 2>&1 &
fi

if [ -z "${E2E_OFFLINE:-}" ]; then
  echo "[session-start] www.pixiv.net がネットワーク許可に無い環境では npm run e2e:offline を使ってください" >&2
fi
exit 0
