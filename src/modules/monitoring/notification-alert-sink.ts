// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import type { HealthAlertSink } from './health-monitor.js';
import type {
  DeliveryTarget,
  NotificationChannel,
  RenderedNotification
} from '../notification/types.js';

/**
 * 把健康告警送往 Task 10.10 的通知渠道。
 *
 * 與使用者通知的差別：告警不經 outbox 也不寫 user_notifications，
 * 因為收件人是運維而非員工，且資料庫異常時本來就寫不進去——
 * 這正是最需要告警的時候。
 */
export class NotificationAlertSink implements HealthAlertSink {
  constructor(
    private readonly channels: NotificationChannel[],
    private readonly targets: DeliveryTarget[]
  ) {}

  async send(content: RenderedNotification): Promise<void> {
    const byKind = new Map(
      this.channels.map((channel) => [channel.kind, channel])
    );

    // 逐一送出且互不影響：單一渠道失敗不應讓其餘渠道收不到告警。
    await Promise.all(
      this.targets.map(async (target) => {
        const channel = byKind.get(target.kind);
        if (!channel) {
          return;
        }
        await channel.deliver(target, content);
      })
    );
  }
}
