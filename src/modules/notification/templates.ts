// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import type { NotificationEvent, RenderedNotification } from './types.js';

/**
 * 通知文案的單一來源。站內通知頁與各外部渠道描述同一事件，
 * 文案只在此定義一次，避免兩邊各自演化成不同說法。
 *
 * 文案規則：先說發生什麼，再說要做什麼。不放命令全文，
 * 不放內部識別碼以外的敏感欄位——外部渠道的訊息可能被轉貼。
 */

function readText(
  payload: Record<string, unknown>,
  key: string
): string | undefined {
  const value = payload[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function packageLink(packageId: string): string {
  return `/packages/${encodeURIComponent(packageId)}`;
}

export function renderNotification(
  event: NotificationEvent
): RenderedNotification {
  const facts: Array<{ label: string; value: string }> = [
    { label: '套件', value: event.packageId },
    { label: '版本', value: event.version }
  ];

  if (event.notificationType === 'version_published') {
    const installed = readText(event.payload, 'installedVersion');
    const releaseNotes = readText(event.payload, 'releaseNotes');
    if (installed) {
      facts.push({ label: '你安裝的版本', value: installed });
    }
    if (releaseNotes) {
      facts.push({ label: '版本說明', value: releaseNotes });
    }

    return {
      title: `${event.packageId} 已發布新版本 ${event.version}`,
      body: installed
        ? `你目前安裝的是 ${installed}，可查看差異後決定是否升級。`
        : '你安裝的版本較舊，可查看差異後決定是否升級。',
      severity: 'info',
      // 有安裝版本才導向差異頁：比較需要來源與目標兩版，
      // 猜錯版本比不提供連結更糟。
      link: installed
        ? `${packageLink(event.packageId)}/versions/${encodeURIComponent(
            installed
          )}/diff/${encodeURIComponent(event.version)}`
        : packageLink(event.packageId),
      facts
    };
  }

  const reasonDetail = readText(event.payload, 'reasonDetail');
  const reasonCode = readText(event.payload, 'reasonCode');
  if (reasonCode) {
    facts.push({ label: '原因代碼', value: reasonCode });
  }
  if (reasonDetail) {
    facts.push({ label: '原因說明', value: reasonDetail });
  }

  if (event.notificationType === 'version_emergency_disabled') {
    return {
      title: `${event.packageId} ${event.version} 已緊急停用`,
      body: '此版本已被緊急停用，請儘快解除安裝。',
      severity: 'critical',
      link: packageLink(event.packageId),
      facts
    };
  }

  return {
    title: `${event.packageId} ${event.version} 已被撤下`,
    body: '此版本已撤下，無法再下載。既有安裝不受影響，但建議改用其他版本。',
    severity: 'warning',
    link: packageLink(event.packageId),
    facts
  };
}

/** 供 email 與純文字渠道使用的完整敘述。 */
export function renderPlainText(
  content: RenderedNotification,
  baseUrl?: string
): string {
  const lines = [content.title, '', content.body, ''];
  for (const fact of content.facts) {
    lines.push(`${fact.label}：${fact.value}`);
  }
  if (baseUrl) {
    lines.push('', `${baseUrl.replace(/\/+$/, '')}${content.link}`);
  }
  return lines.join('\n');
}
