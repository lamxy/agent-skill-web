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
import type { OidcConfig } from '../../src/shared/config/config.js';

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

function oidcConfig(overrides: Partial<OidcConfig> = {}): OidcConfig {
  return {
    authorizeUrl: 'http://idp.test/authorize',
    tokenUrl: 'http://idp.test/token',
    userInfoUrl: 'http://idp.test/userinfo',
    clientId: 'local-dev',
    clientSecret: 'local-dev-secret',
    redirectUri: 'http://127.0.0.1:3000/api/auth/callback',
    scope: 'openid profile',
    claims: { uid: 'sub', displayName: 'name', teams: 'groups' },
    ...overrides
  };
}

const closers: Array<() => Promise<unknown>> = [];

afterEach(async () => {
  await Promise.all(closers.splice(0).map(async (close) => close()));
});

/**
 * 讓 provider 的 fetch 直達 mock IdP 的 Fastify 實例，
 * 免去實際監聽 port，測試因此可平行執行。
 */
function createMockIdpFetch(
  server: ReturnType<typeof createMockIdpServer>
): typeof fetch {
  return async (input, init) => {
    const url = new URL(
      typeof input === 'string' ? input : (input as URL).toString()
    );
    const response = await server.inject({
      method: (init?.method ?? 'GET') as 'GET' | 'POST',
      url: `${url.pathname}${url.search}`,
      ...(init?.headers ? { headers: init.headers as Record<string, string> } : {}),
      ...(init?.body ? { payload: init.body as string } : {})
    });
    return new Response(response.body, {
      status: response.statusCode,
      headers: response.headers as Record<string, string>
    });
  };
}

async function createProviderWithMockIdp(options?: {
  config?: Partial<OidcConfig>;
  claims?: { uid: string; displayName: string; teams: string };
}) {
  const server = createMockIdpServer({
    ...(options?.claims ? { claims: options.claims } : {})
  });
  closers.push(async () => server.close());
  const provider = new OAuth2IdentityProvider({
    config: oidcConfig(options?.config ?? {}),
    fetchImpl: createMockIdpFetch(server)
  });
  return { server, provider };
}

/** 走完 authorize → callback 的轉導，取回 code 與 state。 */
async function authorizeAs(
  server: ReturnType<typeof createMockIdpServer>,
  redirectUrl: string,
  uid: string
): Promise<{ code: string; state: string }> {
  const authorize = new URL(redirectUrl);
  authorize.searchParams.set('uid', uid);
  const response = await server.inject({
    method: 'GET',
    url: `${authorize.pathname}${authorize.search}`
  });
  expect(response.statusCode).toBe(302);
  const callback = new URL(response.headers.location as string);
  return {
    code: callback.searchParams.get('code') ?? '',
    state: callback.searchParams.get('state') ?? ''
  };
}

