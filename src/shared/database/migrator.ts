// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { readdir, readFile } from 'node:fs/promises';

import type { Pool } from 'pg';

/**
 * Migration 執行邏輯。放在 src/ 而非 scripts/ 的理由：
 * scripts/ 不在 tsconfig.build.json 的 rootDir 內，不會編譯進 dist，
 * 而容器的 runtime 階段已 npm prune 掉 tsx，無法直接執行 .ts。
 * 單機部署需要在容器內跑 migration，因此邏輯必須是編譯後可執行的。
 */

export interface MigrationFile {
  name: string;
  sql: string;
}

export async function discoverMigrations(
  migrationsDirectory: URL
): Promise<MigrationFile[]> {
  const entries = await readdir(migrationsDirectory, { withFileTypes: true });
  const names = entries
    .filter(
      (entry) => entry.isFile() && /^\d{4}_[a-z0-9_-]+\.sql$/i.test(entry.name)
    )
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  return Promise.all(
    names.map(async (name) => ({
      name,
      sql: await readFile(new URL(name, migrationsDirectory), 'utf8')
    }))
  );
}

/** drizzle/ 相對於編譯後的 dist/shared/database/ 位置 */
const DEFAULT_MIGRATIONS_DIRECTORY = new URL(
  '../../../drizzle/',
  import.meta.url
);

export async function runMigrations(
  pool: Pool,
  migrationsDirectory: URL = DEFAULT_MIGRATIONS_DIRECTORY
): Promise<string[]> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const migrations = await discoverMigrations(migrationsDirectory);
  const appliedResult = await pool.query<{ name: string }>(
    'SELECT name FROM _schema_migrations'
  );
  const applied = new Set(appliedResult.rows.map((row) => row.name));

  // 既有資料庫在導入 migration 追蹤前就已建表，補記基線避免重跑 0000。
  if (applied.size === 0) {
    const baseline = await pool.query<{ packages: string | null }>(
      "SELECT to_regclass('public.packages')::text AS packages"
    );
    if (baseline.rows[0]?.packages) {
      await pool.query(
        "INSERT INTO _schema_migrations(name) VALUES ('0000_initial.sql') ON CONFLICT DO NOTHING"
      );
      applied.add('0000_initial.sql');
    }
  }

  const newlyApplied: string[] = [];
  for (const migration of migrations) {
    if (applied.has(migration.name)) {
      continue;
    }

    // 每個 migration 各自一個交易：失敗時只回滾該檔，已套用的保持生效。
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(migration.sql);
      await client.query('INSERT INTO _schema_migrations(name) VALUES ($1)', [
        migration.name
      ]);
      await client.query('COMMIT');
      newlyApplied.push(migration.name);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  return newlyApplied;
}
