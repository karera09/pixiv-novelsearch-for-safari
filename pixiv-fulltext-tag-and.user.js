// ==UserScript==
// @name         pixiv 小説 本文検索×タグAND
// @namespace    local
// @version      0.9
// @description  本文全文検索の結果を、タグ条件(AND / NOT)でクライアント側フィルタして表示する
// @match        https://www.pixiv.net/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==
(() => {
  'use strict';

  // ---- 設定 ----
  const VERSION = '0.9';
  const PAGE_SIZE = 24;     // 「検索」「もっと読む」1回で揃えたい件数(表示単位。API は1ページ30件返す)
  const MAX_PAGES = 100;    // 1回の検索で本文検索を何ページまで掘るか(安全弁)
  const WAIT_MS   = 800;    // ページ取得間の待ち時間(連打防止)
  const FULLTEXT_MODE = 's_tc'; // 本文検索のs_mode(2026-09-25 実環境で確認済み)

  let sleep = ms => new Promise(r => setTimeout(r, ms)); // テストでは差し替え可能(下の __pxAndTestHook 参照)

  // 本文検索のクエリ(全文検索と同時に適用できるサーバー側フィルタ。2026-09-25 実環境で確認済み)
  //   mode: all / safe / r18   original_only: 1 で「オリジナル作品限定」
  //   genre: ジャンルの数値ID(1〜17。original_only=1 のときのみ)。スラッグ(contemporary_fantasy 等)を渡すと
  //          「例外エラーです」(HTTP 500)になる。ページ側URLのスラッグと内部APIの値形式は別物
  //   work_lang: 作品の言語     extra: Networkタブで見つけた任意のパラメータをそのまま追記
  const PARAM_ORIGINAL = 'original_only';
  const PARAM_GENRE = 'genre';

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
    return res.json();
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
    if (!fuzzy) return novel.tags.includes(t);
    const q = t.toLowerCase();
    return novel.tags.some(tag => tag.toLowerCase().includes(q));
  }
  const matchTags = (novel, must, not, fuzzy) =>
    must.every(t => hasTag(novel, t, fuzzy)) && !not.some(t => hasTag(novel, t, fuzzy));

  // 検索状態(中断・再開・「もっと読む」のためカーソルを持つ)
  let state = null;
  let abortCtrl = null;

  // 次のバッチを集める。ヒットは見つけ次第 onHit で即描画するので、中断しても途中結果は残る
  async function collectBatch(onHit, log) {
    let got = 0;
    state.stop = false;
    while (got < PAGE_SIZE && !state.done && !state.stop) {
      if ((state.totalPages != null && state.p > state.totalPages) || state.p > MAX_PAGES) { state.done = true; break; }
      log(`本文検索 ${state.p} / ${state.totalPages ?? '?'}ページ目を取得中… (ヒット ${state.found}件)`);
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
        state.total = page.total ?? 0;
        state.totalPages = Math.max(1, Math.ceil(state.total / per));
      }
      for (const n of page.data) {
        if (state.seen.has(n.id)) continue;
        state.seen.add(n.id);
        if (matchTags(n, state.must, state.not, state.fuzzy)) { state.found++; got++; onHit(n); }
      }
      if (page.data.length === 0) state.done = true;
      state.p++;
      if (got < PAGE_SIZE && !state.done && !state.stop) await sleep(WAIT_MS);
    }
    if (state.totalPages != null && state.p > state.totalPages) state.done = true;
  }

  // ---- UI ----
  // Shadow DOM に閉じ込めて、pixiv側のCSS(input の文字色など)とキーボードイベント処理の影響を受けないようにする
  const host = document.createElement('div');
  host.id = 'pxAndHost';
  host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;';
  const root = host.attachShadow({ mode: 'open' });

  const css = `
  :host{all:initial}
  *{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Helvetica Neue",Arial,sans-serif}
  #pxAndBtn{position:fixed;right:12px;bottom:80px;background:#0096fa;color:#fff;border:0;border-radius:24px;padding:10px 14px;font-size:14px;box-shadow:0 2px 8px rgba(0,0,0,.3)}
  #pxAndPanel{position:fixed;inset:0;background:#fff;color:#222;overflow:auto;padding:12px 12px 40px;font-size:14px;display:none;-webkit-overflow-scrolling:touch}
  #pxAndPanel input,#pxAndPanel select{width:100%;padding:8px;margin:4px 0 8px;border:1px solid #ccc;border-radius:6px;font-size:16px;background:#fff;color:#222;-webkit-text-fill-color:#222;-webkit-appearance:none;appearance:none;opacity:1}
  #pxAndPanel label{display:block;color:#222}
  #pxAndPanel label.chk{display:flex;align-items:center;gap:6px;margin:4px 0 8px}
  #pxAndPanel label.chk input{width:auto;margin:0;-webkit-appearance:checkbox;appearance:checkbox}
  #pxAndPanel button{padding:8px 12px;margin-right:8px;border:0;border-radius:6px;background:#0096fa;color:#fff;font-size:14px}
  #pxAndPanel button:disabled{background:#bbb}
  #pxAndPanel button.gray{background:#888}
  #pxAndPanel button.red{background:#e0524f}
  #pxAndPanel .item{border-bottom:1px solid #eee;padding:8px 0}
  #pxAndPanel .item a{color:#0096fa;text-decoration:none;font-weight:bold}
  #pxAndPanel .meta{color:#666;font-size:12px}
  #pxAndPanel .tags{font-size:12px;color:#888}
  #pxFooter{margin-top:12px;padding-top:8px;border-top:2px solid #ddd}
  #pxLog{margin:8px 0;white-space:pre-wrap;word-break:break-all}
  `;
  root.innerHTML = `<style>${css}</style>
    <button id="pxAndBtn">本文×タグ</button>
    <div id="pxAndPanel">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <b>本文検索 × タグ AND <span class="meta">v${VERSION}</span></b><button id="pxClose" class="gray">閉じる</button>
      </div>
      <label>本文に含む語</label><input id="pxText" placeholder="例: 雨の日" autocomplete="off">
      <label>必須タグ(スペース区切り)</label><input id="pxMust" placeholder="例: オリジナル 百合" autocomplete="off">
      <label>除外タグ(スペース区切り)</label><input id="pxNot" placeholder="例: R-18" autocomplete="off">
      <label class="chk"><input type="checkbox" id="pxFuzzy">タグをあいまい検索(部分一致)</label>
      <label>並び順</label>
      <select id="pxOrder">
        <option value="date_d">新しい順</option>
        <option value="date">古い順</option>
        <option value="popular_d">人気順(プレミアム)</option>
        <option value="popular_male_d">男性に人気(プレミアム)</option>
        <option value="popular_female_d">女性に人気(プレミアム)</option>
      </select>
      <details id="pxOpts"><summary style="margin:4px 0 8px;color:#0096fa">検索オプション(全文検索と同時適用)</summary>
        <label>年齢制限</label>
        <select id="pxMode">
          <option value="all">すべて</option>
          <option value="safe">全年齢のみ</option>
          <option value="r18">R-18のみ</option>
        </select>
        <label class="chk"><input type="checkbox" id="pxOriginal">オリジナル作品限定</label>
        <label>ジャンル(オリジナル限定時のみ)</label>
        <select id="pxGenre">
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
        </select>
        <label>作品の言語</label>
        <select id="pxLang">
          <option value="">指定なし</option>
          <option value="ja">日本語</option>
          <option value="en">英語</option>
          <option value="zh">中国語(簡体)</option>
          <option value="zh_tw">中国語(繁体)</option>
          <option value="ko">韓国語</option>
        </select>
        <label>追加パラメータ(上級者向け: 例 tlt=5000&tgt=20000)</label>
        <input id="pxExtra" placeholder="key=value&key2=value2" autocomplete="off">
      </details>
      <button id="pxRun">検索</button>
      <div id="pxList"></div>
      <div id="pxFooter">
        <div id="pxLog" class="meta">未検索</div>
        <button id="pxMore" disabled>もっと読む</button>
        <button id="pxStop" class="red" disabled>中断</button>
      </div>
    </div>`;
  document.documentElement.appendChild(host);

  const panel = root.getElementById('pxAndPanel');
  const btn = root.getElementById('pxAndBtn');
  // ページ側(pixivのReact)のグローバルなキー/入力ハンドラにイベントを渡さない
  for (const ev of ['keydown', 'keyup', 'keypress', 'input', 'beforeinput', 'compositionstart', 'compositionupdate', 'compositionend', 'touchstart', 'touchmove', 'touchend', 'pointerdown', 'click']) {
    panel.addEventListener(ev, e => e.stopPropagation());
  }

  const $ = id => root.getElementById(id);
  const log = msg => { $('pxLog').textContent = msg; };
  const splitTags = s => s.trim().split(/\s+/).filter(Boolean);
  const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function renderOne(n) {
    const el = document.createElement('div');
    el.className = 'item';
    el.innerHTML = `
      <a href="https://www.pixiv.net/novel/show.php?id=${n.id}" target="_blank" rel="noopener">${escapeHtml(n.title)}</a>
      <div class="meta">${escapeHtml(n.userName)} / ${n.textCount}文字 / ♥${n.bookmarkCount}</div>
      <div class="tags">${n.tags.map(escapeHtml).join(' ')}</div>`;
    $('pxList').appendChild(el);
  }

  function setBusy(busy) {
    $('pxRun').disabled = busy;
    $('pxStop').disabled = !busy;
    $('pxMore').disabled = busy || !state || state.done;
    $('pxMore').textContent = state && state.stop ? '再開' : 'もっと読む';
  }

  function statusText() {
    const scanned = Math.min(state.p - 1, state.totalPages ?? state.p - 1);
    let s = `ヒット ${state.found}件 / 本文検索 ${scanned} / ${state.totalPages ?? '?'}ページ走査(全${state.total ?? '?'}件)`;
    if (state.done) s += ' — 終端';
    else if (state.stop) s += ' — 中断中(再開で続きから)';
    return s + '\nURL: ' + buildSearchUrl(state, 1);
  }

  async function run(reset) {
    if (reset) {
      const text = $('pxText').value.trim();
      if (!text) { log('本文の語を入力してください'); return; }
      state = {
        text,
        must: splitTags($('pxMust').value),
        not: splitTags($('pxNot').value),
        fuzzy: $('pxFuzzy').checked,
        order: $('pxOrder').value,
        mode: $('pxMode').value,
        original: $('pxOriginal').checked,
        genre: $('pxGenre').value,
        workLang: $('pxLang').value,
        extra: $('pxExtra').value.trim(),
        p: 1, total: null, totalPages: null, done: false, stop: false, found: 0, seen: new Set(),
      };
      $('pxList').innerHTML = '';
    }
    setBusy(true);
    try {
      await collectBatch(renderOne, log);
      log(statusText());
    } catch (e) {
      log(`エラー: ${e.message}\nURL: ${buildSearchUrl(state, state.p)}`);
    } finally {
      setBusy(false);
      $('pxFooter').scrollIntoView({ block: 'end' });
    }
  }

  btn.onclick = () => { panel.style.display = 'block'; };
  $('pxClose').onclick = () => { panel.style.display = 'none'; };
  $('pxRun').onclick = () => run(true);
  $('pxMore').onclick = () => run(false);
  $('pxStop').onclick = () => { if (state) state.stop = true; if (abortCtrl) abortCtrl.abort(); };

  // ---- テスト用フック ----
  // Node の単体テスト(test/)から内部関数を参照するためのもの。
  // ブラウザ実行時は globalThis.__pxAndTestHook が未定義なので何も起きない。
  if (typeof globalThis.__pxAndTestHook === 'function') {
    globalThis.__pxAndTestHook({
      VERSION, PAGE_SIZE, MAX_PAGES, WAIT_MS, FULLTEXT_MODE, PARAM_GENRE,
      buildSearchUrl, fetchFulltextPage, hasTag, matchTags, collectBatch, splitTags,
      getState: () => state,
      setState: s => { state = s; },
      abort: () => { if (state) state.stop = true; if (abortCtrl) abortCtrl.abort(); },
      setSleep: fn => { sleep = fn; },
      root, $,
    });
  }
})();
