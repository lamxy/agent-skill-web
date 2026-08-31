// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import type {
  GrantableRole,
  MyInstallation,
  PackageType,
  ReviewerCandidate,
  RoleAssignment,
  VersionLifecycle
} from '../api/types.js';

export type InstallationFilter = 'all' | 'upgrade' | 'current';

export interface GrantableRoleMeta {
  role: GrantableRole;
  label: string;
  /** 下拉選項的一行說明，講清楚授予後多了什麼 */
  summary: string;
  /** 撤銷確認框的內容，必須說明「還剩下什麼」而不只是「失去什麼」 */
  revokeEffect: string;
}

/**
 * 可在介面授予的角色。
 *
 * 權限收斂後兩者都是全平台生效，因此不再有範圍選擇。
 * employee 不列入：沒有任何角色即視為員工，授予它不會多任何權限，
 * 列出來只會讓管理員以為「不授予就沒權限」。
 */
export const GRANTABLE_ROLES: GrantableRoleMeta[] = [
  {
    role: 'maintainer',
    label: 'maintainer',
    summary: '可更新所有技能，含其他團隊的',
    revokeEffect:
      '撤銷後他仍可維護自己團隊的技能，但無法再更新其他團隊的技能。'
  },
  {
    role: 'reviewer',
    label: 'reviewer',
    summary: '可審核所有技能，除自己送審的',
    revokeEffect: '撤銷後他將無法再審核任何版本，審核工作台會變成空的。'
  }
];

export function grantableRoleMeta(role: GrantableRole): GrantableRoleMeta | undefined {
  return GRANTABLE_ROLES.find((item) => item.role === role);
}

/**
 * 角色清單只呈現可在此頁管理的角色。
 *
 * platform_admin 會出現在後端回傳中（bootstrap 授予），但此頁不能撤銷它，
 * 混在可撤銷的角色裡會讓管理員以為點得動。employee 同理：它不代表任何權限。
 */
export function manageableRoles(assignments: RoleAssignment[]): RoleAssignment[] {
  return assignments.filter(
    (item) => item.role === 'maintainer' || item.role === 'reviewer'
  );
}

/** 後端回傳中此頁管不到、但仍需讓管理員知道其存在的角色 */
export function readOnlyRoles(assignments: RoleAssignment[]): RoleAssignment[] {
  return assignments.filter((item) => item.role === 'platform_admin');
}

/** 已授予的角色不應再出現在授予下拉中，避免送出必被 409 擋下的重複授予 */
export function availableRolesToGrant(
  assignments: RoleAssignment[]
): GrantableRoleMeta[] {
  const held = new Set(assignments.map((item) => item.role));
  return GRANTABLE_ROLES.filter((item) => !held.has(item.role));
}

export function describeRoleFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (/找不到可用的身份/.test(message)) {
    return '找不到這位使用者，或他的身份已停用。請從下拉重新選擇。';
  }
  if (/平台管理員/.test(message)) {
    return '平台管理員只能由部署設定指定，不能在此授予或撤銷。';
  }
  if (/權限/.test(message)) {
    return '你沒有管理角色的權限，只有平台管理員可以。';
  }
  return message || '角色操作失敗，請稍後再試。';
}

export type GovernanceAction = 'deprecate' | 'delist' | 'emergency-disable';

export interface GovernanceActionMeta {
  action: GovernanceAction;
  label: string;
  /** 執行後版本會進入的生命週期，與 version-state-machine 的對照表一致 */
  resultLifecycle: VersionLifecycle;
  /** 選項下方的一行說明，講清楚這個處置與其他兩者的差別 */
  hint: string;
  submitLabel: string;
  /** 為真時只有 platform_admin 能執行，後端會擋 */
  adminOnly: boolean;
  /** 為真時原因為必填，後端會擋空值 */
  reasonRequired: boolean;
}

