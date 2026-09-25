#!/usr/bin/env bash
# .claude/settings.json の SessionStart フックから毎セッション呼ばれる。
# クラウド実行(CLAUDE_CODE_REMOTE=true)のときだけ、スナップショット後に欠けたものを軽く補う。手元では何もしない。
# 重い処理(WebKit 取得・OS パッケージ)は scripts/cloud-setup.sh(環境作成時に一度)に置く。
set -u
[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0
cd "$(dirname "$0")/.."

[ -d node_modules/@playwright/test ] || npm ci --no-audit --no-fund >/dev/null 2>&1 || true

if ! ls .playwright/browsers 2>/dev/null | grep -q '^webkit-'; then
  echo "[session-start] WebKit が未取得です。scripts/cloud-setup.sh を環境のセットアップスクリプトに設定するか、npm run e2e:install を実行してください" >&2
fi
if [ -z "${E2E_OFFLINE:-}" ]; then
  echo "[session-start] E2E_OFFLINE が未設定です。www.pixiv.net がネットワーク許可に無い環境では npm run e2e:offline を使ってください" >&2
fi
exit 0
