// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { renderNotification } from './templates.js';
import type {
  DeliveryTarget,
  NotificationChannel,
  NotificationChannelKind,
  NotificationEvent
} from './types.js';

/**
 * 收件人的渠道偏好來源。第一期由配置提供靜態對照，
 * 取得公司目錄服務後改為查詢真實訂閱設定。
 */
export interface RecipientDirectory {
  resolveTargets(recipientUid: string): Promise<DeliveryTarget[]>;
}

export interface DispatchRecord {
  eventId: string;
  channel: NotificationChannelKind;
  endpoint: string;
  status: 'delivered' | 'retryable' | 'rejected';
  reason?: string;
  attempts: number;
}

/**
 * 已送達紀錄。用於跨次執行的冪等判斷：outbox 事件可能被重複取出，
 * 不能因此對同一收件人重複發送。
 */
export interface DeliveryLog {
  hasDelivered(eventId: string, channel: NotificationChannelKind, endpoint: string): Promise<boolean>;
  record(entry: DispatchRecord): Promise<void>;
}

export class MemoryDeliveryLog implements DeliveryLog {
  private readonly delivered = new Set<string>();
  private readonly entries: DispatchRecord[] = [];

  async hasDelivered(
    eventId: string,
    channel: NotificationChannelKind,
    endpoint: string
  ): Promise<boolean> {
    return this.delivered.has(`${eventId}::${channel}::${endpoint}`);
  }

  async record(entry: DispatchRecord): Promise<void> {
    this.entries.push({ ...entry });
    if (entry.status === 'delivered') {
      this.delivered.add(`${entry.eventId}::${entry.channel}::${entry.endpoint}`);
    }
  }

  list(): DispatchRecord[] {
    return this.entries.map((entry) => ({ ...entry }));
  }
}

export interface NotificationDispatcherOptions {
  channels: NotificationChannel[];
  directory: RecipientDirectory;
  log: DeliveryLog;
  /** 單一目標的最大嘗試次數，含首次 */
  maxAttempts?: number;
}

const DEFAULT_MAX_ATTEMPTS = 3;

export class NotificationDispatcher {
  private readonly channels: Map<NotificationChannelKind, NotificationChannel>;
  private readonly directory: RecipientDirectory;
  private readonly log: DeliveryLog;
  private readonly maxAttempts: number;

  constructor(options: NotificationDispatcherOptions) {
    this.channels = new Map(
      options.channels.map((channel) => [channel.kind, channel])
    );
    this.directory = options.directory;
    this.log = options.log;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  }

  async dispatch(event: NotificationEvent): Promise<DispatchRecord[]> {
    const targets = await this.directory.resolveTargets(event.recipientUid);
    // 沒有配置渠道不是錯誤：站內通知已寫入，外部渠道屬加值。
    if (targets.length === 0) {
      return [];
    }

    const content = renderNotification(event);
    const records: DispatchRecord[] = [];

    for (const target of targets) {
      const channel = this.channels.get(target.kind);
      if (!channel) {
        // 目標指定了未啟用的渠道，記錄後跳過而非中斷其餘投遞。
        const record: DispatchRecord = {
          eventId: event.eventId,
          channel: target.kind,
          endpoint: target.endpoint,
          status: 'rejected',
          reason: '渠道未啟用',
          attempts: 0
        };
        await this.log.record(record);
        records.push(record);
        continue;
      }

      if (await this.log.hasDelivered(event.eventId, target.kind, target.endpoint)) {
        continue;
      }

      records.push(await this.deliverWithRetry(event, channel, target, content));
    }

    return records;
  }

  private async deliverWithRetry(
    event: NotificationEvent,
    channel: NotificationChannel,
    target: DeliveryTarget,
    content: ReturnType<typeof renderNotification>
  ): Promise<DispatchRecord> {
    let attempts = 0;
    let lastReason: string | undefined;

    while (attempts < this.maxAttempts) {
      attempts += 1;
      const outcome = await channel.deliver(target, content);

      if (outcome.status === 'delivered') {
        const record: DispatchRecord = {
          eventId: event.eventId,
          channel: channel.kind,
          endpoint: target.endpoint,
          status: 'delivered',
          attempts
        };
        await this.log.record(record);
        return record;
      }

      lastReason = outcome.reason;
      // 明確被拒的請求重試不會改變結果，立即停止以免浪費配額。
      if (outcome.status === 'rejected') {
        break;
      }
    }

    const record: DispatchRecord = {
      eventId: event.eventId,
      channel: channel.kind,
      endpoint: target.endpoint,
      status: attempts >= this.maxAttempts ? 'retryable' : 'rejected',
      ...(lastReason ? { reason: lastReason } : {}),
      attempts
    };
    await this.log.record(record);
    return record;
  }
}

/** 由配置提供的靜態收件人對照，供第一期與開發期使用。 */
export class StaticRecipientDirectory implements RecipientDirectory {
  constructor(private readonly targets: Map<string, DeliveryTarget[]>) {}

  async resolveTargets(recipientUid: string): Promise<DeliveryTarget[]> {
    return this.targets.get(recipientUid)?.map((target) => ({ ...target })) ?? [];
  }
}
