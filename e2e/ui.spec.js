'use strict';
// タッチ操作と UI の検証(WebKit + iPhone 15 相当)。検索 API はモックなので pixiv へ検索リクエストは飛ばず、ログインも不要。
// 実 pixiv のページ(React・CSS)の上で本番スクリプトを動かすので、入力横取りや文字色の問題はここで検出できる。
// 入口のタブは小説関連ページでしか出ないので、フィクスチャは /tags/魔法/novels から始める(fixtures.js の startUrl)。
const { test, expect } = require('./fixtures');

const NOVEL_URL = 'https://www.pixiv.net/tags/%E9%AD%94%E6%B3%95/novels';

test('小説ページでは右端のタブが画面内に見えていて、タップでパネルが開く', async ({ page, px }) => {
  const btn = px.$('pxAndBtn');
  await expect(btn).toBeVisible();
  const box = await btn.boundingBox();
  const vp = page.viewportSize();
  expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
  expect(box.y + box.height).toBeLessThanOrEqual(vp.height);
  expect(box.width, '入口は細いタブ(旧版の大きなピル型ボタンではない)').toBeLessThanOrEqual(48);

  await expect(px.$('pxAndPanel')).toBeHidden();
  await btn.tap(); // hasTouch なので touchstart/touchend が発火する
  await expect(px.$('pxAndPanel')).toBeVisible();
  await expect(px.$('pxAndPanel')).toContainText('本文×タグ検索');
  await expect(px.$('pxAndPanel')).toHaveAttribute('data-view', 'form');
  await expect(px.$('pxRun')).toBeVisible();
  await expect(px.$('pxRun'), '本文の語が空のうちは検索できない').toBeDisabled();
  await expect(px.$('pxStop')).toBeHidden();
  await expect(px.$('pxMore')).toBeHidden();
  await expect(btn, '開いている間はタブを隠す').toBeHidden();
});

