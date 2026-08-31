// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { describe, expect, it } from 'vitest';

import { buildUserRolesPath } from '../../web/src/api/admin.js';
import type { RoleAssignment } from '../../web/src/api/types.js';
import {
  GRANTABLE_ROLES,
  availableRolesToGrant,
  describeRoleFailure,
  grantableRoleMeta,
  manageableRoles,
  readOnlyRoles
} from '../../web/src/pages/admin-model.js';

function assignment(
  role: RoleAssignment['role'],
  overrides: Partial<RoleAssignment> = {}
): RoleAssignment {
  return {
    id: `role-${role}`,
    uid: 'user-1',
    role,
    scopeType: 'global',
    scopeValue: '',
    assignedByUid: 'admin-1',
    active: true,
    createdAt: '2026-08-29T00:00:00.000Z',
    ...overrides
  };
}

describe('可授予的角色', () => {
  it('只有 maintainer 與 reviewer', () => {
    // employee 不列入：沒有角色即視為員工，授予它不會多任何權限。
    expect(GRANTABLE_ROLES.map((item) => item.role)).toEqual([
      'maintainer',
      'reviewer'
    ]);
  });

  it('不提供 platform_admin', () => {
    expect(GRANTABLE_ROLES.map((item) => item.role)).not.toContain(
      'platform_admin'
    );
  });

  it('每個角色都說明撤銷後還剩下什麼', () => {
    // 只講「失去什麼」會讓管理員以為撤銷後這個人什麼都不能做了。
    for (const meta of GRANTABLE_ROLES) {
      expect(meta.revokeEffect.length).toBeGreaterThan(0);
    }
    expect(grantableRoleMeta('maintainer')?.revokeEffect).toContain('自己團隊');
  });
});

describe('已授予的角色不重複出現在下拉', () => {
  it('沒有任何角色時兩種都可授予', () => {
    expect(availableRolesToGrant([]).map((item) => item.role)).toEqual([
      'maintainer',
      'reviewer'
    ]);
  });

  it('已有 maintainer 時只剩 reviewer', () => {
    /*
     * 後端重複授予是冪等的（onConflictDoNothing 後回傳既有列），不會報錯，
     * 因此排除已授予的角色純粹是為了讓下拉只呈現有意義的選項——
     * 送出一個什麼都不會改變的請求，對管理員是沒有回饋的空操作。
     */
    const available = availableRolesToGrant([assignment('maintainer')]);

    expect(available.map((item) => item.role)).toEqual(['reviewer']);
  });

  it('兩種都有時清單為空', () => {
    expect(
      availableRolesToGrant([assignment('maintainer'), assignment('reviewer')])
    ).toEqual([]);
  });

  it('platform_admin 不影響可授予的角色', () => {
    const available = availableRolesToGrant([assignment('platform_admin')]);

    expect(available.map((item) => item.role)).toEqual([
      'maintainer',
      'reviewer'
    ]);
  });
});

describe('角色清單分為可管理與唯讀', () => {
  it('只有 maintainer 與 reviewer 可在此頁撤銷', () => {
    const all = [
      assignment('maintainer'),
      assignment('reviewer'),
      assignment('platform_admin'),
      assignment('employee')
    ];

    expect(manageableRoles(all).map((item) => item.role)).toEqual([
      'maintainer',
      'reviewer'
    ]);
  });

  it('platform_admin 另外唯讀呈現而非隱藏', () => {
    /*
     * 混進可撤銷清單會讓管理員以為點得動；完全不顯示又會讓人
     * 誤以為這個人沒有權限。
     */
    const all = [assignment('maintainer'), assignment('platform_admin')];

    expect(readOnlyRoles(all).map((item) => item.role)).toEqual([
      'platform_admin'
    ]);
  });

  it('employee 既不可管理也不唯讀顯示', () => {
    // 它不代表任何權限，顯示出來只會造成困惑。
    const all = [assignment('employee')];

    expect(manageableRoles(all)).toEqual([]);
    expect(readOnlyRoles(all)).toEqual([]);
  });
});

describe('查詢路徑', () => {
  it('uid 經過編碼', () => {
    expect(buildUserRolesPath('user 1')).toBe('/api/admin/roles?uid=user%201');
  });
});

describe('錯誤訊息轉為可行動的說明', () => {
  it('身份不存在時指引重新選擇', () => {
    expect(describeRoleFailure(new Error('找不到可用的身份'))).toContain(
      '重新選擇'
    );
  });

  it('嘗試操作 platform_admin 時說明原因', () => {
    expect(
      describeRoleFailure(new Error('平台管理員只能由部署設定指定，不可在介面授予'))
    ).toContain('部署設定');
  });

  it('權限不足時說明只有管理員可以', () => {
    expect(describeRoleFailure(new Error('沒有執行此操作的權限'))).toContain(
      '平台管理員'
    );
  });

  it('非 Error 值有可讀的回退訊息', () => {
    expect(describeRoleFailure(undefined)).toBe('角色操作失敗，請稍後再試。');
  });
});
