// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { describe, expect, it } from 'vitest';

import { AuditService } from '../../src/modules/audit/audit-service.js';
import { MemoryAuditRepository } from '../../src/modules/audit/memory-audit-repository.js';
import { AuthorizationService } from '../../src/modules/identity/authorization-service.js';
import { MemoryIdentityRepository } from '../../src/modules/identity/memory-identity-repository.js';
import type {
  IdentityRecord,
  PackageAuthorizationSnapshot,
  RoleAssignment
} from '../../src/modules/identity/types.js';
import { AppError } from '../../src/shared/errors/app-error.js';

const now = new Date('2026-08-25T00:00:00.000Z');

function identity(
  uid: string,
  teamIds: string[] = []
): IdentityRecord {
  return {
    uid,
    displayName: uid,
    teamIds,
    providerType: 'development',
    active: true,
    createdAt: now,
    updatedAt: now
  };
}

function role(
  uid: string,
  roleName: RoleAssignment['role'],
  scopeType: RoleAssignment['scopeType'],
  scopeValue = ''
): RoleAssignment {
  return {
    id: `${uid}-${roleName}-${scopeType}-${scopeValue}`,
    uid,
    role: roleName,
    scopeType,
    scopeValue,
    assignedByUid: 'bootstrap',
    active: true,
    createdAt: now
  };
}

function packageSnapshot(
  ownerTeam: string
): PackageAuthorizationSnapshot {
  return {
    packageId: 'pkg-1',
    ownerTeam,
    packageType: 'skill',
    category: 'frontend'
  };
}

