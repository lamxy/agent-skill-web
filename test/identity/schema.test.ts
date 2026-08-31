// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import {
  auditLogs,
  identities,
  identitySessions,
  installations,
  packages,
  packageVersions,
  packageVersionScriptTargets,
  publicationReviews,
  reviewerAssignments,
  roleAssignments,
  scriptTargetRevisions
} from '../../src/shared/database/schema.js';

describe('資料庫反範式約束', () => {
  it('現有業務表只保存邏輯 ID，不建立資料庫外鍵', () => {
    const tables = [
      packages,
      packageVersions,
      packageVersionScriptTargets,
      scriptTargetRevisions,
      installations,
      publicationReviews
    ];

    expect(
      tables.flatMap((table) => getTableConfig(table).foreignKeys)
    ).toEqual([]);
    expect(installations.packageId.notNull).toBe(true);
    expect(installations.version.notNull).toBe(true);
    expect(installations.payloadFingerprint.notNull).toBe(true);
    expect(installations.legacyPackageVersionId.notNull).toBe(false);
    expect(installations.startedAt.dataType).toBe('date');
    expect(installations.createdAt.dataType).toBe('date');
  });

  it('身份、工作階段、角色與審核指派表均可獨立查詢且沒有外鍵', () => {
    const tables = [
      identities,
      identitySessions,
      roleAssignments,
      reviewerAssignments
    ];
    const configs = tables.map(getTableConfig);

    expect(configs.map((config) => config.name)).toEqual([
      'identities',
      'identity_sessions',
      'role_assignments',
      'reviewer_assignments'
    ]);
    expect(configs.flatMap((config) => config.foreignKeys)).toEqual([]);
    expect(identities.teamIds.dataType).toBe('json');
    expect(identitySessions.sessionDigest.primary).toBe(true);
  });

  it('審計表是獨立的 append-only 聚合且沒有外鍵', () => {
    const config = getTableConfig(auditLogs);

    expect(config.name).toBe('audit_logs');
    expect(config.foreignKeys).toEqual([]);
    expect(auditLogs.details.dataType).toBe('json');
  });
});
