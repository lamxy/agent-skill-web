// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { eq, sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { discoverMigrations } from '../../scripts/migrate-database.js';
import { PostgresTelemetryRepository } from '../../src/modules/telemetry/postgres-telemetry-repository.js';
import type { CanonicalTelemetryEvent } from '../../src/modules/telemetry/types.js';
import {
  createPostgresDatabase,
  type PostgresDatabase
} from '../../src/shared/database/postgres-database.js';
import { installations } from '../../src/shared/database/schema.js';

const baseDatabaseUrl = process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:55432/agent_skill_platform';
const databaseName = `telemetry_${randomUUID().replaceAll('-', '')}`;
const adminUrl = new URL(baseDatabaseUrl);
adminUrl.pathname = '/postgres';
const isolatedUrl = new URL(baseDatabaseUrl);
isolatedUrl.pathname = `/${databaseName}`;

// DROP DATABASE WITH (FORCE) 會踢掉目標庫上的所有連線，被踢的 idle client
// 會在 pool 上發出 'error'；沒有 listener 時 Node 會升級成 uncaughtException，
// 讓 vitest 在測試全數通過的情況下仍以 1 收場。
function guardPool(pool: Pool): Pool {
  pool.on('error', () => {});
  return pool;
}

const adminPool = guardPool(new Pool({ connectionString: adminUrl.toString(), max: 1 }));
let migrationPool: Pool;
let database: PostgresDatabase;
let repository: PostgresTelemetryRepository;
let legacyInstallationId: number;
let orphanInstallationId: number;

function event(overrides: Partial<CanonicalTelemetryEvent> = {}): CanonicalTelemetryEvent {
  return {
    idempotencyKey: randomUUID(),
    packageId: 'telemetry-skill',
    version: '1.0.0',
    userRef: 'telemetry-user',
    userRefType: 'uid',
    osType: 'linux',
    clientRuntime: 'codex',
    status: 'succeeded',
    errorCode: null,
    scriptVersion: 7,
    options: { '--scope': 'workspace', '--verify': true },
    startedAt: new Date('2026-08-25T01:00:00.000Z'),
    endedAt: new Date('2026-08-25T01:00:10.000Z'),
    payloadFingerprint: 'fingerprint:first',
    receivedAt: new Date('2026-08-25T01:00:11.000Z'),
    ...overrides
  };
}

beforeAll(async () => {
  await adminPool.query(`CREATE DATABASE ${databaseName}`);
  migrationPool = guardPool(new Pool({ connectionString: isolatedUrl.toString(), max: 4 }));

  const migrations = await discoverMigrations(new URL('../../drizzle/', import.meta.url));
  for (const migration of migrations.filter(({ name }) => name < '0009_telemetry.sql')) {
    await migrationPool.query(migration.sql);
  }

  const packageRow = await migrationPool.query<{ id: string }>(`
    INSERT INTO packages (
      package_id, type, name, owner_team, category, source_uri, license
    ) VALUES ('legacy-skill', 'skill', '舊遙測套件', 'platform', 'backend',
      'https://example.invalid/legacy-skill', 'MIT')
    RETURNING id::text
  `);
  const versionRow = await migrationPool.query<{ id: string }>(`
    INSERT INTO package_versions (
      package_id, version, install_command, uninstall_command, author_uid
    ) VALUES ('legacy-skill', '0.9.0', 'install', 'uninstall', 'legacy-author')
    RETURNING id::text
  `);
  expect(packageRow.rows).toHaveLength(1);

  const legacyRow = await migrationPool.query<{ id: string }>(`
    INSERT INTO installations (
      package_version_id, idempotency_key, user_ref, user_ref_type, os_type,
      client_runtime, status, started_at
    ) VALUES ($1, $2, 'legacy-user', 'uid', 'linux', 'codex', 'succeeded',
      '2026-08-24T01:00:00.000Z')
    RETURNING id::text
  `, [versionRow.rows[0]!.id, randomUUID()]);
  const orphanRow = await migrationPool.query<{ id: string }>(`
    INSERT INTO installations (
      package_version_id, idempotency_key, user_ref, user_ref_type, os_type,
      client_runtime, status, started_at
    ) VALUES (999999, $1, 'orphan-user', 'uid', 'windows', 'claude code',
      'failed', '2026-08-24T02:00:00.000Z')
    RETURNING id::text
  `, [randomUUID()]);
  legacyInstallationId = Number(legacyRow.rows[0]!.id);
  orphanInstallationId = Number(orphanRow.rows[0]!.id);

  const migrationSql = await readFile(
    new URL('../../drizzle/0009_telemetry.sql', import.meta.url),
    'utf8'
  );
  await migrationPool.query(migrationSql);
  await migrationPool.query(migrationSql);

  await migrationPool.query(`
    INSERT INTO packages (
      package_id, type, name, owner_team, category, source_uri, license
    ) VALUES ('telemetry-skill', 'skill', '遙測套件', 'platform', 'backend',
      'https://example.invalid/telemetry-skill', 'MIT')
  `);
  await migrationPool.query(`
    INSERT INTO package_versions (
      package_id, version, install_command, uninstall_command, author_uid
    ) VALUES ('telemetry-skill', '1.0.0', 'install', 'uninstall', 'author')
  `);

  const task13MigrationSql = await readFile(
    new URL('../../drizzle/0012_task13_governance_telemetry.sql', import.meta.url),
    'utf8'
  );
  await migrationPool.query(task13MigrationSql);
  await migrationPool.query(task13MigrationSql);

  database = createPostgresDatabase(isolatedUrl.toString());
  repository = new PostgresTelemetryRepository(database.client);
});

