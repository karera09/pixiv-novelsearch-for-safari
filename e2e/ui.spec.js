'use strict';
// タッチ操作と UI の検証(WebKit + iPhone 15 相当)。検索 API はモックなので pixiv へ検索リクエストは飛ばず、ログインも不要。
// 実 pixiv のページ(React・CSS)の上で本番スクリプトを動かすので、入力横取りや文字色の問題はここで検出できる。
const { test, expect } = require('./fixtures');

test('右下のボタンが画面内に見えていて、タップでパネルが開く', async ({ page, px }) => {
  const btn = px.$('pxAndBtn');
  await expect(btn).toBeVisible();
  const box = await btn.boundingBox();
  const vp = page.viewportSize();
  expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
  expect(box.y + box.height).toBeLessThanOrEqual(vp.height);

  await expect(px.$('pxAndPanel')).toBeHidden();
  await btn.tap(); // hasTouch なので touchstart/touchend が発火する
  await expect(px.$('pxAndPanel')).toBeVisible();
  await expect(px.$('pxAndPanel')).toContainText('本文検索 × タグ AND');
});

test('入力欄に打った文字が保持され、文字色が見える(pixiv の CSS / React に横取りされない)', async ({ page, px }) => {
  await px.$('pxAndBtn').tap();
  const text = px.$('pxText');
  await text.tap();
  await page.keyboard.type('雨の日');
  await expect(text).toHaveValue('雨の日');
  await px.$('pxMust').tap();
  await page.keyboard.type('オリジナル 百合');
  await expect(px.$('pxMust')).toHaveValue('オリジナル 百合');
  await expect(text).toHaveValue('雨の日', '別欄の入力で消えない');

  const style = await text.evaluate(el => {
    const cs = getComputedStyle(el);
    return { color: cs.color, fill: cs.webkitTextFillColor, opacity: cs.opacity, fontSize: parseFloat(cs.fontSize) };
  });
  expect(style.fill).not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
  expect(style.color).not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
  expect(style.opacity).toBe('1');
  expect(style.fontSize, 'iOS Safari は 16px 未満だとフォーカス時に自動ズームする').toBeGreaterThanOrEqual(16);
});

test('検索: 必須/除外タグでクライアント側フィルタされ、PAGE_SIZE 件揃うまでページを掘る', async ({ px }) => {
  await px.$('pxAndBtn').tap();
  await px.$('pxText').fill('魔法');
  await px.$('pxMust').fill('オリジナル');
  await px.$('pxNot').fill('R-18');
  await px.$('pxRun').tap();
  await expect(px.$('pxRun')).toBeEnabled({ timeout: 15000 });

  // モックは i%3==0 だけが「オリジナル かつ R-18 なし」→ 1ページ 10件。24件揃えるには 3ページ必要
  const items = px.$('pxList').locator('.item');
  await expect(items).toHaveCount(30); // ページ単位で処理するので 3ページ目の 10件まで全部描画される(仕様)
  const tagsText = await items.locator('.tags').allInnerTexts();
  for (const t of tagsText) { expect(t).toContain('オリジナル'); expect(t).not.toContain('R-18'); }
  expect(px.apiCalls.length).toBe(3);
  expect(px.apiCalls.map(u => u.searchParams.get('p'))).toEqual(['1', '2', '3']);
  const st = await px.state();
  expect(st.found).toBe(30);
  expect(st.totalPages).toBe(3); // total 90 ÷ 実ページ件数 30
  expect(st.done).toBe(true);
  await expect(px.$('pxLog')).toContainText('終端');
  await expect(px.$('pxMore')).toBeDisabled();

  // 作品リンクは新規タブで開く
  const a = items.first().locator('a');
  await expect(a).toHaveAttribute('target', '_blank');
  await expect(a).toHaveAttribute('href', /novel\/show\.php\?id=\d+/);
});

test('ジャンル: UI の選択肢は数値ID、リクエストに genre=<ID> が乗り、フォールバックしない', async ({ px }) => {
  await px.$('pxAndBtn').tap();
  const opts = await px.$('pxGenre').locator('option').evaluateAll(os => os.map(o => o.value));
  expect(opts).toEqual(['', ...Array.from({ length: 17 }, (_, i) => String(i + 1))]);

  await px.$('pxText').fill('魔法');
  await px.$('pxOpts').locator('summary').tap();
  await px.$('pxOriginal').tap();
  await expect(px.$('pxOriginal')).toBeChecked();
  await px.$('pxGenre').selectOption('3');
  await px.$('pxRun').tap();
  await expect(px.$('pxRun')).toBeEnabled({ timeout: 15000 });

  expect(px.apiCalls.length).toBeGreaterThan(0);
  for (const u of px.apiCalls) {
    expect(u.searchParams.get('genre')).toBe('3');
    expect(u.searchParams.get('original_only')).toBe('1');
    expect(u.searchParams.get('s_mode')).toBe('s_tc');
    for (const k of ['gs', 'genres', 'novel_genre']) expect(u.searchParams.has(k)).toBe(false);
  }
  await expect(px.$('pxLog')).toContainText('genre=3');
});