describe('AuthorizationService', () => {
  it('同一 UID 可疊加角色且全域作用域覆蓋具體作用域', async () => {
    const repository = new MemoryIdentityRepository({
      identities: [identity('user-1')],
      roles: [
        role('user-1', 'employee', 'global'),
        role('user-1', 'reviewer', 'category', 'frontend')
      ]
    });
    const service = new AuthorizationService(repository);

    await expect(
      service.hasRole('user-1', 'employee', {
        type: 'package',
        value: 'pkg-1'
      })
    ).resolves.toBe(true);
    await expect(
      service.hasRole('user-1', 'reviewer', {
        type: 'category',
        value: 'frontend'
      })
    ).resolves.toBe(true);
    await expect(
      service.hasRole('user-1', 'maintainer', { type: 'global' })
    ).resolves.toBe(false);
  });

  it('同團隊的審核人也可以審核——獨立性改由作者迴避保證', async () => {
    /*
     * 收斂前同團隊一律擋下。改為只擋作者本人：擋團隊會讓小團隊無人可審，
     * 而作者迴避已足以避免自己審自己。作者迴避在 governance-service 實施。
     */
    const repository = new MemoryIdentityRepository({
      identities: [identity('reviewer-1', ['team-a'])],
      packages: [packageSnapshot('team-a')],
      roles: [role('reviewer-1', 'reviewer', 'global')]
    });
    const service = new AuthorizationService(repository);

    await expect(service.canReview('reviewer-1', 'pkg-1')).resolves.toBe(
      true
    );
  });

  it('有 reviewer 角色即可審核，不需要另外指派範圍', async () => {
    const repository = new MemoryIdentityRepository({
      identities: [identity('reviewer-1', ['team-b'])],
      packages: [packageSnapshot('team-a')],
      roles: [role('reviewer-1', 'reviewer', 'global')]
    });
    const service = new AuthorizationService(repository);

    await expect(service.canReview('reviewer-1', 'pkg-1')).resolves.toBe(
      true
    );
  });

  it('非平臺管理員不能新增審核人指派', async () => {
    const repository = new MemoryIdentityRepository({
      identities: [identity('employee-1'), identity('reviewer-1')],
      roles: [role('employee-1', 'employee', 'global')]
    });
    const service = new AuthorizationService(repository);

    const operation = service.assignReviewer('employee-1', {
      reviewerUid: 'reviewer-1',
      packageType: 'skill',
      category: 'frontend'
    });

    await expect(operation).rejects.toMatchObject({
      statusCode: 403,
      code: 'FORBIDDEN'
    } satisfies Partial<AppError>);
  });

  it('只有審核範圍而沒有 reviewer 角色時不能審核', async () => {
    /*
     * 收斂後權限判斷不再讀 reviewer_assignments。這條負向斷言確保
     * 舊資料不會因為殘留的範圍指派而意外取得審核權。
     */
    const repository = new MemoryIdentityRepository({
      identities: [identity('reviewer-1', ['team-b'])],
      packages: [packageSnapshot('team-a')],
      reviewerAssignments: [
        {
          id: '123e4567-e89b-42d3-a456-426614174001',
          reviewerUid: 'reviewer-1',
          packageType: 'skill',
          category: 'frontend',
          assignedByUid: 'admin-1',
          active: true,
          createdAt: now
        }
      ]
    });
    const service = new AuthorizationService(repository);

    await expect(service.canReview('reviewer-1', 'pkg-1')).resolves.toBe(false);
  });

  it('沒有任何角色的員工不能審核', async () => {
    const repository = new MemoryIdentityRepository({
      identities: [identity('employee-2', ['team-b'])],
      packages: [packageSnapshot('team-a')]
    });
    const service = new AuthorizationService(repository);

    await expect(service.canReview('employee-2', 'pkg-1')).resolves.toBe(false);
  });

  it('平臺管理員可新增及冪等撤銷審核人指派', async () => {
    const auditRepository = new MemoryAuditRepository();
    const repository = new MemoryIdentityRepository({
      identities: [identity('admin-1'), identity('reviewer-1')],
      roles: [role('admin-1', 'platform_admin', 'global')],
      auditRepository
    });
    const service = new AuthorizationService(repository);

    const assignment = await service.assignReviewer('admin-1', {
      reviewerUid: 'reviewer-1',
      packageType: 'skill',
      category: 'frontend'
    });
    const firstRevocation = await service.revokeReviewer(
      'admin-1',
      assignment.id
    );
    const secondRevocation = await service.revokeReviewer(
      'admin-1',
      assignment.id
    );

    expect(assignment.active).toBe(true);
    expect(firstRevocation?.active).toBe(false);
    expect(secondRevocation).toEqual(firstRevocation);
    expect(repository.domainEvents.map((event) => event.eventType)).toEqual([
      'reviewer.assigned',
      'reviewer.revoked'
    ]);
    await expect(
      new AuditService(auditRepository).list({
        actorUid: 'admin-1',
        limit: 10
      })
    ).resolves.toMatchObject({
      items: [
        { eventType: 'reviewer.revoked' },
        { eventType: 'reviewer.assigned' }
      ]
    });
  });

  it('全域平臺管理員可讀取有效審核人指派', async () => {
    const repository = new MemoryIdentityRepository({
      roles: [role('admin-1', 'platform_admin', 'global')],
      reviewerAssignments: [
        {
          id: '123e4567-e89b-42d3-a456-426614174001',
          reviewerUid: 'reviewer-1',
          packageType: 'skill',
          category: 'frontend',
          assignedByUid: 'admin-1',
          active: true,
          createdAt: now
        }
      ]
    });
    const service = new AuthorizationService(repository);

    await expect(service.listReviewerAssignments('admin-1')).resolves.toEqual([
      expect.objectContaining({
        id: '123e4567-e89b-42d3-a456-426614174001',
        active: true
      })
    ]);
  });

  it('非全域的平臺管理員不能讀取審核人指派', async () => {
    const repository = new MemoryIdentityRepository({
      roles: [role('scoped-admin', 'platform_admin', 'category', 'frontend')]
    });
    const service = new AuthorizationService(repository);

    await expect(
      service.listReviewerAssignments('scoped-admin')
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'FORBIDDEN'
    } satisfies Partial<AppError>);
  });
});

