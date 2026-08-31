// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

export const notificationChannelKinds = [
  'slack',
  'teams',
  'lark',
  'email'
] as const;

export type NotificationChannelKind = (typeof notificationChannelKinds)[number];

export const notificationEventTypes = [
  'version_published',
  'version_delisted',
  'version_emergency_disabled'
] as const;

export type NotificationEventType = (typeof notificationEventTypes)[number];

/**
 * 通知的來源事實。由 domain_events 的 user_notification 事件導出，
 * 與站內通知同源，確保兩邊描述同一件事而不會各自漂移。
 */
export interface NotificationEvent {
  eventId: string;
  notificationType: NotificationEventType;
  recipientUid: string;
  packageId: string;
  version: string;
  payload: Record<string, unknown>;
  occurredAt: Date;
}

/**
 * 渲染後的中性內容。各渠道由此再轉為自身的 payload 格式，
 * 因此文案只寫一次，Slack 與 email 不會出現不同說法。
 */
export interface RenderedNotification {
  /** 列表與推播摘要，亦作為 email 主旨 */
  title: string;
  /** 主要敘述，純文字 */
  body: string;
  /** 嚴重度決定渠道的視覺強調，不決定是否送出 */
  severity: 'info' | 'warning' | 'critical';
  /** 站內對應頁面的相對路徑 */
  link: string;
  facts: Array<{ label: string; value: string }>;
}

export interface DeliveryTarget {
  kind: NotificationChannelKind;
  /** Slack、Teams、Lark 為 webhook URL；email 為收件位址 */
  endpoint: string;
}

export type DeliveryOutcome =
  | { status: 'delivered' }
  /** 可重試：對端暫時性失敗或網路問題 */
  | { status: 'retryable'; reason: string }
  /** 不可重試：憑證錯誤或 payload 被拒，重試只會得到相同結果 */
  | { status: 'rejected'; reason: string };

export interface NotificationChannel {
  readonly kind: NotificationChannelKind;
  deliver(
    target: DeliveryTarget,
    content: RenderedNotification
  ): Promise<DeliveryOutcome>;
}
