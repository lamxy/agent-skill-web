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
  const login = await app.inject({
    method: 'GET',
    url: '/api/auth/callback?code=dev-admin'
  });
  const setCookie = login.headers['set-cookie'];
  const cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie)?.split(';')[0];
  if (!cookie) throw new Error('管理員登入缺少 Cookie');

  await app.inject({
    method: 'POST', url: '/api/packages', headers: { cookie },
    payload: {
      packageId: 'support-demo', type: 'skill', name: '支援示範技能',
      purpose: '驗證支援入口與反饋', ownerTeam: 'platform', category: 'frontend',
      categoryCode: 'frontend', visibility: 'public',
      sourceUri: 'https://example.invalid/support-demo',
      license: 'MIT', source: 'custom',
      publisher: { kind: 'organization', name: '平台組' }
    }
  });
  await app.inject({
    method: 'POST', url: '/api/packages/support-demo/versions', headers: { cookie },
    payload: { version: '1.0.0', releaseNotes: '首版' }
  });
  return { app, cookie };
}

const imChannel = {
  channelType: 'im_group',
  label: '技能支援群',
  address: 'https://im.example.invalid/g/support'
};

describe('支援入口 API', () => {
  it('整組覆寫並讓匿名使用者讀得到公開套件的支援入口', async () => {
    const { app, cookie } = await createFixture();

    const saved = await app.inject({
      method: 'PUT', url: '/api/packages/support-demo/support-channels',
      headers: { cookie },
      payload: {
        channels: [
          imChannel,
          { channelType: 'email', label: '支援信箱', address: 'support@example.invalid' }
        ]
      }
    });
    // 匿名讀取：遇到問題的人不該被要求先登入才看得到求助管道
    const anonymousRead = await app.inject({
      method: 'GET', url: '/api/packages/support-demo/support-channels'
    });
    // 再次送出只含一筆的清單，未列出的既有渠道應被刪除
    const replaced = await app.inject({
      method: 'PUT', url: '/api/packages/support-demo/support-channels',
      headers: { cookie }, payload: { channels: [imChannel] }
    });

    expect(saved.statusCode).toBe(200);
    expect(saved.json().items).toHaveLength(2);
    expect(anonymousRead.statusCode).toBe(200);
    expect(anonymousRead.json()).toMatchObject({ state: 'success' });
    expect(replaced.json().items).toHaveLength(1);
    expect(replaced.json().items[0]).toMatchObject({ channelType: 'im_group' });
  });

  it('拒絕匿名寫入與不支援的渠道類型', async () => {
    const { app, cookie } = await createFixture();

    const anonymousWrite = await app.inject({
      method: 'PUT', url: '/api/packages/support-demo/support-channels',
      payload: { channels: [imChannel] }
    });
    const badType = await app.inject({
      method: 'PUT', url: '/api/packages/support-demo/support-channels',
      headers: { cookie },
      payload: { channels: [{ ...imChannel, channelType: 'carrier_pigeon' }] }
    });
    const tooMany = await app.inject({
      method: 'PUT', url: '/api/packages/support-demo/support-channels',
      headers: { cookie },
      payload: {
        channels: Array.from({ length: 11 }, (_, index) => ({
          ...imChannel, address: `https://im.example.invalid/g/${index}`
        }))
      }
    });

    expect(anonymousWrite.statusCode).toBe(401);
    expect(badType.statusCode).toBe(400);
    expect(tooMany.statusCode).toBe(400);
  });
});

const feedbackPayload = {
  version: '1.0.0',
  satisfaction: 4,
  issueCategory: 'documentation',
  detail: '使用說明缺少 WSL 前置條件。'
};

