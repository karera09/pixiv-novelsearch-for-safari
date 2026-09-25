'use strict';
// `npm run e2e:offline`: E2E_OFFLINE=1 を付けて `e2e/cli.js test` を起動する(環境変数の付け方が OS で異なるので Node で吸収)
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const r = spawnSync(process.execPath, [path.join(__dirname, 'cli.js'), 'test', ...process.argv.slice(2)],
  { stdio: 'inherit', env: { ...process.env, E2E_OFFLINE: '1' } });
process.exit(r.status == null ? 1 : r.status);
