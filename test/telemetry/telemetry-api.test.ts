// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { MemoryCatalogRepository } from '../../src/modules/catalog/memory-catalog-repository.js';
import { createTelemetryModule } from '../../src/modules/telemetry/index.js';
import { MemoryTelemetryRepository } from '../../src/modules/telemetry/memory-telemetry-repository.js';
import { registerErrorHandler } from '../../src/shared/errors/error-handler.js';

const apps: Array<ReturnType<typeof Fastify>> = [];
const now = new Date('2026-08-25T00:00:00.000Z');

function payload(overrides: Record<string, unknown> = {}) {
  return {
    idempotency_key: '123e4567-e89b-42d3-a456-426614174000',
    package_id: 'telemetry-skill',
    version: '1.0.0',
    user_ref: 'developer-1',
    user_ref_type: 'uid',
    os_type: 'wsl',
    client_runtime: 'codex',
    status: 'succeeded',
    start_time: '2026-08-25T01:00:00.000Z',
    end_time: '2026-08-25T01:00:10.000Z',
    ...overrides
  };
}

function createRepository() {
  const catalog = new MemoryCatalogRepository({
    packages: [{
      packageId: 'telemetry-skill',
      type: 'skill',
      name: '遙測測試技能',
      purpose: '驗證公開遙測 API',
      ownerTeam: 'platform',
      category: 'backend',
      visibility: 'public',
      sourceUri: 'https://example.invalid/telemetry-skill',
      license: 'MIT',
      lifecycle: 'active',
      createdAt: now,
      updatedAt: now
    }],
    versions: [{
      id: '1',
      packageId: 'telemetry-skill',
      version: '1.0.0',
      supportedOs: ['wsl'],
      supportedClients: [{
        name: 'codex',
        adaptationSource: 'publisher',
        maintainer: 'platform'
      }],
      lifecycle: 'published',
      installCommand: 'install telemetry-skill',
      uninstallCommand: 'uninstall telemetry-skill',
      hasResidualEffects: false,
      authorUid: 'publisher-1',
      createdAt: now,
      updatedAt: now
    }]
  });
  return new MemoryTelemetryRepository(catalog.store);
}

async function createApi(logLines?: string[]) {
  const app = Fastify({
    logger: logLines
      ? {
          level: 'warn',
          stream: { write: (line: string) => logLines.push(line) }
        }
      : false
  });
  apps.push(app);
  registerErrorHandler(app);
  await app.register(createTelemetryModule({ repository: createRepository() }));
  return app;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

describe('公開遙測 API', () => {
  it('不需 session 即可首寫，重送相同內容回 duplicate', async () => {
    const app = await createApi();

    const first = await app.inject({
      method: 'POST', url: '/api/telemetry/report', payload: payload()
    });
    const duplicate = await app.inject({
      method: 'POST', url: '/api/telemetry/report', payload: payload()
    });

    expect(first.statusCode).toBe(201);
    expect(first.json()).toEqual({
      duplicate: false,
      installationStatus: 'succeeded',
      telemetrySyncStatus: 'synced'
    });
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json()).toEqual({
      duplicate: true,
      installationStatus: 'succeeded',
      telemetrySyncStatus: 'synced'
    });
  });

  it('拒絕同 key 不同內容，未知版本回 404', async () => {
    const app = await createApi();
    await app.inject({
      method: 'POST', url: '/api/telemetry/report', payload: payload()
    });

    const conflict = await app.inject({
      method: 'POST',
      url: '/api/telemetry/report',
      payload: payload({ status: 'uninstalled' })
    });
    const unknown = await app.inject({
      method: 'POST',
      url: '/api/telemetry/report',
      payload: payload({
        idempotency_key: '123e4567-e89b-42d3-a456-426614174001',
        version: '9.9.9'
      })
    });

    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toEqual({
      error: {
        code: 'IDEMPOTENCY_KEY_CONFLICT',
        message: '冪等鍵已對應不同遙測內容'
      }
    });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json()).toEqual({
      error: { code: 'PACKAGE_VERSION_NOT_FOUND', message: '找不到套件版本' }
    });
  });

  it('額外欄位只記錄欄位名，不記錄值或完整 payload', async () => {
    const logLines: string[] = [];
    const app = await createApi(logLines);

    const response = await app.inject({
      method: 'POST',
      url: '/api/telemetry/report',
      payload: payload({ secret: '不得記錄的密鑰值' })
    });
    const logs = logLines.join('');

    expect(response.statusCode).toBe(201);
    expect(logs).toContain('"droppedFields":["secret"]');
    expect(logs).not.toContain('不得記錄的密鑰值');
    expect(logs).not.toContain('"payload"');
  });

  it('接受 Task 13 新欄位並在 HTTP schema 擋下非 primitive option', async () => {
    const app = await createApi();

    const accepted = await app.inject({
      method: 'POST',
      url: '/api/telemetry/report',
      payload: payload({ script_version: 2, options: { '--scope': 'workspace', '--verify': true } })
    });
    const changedOption = await app.inject({
      method: 'POST',
      url: '/api/telemetry/report',
      payload: payload({ script_version: 2, options: { '--scope': 'user', '--verify': true } })
    });
    const rejected = await app.inject({
      method: 'POST',
      url: '/api/telemetry/report',
      payload: payload({
        idempotency_key: '123e4567-e89b-42d3-a456-426614174001',
        script_version: 2,
        options: { '--scope': { secret: true } }
      })
    });

    expect(accepted.statusCode).toBe(201);
    expect(changedOption.statusCode).toBe(409);
    expect(rejected.statusCode).toBe(400);
  });
});
