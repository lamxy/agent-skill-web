// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { randomUUID } from 'node:crypto';

import {
  and,
  eq,
  inArray,
  isNull,
  ne,
  sql,
  type ExtractTablesWithRelations
} from 'drizzle-orm';
import type {
  NodePgDatabase,
  NodePgTransaction
} from 'drizzle-orm/node-postgres';

import { AppError } from '../../shared/errors/app-error.js';
import * as schema from '../../shared/database/schema.js';
import { compareSemanticVersions } from '../../shared/version/semantic-version.js';
import { mapPackageRow } from '../catalog/package-row.js';
import type {
  PackageRecord,
  PackageVersionRecord,
  ScriptTargetRecord,
  ScriptTargetRevision
} from '../catalog/types.js';
import type {
  BeginValidationInput,
  BeginValidationResult,
  ClaimValidationRetryInput,
  ClaimValidationRetryResult,
  CompleteValidationInput,
  CompleteValidationResult,
  DecideReviewInput,
  DecideReviewResult,
  DeprecateVersionInput,
  DelistVersionInput,
  DelistVersionResult,
  EmergencyDisableVersionInput,
  GovernanceRepository,
  NotificationListFilters,
  PublicationReview,
  ReviewListFilters,
  ReviseVersionInput,
  UpdateVersionContentInput,
  UserNotification,
  ValidationAttempt,
  ValidationRun,
  VersionDelisting
} from './repository.js';
import { VALIDATION_RETRY_CLAIM_TTL_MS } from './repository.js';
import { transitionVersion } from './version-state-machine.js';
import {
  SCRIPT_TARGET_CONTRACT_VERSION,
  requireCompleteTargetSnapshots,
  scriptManifestDigest,
  type ValidationTargetSnapshot
} from './script-target-governance.js';
import {
  normalizeClientName,
  normalizeOsName,
  type ValidationMatrixResult,
  type ValidationMatrixTarget
} from './validation-runner.js';

type GovernanceDatabase = NodePgDatabase<typeof schema>;
type GovernanceTransaction = NodePgTransaction<
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

function conflict(message: string): AppError {
  return new AppError({
    statusCode: 409,
    code: 'INVALID_VERSION_TRANSITION',
    message
  });
}

