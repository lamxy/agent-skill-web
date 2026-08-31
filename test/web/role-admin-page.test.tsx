// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import { RoleAdminPage } from '../../web/src/pages/RoleAdminPage.js';

function render(): string {
  return renderToStaticMarkup(
    createElement(MemoryRouter, null, createElement(RoleAdminPage))
  );
}

describe('角色管理頁', () => {
  it('說明一般員工不需角色，避免誤以為不授予就沒權限', () => {
    const html = render();

    expect(html).toContain('一般員工不需角色');
    expect(html).toContain('自己團隊');
  });

  it('明說平台管理員不在此授予', () => {
    const html = render();

    expect(html).toContain('平台管理員不在此授予');
  });

  it('未選使用者時說明沒有全平台總覽的原因', () => {
    // 空白畫面會讓管理員以為壞了；要講清楚是後端沒有這個端點。
    const html = render();

    expect(html).toContain('先選擇一位使用者');
    expect(html).toContain('不提供全平台總覽');
  });

  it('導覽列含角色管理入口', () => {
    const html = render();

    expect(html).toContain('href="/admin/roles"');
    expect(html).toContain('角色管理');
  });
});