afterAll(async () => {
  await database?.close();
  await migrationPool?.end();
  await adminPool.query(`DROP DATABASE IF EXISTS ${databaseName}`);
  await adminPool.end();
});

describe('0009 遙測資料庫遷移', () => {
  it('回填邏輯 ID，並為孤兒與 fingerprint 保留固定可追溯值', async () => {
    const rows = await migrationPool.query<{
      id: string;
      legacy_package_version_id: string;
      package_id: string;
      version: string;
      payload_fingerprint: string;
    }>(`
      SELECT id::text, legacy_package_version_id::text, package_id, version,
        payload_fingerprint
      FROM installations
      WHERE id IN ($1, $2)
      ORDER BY id
    `, [legacyInstallationId, orphanInstallationId]);

    expect(rows.rows).toEqual([
      {
        id: String(legacyInstallationId),
        legacy_package_version_id: expect.any(String),
        package_id: 'legacy-skill',
        version: '0.9.0',
        payload_fingerprint: `legacy:${legacyInstallationId}`
      },
      {
        id: String(orphanInstallationId),
        legacy_package_version_id: '999999',
        package_id: 'legacy-package-version-999999',
        version: 'legacy',
        payload_fingerprint: `legacy:${orphanInstallationId}`
      }
    ]);
  });

  it('建立查詢路徑複合索引且 public schema 維持零外鍵', async () => {
    const indexes = await migrationPool.query<{ indexname: string }>(`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'installations'
      ORDER BY indexname
    `);
    const foreignKeys = await migrationPool.query<{ count: string }>(`
      SELECT count(*)::text AS count FROM pg_constraint
      WHERE contype = 'f' AND connamespace = 'public'::regnamespace
    `);

    expect(indexes.rows.map(({ indexname }) => indexname)).toEqual(expect.arrayContaining([
      'installations_idempotency_key_uidx',
      'installations_package_version_status_started_idx',
      'installations_user_ref_created_idx'
    ]));
    expect(foreignKeys.rows[0]?.count).toBe('0');
  });
});

describe('0012 Task 13 治理與遙測遷移', () => {
  it('新增可相容 legacy 的 snapshot 與遙測欄位', async () => {
    const columns = await migrationPool.query<{
      table_name: string;
      column_name: string;
      is_nullable: string;
    }>(`
      SELECT table_name, column_name, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND (table_name, column_name) IN (
          ('package_versions', 'published_at'),
          ('package_versions', 'script_manifest_digest'),
          ('validation_runs', 'contract_version'),
          ('validation_runs', 'target_snapshots'),
          ('validation_runs', 'manifest_digest'),
          ('installations', 'script_version'),
          ('installations', 'options')
        )
      ORDER BY table_name, column_name
    `);
    const legacyRows = await migrationPool.query<{
      script_version: number | null;
      options: Record<string, unknown> | null;
    }>(`
      SELECT script_version, options
      FROM installations
      WHERE id IN ($1, $2)
      ORDER BY id
    `, [legacyInstallationId, orphanInstallationId]);

    expect(columns.rows).toEqual([
      { table_name: 'installations', column_name: 'options', is_nullable: 'YES' },
      { table_name: 'installations', column_name: 'script_version', is_nullable: 'YES' },
      { table_name: 'package_versions', column_name: 'published_at', is_nullable: 'YES' },
      { table_name: 'package_versions', column_name: 'script_manifest_digest', is_nullable: 'YES' },
      { table_name: 'validation_runs', column_name: 'contract_version', is_nullable: 'NO' },
      { table_name: 'validation_runs', column_name: 'manifest_digest', is_nullable: 'YES' },
      { table_name: 'validation_runs', column_name: 'target_snapshots', is_nullable: 'NO' }
    ]);
    expect(legacyRows.rows).toEqual([
      { script_version: null, options: null },
      { script_version: null, options: null }
    ]);
  });

  it('建立 script version 查詢路徑且不引入外鍵', async () => {
    const indexes = await migrationPool.query<{ indexname: string }>(`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'installations'
    `);
    const foreignKeys = await migrationPool.query<{ count: string }>(`
      SELECT count(*)::text AS count FROM pg_constraint
      WHERE contype = 'f' AND connamespace = 'public'::regnamespace
    `);

    expect(indexes.rows.map(({ indexname }) => indexname)).toContain(
      'installations_package_version_script_status_started_idx'
    );
    expect(foreignKeys.rows[0]?.count).toBe('0');
  });
});