test('トップページではタブが出ず、pushState で小説ページに移ると出る。#pxand でどこでも開ける', async ({ page, px }) => {
  await page.goto('https://www.pixiv.net/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__px);
  const btn = px.$('pxAndBtn');
  await page.waitForTimeout(1000); // ポーリング(800ms)を1回以上通す
  await expect(btn).toBeHidden();
  // SPA 遷移(pixiv 側の pushState)に追従する
  await page.evaluate(u => history.pushState({}, '', u), NOVEL_URL);
  await expect(btn).toBeVisible({ timeout: 5000 });
  await page.evaluate(() => history.pushState({}, '', '/'));
  await expect(btn).toBeHidden({ timeout: 5000 });
  // 出ていないページでも #pxand で開ける(ハッシュは開いた後に消す)
  await page.evaluate(() => { location.hash = '#pxand'; });
  await expect(px.$('pxAndPanel')).toBeVisible({ timeout: 5000 });
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('');
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
  await expect(px.$('pxMustChips'), '入力の解釈結果がチップで見える').toContainText('+オリジナル');
  await expect(px.$('pxMustChips')).toContainText('+百合');

  const style = await text.evaluate(el => {
    const cs = getComputedStyle(el);
    const ph = getComputedStyle(el, '::placeholder');
    return { color: cs.color, fill: cs.webkitTextFillColor, opacity: cs.opacity, fontSize: parseFloat(cs.fontSize), phFill: ph.webkitTextFillColor };
  });
  expect(style.fill).not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
  expect(style.color).not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
  expect(style.opacity).toBe('1');
  expect(style.fontSize, 'iOS Safari は 16px 未満だとフォーカス時に自動ズームする').toBeGreaterThanOrEqual(16);
  expect(style.phFill, '例文(placeholder)は入力値と違う色で薄く表示する').not.toBe(style.fill);
});

test('検索: 必須/除外タグでクライアント側フィルタされ、PAGE_SIZE 件揃うまでページを掘る。結果は先頭から見える', async ({ px }) => {
  await px.$('pxAndBtn').tap();
  await px.$('pxText').fill('魔法');
  await px.$('pxMust').fill('オリジナル');
  await px.$('pxNot').fill('R-18');
  await px.$('pxRun').tap();
  await expect(px.$('pxAndPanel')).toHaveAttribute('data-view', 'results');
  await px.waitIdle();

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
  await expect(px.$('pxAndPanel')).toHaveAttribute('data-state', 'done');
  await expect(px.$('pxLog')).toContainText('すべて確認済み');
  await expect(px.$('pxEnd')).toContainText('最後まで探しました');
  await expect(px.$('pxMore')).toBeHidden();
  await expect(px.$('pxEdit')).toBeVisible();
  // 旧版は結果の末尾まで自動スクロールしていた。新版は 1件目と条件の要約が見えたまま
  await expect(items.first()).toBeInViewport();
  await expect(px.$('pxSummary')).toContainText('「魔法」');
  await expect(px.$('pxSummary')).toContainText('+オリジナル');
  await expect(px.$('pxSummary')).toContainText('−R-18');
  await expect(px.$('pxFooter')).toBeInViewport();
  // 一致した必須タグはカード内で先頭に強調される
  await expect(items.first().locator('.tag').first()).toHaveClass(/hit/);
  await expect(items.first().locator('.tag').first()).toHaveText('#オリジナル');

  // 作品リンクは新規タブで開く(1件につきリンクは1つ)
  const a = items.first().locator('a');
  await expect(a).toHaveAttribute('target', '_blank');
  await expect(a).toHaveAttribute('href', /novel\/show\.php\?id=\d+/);
});

test('ジャンル: UI の選択肢は数値ID、オリジナル限定をオンにすると選べ、リクエストに genre=<ID> が乗る', async ({ px }) => {
  await px.$('pxAndBtn').tap();
  const opts = await px.$('pxGenre').locator('option').evaluateAll(os => os.map(o => o.value));
  expect(opts).toEqual(['', ...Array.from({ length: 17 }, (_, i) => String(i + 1))]);

  await px.$('pxText').fill('魔法');
  await px.$('pxOpts').locator('summary').tap();
  await expect(px.$('pxGenre'), 'オリジナル限定がオフの間はジャンルを選べない').toBeDisabled();
  await px.$('pxOriginal').tap();
  await expect(px.$('pxOriginal')).toBeChecked();
  await expect(px.$('pxGenre')).toBeEnabled();
  await px.$('pxGenre').selectOption('3');
  await expect(px.$('pxOptCnt')).toContainText('2件指定中');
  await px.$('pxRun').tap();
  await px.waitIdle();

  expect(px.apiCalls.length).toBeGreaterThan(0);
  for (const u of px.apiCalls) {
    expect(u.searchParams.get('genre')).toBe('3');
    expect(u.searchParams.get('original_only')).toBe('1');
    expect(u.searchParams.get('s_mode')).toBe('s_tc');
    for (const k of ['gs', 'genres', 'novel_genre']) expect(u.searchParams.has(k)).toBe(false);
  }
  await expect(px.$('pxEnd'), '結果末尾の「リクエスト URL」で確認できる').toContainText('genre=3');
  await expect(px.$('pxSummary')).toContainText('詳細 2件');
});

test('ジャンル: 追加パラメータでスラッグを渡すとエラーが表示され、リクエストは1回で止まり、再試行ボタンが出る', async ({ px }) => {
  await px.$('pxAndBtn').tap();
  await px.$('pxText').fill('魔法');
  await px.$('pxOpts').locator('summary').tap();
  await px.$('pxOriginal').tap();
  await px.$('pxExtra').fill('genre=contemporary_fantasy');
  await px.$('pxRun').tap();
  await px.waitIdle();

  await expect(px.$('pxAndPanel')).toHaveAttribute('data-state', 'error');
  await expect(px.$('pxLog')).toContainText('エラー: 例外エラーです');
  await expect(px.$('pxEnd')).toContainText('例外エラーです');
  expect(px.apiCalls.length).toBe(1);
  await expect(px.$('pxList').locator('.item')).toHaveCount(0);
  await expect(px.$('pxMore')).toBeVisible();
  await expect(px.$('pxMore')).toHaveText('再試行');
});

test('中断→再開: 中断で p は進まず、「続きを探す」で同じページから続き、重複描画しない', async ({ px }) => {
  px.mock.total = 300; // 10ページ分
  // 2ページ目の応答をテスト側で保留し、その間に「止める」をタップする
  let release; px.mock.hold = { p: 2, promise: new Promise(r => { release = r; }) };
  await px.$('pxAndBtn').tap();
  await px.$('pxText').fill('魔法');
  await px.$('pxMust').fill('二次創作'); // i%3==2 → 1ページ 10件。24件揃うまで 3ページ以上かかる
  await px.$('pxRun').tap();
  await expect(px.$('pxAndPanel')).toHaveAttribute('data-state', 'running');
  await expect(px.$('pxStop')).toBeVisible();
  await expect(px.$('pxRun')).toBeHidden();
  await expect(px.$('pxList').locator('.item')).toHaveCount(10); // 1ページ目が描画され、2ページ目で止まっている
  await expect(px.$('pxLog')).toContainText('10件ヒット');
  await expect(px.$('pxLog')).toContainText('2/10ページ目');

  await px.$('pxStop').tap(); // 2ページ目の取得中に中断
  await px.waitIdle();
  release(); px.mock.hold = null;
  const s1 = await px.state();
  expect(s1.stop).toBe(true);
  expect(s1.done).toBe(false);
  expect(s1.p).toBe(2); // 取得中だった 2ページ目は p が進まない
  await expect(px.$('pxAndPanel')).toHaveAttribute('data-state', 'stopped');
  await expect(px.$('pxMore')).toBeVisible();
  await expect(px.$('pxMore')).toHaveText('続きを探す');
  await expect(px.$('pxStop')).toBeHidden();
  await expect(px.$('pxLog')).toContainText('中断中');
  await expect(px.$('pxList').locator('.item')).toHaveCount(10, '中断前の結果は残る');
  const idsBefore = await px.$('pxList').locator('.item a').evaluateAll(as => as.map(a => a.getAttribute('href')));

  await px.$('pxMore').tap();
  await px.waitIdle();
  const s2 = await px.state();
  // 再開は新しいバッチとして PAGE_SIZE(24)件を集め直す仕様: 2,3,4ページ目(各10件)を取って 10+30=40
  expect(s2.found).toBe(40);
  expect(s2.p).toBe(5);
  const ids = await px.$('pxList').locator('.item a').evaluateAll(as => as.map(a => a.getAttribute('href')));
  expect(new Set(ids).size).toBe(ids.length, '重複描画なし');
  expect(ids.slice(0, idsBefore.length)).toEqual(idsBefore);
  // 中断時に切られた 2ページ目をもう一度取りに行っている
  expect(px.apiCalls.map(u => u.searchParams.get('p'))).toEqual(['1', '2', '2', '3', '4']);
  await expect(px.$('pxAndPanel')).toHaveAttribute('data-state', 'paused');
  await expect(px.$('pxMore')).toHaveText('続きを探す');
});

test('ヒットが少ない条件は PAGES_PER_BATCH ページで一時停止し、「続けて探す」で続きから掘る', async ({ page, px }) => {
  px.mock.total = 3000; // 100ページ分
  const N = await page.evaluate(() => window.__px.PAGES_PER_BATCH);
  await px.$('pxAndBtn').tap();
  await px.$('pxText').fill('魔法');
  await px.$('pxMust').fill('存在しないタグ');
  await px.$('pxRun').tap();
  await px.waitIdle(30000);
  await expect(px.$('pxAndPanel')).toHaveAttribute('data-state', 'budget');
  expect(px.apiCalls.length).toBe(N);
  await expect(px.$('pxMore')).toHaveText('続けて探す');
  await expect(px.$('pxLog')).toContainText(`${N}ページ見て一時停止`);
  await expect(px.$('pxEnd')).toContainText('一致が少ない条件です');
  await px.$('pxMore').tap();
  await expect(px.$('pxAndPanel')).toHaveAttribute('data-state', 'running');
  await px.waitIdle(30000);
  expect(px.apiCalls.length).toBe(N * 2);
  expect((await px.state()).p).toBe(N * 2 + 1);
});

test('閉じるボタンでパネルが閉じ、タブは残る。検索中に閉じるとタブに件数バッジが出る', async ({ px }) => {
  px.mock.total = 300;
  let release; px.mock.hold = { p: 2, promise: new Promise(r => { release = r; }) };
  await px.$('pxAndBtn').tap();
  await expect(px.$('pxAndPanel')).toBeVisible();
  await px.$('pxClose').tap();
  await expect(px.$('pxAndPanel')).toBeHidden();
  await expect(px.$('pxAndBtn')).toBeVisible();
  await expect(px.$('pxBadge')).toBeHidden();

  await px.$('pxAndBtn').tap();
  await px.$('pxText').fill('魔法');
  await px.$('pxMust').fill('二次創作');
  await px.$('pxRun').tap();
  await expect(px.$('pxList').locator('.item')).toHaveCount(10);
  await px.$('pxClose').tap(); // 走査は裏で続く
  await expect(px.$('pxAndBtn')).toBeVisible();
  await expect(px.$('pxBadge')).toBeVisible();
  await expect(px.$('pxBadge')).toHaveText('10');
  release(); px.mock.hold = null;
  await px.waitIdle();
  await expect(px.$('pxBadge')).toHaveText('30'); // 1,2,3ページ目で 10件ずつ → 24件を超えた 30件で一区切り
  await px.$('pxAndBtn').tap(); // 再び開くと結果画面に戻る
  await expect(px.$('pxAndPanel')).toHaveAttribute('data-view', 'results');
  await expect(px.$('pxList').locator('.item')).toHaveCount(30);
});

test('キーボードの検索(Enter)で検索が始まり、条件は保存されて再読み込み後に戻る', async ({ page, px }) => {
  await px.$('pxAndBtn').tap();
  await px.$('pxText').tap();
  await page.keyboard.type('魔法');
  await px.$('pxMust').tap();
  await page.keyboard.type('オリジナル');
  await page.keyboard.press('Enter');
  await expect(px.$('pxAndPanel')).toHaveAttribute('data-view', 'results');
  await px.waitIdle();
  expect(px.apiCalls.length).toBeGreaterThan(0);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__px);
  await px.$('pxAndBtn').tap();
  await expect(px.$('pxText')).toHaveValue('魔法');
  await expect(px.$('pxMust')).toHaveValue('オリジナル');
  await expect(px.$('pxHistSec')).toBeVisible();
  await expect(px.$('pxHistory')).toContainText('魔法');
  await expect(px.$('pxHistory')).toContainText('+オリジナル');
});

