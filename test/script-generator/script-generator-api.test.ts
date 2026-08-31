// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { afterEach, describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import { MemoryCatalogRepository } from '../../src/modules/catalog/memory-catalog-repository.js';

const now = new Date('2026-08-25T00:00:00.000Z');
const apps: Array<Awaited<ReturnType<typeof createApp>>> = [];
afterEach(async () => Promise.all(apps.splice(0).map(async (app) => app.close())));

function target(targetOs: 'linux/macos' | 'windows' | 'wsl', clientRuntime: 'codex' | 'claude-code') {
  const id = `target-${targetOs}-${clientRuntime}`;
  const currentRevision = {
    id: `${id}-v2`, targetId: id, targetOs, clientRuntime, scriptVersion: 2,
    installCommand: targetOs === 'windows' ? 'Write-Output installed' : 'printf installed',
    uninstallCommand: targetOs === 'windows' ? 'Write-Output removed' : 'printf removed',
    options: [{ name: '--scope', type: 'text' as const, description: '範圍', defaultValue: 'team' }],
    usageInstructions: '執行腳本', hasResidualEffects: false,
    contentDigest: `digest-${id}`, legacyImported: false,
    createdByUid: 'admin', createdAt: now
  };
  return {
    id, packageId: 'public-installer', packageVersion: '1.0.0', targetOs, clientRuntime,
    currentRevision, revisions: [currentRevision], createdAt: now, updatedAt: now
  };
}

async function fixture() {
  const repository = new MemoryCatalogRepository({
    packages: [{
      packageId: 'public-installer', type: 'skill', name: '公開安裝器', purpose: '測試安裝',
      ownerTeam: 'platform', category: 'general', visibility: 'public',
      sourceUri: 'https://example.invalid/public-installer', license: 'MIT', lifecycle: 'active',
      createdAt: now, updatedAt: now
    }],
    versions: [
      {
        id: '1', packageId: 'public-installer', version: '1.0.0', supportedOs: ['linux'],
        supportedClients: [{ name: 'codex', adaptationSource: 'publisher', maintainer: 'platform' }],
        lifecycle: 'published', installCommand: 'printf installed', uninstallCommand: 'printf removed',
        hasResidualEffects: false, scriptTargets: [
          target('linux/macos', 'codex'),
          target('wsl', 'claude-code')
        ], authorUid: 'admin', createdAt: now, updatedAt: now
      },
      {
        id: '2', packageId: 'public-installer', version: '1.1.0', supportedOs: ['windows'],
        supportedClients: [{ name: 'claude-code', adaptationSource: 'publisher', maintainer: 'platform' }],
        lifecycle: 'review_required', installCommand: 'Write-Output installed', uninstallCommand: 'Write-Output removed',
        hasResidualEffects: false, authorUid: 'admin', createdAt: now, updatedAt: now
      }
    ]
  });
  const app = await createApp({
    config: {
      environment: 'test', host: '127.0.0.1', port: 3000, logLevel: 'silent',
      databaseUrl: 'postgresql://unused', telemetryEndpoint: 'https://telemetry.example.invalid'
    },
    database: { ping: async () => undefined, close: async () => undefined },
    catalog: { repository }
  });
  apps.push(app);
  return app;
}

describe('腳本生成 API', () => {
  it('只為已發佈且聲明支援的 OS／Client 生成安裝與卸載腳本', async () => {
    const app = await fixture();
    const install = await app.inject({
      method: 'POST', url: '/api/packages/public-installer/versions/1.0.0/scripts',
      payload: { targetOs: 'linux/macos', clientRuntime: 'codex', selectedOptions: { '--scope': 'owner' } }
    });
    const uninstall = await app.inject({
      method: 'POST', url: '/api/packages/public-installer/versions/1.0.0/scripts',
      payload: { targetOs: 'linux/macos', clientRuntime: 'codex', action: 'uninstall' }
    });
    const unsupported = await app.inject({
      method: 'POST', url: '/api/packages/public-installer/versions/1.0.0/scripts',
      payload: { targetOs: 'windows', clientRuntime: 'codex' }
    });
    const pending = await app.inject({
      method: 'POST', url: '/api/packages/public-installer/versions/1.1.0/scripts',
      payload: { targetOs: 'windows', clientRuntime: 'claude-code' }
    });

    expect(install.statusCode).toBe(200);
    expect(install.json()).toMatchObject({
      action: 'install', targetOs: 'linux/macos', clientRuntime: 'codex', scriptVersion: 2,
      resolvedOptions: { '--scope': 'owner' },
      telemetryAssurance: 'best-effort'
    });
    expect(install.json<{ script: string }>().script).toContain('https://telemetry.example.invalid');
    expect(uninstall.json()).toMatchObject({ action: 'uninstall' });
    expect(uninstall.json<{ script: string }>().script).toContain("_ASP_INSTALL_STATUS='uninstalled'");
    expect(unsupported.statusCode).toBe(409);
    expect(unsupported.json()).toMatchObject({ error: { code: 'UNSUPPORTED_TARGET_OS' } });
    expect(pending.statusCode).toBe(404);
  });
});
