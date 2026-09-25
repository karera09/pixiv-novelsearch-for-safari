'use strict';
// 共通フィクスチャ: 本番スクリプト(無改変)をページ読み込み時に注入し、Shadow DOM 内の要素を扱うヘルパーを提供する。
// Userscripts 拡張の @run-at document-idle に近づけるため、addInitScript で DOMContentLoaded 後に IIFE を評価する。
const fs = require('node:fs');
const path = require('node:path');
const { test: base, expect } = require('@playwright/test');
const paths = require('./paths');

const SOURCE = fs.readFileSync(paths.userscript, 'utf8');
// E2E_OFFLINE=1: pixiv に到達できない環境(クラウドのサンドボックス等)向け。
// www.pixiv.net への全リクエストを止め、トップページは e2e/stub/pixiv.html(干渉を再現したスタブ)で代替する
const OFFLINE = /^(1|true)$/i.test(process.env.E2E_OFFLINE || '');
const STUB_HTML = fs.readFileSync(path.join(__dirname, 'stub', 'pixiv.html'), 'utf8');
// 本番と同じ IIFE を評価しつつ、テストから内部関数を触れるように __pxAndTestHook を仕込む(ブラウザ実行時は未定義で無害)
const INIT = [
  'window.__pxAndTestHook = h => { window.__px = h; };',
  'const __pxRun = () => { try {',
  SOURCE,
  '} catch (e) { window.__pxInjectError = String(e && e.stack || e); } };',
  "if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', __pxRun); else __pxRun();",
].join('\n');

// モック作品。tags / genre / isOriginal を持たせてクライアント側フィルタを検証できるようにする
//   i%3==0: オリジナル+百合+魔法 / i%3==1: オリジナル+R-18 / i%3==2: 二次創作
function mockNovel(i, over = {}) {
  return {
    id: String(100000 + i), title: `モック作品${i}`, userName: `作者${i}`, textCount: 1000 + i, bookmarkCount: i,
    tags: i % 3 === 0 ? ['オリジナル', '百合', '魔法'] : i % 3 === 1 ? ['オリジナル', 'R-18'] : ['二次創作'],
    genre: String((i % 17) + 1), isOriginal: i % 3 !== 2, ...over,
  };
}
// 実 API と同じく 1ページ 30件
function mockPage(p, total, perPage = 30) {
  const start = (p - 1) * perPage;
  const data = start >= total ? [] : Array.from({ length: Math.min(perPage, total - start) }, (_, k) => mockNovel(start + k + 1));
  return { error: false, message: '', body: { novel: { data, total } } };
}

const test = base.extend({
  // true(既定): 検索 API をモックし pixiv へ検索リクエストを飛ばさない(ログイン不要)。false: 実 API に通す(@live 用)
  mockApi: [true, { option: true }],
  // 最初に開くページ。入口のタブは小説関連ページでしか出ないので、既定はタグ検索の小説タブ(魔法)
  startUrl: ['https://www.pixiv.net/tags/%E9%AD%94%E6%B3%95/novels', { option: true }],

  px: async ({ page, mockApi, startUrl }, use) => {
    // テストから書き換え可能。hold: { p, promise } を入れると、そのページ番号の応答を promise 解決まで保留する(中断テスト用)
    const mock = { total: 90, hold: null };
    const apiCalls = [];
    if (OFFLINE) {
      // 先に登録したものほど後に評価される(Playwright は新しい route を優先)ので、包括ルートは API モックより先に登録する
      await page.route(/^https:\/\/(www\.)?pixiv\.net\//, route => {
        const u = new URL(route.request().url());
        // ページ遷移(トップでも小説ページでも)はスタブ HTML を返し、それ以外(画像・API 等)は空応答
        if (route.request().isNavigationRequest() && !u.pathname.startsWith('/ajax/')) return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: STUB_HTML });
        return route.fulfill({ status: 204, body: '' });
      });
      // ページ内から参照される他ドメイン(s.pximg.net 等)も外へ出さない
      await page.route(/^https?:\/\/(?!www\.pixiv\.net\/)/, route => route.fulfill({ status: 204, body: '' }));
    }
    await page.route('**/ajax/search/novels/**', async route => {
      const u = new URL(route.request().url());
      apiCalls.push(u);
      if (!mockApi) return route.continue();
      const p = Number(u.searchParams.get('p') || '1');
      if (mock.hold && mock.hold.p === p) {
        await mock.hold.promise;
        if (route.request().failure()) return; // 保留中にクライアント側で中断(abort)された
      }
      const g = u.searchParams.get('genre');
      if (g && !/^\d+$/.test(g)) {
        // 実 API と同じ: ジャンルがスラッグだと HTTP 500「例外エラーです」
        return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: true, message: '例外エラーです', body: [] }) });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockPage(p, mock.total)) });
    });

    await page.addInitScript(INIT);
    await page.goto(startUrl, { waitUntil: 'domcontentloaded' });

    const host = page.locator('#pxAndHost');
    await expect(host).toBeAttached();
    expect(await page.evaluate(() => window.__pxInjectError || null), 'スクリプト注入時の例外').toBeNull();
    await page.waitForFunction(() => !!window.__px);

    // WAIT_MS(800ms)の待ちだけ短縮してテストを速くする。本体の定数は無改変
    await page.evaluate(() => window.__px.setSleep(ms => new Promise(r => setTimeout(r, Math.min(ms, 30)))));

    const $ = id => host.locator('#' + id); // Playwright の locator は open な Shadow DOM を透過する
    const state = () => page.evaluate(() => { const s = window.__px.getState(); return s && { ...s, seen: s.seen.size }; });
    // 走査が止まる(running 以外になる)まで待つ。data-state は本体が状態ごとに付ける属性
    const waitIdle = (timeout = 15000) => expect($('pxAndPanel')).toHaveAttribute('data-state', /^(paused|budget|stopped|done|limit|error)$/, { timeout });
    await use({ host, $, apiCalls, mock, state, waitIdle, offline: OFFLINE });
  },
});

module.exports = { test, expect, mockNovel, mockPage, OFFLINE };