test('結果のタグをタップすると、除外タグに追加して再検索できる', async ({ px }) => {
  await px.$('pxAndBtn').tap();
  await px.$('pxText').fill('魔法');
  await px.$('pxRun').tap();
  await px.waitIdle();
  const first = px.$('pxList').locator('.item').first();
  const tag = first.locator('.tag').first();
  const name = (await tag.innerText()).replace(/^#/, '');
  await tag.tap();
  await expect(px.$('pxSheet')).toBeVisible();
  await expect(px.$('pxSheetTitle')).toHaveText('#' + name);
  await px.$('pxSheet').locator('button[data-a=not]').tap();
  await expect(px.$('pxSheet')).toBeHidden();
  await px.waitIdle();
  await expect(px.$('pxNot')).toHaveValue(name);
  await expect(px.$('pxSummary')).toContainText('−' + name);
  const tagsText = await px.$('pxList').locator('.item .tags').allInnerTexts();
  for (const t of tagsText) expect(t).not.toContain('#' + name);
});

test('タグページから開くと、そのタグを必須タグに使う提案が出る', async ({ px }) => {
  await px.$('pxAndBtn').tap();
  await expect(px.$('pxPreset')).toBeVisible();
  await expect(px.$('pxPreset')).toContainText('魔法');
  await px.$('pxPresetUse').tap();
  await expect(px.$('pxMust')).toHaveValue('魔法');
  await expect(px.$('pxPreset'), '取り込んだら提案は消える').toBeHidden();
});

test('パネル内のタッチ/キー操作が pixiv 側(document)へ伝播しない', async ({ page, px }) => {
  await px.$('pxAndBtn').tap();
  // capture フェーズの document リスナーには届くのが DOM の仕様。ここではバブリングで届かないことを見る
  await page.evaluate(() => {
    window.__bubbled = [];
    for (const ev of ['touchstart', 'touchend', 'keydown', 'input', 'click', 'change', 'submit']) document.addEventListener(ev, () => window.__bubbled.push(ev), false);
  });
  await px.$('pxText').tap();
  await page.keyboard.type('a');
  await px.$('pxFuzzy').tap();
  await page.keyboard.press('Enter');
  const bubbled = await page.evaluate(() => window.__bubbled);
  expect(bubbled).toEqual([]);
});
