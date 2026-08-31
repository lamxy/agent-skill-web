// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { randomUUID } from 'node:crypto';

import type { IdentityRepository } from './repository.js';
import type {
  AssignReviewerInput,
  IdentityRecord,
  PackageAuthorizationSnapshot,
  ReviewerAssignment,
  Role,
  RoleAssignment,
  RoleScope,
  RoleScopeType
} from './types.js';
import { AppError } from '../../shared/errors/app-error.js';

function scopeMatches(assignment: RoleAssignment, requested: RoleScope): boolean {
  if (assignment.scopeType === 'global') {
    return true;
  }
  return (
    assignment.scopeType === requested.type &&
    assignment.scopeValue === (requested.value ?? '')
  );
}

export class AuthorizationService {
  constructor(
    private readonly repository: IdentityRepository,
    private readonly clock: () => Date = () => new Date()
  ) {}

  async hasRole(
    uid: string,
    role: Role,
    scope: RoleScope
  ): Promise<boolean> {
    const assignments = await this.repository.listActiveRoles(uid);
    return assignments.some(
      (assignment) =>
        assignment.role === role && scopeMatches(assignment, scope)
    );
  }

  async canReview(uid: string, packageId: string): Promise<boolean> {
    const [identity, packageSnapshot] = await Promise.all([
      this.repository.findIdentity(uid),
      this.repository.findPackageSnapshot(packageId)
    ]);
    if (!packageSnapshot) {
      return false;
    }
    return this.canReviewPackageSnapshot(uid, packageSnapshot, identity);
  }

  async canReviewPackageSnapshot(
    uid: string,
    packageSnapshot: PackageAuthorizationSnapshot,
    knownIdentity?: Awaited<ReturnType<IdentityRepository['findIdentity']>>
  ): Promise<boolean> {
    const identity = knownIdentity ?? await this.repository.findIdentity(uid);
    if (!identity?.active) return false;
    if (await this.hasRole(uid, 'platform_admin', { type: 'global' })) {
      return true;
    }
    /*
     * 有 reviewer 角色即可審核全部技能。
     *
     * 原本另以 reviewer_assignments 的「類型＋分類」限縮範圍，已停止採用：
     * category 是自由文字（實際資料同時存在 backend 與 後端、DBA 與 部署），
     * 拿沒有約束的欄位當權限條件，結果是指派了卻匹配不到任何技能。
     *
     * 同團隊限制也一併移除。獨立性由作者迴避保證——送審者不得審自己送的版本，
     * 該判斷在 governance-service.ts 的 listReviews 與審核決議處。
     */
    return this.hasRole(uid, 'reviewer', { type: 'global' });
  }

  async assignReviewer(
    actorUid: string,
    input: AssignReviewerInput
  ): Promise<ReviewerAssignment> {
    await this.requirePlatformAdmin(actorUid);
    const reviewer = await this.repository.findIdentity(input.reviewerUid);
    if (!reviewer?.active) {
      throw new AppError({
        statusCode: 404,
        code: 'REVIEWER_NOT_FOUND',
        message: '找不到可用的審核人身份'
      });
    }

    const assignment = await this.repository.assignReviewer(
      actorUid,
      input,
      this.clock()
    );

    // 審核範圍與 reviewer 角色分屬兩張表，但對管理員而言「指派審核人」
    // 就是一件事。只寫範圍會讓對方拿到範圍卻沒有角色，審核入口不顯示，
    // 指派形同無效且介面不會提示——因此在此一併補齊角色。
    await this.ensureReviewerRole(input.reviewerUid, actorUid);

    return assignment;
  }

  private async ensureReviewerRole(
    uid: string,
    assignedByUid: string
  ): Promise<void> {
    if (await this.hasRole(uid, 'reviewer', { type: 'global' })) {
      return;
    }
    await this.repository.grantRole({
      id: randomUUID(),
      uid,
      role: 'reviewer',
      // 角色本身是全域的，實際可審範圍由 reviewer_assignments 決定。
      scopeType: 'global',
      scopeValue: '',
      assignedByUid,
      active: true,
      createdAt: this.clock()
    });
  }

  async listReviewerAssignments(
    actorUid: string
  ): Promise<ReviewerAssignment[]> {
    await this.requirePlatformAdmin(actorUid);
    return this.repository.listActiveReviewerAssignments();
  }

  async listReviewerCandidates(actorUid: string): Promise<IdentityRecord[]> {
    await this.requirePlatformAdmin(actorUid);
    return this.repository.listActiveIdentities();
  }

  async revokeReviewer(
    actorUid: string,
    id: string
  ): Promise<ReviewerAssignment | undefined> {
    await this.requirePlatformAdmin(actorUid);
    const revoked = await this.repository.revokeReviewer(
      actorUid,
      id,
      this.clock()
    );
    if (!revoked) {
      return undefined;
    }

    // 撤銷最後一個範圍後仍保留 reviewer 角色，會讓對方看到審核入口
    // 卻永遠是空清單。角色與範圍同進同出。
    const remaining = await this.repository.listActiveReviewerAssignments();
    const stillAssigned = remaining.some(
      (assignment) => assignment.reviewerUid === revoked.reviewerUid
    );
    if (!stillAssigned) {
      await this.repository.revokeRole(
        revoked.reviewerUid,
        'reviewer',
        this.clock()
      );
    }

    return revoked;
  }

