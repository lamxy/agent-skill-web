// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { describe, expect, it, vi } from 'vitest';

import {
  AnalyticsService,
  compareSemanticVersions,
  wilsonScoreInterval
} from '../../src/modules/analytics/analytics-service.js';
import { MemoryAnalyticsRepository } from '../../src/modules/analytics/memory-analytics-repository.js';
import type { AnalyticsRepository } from '../../src/modules/analytics/repository.js';
import { MemoryPlatformStore, memoryVersionKey } from '../../src/modules/catalog/memory-platform-store.js';
import type { PackageRecord, PackageVersionRecord } from '../../src/modules/catalog/types.js';
import { AuthorizationService } from '../../src/modules/identity/authorization-service.js';
import { MemoryIdentityRepository } from '../../src/modules/identity/memory-identity-repository.js';
import type { IdentityRecord, ResolvedIdentity, RoleAssignment } from '../../src/modules/identity/types.js';
import type { TelemetryRecord, TelemetryStatus } from '../../src/modules/telemetry/types.js';

const baseTime = new Date('2026-08-25T00:00:00.000Z');
const period = {
  start: new Date('2026-08-25T00:00:00.000Z'),
  end: new Date('2026-08-25T23:59:59.999Z')
};

function packageRecord(): PackageRecord {
  return {
    packageId: 'pkg-analytics',
    type: 'skill',
    name: '分析工具',
    purpose: '驗證分析資料',
    ownerTeam: 'team-platform',
    category: 'quality',
    categoryCode: 'testing',
    visibility: 'internal',
    sourceUri: 'https://example.test/pkg-analytics',
    license: 'MIT',
    source: 'custom',
    publisher: { kind: 'organization', name: '平台組' },
    grade: 'basic',
    lifecycle: 'active',
    createdAt: baseTime,
    updatedAt: baseTime
  };
}

function version(
  value: string,
  authorUid = 'author-1',
  lifecycle: PackageVersionRecord['lifecycle'] = 'published',
  compatibility: Pick<PackageVersionRecord, 'supportedOs' | 'supportedClients'> = {
    supportedOs: ['linux'],
    supportedClients: [{
      name: 'codex',
      adaptationSource: 'publisher',
      maintainer: 'platform'
    }]
  }
): PackageVersionRecord {
  return {
    id: `version-${value}`,
    packageId: 'pkg-analytics',
    version: value,
    supportedOs: compatibility.supportedOs,
    supportedClients: compatibility.supportedClients,
    lifecycle,
    installCommand: 'install',
    uninstallCommand: 'uninstall',
    hasResidualEffects: false,
    authorUid,
    createdAt: baseTime,
    updatedAt: baseTime
  };
}

function telemetry(
  id: string,
  input: {
    userRef: string;
    userRefType: 'uid' | 'uuid';
    status: TelemetryStatus;
    version?: string;
    second?: number;
    durationSeconds?: number;
    errorCode?: TelemetryRecord['errorCode'];
    startedAt?: Date;
    receivedAt?: Date;
    osType?: TelemetryRecord['osType'];
    clientRuntime?: string;
  }
): TelemetryRecord {
  const startedAt = input.startedAt ?? new Date(baseTime.getTime() + (input.second ?? 0) * 1_000);
  return {
    id,
    idempotencyKey: `key-${id}`,
    packageId: 'pkg-analytics',
    version: input.version ?? '1.9.0',
    userRef: input.userRef,
    userRefType: input.userRefType,
    osType: input.osType ?? (input.userRef === 'uuid-b' ? 'windows' : 'linux'),
    clientRuntime: input.clientRuntime ?? 'codex',
    status: input.status,
    errorCode: input.errorCode ?? null,
    startedAt,
    endedAt: new Date(startedAt.getTime() + (input.durationSeconds ?? 1) * 1_000),
    payloadFingerprint: `fingerprint-${id}`,
    receivedAt: input.receivedAt ?? startedAt
  };
}

function identity(uid: string, teamIds: string[] = []): IdentityRecord {
  return {
    uid,
    displayName: uid,
    teamIds,
    providerType: 'development',
    active: true,
    createdAt: baseTime,
    updatedAt: baseTime
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
    createdAt: baseTime
  };
}

function authenticated(uid: string, teamIds: string[] = []): ResolvedIdentity {
  return { kind: 'authenticated', uid, displayName: uid, teamIds };
}

