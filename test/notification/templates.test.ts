// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { describe, expect, it } from 'vitest';

import { renderNotification, renderPlainText } from '../../src/modules/notification/templates.js';
import type { NotificationEvent } from '../../src/modules/notification/types.js';

function event(overrides: Partial<NotificationEvent> = {}): NotificationEvent {
  return {
    eventId: 'event-1',
    notificationType: 'version_published',
    recipientUid: 'e12345',
    packageId: 'acme/deploy-helper',
    version: '2.1.0',
    payload: {},
    occurredAt: new Date('2026-08-29T00:00:00.000Z'),
    ...overrides
  };
}

describe('通知模板', () => {
  it('新版本通知在已知安裝版本時連向差異頁', () => {
    const content = renderNotification(
      event({ payload: { installedVersion: '1.4.0' } })
    );

    expect(content.severity).toBe('info');
    expect(content.title).toContain('已發布新版本 2.1.0');
    expect(content.body).toContain('1.4.0');
    expect(content.link).toBe(
      '/packages/acme%2Fdeploy-helper/versions/1.4.0/diff/2.1.0'
    );
    expect(content.facts).toContainEqual({ label: '你安裝的版本', value: '1.4.0' });
  });

  it('沒有安裝版本時退回套件詳情，不猜測來源版本', () => {
    const content = renderNotification(event());

    // 差異比較需要來源與目標兩版，猜錯比不提供連結更糟。
    expect(content.link).toBe('/packages/acme%2Fdeploy-helper');
    expect(content.facts.map((fact) => fact.label)).not.toContain('你安裝的版本');
  });

  it('緊急停用為 critical 並要求解除安裝', () => {
    const content = renderNotification(
      event({
        notificationType: 'version_emergency_disabled',
        payload: { reasonCode: 'SECURITY', reasonDetail: '含未授權外連' }
      })
    );

    expect(content.severity).toBe('critical');
    expect(content.body).toContain('解除安裝');
    expect(content.facts).toContainEqual({ label: '原因代碼', value: 'SECURITY' });
    expect(content.facts).toContainEqual({ label: '原因說明', value: '含未授權外連' });
  });

  it('撤下為 warning 並說明既有安裝不受影響', () => {
    const content = renderNotification(
      event({ notificationType: 'version_delisted' })
    );

    expect(content.severity).toBe('warning');
    expect(content.body).toContain('既有安裝不受影響');
  });

  it('忽略空白或非字串的 payload 欄位', () => {
    const content = renderNotification(
      event({ payload: { installedVersion: '   ', releaseNotes: 42 } })
    );

    expect(content.link).toBe('/packages/acme%2Fdeploy-helper');
    expect(content.facts.map((fact) => fact.label)).not.toContain('版本說明');
  });

  it('純文字輸出附上絕對連結供 email 使用', () => {
    const text = renderPlainText(
      renderNotification(event({ payload: { installedVersion: '1.4.0' } })),
      'https://platform.example.com/'
    );

    expect(text).toContain('acme/deploy-helper 已發布新版本 2.1.0');
    expect(text).toContain('套件：acme/deploy-helper');
    expect(text).toContain(
      'https://platform.example.com/packages/acme%2Fdeploy-helper/versions/1.4.0/diff/2.1.0'
    );
  });
});
