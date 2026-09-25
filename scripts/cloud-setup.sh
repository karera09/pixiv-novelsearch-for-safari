#!/usr/bin/env bash
# Claude Code クラウド実行(claude.ai/code)の「セットアップスクリプト」から呼ぶ想定。
#   環境設定 → Setup script に:  bash scripts/cloud-setup.sh
# 環境の初回作成時に root で一度だけ実行され、結果(ディスク状態)はスナップショットされて以後のセッションで再利用される。
# 制限時間は 5 分なので、重い処理はここに集約し、毎セッションの処理は scripts/session-start.sh に置く。
#
# 必要なネットワーク許可(Custom を選んだ場合。Trusted の既定に加えて):
#   cdn.playwright.dev / playwright.download.prss.microsoft.com  … WebKit の取得
#   www.pixiv.net / s.pximg.net                                   … online モードの E2E(不要なら E2E_OFFLINE=1)
set -u
cd "$(dirname "$0")/.."

echo "== Node: $(node --version) / npm: $(npm --version)"

echo "== 依存パッケージ"
npm ci --no-audit --no-fund || { echo "!! npm ci に失敗(registry.npmjs.org への到達を確認)"; exit 1; }

echo "== WebKit(プロジェクト内 .playwright/browsers に保存。Linux は OS パッケージも導入)"
if [ "$(uname -s)" = "Linux" ]; then
  node e2e/cli.js install --with-deps || {
    echo "!! WebKit の取得または OS パッケージ導入に失敗。"
    echo "   ネットワーク許可に cdn.playwright.dev と playwright.download.prss.microsoft.com を追加してください。"
    echo "   セットアップは続行します(E2E 以外は使えます)。"
  }
else
  node e2e/cli.js install || true
fi

echo "== 動作確認(単体テスト)"
npm run check && npm test

echo "== セットアップ完了。E2E は npm run e2e:offline(pixiv 未許可時)または npm run e2e"
exit 0
