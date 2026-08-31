// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { afterEach, describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import {
  DevelopmentIdentityProvider,
  DisabledIdentityProvider
} from '../../src/modules/identity/identity-provider.js';
import { createIdentityModule } from '../../src/modules/identity/index.js';
import { MemoryIdentityRepository } from '../../src/modules/identity/memory-identity-repository.js';

const now = new Date('2026-08-25T00:00:00.000Z');
const database = {
  ping: async () => undefined,
  close: async () => undefined
};
const testConfig = {
  environment: 'test' as const,
  host: '127.0.0.1',
  port: 3000,
  logLevel: 'silent' as const,
  databaseUrl: 'postgresql://unused'
};
const productionConfig = {
  ...testConfig,
  environment: 'production' as const
};
const fixtures = [
  { uid: 'user-1', displayName: '使用者一', teamIds: ['team-a'] },
  { uid: 'reviewer-1', displayName: '審核人一', teamIds: ['team-b'] },
  { uid: 'dev-admin', displayName: '開發管理員', teamIds: ['platform'] }
];

const apps: Array<Awaited<ReturnType<typeof createApp>>> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

function firstCookie(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (!header) {
    throw new Error('預期回應包含 Set-Cookie');
  }
  const cookie = header.split(';')[0];
  if (!cookie) {
    throw new Error('預期 Cookie 具備名稱和值');
  }
  return cookie;
}

async function createTestApp(options?: {
  repository?: MemoryIdentityRepository;
  production?: boolean;
}) {
  const repository = options?.repository ?? new MemoryIdentityRepository();
  const config = options?.production ? productionConfig : testConfig;
  const provider = options?.production
    ? new DisabledIdentityProvider()
    : new DevelopmentIdentityProvider(fixtures);
  const app = await createApp({
    config,
    database,
    modules: [
      createIdentityModule({
        config,
        repository,
        provider,
        clock: () => now,
        sessionTokenFactory: (() => {
          let sequence = 0;
          return () => `session-token-${++sequence}`;
        })(),
        anonymousIdFactory: () =>
          '123e4567-e89b-42d3-a456-426614174000'
      })
    ]
  });
  apps.push(app);
  return { app, repository };
}

async function login(
  app: Awaited<ReturnType<typeof createApp>>,
  uid: string
): Promise<string> {
  const started = await app.inject({
    method: 'GET',
    url: `/api/auth/login?uid=${encodeURIComponent(uid)}&returnTo=%2Fconsole`
  });
  expect(started.statusCode).toBe(302);
  const callbackUrl = started.headers.location;
  if (!callbackUrl) {
    throw new Error('登入起始回應缺少 callback Location');
  }

  const callback = await app.inject({
    method: 'GET',
    url: callbackUrl
  });
  expect(callback.statusCode).toBe(302);
  expect(callback.headers.location).toBe('/console');
  return firstCookie(callback.headers['set-cookie']);
}

