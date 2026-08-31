// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import {
  buildLoginUrl,
  canReview,
  hasRole,
  isAuthenticated,
  isPlatformAdmin,
  roleLabel,
  scopeLabel
} from '../../web/src/api/identity.js';
import type { Viewer } from '../../web/src/api/types.js';
import { ViewerMenu } from '../../web/src/components/ViewerMenu.js';
import { ViewerProvider } from '../../web/src/api/viewer-context.js';

const anonymous: Viewer = { kind: 'anonymous', anonymousId: 'anon-1' };

const employee: Viewer = {
  kind: 'authenticated',
  uid: 'e12345',
  displayName: '陳彥廷',
  teamIds: ['platform'],
  roles: []
};

const reviewer: Viewer = {
  ...employee,
  roles: [{ role: 'reviewer', scopeType: 'package_type', scopeValue: 'skill' }]
};

const admin: Viewer = {
  ...employee,
  roles: [{ role: 'platform_admin', scopeType: 'global', scopeValue: '' }]
};

describe('身份判斷', () => {
  it('只有 authenticated 視為已登入', () => {
    expect(isAuthenticated(employee)).toBe(true);
    expect(isAuthenticated(anonymous)).toBe(false);
    // 身份查詢失敗時 viewer 為 undefined，不得當成已登入
    expect(isAuthenticated(undefined)).toBe(false);
  });

  it('沒有角色的員工不具備任何管理權限', () => {
    expect(hasRole(employee, 'reviewer')).toBe(false);
    expect(canReview(employee)).toBe(false);
    expect(isPlatformAdmin(employee)).toBe(false);
  });

  it('審核人可進審核，但不可進管理', () => {
    expect(canReview(reviewer)).toBe(true);
    expect(isPlatformAdmin(reviewer)).toBe(false);
  });

  it('平台管理員可審核所有範圍', () => {
    expect(canReview(admin)).toBe(true);
    expect(isPlatformAdmin(admin)).toBe(true);
  });

  it('匿名與身份未知一律不具任何角色', () => {
    for (const viewer of [anonymous, undefined]) {
      expect(canReview(viewer)).toBe(false);
      expect(isPlatformAdmin(viewer)).toBe(false);
    }
  });
});

describe('登入轉導', () => {
  it('保留站內 returnTo', () => {
    expect(buildLoginUrl('/reviews')).toBe(
      '/api/auth/login?returnTo=%2Freviews'
    );
  });

  it('外部網址與協定相對網址一律退回首頁', () => {
    for (const hostile of [
      'https://evil.example/steal',
      '//evil.example',
      'javascript:alert(1)'
    ]) {
      expect(buildLoginUrl(hostile)).toBe('/api/auth/login?returnTo=%2F');
    }
  });
});

describe('角色與範圍標示', () => {
  it('以中文標示角色', () => {
    expect(roleLabel('platform_admin')).toBe('平台管理員');
    expect(roleLabel('reviewer')).toBe('審核人');
  });

  it('global 範圍不附帶空值', () => {
    expect(scopeLabel('global', '')).toBe('全平台');
    expect(scopeLabel('package_type', 'skill')).toBe('套件類型：skill');
  });
});

function renderMenu(): string {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(ViewerProvider, null, createElement(ViewerMenu))
    )
  );
}

describe('ViewerMenu 首次繪製', () => {
  it('身份解析完成前不顯示登入鍵，避免已登入者看到閃動', () => {
    const html = renderMenu();

    expect(html).toContain('viewer-placeholder');
    expect(html).not.toContain('使用公司帳號登入');
  });
});
