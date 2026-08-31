// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { describe, expect, it } from 'vitest';

import { MemoryCatalogRepository } from '../../src/modules/catalog/memory-catalog-repository.js';
import type {
  CatalogAggregate,
  PackageVersionRecord,
  ScriptTargetRecord,
  ScriptTargetRevision
} from '../../src/modules/catalog/types.js';
import { GovernanceService } from '../../src/modules/governance/governance-service.js';
import { MemoryGovernanceRepository } from '../../src/modules/governance/memory-governance-repository.js';
import type {
  ValidationMatrixResult,
  ValidationRunResult,
  ValidationRunner,
  ValidationRunnerInput
} from '../../src/modules/governance/validation-runner.js';
import { AuthorizationService } from '../../src/modules/identity/authorization-service.js';
import { MemoryIdentityRepository } from '../../src/modules/identity/memory-identity-repository.js';
import type { ResolvedIdentity } from '../../src/modules/identity/types.js';

const now = new Date('2026-08-25T08:00:00.000Z');

function scriptTarget(
  overrides: Partial<ScriptTargetRecord> = {},
  revisionOverrides: Partial<ScriptTargetRevision> = {}
): ScriptTargetRecord {
  const targetOs = overrides.targetOs ?? revisionOverrides.targetOs ?? 'linux/macos';
  const clientRuntime = overrides.clientRuntime ?? revisionOverrides.clientRuntime ?? 'codex';
  const id = overrides.id ?? revisionOverrides.targetId ?? `target-${targetOs}-${clientRuntime}`;
  const revision: ScriptTargetRevision = {
    id: `${id}-revision-1`, targetId: id, targetOs, clientRuntime, scriptVersion: 1,
    installCommand: 'printf installed', uninstallCommand: 'printf uninstalled', options: [],
    usageInstructions: '執行產生的安裝腳本。', hasResidualEffects: false,
    contentDigest: `digest-${id}`, legacyImported: false,
    createdByUid: 'author-1', createdAt: now,
    ...revisionOverrides
  };
  return {
    id, packageId: 'pkg-one', packageVersion: '1.0.0', targetOs, clientRuntime,
    currentRevision: revision, revisions: [revision], createdAt: now, updatedAt: now,
    ...overrides
  };
}

function pendingScriptTarget(): ScriptTargetRecord {
  const target = scriptTarget();
  delete target.currentRevision;
  target.revisions = [];
  return target;
}

const identities = {
  author: { kind: 'authenticated', uid: 'author-1', displayName: '作者', teamIds: ['team-a'] },
  ownerMember: { kind: 'authenticated', uid: 'owner-2', displayName: '所有團隊成員', teamIds: ['team-a'] },
  reviewer: { kind: 'authenticated', uid: 'reviewer-1', displayName: '跨團隊審核人', teamIds: ['team-b'] },
  employee: { kind: 'authenticated', uid: 'employee-1', displayName: '未指派員工', teamIds: ['team-b'] },
  admin: { kind: 'authenticated', uid: 'admin-1', displayName: '平台管理員', teamIds: ['platform'] }
} satisfies Record<string, ResolvedIdentity>;

function version(lifecycle: PackageVersionRecord['lifecycle'] = 'draft'): PackageVersionRecord {
  return {
    id: 'version-logical-1',
    packageId: 'pkg-one',
    version: '1.0.0',
    releaseNotes: '第一版',
    supportedOs: ['linux'],
    supportedClients: [{ name: 'codex', adaptationSource: 'publisher', maintainer: 'team-a' }],
    lifecycle,
    scriptDigest: 'sha256:test',
    installCommand: 'install pkg-one',
    uninstallCommand: 'uninstall pkg-one',
    hasResidualEffects: false,
    scriptTargets: [scriptTarget()],
    authorUid: 'author-1',
    createdAt: now,
    updatedAt: now
  };
}

function aggregate(
  lifecycle: PackageVersionRecord['lifecycle'] = 'draft',
  versionOverrides: Partial<PackageVersionRecord> = {}
): CatalogAggregate {
  return {
    package: {
      packageId: 'pkg-one',
      type: 'skill',
      name: '範例技能',
      purpose: '驗證治理流程',
      ownerTeam: 'team-a',
      category: 'development',
      categoryCode: 'backend',
      visibility: 'internal',
      sourceUri: 'https://example.test/pkg-one',
      license: 'MIT',
      source: 'custom',
      publisher: { kind: 'organization', name: '平台組' },
      grade: 'basic',
      lifecycle: 'active',
      createdAt: now,
      updatedAt: now
    },
    versions: [{ ...version(lifecycle), ...versionOverrides }],
    adoption: { installations: 0, succeeded: 0, successRate: null }
  };
}

function passedMatrix(os: string, client: string, overrides: Partial<ValidationMatrixResult> = {}): ValidationMatrixResult {
  const normalizedOs = os === 'linux' ? 'linux/macos' : os;
  const targetId = `target-${normalizedOs}-${client}`;
  return {
    os: normalizedOs,
    client,
    runnerName: 'memory',
    runnerVersion: '1',
    scriptDigest: 'sha256:test',
    targetId,
    scriptVersion: 1,
    contentDigest: `digest-${targetId}`,
    installScriptDigest: 'sha256:install',
    uninstallScriptDigest: 'sha256:uninstall',
    startedAt: now,
    endedAt: now,
    installExitCode: 0,
    telemetrySeen: true,
    uninstallExitCode: 0,
    cleanupSucceeded: true,
    status: 'passed',
    ...overrides
  };
}

