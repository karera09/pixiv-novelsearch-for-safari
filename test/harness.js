// テストハーネス: スクリプト本体(IIFE)を最小限の DOM スタブ上で評価し、
// __pxAndTestHook 経由で内部関数を取り出す。ブラウザ環境は再現しない(UI は対象外)。
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SCRIPT_PATH = path.join(__dirname, '..', 'pixiv-fulltext-tag-and.user.js');

// Shadow DOM / 要素の最小スタブ。使われるプロパティだけ持つ
function makeElement(id) {
  return {
    id, style: {}, disabled: false, textContent: '', value: '', checked: false, innerHTML: '',
    className: '', children: [],
    appendChild(c) { this.children.push(c); return c; },
    addEventListener() {},
    scrollIntoView() {},
    onclick: null,
  };
}

function makeDocument() {
  const elements = new Map();
  const root = {
    innerHTML: '',
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, makeElement(id));
      return elements.get(id);
    },
  };
  return {
    documentElement: { appendChild() {} },
    createElement(tag) {
      const el = makeElement(tag);
      el.attachShadow = () => root;
      return el;
    },
    _root: root,
  };
}

/**
 * スクリプトを評価して内部 API を返す。
 * @param {object} opts
 * @param {Function} opts.fetch  fetch のモック (url, init) => Promise<{ json(): Promise<any> }>
 * @param {Function} [opts.sleep] 待機のモック。既定は待たない
 */
function load(opts = {}) {
  const source = fs.readFileSync(SCRIPT_PATH, 'utf8');
  let api = null;
  const sandbox = {
    console,
    URLSearchParams, encodeURIComponent, AbortController, Promise, Set, Math, String, Error, Object,
    setTimeout, clearTimeout,
    document: makeDocument(),
    fetch: opts.fetch || (() => { throw new Error('fetch がモックされていません'); }),
    __pxAndTestHook: a => { api = a; },
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  vm.runInNewContext(source, sandbox, { filename: SCRIPT_PATH });
  if (!api) throw new Error('__pxAndTestHook が呼ばれませんでした');
  api.setSleep(opts.sleep || (() => Promise.resolve()));
  return api;
}

// 検索 state の生成。collectBatch が参照するフィールドを揃える
function makeState(over = {}) {
  return {
    text: 'test', must: [], not: [], fuzzy: false,
    order: 'date_d', mode: 'all', original: false, genre: '', workLang: '', extra: '',
    p: 1, total: null, totalPages: null, done: false, stop: false, found: 0, seen: new Set(),
    ...over,
  };
}

// 作品オブジェクトの生成
function novel(id, tags = [], extra = {}) {
  return { id: String(id), title: `title${id}`, userName: 'u', textCount: 100, bookmarkCount: 0, tags, ...extra };
}

// pixiv API の応答モック。pages[p-1] を p ページ目として返す。範囲外は空ページ
function pagedFetch(pages, { total, onCall } = {}) {
  const calls = [];
  const f = async (url, init) => {
    calls.push(url);
    if (onCall) onCall(url, init, calls.length);
    const p = Number(new URL(url).searchParams.get('p'));
    const data = pages[p - 1] || [];
    const body = { data, total: total ?? pages.flat().length };
    return { json: async () => ({ error: false, body: { novel: body } }) };
  };
  f.calls = calls;
  return f;
}

module.exports = { load, makeState, novel, pagedFetch };
