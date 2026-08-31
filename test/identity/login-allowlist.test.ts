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
import type { AppConfig } from '../../src/shared/config/config.js';

/**
 * LOGIN_ALLOWED_UIDS 白名單。公網部署時 IdP 可能對全網開放
 * （例如 GitHub OAuth），此時需要一道名單擋下非預期對象。
 *
 * 關鍵驗證：被拒者不得在 identities 留下任何記錄。
 */

const database = { ping: async () => undefined, close: async () => undefined };

const closers: Array<() => Promise<unknown>> = [];

afterEach(async () => {
  await Promise.all(closers.splice(0).map(async (close) => close()));
});

async function createStack(allowedUids?: readonly string[]) {
  const idp = createMockIdpServer();
  closers.push(async () => idp.close());

  const config: AppConfig = {
    environment: 'test',
    host: '127.0.0.1',
    port: 3000,
    logLevel: 'silent',
    databaseUrl: 'postgresql://unused',
    ...(allowedUids ? { loginAllowedUids: allowedUids } : {})
  };

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
    config,
    database,
    modules: [createIdentityModule({ config, repository, provider })]
  });
  closers.push(async () => app.close());
  return { app, idp, repository };
}

async function attemptSignIn(
  app: Awaited<ReturnType<typeof createStack>>['app'],
  idp: ReturnType<typeof createMockIdpServer>,
  uid: string
) {
  const login = await app.inject({ method: 'GET', url: '/api/auth/login' });
  const authorize = new URL(login.headers.location as string);
  authorize.searchParams.set('uid', uid);

  const granted = await idp.inject({
    method: 'GET',
    url: `${authorize.pathname}${authorize.search}`
  });
  const callbackUrl = new URL(granted.headers.location as string);

  return app.inject({
    method: 'GET',
    url: `${callbackUrl.pathname}${callbackUrl.search}`
  });
}

describe('登入白名單', () => {
  it('未設定白名單時任何通過 IdP 驗證者都能登入', async () => {
    const { app, idp } = await createStack();

    const response = await attemptSignIn(app, idp, 'mock-user');

    expect(response.statusCode).toBe(302);
    expect(response.headers['set-cookie']).toBeTruthy();
  });

  it('名單內的 uid 可正常登入', async () => {
    const { app, idp } = await createStack(['mock-user', 'mock-admin']);

    const response = await attemptSignIn(app, idp, 'mock-user');

    expect(response.statusCode).toBe(302);
    expect(response.headers['set-cookie']).toBeTruthy();
  });

  it('名單外的 uid 被拒絕且不發放 session', async () => {
    const { app, idp } = await createStack(['mock-admin']);

    const response = await attemptSignIn(app, idp, 'mock-user');

    expect(response.statusCode).toBe(403);
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('被拒絕者不得在 identities 留下記錄', async () => {
    const { app, idp, repository } = await createStack(['mock-admin']);

    await attemptSignIn(app, idp, 'mock-user');

    expect(await repository.findIdentity('mock-user')).toBeUndefined();
  });
});
