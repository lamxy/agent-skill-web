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

describe('維護清單端點', () => {
  it('mine 不會被當成 packageId 落入詳情路由', async () => {
    /*
     * 路由註冊順序的迴歸測試。/api/packages/:packageId 若先註冊，
     * mine 會被當成套件識別碼，回傳 404 而非清單——單元測試看不到這個問題。
     */
    const { app, cookie } = await createFixture();

    const response = await app.inject({
      method: 'GET', url: '/api/packages/mine', headers: { cookie }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveProperty('items');
    expect(response.json()).toHaveProperty('canIncludeAllTeams');
  });

  it('未登入時回 401', async () => {
    const { app } = await createFixture();

    const response = await app.inject({ method: 'GET', url: '/api/packages/mine' });

    expect(response.statusCode).toBe(401);
  });

  it('剛建立且尚無版本的套件立刻出現在清單', async () => {
    // 這是任務 16 的核心：建立後必須找得到入口回來填寫第一個版本。
    const { app, cookie } = await createFixture();
    await app.inject({
      method: 'POST', url: '/api/packages', headers: { cookie },
      payload: {
        packageId: 'brand-new-skill', type: 'skill', name: '全新技能',
        purpose: '驗證建立後可被找到', ownerTeam: 'platform', category: 'backend',
        categoryCode: 'backend', visibility: 'internal',
        sourceUri: 'https://example.invalid/brand-new-skill',
        license: 'MIT', source: 'custom',
        publisher: { kind: 'organization', name: '平台組' }
      }
    });

    const mine = await app.inject({
      method: 'GET', url: '/api/packages/mine', headers: { cookie }
    });
    const listed = mine.json().items.find(
      (item: { packageId: string }) => item.packageId === 'brand-new-skill'
    );

    expect(listed).toBeDefined();
    expect(listed.hasPublishedVersion).toBe(false);
    expect(listed.versionCount).toBe(0);

    // 對照組：技能池不該看到它，兩個端點的職責不同。
    const catalog = await app.inject({ method: 'GET', url: '/api/packages', headers: { cookie } });
    expect(
      catalog.json().items.map((item: { packageId: string }) => item.packageId)
    ).not.toContain('brand-new-skill');
  });

  it('管理員在自己 team 的套件上不會拿到空清單', async () => {
    /*
     * 迴歸測試：全域管理員不持有 team 範圍的 maintainer 角色。
     * 若清單只查 team 角色，管理員會看到空清單，卻能正常建立版本——
     * 授權判斷必須涵蓋 requireMaintainer 的三條路徑。
     */
    const { app, cookie } = await createFixture();
    await app.inject({
      method: 'POST', url: '/api/packages', headers: { cookie },
      payload: {
        packageId: 'admin-owned-skill', type: 'skill', name: '管理員建立的技能',
        purpose: '驗證管理員授權路徑', ownerTeam: 'platform', category: 'backend',
        categoryCode: 'backend', visibility: 'internal',
        sourceUri: 'https://example.invalid/admin-owned-skill',
        license: 'MIT', source: 'custom',
        publisher: { kind: 'organization', name: '平台組' }
      }
    });

    const mine = await app.inject({
      method: 'GET', url: '/api/packages/mine', headers: { cookie }
    });

    expect(mine.json().canIncludeAllTeams).toBe(true);
    expect(
      mine.json().items.map((item: { packageId: string }) => item.packageId)
    ).toContain('admin-owned-skill');
  });
});