function mapVersion(
  row: typeof schema.packageVersions.$inferSelect,
  scriptTargets: ScriptTargetRecord[] = []
): PackageVersionRecord {
  return {
    id: String(row.id),
    packageId: row.packageId,
    version: row.version,
    ...(row.releaseNotes ? { releaseNotes: row.releaseNotes } : {}),
    supportedOs: [...row.supportedOs],
    supportedClients: row.supportedClients.map((client) => ({ ...client })),
    lifecycle: row.lifecycle,
    ...(row.scriptDigest ? { scriptDigest: row.scriptDigest } : {}),
    ...(row.scriptManifestDigest ? { scriptManifestDigest: row.scriptManifestDigest } : {}),
    ...(row.publishedAt ? { publishedAt: row.publishedAt } : {}),
    installCommand: row.installCommand,
    uninstallCommand: row.uninstallCommand,
    hasResidualEffects: row.hasResidualEffects,
    ...(row.residualDescription ? { residualDescription: row.residualDescription } : {}),
    ...(row.manualCleanupSteps ? { manualCleanupSteps: row.manualCleanupSteps } : {}),
    scriptTargets,
    authorUid: row.authorUid,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function mapReview(row: typeof schema.publicationReviews.$inferSelect): PublicationReview {
  const packageSnapshot = row.packageSnapshot;
  const versionSnapshot = row.versionSnapshot;
  return {
    id: row.id,
    packageId: row.packageId,
    version: row.version,
    packageType: row.packageType as PublicationReview['packageType'],
    category: row.category,
    ownerTeam: row.ownerTeam,
    authorUid: row.authorUid,
    packageSnapshot: {
      ...packageSnapshot,
      createdAt: toDate(packageSnapshot.createdAt as Date | string),
      updatedAt: toDate(packageSnapshot.updatedAt as Date | string)
    },
    versionSnapshot: mapVersionSnapshot(versionSnapshot),
    validationRunId: row.validationRunId,
    ...(row.reviewerUid ? { reviewerUid: row.reviewerUid } : {}),
    status: row.status,
    ...(row.decisionReason ? { decisionReason: row.decisionReason } : {}),
    createdAt: row.createdAt,
    ...(row.decidedAt ? { decidedAt: row.decidedAt } : {})
  };
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function mapMatrixResult(result: ValidationMatrixResult): ValidationMatrixResult {
  return {
    ...result,
    startedAt: toDate(result.startedAt as Date | string),
    endedAt: toDate(result.endedAt as Date | string)
  };
}

function mapAttempt(attempt: ValidationAttempt): ValidationAttempt {
  return {
    ...attempt,
    startedAt: toDate(attempt.startedAt as Date | string),
    ...(attempt.endedAt ? { endedAt: toDate(attempt.endedAt as Date | string) } : {}),
    matrixResults: attempt.matrixResults.map(mapMatrixResult)
  };
}

function mapValidationRun(row: typeof schema.validationRuns.$inferSelect): ValidationRun {
  return {
    id: row.id,
    packageId: row.packageId,
    version: row.version,
    scriptDigest: row.scriptDigest,
    contractVersion: row.contractVersion ?? 1,
    targetSnapshots: (row.targetSnapshots ?? []).map(mapTargetSnapshot),
    manifestDigest: row.manifestDigest ?? row.scriptDigest,
    status: row.status as ValidationRun['status'],
    requestedByUid: row.requestedByUid,
    expectedMatrix: row.expectedMatrix.map((target) => ({ ...target })),
    attempts: row.attempts.map(mapAttempt),
    ...(row.retryClaimToken ? { retryClaimToken: row.retryClaimToken } : {}),
    ...(row.retryClaimedAt ? { retryClaimedAt: row.retryClaimedAt } : {}),
    lastAttemptStartedAt: row.lastAttemptStartedAt,
    runnerVersion: row.runnerVersion,
    matrixResults: row.matrixResults.map(mapMatrixResult),
    startedAt: row.startedAt,
    ...(row.endedAt ? { endedAt: row.endedAt } : {}),
    ...(row.errorCode ? { errorCode: row.errorCode } : {})
  };
}

function mapTargetSnapshot(snapshot: ValidationTargetSnapshot): ValidationTargetSnapshot {
  return {
    ...snapshot,
    options: snapshot.options.map((option) => ({
      ...option,
      ...(option.choices ? { choices: [...option.choices] } : {})
    }))
  };
}

function mapVersionSnapshot(snapshot: PackageVersionRecord): PackageVersionRecord {
  return {
    ...snapshot,
    supportedOs: [...snapshot.supportedOs],
    supportedClients: snapshot.supportedClients.map((client) => ({ ...client })),
    scriptTargets: (snapshot.scriptTargets ?? []).map((target) => ({
      ...target,
      ...(target.currentRevision ? { currentRevision: mapSnapshotRevision(target.currentRevision) } : {}),
      revisions: target.revisions.map(mapSnapshotRevision),
      ...(target.deletedAt ? { deletedAt: toDate(target.deletedAt as Date | string) } : {}),
      createdAt: toDate(target.createdAt as Date | string),
      updatedAt: toDate(target.updatedAt as Date | string)
    })),
    ...(snapshot.publishedAt ? { publishedAt: toDate(snapshot.publishedAt as Date | string) } : {}),
    createdAt: toDate(snapshot.createdAt as Date | string),
    updatedAt: toDate(snapshot.updatedAt as Date | string)
  };
}

function mapSnapshotRevision(revision: ScriptTargetRevision): ScriptTargetRevision {
  return {
    ...revision,
    options: revision.options.map((option) => ({
      ...option,
      ...(option.choices ? { choices: [...option.choices] } : {})
    })),
    createdAt: toDate(revision.createdAt as Date | string)
  };
}

function mapDelisting(row: typeof schema.versionDelistings.$inferSelect): VersionDelisting {
  return {
    id: row.id,
    packageId: row.packageId,
    version: row.version,
    reasonCode: row.reasonCode,
    ...(row.reasonDetail ? { reasonDetail: row.reasonDetail } : {}),
    effectiveAt: row.effectiveAt,
    actorUid: row.actorUid,
    createdAt: row.createdAt
  };
}

function mapNotification(row: typeof schema.userNotifications.$inferSelect): UserNotification {
  return {
    id: row.id,
    recipientUid: row.recipientUid,
    notificationType: row.notificationType as UserNotification['notificationType'],
    packageId: row.packageId,
    version: row.version,
    payload: { ...row.payload },
    status: row.status as UserNotification['status'],
    createdAt: row.createdAt,
    ...(row.readAt ? { readAt: row.readAt } : {})
  };
}

function matrixKey(target: ValidationMatrixTarget): string {
  return JSON.stringify([
    normalizeOsName(target.os),
    normalizeClientName(target.client)
  ]);
}

function expectedMatrixFor(snapshots: ValidationTargetSnapshot[]): ValidationMatrixTarget[] {
  return snapshots.map((snapshot) => ({
    targetId: snapshot.targetId,
    os: snapshot.targetOs,
    client: snapshot.clientRuntime,
    scriptVersion: snapshot.scriptVersion,
    contentDigest: snapshot.contentDigest
  }));
}

function hasExactPassedMatrix(
  expected: ValidationMatrixTarget[],
  actual: ValidationMatrixResult[],
  _manifestDigest: string
): boolean {
  if (expected.length === 0 || actual.length !== expected.length) {
    return false;
  }
  const expectedKeys = new Set(expected.map(matrixKey));
  const actualKeys = new Set<string>();
  for (const result of actual) {
    const key = matrixKey(result);
    if (actualKeys.has(key) || !expectedKeys.has(key)) return false;
    actualKeys.add(key);
    const target = expected.find((candidate) => matrixKey(candidate) === key)!;
    if (
      result.status !== 'passed' ||
      (target.targetId !== undefined && (
        result.targetId !== target.targetId ||
        result.scriptVersion !== target.scriptVersion ||
        result.contentDigest !== target.contentDigest ||
        !result.installScriptDigest?.trim() ||
        !result.uninstallScriptDigest?.trim()
      )) ||
      !result.runnerName.trim() ||
      !result.runnerVersion.trim() ||
      !result.scriptDigest.trim() ||
      !Number.isFinite(result.startedAt.getTime()) ||
      !Number.isFinite(result.endedAt.getTime()) ||
      result.endedAt.getTime() < result.startedAt.getTime() ||
      result.installExitCode !== 0 ||
      result.telemetrySeen !== true ||
      result.uninstallExitCode !== 0 ||
      result.cleanupSucceeded !== true
    ) {
      return false;
    }
  }
  return actualKeys.size === expectedKeys.size;
}

function mapRevisionRow(row: typeof schema.scriptTargetRevisions.$inferSelect): ScriptTargetRevision {
  const hasCopySource = row.copiedFromTargetId !== null && row.copiedFromTargetOs !== null &&
    row.copiedFromClientRuntime !== null && row.copiedFromScriptVersion !== null;
  return {
    id: row.id,
    targetId: row.targetId,
    targetOs: row.targetOs as ScriptTargetRevision['targetOs'],
    clientRuntime: row.clientRuntime as ScriptTargetRevision['clientRuntime'],
    scriptVersion: row.scriptVersion,
    installCommand: row.installCommand,
    uninstallCommand: row.uninstallCommand,
    options: row.options.map((option) => ({
      ...option,
      ...(option.choices ? { choices: [...option.choices] } : {})
    })),
    usageInstructions: row.usageInstructions,
    hasResidualEffects: row.hasResidualEffects,
    ...(row.residualDescription ? { residualDescription: row.residualDescription } : {}),
    ...(row.manualCleanupSteps ? { manualCleanupSteps: row.manualCleanupSteps } : {}),
    ...(row.changeDescription ? { changeDescription: row.changeDescription } : {}),
    ...(hasCopySource ? { copiedFrom: {
      targetId: row.copiedFromTargetId!,
      targetOs: row.copiedFromTargetOs as ScriptTargetRevision['targetOs'],
      clientRuntime: row.copiedFromClientRuntime as ScriptTargetRevision['clientRuntime'],
      scriptVersion: row.copiedFromScriptVersion!
    } } : {}),
    contentDigest: row.contentDigest,
    legacyImported: row.legacyImported,
    createdByUid: row.createdByUid,
    createdAt: row.createdAt
  };
}

async function loadVersionTargets(
  transaction: GovernanceTransaction,
  packageId: string,
  version: string
): Promise<ScriptTargetRecord[]> {
  const targetRows = await transaction.select().from(schema.packageVersionScriptTargets)
    .where(and(
      eq(schema.packageVersionScriptTargets.packageId, packageId),
      eq(schema.packageVersionScriptTargets.packageVersion, version)
    ));
  if (targetRows.length === 0) return [];
  const revisionRows = await transaction.select().from(schema.scriptTargetRevisions)
    .where(inArray(schema.scriptTargetRevisions.targetId, targetRows.map((row) => row.id)));
  const revisionsByTarget = new Map<string, ScriptTargetRevision[]>();
  for (const row of revisionRows) {
    const revisions = revisionsByTarget.get(row.targetId) ?? [];
    revisions.push(mapRevisionRow(row));
    revisionsByTarget.set(row.targetId, revisions);
  }
  return targetRows.map((row) => {
    const revisions = (revisionsByTarget.get(row.id) ?? [])
      .sort((left, right) => left.scriptVersion - right.scriptVersion);
    const currentRevision = row.deletedAt
      ? undefined
      : revisions.find((revision) => revision.id === row.currentRevisionId);
    return {
      id: row.id,
      packageId: row.packageId,
      packageVersion: row.packageVersion,
      targetOs: row.targetOs as ScriptTargetRecord['targetOs'],
      clientRuntime: row.clientRuntime as ScriptTargetRecord['clientRuntime'],
      ...(currentRevision ? { currentRevision } : {}),
      revisions,
      ...(row.deletedAt ? { deletedAt: row.deletedAt } : {}),
      ...(row.deletedByUid ? { deletedByUid: row.deletedByUid } : {}),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
  });
}

async function appendObservability(
  transaction: GovernanceTransaction,
  input: {
    eventType: string;
    outboxEventType: string;
    actorUid: string;
    version: PackageVersionRecord;
    details: Record<string, unknown>;
  },
  occurredAt: Date
): Promise<void> {
  const targetId = `${input.version.packageId}@${input.version.version}`;
  await transaction.insert(schema.auditLogs).values({
    eventType: input.eventType,
    actorUid: input.actorUid,
    targetType: 'version',
    targetId,
    action: input.eventType.replaceAll('.', '_'),
    details: input.details,
    occurredAt
  });
  await transaction.insert(schema.domainEvents).values({
    aggregateType: 'package_version',
    aggregateId: targetId,
    eventType: input.outboxEventType,
    payload: {
      actorUid: input.actorUid,
      lifecycle: input.version.lifecycle,
      ...input.details
    },
    occurredAt
  });
}

/**
 * 新版本發布時通知既有安裝者。
 *
 * 收件人是「裝了同一套件其他版本」的 UID：剛發布的版本自己還沒有安裝紀錄，
 * 而已經裝到新版的人不需要被提醒升級。匿名 UUID 沒有收件匣，依 Task #6
 * 既有決策不通知。作者本人排除，避免自己通知自己。
 */
async function notifyExistingInstallers(
  transaction: GovernanceTransaction,
  input: {
    packageId: string;
    version: string;
    authorUid: string;
    releaseNotes?: string;
    occurredAt: Date;
  }
): Promise<Array<typeof schema.userNotifications.$inferSelect>> {
  const installedRows = await transaction.selectDistinct({
    recipientUid: schema.installations.userRef,
    version: schema.installations.version
  }).from(schema.installations).where(and(
    eq(schema.installations.packageId, input.packageId),
    ne(schema.installations.version, input.version),
    eq(schema.installations.userRefType, 'uid'),
    ne(schema.installations.userRef, input.authorUid),
    inArray(schema.installations.status, ['downloaded', 'succeeded'])
  ));

  // 帶上收件人目前安裝的版本，讓通知能直接連到真實的差異比較。
  // 同一人可能裝過多個舊版，取最高者作為差異來源。
  const installedByUid = new Map<string, string>();
  for (const row of installedRows) {
    const current = installedByUid.get(row.recipientUid);
    if (!current || compareSemanticVersions(current, row.version) < 0) {
      installedByUid.set(row.recipientUid, row.version);
    }
  }

  const notifications: Array<typeof schema.userNotifications.$inferSelect> = [];
  for (const [recipientUid, installedVersion] of installedByUid) {
    const inserted = await transaction.insert(schema.userNotifications).values({
      id: randomUUID(),
      recipientUid,
      notificationType: 'version_published',
      packageId: input.packageId,
      version: input.version,
      payload: {
        installedVersion,
        ...(input.releaseNotes ? { releaseNotes: input.releaseNotes } : {})
      },
      status: 'unread',
      createdAt: input.occurredAt
    }).onConflictDoNothing().returning();
    if (inserted[0]) notifications.push(inserted[0]);
  }
  return notifications;
}

export class PostgresGovernanceRepository implements GovernanceRepository {
  constructor(private readonly database: GovernanceDatabase) {}

  async beginValidation(input: BeginValidationInput): Promise<BeginValidationResult> {
    return this.database.transaction(async (transaction) => {
      const versionRows = await transaction.update(schema.packageVersions)
        .set({ lifecycle: 'validating', updatedAt: input.occurredAt })
        .where(and(
          eq(schema.packageVersions.packageId, input.version.packageId),
          eq(schema.packageVersions.version, input.version.version),
          eq(schema.packageVersions.lifecycle, 'draft')
        ))
        .returning();
      const versionRow = versionRows[0];
      if (!versionRow) {
        await this.throwVersionMutationFailure(
          transaction,
          input.version.packageId,
          input.version.version,
          '版本不在草稿狀態'
        );
      }
      const scriptTargets = await loadVersionTargets(
        transaction,
        versionRow!.packageId,
        versionRow!.version
      );
      const version = mapVersion(versionRow!, scriptTargets);
      const targetSnapshots = requireCompleteTargetSnapshots(version);
      const manifestDigest = scriptManifestDigest(targetSnapshots);
      const expectedMatrix = expectedMatrixFor(targetSnapshots);
      await transaction.update(schema.packageVersions).set({
        scriptDigest: manifestDigest,
        scriptManifestDigest: manifestDigest
      }).where(eq(schema.packageVersions.id, versionRow!.id));
      version.scriptDigest = manifestDigest;
      version.scriptManifestDigest = manifestDigest;
      const validationRunId = randomUUID();
      const attempts: ValidationAttempt[] = [{
        attempt: 1,
        kind: 'initial',
        status: 'running',
        requestedByUid: input.actorUid,
        startedAt: input.occurredAt,
        matrixResults: []
      }];
      const runRows = await transaction.insert(schema.validationRuns).values({
        id: validationRunId,
        packageId: version.packageId,
        version: version.version,
        scriptDigest: manifestDigest,
        contractVersion: SCRIPT_TARGET_CONTRACT_VERSION,
        targetSnapshots,
        manifestDigest,
        status: 'running',
        requestedByUid: input.actorUid,
        expectedMatrix,
        attempts,
        lastAttemptStartedAt: input.occurredAt,
        runnerVersion: '',
        matrixResults: [],
        startedAt: input.occurredAt
      }).returning();
      await appendObservability(transaction, {
        eventType: 'version.validation_started',
        outboxEventType: 'version.validation_started',
        actorUid: input.actorUid,
        version,
        details: { validationRunId }
      }, input.occurredAt);
      return { version, validationRun: mapValidationRun(runRows[0]!) };
    });
  }

  async claimValidationRetry(input: ClaimValidationRetryInput): Promise<ClaimValidationRetryResult> {
    return this.database.transaction(async (transaction) => {
      const runRows = await transaction.select().from(schema.validationRuns)
        .where(eq(schema.validationRuns.id, input.validationRunId))
        .limit(1)
        .for('update');
      const runRow = runRows[0];
      if (!runRow) {
        throw new AppError({
          statusCode: 404,
          code: 'VALIDATION_RUN_NOT_FOUND',
          message: '找不到驗證執行記錄'
        });
      }
      if (runRow.status !== 'running') throw conflict('驗證執行已完成');
      const reclaimingExpiredClaim = Boolean(
        runRow.retryClaimToken &&
        runRow.retryClaimedAt &&
        input.occurredAt.getTime() >=
          runRow.retryClaimedAt.getTime() + VALIDATION_RETRY_CLAIM_TTL_MS
      );
      if (runRow.retryClaimToken && !reclaimingExpiredClaim) {
        throw new AppError({
          statusCode: 409,
          code: 'VALIDATION_RETRY_ALREADY_CLAIMED',
          message: '驗證重試已由另一個程序取得'
        });
      }
      const versionRows = await transaction.select().from(schema.packageVersions)
        .where(and(
          eq(schema.packageVersions.packageId, runRow.packageId),
          eq(schema.packageVersions.version, runRow.version)
        )).limit(1);
      const versionRow = versionRows[0];
      if (!versionRow) {
        throw new AppError({
          statusCode: 404,
          code: 'PACKAGE_VERSION_NOT_FOUND',
          message: '找不到套件版本'
        });
      }
      if (versionRow.lifecycle !== 'validating') throw conflict('版本不在驗證中');

      const attempts = runRow.attempts.map(mapAttempt);
      const previousIndex = attempts.length - 1;
      const previous = attempts[previousIndex];
      if (previous?.status === 'running') {
        attempts[previousIndex] = {
          ...previous,
          status: 'abandoned',
          endedAt: input.occurredAt,
          errorCode: reclaimingExpiredClaim
            ? 'validation_retry_claim_expired'
            : 'validation_attempt_abandoned'
        };
      }
      attempts.push({
        attempt: attempts.length + 1,
        kind: 'retry',
        status: 'running',
        requestedByUid: input.actorUid,
        startedAt: input.occurredAt,
        matrixResults: []
      });
      const retryClaimToken = randomUUID();
      const claimedRows = await transaction.update(schema.validationRuns).set({
        attempts,
        retryClaimToken,
        retryClaimedAt: input.occurredAt,
        lastAttemptStartedAt: input.occurredAt
      }).where(and(
        eq(schema.validationRuns.id, input.validationRunId),
        eq(schema.validationRuns.status, 'running'),
        runRow.retryClaimToken
          ? eq(schema.validationRuns.retryClaimToken, runRow.retryClaimToken)
          : isNull(schema.validationRuns.retryClaimToken),
        runRow.retryClaimedAt
          ? eq(schema.validationRuns.retryClaimedAt, runRow.retryClaimedAt)
          : isNull(schema.validationRuns.retryClaimedAt)
      )).returning();
      if (!claimedRows[0]) {
        throw new AppError({
          statusCode: 409,
          code: 'VALIDATION_RETRY_ALREADY_CLAIMED',
          message: '驗證重試已由另一個程序取得'
        });
      }
      const version = mapVersion(
        versionRow,
        await loadVersionTargets(transaction, versionRow.packageId, versionRow.version)
      );
      await appendObservability(transaction, {
        eventType: 'version.validation_retry_started',
        outboxEventType: 'version.validation_retry_started',
        actorUid: input.actorUid,
        version,
        details: {
          validationRunId: runRow.id,
          attempt: attempts.length,
          reclaimedExpiredClaim: reclaimingExpiredClaim
        }
      }, input.occurredAt);
      return {
        version,
        validationRun: mapValidationRun(claimedRows[0]),
        retryClaimToken
      };
    });
  }

  async completeValidation(input: CompleteValidationInput): Promise<CompleteValidationResult> {
    return this.database.transaction(async (transaction) => {
      const runRows = await transaction.select().from(schema.validationRuns)
        .where(eq(schema.validationRuns.id, input.validationRunId))
        .limit(1)
        .for('update');
      const runRow = runRows[0];
      if (!runRow) {
        throw new AppError({
          statusCode: 404,
          code: 'VALIDATION_RUN_NOT_FOUND',
          message: '找不到驗證執行記錄'
        });
      }
      if (runRow.status !== 'running') throw conflict('驗證執行已完成');
      if (
        (runRow.retryClaimToken && input.retryClaimToken !== runRow.retryClaimToken) ||
        (!runRow.retryClaimToken && input.retryClaimToken)
      ) {
        throw new AppError({
          statusCode: 409,
          code: 'VALIDATION_RETRY_CLAIM_CONFLICT',
          message: '驗證重試 claim 已失效'
        });
      }
      if (
        runRow.retryClaimToken &&
        (!runRow.retryClaimedAt ||
          input.occurredAt.getTime() >=
            runRow.retryClaimedAt.getTime() + VALIDATION_RETRY_CLAIM_TTL_MS)
      ) {
        throw new AppError({
          statusCode: 409,
          code: 'VALIDATION_RETRY_CLAIM_EXPIRED',
          message: '驗證重試 claim 已過期'
        });
      }

      const passed = input.result.status === 'passed' &&
        Boolean(input.result.runnerVersion.trim()) &&
        hasExactPassedMatrix(
          runRow.expectedMatrix,
          input.result.matrixResults,
          runRow.scriptDigest
        );
      const nextLifecycle = passed ? 'review_required' : 'draft';
      const versionRows = await transaction.update(schema.packageVersions).set({
        lifecycle: nextLifecycle,
        updatedAt: input.occurredAt
      }).where(and(
        eq(schema.packageVersions.packageId, runRow.packageId),
        eq(schema.packageVersions.version, runRow.version),
        eq(schema.packageVersions.lifecycle, 'validating')
      )).returning();
      if (!versionRows[0]) {
        await this.throwVersionMutationFailure(
          transaction,
          runRow.packageId,
          runRow.version,
          '版本不在驗證中'
        );
      }
      const version = mapVersion(
        versionRows[0]!,
        await loadVersionTargets(transaction, runRow.packageId, runRow.version)
      );
      const attempts = runRow.attempts.map(mapAttempt);
      const currentAttempt = attempts.at(-1);
      if (!currentAttempt || currentAttempt.status !== 'running') {
        throw conflict('驗證嘗試不在執行中');
      }
      const errorCode = passed
        ? undefined
        : input.result.status === 'passed'
          ? 'validation_matrix_mismatch'
          : input.result.errorCode ?? 'validation_failed';
      attempts[attempts.length - 1] = {
        ...currentAttempt,
        status: passed ? 'passed' : 'failed',
        endedAt: input.occurredAt,
        runnerVersion: input.result.runnerVersion,
        matrixResults: input.result.matrixResults.map(mapMatrixResult),
        ...(errorCode ? { errorCode } : {})
      };
      const completionConditions = [
        eq(schema.validationRuns.id, input.validationRunId),
        eq(schema.validationRuns.status, 'running'),
        runRow.retryClaimToken
          ? eq(schema.validationRuns.retryClaimToken, runRow.retryClaimToken)
          : isNull(schema.validationRuns.retryClaimToken),
        runRow.retryClaimToken && runRow.retryClaimedAt
          ? and(
              eq(schema.validationRuns.retryClaimedAt, runRow.retryClaimedAt),
              sql`${schema.validationRuns.retryClaimedAt} + (${VALIDATION_RETRY_CLAIM_TTL_MS} * interval '1 millisecond') > ${input.occurredAt}`
            )
          : isNull(schema.validationRuns.retryClaimedAt)
      ];
      const completedRows = await transaction.update(schema.validationRuns).set({
        status: passed ? 'passed' : 'failed',
        attempts,
        retryClaimToken: null,
        retryClaimedAt: null,
        runnerVersion: input.result.runnerVersion,
        matrixResults: input.result.matrixResults,
        endedAt: input.occurredAt,
        errorCode: errorCode ?? null
      }).where(and(...completionConditions)).returning();
      if (!completedRows[0]) throw conflict('驗證執行已由另一個程序完成');

      let review: PublicationReview | undefined;
      if (passed) {
        const packageRows = await transaction.select().from(schema.packages)
          .where(eq(schema.packages.packageId, runRow.packageId)).limit(1);
        const packageRow = packageRows[0];
        if (!packageRow) {
          throw new AppError({
            statusCode: 404,
            code: 'PACKAGE_NOT_FOUND',
            message: '找不到套件快照'
          });
        }
        const packageSnapshot: PackageRecord = mapPackageRow(packageRow);
        const reviewRows = await transaction.insert(schema.publicationReviews).values({
          id: randomUUID(),
          packageId: runRow.packageId,
          version: runRow.version,
          packageType: packageRow.type,
          category: packageRow.category,
          ownerTeam: packageRow.ownerTeam,
          authorUid: version.authorUid,
          packageSnapshot,
          versionSnapshot: version,
          validationRunId: runRow.id,
          status: 'pending',
          createdAt: input.occurredAt
        }).returning();
        review = mapReview(reviewRows[0]!);
      }

      await appendObservability(transaction, {
        eventType: passed ? 'version.validation_passed' : 'version.validation_failed',
        outboxEventType: passed ? 'version.review_requested' : 'version.validation_failed',
        actorUid: runRow.requestedByUid,
        version,
        details: {
          validationRunId: runRow.id,
          ...(review ? { reviewId: review.id } : {}),
          ...(errorCode ? { errorCode } : {})
        }
      }, input.occurredAt);
      return {
        version,
        validationRun: mapValidationRun(completedRows[0]),
        ...(review ? { review } : {})
      };
    });
  }

  async findValidationRun(validationRunId: string): Promise<ValidationRun | undefined> {
    const rows = await this.database.select().from(schema.validationRuns)
      .where(eq(schema.validationRuns.id, validationRunId)).limit(1);
    return rows[0] ? mapValidationRun(rows[0]) : undefined;
  }

  async findRunningValidationRun(
    packageId: string,
    version: string
  ): Promise<ValidationRun | undefined> {
    const rows = await this.database.select().from(schema.validationRuns)
      .where(and(
        eq(schema.validationRuns.packageId, packageId),
        eq(schema.validationRuns.version, version),
        eq(schema.validationRuns.status, 'running')
      )).limit(1);
    return rows[0] ? mapValidationRun(rows[0]) : undefined;
  }

  async decideReview(input: DecideReviewInput): Promise<DecideReviewResult> {
    return this.database.transaction(async (transaction) => {
      const reviewRows = await transaction.select().from(schema.publicationReviews)
        .where(eq(schema.publicationReviews.id, input.reviewId)).limit(1).for('update');
      const reviewRow = reviewRows[0];
      if (!reviewRow) {
        throw new AppError({ statusCode: 404, code: 'REVIEW_NOT_FOUND', message: '找不到審核記錄' });
      }
      if (reviewRow.status !== 'pending') {
        throw new AppError({
          statusCode: 409,
          code: 'REVIEW_ALREADY_DECIDED',
          message: '審核已完成決議'
        });
      }
      const approved = input.decision === 'approve';
      const reviewSnapshot = mapVersionSnapshot(reviewRow.versionSnapshot);
      const versionRows = await transaction.update(schema.packageVersions).set({
        lifecycle: approved ? 'published' : 'draft',
        ...(approved ? {
          publishedAt: input.occurredAt,
          scriptDigest: reviewSnapshot.scriptManifestDigest ?? reviewSnapshot.scriptDigest ?? null,
          scriptManifestDigest: reviewSnapshot.scriptManifestDigest ?? reviewSnapshot.scriptDigest ?? null
        } : {}),
        updatedAt: input.occurredAt
      }).where(and(
        eq(schema.packageVersions.packageId, reviewRow.packageId),
        eq(schema.packageVersions.version, reviewRow.version),
        eq(schema.packageVersions.lifecycle, 'review_required')
      )).returning();
      if (!versionRows[0]) {
        await this.throwVersionMutationFailure(
          transaction,
          reviewRow.packageId,
          reviewRow.version,
          '版本不在待審狀態'
        );
      }
      const decidedRows = await transaction.update(schema.publicationReviews).set({
        reviewerUid: input.actorUid,
        status: approved ? 'approved' : 'rejected',
        decisionReason: input.reason,
        decidedAt: input.occurredAt
      }).where(and(
        eq(schema.publicationReviews.id, input.reviewId),
        eq(schema.publicationReviews.status, 'pending')
      )).returning();
      if (!decidedRows[0]) {
        throw new AppError({
          statusCode: 409,
          code: 'REVIEW_ALREADY_DECIDED',
          message: '審核已完成決議'
        });
      }
      const version = mapVersion(
        versionRows[0]!,
        await loadVersionTargets(transaction, reviewRow.packageId, reviewRow.version)
      );
      const notificationRows = approved
        ? await notifyExistingInstallers(transaction, {
            packageId: reviewRow.packageId,
            version: reviewRow.version,
            authorUid: reviewRow.authorUid,
            ...(version.releaseNotes ? { releaseNotes: version.releaseNotes } : {}),
            occurredAt: input.occurredAt
          })
        : [];
      const eventType = approved ? 'version.published' : 'version.review_rejected';
      await appendObservability(transaction, {
        eventType,
        outboxEventType: eventType,
        actorUid: input.actorUid,
        version,
        details: {
          reviewId: input.reviewId,
          reason: input.reason,
          ...(approved ? { notificationCount: notificationRows.length } : {})
        }
      }, input.occurredAt);
      return {
        version,
        review: mapReview(decidedRows[0]),
        notifications: notificationRows.map(mapNotification)
      };
    });
  }

  async reviseVersion(input: ReviseVersionInput): Promise<PackageVersionRecord> {
    return this.database.transaction(async (transaction) => {
      const currentRows = await transaction.select().from(schema.packageVersions)
        .where(and(
          eq(schema.packageVersions.packageId, input.packageId),
          eq(schema.packageVersions.version, input.version)
        )).limit(1).for('update');
      const current = currentRows[0];
      if (!current) {
        throw new AppError({
          statusCode: 404,
          code: 'PACKAGE_VERSION_NOT_FOUND',
          message: '找不到套件版本'
        });
      }
      const nextLifecycle = transitionVersion(current.lifecycle, 'REVISE');
      const updatedRows = await transaction.update(schema.packageVersions).set({
        lifecycle: nextLifecycle,
        updatedAt: input.occurredAt
      }).where(and(
        eq(schema.packageVersions.packageId, input.packageId),
        eq(schema.packageVersions.version, input.version),
        eq(schema.packageVersions.lifecycle, current.lifecycle)
      )).returning();
      if (!updatedRows[0]) throw conflict('版本狀態已被其他程序更新');
      await transaction.update(schema.publicationReviews).set({
        status: 'superseded',
        decidedAt: input.occurredAt
      }).where(and(
        eq(schema.publicationReviews.packageId, input.packageId),
        eq(schema.publicationReviews.version, input.version),
        eq(schema.publicationReviews.status, 'pending')
      ));
      const version = mapVersion(updatedRows[0]);
      await appendObservability(transaction, {
        eventType: 'version.revised',
        outboxEventType: 'version.revised',
        actorUid: input.actorUid,
        version,
        details: {}
      }, input.occurredAt);
      return version;
    });
  }

  async updateVersionContent(
    input: UpdateVersionContentInput
  ): Promise<PackageVersionRecord> {
    return this.database.transaction(async (transaction) => {
      const currentRows = await transaction.select().from(schema.packageVersions)
        .where(and(
          eq(schema.packageVersions.packageId, input.packageId),
          eq(schema.packageVersions.version, input.version)
        )).limit(1).for('update');
      const current = currentRows[0];
      if (!current) {
        throw new AppError({ statusCode: 404, code: 'PACKAGE_VERSION_NOT_FOUND', message: '找不到套件版本' });
      }
      const nextLifecycle = current.lifecycle === 'draft'
        ? 'draft'
        : transitionVersion(current.lifecycle, 'REVISE');
      const updatedRows = await transaction.update(schema.packageVersions).set({
        ...input.patch,
        lifecycle: nextLifecycle,
        updatedAt: input.occurredAt
      }).where(and(
        eq(schema.packageVersions.packageId, input.packageId),
        eq(schema.packageVersions.version, input.version),
        eq(schema.packageVersions.lifecycle, current.lifecycle)
      )).returning();
      if (!updatedRows[0]) throw conflict('版本狀態已被其他程序更新');
      if (nextLifecycle !== current.lifecycle) {
        await transaction.update(schema.publicationReviews).set({
          status: 'superseded', decidedAt: input.occurredAt
        }).where(and(
          eq(schema.publicationReviews.packageId, input.packageId),
          eq(schema.publicationReviews.version, input.version),
          eq(schema.publicationReviews.status, 'pending')
        ));
      }
      const version = mapVersion(updatedRows[0]);
      const eventType = nextLifecycle === current.lifecycle
        ? 'version.updated'
        : 'version.revised';
      await appendObservability(transaction, {
        eventType, outboxEventType: eventType, actorUid: input.actorUid,
        version, details: { changedFields: Object.keys(input.patch) }
      }, input.occurredAt);
      return version;
    });
  }

  async deprecateVersion(input: DeprecateVersionInput): Promise<PackageVersionRecord> {
    return this.database.transaction(async (transaction) => {
      const updatedRows = await transaction.update(schema.packageVersions).set({
        lifecycle: 'deprecated', updatedAt: input.occurredAt
      }).where(and(
        eq(schema.packageVersions.packageId, input.packageId),
        eq(schema.packageVersions.version, input.version),
        eq(schema.packageVersions.lifecycle, 'published')
      )).returning();
      if (!updatedRows[0]) {
        await this.throwVersionMutationFailure(
          transaction, input.packageId, input.version,
          '只有已發布版本可以標記為棄用'
        );
      }
      const version = mapVersion(updatedRows[0]!);
      await appendObservability(transaction, {
        eventType: 'version.deprecated', outboxEventType: 'version.deprecated',
        actorUid: input.actorUid, version,
        details: { ...(input.reason ? { reason: input.reason } : {}) }
      }, input.occurredAt);
      return version;
    });
  }

  async delistVersion(input: DelistVersionInput): Promise<DelistVersionResult> {
    return this.database.transaction(async (transaction) => {
      const currentRows = await transaction.select().from(schema.packageVersions)
        .where(and(
          eq(schema.packageVersions.packageId, input.packageId),
          eq(schema.packageVersions.version, input.version)
        )).limit(1).for('update');
      const current = currentRows[0];
      if (!current) {
        throw new AppError({
          statusCode: 404,
          code: 'PACKAGE_VERSION_NOT_FOUND',
          message: '找不到套件版本'
        });
      }
      const nextLifecycle = transitionVersion(current.lifecycle, 'DELIST');
      const updatedRows = await transaction.update(schema.packageVersions).set({
        lifecycle: nextLifecycle,
        updatedAt: input.occurredAt
      }).where(and(
        eq(schema.packageVersions.packageId, input.packageId),
        eq(schema.packageVersions.version, input.version),
        eq(schema.packageVersions.lifecycle, current.lifecycle)
      )).returning();
      if (!updatedRows[0]) throw conflict('版本狀態已被其他程序更新');

      const delistingRows = await transaction.insert(schema.versionDelistings).values({
        id: randomUUID(),
        packageId: input.packageId,
        version: input.version,
        reasonCode: input.reasonCode,
        reasonDetail: input.reasonDetail ?? null,
        effectiveAt: input.effectiveAt,
        actorUid: input.actorUid,
        createdAt: input.occurredAt
      }).returning();
      const recipientRows = await transaction.selectDistinct({
        recipientUid: schema.installations.userRef
      }).from(schema.installations).where(and(
        eq(schema.installations.packageId, input.packageId),
        eq(schema.installations.version, input.version),
        eq(schema.installations.userRefType, 'uid'),
        inArray(schema.installations.status, ['downloaded', 'succeeded'])
      ));
      const notificationRows: Array<typeof schema.userNotifications.$inferSelect> = [];
      for (const recipient of recipientRows) {
        const inserted = await transaction.insert(schema.userNotifications).values({
          id: randomUUID(),
          recipientUid: recipient.recipientUid,
          notificationType: 'version_delisted',
          packageId: input.packageId,
          version: input.version,
          payload: {
            reasonCode: input.reasonCode,
            ...(input.reasonDetail ? { reasonDetail: input.reasonDetail } : {})
          },
          status: 'unread',
          createdAt: input.occurredAt
        }).onConflictDoNothing().returning();
        if (inserted[0]) notificationRows.push(inserted[0]);
      }
      const version = mapVersion(updatedRows[0]);
      await appendObservability(transaction, {
        eventType: 'version.delisted',
        outboxEventType: 'version.delisted',
        actorUid: input.actorUid,
        version,
        details: {
          delistingId: delistingRows[0]!.id,
          notificationCount: notificationRows.length
        }
      }, input.occurredAt);
      return {
        version,
        delisting: mapDelisting(delistingRows[0]!),
        notifications: notificationRows.map(mapNotification)
      };
    });
  }

  async emergencyDisableVersion(
    input: EmergencyDisableVersionInput
  ): Promise<DelistVersionResult> {
    return this.database.transaction(async (transaction) => {
      const currentRows = await transaction.select().from(schema.packageVersions)
        .where(and(
          eq(schema.packageVersions.packageId, input.packageId),
          eq(schema.packageVersions.version, input.version)
        )).limit(1).for('update');
      const current = currentRows[0];
      if (!current) {
        throw new AppError({ statusCode: 404, code: 'PACKAGE_VERSION_NOT_FOUND', message: '找不到套件版本' });
      }
      const nextLifecycle = transitionVersion(current.lifecycle, 'EMERGENCY_DISABLE');
      const updatedRows = await transaction.update(schema.packageVersions).set({
        lifecycle: nextLifecycle, updatedAt: input.occurredAt
      }).where(and(
        eq(schema.packageVersions.packageId, input.packageId),
        eq(schema.packageVersions.version, input.version),
        eq(schema.packageVersions.lifecycle, current.lifecycle)
      )).returning();
      if (!updatedRows[0]) throw conflict('版本狀態已被其他程序更新');
      const delistingRows = await transaction.insert(schema.versionDelistings).values({
        id: randomUUID(), packageId: input.packageId, version: input.version,
        reasonCode: input.reasonCode, reasonDetail: input.reasonDetail ?? null,
        effectiveAt: input.occurredAt, actorUid: input.actorUid,
        createdAt: input.occurredAt
      }).returning();
      const recipientRows = await transaction.selectDistinct({
        recipientUid: schema.installations.userRef
      }).from(schema.installations).where(and(
        eq(schema.installations.packageId, input.packageId),
        eq(schema.installations.version, input.version),
        eq(schema.installations.userRefType, 'uid'),
        inArray(schema.installations.status, ['downloaded', 'succeeded'])
      ));
      const notificationRows: Array<typeof schema.userNotifications.$inferSelect> = [];
      for (const recipient of recipientRows) {
        const inserted = await transaction.insert(schema.userNotifications).values({
          id: randomUUID(), recipientUid: recipient.recipientUid,
          notificationType: 'version_emergency_disabled',
          packageId: input.packageId, version: input.version,
          payload: {
            priority: 'high', reasonCode: input.reasonCode,
            ...(input.reasonDetail ? { reasonDetail: input.reasonDetail } : {})
          },
          status: 'unread', createdAt: input.occurredAt
        }).onConflictDoNothing().returning();
        if (inserted[0]) notificationRows.push(inserted[0]);
      }
      const version = mapVersion(updatedRows[0]);
      await appendObservability(transaction, {
        eventType: 'version.emergency_disabled',
        outboxEventType: 'version.emergency_disabled', actorUid: input.actorUid,
        version,
        details: {
          delistingId: delistingRows[0]!.id,
          notificationCount: notificationRows.length,
          priority: 'high'
        }
      }, input.occurredAt);
      return {
        version, delisting: mapDelisting(delistingRows[0]!),
        notifications: notificationRows.map(mapNotification)
      };
    });
  }

  async listReviews(filters: ReviewListFilters): Promise<PublicationReview[]> {
    const conditions = [
      ...(filters.status ? [eq(schema.publicationReviews.status, filters.status)] : []),
      ...(filters.packageId ? [eq(schema.publicationReviews.packageId, filters.packageId)] : [])
    ];
    const rows = await this.database.select().from(schema.publicationReviews)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(schema.publicationReviews.createdAt);
    return rows.map(mapReview);
  }

  async findReview(reviewId: string): Promise<PublicationReview | undefined> {
    const rows = await this.database.select().from(schema.publicationReviews)
      .where(eq(schema.publicationReviews.id, reviewId)).limit(1);
    return rows[0] ? mapReview(rows[0]) : undefined;
  }

  async listNotifications(filters: NotificationListFilters): Promise<UserNotification[]> {
    const conditions = [
      ...(filters.recipientUid
        ? [eq(schema.userNotifications.recipientUid, filters.recipientUid)]
        : []),
      ...(filters.status ? [eq(schema.userNotifications.status, filters.status)] : [])
    ];
    const rows = await this.database.select().from(schema.userNotifications)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(schema.userNotifications.createdAt);
    return rows.map(mapNotification);
  }

  async markNotificationRead(
    notificationId: string,
    recipientUid: string,
    occurredAt: Date
  ): Promise<UserNotification | undefined> {
    return this.database.transaction(async (transaction) => {
      const updatedRows = await transaction.update(schema.userNotifications).set({
        status: 'read',
        readAt: occurredAt
      }).where(and(
        eq(schema.userNotifications.id, notificationId),
        eq(schema.userNotifications.recipientUid, recipientUid),
        eq(schema.userNotifications.status, 'unread')
      )).returning();
      if (updatedRows[0]) {
        await transaction.insert(schema.auditLogs).values({
          eventType: 'notification.read',
          actorUid: recipientUid,
          targetType: 'user',
          targetId: recipientUid,
          action: 'read_notification',
          details: { notificationId },
          occurredAt
        });
        await transaction.insert(schema.domainEvents).values({
          aggregateType: 'user_notification',
          aggregateId: notificationId,
          eventType: 'notification.read',
          payload: { recipientUid },
          occurredAt
        });
        return mapNotification(updatedRows[0]);
      }
      const rows = await transaction.select().from(schema.userNotifications)
        .where(and(
          eq(schema.userNotifications.id, notificationId),
          eq(schema.userNotifications.recipientUid, recipientUid)
        )).limit(1);
      return rows[0] ? mapNotification(rows[0]) : undefined;
    });
  }

  private async throwVersionMutationFailure(
    transaction: GovernanceTransaction,
    packageId: string,
    version: string,
    conflictMessage: string
  ): Promise<never> {
    const rows = await transaction.select({ id: schema.packageVersions.id })
      .from(schema.packageVersions)
      .where(and(
        eq(schema.packageVersions.packageId, packageId),
        eq(schema.packageVersions.version, version)
      )).limit(1);
    if (!rows[0]) {
      throw new AppError({
        statusCode: 404,
        code: 'PACKAGE_VERSION_NOT_FOUND',
        message: '找不到套件版本'
      });
    }
    throw conflict(conflictMessage);
  }
}
