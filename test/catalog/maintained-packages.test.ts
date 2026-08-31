// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { describe, expect, it } from 'vitest';

import { CatalogService } from '../../src/modules/catalog/catalog-service.js';
import { MemoryCatalogRepository } from '../../src/modules/catalog/memory-catalog-repository.js';
import { AuthorizationService } from '../../src/modules/identity/authorization-service.js';
import { MemoryIdentityRepository } from '../../src/modules/identity/memory-identity-repository.js';
import type { PackageRecord, PackageVersionRecord } from '../../src/modules/catalog/types.js';
import type { ResolvedIdentity } from '../../src/modules/identity/types.js';
import type { RoleAssignment } from '../../src/modules/identity/types.js';

const now = new Date('2026-08-29T00:00:00.000Z');

const anonymous: ResolvedIdentity = {
  kind: 'anonymous',
  anonymousId: '123e4567-e89b-42d3-a456-426614174000',
  isNew: false
};

/** team-a 的維護者。teamIds 與角色範圍都限於 team-a */
const teamMaintainer: ResolvedIdentity = {
  kind: 'authenticated',
  uid: 'maintainer-1',
  displayName: '維護者一',
  teamIds: ['team-a']
};

const admin: ResolvedIdentity = {
  kind: 'authenticated',
  uid: 'admin-1',
  displayName: '管理員',
  teamIds: ['team-a']
};

/** 沒有任何 maintainer 角色的一般員工 */
const employee: ResolvedIdentity = {
  kind: 'authenticated',
  uid: 'employee-1',
  displayName: '員工一',
  teamIds: ['team-a']
};

