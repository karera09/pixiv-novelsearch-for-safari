'use strict';
// 実 pixiv に対する検証(@live)。`npm run e2e:login` で保存したログイン状態が必要。無ければスキップ。
// リクエスト数は最小限にし、走査は数ページで中断する。WAIT_MS / MAX_PAGES は本体の値のまま(sleep だけ短縮)。
const fs = require('node:fs');
const paths = require('./paths');
const { test, expect, OFFLINE } = require('./fixtures');

test.use({ mockApi: false });
test.skip(OFFLINE, 'E2E_OFFLINE=1 では実 pixiv に接続しないのでスキップ');
test.skip(!fs.existsSync(paths.authState), 'ログイン状態(.playwright/auth/pixiv.json)が無いのでスキップ。npm run e2e:login で作成する');

test('@live ログイン状態が有効', async ({ page, px }) => {
  const r = await page.evaluate(() => fetch('/ajax/user/extra', { credentials: 'include' }).then(r => r.json()));
  expect(r.error, 'ログインが切れている。npm run e2e:login をやり直す').toBe(false);
});

test('@live 本文検索 API: s_tc / 1ページ30件 / 作品に genre と isOriginal がある', async ({ page, px }) => {
  const nv = await page.evaluate(async () => {
    const o = { text: '魔法', order: 'date_d', mode: 'all', original: false, genre: '', workLang: '', extra: '' };
    const n = await window.__px.fetchFulltextPage(o, 1, new AbortController().signal);
    return { total: n.total, count: n.data.length, sample: n.data.slice(0, 3).map(x => ({ id: x.id, genre: x.genre, isOriginal: x.isOriginal, tags: x.tags.length })) };
  });
  expect(nv.count).toBe(30);
  expect(nv.total).toBeGreaterThan(30);
  for (const s of nv.sample) {
    expect(s.genre).toMatch(/^\d+$/);
    expect(typeof s.isOriginal).toBe('boolean');
  }
});

test('@live ジャンル: genre=3 で件数が絞られ、返る作品はすべて genre "3"', async ({ page, px }) => {
  const r = await page.evaluate(async () => {
    const base = { text: '魔法', order: 'date_d', mode: 'all', original: true, genre: '', workLang: '', extra: '' };
    const all = await window.__px.fetchFulltextPage(base, 1, new AbortController().signal);
    await new Promise(r => setTimeout(r, 1000));
    const g3 = await window.__px.fetchFulltextPage({ ...base, genre: '3' }, 1, new AbortController().signal);
    return { totalAll: all.total, total3: g3.total, genres: g3.data.map(x => x.genre), originals: g3.data.map(x => x.isOriginal) };
  });
  expect(r.total3).toBeGreaterThan(0);
  expect(r.total3).toBeLessThan(r.totalAll);
  expect(r.genres.every(g => g === '3')).toBe(true);
  expect(r.originals.every(Boolean)).toBe(true);
});

test('@live ジャンル: スラッグを渡すと「例外エラーです」で失敗する(フォールバックしない)', async ({ page, px }) => {
  const r = await page.evaluate(async () => {
    const o = { text: '魔法', order: 'date_d', mode: 'all', original: true, genre: 'contemporary_fantasy', workLang: '', extra: '' };
    try { await window.__px.fetchFulltextPage(o, 1, new AbortController().signal); return { ok: true }; }
    catch (e) { return { ok: false, message: e.message }; }
  });
  expect(r.ok).toBe(false);
  expect(r.message).toContain('例外エラーです');
  expect(px.apiCalls.length).toBe(1);
});

test('@live UI から検索し、数ページで中断できる', async ({ px }) => {
  await px.$('pxAndBtn').tap();
  await px.$('pxText').fill('魔法');
  await px.$('pxMust').fill('オリジナル');
  await px.$('pxNot').fill('R-18');
  await px.$('pxRun').tap();
  await expect(px.$('pxStop')).toBeVisible();
  // 3ページ目まで取ったら中断
  await expect.poll(() => px.apiCalls.length, { timeout: 30000 }).toBeGreaterThanOrEqual(3);
  await px.$('pxStop').tap();
  await px.waitIdle(10000);
  const st = await px.state();
  expect(st.total).toBeGreaterThan(0);
  expect(st.totalPages).toBe(Math.ceil(st.total / 30));
  expect(st.seen).toBeGreaterThanOrEqual(60);
  const tags = await px.$('pxList').locator('.tags').allInnerTexts();
  for (const t of tags) { expect(t).toContain('オリジナル'); expect(t).not.toContain('R-18'); }
  await expect(px.$('pxEnd')).toContainText('s_mode=s_tc'); // 結果末尾の「リクエスト URL」
});
