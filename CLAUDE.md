# CLAUDE.md

このリポジトリは iPhone Safari(Userscripts拡張)向けの pixiv 小説検索ユーザースクリプトです。
作業前に必ず `HANDOVER.md` を読んでください。特に「5. 未解決・要確認事項」が最優先です。

## ルール
- 成果物は単一ファイル `pixiv-fulltext-tag-and.user.js` を維持する(Userscripts は1ファイル運用)。
  テスト用にモジュール分割する場合は、ビルドで1ファイルに戻すか、テスト時のみ IIFE を評価する方式にする
- 機能変更時は `// @version` と `VERSION` 定数を両方上げる
- UI は Shadow DOM 内に閉じたまま。`document.body` 直下に要素を足さない(pixiv の React に消される)
- pixiv への実リクエストはユーザーのログインCookieが必要。自動テストでは fetch をモックする
- 取得間隔 `WAIT_MS` と `MAX_PAGES` の安全弁は外さない(アクセス過多防止)
- 文言・コメントは日本語

## 検証環境
- iPhone Safari + Userscripts(本番)
- Playwright WebKit + iPhone デバイス設定(`npm run e2e`。タッチ操作・UI・検索フローの自動検証。詳細は README と HANDOVER 6章)
- PC ブラウザ + Tampermonkey/Violentmonkey(開発・Networkタブでの API 確認用)

## E2E のルール
- E2E 関連の成果物(ブラウザ本体・npm キャッシュ・ログイン状態・結果)はプロジェクト内 `.playwright/` `.npm-cache/` `node_modules/` に閉じる。
  フォルダ外に書く変更(グローバルインストール、既定のブラウザ保存先など)はしない
- `npm run e2e` は検索 API をモックする。実 pixiv を叩くテストは `@live` タグを付け、`npm run e2e:live` でのみ走らせる
- ログイン状態の取得(`npm run e2e:login`)はユーザーが自分で行う。Claude は Cookie/トークンを扱わない
