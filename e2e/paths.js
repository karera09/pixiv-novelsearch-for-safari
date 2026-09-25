'use strict';
// E2E 用のパス定義。ブラウザ本体・ログイン状態・テスト結果をすべてプロジェクト内 `.playwright/` に閉じ込める。
// このファイルは playwright.config.js と各スクリプトの先頭で require され、
// require 時点で PLAYWRIGHT_BROWSERS_PATH を設定する(Playwright はこの環境変数を install 時と起動時に見る)。
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PW_DIR = path.join(ROOT, '.playwright');

const paths = {
  root: ROOT,
  userscript: path.join(ROOT, 'pixiv-fulltext-tag-and.user.js'),
  browsers: path.join(PW_DIR, 'browsers'),            // `npm run e2e:install` の保存先
  authState: path.join(PW_DIR, 'auth', 'pixiv.json'), // `npm run e2e:login` が保存するログイン状態(Cookie 含む。git 管理外)
  results: path.join(PW_DIR, 'test-results'),
  report: path.join(PW_DIR, 'report'),
};

// 既定はプロジェクト内。Docker/devcontainer(Playwright 公式イメージは /ms-playwright にブラウザ同梱)や
// クラウド環境で外から指定されていればそれを尊重する
if (!process.env.PLAYWRIGHT_BROWSERS_PATH) process.env.PLAYWRIGHT_BROWSERS_PATH = paths.browsers;
paths.browsers = process.env.PLAYWRIGHT_BROWSERS_PATH;

module.exports = paths;