describe('身份 API', () => {
  it('開發 provider 完成登入後 /me 回傳 UID、團隊與角色', async () => {
    const { app } = await createTestApp();
    const sessionCookie = await login(app, 'dev-admin');

    const response = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: sessionCookie }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      kind: 'authenticated',
      uid: 'dev-admin',
      displayName: '開發管理員',
      teamIds: ['platform'],
      roles: [
        {
          role: 'platform_admin',
          scopeType: 'global',
          scopeValue: ''
        }
      ]
    });
  });

  it('未登入時簽發並沿用匿名 UUID，不把它放入 uid', async () => {
    const { app } = await createTestApp();
    const first = await app.inject({ method: 'GET', url: '/api/auth/me' });
    const anonymousCookie = firstCookie(first.headers['set-cookie']);
    const second = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: anonymousCookie }
    });

    expect(first.json()).toEqual({
      kind: 'anonymous',
      anonymousId: '123e4567-e89b-42d3-a456-426614174000'
    });
    expect(second.json()).toEqual(first.json());
    expect(second.json()).not.toHaveProperty('uid');
  });

  it('登出撤銷 session，舊 Cookie 不再恢復登入身份', async () => {
    const { app } = await createTestApp();
    const sessionCookie = await login(app, 'user-1');

    const logout = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie: sessionCookie }
    });
    const me = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: sessionCookie }
    });

    expect(logout.statusCode).toBe(200);
    expect(logout.json()).toEqual({ loggedOut: true });
    expect(me.json()).toMatchObject({ kind: 'anonymous' });
  });

  it('正式環境未接入 OIDC 時拒絕登入而不降級開發身份', async () => {
    const { app } = await createTestApp({ production: true });

    const response = await app.inject({
      method: 'GET',
      url: '/api/auth/login'
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      error: {
        code: 'AUTH_PROVIDER_UNAVAILABLE',
        message: '正式身份提供者尚未配置'
      }
    });
  });

  it('平臺管理員可新增及撤銷審核人並留下兩筆稽核事件', async () => {
    const repository = new MemoryIdentityRepository();
    const { app } = await createTestApp({ repository });
    await login(app, 'reviewer-1');
    const adminCookie = await login(app, 'dev-admin');

    const created = await app.inject({
      method: 'POST',
      url: '/api/admin/reviewers',
      headers: { cookie: adminCookie },
      payload: {
        reviewerUid: 'reviewer-1',
        packageType: 'skill',
        category: 'frontend'
      }
    });
    const assignment = created.json<{ id: string }>();
    const revoked = await app.inject({
      method: 'DELETE',
      url: `/api/admin/reviewers/${assignment.id}`,
      headers: { cookie: adminCookie }
    });

    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      reviewerUid: 'reviewer-1',
      active: true
    });
    expect(revoked.statusCode).toBe(200);
    expect(revoked.json()).toMatchObject({ active: false });
    expect(repository.domainEvents.map((event) => event.eventType)).toEqual([
      'reviewer.assigned',
      'reviewer.revoked'
    ]);
  });

  it('僅平臺管理員可讀取有效審核人指派，並依建立時間與 ID 穩定倒序', async () => {
    const repository = new MemoryIdentityRepository({
      reviewerAssignments: [
        {
          id: '123e4567-e89b-42d3-a456-426614174001',
          reviewerUid: 'reviewer-1',
          packageType: 'skill',
          category: 'frontend',
          assignedByUid: 'admin-1',
          active: true,
          createdAt: new Date('2026-08-24T00:00:00.000Z')
        },
        {
          id: '123e4567-e89b-42d3-a456-426614174003',
          reviewerUid: 'reviewer-3',
          packageType: 'plugin',
          category: 'backend',
          assignedByUid: 'admin-1',
          active: true,
          createdAt: new Date('2026-08-25T00:00:00.000Z')
        },
        {
          id: '123e4567-e89b-42d3-a456-426614174002',
          reviewerUid: 'reviewer-2',
          packageType: 'skill',
          category: 'backend',
          assignedByUid: 'admin-1',
          active: true,
          createdAt: new Date('2026-08-25T00:00:00.000Z')
        },
        {
          id: '123e4567-e89b-42d3-a456-426614174004',
          reviewerUid: 'reviewer-revoked',
          packageType: 'skill',
          category: 'security',
          assignedByUid: 'admin-1',
          active: false,
          createdAt: new Date('2026-08-26T00:00:00.000Z'),
          revokedAt: new Date('2026-08-27T00:00:00.000Z'),
          revokedByUid: 'admin-1'
        }
      ]
    });
    const { app } = await createTestApp({ repository });
    const adminCookie = await login(app, 'dev-admin');

    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/reviewers',
      headers: { cookie: adminCookie }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      items: [
        {
          id: '123e4567-e89b-42d3-a456-426614174003',
          reviewerUid: 'reviewer-3',
          packageType: 'plugin',
          category: 'backend',
          assignedByUid: 'admin-1',
          active: true,
          createdAt: '2026-08-25T00:00:00.000Z'
        },
        {
          id: '123e4567-e89b-42d3-a456-426614174002',
          reviewerUid: 'reviewer-2',
          packageType: 'skill',
          category: 'backend',
          assignedByUid: 'admin-1',
          active: true,
          createdAt: '2026-08-25T00:00:00.000Z'
        },
        {
          id: '123e4567-e89b-42d3-a456-426614174001',
          reviewerUid: 'reviewer-1',
          packageType: 'skill',
          category: 'frontend',
          assignedByUid: 'admin-1',
          active: true,
          createdAt: '2026-08-24T00:00:00.000Z'
        }
      ]
    });
  });

  it('平臺管理員可取得真實有效身份作為審核者候選', async () => {
    const { app } = await createTestApp();
    await login(app, 'reviewer-1');
    await login(app, 'user-1');
    const adminCookie = await login(app, 'dev-admin');

    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/reviewer-candidates',
      headers: { cookie: adminCookie }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      items: [
        { uid: 'dev-admin', displayName: '開發管理員', teamIds: ['platform'] },
        { uid: 'reviewer-1', displayName: '審核人一', teamIds: ['team-b'] },
        { uid: 'user-1', displayName: '使用者一', teamIds: ['team-a'] }
      ]
    });
  });

  it('一般登入使用者不能管理審核人', async () => {
    const { app } = await createTestApp();
    const userCookie = await login(app, 'user-1');

    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/reviewers',
      headers: { cookie: userCookie },
      payload: {
        reviewerUid: 'reviewer-1',
        packageType: 'skill',
        category: 'frontend'
      }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      error: { code: 'FORBIDDEN' }
    });
  });

  it('一般登入使用者不能讀取審核人指派', async () => {
    const { app } = await createTestApp();
    const userCookie = await login(app, 'user-1');

    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/reviewers',
      headers: { cookie: userCookie }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      error: { code: 'FORBIDDEN' }
    });
  });
});

