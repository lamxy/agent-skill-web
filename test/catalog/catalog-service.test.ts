// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { describe, expect, it } from 'vitest';

import { CatalogService } from '../../src/modules/catalog/catalog-service.js';
import { MemoryCatalogRepository } from '../../src/modules/catalog/memory-catalog-repository.js';
import { memoryVersionKey } from '../../src/modules/catalog/memory-platform-store.js';
import { AuthorizationService } from '../../src/modules/identity/authorization-service.js';
import { MemoryIdentityRepository } from '../../src/modules/identity/memory-identity-repository.js';
import type { ResolvedIdentity } from '../../src/modules/identity/types.js';

const anonymous: ResolvedIdentity = {
  kind: 'anonymous',
  anonymousId: '123e4567-e89b-42d3-a456-426614174000',
  isNew: false
};
const employee: ResolvedIdentity = {
  kind: 'authenticated',
  uid: 'employee-1',
  displayName: '員工一',
  teamIds: ['team-b', 'team-c']
};

function createService() {
  const now = new Date('2026-08-25T00:00:00.000Z');
  const catalog = new MemoryCatalogRepository({
    packages: [
      {
        packageId: 'public-skill',
        type: 'skill',
        name: '前端品質技能',
        purpose: '檢查前端品質',
        ownerTeam: 'team-a',
        category: 'frontend',
        visibility: 'public',
        sourceUri: 'https://example.invalid/public-skill',
        license: 'MIT',
        lifecycle: 'active',
        createdAt: now,
        updatedAt: now
      },
      {
        packageId: 'internal-tool',
        type: 'tool',
        name: '內部部署工具',
        purpose: '部署內部服務',
        ownerTeam: 'team-c',
        category: 'backend',
        visibility: 'internal',
        sourceUri: 'https://example.invalid/internal-tool',
        license: 'Apache-2.0',
        lifecycle: 'active',
        createdAt: now,
        updatedAt: now
      }
    ],
    versions: [
      {
        id: '1',
        packageId: 'public-skill',
        version: '1.0.0',
        releaseNotes: '首版',
        supportedOs: ['linux'],
        supportedClients: [
          {
            name: 'codex',
            version: '>=1',
            adaptationSource: 'publisher',
            maintainer: 'team-a'
          }
        ],
        lifecycle: 'published',
        scriptDigest: 'sha256:published',
        installCommand: 'install public',
        uninstallCommand: 'uninstall public',
        hasResidualEffects: false,
        authorUid: 'author-1',
        createdAt: now,
        updatedAt: now
      },
      {
        id: '2',
        packageId: 'public-skill',
        version: '1.1.0',
        releaseNotes: '待審',
        supportedOs: ['windows'],
        supportedClients: [
          {
            name: 'claude-code',
            adaptationSource: 'maintainer',
            maintainer: 'team-a'
          }
        ],
        lifecycle: 'review_required',
        installCommand: 'install pending',
        uninstallCommand: 'uninstall pending',
        hasResidualEffects: true,
        residualDescription: '留下設定檔',
        authorUid: 'author-1',
        createdAt: now,
        updatedAt: now
      },
      {
        id: '3',
        packageId: 'internal-tool',
        version: '2.0.0',
        supportedOs: ['linux'],
        supportedClients: [
          {
            name: 'codex',
            adaptationSource: 'publisher',
            maintainer: 'team-c'
          }
        ],
        lifecycle: 'published',
        installCommand: 'install internal',
        uninstallCommand: 'uninstall internal',
        hasResidualEffects: false,
        authorUid: 'employee-1',
        createdAt: now,
        updatedAt: now
      }
    ]
  });
  const identities = new MemoryIdentityRepository({
    identities: [
      {
        uid: 'employee-1',
        displayName: '員工一',
        teamIds: ['team-b', 'team-c'],
        providerType: 'development',
        active: true,
        createdAt: now,
        updatedAt: now
      },
      {
        uid: 'author-1',
        displayName: '作者一',
        teamIds: ['team-a'],
        providerType: 'development',
        active: true,
        createdAt: now,
        updatedAt: now
      }
    ],
    roles: [
      {
        id: '123e4567-e89b-42d3-a456-426614174088',
        uid: 'employee-1',
        role: 'maintainer',
        scopeType: 'team',
        scopeValue: 'team-c',
        assignedByUid: 'admin-1',
        active: true,
        createdAt: now
      },
      // 權限收斂後審核權來自 reviewer 角色，下方的範圍指派不再構成授權。
      {
        id: '123e4567-e89b-42d3-a456-426614174089',
        uid: 'employee-1',
        role: 'reviewer',
        scopeType: 'global',
        scopeValue: '',
        assignedByUid: 'admin-1',
        active: true,
        createdAt: now
      }
    ],
    packages: [
      {
        packageId: 'public-skill',
        ownerTeam: 'team-a',
        packageType: 'skill',
        category: 'frontend'
      }
    ],
    reviewerAssignments: [
      {
        id: '123e4567-e89b-42d3-a456-426614174099',
        reviewerUid: 'employee-1',
        packageType: 'skill',
        category: 'frontend',
        assignedByUid: 'admin-1',
        active: true,
        createdAt: now
      }
    ]
  });
  return new CatalogService(catalog, new AuthorizationService(identities));
}