test('ジャンル: 追加パラメータでスラッグを渡すとエラーがそのまま表示され、リクエストは1回で止まる', async ({ px }) => {
  await px.$('pxAndBtn').tap();
  await px.$('pxText').fill('魔法');
  await px.$('pxOpts').locator('summary').tap();
  await px.$('pxOriginal').tap();
  await px.$('pxExtra').fill('genre=contemporary_fantasy');
  await px.$('pxRun').tap();
  await expect(px.$('pxRun')).toBeEnabled({ timeout: 15000 });

  await expect(px.$('pxLog')).toContainText('エラー: 例外エラーです');
  expect(px.apiCalls.length).toBe(1);
  await expect(px.$('pxList').locator('.item')).toHaveCount(0);
});

test('中断→再開: 中断で p は進まず、再開ボタンで同じページから続き、重複描画しない', async ({ px }) => {
  px.mock.total = 300; // 10ページ分
  // 2ページ目の応答をテスト側で保留し、その間に「中断」をタップする
  let release; px.mock.hold = { p: 2, promise: new Promise(r => { release = r; }) };
  await px.$('pxAndBtn').tap();
  await px.$('pxText').fill('魔法');
  await px.$('pxMust').fill('二次創作'); // i%3==2 → 1ページ 10件。24件揃うまで 3ページ以上かかる
  await px.$('pxRun').tap();
  await expect(px.$('pxStop')).toBeEnabled();
  await expect(px.$('pxList').locator('.item')).toHaveCount(10); // 1ページ目が描画され、2ページ目で止まっている
  await expect(px.$('pxLog')).toContainText('本文検索 2 /');

  await px.$('pxStop').tap(); // 2ページ目の取得中に中断
  await expect(px.$('pxRun')).toBeEnabled();
  release(); px.mock.hold = null;
  const s1 = await px.state();
  expect(s1.stop).toBe(true);
  expect(s1.done).toBe(false);
  expect(s1.p).toBe(2); // 取得中だった 2ページ目は p が進まない
  await expect(px.$('pxMore')).toHaveText('再開');
  await expect(px.$('pxMore')).toBeEnabled();
  await expect(px.$('pxLog')).toContainText('中断中');
  await expect(px.$('pxList').locator('.item')).toHaveCount(10, '中断前の結果は残る');
  const idsBefore = await px.$('pxList').locator('.item a').evaluateAll(as => as.map(a => a.getAttribute('href')));

  await px.$('pxMore').tap();
  await expect(px.$('pxRun')).toBeEnabled({ timeout: 15000 });
  const s2 = await px.state();
  // 再開は新しいバッチとして PAGE_SIZE(24)件を集め直す仕様: 2,3,4ページ目(各10件)を取って 10+30=40
  expect(s2.found).toBe(40);
  expect(s2.p).toBe(5);
  const ids = await px.$('pxList').locator('.item a').evaluateAll(as => as.map(a => a.getAttribute('href')));
  expect(new Set(ids).size).toBe(ids.length, '重複描画なし');
  expect(ids.slice(0, idsBefore.length)).toEqual(idsBefore);
  // 中断時に切られた 2ページ目をもう一度取りに行っている
  expect(px.apiCalls.map(u => u.searchParams.get('p'))).toEqual(['1', '2', '2', '3', '4']);
});

test('閉じるボタンでパネルが閉じ、ボタンは残る', async ({ px }) => {
  await px.$('pxAndBtn').tap();
  await expect(px.$('pxAndPanel')).toBeVisible();
  await px.$('pxClose').tap();
  await expect(px.$('pxAndPanel')).toBeHidden();
  await expect(px.$('pxAndBtn')).toBeVisible();
});

test('パネル内のタッチ/キー操作が pixiv 側(document)へ伝播しない', async ({ page, px }) => {
  await px.$('pxAndBtn').tap();
  await page.evaluate(() => {
    window.__leaked = [];
    for (const ev of ['touchstart', 'touchend', 'keydown', 'input', 'click']) document.addEventListener(ev, () => window.__leaked.push(ev), true);
  });
  // capture フェーズの document リスナーには届くのが DOM の仕様。ここではバブリングで届かないことを見る
  await page.evaluate(() => {
    window.__bubbled = [];
    for (const ev of ['touchstart', 'touchend', 'keydown', 'input', 'click']) document.addEventListener(ev, () => window.__bubbled.push(ev), false);
  });
  await px.$('pxText').tap();
  await page.keyboard.type('a');
  await px.$('pxFuzzy').tap();
  const bubbled = await page.evaluate(() => window.__bubbled);
  expect(bubbled).toEqual([]);
});
