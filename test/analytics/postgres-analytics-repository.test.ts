// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { randomUUID } from 'node:crypto';

import { eq, sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runMigrations } from '../../scripts/migrate-database.js';
import { PostgresAnalyticsRepository } from '../../src/modules/analytics/postgres-analytics-repository.js';
import { createPostgresDatabase } from '../../src/shared/database/postgres-database.js';
import { installations, packageVersions, packages } from '../../src/shared/database/schema.js';

const databaseUrl = process.env.TEST_DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:55432/agent_skill_platform';
const migrationPool = new Pool({ connectionString: databaseUrl, max: 1 });
const database = createPostgresDatabase(databaseUrl);
const repository = new PostgresAnalyticsRepository(database.client);
const suffix = randomUUID();
const packageId = `analytics-${suffix}`;
const uid = `analytics-user-${suffix}`;

beforeAll(async () => {
  await runMigrations(migrationPool);
  await database.client.insert(packages).values({
    packageId,
    type: 'skill',
    name: 'PostgreSQL 分析套件',
    purpose: '驗證期間查詢',
    ownerTeam: 'platform',
    category: 'analytics',
    visibility: 'internal',
    sourceUri: 'https://example.invalid/postgres-analytics',
    license: 'MIT',
    lifecycle: 'active'
  });
  await database.client.insert(packageVersions).values({
    packageId,
    version: '1.0.0',
    supportedOs: ['linux'],
    supportedClients: [{
      name: 'codex',
      adaptationSource: 'publisher',
      maintainer: 'platform'
    }],
    lifecycle: 'published',
    installCommand: 'install',
    uninstallCommand: 'uninstall',
    hasResidualEffects: false,
    authorUid: 'postgres-analytics-author'
  });
  await database.client.insert(installations).values([
    {
      idempotencyKey: `before-${suffix}`,
      packageId,
      version: '1.0.0',
      userRef: uid,
      userRefType: 'uid',
      osType: 'linux',
      clientRuntime: 'codex',
      status: 'downloaded',
      startedAt: new Date('2026-08-24T23:59:59.999Z'),
      endedAt: new Date('2026-08-25T00:00:00.100Z'),
      payloadFingerprint: `before-fingerprint-${suffix}`,
      createdAt: new Date('2026-08-25T12:00:00.000Z')
    },
    {
      idempotencyKey: `start-boundary-${suffix}`,
      packageId,
      version: '1.0.0',
      userRef: uid,
      userRefType: 'uid',
      osType: 'linux',
      clientRuntime: 'codex',
      status: 'downloaded',
      startedAt: new Date('2026-08-25T00:00:00.000Z'),
      endedAt: new Date('2026-08-25T00:00:00.100Z'),
      payloadFingerprint: `start-boundary-fingerprint-${suffix}`,
      createdAt: new Date('2026-08-25T12:00:00.000Z')
    },
    {
      idempotencyKey: `inside-${suffix}`,
      packageId,
      version: '1.0.0',
      userRef: uid,
      userRefType: 'uid',
      osType: 'linux',
      clientRuntime: 'codex',
      status: 'succeeded',
      startedAt: new Date('2026-08-25T10:00:00.000Z'),
      endedAt: new Date('2026-08-25T10:00:10.000Z'),
      payloadFingerprint: `inside-fingerprint-${suffix}`,
      createdAt: new Date('2026-08-26T12:00:00.000Z')
    },
    {
      idempotencyKey: `end-boundary-${suffix}`,
      packageId,
      version: '1.0.0',
      userRef: uid,
      userRefType: 'uid',
      osType: 'linux',
      clientRuntime: 'codex',
      status: 'failed',
      errorCode: 'E002',
      startedAt: new Date('2026-08-25T23:59:59.999Z'),
      endedAt: new Date('2026-08-26T00:00:00.999Z'),
      payloadFingerprint: `end-boundary-fingerprint-${suffix}`,
      createdAt: new Date('2026-08-26T12:00:00.000Z')
    },
    {
      idempotencyKey: `after-${suffix}`,
      packageId,
      version: '1.0.0',
      userRef: `other-${uid}`,
      userRefType: 'uid',
      osType: 'windows',
      clientRuntime: 'claude-code',
      status: 'failed',
      errorCode: 'E002',
      startedAt: new Date('2026-08-26T00:00:00.000Z'),
      endedAt: new Date('2026-08-26T00:00:01.000Z'),
      payloadFingerprint: `after-fingerprint-${suffix}`,
      createdAt: new Date('2026-08-25T12:00:00.000Z')
    }
  ]);
});

afterAll(async () => {
  await database.client.delete(installations).where(eq(installations.packageId, packageId));
  await database.client.delete(packageVersions).where(eq(packageVersions.packageId, packageId));
  await database.client.delete(packages).where(eq(packages.packageId, packageId));
  await Promise.all([database.close(), migrationPool.end()]);
});

describe('PostgreSQL 分析儲存庫', () => {
  it('套件期間只讀取 startedAt 落在閉區間內的遙測事實', async () => {
    const metadata = await repository.findPackageMetadata(packageId);
    const telemetry = await repository.findPackageTelemetry(packageId, {
      start: new Date('2026-08-25T00:00:00.000Z'),
      end: new Date('2026-08-25T23:59:59.999Z')
    });

    expect(metadata.package).toMatchObject({ packageId, name: 'PostgreSQL 分析套件' });
    expect(metadata.versions).toHaveLength(1);
    expect(telemetry.map((record) => record.idempotencyKey)).toEqual([
      `start-boundary-${suffix}`,
      `inside-${suffix}`,
      `end-boundary-${suffix}`
    ]);
  });

  it('我的安裝依 UID 路徑返回完整套件、版本與全部歷史事件', async () => {
    const dataset = await repository.findUserDataset(uid);

    expect(dataset.packages.map((item) => item.packageId)).toEqual([packageId]);
    expect(dataset.versions.map((item) => item.version)).toEqual(['1.0.0']);
    expect(dataset.telemetry.map((record) => record.idempotencyKey)).toEqual([
      `before-${suffix}`,
      `start-boundary-${suffix}`,
      `inside-${suffix}`,
      `end-boundary-${suffix}`
    ]);
  });

  it('分析 migration 建立普通查詢索引且 public schema 維持零外鍵', async () => {
    const indexes = await database.client.execute<{ indexname: string; indexdef: string }>(sql`
      select indexname, indexdef from pg_indexes
      where schemaname = 'public' and tablename = 'installations'
    `);
    const foreignKeys = await database.client.execute<{ count: string }>(sql`
      select count(*)::text as count from pg_constraint
      where contype = 'f' and connamespace = 'public'::regnamespace
    `);

    const packagePeriodIndex = indexes.rows.find(
      (row) => row.indexname === 'installations_package_started_at_idx'
    );
    expect(packagePeriodIndex?.indexdef).toContain('(package_id, started_at)');
    expect(foreignKeys.rows[0]?.count).toBe('0');
  });
});
