// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { AppError } from '../../shared/errors/app-error.js';
import type {
  CatalogAggregate,
  PackageRecord,
  PackageVersionRecord
} from '../catalog/types.js';
import type { CatalogRepository } from '../catalog/repository.js';
import type { AuthorizationService } from '../identity/authorization-service.js';
import type { ResolvedIdentity } from '../identity/types.js';
import type {
  CompleteValidationResult,
  DecideReviewResult,
  DelistVersionResult,
  GovernanceRepository,
  NotificationListFilters,
  PublicationReview,
  ReviewListFilters,
  UserNotification
} from './repository.js';
import type { ValidationRun } from './repository.js';
import type { ValidationRunner, ValidationRunResult } from './validation-runner.js';
import { requireCompleteTargetSnapshots } from './script-target-governance.js';

export interface DelistVersionCommand {
  reasonCode: string;
  reasonDetail?: string;
  effectiveAt: Date;
}

export interface ReviewWorkbench {
  review: PublicationReview;
  package: PackageRecord;
  version: PackageVersionRecord;
  validation: {
    id: string;
    status: ValidationRun['status'];
    runnerVersion: string;
    scriptDigest: string;
    expectedMatrix: ValidationRun['expectedMatrix'];
    matrixResults: ValidationRun['matrixResults'];
    attempts: ValidationRun['attempts'];
    startedAt: Date;
    endedAt?: Date;
    errorCode?: string;
  };
}

export class GovernanceService {
  constructor(
    private readonly repository: GovernanceRepository,
    private readonly catalogRepository: CatalogRepository,
    private readonly authorization: AuthorizationService,
    private readonly validationRunner: ValidationRunner,
    private readonly clock: () => Date = () => new Date()
  ) {}

  async submitReview(
    packageId: string,
    version: string,
    identity: ResolvedIdentity
  ): Promise<CompleteValidationResult> {
    const aggregate = await this.requireAggregate(packageId);
    const actorUid = await this.requireMaintainer(identity, aggregate.package.ownerTeam);
    const versionSnapshot = aggregate.versions.find((candidate) => candidate.version === version);
    if (!versionSnapshot) throw this.versionNotFound();
    requireCompleteTargetSnapshots(versionSnapshot);

    const begun = await this.repository.beginValidation({
      aggregate,
      version: versionSnapshot,
      actorUid,
      occurredAt: this.clock()
    });

    let result: ValidationRunResult;
    try {
      result = await this.validationRunner.run({
        validationRunId: begun.validationRun.id,
        package: aggregate.package,
        version: begun.version,
        requestedByUid: actorUid,
        expectedMatrix: begun.validationRun.expectedMatrix,
        targetSnapshots: begun.validationRun.targetSnapshots
      });
    } catch {
      result = {
        status: 'failed',
        runnerVersion: 'unavailable',
        matrixResults: [],
        errorCode: 'runner_error'
      };
    }

    return this.repository.completeValidation({
      validationRunId: begun.validationRun.id,
      result,
      occurredAt: this.clock()
    });
  }

  async retryValidation(
    validationRunId: string,
    identity: ResolvedIdentity
  ): Promise<CompleteValidationResult> {
    const actorUid = this.requireAuthenticated(identity);
    const existingRun = await this.repository.findValidationRun(validationRunId);
    if (!existingRun) {
      throw new AppError({ statusCode: 404, code: 'VALIDATION_RUN_NOT_FOUND', message: '找不到驗證執行記錄' });
    }
    const aggregate = await this.requireAggregate(existingRun.packageId);
    const isAdmin = await this.authorization.hasRole(actorUid, 'platform_admin', { type: 'global' });
    if (actorUid === existingRun.requestedByUid) {
      if (!isAdmin) {
        await this.requireMaintainer(identity, aggregate.package.ownerTeam);
      }
    } else if (!isAdmin) {
      throw new AppError({ statusCode: 403, code: 'FORBIDDEN', message: '只有原請求維護者或平台管理員可重試驗證' });
    }

    const claimed = await this.repository.claimValidationRetry({
      validationRunId,
      actorUid,
      occurredAt: this.clock()
    });
    let result: ValidationRunResult;
    try {
      result = await this.validationRunner.run({
        validationRunId,
        package: aggregate.package,
        version: claimed.version,
        requestedByUid: actorUid,
        expectedMatrix: claimed.validationRun.expectedMatrix,
        targetSnapshots: claimed.validationRun.targetSnapshots
      });
    } catch {
      result = {
        status: 'failed',
        runnerVersion: 'unavailable',
        matrixResults: [],
        errorCode: 'runner_error'
      };
    }
    return this.repository.completeValidation({
      validationRunId,
      retryClaimToken: claimed.retryClaimToken,
      result,
      occurredAt: this.clock()
    });
  }

