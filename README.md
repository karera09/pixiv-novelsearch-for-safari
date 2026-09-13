# pixiv 小説 本文検索 × タグ AND

pixiv 小説の **本文全文検索** の結果を、**タグ条件(AND / NOT)** でクライアント側フィルタして表示するユーザースクリプトです。
iPhone Safari + [Userscripts](https://apps.apple.com/jp/app/userscripts/id1463298887) 拡張で動かすことを前提にしています。

- 成果物: `pixiv-fulltext-tag-and.user.js`(単一ファイル)
- 引き継ぎ資料: [`HANDOVER.md`](HANDOVER.md) — 動作原理・既知の問題・未解決事項はこちら
- 開発ルール: [`CLAUDE.md`](CLAUDE.md)

## 導入(iPhone)

1. App Store で「Userscripts」をインストールし、設定 → Safari → 機能拡張 で有効化する
2. Userscripts アプリで保存先フォルダ(iCloud Drive)を指定する
3. `pixiv-fulltext-tag-and.user.js` をそのフォルダに置く
4. pixiv を開くと右下に「本文×タグ」ボタンが出る

PC ブラウザでは Tampermonkey / Violentmonkey で同じファイルを読み込めます(開発・Network タブでの API 確認用)。

## 開発

依存パッケージはありません。Node.js 20 以上の標準テストランナーを使います。

```sh
npm test          # test/ 配下の単体テスト(fetch はモック)
npm run check     # 構文チェックのみ
```

テストはスクリプト本体(IIFE)を最小限の DOM スタブ上で評価し、
`globalThis.__pxAndTestHook` 経由で内部関数を取り出して検証します(`test/harness.js`)。
ブラウザ実行時はこのフックが未定義なので何も起きません。

### 調査用スクリプト

`tools/probe-search-api.user.js` は内部 API のパラメータ名を実環境で確認するための別スクリプトです。
本番スクリプトと同時に有効にでき、左下の「API調査」ボタンから実行します(結果は「コピー」で取り出せます)。

### 変更時のルール(抜粋)

- 機能変更時は `// @version` と `VERSION` 定数を両方上げる
- UI は Shadow DOM 内に閉じたまま。`document.body` 直下に要素を足さない
- `WAIT_MS` / `MAX_PAGES` の安全弁は外さない

## 未解決事項

内部 API のパラメータ名(ジャンル・`s_mode` など)が未確定です。詳細は `HANDOVER.md` の「5. 未解決・要確認事項」を参照してください。