function createFixture() {
  const records = [
    telemetry('download-a', { userRef: 'uid-a', userRefType: 'uid', status: 'downloaded', second: 1 }),
    telemetry('download-b', { userRef: 'uid-b', userRefType: 'uid', status: 'downloaded', second: 2, version: '1.10.0' }),
    telemetry('download-c', { userRef: 'uid-c', userRefType: 'uid', status: 'downloaded', second: 3 }),
    telemetry('download-uuid-a', { userRef: 'uuid-a', userRefType: 'uuid', status: 'downloaded', second: 4 }),
    telemetry('success-a', { userRef: 'uid-a', userRefType: 'uid', status: 'succeeded', second: 10, durationSeconds: 10 }),
    telemetry('success-b', { userRef: 'uid-b', userRefType: 'uid', status: 'succeeded', second: 20, durationSeconds: 20, version: '1.10.0' }),
    telemetry('failure-c', { userRef: 'uid-c', userRefType: 'uid', status: 'failed', second: 30, errorCode: 'E002' }),
    telemetry('success-uuid-a', { userRef: 'uuid-a', userRefType: 'uuid', status: 'succeeded', second: 40, durationSeconds: 30 }),
    telemetry('failure-uuid-b', { userRef: 'uuid-b', userRefType: 'uuid', status: 'failed', second: 50, errorCode: 'E004', version: '1.10.0-beta.1' }),
    telemetry('uninstall-b', { userRef: 'uid-b', userRefType: 'uid', status: 'uninstalled', second: 60, version: '1.10.0' }),
    telemetry('outside-by-start', {
      userRef: 'uid-outside',
      userRefType: 'uid',
      status: 'downloaded',
      startedAt: new Date('2026-08-24T23:59:59.000Z'),
      receivedAt: new Date('2026-08-25T00:00:01.000Z')
    })
  ];
  const versions = [version('1.9.0'), version('1.10.0'), version('1.10.0-beta.1')];
  const store = new MemoryPlatformStore({
    packages: { 'pkg-analytics': packageRecord() },
    versions: Object.fromEntries(versions.map((item) => [memoryVersionKey(item.packageId, item.version), item])),
    telemetryRecords: records
  });
  const identities = new MemoryIdentityRepository({
    identities: [
      identity('author-1'),
      identity('maintainer-1', ['team-platform']),
      identity('admin-1'),
      identity('employee-1'),
      identity('uid-a')
    ],
    roles: [
      role('maintainer-1', 'maintainer', 'team', 'team-platform'),
      role('admin-1', 'platform_admin', 'global'),
      role('employee-1', 'employee', 'global')
    ]
  });
  return new AnalyticsService(
    new MemoryAnalyticsRepository(store),
    new AuthorizationService(identities)
  );
}

