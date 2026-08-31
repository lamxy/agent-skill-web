// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { afterEach, describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import { MemoryAnalyticsRepository } from '../../src/modules/analytics/memory-analytics-repository.js';
import { MemoryCatalogRepository } from '../../src/modules/catalog/memory-catalog-repository.js';
import { MemoryPlatformStore, memoryVersionKey } from '../../src/modules/catalog/memory-platform-store.js';
import type { PackageRecord, PackageVersionRecord } from '../../src/modules/catalog/types.js';
import { DevelopmentIdentityProvider } from '../../src/modules/identity/identity-provider.js';
import { MemoryIdentityRepository } from '../../src/modules/identity/memory-identity-repository.js';
import type { TelemetryRecord } from '../../src/modules/telemetry/types.js';

const config = {
  environment: 'test' as const,
  host: '127.0.0.1',
  port: 3000,
  logLevel: 'silent' as const,
  databaseUrl: 'postgresql://unused'
};
const database = { ping: async () => undefined, close: async () => undefined };
const apps: Array<Awaited<ReturnType<typeof createApp>>> = [];
const startedAt = new Date('2026-08-25T10:00:00.000Z');

function packageRecord(): PackageRecord {
  return {
    packageId: 'analytics-api-package',
    type: 'skill',
    name: '分析 API 套件',
    purpose: '驗收分析 API',
    ownerTeam: 'platform',
    category: 'analytics',
    categoryCode: 'data',
    visibility: 'internal',
    sourceUri: 'https://example.invalid/analytics-api-package',
    license: 'MIT',
    source: 'custom',
    publisher: { kind: 'organization', name: '平台組' },
    grade: 'basic',
    lifecycle: 'active',
    createdAt: startedAt,
    updatedAt: startedAt
  };
}

function packageVersion(): PackageVersionRecord {
  return {
    id: 'analytics-api-version',
    packageId: 'analytics-api-package',
    version: '1.0.0',
    supportedOs: ['linux'],
    supportedClients: [{
      name: 'codex',
      adaptationSource: 'publisher',
      maintainer: 'platform'
    }],
    lifecycle: 'published',
    installCommand: 'install',
    uninstallCommand: 'uninstall',
    hasResidualEffects: false,
    authorUid: 'author-api',
    createdAt: startedAt,
    updatedAt: startedAt
  };
}

function telemetry(): TelemetryRecord {
  return {
    id: 'analytics-api-installation',
    idempotencyKey: 'analytics-api-key',
    packageId: 'analytics-api-package',
    version: '1.0.0',
    userRef: 'author-api',
    userRefType: 'uid',
    osType: 'linux',
    clientRuntime: 'codex',
    status: 'succeeded',
    errorCode: null,
    startedAt,
    endedAt: new Date('2026-08-25T10:00:10.000Z'),
    payloadFingerprint: 'analytics-api-fingerprint',
    receivedAt: new Date('2026-08-26T10:00:00.000Z')
  };
}

async function login(
  app: Awaited<ReturnType<typeof createApp>>,
  uid: 'author-api' | 'intruder-api'
): Promise<string> {
  const response = await app.inject({
    method: 'GET',
    url: `/api/auth/callback?code=${uid}`
  });
  const setCookie = response.headers['set-cookie'];
  const cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie)?.split(';')[0];
  if (!cookie) throw new Error('測試登入未取得 Session Cookie');
  return cookie;
}