describe('CatalogService', () => {
  it('匿名列表只包含 public 且具有 published 版本的套件', async () => {
    const result = await createService().search({}, anonymous);

    expect(result.items.map((item) => item.packageId)).toEqual([
      'public-skill'
    ]);
    expect(result.items[0]?.latestVersion.version).toBe('1.0.0');
  });

  it('登入使用者可搜尋 internal 並組合 Client、OS 與分類過濾', async () => {
    const result = await createService().search(
      {
        keyword: '部署',
        category: 'backend',
        client: 'codex',
        os: 'linux'
      },
      employee
    );

    expect(result.items.map((item) => item.packageId)).toEqual([
      'internal-tool'
    ]);
  });

  it('搜尋使用穩定 cursor 分頁並允許明確排序', async () => {
    const service = createService();
    const first = await service.search({ limit: 1, sort: 'name_asc' }, employee);
    if (!first.nextCursor) throw new Error('第一頁應提供下一頁游標');
    const second = await service.search(
      { limit: 1, sort: 'name_asc', cursor: first.nextCursor },
      employee
    );

    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).toBe('1');
    expect(second.items).toHaveLength(1);
    expect(second.items[0]?.packageId).not.toBe(first.items[0]?.packageId);
    expect(second.nextCursor).toBeUndefined();
  });

  it('列表與下載永遠不暴露 review_required 版本', async () => {
    const service = createService();
    const author: ResolvedIdentity = {
      kind: 'authenticated',
      uid: 'author-1',
      displayName: '作者一',
      teamIds: ['team-a']
    };

    const search = await service.search({}, author);
    const publicSkill = search.items.find(
      (item) => item.packageId === 'public-skill'
    );

    expect(publicSkill?.latestVersion.version).toBe('1.0.0');
    await expect(
      service.getDownload('public-skill', '1.1.0', author)
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'PACKAGE_VERSION_NOT_FOUND'
    });
  });

  it('待審版本只在詳情對作者或指定審核人可見', async () => {
    const service = createService();
    const author: ResolvedIdentity = {
      kind: 'authenticated',
      uid: 'author-1',
      displayName: '作者一',
      teamIds: ['team-a']
    };

    const anonymousDetail = await service.getDetail(
      'public-skill',
      anonymous
    );
    const authorDetail = await service.getDetail('public-skill', author);
    const reviewerDetail = await service.getDetail(
      'public-skill',
      employee
    );

    expect(anonymousDetail.versions.map((version) => version.version)).toEqual([
      '1.0.0'
    ]);
    expect(authorDetail.versions.map((version) => version.version)).toEqual([
      '1.1.0',
      '1.0.0'
    ]);
    expect(reviewerDetail.versions.map((version) => version.version)).toEqual([
      '1.1.0',
      '1.0.0'
    ]);
  });

  /*
   * 發布者由 ownerTeam 推導：技能屬團隊資產，維護權限綁團隊，
   * 讓前端再填一次同樣的資訊只會產生兩份可能不一致的資料。
   */
  it('未指定發布者時，從所屬團隊推導', async () => {
    const service = createService();

    const created = await service.createPackage(
      {
        packageId: 'derived-publisher',
        type: 'skill',
        name: '推導發布者',
        purpose: '驗證發布者由團隊推導',
        ownerTeam: 'team-c',
        category: 'backend',
        categoryCode: 'backend',
        visibility: 'internal',
        sourceUri: '',
        license: '',
        source: 'custom'
      },
      employee
    );

    expect(created.publisher).toEqual({ kind: 'organization', name: 'team-c' });
  });

  it('顯式指定發布者時以指定值為準', async () => {
    const service = createService();

    const created = await service.createPackage(
      {
        packageId: 'explicit-publisher',
        type: 'skill',
        name: '指定發布者',
        purpose: '驗證顯式發布者不被覆寫',
        ownerTeam: 'team-c',
        category: 'backend',
        categoryCode: 'backend',
        visibility: 'internal',
        sourceUri: '',
        license: '',
        source: 'custom',
        publisher: { kind: 'individual', name: '張三' }
      },
      employee
    );

    expect(created.publisher).toEqual({ kind: 'individual', name: '張三' });
  });

  it('團隊維護者建立版本固定為草稿且不能繞過治理更新生命週期', async () => {
    const service = createService();
    const created = await service.createPackage(
      {
        packageId: 'backend-observer',
        type: 'tool',
        name: '後端觀測工具',
        purpose: '觀測服務執行狀態',
        ownerTeam: 'team-c',
        category: 'backend',
        categoryCode: 'backend',
        visibility: 'internal',
        sourceUri: 'https://example.invalid/backend-observer',
        license: 'MIT',
        source: 'custom',
        publisher: { kind: 'organization', name: '平台組' }
      },
      employee
    );
    const version = await service.createVersion(
      created.packageId,
      {
        version: '0.1.0',
        releaseNotes: '第一版'
      },
      employee
    );
    await expect(service.updateVersion(
      created.packageId,
      version.version,
      { lifecycle: 'published' } as never,
      employee
    )).rejects.toMatchObject({
      statusCode: 400,
      code: 'LIFECYCLE_MANAGED_BY_GOVERNANCE'
    });
    const updated = await service.updateVersion(
      created.packageId,
      version.version,
      { scriptDigest: 'sha256:observer' },
      employee
    );

    expect(updated).toMatchObject({
      authorUid: 'employee-1',
      lifecycle: 'draft',
      scriptDigest: 'sha256:observer'
    });
  });

  it('維護者以空 draft 建立 target，revision 透過 CAS 遞增並可讀取歷史', async () => {
    const service = createService();
    const draft = await service.createVersion(
      'internal-tool',
      { version: '2.1.0', releaseNotes: 'Matrix draft' },
      employee
    );
    const pending = await service.createScriptTarget(
      'internal-tool',
      draft.version,
      { targetOs: 'wsl', clientRuntime: 'codex' },
      employee
    );
    const first = await service.saveScriptTargetRevision(
      'internal-tool',
      draft.version,
      pending.id,
      {
        expectedScriptVersion: 0,
        installCommand: 'install one',
        uninstallCommand: 'uninstall one',
        options: [],
        usageInstructions: '先下載再執行。',
        hasResidualEffects: false
      },
      employee
    );
    const second = await service.saveScriptTargetRevision(
      'internal-tool',
      draft.version,
      pending.id,
      {
        expectedScriptVersion: 1,
        installCommand: 'install two',
        uninstallCommand: 'uninstall two',
        options: [],
        usageInstructions: '先下載再執行。',
        hasResidualEffects: false
      },
      employee
    );
    const reloaded = await service.getVersion('internal-tool', draft.version, employee);
    const revisions = await service.getScriptTargetRevisions(
      'internal-tool', draft.version, pending.id, employee
    );

    expect(draft.scriptTargets).toEqual([]);
    expect(pending.currentRevision).toBeUndefined();
    expect(first.currentRevision?.scriptVersion).toBe(1);
    expect(second.currentRevision?.scriptVersion).toBe(2);
    expect(reloaded.scriptTargets?.[0]?.currentRevision?.installCommand).toBe('install two');
    expect(revisions.map((revision) => revision.scriptVersion)).toEqual([1, 2]);
  });

  it('target 寫入拒絕非維護者與不合法 options', async () => {
    const service = createService();
    const draft = await service.createVersion(
      'internal-tool', { version: '2.2.0' }, employee
    );
    const pending = await service.createScriptTarget(
      'internal-tool', draft.version,
      { targetOs: 'windows', clientRuntime: 'claude-code' }, employee
    );

    await expect(service.createScriptTarget(
      'internal-tool', draft.version,
      { targetOs: 'windows', clientRuntime: 'codex' }, anonymous
    )).rejects.toMatchObject({ statusCode: 401, code: 'AUTHENTICATION_REQUIRED' });
    await expect(service.saveScriptTargetRevision(
      'internal-tool', draft.version, pending.id,
      {
        expectedScriptVersion: 0,
        installCommand: 'install',
        uninstallCommand: 'uninstall',
        options: [
          { name: 'scope', type: 'text', description: '錯誤名稱', defaultValue: '' }
        ],
        usageInstructions: '使用說明',
        hasResidualEffects: false
      },
      employee
    )).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_SCRIPT_OPTIONS' });
  });

  it('memory target 寫入同步到共享 version snapshot 供治理流程讀取', async () => {
    const repository = new MemoryCatalogRepository();
    await repository.createPackage('maintainer-1', {
      packageId: 'shared-matrix', type: 'skill', name: 'Shared matrix',
      purpose: '共享治理快照', ownerTeam: 'platform', category: 'backend',
      categoryCode: 'backend', visibility: 'internal',
      sourceUri: 'https://example.invalid/shared', license: 'MIT',
      source: 'custom', publisher: { kind: 'organization', name: '平台組' }
    }, new Date('2026-08-28T00:00:00.000Z'));
    await repository.createVersion(
      'maintainer-1', 'shared-matrix', { version: '1.0.0' },
      new Date('2026-08-28T00:00:00.000Z')
    );
    const pending = await repository.createScriptTarget(
      'maintainer-1', 'shared-matrix', '1.0.0',
      { targetOs: 'wsl', clientRuntime: 'codex' },
      new Date('2026-08-28T01:00:00.000Z')
    );
    await repository.saveScriptTargetRevision(
      'maintainer-1', 'shared-matrix', '1.0.0', pending.id,
      {
        expectedScriptVersion: 0,
        installCommand: 'install shared',
        uninstallCommand: 'uninstall shared',
        options: [],
        usageInstructions: '執行共享腳本。',
        hasResidualEffects: false
      },
      new Date('2026-08-28T02:00:00.000Z')
    );

    const sharedVersion = repository.store.snapshot().versions[
      memoryVersionKey('shared-matrix', '1.0.0')
    ];
    expect(sharedVersion?.scriptTargets?.[0]?.currentRevision).toMatchObject({
      installCommand: 'install shared',
      scriptVersion: 1
    });
  });

  it('memory repository 在版本離開 draft 後拒絕 target mutation', async () => {
    const repository = new MemoryCatalogRepository();
    const occurredAt = new Date('2026-08-28T00:00:00.000Z');
    await repository.createPackage('maintainer-1', {
      packageId: 'memory-lifecycle', type: 'skill', name: 'Memory lifecycle',
      purpose: '驗證 repository lifecycle gate', ownerTeam: 'platform',
      category: 'backend', categoryCode: 'backend', visibility: 'internal',
      sourceUri: 'https://example.invalid/memory-lifecycle', license: 'MIT',
      source: 'custom', publisher: { kind: 'organization', name: '平台組' }
    }, occurredAt);
    await repository.createVersion(
      'maintainer-1', 'memory-lifecycle', { version: '1.0.0' }, occurredAt
    );
    const source = await repository.createScriptTarget(
      'maintainer-1', 'memory-lifecycle', '1.0.0',
      { targetOs: 'linux/macos', clientRuntime: 'codex' }, occurredAt
    );
    const destination = await repository.createScriptTarget(
      'maintainer-1', 'memory-lifecycle', '1.0.0',
      { targetOs: 'windows', clientRuntime: 'claude-code' }, occurredAt
    );
    await repository.saveScriptTargetRevision(
      'maintainer-1', 'memory-lifecycle', '1.0.0', source.id,
      {
        expectedScriptVersion: 0,
        installCommand: 'install memory',
        uninstallCommand: 'uninstall memory',
        options: [],
        usageInstructions: '執行 memory 腳本。',
        hasResidualEffects: false
      },
      occurredAt
    );
    const next = repository.store.snapshot();
    next.versions[memoryVersionKey('memory-lifecycle', '1.0.0')] = {
      ...next.versions[memoryVersionKey('memory-lifecycle', '1.0.0')]!,
      lifecycle: 'validating'
    };
    repository.store.replace(next);

    const mutations = [
      repository.createScriptTarget(
        'maintainer-1', 'memory-lifecycle', '1.0.0',
        { targetOs: 'wsl', clientRuntime: 'codex' }, occurredAt
      ),
      repository.saveScriptTargetRevision(
        'maintainer-1', 'memory-lifecycle', '1.0.0', source.id,
        {
          expectedScriptVersion: 1,
          installCommand: 'late install',
          uninstallCommand: 'late uninstall',
          options: [],
          usageInstructions: '不可寫入。',
          hasResidualEffects: false
        },
        occurredAt
      ),
      repository.copyScriptTargetRevision(
        'maintainer-1', 'memory-lifecycle', '1.0.0', destination.id,
        { sourceTargetId: source.id, expectedScriptVersion: 0 }, occurredAt
      ),
      repository.softDeleteScriptTarget(
        'maintainer-1', 'memory-lifecycle', '1.0.0', source.id, 2, occurredAt
      )
    ];
    const results = await Promise.allSettled(mutations);

    expect(results).toHaveLength(4);
    expect(results.every((result) =>
      result.status === 'rejected' &&
      result.reason instanceof Error &&
      'statusCode' in result.reason && result.reason.statusCode === 409 &&
      'code' in result.reason && result.reason.code === 'INVALID_VERSION_TRANSITION'
    )).toBe(true);
  });
});
