'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load, makeState, novel } = require('./harness');

// ジャンルは数値ID(1〜17)を `genre` パラメータで渡す(2026-09-25 実環境で確認)。
// v0.8 のパラメータ名フォールバック(genre→gs→genres→novel_genre)は、未知の名前がサーバーに無視されて
// 「絞り込みなしで成功」してしまうバグの原因だったため廃止した。

test('fetchFulltextPage: ジャンルは genre=数値ID で1回だけ叩き、成功したらそのまま返す', async () => {
  const urls = [];
  const fetch = async url => {
    urls.push(new URL(url).searchParams);
    return { json: async () => ({ error: false, body: { novel: { data: [novel(1, [], { genre: '3', isOriginal: true })], total: 1 } } }) };
  };
  const api = load({ fetch });
  const o = makeState({ original: true, genre: '3' });
  const page = await api.fetchFulltextPage(o, 1, new AbortController().signal);
  assert.equal(page.data.length, 1);
  assert.equal(urls.length, 1);
  assert.equal(urls[0].get('genre'), '3');
  assert.equal(urls[0].get('original_only'), '1');
  for (const k of ['gs', 'genres', 'novel_genre']) assert.equal(urls[0].has(k), false, `${k} は付けない`);
});

test('fetchFulltextPage: ジャンル指定でエラーになったらフォールバックせず即座に例外(リクエストは1回)', async () => {
  let calls = 0;
  const fetch = async () => { calls++; return { json: async () => ({ error: true, message: '例外エラーです' }) }; };
  const api = load({ fetch });
  const o = makeState({ original: true, genre: 'contemporary_fantasy' }); // 旧UIのスラッグを渡した場合を想定
  await assert.rejects(api.fetchFulltextPage(o, 1, new AbortController().signal), /例外エラーです/);
  assert.equal(calls, 1, '候補パラメータ名を試して回らない');
  assert.equal(o.genreParamUsed, undefined);
});

test('fetchFulltextPage: ジャンル未指定でも同じく1回で失敗', async () => {
  let calls = 0;
  const fetch = async () => { calls++; return { json: async () => ({ error: true, message: 'x' }) }; };
  const api = load({ fetch });
  await assert.rejects(api.fetchFulltextPage(makeState(), 1, new AbortController().signal));
  assert.equal(calls, 1);
});

test('PARAM_GENRE は genre 固定', () => {
  const api = load({ fetch: async () => { throw new Error('unused'); } });
  assert.equal(api.PARAM_GENRE, 'genre');
});

test('UI のジャンル選択肢は空(すべて)+ 数値ID 1〜17 のみ', () => {
  // ハーネスは innerHTML を解釈しないので、ソースから <select id="pxGenre"> の option を直接読む
  const src = fs.readFileSync(path.join(__dirname, '..', 'pixiv-fulltext-tag-and.user.js'), 'utf8');
  const m = src.match(/<select id="pxGenre">([\s\S]*?)<\/select>/);
  assert.ok(m, 'pxGenre の select が見つからない');
  const values = [...m[1].matchAll(/<option value="([^"]*)">/g)].map(x => x[1]);
  assert.equal(values[0], '');
  const ids = values.slice(1);
  assert.deepEqual(ids, Array.from({ length: 17 }, (_, i) => String(i + 1)));
  // スラッグ形式が残っていないこと
  assert.equal(ids.some(v => /[a-z_]/.test(v)), false);
});
