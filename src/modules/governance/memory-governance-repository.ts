// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { randomUUID } from 'node:crypto';

import { AppError } from '../../shared/errors/app-error.js';
import { compareSemanticVersions } from '../../shared/version/semantic-version.js';
import {
  MemoryPlatformStore,
  memoryVersionKey
} from '../catalog/memory-platform-store.js';
import type { CatalogAggregate, PackageRecord, PackageVersionRecord } from '../catalog/types.js';
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
  GovernanceAuditLog,
  GovernanceDomainEvent,
  GovernanceRepository,
  InstallationSnapshot,
  NotificationListFilters,
  PublicationReview,
  ReviewListFilters,
  UserNotification,
  ValidationRun,
  VersionDelisting,
  ReviseVersionInput,
  UpdateVersionContentInput
} from './repository.js';
import { VALIDATION_RETRY_CLAIM_TTL_MS } from './repository.js';
import { transitionVersion } from './version-state-machine.js';
import {
  normalizeClientName,
  normalizeOsName,
  type ValidationMatrixResult,
  type ValidationMatrixTarget
} from './validation-runner.js';
import {
  SCRIPT_TARGET_CONTRACT_VERSION,
  requireCompleteTargetSnapshots,
  scriptManifestDigest,
  type ValidationTargetSnapshot
} from './script-target-governance.js';

export interface MemoryGovernanceRepositorySeed {
  aggregates?: CatalogAggregate[];
  installations?: InstallationSnapshot[];
  store?: MemoryPlatformStore;
}

