// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { afterEach, describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import { MemoryCatalogRepository } from '../../src/modules/catalog/memory-catalog-repository.js';

const config = {
  environment: 'test' as const,
  host: '127.0.0.1',
  port: 3000,
  logLevel: 'silent' as const,
  databaseUrl: 'postgresql://unused'
};
const database = { ping: async () => undefined, close: async () => undefined };
const apps: Array<Awaited<ReturnType<typeof createApp>>> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

async function createFixture() {
  const app = await createApp({
    config,
    database,
    catalog: { repository: new MemoryCatalogRepository() }
  });
  apps.push(app);
  const login = await app.inject({ method: 'GET', url: '/api/auth/callback?code=dev-admin' });
  const setCookie = login.headers['set-cookie'];
  const cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie)?.split(';')[0];
  if (!cookie) throw new Error('管理員登入缺少 Cookie');
  return { app, cookie };
}

describe('技能目錄 API', () => {
  it('完成套件 CRUD 並封鎖目錄 API 直接變更版本生命週期', async () => {
    const { app, cookie } = await createFixture();
    const created = await app.inject({
      method: 'POST', url: '/api/packages', headers: { cookie },
      payload: {
        packageId: 'frontend-quality', type: 'skill', name: '前端品質技能',
        purpose: '檢查頁面品質', ownerTeam: 'platform', category: 'frontend',
        categoryCode: 'frontend', visibility: 'public',
        sourceUri: 'https://example.invalid/frontend-quality', license: 'MIT',
        source: 'custom', publisher: { kind: 'organization', name: '平台組' }
      }
    });
    const updated = await app.inject({
      method: 'PATCH', url: '/api/packages/frontend-quality', headers: { cookie },
      payload: { purpose: '檢查頁面品質與相容性' }
    });
    const version = await app.inject({
      method: 'POST', url: '/api/packages/frontend-quality/versions', headers: { cookie },
      payload: { version: '1.0.0', releaseNotes: '首版' }
    });
    const forbiddenCreateLifecycle = await app.inject({
      method: 'POST', url: '/api/packages/frontend-quality/versions', headers: { cookie },
      payload: {
        version: '2.0.0', lifecycle: 'published'
      }
    });
    const hiddenDownload = await app.inject({
      method: 'GET', url: '/api/packages/frontend-quality/versions/1.0.0/download', headers: { cookie }
    });
    const forbiddenLifecycle = await app.inject({
      method: 'PATCH', url: '/api/packages/frontend-quality/versions/1.0.0', headers: { cookie },
      payload: { lifecycle: 'published', scriptDigest: 'sha256:quality' }
    });
    const revisedDraft = await app.inject({
      method: 'PATCH', url: '/api/packages/frontend-quality/versions/1.0.0', headers: { cookie },
      payload: { scriptDigest: 'sha256:quality', releaseNotes: '草稿修訂' }
    });
    const archived = await app.inject({
      method: 'DELETE', url: '/api/packages/frontend-quality', headers: { cookie }
    });
    const afterArchive = await app.inject({ method: 'GET', url: '/api/packages' });

    expect(created.statusCode).toBe(201);
    expect(version.statusCode).toBe(201);
    expect(forbiddenCreateLifecycle.statusCode).toBe(400);
    expect(hiddenDownload.statusCode).toBe(404);
    expect(forbiddenLifecycle.statusCode).toBe(400);
    expect(forbiddenLifecycle.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    expect(revisedDraft.json()).toMatchObject({ lifecycle: 'draft', releaseNotes: '草稿修訂' });
    expect(updated.json()).toMatchObject({ purpose: '檢查頁面品質與相容性' });
    expect(archived.json()).toMatchObject({ lifecycle: 'archived' });
    expect(afterArchive.json()).toEqual({ items: [], state: 'empty' });
  });

  it('匿名使用者不能建立套件且請求欄位受 schema 約束', async () => {
    const { app } = await createFixture();
    const unauthenticated = await app.inject({ method: 'POST', url: '/api/packages', payload: {
      packageId: 'x', type: 'skill', name: 'X', purpose: 'X', ownerTeam: 'x', category: 'x',
      categoryCode: 'general', visibility: 'public', sourceUri: 'x', license: 'MIT',
      source: 'custom', publisher: { kind: 'organization', name: 'X' }
    }});
    const invalid = await app.inject({ method: 'GET', url: '/api/packages?limit=101' });

    expect(unauthenticated.statusCode).toBe(401);
    expect(invalid.statusCode).toBe(400);
  });

  it('以精確 target 路徑完成空 target、版本、複製、歷史與軟刪除', async () => {
    const { app, cookie } = await createFixture();
    await app.inject({
      method: 'POST', url: '/api/packages', headers: { cookie }, payload: {
        packageId: 'matrix-api', type: 'skill', name: 'Matrix API', purpose: '測試 target API',
        ownerTeam: 'platform', category: 'backend', categoryCode: 'backend',
        visibility: 'internal',
        sourceUri: 'https://example.invalid/matrix-api', license: 'MIT',
        source: 'custom', publisher: { kind: 'organization', name: '平台組' }
      }
    });
    const draft = await app.inject({
      method: 'POST', url: '/api/packages/matrix-api/versions', headers: { cookie },
      payload: { version: '1.0.0', releaseNotes: '空草稿' }
    });
    const sourcePending = await app.inject({
      method: 'POST', url: '/api/packages/matrix-api/versions/1.0.0/script-targets', headers: { cookie },
      payload: { targetOs: 'linux/macos', clientRuntime: 'codex' }
    });
    const sourceId = sourcePending.json().id as string;
    const sourceV1 = await app.inject({
      method: 'PUT', url: `/api/packages/matrix-api/versions/1.0.0/script-targets/${sourceId}`, headers: { cookie },
      payload: {
        expectedScriptVersion: 0, installCommand: 'install source', uninstallCommand: 'uninstall source',
        options: [{ name: '--scope', type: 'select', description: '安裝範圍', defaultValue: 'user', choices: ['user', 'project'] }],
        usageInstructions: '執行來源腳本。', hasResidualEffects: false, changeDescription: '初版'
      }
    });
    const sourceV2 = await app.inject({
      method: 'PUT', url: `/api/packages/matrix-api/versions/1.0.0/script-targets/${sourceId}`, headers: { cookie },
      payload: {
        expectedScriptVersion: 1, installCommand: 'install source v2', uninstallCommand: 'uninstall source',
        options: [], usageInstructions: '執行來源腳本。', hasResidualEffects: false
      }
    });
    const destinationPending = await app.inject({
      method: 'POST', url: '/api/packages/matrix-api/versions/1.0.0/script-targets', headers: { cookie },
      payload: { targetOs: 'windows', clientRuntime: 'claude-code' }
    });
    const destinationId = destinationPending.json().id as string;
    const copied = await app.inject({
      method: 'POST', url: `/api/packages/matrix-api/versions/1.0.0/script-targets/${destinationId}/copy-from`, headers: { cookie },
      payload: { sourceTargetId: sourceId, expectedScriptVersion: 0, changeDescription: '跨組合複製' }
    });
    const history = await app.inject({
      method: 'GET', url: `/api/packages/matrix-api/versions/1.0.0/script-targets/${sourceId}/revisions`, headers: { cookie }
    });
    const stale = await app.inject({
      method: 'PUT', url: `/api/packages/matrix-api/versions/1.0.0/script-targets/${sourceId}`, headers: { cookie },
      payload: {
        expectedScriptVersion: 1, installCommand: 'stale', uninstallCommand: 'stale',
        options: [], usageInstructions: 'stale', hasResidualEffects: false
      }
    });
    const deleted = await app.inject({
      method: 'DELETE', url: `/api/packages/matrix-api/versions/1.0.0/script-targets/${destinationId}`, headers: { cookie },
      payload: { expectedScriptVersion: 1 }
    });
    const reloaded = await app.inject({
      method: 'GET', url: '/api/packages/matrix-api/versions/1.0.0', headers: { cookie }
    });

    expect(draft.statusCode).toBe(201);
    expect(draft.json()).toMatchObject({ version: '1.0.0', lifecycle: 'draft', scriptTargets: [] });
    expect(sourcePending.statusCode).toBe(201);
    expect(sourcePending.json().currentRevision).toBeUndefined();
    expect(sourceV1.json().currentRevision.scriptVersion).toBe(1);
    expect(sourceV2.json().currentRevision.scriptVersion).toBe(2);
    expect(copied.json().currentRevision.copiedFrom).toMatchObject({ targetId: sourceId, scriptVersion: 2 });
    expect(history.json().map((revision: { scriptVersion: number }) => revision.scriptVersion)).toEqual([1, 2]);
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ error: { code: 'SCRIPT_TARGET_REVISION_CONFLICT' } });
    expect(deleted.json().currentRevision).toBeUndefined();
    expect(reloaded.json().scriptTargets).toHaveLength(1);
    expect(reloaded.json().scriptTargets[0].id).toBe(sourceId);
  });

  it('target schema 限制 enum、options 並要求維護者授權', async () => {
    const { app, cookie } = await createFixture();
    await app.inject({
      method: 'POST', url: '/api/packages', headers: { cookie }, payload: {
        packageId: 'matrix-validation', type: 'skill', name: 'Matrix validation', purpose: '驗證 schema',
        ownerTeam: 'platform', category: 'backend', categoryCode: 'backend',
        visibility: 'internal',
        sourceUri: 'https://example.invalid/matrix-validation', license: 'MIT',
        source: 'custom', publisher: { kind: 'organization', name: '平台組' }
      }
    });
    await app.inject({
      method: 'POST', url: '/api/packages/matrix-validation/versions', headers: { cookie },
      payload: { version: '1.0.0' }
    });
    const invalidEnum = await app.inject({
      method: 'POST', url: '/api/packages/matrix-validation/versions/1.0.0/script-targets', headers: { cookie },
      payload: { targetOs: 'linux', clientRuntime: 'codex' }
    });
    const pending = await app.inject({
      method: 'POST', url: '/api/packages/matrix-validation/versions/1.0.0/script-targets', headers: { cookie },
      payload: { targetOs: 'wsl', clientRuntime: 'codex' }
    });
    const invalidOptions = await app.inject({
      method: 'PUT', url: `/api/packages/matrix-validation/versions/1.0.0/script-targets/${pending.json().id}`, headers: { cookie },
      payload: {
        expectedScriptVersion: 0, installCommand: 'install', uninstallCommand: 'uninstall',
        options: [{ name: 'scope', type: 'text', description: '錯誤', defaultValue: '' }],
        usageInstructions: '使用說明', hasResidualEffects: false
      }
    });
    const anonymousWrite = await app.inject({
      method: 'POST', url: '/api/packages/matrix-validation/versions/1.0.0/script-targets',
      payload: { targetOs: 'windows', clientRuntime: 'codex' }
    });
    const legacyWrite = await app.inject({
      method: 'POST', url: '/api/packages/matrix-validation/versions', headers: { cookie },
      payload: { version: '2.0.0', installCommand: 'legacy', uninstallCommand: 'legacy' }
    });
    const missingVersionBody = await app.inject({
      method: 'POST', url: '/api/packages/matrix-validation/versions', headers: { cookie }
    });

    expect(invalidEnum.statusCode).toBe(400);
    expect(invalidOptions.statusCode).toBe(400);
    expect(invalidOptions.json()).toMatchObject({ error: { code: 'INVALID_SCRIPT_OPTIONS' } });
    expect(anonymousWrite.statusCode).toBe(401);
    expect(legacyWrite.statusCode).toBe(400);
    expect(missingVersionBody.statusCode).toBe(400);
  });
});
