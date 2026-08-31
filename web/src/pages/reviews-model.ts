// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { REVIEW_PAGE_SIZE } from '../api/reviews.js';
import { ApiError } from '../api/client.js';
import type {
  PublicationReviewStatus,
  ReviewFilters,
  ReviewSearchResult,
  ValidationMatrixResult,
  ValidationMatrixTarget
} from '../api/types.js';
import type { ReviewDecision } from '../api/reviews.js';

const REVIEW_STATUSES = new Set<PublicationReviewStatus>([
  'pending',
  'approved',
  'rejected',
  'superseded'
]);
const CURSOR_PATTERN = /^[1-9]\d{0,19}$/;
const REVIEW_OS = new Set(['linux', 'windows', 'macos']);
const REVIEW_CLIENTS = new Set(['codex', 'claude-code']);

const REVIEW_QUEUE_COPY: Record<
  PublicationReviewStatus,
  { title: string; emptyMessage: string }
> = {
  pending: {
    title: '待審佇列',
    emptyMessage: '目前沒有符合條件的待審項目。調整篩選條件，或稍後再回來查看。'
  },
  approved: {
    title: '已核准記錄',
    emptyMessage: '目前沒有符合條件的已核准記錄。調整篩選條件再試一次。'
  },
  rejected: {
    title: '已駁回記錄',
    emptyMessage: '目前沒有符合條件的已駁回記錄。調整篩選條件再試一次。'
  },
  superseded: {
    title: '已取代記錄',
    emptyMessage: '目前沒有符合條件的已取代記錄。調整篩選條件再試一次。'
  }
};

function normalizeFilterValue(value: string | null): string | undefined {
  const normalized = value
    ?.normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/gu, '-');
  return normalized || undefined;
}

export function readReviewFilters(params: URLSearchParams): ReviewFilters {
  const requestedStatus = params.get('status');
  const status = REVIEW_STATUSES.has(requestedStatus as PublicationReviewStatus)
    ? (requestedStatus as PublicationReviewStatus)
    : 'pending';
  const requestedOs = normalizeFilterValue(params.get('os'));
  const os = requestedOs && REVIEW_OS.has(requestedOs) ? requestedOs : undefined;
  const requestedClient = normalizeFilterValue(params.get('client'));
  const client = requestedClient && REVIEW_CLIENTS.has(requestedClient)
    ? requestedClient
    : undefined;
  const cursor = params.get('cursor')?.trim();

  return {
    status,
    ...(os ? { os } : {}),
    ...(client ? { client } : {}),
    ...(cursor && CURSOR_PATTERN.test(cursor) ? { cursor } : {})
  };
}

export function isEmptyReviewPage(
  filters: ReviewFilters,
  result: Pick<ReviewSearchResult, 'items'>
): boolean {
  return !filters.cursor && result.items.length === 0;
}

export function reviewQueueCopy(status: PublicationReviewStatus) {
  return REVIEW_QUEUE_COPY[status];
}

const REVIEW_STATUS_META: Record<
  PublicationReviewStatus,
  { label: string; tone: 'ok' | 'warn' | 'stop' | 'neutral'; canDecide: boolean }
> = {
  pending: { label: '待審', tone: 'warn', canDecide: true },
  approved: { label: '已核准', tone: 'ok', canDecide: false },
  rejected: { label: '已駁回', tone: 'stop', canDecide: false },
  superseded: { label: '已取代', tone: 'neutral', canDecide: false }
};

export function reviewStatusMeta(status: PublicationReviewStatus) {
  return REVIEW_STATUS_META[status];
}

export function reviewDecisionError(
  decision: ReviewDecision,
  reason: string
): string | undefined {
  if (reason.length > 5000) return '決議理由最多 5,000 字。';
  if (decision === 'reject' && !reason.trim()) return '駁回必須填寫理由。';
  return undefined;
}

export type ReviewMutationRecovery = 'reload' | 'sync-required' | 'show-error';

export function reviewMutationRecovery(error: unknown): ReviewMutationRecovery {
  if (!(error instanceof ApiError)) return 'show-error';
  if (error.code === 'REVIEW_ALREADY_DECIDED' || error.statusCode === 409) {
    return 'reload';
  }
  return error.retryable ? 'sync-required' : 'show-error';
}

export function buildReviewMatrixRows(
  expected: ValidationMatrixTarget[],
  results: ValidationMatrixResult[]
): Array<{ target: ValidationMatrixTarget; result?: ValidationMatrixResult }> {
  const resultByTarget = new Map(
    results.map((result) => [`${result.os}\u0000${result.client}`, result])
  );
  return expected.map((target) => {
    const result = resultByTarget.get(`${target.os}\u0000${target.client}`);
    return { target, ...(result ? { result } : {}) };
  });
}

export function previousReviewCursor(cursor: string | undefined): string | undefined {
  if (!cursor || !CURSOR_PATTERN.test(cursor)) return undefined;
  const offset = Number.parseInt(cursor, 10);
  if (!Number.isSafeInteger(offset) || offset <= REVIEW_PAGE_SIZE) {
    return undefined;
  }
  return String(offset - REVIEW_PAGE_SIZE);
}

export function replaceReviewCursor(
  filters: ReviewFilters,
  cursor: string | undefined
): ReviewFilters {
  const { cursor: _currentCursor, ...firstPageFilters } = filters;
  return {
    ...firstPageFilters,
    ...(cursor ? { cursor } : {})
  };
}

interface ValidationSummaryInput {
  expectedMatrix: Array<{ os: string; client: string }>;
  matrixResults: Array<{ status: 'passed' | 'failed' | 'not_supported' }>;
}

interface DecisionReadinessInput {
  expectedMatrix: ValidationMatrixTarget[];
  matrixResults: Array<
    Pick<ValidationMatrixResult, 'os' | 'client' | 'telemetrySeen' | 'cleanupSucceeded'>
  >;
}

export function summarizeDecisionReadiness(
  validation: DecisionReadinessInput
): { telemetryComplete: boolean; cleanupComplete: boolean } {
  const resultByTarget = new Map(
    validation.matrixResults.map((result) => [
      `${result.os}\u0000${result.client}`,
      result
    ])
  );
  const expectedResults = validation.expectedMatrix.map((target) =>
    resultByTarget.get(`${target.os}\u0000${target.client}`)
  );
  return {
    telemetryComplete:
      expectedResults.length > 0 &&
      expectedResults.every((result) => result?.telemetrySeen === true),
    cleanupComplete:
      expectedResults.length > 0 &&
      expectedResults.every((result) => result?.cleanupSucceeded === true)
  };
}

export function summarizeReviewValidation(validation: ValidationSummaryInput): {
  passed: number;
  failed: number;
  notSupported: number;
  missing: number;
  total: number;
} {
  let passed = 0;
  let failed = 0;
  let notSupported = 0;
  for (const result of validation.matrixResults) {
    if (result.status === 'passed') passed += 1;
    else if (result.status === 'failed') failed += 1;
    else notSupported += 1;
  }
  const total = validation.expectedMatrix.length;
  return {
    passed,
    failed,
    notSupported,
    missing: Math.max(total - validation.matrixResults.length, 0),
    total
  };
}