  async retryValidationForVersion(
    packageId: string,
    version: string,
    validationRunId: string | undefined,
    identity: ResolvedIdentity
  ): Promise<CompleteValidationResult> {
    const run = validationRunId
      ? await this.repository.findValidationRun(validationRunId)
      : await this.repository.findRunningValidationRun(packageId, version);
    if (
      !run ||
      run.packageId !== packageId ||
      run.version !== version ||
      run.status !== 'running'
    ) {
      throw new AppError({
        statusCode: 404,
        code: 'VALIDATION_RUN_NOT_FOUND',
        message: '找不到此版本可重試的驗證執行記錄'
      });
    }
    return this.retryValidation(run.id, identity);
  }

  async approveReview(
    reviewId: string,
    reason: string,
    identity: ResolvedIdentity
  ): Promise<DecideReviewResult> {
    return this.decideReview(reviewId, 'approve', reason, identity);
  }

  async rejectReview(
    reviewId: string,
    reason: string,
    identity: ResolvedIdentity
  ): Promise<DecideReviewResult> {
    if (!reason.trim()) {
      throw new AppError({ statusCode: 400, code: 'REVIEW_REASON_REQUIRED', message: '拒絕審核必須填寫理由' });
    }
    return this.decideReview(reviewId, 'reject', reason, identity);
  }

  async reviseVersion(
    packageId: string,
    version: string,
    identity: ResolvedIdentity
  ) {
    const aggregate = await this.requireAggregate(packageId);
    const actorUid = await this.requireMaintainer(identity, aggregate.package.ownerTeam);
    return this.repository.reviseVersion({ packageId, version, actorUid, occurredAt: this.clock() });
  }

  async delistVersion(
    packageId: string,
    version: string,
    command: DelistVersionCommand,
    identity: ResolvedIdentity
  ): Promise<DelistVersionResult> {
    const occurredAt = this.clock();
    if (!command.reasonCode.trim()) {
      throw new AppError({ statusCode: 400, code: 'DELIST_REASON_REQUIRED', message: '撤下必須填寫原因' });
    }
    if (command.effectiveAt.getTime() > occurredAt.getTime()) {
      throw new AppError({
        statusCode: 400,
        code: 'FUTURE_DELIST_NOT_SUPPORTED',
        message: '第一期只支援立即生效的撤下'
      });
    }
    const aggregate = await this.requireAggregate(packageId);
    const actorUid = await this.requireMaintainer(identity, aggregate.package.ownerTeam);
    return this.repository.delistVersion({
      packageId,
      version,
      actorUid,
      occurredAt,
      reasonCode: command.reasonCode,
      ...(command.reasonDetail ? { reasonDetail: command.reasonDetail } : {}),
      effectiveAt: command.effectiveAt
    });
  }

  async deprecateVersion(
    packageId: string,
    version: string,
    reason: string | undefined,
    identity: ResolvedIdentity
  ): Promise<PackageVersionRecord> {
    const aggregate = await this.requireAggregate(packageId);
    const actorUid = await this.requireMaintainer(
      identity,
      aggregate.package.ownerTeam
    );
    return this.repository.deprecateVersion({
      packageId, version, actorUid, occurredAt: this.clock(),
      ...(reason?.trim() ? { reason: reason.trim() } : {})
    });
  }

  async emergencyDisableVersion(
    packageId: string,
    version: string,
    reasonCode: string,
    reasonDetail: string | undefined,
    identity: ResolvedIdentity
  ): Promise<DelistVersionResult> {
    if (!reasonCode.trim()) {
      throw new AppError({ statusCode: 400, code: 'EMERGENCY_REASON_REQUIRED', message: '緊急停用必須填寫原因' });
    }
    const actorUid = this.requireAuthenticated(identity);
    if (!(await this.authorization.hasRole(actorUid, 'platform_admin', { type: 'global' }))) {
      throw new AppError({ statusCode: 403, code: 'FORBIDDEN', message: '只有平台管理員可緊急停用版本' });
    }
    await this.requireAggregate(packageId);
    return this.repository.emergencyDisableVersion({
      packageId, version, actorUid, occurredAt: this.clock(),
      reasonCode: reasonCode.trim(),
      ...(reasonDetail?.trim() ? { reasonDetail: reasonDetail.trim() } : {})
    });
  }

  async listReviews(filters: ReviewListFilters, identity: ResolvedIdentity): Promise<PublicationReview[]> {
    const uid = this.requireAuthenticated(identity);
    const reviews = await this.repository.listReviews(filters);
    const visible: PublicationReview[] = [];
    for (const review of reviews) {
      if (
        review.authorUid !== uid &&
        await this.authorization.canReviewPackageSnapshot(uid, {
          packageId: review.packageId,
          ownerTeam: review.ownerTeam,
          packageType: review.packageType,
          category: review.category
        })
      ) {
        visible.push(review);
      }
    }
    return visible;
  }

