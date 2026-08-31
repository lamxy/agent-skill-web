// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import 'dotenv/config';

import { pathToFileURL } from 'node:url';

import { Pool } from 'pg';

import { loadConfig } from '../src/shared/config/config.js';
import { runMigrations } from '../src/shared/database/migrator.js';

/**
 * 開發環境的 migration 進入點：npm run db:migrate
 *
 * 實作在 src/shared/database/migrator.ts，與容器內使用的 dist/migrate.js
 * 共用同一份邏輯，避免兩條路徑各自演化。
 */

export {
  discoverMigrations,
  runMigrations,
  type MigrationFile
} from '../src/shared/database/migrator.js';

const migrationsDirectory = new URL('../drizzle/', import.meta.url);

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = new Pool({ connectionString: config.databaseUrl, max: 2 });
  try {
    const applied = await runMigrations(pool, migrationsDirectory);
    process.stdout.write(
      applied.length > 0
        ? `已套用資料庫 migration：${applied.join('、')}\n`
        : '資料庫 migration 已是最新狀態\n'
    );
  } finally {
    await pool.end();
  }
}

const invokedPath = process.argv[1]
  ? pathToFileURL(process.argv[1]).href
  : undefined;
if (invokedPath === import.meta.url) {
  await main();
}
