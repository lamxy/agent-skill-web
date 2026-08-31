// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from 'drizzle-orm/pg-core';

import type { ValidationAttempt } from '../../modules/governance/repository.js';
import type { ValidationTargetSnapshot } from '../../modules/governance/script-target-governance.js';
import type {
  PackageRecord,
  PackageVersionRecord,
  ScriptOptionDefinition
} from '../../modules/catalog/types.js';
import type {
  ValidationMatrixResult,
  ValidationMatrixTarget
} from '../../modules/governance/validation-runner.js';

export const packageVersionStatus = pgEnum('package_version_status', [
  'draft',
  'validating',
  'validation_failed',
  'review_required',
  'published',
  'deprecated',
  'delisted',
  'emergency_disabled'
]);

export const installationStatus = pgEnum('installation_status', [
  'downloaded',
  'succeeded',
  'failed',
  'uninstalled'
]);

export const userReferenceType = pgEnum('user_reference_type', [
  'uid',
  'uuid'
]);

export const publicationReviewStatus = pgEnum('publication_review_status', [
  'pending',
  'approved',
  'rejected',
  'superseded'
]);

export const domainEventStatus = pgEnum('domain_event_status', [
  'pending',
  'published',
  'failed'
]);

const idColumn = () =>
  bigint('id', { mode: 'number' })
    .primaryKey()
    .generatedAlwaysAsIdentity();

