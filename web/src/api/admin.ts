// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { request } from './client.js';
import type {
  AuditFilters,
  AuditPage,
  GrantRoleInput,
  PackageVersionSummary,
  RevokeRoleInput,
  RoleAssignment,
  RoleAssignmentPage,
  ReviewerCandidate,
  ReviewerCandidatePage,
  ReviewerAssignment,
  ReviewerAssignmentInput,
  ReviewerAssignmentPage
} from './types.js';

export function buildReviewerPath(id?: string): string {
  return id
    ? `/api/admin/reviewers/${encodeURIComponent(id)}`
    : '/api/admin/reviewers';
}

export function buildReviewerAssignmentPayload(
  input: ReviewerAssignmentInput
): ReviewerAssignmentInput {
  return {
    reviewerUid: input.reviewerUid.trim(),
    packageType: input.packageType.trim(),
    category: input.category.trim()
  };
}

export async function fetchReviewerAssignments(
  signal: AbortSignal
): Promise<ReviewerAssignment[]> {
  const page = await request<ReviewerAssignmentPage>(buildReviewerPath(), {
    signal
  });
  return page.items;
}

export function buildUserRolesPath(uid: string): string {
  return `/api/admin/roles?uid=${encodeURIComponent(uid)}`;
}

/**
 * 查詢單一使用者的有效角色。
 *
 * 後端的 uid 是必填，沒有「列出全平台角色指派」的端點——因此角色管理
 * 一次只能針對一位使用者，做不出總覽。
 */
export async function fetchUserRoles(
  uid: string,
  signal?: AbortSignal
): Promise<RoleAssignment[]> {
  const page = await request<RoleAssignmentPage>(buildUserRolesPath(uid), {
    method: 'GET',
    ...(signal ? { signal } : {})
  });
  return page.items;
}

export async function grantRole(input: GrantRoleInput): Promise<RoleAssignment> {
  return request<RoleAssignment>('/api/admin/roles', {
    method: 'POST',
    body: input
  });
}

/**
 * 撤銷角色。後端只收 uid 與 role，會一次撤銷該角色的全部範圍並回傳筆數。
 * 權限收斂後每個角色最多一筆，因此實務上就是移除單一指派。
 */
export async function revokeRole(input: RevokeRoleInput): Promise<number> {
  const result = await request<{ revoked: number }>('/api/admin/roles', {
    method: 'DELETE',
    body: input
  });
  return result.revoked;
}

export async function fetchReviewerCandidates(
  signal: AbortSignal
): Promise<ReviewerCandidate[]> {
  const page = await request<ReviewerCandidatePage>(
    '/api/admin/reviewer-candidates',
    { signal }
  );
  return page.items;
}

export async function assignReviewer(
  input: ReviewerAssignmentInput
): Promise<ReviewerAssignment> {
  return request<ReviewerAssignment>(buildReviewerPath(), {
    method: 'POST',
    body: buildReviewerAssignmentPayload(input)
  });
}

export async function revokeReviewer(id: string): Promise<ReviewerAssignment> {
  return request<ReviewerAssignment>(buildReviewerPath(id), {
    method: 'DELETE'
  });
}

export function buildVersionGovernancePath(
  packageId: string,
  version: string,
  action: 'deprecate' | 'delist' | 'emergency-disable'
): string {
  return `/api/packages/${encodeURIComponent(packageId)}/versions/${encodeURIComponent(version)}/${action}`;
}

interface GovernanceReason {
  reasonCode: string;
  reasonDetail?: string;
}

export function buildVersionDelistPayload(
  input: GovernanceReason,
  now = new Date()
): GovernanceReason & { effectiveAt: string } {
  const detail = input.reasonDetail?.trim();
  return {
    reasonCode: input.reasonCode.trim(),
    ...(detail ? { reasonDetail: detail } : {}),
    effectiveAt: now.toISOString()
  };
}

export function buildEmergencyDisablePayload(
  input: GovernanceReason
): GovernanceReason {
  const detail = input.reasonDetail?.trim();
  return {
    reasonCode: input.reasonCode.trim(),
    ...(detail ? { reasonDetail: detail } : {})
  };
}

/**
 * 棄用的 payload 與撤下、緊急停用不同形狀：後端只收單一 reason，
 * 沒有 reasonCode 與 effectiveAt。送錯形狀會被 additionalProperties: false 擋下。
 */
export function buildDeprecatePayload(reason: string): { reason?: string } {
  const trimmed = reason.trim();
  return trimmed ? { reason: trimmed } : {};
}

export async function deprecateVersion(
  packageId: string,
  version: string,
  reason: string
): Promise<PackageVersionSummary> {
  return request<PackageVersionSummary>(
    buildVersionGovernancePath(packageId, version, 'deprecate'),
    { method: 'POST', body: buildDeprecatePayload(reason) }
  );
}

/**
 * 撤下與緊急停用的回應把版本包在 { version, delisting, notifications } 裡，
 * 棄用則直接回傳版本本身。此處統一取出版本，讓三者對呼叫端形狀一致——
 * 否則呼叫端讀 result.lifecycle 會得到 undefined。
 */
interface DelistResponse {
  version: PackageVersionSummary;
}

export async function delistVersion(
  packageId: string,
  version: string,
  reason: GovernanceReason
): Promise<PackageVersionSummary> {
  const result = await request<DelistResponse>(
    buildVersionGovernancePath(packageId, version, 'delist'),
    { method: 'POST', body: buildVersionDelistPayload(reason) }
  );
  return result.version;
}

export async function emergencyDisableVersion(
  packageId: string,
  version: string,
  reason: GovernanceReason
): Promise<PackageVersionSummary> {
  const result = await request<DelistResponse>(
    buildVersionGovernancePath(packageId, version, 'emergency-disable'),
    { method: 'POST', body: buildEmergencyDisablePayload(reason) }
  );
  return result.version;
}

export function buildAuditLogsPath(filters: AuditFilters): string {
  const params = new URLSearchParams();
  const textFilters = ['eventType', 'actorUid'] as const;
  for (const key of textFilters) {
    const value = filters[key]?.trim();
    if (value) params.set(key, value);
  }
  if (filters.targetType) params.set('targetType', filters.targetType);
  if (filters.targetId?.trim()) params.set('targetId', filters.targetId.trim());
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (filters.cursor) params.set('cursor', filters.cursor);
  params.set('limit', '50');
  return `/api/audit/logs?${params.toString()}`;
}

export async function fetchAuditLogs(
  filters: AuditFilters,
  signal: AbortSignal
): Promise<AuditPage> {
  return request<AuditPage>(buildAuditLogsPath(filters), { signal });
}
