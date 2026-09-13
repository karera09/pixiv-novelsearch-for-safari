# 引き継ぎ資料: pixiv 小説「本文検索 × タグ AND」ユーザースクリプト

作成日: 2026-09-14 / 現行バージョン: v0.8 (`pixiv-fulltext-tag-and.user.js`)

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

## 3. 実装済み機能 (v0.8)

- 本文語 / 必須タグ / 除外タグ(スペース区切り)
- タグあいまい検索(部分一致・大文字小文字無視)チェックボックス
- 並び順: date_d / date / popular_d / popular_male_d / popular_female_d (人気順はプレミアム限定)
- 検索オプション(サーバー側クエリに乗る): 年齢制限 `mode=all|safe|r18`、オリジナル限定 `original_only=1`、
  ジャンル、作品言語 `work_lang`、追加パラメータ自由入力
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
| ジャンル指定で「例外エラーです」 | 内部APIのジャンルパラメータ名が不明 | 候補 `genre`→`gs`→`genres`→`novel_genre` を順に試す (v0.8, 未検証) |

## 5. 未解決・要確認事項 (最優先)

### 5-1. 内部APIのパラメータ名が未確定
ユーザー提供のページ側URL(PC版・新検索UI):
```
https://www.pixiv.net/search?q=test&s_mode=text&type=novel&work_lang=ja&original_only=1&genre=contemporary_fantasy&r=1
```
一方スクリプトが叩いている内部API(v0.8時点):
```
https://www.pixiv.net/ajax/search/novels/{word}?word=...&order=date_d&mode=r18&p=1&s_mode=s_tc&lang=ja&original_only=1&genre=contemporary_fantasy
```
→ このURLは「例外エラーです」を返した。`genre` を付けると落ちる。

確認すべきこと:
- 新検索UI(`/search?...&type=novel`)が実際に呼ぶ内部APIのURL(DevTools Networkで `ajax` フィルタ)。
  エンドポイント自体が `/ajax/search/novels/` から変わっている可能性がある
- 本文検索の `s_mode` の正しい値(`s_tc` と仮定。ページ側は `s_mode=text`)
- ジャンルのパラメータ名と、`original_only` の名前
- `r=1` の意味
- ジャンル値のスラッグ一覧(`contemporary_fantasy` は正しいと判明。他は推定):
  romance / isekai_fantasy / contemporary_fantasy / mystery / horror / sf / literature / drama /
  historical / bl / yuri / for_men / for_women / other
- 1ページあたり件数(24と仮定。`PAGE_SIZE` と総ページ数計算に影響)

### 5-1a. 公開OSSの調査で判明したこと(2026-09-13, PixivBatchDownloader / PixivFE のソースより)
実環境ではまだ未検証。`tools/probe-search-api.user.js` で確認する。

- エンドポイントは新検索UI(`/search?q=...&type=novel`)になっても `/ajax/search/novels/{word}` のまま
  (PixivBatchDownloader は 2026-02-10 改版後もこのURLを使用)
- `s_mode`: ページ側 `text` → API `s_tc`。`tag` → `s_tag_only`、`tag_tc` → `s_tag`、未指定 → `s_tag_full`
  → 本文検索を `s_tc` とした v0.8 の仮定は正しい
- `original_only=1`、`work_lang`、`tlt`/`tgt`(文字数)、`wlt`/`wgt`(単語数)、`rlt`/`rgt`(読了時間)、
  `scd`/`ecd`(投稿日)、`ai_type` はページ側と同名でそのまま API に渡る
- **`gs` はジャンルではない**。`gs=1` = 「シリーズでまとめて表示」。`csw=1` = 作者でまとめる。
  v0.8 のフォールバック候補 `gs` は誤り(有効な値をスラッグで渡しているので落ちるか無視される)
- 1ページあたりは **30件**(24ではない)。`PAGE_SIZE` は表示単位なので実害はないが、総ページ数の初期推定に使うなら 30
- 検索結果の各作品オブジェクトに **`genre`(数値ID文字列)と `isOriginal`(真偽値)** が含まれる
  → サーバー側パラメータが分からなくても、クライアント側でジャンル絞り込みが可能(最有力の回避策)
- ジャンルIDの対応表(PixivFE `genreMap`): 1 恋愛 / 2 異世界ファンタジー / 3 現代ファンタジー / 4 ミステリー / 5 ホラー /
  6 SF / 7 文学 / 8 ドラマ / 9 歴史・時代 / 10 BL / 11 百合 / 12 キッズ / 13 詩 / 14 エッセイ・ノンフィクション /
  15 脚本・台本 / 16 評論・レビュー / 17 その他。`0` は未設定。
  → v0.8 のジャンル一覧(男性向け/女性向け)は誤り。UI の選択肢もこの表に合わせて直す
- 仮説: `genre=contemporary_fantasy` で「例外エラーです」になるのは、パラメータ名は認識されているが
  値の形式が違う(API は数値ID `genre=3` を期待している)ため。未知のパラメータ名なら通常は無視されて落ちない

### 5-2. 動作未検証の項目
- 人気順(プレミアム)の挙動(未加入時にエラーか丸められるか)
- `work_lang` が内部APIでも有効か
- 中断→再開でページを二重取得/取りこぼししないか(seen Set で重複排除はしている)
- 最終ページ取得後にも `WAIT_MS` の待機が1回余分に入る(終端判定がループ先頭にあるため)。実害は800msの待ちだけ。
  直すなら `state.p++` の直後に `totalPages` 超過判定を入れる(test/collect.test.js の待機回数テストも更新すること)

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
  - ジャンルパラメータの候補フォールバック
- 上記のため、純粋関数部分をモジュールに切り出す(またはテスト時に IIFE を評価してグローバル公開)リファクタを検討

### (b) 実環境確認
- `tools/probe-search-api.user.js` を有効にして「自動プローブ実行」→ 出力をコピーして共有する。
  ジャンルのパラメータ名×値形式の総当たり、`s_mode`/`gs`/`r` の効果、1ページ件数、作品オブジェクトの `genre` 有無を一度に確認できる。
  「記録URL表示」で pixiv 本体がジャンル指定時に実際に叩いた API の URL も見られる
- PC Chrome/Firefox + Tampermonkey/Violentmonkey で同じ `.user.js` を読み込んで動作確認
  (`@match https://www.pixiv.net/*` はPC版にも当たる。ただしUIはモバイル向けの全画面パネル)
- Network タブで実URLを取得し、5-1 を解消する
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
設定定数 (VERSION, PAGE_SIZE, MAX_PAGES, WAIT_MS, FULLTEXT_MODE, PARAM_*)
buildSearchUrl / fetchJson / fetchFulltextPage   … API呼び出し
hasTag / matchTags                                … タグ判定
state / collectBatch                              … 走査ループ(カーソル・中断・重複排除)
UI: Shadow DOM 構築, イベント隔離, renderOne, setBusy, statusText, run
```