describe('PostgreSQL 遙測儲存庫', () => {
  it('首次寫入保存完整不可變遙測事實', async () => {
    const input = event();

    const result = await repository.ingest(input);
    const rows = await database.client.select().from(installations)
      .where(eq(installations.idempotencyKey, input.idempotencyKey));

    expect(result).toEqual({
      duplicate: false,
      record: { id: expect.any(String), ...input }
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      packageId: 'telemetry-skill',
      version: '1.0.0',
      payloadFingerprint: 'fingerprint:first',
      legacyPackageVersionId: null,
      scriptVersion: 7,
      options: { '--scope': 'workspace', '--verify': true }
    });
  });

  it('legacy canonical event 明確保存 null 新欄位', async () => {
    const input = event({ scriptVersion: null, options: null });

    const result = await repository.ingest(input);
    const rows = await database.client.select().from(installations)
      .where(eq(installations.idempotencyKey, input.idempotencyKey));

    expect(result.record).toMatchObject({ scriptVersion: null, options: null });
    expect(rows[0]).toMatchObject({ scriptVersion: null, options: null });
  });

  it('相同 key 與 fingerprint 回 duplicate 且不新增資料', async () => {
    const input = event();
    const first = await repository.ingest(input);

    const duplicate = await repository.ingest(input);
    const count = await database.client.select({ count: sql<number>`count(*)::int` })
      .from(installations)
      .where(eq(installations.idempotencyKey, input.idempotencyKey));

    expect(duplicate).toEqual({ duplicate: true, record: first.record });
    expect(count[0]?.count).toBe(1);
  });

  it('相同 key 但不同 fingerprint 保留首筆並回冪等衝突', async () => {
    const input = event();
    await repository.ingest(input);

    await expect(repository.ingest(event({
      ...input,
      payloadFingerprint: 'fingerprint:changed'
    }))).rejects.toMatchObject({ statusCode: 409, code: 'IDEMPOTENCY_KEY_CONFLICT' });

    const rows = await database.client.select({
      payloadFingerprint: installations.payloadFingerprint
    }).from(installations).where(eq(installations.idempotencyKey, input.idempotencyKey));
    expect(rows).toEqual([{ payloadFingerprint: 'fingerprint:first' }]);
  });

  it('兩個並發相同 key 採 first-write-wins 且只保存一列', async () => {
    const input = event();

    const results = await Promise.all([
      repository.ingest(input),
      repository.ingest(input)
    ]);
    const count = await database.client.select({ count: sql<number>`count(*)::int` })
      .from(installations)
      .where(eq(installations.idempotencyKey, input.idempotencyKey));

    expect(results.map(({ duplicate }) => duplicate).sort()).toEqual([false, true]);
    expect(results[0]!.record.id).toBe(results[1]!.record.id);
    expect(count[0]?.count).toBe(1);
  });

  it('未知 package/version 不寫入並回 404', async () => {
    const input = event({ version: '404.0.0' });

    await expect(repository.ingest(input)).rejects.toMatchObject({
      statusCode: 404,
      code: 'PACKAGE_VERSION_NOT_FOUND'
    });
    const rows = await database.client.select().from(installations)
      .where(eq(installations.idempotencyKey, input.idempotencyKey));
    expect(rows).toEqual([]);
  });
});
