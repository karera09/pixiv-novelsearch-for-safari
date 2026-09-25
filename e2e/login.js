'use strict';
// 実 pixiv へのログイン状態を `.playwright/auth/pixiv.json` に保存する。
// ログイン操作(ID/パスワード入力、reCAPTCHA 等)はユーザー自身がブラウザ上で行う。このスクリプトは検知して保存するだけ。
// 保存されるファイルにはセッション Cookie が含まれるので git 管理外(.gitignore 済み)。共有・コピーしないこと。
const fs = require('node:fs');
const path = require('node:path');
const paths = require('./paths');
const { webkit, devices } = require('@playwright/test');

const TIMEOUT_MS = 10 * 60 * 1000; // 10分待ってログインされなければ諦める

(async () => {
  const browser = await webkit.launch({ headless: false });
  const context = await browser.newContext({ ...devices['iPhone 15'], locale: 'ja-JP' });
  const page = await context.newPage();
  await page.goto('https://accounts.pixiv.net/login?return_to=https%3A%2F%2Fwww.pixiv.net%2F&lang=ja');
  console.log('開いた WebKit ウィンドウで pixiv にログインしてください。ログインを検知したら自動で保存して閉じます。');

  const deadline = Date.now() + TIMEOUT_MS;
  let loggedIn = false;
  while (Date.now() < deadline) {
    await page.waitForTimeout(2000);
    try {
      // ログイン判定: www.pixiv.net 上で /ajax/user/extra が error:false を返せばログイン済み(新 UI に global-data meta は無い)
      if (!/^https:\/\/www\.pixiv\.net\//.test(page.url())) continue;
      const r = await page.evaluate(() => fetch('/ajax/user/extra', { credentials: 'include' }).then(r => r.json()).catch(() => null));
      if (r && r.error === false) { loggedIn = true; break; }
    } catch { /* ページ遷移中などは無視して次の周回へ */ }
  }
  if (!loggedIn) {
    console.error('ログインを検知できませんでした(タイムアウト)。何も保存していません。');
    await browser.close();
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(paths.authState), { recursive: true });
  await context.storageState({ path: paths.authState });
  console.log('ログイン状態を保存しました: ' + path.relative(paths.root, paths.authState));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
