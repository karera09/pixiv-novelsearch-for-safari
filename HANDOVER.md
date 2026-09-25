# 引き継ぎ資料: pixiv 小説「本文検索 × タグ AND」ユーザースクリプト

作成日: 2026-09-14 / 最終更新: 2026-09-25 / 現行バージョン: v0.9 (`pixiv-fulltext-tag-and.user.js`)

## 1. 目的

pixiv小説の **本文全文検索** の結果と **タグ条件(AND / NOT)** を組み合わせて検索したい。
pixiv本体は本文検索とタグ検索を同時に指定できないため、クライアント側で合成する。

利用環境は **iPhone Safari**。Macがないため Safari Web Extension は作れず、
App Store の「Userscripts」アプリ(Safari拡張)で `.user.js` として動かす方針。

## 2. 動作原理

1. pixiv内部API `/ajax/search/novels/{word}?...&s_mode=s_tc` で本文検索を1ページずつ取得
   (同一オリジンなのでログインCookieがそのまま乗る。認証処理は不要)
2. レスポンスの各作品に `tags` 配列が含まれるので、追加リクエストなしでタグ判定できる
3. 必須タグを全て含み、除外タグを含まない作品だけを描画
4. `PAGE_SIZE`(24)件集まるか、終端/上限/中断まで次ページを掘る
5. カーソル(`state.p`)を保持しているので「もっと読む」「中断→再開」は続きから

方向は「本文検索を回してタグで絞る」一択。逆(タグ検索→本文照合)は作品ごとに本文取得が必要で不可。

## 3. 実装済み機能 (v0.9)

- 本文語 / 必須タグ / 除外タグ(スペース区切り)
- タグあいまい検索(部分一致・大文字小文字無視)チェックボックス
- 並び順: date_d / date / popular_d / popular_male_d / popular_female_d (人気順はプレミアム限定)
- 検索オプション(サーバー側クエリに乗る): 年齢制限 `mode=all|safe|r18`、オリジナル限定 `original_only=1`、
  ジャンル `genre=<数値ID 1〜17>`(v0.9 で数値IDに修正)、作品言語 `work_lang`、追加パラメータ自由入力
- 総ページ数表示: 1ページ目の `total` ÷ 1ページあたり件数
- 中断(AbortController でfetchを切る。pは進めない)と再開
- ヒットは見つけ次第描画。ステータス欄と操作ボタンは結果リストの下
- 作品リンクは `target="_blank"`
- UIは Shadow DOM 内、`documentElement` 直下にマウント。パネル内のキー/入力/タッチ/クリック系イベントは
  `stopPropagation` でpixiv側(React)へ流さない  ← pixivのCSSと入力横取り対策
- バージョン表記(`VERSION` 定数、パネル見出しに表示)
- ステータス欄に実際のリクエストURLを常時表示(パラメータ検証用)
- エラー時はメッセージ + URL を表示

## 4. 開発中に踏んだ問題と対処

| 症状 | 原因 | 対処 |
|---|---|---|
| 入力欄に文字が表示されない | pixivのCSS(input文字色 / -webkit-text-fill-color)とReactのグローバル入力ハンドラ | Shadow DOM化 + stopPropagation + 色を明示 (v0.3) |
| 検索しても「全?件」で止まる | `state.p > state.totalPages` を totalPages が null の時点で評価(null→0) | null チェック追加 (v0.4) |
| ジャンル指定で「例外エラーです」 | 内部APIのジャンルパラメータ名が不明(と誤認) | 候補 `genre`→`gs`→`genres`→`novel_genre` を順に試す (v0.8, 未検証) |
| ジャンルを選んでもエラーにならないのに絞り込まれない | 上のフォールバックで `genres=<スラッグ>` に到達すると、サーバーが未知パラメータを無視して「絞り込みなし」で 200 を返す。実は名前は `genre` で正しく、値がスラッグではなく数値IDだった | フォールバック廃止、UI の選択肢を数値ID 1〜17 に差し替え (v0.9, 実環境で確認) |

## 5. 未解決・要確認事項

