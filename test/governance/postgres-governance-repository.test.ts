// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { and, eq, sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runMigrations } from '../../scripts/migrate-database.js';
import { PostgresGovernanceRepository } from '../../src/modules/governance/postgres-governance-repository.js';
import type { CatalogAggregate, PackageVersionRecord } from '../../src/modules/catalog/types.js';
import { PostgresCatalogRepository } from '../../src/modules/catalog/postgres-catalog-repository.js';
import { VALIDATION_RETRY_CLAIM_TTL_MS } from '../../src/modules/governance/repository.js';
import { createPostgresDatabase } from '../../src/shared/database/postgres-database.js';
import {
  auditLogs,
  domainEvents,
  installations,
  packageVersionScriptTargets,
  packageVersions,
  packages,
  publicationReviews,
  scriptTargetRevisions,
  userNotifications,
  validationRuns,
  versionDelistings
} from '../../src/shared/database/schema.js';

const databaseUrl = process.env.TEST_DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:55432/agent_skill_platform';
const adminPool = new Pool({ connectionString: databaseUrl, max: 1 });
const suiteDatabaseName = `governance_repository_${randomUUID().replaceAll('-', '')}`;
const suiteDatabaseUrl = new URL(databaseUrl);
suiteDatabaseUrl.pathname = `/${suiteDatabaseName}`;
let migrationPool!: Pool;
let database!: ReturnType<typeof createPostgresDatabase>;
let repository!: PostgresGovernanceRepository;

const startedAt = new Date('2026-08-25T10:00:00.000Z');
const completedAt = new Date('2026-08-25T10:05:00.000Z');
const decidedAt = new Date('2026-08-25T10:10:00.000Z');

function packageId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

function aggregateFor(id: string, lifecycle: PackageVersionRecord['lifecycle'] = 'draft'): CatalogAggregate {
  const createdAt = new Date('2026-08-25T09:00:00.000Z');
  const targetId = `${id}-linux-codex`;
  const revision = {
    id: `${targetId}-v1`, targetId, targetOs: 'linux/macos' as const,
    clientRuntime: 'codex' as const, scriptVersion: 1,
    installCommand: 'echo install', uninstallCommand: 'echo uninstall', options: [],
    usageInstructions: '執行安裝腳本', hasResidualEffects: false,
    contentDigest: 'sha256:governance-target-v1', legacyImported: false,
    createdByUid: 'author-uid', createdAt
  };
  return {
    package: {
      packageId: id,
      type: 'skill',
      name: '治理整合測試技能',
      purpose: '驗證發布治理交易',
      ownerTeam: 'platform-team',
      category: 'backend',
      categoryCode: 'backend',
      visibility: 'internal',
      sourceUri: 'https://example.invalid/governance-skill',
      license: 'MIT',
      source: 'custom',
      publisher: { kind: 'organization', name: '平台組' },
      grade: 'basic',
      lifecycle: 'active',
      createdAt,
      updatedAt: createdAt
    },
    versions: [{
      id: '尚未持久化',
      packageId: id,
      version: '1.0.0',
      releaseNotes: '第一版',
      supportedOs: ['linux', 'windows'],
      supportedClients: [
        { name: 'codex', adaptationSource: 'publisher', maintainer: 'platform-team' },
        { name: 'claude code', adaptationSource: 'maintainer', maintainer: 'platform-team' }
      ],
      lifecycle,
      scriptDigest: 'sha256:governance-test',
      installCommand: 'echo install',
      uninstallCommand: 'echo uninstall',
      hasResidualEffects: false,
      scriptTargets: [{
        id: targetId, packageId: id, packageVersion: '1.0.0', targetOs: 'linux/macos',
        clientRuntime: 'codex', currentRevision: revision, revisions: [revision],
        createdAt, updatedAt: createdAt
      }],
      authorUid: 'author-uid',
      createdAt,
      updatedAt: createdAt
    }],
    adoption: { installations: 0, succeeded: 0, successRate: null }
  };
}

async function seedAggregate(
  id: string,
  lifecycle: PackageVersionRecord['lifecycle'] = 'draft'
): Promise<CatalogAggregate> {
  const aggregate = aggregateFor(id, lifecycle);
  await database.client.insert(packages).values({
    ...aggregate.package,
    type: aggregate.package.type,
    lifecycle: aggregate.package.lifecycle
  });
  const version = aggregate.versions[0]!;
  const rows = await database.client.insert(packageVersions).values({
    packageId: version.packageId,
    version: version.version,
    releaseNotes: version.releaseNotes,
    supportedOs: version.supportedOs,
    supportedClients: version.supportedClients,
    lifecycle,
    scriptDigest: version.scriptDigest,
    installCommand: version.installCommand,
    uninstallCommand: version.uninstallCommand,
    hasResidualEffects: version.hasResidualEffects,
    authorUid: version.authorUid,
    createdAt: version.createdAt,
    updatedAt: version.updatedAt
  }).returning();
  aggregate.versions[0] = {
    ...aggregate.versions[0]!,
    id: String(rows[0]!.id)
  };
  const target = aggregate.versions[0]!.scriptTargets![0]!;
  const revision = target.currentRevision!;
  await database.client.insert(packageVersionScriptTargets).values({
    id: target.id,
    packageId: target.packageId,
    packageVersion: target.packageVersion,
    targetOs: target.targetOs,
    clientRuntime: target.clientRuntime,
    currentRevisionId: revision.id,
    createdAt: target.createdAt,
    updatedAt: target.updatedAt
  });
  await database.client.insert(scriptTargetRevisions).values({
    id: revision.id,
    targetId: revision.targetId,
    targetOs: revision.targetOs,
    clientRuntime: revision.clientRuntime,
    scriptVersion: revision.scriptVersion,
    installCommand: revision.installCommand,
    uninstallCommand: revision.uninstallCommand,
    options: revision.options,
    usageInstructions: revision.usageInstructions,
    hasResidualEffects: revision.hasResidualEffects,
    contentDigest: revision.contentDigest,
    legacyImported: revision.legacyImported,
    createdByUid: revision.createdByUid,
    createdAt: revision.createdAt
  });
  return aggregate;
}

