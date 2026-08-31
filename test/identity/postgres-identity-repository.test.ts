// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { eq, sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { runMigrations } from '../../scripts/migrate-database.js';
import { PostgresIdentityRepository } from '../../src/modules/identity/postgres-identity-repository.js';
import { createPostgresDatabase } from '../../src/shared/database/postgres-database.js';
import {
  auditLogs,
  domainEvents,
  identities,
  identitySessions,
  packages,
  reviewerAssignments,
  roleAssignments
} from '../../src/shared/database/schema.js';

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:55432/agent_skill_platform';
const now = new Date('2026-08-25T00:00:00.000Z');

const migrationPool = new Pool({ connectionString: databaseUrl, max: 1 });
const database = createPostgresDatabase(databaseUrl);
const repository = new PostgresIdentityRepository(database.client);

beforeAll(async () => {
  await runMigrations(migrationPool);
});

beforeEach(async () => {
  await database.client.delete(domainEvents);
  await database.client.delete(reviewerAssignments);
  await database.client.delete(roleAssignments);
  await database.client.delete(identitySessions);
  await database.client.delete(identities);
  await database.client.delete(packages);
});

afterAll(async () => {
  await Promise.all([database.close(), migrationPool.end()]);
});

describe('PostgresIdentityRepository', () => {
  it('保存反範式身份快照、session 摘要及疊加角色', async () => {
    await repository.upsertIdentity({
      uid: 'user-1',
      displayName: '使用者一',
      teamIds: ['team-a', 'team-b'],
      providerType: 'development',
      active: true,
      createdAt: now,
      updatedAt: now
    });
    await repository.createSession({
      sessionDigest: 'digest-1',
      uid: 'user-1',
      expiresAt: new Date('2026-08-26T00:00:00.000Z'),
      lastSeenAt: now,
      createdAt: now
    });
    await repository.grantRole({
      id: '123e4567-e89b-42d3-a456-426614174010',
      uid: 'user-1',
      role: 'employee',
      scopeType: 'global',
      scopeValue: '',
      assignedByUid: 'bootstrap',
      active: true,
      createdAt: now
    });
    await repository.grantRole({
      id: '123e4567-e89b-42d3-a456-426614174011',
      uid: 'user-1',
      role: 'reviewer',
      scopeType: 'category',
      scopeValue: 'frontend',
      assignedByUid: 'admin-1',
      active: true,
      createdAt: now
    });

    await expect(repository.findIdentity('user-1')).resolves.toMatchObject({
      uid: 'user-1',
      teamIds: ['team-a', 'team-b']
    });
    const storedSession = await repository.findSession('digest-1');
    expect(storedSession).toMatchObject({ uid: 'user-1' });
    expect(storedSession).not.toHaveProperty('revokedAt');
    await expect(repository.listActiveRoles('user-1')).resolves.toHaveLength(
      2
    );
  });

  it('在同一交易新增及撤銷審核人指派與稽核事件', async () => {
    await repository.upsertIdentity({
      uid: 'reviewer-1',
      displayName: '審核人一',
      teamIds: ['team-b'],
      providerType: 'development',
      active: true,
      createdAt: now,
      updatedAt: now
    });

    const assignment = await repository.assignReviewer(
      'admin-1',
      {
        reviewerUid: 'reviewer-1',
        packageType: 'skill',
        category: 'frontend'
      },
      now
    );
    const revoked = await repository.revokeReviewer(
      'admin-1',
      assignment.id,
      new Date('2026-08-25T01:00:00.000Z')
    );
    const repeated = await repository.revokeReviewer(
      'admin-1',
      assignment.id,
      new Date('2026-08-25T02:00:00.000Z')
    );
    const events = await database.client
      .select({ eventType: domainEvents.eventType })
      .from(domainEvents)
      .where(eq(domainEvents.aggregateId, assignment.id))
      .orderBy(domainEvents.occurredAt);
    const audits = await database.client
      .select({ eventType: auditLogs.eventType, actorUid: auditLogs.actorUid })
      .from(auditLogs)
      .where(eq(auditLogs.targetId, assignment.id))
      .orderBy(auditLogs.occurredAt);

    expect(revoked?.active).toBe(false);
    expect(repeated?.revokedAt).toEqual(revoked?.revokedAt);
    expect(events).toEqual([
      { eventType: 'reviewer.assigned' },
      { eventType: 'reviewer.revoked' }
    ]);
    expect(audits).toEqual([
      { eventType: 'reviewer.assigned', actorUid: 'admin-1' },
      { eventType: 'reviewer.revoked', actorUid: 'admin-1' }
    ]);
  });

  it('只列出有效審核人指派並依建立時間與 ID 穩定倒序', async () => {
    await database.client.insert(reviewerAssignments).values([
      {
        id: '123e4567-e89b-42d3-a456-426614174001',
        reviewerUid: 'reviewer-1',
        packageType: 'skill',
        category: 'frontend',
        assignedByUid: 'admin-1',
        active: true,
        createdAt: new Date('2026-08-24T00:00:00.000Z')
      },
      {
        id: '123e4567-e89b-42d3-a456-426614174003',
        reviewerUid: 'reviewer-3',
        packageType: 'plugin',
        category: 'backend',
        assignedByUid: 'admin-1',
        active: true,
        createdAt: new Date('2026-08-25T00:00:00.000Z')
      },
      {
        id: '123e4567-e89b-42d3-a456-426614174002',
        reviewerUid: 'reviewer-2',
        packageType: 'skill',
        category: 'backend',
        assignedByUid: 'admin-1',
        active: true,
        createdAt: new Date('2026-08-25T00:00:00.000Z')
      },
      {
        id: '123e4567-e89b-42d3-a456-426614174004',
        reviewerUid: 'reviewer-revoked',
        packageType: 'skill',
        category: 'security',
        assignedByUid: 'admin-1',
        active: false,
        createdAt: new Date('2026-08-26T00:00:00.000Z'),
        revokedAt: new Date('2026-08-27T00:00:00.000Z'),
        revokedByUid: 'admin-1'
      }
    ]);

    const assignments = await repository.listActiveReviewerAssignments();

    expect(assignments.map(({ id }) => id)).toEqual([
      '123e4567-e89b-42d3-a456-426614174003',
      '123e4567-e89b-42d3-a456-426614174002',
      '123e4567-e89b-42d3-a456-426614174001'
    ]);
    expect(assignments.every(({ active }) => active)).toBe(true);
  });

  it('以套件邏輯 ID 讀取授權快照且資料庫沒有外鍵', async () => {
    await database.client.insert(packages).values({
      packageId: 'pkg-1',
      type: 'skill',
      name: '前端技能',
      ownerTeam: 'team-a',
      category: 'frontend',
      sourceUri: 'https://example.invalid/pkg-1',
      license: 'MIT'
    });

    const snapshot = await repository.findPackageSnapshot('pkg-1');
    const foreignKeys = await database.client.execute<{ count: string }>(sql`
      select count(*)::text as count
      from pg_constraint
      where contype = 'f'
        and connamespace = 'public'::regnamespace
    `);

    expect(snapshot).toEqual({
      packageId: 'pkg-1',
      ownerTeam: 'team-a',
      packageType: 'skill',
      category: 'frontend'
    });
    expect(foreignKeys.rows[0]?.count).toBe('0');
  });

  it('業務交易回滾時 reviewer 指派與審計事件都不存在', async () => {
    await database.client.execute(sql`
      create or replace function fail_reviewer_domain_event_for_test()
      returns trigger
      language plpgsql
      as $test_failure$
      begin
        if new.event_type = 'reviewer.assigned'
          and new.payload ->> 'actorUid' = 'rollback-admin'
        then
          raise exception 'forced outbox failure';
        end if;
        return new;
      end;
      $test_failure$
    `);
    await database.client.execute(sql`
      create trigger fail_reviewer_domain_event_for_test
      before insert on domain_events
      for each row
      execute function fail_reviewer_domain_event_for_test()
    `);

    try {
      await expect(
        repository.assignReviewer(
          'rollback-admin',
          {
            reviewerUid: 'rollback-reviewer',
            packageType: 'skill',
            category: 'rollback-test'
          },
          now
        )
      ).rejects.toMatchObject({
        cause: { message: 'forced outbox failure' }
      });

      await expect(
        repository.findActiveReviewerAssignment(
          'rollback-reviewer',
          'skill',
          'rollback-test'
        )
      ).resolves.toBeUndefined();
      const audits = await database.client
        .select({ id: auditLogs.id })
        .from(auditLogs)
        .where(eq(auditLogs.actorUid, 'rollback-admin'));
      expect(audits).toEqual([]);
    } finally {
      await database.client.execute(sql`
        drop trigger if exists fail_reviewer_domain_event_for_test
        on domain_events
      `);
      await database.client.execute(sql`
        drop function if exists fail_reviewer_domain_event_for_test()
      `);
    }
  });
});
