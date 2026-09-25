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
4. pixiv の小説関連ページ(小説タブの検索結果、`/novel/`、ユーザーの小説一覧など)を開くと、画面右端に細い「本文×タグ」タブが出る。
   トップやイラストのページには出ない(設定で「pixiv の全ページ」「出さない」に変更可)。出していないページでは URL 末尾に `#pxand` を付けても開ける

PC ブラウザでは Tampermonkey / Violentmonkey で同じファイルを読み込めます(開発・Network タブでの API 確認用)。

## 使い方(v1.0 の UI)

- **条件画面**: 本文に含む語(必須)、必須タグ / 除外タグ(スペース区切り。解釈結果がチップで見える)、部分一致、並び順、詳細条件(年齢制限・オリジナル限定・ジャンル・言語・追加パラメータ)。
  タグ検索ページから開くと、そのタグを必須タグに入れる提案が出る。キーボードの「検索」キーでも検索できる
- **結果画面**: 上部に条件の要約(タップで条件画面へ)、下部の固定バーに件数・進捗と状態ごとの主ボタン(止める / 続きを探す / 続けて探す / 再試行 / 条件を変える)。
  結果カードのタグをタップすると、必須 / 除外に追加して再検索できる。パネルを閉じても検索は続き、タブに件数バッジが出る
- **安全弁**: 1回のタップで掘るのは `PAGES_PER_BATCH`(20)ページまで。ヒットが少ない条件では一旦止まり、「続けて探す」で続きから掘る。全体の上限は `MAX_PAGES`(100)
- **保存**: 前回の条件と最近の検索 8件を localStorage に保存(設定でオフにできる)。ダーク配色は pixiv 側の背景色に追従

## 開発

依存パッケージはありません。Node.js 20 以上の標準テストランナーを使います。

```sh
npm test          # test/ 配下の単体テスト(fetch はモック)
npm run check     # 構文チェックのみ
```

テストはスクリプト本体(IIFE)を最小限の DOM スタブ上で評価し、
`globalThis.__pxAndTestHook` 経由で内部関数を取り出して検証します(`test/harness.js`)。
ブラウザ実行時はこのフックが未定義なので何も起きません。

### E2E テスト(Playwright WebKit / iPhone 相当)

iPhone Safari に近い WebKit エンジンで、実際の pixiv ページ上に本番スクリプトを注入してタッチ操作・入力・検索フローを検証します。
ブラウザ本体、npm キャッシュ、ログイン状態、結果はすべてこのフォルダ内(`.playwright/`、`.npm-cache/`、`node_modules/`)に閉じ、
フォルダ外には何も書きません。

```sh
npm install          # @playwright/test(devDependency)。キャッシュは .npm-cache/ に置かれる
npm run e2e:install  # WebKit を .playwright/browsers/ に取得(約 175MB、初回のみ)
npm run e2e          # モック API でのタッチ/UI テスト。ログイン不要、pixiv へ検索リクエストは飛ばない
npm run e2e:login    # 実 pixiv 検証用: 開いた WebKit で自分でログインすると .playwright/auth/pixiv.json に保存される
npm run e2e:live     # 実 pixiv に対する検証(上のログイン状態が無ければ自動スキップ)
npm run e2e:report   # 直近の HTML レポートを開く
```

`.playwright/auth/pixiv.json` にはセッション Cookie が含まれます。git 管理外ですが、共有・コピーしないでください。

### Linux / クラウドでの開発

開発環境は Windows / Linux / クラウド(Claude Code のクラウド実行、GitHub Actions、devcontainer)のどれでも同じコマンドで動きます。
リポジトリ内の改行は `.gitattributes` で LF に統一しています。

```sh
npm run e2e:deps     # Linux のみ: WebKit の実行に必要な OS パッケージ(apt、root/sudo 必要)。Playwright 公式イメージでは不要
npm run e2e:offline  # pixiv に接続できない環境向け。干渉を再現したスタブページ(e2e/stub/pixiv.html)で同じテストを回す
npm run e2e:docker   # Docker で Linux 上の E2E を回す(Playwright 公式イメージ。ブラウザ同梱)
```

