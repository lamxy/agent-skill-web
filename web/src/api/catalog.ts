// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { request } from './client.js';
import type {
  GeneratedScript,
  PackageDetail,
  PackageGrade,
  PackageRecordSummary,
  ScriptAction,
  ScriptTarget,
  SearchFilters,
  SearchResult
} from './types.js';

function toQueryString(filters: SearchFilters): string {
  const params = new URLSearchParams();

  // 只送出有值的參數：後端 schema 為 additionalProperties: false，
  // 空字串會被當成有效值而過濾掉全部結果。
  if (filters.keyword?.trim()) params.set('keyword', filters.keyword.trim());
  if (filters.category) params.set('category', filters.category);
  if (filters.categoryCode) params.set('categoryCode', filters.categoryCode);
  if (filters.grade) params.set('grade', filters.grade);
  if (filters.source) params.set('source', filters.source);
  if (filters.client) params.set('client', filters.client);
  if (filters.os) params.set('os', filters.os);
  if (filters.cursor) params.set('cursor', filters.cursor);
  if (filters.limit !== undefined) params.set('limit', String(filters.limit));
  if (filters.sort) params.set('sort', filters.sort);

  const query = params.toString();
  return query ? `?${query}` : '';
}

export async function searchPackages(
  filters: SearchFilters,
  signal: AbortSignal
): Promise<SearchResult> {
  return request<SearchResult>(`/api/packages${toQueryString(filters)}`, {
    signal
  });
}

export async function fetchPackageDetail(
  packageId: string,
  signal: AbortSignal
): Promise<PackageDetail> {
  return request<PackageDetail>(
    `/api/packages/${encodeURIComponent(packageId)}`,
    { signal }
  );
}

export function buildPackageGradePath(packageId: string): string {
  return `/api/packages/${encodeURIComponent(packageId)}/grade`;
}

/**
 * 核定技能分級。只有審核人可呼叫，維護者會收到 403。
 * 與審核決議分開：改分級是發布後的常態操作，不需要重新送審。
 */
export function setPackageGrade(
  packageId: string,
  grade: PackageGrade
): Promise<PackageRecordSummary> {
  return request<PackageRecordSummary>(buildPackageGradePath(packageId), {
    method: 'PATCH',
    body: { grade }
  });
}

/**
 * 生成一鍵安裝腳本。後端會校驗目標是否在該版本聲明的支援清單內，
 * 不符回 409，因此呼叫端須先依詳情資料過濾可選項。
 */
export async function generateScript(
  packageId: string,
  version: string,
  target: ScriptTarget,
  action: ScriptAction = 'install'
): Promise<GeneratedScript> {
  return request<GeneratedScript>(
    `/api/packages/${encodeURIComponent(packageId)}/versions/${encodeURIComponent(version)}/scripts`,
    { method: 'POST', body: buildScriptRequestBody(target, action) }
  );
}

export function buildScriptRequestBody(
  target: ScriptTarget,
  action: ScriptAction
): ScriptTarget & { action: ScriptAction } {
  return { ...target, action };
}