  async findReview(reviewId: string, identity: ResolvedIdentity): Promise<PublicationReview> {
    const uid = this.requireAuthenticated(identity);
    const review = await this.repository.findReview(reviewId);
    if (
      !review ||
      review.authorUid === uid ||
      !(await this.authorization.canReviewPackageSnapshot(uid, {
        packageId: review.packageId,
        ownerTeam: review.ownerTeam,
        packageType: review.packageType,
        category: review.category
      }))
    ) {
      throw new AppError({ statusCode: 404, code: 'REVIEW_NOT_FOUND', message: '找不到審核記錄' });
    }
    return review;
  }

  async findReviewWorkbench(
    reviewId: string,
    identity: ResolvedIdentity
  ): Promise<ReviewWorkbench> {
    const review = await this.findReview(reviewId, identity);
    const validationRun = await this.repository.findValidationRun(
      review.validationRunId
    );
    if (!validationRun) {
      throw new AppError({ statusCode: 404, code: 'REVIEW_EVIDENCE_NOT_FOUND', message: '找不到審核所需的驗證證據' });
    }
    return {
      review,
      package: review.packageSnapshot,
      version: review.versionSnapshot,
      validation: {
        id: validationRun.id,
        status: validationRun.status,
        runnerVersion: validationRun.runnerVersion,
        scriptDigest: validationRun.scriptDigest,
        expectedMatrix: validationRun.expectedMatrix,
        matrixResults: validationRun.matrixResults,
        attempts: validationRun.attempts,
        startedAt: validationRun.startedAt,
        ...(validationRun.endedAt ? { endedAt: validationRun.endedAt } : {}),
        ...(validationRun.errorCode ? { errorCode: validationRun.errorCode } : {})
      }
    };
  }

  async listNotifications(
    filters: Omit<NotificationListFilters, 'recipientUid'>,
    identity: ResolvedIdentity
  ): Promise<UserNotification[]> {
    const recipientUid = this.requireAuthenticated(identity);
    return this.repository.listNotifications({ ...filters, recipientUid });
  }

  async markNotificationRead(
    notificationId: string,
    identity: ResolvedIdentity
  ): Promise<UserNotification> {
    const recipientUid = this.requireAuthenticated(identity);
    const notification = await this.repository.markNotificationRead(notificationId, recipientUid, this.clock());
    if (!notification) {
      throw new AppError({ statusCode: 404, code: 'NOTIFICATION_NOT_FOUND', message: '找不到通知' });
    }
    return notification;
  }

  private async decideReview(
    reviewId: string,
    decision: 'approve' | 'reject',
    reason: string,
    identity: ResolvedIdentity
  ): Promise<DecideReviewResult> {
    const actorUid = this.requireAuthenticated(identity);
    const review = await this.repository.findReview(reviewId);
    if (!review) {
      throw new AppError({ statusCode: 404, code: 'REVIEW_NOT_FOUND', message: '找不到審核記錄' });
    }
    if (
      review.authorUid === actorUid ||
      !(await this.authorization.canReviewPackageSnapshot(actorUid, {
        packageId: review.packageId,
        ownerTeam: review.ownerTeam,
        packageType: review.packageType,
        category: review.category
      }))
    ) {
      throw new AppError({ statusCode: 403, code: 'FORBIDDEN', message: '不符合審核迴避或指派規則' });
    }
    return this.repository.decideReview({
      reviewId,
      decision,
      reason,
      actorUid,
      occurredAt: this.clock()
    });
  }

  private async requireAggregate(packageId: string): Promise<CatalogAggregate> {
    const aggregate = await this.catalogRepository.findAggregate(packageId);
    if (!aggregate) {
      throw new AppError({ statusCode: 404, code: 'PACKAGE_NOT_FOUND', message: '找不到套件' });
    }
    return aggregate;
  }

  private async requireMaintainer(identity: ResolvedIdentity, ownerTeam: string): Promise<string> {
    const uid = this.requireAuthenticated(identity);
    const [isAdmin, isGlobalMaintainer, isTeamMaintainer] = await Promise.all([
      this.authorization.hasRole(uid, 'platform_admin', { type: 'global' }),
      this.authorization.hasRole(uid, 'maintainer', { type: 'global' }),
      identity.kind === 'authenticated' && identity.teamIds.includes(ownerTeam)
        ? this.authorization.hasRole(uid, 'maintainer', { type: 'team', value: ownerTeam })
        : Promise.resolve(false)
    ]);
    if (!isAdmin && !isGlobalMaintainer && !isTeamMaintainer) {
      throw new AppError({ statusCode: 403, code: 'FORBIDDEN', message: '沒有維護此套件的權限' });
    }
    return uid;
  }

  private requireAuthenticated(identity: ResolvedIdentity): string {
    if (identity.kind !== 'authenticated') {
      throw new AppError({ statusCode: 401, code: 'AUTHENTICATION_REQUIRED', message: '請先登入' });
    }
    return identity.uid;
  }

  private versionNotFound(): AppError {
    return new AppError({ statusCode: 404, code: 'PACKAGE_VERSION_NOT_FOUND', message: '找不到套件版本' });
  }
}
