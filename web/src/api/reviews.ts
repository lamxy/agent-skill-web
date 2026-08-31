// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { request } from './client.js';
import type {
  ReviewDecisionResult,
  ReviewFilters,
  ReviewSearchResult,
  ReviewWorkbench
} from './types.js';

export const REVIEW_PAGE_SIZE = 20;

export function buildReviewsPath(filters: ReviewFilters): string {
  const query = new URLSearchParams({ status: filters.status });
  if (filters.os) query.set('os', filters.os);
  if (filters.client) query.set('client', filters.client);
  if (filters.cursor) query.set('cursor', filters.cursor);
  query.set('limit', String(REVIEW_PAGE_SIZE));
  return `/api/reviews?${query.toString()}`;
}

export function fetchReviews(
  filters: ReviewFilters,
  signal: AbortSignal
): Promise<ReviewSearchResult> {
  return request<ReviewSearchResult>(buildReviewsPath(filters), { signal });
}

export type ReviewDecision = 'approve' | 'reject';

export function buildReviewDetailPath(reviewId: string): string {
  return `/api/reviews/${encodeURIComponent(reviewId)}`;
}

export function buildReviewDecisionPath(
  reviewId: string,
  decision: ReviewDecision
): string {
  return `${buildReviewDetailPath(reviewId)}/${decision}`;
}

export function fetchReview(
  reviewId: string,
  signal: AbortSignal
): Promise<ReviewWorkbench> {
  return request<ReviewWorkbench>(buildReviewDetailPath(reviewId), { signal });
}

export function decideReview(
  reviewId: string,
  decision: ReviewDecision,
  reason: string
): Promise<ReviewDecisionResult> {
  return request<ReviewDecisionResult>(buildReviewDecisionPath(reviewId, decision), {
    method: 'POST',
    body: { reason: reason.trim() }
  });
}