### 5-1. 内部APIのパラメータ — 解決済み(2026-09-25 実環境で確認)

Claude Code の内蔵ブラウザでユーザーが pixiv にログインした状態で、`/ajax/search/novels/` を直接叩き、
さらに `pixiv-fulltext-tag-and.user.js` 本体をページに注入して UI 経由でも確認した。

| 項目 | 結果 |
|---|---|
| エンドポイント | `/ajax/search/novels/{word}` のまま有効(新検索UIになっても変わっていない) |
| 本文検索の `s_mode` | `s_tc` で有効(ページ側の `s_mode=text` に対応) |
| `original_only=1` | 有効。件数が絞られる(例: 1,411,362 → 207,406) |
| `work_lang=ja` | 有効。件数が絞られる(例: 1,411,362 → 1,323,994) |
| ジャンルのパラメータ名 | `genre` で正しい |
| ジャンルの値形式 | **数値ID**。`genre=3` で現代ファンタジーに絞られる(207,406 → 22,542)。`genre=contemporary_fantasy` は HTTP 500「例外エラーです」 |
| `genres=<スラッグ>` 等の未知パラメータ | エラーにならず無視される(件数が original_only 単独と一致)。← v0.8 のフォールバックが「成功扱い」になっていた原因 |
| 1ページあたり件数 | **30件**(24ではない)。`PAGE_SIZE`(24)は表示単位なので実害なし。総ページ数は1ページ目の実件数から算出しているので正しく 30 で割られる |
| 作品オブジェクト | `genre`(数値ID文字列)と `isOriginal`(真偽値)を含む。クライアント側絞り込みにも使える |

ジャンルIDの対応表(PixivFE `genreMap`。`genre=3` のみ実環境で件数変化を確認、他は同表を信頼):
1 恋愛 / 2 異世界ファンタジー / 3 現代ファンタジー / 4 ミステリー / 5 ホラー / 6 SF / 7 文学 / 8 ドラマ /
9 歴史・時代 / 10 BL / 11 百合 / 12 キッズ / 13 詩 / 14 エッセイ・ノンフィクション / 15 脚本・台本 /
16 評論・レビュー / 17 その他。`0` は未設定。v0.8 の「男性向け/女性向け」は誤りだったので削除した。

未確認のまま残っている小項目:
- ページ側URLの `r=1` の意味
- `s_mode` の他の値(`s_tag_only` / `s_tag` / `s_tag_full`)は本スクリプトでは使わないので未確認
- `tlt`/`tgt`/`wlt`/`wgt`/`rlt`/`rgt`/`scd`/`ecd`/`ai_type` は OSS 調査ベースのまま(追加パラメータ欄で試せる)

### 5-1a. 公開OSSの調査で判明していたこと(2026-09-13, PixivBatchDownloader / PixivFE のソースより)
上記 5-1 の実環境確認で、以下の推測はすべて正しかったことが確定した。記録として残す。

- エンドポイントは `/ajax/search/novels/{word}` のまま
- `s_mode`: ページ側 `text` → API `s_tc`。`tag` → `s_tag_only`、`tag_tc` → `s_tag`、未指定 → `s_tag_full`
- `original_only=1`、`work_lang` 等はページ側と同名でそのまま API に渡る
- **`gs` はジャンルではない**。`gs=1` = 「シリーズでまとめて表示」。`csw=1` = 作者でまとめる
- 1ページあたりは 30件
- 各作品オブジェクトに `genre`(数値ID文字列)と `isOriginal` が含まれる
- `genre=contemporary_fantasy` の「例外エラーです」は値形式の不一致(API は数値IDを期待)

### 5-2. 動作未検証の項目
実環境で確認済み(2026-09-25):
- `work_lang` は内部APIでも有効
- 中断→再開: 中断時に `p` は進まず、再開で同じページから続く。`seen` による重複描画なし
  (注入テストで 37ページ走査 → 中断 → 再開 → 2ページ進んで seen が 60 増加、描画は PAGE_SIZE の 24 件で停止)