const createdAtColumn = () =>
  timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const packages = pgTable(
  'packages',
  {
    id: idColumn(),
    packageId: text('package_id').notNull(),
    type: text('type').notNull(),
    name: text('name').notNull(),
    purpose: text('purpose').notNull().default(''),
    ownerTeam: text('owner_team').notNull(),
    /**
     * 舊的自由文字分類。Task 17 後降級為 legacy 顯示標籤：
     * 實際資料同時存在 backend 與 後端，不能拿來當篩選或權限條件。
     * 篩選與標籤一律使用 categoryCode。
     */
    category: text('category').notNull(),
    categoryCode: text('category_code').notNull().default('general'),
    visibility: text('visibility').notNull().default('internal'),
    sourceUri: text('source_uri').notNull(),
    license: text('license').notNull(),
    source: text('source').notNull().default('custom'),
    publisherKind: text('publisher_kind').notNull().default('organization'),
    publisherName: text('publisher_name').notNull().default(''),
    /** 技能在組織內的推廣地位，由審核人核定，不隨發版重評 */
    grade: text('grade').notNull().default('basic'),
    gradeDecidedByUid: text('grade_decided_by_uid'),
    gradeDecidedAt: timestamp('grade_decided_at', { withTimezone: true }),
    /**
     * 建立者。不參與授權判斷（維護權限綁團隊，見 requireMaintainer），
     * 只用於「我的技能」的預設收錄。舊資料可能為空。
     */
    createdByUid: text('created_by_uid'),
    lifecycle: text('lifecycle').notNull().default('active'),
    createdAt: createdAtColumn(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => [
    uniqueIndex('packages_package_id_uidx').on(table.packageId),
    check('packages_type_check', sql`${table.type} in ('skill', 'tool')`),
    check('packages_visibility_check', sql`${table.visibility} in ('public', 'internal')`),
    check('packages_lifecycle_check', sql`${table.lifecycle} in ('active', 'archived')`),
    check('packages_source_check', sql`${table.source} in ('opensource', 'custom')`),
    check(
      'packages_publisher_kind_check',
      sql`${table.publisherKind} in ('individual', 'organization')`
    ),
    check(
      'packages_category_code_check',
      sql`${table.categoryCode} in ('frontend', 'backend', 'data', 'testing', 'devops', 'security', 'product_design', 'general')`
    ),
    check(
      'packages_grade_check',
      sql`${table.grade} in ('basic', 'premium', 'general', 'company_wide', 'open_sourced')`
    ),
    index('packages_category_name_idx').on(table.category, table.name),
    index('packages_grade_name_idx').on(table.grade, table.name),
    index('packages_created_by_updated_idx').on(table.createdByUid, table.updatedAt),
    index('packages_source_name_idx').on(table.source, table.name),
    index('packages_category_code_name_idx').on(table.categoryCode, table.name)
  ]
);

export const packageVersions = pgTable(
  'package_versions',
  {
    id: idColumn(),
    packageId: text('package_id').notNull(),
    version: text('version').notNull(),
    releaseNotes: text('release_notes'),
    supportedOs: jsonb('supported_os').$type<string[]>().notNull().default([]),
    supportedClients: jsonb('supported_clients')
      .$type<
        Array<{
          name: string;
          version?: string;
          adaptationSource: 'publisher' | 'maintainer' | 'community';
          maintainer: string;
        }>
      >()
      .notNull()
      .default([]),
    lifecycle: packageVersionStatus('lifecycle').notNull().default('draft'),
    scriptDigest: text('script_digest'),
    scriptManifestDigest: text('script_manifest_digest'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    installCommand: text('install_command').notNull(),
    uninstallCommand: text('uninstall_command').notNull(),
    hasResidualEffects: boolean('has_residual_effects').notNull().default(false),
    residualDescription: text('residual_description'),
    manualCleanupSteps: text('manual_cleanup_steps'),
    authorUid: text('author_uid').notNull(),
    createdAt: createdAtColumn(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => [
    uniqueIndex('package_versions_package_version_uidx').on(
      table.packageId,
      table.version
    ),
    index('package_versions_package_id_idx').on(table.packageId),
    index('package_versions_lifecycle_created_at_idx').on(
      table.lifecycle,
      table.createdAt
    )
  ]
);

export const packageVersionScriptTargets = pgTable(
  'package_version_script_targets',
  {
    id: text('id').primaryKey(),
    packageId: text('package_id').notNull(),
    packageVersion: text('package_version').notNull(),
    targetOs: text('target_os').notNull(),
    clientRuntime: text('client_runtime').notNull(),
    currentRevisionId: text('current_revision_id'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedByUid: text('deleted_by_uid'),
    createdAt: createdAtColumn(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => [
    uniqueIndex('package_version_script_targets_matrix_uidx').on(
      table.packageId,
      table.packageVersion,
      table.targetOs,
      table.clientRuntime
    ),
    index('package_version_script_targets_active_idx').on(
      table.packageId,
      table.packageVersion,
      table.deletedAt
    ),
    check(
      'package_version_script_targets_os_check',
      sql`${table.targetOs} in ('linux/macos', 'windows', 'wsl')`
    ),
    check(
      'package_version_script_targets_client_check',
      sql`${table.clientRuntime} in ('claude-code', 'codex')`
    )
  ]
);

export const scriptTargetRevisions = pgTable(
  'script_target_revisions',
  {
    id: text('id').primaryKey(),
    targetId: text('target_id').notNull(),
    targetOs: text('target_os').notNull(),
    clientRuntime: text('client_runtime').notNull(),
    scriptVersion: integer('script_version').notNull(),
    installCommand: text('install_command').notNull(),
    uninstallCommand: text('uninstall_command').notNull(),
    options: jsonb('options').$type<ScriptOptionDefinition[]>().notNull().default([]),
    usageInstructions: text('usage_instructions').notNull(),
    hasResidualEffects: boolean('has_residual_effects').notNull().default(false),
    residualDescription: text('residual_description'),
    manualCleanupSteps: text('manual_cleanup_steps'),
    changeDescription: text('change_description'),
    copiedFromTargetId: text('copied_from_target_id'),
    copiedFromTargetOs: text('copied_from_target_os'),
    copiedFromClientRuntime: text('copied_from_client_runtime'),
    copiedFromScriptVersion: integer('copied_from_script_version'),
    contentDigest: text('content_digest').notNull(),
    legacyImported: boolean('legacy_imported').notNull().default(false),
    createdByUid: text('created_by_uid').notNull(),
    createdAt: createdAtColumn()
  },
  (table) => [
    uniqueIndex('script_target_revisions_target_version_uidx').on(
      table.targetId,
      table.scriptVersion
    ),
    index('script_target_revisions_target_created_idx').on(
      table.targetId,
      table.createdAt
    ),
    check('script_target_revisions_version_check', sql`${table.scriptVersion} >= 1`),
    check(
      'script_target_revisions_os_check',
      sql`${table.targetOs} in ('linux/macos', 'windows', 'wsl')`
    ),
    check(
      'script_target_revisions_client_check',
      sql`${table.clientRuntime} in ('claude-code', 'codex')`
    )
  ]
);

export const installations = pgTable(
  'installations',
  {
    id: idColumn(),
    legacyPackageVersionId: bigint('legacy_package_version_id', {
      mode: 'number'
    }),
    idempotencyKey: text('idempotency_key').notNull(),
    packageId: text('package_id').notNull().default(sql`null`),
    version: text('version').notNull().default(sql`null`),
    userRef: text('user_ref').notNull(),
    userRefType: userReferenceType('user_ref_type').notNull(),
    osType: text('os_type').notNull(),
    clientRuntime: text('client_runtime').notNull(),
    status: installationStatus('status').notNull(),
    errorCode: text('error_code'),
    scriptVersion: integer('script_version'),
    options: jsonb('options').$type<Record<string, string | boolean>>(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    payloadFingerprint: text('payload_fingerprint').notNull().default(sql`null`),
    createdAt: createdAtColumn()
  },
  (table) => [
    uniqueIndex('installations_idempotency_key_uidx').on(table.idempotencyKey),
    index('installations_package_version_status_started_idx').on(
      table.packageId,
      table.version,
      table.status,
      table.startedAt
    ),
    index('installations_package_version_script_status_started_idx').on(
      table.packageId,
      table.version,
      table.scriptVersion,
      table.status,
      table.startedAt
    ),
    index('installations_package_started_at_idx').on(
      table.packageId,
      table.startedAt
    ),
    index('installations_user_ref_created_idx').on(
      table.userRefType,
      table.userRef,
      table.createdAt
    )
  ]
);

export const publicationReviews = pgTable(
  'publication_reviews',
  {
    legacyRecordId: bigint('legacy_record_id', { mode: 'number' }),
    legacyPackageVersionId: bigint('legacy_package_version_id', {
      mode: 'number'
    }),
    id: uuid('id').primaryKey().defaultRandom(),
    packageId: text('package_id').notNull(),
    version: text('version').notNull(),
    packageType: text('package_type').notNull(),
    category: text('category').notNull(),
    ownerTeam: text('owner_team').notNull(),
    authorUid: text('author_uid').notNull(),
    packageSnapshot: jsonb('package_snapshot').$type<PackageRecord>().notNull(),
    versionSnapshot: jsonb('version_snapshot').$type<PackageVersionRecord>().notNull(),
    validationRunId: uuid('validation_run_id').notNull(),
    reviewerUid: text('reviewer_uid'),
    status: publicationReviewStatus('status').notNull().default('pending'),
    decisionReason: text('decision_reason'),
    createdAt: createdAtColumn(),
    decidedAt: timestamp('decided_at', { withTimezone: true })
  },
  (table) => [
    uniqueIndex('publication_reviews_pending_version_uidx')
      .on(table.packageId, table.version)
      .where(sql`${table.status} = 'pending'`),
    index('publication_reviews_package_version_idx').on(
      table.packageId,
      table.version,
      table.createdAt
    ),
    index('publication_reviews_status_created_at_idx').on(
      table.status,
      table.createdAt
    ),
    index('publication_reviews_reviewer_decided_at_idx').on(
      table.reviewerUid,
      table.decidedAt
    )
  ]
);

export const validationRuns = pgTable(
  'validation_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    packageId: text('package_id').notNull(),
    version: text('version').notNull(),
    scriptDigest: text('script_digest').notNull(),
    contractVersion: integer('contract_version').notNull().default(1),
    targetSnapshots: jsonb('target_snapshots')
      .$type<ValidationTargetSnapshot[]>()
      .notNull()
      .default([]),
    manifestDigest: text('manifest_digest'),
    status: text('status').notNull(),
    requestedByUid: text('requested_by_uid').notNull(),
    expectedMatrix: jsonb('expected_matrix').$type<ValidationMatrixTarget[]>().notNull().default([]),
    attempts: jsonb('attempts').$type<ValidationAttempt[]>().notNull().default([]),
    retryClaimToken: uuid('retry_claim_token'),
    retryClaimedAt: timestamp('retry_claimed_at', { withTimezone: true }),
    lastAttemptStartedAt: timestamp('last_attempt_started_at', { withTimezone: true }).notNull(),
    runnerVersion: text('runner_version').notNull().default(''),
    matrixResults: jsonb('matrix_results').$type<ValidationMatrixResult[]>().notNull().default([]),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    errorCode: text('error_code')
  },
  (table) => [
    check('validation_runs_status_check', sql`${table.status} in ('running', 'passed', 'failed', 'skipped')`),
    uniqueIndex('validation_runs_running_version_uidx')
      .on(table.packageId, table.version)
      .where(sql`${table.status} = 'running'`),
    index('validation_runs_package_version_started_idx').on(
      table.packageId,
      table.version,
      table.startedAt
    ),
    index('validation_runs_status_started_idx').on(table.status, table.startedAt)
  ]
);

export const versionDelistings = pgTable(
  'version_delistings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    packageId: text('package_id').notNull(),
    version: text('version').notNull(),
    reasonCode: text('reason_code').notNull(),
    reasonDetail: text('reason_detail'),
    effectiveAt: timestamp('effective_at', { withTimezone: true }).notNull(),
    actorUid: text('actor_uid').notNull(),
    createdAt: createdAtColumn()
  },
  (table) => [
    index('version_delistings_package_version_created_idx').on(
      table.packageId,
      table.version,
      table.createdAt
    ),
    index('version_delistings_effective_at_idx').on(table.effectiveAt)
  ]
);

export const userNotifications = pgTable(
  'user_notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    recipientUid: text('recipient_uid').notNull(),
    notificationType: text('notification_type').notNull(),
    packageId: text('package_id').notNull(),
    version: text('version').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    status: text('status').notNull().default('unread'),
    createdAt: createdAtColumn(),
    readAt: timestamp('read_at', { withTimezone: true })
  },
  (table) => [
    check(
      'user_notifications_type_check',
      sql`${table.notificationType} in ('version_delisted', 'version_emergency_disabled', 'version_published')`
    ),
    check('user_notifications_status_check', sql`${table.status} in ('unread', 'read')`),
    uniqueIndex('user_notifications_recipient_type_version_uidx').on(
      table.recipientUid,
      table.notificationType,
      table.packageId,
      table.version
    ),
    index('user_notifications_recipient_status_created_idx').on(
      table.recipientUid,
      table.status,
      table.createdAt
    ),
    index('user_notifications_package_version_idx').on(table.packageId, table.version)
  ]
);

export const packageSupportChannels = pgTable(
  'package_support_channels',
  {
    id: text('id').primaryKey(),
    packageId: text('package_id').notNull(),
    channelType: text('channel_type').notNull(),
    label: text('label').notNull(),
    address: text('address').notNull(),
    instructions: text('instructions'),
    displayOrder: integer('display_order').notNull().default(0),
    updatedByUid: text('updated_by_uid').notNull(),
    createdAt: createdAtColumn(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => [
    check(
      'package_support_channels_type_check',
      sql`${table.channelType} in ('im_group', 'email', 'ticket_system', 'doc')`
    ),
    check(
      'package_support_channels_order_check',
      sql`${table.displayOrder} >= 0`
    ),
    uniqueIndex('package_support_channels_package_type_address_uidx').on(
      table.packageId,
      table.channelType,
      table.address
    ),
    index('package_support_channels_package_order_idx').on(
      table.packageId,
      table.displayOrder,
      table.createdAt
    )
  ]
);

export const packageFeedback = pgTable(
  'package_feedback',
  {
    id: text('id').primaryKey(),
    packageId: text('package_id').notNull(),
    version: text('version').notNull(),
    authorRefType: text('author_ref_type').notNull(),
    authorRef: text('author_ref').notNull(),
    satisfaction: integer('satisfaction').notNull(),
    issueCategory: text('issue_category').notNull(),
    detail: text('detail').notNull(),
    needsHumanSupport: boolean('needs_human_support').notNull().default(false),
    status: text('status').notNull().default('open'),
    createdAt: createdAtColumn()
  },
  (table) => [
    check(
      'package_feedback_ref_type_check',
      sql`${table.authorRefType} in ('uid', 'uuid')`
    ),
    check(
      'package_feedback_satisfaction_check',
      sql`${table.satisfaction} between 1 and 5`
    ),
    check(
      'package_feedback_category_check',
      sql`${table.issueCategory} in ('install_failure', 'uninstall_failure', 'documentation', 'performance', 'compatibility', 'feature_request', 'other')`
    ),
    check(
      'package_feedback_status_check',
      sql`${table.status} in ('open', 'acknowledged', 'resolved')`
    ),
    index('package_feedback_package_created_idx').on(
      table.packageId,
      table.createdAt
    ),
    index('package_feedback_package_version_category_idx').on(
      table.packageId,
      table.version,
      table.issueCategory
    ),
    index('package_feedback_support_idx').on(
      table.packageId,
      table.needsHumanSupport,
      table.status,
      table.createdAt
    ),
    index('package_feedback_author_created_idx').on(
      table.authorRefType,
      table.authorRef,
      table.createdAt
    )
  ]
);

export const domainEvents = pgTable(
  'domain_events',
  {
    id: idColumn(),
    aggregateType: text('aggregate_type').notNull(),
    aggregateId: text('aggregate_id').notNull(),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    status: domainEventStatus('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    occurredAt: timestamp('occurred_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    lastError: text('last_error')
  },
  (table) => [
    check('domain_events_attempts_nonnegative', sql`${table.attempts} >= 0`),
    index('domain_events_status_occurred_at_idx').on(
      table.status,
      table.occurredAt
    ),
    index('domain_events_aggregate_idx').on(
      table.aggregateType,
      table.aggregateId
    )
  ]
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: bigint('id', { mode: 'bigint' })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    eventType: text('event_type').notNull(),
    actorUid: text('actor_uid').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    action: text('action').notNull(),
    details: jsonb('details').$type<Record<string, unknown>>().notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    occurredAt: timestamp('occurred_at', { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => [
    check(
      'audit_logs_required_text_check',
      sql`length(${table.eventType}) > 0 and length(${table.actorUid}) > 0 and length(${table.targetId}) > 0 and length(${table.action}) > 0`
    ),
    check(
      'audit_logs_target_type_check',
      sql`${table.targetType} in ('package', 'version', 'script_target', 'user', 'role', 'support_channel', 'feedback')`
    ),
    index('audit_logs_occurred_at_id_idx').on(table.occurredAt, table.id),
    index('audit_logs_event_type_occurred_at_id_idx').on(
      table.eventType,
      table.occurredAt,
      table.id
    ),
    index('audit_logs_actor_uid_occurred_at_id_idx').on(
      table.actorUid,
      table.occurredAt,
      table.id
    ),
    index('audit_logs_target_occurred_at_id_idx').on(
      table.targetType,
      table.targetId,
      table.occurredAt,
      table.id
    )
  ]
);

export const identities = pgTable(
  'identities',
  {
    uid: text('uid').primaryKey(),
    displayName: text('display_name').notNull(),
    teamIds: jsonb('team_ids').$type<string[]>().notNull().default([]),
    providerType: text('provider_type').notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: createdAtColumn(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => [
    check(
      'identities_provider_type_check',
      sql`${table.providerType} in ('development', 'oidc')`
    ),
    index('identities_active_updated_at_idx').on(
      table.active,
      table.updatedAt
    )
  ]
);

export const identitySessions = pgTable(
  'identity_sessions',
  {
    sessionDigest: text('session_digest').primaryKey(),
    uid: text('uid').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAtColumn()
  },
  (table) => [
    index('identity_sessions_uid_revoked_at_idx').on(
      table.uid,
      table.revokedAt
    ),
    index('identity_sessions_expires_at_idx').on(table.expiresAt)
  ]
);

export const roleAssignments = pgTable(
  'role_assignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    uid: text('uid').notNull(),
    role: text('role').notNull(),
    scopeType: text('scope_type').notNull(),
    scopeValue: text('scope_value').notNull().default(''),
    assignedByUid: text('assigned_by_uid').notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: createdAtColumn(),
    revokedAt: timestamp('revoked_at', { withTimezone: true })
  },
  (table) => [
    check(
      'role_assignments_role_check',
      sql`${table.role} in ('employee', 'maintainer', 'reviewer', 'platform_admin')`
    ),
    check(
      'role_assignments_scope_type_check',
      sql`${table.scopeType} in ('global', 'team', 'package_type', 'category', 'package')`
    ),
    check(
      'role_assignments_scope_value_check',
      sql`(${table.scopeType} = 'global' and ${table.scopeValue} = '') or (${table.scopeType} <> 'global' and length(${table.scopeValue}) > 0)`
    ),
    uniqueIndex('role_assignments_active_uidx')
      .on(table.uid, table.role, table.scopeType, table.scopeValue)
      .where(sql`${table.active} = true`),
    index('role_assignments_uid_active_idx').on(table.uid, table.active)
  ]
);

export const reviewerAssignments = pgTable(
  'reviewer_assignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reviewerUid: text('reviewer_uid').notNull(),
    packageType: text('package_type').notNull(),
    category: text('category').notNull(),
    assignedByUid: text('assigned_by_uid').notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: createdAtColumn(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedByUid: text('revoked_by_uid')
  },
  (table) => [
    check(
      'reviewer_assignments_scope_nonempty',
      sql`length(${table.packageType}) > 0 and length(${table.category}) > 0`
    ),
    uniqueIndex('reviewer_assignments_active_scope_uidx')
      .on(table.reviewerUid, table.packageType, table.category)
      .where(sql`${table.active} = true`),
    index('reviewer_assignments_reviewer_active_idx').on(
      table.reviewerUid,
      table.active
    )
  ]
);

/**
 * 平台版本歷史。記錄平台自身發布過哪些版本、各版本是否開放使用，
 * 讓頂欄的版本選單改由資料驅動，不必在前端寫死版本清單。
 *
 * 版本號直接作為主鍵：版本號本身即穩定的業務識別，不需要額外代理鍵。
 */
export const platformVersions = pgTable(
  'platform_versions',
  {
    version: text('version').primaryKey(),
    isAvailable: boolean('is_available').notNull().default(false),
    isCurrent: boolean('is_current').notNull().default(false),
    note: text('note'),
    releasedAt: timestamp('released_at', { withTimezone: true }),
    displayOrder: integer('display_order').notNull().default(0),
    createdAt: createdAtColumn(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => [
    check('platform_versions_version_nonempty', sql`length(${table.version}) > 0`),
    check('platform_versions_order_check', sql`${table.displayOrder} >= 0`),
    /* 預設版本至多一個，交由資料庫保證，避免前端拿到兩個預設值 */
    uniqueIndex('platform_versions_current_uidx')
      .on(table.isCurrent)
      .where(sql`${table.isCurrent} = true`),
    index('platform_versions_order_idx').on(table.displayOrder, table.version)
  ]
);