- `PLAYWRIGHT_BROWSERS_PATH` が外から設定されていればそれを使います(Playwright 公式イメージの `/ms-playwright` 等)。未設定ならプロジェクト内 `.playwright/browsers/`
- `E2E_OFFLINE=1` で www.pixiv.net への接続を一切行いません。`@live` テストもスキップされます
- `.devcontainer/devcontainer.json` は Playwright 公式イメージを使うので、Codespaces や VS Code の devcontainer では `npm run e2e` がそのまま動きます
- 実 pixiv へのログイン(`npm run e2e:login`)は画面が必要なので手元のマシンで行ってください。クラウドでは `e2e:offline` かモック API の `e2e` を使います

### Claude Code のクラウド実行で開発する場合

claude.ai/code の環境(Environment)設定に以下を入れます。セットアップスクリプトは**リポジトリが checkout される前**に
(作業ディレクトリも不定で)root で一度だけ実行されるため、リポジトリ内のファイルを直接参照できません。
そのため、OS パッケージと WebKit 本体の取得だけを自己完結型スクリプトで行い、`npm ci` などリポジトリ依存の処理は
`.claude/settings.json` の SessionStart フック(`scripts/session-start.sh`)が毎セッション行う構成にしています。

| 設定 | 値 |
|---|---|
| Setup script | `curl -fsSL https://raw.githubusercontent.com/karera09/pixiv-novelsearch-for-safari/main/scripts/cloud-setup.sh | bash`(1行) |
| Environment variables | `CI=1` と `PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright`。pixiv をネットワーク許可に入れない場合は `E2E_OFFLINE=1` も |
| Network access | Custom。Trusted の既定(npm / GitHub / raw.githubusercontent.com / Ubuntu apt)に加えて `cdn.playwright.dev`、`playwright.download.prss.microsoft.com`。online モードで検証するなら `www.pixiv.net`、`s.pximg.net` も |
| API 認証情報 | 不要。GitHub は Claude の GitHub App 経由で push / PR 作成できます。pixiv に API キーはありません |

- `PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright` は、セットアップスクリプトが WebKit を置く場所と `e2e/paths.js` を一致させるためのものです。
  スナップショットに含まれるので、2回目以降のセッションはダウンロード無しで `npm run e2e` が使えます
- `scripts/cloud-setup.sh` の `PW_VERSION` は `package.json` の `@playwright/test` と揃えてください(WebKit のリビジョンが版に紐づきます)
- セットアップスクリプトを変えたり許可ドメインを変えると、次の新規セッションでスクリプトが再実行されてスナップショットが作り直されます
- WebKit が無いセッションでは SessionStart フックがバックグラウンドで取得を始めます(`.playwright/install.log`)。完了まで `npm run e2e` は失敗します
- `.devcontainer/` はクラウド実行では読まれません(Codespaces / VS Code 用)
- pixiv のログイン状態(`.playwright/auth/pixiv.json`)はクラウドに持ち込まないでください。セッション Cookie はアカウント全体の権限を持ちます。
  実 pixiv 検証(`e2e:live`)は手元で行い、クラウドは `e2e:offline` / モック API の `e2e` を使う運用を推奨します

### 変更時のルール(抜粋)

- 機能変更時は `// @version` と `VERSION` 定数を両方上げる
- UI は Shadow DOM 内に閉じたまま。`document.body` 直下に要素を足さない
- `WAIT_MS` / `MAX_PAGES` / `PAGES_PER_BATCH` の安全弁は外さない

## 検証状況

内部 API のパラメータ(`s_mode=s_tc`、`original_only`、`work_lang`、ジャンルは `genre=<数値ID>`)は 2026-09-25 に実環境で確認済みです。
iPhone Safari 実機での最終確認と、残りの小項目は `HANDOVER.md` の「5. 未解決・要確認事項」を参照してください。
