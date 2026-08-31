// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import 'dotenv/config';

import { Pool } from 'pg';

import { loadConfig } from './shared/config/config.js';
import { runMigrations } from './shared/database/migrator.js';

/**
 * 容器內執行 migration 的進入點：node dist/migrate.js
 *
 * 與平台服務分離，避免多次重啟或未來多副本時併發套用同一批 migration。
 * 開發環境的 npm run db:migrate 走 scripts/migrate-database.ts，
 * 兩者共用 shared/database/migrator.ts 的同一份實作。
 */

// dist/migrate.js 位於 dist/ 下，drizzle/ 與 dist/ 同層。
const migrationsDirectory = new URL('../drizzle/', import.meta.url);

const config = loadConfig();
const pool = new Pool({ connectionString: config.databaseUrl, max: 2 });

try {
  const applied = await runMigrations(pool, migrationsDirectory);
  process.stdout.write(
    applied.length > 0
      ? `已套用資料庫 migration：${applied.join('、')}\n`
      : '資料庫 migration 已是最新狀態\n'
  );
} catch (error) {
  process.stderr.write(
    `migration 失敗：${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
