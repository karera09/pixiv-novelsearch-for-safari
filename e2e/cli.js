'use strict';
// `npm run e2e:*` の入口。PLAYWRIGHT_BROWSERS_PATH を設定してから playwright CLI を子プロセスで起動する。
// (npm scripts 内で環境変数をセットする書き方が Windows/Unix で異なるため、Node 側で吸収する)
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const paths = require('./paths');

const [cmd, ...rest] = process.argv.slice(2);
const pwCli = path.join(paths.root, 'node_modules', '@playwright', 'test', 'cli.js');
const config = ['--config', path.join(paths.root, 'playwright.config.js')];

const commands = {
  // WebKit だけをプロジェクト内(.playwright/browsers)に取得する。Chromium/Firefox は落とさない
  install: () => run([pwCli, 'install', 'webkit', ...rest]),
  // 実 pixiv へのログイン状態を保存する(ログイン操作はユーザー自身がブラウザ上で行う)
  login: () => run([path.join(__dirname, 'login.js'), ...rest]),
  // モック API でのタッチ/UI テスト。ログイン不要、pixiv へ検索リクエストは飛ばない
  test: () => run([pwCli, 'test', ...config, '--grep-invert', '@live', ...rest]),
  // 実 pixiv に対する検証(ログイン状態が必要。無ければスキップ)
  live: () => run([pwCli, 'test', ...config, '--grep', '@live', ...rest]),
  // 直近の実行結果の HTML レポートを開く
  report: () => run([pwCli, 'show-report', paths.report, ...rest]),
};

function run(args) {
  const r = spawnSync(process.execPath, args, { stdio: 'inherit', env: process.env, cwd: paths.root });
  process.exit(r.status == null ? 1 : r.status);
}

if (!commands[cmd]) {
  console.error('使い方: node e2e/cli.js <' + Object.keys(commands).join('|') + '> [playwright の追加引数]');
  process.exit(2);
}
commands[cmd]();
