// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { describe, expect, it } from 'vitest';

import { loadConfig } from '../src/shared/config/config.js';

describe('loadConfig', () => {
  it('provides safe local defaults without weakening production configuration', () => {
    const config = loadConfig({ NODE_ENV: 'development' });

    expect(config).toEqual({
      environment: 'development',
      host: '127.0.0.1',
      port: 3000,
      logLevel: 'debug',
      databaseUrl: 'postgresql://postgres:postgres@127.0.0.1:5432/agent_skill_platform'
    });
  });

  it('rejects a production environment without an explicit database URL', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(
      'DATABASE_URL is required outside development'
    );
  });

  it('rejects ports outside the TCP range', () => {
    expect(() =>
      loadConfig({ NODE_ENV: 'development', PORT: '70000' })
    ).toThrow('PORT must be between 1 and 65535');
  });
});

const oidcEnvironment = {
  OIDC_AUTHORIZE_URL: 'https://idp.example.com/authorize',
  OIDC_TOKEN_URL: 'https://idp.example.com/token',
  OIDC_USERINFO_URL: 'https://idp.example.com/userinfo',
  OIDC_CLIENT_ID: 'platform',
  OIDC_CLIENT_SECRET: 'secret',
  OIDC_REDIRECT_URI: 'https://platform.example.com/api/auth/callback'
};

describe('loadConfig 的 OIDC 區塊', () => {
  it('未配置任何 OIDC 變數時不啟用 OIDC', () => {
    expect(loadConfig({ NODE_ENV: 'development' }).oidc).toBeUndefined();
  });

  it('採用預設 claim 名稱與 scope', () => {
    const config = loadConfig({ NODE_ENV: 'development', ...oidcEnvironment });

    expect(config.oidc).toMatchObject({
      clientId: 'platform',
      scope: 'openid profile',
      claims: { uid: 'sub', displayName: 'name', teams: 'groups' }
    });
  });

  it('claim 名稱可覆寫，以配合各家 IdP 的欄位命名', () => {
    const config = loadConfig({
      NODE_ENV: 'development',
      ...oidcEnvironment,
      OIDC_CLAIM_UID: 'employee_id',
      OIDC_CLAIM_TEAMS: 'profile.departments'
    });

    expect(config.oidc?.claims).toEqual({
      uid: 'employee_id',
      displayName: 'name',
      teams: 'profile.departments'
    });
  });

  it('拒絕只配置一部分的 OIDC 變數', () => {
    const { OIDC_CLIENT_SECRET: _omitted, ...partial } = oidcEnvironment;

    expect(() => loadConfig({ NODE_ENV: 'development', ...partial })).toThrow(
      /OIDC 配置不完整.*OIDC_CLIENT_SECRET/
    );
  });

  it('允許開發環境的 OIDC 端點指向本機模擬 IdP', () => {
    const config = loadConfig({
      NODE_ENV: 'development',
      ...oidcEnvironment,
      OIDC_AUTHORIZE_URL: 'http://127.0.0.1:4780/authorize',
      OIDC_TOKEN_URL: 'http://127.0.0.1:4780/token',
      OIDC_USERINFO_URL: 'http://127.0.0.1:4780/userinfo'
    });

    expect(config.oidc?.authorizeUrl).toBe('http://127.0.0.1:4780/authorize');
  });

  it('拒絕正式環境的 OIDC 端點指向本機位址', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://example',
        ...oidcEnvironment,
        OIDC_TOKEN_URL: 'http://localhost:4780/token'
      })
    ).toThrow('正式或 staging 環境的 OIDC_TOKEN_URL 不得指向本機位址');
  });

  it('staging 環境同樣拒絕本機端點', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'staging',
        DATABASE_URL: 'postgresql://example',
        ...oidcEnvironment,
        OIDC_AUTHORIZE_URL: 'http://127.0.0.1:4780/authorize'
      })
    ).toThrow('正式或 staging 環境的 OIDC_AUTHORIZE_URL 不得指向本機位址');
  });
});

describe('loadConfig 的登入白名單', () => {
  it('未設定時不限制登入', () => {
    expect(loadConfig({ NODE_ENV: 'development' }).loginAllowedUids).toBeUndefined();
  });

  it('全為空白時視為未設定，避免誤擋所有人', () => {
    expect(
      loadConfig({ NODE_ENV: 'development', LOGIN_ALLOWED_UIDS: ' , , ' })
        .loginAllowedUids
    ).toBeUndefined();
  });

  it('逗號分隔並去除前後空白', () => {
    expect(
      loadConfig({
        NODE_ENV: 'development',
        LOGIN_ALLOWED_UIDS: ' 1001 , 1002,1003 '
      }).loginAllowedUids
    ).toEqual(['1001', '1002', '1003']);
  });

  it('白名單未包含 BOOTSTRAP_ADMIN_UID 時啟動即失敗', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'development',
        BOOTSTRAP_ADMIN_UID: '1001',
        LOGIN_ALLOWED_UIDS: '1002,1003'
      })
    ).toThrow('LOGIN_ALLOWED_UIDS 未包含 BOOTSTRAP_ADMIN_UID');
  });

  it('白名單包含管理員時正常載入', () => {
    expect(
      loadConfig({
        NODE_ENV: 'development',
        BOOTSTRAP_ADMIN_UID: '1001',
        LOGIN_ALLOWED_UIDS: '1001,1002'
      }).loginAllowedUids
    ).toEqual(['1001', '1002']);
  });
});