describe('審核範圍與 reviewer 角色同進同出', () => {
  function createService() {
    const repository = new MemoryIdentityRepository({
      identities: [identity('admin-1'), identity('reviewer-1')],
      roles: [role('admin-1', 'platform_admin', 'global')]
    });
    return { repository, service: new AuthorizationService(repository) };
  }

  it('指派審核範圍時一併授予 reviewer 角色', async () => {
    const { repository, service } = createService();

    // 指派前沒有任何角色：審核入口不會顯示。
    expect(await repository.listActiveRoles('reviewer-1')).toEqual([]);

    await service.assignReviewer('admin-1', {
      reviewerUid: 'reviewer-1',
      packageType: 'tool',
      category: 'DBA'
    });

    const roles = await repository.listActiveRoles('reviewer-1');
    expect(roles).toHaveLength(1);
    expect(roles[0]).toMatchObject({
      role: 'reviewer',
      scopeType: 'global',
      assignedByUid: 'admin-1'
    });
  });

  it('多次指派不重複授予角色', async () => {
    const { repository, service } = createService();

    await service.assignReviewer('admin-1', {
      reviewerUid: 'reviewer-1',
      packageType: 'tool',
      category: 'DBA'
    });
    await service.assignReviewer('admin-1', {
      reviewerUid: 'reviewer-1',
      packageType: 'skill',
      category: '通用'
    });

    expect(await repository.listActiveRoles('reviewer-1')).toHaveLength(1);
  });

  it('仍有其他範圍時保留角色', async () => {
    const { repository, service } = createService();

    const first = await service.assignReviewer('admin-1', {
      reviewerUid: 'reviewer-1',
      packageType: 'tool',
      category: 'DBA'
    });
    await service.assignReviewer('admin-1', {
      reviewerUid: 'reviewer-1',
      packageType: 'skill',
      category: '通用'
    });
    await service.revokeReviewer('admin-1', first.id);

    expect(await repository.listActiveRoles('reviewer-1')).toHaveLength(1);
  });

  it('撤銷最後一個範圍時一併撤銷角色', async () => {
    const { repository, service } = createService();

    const assignment = await service.assignReviewer('admin-1', {
      reviewerUid: 'reviewer-1',
      packageType: 'tool',
      category: 'DBA'
    });
    await service.revokeReviewer('admin-1', assignment.id);

    // 否則對方看得到審核入口，但清單永遠是空的。
    expect(await repository.listActiveRoles('reviewer-1')).toEqual([]);
  });

  it('重複撤銷不影響其他人的角色', async () => {
    const repository = new MemoryIdentityRepository({
      identities: [
        identity('admin-1'),
        identity('reviewer-1'),
        identity('reviewer-2')
      ],
      roles: [role('admin-1', 'platform_admin', 'global')]
    });
    const service = new AuthorizationService(repository);

    const first = await service.assignReviewer('admin-1', {
      reviewerUid: 'reviewer-1',
      packageType: 'tool',
      category: 'DBA'
    });
    await service.assignReviewer('admin-1', {
      reviewerUid: 'reviewer-2',
      packageType: 'tool',
      category: 'DBA'
    });

    await service.revokeReviewer('admin-1', first.id);
    await service.revokeReviewer('admin-1', first.id);

    expect(await repository.listActiveRoles('reviewer-1')).toEqual([]);
    expect(await repository.listActiveRoles('reviewer-2')).toHaveLength(1);
  });

  it('授予的 reviewer 角色不帶管理權限', async () => {
    const { service } = createService();

    await service.assignReviewer('admin-1', {
      reviewerUid: 'reviewer-1',
      packageType: 'tool',
      category: 'DBA'
    });

    await expect(
      service.assignReviewer('reviewer-1', {
        reviewerUid: 'reviewer-1',
        packageType: 'skill',
        category: '通用'
      })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('角色授予與撤銷', () => {
  function createService() {
    const repository = new MemoryIdentityRepository({
      identities: [
        identity('admin-1'),
        identity('member-1', ['資料庫平台'])
      ],
      roles: [role('admin-1', 'platform_admin', 'global')]
    });
    return { repository, service: new AuthorizationService(repository) };
  }

  it('管理員可授予 maintainer 並帶團隊範圍', async () => {
    const { service } = createService();

    const assignment = await service.grantRole('admin-1', {
      uid: 'member-1',
      role: 'maintainer',
      scopeType: 'team',
      scopeValue: '資料庫平台'
    });

    expect(assignment).toMatchObject({
      uid: 'member-1',
      role: 'maintainer',
      scopeType: 'team',
      scopeValue: '資料庫平台',
      assignedByUid: 'admin-1',
      active: true
    });
  });

  it('不得授予 platform_admin：管理員只能由部署設定產生', async () => {
    const { service } = createService();

    await expect(
      service.grantRole('admin-1', {
        uid: 'member-1',
        role: 'platform_admin',
        scopeType: 'global'
      })
    ).rejects.toMatchObject({ code: 'ROLE_NOT_GRANTABLE', statusCode: 403 });
  });

  it('不得撤銷 platform_admin：撤銷最後一位會讓平台失去授權能力', async () => {
    const { service } = createService();

    await expect(
      service.revokeRoleAssignment('admin-1', {
        uid: 'admin-1',
        role: 'platform_admin'
      })
    ).rejects.toMatchObject({ code: 'ROLE_NOT_REVOCABLE' });
  });

  it('非管理員不得授予任何角色', async () => {
    const { service } = createService();

    await expect(
      service.grantRole('member-1', {
        uid: 'member-1',
        role: 'maintainer',
        scopeType: 'global'
      })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('拒絕不存在的身份', async () => {
    const { service } = createService();

    await expect(
      service.grantRole('admin-1', {
        uid: '查無此人',
        role: 'maintainer',
        scopeType: 'global'
      })
    ).rejects.toMatchObject({ code: 'IDENTITY_NOT_FOUND', statusCode: 404 });
  });

  it('global 範圍不得帶範圍值', async () => {
    const { service } = createService();

    await expect(
      service.grantRole('admin-1', {
        uid: 'member-1',
        role: 'maintainer',
        scopeType: 'global',
        scopeValue: '資料庫平台'
      })
    ).rejects.toMatchObject({ code: 'ROLE_SCOPE_INVALID' });
  });

  it('非 global 範圍必須帶範圍值', async () => {
    const { service } = createService();

    for (const scopeValue of [undefined, '', '   ']) {
      await expect(
        service.grantRole('admin-1', {
          uid: 'member-1',
          role: 'maintainer',
          scopeType: 'team',
          ...(scopeValue === undefined ? {} : { scopeValue })
        })
      ).rejects.toMatchObject({ code: 'ROLE_SCOPE_INVALID' });
    }
  });

  it('撤銷後該角色不再生效，其他角色保留', async () => {
    const { repository, service } = createService();

    await service.grantRole('admin-1', {
      uid: 'member-1',
      role: 'maintainer',
      scopeType: 'global'
    });
    await service.grantRole('admin-1', {
      uid: 'member-1',
      role: 'employee',
      scopeType: 'global'
    });

    const revoked = await service.revokeRoleAssignment('admin-1', {
      uid: 'member-1',
      role: 'maintainer'
    });

    expect(revoked).toBe(1);
    const remaining = await repository.listActiveRoles('member-1');
    expect(remaining.map((entry) => entry.role)).toEqual(['employee']);
  });

  it('授予的 maintainer 實際可通過權限判定', async () => {
    const { service } = createService();

    await service.grantRole('admin-1', {
      uid: 'member-1',
      role: 'maintainer',
      scopeType: 'team',
      scopeValue: '資料庫平台'
    });

    expect(
      await service.hasRole('member-1', 'maintainer', {
        type: 'team',
        value: '資料庫平台'
      })
    ).toBe(true);
    // 範圍之外不生效
    expect(
      await service.hasRole('member-1', 'maintainer', {
        type: 'team',
        value: 'SRE'
      })
    ).toBe(false);
  });
});