class SuccessfulRunner implements ValidationRunner {
  calls: ValidationRunnerInput[] = [];

  async run(input: ValidationRunnerInput): Promise<ValidationRunResult> {
    this.calls.push(input);
    return {
      status: 'passed',
      runnerVersion: 'memory-runner/1',
      matrixResults: input.expectedMatrix.map((target) => ({
        ...target,
        runnerName: 'memory',
        runnerVersion: '1',
        scriptDigest: 'sha256:generated-install',
        installScriptDigest: 'sha256:generated-install',
        uninstallScriptDigest: 'sha256:generated-uninstall',
        startedAt: now,
        endedAt: now,
        installExitCode: 0,
        telemetrySeen: true,
        uninstallExitCode: 0,
        cleanupSucceeded: true,
        status: 'passed'
      }))
    };
  }
}

function createHarness(
  lifecycle: PackageVersionRecord['lifecycle'] = 'draft',
  runner: ValidationRunner = new SuccessfulRunner(),
  snapshot: CatalogAggregate = aggregate(lifecycle)
) {
  const catalog = new MemoryCatalogRepository({
    packages: [snapshot.package],
    versions: snapshot.versions
  });
  const identityRepository = new MemoryIdentityRepository({
    identities: [
      { uid: 'author-1', displayName: '作者', teamIds: ['team-a'], providerType: 'development', active: true, createdAt: now, updatedAt: now },
      { uid: 'owner-2', displayName: '所有團隊成員', teamIds: ['team-a'], providerType: 'development', active: true, createdAt: now, updatedAt: now },
      { uid: 'reviewer-1', displayName: '跨團隊審核人', teamIds: ['team-b'], providerType: 'development', active: true, createdAt: now, updatedAt: now },
      { uid: 'employee-1', displayName: '未指派員工', teamIds: ['team-b'], providerType: 'development', active: true, createdAt: now, updatedAt: now },
      { uid: 'admin-1', displayName: '平台管理員', teamIds: ['platform'], providerType: 'development', active: true, createdAt: now, updatedAt: now }
    ],
    roles: [
      { id: 'maintainer-role', uid: 'author-1', role: 'maintainer', scopeType: 'team', scopeValue: 'team-a', assignedByUid: 'admin', active: true, createdAt: now },
      // 權限收斂後審核權來自 reviewer 角色，不再來自下方的範圍指派。
      { id: 'reviewer-role', uid: 'reviewer-1', role: 'reviewer', scopeType: 'global', scopeValue: '', assignedByUid: 'admin', active: true, createdAt: now },
      { id: 'admin-role', uid: 'admin-1', role: 'platform_admin', scopeType: 'global', scopeValue: '', assignedByUid: 'bootstrap', active: true, createdAt: now }
    ],
    packages: [{ packageId: 'pkg-one', ownerTeam: 'team-a', packageType: 'skill', category: 'development' }],
    reviewerAssignments: [{
      id: 'reviewer-assignment', reviewerUid: 'reviewer-1', packageType: 'skill', category: 'development', assignedByUid: 'admin', active: true, createdAt: now
    }]
  });
  const repository = new MemoryGovernanceRepository({ aggregates: [snapshot] });
  const service = new GovernanceService(
    repository,
    catalog,
    new AuthorizationService(identityRepository, () => now),
    runner,
    () => now
  );
  return { service, repository, runner };
}

