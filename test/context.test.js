'use strict';
// 入口のタブを出すページの判定(isNovelContext)と、ページから条件を提案するための語の取り出し(pageContext)
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./harness');

const api = load();
const u = s => new URL(s, 'https://www.pixiv.net');
// vm の別コンテキストで作られたオブジェクトは prototype が異なるので、素の値に落としてから比較する
const pc = s => { const r = api.pageContext(u(s)); return r && JSON.parse(JSON.stringify(r)); };

test('isNovelContext: 小説関連ページでは true', () => {
  for (const s of ['/novel', '/novel/', '/novel/ranking.php', '/novel/series/12345', '/novel/new_novel.php',
    '/tags/百合/novels', '/tags/%E7%99%BE%E5%90%88/novels?s_mode=s_tc', '/users/123/novels', '/en/tags/yuri/novels', '/en/novel',
    '/search.php?word=雨&type=novel']) {
    assert.equal(api.isNovelContext(u(s)), true, s);
  }
});

test('isNovelContext: トップ・イラスト・読書中のページでは false', () => {
  for (const s of ['/', '/artworks/123', '/tags/百合', '/tags/百合/illustrations', '/users/123', '/users/123/illustrations',
    '/novel/show.php?id=123', '/en/novel/show.php?id=123', '/search.php?word=雨', '/ranking.php', '/bookmark_new_illust.php']) {
    assert.equal(api.isNovelContext(u(s)), false, s);
  }
});

test('pageContext: タグページは必須タグ、本文検索ページは本文語として提案する', () => {
  assert.deepEqual(pc('/tags/%E7%99%BE%E5%90%88/novels'), { word: '百合', fulltext: false });
  assert.deepEqual(pc('/tags/%E9%9B%A8%E3%81%AE%E6%97%A5/novels?s_mode=s_tc'), { word: '雨の日', fulltext: true });
  assert.deepEqual(pc('/en/tags/rain/novels?s_mode=text'), { word: 'rain', fulltext: true });
  assert.deepEqual(pc('/search.php?word=%E9%9B%A8&type=novel'), { word: '雨', fulltext: false });
  assert.equal(pc('/novel/'), null);
  assert.equal(pc('/tags/%E5%80%8B/illustrations'), null);
  assert.equal(pc('/tags/%ZZ/novels'), null, '壊れたエンコードでも例外にしない');
});

test('UI の定数: PAGES_PER_BATCH は MAX_PAGES 以下、ジャンル表は 1〜17', () => {
  assert.ok(api.PAGES_PER_BATCH > 0 && api.PAGES_PER_BATCH <= api.MAX_PAGES);
  assert.deepEqual(Object.keys(api.GENRES).map(Number), Array.from({ length: 17 }, (_, i) => i + 1));
  assert.equal(api.GENRES[3], '現代ファンタジー');
});