/**
 * 三種下架處置。
 *
 * 對員工的效果完全相同：三者都會停止腳本生成，並讓版本從技能池消失。
 * 差別只在稽核語意與執行權限，因此文案必須說明「為什麼選這個」，
 * 而不是描述「會發生什麼」——後者三者一樣，寫了也無法幫助選擇。
 */
export const GOVERNANCE_ACTIONS: GovernanceActionMeta[] = [
  {
    action: 'deprecate',
    label: '標記棄用',
    resultLifecycle: 'deprecated',
    hint: '已有更好的替代版本，不建議繼續採用。原因選填。',
    submitLabel: '標記棄用',
    adminOnly: false,
    reasonRequired: false
  },
  {
    action: 'delist',
    label: '標準撤下',
    resultLifecycle: 'delisted',
    hint: '因政策或合規決定停止提供。立即生效，不支援排程。',
    submitLabel: '立即撤下版本',
    adminOnly: false,
    reasonRequired: true
  },
  {
    action: 'emergency-disable',
    label: '緊急停用',
    resultLifecycle: 'emergency_disabled',
    hint: '發現重大問題須立即阻斷。僅平台管理員可執行。',
    submitLabel: '緊急停用版本',
    adminOnly: true,
    reasonRequired: true
  }
];

export function governanceActionMeta(action: GovernanceAction): GovernanceActionMeta {
  const found = GOVERNANCE_ACTIONS.find((item) => item.action === action);
  if (!found) throw new Error(`未知的治理處置：${action}`);
  return found;
}

/**
 * 該版本目前可執行哪些處置，對照 version-state-machine 的轉換表。
 * 送出後才被 409 擋下，使用者已經填完整份表單，體驗遠差於事前停用。
 */
export function availableGovernanceActions(
  lifecycle: VersionLifecycle
): GovernanceAction[] {
  if (lifecycle === 'published') return ['deprecate', 'delist', 'emergency-disable'];
  if (lifecycle === 'deprecated') return ['delist', 'emergency-disable'];
  if (lifecycle === 'delisted') return ['emergency-disable'];
  return [];
}

/** 沒有任何可執行處置時，說明為什麼——不是「沒有權限」而是狀態已終結 */
export function governanceUnavailableReason(lifecycle: VersionLifecycle): string {
  if (lifecycle === 'emergency_disabled') {
    return '此版本已緊急停用，是最終狀態，不能再執行其他處置。';
  }
  return '只有已發布的版本需要下架處置。此版本尚未發布，或已回到草稿。';
}

interface GovernancePackageChoice {
  packageId: string;
  name: string;
  ownerTeam: string;
}

export function governancePackageOptions(
  packages: GovernancePackageChoice[]
): Array<{ value: string; label: string }> {
  return packages.map((item) => ({
    value: item.packageId,
    label: `${item.name} · ${item.packageId} · ${item.ownerTeam}`
  }));
}

export function reviewerCandidateOptions(
  candidates: ReviewerCandidate[]
): Array<{ value: string; label: string }> {
  return candidates.map((candidate) => ({
    value: candidate.uid,
    label: `${candidate.displayName} · ${candidate.uid} · ${candidate.teamIds.join('、') || '未分組'}`
  }));
}

export function reviewerScopeCategories(
  packages: Array<{ type: PackageType; category: string }>,
  packageType: PackageType
): string[] {
  return [...new Set(
    packages
      .filter((item) => item.type === packageType)
      .map((item) => item.category)
  )].sort((left, right) => left.localeCompare(right, 'zh-Hant'));
}

export function filterMyInstallations(
  installations: MyInstallation[],
  filter: InstallationFilter
): MyInstallation[] {
  if (filter === 'upgrade') {
    return installations.filter((item) => item.upgradeAvailable);
  }
  if (filter === 'current') {
    return installations.filter((item) => !item.upgradeAvailable);
  }
  return installations;
}

export function installationTargetPath(
  packageId: string,
  intent: 'install' | 'uninstall'
): string {
  const query = new URLSearchParams({ intent });
  return `/packages/${encodeURIComponent(packageId)}?${query.toString()}`;
}
