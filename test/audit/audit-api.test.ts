// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { afterEach, describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import { AuditService } from '../../src/modules/audit/audit-service.js';
import { createAuditModule } from '../../src/modules/audit/index.js';
import { MemoryAuditRepository } from '../../src/modules/audit/memory-audit-repository.js';
import { DevelopmentIdentityProvider } from '../../src/modules/identity/identity-provider.js';
import { createIdentityModule } from '../../src/modules/identity/index.js';
import { MemoryIdentityRepository } from '../../src/modules/identity/memory-identity-repository.js';

const now = new Date('2026-08-25T08:00:00.000Z');
const config = {
  environment: 'test' as const,
  host: '127.0.0.1',
  port: 3000,
  logLevel: 'silent' as const,
  databaseUrl: 'postgresql://unused'
};
const database = {
  ping: async () => undefined,
  close: async () => undefined
};
const fixtures = [
  { uid: 'dev-admin', displayName: '開發管理員', teamIds: ['platform'] },
  { uid: 'user-1', displayName: '一般使用者', teamIds: ['team-a'] }
];
const apps: Array<Awaited<ReturnType<typeof createApp>>> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

function cookieFrom(setCookie: string | string[] | undefined): string {
  const value = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  const cookie = value?.split(';')[0];
  if (!cookie) throw new Error('登入回應缺少 Cookie');
  return cookie;
}

async function createAuditApp() {
  const identityRepository = new MemoryIdentityRepository();
  const auditRepository = new MemoryAuditRepository();
  const provider = new DevelopmentIdentityProvider(fixtures);
  let tokenSequence = 0;
  const app = await createApp({
    config,
    database,
    modules: [
      createIdentityModule({
        config,
        repository: identityRepository,
        provider,
        clock: () => now,
        sessionTokenFactory: () => `audit-session-${++tokenSequence}`
      }),
      createAuditModule({
        config,
        identityRepository,
        auditRepository,
        clock: () => now
      })
    ]
  });
  apps.push(app);
  return { app, auditService: new AuditService(auditRepository, () => now) };
}

async function login(
  app: Awaited<ReturnType<typeof createApp>>,
  uid: string
): Promise<string> {
  const response = await app.inject({
    method: 'GET',
    url: `/api/auth/callback?code=${uid}`
  });
  expect(response.statusCode).toBe(302);
  return cookieFrom(response.headers['set-cookie']);
}

describe('GET /api/audit/logs', () => {
  it('平臺管理員可組合過濾並取得游標分頁', async () => {
    const { app, auditService } = await createAuditApp();
    const adminCookie = await login(app, 'dev-admin');
    await auditService.record({
      eventType: 'reviewer.assigned',
      actorUid: 'admin-1',
      targetType: 'role',
      targetId: 'assignment-1',
      action: 'assign_reviewer',
      details: { category: 'frontend' },
      occurredAt: new Date('2026-08-25T06:00:00.000Z')
    });
    await auditService.record({
      eventType: 'reviewer.revoked',
      actorUid: 'admin-1',
      targetType: 'role',
      targetId: 'assignment-1',
      action: 'revoke_reviewer',
      details: { category: 'frontend' },
      occurredAt: new Date('2026-08-25T07:00:00.000Z')
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/audit/logs?actorUid=admin-1&targetType=role&targetId=assignment-1&limit=1',
      headers: { cookie: adminCookie }
    });
    const first = response.json<{
      items: Array<{ eventType: string; occurredAt: string }>;
      nextCursor: string;
    }>();
    const next = await app.inject({
      method: 'GET',
      url: `/api/audit/logs?limit=1&cursor=${encodeURIComponent(first.nextCursor)}`,
      headers: { cookie: adminCookie }
    });

    expect(response.statusCode).toBe(200);
    expect(first.items).toEqual([
      {
        id: '2',
        eventType: 'reviewer.revoked',
        actorUid: 'admin-1',
        targetType: 'role',
        targetId: 'assignment-1',
        action: 'revoke_reviewer',
        details: { category: 'frontend' },
        occurredAt: '2026-08-25T07:00:00.000Z'
      }
    ]);
    expect(first.nextCursor).toEqual(expect.any(String));
    expect(next.json()).toMatchObject({
      items: [{ id: '1', eventType: 'reviewer.assigned' }]
    });
  });

  it('一般登入使用者沒有平臺管理員角色時回 403', async () => {
    const { app } = await createAuditApp();
    const userCookie = await login(app, 'user-1');

    const response = await app.inject({
      method: 'GET',
      url: '/api/audit/logs',
      headers: { cookie: userCookie }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });
  });

  it('匿名訪客查詢審計時回 401', async () => {
    const { app } = await createAuditApp();

    const response = await app.inject({
      method: 'GET',
      url: '/api/audit/logs'
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      error: { code: 'AUTHENTICATION_REQUIRED' }
    });
  });
});
