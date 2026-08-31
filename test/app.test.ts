// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import type { FastifyPluginAsync } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import { AppError } from '../src/shared/errors/app-error.js';

const config = {
  environment: 'test' as const,
  host: '127.0.0.1',
  port: 3000,
  logLevel: 'silent' as const,
  databaseUrl: 'postgresql://unused'
};

const apps: Array<Awaited<ReturnType<typeof createApp>>> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

describe('createApp', () => {
  it('reports application and database readiness', async () => {
    const app = await createApp({
      config,
      database: { ping: async () => undefined, close: async () => undefined }
    });
    apps.push(app);

    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', database: 'up' });
  });

  it('returns a degraded health response when PostgreSQL is unavailable', async () => {
    const app = await createApp({
      config,
      database: {
        ping: async () => {
          throw new Error('connection refused');
        },
        close: async () => undefined
      }
    });
    apps.push(app);

    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: 'degraded', database: 'down' });
  });

  it('registers every domain module through Fastify plugin boundaries', async () => {
    const app = await createApp({
      config,
      database: { ping: async () => undefined, close: async () => undefined }
    });
    apps.push(app);
    await app.ready();

    expect(
      [
        'identity-module',
        'catalog-module',
        'script-generator-module',
        'governance-module',
        'telemetry-module',
        'analytics-module',
        'audit-module'
      ].every((name) => app.hasPlugin(name))
    ).toBe(true);
  });

  it('publishes OpenAPI JSON for registered routes', async () => {
    const app = await createApp({
      config,
      database: { ping: async () => undefined, close: async () => undefined }
    });
    apps.push(app);

    const response = await app.inject({ method: 'GET', url: '/docs/json' });
    const document = response.json();

    expect(response.statusCode).toBe(200);
    expect(document.openapi).toBe('3.0.3');
    expect(document.paths['/health']).toBeDefined();
    expect(document.paths['/api/telemetry/report']?.post).toBeDefined();
  });

  it('預設記憶體組裝讓身份管理操作立即出現在審計查詢', async () => {
    const app = await createApp({
      config,
      database: { ping: async () => undefined, close: async () => undefined }
    });
    apps.push(app);
    const reviewerLogin = await app.inject({
      method: 'GET',
      url: '/api/auth/callback?code=dev-user'
    });
    expect(reviewerLogin.statusCode).toBe(302);
    const adminLogin = await app.inject({
      method: 'GET',
      url: '/api/auth/callback?code=dev-admin'
    });
    const setCookie = adminLogin.headers['set-cookie'];
    const cookieHeader = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    const adminCookie = cookieHeader?.split(';')[0];
    if (!adminCookie) throw new Error('開發管理員登入缺少 Cookie');

    const assigned = await app.inject({
      method: 'POST',
      url: '/api/admin/reviewers',
      headers: { cookie: adminCookie },
      payload: {
        reviewerUid: 'dev-user',
        packageType: 'skill',
        category: 'frontend'
      }
    });
    const audits = await app.inject({
      method: 'GET',
      url: '/api/audit/logs?eventType=reviewer.assigned',
      headers: { cookie: adminCookie }
    });

    expect(assigned.statusCode).toBe(201);
    expect(audits.statusCode).toBe(200);
    expect(audits.json()).toMatchObject({
      items: [
        {
          eventType: 'reviewer.assigned',
          actorUid: 'dev-admin',
          action: 'assign_reviewer'
        }
      ]
    });
  });

  it('normalizes application and request validation failures', async () => {
    const failingModule: FastifyPluginAsync = async (app) => {
      app.get('/failure', async () => {
        throw new AppError({
          statusCode: 409,
          code: 'PACKAGE_CONFLICT',
          message: 'Package already exists'
        });
      });
      app.post(
        '/validated',
        {
          schema: {
            body: {
              type: 'object',
              required: ['name'],
              additionalProperties: false,
              properties: { name: { type: 'string', minLength: 1 } }
            }
          }
        },
        async () => ({ accepted: true })
      );
    };

    const app = await createApp({
      config,
      database: { ping: async () => undefined, close: async () => undefined },
      modules: [failingModule]
    });
    apps.push(app);

    const conflict = await app.inject({ method: 'GET', url: '/failure' });
    const invalid = await app.inject({
      method: 'POST',
      url: '/validated',
      payload: {}
    });

    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toEqual({
      error: { code: 'PACKAGE_CONFLICT', message: 'Package already exists' }
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toEqual({
      error: { code: 'VALIDATION_ERROR', message: '請求欄位驗證失敗' }
    });
  });
});
