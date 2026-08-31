// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { request } from './client.js';
import type {
  CopyScriptTargetRevisionInput,
  CreatePackageInput,
  CreatePackageVersionInput,
  CreateScriptTargetInput,
  MaintainedPackageResult,
  MaintainedScope,
  PackageSummary,
  PackageVersionSummary,
  SaveScriptTargetRevisionInput,
  ScriptTargetRecord,
  ScriptTargetRevision
} from './types.js';

/**
 * 有維護權限的技能，含尚無已發布版本者。
 *
 * 不能改用 searchPackages：那個端點只回傳有 published 版本的套件，
 * 剛建立的技能不會出現，使用者無從為它填寫第一個版本。
 */
export function fetchMaintainedPackages(
  options: { scope?: MaintainedScope; cursor?: string },
  signal?: AbortSignal
): Promise<MaintainedPackageResult> {
  const params = new URLSearchParams();
  if (options.scope) params.set('scope', options.scope);
  if (options.cursor) params.set('cursor', options.cursor);
  const query = params.size > 0 ? `?${params}` : '';
  return request<MaintainedPackageResult>(`/api/packages/mine${query}`, {
    method: 'GET', ...(signal ? { signal } : {})
  });
}

export function createPackage(input: CreatePackageInput): Promise<PackageSummary> {
  return request<PackageSummary>('/api/packages', { method: 'POST', body: input });
}

export function buildPackageVersionsPath(packageId: string): string {
  return `/api/packages/${encodeURIComponent(packageId)}/versions`;
}

export function buildPackageVersionPath(packageId: string, version: string): string {
  return `${buildPackageVersionsPath(packageId)}/${encodeURIComponent(version)}`;
}

export function buildSubmitReviewPath(packageId: string, version: string): string {
  return `${buildPackageVersionPath(packageId, version)}/submit-review`;
}

export function buildScriptTargetsPath(packageId: string, version: string): string {
  return `${buildPackageVersionPath(packageId, version)}/script-targets`;
}

export function buildScriptTargetPath(packageId: string, version: string, targetId: string): string {
  return `${buildScriptTargetsPath(packageId, version)}/${encodeURIComponent(targetId)}`;
}

export function buildRevisionHistoryPath(packageId: string, version: string, targetId: string): string {
  return `${buildScriptTargetPath(packageId, version, targetId)}/revisions`;
}

export function createPackageVersion(packageId: string, input: CreatePackageVersionInput): Promise<PackageVersionSummary> {
  return request<PackageVersionSummary>(buildPackageVersionsPath(packageId), { method: 'POST', body: input });
}

export function fetchPackageVersion(packageId: string, version: string, signal?: AbortSignal): Promise<PackageVersionSummary> {
  return request<PackageVersionSummary>(buildPackageVersionPath(packageId, version), {
    method: 'GET', ...(signal ? { signal } : {})
  });
}

export function createScriptTarget(packageId: string, version: string, input: CreateScriptTargetInput): Promise<ScriptTargetRecord> {
  return request<ScriptTargetRecord>(buildScriptTargetsPath(packageId, version), { method: 'POST', body: input });
}

export function saveScriptTargetRevision(packageId: string, version: string, targetId: string, input: SaveScriptTargetRevisionInput): Promise<ScriptTargetRecord> {
  return request<ScriptTargetRecord>(buildScriptTargetPath(packageId, version, targetId), { method: 'PUT', body: input });
}

export function copyScriptTargetRevision(packageId: string, version: string, targetId: string, input: CopyScriptTargetRevisionInput): Promise<ScriptTargetRecord> {
  return request<ScriptTargetRecord>(`${buildScriptTargetPath(packageId, version, targetId)}/copy-from`, { method: 'POST', body: input });
}

export function deleteScriptTarget(packageId: string, version: string, targetId: string, expectedScriptVersion: number): Promise<ScriptTargetRecord> {
  return request<ScriptTargetRecord>(buildScriptTargetPath(packageId, version, targetId), { method: 'DELETE', body: { expectedScriptVersion } });
}

export function fetchScriptTargetRevisions(packageId: string, version: string, targetId: string): Promise<ScriptTargetRevision[]> {
  return request<ScriptTargetRevision[]>(buildRevisionHistoryPath(packageId, version, targetId), { method: 'GET' });
}

export function submitVersionReview(packageId: string, version: string): Promise<unknown> {
  return request(buildSubmitReviewPath(packageId, version), { method: 'POST', body: {} });
}
