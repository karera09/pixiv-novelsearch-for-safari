'use strict';
// Playwright WebKit(iPhone 相当)で本番スクリプトを検証するための設定。
// ブラウザ本体・ログイン状態・出力はすべて `.playwright/` 配下(e2e/paths.js 参照)。
const fs = require('node:fs');
const { defineConfig, devices } = require('@playwright/test');
const paths = require('./e2e/paths');

const hasAuth = fs.existsSync(paths.authState);

module.exports = defineConfig({
  testDir: './e2e',
  testMatch: /.*\.spec\.js/,
  outputDir: paths.results,
  fullyParallel: false,
  workers: 1,             // 実 pixiv を叩く @live テストが並列で走らないように
  retries: 0,
  timeout: 120 * 1000,
  reporter: [['list'], ['html', { outputFolder: paths.report, open: 'never' }]],
  use: {
    ...devices['iPhone 15'], // WebKit + iPhone のビューポート / UA / hasTouch / isMobile
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // ログイン状態があれば全テストで使う。無ければ未ログインで走り、@live テストは自動でスキップされる
    ...(hasAuth ? { storageState: paths.authState } : {}),
  },
  projects: [{ name: 'iphone-webkit', use: { browserName: 'webkit' } }],
});
