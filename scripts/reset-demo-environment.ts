// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

/**
 * 重建本機演示環境：清空資料庫、重跑 migration、載入示範資料。
 *
 * 執行：npm run demo:reset
 *
 * MVP 階段以此取代 VM 快照還原，見 docs/待決策與延後事項.md 的 D-5。
 */

const run = promisify(execFile);

const nodeEnvironment = process.env.NODE_ENV ?? 'development';
if (nodeEnvironment !== 'development' && nodeEnvironment !== 'test') {
  throw new Error(
    `演示環境重置會清空資料，只能在 development 或 test 執行，目前為 ${nodeEnvironment}`
  );
}

async function step(
  label: string,
  command: string,
  args: string[]
): Promise<void> {
  process.stdout.write(`→ ${label}\n`);
  const { stdout, stderr } = await run(command, args);
  if (stdout.trim()) {
    process.stdout.write(`${stdout.trim()}\n`);
  }
  if (stderr.trim()) {
    process.stderr.write(`${stderr.trim()}\n`);
  }
}

// down -v 會移除 volume，資料庫因此回到全新狀態。
await step('停止並清除既有容器與資料', 'docker', [
  'compose',
  'down',
  '-v'
]);
await step('啟動資料庫', 'docker', ['compose', 'up', '-d', '--wait']);
await step('套用 migration', 'npm', ['run', 'db:migrate']);
await step('載入示範資料', 'npm', ['run', 'db:seed']);

process.stdout.write(
  '\n演示環境已重建。\n' +
    '  平台：npm run dev\n' +
    '  模擬 IdP：npm run dev:idp\n'
);
