// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { describe, expect, it } from 'vitest';

import {
  parseCookieHeader,
  serializeIdentityCookie
} from '../../src/modules/identity/cookie.js';
import { MemoryIdentityRepository } from '../../src/modules/identity/memory-identity-repository.js';
import {
  hashSessionToken,
  SessionService
} from '../../src/modules/identity/session-service.js';
import { toInstallationUserReference } from '../../src/modules/identity/installation-user-reference.js';

const now = new Date('2026-08-25T00:00:00.000Z');

function createService(repository = new MemoryIdentityRepository()) {
  return {
    repository,
    service: new SessionService({
      repository,
      clock: () => now,
      sessionTokenFactory: () => 'deterministic-session-token',
      anonymousIdFactory: () => '123e4567-e89b-42d3-a456-426614174000'
    })
  };
}

describe('SessionService', () => {
  it('只保存 session 摘要並解析有效的已登入身份', async () => {
    const { repository, service } = createService();
    await repository.upsertIdentity({
      uid: 'user-1',
      displayName: '使用者一',
      teamIds: ['team-a'],
      providerType: 'development',
      active: true,
      createdAt: now,
      updatedAt: now
    });

    const created = await service.create('user-1');
    const stored = await repository.findSession(
      hashSessionToken(created.token)
    );
    const resolved = await service.resolve({ sessionToken: created.token });

    expect(created.token).toBe('deterministic-session-token');
    expect(stored?.sessionDigest).toBe(
      '4afc7a84d2449a11b33c70ea34654cb07d0ee8a7568f4ea751d4114e37f3ca22'
    );
    expect(stored?.sessionDigest).not.toBe(created.token);
    expect(resolved).toEqual({
      kind: 'authenticated',
      uid: 'user-1',
      displayName: '使用者一',
      teamIds: ['team-a']
    });
  });

  it('已撤銷或過期的 session 不再解析成登入身份', async () => {
    const { repository, service } = createService();
    await repository.upsertIdentity({
      uid: 'user-1',
      displayName: '使用者一',
      teamIds: [],
      providerType: 'development',
      active: true,
      createdAt: now,
      updatedAt: now
    });
    const created = await service.create('user-1');
    await service.logout(created.token);

    const resolved = await service.resolve({
      sessionToken: created.token,
      anonymousId: 'd9428888-122b-11e1-b85c-61cd3cbb3210'
    });

    expect(resolved).toEqual({
      kind: 'anonymous',
      anonymousId: 'd9428888-122b-11e1-b85c-61cd3cbb3210',
      isNew: false
    });
  });

  it('建立匿名 UUID 後可在後續請求穩定沿用', async () => {
    const { service } = createService();

    const first = await service.resolve({});
    const second = await service.resolve({
      anonymousId:
        first.kind === 'anonymous' ? first.anonymousId : 'unexpected'
    });

    expect(first).toEqual({
      kind: 'anonymous',
      anonymousId: '123e4567-e89b-42d3-a456-426614174000',
      isNew: true
    });
    expect(second).toEqual({
      kind: 'anonymous',
      anonymousId: '123e4567-e89b-42d3-a456-426614174000',
      isNew: false
    });
  });
});

describe('身份 Cookie', () => {
  it('解析 Cookie 並忽略格式錯誤的片段', () => {
    expect(
      parseCookieHeader('theme=dark; malformed; asp_session=token%20value')
    ).toEqual({ theme: 'dark', asp_session: 'token value' });
  });

  it('正式環境身份 Cookie 具備基本安全屬性', () => {
    const cookie = serializeIdentityCookie('asp_session', 'secret', {
      maxAgeSeconds: 3600,
      secure: true
    });

    expect(cookie).toBe(
      'asp_session=secret; Max-Age=3600; Path=/; HttpOnly; SameSite=Lax; Secure'
    );
  });
});

describe('安裝腳本身份接口', () => {
  it('登入身份映射為 uid 類型', () => {
    expect(
      toInstallationUserReference({
        kind: 'authenticated',
        uid: 'user-1',
        displayName: '使用者一',
        teamIds: ['team-a']
      })
    ).toEqual({ type: 'uid', value: 'user-1' });
  });

  it('匿名身份映射為 uuid 類型且不產生 uid 欄位', () => {
    const reference = toInstallationUserReference({
      kind: 'anonymous',
      anonymousId: '123e4567-e89b-42d3-a456-426614174000',
      isNew: false
    });

    expect(reference).toEqual({
      type: 'uuid',
      value: '123e4567-e89b-42d3-a456-426614174000'
    });
    expect(reference).not.toHaveProperty('uid');
  });
});
