// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { request } from './client.js';
import type { IdentityRoleName, Viewer } from './types.js';

export async function fetchViewer(signal: AbortSignal): Promise<Viewer> {
  return request<Viewer>('/api/auth/me', { signal });
}

export async function logout(): Promise<void> {
  await request<{ loggedOut: boolean }>('/api/auth/logout', { method: 'POST' });
}

/**
 * 登入是整頁轉導而非 fetch：後端會把瀏覽器送往 IdP 的授權頁，
 * 該轉導無法在 XHR 中完成。
 */
export function buildLoginUrl(returnTo: string): string {
  const safeReturnTo =
    returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/';
  return `/api/auth/login?returnTo=${encodeURIComponent(safeReturnTo)}`;
}

export function startLogin(returnTo: string): void {
  window.location.assign(buildLoginUrl(returnTo));
}

export function isAuthenticated(
  viewer: Viewer | undefined
): viewer is Extract<Viewer, { kind: 'authenticated' }> {
  return viewer?.kind === 'authenticated';
}

/**
 * 角色判斷只看角色本身，不看範圍：導覽入口的可見性是粗粒度的，
 * 真正的授權判定一律在後端按範圍執行。前端隱藏入口只是減少無效點擊，
 * 不構成安全邊界。
 */
export function hasRole(viewer: Viewer | undefined, role: IdentityRoleName): boolean {
  return isAuthenticated(viewer) && viewer.roles.some((entry) => entry.role === role);
}

export function isPlatformAdmin(viewer: Viewer | undefined): boolean {
  return hasRole(viewer, 'platform_admin');
}

/** 審核入口對審核人與平台管理員開放，後者可審所有範圍。 */
export function canReview(viewer: Viewer | undefined): boolean {
  return hasRole(viewer, 'reviewer') || isPlatformAdmin(viewer);
}

const ROLE_LABELS: Record<IdentityRoleName, string> = {
  employee: '一般員工',
  maintainer: '維護者',
  reviewer: '審核人',
  platform_admin: '平台管理員'
};

export function roleLabel(role: IdentityRoleName): string {
  return ROLE_LABELS[role] ?? role;
}

const SCOPE_LABELS: Record<string, string> = {
  global: '全平台',
  team: '團隊',
  package_type: '套件類型',
  category: '分類',
  package: '單一套件'
};

export function scopeLabel(scopeType: string, scopeValue: string): string {
  const label = SCOPE_LABELS[scopeType] ?? scopeType;
  return scopeValue ? `${label}：${scopeValue}` : label;
}