describe('角色管理 API', () => {
  it('管理員授予 maintainer 後對方即可通過權限判定', async () => {
    const { app, repository } = await createTestApp();
    const adminCookie = await login(app, 'dev-admin');
    await login(app, 'user-1');

    const granted = await app.inject({
      method: 'POST',
      url: '/api/admin/roles',
      headers: { cookie: adminCookie },
      payload: {
        uid: 'user-1',
        role: 'maintainer',
        scopeType: 'team',
        scopeValue: 'team-a'
      }
    });

    expect(granted.statusCode).toBe(201);
    expect(granted.json()).toMatchObject({
      uid: 'user-1',
      role: 'maintainer',
      scopeType: 'team',
      scopeValue: 'team-a',
      assignedByUid: 'dev-admin'
    });
    expect(await repository.listActiveRoles('user-1')).toHaveLength(1);
  });

  it('查詢指定身份的生效角色', async () => {
    const { app } = await createTestApp();
    const adminCookie = await login(app, 'dev-admin');
    await login(app, 'user-1');
    await app.inject({
      method: 'POST',
      url: '/api/admin/roles',
      headers: { cookie: adminCookie },
      payload: { uid: 'user-1', role: 'maintainer', scopeType: 'global' }
    });

    const listed = await app.inject({
      method: 'GET',
      url: '/api/admin/roles?uid=user-1',
      headers: { cookie: adminCookie }
    });

    expect(listed.json().items).toHaveLength(1);
  });

  it('撤銷後回報撤銷筆數', async () => {
    const { app, repository } = await createTestApp();
    const adminCookie = await login(app, 'dev-admin');
    await login(app, 'user-1');
    await app.inject({
      method: 'POST',
      url: '/api/admin/roles',
      headers: { cookie: adminCookie },
      payload: { uid: 'user-1', role: 'maintainer', scopeType: 'global' }
    });

    const revoked = await app.inject({
      method: 'DELETE',
      url: '/api/admin/roles',
      headers: { cookie: adminCookie },
      payload: { uid: 'user-1', role: 'maintainer' }
    });

    expect(revoked.json()).toEqual({ revoked: 1 });
    expect(await repository.listActiveRoles('user-1')).toEqual([]);
  });

  it('schema 層即拒絕 platform_admin，不進入服務層', async () => {
    const { app } = await createTestApp();
    const adminCookie = await login(app, 'dev-admin');

    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/roles',
      headers: { cookie: adminCookie },
      payload: { uid: 'user-1', role: 'platform_admin', scopeType: 'global' }
    });

    expect(response.statusCode).toBe(400);
  });

  it('一般使用者不得授予角色', async () => {
    const { app } = await createTestApp();
    const userCookie = await login(app, 'user-1');

    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/roles',
      headers: { cookie: userCookie },
      payload: { uid: 'user-1', role: 'maintainer', scopeType: 'global' }
    });

    expect(response.statusCode).toBe(403);
  });

  it('未登入者不得存取角色管理', async () => {
    const { app } = await createTestApp();

    for (const [method, url] of [
      ['GET', '/api/admin/roles?uid=user-1'],
      ['POST', '/api/admin/roles'],
      ['DELETE', '/api/admin/roles']
    ] as const) {
      const response = await app.inject({
        method,
        url,
        ...(method === 'GET'
          ? {}
          : {
              payload: {
                uid: 'user-1',
                role: 'maintainer',
                scopeType: 'global'
              }
            })
      });
      expect(response.statusCode).toBe(401);
    }
  });
});