describe('OAuth2IdentityProvider 對接 OAuth2 協議', () => {
  it('完成 authorize 轉導、code 交換與 userinfo 映射', async () => {
    const { server, provider } = await createProviderWithMockIdp();

    const { redirectUrl } = await provider.beginLogin({ returnTo: '/catalog' });
    const authorize = new URL(redirectUrl);
    expect(authorize.origin + authorize.pathname).toBe(
      'http://idp.test/authorize'
    );
    expect(authorize.searchParams.get('response_type')).toBe('code');
    expect(authorize.searchParams.get('client_id')).toBe('local-dev');
    expect(authorize.searchParams.get('state')).toBeTruthy();

    const { code, state } = await authorizeAs(
      server,
      redirectUrl,
      'mock-reviewer'
    );

    expect(provider.peekReturnTo(state)).toBe('/catalog');

    const identity = await provider.completeLogin({ code, state });
    expect(identity).toEqual({
      uid: 'mock-reviewer',
      displayName: '模擬審核人',
      teamIds: ['quality']
    });
  });

  it('依配置的 claim 名稱映射欄位，而非寫死 sub/name/groups', async () => {
    const claims = {
      uid: 'employee_id',
      displayName: 'full_name',
      teams: 'departments'
    };
    const { server, provider } = await createProviderWithMockIdp({
      claims,
      config: { claims }
    });

    const { redirectUrl } = await provider.beginLogin({ returnTo: '/' });
    const { code, state } = await authorizeAs(server, redirectUrl, 'mock-user');
    const identity = await provider.completeLogin({ code, state });

    expect(identity.uid).toBe('mock-user');
    expect(identity.displayName).toBe('模擬使用者');
    expect(identity.teamIds).toEqual(['development']);
  });

  it('拒絕沒有 state 或 state 不符的 callback', async () => {
    const { server, provider } = await createProviderWithMockIdp();
    const { redirectUrl } = await provider.beginLogin({ returnTo: '/' });
    const { code } = await authorizeAs(server, redirectUrl, 'mock-user');

    await expect(provider.completeLogin({ code })).rejects.toMatchObject({
      code: 'AUTHENTICATION_STATE_INVALID'
    });
    await expect(
      provider.completeLogin({ code, state: 'forged-state' })
    ).rejects.toMatchObject({ code: 'AUTHENTICATION_STATE_INVALID' });
  });

  it('state 為一次性，重放同一組 code 與 state 會被拒絕', async () => {
    const { server, provider } = await createProviderWithMockIdp();
    const { redirectUrl } = await provider.beginLogin({ returnTo: '/' });
    const { code, state } = await authorizeAs(server, redirectUrl, 'mock-user');

    await provider.completeLogin({ code, state });
    await expect(
      provider.completeLogin({ code, state })
    ).rejects.toMatchObject({ code: 'AUTHENTICATION_STATE_INVALID' });
  });

  it('code 交換失敗時回報驗證失敗，不洩露內部細節', async () => {
    const { server, provider } = await createProviderWithMockIdp();
    const { redirectUrl } = await provider.beginLogin({ returnTo: '/' });
    const { state } = await authorizeAs(server, redirectUrl, 'mock-user');

    await expect(
      provider.completeLogin({ code: 'never-issued', state })
    ).rejects.toMatchObject({ code: 'AUTHENTICATION_FAILED', statusCode: 401 });
  });

  it('IdP 無法連線時回報 502 而非讓請求掛住', async () => {
    const provider = new OAuth2IdentityProvider({
      config: oidcConfig(),
      fetchImpl: async () => {
        throw new Error('connection refused');
      }
    });
    const { redirectUrl } = await provider.beginLogin({ returnTo: '/' });
    const state = new URL(redirectUrl).searchParams.get('state') ?? '';

    await expect(
      provider.completeLogin({ code: 'any', state })
    ).rejects.toMatchObject({ code: 'IDENTITY_PROVIDER_UNREACHABLE' });
  });

  it('userinfo 缺少 uid claim 時拒絕建立身份', async () => {
    const { server, provider } = await createProviderWithMockIdp({
      config: { claims: { uid: 'missing_field', displayName: 'name', teams: 'groups' } }
    });
    const { redirectUrl } = await provider.beginLogin({ returnTo: '/' });
    const { code, state } = await authorizeAs(server, redirectUrl, 'mock-user');

    await expect(
      provider.completeLogin({ code, state })
    ).rejects.toMatchObject({ code: 'IDENTITY_CLAIM_MISSING' });
  });
});

describe('OAuth2 provider 接上登入端點', () => {
  it('登入後簽發 session，並轉回 state 登記的目的地', async () => {
    const { server, provider } = await createProviderWithMockIdp();
    const repository = new MemoryIdentityRepository();
    const app = await createApp({
      config: testConfig,
      database,
      modules: [createIdentityModule({ config: testConfig, repository, provider })]
    });
    closers.push(async () => app.close());

    const login = await app.inject({
      method: 'GET',
      url: '/api/auth/login?returnTo=/reviews'
    });
    expect(login.statusCode).toBe(302);

    const { code, state } = await authorizeAs(
      server,
      login.headers.location as string,
      'mock-admin'
    );

    const callback = await app.inject({
      method: 'GET',
      url: `/api/auth/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`
    });
    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toBe('/reviews');

    const setCookie = callback.headers['set-cookie'];
    const cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie) ?? '';
    expect(cookie).toContain('HttpOnly');

    const me = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: cookie.split(';')[0] as string }
    });
    expect(me.json()).toMatchObject({
      kind: 'authenticated',
      uid: 'mock-admin',
      displayName: '模擬管理員',
      teamIds: ['platform']
    });

    // 身份以 oidc 來源落地，而非開發身份。
    const stored = await repository.findIdentity('mock-admin');
    expect(stored?.providerType).toBe('oidc');
  });

  it('外部轉導目的地一律被擋下', async () => {
    const { server, provider } = await createProviderWithMockIdp();
    const repository = new MemoryIdentityRepository();
    const app = await createApp({
      config: testConfig,
      database,
      modules: [createIdentityModule({ config: testConfig, repository, provider })]
    });
    closers.push(async () => app.close());

    const login = await app.inject({
      method: 'GET',
      url: '/api/auth/login?returnTo=https://evil.example/steal'
    });
    const { code, state } = await authorizeAs(
      server,
      login.headers.location as string,
      'mock-user'
    );
    const callback = await app.inject({
      method: 'GET',
      url: `/api/auth/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`
    });

    expect(callback.headers.location).toBe('/');
  });
});
