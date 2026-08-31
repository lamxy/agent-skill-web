// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import type {
  CatalogAggregate,
  PackageRecord,
  PackageType,
  PackageVersionRecord,
  UpdatePackageVersionInput
} from '../catalog/types.js';
import type {
  ValidationMatrixTarget,
  ValidationMatrixResult,
  ValidationRunResult
} from './validation-runner.js';
import type { ValidationTargetSnapshot } from './script-target-governance.js';

export type PublicationReviewStatus = 'pending' | 'approved' | 'rejected' | 'superseded';

export const VALIDATION_RETRY_CLAIM_TTL_MS = 15 * 60 * 1000;

export interface PublicationReview {
  id: string;
  packageId: string;
  version: string;
  packageType: PackageType;
  category: string;
  ownerTeam: string;
  authorUid: string;
  packageSnapshot: PackageRecord;
  versionSnapshot: PackageVersionRecord;
  validationRunId: string;
  reviewerUid?: string;
  status: PublicationReviewStatus;
  decisionReason?: string;
  createdAt: Date;
  decidedAt?: Date;
}

export interface ValidationRun {
  id: string;
  packageId: string;
  version: string;
  scriptDigest: string;
  contractVersion: number;
  targetSnapshots: ValidationTargetSnapshot[];
  manifestDigest: string;
  status: 'running' | 'passed' | 'failed';
  requestedByUid: string;
  expectedMatrix: ValidationMatrixTarget[];
  attempts: ValidationAttempt[];
  retryClaimToken?: string;
  retryClaimedAt?: Date;
  lastAttemptStartedAt: Date;
  runnerVersion: string;
  matrixResults: ValidationMatrixResult[];
  startedAt: Date;
  endedAt?: Date;
  errorCode?: string;
}

export interface ValidationAttempt {
  attempt: number;
  kind: 'initial' | 'retry';
  /** skipped：VALIDATION_MODE=manual 時未執行機器驗證，與 passed 語意不同。 */
  status: 'running' | 'abandoned' | 'passed' | 'failed' | 'skipped';
  requestedByUid: string;
  startedAt: Date;
  endedAt?: Date;
  runnerVersion?: string;
  matrixResults: ValidationMatrixResult[];
  errorCode?: string;
}

export interface VersionDelisting {
  id: string;
  packageId: string;
  version: string;
  reasonCode: string;
  reasonDetail?: string;
  effectiveAt: Date;
  actorUid: string;
  createdAt: Date;
}

export interface UserNotification {
  id: string;
  recipientUid: string;
  notificationType:
    | 'version_delisted'
    | 'version_emergency_disabled'
    | 'version_published';
  packageId: string;
  version: string;
  payload: Record<string, unknown>;
  status: 'unread' | 'read';
  createdAt: Date;
  readAt?: Date;
}

export interface GovernanceAuditLog {
  id: string;
  eventType: string;
  actorUid: string;
  packageId: string;
  version: string;
  details: Record<string, unknown>;
  occurredAt: Date;
}

export interface GovernanceDomainEvent {
  id: string;
  aggregateType: 'package_version' | 'user_notification';
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
  occurredAt: Date;
}

export interface InstallationSnapshot {
  id: string;
  packageId: string;
  version: string;
  userRefType: 'uid' | 'uuid';
  userRef: string;
  status: 'downloaded' | 'succeeded' | 'failed' | 'uninstalled';
}

export interface BeginValidationInput {
  aggregate: CatalogAggregate;
  version: PackageVersionRecord;
  actorUid: string;
  occurredAt: Date;
}

export interface BeginValidationResult {
  version: PackageVersionRecord;
  validationRun: ValidationRun;
}

export interface CompleteValidationInput {
  validationRunId: string;
  retryClaimToken?: string;
  result: ValidationRunResult;
  occurredAt: Date;
}

export interface ClaimValidationRetryInput {
  validationRunId: string;
  actorUid: string;
  occurredAt: Date;
}

export interface ClaimValidationRetryResult {
  version: PackageVersionRecord;
  validationRun: ValidationRun;
  retryClaimToken: string;
}

export interface CompleteValidationResult {
  version: PackageVersionRecord;
  validationRun: ValidationRun;
  review?: PublicationReview;
}

export interface DecideReviewInput {
  reviewId: string;
  decision: 'approve' | 'reject';
  reason: string;
  actorUid: string;
  occurredAt: Date;
}

export interface DecideReviewResult {
  version: PackageVersionRecord;
  review: PublicationReview;
  /** 核准發布時對既有安裝者送出的更新通知；駁回時為空陣列。 */
  notifications: UserNotification[];
}

export interface ReviseVersionInput {
  packageId: string;
  version: string;
  actorUid: string;
  occurredAt: Date;
}

export interface UpdateVersionContentInput extends ReviseVersionInput {
  patch: UpdatePackageVersionInput;
}

export interface DeprecateVersionInput extends ReviseVersionInput {
  reason?: string;
}

export interface EmergencyDisableVersionInput extends ReviseVersionInput {
  reasonCode: string;
  reasonDetail?: string;
}

export interface DelistVersionInput extends ReviseVersionInput {
  reasonCode: string;
  reasonDetail?: string;
  effectiveAt: Date;
}

export interface DelistVersionResult {
  version: PackageVersionRecord;
  delisting: VersionDelisting;
  notifications: UserNotification[];
}

export interface ReviewListFilters {
  status?: PublicationReviewStatus;
  packageId?: string;
}

export interface NotificationListFilters {
  recipientUid?: string;
  status?: UserNotification['status'];
}

export interface GovernanceRepository {
  beginValidation(input: BeginValidationInput): Promise<BeginValidationResult>;
  claimValidationRetry(input: ClaimValidationRetryInput): Promise<ClaimValidationRetryResult>;
  completeValidation(input: CompleteValidationInput): Promise<CompleteValidationResult>;
  findValidationRun(validationRunId: string): Promise<ValidationRun | undefined>;
  findRunningValidationRun(packageId: string, version: string): Promise<ValidationRun | undefined>;
  decideReview(input: DecideReviewInput): Promise<DecideReviewResult>;
  reviseVersion(input: ReviseVersionInput): Promise<PackageVersionRecord>;
  updateVersionContent(input: UpdateVersionContentInput): Promise<PackageVersionRecord>;
  deprecateVersion(input: DeprecateVersionInput): Promise<PackageVersionRecord>;
  delistVersion(input: DelistVersionInput): Promise<DelistVersionResult>;
  emergencyDisableVersion(input: EmergencyDisableVersionInput): Promise<DelistVersionResult>;
  listReviews(filters: ReviewListFilters): Promise<PublicationReview[]>;
  findReview(reviewId: string): Promise<PublicationReview | undefined>;
  listNotifications(filters: NotificationListFilters): Promise<UserNotification[]>;
  markNotificationRead(notificationId: string, recipientUid: string, occurredAt: Date): Promise<UserNotification | undefined>;
}
