// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { afterEach, describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import { AuthorizationService } from '../../src/modules/identity/authorization-service.js';
import { OAuth2IdentityProvider } from '../../src/modules/identity/identity-provider.js';
import { createIdentityModule } from '../../src/modules/identity/index.js';
import { MemoryIdentityRepository } from '../../src/modules/identity/memory-identity-repository.js';
import { createMockIdpServer } from '../../src/modules/identity/mock-idp-server.js';

/**
 * D-4：授予角色本身需要 platform_admin，正式環境因此需要一條
 * bootstrap 路徑，否則 SSO 接通後仍無人能指派審核人。
 */

const database = { ping: async () => undefined, close: async () => undefined };
const baseConfig = {
  environment: 'test' as const,
  host: '127.0.0.1',
  port: 3000,
  logLevel: 'silent' as const,
  databaseUrl: 'postgresql://unused'
};

const closers: Array<() => Promise<unknown>> = [];

afterEach(async () => {
  await Promise.all(closers.splice(0).map(async (close) => close()));
});

async function createStack(bootstrapAdminUid?: string) {
  const idp = createMockIdpServer();
  closers.push(async () => idp.close());

  const provider = new OAuth2IdentityProvider({
    config: {
      authorizeUrl: 'http://idp.test/authorize',
      tokenUrl: 'http://idp.test/token',
      userInfoUrl: 'http://idp.test/userinfo',
      clientId: 'local-dev',
      clientSecret: 'local-dev-secret',
      redirectUri: 'http://127.0.0.1:3000/api/auth/callback',
      scope: 'openid profile',
      claims: { uid: 'sub', displayName: 'name', teams: 'groups' }
    },
    fetchImpl: async (input, init) => {
      const url = new URL(
        typeof input === 'string' ? input : (input as URL).toString()
      );
      const response = await idp.inject({
        method: (init?.method ?? 'GET') as 'GET' | 'POST',
        url: `${url.pathname}${url.search}`,
        ...(init?.headers
          ? { headers: init.headers as Record<string, string> }
          : {}),
        ...(init?.body ? { payload: init.body as string } : {})
      });
      return new Response(response.body, {
        status: response.statusCode,
        headers: response.headers as Record<string, string>
      });
    }
  });

  const config = {
    ...baseConfig,
    ...(bootstrapAdminUid ? { bootstrapAdminUid } : {})
  };
  const repository = new MemoryIdentityRepository();
  const app = await createApp({
    config,
    database,
    modules: [createIdentityModule({ config, repository, provider })]
  });
  closers.push(async () => app.close());
  return { app, idp, repository };
}

async function signIn(
  app: Awaited<ReturnType<typeof createStack>>['app'],
  idp: ReturnType<typeof createMockIdpServer>,
  uid: string
): Promise<string> {
  const login = await app.inject({ method: 'GET', url: '/api/auth/login' });
  const authorize = new URL(login.headers.location as string);
  authorize.searchParams.set('uid', uid);
  const granted = await idp.inject({
    method: 'GET',
    url: `${authorize.pathname}${authorize.search}`
  });
  const callbackUrl = new URL(granted.headers.location as string);
  const callback = await app.inject({
    method: 'GET',
    url: `${callbackUrl.pathname}${callbackUrl.search}`
  });
  const setCookie = callback.headers['set-cookie'];
  const header = (Array.isArray(setCookie) ? setCookie[0] : setCookie) ?? '';
  return header.split(';')[0] as string;
}

async function rolesOf(
  app: Awaited<ReturnType<typeof createStack>>['app'],
  cookie: string
): Promise<Array<Record<string, unknown>>> {
  const me = await app.inject({
    method: 'GET',
    url: '/api/auth/me',
    headers: { cookie }
  });
  return me.json().roles as Array<Record<string, unknown>>;
}

describe('BOOTSTRAP_ADMIN_UID 授予首位平台管理員', () => {
  it('未配置時任何人登入都不會取得管理員', async () => {
    const { app, idp } = await createStack();
    const cookie = await signIn(app, idp, 'mock-admin');

    expect(await rolesOf(app, cookie)).toEqual([]);
  });

  it('指定的 uid 登入後取得 global platform_admin', async () => {
    const { app, idp } = await createStack('mock-admin');
    const cookie = await signIn(app, idp, 'mock-admin');

    expect(await rolesOf(app, cookie)).toEqual([
      { role: 'platform_admin', scopeType: 'global', scopeValue: '' }
    ]);
  });

  it('其他人登入不會被授予，即使已配置 bootstrap', async () => {
    const { app, idp } = await createStack('mock-admin');
    const cookie = await signIn(app, idp, 'mock-user');

    expect(await rolesOf(app, cookie)).toEqual([]);
  });

  it('重複登入不重複授予，角色只有一筆', async () => {
    const { app, idp } = await createStack('mock-admin');

    await signIn(app, idp, 'mock-admin');
    await signIn(app, idp, 'mock-admin');
    const cookie = await signIn(app, idp, 'mock-admin');

    expect(await rolesOf(app, cookie)).toHaveLength(1);
  });

  it('授予紀錄以 bootstrap 標示，與人為授予區分', async () => {
    const { app, idp, repository } = await createStack('mock-admin');
    await signIn(app, idp, 'mock-admin');

    const [assignment] = await repository.listActiveRoles('mock-admin');

    expect(assignment?.assignedByUid).toBe('bootstrap');
  });

  it('取得管理員後可實際指派審核人，證明授權鏈完整', async () => {
    const { app, idp } = await createStack('mock-admin');
    const cookie = await signIn(app, idp, 'mock-admin');
    // 先讓被指派者建立身份記錄
    await signIn(app, idp, 'mock-reviewer');

    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/reviewers',
      headers: { cookie },
      payload: {
        reviewerUid: 'mock-reviewer',
        packageType: 'skill',
        category: 'frontend'
      }
    });

    expect(response.statusCode).toBe(201);
  });
});

describe('grantBootstrapAdmin 的冪等語意', () => {
  it('已是管理員時不再授予，回傳 undefined', async () => {
    const repository = new MemoryIdentityRepository();
    const authorization = new AuthorizationService(repository);
    const now = new Date('2026-08-29T00:00:00.000Z');
    await repository.upsertIdentity({
      uid: 'admin-1',
      displayName: '管理員',
      teamIds: [],
      providerType: 'oidc',
      active: true,
      createdAt: now,
      updatedAt: now
    });

    expect(await authorization.grantBootstrapAdmin('admin-1')).toBeDefined();
    expect(await authorization.grantBootstrapAdmin('admin-1')).toBeUndefined();
    expect(await repository.listActiveRoles('admin-1')).toHaveLength(1);
  });
});