function pkg(
  packageId: string,
  ownerTeam: string,
  overrides: Partial<PackageRecord> = {}
): PackageRecord {
  return {
    packageId,
    type: 'skill',
    name: packageId,
    purpose: '用途',
    ownerTeam,
    category: 'backend',
    categoryCode: 'backend',
    visibility: 'internal',
    sourceUri: `https://example.invalid/${packageId}`,
    license: 'MIT',
    source: 'custom',
    publisher: { kind: 'organization', name: '平台組' },
    grade: 'basic',
    lifecycle: 'active',
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function version(
  packageId: string,
  versionNumber: string,
  lifecycle: PackageVersionRecord['lifecycle']
): PackageVersionRecord {
  return {
    id: `${packageId}-${versionNumber}`,
    packageId,
    version: versionNumber,
    supportedOs: ['linux'],
    supportedClients: [],
    lifecycle,
    installCommand: 'true',
    uninstallCommand: 'true',
    hasResidualEffects: false,
    authorUid: 'maintainer-1',
    createdAt: now,
    updatedAt: now
  };
}

function role(uid: string, scopeType: 'team' | 'global', scopeValue: string, roleName: 'maintainer' | 'platform_admin'): RoleAssignment {
  return {
    id: `role-${uid}-${roleName}-${scopeValue || 'global'}`,
    uid,
    role: roleName,
    scopeType,
    scopeValue,
    assignedByUid: 'bootstrap',
    active: true,
    createdAt: now
  };
}

function createService() {
  const catalog = new MemoryCatalogRepository({
    packages: [
      // 有已發布版本，team-a，且由 maintainer-1 自己建立
      pkg('published-skill', 'team-a', {
        updatedAt: new Date('2026-08-29T03:00:00.000Z'),
        createdByUid: 'maintainer-1'
      }),
      // 只有草稿版本，team-a——技能池看不到，維護清單必須看得到
      pkg('draft-skill', 'team-a', { updatedAt: new Date('2026-08-29T02:00:00.000Z') }),
      // 完全沒有版本，team-a——剛建立的技能
      pkg('empty-skill', 'team-a', { updatedAt: new Date('2026-08-29T01:00:00.000Z') }),
      // 別的 team
      pkg('other-team-skill', 'team-b'),
      // 已封存，不能再建立版本
      pkg('archived-skill', 'team-a', { lifecycle: 'archived' })
    ],
    versions: [
      version('published-skill', '1.0.0', 'published'),
      version('published-skill', '1.1.0', 'draft'),
      version('draft-skill', '0.1.0', 'draft'),
      version('other-team-skill', '1.0.0', 'published'),
      version('archived-skill', '1.0.0', 'published')
    ]
  });
  const identities = new MemoryIdentityRepository({
    identities: [
      { uid: 'maintainer-1', displayName: '維護者一', teamIds: ['team-a'], providerType: 'development', active: true, createdAt: now, updatedAt: now },
      { uid: 'admin-1', displayName: '管理員', teamIds: ['team-a'], providerType: 'development', active: true, createdAt: now, updatedAt: now },
      { uid: 'employee-1', displayName: '員工一', teamIds: ['team-a'], providerType: 'development', active: true, createdAt: now, updatedAt: now }
    ],
    roles: [
      role('maintainer-1', 'team', 'team-a', 'maintainer'),
      role('admin-1', 'global', '', 'platform_admin')
    ]
  });
  return new CatalogService(catalog, new AuthorizationService(identities));
}

describe('維護清單列出可操作的套件', () => {
  it('未登入時拒絕，不以空清單掩蓋', async () => {
    // 回空清單會讓前端顯示「你還沒有技能」，與「請先登入」是不同意思。
    await expect(createService().listMaintainedPackages({}, anonymous)).rejects.toThrow(
      '請先登入'
    );
  });

  it('team 維護者看到自己 team 的套件', async () => {
    const result = await createService().listMaintainedPackages({}, teamMaintainer);

    expect(result.items.map((item) => item.packageId)).toEqual([
      'published-skill',
      'draft-skill',
      'empty-skill'
    ]);
  });

  it('列出只有草稿版本的套件——技能池看不到它們', async () => {
    const result = await createService().listMaintainedPackages({}, teamMaintainer);
    const draft = result.items.find((item) => item.packageId === 'draft-skill');

    expect(draft?.hasPublishedVersion).toBe(false);
    expect(draft?.latestVersion?.version).toBe('0.1.0');
  });

  it('列出完全沒有版本的套件，latestVersion 缺席', async () => {
    // 這是建立技能後的第一個狀態；漏掉它就等於漏掉了整個死結。
    const result = await createService().listMaintainedPackages({}, teamMaintainer);
    const empty = result.items.find((item) => item.packageId === 'empty-skill');

    expect(empty).toBeDefined();
    expect(empty?.latestVersion).toBeUndefined();
    expect(empty?.versionCount).toBe(0);
    expect(empty?.hasPublishedVersion).toBe(false);
  });

  it('不列出其他 team 的套件', async () => {
    const result = await createService().listMaintainedPackages({}, teamMaintainer);

    expect(result.items.map((item) => item.packageId)).not.toContain('other-team-skill');
  });

  it('不列出已封存的套件——無法再建立版本', async () => {
    const result = await createService().listMaintainedPackages({}, teamMaintainer);

    expect(result.items.map((item) => item.packageId)).not.toContain('archived-skill');
  });

  it('沒有任何角色的員工也能維護自己團隊的技能', async () => {
    /*
     * 權限收斂：技能是團隊資產，同團隊即可維護，不需 maintainer 角色。
     * 此清單必須與 requireMaintainer 一致，否則會列出點進去才發現
     * 不能操作的套件，或反過來藏起使用者其實能維護的套件。
     */
    const result = await createService().listMaintainedPackages({}, employee);

    expect(result.items.map((item) => item.packageId)).toEqual([
      'published-skill',
      'draft-skill',
      'empty-skill'
    ]);
  });

  it('員工看不到別團隊的技能', async () => {
    const outsider = {
      kind: 'authenticated' as const,
      uid: 'outsider-1',
      displayName: '外部團隊員工',
      teamIds: ['team-z']
    };

    const result = await createService().listMaintainedPackages({}, outsider);

    expect(result.items).toEqual([]);
    expect(result.state).toBe('empty');
  });

  it('最近更新的排在前面', async () => {
    const result = await createService().listMaintainedPackages({}, teamMaintainer);

    expect(result.items[0]?.packageId).toBe('published-skill');
  });

  it('已發布與草稿並存時取語意版本最新者', async () => {
    const result = await createService().listMaintainedPackages({}, teamMaintainer);
    const published = result.items.find((item) => item.packageId === 'published-skill');

    expect(published?.latestVersion?.version).toBe('1.1.0');
    expect(published?.hasPublishedVersion).toBe(true);
    expect(published?.versionCount).toBe(2);
  });
});

describe('顯示全部的切換權限', () => {
  it('team 維護者不能切換', async () => {
    const result = await createService().listMaintainedPackages({}, teamMaintainer);

    expect(result.canIncludeAllTeams).toBe(false);
  });

  it('team 維護者傳 includeAllTeams 也拿不到其他 team 的套件', async () => {
    // 前端可以送任何參數，權限必須由伺服器判斷。
    const result = await createService().listMaintainedPackages(
      { includeAllTeams: true },
      teamMaintainer
    );

    expect(result.items.map((item) => item.packageId)).not.toContain('other-team-skill');
  });

  it('管理員可以切換，但預設只看自己 team', async () => {
    const result = await createService().listMaintainedPackages({}, admin);

    expect(result.canIncludeAllTeams).toBe(true);
    expect(result.items.map((item) => item.packageId)).not.toContain('other-team-skill');
  });

  it('管理員開啟後看到全部 team 的套件', async () => {
    const result = await createService().listMaintainedPackages(
      { includeAllTeams: true },
      admin
    );

    expect(result.items.map((item) => item.packageId)).toContain('other-team-skill');
  });

  it('管理員開啟後仍不列出已封存的套件', async () => {
    const result = await createService().listMaintainedPackages(
      { includeAllTeams: true },
      admin
    );

    expect(result.items.map((item) => item.packageId)).not.toContain('archived-skill');
  });
});

/*
 * 三個範圍逐層擴大：mine ⊂ team ⊂ all，對應頁面上的三個 tab。
 * team 等同 scope 參數存在之前的預設行為，因此上方既有案例都不需改寫。
 */
describe('維護清單的三種範圍', () => {
  it('mine 只列出自己建立的技能', async () => {
    const result = await createService().listMaintainedPackages(
      { scope: 'mine' },
      teamMaintainer
    );

    expect(result.items.map((item) => item.packageId)).toEqual(['published-skill']);
    expect(result.scope).toBe('mine');
  });

  it('team 涵蓋 mine，且包含同 team 但非自己建立的技能', async () => {
    const result = await createService().listMaintainedPackages(
      { scope: 'team' },
      teamMaintainer
    );
    const ids = result.items.map((item) => item.packageId);

    expect(ids).toContain('published-skill');
    expect(ids).toContain('draft-skill');
    expect(ids).not.toContain('other-team-skill');
  });

  it('未指定 scope 時預設為 team，維持既有行為', async () => {
    const result = await createService().listMaintainedPackages({}, teamMaintainer);

    expect(result.scope).toBe('team');
  });

  it('無權者要求 all 時退回 team，不報錯也不越權', async () => {
    // 前端可以送任何值，權限一律由伺服器判定。
    const result = await createService().listMaintainedPackages(
      { scope: 'all' },
      teamMaintainer
    );

    expect(result.scope).toBe('team');
    expect(result.items.map((item) => item.packageId)).not.toContain('other-team-skill');
  });

  it('管理員的 all 涵蓋其他 team', async () => {
    const result = await createService().listMaintainedPackages({ scope: 'all' }, admin);

    expect(result.scope).toBe('all');
    expect(result.items.map((item) => item.packageId)).toContain('other-team-skill');
  });

  /*
   * 分頁在權限過濾之後做，游標是排序後清單中的位置。
   * 這批測試資料不足一頁，正好覆蓋「只有一頁」的邊界。
   */
  it('資料不足一頁時不給下一頁游標，並回報總筆數', async () => {
    const result = await createService().listMaintainedPackages({ scope: 'all' }, admin);

    expect(result.nextCursor).toBeUndefined();
    expect(result.totalCount).toBe(result.items.length);
  });

  it('游標超出範圍時回空清單，不報錯', async () => {
    // 資料在兩次請求之間變少時會走到這條路徑。
    const result = await createService().listMaintainedPackages(
      { scope: 'all', cursor: '999' },
      admin
    );

    expect(result.items).toEqual([]);
    expect(result.nextCursor).toBeUndefined();
  });

  it('無效游標視為第一頁，不讓壞參數清空清單', async () => {
    const result = await createService().listMaintainedPackages(
      { scope: 'all', cursor: 'not-a-number' },
      admin
    );

    expect(result.items.length).toBeGreaterThan(0);
  });

  it('scope 與 includeAllTeams 同時出現時以 scope 為準', async () => {
    const result = await createService().listMaintainedPackages(
      { scope: 'mine', includeAllTeams: true },
      admin
    );

    expect(result.scope).toBe('mine');
    expect(result.items.map((item) => item.packageId)).not.toContain('other-team-skill');
  });
});