function versionKey(packageId: string, version: string): string {
  return memoryVersionKey(packageId, version);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function conflict(message: string): AppError {
  return new AppError({ statusCode: 409, code: 'INVALID_VERSION_TRANSITION', message });
}

function matrixKey(target: ValidationMatrixTarget): string {
  return JSON.stringify([normalizeOsName(target.os), normalizeClientName(target.client)]);
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
  manifestDigest: string
): boolean {
  if (expected.length === 0 || actual.length !== expected.length || !manifestDigest.trim()) return false;
  const expectedKeys = new Set(expected.map(matrixKey));
  const actualKeys = new Set<string>();
  for (const result of actual) {
    const key = matrixKey(result);
    if (actualKeys.has(key) || !expectedKeys.has(key)) return false;
    actualKeys.add(key);
    if (
      result.status !== 'passed' ||
      (targetHasContract(expected.find((target) => matrixKey(target) === key)!) && (
        result.targetId !== expected.find((target) => matrixKey(target) === key)!.targetId ||
        result.scriptVersion !== expected.find((target) => matrixKey(target) === key)!.scriptVersion ||
        result.contentDigest !== expected.find((target) => matrixKey(target) === key)!.contentDigest ||
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

function targetHasContract(target: ValidationMatrixTarget): boolean {
  return Boolean(target.targetId && target.scriptVersion && target.contentDigest);
}

export class MemoryGovernanceRepository implements GovernanceRepository {
  readonly store: MemoryPlatformStore;

  constructor(seed: MemoryGovernanceRepositorySeed = {}) {
    this.store = seed.store ?? new MemoryPlatformStore();
    const next = this.store.snapshot();
    for (const aggregate of seed.aggregates ?? []) {
      next.packages[aggregate.package.packageId] = clone(aggregate.package);
      next.adoption[aggregate.package.packageId] = {
        installations: aggregate.adoption.installations,
        succeeded: aggregate.adoption.succeeded
      };
      for (const version of aggregate.versions) {
        next.versions[versionKey(version.packageId, version.version)] = clone(version);
      }
    }
    next.installations.push(...clone(seed.installations ?? []));
    this.store.replace(next);
  }

  private get state() {
    return this.store.snapshot();
  }

  private set state(next: ReturnType<MemoryPlatformStore['snapshot']>) {
    this.store.replace(next);
  }

  get validationRuns(): ValidationRun[] {
    return clone(this.state.validationRuns);
  }

  get auditLogs(): GovernanceAuditLog[] {
    return clone(this.state.auditLogs);
  }

  get domainEvents(): GovernanceDomainEvent[] {
    return clone(this.state.domainEvents);
  }

  async findVersion(packageId: string, version: string): Promise<PackageVersionRecord | undefined> {
    const found = this.state.versions[versionKey(packageId, version)];
    return found ? clone(found) : undefined;
  }

  async beginValidation(input: BeginValidationInput): Promise<BeginValidationResult> {
    const next = clone(this.state);
    const key = versionKey(input.version.packageId, input.version.version);
    const current = next.versions[key];
    if (!current) {
      throw new AppError({ statusCode: 404, code: 'PACKAGE_VERSION_NOT_FOUND', message: '找不到套件版本' });
    }
    const lifecycle = transitionVersion(current.lifecycle, 'SUBMIT');
    const targetSnapshots = requireCompleteTargetSnapshots(input.version);
    const manifestDigest = scriptManifestDigest(targetSnapshots);
    const updated: PackageVersionRecord = {
      ...current, lifecycle, updatedAt: input.occurredAt,
      scriptDigest: manifestDigest,
      scriptManifestDigest: manifestDigest
    };
    next.versions[key] = updated;

    const validationRun: ValidationRun = {
      id: randomUUID(),
      packageId: current.packageId,
      version: current.version,
      scriptDigest: manifestDigest,
      contractVersion: SCRIPT_TARGET_CONTRACT_VERSION,
      targetSnapshots,
      manifestDigest,
      status: 'running',
      requestedByUid: input.actorUid,
      expectedMatrix: expectedMatrixFor(targetSnapshots),
      attempts: [{
        attempt: 1,
        kind: 'initial',
        status: 'running',
        requestedByUid: input.actorUid,
        startedAt: input.occurredAt,
        matrixResults: []
      }],
      lastAttemptStartedAt: input.occurredAt,
      runnerVersion: '',
      matrixResults: [],
      startedAt: input.occurredAt
    };
    next.validationRuns.push(validationRun);
    this.appendObservability(next, {
      eventType: 'version.validation_started',
      outboxEventType: 'version.validation_started',
      actorUid: input.actorUid,
      version: updated,
      details: { validationRunId: validationRun.id }
    }, input.occurredAt);
    this.state = next;
    return { version: clone(updated), validationRun: clone(validationRun) };
  }

  async claimValidationRetry(input: ClaimValidationRetryInput): Promise<ClaimValidationRetryResult> {
    const next = clone(this.state);
    const runIndex = next.validationRuns.findIndex((run) => run.id === input.validationRunId);
    const running = next.validationRuns[runIndex];
    if (runIndex < 0 || !running) {
      throw new AppError({ statusCode: 404, code: 'VALIDATION_RUN_NOT_FOUND', message: '找不到驗證執行記錄' });
    }
    if (running.status !== 'running') {
      throw conflict('驗證執行已完成');
    }
    const reclaimingExpiredClaim = Boolean(
      running.retryClaimToken &&
      running.retryClaimedAt &&
      input.occurredAt.getTime() >= running.retryClaimedAt.getTime() + VALIDATION_RETRY_CLAIM_TTL_MS
    );
    if (running.retryClaimToken && !reclaimingExpiredClaim) {
      throw new AppError({
        statusCode: 409,
        code: 'VALIDATION_RETRY_ALREADY_CLAIMED',
        message: '驗證重試已由另一個程序取得'
      });
    }
    const key = versionKey(running.packageId, running.version);
    const current = next.versions[key];
    if (!current || current.lifecycle !== 'validating') {
      throw conflict('版本不在驗證中');
    }
    const previousAttemptIndex = running.attempts.length - 1;
    const previousAttempt = running.attempts[previousAttemptIndex];
    if (previousAttempt?.status === 'running') {
      running.attempts[previousAttemptIndex] = {
        ...previousAttempt,
        status: 'abandoned',
        endedAt: input.occurredAt,
        errorCode: reclaimingExpiredClaim
          ? 'validation_retry_claim_expired'
          : 'validation_attempt_abandoned'
      };
    }
    const retryClaimToken = randomUUID();
    running.retryClaimToken = retryClaimToken;
    running.retryClaimedAt = input.occurredAt;
    running.lastAttemptStartedAt = input.occurredAt;
    running.attempts.push({
      attempt: running.attempts.length + 1,
      kind: 'retry',
      status: 'running',
      requestedByUid: input.actorUid,
      startedAt: input.occurredAt,
      matrixResults: []
    });
    next.validationRuns[runIndex] = running;
    this.appendObservability(next, {
      eventType: 'version.validation_retry_started',
      outboxEventType: 'version.validation_retry_started',
      actorUid: input.actorUid,
      version: current,
      details: {
        validationRunId: running.id,
        attempt: running.attempts.length,
        reclaimedExpiredClaim: reclaimingExpiredClaim
      }
    }, input.occurredAt);
    this.state = next;
    return {
      version: clone(current),
      validationRun: clone(running),
      retryClaimToken
    };
  }

  async completeValidation(input: CompleteValidationInput): Promise<CompleteValidationResult> {
    const next = clone(this.state);
    const runIndex = next.validationRuns.findIndex((run) => run.id === input.validationRunId);
    const running = next.validationRuns[runIndex];
    if (runIndex < 0 || !running) {
      throw new AppError({ statusCode: 404, code: 'VALIDATION_RUN_NOT_FOUND', message: '找不到驗證執行記錄' });
    }
    if (running.status !== 'running') {
      throw conflict('驗證執行已完成');
    }
    if (
      (running.retryClaimToken && input.retryClaimToken !== running.retryClaimToken) ||
      (!running.retryClaimToken && input.retryClaimToken)
    ) {
      throw new AppError({
        statusCode: 409,
        code: 'VALIDATION_RETRY_CLAIM_CONFLICT',
        message: '驗證重試 claim 已失效'
      });
    }
    if (
      running.retryClaimToken &&
      (!running.retryClaimedAt ||
        input.occurredAt.getTime() >=
          running.retryClaimedAt.getTime() + VALIDATION_RETRY_CLAIM_TTL_MS)
    ) {
      throw new AppError({
        statusCode: 409,
        code: 'VALIDATION_RETRY_CLAIM_EXPIRED',
        message: '驗證重試 claim 已過期'
      });
    }
    const key = versionKey(running.packageId, running.version);
    const current = next.versions[key];
    if (!current || current.lifecycle !== 'validating') {
      throw conflict('版本不在驗證中');
    }

    const passed = input.result.status === 'passed' &&
      Boolean(input.result.runnerVersion.trim()) &&
      hasExactPassedMatrix(
      running.expectedMatrix,
      input.result.matrixResults,
      running.scriptDigest
    );
    const event = passed ? 'VALIDATION_PASSED' : 'VALIDATION_FAILED';
    const updated: PackageVersionRecord = {
      ...current,
      lifecycle: transitionVersion(current.lifecycle, event),
      updatedAt: input.occurredAt
    };
    next.versions[key] = updated;
    const completedRun: ValidationRun = {
      ...running,
      status: passed ? 'passed' : 'failed',
      runnerVersion: input.result.runnerVersion,
      matrixResults: clone(input.result.matrixResults),
      endedAt: input.occurredAt,
      ...(!passed ? {
        errorCode: input.result.status === 'passed'
          ? 'validation_matrix_mismatch'
          : input.result.errorCode ?? 'validation_failed'
      } : {})
    };
    const attemptIndex = completedRun.attempts.length - 1;
    const currentAttempt = completedRun.attempts[attemptIndex];
    if (!currentAttempt || currentAttempt.status !== 'running') {
      throw conflict('驗證嘗試不在執行中');
    }
    completedRun.attempts[attemptIndex] = {
      ...currentAttempt,
      status: passed ? 'passed' : 'failed',
      endedAt: input.occurredAt,
      runnerVersion: input.result.runnerVersion,
      matrixResults: clone(input.result.matrixResults),
      ...(!passed ? { errorCode: completedRun.errorCode } : {})
    };
    delete completedRun.retryClaimToken;
    delete completedRun.retryClaimedAt;
    next.validationRuns[runIndex] = completedRun;

    let review: PublicationReview | undefined;
    if (passed) {
      const packageSnapshot = next.packages[running.packageId];
      if (!packageSnapshot) {
        throw new AppError({ statusCode: 404, code: 'PACKAGE_NOT_FOUND', message: '找不到套件快照' });
      }
      if (next.reviews.some((candidate) =>
        candidate.packageId === running.packageId &&
        candidate.version === running.version &&
        candidate.status === 'pending'
      )) {
        throw conflict('版本已有待審記錄');
      }
      review = {
        id: randomUUID(),
        packageId: running.packageId,
        version: running.version,
        packageType: packageSnapshot.type,
        category: packageSnapshot.category,
        ownerTeam: packageSnapshot.ownerTeam,
        authorUid: current.authorUid,
        packageSnapshot: clone(packageSnapshot),
        versionSnapshot: clone(updated),
        validationRunId: running.id,
        status: 'pending',
        createdAt: input.occurredAt
      };
      next.reviews.push(review);
    }

    this.appendObservability(next, {
      eventType: passed ? 'version.validation_passed' : 'version.validation_failed',
      outboxEventType: passed ? 'version.review_requested' : 'version.validation_failed',
      actorUid: running.requestedByUid,
      version: updated,
      details: {
        validationRunId: running.id,
        ...(review ? { reviewId: review.id } : {}),
        ...(!passed ? { errorCode: completedRun.errorCode } : {})
      }
    }, input.occurredAt);
    this.state = next;
    return {
      version: clone(updated),
      validationRun: clone(completedRun),
      ...(review ? { review: clone(review) } : {})
    };
  }

  async findValidationRun(validationRunId: string): Promise<ValidationRun | undefined> {
    const run = this.state.validationRuns.find((candidate) => candidate.id === validationRunId);
    return run ? clone(run) : undefined;
  }

  async findRunningValidationRun(
    packageId: string,
    version: string
  ): Promise<ValidationRun | undefined> {
    const run = this.state.validationRuns.find(
      (candidate) =>
        candidate.packageId === packageId &&
        candidate.version === version &&
        candidate.status === 'running'
    );
    return run ? clone(run) : undefined;
  }

  async decideReview(input: DecideReviewInput): Promise<DecideReviewResult> {
    const next = clone(this.state);
    const reviewIndex = next.reviews.findIndex((review) => review.id === input.reviewId);
    const currentReview = next.reviews[reviewIndex];
    if (reviewIndex < 0 || !currentReview) {
      throw new AppError({ statusCode: 404, code: 'REVIEW_NOT_FOUND', message: '找不到審核記錄' });
    }
    if (currentReview.status !== 'pending') {
      throw new AppError({ statusCode: 409, code: 'REVIEW_ALREADY_DECIDED', message: '審核已完成決議' });
    }
    const key = versionKey(currentReview.packageId, currentReview.version);
    const currentVersion = next.versions[key];
    if (!currentVersion) {
      throw new AppError({ statusCode: 404, code: 'PACKAGE_VERSION_NOT_FOUND', message: '找不到套件版本' });
    }
    const approved = input.decision === 'approve';
    const updatedVersion: PackageVersionRecord = {
      ...currentVersion,
      lifecycle: transitionVersion(currentVersion.lifecycle, approved ? 'APPROVE' : 'REJECT'),
      ...(approved ? {
        publishedAt: input.occurredAt,
        scriptDigest: currentReview.versionSnapshot.scriptManifestDigest ??
          currentReview.versionSnapshot.scriptDigest,
        scriptManifestDigest: currentReview.versionSnapshot.scriptManifestDigest ??
          currentReview.versionSnapshot.scriptDigest
      } : {}),
      updatedAt: input.occurredAt
    };
    const decidedReview: PublicationReview = {
      ...currentReview,
      reviewerUid: input.actorUid,
      status: approved ? 'approved' : 'rejected',
      decisionReason: input.reason,
      decidedAt: input.occurredAt
    };
    next.versions[key] = updatedVersion;
    next.reviews[reviewIndex] = decidedReview;

    // 收件人為裝了同套件其他版本的 UID；作者與匿名 UUID 不通知。
    const createdNotifications: UserNotification[] = [];
    if (approved) {
      // 帶上收件人目前安裝的版本，讓通知能直接連到真實的差異比較。
      // 同一人可能裝過多個舊版，取最高者作為差異來源。
      const installedByUid = new Map<string, string>();
      for (const installation of next.installations) {
        if (
          installation.packageId !== currentReview.packageId ||
          installation.version === currentReview.version ||
          installation.userRefType !== 'uid' ||
          installation.userRef === currentReview.authorUid ||
          (installation.status !== 'downloaded' && installation.status !== 'succeeded')
        ) continue;
        const current = installedByUid.get(installation.userRef);
        if (!current || compareSemanticVersions(current, installation.version) < 0) {
          installedByUid.set(installation.userRef, installation.version);
        }
      }
      for (const [recipientUid, installedVersion] of installedByUid) {
        const duplicate = next.notifications.some((notification) =>
          notification.recipientUid === recipientUid &&
          notification.notificationType === 'version_published' &&
          notification.packageId === currentReview.packageId &&
          notification.version === currentReview.version);
        if (duplicate) continue;
        const notification: UserNotification = {
          id: randomUUID(),
          recipientUid,
          notificationType: 'version_published',
          packageId: currentReview.packageId,
          version: currentReview.version,
          payload: {
            installedVersion,
            ...(updatedVersion.releaseNotes
              ? { releaseNotes: updatedVersion.releaseNotes } : {})
          },
          status: 'unread',
          createdAt: input.occurredAt
        };
        next.notifications.push(notification);
        createdNotifications.push(notification);
      }
    }

    const eventType = approved ? 'version.published' : 'version.review_rejected';
    this.appendObservability(next, {
      eventType,
      outboxEventType: eventType,
      actorUid: input.actorUid,
      version: updatedVersion,
      details: {
        reviewId: input.reviewId,
        reason: input.reason,
        ...(approved ? { notificationCount: createdNotifications.length } : {})
      }
    }, input.occurredAt);
    this.state = next;
    return {
      version: clone(updatedVersion),
      review: clone(decidedReview),
      notifications: clone(createdNotifications)
    };
  }

  async reviseVersion(input: ReviseVersionInput): Promise<PackageVersionRecord> {
    return this.updateVersionContent({ ...input, patch: {} });
  }

  async updateVersionContent(
    input: UpdateVersionContentInput
  ): Promise<PackageVersionRecord> {
    const next = clone(this.state);
    const key = versionKey(input.packageId, input.version);
    const current = next.versions[key];
    if (!current) {
      throw new AppError({ statusCode: 404, code: 'PACKAGE_VERSION_NOT_FOUND', message: '找不到套件版本' });
    }
    const lifecycle = current.lifecycle === 'draft'
      ? 'draft'
      : transitionVersion(current.lifecycle, 'REVISE');
    const updated: PackageVersionRecord = {
      ...current,
      ...clone(input.patch),
      lifecycle,
      updatedAt: input.occurredAt
    };
    next.versions[key] = updated;
    for (let index = 0; index < next.reviews.length; index += 1) {
      const review = next.reviews[index];
      if (review && review.packageId === input.packageId && review.version === input.version && review.status === 'pending') {
        next.reviews[index] = { ...review, status: 'superseded', decidedAt: input.occurredAt };
      }
    }
    this.appendObservability(next, {
      eventType: lifecycle === current.lifecycle ? 'version.updated' : 'version.revised',
      outboxEventType: lifecycle === current.lifecycle ? 'version.updated' : 'version.revised',
      actorUid: input.actorUid,
      version: updated,
      details: { changedFields: Object.keys(input.patch) }
    }, input.occurredAt);
    this.state = next;
    return clone(updated);
  }

  async deprecateVersion(input: DeprecateVersionInput): Promise<PackageVersionRecord> {
    const next = clone(this.state);
    const key = versionKey(input.packageId, input.version);
    const current = next.versions[key];
    if (!current) {
      throw new AppError({ statusCode: 404, code: 'PACKAGE_VERSION_NOT_FOUND', message: '找不到套件版本' });
    }
    const updated: PackageVersionRecord = {
      ...current,
      lifecycle: transitionVersion(current.lifecycle, 'DEPRECATE'),
      updatedAt: input.occurredAt
    };
    next.versions[key] = updated;
    this.appendObservability(next, {
      eventType: 'version.deprecated', outboxEventType: 'version.deprecated',
      actorUid: input.actorUid, version: updated,
      details: { ...(input.reason ? { reason: input.reason } : {}) }
    }, input.occurredAt);
    this.state = next;
    return clone(updated);
  }

  async delistVersion(input: DelistVersionInput): Promise<DelistVersionResult> {
    const next = clone(this.state);
    const key = versionKey(input.packageId, input.version);
    const current = next.versions[key];
    if (!current) {
      throw new AppError({ statusCode: 404, code: 'PACKAGE_VERSION_NOT_FOUND', message: '找不到套件版本' });
    }
    const updated: PackageVersionRecord = {
      ...current,
      lifecycle: transitionVersion(current.lifecycle, 'DELIST'),
      updatedAt: input.occurredAt
    };
    next.versions[key] = updated;
    const delisting: VersionDelisting = {
      id: randomUUID(), packageId: input.packageId, version: input.version,
      reasonCode: input.reasonCode,
      ...(input.reasonDetail ? { reasonDetail: input.reasonDetail } : {}),
      effectiveAt: input.effectiveAt, actorUid: input.actorUid, createdAt: input.occurredAt
    };
    next.delistings.push(delisting);

    const recipientUids = new Set(next.installations
      .filter((installation) =>
        installation.packageId === input.packageId &&
        installation.version === input.version &&
        installation.userRefType === 'uid' &&
        (installation.status === 'downloaded' || installation.status === 'succeeded'))
      .map((installation) => installation.userRef));
    const createdNotifications: UserNotification[] = [];
    for (const recipientUid of recipientUids) {
      const duplicate = next.notifications.some((notification) =>
        notification.recipientUid === recipientUid &&
        notification.notificationType === 'version_delisted' &&
        notification.packageId === input.packageId &&
        notification.version === input.version);
      if (duplicate) continue;
      const notification: UserNotification = {
        id: randomUUID(), recipientUid, notificationType: 'version_delisted',
        packageId: input.packageId, version: input.version,
        payload: { reasonCode: input.reasonCode, ...(input.reasonDetail ? { reasonDetail: input.reasonDetail } : {}) },
        status: 'unread', createdAt: input.occurredAt
      };
      next.notifications.push(notification);
      createdNotifications.push(notification);
    }
    this.appendObservability(next, {
      eventType: 'version.delisted', outboxEventType: 'version.delisted', actorUid: input.actorUid,
      version: updated, details: { delistingId: delisting.id, notificationCount: createdNotifications.length }
    }, input.occurredAt);
    this.state = next;
    return { version: clone(updated), delisting: clone(delisting), notifications: clone(createdNotifications) };
  }

  async emergencyDisableVersion(
    input: EmergencyDisableVersionInput
  ): Promise<DelistVersionResult> {
    const next = clone(this.state);
    const key = versionKey(input.packageId, input.version);
    const current = next.versions[key];
    if (!current) {
      throw new AppError({ statusCode: 404, code: 'PACKAGE_VERSION_NOT_FOUND', message: '找不到套件版本' });
    }
    const updated: PackageVersionRecord = {
      ...current,
      lifecycle: transitionVersion(current.lifecycle, 'EMERGENCY_DISABLE'),
      updatedAt: input.occurredAt
    };
    next.versions[key] = updated;
    const delisting: VersionDelisting = {
      id: randomUUID(), packageId: input.packageId, version: input.version,
      reasonCode: input.reasonCode,
      ...(input.reasonDetail ? { reasonDetail: input.reasonDetail } : {}),
      effectiveAt: input.occurredAt, actorUid: input.actorUid,
      createdAt: input.occurredAt
    };
    next.delistings.push(delisting);
    const recipients = new Set(next.installations
      .filter((installation) =>
        installation.packageId === input.packageId &&
        installation.version === input.version &&
        installation.userRefType === 'uid' &&
        (installation.status === 'downloaded' || installation.status === 'succeeded'))
      .map((installation) => installation.userRef));
    const notifications: UserNotification[] = [];
    for (const recipientUid of recipients) {
      if (next.notifications.some((notification) =>
        notification.recipientUid === recipientUid &&
        notification.notificationType === 'version_emergency_disabled' &&
        notification.packageId === input.packageId &&
        notification.version === input.version)) continue;
      const notification: UserNotification = {
        id: randomUUID(), recipientUid,
        notificationType: 'version_emergency_disabled',
        packageId: input.packageId, version: input.version,
        payload: {
          priority: 'high', reasonCode: input.reasonCode,
          ...(input.reasonDetail ? { reasonDetail: input.reasonDetail } : {})
        },
        status: 'unread', createdAt: input.occurredAt
      };
      next.notifications.push(notification);
      notifications.push(notification);
    }
    this.appendObservability(next, {
      eventType: 'version.emergency_disabled',
      outboxEventType: 'version.emergency_disabled', actorUid: input.actorUid,
      version: updated,
      details: { delistingId: delisting.id, notificationCount: notifications.length, priority: 'high' }
    }, input.occurredAt);
    this.state = next;
    return {
      version: clone(updated), delisting: clone(delisting),
      notifications: clone(notifications)
    };
  }

  async listReviews(filters: ReviewListFilters): Promise<PublicationReview[]> {
    return clone(this.state.reviews.filter((review) =>
      (!filters.status || review.status === filters.status) &&
      (!filters.packageId || review.packageId === filters.packageId)));
  }

  async findReview(reviewId: string): Promise<PublicationReview | undefined> {
    const review = this.state.reviews.find((candidate) => candidate.id === reviewId);
    return review ? clone(review) : undefined;
  }

  async listNotifications(filters: NotificationListFilters): Promise<UserNotification[]> {
    return clone(this.state.notifications.filter((notification) =>
      (!filters.recipientUid || notification.recipientUid === filters.recipientUid) &&
      (!filters.status || notification.status === filters.status)));
  }

  async markNotificationRead(notificationId: string, recipientUid: string, occurredAt: Date): Promise<UserNotification | undefined> {
    const next = clone(this.state);
    const index = next.notifications.findIndex((notification) =>
      notification.id === notificationId && notification.recipientUid === recipientUid);
    const current = next.notifications[index];
    if (index < 0 || !current) return undefined;
    if (current.status === 'read') return clone(current);
    const updated: UserNotification = { ...current, status: 'read', readAt: occurredAt };
    next.notifications[index] = updated;
    next.auditLogs.push({
      id: randomUUID(), eventType: 'notification.read',
      actorUid: recipientUid, packageId: current.packageId,
      version: current.version, details: { notificationId }, occurredAt
    });
    next.domainEvents.push({
      id: randomUUID(), aggregateType: 'user_notification',
      aggregateId: notificationId, eventType: 'notification.read',
      payload: { recipientUid }, occurredAt
    });
    this.state = next;
    return clone(updated);
  }

  private appendObservability(
    state: ReturnType<MemoryPlatformStore['snapshot']>,
    input: {
      eventType: string;
      outboxEventType: string;
      actorUid: string;
      version: PackageVersionRecord;
      details: Record<string, unknown>;
    },
    occurredAt: Date
  ): void {
    state.auditLogs.push({
      id: randomUUID(), eventType: input.eventType, actorUid: input.actorUid,
      packageId: input.version.packageId, version: input.version.version,
      details: clone(input.details), occurredAt
    });
    state.domainEvents.push({
      id: randomUUID(), aggregateType: 'package_version',
      aggregateId: versionKey(input.version.packageId, input.version.version),
      eventType: input.outboxEventType,
      payload: { actorUid: input.actorUid, lifecycle: input.version.lifecycle, ...clone(input.details) },
      occurredAt
    });
  }
}
