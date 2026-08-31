// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { request } from './client.js';
import type {
  FeedbackIssueCategory,
  FeedbackRecord,
  FeedbackStatus,
  FeedbackSummary,
  SubmitFeedbackInput,
  SupportChannel,
  SupportChannelContent,
  VersionDiff
} from './types.js';

interface ItemsResponse<T> {
  items: T[];
  state: 'empty' | 'success';
}

export async function fetchVersionDiff(
  packageId: string,
  currentVersion: string,
  targetVersion: string,
  signal: AbortSignal
): Promise<VersionDiff> {
  return request<VersionDiff>(
    `/api/packages/${encodeURIComponent(packageId)}/versions/${encodeURIComponent(currentVersion)}/diff/${encodeURIComponent(targetVersion)}`,
    { signal }
  );
}

export async function fetchSupportChannels(
  packageId: string,
  signal: AbortSignal
): Promise<SupportChannel[]> {
  const response = await request<ItemsResponse<SupportChannel>>(
    `/api/packages/${encodeURIComponent(packageId)}/support-channels`,
    { signal }
  );
  return response.items;
}

/**
 * 整組覆寫：送出的清單即為完整結果，未列出的既有渠道會被刪除。
 * 呼叫端必須送出完整清單，不能只送異動項。
 */
export async function saveSupportChannels(
  packageId: string,
  channels: SupportChannelContent[]
): Promise<SupportChannel[]> {
  const response = await request<ItemsResponse<SupportChannel>>(
    `/api/packages/${encodeURIComponent(packageId)}/support-channels`,
    { method: 'PUT', body: { channels } }
  );
  return response.items;
}

export async function submitFeedback(
  packageId: string,
  input: SubmitFeedbackInput
): Promise<FeedbackRecord> {
  return request<FeedbackRecord>(
    `/api/packages/${encodeURIComponent(packageId)}/feedback`,
    { method: 'POST', body: input }
  );
}

export interface FeedbackQuery {
  version?: string;
  issueCategory?: FeedbackIssueCategory;
  needsHumanSupport?: boolean;
  status?: FeedbackStatus;
}

export function buildFeedbackPath(
  packageId: string,
  query: FeedbackQuery
): string {
  const params = new URLSearchParams();
  if (query.version) params.set('version', query.version);
  if (query.issueCategory) params.set('issueCategory', query.issueCategory);
  if (query.needsHumanSupport !== undefined) {
    params.set('needsHumanSupport', String(query.needsHumanSupport));
  }
  if (query.status) params.set('status', query.status);
  const search = params.toString();
  return `/api/packages/${encodeURIComponent(packageId)}/feedback${search ? `?${search}` : ''}`;
}

export async function fetchFeedback(
  packageId: string,
  query: FeedbackQuery,
  signal: AbortSignal
): Promise<FeedbackRecord[]> {
  const response = await request<ItemsResponse<FeedbackRecord>>(
    buildFeedbackPath(packageId, query),
    { signal }
  );
  return response.items;
}

export async function fetchFeedbackSummary(
  packageId: string,
  signal: AbortSignal
): Promise<FeedbackSummary> {
  return request<FeedbackSummary>(
    `/api/packages/${encodeURIComponent(packageId)}/feedback/summary`,
    { signal }
  );
}

export async function updateFeedbackStatus(
  feedbackId: string,
  status: FeedbackStatus
): Promise<FeedbackRecord> {
  return request<FeedbackRecord>(
    `/api/feedback/${encodeURIComponent(feedbackId)}`,
    { method: 'PATCH', body: { status } }
  );
}