describe('GovernanceService', () => {
  it.each([
    ['沒有 target', []],
    ['只有 pending target', [pendingScriptTarget()]],
    ['只有 legacy revision', [scriptTarget({}, { legacyImported: true })]],
    ['安裝命令不完整', [scriptTarget({}, { installCommand: '  ' })]],
    ['usage 不完整', [scriptTarget({}, { usageInstructions: '' })]],
    ['殘留說明不完整', [scriptTarget({}, {
      hasResidualEffects: true, residualDescription: '', manualCleanupSteps: ''
    })]],
    ['options 不合法', [scriptTarget({}, {
      options: [
        { name: '--scope', type: 'text', description: 'A', defaultValue: '' },
        { name: '--scope', type: 'text', description: 'B', defaultValue: '' }
      ]
    })]],
    ['只有已刪除 target', [scriptTarget({ deletedAt: now })]]
  ] as const)('%s 在 begin／Audit／Outbox／runner 前回 SCRIPT_TARGETS_INCOMPLETE', async (_label, targets) => {
    const runner = new SuccessfulRunner();
    const { service, repository } = createHarness('draft', runner, aggregate('draft', {
      scriptTargets: [...targets]
    }));

    await expect(service.submitReview('pkg-one', '1.0.0', identities.author)).rejects.toMatchObject({
      statusCode: 409,
      code: 'SCRIPT_TARGETS_INCOMPLETE'
    });

    expect(runner.calls).toHaveLength(0);
    expect(repository.validationRuns).toHaveLength(0);
    expect(repository.auditLogs).toHaveLength(0);
    expect(repository.domainEvents).toHaveLength(0);
  });

  it('只用 active current targets 建立 Matrix，不對 OS 與 Client 做笛卡兒積', async () => {
    const first = scriptTarget();
    const second = scriptTarget(
      { id: 'target-windows-claude', targetOs: 'windows', clientRuntime: 'claude-code' },
      { targetId: 'target-windows-claude', targetOs: 'windows', clientRuntime: 'claude-code' }
    );
    const deleted = scriptTarget(
      { id: 'target-wsl-codex', targetOs: 'wsl', clientRuntime: 'codex', deletedAt: now },
      { targetId: 'target-wsl-codex', targetOs: 'wsl', clientRuntime: 'codex' }
    );
    const runner: ValidationRunner = {
      async run(input) {
        expect(input.expectedMatrix).toEqual([
          expect.objectContaining({ targetId: first.id, os: 'linux/macos', client: 'codex', scriptVersion: 1 }),
          expect.objectContaining({ targetId: second.id, os: 'windows', client: 'claude-code', scriptVersion: 1 })
        ]);
        expect(input.targetSnapshots).toHaveLength(2);
        return { status: 'failed', runnerVersion: 'test/1', matrixResults: [], errorCode: 'expected-stop' };
      }
    };
    const { service, repository } = createHarness('draft', runner, aggregate('draft', {
      supportedOs: ['linux/macos', 'windows', 'wsl'],
      supportedClients: [
        { name: 'codex', adaptationSource: 'publisher', maintainer: 'team-a' },
        { name: 'claude-code', adaptationSource: 'publisher', maintainer: 'team-a' }
      ],
      scriptTargets: [second, deleted, first]
    }));

    await service.submitReview('pkg-one', '1.0.0', identities.author);

    expect(repository.validationRuns[0]).toMatchObject({
      contractVersion: 2,
      expectedMatrix: [
        { targetId: first.id, os: 'linux/macos', client: 'codex', scriptVersion: 1, contentDigest: first.currentRevision!.contentDigest },
        { targetId: second.id, os: 'windows', client: 'claude-code', scriptVersion: 1, contentDigest: second.currentRevision!.contentDigest }
      ]
    });
    expect(repository.validationRuns[0]?.manifestDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it('提交通過驗證後建立待審快照，批准後發布並保留審計與 outbox', async () => {
    const { service, repository } = createHarness();

    const submitted = await service.submitReview('pkg-one', '1.0.0', identities.author);

    expect(submitted.version.lifecycle).toBe('review_required');
    expect(submitted.review?.status).toBe('pending');
    expect(repository.validationRuns[0]?.matrixResults).toEqual([
      expect.objectContaining({ os: 'linux/macos', client: 'codex', telemetrySeen: true, cleanupSucceeded: true })
    ]);
    expect(repository.auditLogs.map((item) => item.eventType)).toEqual([
      'version.validation_started',
      'version.validation_passed'
    ]);
    expect(repository.domainEvents.map((item) => item.eventType)).toEqual([
      'version.validation_started',
      'version.review_requested'
    ]);

    const published = await service.approveReview(submitted.review!.id, '證據完整', identities.reviewer);

    expect(published.version.lifecycle).toBe('published');
    expect(published.review.status).toBe('approved');
    expect(repository.auditLogs.at(-1)?.eventType).toBe('version.published');
    expect(repository.domainEvents.at(-1)?.eventType).toBe('version.published');
  });

  it('只有 begin CAS 成功後才執行外部 runner', async () => {
    const runner = new SuccessfulRunner();
    const { service } = createHarness('draft', runner);

    await service.submitReview('pkg-one', '1.0.0', identities.author);
    await expect(service.submitReview('pkg-one', '1.0.0', identities.author)).rejects.toMatchObject({
      statusCode: 409,
      code: 'INVALID_VERSION_TRANSITION'
    });

    expect(runner.calls).toHaveLength(1);
  });

  it('驗證失敗保存證據並退回 draft，不建立待審', async () => {
    const failedRunner: ValidationRunner = {
      async run(input) {
        return {
          status: 'failed', runnerVersion: 'memory-runner/1', errorCode: 'install_failed',
          matrixResults: [{
            os: 'linux', client: 'codex', runnerName: 'memory', runnerVersion: '1',
            scriptDigest: input.version.scriptDigest ?? '', startedAt: now, endedAt: now,
            installExitCode: 1, telemetrySeen: false, cleanupSucceeded: false,
            status: 'failed', errorCode: 'install_failed'
          }]
        };
      }
    };
    const { service, repository } = createHarness('draft', failedRunner);

    const result = await service.submitReview('pkg-one', '1.0.0', identities.author);

    expect(result.version.lifecycle).toBe('draft');
    expect(result.review).toBeUndefined();
    expect(repository.validationRuns[0]).toMatchObject({ status: 'failed', errorCode: 'install_failed' });
  });

  it('begin 從不可變 target revisions 保存精確 Matrix', async () => {
    const windowsClaude = scriptTarget(
      { id: 'target-windows-claude-code', targetOs: 'windows', clientRuntime: 'claude-code' },
      { targetId: 'target-windows-claude-code', targetOs: 'windows', clientRuntime: 'claude-code' }
    );
    const snapshot = aggregate('draft', {
      supportedOs: ['linux', 'windows'],
      supportedClients: [
        { name: ' Codex ', adaptationSource: 'publisher', maintainer: 'team-a' },
        { name: 'CLAUDE-CODE', adaptationSource: 'maintainer', maintainer: 'team-a' }
      ],
      scriptTargets: [scriptTarget(), windowsClaude]
    });
    const repository = new MemoryGovernanceRepository({ aggregates: [snapshot] });

    const begun = await repository.beginValidation({
      aggregate: snapshot,
      version: snapshot.versions[0]!,
      actorUid: 'author-1',
      occurredAt: now
    });
    snapshot.versions[0]!.supportedOs.splice(0);
    snapshot.versions[0]!.supportedClients.splice(0);

    expect(begun.validationRun.expectedMatrix).toEqual([
      expect.objectContaining({ os: 'linux/macos', client: 'codex' }),
      expect.objectContaining({ os: 'windows', client: 'claude-code' })
    ]);
    expect(repository.validationRuns[0]?.expectedMatrix).toHaveLength(2);
  });

  it.each([
    ['遺漏', [passedMatrix('linux', 'codex')]],
    ['額外', [passedMatrix('linux', 'codex'), passedMatrix('windows', 'codex'), passedMatrix('macos', 'codex')]],
    ['重複', [passedMatrix('linux', 'codex'), passedMatrix('windows', 'codex'), passedMatrix('windows', 'CODEX')]],
    ['未支援', [passedMatrix('linux', 'codex'), passedMatrix('windows', 'codex', { status: 'not_supported', cleanupSucceeded: false })]],
    ['失敗', [passedMatrix('linux', 'codex'), passedMatrix('windows', 'codex', { status: 'failed', installExitCode: 1 })]],
    ['偽 passed 遙測證據', [passedMatrix('linux', 'codex'), passedMatrix('windows', 'codex', { telemetrySeen: false })]],
    ['偽 passed runner 證據', [passedMatrix('linux', 'codex'), passedMatrix('windows', 'codex', { runnerName: '' })]]
  ] as const)('矩陣%s時驗證失敗退回 draft 且不建立 Review', async (_caseName, matrixResults) => {
    const windows = scriptTarget(
      { id: 'target-windows-codex', targetOs: 'windows', clientRuntime: 'codex' },
      { targetId: 'target-windows-codex', targetOs: 'windows', clientRuntime: 'codex' }
    );
    const snapshot = aggregate('draft', {
      supportedOs: ['linux', 'windows'],
      scriptTargets: [scriptTarget(), windows]
    });
    const repository = new MemoryGovernanceRepository({ aggregates: [snapshot] });
    const begun = await repository.beginValidation({
      aggregate: snapshot,
      version: snapshot.versions[0]!,
      actorUid: 'author-1',
      occurredAt: now
    });

    const completed = await repository.completeValidation({
      validationRunId: begun.validationRun.id,
      result: { status: 'passed', runnerVersion: 'memory/1', matrixResults: [...matrixResults] },
      occurredAt: now
    });

    expect(completed.version.lifecycle).toBe('draft');
    expect(completed.validationRun).toMatchObject({ status: 'failed', errorCode: 'validation_matrix_mismatch' });
    expect(completed.review).toBeUndefined();
    expect(await repository.listReviews({ status: 'pending' })).toHaveLength(0);
  });

  it('矩陣結果以 target identity 與 revision metadata 精確匹配', async () => {
    const snapshot = aggregate('draft');
    const repository = new MemoryGovernanceRepository({ aggregates: [snapshot] });
    const begun = await repository.beginValidation({ aggregate: snapshot, version: snapshot.versions[0]!, actorUid: 'author-1', occurredAt: now });

    const completed = await repository.completeValidation({
      validationRunId: begun.validationRun.id,
      result: { status: 'passed', runnerVersion: 'memory/1', matrixResults: [passedMatrix('linux/macos', 'codex')] },
      occurredAt: now
    });

    expect(completed.version.lifecycle).toBe('review_required');
    expect(completed.review?.status).toBe('pending');
  });

  it.each([
    ['原請求維護者', identities.author],
    ['平台管理員', identities.admin]
  ])('crash 後 %s 可 claim stuck run，保留 attempt 證據並只建立一個 pending Review', async (_label, identity) => {
    const snapshot = aggregate();
    const { service, repository } = createHarness('draft', new SuccessfulRunner(), snapshot);
    const stuck = await repository.beginValidation({
      aggregate: snapshot,
      version: snapshot.versions[0]!,
      actorUid: 'author-1',
      occurredAt: now
    });

    const recovered = await service.retryValidation(stuck.validationRun.id, identity);

    expect(recovered.version.lifecycle).toBe('review_required');
    expect(recovered.review?.status).toBe('pending');
    expect(repository.validationRuns[0]?.attempts).toEqual([
      expect.objectContaining({ attempt: 1, status: 'abandoned', requestedByUid: 'author-1' }),
      expect.objectContaining({ attempt: 2, status: 'passed', requestedByUid: identity.kind === 'authenticated' ? identity.uid : '' })
    ]);
    expect(await repository.listReviews({ status: 'pending' })).toHaveLength(1);
  });

  it('非原請求者且非平台管理員不可 retry，runner 不會執行', async () => {
    const snapshot = aggregate();
    const runner = new SuccessfulRunner();
    const { service, repository } = createHarness('draft', runner, snapshot);
    const stuck = await repository.beginValidation({ aggregate: snapshot, version: snapshot.versions[0]!, actorUid: 'author-1', occurredAt: now });

    await expect(service.retryValidation(stuck.validationRun.id, identities.employee)).rejects.toMatchObject({
      statusCode: 403,
      code: 'FORBIDDEN'
    });

    expect(runner.calls).toHaveLength(0);
    expect(repository.validationRuns[0]?.attempts).toHaveLength(1);
  });

  it('並行 retry 只有第一個 CAS claim 可執行 runner，完成後只有一個 pending Review', async () => {
    let releaseRunner: ((result: ValidationRunResult) => void) | undefined;
    const calls: ValidationRunnerInput[] = [];
    const runner: ValidationRunner = {
      run(input) {
        calls.push(input);
        return new Promise<ValidationRunResult>((resolve) => {
          releaseRunner = resolve;
        });
      }
    };
    const snapshot = aggregate();
    const { service, repository } = createHarness('draft', runner, snapshot);
    const stuck = await repository.beginValidation({ aggregate: snapshot, version: snapshot.versions[0]!, actorUid: 'author-1', occurredAt: now });

    const firstRetry = service.retryValidation(stuck.validationRun.id, identities.author);
    await expect.poll(() => calls.length).toBe(1);
    await expect(service.retryValidation(stuck.validationRun.id, identities.author)).rejects.toMatchObject({
      statusCode: 409,
      code: 'VALIDATION_RETRY_ALREADY_CLAIMED'
    });
    expect(calls).toHaveLength(1);
    releaseRunner?.({ status: 'passed', runnerVersion: 'memory/1', matrixResults: [passedMatrix('linux', 'codex')] });
    await firstRetry;

    expect(repository.validationRuns[0]?.attempts).toHaveLength(2);
    expect(await repository.listReviews({ status: 'pending' })).toHaveLength(1);
  });

  it('retry claim 在 15 分鐘 TTL 前不可回收且 claim 時間可觀察', async () => {
    const snapshot = aggregate();
    const repository = new MemoryGovernanceRepository({ aggregates: [snapshot] });
    const stuck = await repository.beginValidation({ aggregate: snapshot, version: snapshot.versions[0]!, actorUid: 'author-1', occurredAt: now });
    const firstClaim = await repository.claimValidationRetry({ validationRunId: stuck.validationRun.id, actorUid: 'author-1', occurredAt: now });
    const beforeExpiry = new Date(now.getTime() + 15 * 60 * 1000 - 1);

    await expect(repository.claimValidationRetry({
      validationRunId: stuck.validationRun.id,
      actorUid: 'author-1',
      occurredAt: beforeExpiry
    })).rejects.toMatchObject({ statusCode: 409, code: 'VALIDATION_RETRY_ALREADY_CLAIMED' });

    expect(firstClaim.validationRun.retryClaimedAt).toEqual(now);
    expect(repository.validationRuns[0]?.attempts).toHaveLength(2);
    const completed = await repository.completeValidation({
      validationRunId: stuck.validationRun.id,
      retryClaimToken: firstClaim.retryClaimToken,
      result: {
        status: 'failed', runnerVersion: 'memory/1', matrixResults: [],
        errorCode: 'runner_failed'
      },
      occurredAt: beforeExpiry
    });
    expect(completed.version.lifecycle).toBe('draft');
    expect(completed.validationRun.status).toBe('failed');
  });

  it('retry claim 到 15 分鐘可原子回收，舊 token 不污染新 attempt，新 token 只建立一個 Review', async () => {
    const snapshot = aggregate();
    const repository = new MemoryGovernanceRepository({ aggregates: [snapshot] });
    const stuck = await repository.beginValidation({ aggregate: snapshot, version: snapshot.versions[0]!, actorUid: 'author-1', occurredAt: now });
    const firstClaim = await repository.claimValidationRetry({ validationRunId: stuck.validationRun.id, actorUid: 'author-1', occurredAt: now });
    const expiresAt = new Date(now.getTime() + 15 * 60 * 1000);

    const reclaimed = await repository.claimValidationRetry({
      validationRunId: stuck.validationRun.id,
      actorUid: 'admin-1',
      occurredAt: expiresAt
    });

    expect(reclaimed.retryClaimToken).not.toBe(firstClaim.retryClaimToken);
    expect(reclaimed.validationRun.retryClaimedAt).toEqual(expiresAt);
    expect(reclaimed.validationRun.attempts).toEqual([
      expect.objectContaining({ attempt: 1, status: 'abandoned', errorCode: 'validation_attempt_abandoned' }),
      expect.objectContaining({ attempt: 2, status: 'abandoned', endedAt: expiresAt, errorCode: 'validation_retry_claim_expired' }),
      expect.objectContaining({ attempt: 3, status: 'running', requestedByUid: 'admin-1' })
    ]);

    const passedResult: ValidationRunResult = {
      status: 'passed',
      runnerVersion: 'memory/1',
      matrixResults: [passedMatrix('linux', 'codex')]
    };
    await expect(repository.completeValidation({
      validationRunId: stuck.validationRun.id,
      retryClaimToken: firstClaim.retryClaimToken,
      result: passedResult,
      occurredAt: expiresAt
    })).rejects.toMatchObject({ statusCode: 409, code: 'VALIDATION_RETRY_CLAIM_CONFLICT' });
    expect(repository.validationRuns[0]?.attempts.at(-1)).toMatchObject({ attempt: 3, status: 'running' });
    expect(await repository.listReviews({ status: 'pending' })).toHaveLength(0);

    const completed = await repository.completeValidation({
      validationRunId: stuck.validationRun.id,
      retryClaimToken: reclaimed.retryClaimToken,
      result: passedResult,
      occurredAt: new Date(expiresAt.getTime() + 1)
    });

    expect(completed.version.lifecycle).toBe('review_required');
    expect(completed.validationRun.retryClaimedAt).toBeUndefined();
    expect(completed.validationRun.attempts.at(-1)).toMatchObject({ attempt: 3, status: 'passed' });
    expect(await repository.listReviews({ status: 'pending' })).toHaveLength(1);
  });

  it('Memory retry claim 在 TTL 邊界拒絕完成且狀態不變後可回收', async () => {
    const snapshot = aggregate();
    const repository = new MemoryGovernanceRepository({ aggregates: [snapshot] });
    const stuck = await repository.beginValidation({
      aggregate: snapshot, version: snapshot.versions[0]!,
      actorUid: 'author-1', occurredAt: now
    });
    const firstClaim = await repository.claimValidationRetry({
      validationRunId: stuck.validationRun.id,
      actorUid: 'author-1', occurredAt: now
    });
    const expiresAt = new Date(now.getTime() + 15 * 60 * 1000);
    const before = repository.validationRuns[0];

    await expect(repository.completeValidation({
      validationRunId: stuck.validationRun.id,
      retryClaimToken: firstClaim.retryClaimToken,
      result: {
        status: 'passed', runnerVersion: 'memory/1',
        matrixResults: [passedMatrix('linux', 'codex')]
      },
      occurredAt: expiresAt
    })).rejects.toMatchObject({
      statusCode: 409,
      code: 'VALIDATION_RETRY_CLAIM_EXPIRED'
    });
    expect(repository.validationRuns[0]).toEqual(before);
    expect(await repository.findVersion('pkg-one', '1.0.0')).toMatchObject({
      lifecycle: 'validating'
    });

    const reclaimed = await repository.claimValidationRetry({
      validationRunId: stuck.validationRun.id,
      actorUid: 'admin-1', occurredAt: expiresAt
    });
    expect(reclaimed.retryClaimToken).not.toBe(firstClaim.retryClaimToken);
    await expect(repository.completeValidation({
      validationRunId: stuck.validationRun.id,
      retryClaimToken: firstClaim.retryClaimToken,
      result: { status: 'failed', runnerVersion: 'memory/1', matrixResults: [] },
      occurredAt: new Date(expiresAt.getTime() + 1)
    })).rejects.toMatchObject({ code: 'VALIDATION_RETRY_CLAIM_CONFLICT' });
  });

  it.each([
    ['作者', identities.author],
    ['所有團隊成員', identities.ownerMember],
    ['未指派員工', identities.employee]
  ])('%s 不可批准，指定跨團隊審核人可批准', async (_label, identity) => {
    const { service } = createHarness();
    const submitted = await service.submitReview('pkg-one', '1.0.0', identities.author);

    await expect(service.approveReview(submitted.review!.id, '嘗試批准', identity)).rejects.toMatchObject({
      statusCode: 403,
      code: 'FORBIDDEN'
    });

    const result = await service.approveReview(submitted.review!.id, '跨團隊批准', identities.reviewer);
    expect(result.version.lifecycle).toBe('published');
  });

  it.each(['review_required', 'published'] as const)('%s 修改後退回 draft 並關閉 pending review', async (lifecycle) => {
    const { service, repository } = createHarness();
    const submitted = await service.submitReview('pkg-one', '1.0.0', identities.author);
    if (lifecycle === 'published') {
      await service.approveReview(submitted.review!.id, '批准', identities.reviewer);
    }

    const revised = await service.reviseVersion('pkg-one', '1.0.0', identities.author);

    expect(revised.lifecycle).toBe('draft');
    expect((await repository.findReview(submitted.review!.id))?.status).toBe(
      lifecycle === 'review_required' ? 'superseded' : 'approved'
    );
    expect(await repository.listReviews({ status: 'pending' })).toHaveLength(0);
  });

  it('validating 中修改回 409 且沒有部分審計或 outbox', async () => {
    const snapshot = aggregate();
    const { service, repository } = createHarness();
    await repository.beginValidation({ aggregate: snapshot, version: snapshot.versions[0]!, actorUid: 'author-1', occurredAt: now });
    const auditCount = repository.auditLogs.length;
    const eventCount = repository.domainEvents.length;

    await expect(service.reviseVersion('pkg-one', '1.0.0', identities.author)).rejects.toMatchObject({
      statusCode: 409,
      code: 'INVALID_VERSION_TRANSITION'
    });
    expect(repository.auditLogs).toHaveLength(auditCount);
    expect(repository.domainEvents).toHaveLength(eventCount);
  });

  it('撤下按 UID 去重通知並忽略匿名 UUID，重複撤下回 409', async () => {
    const snapshot = aggregate('published');
    const catalog = new MemoryCatalogRepository({ packages: [snapshot.package], versions: snapshot.versions });
    const identityRepository = new MemoryIdentityRepository({
      identities: [{ uid: 'author-1', displayName: '作者', teamIds: ['team-a'], providerType: 'development', active: true, createdAt: now, updatedAt: now }],
      roles: [{ id: 'maintainer-role', uid: 'author-1', role: 'maintainer', scopeType: 'team', scopeValue: 'team-a', assignedByUid: 'admin', active: true, createdAt: now }],
      packages: [{ packageId: 'pkg-one', ownerTeam: 'team-a', packageType: 'skill', category: 'development' }]
    });
    const repository = new MemoryGovernanceRepository({
      aggregates: [snapshot],
      installations: [
        { id: 'i-1', packageId: 'pkg-one', version: '1.0.0', userRefType: 'uid', userRef: 'user-1', status: 'succeeded' },
        { id: 'i-2', packageId: 'pkg-one', version: '1.0.0', userRefType: 'uid', userRef: 'user-1', status: 'downloaded' },
        { id: 'i-3', packageId: 'pkg-one', version: '1.0.0', userRefType: 'uid', userRef: 'user-2', status: 'succeeded' },
        { id: 'i-4', packageId: 'pkg-one', version: '1.0.0', userRefType: 'uuid', userRef: 'anonymous-uuid', status: 'succeeded' }
      ]
    });
    const service = new GovernanceService(repository, catalog, new AuthorizationService(identityRepository), new SuccessfulRunner(), () => now);

    const delisted = await service.delistVersion('pkg-one', '1.0.0', {
      reasonCode: 'security_issue', reasonDetail: '立即撤下', effectiveAt: now
    }, identities.author);

    expect(delisted.version.lifecycle).toBe('delisted');
    expect((await repository.listNotifications({})).map((item) => item.recipientUid).sort()).toEqual(['user-1', 'user-2']);
    const notification = delisted.notifications[0]!;
    const beforeWrong = {
      audits: repository.auditLogs,
      events: repository.domainEvents,
      notifications: await repository.listNotifications({})
    };
    expect(await repository.markNotificationRead(
      notification.id, 'wrong-uid', now
    )).toBeUndefined();
    expect(repository.auditLogs).toEqual(beforeWrong.audits);
    expect(repository.domainEvents).toEqual(beforeWrong.events);
    expect(await repository.listNotifications({})).toEqual(beforeWrong.notifications);

    const read = await repository.markNotificationRead(
      notification.id, notification.recipientUid, now
    );
    expect(read).toMatchObject({ status: 'read', readAt: now });
    expect(repository.auditLogs.at(-1)).toMatchObject({
      eventType: 'notification.read', actorUid: notification.recipientUid,
      details: { notificationId: notification.id }
    });
    expect(repository.domainEvents.at(-1)).toMatchObject({
      aggregateType: 'user_notification', aggregateId: notification.id,
      eventType: 'notification.read'
    });
    const afterFirstRead = {
      audits: repository.auditLogs,
      events: repository.domainEvents
    };
    expect(await repository.markNotificationRead(
      notification.id, notification.recipientUid, now
    )).toEqual(read);
    expect(repository.auditLogs).toEqual(afterFirstRead.audits);
    expect(repository.domainEvents).toEqual(afterFirstRead.events);
    await expect(service.delistVersion('pkg-one', '1.0.0', {
      reasonCode: 'security_issue', effectiveAt: now
    }, identities.author)).rejects.toMatchObject({ statusCode: 409, code: 'INVALID_VERSION_TRANSITION' });
  });

  it('核准發布時通知既有版本的安裝者，排除作者、匿名與已在新版者', async () => {
    const snapshot = aggregate('draft');
    const catalog = new MemoryCatalogRepository({
      packages: [snapshot.package], versions: snapshot.versions
    });
    const identityRepository = new MemoryIdentityRepository({
      identities: [
        { uid: 'author-1', displayName: '作者', teamIds: ['team-a'], providerType: 'development', active: true, createdAt: now, updatedAt: now },
        { uid: 'reviewer-1', displayName: '跨團隊審核人', teamIds: ['team-b'], providerType: 'development', active: true, createdAt: now, updatedAt: now }
      ],
      roles: [
        { id: 'maintainer-role', uid: 'author-1', role: 'maintainer', scopeType: 'team', scopeValue: 'team-a', assignedByUid: 'admin', active: true, createdAt: now },
        { id: 'reviewer-role', uid: 'reviewer-1', role: 'reviewer', scopeType: 'global', scopeValue: '', assignedByUid: 'admin', active: true, createdAt: now }
      ],
      packages: [{ packageId: 'pkg-one', ownerTeam: 'team-a', packageType: 'skill', category: 'development' }],
      reviewerAssignments: [{
        id: 'reviewer-assignment', reviewerUid: 'reviewer-1', packageType: 'skill',
        category: 'development', assignedByUid: 'admin', active: true, createdAt: now
      }]
    });
    const repository = new MemoryGovernanceRepository({
      aggregates: [snapshot],
      installations: [
        // 舊版安裝者：應收到通知
        { id: 'i-1', packageId: 'pkg-one', version: '0.9.0', userRefType: 'uid', userRef: 'user-1', status: 'succeeded' },
        { id: 'i-2', packageId: 'pkg-one', version: '0.9.0', userRefType: 'uid', userRef: 'user-1', status: 'downloaded' },
        { id: 'i-3', packageId: 'pkg-one', version: '0.8.0', userRefType: 'uid', userRef: 'user-2', status: 'downloaded' },
        // 匿名 UUID 沒有收件匣
        { id: 'i-4', packageId: 'pkg-one', version: '0.9.0', userRefType: 'uuid', userRef: 'anonymous-uuid', status: 'succeeded' },
        // 作者本人不通知自己
        { id: 'i-5', packageId: 'pkg-one', version: '0.9.0', userRefType: 'uid', userRef: 'author-1', status: 'succeeded' },
        // 已經裝在本次發布版本上，不需要提醒升級
        { id: 'i-6', packageId: 'pkg-one', version: '1.0.0', userRefType: 'uid', userRef: 'user-3', status: 'succeeded' },
        // 其他套件不受影響
        { id: 'i-7', packageId: 'pkg-two', version: '0.9.0', userRefType: 'uid', userRef: 'user-4', status: 'succeeded' }
      ]
    });
    const service = new GovernanceService(
      repository, catalog, new AuthorizationService(identityRepository, () => now),
      new SuccessfulRunner(), () => now
    );

    const submitted = await service.submitReview('pkg-one', '1.0.0', identities.author);
    const published = await service.approveReview(
      submitted.review!.id, '證據完整', identities.reviewer
    );

    expect(published.version.lifecycle).toBe('published');
    expect(published.notifications.map((item) => item.recipientUid).sort())
      .toEqual(['user-1', 'user-2']);
    expect(published.notifications[0]).toMatchObject({
      notificationType: 'version_published',
      packageId: 'pkg-one',
      version: '1.0.0',
      status: 'unread',
      payload: { releaseNotes: '第一版' }
    });
    expect(repository.auditLogs.at(-1)).toMatchObject({
      eventType: 'version.published',
      details: { notificationCount: 2 }
    });
  });

  it('駁回審核不產生發布通知', async () => {
    const snapshot = aggregate('draft');
    const catalog = new MemoryCatalogRepository({
      packages: [snapshot.package], versions: snapshot.versions
    });
    const identityRepository = new MemoryIdentityRepository({
      identities: [
        { uid: 'author-1', displayName: '作者', teamIds: ['team-a'], providerType: 'development', active: true, createdAt: now, updatedAt: now },
        { uid: 'reviewer-1', displayName: '跨團隊審核人', teamIds: ['team-b'], providerType: 'development', active: true, createdAt: now, updatedAt: now }
      ],
      roles: [
        { id: 'maintainer-role', uid: 'author-1', role: 'maintainer', scopeType: 'team', scopeValue: 'team-a', assignedByUid: 'admin', active: true, createdAt: now },
        { id: 'reviewer-role', uid: 'reviewer-1', role: 'reviewer', scopeType: 'global', scopeValue: '', assignedByUid: 'admin', active: true, createdAt: now }
      ],
      packages: [{ packageId: 'pkg-one', ownerTeam: 'team-a', packageType: 'skill', category: 'development' }],
      reviewerAssignments: [{
        id: 'reviewer-assignment', reviewerUid: 'reviewer-1', packageType: 'skill',
        category: 'development', assignedByUid: 'admin', active: true, createdAt: now
      }]
    });
    const repository = new MemoryGovernanceRepository({
      aggregates: [snapshot],
      installations: [
        { id: 'i-1', packageId: 'pkg-one', version: '0.9.0', userRefType: 'uid', userRef: 'user-1', status: 'succeeded' }
      ]
    });
    const service = new GovernanceService(
      repository, catalog, new AuthorizationService(identityRepository, () => now),
      new SuccessfulRunner(), () => now
    );

    const submitted = await service.submitReview('pkg-one', '1.0.0', identities.author);
    const rejected = await service.rejectReview(
      submitted.review!.id, '殘留說明不足', identities.reviewer
    );

    expect(rejected.review.status).toBe('rejected');
    expect(rejected.notifications).toEqual([]);
    expect(await repository.listNotifications({})).toEqual([]);
  });

  it('拒絕尚未生效的未來撤下時間', async () => {
    const { service } = createHarness('published');

    await expect(service.delistVersion('pkg-one', '1.0.0', {
      reasonCode: 'maintenance', effectiveAt: new Date('2026-08-25T08:00:01.000Z')
    }, identities.author)).rejects.toMatchObject({ statusCode: 400, code: 'FUTURE_DELIST_NOT_SUPPORTED' });
  });
});