function passedResult(run: { expectedMatrix: Array<{ os: string; client: string; targetId?: string; scriptVersion?: number; contentDigest?: string }> }) {
  return {
    status: 'passed' as const,
    runnerVersion: 'runner-suite/1.0.0',
    matrixResults: run.expectedMatrix.map((target) => ({
      ...target,
      runnerName: target.os === 'windows' ? 'powershell-wsl' : 'docker-linux',
      runnerVersion: '1.0.0',
      scriptDigest: 'sha256:generated-install',
      installScriptDigest: 'sha256:generated-install',
      uninstallScriptDigest: 'sha256:generated-uninstall',
      startedAt,
      endedAt: completedAt,
      installExitCode: 0,
      telemetrySeen: true,
      uninstallExitCode: 0,
      cleanupSucceeded: true,
      status: 'passed' as const
    }))
  };
}

async function rejectOutboxFor(aggregateId: string): Promise<() => Promise<void>> {
  const literal = aggregateId.replaceAll("'", "''");
  await migrationPool.query(`
    CREATE OR REPLACE FUNCTION reject_governance_outbox_for_test()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.aggregate_id = '${literal}' THEN
        RAISE EXCEPTION '測試強制 governance outbox 失敗';
      END IF;
      RETURN NEW;
    END
    $$;
    CREATE TRIGGER reject_governance_outbox_for_test_trigger
    BEFORE INSERT ON domain_events
    FOR EACH ROW EXECUTE FUNCTION reject_governance_outbox_for_test();
  `);
  return async () => {
    await migrationPool.query(
      'DROP TRIGGER IF EXISTS reject_governance_outbox_for_test_trigger ON domain_events'
    );
    await migrationPool.query('DROP FUNCTION IF EXISTS reject_governance_outbox_for_test()');
  };
}

beforeAll(async () => {
  await adminPool.query(`CREATE DATABASE "${suiteDatabaseName}"`);
  migrationPool = new Pool({ connectionString: suiteDatabaseUrl.toString(), max: 1 });
  database = createPostgresDatabase(suiteDatabaseUrl.toString());
  repository = new PostgresGovernanceRepository(database.client);
  await runMigrations(migrationPool);
});
afterAll(async () => {
  await Promise.all([database.close(), migrationPool.end()]);
  await adminPool.query(`DROP DATABASE "${suiteDatabaseName}" WITH (FORCE)`);
  await adminPool.end();
});

