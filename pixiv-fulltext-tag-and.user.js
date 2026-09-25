// ==UserScript==
// @name         pixiv 小説 本文検索×タグAND
// @namespace    local
// @version      1.0
// @description  本文全文検索の結果を、タグ条件(AND / NOT)でクライアント側フィルタして表示する
// @match        https://www.pixiv.net/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==
(() => {
  'use strict';

  // ---- 設定 ----
  const VERSION = '1.0';
  const PAGE_SIZE = 24;         // 「検索」「続きを探す」1回で揃えたい件数(表示単位。API は1ページ30件返す)
  const MAX_PAGES = 100;        // 1回の検索で本文検索を何ページまで掘るか(安全弁)
  const PAGES_PER_BATCH = 20;   // 1回のタップで掘るページ数の上限(追加の安全弁。ヒットが少ない条件で何分も走り続けない)
  const WAIT_MS   = 800;        // ページ取得間の待ち時間(連打防止)
  const FULLTEXT_MODE = 's_tc'; // 本文検索のs_mode(2026-09-25 実環境で確認済み)

  let sleep = ms => new Promise(r => setTimeout(r, ms)); // テストでは差し替え可能(下の __pxAndTestHook 参照)

  // 本文検索のクエリ(全文検索と同時に適用できるサーバー側フィルタ。2026-09-25 実環境で確認済み)
  //   mode: all / safe / r18   original_only: 1 で「オリジナル作品限定」
  //   genre: ジャンルの数値ID(1〜17。original_only=1 のときのみ)。スラッグ(contemporary_fantasy 等)を渡すと
  //          「例外エラーです」(HTTP 500)になる。ページ側URLのスラッグと内部APIの値形式は別物
  //   work_lang: 作品の言語     extra: Networkタブで見つけた任意のパラメータをそのまま追記
  const PARAM_ORIGINAL = 'original_only';
  const PARAM_GENRE = 'genre';
  // ジャンルID → 名前(PixivFE の genreMap。結果カードの表示にも使う)
  const GENRES = { 1: '恋愛', 2: '異世界ファンタジー', 3: '現代ファンタジー', 4: 'ミステリー', 5: 'ホラー', 6: 'SF', 7: '文学', 8: 'ドラマ', 9: '歴史・時代', 10: 'BL', 11: '百合', 12: 'キッズ', 13: '詩', 14: 'エッセイ・ノンフィクション', 15: '脚本・台本', 16: '評論・レビュー', 17: 'その他' };

  function buildSearchUrl(o, p) {
    const w = encodeURIComponent(o.text);
    const q = new URLSearchParams({ word: o.text, order: o.order, mode: o.mode, p, s_mode: FULLTEXT_MODE, lang: 'ja' });
    if (o.workLang) q.set('work_lang', o.workLang);
    if (o.original) {
      q.set(PARAM_ORIGINAL, '1');
      if (o.genre) q.set(PARAM_GENRE, o.genre);
    }
    let url = `https://www.pixiv.net/ajax/search/novels/${w}?${q}`;
    if (o.extra) url += '&' + o.extra.replace(/^[?&]+/, '');
    return url;
  }

  async function fetchJson(url, signal) {
    const res = await fetch(url, { credentials: 'include', headers: { accept: 'application/json' }, signal });
    try {
      return await res.json();
    } catch (e) {
      // HTML(ログイン切れ・アクセス制限ページ)が返ると JSON 解析で落ちるので、状況が分かる文言に言い換える
      if (res.status === 429) throw new Error('アクセスが多すぎると言われました(HTTP 429)。しばらく待ってから再試行してください');
      throw new Error(res.ok === false ? `HTTP ${res.status}(ログイン切れ・アクセス制限の可能性)` : '応答を読み取れませんでした(ログイン切れの可能性)');
    }
  }

  async function fetchFulltextPage(o, p, signal) {
    const json = await fetchJson(buildSearchUrl(o, p), signal);
    // ※以前はジャンル指定でエラーになったらパラメータ名の候補を順に試していたが、未知の名前(genres 等)は
    //   サーバーに無視されて「絞り込みなしで成功」してしまうため廃止した。エラーはそのまま伝える
    if (json.error) throw new Error(json.message || 'pixiv API error');
    return json.body.novel; // { data: [...], total: N, ... }
  }

  // タグ判定: fuzzy=true なら部分一致(大文字小文字無視)、false なら完全一致
  function hasTag(novel, t, fuzzy) {
    const tags = Array.isArray(novel.tags) ? novel.tags : [];
    if (!fuzzy) return tags.includes(t);
    const q = t.toLowerCase();
    return tags.some(tag => String(tag).toLowerCase().includes(q));
  }
  const matchTags = (novel, must, not, fuzzy) =>
    must.every(t => hasTag(novel, t, fuzzy)) && !not.some(t => hasTag(novel, t, fuzzy));

  // 検索状態(中断・再開・「続きを探す」のためカーソルを持つ)
  //   p: 次に取るページ  done: 終端  capped: MAX_PAGES で打ち切り  stop: ユーザー中断  budget: PAGES_PER_BATCH で一時停止
  let state = null;
  let abortCtrl = null;

  // 次のバッチを集める。ヒットは見つけ次第 onHit で即描画するので、中断しても途中結果は残る。
  // log はページを取るたびに呼ぶ(進捗表示用)
  async function collectBatch(onHit, log) {
    let got = 0, pages = 0;
    state.stop = false; state.budget = false;
    while (got < PAGE_SIZE && !state.done && !state.stop) {
      if (state.p > MAX_PAGES) { state.done = true; state.capped = true; break; }
      if (pages >= PAGES_PER_BATCH) { state.budget = true; break; }
      log();
      abortCtrl = new AbortController();
      let page;
      try {
        page = await fetchFulltextPage(state, state.p, abortCtrl.signal);
      } catch (e) {
        if (e.name === 'AbortError') break; // 中断: p を進めずに抜ける(再開時に同じページから)
        throw e;
      } finally { abortCtrl = null; }

      // 総ページ数は1ページ目の total と 1ページあたり件数から算出
      if (state.totalPages == null) {
        const per = page.data.length || 1;
        state.per = per;
        state.total = page.total ?? 0;
        state.totalPages = Math.max(1, Math.ceil(state.total / per));
      }
      for (const n of page.data) {
        if (state.seen.has(n.id)) continue;
        state.seen.add(n.id);
        if (matchTags(n, state.must, state.not, state.fuzzy)) { state.found++; got++; onHit(n); }
      }
      if (page.data.length === 0) state.done = true;
      state.p++; pages++;
      // 終端判定はここで行い、最終ページの後に余分な待機を入れない
      if (state.totalPages != null && state.p > state.totalPages) state.done = true;
      else if (state.p > MAX_PAGES) { state.done = true; state.capped = true; }
      log();
      if (got < PAGE_SIZE && !state.done && !state.stop && pages < PAGES_PER_BATCH) await sleep(WAIT_MS);
    }
  }

  // ---- ページ判定(入口のタブを小説関連ページだけに出す) ----
  // u は URL オブジェクト。/en/ 付きも同じ扱い
  function isNovelContext(u) {
    const p = u.pathname.replace(/^\/en(?=\/)/, '');
    if (/^\/novel\/show\.php/.test(p)) return false;          // 読書中は出さない
    if (/^\/novel(\/|$)/.test(p)) return true;                  // 小説トップ・ランキング・シリーズ等
    if (/^\/tags\/[^/]+\/novels/.test(p)) return true;          // タグ/本文検索の小説タブ
    if (/^\/users\/\d+\/novels/.test(p)) return true;
    if (/^\/search(\.php)?$/.test(p)) return /novel/.test(u.searchParams.get('type') || '');
    return false;
  }
  // 検索結果ページの語を取り出す。本文検索(s_tc / text)なら本文語、タグ検索なら必須タグとして提案する
  function pageContext(u) {
    const m = u.pathname.match(/^(?:\/en)?\/tags\/([^/]+)\/novels/);
    let word = '';
    try { word = m ? decodeURIComponent(m[1]) : (/^(?:\/en)?\/search/.test(u.pathname) ? (u.searchParams.get('word') || '') : ''); } catch { return null; }
    if (!word) return null;
    const sm = u.searchParams.get('s_mode') || '';
    return { word, fulltext: sm === 's_tc' || sm === 'text' };
  }

  // ---- 保存(localStorage。失敗しても動くように全部 try/catch) ----
  // 注意: pixiv と同じオリジンの領域なので pixiv 側のスクリプトからも読める。設定で保存しない選択も用意している
  const LS = {
    get(k, d) { try { const v = localStorage.getItem('pxAnd:v1:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('pxAnd:v1:' + k, JSON.stringify(v)); } catch { /* 容量超過・プライベート等 */ } },
    del(k) { try { localStorage.removeItem('pxAnd:v1:' + k); } catch { } },
  };
  const prefs = Object.assign({ show: 'novel', saveHistory: true }, LS.get('prefs', {}));

  // ---- UI ----
  // Shadow DOM に閉じ込めて、pixiv側のCSS(input の文字色など)とキーボードイベント処理の影響を受けないようにする。
  // ブラウザ以外(Node の単体テストハーネス)では location / addEventListener 等が無いので、起動時の処理は BROWSER で守る
  const BROWSER = typeof location !== 'undefined' && typeof addEventListener === 'function';
  const host = document.createElement('div');
  host.id = 'pxAndHost';
  host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;';
  const root = host.attachShadow({ mode: 'open' });

  // ダーク配色。OS の設定に従うが、pixiv 側の背景色が分かるときはそちらを優先する(applyTheme)
  const DARK = '--bg:#1c1c1e;--bg2:#2c2c2e;--fg:#f2f2f7;--sub:#a1a1a8;--mute:#75757c;--line:#38383c;--chip:#12314b;--chipfg:#8fcbff;--ng:#45201f;--ngfg:#ff9d99;--shadow:rgba(0,0,0,.6)';
  const css = `
  :host{all:initial;--ac:#0096fa;--bg:#fff;--bg2:#f4f4f6;--fg:#1f1f1f;--sub:#6b6b70;--mute:#9a9aa0;--line:#e5e5ea;--chip:#e8f4fe;--chipfg:#0a6cb4;--ng:#fdeceb;--ngfg:#c23b37;--danger:#e0524f;--warn:#e8930c;--r18:#ff4060;--shadow:rgba(0,0,0,.22)}
  @media (prefers-color-scheme:dark){:host(:not([data-theme=light])){${DARK}}}
  :host([data-theme=dark]){${DARK}}
  *{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans","Helvetica Neue",Arial,sans-serif;-webkit-tap-highlight-color:transparent}
  button{touch-action:manipulation;cursor:pointer;font:inherit;color:inherit}
  [hidden]{display:none !important}

  /* 入口: 右端のエッジタブ(判定 36x72、見た目 18x64)。下スクロール中は引っ込む */
  #pxAndBtn{position:fixed;right:0;top:68%;width:36px;height:72px;padding:0;margin:0;border:0;background:transparent;transition:transform .25s,opacity .25s}
  #pxAndBtn .grip{position:absolute;right:0;top:4px;bottom:4px;width:18px;border-radius:9px 0 0 9px;background:var(--ac);opacity:.8;box-shadow:-1px 1px 5px var(--shadow);display:flex;align-items:center;justify-content:center}
  #pxAndBtn .gl{writing-mode:vertical-rl;color:#fff;font-size:9.5px;font-weight:700;letter-spacing:.5px}
  #pxAndBtn.tuck{transform:translateX(12px);opacity:.35}
  #pxBadge{position:absolute;right:10px;top:-6px;min-width:20px;height:20px;border-radius:10px;background:#ff3b5c;color:#fff;font-size:11px;font-weight:700;line-height:20px;text-align:center;padding:0 5px;box-shadow:0 1px 3px var(--shadow)}
  #pxBadge.run{animation:pxPulse 1.1s ease-in-out infinite}
  @keyframes pxPulse{50%{transform:scale(1.18)}}

  /* パネル: 固定ヘッダー / スクロール領域 / 固定フッターの3段 */
  #pxAndPanel{position:fixed;inset:0;display:none;flex-direction:column;background:var(--bg);color:var(--fg);font-size:15px;line-height:1.4}
  #pxAndPanel.open{display:flex;animation:pxUp .22s ease-out}
  @keyframes pxUp{from{transform:translateY(24px);opacity:.3}}
  .hd{flex:none;border-bottom:1px solid var(--line);padding-top:env(safe-area-inset-top);background:var(--bg)}
  .bar{display:flex;align-items:center;height:48px;padding:0 4px}
  .bar .ttl{flex:1;text-align:center;font-size:16px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .icon{min-width:72px;height:44px;border:0;background:none;color:var(--ac);font-size:16px;padding:0 10px;text-align:left}
  .icon:disabled{opacity:0}
  #pxClose{text-align:right;color:var(--sub);font-size:15px}
  #pxSummary{display:none;flex-wrap:nowrap;gap:6px;padding:0 14px 10px;border:0;background:none;width:100%;text-align:left;overflow-x:auto;scrollbar-width:none}
  #pxSummary::-webkit-scrollbar{display:none}
  #pxSummary .chip{flex:none;height:26px;font-size:12.5px}
  [data-view=results] #pxSummary{display:flex}
  #pxProgress{height:3px;display:none;background:var(--bg2)} [data-view=results] #pxProgress{display:block}
  #pxProgress i{display:block;height:100%;width:0;background:var(--ac);transition:width .3s}
  [data-state=done] #pxProgress i{background:var(--sub)}
  [data-state=limit] #pxProgress i,[data-state=budget] #pxProgress i{background:var(--warn)}
  [data-state=error] #pxProgress i{background:var(--danger)}

  .body{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain}
  #pxForm,#pxResults{display:none}
  [data-view=form] #pxForm{display:block} [data-view=results] #pxResults{display:block}
  #pxForm{padding:14px 16px 28px}
  .f{margin:0 0 14px}
  .lbl{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:baseline;gap:2px 8px;font-size:13px;color:var(--sub);margin:0 0 6px;font-weight:600}
  .lbl small{font-weight:400;font-size:12px;color:var(--mute)}
  #pxAndPanel input[type=search],#pxAndPanel input[type=text]{display:block;width:100%;height:46px;margin:0;padding:0 12px;border:1px solid var(--line);border-radius:10px;font-size:16px;background:var(--bg2);color:var(--fg);-webkit-text-fill-color:var(--fg);-webkit-appearance:none;appearance:none;opacity:1;outline:none}
  #pxAndPanel input:focus{border-color:var(--ac);background:var(--bg)}
  #pxAndPanel input::placeholder{color:var(--mute);-webkit-text-fill-color:var(--mute);opacity:1}
  #pxAndPanel input.mono{font-family:ui-monospace,Menlo,monospace;font-size:16px}
  /* 設定行: 左にラベル、右にスイッチ or 選択欄(iOS の設定画面風) */
  .rows{border-top:1px solid var(--line);margin:0 -16px;padding:0 16px}
  .row{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:52px;border-bottom:1px solid var(--line)}
  .row>span,.row>label{flex:1;min-width:0;font-size:15px;color:var(--fg);display:flex;flex-direction:column;line-height:1.3}
  .row small{margin:2px 0 0;font-size:12px;color:var(--mute)}
  .row.off>span{color:var(--mute)}
  .sel{position:relative;flex:none;max-width:60%}
  .sel select{min-height:44px;max-width:100%;padding:6px 26px 6px 8px;border:0;background:transparent;color:var(--sub);-webkit-text-fill-color:var(--sub);font-size:16px;-webkit-appearance:none;appearance:none;text-align:right;opacity:1;outline:none}
  .sel select:disabled{color:var(--mute);-webkit-text-fill-color:var(--mute)}
  .sel::after{content:"";position:absolute;right:8px;top:50%;width:6px;height:6px;pointer-events:none;border-right:2px solid var(--mute);border-bottom:2px solid var(--mute);transform:translateY(-75%) rotate(45deg)}
  input[type=checkbox].sw{-webkit-appearance:none;appearance:none;flex:none;width:51px;height:31px;margin:0;border:0;border-radius:999px;background:var(--line);position:relative;transition:background .2s;opacity:1}
  input[type=checkbox].sw::before{content:"";position:absolute;top:2px;left:2px;width:27px;height:27px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.3);transition:transform .2s}
  input[type=checkbox].sw:checked{background:var(--ac)}
  input[type=checkbox].sw:checked::before{transform:translateX(20px)}
  .chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
  .chips:empty{display:none}
  .chip{display:inline-flex;align-items:center;height:28px;padding:0 10px;border-radius:14px;background:var(--chip);color:var(--chipfg);font-size:13px;font-weight:600;border:0;white-space:nowrap}
  .chip.ng{background:var(--ng);color:var(--ngfg)}
  .chip.w{background:var(--fg);color:var(--bg)}
  .chip.o{background:var(--bg2);color:var(--sub);font-weight:400}
  #pxPreset{display:flex;align-items:center;gap:8px;margin:0 0 14px;padding:8px 8px 8px 12px;background:var(--chip);border-radius:10px;font-size:13px;color:var(--chipfg)}
  #pxPreset span{flex:1;min-width:0}
  #pxPreset button{flex:none;border:0;background:var(--ac);color:#fff;border-radius:16px;height:32px;padding:0 14px;font-size:13px;font-weight:700}
  details.sec{border-top:1px solid var(--line);margin:6px -16px 0;padding:0 16px}
  details.sec>summary{list-style:none;display:flex;align-items:center;min-height:50px;font-size:15px;font-weight:600;color:var(--fg)}
  details.sec>summary::-webkit-details-marker{display:none}
  details.sec>summary::after{content:'';width:8px;height:8px;border-right:2px solid var(--sub);border-bottom:2px solid var(--sub);transform:rotate(-45deg);margin-left:auto;transition:transform .2s}
  details.sec[open]>summary::after{transform:rotate(45deg)}
  details.sec>summary .cnt{margin-left:8px;font-size:12px;font-weight:600;color:var(--chipfg);background:var(--chip);border-radius:10px;padding:1px 8px}
  details.sec .inner{padding:2px 0 14px}
  .hint{font-size:12px;color:var(--sub);margin-top:4px;line-height:1.5}
  #pxHistory button{display:block;width:100%;text-align:left;min-height:44px;border:0;border-bottom:1px solid var(--line);background:none;color:var(--fg);font-size:14px;padding:10px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  #pxHistory .p{color:var(--chipfg)} #pxHistory .n{color:var(--ngfg)}
  .linkbtn{border:0;background:none;color:var(--ac);font-size:13px;padding:6px 0;min-height:32px}
  .ver{margin-top:18px;font-size:11px;color:var(--mute);text-align:center}
  code.k{font-family:ui-monospace,Menlo,monospace;font-size:11px;word-break:break-all;color:var(--sub)}

  /* 結果カード */
  .item{padding:10px 16px;border-bottom:1px solid var(--line)}
  .item a{display:block;color:inherit;text-decoration:none}
  .item .g{font-size:11.5px;color:var(--mute);display:flex;flex-wrap:wrap;gap:4px 6px;align-items:center;margin-bottom:2px}
  .item .g:empty{display:none}
  .b{font-weight:700;font-size:11px;line-height:18px;padding:0 6px;border-radius:4px}
  .b-r18{background:var(--r18);color:#fff} .b-ai{background:var(--bg2);color:var(--sub)}
  .item .t{font-size:16px;font-weight:700;line-height:1.35;color:var(--fg);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
  .item a:visited .t{color:var(--sub)}
  .item .ser{font-size:12.5px;color:var(--chipfg);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px}
  .item .m{font-size:12.5px;color:var(--sub);margin-top:3px;display:flex;flex-wrap:wrap;gap:0 10px;font-variant-numeric:tabular-nums}
  .tags{display:flex;flex-wrap:nowrap;gap:6px;margin-top:7px;overflow:hidden;-webkit-mask-image:linear-gradient(90deg,#000 88%,transparent)}
  .tag{flex:none;height:26px;padding:0 9px;border-radius:13px;border:0;background:var(--bg2);color:var(--sub);font-size:12px;white-space:nowrap}
  .tag.hit{background:var(--chip);color:var(--chipfg);font-weight:700}
  .tag.ng{background:var(--ng);color:var(--ngfg)}
  #pxEnd{padding:18px 16px 28px;text-align:center;color:var(--sub);font-size:13.5px;line-height:1.5}
  #pxEnd .big{font-size:16px;color:var(--fg);font-weight:700;margin-bottom:6px}
  #pxEnd .big.err{color:var(--danger)}
  .spin{display:inline-block;width:14px;height:14px;border:2px solid var(--line);border-top-color:var(--ac);border-radius:50%;animation:pxSpin .8s linear infinite;vertical-align:-2px;margin-right:6px}
  @keyframes pxSpin{to{transform:rotate(360deg)}}
  #pxDebug{margin-top:14px;text-align:left;font-size:12px}
  #pxDebug summary{color:var(--mute);min-height:28px;line-height:28px}
  #pxDebug code{display:block;word-break:break-all;margin-top:4px;padding:6px 8px;border-radius:6px;background:var(--bg2);color:var(--sub);font:11px/1.4 ui-monospace,Menlo,monospace}

  /* 下部固定の操作バー: 左に状態(2行)、右に状態ごとの主ボタンを1つだけ */
  #pxFooter{flex:none;display:flex;align-items:center;gap:12px;padding:10px 16px max(12px, env(safe-area-inset-bottom));border-top:1px solid var(--line);background:var(--bg)}
  #pxLog{flex:1;min-width:0}
  #pxLog b{display:block;font-size:15px;font-weight:700;line-height:1.3;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  #pxLog span{display:block;font-size:12px;line-height:1.4;color:var(--sub);font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  #pxLog b.err{color:var(--danger)} #pxLog b.warn{color:var(--warn)}
  .primary{display:none;flex:none;min-width:104px;height:48px;padding:0 22px;border:0;border-radius:24px;background:var(--ac);color:#fff;font-size:16px;font-weight:700}
  .primary:disabled{opacity:.45}
  .primary.danger{background:var(--ng);color:var(--ngfg)}
  .primary.sub{background:var(--bg2);color:var(--ac)}
  [data-view=form] #pxRun{display:block}
  [data-view=results][data-state=running] #pxStop,
  [data-view=results][data-state=paused] #pxMore,[data-view=results][data-state=budget] #pxMore,[data-view=results][data-state=stopped] #pxMore,[data-view=results][data-state=error] #pxMore,
  [data-view=results][data-state=done] #pxEdit,[data-view=results][data-state=limit] #pxEdit{display:block}
  #pxAndPanel.kb #pxFooter{display:none}

  /* タグのアクションシート */
  #pxSheet{position:absolute;inset:0;background:rgba(0,0,0,.35);display:flex;align-items:flex-end}
  #pxSheet .sh{width:100%;background:var(--bg);border-radius:16px 16px 0 0;padding:10px 16px max(16px, env(safe-area-inset-bottom));animation:pxUp .2s ease-out}
  #pxSheet .sht{text-align:center;font-weight:700;padding:8px 0 12px;color:var(--fg);word-break:break-all}
  #pxSheet button{display:block;width:100%;height:48px;margin:0 0 8px;border:0;border-radius:12px;background:var(--bg2);color:var(--fg);font-size:16px}
  #pxSheet button[data-a=must]{color:var(--chipfg);font-weight:700}
  #pxSheet button[data-a=not]{color:var(--ngfg);font-weight:700}
  `;
  root.innerHTML = `<style>${css}</style>
    <button id="pxAndBtn" type="button" aria-label="本文×タグ検索を開く" hidden><span class="grip"><span class="gl">本文×タグ</span></span><span id="pxBadge" hidden></span></button>
    <div id="pxAndPanel" role="dialog" aria-modal="true" data-view="form" data-state="idle">
      <div class="hd">
        <div class="bar">
          <button id="pxBack" class="icon" type="button"></button>
          <div class="ttl" id="pxTitle">本文×タグ検索</div>
          <button id="pxClose" class="icon" type="button">閉じる</button>
        </div>
        <button id="pxSummary" type="button" aria-label="条件を変更"></button>
        <div id="pxProgress"><i></i></div>
      </div>
      <form id="pxForm" class="body" autocomplete="off" novalidate>
        <div id="pxPreset" hidden><span></span><button type="button" id="pxPresetUse">使う</button></div>
        <div class="f"><div class="lbl">本文に含む語</div>
          <input id="pxText" type="search" enterkeyhint="search" placeholder="例: 雨の日" autocomplete="off"></div>
        <div class="f"><div class="lbl">必須タグ <small>スペース区切り・すべて含む</small></div>
          <input id="pxMust" type="search" enterkeyhint="search" placeholder="例: オリジナル 百合" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false">
          <div class="chips" id="pxMustChips"></div></div>
        <div class="f"><div class="lbl">除外タグ <small>1つでも含めば除外</small></div>
          <input id="pxNot" type="search" enterkeyhint="search" placeholder="例: R-18" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false">
          <div class="chips" id="pxNotChips"></div></div>
        <div class="rows">
          <label class="row"><span>タグを部分一致で探す<small>「百合」で「創作百合」も対象。大文字小文字も無視</small></span><input type="checkbox" class="sw" id="pxFuzzy"></label>
          <div class="row"><span>並び順</span><div class="sel"><select id="pxOrder">
            <option value="date_d">新しい順</option>
            <option value="date">古い順</option>
            <option value="popular_d">人気順(プレミアム)</option>
            <option value="popular_male_d">男性に人気(プレミアム)</option>
            <option value="popular_female_d">女性に人気(プレミアム)</option>
          </select></div></div>
        </div>
        <details id="pxOpts" class="sec"><summary>詳細条件<span class="cnt" id="pxOptCnt" hidden></span></summary>
          <div class="inner">
            <div class="hint" style="margin:0 0 6px">ここの条件は pixiv 側の本文検索に渡すので、走査するページ数そのものが減ります。</div>
            <div class="rows">
              <div class="row"><span>年齢制限</span><div class="sel"><select id="pxMode"><option value="all">すべて</option><option value="safe">全年齢のみ</option><option value="r18">R-18のみ</option></select></div></div>
              <label class="row"><span>オリジナル作品に限定</span><input type="checkbox" class="sw" id="pxOriginal"></label>
              <div class="row" id="pxGenreRow"><span>ジャンル<small>オリジナル限定時のみ</small></span><div class="sel"><select id="pxGenre">
                <option value="">すべてのジャンル</option>
                <option value="1">恋愛</option>
                <option value="2">異世界ファンタジー</option>
                <option value="3">現代ファンタジー</option>
                <option value="4">ミステリー</option>
                <option value="5">ホラー</option>
                <option value="6">SF</option>
                <option value="7">文学</option>
                <option value="8">ドラマ</option>
                <option value="9">歴史・時代</option>
                <option value="10">BL</option>
                <option value="11">百合</option>
                <option value="12">キッズ</option>
                <option value="13">詩</option>
                <option value="14">エッセイ・ノンフィクション</option>
                <option value="15">脚本・台本</option>
                <option value="16">評論・レビュー</option>
                <option value="17">その他</option>
              </select></div></div>
              <div class="row"><span>作品の言語</span><div class="sel"><select id="pxLang"><option value="">指定なし</option><option value="ja">日本語</option><option value="en">英語</option><option value="zh">中国語(簡体)</option><option value="zh_tw">中国語(繁体)</option><option value="ko">韓国語</option></select></div></div>
            </div>
            <div class="f" style="margin-top:14px"><div class="lbl">追加パラメータ <small>上級者向け</small></div>
              <input id="pxExtra" type="text" class="mono" placeholder="例: tlt=5000&tgt=20000" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false">
              <div class="hint">Network タブで見つけたクエリをそのまま追記します(key=value&amp;key2=value2)。</div></div>
          </div></details>
        <details id="pxHistSec" class="sec" open><summary>最近の検索</summary>
          <div class="inner"><div id="pxHistory"></div><button type="button" class="linkbtn" id="pxHistClear">履歴を消去</button></div></details>
        <details id="pxPrefs" class="sec"><summary>設定</summary>
          <div class="inner">
            <div class="rows">
              <div class="row"><span>入口のタブを出す場所</span><div class="sel"><select id="pxShow"><option value="novel">小説のページだけ</option><option value="always">pixiv の全ページ</option><option value="manual">出さない</option></select></div></div>
              <label class="row"><span>検索条件と履歴をこの端末に保存<small>pixiv と同じ保存領域(localStorage)を使います</small></span><input type="checkbox" class="sw" id="pxSaveHist"></label>
            </div>
            <div class="hint">検索中や結果が残っている間は、どのページでもタブ(件数バッジ付き)が出ます。「出さない」にしたときは、URL の末尾に <code class="k">#pxand</code> を付けて開くか、ブックマークレット <code class="k">javascript:void dispatchEvent(new Event('pxand:open'))</code> で呼び出せます。</div>
          </div></details>
        <div class="ver">pixiv 小説 本文検索×タグAND v${VERSION}</div>
      </form>
      <div id="pxResults" class="body"><div id="pxList"></div><div id="pxEnd"></div></div>
      <div id="pxFooter">
        <div id="pxLog"></div>
        <button id="pxRun" class="primary" type="submit" form="pxForm">検索</button>
        <button id="pxStop" class="primary danger" type="button">止める</button>
        <button id="pxMore" class="primary" type="button">続きを探す</button>
        <button id="pxEdit" class="primary sub" type="button">条件を変える</button>
      </div>
      <div id="pxSheet" hidden><div class="sh"><div class="sht" id="pxSheetTitle"></div>
        <button type="button" data-a="must">必須タグに追加して再検索</button>
        <button type="button" data-a="not">除外タグに追加して再検索</button>
        <button type="button" data-a="cancel">キャンセル</button></div></div>
    </div>`;
  document.documentElement.appendChild(host);

  const $ = id => root.getElementById(id);
  const panel = $('pxAndPanel');
  const btn = $('pxAndBtn');
  // ページ側(pixivのReact)のグローバルなキー/入力/タッチハンドラにイベントを渡さない。
  // エッジタブも対象にするため、パネルではなく ShadowRoot で止める
  if (typeof root.addEventListener === 'function') {
    for (const ev of ['keydown', 'keyup', 'keypress', 'input', 'beforeinput', 'compositionstart', 'compositionupdate', 'compositionend', 'touchstart', 'touchmove', 'touchend', 'pointerdown', 'click', 'submit', 'change']) {
      root.addEventListener(ev, e => e.stopPropagation());
    }
  }

  const splitTags = s => s.trim().split(/\s+/).filter(Boolean);
  const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = n => Number(n || 0).toLocaleString('ja-JP');

  // ---- フォーム ⇔ 条件 ----
  const FIELDS = ['text', 'must', 'not', 'fuzzy', 'order', 'mode', 'original', 'genre', 'workLang', 'extra'];
  const ID = { text: 'pxText', must: 'pxMust', not: 'pxNot', fuzzy: 'pxFuzzy', order: 'pxOrder', mode: 'pxMode', original: 'pxOriginal', genre: 'pxGenre', workLang: 'pxLang', extra: 'pxExtra' };
  const BOOL = new Set(['fuzzy', 'original']);
  function readForm() {
    const o = {};
    for (const k of FIELDS) { const el = $(ID[k]); o[k] = BOOL.has(k) ? !!el.checked : String(el.value || '').trim(); }
    if (!o.original) o.genre = '';
    return o;
  }
  function writeForm(o) {
    for (const k of FIELDS) { if (!(k in o)) continue; const el = $(ID[k]); if (BOOL.has(k)) el.checked = !!o[k]; else el.value = o[k] ?? ''; }
    syncForm();
  }
  function optCount(o) { return [o.mode !== 'all', o.original, !!o.genre, !!o.workLang, !!o.extra].filter(Boolean).length; }
  function syncForm() {
    const chips = (s, cls) => splitTags(s).map(t => `<span class="chip ${cls}">${cls ? '−' : '+'}${escapeHtml(t)}</span>`).join('');
    $('pxMustChips').innerHTML = chips($('pxMust').value || '', '');
    $('pxNotChips').innerHTML = chips($('pxNot').value || '', 'ng');
    const orig = !!$('pxOriginal').checked;
    $('pxGenre').disabled = !orig;
    if (BROWSER) $('pxGenreRow').classList.toggle('off', !orig);
    const n = optCount(readForm());
    $('pxOptCnt').hidden = !n; $('pxOptCnt').textContent = `${n}件指定中`;
    $('pxRun').disabled = !String($('pxText').value || '').trim();
    updatePreset();
  }
  let composing = false;
  $('pxForm').addEventListener('compositionstart', () => { composing = true; });
  $('pxForm').addEventListener('compositionend', () => { composing = false; syncForm(); });
  $('pxForm').addEventListener('input', () => { if (!composing) syncForm(); });
  $('pxForm').addEventListener('change', syncForm);
  // キーボード表示中は下部バーを隠す(iOS ではキーボード表示中に固定要素が跳ねる。検索はキーボードの「検索」キーで)
  const vv = BROWSER ? globalThis.visualViewport : null;
  if (vv) vv.addEventListener('resize', () => panel.classList.toggle('kb', innerHeight - vv.height > 150));

  // 今いるページの語をフォームに提案する(タグページなら必須タグ、本文検索ページなら本文語)
  let presetCtx = null;
  function updatePreset() {
    const box = $('pxPreset');
    const ctx = presetCtx;
    if (!ctx) { box.hidden = true; return; }
    const field = ctx.fulltext ? 'pxText' : 'pxMust';
    const cur = ctx.fulltext ? String($('pxText').value || '').trim() : splitTags($('pxMust').value || '');
    const has = ctx.fulltext ? cur === ctx.word : cur.includes(ctx.word);
    box.hidden = has;
    if (!has) box.firstElementChild.innerHTML = ctx.fulltext ? `このページの検索語「<b>${escapeHtml(ctx.word)}</b>」を本文の語に` : `このページのタグ「<b>${escapeHtml(ctx.word)}</b>」を必須タグに`;
    box.dataset.field = field;
  }
  $('pxPresetUse').onclick = () => {
    const ctx = presetCtx; if (!ctx) return;
    if (ctx.fulltext) $('pxText').value = ctx.word;
    else { const cur = splitTags($('pxMust').value || ''); if (!cur.includes(ctx.word)) cur.push(ctx.word); $('pxMust').value = cur.join(' '); }
    syncForm();
  };

  const ORDER_LABEL = { date: '古い順', popular_d: '人気順', popular_male_d: '男性に人気', popular_female_d: '女性に人気' };
  function summaryHtml(o) {
    let h = `<span class="chip w">「${escapeHtml(o.text)}」</span>`;
    h += (Array.isArray(o.must) ? o.must : splitTags(o.must)).map(t => `<span class="chip">+${escapeHtml(t)}</span>`).join('');
    h += (Array.isArray(o.not) ? o.not : splitTags(o.not)).map(t => `<span class="chip ng">−${escapeHtml(t)}</span>`).join('');
    if (o.fuzzy) h += '<span class="chip o">部分一致</span>';
    if (ORDER_LABEL[o.order]) h += `<span class="chip o">${ORDER_LABEL[o.order]}</span>`;
    const n = optCount(o); if (n) h += `<span class="chip o">詳細 ${n}件</span>`;
    return h;
  }

  // ---- 履歴 ----
  const histLabel = o => `<b>${escapeHtml(o.text)}</b> ${splitTags(o.must).map(t => `<span class="p">+${escapeHtml(t)}</span>`).join(' ')} ${splitTags(o.not).map(t => `<span class="n">−${escapeHtml(t)}</span>`).join(' ')}`;
  function renderHistory() {
    const h = prefs.saveHistory ? LS.get('history', []) : [];
    $('pxHistSec').hidden = !h.length;
    $('pxHistory').innerHTML = h.map((o, i) => `<button type="button" data-i="${i}">${histLabel(o)}</button>`).join('');
  }
  function remember(o) {
    if (!prefs.saveHistory) return;
    LS.set('last', o);
    const key = JSON.stringify(o);
    const h = LS.get('history', []).filter(x => JSON.stringify(x) !== key);
    h.unshift(o); LS.set('history', h.slice(0, 8));
    renderHistory();
  }
  $('pxHistory').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    writeForm(LS.get('history', [])[Number(b.dataset.i)] || {}); // 条件に入れるだけ。検索は「検索」で
    $('pxForm').scrollTop = 0;
  });
  $('pxHistClear').onclick = () => { LS.del('history'); renderHistory(); };

  // ---- 画面と状態 ----
  // data-view: form(条件) / results(結果)
  // data-state: idle / running / paused(規定件数集まった) / budget(1回の上限ページ数) / stopped(ユーザー中断) /
  //             done(最後まで) / limit(MAX_PAGES 到達) / error
  let running = null;
  let lastError = '';
  function phase() {
    if (!state) return 'idle';
    if (running) return 'running';
    if (lastError) return 'error';
    if (state.done) return state.capped ? 'limit' : 'done';
    if (state.stop) return 'stopped';
    return state.budget ? 'budget' : 'paused';
  }
  function setView(v) {
    const prev = panel.dataset.view;
    panel.dataset.view = v;
    $('pxBack').textContent = v === 'results' ? '‹ 条件' : (state ? '‹ 結果' : '');
    $('pxBack').disabled = v === 'form' && !state;
    $('pxTitle').textContent = v === 'results' ? '検索結果' : '本文×タグ検索';
    if (v === 'form' && prev === 'results') $('pxForm').scrollTop = 0;
    updateStatus();
  }
  const statusHtml = (main, sub, cls = '') => `<b class="${cls}">${main}</b>${sub ? `<span>${sub}</span>` : ''}`;
  function updateStatus() {
    const ph = phase();
    panel.dataset.state = ph;
    const s = state;
    if (!s) { $('pxLog').innerHTML = statusHtml('未検索', '本文に含む語を入れて検索'); updateEntry(); return; }
    const lim = Math.min(s.totalPages ?? MAX_PAGES, MAX_PAGES);
    const scanned = Math.max(0, Math.min(s.p - 1, lim));
    $('pxProgress').firstElementChild.style.width = (ph === 'done' ? 100 : Math.round(scanned / lim * 100)) + '%';
    const hit = `${num(s.found)}件ヒット`;
    const pages = `${scanned}/${s.totalPages ?? '?'}ページ`;
    const checked = s.total != null ? `本文一致 ${num(s.seen.size)}/${num(s.total)}件確認` : '';
    if (panel.dataset.view === 'form') {
      $('pxLog').innerHTML = statusHtml('条件を変えて検索', `前回: ${hit}(「‹ 結果」で戻る)`);
    } else {
      const LOG = {
        running: [hit, `${s.p}/${s.totalPages ?? '?'}ページ目を確認中…`],
        paused: [hit, `${checked} · ${pages}`],
        budget: [`${hit} · ${PAGES_PER_BATCH}ページ見て一時停止`, `${checked} · ${pages}`, 'warn'],
        stopped: [`中断中 · ${hit}`, `${s.p}ページ目から再開できます · ${pages}`],
        done: [s.found ? `${hit} · すべて確認済み` : 'ヒットなし', `${checked}`],
        limit: [`${hit} · 上限${MAX_PAGES}ページで停止`, `${checked}`, 'warn'],
        error: [`エラー: ${escapeHtml(lastError)}`, `${s.p}ページ目で停止。結果はそのまま残っています`, 'err'],
      }[ph];
      $('pxLog').innerHTML = statusHtml(LOG[0], LOG[1], LOG[2]);
    }
    const url = escapeHtml(buildSearchUrl(s, Math.min(s.p, lim) || 1));
    const END = {
      running: `<span class="spin"></span>${s.p}ページ目を確認中…`,
      paused: `ここまで ${num(s.found)}件。「続きを探す」で次の約${PAGE_SIZE}件を探します`,
      budget: `<div class="big">一致が少ない条件です</div>${PAGES_PER_BATCH}ページ(${num(PAGES_PER_BATCH * (s.per || 30))}件)を確認して一旦止めました。続ける前に、年齢制限や詳細条件で本文検索側を絞ると速くなります`,
      stopped: `中断しました。「続きを探す」で ${s.p}ページ目から再開します`,
      done: s.found ? `<div class="big">最後まで探しました</div>本文検索 ${num(s.total)}件のうち、条件に合うのは ${num(s.found)}件でした`
        : s.total ? `<div class="big">条件に合う作品はありませんでした</div>本文検索 ${num(s.total)}件を確認しました。タグを減らすか「部分一致」を試してください`
          : `<div class="big">本文に「${escapeHtml(s.text)}」を含む作品が見つかりませんでした</div>語を短くするか、詳細条件を外してください`,
      limit: `<div class="big">${MAX_PAGES}ページで打ち切りました</div>アクセス過多を防ぐための上限です。本文の語や詳細条件で絞り込むか、並び順を「古い順」にして反対側から探してください`,
      error: `<div class="big err">エラー: ${escapeHtml(lastError)}</div>「再試行」で同じページから取り直します`,
    };
    $('pxEnd').innerHTML = (END[ph] || '') + `<details id="pxDebug"><summary>リクエスト URL(確認用)</summary><code>${url}</code><button type="button" class="linkbtn" id="pxCopyUrl">URL をコピー</button></details>`;
    $('pxMore').textContent = ph === 'error' ? '再試行' : ph === 'budget' ? '続けて探す' : '続きを探す';
    updateEntry();
  }

  function renderOne(n) {
    const el = document.createElement('div');
    el.className = 'item';
    const isHit = t => state.must.some(m => state.fuzzy ? t.toLowerCase().includes(m.toLowerCase()) : t === m);
    const all = Array.isArray(n.tags) ? n.tags.map(String) : [];
    const tags = [...all.filter(isHit), ...all.filter(t => !isHit(t))];
    const d = n.createDate ? String(n.createDate).slice(0, 10).replace(/-/g, '/') : '';
    const g = [];
    if (n.xRestrict) g.push(`<span class="b b-r18">${n.xRestrict >= 2 ? 'R-18G' : 'R-18'}</span>`);
    if (n.aiType === 2) g.push('<span class="b b-ai">AI</span>');
    const gn = [n.isOriginal ? 'オリジナル' : '', GENRES[n.genre] || ''].filter(Boolean).join('・');
    if (gn) g.push(`<span>${gn}</span>`);
    const mins = n.textCount ? Math.max(1, Math.round(n.textCount / 500)) : 0;
    el.innerHTML = `
      <a href="https://www.pixiv.net/novel/show.php?id=${encodeURIComponent(n.id)}" target="_blank" rel="noopener">
        <div class="g">${g.join('')}</div>
        <div class="t">${escapeHtml(n.title)}</div>
        ${n.seriesTitle ? `<div class="ser">シリーズ: ${escapeHtml(n.seriesTitle)}</div>` : ''}
        <div class="m"><span>${escapeHtml(n.userName)}</span><span>${num(n.textCount)}字${mins ? `(約${mins}分)` : ''}</span><span>♡${num(n.bookmarkCount)}</span>${d ? `<span>${d}</span>` : ''}</div>
      </a>
      <div class="tags">${tags.map(t => `<button type="button" class="tag${isHit(t) ? ' hit' : ''}" data-tag="${escapeHtml(t)}">#${escapeHtml(t)}</button>`).join('')}</div>`;
    $('pxList').appendChild(el);
  }

  // ---- 検索の実行 ----
  function stopNow() { if (state) state.stop = true; if (abortCtrl) abortCtrl.abort(); }
  async function step() {
    lastError = '';
    running = collectBatch(renderOne, updateStatus).catch(e => { lastError = e.message; });
    updateStatus();
    await running;
    running = null;
    $('pxStop').disabled = false; $('pxStop').textContent = '止める';
    updateStatus();
  }
  async function startSearch() {
    const o = readForm();
    if (!o.text) { try { $('pxText').focus(); } catch { } return; }
    if (running) { stopNow(); await running; }
    remember(o);
    state = { ...o, must: splitTags(o.must), not: splitTags(o.not), p: 1, per: null, total: null, totalPages: null, done: false, capped: false, stop: false, budget: false, found: 0, seen: new Set() };
    $('pxList').innerHTML = '';
    $('pxSummary').innerHTML = summaryHtml(o);
    try { root.activeElement && root.activeElement.blur(); } catch { }
    setView('results');
    $('pxResults').scrollTop = 0;
    await step();
  }
  $('pxForm').addEventListener('submit', e => { e.preventDefault(); startSearch(); });
  $('pxStop').onclick = () => { stopNow(); $('pxStop').disabled = true; $('pxStop').textContent = '止めています…'; };
  $('pxMore').onclick = () => { if (!running) step(); };
  $('pxEnd').addEventListener('click', async e => {
    const b = e.target.closest('#pxCopyUrl'); if (!b) return;
    const code = b.parentElement.querySelector('code');
    try { await navigator.clipboard.writeText(code.textContent); b.textContent = 'コピーしました'; }
    catch { b.textContent = 'コピーできませんでした(長押しで選択してください)'; }
  });
  $('pxEdit').onclick = $('pxSummary').onclick = () => setView('form');
  $('pxBack').onclick = () => setView(panel.dataset.view === 'results' ? 'form' : 'results');

  // 結果のタグをタップ → 必須/除外に追加して再検索
  let sheetTag = '';
  $('pxList').addEventListener('click', e => {
    const t = e.target.closest('button.tag'); if (!t) return;
    sheetTag = t.dataset.tag; $('pxSheetTitle').textContent = '#' + sheetTag; $('pxSheet').hidden = false;
  });
  $('pxSheet').addEventListener('click', e => {
    const a = e.target.dataset.a || (e.target === $('pxSheet') ? 'cancel' : ''); if (!a) return;
    $('pxSheet').hidden = true;
    if (a === 'cancel') return;
    const id = a === 'must' ? 'pxMust' : 'pxNot';
    const cur = splitTags($(id).value); if (!cur.includes(sheetTag)) cur.push(sheetTag);
    $(id).value = cur.join(' '); syncForm(); startSearch();
  });

  // ---- 開閉と入口 ----
  const isOpen = () => panel.classList.contains('open');
  // pixiv 側の背景色の明るさでライト/ダークを決める(pixiv 独自のダークテーマにも追従する)。取れなければ OS 設定に任せる
  function applyTheme() {
    try {
      const m = getComputedStyle(document.body).backgroundColor.match(/[\d.]+/g) || [];
      const [r, g, b, a = 1] = m.map(Number);
      if (m.length < 3 || a === 0) { delete host.dataset.theme; return; }
      host.dataset.theme = (r * 299 + g * 587 + b * 114) / 1000 < 128 ? 'dark' : 'light';
    } catch { }
  }
  function open() {
    applyTheme();
    presetCtx = BROWSER && isNovelContext(new URL(location.href)) ? pageContext(new URL(location.href)) : null;
    updatePreset();
    panel.classList.add('open');
    setView(state ? 'results' : 'form');
    if (!state && !$('pxText').value) try { $('pxText').focus(); } catch { }
  }
  function close() { panel.classList.remove('open'); updateEntry(); }
  $('pxClose').onclick = close;
  btn.onclick = () => open();

  // 入口のタブ: 表示設定に従う。検索中や結果が残っている間は、戻り道としてどのページでも出す(件数バッジ付き)
  function updateEntry() {
    if (!BROWSER) return;
    const active = !!state && (!!running || state.found > 0);
    const show = !isOpen() && (prefs.show === 'always' || (prefs.show === 'novel' && isNovelContext(new URL(location.href))) || active);
    btn.hidden = !show;
    const b = $('pxBadge');
    b.hidden = !active; b.textContent = state ? (state.found > 99 ? '99+' : String(state.found)) : '';
    b.classList.toggle('run', !!running);
  }

  // 設定
  $('pxShow').value = prefs.show;
  $('pxSaveHist').checked = prefs.saveHistory;
  $('pxShow').onchange = () => { prefs.show = $('pxShow').value; LS.set('prefs', prefs); updateEntry(); };
  $('pxSaveHist').onchange = () => { prefs.saveHistory = !!$('pxSaveHist').checked; LS.set('prefs', prefs); if (!prefs.saveHistory) { LS.del('history'); LS.del('last'); } renderHistory(); };

  // 起動時: 前回の条件を復元
  writeForm(prefs.saveHistory ? LS.get('last', {}) : {});
  renderHistory();

  if (BROWSER) {
    setView('form');
    // SPA 遷移への追従: pushState は隔離ワールドから捕まえられないことがあるので、URL の文字列比較で見張る
    let lastHref = '';
    const onRoute = () => {
      if (location.href === lastHref) return;
      lastHref = location.href;
      if (location.hash === '#pxand') { try { history.replaceState(history.state, '', location.pathname + location.search); } catch { } open(); }
      updateEntry();
    };
    setInterval(() => { if (!document.hidden) onRoute(); }, 800);
    addEventListener('popstate', onRoute);
    addEventListener('hashchange', onRoute);
    addEventListener('pxand:open', () => open());
    root.addEventListener('keydown', e => { if (e.key === 'Escape' && isOpen()) close(); }); // PC 用(パネル内のキー入力は ShadowRoot で止めているので root に付ける)
    // 下にスクロール中はタブを引っ込める
    let tuckTimer = null;
    addEventListener('scroll', () => { btn.classList.add('tuck'); clearTimeout(tuckTimer); tuckTimer = setTimeout(() => btn.classList.remove('tuck'), 900); }, { passive: true });
    onRoute();
  }

  // ---- テスト用フック ----
  // Node の単体テスト(test/)と E2E から内部関数を参照するためのもの。
  // ブラウザ実行時は globalThis.__pxAndTestHook が未定義なので何も起きない。
  if (typeof globalThis.__pxAndTestHook === 'function') {
    globalThis.__pxAndTestHook({
      VERSION, PAGE_SIZE, MAX_PAGES, PAGES_PER_BATCH, WAIT_MS, FULLTEXT_MODE, PARAM_GENRE, GENRES,
      buildSearchUrl, fetchFulltextPage, hasTag, matchTags, collectBatch, splitTags, isNovelContext, pageContext,
      getState: () => state,
      setState: s => { state = s; },
      abort: stopNow,
      setSleep: fn => { sleep = fn; },
      root, $,
    });
  }
})();
