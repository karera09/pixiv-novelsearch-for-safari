'use strict';
// 検索速度の設定(v1.1): ページ取得間の待ち時間だけを変え、下限 MIN_WAIT_MS より短くはしない
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load, makeState, novel, pagedFetch } = require('./harness');

const noop = () => {};

test('waitMs: 「標準」は WAIT_MS、不明な値は「標準」扱い', () => {
  const api = load();
  assert.equal(api.waitMs('normal'), api.WAIT_MS);
  assert.equal(api.waitMs('nope'), api.WAIT_MS);
  assert.equal(api.waitMs(undefined), api.WAIT_MS);
});

test('waitMs: どの選択肢も MIN_WAIT_MS 以上(安全弁)で、ゆっくり > 標準 > 速め', () => {
  const api = load();
  assert.ok(api.MIN_WAIT_MS > 0);
  for (const k of Object.keys(api.SPEEDS)) assert.ok(api.waitMs(k) >= api.MIN_WAIT_MS, k);
  assert.ok(api.waitMs('slow') > api.waitMs('normal'));
  assert.ok(api.waitMs('normal') > api.waitMs('fast'));
});

test('waitMs: 選択肢の値を書き換えても MIN_WAIT_MS 未満にはならない', () => {
  const api = load();
  api.SPEEDS.fast.ms = 0;
  assert.equal(api.waitMs('fast'), api.MIN_WAIT_MS);
});

for (const speed of ['slow', 'normal', 'fast']) {
  test(`collectBatch: 検索速度「${speed}」の待ち時間でページ間を待つ`, async () => {
    const waits = [];
    const fetch = pagedFetch([[novel(1)], [novel(2)], [novel(3)]], { total: 3 });
    const api = load({ fetch, sleep: ms => { waits.push(ms); return Promise.resolve(); } });
    api.prefs.speed = speed;
    api.setState(makeState({ must: ['none'] }));
    await api.collectBatch(noop, noop);
    assert.deepEqual(waits, [api.waitMs(speed), api.waitMs(speed)]);
  });
}

test('collectBatch: 検索中に速度を変えると次の待機から効く', async () => {
  const waits = [];
  const fetch = pagedFetch([[novel(1)], [novel(2)], [novel(3)]], { total: 3 });
  let api;
  api = load({ fetch, sleep: ms => { waits.push(ms); api.prefs.speed = 'slow'; return Promise.resolve(); } });
  api.prefs.speed = 'fast';
  api.setState(makeState({ must: ['none'] }));
  await api.collectBatch(noop, noop);
  assert.deepEqual(waits, [api.waitMs('fast'), api.waitMs('slow')]);
});

test('ソース検査: 設定画面に検索速度の選択欄がある', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'pixiv-fulltext-tag-and.user.js'), 'utf8');
  assert.match(src, /id="pxSpeed"/);
});
