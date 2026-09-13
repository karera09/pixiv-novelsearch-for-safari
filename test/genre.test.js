'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load, makeState, novel } = require('./harness');

// ジャンルパラメータ名のフォールバック(v0.8, 実 API では未検証)
test('fetchFulltextPage: ジャンル指定でエラーなら候補パラメータ名を順に試す', async () => {
  const seen = [];
  const fetch = async url => {
    const q = new URL(url).searchParams;
    const used = ['genre', 'gs', 'genres', 'novel_genre'].filter(k => q.has(k));
    seen.push(used.join(','));
    // 'genres' だけ受け付ける API を想定
    if (q.has('genres')) return { json: async () => ({ error: false, body: { novel: { data: [novel(1)], total: 1 } } }) };
    return { json: async () => ({ error: true, message: '例外エラーです' }) };
  };
  const api = load({ fetch });
  const o = makeState({ original: true, genre: 'sf' });
  const page = await api.fetchFulltextPage(o, 1, new AbortController().signal);
  assert.equal(page.data.length, 1);
  assert.deepEqual(seen, ['genre', 'gs', 'genres']);
  assert.equal(o.genreParamUsed, 'genres');
  // 採用後は最初からその名前で叩く
  seen.length = 0;
  await api.fetchFulltextPage(o, 2, new AbortController().signal);
  assert.deepEqual(seen, ['genres']);
});

test('fetchFulltextPage: 全候補が失敗したら最初のエラーを投げる', async () => {
  const fetch = async () => ({ json: async () => ({ error: true, message: '例外エラーです' }) });
  const api = load({ fetch });
  const o = makeState({ original: true, genre: 'sf' });
  await assert.rejects(api.fetchFulltextPage(o, 1, new AbortController().signal), /例外エラーです/);
});

test('fetchFulltextPage: ジャンル未指定ならフォールバックせず1回で失敗', async () => {
  let calls = 0;
  const fetch = async () => { calls++; return { json: async () => ({ error: true, message: 'x' }) }; };
  const api = load({ fetch });
  await assert.rejects(api.fetchFulltextPage(makeState(), 1, new AbortController().signal));
  assert.equal(calls, 1);
});