describe('結構化反饋 API', () => {
  it('接受匿名提交，但明細只有維護者讀得到', async () => {
    const { app, cookie } = await createFixture();

    const anonymousSubmit = await app.inject({
      method: 'POST', url: '/api/packages/support-demo/feedback',
      payload: feedbackPayload
    });
    const anonymousRead = await app.inject({
      method: 'GET', url: '/api/packages/support-demo/feedback'
    });
    const maintainerRead = await app.inject({
      method: 'GET', url: '/api/packages/support-demo/feedback', headers: { cookie }
    });

    expect(anonymousSubmit.statusCode).toBe(201);
    expect(anonymousSubmit.json()).toMatchObject({
      authorRefType: 'uuid', status: 'open', needsHumanSupport: false
    });
    expect(anonymousRead.statusCode).toBe(401);
    expect(maintainerRead.statusCode).toBe(200);
    expect(maintainerRead.json().items).toHaveLength(1);
  });

  it('統計固定回傳全部七個分類，無樣本時平均為 null', async () => {
    const { app, cookie } = await createFixture();

    const empty = await app.inject({
      method: 'GET', url: '/api/packages/support-demo/feedback/summary',
      headers: { cookie }
    });
    await app.inject({
      method: 'POST', url: '/api/packages/support-demo/feedback',
      headers: { cookie },
      payload: { ...feedbackPayload, satisfaction: 2, needsHumanSupport: true }
    });
    await app.inject({
      method: 'POST', url: '/api/packages/support-demo/feedback',
      headers: { cookie }, payload: { ...feedbackPayload, satisfaction: 4 }
    });
    const filled = await app.inject({
      method: 'GET', url: '/api/packages/support-demo/feedback/summary',
      headers: { cookie }
    });

    expect(empty.json()).toMatchObject({
      total: 0, averageSatisfaction: null, needsHumanSupport: 0
    });
    expect(empty.json().byCategory).toHaveLength(7);
    expect(filled.json()).toMatchObject({
      total: 2, averageSatisfaction: 3, needsHumanSupport: 1, openNeedsHumanSupport: 1
    });
  });

  it('維護者變更處理狀態後不再計入待處理', async () => {
    const { app, cookie } = await createFixture();
    const created = await app.inject({
      method: 'POST', url: '/api/packages/support-demo/feedback',
      headers: { cookie }, payload: { ...feedbackPayload, needsHumanSupport: true }
    });
    const feedbackId = created.json().id as string;

    const resolved = await app.inject({
      method: 'PATCH', url: `/api/feedback/${feedbackId}`,
      headers: { cookie }, payload: { status: 'resolved' }
    });
    const summary = await app.inject({
      method: 'GET', url: '/api/packages/support-demo/feedback/summary',
      headers: { cookie }
    });

    expect(resolved.json()).toMatchObject({ status: 'resolved' });
    expect(summary.json()).toMatchObject({
      needsHumanSupport: 1, openNeedsHumanSupport: 0
    });
  });

  it('拒絕不存在的版本、空白描述與越界滿意度', async () => {
    const { app, cookie } = await createFixture();

    const unknownVersion = await app.inject({
      method: 'POST', url: '/api/packages/support-demo/feedback',
      headers: { cookie }, payload: { ...feedbackPayload, version: '9.9.9' }
    });
    const blankDetail = await app.inject({
      method: 'POST', url: '/api/packages/support-demo/feedback',
      headers: { cookie }, payload: { ...feedbackPayload, detail: '   ' }
    });
    const badSatisfaction = await app.inject({
      method: 'POST', url: '/api/packages/support-demo/feedback',
      headers: { cookie }, payload: { ...feedbackPayload, satisfaction: 9 }
    });

    expect(unknownVersion.statusCode).toBe(404);
    expect(blankDetail.statusCode).toBe(400);
    expect(badSatisfaction.statusCode).toBe(400);
  });
});

describe('版本差異 API', () => {
  it('只比較呼叫者看得到的版本', async () => {
    const { app, cookie } = await createFixture();

    // 兩個版本都還在 draft，未發布故對匿名不可見
    const anonymousDiff = await app.inject({
      method: 'GET', url: '/api/packages/support-demo/versions/1.0.0/diff/2.0.0'
    });
    const unknownTarget = await app.inject({
      method: 'GET', url: '/api/packages/support-demo/versions/1.0.0/diff/9.9.9',
      headers: { cookie }
    });

    expect(anonymousDiff.statusCode).toBe(404);
    expect(unknownTarget.statusCode).toBe(404);
  });
});
