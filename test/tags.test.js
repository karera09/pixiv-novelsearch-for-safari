'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load, novel } = require('./harness');

const api = load();
const { hasTag, matchTags, splitTags } = api;

test('hasTag: 完全一致は大文字小文字を区別し、部分一致は許さない', () => {
  const n = novel(1, ['オリジナル', 'Yuri']);
  assert.equal(hasTag(n, 'オリジナル', false), true);
  assert.equal(hasTag(n, 'yuri', false), false);
  assert.equal(hasTag(n, 'オリジ', false), false);
});

test('hasTag: あいまい検索は部分一致・大文字小文字無視', () => {
  const n = novel(1, ['オリジナル', 'Yuri']);
  assert.equal(hasTag(n, 'yuri', true), true);
  assert.equal(hasTag(n, 'オリジ', true), true);
  assert.equal(hasTag(n, 'BL', true), false);
});

test('matchTags: 必須タグは全て含む必要がある', () => {
  const n = novel(1, ['a', 'b']);
  assert.equal(matchTags(n, ['a', 'b'], [], false), true);
  assert.equal(matchTags(n, ['a', 'c'], [], false), false);
  assert.equal(matchTags(n, [], [], false), true);
});

test('matchTags: 除外タグが優先される', () => {
  const n = novel(1, ['a', 'R-18']);
  assert.equal(matchTags(n, ['a'], ['R-18'], false), false);
  assert.equal(matchTags(n, ['a'], ['R-15'], false), true);
  // あいまい: 'r-1' で R-18 も除外される
  assert.equal(matchTags(n, ['a'], ['r-1'], true), false);
});

test('splitTags: スペース区切り・空要素除去', () => {
  // vm コンテキスト内の配列はプロトタイプが異なるのでスプレッドして比較する
  assert.deepEqual([...splitTags('  a  b\tc ')], ['a', 'b', 'c']);
  assert.deepEqual([...splitTags('')], []);
});
