// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import {
  FEEDBACK_ISSUE_CATEGORIES,
  type FeedbackRecord,
  type FeedbackSummary
} from './types.js';

/**
 * 由反饋明細折疊出統計。所有分類都保留，包含計數為 0 的：
 * 缺席的分類與「無人回報」是兩件事，隱藏會讓讀者誤判分佈。
 */
export function summarizeFeedback(
  packageId: string,
  records: FeedbackRecord[]
): FeedbackSummary {
  const satisfactionCounts = new Map<number, number>();
  const categoryCounts = new Map<string, number>();
  let satisfactionTotal = 0;
  let needsHumanSupport = 0;
  let openNeedsHumanSupport = 0;

  for (const record of records) {
    satisfactionTotal += record.satisfaction;
    satisfactionCounts.set(
      record.satisfaction,
      (satisfactionCounts.get(record.satisfaction) ?? 0) + 1
    );
    categoryCounts.set(
      record.issueCategory,
      (categoryCounts.get(record.issueCategory) ?? 0) + 1
    );
    if (record.needsHumanSupport) {
      needsHumanSupport += 1;
      if (record.status !== 'resolved') openNeedsHumanSupport += 1;
    }
  }

  return {
    packageId,
    total: records.length,
    averageSatisfaction:
      records.length === 0 ? null : satisfactionTotal / records.length,
    satisfactionDistribution: [1, 2, 3, 4, 5].map((satisfaction) => ({
      satisfaction,
      count: satisfactionCounts.get(satisfaction) ?? 0
    })),
    byCategory: FEEDBACK_ISSUE_CATEGORIES.map((issueCategory) => ({
      issueCategory,
      count: categoryCounts.get(issueCategory) ?? 0
    })),
    needsHumanSupport,
    openNeedsHumanSupport
  };
}
