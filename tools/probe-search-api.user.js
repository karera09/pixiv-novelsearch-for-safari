// ==UserScript==
// @name         pixiv 小説検索API パラメータ調査
// @namespace    local
// @version      0.1
// @description  /ajax/search/novels のジャンル等パラメータを実環境で検証する調査用スクリプト(本番スクリプトとは別物)
// @match        https://www.pixiv.net/*
// @run-at       document-start
// @inject-into  page
// @grant        none
// ==/UserScript==
//
// 使い方:
//   1. pixiv にログインした状態でこのスクリプトを有効にする(iPhone Userscripts / PC Tampermonkey どちらでも可)
//   2. 左下の「API調査」ボタン → 「自動プローブ実行」。20〜40秒で結果が出る
//   3. 「記録URL表示」: pixiv本体の検索画面でジャンル等を操作したあとに押すと、本体が実際に叩いたAPIのURLが見える
//   4. 「コピー」で結果(JSON付き)をコピーして貼り付けてください
(() => {
  'use strict';

  // ---- 1. 通信記録: pixiv本体が呼ぶ /ajax/search/ のURLを記録(document-start で fetch/XHR をフックする) ----
  const captured = [];
  const record = u => {
    try {
      const s = String(u);
      if (s.includes('/ajax/search/')) { captured.push(decodeURIComponent(s)); if (captured.length > 50) captured.shift(); }
    } catch {}
  };
  const origFetch = window.fetch;
  window.fetch = function (input) { record(typeof input === 'string' ? input : input && input.url); return origFetch.apply(this, arguments); };
  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (_m, url) { record(url); return origOpen.apply(this, arguments); };

  // ---- 2. プローブ ----
  const WAIT = 1200; // リクエスト間隔(アクセス過多防止。短くしない)
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // 候補: パラメータ名 × 値の形式(スラッグ / 数値ID)
  const NAME_CANDIDATES = ['genre', 'genre_id', 'genreId', 'genres', 'novel_genre', 'ng'];
  const VALUE_CANDIDATES = [['slug', 'contemporary_fantasy'], ['id', '3']]; // 現代ファンタジー。ID=3 は他OSSの対応表より
  // ジャンルID対応表(PixivFE の genreMap より。要確認)
  const GENRE_IDS = {
    1: '恋愛', 2: '異世界ファンタジー', 3: '現代ファンタジー', 4: 'ミステリー', 5: 'ホラー', 6: 'SF', 7: '文学', 8: 'ドラマ',
    9: '歴史・時代', 10: 'BL', 11: '百合', 12: 'キッズ', 13: '詩', 14: 'エッセイ・ノンフィクション', 15: '脚本・台本', 16: '評論・レビュー', 17: 'その他',
  };
  // スラッグ候補(contemporary_fantasy 以外は推定)
  const GENRE_SLUGS = ['romance', 'isekai_fantasy', 'contemporary_fantasy', 'mystery', 'horror', 'sf', 'science_fiction', 'literature', 'drama',
    'historical', 'history', 'bl', 'yuri', 'kids', 'poetry', 'poem', 'essay', 'essay_nonfiction', 'nonfiction', 'script', 'screenplay', 'review', 'other', 'for_men', 'for_women'];

  async function call(word, params) {
    const q = new URLSearchParams(params);
    const url = `https://www.pixiv.net/ajax/search/novels/${encodeURIComponent(word)}?${q}`;
    try {
      const res = await origFetch(url, { credentials: 'include', headers: { accept: 'application/json' } });
      const text = await res.text();
      let json;
      try { json = JSON.parse(text); } catch { return { url, status: res.status, error: true, message: 'JSONでない応答: ' + text.slice(0, 80) }; }
      if (json.error) return { url, status: res.status, error: true, message: json.message };
      const nv = json.body && json.body.novel;
      if (!nv) return { url, status: res.status, error: true, message: 'body.novel なし。body のキー: ' + Object.keys(json.body || {}).join(',') };
      return {
        url, status: res.status, error: false, total: nv.total, lastPage: nv.lastPage, count: nv.data.length,
        ids: nv.data.slice(0, 5).map(n => n.id),
        genres: nv.data.map(n => n.genre), originals: nv.data.map(n => n.isOriginal),
        sampleKeys: nv.data[0] ? Object.keys(nv.data[0]) : [],
      };
    } catch (e) { return { url, error: true, message: e.message }; }
  }

  function verdict(r, base) {
    if (r.error) return 'ERROR';
    if (!base || base.error) return 'OK';
    if (r.total === base.total && String(r.ids) === String(base.ids)) return 'IGNORED(結果が基準と同じ)';
    return 'EFFECTIVE(結果が変わった)';
  }

  async function probe(word, mode, out) {
    const results = [];
    const base = { word, order: 'date_d', mode, p: 1, s_mode: 's_tc', lang: 'ja' };
    const push = (label, r, baseR) => {
      const v = verdict(r, baseR);
      results.push({ label, verdict: v, status: r.status, total: r.total, count: r.count, message: r.message, url: r.url });
      out(`[${v}] ${label}` + (r.error ? `\n    → ${r.message}` : `  total=${r.total} count=${r.count}`));
    };

    out('== フェーズ1: 基準と基本パラメータ ==');
    const b0 = await call(word, base); push('基準: s_mode=s_tc のみ', b0, null);
    if (b0.error) { out('基準リクエストが失敗しました。ログイン状態と語を確認してください'); return { results, captured }; }
    out(`  1ページあたり件数=${b0.count}, lastPage=${b0.lastPage}`);
    out(`  作品オブジェクトのキー: ${b0.sampleKeys.join(', ')}`);
    out(`  各作品の genre 値: ${JSON.stringify(b0.genres)}`);
    out(`  各作品の isOriginal: ${JSON.stringify(b0.originals)}`);
    await sleep(WAIT);
    const b1 = await call(word, { ...base, original_only: '1' }); push('original_only=1', b1, b0);
    if (!b1.error) out(`  isOriginal: ${JSON.stringify(b1.originals)} / genre: ${JSON.stringify(b1.genres)}`);
    await sleep(WAIT);
    push('s_mode=text(ページ側の値をそのまま)', await call(word, { ...base, s_mode: 'text' }), b0); await sleep(WAIT);
    push('s_mode=s_tag(タグ検索。s_tc と件数が違えば本文検索は効いている)', await call(word, { ...base, s_mode: 's_tag' }), b0); await sleep(WAIT);
    push('gs=1(シリーズ整合)', await call(word, { ...base, gs: '1' }), b0); await sleep(WAIT);
    push('r=1(意味不明のページ側パラメータ)', await call(word, { ...base, r: '1' }), b0); await sleep(WAIT);
    push('work_lang=ja', await call(word, { ...base, work_lang: 'ja' }), b0); await sleep(WAIT);

    out('\n== フェーズ2: ジャンルのパラメータ名 × 値形式(original_only=1 と併用) ==');
    const baseO = b1.error ? b0 : b1;
    const genreBase = { ...base, original_only: '1' };
    let found = null;
    for (const name of NAME_CANDIDATES) {
      for (const [kind, val] of VALUE_CANDIDATES) {
        const r = await call(word, { ...genreBase, [name]: val });
        push(`${name}=${val}`, r, baseO);
        if (!found && !r.error && verdict(r, baseO).startsWith('EFFECTIVE')) found = { name, kind, val, genres: r.genres };
        await sleep(WAIT);
      }
    }
    // original_only なしでジャンル単独指定も1つ試す
    push('genre=3 (original_only なし)', await call(word, { ...base, genre: '3' }), b0); await sleep(WAIT);

    if (!found) {
      out('\n有効なジャンルパラメータは見つかりませんでした。作品の genre 値を使ったクライアント側絞り込みに切り替えるのが安全です。');
    } else {
      out(`\n有効: ${found.name}=${found.val} (${found.kind}) 。ヒット作品の genre 値: ${JSON.stringify(found.genres)}`);
      out('\n== フェーズ3: 全ジャンル値の件数 ==');
      const values = found.kind === 'id' ? Object.keys(GENRE_IDS) : GENRE_SLUGS;
      for (const v of values) {
        const r = await call(word, { ...genreBase, [found.name]: v });
        const label = `${found.name}=${v}` + (found.kind === 'id' ? ` (${GENRE_IDS[v]})` : '');
        push(label, r, baseO);
        if (!r.error) out(`    genre値: ${JSON.stringify([...new Set(r.genres)])}`);
        await sleep(WAIT);
      }
    }
    return { word, mode, perPage: b0.count, found, results, captured: captured.slice() };
  }

  // ---- 3. UI(Shadow DOM。本番スクリプトのボタン(右下)と被らないよう左下) ----
  function mountUI() {
    const host = document.createElement('div');
    host.id = 'pxProbeHost';
    host.style.cssText = 'all:initial;position:fixed;z-index:2147483646;';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>
      :host{all:initial}*{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Helvetica Neue",Arial,sans-serif}
      #btn{position:fixed;left:12px;bottom:80px;background:#444;color:#fff;border:0;border-radius:24px;padding:10px 14px;font-size:14px;box-shadow:0 2px 8px rgba(0,0,0,.3)}
      #panel{position:fixed;inset:0;background:#fff;color:#222;overflow:auto;padding:12px;font-size:13px;display:none;-webkit-overflow-scrolling:touch}
      input,select{padding:8px;margin:4px 0 8px;border:1px solid #ccc;border-radius:6px;font-size:16px;background:#fff;color:#222;-webkit-text-fill-color:#222;width:100%}
      button{padding:8px 12px;margin:0 8px 8px 0;border:0;border-radius:6px;background:#0096fa;color:#fff;font-size:14px}
      button:disabled{background:#bbb}button.gray{background:#888}
      textarea{width:100%;height:60vh;font-family:Menlo,Consolas,monospace;font-size:12px;color:#222;-webkit-text-fill-color:#222;background:#fafafa;border:1px solid #ccc;border-radius:6px;padding:8px;white-space:pre}
      label{display:block;color:#222}
    </style>
    <button id="btn">API調査</button>
    <div id="panel">
      <div style="display:flex;justify-content:space-between;align-items:center"><b>検索API パラメータ調査 v0.1</b><button id="close" class="gray">閉じる</button></div>
      <label>本文検索の語(ヒットが多い語がよい)</label><input id="word" value="雨" autocomplete="off">
      <label>年齢制限 mode</label><select id="mode"><option value="all">all</option><option value="safe">safe</option><option value="r18">r18</option></select>
      <button id="run">自動プローブ実行</button><button id="cap" class="gray">記録URL表示</button><button id="copy" class="gray">コピー</button>
      <textarea id="out" readonly placeholder="ここに結果が出ます"></textarea>
    </div>`;
    document.documentElement.appendChild(host);
    const $ = id => root.getElementById(id);
    const panel = $('panel');
    for (const ev of ['keydown', 'keyup', 'keypress', 'input', 'beforeinput', 'compositionstart', 'compositionupdate', 'compositionend', 'touchstart', 'touchmove', 'touchend', 'pointerdown', 'click']) {
      panel.addEventListener(ev, e => e.stopPropagation());
    }
    const out = s => { $('out').value += s + '\n'; $('out').scrollTop = $('out').scrollHeight; };
    $('btn').onclick = () => { panel.style.display = 'block'; };
    $('close').onclick = () => { panel.style.display = 'none'; };
    $('cap').onclick = () => {
      out('== pixiv本体が呼んだ /ajax/search/ URL(新しい順) ==');
      if (!captured.length) out('(まだ記録なし。pixivの検索画面でジャンル等を変更してから押してください。このスクリプトが document-start で動いていない場合も記録されません)');
      [...captured].reverse().forEach(u => out(u));
    };
    $('copy').onclick = async () => {
      const t = $('out'); t.select();
      try { await navigator.clipboard.writeText(t.value); out('(コピーしました)'); } catch { document.execCommand && document.execCommand('copy'); out('(選択状態にしました。手動でコピーしてください)'); }
    };
    $('run').onclick = async () => {
      $('run').disabled = true; $('out').value = '';
      try {
        const summary = await probe($('word').value.trim() || '雨', $('mode').value, out);
        out('\n== JSON(これを貼り付けてください) ==\n' + JSON.stringify(summary, null, 1));
      } catch (e) { out('例外: ' + e.message); }
      finally { $('run').disabled = false; }
    };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountUI); else mountUI();
})();
