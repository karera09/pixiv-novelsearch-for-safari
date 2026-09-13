'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load, makeState, novel, pagedFetch } = require('./harness');

const noop = () => {};

test('collectBatch: totalPages 未確定でも1ページ目を取りに行く(v0.4 リグレッション)', async () => {
  const fetch = pagedFetch([[novel(1, ['x'])]], { total: 1 });
  const api = load({ fetch });
  api.setState(makeState({ must: ['x'] }));
  const hits = [];
  await api.collectBatch(n => hits.push(n.id), noop);
  assert.equal(fetch.calls.length, 1);
  assert.deepEqual(hits, ['1']);
  const s = api.getState();
  assert.equal(s.total, 1);
  assert.equal(s.totalPages, 1);
  assert.equal(s.done, true);
});

test('collectBatch: 総ページ数は total ÷ 1ページの件数', async () => {
  const page1 = Array.from({ length: 24 }, (_, i) => novel(i + 1));
  const fetch = pagedFetch([page1], { total: 100 });
  const api = load({ fetch });
  api.setState(makeState({ must: ['nothing'] })); // ヒットさせず走査だけ
  await api.collectBatch(noop, noop);
  assert.equal(api.getState().totalPages, 5); // ceil(100/24)
});

test('collectBatch: PAGE_SIZE 件揃ったら止まり、続きは次の呼び出しで', async () => {
  const api0 = load();
  const N = api0.PAGE_SIZE;
  // 1ページ目に N+2 件全てヒット → 1回目で N 件、残り2件は同ページ内で捨てられず got 超過分も描画される
  // (ページ単位で処理するため、1ページ内では PAGE_SIZE を超えて描画される仕様)
  const page1 = Array.from({ length: N + 2 }, (_, i) => novel(i + 1, ['x']));
  const page2 = [novel(900, ['x'])];
  const fetch = pagedFetch([page1, page2], { total: N + 3 });
  const api = load({ fetch });
  api.setState(makeState({ must: ['x'] }));
  const hits = [];
  await api.collectBatch(n => hits.push(n.id), noop);
  assert.equal(fetch.calls.length, 1, '1ページで PAGE_SIZE に達したら次ページは取らない');
  assert.equal(hits.length, N + 2);
  assert.equal(api.getState().done, false);
  assert.equal(api.getState().p, 2);

  await api.collectBatch(n => hits.push(n.id), noop);
  assert.equal(fetch.calls.length, 2);
  assert.ok(hits.includes('900'));
  assert.equal(api.getState().done, true);
});

test('collectBatch: 空ページで終端', async () => {
  const fetch = pagedFetch([[novel(1)], []], { total: 48 }); // total は 2ページ分を主張するが 2ページ目は空
  const api = load({ fetch });
  api.setState(makeState());
  await api.collectBatch(noop, noop);
  assert.equal(api.getState().done, true);
  assert.equal(fetch.calls.length, 2);
});

test('collectBatch: totalPages 超過で終端(以降は fetch しない)', async () => {
  const fetch = pagedFetch([[novel(1)], [novel(2)]], { total: 2 }); // per=1 → totalPages=2
  const api = load({ fetch });
  api.setState(makeState({ must: ['none'] }));
  await api.collectBatch(noop, noop);
  assert.equal(fetch.calls.length, 2);
  assert.equal(api.getState().done, true);
  await api.collectBatch(noop, noop);
  assert.equal(fetch.calls.length, 2, 'done 後は fetch しない');
});

test('collectBatch: MAX_PAGES を超えて掘らない', async () => {
  const api0 = load();
  const pages = Array.from({ length: api0.MAX_PAGES + 5 }, (_, i) => [novel(i + 1)]);
  const fetch = pagedFetch(pages, { total: pages.length });
  const api = load({ fetch });
  api.setState(makeState({ must: ['none'] }));
  await api.collectBatch(noop, noop);
  assert.equal(fetch.calls.length, api.MAX_PAGES);
  assert.equal(api.getState().done, true);
});

test('collectBatch: seen による重複排除(同じ id は二度描画しない)', async () => {
  const fetch = pagedFetch([[novel(1, ['x']), novel(1, ['x'])], [novel(1, ['x']), novel(2, ['x'])]], { total: 4 });
  const api = load({ fetch });
  api.setState(makeState({ must: ['x'] }));
  const hits = [];
  await api.collectBatch(n => hits.push(n.id), noop);
  assert.deepEqual(hits, ['1', '2']);
  assert.equal(api.getState().found, 2);
});

test('collectBatch: 中断(AbortError)で p は進まず、再開で同じページから', async () => {
  let api;
  const pages = [[novel(1)], [novel(2, ['x'])]];
  const fetch = async (url, init) => {
    const p = Number(new URL(url).searchParams.get('p'));
    if (p === 2 && fetch.abortOnce) {
      fetch.abortOnce = false;
      api.abort(); // fetch 中に中断ボタンが押された想定
      const e = new Error('aborted'); e.name = 'AbortError';
      assert.equal(init.signal.aborted, true);
      throw e;
    }
    return { json: async () => ({ error: false, body: { novel: { data: pages[p - 1] || [], total: 2 } } }) };
  };
  fetch.abortOnce = true;
  api = load({ fetch });
  api.setState(makeState({ must: ['x'] }));
  const hits = [];
  await api.collectBatch(n => hits.push(n.id), noop);
  let s = api.getState();
  assert.equal(s.p, 2, '中断したページ番号のまま');
  assert.equal(s.stop, true);
  assert.equal(s.done, false);
  assert.deepEqual(hits, []);

  await api.collectBatch(n => hits.push(n.id), noop); // 再開
  s = api.getState();
  assert.deepEqual(hits, ['2']);
  assert.equal(s.done, true);
});

test('collectBatch: API エラーは例外として伝播し、message を含む', async () => {
  const fetch = async () => ({ json: async () => ({ error: true, message: '例外エラーです' }) });
  const api = load({ fetch });
  api.setState(makeState());
  await assert.rejects(api.collectBatch(noop, noop), /例外エラーです/);
});

test('collectBatch: ページ取得ごとに WAIT_MS 待機する(安全弁)', async () => {
  const waits = [];
  const fetch = pagedFetch([[novel(1)], [novel(2)], [novel(3)]], { total: 3 });
  const api = load({ fetch, sleep: ms => { waits.push(ms); return Promise.resolve(); } });
  api.setState(makeState({ must: ['none'] }));
  await api.collectBatch(noop, noop);
  assert.equal(fetch.calls.length, 3);
  assert.ok(waits.every(ms => ms === api.WAIT_MS));
  // 現行実装(v0.8)は最終ページ取得後にも1回待機する(終端判定がループ先頭にあるため)。
  // 軽微な無駄なので挙動としては許容し、待機回数がページ数を下回らないことだけを保証する
  assert.ok(waits.length >= 2, '3ページなら少なくともページ間の2回は待機する');
  assert.equal(waits.length, 3);
});
