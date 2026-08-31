// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { afterEach, describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import { MemoryCatalogRepository } from '../../src/modules/catalog/memory-catalog-repository.js';
import type { CatalogAggregate } from '../../src/modules/catalog/types.js';
import { MemoryGovernanceRepository } from '../../src/modules/governance/memory-governance-repository.js';
import type {
  ValidationRunner,
  ValidationRunnerInput
} from '../../src/modules/governance/validation-runner.js';
import { normalizeClientName } from '../../src/modules/governance/validation-runner.js';
import { DevelopmentIdentityProvider } from '../../src/modules/identity/identity-provider.js';
import { MemoryIdentityRepository } from '../../src/modules/identity/memory-identity-repository.js';
import { createPostgresDatabase } from '../../src/shared/database/postgres-database.js';

const now = new Date('2026-08-25T08:00:00.000Z');
const config = {
  environment: 'test' as const,
  host: '127.0.0.1',
  port: 3000,
  logLevel: 'silent' as const,
  databaseUrl: 'postgresql://unused',
  telemetryEndpoint: 'https://telemetry.example.invalid'
};
const database = { ping: async () => undefined, close: async () => undefined };
const apps: Array<Awaited<ReturnType<typeof createApp>>> = [];

describe('審核查詢正規化', () => {
  it('把顯示名稱與 URL slug 收斂成同一個 client 比較鍵', () => {
    expect(normalizeClientName(' Claude_Code ')).toBe('claude-code');
    expect(normalizeClientName('Claude Code')).toBe('claude-code');
  });
});

const aggregate: CatalogAggregate = {
  package: {
    packageId: 'review-api-skill',
    type: 'skill',
    name: '治理 API 技能',
    purpose: '驗證發布治理 API',
    ownerTeam: 'team-a',
    category: 'frontend',
    categoryCode: 'frontend',
    visibility: 'public',
    sourceUri: 'https://example.invalid/review-api-skill',
    license: 'MIT',
    source: 'custom',
    publisher: { kind: 'organization', name: '平台組' },
    grade: 'basic',
    lifecycle: 'active',
    createdAt: now,
    updatedAt: now
  },
  versions: [
    {
      id: '1',
      packageId: 'review-api-skill',
      version: '1.0.0',
      releaseNotes: '第一版',
      supportedOs: ['linux'],
      supportedClients: [
        {
          name: 'codex',
          adaptationSource: 'publisher',
          maintainer: 'team-a'
        }
      ],
      lifecycle: 'draft',
      scriptDigest: 'sha256:review-api',
      installCommand: 'printf install',
      uninstallCommand: 'printf uninstall',
      hasResidualEffects: true,
      residualDescription: '保留快取',
      manualCleanupSteps: '刪除快取目錄',
      scriptTargets: [{
        id: 'review-api-linux-codex',
        packageId: 'review-api-skill',
        packageVersion: '1.0.0',
        targetOs: 'linux/macos',
        clientRuntime: 'codex',
        currentRevision: {
          id: 'review-api-linux-codex-v1',
          targetId: 'review-api-linux-codex',
          targetOs: 'linux/macos',
          clientRuntime: 'codex',
          scriptVersion: 1,
          installCommand: 'printf install',
          uninstallCommand: 'printf uninstall',
          options: [],
          usageInstructions: '執行安裝腳本',
          hasResidualEffects: true,
          residualDescription: '保留快取',
          manualCleanupSteps: '刪除快取目錄',
          contentDigest: 'sha256:review-api-target-v1',
          legacyImported: false,
          createdByUid: 'author-1',
          createdAt: now
        },
        revisions: [],
        createdAt: now,
        updatedAt: now
      }],
      authorUid: 'author-1',
      createdAt: now,
      updatedAt: now
    }
  ],
  adoption: { installations: 1, succeeded: 1, successRate: 1 }
};

class PassingRunner implements ValidationRunner {
  async run(input: ValidationRunnerInput) {
    return {
      status: 'passed' as const,
      runnerVersion: 'deterministic/1.0.0',
      matrixResults: input.expectedMatrix.map((target) => ({
        ...target,
        runnerName: 'deterministic',
        runnerVersion: '1.0.0',
        scriptDigest: input.version.scriptDigest ?? '',
        installScriptDigest: 'sha256:generated-install',
        uninstallScriptDigest: 'sha256:generated-uninstall',
        startedAt: now,
        endedAt: new Date(now.getTime() + 1000),
        installExitCode: 0,
        telemetrySeen: true,
        uninstallExitCode: 0,
        cleanupSucceeded: true,
        status: 'passed' as const
      }))
    };
  }
}

