// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { describe, expect, it, vi } from 'vitest';

import {
  EmailChannel,
  LarkChannel,
  SlackChannel,
  TeamsChannel
} from '../../src/modules/notification/channels.js';
import { renderNotification } from '../../src/modules/notification/templates.js';
import type {
  DeliveryTarget,
  NotificationEvent
} from '../../src/modules/notification/types.js';

const criticalEvent: NotificationEvent = {
  eventId: 'event-1',
  notificationType: 'version_emergency_disabled',
  recipientUid: 'e12345',
  packageId: 'acme/deploy-helper',
  version: '2.1.0',
  payload: { reasonCode: 'SECURITY' },
  occurredAt: new Date('2026-08-29T00:00:00.000Z')
};

const content = renderNotification(criticalEvent);
const webhook: DeliveryTarget = {
  kind: 'slack',
  endpoint: 'https://hooks.example.com/abc'
};

function stubFetch(status: number) {
  return vi.fn(
    async (_input: unknown, _init?: RequestInit) => new Response('', { status })
  );
}

/** 取出送出的 JSON payload，驗證各渠道確實依自身格式組裝。 */
function sentPayload(fetchImpl: ReturnType<typeof stubFetch>): unknown {
  const init = fetchImpl.mock.calls[0]?.[1];
  return JSON.parse(init?.body as string);
}

describe('Webhook 渠道結果分類', () => {
  it('2xx 視為送達', async () => {
    const fetchImpl = stubFetch(200);
    const outcome = await new SlackChannel({ fetchImpl }).deliver(webhook, content);

    expect(outcome).toEqual({ status: 'delivered' });
  });

  it('4xx 為不可重試：payload 或憑證有問題，重試結果相同', async () => {
    const fetchImpl = stubFetch(403);
    const outcome = await new SlackChannel({ fetchImpl }).deliver(webhook, content);

    expect(outcome.status).toBe('rejected');
  });

  it('429 與 5xx 為可重試', async () => {
    for (const status of [429, 500, 503]) {
      const fetchImpl = stubFetch(status);
      const outcome = await new SlackChannel({ fetchImpl }).deliver(webhook, content);

      expect(outcome.status).toBe('retryable');
    }
  });

  it('連線失敗視為可重試而非直接放棄', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('connection refused');
    });
    const outcome = await new SlackChannel({ fetchImpl }).deliver(webhook, content);

    expect(outcome).toEqual({
      status: 'retryable',
      reason: '無法連線至通知渠道'
    });
  });
});

describe('各渠道 payload 格式', () => {
  it('Slack 使用 blocks 並附上絕對連結', async () => {
    const fetchImpl = stubFetch(200);
    await new SlackChannel({
      fetchImpl,
      baseUrl: 'https://platform.example.com'
    }).deliver(webhook, content);

    const payload = sentPayload(fetchImpl) as {
      text: string;
      blocks: Array<Record<string, unknown>>;
    };
    expect(payload.text).toContain('🚨');
    expect(payload.blocks).toHaveLength(3);
    expect(JSON.stringify(payload)).toContain(
      'https://platform.example.com/packages/acme%2Fdeploy-helper'
    );
  });

  it('Teams 使用 MessageCard 並依嚴重度給主題色', async () => {
    const fetchImpl = stubFetch(200);
    await new TeamsChannel({ fetchImpl }).deliver(webhook, content);

    const payload = sentPayload(fetchImpl) as Record<string, unknown>;
    expect(payload['@type']).toBe('MessageCard');
    expect(payload.themeColor).toBe('A32020');
    expect(payload.summary).toBe(content.title);
  });

  it('Lark 使用 post 富文本並帶連結節點', async () => {
    const fetchImpl = stubFetch(200);
    await new LarkChannel({
      fetchImpl,
      baseUrl: 'https://platform.example.com'
    }).deliver(webhook, content);

    const payload = sentPayload(fetchImpl) as { msg_type: string };
    expect(payload.msg_type).toBe('post');
    expect(JSON.stringify(payload)).toContain('"tag":"a"');
  });

  it('三個渠道送出的標題一致，不各自演化文案', async () => {
    const titles: string[] = [];
    for (const Channel of [SlackChannel, TeamsChannel, LarkChannel]) {
      const fetchImpl = stubFetch(200);
      await new Channel({ fetchImpl }).deliver(webhook, content);
      titles.push(JSON.stringify(sentPayload(fetchImpl)));
    }

    for (const body of titles) {
      expect(body).toContain('已緊急停用');
    }
  });
});

describe('郵件渠道', () => {
  it('以模板純文字送出，主旨為通知標題', async () => {
    const send = vi.fn(async () => undefined);
    const outcome = await new EmailChannel(
      { send },
      'https://platform.example.com'
    ).deliver({ kind: 'email', endpoint: 'user@example.com' }, content);

    expect(outcome).toEqual({ status: 'delivered' });
    expect(send).toHaveBeenCalledWith({
      to: 'user@example.com',
      subject: content.title,
      text: expect.stringContaining('原因代碼：SECURITY')
    });
  });

  it('傳送失敗視為可重試並帶回原因', async () => {
    const send = vi.fn(async () => {
      throw new Error('SMTP 逾時');
    });
    const outcome = await new EmailChannel({ send }).deliver(
      { kind: 'email', endpoint: 'user@example.com' },
      content
    );

    expect(outcome).toEqual({ status: 'retryable', reason: 'SMTP 逾時' });
  });
});
