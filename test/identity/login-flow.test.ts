// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { afterEach, describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import { OAuth2IdentityProvider } from '../../src/modules/identity/identity-provider.js';
import { createIdentityModule } from '../../src/modules/identity/index.js';
import { MemoryIdentityRepository } from '../../src/modules/identity/memory-identity-repository.js';
import { createMockIdpServer } from '../../src/modules/identity/mock-idp-server.js';

/**
 * 端到端走完前端會經歷的登入流程：/api/auth/login → IdP → callback →
 * /api/auth/me → 登出。驗證前端 ViewerProvider 依賴的回應形狀確實成立。
 */

const database = { ping: async () => undefined, close: async () => undefined };
const testConfig = {
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

async function createStack() {
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

  const repository = new MemoryIdentityRepository();
  const app = await createApp({
    config: testConfig,
    database,
    modules: [createIdentityModule({ config: testConfig, repository, provider })]
  });
  closers.push(async () => app.close());
  return { app, idp, repository };
}

async function signIn(
  app: Awaited<ReturnType<typeof createStack>>['app'],
  idp: ReturnType<typeof createMockIdpServer>,
  uid: string,
  returnTo = '/'
): Promise<string> {
  const login = await app.inject({
    method: 'GET',
    url: `/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`
  });
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

describe('前端登入流程依賴的回應形狀', () => {
  it('未登入時 /api/auth/me 回匿名身份而非錯誤', async () => {
    const { app } = await createStack();

    const response = await app.inject({ method: 'GET', url: '/api/auth/me' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ kind: 'anonymous' });
    expect(response.json().anonymousId).toBeTruthy();
  });

  it('登入後回傳前端所需的 uid、姓名、團隊與角色欄位', async () => {
    const { app, idp } = await createStack();
    const cookie = await signIn(app, idp, 'mock-user');

    const me = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie }
    });

    expect(me.json()).toEqual({
      kind: 'authenticated',
      uid: 'mock-user',
      displayName: '模擬使用者',
      teamIds: ['development'],
      // 新登入的員工沒有任何角色：導覽只顯示技能池與個人頁。
      roles: []
    });
  });

  it('登出後回到匿名身份，匿名可用頁面仍能運作', async () => {
    const { app, idp } = await createStack();
    const cookie = await signIn(app, idp, 'mock-user');

    const loggedOut = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie }
    });
    expect(loggedOut.json()).toEqual({ loggedOut: true });

    const me = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie }
    });
    expect(me.json().kind).toBe('anonymous');
  });

  it('登入後轉回原本要去的頁面', async () => {
    const { app, idp } = await createStack();

    const login = await app.inject({
      method: 'GET',
      url: '/api/auth/login?returnTo=%2Fme%2Finstallations'
    });
    const authorize = new URL(login.headers.location as string);
    authorize.searchParams.set('uid', 'mock-admin');
    const granted = await idp.inject({
      method: 'GET',
      url: `${authorize.pathname}${authorize.search}`
    });
    const callbackUrl = new URL(granted.headers.location as string);
    const callback = await app.inject({
      method: 'GET',
      url: `${callbackUrl.pathname}${callbackUrl.search}`
    });

    expect(callback.headers.location).toBe('/me/installations');
  });

  it('角色授予後才出現在 /api/auth/me，供導覽決定入口', async () => {
    const { app, idp, repository } = await createStack();
    const cookie = await signIn(app, idp, 'mock-reviewer');

    const before = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie }
    });
    expect(before.json().roles).toEqual([]);

    await repository.grantRole({
      id: '00000000-0000-4000-8000-000000000001',
      uid: 'mock-reviewer',
      role: 'reviewer',
      scopeType: 'package_type',
      scopeValue: 'skill',
      assignedByUid: 'test',
      active: true,
      createdAt: new Date()
    });

    const after = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie }
    });
    expect(after.json().roles).toEqual([
      { role: 'reviewer', scopeType: 'package_type', scopeValue: 'skill' }
    ]);
  });
});
