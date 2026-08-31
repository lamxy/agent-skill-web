// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { describe, expect, it, vi } from 'vitest';

import {
  createChannels,
  createSharedTargets
} from '../../src/modules/notification/channel-factory.js';
import { loadConfig } from '../../src/shared/config/config.js';

const transport = { send: vi.fn(async () => undefined) };

describe('依配置建立渠道', () => {
  it('未配置任何渠道時不建立 webhook 渠道', () => {
    expect(createChannels({ config: undefined })).toEqual([]);
  });

  it('只建立已配置的渠道，避免看似啟用卻送不出去', () => {
    const channels = createChannels({
      config: {
        slackWebhookUrl: 'https://hooks.example.com/slack',
        larkWebhookUrl: 'https://open.example.com/lark'
      }
    });

    expect(channels.map((channel) => channel.kind)).toEqual(['slack', 'lark']);
  });

  it('提供郵件通道時才啟用 email 渠道', () => {
    expect(
      createChannels({ config: undefined, emailTransport: transport }).map(
        (channel) => channel.kind
      )
    ).toEqual(['email']);
  });

  it('共用目標涵蓋所有已配置的 webhook', () => {
    const targets = createSharedTargets({
      slackWebhookUrl: 'https://hooks.example.com/slack',
      teamsWebhookUrl: 'https://outlook.example.com/teams'
    });

    expect(targets).toEqual([
      { kind: 'slack', endpoint: 'https://hooks.example.com/slack' },
      { kind: 'teams', endpoint: 'https://outlook.example.com/teams' }
    ]);
  });
});

describe('loadConfig 的通知區塊', () => {
  it('未配置時不啟用通知', () => {
    expect(loadConfig({ NODE_ENV: 'development' }).notification).toBeUndefined();
  });

  it('讀取已配置的 webhook 與平台位址', () => {
    const config = loadConfig({
      NODE_ENV: 'development',
      NOTIFY_SLACK_WEBHOOK_URL: 'https://hooks.example.com/slack',
      PLATFORM_BASE_URL: 'https://platform.example.com'
    });

    expect(config.notification).toEqual({
      slackWebhookUrl: 'https://hooks.example.com/slack',
      baseUrl: 'https://platform.example.com'
    });
  });

  it('拒絕非 https 的 webhook：錯字會讓通知靜默消失', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'development',
        NOTIFY_TEAMS_WEBHOOK_URL: 'http://outlook.example.com/teams'
      })
    ).toThrow('通知渠道 teamsWebhookUrl 必須是 https 位址');
  });
});
