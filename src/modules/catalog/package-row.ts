// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import type { PackageRecord, PublisherKind } from './types.js';
import type * as schema from '../../shared/database/schema.js';

/**
 * packages 資料列轉為 PackageRecord。
 *
 * catalog、governance、analytics 三個模組都要做這件事。各自抄一份的結果是
 * 新增欄位時只改到其中一兩處，讀取端拿到缺欄位的快照，因此集中在此。
 */
export function mapPackageRow(
  row: typeof schema.packages.$inferSelect
): PackageRecord {
  return {
    packageId: row.packageId,
    type: row.type as PackageRecord['type'],
    name: row.name,
    purpose: row.purpose,
    ownerTeam: row.ownerTeam,
    category: row.category,
    categoryCode: row.categoryCode as PackageRecord['categoryCode'],
    visibility: row.visibility as PackageRecord['visibility'],
    sourceUri: row.sourceUri,
    license: row.license,
    source: row.source as PackageRecord['source'],
    publisher: {
      kind: row.publisherKind as PublisherKind,
      name: row.publisherName
    },
    grade: row.grade as PackageRecord['grade'],
    ...(row.gradeDecidedByUid ? { gradeDecidedByUid: row.gradeDecidedByUid } : {}),
    ...(row.gradeDecidedAt ? { gradeDecidedAt: row.gradeDecidedAt } : {}),
    ...(row.createdByUid ? { createdByUid: row.createdByUid } : {}),
    lifecycle: row.lifecycle as PackageRecord['lifecycle'],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}