async function createFixture() {
  const packageValue = packageRecord();
  const versionValue = packageVersion();
  const store = new MemoryPlatformStore({
    packages: { [packageValue.packageId]: packageValue },
    versions: {
      [memoryVersionKey(versionValue.packageId, versionValue.version)]: versionValue
    },
    telemetryRecords: [telemetry()]
  });
  const catalogRepository = new MemoryCatalogRepository({}, store);
  const identityRepository = new MemoryIdentityRepository();
  const app = await createApp({
    config,
    database,
    identity: {
      repository: identityRepository,
      provider: new DevelopmentIdentityProvider([
        { uid: 'author-api', displayName: '分析作者', teamIds: ['platform'] },
        { uid: 'intruder-api', displayName: '無權使用者', teamIds: ['other'] }
      ])
    },
    catalog: { repository: catalogRepository },
    analytics: { repository: new MemoryAnalyticsRepository(store) }
  });
  apps.push(app);
  return { app };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

describe('分析 API', () => {
  it('作者可依 startedAt 期間查看分析且回應標示 best-effort', async () => {
    const { app } = await createFixture();
    const cookie = await login(app, 'author-api');

    const response = await app.inject({
      method: 'GET',
      url: '/api/packages/analytics-api-package/analytics?start=2026-08-25T00%3A00%3A00.000Z&end=2026-08-25T23%3A59%3A59.999Z',
      headers: { cookie }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      packageId: 'analytics-api-package',
      telemetryAssurance: 'best-effort',
      dataNotice: '數據僅供參考',
      funnel: { installs: 1 },
      failureDistribution: {
        byVersion: [],
        byOs: [],
        byErrorCode: [],
        heatmap: []
      }
    });
  });

  it('匿名與無權使用者分別收到 401 與 403', async () => {
    const { app } = await createFixture();
    const anonymous = await app.inject({
      method: 'GET',
      url: '/api/packages/analytics-api-package/analytics?start=2026-08-25T00%3A00%3A00.000Z&end=2026-08-25T23%3A59%3A59.999Z'
    });
    const intruderCookie = await login(app, 'intruder-api');
    const forbidden = await app.inject({
      method: 'GET',
      url: '/api/packages/analytics-api-package/analytics?start=2026-08-25T00%3A00%3A00.000Z&end=2026-08-25T23%3A59%3A59.999Z',
      headers: { cookie: intruderCookie }
    });

    expect(anonymous.statusCode).toBe(401);
    expect(forbidden.statusCode).toBe(403);
  });

  it('拒絕無效日期與反向期間', async () => {
    const { app } = await createFixture();
    const cookie = await login(app, 'author-api');

    const invalid = await app.inject({
      method: 'GET',
      url: '/api/packages/analytics-api-package/analytics?start=not-a-date&end=2026-08-25T23%3A59%3A59.999Z',
      headers: { cookie }
    });
    const reversed = await app.inject({
      method: 'GET',
      url: '/api/packages/analytics-api-package/analytics?start=2026-08-26T00%3A00%3A00.000Z&end=2026-08-25T00%3A00%3A00.000Z',
      headers: { cookie }
    });

    expect(invalid.statusCode).toBe(400);
    expect(reversed.statusCode).toBe(400);
  });

  it('拒絕超過 366 天的分析期間並回傳中文錯誤', async () => {
    const { app } = await createFixture();
    const cookie = await login(app, 'author-api');

    const response = await app.inject({
      method: 'GET',
      url: '/api/packages/analytics-api-package/analytics?start=2025-01-01T00%3A00%3A00.000Z&end=2026-01-03T00%3A00%3A00.000Z',
      headers: { cookie }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: {
        code: 'INVALID_ANALYTICS_PERIOD',
        message: '分析期間不得超過 366 天'
      }
    });
  });

  it('拒絕會被 Date 正規化的不存在日曆日期', async () => {
    const { app } = await createFixture();
    const cookie = await login(app, 'author-api');

    const response = await app.inject({
      method: 'GET',
      url: '/api/packages/analytics-api-package/analytics?start=2026-02-30T00%3A00%3A00.000Z&end=2026-03-03T00%3A00%3A00.000Z',
      headers: { cookie }
    });

    expect(response.statusCode).toBe(400);
  });

  it('我的安裝強制登入並只返回目前 UID 的安裝', async () => {
    const { app } = await createFixture();
    const anonymous = await app.inject({ method: 'GET', url: '/api/me/installations' });
    const cookie = await login(app, 'author-api');
    const authenticated = await app.inject({
      method: 'GET',
      url: '/api/me/installations',
      headers: { cookie }
    });

    expect(anonymous.statusCode).toBe(401);
    expect(authenticated.statusCode).toBe(200);
    expect(authenticated.json()).toEqual([{
      packageId: 'analytics-api-package',
      packageName: '分析 API 套件',
      currentVersion: '1.0.0',
      status: 'installed',
      availableVersion: '1.0.0',
      upgradeAvailable: false
    }]);
  });
});
