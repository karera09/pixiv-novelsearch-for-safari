'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load, makeState } = require('./harness');

const api = load();
const { buildSearchUrl, FULLTEXT_MODE } = api;

const params = url => new URL(url).searchParams;

test('buildSearchUrl: 基本形(語はパスとwordの両方に入る)', () => {
  const url = buildSearchUrl(makeState({ text: '雨の日' }), 3);
  assert.ok(url.startsWith(`https://www.pixiv.net/ajax/search/novels/${encodeURIComponent('雨の日')}?`));
  const q = params(url);
  assert.equal(q.get('word'), '雨の日');
  assert.equal(q.get('p'), '3');
  assert.equal(q.get('s_mode'), FULLTEXT_MODE);
  assert.equal(q.get('order'), 'date_d');
  assert.equal(q.get('mode'), 'all');
  assert.equal(q.get('lang'), 'ja');
  assert.equal(q.has('work_lang'), false);
  assert.equal(q.has('original_only'), false);
  assert.equal(q.has('genre'), false);
});

test('buildSearchUrl: work_lang / original_only / genre', () => {
  const q = params(buildSearchUrl(makeState({ workLang: 'en', original: true, genre: '3' }), 1));
  assert.equal(q.get('work_lang'), 'en');
  assert.equal(q.get('original_only'), '1');
  assert.equal(q.get('genre'), '3');
});

test('buildSearchUrl: original 未指定ならジャンルは付かない', () => {
  const q = params(buildSearchUrl(makeState({ original: false, genre: '3' }), 1));
  assert.equal(q.has('original_only'), false);
  assert.equal(q.has('genre'), false);
});

test('buildSearchUrl: extra の先頭 ?& は除去して連結', () => {
  const url = buildSearchUrl(makeState({ extra: '?&tlt=5000&tgt=20000' }), 1);
  assert.ok(url.endsWith('&tlt=5000&tgt=20000'));
  assert.equal(url.includes('?&'), false);
  const q = params(url);
  assert.equal(q.get('tlt'), '5000');
  assert.equal(q.get('tgt'), '20000');
});
