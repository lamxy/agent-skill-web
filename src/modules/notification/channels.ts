// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { renderPlainText } from './templates.js';
import type {
  DeliveryOutcome,
  DeliveryTarget,
  NotificationChannel,
  RenderedNotification
} from './types.js';

const REQUEST_TIMEOUT_MS = 10_000;

export interface WebhookChannelOptions {
  fetchImpl?: typeof fetch;
  /** 訊息內連結需要絕對位址，webhook 收件端不在平台網域內 */
  baseUrl?: string;
}

/**
 * 對端回 4xx 代表 payload 或憑證有問題，重試只會得到相同結果；
 * 429 與 5xx 是暫時性的，值得重試。
 */
function classifyResponse(status: number): DeliveryOutcome {
  if (status >= 200 && status < 300) {
    return { status: 'delivered' };
  }
  if (status === 429 || status >= 500) {
    return { status: 'retryable', reason: `對端回應 ${status}` };
  }
  return { status: 'rejected', reason: `對端拒絕，回應 ${status}` };
}

function absoluteLink(link: string, baseUrl?: string): string {
  return baseUrl ? `${baseUrl.replace(/\/+$/, '')}${link}` : link;
}

abstract class WebhookChannel implements NotificationChannel {
  abstract readonly kind: NotificationChannel['kind'];
  protected readonly fetchImpl: typeof fetch;
  protected readonly baseUrl: string | undefined;

  constructor(options: WebhookChannelOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.baseUrl = options.baseUrl;
  }

  protected abstract buildPayload(content: RenderedNotification): unknown;

  async deliver(
    target: DeliveryTarget,
    content: RenderedNotification
  ): Promise<DeliveryOutcome> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await this.fetchImpl(target.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(this.buildPayload(content)),
        signal: controller.signal
      });
      return classifyResponse(response.status);
    } catch {
      // 網路失敗與逾時皆可能是暫時性的，交給重試機制決定何時放棄。
      return { status: 'retryable', reason: '無法連線至通知渠道' };
    } finally {
      clearTimeout(timeout);
    }
  }
}

const SEVERITY_PREFIX: Record<RenderedNotification['severity'], string> = {
  info: '',
  warning: '⚠️ ',
  critical: '🚨 '
};

export class SlackChannel extends WebhookChannel {
  readonly kind = 'slack' as const;

  protected buildPayload(content: RenderedNotification): unknown {
    const link = absoluteLink(content.link, this.baseUrl);
    const fields = content.facts.map((fact) => ({
      type: 'mrkdwn',
      text: `*${fact.label}*\n${fact.value}`
    }));

    return {
      text: `${SEVERITY_PREFIX[content.severity]}${content.title}`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*${SEVERITY_PREFIX[content.severity]}${content.title}*\n${content.body}`
          }
        },
        // Slack 的 section fields 上限為 10 個
        { type: 'section', fields: fields.slice(0, 10) },
        {
          type: 'context',
          elements: [{ type: 'mrkdwn', text: `<${link}|在平台開啟>` }]
        }
      ]
    };
  }
}

const TEAMS_THEME: Record<RenderedNotification['severity'], string> = {
  info: '1F4FD8',
  warning: '8A5A00',
  critical: 'A32020'
};

export class TeamsChannel extends WebhookChannel {
  readonly kind = 'teams' as const;

  protected buildPayload(content: RenderedNotification): unknown {
    return {
      '@type': 'MessageCard',
      '@context': 'https://schema.org/extensions',
      themeColor: TEAMS_THEME[content.severity],
      summary: content.title,
      title: `${SEVERITY_PREFIX[content.severity]}${content.title}`,
      text: content.body,
      sections: [
        {
          facts: content.facts.map((fact) => ({
            name: fact.label,
            value: fact.value
          }))
        }
      ],
      potentialAction: [
        {
          '@type': 'OpenUri',
          name: '在平台開啟',
          targets: [
            { os: 'default', uri: absoluteLink(content.link, this.baseUrl) }
          ]
        }
      ]
    };
  }
}

export class LarkChannel extends WebhookChannel {
  readonly kind = 'lark' as const;

  protected buildPayload(content: RenderedNotification): unknown {
    return {
      msg_type: 'post',
      content: {
        post: {
          zh_cn: {
            title: `${SEVERITY_PREFIX[content.severity]}${content.title}`,
            content: [
              [{ tag: 'text', text: content.body }],
              ...content.facts.map((fact) => [
                { tag: 'text', text: `${fact.label}：${fact.value}` }
              ]),
              [
                {
                  tag: 'a',
                  text: '在平台開啟',
                  href: absoluteLink(content.link, this.baseUrl)
                }
              ]
            ]
          }
        }
      }
    };
  }
}

/**
 * 郵件傳送端點的注入介面。第一期不綁定特定 SMTP 或郵件服務商，
 * 取得公司郵件通道後實作此介面即可接上。
 */
export interface EmailTransport {
  send(input: {
    to: string;
    subject: string;
    text: string;
  }): Promise<void>;
}

export class EmailChannel implements NotificationChannel {
  readonly kind = 'email' as const;

  constructor(
    private readonly transport: EmailTransport,
    private readonly baseUrl?: string
  ) {}

  async deliver(
    target: DeliveryTarget,
    content: RenderedNotification
  ): Promise<DeliveryOutcome> {
    try {
      await this.transport.send({
        to: target.endpoint,
        subject: content.title,
        text: renderPlainText(content, this.baseUrl)
      });
      return { status: 'delivered' };
    } catch (error) {
      return {
        status: 'retryable',
        reason: error instanceof Error ? error.message : '郵件傳送失敗'
      };
    }
  }
}
