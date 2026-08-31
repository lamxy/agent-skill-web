// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runMigrations } from '../../scripts/migrate-database.js';
import { PostgresAuditRepository } from '../../src/modules/audit/postgres-audit-repository.js';
import { createPostgresDatabase } from '../../src/shared/database/postgres-database.js';
import { auditLogs } from '../../src/shared/database/schema.js';

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:55432/agent_skill_platform';
const migrationPool = new Pool({ connectionString: databaseUrl, max: 1 });
const database = createPostgresDatabase(databaseUrl);
const repository = new PostgresAuditRepository(database.client);

beforeAll(async () => {
  await runMigrations(migrationPool);
});

afterAll(async () => {
  await Promise.all([database.close(), migrationPool.end()]);
});

describe('PostgresAuditRepository', () => {
  it('寫入後可按操作者與事件類型組合查詢', async () => {
    const actorUid = `audit-test-${randomUUID()}`;
    await repository.append({
      eventType: 'reviewer.assigned',
      actorUid,
      targetType: 'role',
      targetId: 'assignment-1',
      action: 'assign_reviewer',
      details: { category: 'frontend' },
      occurredAt: new Date('2026-08-25T04:00:00.000Z')
    });
    await repository.append({
      eventType: 'reviewer.revoked',
      actorUid,
      targetType: 'role',
      targetId: 'assignment-1',
      action: 'revoke_reviewer',
      details: { category: 'frontend' },
      occurredAt: new Date('2026-08-25T05:00:00.000Z')
    });

    const rows = await repository.list({
      actorUid,
      eventType: 'reviewer.revoked',
      limit: 10
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      eventType: 'reviewer.revoked',
      actorUid,
      targetId: 'assignment-1'
    });
  });

  it('資料庫拒絕 UPDATE 與 DELETE 並保留原始審計內容', async () => {
    const actorUid = `immutable-test-${randomUUID()}`;
    const created = await repository.append({
      eventType: 'admin.role_granted',
      actorUid,
      targetType: 'role',
      targetId: 'role-1',
      action: 'grant_role',
      details: { role: 'reviewer' },
      occurredAt: new Date('2026-08-25T06:00:00.000Z')
    });

    await expect(
      database.client
        .update(auditLogs)
        .set({ action: 'tampered' })
        .where(eq(auditLogs.id, BigInt(created.id)))
    ).rejects.toMatchObject({ cause: { code: '55000' } });
    await expect(
      database.client
        .delete(auditLogs)
        .where(eq(auditLogs.id, BigInt(created.id)))
    ).rejects.toMatchObject({ cause: { code: '55000' } });

    const rows = await repository.list({ actorUid, limit: 10 });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe('grant_role');
  });
});