describe('AnalyticsService', () => {
  it('以已知資料集計算分層漏斗、失敗分布、時間與當前版本', async () => {
    const report = await createFixture().getPackageAnalytics(
      'pkg-analytics',
      period,
      authenticated('author-1')
    );

    expect(report.funnel).toEqual({
      downloads: 4,
      installs: 3,
      uninstalls: 1,
      downloadToInstall: 0.75,
      installToUninstall: 1 / 3
    });
    expect(report.successRates.uid).toMatchObject({ successes: 2, total: 3, rate: 2 / 3 });
    expect(report.successRates.uuid).toMatchObject({ successes: 1, total: 2, rate: 0.5 });
    expect(report.successRates.uid.confidenceInterval).toEqual(wilsonScoreInterval(2, 3));
    expect(report.failureCells).toEqual([
      { version: '1.9.0', osType: 'linux', errorCode: 'E002', count: 1 },
      { version: '1.10.0-beta.1', osType: 'windows', errorCode: 'E004', count: 1 }
    ]);
    expect(report.failureDistribution).toEqual({
      byVersion: [
        { version: '1.9.0', count: 1 },
        { version: '1.10.0-beta.1', count: 1 }
      ],
      byOs: [
        { osType: 'linux', count: 1 },
        { osType: 'windows', count: 1 }
      ],
      byErrorCode: [
        { errorCode: 'E002', count: 1 },
        { errorCode: 'E004', count: 1 }
      ],
      heatmap: [
        { version: '1.9.0', osType: 'linux', errorCode: 'E002', count: 1 },
        { version: '1.10.0-beta.1', osType: 'windows', errorCode: 'E004', count: 1 }
      ]
    });
    expect(report.timeToRunnable).toEqual({
      platform: {
        sampleSize: 3,
        medianMilliseconds: 20_000,
        p90Milliseconds: 30_000,
        p95Milliseconds: 30_000
      },
      employee: {
        sampleSize: 3,
        medianMilliseconds: 38_000,
        p90Milliseconds: 66_000,
        p95Milliseconds: 66_000,
        approximate: true
      }
    });
    expect(report.versionDistribution).toEqual([
      { version: '1.9.0', installations: 2 }
    ]);
    expect(report.upgradeCandidates).toEqual([
      { uid: 'uid-a', currentVersion: '1.9.0', availableVersion: '1.10.0' }
    ]);
    expect(report.telemetryAssurance).toBe('best-effort');
    expect(report.dataNotice).toBe('數據僅供參考');
    expect(report.dataGaps).toEqual([
      { code: 'MISSING_DOWNLOAD_EVENTS', missingCount: 1, message: '終態事件比下載事件多 1 筆' }
    ]);
  });

  it('零分母不產生無效比率或信賴區間', async () => {
    const emptyStore = new MemoryPlatformStore({
      packages: { 'pkg-analytics': packageRecord() },
      versions: { [memoryVersionKey('pkg-analytics', '1.10.0')]: version('1.10.0') }
    });
    const identities = new MemoryIdentityRepository({ identities: [identity('author-1')] });
    const service = new AnalyticsService(
      new MemoryAnalyticsRepository(emptyStore),
      new AuthorizationService(identities)
    );

    const report = await service.getPackageAnalytics('pkg-analytics', period, authenticated('author-1'));

    expect(report.funnel.downloadToInstall).toBeNull();
    expect(report.funnel.installToUninstall).toBeNull();
    expect(report.successRates.uid).toMatchObject({ successes: 0, total: 0, rate: null, confidenceInterval: null });
    expect(report.successRates.uuid).toMatchObject({ successes: 0, total: 0, rate: null, confidenceInterval: null });
    expect(report.timeToRunnable).toEqual({
      platform: {
        sampleSize: 0,
        medianMilliseconds: null,
        p90Milliseconds: null,
        p95Milliseconds: null
      },
      employee: {
        sampleSize: 0,
        medianMilliseconds: null,
        p90Milliseconds: null,
        p95Milliseconds: null,
        approximate: true
      }
    });
    expect(wilsonScoreInterval(0, 0)).toBeNull();
  });

  it('員工口徑選擇同安裝鍵最近的前序下載且不以平台時間補齊缺少樣本', async () => {
    const store = new MemoryPlatformStore({
      packages: { 'pkg-analytics': packageRecord() },
      versions: { [memoryVersionKey('pkg-analytics', '1.9.0')]: version('1.9.0') },
      telemetryRecords: [
        telemetry('early-download', {
          userRef: 'uid-a', userRefType: 'uid', status: 'downloaded', second: 1
        }),
        telemetry('recent-download', {
          userRef: 'uid-a', userRefType: 'uid', status: 'downloaded', second: 5
        }),
        telemetry('matched-success', {
          userRef: 'uid-a', userRefType: 'uid', status: 'succeeded', second: 10, durationSeconds: 10
        }),
        telemetry('unmatched-success', {
          userRef: 'uid-without-download', userRefType: 'uid', status: 'succeeded', second: 20, durationSeconds: 30
        })
      ]
    });
    const service = new AnalyticsService(
      new MemoryAnalyticsRepository(store),
      new AuthorizationService(new MemoryIdentityRepository({ identities: [identity('author-1')] }))
    );

    const report = await service.getPackageAnalytics('pkg-analytics', period, authenticated('author-1'));

    expect(report.timeToRunnable).toEqual({
      platform: {
        sampleSize: 2,
        medianMilliseconds: 10_000,
        p90Milliseconds: 30_000,
        p95Milliseconds: 30_000
      },
      employee: {
        sampleSize: 1,
        medianMilliseconds: 15_000,
        p90Milliseconds: 15_000,
        p95Milliseconds: 15_000,
        approximate: true
      }
    });
  });

  it('大型同鍵資料集仍配對最近前序下載並在寬鬆時限內完成', async () => {
    const sampleSize = 10_000;
    const downloads = Array.from({ length: sampleSize }, (_, index) => telemetry(`bulk-download-${index}`, {
      userRef: 'uid-bulk',
      userRefType: 'uid',
      status: 'downloaded',
      startedAt: new Date(baseTime.getTime() + index)
    }));
    const successes = Array.from({ length: sampleSize }, (_, index) => telemetry(`bulk-success-${index}`, {
      userRef: 'uid-bulk',
      userRefType: 'uid',
      status: 'succeeded',
      startedAt: new Date(baseTime.getTime() + 15_000 + index)
    }));
    const store = new MemoryPlatformStore({
      packages: { 'pkg-analytics': packageRecord() },
      versions: { [memoryVersionKey('pkg-analytics', '1.9.0')]: version('1.9.0') },
      telemetryRecords: [...downloads, ...successes]
    });
    const service = new AnalyticsService(
      new MemoryAnalyticsRepository(store),
      new AuthorizationService(new MemoryIdentityRepository({ identities: [identity('author-1')] }))
    );

    const report = await service.getPackageAnalytics(
      'pkg-analytics',
      period,
      authenticated('author-1')
    );

    expect(report.timeToRunnable).toEqual({
      platform: {
        sampleSize,
        medianMilliseconds: 1_000,
        p90Milliseconds: 1_000,
        p95Milliseconds: 1_000
      },
      employee: {
        sampleSize,
        medianMilliseconds: 11_000,
        p90Milliseconds: 15_000,
        p95Milliseconds: 15_500,
        approximate: true
      }
    });
  }, 10_000);

  it('匿名不存在套件時先回 401 且不讀取任何 repository 資料', async () => {
    const findPackageDataset = vi.fn();
    const findPackageMetadata = vi.fn();
    const findPackageTelemetry = vi.fn();
    const repository = {
      findPackageDataset,
      findPackageMetadata,
      findPackageTelemetry,
      findUserDataset: vi.fn()
    } as unknown as AnalyticsRepository;
    const service = new AnalyticsService(
      repository,
      new AuthorizationService(new MemoryIdentityRepository())
    );

    await expect(service.getPackageAnalytics(
      'missing-package',
      period,
      { kind: 'anonymous', anonymousId: 'anon', isNew: false }
    )).rejects.toMatchObject({ statusCode: 401, code: 'AUTHENTICATION_REQUIRED' });
    expect(findPackageDataset).not.toHaveBeenCalled();
    expect(findPackageMetadata).not.toHaveBeenCalled();
    expect(findPackageTelemetry).not.toHaveBeenCalled();
  });

  it('已登入越權只讀 metadata，不觸發期間 telemetry 查詢', async () => {
    const metadata = { package: packageRecord(), versions: [version('1.9.0')] };
    const findPackageDataset = vi.fn(async () => ({ ...metadata, telemetry: [] }));
    const findPackageMetadata = vi.fn(async () => metadata);
    const findPackageTelemetry = vi.fn(async () => []);
    const repository = {
      findPackageDataset,
      findPackageMetadata,
      findPackageTelemetry,
      findUserDataset: vi.fn()
    } as unknown as AnalyticsRepository;
    const service = new AnalyticsService(
      repository,
      new AuthorizationService(new MemoryIdentityRepository({ identities: [identity('intruder')] }))
    );

    await expect(service.getPackageAnalytics(
      'pkg-analytics',
      period,
      authenticated('intruder')
    )).rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
    expect(findPackageDataset).not.toHaveBeenCalled();
    expect(findPackageMetadata).toHaveBeenCalledOnce();
    expect(findPackageTelemetry).not.toHaveBeenCalled();
  });

  it('同時間事件依 receivedAt 與 id 折疊，且不受 repository 輸入順序影響', async () => {
    const success = telemetry('a-success', {
      userRef: 'uid-tie',
      userRefType: 'uid',
      status: 'succeeded',
      receivedAt: new Date('2026-08-25T00:00:01.000Z')
    });
    const uninstall = telemetry('z-uninstall', {
      userRef: 'uid-tie',
      userRefType: 'uid',
      status: 'uninstalled',
      receivedAt: new Date('2026-08-25T00:00:02.000Z')
    });

    for (const telemetryRecords of [[success, uninstall], [uninstall, success]]) {
      const store = new MemoryPlatformStore({
        packages: { 'pkg-analytics': packageRecord() },
        versions: { [memoryVersionKey('pkg-analytics', '1.9.0')]: version('1.9.0') },
        telemetryRecords
      });
      const service = new AnalyticsService(
        new MemoryAnalyticsRepository(store),
        new AuthorizationService(new MemoryIdentityRepository({ identities: [identity('author-1')] }))
      );

      const report = await service.getPackageAnalytics(
        'pkg-analytics',
        period,
        authenticated('author-1')
      );

      expect(report.versionDistribution).toEqual([]);
    }
  });

  it('receivedAt 也相同時以 id 決定折疊順序', async () => {
    const receivedAt = new Date('2026-08-25T00:00:01.000Z');
    const success = telemetry('a-success', {
      userRef: 'uid-id-tie', userRefType: 'uid', status: 'succeeded', receivedAt
    });
    const uninstall = telemetry('z-uninstall', {
      userRef: 'uid-id-tie', userRefType: 'uid', status: 'uninstalled', receivedAt
    });
    const store = new MemoryPlatformStore({
      packages: { 'pkg-analytics': packageRecord() },
      versions: { [memoryVersionKey('pkg-analytics', '1.9.0')]: version('1.9.0') },
      telemetryRecords: [uninstall, success]
    });
    const service = new AnalyticsService(
      new MemoryAnalyticsRepository(store),
      new AuthorizationService(new MemoryIdentityRepository({ identities: [identity('author-1')] }))
    );

    const report = await service.getPackageAnalytics(
      'pkg-analytics', period, authenticated('author-1')
    );

    expect(report.versionDistribution).toEqual([]);
  });

  it('非 SemVer 使用自然排序，推薦版不受 repository 順序影響', async () => {
    expect(compareSemanticVersions('release2', 'release10')).toBeLessThan(0);
    expect(compareSemanticVersions('1.9.0', 'release2')).toBeLessThan(0);

    const published = [version('1.9.0'), version('release10'), version('release2')];
    for (const versionRecords of [published, [...published].reverse()]) {
      const store = new MemoryPlatformStore({
        packages: { 'pkg-analytics': packageRecord() },
        versions: Object.fromEntries(versionRecords.map((item) => [
          memoryVersionKey(item.packageId, item.version), item
        ])),
        telemetryRecords: [telemetry('natural-version-install', {
          userRef: 'uid-natural',
          userRefType: 'uid',
          status: 'succeeded',
          version: 'release2'
        })]
      });
      const service = new AnalyticsService(
        new MemoryAnalyticsRepository(store),
        new AuthorizationService(new MemoryIdentityRepository())
      );

      await expect(service.getMyInstallations(authenticated('uid-natural'))).resolves.toEqual([{
        packageId: 'pkg-analytics',
        packageName: '分析工具',
        currentVersion: 'release2',
        status: 'installed',
        availableVersion: 'release10',
        upgradeAvailable: true
      }]);
    }
  });

  it('混合 SemVer 與非 SemVer 的推薦版在所有輸入順序下保持一致', async () => {
    const labels = ['1.0.0', '1.0.0-alpha', '1.0.0-'];
    const permutations = [
      [labels[0], labels[1], labels[2]],
      [labels[0], labels[2], labels[1]],
      [labels[1], labels[0], labels[2]],
      [labels[1], labels[2], labels[0]],
      [labels[2], labels[0], labels[1]],
      [labels[2], labels[1], labels[0]]
    ] as string[][];

    for (const orderedLabels of permutations) {
      const versionRecords = orderedLabels.map((label) => version(label));
      const store = new MemoryPlatformStore({
        packages: { 'pkg-analytics': packageRecord() },
        versions: Object.fromEntries(versionRecords.map((item) => [
          memoryVersionKey(item.packageId, item.version), item
        ])),
        telemetryRecords: [telemetry('mixed-version-install', {
          userRef: 'uid-mixed-version',
          userRefType: 'uid',
          status: 'succeeded',
          version: '1.0.0-alpha'
        })]
      });
      const service = new AnalyticsService(
        new MemoryAnalyticsRepository(store),
        new AuthorizationService(new MemoryIdentityRepository())
      );

      const installations = await service.getMyInstallations(
        authenticated('uid-mixed-version')
      );

      expect(installations[0]?.availableVersion).toBe('1.0.0-');
    }
  });

  it('只有解除安裝事件時不製造缺少下載事件的假缺口', async () => {
    const store = new MemoryPlatformStore({
      packages: { 'pkg-analytics': packageRecord() },
      versions: { [memoryVersionKey('pkg-analytics', '1.9.0')]: version('1.9.0') },
      telemetryRecords: [telemetry('uninstall-only', {
        userRef: 'uid-uninstall', userRefType: 'uid', status: 'uninstalled'
      })]
    });
    const service = new AnalyticsService(
      new MemoryAnalyticsRepository(store),
      new AuthorizationService(new MemoryIdentityRepository({ identities: [identity('author-1')] }))
    );

    const report = await service.getPackageAnalytics(
      'pkg-analytics', period, authenticated('author-1')
    );

    expect(report.dataGaps).toEqual([]);
  });

  it.each([
    ['套件版本作者', authenticated('author-1')],
    ['owner team maintainer', authenticated('maintainer-1', ['team-platform'])],
    ['platform admin', authenticated('admin-1')]
  ])('%s 可以查看套件分析', async (_label, actor) => {
    await expect(createFixture().getPackageAnalytics('pkg-analytics', period, actor)).resolves.toMatchObject({
      packageId: 'pkg-analytics'
    });
  });

  it('作者分析固定附帶數據僅供參考提示', async () => {
    const report = await createFixture().getPackageAnalytics(
      'pkg-analytics',
      period,
      authenticated('author-1')
    );

    expect(report.dataNotice).toBe('數據僅供參考');
  });

  it('一般員工與匿名身份不能查看套件分析', async () => {
    await expect(
      createFixture().getPackageAnalytics('pkg-analytics', period, authenticated('employee-1'))
    ).rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
    await expect(
      createFixture().getPackageAnalytics('pkg-analytics', period, { kind: 'anonymous', anonymousId: 'anon', isNew: false })
    ).rejects.toMatchObject({ statusCode: 401, code: 'AUTHENTICATION_REQUIRED' });
  });

  it('我的安裝只折疊目前 UID，正確比較多位語意版本與 prerelease', async () => {
    const service = createFixture();

    await expect(service.getMyInstallations(authenticated('uid-a'))).resolves.toEqual([
      {
        packageId: 'pkg-analytics',
        packageName: '分析工具',
        currentVersion: '1.9.0',
        status: 'installed',
        availableVersion: '1.10.0',
        upgradeAvailable: true
      }
    ]);
    await expect(
      service.getMyInstallations({ kind: 'anonymous', anonymousId: 'anon', isNew: false })
    ).rejects.toMatchObject({ statusCode: 401, code: 'AUTHENTICATION_REQUIRED' });

    const prereleaseStore = new MemoryPlatformStore({
      packages: { 'pkg-analytics': packageRecord() },
      versions: {
        [memoryVersionKey('pkg-analytics', '1.10.0-beta.1')]: version('1.10.0-beta.1'),
        [memoryVersionKey('pkg-analytics', '1.10.0')]: version('1.10.0')
      },
      telemetryRecords: [telemetry('prerelease', {
        userRef: 'uid-a', userRefType: 'uid', status: 'succeeded', version: '1.10.0-beta.1'
      })]
    });
    const prereleaseService = new AnalyticsService(
      new MemoryAnalyticsRepository(prereleaseStore),
      new AuthorizationService(new MemoryIdentityRepository())
    );
    const [installation] = await prereleaseService.getMyInstallations(authenticated('uid-a'));
    expect(installation).toMatchObject({ currentVersion: '1.10.0-beta.1', availableVersion: '1.10.0', upgradeAvailable: true });
  });

  it('待升級 UID 只包含最後成功安裝環境相容推薦版的使用者', async () => {
    const incompatibleVersion = version('2.0.0', 'author-1', 'published', {
      supportedOs: ['windows'],
      supportedClients: [{
        name: 'claude-code',
        adaptationSource: 'publisher',
        maintainer: 'platform'
      }]
    });
    const store = new MemoryPlatformStore({
      packages: { 'pkg-analytics': packageRecord() },
      versions: {
        [memoryVersionKey('pkg-analytics', '1.9.0')]: version('1.9.0'),
        [memoryVersionKey('pkg-analytics', '2.0.0')]: incompatibleVersion
      },
      telemetryRecords: [
        telemetry('linux-codex-success', {
          userRef: 'uid-linux',
          userRefType: 'uid',
          status: 'succeeded',
          version: '1.9.0',
          osType: 'linux',
          clientRuntime: 'codex'
        }),
        telemetry('windows-claude-success', {
          userRef: 'uid-windows',
          userRefType: 'uid',
          status: 'succeeded',
          version: '1.9.0',
          osType: 'windows',
          clientRuntime: 'claude-code',
          second: 1
        })
      ]
    });
    const service = new AnalyticsService(
      new MemoryAnalyticsRepository(store),
      new AuthorizationService(new MemoryIdentityRepository({
        identities: [identity('author-1')]
      }))
    );

    const report = await service.getPackageAnalytics(
      'pkg-analytics',
      period,
      authenticated('author-1')
    );

    expect(report.upgradeCandidates).toEqual([{
      uid: 'uid-windows',
      currentVersion: '1.9.0',
      availableVersion: '2.0.0'
    }]);
  });
});
