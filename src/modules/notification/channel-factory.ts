// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import {
  EmailChannel,
  LarkChannel,
  SlackChannel,
  TeamsChannel,
  type EmailTransport
} from './channels.js';
import type { DeliveryTarget, NotificationChannel } from './types.js';
import type { NotificationConfig } from '../../shared/config/config.js';

export interface ChannelFactoryOptions {
  config: NotificationConfig | undefined;
  fetchImpl?: typeof fetch;
  /** 郵件通道由外部注入；未提供時不啟用 email 渠道。 */
  emailTransport?: EmailTransport;
}

/**
 * 依配置建立已啟用的渠道。未配置的渠道不建立，因此不會有
 * 「看似啟用但送不出去」的中間狀態。
 */
export function createChannels(
  options: ChannelFactoryOptions
): NotificationChannel[] {
  const { config } = options;
  const channels: NotificationChannel[] = [];
  if (!config) {
    return options.emailTransport
      ? [new EmailChannel(options.emailTransport)]
      : channels;
  }

  const webhookOptions = {
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    ...(config.baseUrl ? { baseUrl: config.baseUrl } : {})
  };

  if (config.slackWebhookUrl) {
    channels.push(new SlackChannel(webhookOptions));
  }
  if (config.teamsWebhookUrl) {
    channels.push(new TeamsChannel(webhookOptions));
  }
  if (config.larkWebhookUrl) {
    channels.push(new LarkChannel(webhookOptions));
  }
  if (options.emailTransport) {
    channels.push(new EmailChannel(options.emailTransport, config.baseUrl));
  }

  return channels;
}

/**
 * 由配置導出的共用投遞目標。第一期公司只提供單一 workspace webhook，
 * 全體收件人共用同一組端點；取得真實目錄服務後改為逐人解析。
 */
export function createSharedTargets(
  config: NotificationConfig | undefined
): DeliveryTarget[] {
  if (!config) {
    return [];
  }

  const targets: DeliveryTarget[] = [];
  if (config.slackWebhookUrl) {
    targets.push({ kind: 'slack', endpoint: config.slackWebhookUrl });
  }
  if (config.teamsWebhookUrl) {
    targets.push({ kind: 'teams', endpoint: config.teamsWebhookUrl });
  }
  if (config.larkWebhookUrl) {
    targets.push({ kind: 'lark', endpoint: config.larkWebhookUrl });
  }
  return targets;
}