- Shadow DOM のパネル表示、ボタンの活性切替(検索/中断/もっと読む↔再開)、逐次描画、`WAIT_MS` の待機

未検証のまま:
- 人気順(プレミアム)の挙動(未加入時にエラーか丸められるか)
- iPhone Safari + Userscripts 実機での表示・タッチ操作(Claude Code の環境では PC Chrome 相当の内蔵ブラウザしか使えない)
- 最終ページ取得後にも `WAIT_MS` の待機が1回余分に入る(終端判定がループ先頭にあるため)。実害は800msの待ちだけ。
  直すなら `state.p++` の直後に `totalPages` 超過判定を入れる(test/collect.test.js の待機回数テストも更新すること)

### 5-3. Claude Code 環境での実環境検証手順(再現用)
※ 2026-09-25 以降は `npm run e2e:login` → `npm run e2e:live`(6章 (b))の方が再現性が高い。以下は内蔵ブラウザで手早く確認する場合の手順。
1. Claude Code の内蔵ブラウザで pixiv を開き、**ユーザー自身が**ログインする(Cookie は HttpOnly で、Claude 側で保存・再利用はできない)
2. Claude が `javascript_tool` でスクリプト本体を `(0,eval)(src)` で注入する。事前に
   `globalThis.__pxAndTestHook = h => { globalThis.__px = h }` を定義しておくと内部関数と Shadow DOM の `$` が取れる
3. pixiv ページから `http://127.0.0.1` への fetch は CSP で弾かれるので、ソースはツール引数に直接埋め込む
4. ログイン判定は `/ajax/user/extra`(`meta[name=global-data]` は新UIに無い)
5. `WAIT_MS` / `MAX_PAGES` はそのまま、走査は数十ページで「中断」して止める

## 6. 試験計画(Claude Code側でお願いしたいこと)

前提: pixivへの実リクエストにはログインCookieが必要。自動テストは
(a) fetch をモックした単体テスト、(b) 実ブラウザでの手動/半自動確認、の2層に分ける。

### (a) 単体テスト(Node, fetch モック) — 整備済み(`npm test`)
`test/` に Node 標準テストランナー(`node --test`)で実装済み。`test/harness.js` がスクリプト本体(IIFE)を
最小限の DOM スタブ上で `vm` 評価し、末尾の `__pxAndTestHook` から内部関数を取り出す(単一ファイル運用は維持)。
以下の項目はすべてカバー済み。追加時は同じ形式で `test/*.test.js` を足す。

- `matchTags`: 完全一致 / 部分一致 / 大文字小文字 / 除外優先
- `buildSearchUrl`: オプション組み合わせごとのクエリ生成、extra の先頭 `?&` 除去
- `collectBatch`:
  - totalPages 未確定時に1ページ目を取りに行くこと(v0.4のリグレッション)
  - PAGE_SIZE 到達で止まる / 終端(空ページ・totalPages 超過)で done
  - 中断(AbortError)で p が進まない、再開で同じページから
  - seen による重複排除
  - ジャンルは `genre=<数値ID>` で1回だけ叩き、エラー時はフォールバックせず即例外。UI の選択肢が数値ID 1〜17 であること(ソース検査)
- 上記のため、純粋関数部分をモジュールに切り出す(またはテスト時に IIFE を評価してグローバル公開)リファクタを検討

### (b) E2E テスト(Playwright WebKit / iPhone 15 相当) — 整備済み(`npm run e2e`)
Windows に Mac/iOS 実機が無くても、Safari と同系統の WebKit エンジンでタッチ操作まで検証できるようにした(2026-09-25)。
- 構成: `playwright.config.js`、`e2e/paths.js`(全出力を `.playwright/` に閉じる)、`e2e/cli.js`(npm scripts の入口)、
  `e2e/fixtures.js`(本番スクリプトを無改変で `addInitScript` 注入、検索 API のモック、Shadow DOM 用ヘルパー)、
  `e2e/ui.spec.js`(モック API。ログイン不要)、`e2e/live.spec.js`(`@live`。実 pixiv、ログイン状態が無ければスキップ)、
  `e2e/login.js`(ユーザーが WebKit ウィンドウでログインすると `storageState` を保存)