describe('PostgresGovernanceRepository', () => {
  it('提交、完成驗證與批准在七類資料表留下完整快照', async () => {
    const id = packageId('governance-flow');
    const aggregate = await seedAggregate(id);
    const begun = await repository.beginValidation({
      aggregate,
      version: aggregate.versions[0]!,
      actorUid: 'maintainer-uid',
      occurredAt: startedAt
    });
    const completed = await repository.completeValidation({
      validationRunId: begun.validationRun.id,
      result: passedResult(begun.validationRun),
      occurredAt: completedAt
    });
    const decided = await repository.decideReview({
      reviewId: completed.review!.id,
      decision: 'approve',
      reason: '矩陣與遙測證據完整',
      actorUid: 'reviewer-uid',
      occurredAt: decidedAt
    });

    const versionRows = await database.client.select({ lifecycle: packageVersions.lifecycle })
      .from(packageVersions).where(eq(packageVersions.packageId, id));
    const reviewRows = await database.client.select({
      id: publicationReviews.id,
      legacyRecordId: publicationReviews.legacyRecordId,
      legacyPackageVersionId: publicationReviews.legacyPackageVersionId,
      packageId: publicationReviews.packageId,
      version: publicationReviews.version,
      packageType: publicationReviews.packageType,
      category: publicationReviews.category,
      ownerTeam: publicationReviews.ownerTeam,
      authorUid: publicationReviews.authorUid,
      packageSnapshot: publicationReviews.packageSnapshot,
      versionSnapshot: publicationReviews.versionSnapshot,
      validationRunId: publicationReviews.validationRunId,
      reviewerUid: publicationReviews.reviewerUid,
      status: publicationReviews.status,
      decisionReason: publicationReviews.decisionReason
    }).from(publicationReviews)
      .where(eq(publicationReviews.packageId, id));
    const runRows = await database.client.select().from(validationRuns)
      .where(eq(validationRuns.packageId, id));
    const auditRows = await database.client.select({ eventType: auditLogs.eventType })
      .from(auditLogs).where(eq(auditLogs.targetId, `${id}@1.0.0`))
      .orderBy(auditLogs.occurredAt);
    const eventRows = await database.client.select({
      eventType: domainEvents.eventType,
      payload: domainEvents.payload
    }).from(domainEvents).where(eq(domainEvents.aggregateId, `${id}@1.0.0`))
      .orderBy(domainEvents.occurredAt);

    expect(decided.version.lifecycle).toBe('published');
    expect(versionRows).toEqual([{ lifecycle: 'published' }]);
    expect(reviewRows).toEqual([expect.objectContaining({
      id: completed.review!.id,
      legacyRecordId: null,
      legacyPackageVersionId: null,
      packageId: id,
      version: '1.0.0',
      packageType: 'skill',
      category: 'backend',
      ownerTeam: 'platform-team',
      authorUid: 'author-uid',
      packageSnapshot: expect.objectContaining({
        packageId: id,
        name: '治理整合測試技能',
        category: 'backend',
        ownerTeam: 'platform-team'
      }),
      versionSnapshot: expect.objectContaining({
        packageId: id,
        version: '1.0.0',
        releaseNotes: '第一版',
        installCommand: 'echo install',
        uninstallCommand: 'echo uninstall',
        scriptDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        scriptManifestDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        scriptTargets: [expect.objectContaining({ targetOs: 'linux/macos', clientRuntime: 'codex' })]
      }),
      validationRunId: begun.validationRun.id,
      reviewerUid: 'reviewer-uid',
      status: 'approved',
      decisionReason: '矩陣與遙測證據完整'
    })]);
    expect(runRows).toEqual([expect.objectContaining({
      id: begun.validationRun.id,
      packageId: id,
      status: 'passed',
      contractVersion: 2,
      targetSnapshots: [expect.objectContaining({ targetOs: 'linux/macos', clientRuntime: 'codex' })],
      manifestDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      expectedMatrix: [expect.objectContaining({ os: 'linux/macos', client: 'codex' })],
      attempts: [expect.objectContaining({ attempt: 1, kind: 'initial', status: 'passed' })],
      matrixResults: expect.arrayContaining([
        expect.objectContaining({ os: 'linux/macos', client: 'codex', telemetrySeen: true })
      ]),
      retryClaimToken: null,
      retryClaimedAt: null
    })]);
    expect(auditRows).toEqual([
      { eventType: 'version.validation_started' },
      { eventType: 'version.validation_passed' },
      { eventType: 'version.published' }
    ]);
    expect(eventRows.map((row) => row.eventType)).toEqual([
      'version.validation_started',
      'version.review_requested',
      'version.published'
    ]);
    expect(eventRows[1]?.payload).toEqual(expect.objectContaining({
      lifecycle: 'review_required',
      reviewId: completed.review!.id
    }));

    const catalogRepository = new PostgresCatalogRepository(database.client);
    expect(
      (await catalogRepository.findAggregate(id))?.versions[0]?.lifecycle
    ).toBe('published');
    await repository.updateVersionContent({
      packageId: id,
      version: '1.0.0',
      actorUid: 'maintainer-uid',
      patch: { releaseNotes: '發布後修訂內容' },
      occurredAt: new Date('2026-08-25T00:04:00.000Z')
    });
    await catalogRepository.updatePackage(
      'maintainer-uid',
      id,
      { name: '後續修改名稱', category: 'frontend' },
      new Date('2026-08-25T00:05:00.000Z')
    );
    expect(
      (await catalogRepository.findAggregate(id))?.versions[0]
    ).toMatchObject({
      lifecycle: 'draft',
      releaseNotes: '發布後修訂內容'
    });
    expect(await repository.findReview(completed.review!.id)).toMatchObject({
      packageSnapshot: {
        name: '治理整合測試技能',
        category: 'backend'
      },
      versionSnapshot: {
        releaseNotes: '第一版',
        installCommand: 'echo install',
        scriptDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        scriptManifestDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/)
      }
    });
  });

  it('重試 claim 在 TTL 前一毫秒仍可完成', async () => {
    const id = packageId('governance-retry-valid-lease');
    const aggregate = await seedAggregate(id);
    const begun = await repository.beginValidation({
      aggregate,
      version: aggregate.versions[0]!,
      actorUid: 'maintainer-uid',
      occurredAt: startedAt
    });
    const retryAt = new Date('2026-08-25T10:02:00.000Z');
    const claimed = await repository.claimValidationRetry({
      validationRunId: begun.validationRun.id,
      actorUid: 'maintainer-uid',
      occurredAt: retryAt
    });
    const beforeExpiry = new Date(retryAt.getTime() + VALIDATION_RETRY_CLAIM_TTL_MS - 1);

    const completed = await repository.completeValidation({
      validationRunId: begun.validationRun.id,
      retryClaimToken: claimed.retryClaimToken,
      result: {
        status: 'failed',
        runnerVersion: 'runner-suite/1.0.0',
        matrixResults: [],
        errorCode: 'runner_failed'
      },
      occurredAt: beforeExpiry
    });

    expect(completed.version.lifecycle).toBe('draft');
    expect(completed.validationRun).toEqual(expect.objectContaining({
      status: 'failed',
      endedAt: beforeExpiry,
      attempts: expect.arrayContaining([
        expect.objectContaining({ attempt: 2, status: 'failed', endedAt: beforeExpiry })
      ])
    }));
  });

  it('重試 claim 在 TTL 邊界拒絕完成且保持狀態後才允許回收', async () => {
    const id = packageId('governance-retry');
    const aggregate = await seedAggregate(id);
    const begun = await repository.beginValidation({
      aggregate,
      version: aggregate.versions[0]!,
      actorUid: 'maintainer-uid',
      occurredAt: startedAt
    });
    const retryAt = new Date('2026-08-25T10:02:00.000Z');
    const claimed = await repository.claimValidationRetry({
      validationRunId: begun.validationRun.id,
      actorUid: 'maintainer-uid',
      occurredAt: retryAt
    });
    const beforeExpiry = new Date(retryAt.getTime() + VALIDATION_RETRY_CLAIM_TTL_MS - 1);
    const expiresAt = new Date(retryAt.getTime() + VALIDATION_RETRY_CLAIM_TTL_MS);

    await expect(repository.claimValidationRetry({
      validationRunId: begun.validationRun.id,
      actorUid: 'maintainer-uid',
      occurredAt: beforeExpiry
    })).rejects.toMatchObject({ code: 'VALIDATION_RETRY_ALREADY_CLAIMED', statusCode: 409 });
    expect(claimed.validationRun.retryClaimedAt).toEqual(retryAt);

    await expect(repository.completeValidation({
      validationRunId: begun.validationRun.id,
      retryClaimToken: claimed.retryClaimToken,
      result: passedResult(begun.validationRun),
      occurredAt: expiresAt
    })).rejects.toMatchObject({
      code: 'VALIDATION_RETRY_CLAIM_EXPIRED',
      statusCode: 409,
      message: '驗證重試 claim 已過期'
    });
    const versionBeforeReclaim = await database.client.select({
      lifecycle: packageVersions.lifecycle
    }).from(packageVersions).where(eq(packageVersions.packageId, id));
    const runBeforeReclaim = await repository.findValidationRun(begun.validationRun.id);
    const reviewsBeforeReclaim = await database.client.select().from(publicationReviews)
      .where(eq(publicationReviews.packageId, id));
    const auditsBeforeReclaim = await database.client.select({ eventType: auditLogs.eventType })
      .from(auditLogs).where(eq(auditLogs.targetId, `${id}@1.0.0`))
      .orderBy(auditLogs.occurredAt);
    const eventsBeforeReclaim = await database.client.select({ eventType: domainEvents.eventType })
      .from(domainEvents).where(eq(domainEvents.aggregateId, `${id}@1.0.0`))
      .orderBy(domainEvents.occurredAt);

    expect(versionBeforeReclaim).toEqual([{ lifecycle: 'validating' }]);
    expect(runBeforeReclaim).toEqual(expect.objectContaining({
      status: 'running',
      retryClaimToken: claimed.retryClaimToken,
      retryClaimedAt: retryAt,
      attempts: [
        expect.objectContaining({ attempt: 1, status: 'abandoned' }),
        expect.objectContaining({ attempt: 2, status: 'running' })
      ]
    }));
    expect(reviewsBeforeReclaim).toEqual([]);
    expect(auditsBeforeReclaim).toEqual([
      { eventType: 'version.validation_started' },
      { eventType: 'version.validation_retry_started' }
    ]);
    expect(eventsBeforeReclaim).toEqual([
      { eventType: 'version.validation_started' },
      { eventType: 'version.validation_retry_started' }
    ]);

    const reclaimed = await repository.claimValidationRetry({
      validationRunId: begun.validationRun.id,
      actorUid: 'maintainer-uid',
      occurredAt: expiresAt
    });
    expect(reclaimed.retryClaimToken).not.toBe(claimed.retryClaimToken);
    expect(reclaimed.validationRun.retryClaimedAt).toEqual(expiresAt);
    expect(reclaimed.validationRun.attempts).toEqual([
      expect.objectContaining({
        attempt: 1,
        status: 'abandoned',
        errorCode: 'validation_attempt_abandoned'
      }),
      expect.objectContaining({
        attempt: 2,
        status: 'abandoned',
        endedAt: expiresAt,
        errorCode: 'validation_retry_claim_expired'
      }),
      expect.objectContaining({ attempt: 3, status: 'running' })
    ]);
    await expect(repository.completeValidation({
      validationRunId: begun.validationRun.id,
      retryClaimToken: claimed.retryClaimToken,
      result: { status: 'failed', runnerVersion: 'runner-suite/1.0.0', matrixResults: [], errorCode: 'runner_failed' },
      occurredAt: new Date(expiresAt.getTime() + 1)
    })).rejects.toMatchObject({ code: 'VALIDATION_RETRY_CLAIM_CONFLICT', statusCode: 409 });
    const afterStaleCompletion = await repository.findValidationRun(begun.validationRun.id);
    expect(afterStaleCompletion).toEqual(expect.objectContaining({
      retryClaimToken: reclaimed.retryClaimToken,
      retryClaimedAt: expiresAt,
      attempts: expect.arrayContaining([
        expect.objectContaining({ attempt: 3, status: 'running' })
      ])
    }));

    const retryCompletedAt = new Date(expiresAt.getTime() + 60_000);
    const completed = await repository.completeValidation({
      validationRunId: begun.validationRun.id,
      retryClaimToken: reclaimed.retryClaimToken,
      result: { status: 'failed', runnerVersion: 'runner-suite/1.0.0', matrixResults: [], errorCode: 'runner_failed' },
      occurredAt: retryCompletedAt
    });
    const persisted = await repository.findValidationRun(begun.validationRun.id);

    expect(completed.version.lifecycle).toBe('draft');
    expect(persisted).toEqual(expect.objectContaining({
      status: 'failed',
      errorCode: 'runner_failed',
      attempts: [
        expect.objectContaining({ attempt: 1, kind: 'initial', status: 'abandoned', errorCode: 'validation_attempt_abandoned' }),
        expect.objectContaining({ attempt: 2, kind: 'retry', status: 'abandoned', errorCode: 'validation_retry_claim_expired' }),
        expect.objectContaining({ attempt: 3, kind: 'retry', status: 'failed', errorCode: 'runner_failed' })
      ]
    }));
    expect(persisted).not.toHaveProperty('retryClaimToken');
    expect(persisted).not.toHaveProperty('retryClaimedAt');
  });

  it('撤下按 UID 去重通知且忽略匿名 UUID', async () => {
    const id = packageId('governance-delist');
    const aggregate = await seedAggregate(id, 'published');
    const versionId = Number(aggregate.versions[0]!.id);
    await database.client.insert(installations).values([
      { legacyPackageVersionId: versionId, idempotencyKey: randomUUID(), userRef: 'affected-uid', userRefType: 'uid', osType: 'linux', clientRuntime: 'codex', status: 'downloaded', startedAt },
      { legacyPackageVersionId: versionId, idempotencyKey: randomUUID(), userRef: 'affected-uid', userRefType: 'uid', osType: 'windows', clientRuntime: 'claude code', status: 'succeeded', startedAt },
      { legacyPackageVersionId: versionId, idempotencyKey: randomUUID(), userRef: randomUUID(), userRefType: 'uuid', osType: 'linux', clientRuntime: 'codex', status: 'succeeded', startedAt },
      { legacyPackageVersionId: versionId, idempotencyKey: randomUUID(), userRef: 'failed-uid', userRefType: 'uid', osType: 'linux', clientRuntime: 'codex', status: 'failed', startedAt }
    ]);

    const result = await repository.delistVersion({
      packageId: id,
      version: '1.0.0',
      actorUid: 'maintainer-uid',
      reasonCode: 'publisher_request',
      reasonDetail: '套件由新版取代',
      effectiveAt: decidedAt,
      occurredAt: decidedAt
    });
    const delistingRows = await database.client.select().from(versionDelistings)
      .where(eq(versionDelistings.packageId, id));
    const notificationRows = await database.client.select().from(userNotifications)
      .where(eq(userNotifications.packageId, id));
    const listed = await repository.listNotifications({ recipientUid: 'affected-uid', status: 'unread' });
    const wrongRecipient = await repository.markNotificationRead(
      result.notifications[0]!.id,
      'other-uid',
      completedAt
    );
    const afterWrongRecipient = await database.client.select({ status: userNotifications.status })
      .from(userNotifications)
      .where(eq(userNotifications.id, result.notifications[0]!.id));
    const wrongRecipientAudits = await database.client.select().from(auditLogs)
      .where(and(
        eq(auditLogs.eventType, 'notification.read'),
        eq(auditLogs.actorUid, 'other-uid')
      ));
    const wrongRecipientEvents = await database.client.select().from(domainEvents)
      .where(and(
        eq(domainEvents.aggregateId, result.notifications[0]!.id),
        eq(domainEvents.eventType, 'notification.read')
      ));
    const marked = await repository.markNotificationRead(result.notifications[0]!.id, 'affected-uid', completedAt);

    expect(result.version.lifecycle).toBe('delisted');
    expect(result.notifications).toEqual([expect.objectContaining({ recipientUid: 'affected-uid' })]);
    expect(delistingRows).toEqual([expect.objectContaining({
      packageId: id,
      version: '1.0.0',
      reasonCode: 'publisher_request',
      reasonDetail: '套件由新版取代',
      actorUid: 'maintainer-uid'
    })]);
    expect(notificationRows).toEqual([expect.objectContaining({
      recipientUid: 'affected-uid',
      notificationType: 'version_delisted',
      status: 'unread',
      payload: { reasonCode: 'publisher_request', reasonDetail: '套件由新版取代' }
    })]);
    expect(listed).toHaveLength(1);
    expect(wrongRecipient).toBeUndefined();
    expect(afterWrongRecipient).toEqual([{ status: 'unread' }]);
    expect(wrongRecipientAudits).toEqual([]);
    expect(wrongRecipientEvents).toEqual([]);
    expect(marked).toEqual(expect.objectContaining({ status: 'read', readAt: completedAt }));
  });

  it('棄用與緊急停用在同交易失效並建立高優先 UID 通知', async () => {
    const id = packageId('governance-emergency');
    const aggregate = await seedAggregate(id, 'published');
    const versionId = Number(aggregate.versions[0]!.id);
    await database.client.insert(installations).values([
      {
        legacyPackageVersionId: versionId, idempotencyKey: randomUUID(),
        userRef: 'emergency-uid', userRefType: 'uid', osType: 'linux',
        clientRuntime: 'codex', status: 'succeeded', startedAt
      },
      {
        legacyPackageVersionId: versionId, idempotencyKey: randomUUID(),
        userRef: randomUUID(), userRefType: 'uuid', osType: 'linux',
        clientRuntime: 'codex', status: 'succeeded', startedAt
      }
    ]);

    const deprecated = await repository.deprecateVersion({
      packageId: id, version: '1.0.0', actorUid: 'maintainer-uid',
      reason: '已有替代版本', occurredAt: completedAt
    });
    const disabled = await repository.emergencyDisableVersion({
      packageId: id, version: '1.0.0', actorUid: 'platform-admin',
      reasonCode: 'critical_issue', reasonDetail: '立即停用',
      occurredAt: decidedAt
    });
    const catalogRepository = new PostgresCatalogRepository(database.client);
    const catalog = await catalogRepository.findAggregate(id);
    const notifications = await database.client.select().from(userNotifications)
      .where(eq(userNotifications.packageId, id));
    const events = await database.client.select({ eventType: domainEvents.eventType })
      .from(domainEvents).where(eq(domainEvents.aggregateId, `${id}@1.0.0`))
      .orderBy(domainEvents.occurredAt);

    expect(deprecated.lifecycle).toBe('deprecated');
    expect(disabled.version.lifecycle).toBe('emergency_disabled');
    expect(catalog?.versions[0]?.lifecycle).toBe('emergency_disabled');
    expect(notifications).toEqual([
      expect.objectContaining({
        recipientUid: 'emergency-uid',
        notificationType: 'version_emergency_disabled',
        payload: expect.objectContaining({ priority: 'high' })
      })
    ]);
    expect(events.map((event) => event.eventType)).toEqual([
      'version.deprecated',
      'version.emergency_disabled'
    ]);
    await expect(repository.emergencyDisableVersion({
      packageId: id, version: '1.0.0', actorUid: 'platform-admin',
      reasonCode: 'repeat', occurredAt: decidedAt
    })).rejects.toMatchObject({ statusCode: 409, code: 'INVALID_VERSION_TRANSITION' });
  });

  it('修訂會 CAS 退回草稿並關閉待審記錄', async () => {
    const id = packageId('governance-revise');
    const aggregate = await seedAggregate(id);
    const begun = await repository.beginValidation({ aggregate, version: aggregate.versions[0]!, actorUid: 'maintainer-uid', occurredAt: startedAt });
    const completed = await repository.completeValidation({ validationRunId: begun.validationRun.id, result: passedResult(begun.validationRun), occurredAt: completedAt });

    const revised = await repository.reviseVersion({ packageId: id, version: '1.0.0', actorUid: 'author-uid', occurredAt: decidedAt });
    const review = await repository.findReview(completed.review!.id);
    const reviews = await repository.listReviews({ packageId: id, status: 'superseded' });

    expect(revised.lifecycle).toBe('draft');
    expect(review).toEqual(expect.objectContaining({ status: 'superseded', decidedAt }));
    expect(reviews).toHaveLength(1);
  });

  it('Outbox 寫入失敗時版本、執行、審計與事件全部回滾', async () => {
    const id = packageId('governance-rollback');
    const aggregate = await seedAggregate(id);
    const cleanupRejection = await rejectOutboxFor(`${id}@1.0.0`);

    try {
      await expect(repository.beginValidation({
        aggregate,
        version: aggregate.versions[0]!,
        actorUid: 'maintainer-uid',
        occurredAt: startedAt
      })).rejects.toMatchObject({
        cause: { message: '測試強制 governance outbox 失敗' }
      });

      const versionRows = await database.client.select({ lifecycle: packageVersions.lifecycle })
        .from(packageVersions).where(eq(packageVersions.packageId, id));
      const runRows = await database.client.select().from(validationRuns)
        .where(eq(validationRuns.packageId, id));
      const reviewRows = await database.client.select().from(publicationReviews)
        .where(eq(publicationReviews.packageId, id));
      const delistingRows = await database.client.select().from(versionDelistings)
        .where(eq(versionDelistings.packageId, id));
      const notificationRows = await database.client.select().from(userNotifications)
        .where(eq(userNotifications.packageId, id));
      const auditRows = await database.client.select().from(auditLogs)
        .where(eq(auditLogs.targetId, `${id}@1.0.0`));
      const eventRows = await database.client.select().from(domainEvents)
        .where(eq(domainEvents.aggregateId, `${id}@1.0.0`));

      expect(versionRows).toEqual([{ lifecycle: 'draft' }]);
      expect(runRows).toEqual([]);
      expect(reviewRows).toEqual([]);
      expect(delistingRows).toEqual([]);
      expect(notificationRows).toEqual([]);
      expect(auditRows).toEqual([]);
      expect(eventRows).toEqual([]);
    } finally {
      await cleanupRejection();
    }
  });

  it('完成驗證的 Outbox 失敗時 run、review、版本與審計全部回滾', async () => {
    const id = packageId('governance-complete-rollback');
    const aggregate = await seedAggregate(id);
    const begun = await repository.beginValidation({
      aggregate,
      version: aggregate.versions[0]!,
      actorUid: 'maintainer-uid',
      occurredAt: startedAt
    });
    const cleanupRejection = await rejectOutboxFor(`${id}@1.0.0`);

    try {
      await expect(repository.completeValidation({
        validationRunId: begun.validationRun.id,
        result: passedResult(begun.validationRun),
        occurredAt: completedAt
      })).rejects.toMatchObject({
        cause: { message: '測試強制 governance outbox 失敗' }
      });

      const versionRows = await database.client.select({ lifecycle: packageVersions.lifecycle })
        .from(packageVersions).where(eq(packageVersions.packageId, id));
      const runRows = await database.client.select({
        status: validationRuns.status,
        attempts: validationRuns.attempts,
        endedAt: validationRuns.endedAt
      }).from(validationRuns).where(eq(validationRuns.id, begun.validationRun.id));
      const reviewRows = await database.client.select().from(publicationReviews)
        .where(eq(publicationReviews.packageId, id));
      const auditRows = await database.client.select({ eventType: auditLogs.eventType })
        .from(auditLogs).where(eq(auditLogs.targetId, `${id}@1.0.0`));
      const eventRows = await database.client.select({ eventType: domainEvents.eventType })
        .from(domainEvents).where(eq(domainEvents.aggregateId, `${id}@1.0.0`));

      expect(versionRows).toEqual([{ lifecycle: 'validating' }]);
      expect(runRows).toEqual([expect.objectContaining({
        status: 'running',
        attempts: [expect.objectContaining({ attempt: 1, status: 'running' })],
        endedAt: null
      })]);
      expect(reviewRows).toEqual([]);
      expect(auditRows).toEqual([{ eventType: 'version.validation_started' }]);
      expect(eventRows).toEqual([{ eventType: 'version.validation_started' }]);
    } finally {
      await cleanupRejection();
    }
  });

  it('撤下的 Outbox 失敗時 delisting、UID 通知、版本與審計全部回滾', async () => {
    const id = packageId('governance-delist-rollback');
    const aggregate = await seedAggregate(id, 'published');
    const versionId = Number(aggregate.versions[0]!.id);
    await database.client.insert(installations).values([
      {
        legacyPackageVersionId: versionId,
        idempotencyKey: randomUUID(),
        userRef: 'downloaded-uid',
        userRefType: 'uid',
        osType: 'linux',
        clientRuntime: 'codex',
        status: 'downloaded',
        startedAt
      },
      {
        legacyPackageVersionId: versionId,
        idempotencyKey: randomUUID(),
        userRef: 'succeeded-uid',
        userRefType: 'uid',
        osType: 'windows',
        clientRuntime: 'claude code',
        status: 'succeeded',
        startedAt
      }
    ]);
    const cleanupRejection = await rejectOutboxFor(`${id}@1.0.0`);

    try {
      await expect(repository.delistVersion({
        packageId: id,
        version: '1.0.0',
        actorUid: 'maintainer-uid',
        reasonCode: 'publisher_request',
        reasonDetail: '回滾測試',
        effectiveAt: decidedAt,
        occurredAt: decidedAt
      })).rejects.toMatchObject({
        cause: { message: '測試強制 governance outbox 失敗' }
      });

      const versionRows = await database.client.select({ lifecycle: packageVersions.lifecycle })
        .from(packageVersions).where(eq(packageVersions.packageId, id));
      const delistingRows = await database.client.select().from(versionDelistings)
        .where(eq(versionDelistings.packageId, id));
      const notificationRows = await database.client.select().from(userNotifications)
        .where(eq(userNotifications.packageId, id));
      const auditRows = await database.client.select().from(auditLogs)
        .where(eq(auditLogs.targetId, `${id}@1.0.0`));
      const eventRows = await database.client.select().from(domainEvents)
        .where(eq(domainEvents.aggregateId, `${id}@1.0.0`));

      expect(versionRows).toEqual([{ lifecycle: 'published' }]);
      expect(delistingRows).toEqual([]);
      expect(notificationRows).toEqual([]);
      expect(auditRows).toEqual([]);
      expect(eventRows).toEqual([]);
    } finally {
      await cleanupRejection();
    }
  });

  it('0006 migration 回填舊 review 且保留舊邏輯 ID 備查', async () => {
    const temporaryDatabaseName = `governance_migration_${randomUUID().replaceAll('-', '')}`;
    const temporaryUrl = new URL(databaseUrl);
    temporaryUrl.pathname = `/${temporaryDatabaseName}`;
    let temporaryPool: Pool | undefined;

    await adminPool.query(`CREATE DATABASE "${temporaryDatabaseName}"`);
    try {
      temporaryPool = new Pool({ connectionString: temporaryUrl.toString(), max: 1 });
      for (const migrationName of [
        '0000_initial.sql',
        '0001_identity_access.sql',
        '0002_audit_logs.sql',
        '0003_catalog.sql',
        '0004_catalog_defaults.sql',
        '0005_uninstall_cleanup.sql'
      ]) {
        const migrationSql = await readFile(
          new URL(`../../drizzle/${migrationName}`, import.meta.url),
          'utf8'
        );
        await temporaryPool.query(migrationSql);
      }
      await temporaryPool.query(`
        INSERT INTO packages (
          package_id, type, name, purpose, owner_team, category,
          visibility, source_uri, license, lifecycle
        ) VALUES (
          'legacy-skill', 'skill', '舊技能', '驗證回填', 'legacy-team',
          'backend', 'internal', 'https://example.invalid/legacy', 'MIT', 'active'
        );
        INSERT INTO package_versions (
          package_id, version, supported_os, supported_clients, lifecycle,
          script_digest, install_command, uninstall_command, author_uid
        ) VALUES (
          'legacy-skill', '0.9.0', '["linux"]'::jsonb, '[]'::jsonb,
          'review_required', 'sha256:legacy', 'echo install', 'echo uninstall',
          'legacy-author'
        );
        INSERT INTO publication_reviews (
          package_version_id, reviewer_uid, status, decision_reason
        ) SELECT id, 'legacy-reviewer', 'approved', '舊版已批准'
          FROM package_versions
          WHERE package_id = 'legacy-skill' AND version = '0.9.0';
      `);

      const governanceMigration = await readFile(
        new URL('../../drizzle/0006_governance.sql', import.meta.url),
        'utf8'
      );
      await temporaryPool.query(governanceMigration);
      const preserved = await temporaryPool.query<{
        id: string;
        legacy_record_id: string;
        legacy_package_version_id: string;
        package_id: string;
        version: string;
        owner_team: string;
        author_uid: string;
        reviewer_uid: string;
        status: string;
      }>(`
        SELECT id::text, legacy_record_id::text, legacy_package_version_id::text,
               package_id, version, owner_team, author_uid, reviewer_uid, status::text
        FROM publication_reviews
      `);
      await temporaryPool.query(`
        INSERT INTO publication_reviews (
          package_id, version, package_type, category, owner_team, author_uid,
          validation_run_id, reviewer_uid, status
        ) VALUES (
          'new-skill', '1.0.0', 'skill', 'backend', 'new-team', 'new-author',
          gen_random_uuid(), NULL, 'pending'
        )
      `);
      const beforeSecondRunData = await temporaryPool.query(`
        SELECT id::text, legacy_record_id::text, legacy_package_version_id::text,
               package_id, version, package_type, category, owner_team,
               author_uid, validation_run_id::text, reviewer_uid, status::text,
               decision_reason, created_at::text, decided_at::text
        FROM publication_reviews
        ORDER BY package_id, version
      `);
      const beforeSecondRunSchema = await temporaryPool.query(`
        SELECT table_name, column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name IN (
            'publication_reviews', 'validation_runs',
            'version_delistings', 'user_notifications'
          )
        ORDER BY table_name, ordinal_position
      `);
      const beforeSecondRunIndexes = await temporaryPool.query(`
        SELECT tablename, indexname, indexdef
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename IN (
            'publication_reviews', 'validation_runs',
            'version_delistings', 'user_notifications'
          )
        ORDER BY tablename, indexname
      `);

      await temporaryPool.query(governanceMigration);
      const afterSecondRunData = await temporaryPool.query(`
        SELECT id::text, legacy_record_id::text, legacy_package_version_id::text,
               package_id, version, package_type, category, owner_team,
               author_uid, validation_run_id::text, reviewer_uid, status::text,
               decision_reason, created_at::text, decided_at::text
        FROM publication_reviews
        ORDER BY package_id, version
      `);
      const afterSecondRunSchema = await temporaryPool.query(`
        SELECT table_name, column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name IN (
            'publication_reviews', 'validation_runs',
            'version_delistings', 'user_notifications'
          )
        ORDER BY table_name, ordinal_position
      `);
      const afterSecondRunIndexes = await temporaryPool.query(`
        SELECT tablename, indexname, indexdef
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename IN (
            'publication_reviews', 'validation_runs',
            'version_delistings', 'user_notifications'
          )
        ORDER BY tablename, indexname
      `);
      const newRecord = await temporaryPool.query<{
        legacy_record_id: string | null;
        legacy_package_version_id: string | null;
        reviewer_uid: string | null;
      }>(`
        SELECT legacy_record_id::text, legacy_package_version_id::text, reviewer_uid
        FROM publication_reviews
        WHERE package_id = 'new-skill'
      `);

      expect(preserved.rows).toEqual([expect.objectContaining({
        id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        legacy_record_id: '1',
        legacy_package_version_id: '1',
        package_id: 'legacy-skill',
        version: '0.9.0',
        owner_team: 'legacy-team',
        author_uid: 'legacy-author',
        reviewer_uid: 'legacy-reviewer',
        status: 'approved'
      })]);
      expect(newRecord.rows).toEqual([{
        legacy_record_id: null,
        legacy_package_version_id: null,
        reviewer_uid: null
      }]);
      expect(afterSecondRunData.rows).toEqual(beforeSecondRunData.rows);
      expect(afterSecondRunSchema.rows).toEqual(beforeSecondRunSchema.rows);
      expect(afterSecondRunIndexes.rows).toEqual(beforeSecondRunIndexes.rows);
    } finally {
      await temporaryPool?.end();
      await adminPool.query(`DROP DATABASE "${temporaryDatabaseName}" WITH (FORCE)`);
    }
  });

  it('0007 緊急停用通知 migration 可直接重跑且不建立外鍵', async () => {
    const migration = await readFile(
      new URL('../../drizzle/0007_governance_actions.sql', import.meta.url),
      'utf8'
    );
    await migrationPool.query(migration);
    await migrationPool.query(migration);
    const constraint = await migrationPool.query<{ definition: string }>(`
      SELECT pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conrelid = 'public.user_notifications'::regclass
        AND conname = 'user_notifications_type_check'
    `);
    expect(constraint.rows[0]?.definition).toContain('version_emergency_disabled');
  });

  it('0008 回填現有與孤立 Review 快照且可直接重跑', async () => {
    const temporaryDatabaseName = `review_snapshot_migration_${randomUUID().replaceAll('-', '')}`;
    const temporaryUrl = new URL(databaseUrl);
    temporaryUrl.pathname = `/${temporaryDatabaseName}`;
    let temporaryPool: Pool | undefined;
    await adminPool.query(`CREATE DATABASE "${temporaryDatabaseName}"`);
    try {
      temporaryPool = new Pool({ connectionString: temporaryUrl.toString(), max: 1 });
      for (const migrationName of [
        '0000_initial.sql',
        '0001_identity_access.sql',
        '0002_audit_logs.sql',
        '0003_catalog.sql',
        '0004_catalog_defaults.sql',
        '0005_uninstall_cleanup.sql',
        '0006_governance.sql',
        '0007_governance_actions.sql'
      ]) {
        await temporaryPool.query(await readFile(
          new URL(`../../drizzle/${migrationName}`, import.meta.url),
          'utf8'
        ));
      }
      await temporaryPool.query(`
        INSERT INTO packages (
          package_id, type, name, purpose, owner_team, category,
          visibility, source_uri, license, lifecycle
        ) VALUES (
          'snapshot-existing', 'skill', '原始名稱', '原始用途',
          'snapshot-team', 'backend', 'internal',
          'https://example.invalid/snapshot', 'MIT', 'active'
        );
        INSERT INTO package_versions (
          package_id, version, release_notes, supported_os,
          supported_clients, lifecycle, script_digest, install_command,
          uninstall_command, has_residual_effects, author_uid
        ) VALUES (
          'snapshot-existing', '1.0.0', '原始版本', '["linux"]'::jsonb,
          '[{"name":"codex","adaptationSource":"publisher","maintainer":"snapshot-team"}]'::jsonb,
          'review_required', 'sha256:snapshot', 'echo original install',
          'echo original uninstall', false, 'snapshot-author'
        );
        INSERT INTO publication_reviews (
          package_id, version, package_type, category, owner_team,
          author_uid, validation_run_id, status
        ) VALUES
          ('snapshot-existing', '1.0.0', 'skill', 'backend', 'snapshot-team',
           'snapshot-author', gen_random_uuid(), 'pending'),
          ('orphan-package', '9.9.9', 'tool', 'legacy', 'orphan-team',
           'orphan-author', gen_random_uuid(), 'approved');
      `);
      const migration = await readFile(
        new URL('../../drizzle/0008_review_snapshots.sql', import.meta.url),
        'utf8'
      );
      await temporaryPool.query(migration);
      const first = await temporaryPool.query<{
        package_id: string;
        package_snapshot: Record<string, unknown>;
        version_snapshot: Record<string, unknown>;
      }>(`
        SELECT package_id, package_snapshot, version_snapshot
        FROM publication_reviews
        ORDER BY package_id
      `);
      await temporaryPool.query(migration);
      const second = await temporaryPool.query(`
        SELECT package_id, package_snapshot, version_snapshot
        FROM publication_reviews
        ORDER BY package_id
      `);
      const columns = await temporaryPool.query(`
        SELECT column_name, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'publication_reviews'
          AND column_name IN ('package_snapshot', 'version_snapshot')
        ORDER BY column_name
      `);
      const foreignKeys = await temporaryPool.query(`
        SELECT count(*)::int AS count
        FROM pg_constraint
        WHERE contype = 'f' AND connamespace = 'public'::regnamespace
      `);

      expect(first.rows[0]).toMatchObject({
        package_id: 'orphan-package',
        package_snapshot: {
          packageId: 'orphan-package',
          name: '[歷史資料] orphan-package'
        },
        version_snapshot: {
          version: '9.9.9',
          installCommand: '[歷史資料缺失]'
        }
      });
      expect(first.rows[1]).toMatchObject({
        package_id: 'snapshot-existing',
        package_snapshot: { name: '原始名稱', ownerTeam: 'snapshot-team' },
        version_snapshot: {
          releaseNotes: '原始版本',
          installCommand: 'echo original install',
          scriptDigest: 'sha256:snapshot'
        }
      });
      expect(second.rows).toEqual(first.rows);
      expect(columns.rows).toEqual([
        { column_name: 'package_snapshot', is_nullable: 'NO' },
        { column_name: 'version_snapshot', is_nullable: 'NO' }
      ]);
      expect(foreignKeys.rows).toEqual([{ count: 0 }]);
    } finally {
      await temporaryPool?.end();
      await adminPool.query(`DROP DATABASE "${temporaryDatabaseName}" WITH (FORCE)`);
    }
  });

  it('migration tracker 第二次執行不重套治理 migrations', async () => {
    await expect(runMigrations(migrationPool)).resolves.toEqual([]);
  });

  it('public schema 不建立任何外鍵', async () => {
    const foreignKeys = await database.client.execute<{ count: string }>(sql`
      select count(*)::text as count
      from pg_constraint
      where contype = 'f' and connamespace = 'public'::regnamespace
    `);
    expect(foreignKeys.rows[0]?.count).toBe('0');
  });
});