  /**
   * 由平台管理員授予角色。
   *
   * 不開放授予 platform_admin：管理員資格只能經 BOOTSTRAP_ADMIN_UID 產生，
   * 避免任一管理員在介面上無限擴增管理員而繞過部署層的控制。要新增管理員
   * 請改環境變數，該路徑有日誌留痕。
   */
  async grantRole(
    actorUid: string,
    input: {
      uid: string;
      role: Role;
      scopeType: RoleScopeType;
      scopeValue?: string;
    }
  ): Promise<RoleAssignment> {
    await this.requirePlatformAdmin(actorUid);

    if (input.role === 'platform_admin') {
      throw new AppError({
        statusCode: 403,
        code: 'ROLE_NOT_GRANTABLE',
        message: '平台管理員只能由部署設定指定，不可在介面授予'
      });
    }

    const target = await this.repository.findIdentity(input.uid);
    if (!target?.active) {
      throw new AppError({
        statusCode: 404,
        code: 'IDENTITY_NOT_FOUND',
        message: '找不到可用的身份'
      });
    }

    const scopeValue = input.scopeValue?.trim() ?? '';
    // 資料庫的 CHECK 約束同樣要求 global 不帶值、其餘必須帶值；
    // 在此先擋下可得到明確錯誤訊息，而非資料庫層的約束違反。
    if (input.scopeType === 'global' && scopeValue) {
      throw new AppError({
        statusCode: 400,
        code: 'ROLE_SCOPE_INVALID',
        message: '全平台範圍不得指定範圍值'
      });
    }
    if (input.scopeType !== 'global' && !scopeValue) {
      throw new AppError({
        statusCode: 400,
        code: 'ROLE_SCOPE_INVALID',
        message: '此範圍類型必須指定範圍值'
      });
    }

    return this.repository.grantRole({
      id: randomUUID(),
      uid: input.uid,
      role: input.role,
      scopeType: input.scopeType,
      scopeValue,
      assignedByUid: actorUid,
      active: true,
      createdAt: this.clock()
    });
  }

  async listRoleAssignments(
    actorUid: string,
    uid: string
  ): Promise<RoleAssignment[]> {
    await this.requirePlatformAdmin(actorUid);
    return this.repository.listActiveRoles(uid);
  }

  /**
   * 呼叫者自己被授予某角色的 team scope 清單。
   *
   * 與 hasRole 的差別：hasRole 對 global scope 一律回真，因此無法回答
   * 「這個人具體被綁在哪些 team 上」。需要按 team 逐一判斷、又不希望
   * 全域身分一次命中全部時使用。
   *
   * 查自己的授予不需額外授權——呼叫者本來就能從行為推知自己的權限。
   */
  async listOwnScopedTeams(uid: string, role: Role): Promise<Set<string>> {
    const assignments = await this.repository.listActiveRoles(uid);
    return new Set(
      assignments
        .filter(
          (assignment) =>
            assignment.role === role && assignment.scopeType === 'team'
        )
        .map((assignment) => assignment.scopeValue)
    );
  }

  /**
   * 撤銷角色。不允許撤銷 platform_admin：與授予同理，且撤銷最後一位
   * 管理員會讓平台永久失去授權能力。
   */
  async revokeRoleAssignment(
    actorUid: string,
    input: { uid: string; role: Role }
  ): Promise<number> {
    await this.requirePlatformAdmin(actorUid);

    if (input.role === 'platform_admin') {
      throw new AppError({
        statusCode: 403,
        code: 'ROLE_NOT_REVOCABLE',
        message: '平台管理員不可在介面撤銷'
      });
    }

    return this.repository.revokeRole(input.uid, input.role, this.clock());
  }

  async grantDevelopmentAdmin(uid: string): Promise<RoleAssignment> {
    return this.grantPlatformAdmin(uid, 'development-bootstrap');
  }

  /**
   * 授予首位平台管理員。授予角色本身需要 platform_admin，正式環境
   * 因此需要這條 bootstrap 路徑，否則 SSO 接通後仍無人能指派審核人。
   *
   * 只在該 uid 尚無 platform_admin 時授予，因此可安全地在每次登入時呼叫；
   * 管理員被撤銷後重新登入會再次取得，這是刻意的——否則撤銷最後一位
   * 管理員會讓平台永久失去授權能力。
   */
  async grantBootstrapAdmin(uid: string): Promise<RoleAssignment | undefined> {
    if (await this.hasRole(uid, 'platform_admin', { type: 'global' })) {
      return undefined;
    }
    return this.grantPlatformAdmin(uid, 'bootstrap');
  }

  private async grantPlatformAdmin(
    uid: string,
    assignedByUid: string
  ): Promise<RoleAssignment> {
    return this.repository.grantRole({
      id: randomUUID(),
      uid,
      role: 'platform_admin',
      scopeType: 'global',
      scopeValue: '',
      // 與人為授予區分：稽核時可看出這是系統依配置自動授予。
      assignedByUid,
      active: true,
      createdAt: this.clock()
    });
  }

  private async requirePlatformAdmin(uid: string): Promise<void> {
    if (!(await this.hasRole(uid, 'platform_admin', { type: 'global' }))) {
      throw new AppError({
        statusCode: 403,
        code: 'FORBIDDEN',
        message: '沒有執行此操作的權限'
      });
    }
  }
}