class StuckOnceRunner implements ValidationRunner {
  readonly started: Promise<void>;
  private announceStarted!: () => void;
  private releaseFirst!: () => void;
  private calls = 0;

  constructor() {
    this.started = new Promise((resolve) => {
      this.announceStarted = resolve;
    });
  }

  release(): void {
    this.releaseFirst?.();
  }

  async run(input: ValidationRunnerInput) {
    this.calls += 1;
    if (this.calls === 1) {
      this.announceStarted();
      await new Promise<void>((resolve) => {
        this.releaseFirst = resolve;
      });
    }
    return new PassingRunner().run(input);
  }
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

function firstCookie(value: string | string[] | undefined): string {
  const header = Array.isArray(value) ? value[0] : value;
  const cookie = header?.split(';')[0];
  if (!cookie) throw new Error('登入回應缺少 Cookie');
  return cookie;
}

async function login(
  app: Awaited<ReturnType<typeof createApp>>,
  uid: string
): Promise<string> {
  const response = await app.inject({
    method: 'GET',
    url: `/api/auth/callback?code=${encodeURIComponent(uid)}`
  });
  expect(response.statusCode).toBe(302);
  return firstCookie(response.headers['set-cookie']);
}

async function createFixture(
  runner: ValidationRunner = new PassingRunner()
) {
  const catalogRepository = new MemoryCatalogRepository({
    packages: [aggregate.package],
    versions: aggregate.versions,
    adoption: { 'review-api-skill': { installations: 1, succeeded: 1 } }
  });
  const governanceRepository = new MemoryGovernanceRepository({
    store: catalogRepository.store,
    installations: [
      {
        id: 'installation-uid',
        packageId: 'review-api-skill',
        version: '1.0.0',
        userRefType: 'uid',
        userRef: 'affected-1',
        status: 'succeeded'
      },
      {
        id: 'installation-uuid',
        packageId: 'review-api-skill',
        version: '1.0.0',
        userRefType: 'uuid',
        userRef: '123e4567-e89b-42d3-a456-426614174000',
        status: 'succeeded'
      }
    ]
  });
  const identityRepository = new MemoryIdentityRepository({
    identities: [
      { uid: 'author-1', displayName: '作者', teamIds: ['team-a'], providerType: 'development', active: true, createdAt: now, updatedAt: now },
      { uid: 'owner-2', displayName: '同團隊維護者', teamIds: ['team-a'], providerType: 'development', active: true, createdAt: now, updatedAt: now },
      { uid: 'reviewer-1', displayName: '跨團隊審核人', teamIds: ['team-b'], providerType: 'development', active: true, createdAt: now, updatedAt: now },
      { uid: 'outsider-1', displayName: '未指派人員', teamIds: ['team-c'], providerType: 'development', active: true, createdAt: now, updatedAt: now },
      { uid: 'affected-1', displayName: '受影響使用者', teamIds: ['team-d'], providerType: 'development', active: true, createdAt: now, updatedAt: now },
      { uid: 'admin-1', displayName: '平台管理員', teamIds: ['platform'], providerType: 'development', active: true, createdAt: now, updatedAt: now }
    ],
    roles: [
      { id: 'role-author', uid: 'author-1', role: 'maintainer', scopeType: 'team', scopeValue: 'team-a', assignedByUid: 'admin-1', active: true, createdAt: now },
      { id: 'role-owner', uid: 'owner-2', role: 'maintainer', scopeType: 'team', scopeValue: 'team-a', assignedByUid: 'admin-1', active: true, createdAt: now },
      // 權限收斂後審核權來自 reviewer 角色，不再來自下方的範圍指派。
      { id: 'role-reviewer', uid: 'reviewer-1', role: 'reviewer', scopeType: 'global', scopeValue: '', assignedByUid: 'admin-1', active: true, createdAt: now },
      { id: 'role-admin', uid: 'admin-1', role: 'platform_admin', scopeType: 'global', scopeValue: '', assignedByUid: 'bootstrap', active: true, createdAt: now }
    ],
    packages: [
      { packageId: 'review-api-skill', ownerTeam: 'team-a', packageType: 'skill', category: 'frontend' }
    ],
    reviewerAssignments: [
      { id: 'reviewer-assignment', reviewerUid: 'reviewer-1', packageType: 'skill', category: 'frontend', assignedByUid: 'admin-1', active: true, createdAt: now }
    ]
  });
  const provider = new DevelopmentIdentityProvider([
    { uid: 'author-1', displayName: '作者', teamIds: ['team-a'] },
    { uid: 'owner-2', displayName: '同團隊維護者', teamIds: ['team-a'] },
    { uid: 'reviewer-1', displayName: '跨團隊審核人', teamIds: ['team-b'] },
    { uid: 'outsider-1', displayName: '未指派人員', teamIds: ['team-c'] },
    { uid: 'affected-1', displayName: '受影響使用者', teamIds: ['team-d'] },
    { uid: 'admin-1', displayName: '平台管理員', teamIds: ['platform'] }
  ]);
  const appOptions = {
    config,
    database,
    identity: { repository: identityRepository, provider },
    catalog: { repository: catalogRepository },
    governance: {
      repository: governanceRepository,
      validationRunner: runner,
      clock: () => now
    }
  };
  const app = await createApp(appOptions);
  apps.push(app);
  return { app, governanceRepository };
}

describe('發布治理 API', () => {
  it('提交、工作台與批准形成可下載的同一份生命週期', async () => {
    const { app } = await createFixture();
    const authorCookie = await login(app, 'author-1');
    const reviewerCookie = await login(app, 'reviewer-1');

    const submitted = await app.inject({
      method: 'POST',
      url: '/api/packages/review-api-skill/versions/1.0.0/submit-review',
      headers: { cookie: authorCookie },
      payload: {}
    });
    const reviewId = submitted.json<{ review: { id: string } }>().review?.id;
    expect(submitted.statusCode).toBe(200);
    expect(reviewId).toBeTruthy();

    const list = await app.inject({
      method: 'GET',
      url: '/api/reviews?status=pending&os=LINUX&client=CODEX&limit=20',
      headers: { cookie: reviewerCookie }
    });
    const detail = await app.inject({
      method: 'GET',
      url: `/api/reviews/${reviewId}`,
      headers: { cookie: reviewerCookie }
    });
    const approved = await app.inject({
      method: 'POST',
      url: `/api/reviews/${reviewId}/approve`,
      headers: { cookie: reviewerCookie },
      payload: { reason: '驗證證據完整' }
    });
    const download = await app.inject({
      method: 'GET',
      url: '/api/packages/review-api-skill/versions/1.0.0/download'
    });
    const revisedPublished = await app.inject({
      method: 'PATCH',
      url: '/api/packages/review-api-skill/versions/1.0.0',
      headers: { cookie: authorCookie },
      payload: { releaseNotes: '發布後修訂', installCommand: 'printf changed' }
    });
    await app.inject({
      method: 'PATCH',
      url: '/api/packages/review-api-skill',
      headers: { cookie: authorCookie },
      payload: { name: '後續修改的套件名稱', category: 'backend' }
    });
    const historicalDetail = await app.inject({
      method: 'GET',
      url: `/api/reviews/${reviewId}`,
      headers: { cookie: reviewerCookie }
    });
    const downloadAfterRevision = await app.inject({
      method: 'GET',
      url: '/api/packages/review-api-skill/versions/1.0.0/download'
    });
    const scriptAfterRevision = await app.inject({
      method: 'POST',
      url: '/api/packages/review-api-skill/versions/1.0.0/scripts',
      payload: { targetOs: 'linux/macos', clientRuntime: 'codex' }
    });

    expect(list.json()).toMatchObject({
      state: 'success',
      items: [{ review: { id: reviewId } }]
    });
    expect(detail.json()).toMatchObject({
      review: { id: reviewId, ownerTeam: 'team-a', authorUid: 'author-1' },
      package: { packageId: 'review-api-skill', name: '治理 API 技能' },
      version: {
        installCommand: 'printf install',
        uninstallCommand: 'printf uninstall',
        hasResidualEffects: true,
        residualDescription: '保留快取',
        manualCleanupSteps: '刪除快取目錄',
        scriptDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        supportedClients: [{ adaptationSource: 'publisher', maintainer: 'team-a' }]
      },
      validation: {
        expectedMatrix: [expect.objectContaining({ os: 'linux/macos', client: 'codex' })],
        matrixResults: [{ status: 'passed', telemetrySeen: true }],
        attempts: [{ kind: 'initial', status: 'passed' }]
      }
    });
    expect(approved.json()).toMatchObject({ version: { lifecycle: 'published' } });
    expect(download.statusCode).toBe(200);
    expect(revisedPublished.json()).toMatchObject({
      lifecycle: 'draft', releaseNotes: '發布後修訂',
      installCommand: 'printf install'
    });
    expect(historicalDetail.json()).toMatchObject({
      package: { name: '治理 API 技能', category: 'frontend' },
      version: {
        releaseNotes: '第一版',
        installCommand: 'printf install',
        scriptDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/)
      }
    });
    expect(downloadAfterRevision.statusCode).toBe(404);
    expect(scriptAfterRevision.statusCode).toBe(404);
  });

  it('同團隊、作者與未指派人員都不能審核', async () => {
    const { app } = await createFixture();
    const authorCookie = await login(app, 'author-1');
    const submitted = await app.inject({
      method: 'POST',
      url: '/api/packages/review-api-skill/versions/1.0.0/submit-review',
      headers: { cookie: authorCookie },
      payload: {}
    });
    const reviewId = submitted.json<{ review: { id: string } }>().review.id;

    for (const uid of ['author-1', 'owner-2', 'outsider-1']) {
      const cookie = await login(app, uid);
      const detail = await app.inject({
        method: 'GET',
        url: `/api/reviews/${reviewId}`,
        headers: { cookie }
      });
      expect(detail.statusCode).toBe(404);
    }
  });

  it('拒絕理由、重複決議與待審內容修改都受治理交易約束', async () => {
    const { app } = await createFixture();
    const authorCookie = await login(app, 'author-1');
    const reviewerCookie = await login(app, 'reviewer-1');
    const submitted = await app.inject({
      method: 'POST',
      url: '/api/packages/review-api-skill/versions/1.0.0/submit-review',
      headers: { cookie: authorCookie }, payload: {}
    });
    const reviewId = submitted.json<{ review: { id: string } }>().review.id;
    const emptyReason = await app.inject({
      method: 'POST', url: `/api/reviews/${reviewId}/reject`,
      headers: { cookie: reviewerCookie }, payload: { reason: '   ' }
    });
    const revised = await app.inject({
      method: 'PATCH',
      url: '/api/packages/review-api-skill/versions/1.0.0',
      headers: { cookie: authorCookie },
      payload: { releaseNotes: '修訂後內容', installCommand: 'printf revised' }
    });
    const pendingAfterRevision = await app.inject({
      method: 'GET', url: '/api/reviews?status=pending',
      headers: { cookie: reviewerCookie }
    });
    const supersededDetail = await app.inject({
      method: 'GET', url: `/api/reviews/${reviewId}`,
      headers: { cookie: reviewerCookie }
    });
    const duplicateDecision = await app.inject({
      method: 'POST', url: `/api/reviews/${reviewId}/approve`,
      headers: { cookie: reviewerCookie }, payload: { reason: '延遲決議' }
    });

    expect(emptyReason.statusCode).toBe(400);
    expect(emptyReason.json()).toMatchObject({ error: { code: 'REVIEW_REASON_REQUIRED' } });
    expect(revised.json()).toMatchObject({
      lifecycle: 'draft', releaseNotes: '修訂後內容', installCommand: 'printf install'
    });
    expect(pendingAfterRevision.json()).toMatchObject({ state: 'empty', items: [] });
    expect(supersededDetail.json()).toMatchObject({
      review: { status: 'superseded' },
      version: {
        releaseNotes: '第一版',
        installCommand: 'printf install'
      }
    });
    expect(duplicateDecision.statusCode).toBe(409);
  });

  it('審核拒絕回草稿且第二次決議固定衝突', async () => {
    const { app } = await createFixture();
    const authorCookie = await login(app, 'author-1');
    const reviewerCookie = await login(app, 'reviewer-1');
    const submitted = await app.inject({
      method: 'POST',
      url: '/api/packages/review-api-skill/versions/1.0.0/submit-review',
      headers: { cookie: authorCookie }, payload: {}
    });
    const reviewId = submitted.json<{ review: { id: string } }>().review.id;
    const rejected = await app.inject({
      method: 'POST', url: `/api/reviews/${reviewId}/reject`,
      headers: { cookie: reviewerCookie }, payload: { reason: '證據不足' }
    });
    const repeated = await app.inject({
      method: 'POST', url: `/api/reviews/${reviewId}/reject`,
      headers: { cookie: reviewerCookie }, payload: { reason: '再次拒絕' }
    });

    expect(rejected.json()).toMatchObject({
      version: { lifecycle: 'draft' },
      review: { status: 'rejected', decisionReason: '證據不足' }
    });
    expect(repeated.statusCode).toBe(409);
    expect(repeated.json()).toMatchObject({ error: { code: 'REVIEW_ALREADY_DECIDED' } });
  });

  it('卡住的驗證可依 package/version 重試且只建立一個待審', async () => {
    const runner = new StuckOnceRunner();
    const { app, governanceRepository } = await createFixture(runner);
    const authorCookie = await login(app, 'author-1');
    const firstRequest = app.inject({
      method: 'POST',
      url: '/api/packages/review-api-skill/versions/1.0.0/submit-review',
      headers: { cookie: authorCookie }, payload: {}
    });
    await runner.started;
    const validationRunId = governanceRepository.validationRuns[0]?.id;
    expect(validationRunId).toBeTruthy();

    const updateDuringValidation = await app.inject({
      method: 'PATCH',
      url: '/api/packages/review-api-skill/versions/1.0.0',
      headers: { cookie: authorCookie },
      payload: { releaseNotes: '驗證期間不得修改' }
    });

    const retried = await app.inject({
      method: 'POST',
      url: '/api/packages/review-api-skill/versions/1.0.0/validation/retry',
      headers: { cookie: authorCookie }, payload: { validationRunId }
    });
    runner.release();
    const staleFirst = await firstRequest;

    expect(retried.statusCode).toBe(200);
    expect(updateDuringValidation.statusCode).toBe(409);
    expect(retried.json()).toMatchObject({
      version: { lifecycle: 'review_required' },
      review: { status: 'pending' }
    });
    expect(staleFirst.statusCode).toBe(409);
    expect(governanceRepository.validationRuns[0]?.attempts).toHaveLength(2);
  });

  it('棄用、撤下與緊急停用立即失效並只通知 UID', async () => {
    const { app, governanceRepository } = await createFixture();
    const authorCookie = await login(app, 'author-1');
    const reviewerCookie = await login(app, 'reviewer-1');
    const adminCookie = await login(app, 'admin-1');
    const affectedCookie = await login(app, 'affected-1');
    const outsiderCookie = await login(app, 'outsider-1');
    const submitted = await app.inject({
      method: 'POST',
      url: '/api/packages/review-api-skill/versions/1.0.0/submit-review',
      headers: { cookie: authorCookie }, payload: {}
    });
    const reviewId = submitted.json<{ review: { id: string } }>().review.id;
    await app.inject({
      method: 'POST', url: `/api/reviews/${reviewId}/approve`,
      headers: { cookie: reviewerCookie }, payload: {}
    });
    const deprecated = await app.inject({
      method: 'POST',
      url: '/api/packages/review-api-skill/versions/1.0.0/deprecate',
      headers: { cookie: authorCookie }, payload: { reason: '已有替代版本' }
    });
    const delisted = await app.inject({
      method: 'POST',
      url: '/api/packages/review-api-skill/versions/1.0.0/delist',
      headers: { cookie: authorCookie },
      payload: {
        reasonCode: 'policy_change',
        reasonDetail: '不再提供',
        effectiveAt: now.toISOString()
      }
    });
    const forbiddenEmergency = await app.inject({
      method: 'POST',
      url: '/api/packages/review-api-skill/versions/1.0.0/emergency-disable',
      headers: { cookie: authorCookie }, payload: { reasonCode: 'critical_issue' }
    });
    const emergency = await app.inject({
      method: 'POST',
      url: '/api/packages/review-api-skill/versions/1.0.0/emergency-disable',
      headers: { cookie: adminCookie },
      payload: { reasonCode: 'critical_issue', reasonDetail: '立即停用' }
    });
    const repeatedEmergency = await app.inject({
      method: 'POST',
      url: '/api/packages/review-api-skill/versions/1.0.0/emergency-disable',
      headers: { cookie: adminCookie }, payload: { reasonCode: 'repeat' }
    });
    const download = await app.inject({
      method: 'GET', url: '/api/packages/review-api-skill/versions/1.0.0/download'
    });
    const script = await app.inject({
      method: 'POST', url: '/api/packages/review-api-skill/versions/1.0.0/scripts',
      payload: { targetOs: 'linux/macos', clientRuntime: 'codex' }
    });
    const notifications = await app.inject({
      method: 'GET', url: '/api/notifications?status=unread&limit=20',
      headers: { cookie: affectedCookie }
    });
    const notificationItems = notifications.json<{ items: Array<{ id: string; notificationType: string; payload: { priority?: string } }> }>().items;
    const delistNotification = notificationItems.find(
      (item) => item.notificationType === 'version_delisted'
    );
    const emergencyNotification = notificationItems.find(
      (item) => item.notificationType === 'version_emergency_disabled'
    );
    const wrongUid = await app.inject({
      method: 'POST', url: `/api/notifications/${delistNotification?.id}/read`,
      headers: { cookie: outsiderCookie }, payload: {}
    });
    const markedRead = await app.inject({
      method: 'POST', url: `/api/notifications/${delistNotification?.id}/read`,
      headers: { cookie: affectedCookie }, payload: {}
    });
    const repeatedRead = await app.inject({
      method: 'POST', url: `/api/notifications/${delistNotification?.id}/read`,
      headers: { cookie: affectedCookie }, payload: {}
    });

    expect(deprecated.json()).toMatchObject({ lifecycle: 'deprecated' });
    expect(delisted.json()).toMatchObject({
      version: { lifecycle: 'delisted' },
      notifications: [{ recipientUid: 'affected-1', notificationType: 'version_delisted' }]
    });
    expect(forbiddenEmergency.statusCode).toBe(403);
    expect(emergency.json()).toMatchObject({ version: { lifecycle: 'emergency_disabled' } });
    expect(repeatedEmergency.statusCode).toBe(409);
    expect(download.statusCode).toBe(404);
    expect(script.statusCode).toBe(404);
    expect(notificationItems).toHaveLength(2);
    expect(emergencyNotification).toMatchObject({ payload: { priority: 'high' } });
    expect(wrongUid.statusCode).toBe(404);
    expect(markedRead.json()).toMatchObject({ status: 'read' });
    expect(repeatedRead.json()).toMatchObject({ status: 'read' });
    expect(governanceRepository.auditLogs.filter(
      (event) => event.eventType === 'notification.read'
    )).toHaveLength(1);
    expect(governanceRepository.domainEvents.filter(
      (event) => event.eventType === 'notification.read'
    )).toHaveLength(1);
  });

  it('UUID 輸入在進入 repository 前固定回中文 400', async () => {
    const { app, governanceRepository } = await createFixture();
    const authorCookie = await login(app, 'author-1');
    const reviewerCookie = await login(app, 'reviewer-1');
    const before = {
      runs: governanceRepository.validationRuns.length,
      audits: governanceRepository.auditLogs.length,
      events: governanceRepository.domainEvents.length
    };
    const requests = await Promise.all([
      app.inject({ method: 'GET', url: '/api/reviews/not-a-uuid', headers: { cookie: reviewerCookie } }),
      app.inject({ method: 'POST', url: '/api/reviews/not-a-uuid/approve', headers: { cookie: reviewerCookie }, payload: {} }),
      app.inject({ method: 'POST', url: '/api/reviews/not-a-uuid/reject', headers: { cookie: reviewerCookie }, payload: { reason: '拒絕' } }),
      app.inject({ method: 'POST', url: '/api/notifications/not-a-uuid/read', headers: { cookie: authorCookie }, payload: {} }),
      app.inject({
        method: 'POST',
        url: '/api/packages/review-api-skill/versions/1.0.0/validation/retry',
        headers: { cookie: authorCookie }, payload: { validationRunId: 'not-a-uuid' }
      })
    ]);

    for (const response of requests) {
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({
        error: { code: 'VALIDATION_ERROR', message: '請求欄位驗證失敗' }
      });
    }
    expect(governanceRepository.validationRuns).toHaveLength(before.runs);
    expect(governanceRepository.auditLogs).toHaveLength(before.audits);
    expect(governanceRepository.domainEvents).toHaveLength(before.events);
  });

  it('PostgreSQL app composition 也在查詢 UUID 欄位前拒絕損壞 ID', async () => {
    const postgres = createPostgresDatabase(
      process.env.TEST_DATABASE_URL ??
        'postgresql://postgres:postgres@127.0.0.1:55432/agent_skill_platform'
    );
    const app = await createApp({ config, database: postgres });
    apps.push(app);

    const response = await app.inject({
      method: 'GET',
      url: '/api/reviews/not-a-uuid'
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: { code: 'VALIDATION_ERROR', message: '請求欄位驗證失敗' }
    });
  });
});