- `ui.spec.js` でカバー済み: ボタンがビューポート内 / タップでパネル開閉 / 入力保持と文字色(pixiv の CSS・React 干渉) /
  タグ AND・NOT フィルタと PAGE_SIZE までのページ掘り / ジャンル選択肢が数値ID・リクエストに `genre=<ID>`・フォールバック無し /
  スラッグ指定時のエラー表示(1リクエストで停止) / 中断→再開(p が進まない・重複なし・再開は新バッチ24件) /
  パネル内イベントが document へバブリングしない
- `live.spec.js` でカバー済み: ログイン有効 / `s_tc` で 30件・`genre`・`isOriginal` あり / `genre=3` で絞られ全件 genre "3" /
  スラッグは「例外エラーです」 / UI から検索して数ページで中断
- テスト側では `setSleep` で `WAIT_MS` の待ちだけ短縮している。本体の定数は無改変
- 限界: Userscripts 拡張そのもの、iOS 固有 UI(下部ツールバーとボタン位置の重なり、アドレスバー縮小時のビューポート)、
  iOS 版 WebKit との細かな差は検証できない。最終確認は実機
- Linux / クラウド対応(2026-09-25): CI(ubuntu-latest)で online / offline の両モードを実行。`E2E_OFFLINE=1` は pixiv に接続せず
  `e2e/stub/pixiv.html`(input の文字を透明にする CSS、document レベルのキー横取り、body 直下の定期再描画を再現)で同じ 8件を回す。
  `PLAYWRIGHT_BROWSERS_PATH` は外部指定を尊重(Playwright 公式イメージ / devcontainer)。`.gitattributes` で LF 統一。
  実 pixiv ログイン(`e2e:login`)は画面が必要なので手元のみ。クラウドでは offline / モック API で回す

### (c) 実環境確認(手動)
- 5-1 は解決済み。再確認が必要になったら 5-3 の手順(内蔵ブラウザ注入)か、`tools/probe-search-api.user.js` を使う。
  probe スクリプトは「ジャンルのパラメータ名×値形式の総当たり」等を一度に確認できる(結果は「コピー」で取り出す)
- PC Chrome/Firefox + Tampermonkey/Violentmonkey で同じ `.user.js` を読み込んで動作確認
  (`@match https://www.pixiv.net/*` はPC版にも当たる。ただしUIはモバイル向けの全画面パネル)
- iPhone Safari(Userscripts)での最終確認: 入力、スクロール、新規タブ、中断ボタンの反応

## 7. 配布・導入手順(iPhone)

1. App Store「Userscripts」をインストール → 設定 → Safari → 機能拡張 で有効化
2. Userscripts アプリで保存先フォルダ(iCloud Drive)を指定
3. `pixiv-fulltext-tag-and.user.js` をそのフォルダに置く(PCから iCloud 経由でも可)
4. pixiv を開くと右下に「本文×タグ」ボタン

## 8. 今後の要望候補(未着手)

- 文字数範囲指定(`tlt` / `tgt` らしいが未確認。現状は追加パラメータ欄で試せる)
- 検索条件の保存(Userscripts では `localStorage` が使える)
- 結果の並び替え/ブックマーク数フィルタ(クライアント側で可能)
- ページ内グリッドへの統合(現状は独立パネル。モバイル版UIが別物なので当面は独立のまま推奨)

## 9. コード構成(単一ファイル)

```
設定定数 (VERSION, PAGE_SIZE, MAX_PAGES, WAIT_MS, FULLTEXT_MODE, PARAM_ORIGINAL, PARAM_GENRE)
buildSearchUrl / fetchJson / fetchFulltextPage   … API呼び出し
hasTag / matchTags                                … タグ判定
state / collectBatch                              … 走査ループ(カーソル・中断・重複排除)
UI: Shadow DOM 構築, イベント隔離, renderOne, setBusy, statusText, run
```
