// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { describe, expect, it, vi } from 'vitest';

import {
  MemoryDeliveryLog,
  NotificationDispatcher,
  StaticRecipientDirectory
} from '../../src/modules/notification/notification-dispatcher.js';
import type {
  DeliveryOutcome,
  DeliveryTarget,
  NotificationChannel,
  NotificationChannelKind,
  NotificationEvent
} from '../../src/modules/notification/types.js';

const event: NotificationEvent = {
  eventId: 'event-1',
  notificationType: 'version_published',
  recipientUid: 'e12345',
  packageId: 'acme/deploy-helper',
  version: '2.1.0',
  payload: { installedVersion: '1.4.0' },
  occurredAt: new Date('2026-08-29T00:00:00.000Z')
};

const slackTarget: DeliveryTarget = {
  kind: 'slack',
  endpoint: 'https://hooks.example.com/abc'
};
const emailTarget: DeliveryTarget = {
  kind: 'email',
  endpoint: 'user@example.com'
};

/** 依序回傳預設結果的假渠道，用於驗證重試次數與停止條件。 */
function fakeChannel(
  kind: NotificationChannelKind,
  outcomes: DeliveryOutcome[]
): NotificationChannel & { calls: number } {
  let index = 0;
  const channel = {
    kind,
    calls: 0,
    async deliver(): Promise<DeliveryOutcome> {
      channel.calls += 1;
      const outcome = outcomes[Math.min(index, outcomes.length - 1)];
      index += 1;
      return outcome ?? { status: 'delivered' };
    }
  };
  return channel;
}

function createDispatcher(
  channels: NotificationChannel[],
  targets: DeliveryTarget[],
  log = new MemoryDeliveryLog()
) {
  return {
    log,
    dispatcher: new NotificationDispatcher({
      channels,
      directory: new StaticRecipientDirectory(
        new Map([[event.recipientUid, targets]])
      ),
      log
    })
  };
}

describe('通知派送', () => {
  it('沒有配置渠道時靜默略過：站內通知已寫入，外部渠道屬加值', async () => {
    const { dispatcher } = createDispatcher([], []);

    expect(await dispatcher.dispatch(event)).toEqual([]);
  });

  it('對所有已配置目標各送一次', async () => {
    const slack = fakeChannel('slack', [{ status: 'delivered' }]);
    const email = fakeChannel('email', [{ status: 'delivered' }]);
    const { dispatcher } = createDispatcher(
      [slack, email],
      [slackTarget, emailTarget]
    );

    const records = await dispatcher.dispatch(event);

    expect(records).toHaveLength(2);
    expect(records.every((record) => record.status === 'delivered')).toBe(true);
    expect(slack.calls).toBe(1);
    expect(email.calls).toBe(1);
  });

  it('可重試失敗會重試至上限', async () => {
    const slack = fakeChannel('slack', [
      { status: 'retryable', reason: '對端回應 503' }
    ]);
    const { dispatcher } = createDispatcher([slack], [slackTarget]);

    const [record] = await dispatcher.dispatch(event);

    expect(slack.calls).toBe(3);
    expect(record).toMatchObject({
      status: 'retryable',
      attempts: 3,
      reason: '對端回應 503'
    });
  });

  it('暫時失敗後成功即停止重試', async () => {
    const slack = fakeChannel('slack', [
      { status: 'retryable', reason: '對端回應 500' },
      { status: 'delivered' }
    ]);
    const { dispatcher } = createDispatcher([slack], [slackTarget]);

    const [record] = await dispatcher.dispatch(event);

    expect(slack.calls).toBe(2);
    expect(record).toMatchObject({ status: 'delivered', attempts: 2 });
  });

  it('明確被拒不重試，避免浪費配額', async () => {
    const slack = fakeChannel('slack', [
      { status: 'rejected', reason: '對端拒絕，回應 403' }
    ]);
    const { dispatcher } = createDispatcher([slack], [slackTarget]);

    const [record] = await dispatcher.dispatch(event);

    expect(slack.calls).toBe(1);
    expect(record).toMatchObject({ status: 'rejected', attempts: 1 });
  });

  it('單一渠道失敗不影響其餘渠道投遞', async () => {
    const slack = fakeChannel('slack', [
      { status: 'rejected', reason: '憑證失效' }
    ]);
    const email = fakeChannel('email', [{ status: 'delivered' }]);
    const { dispatcher } = createDispatcher(
      [slack, email],
      [slackTarget, emailTarget]
    );

    const records = await dispatcher.dispatch(event);

    expect(records.find((record) => record.channel === 'email')?.status).toBe(
      'delivered'
    );
    expect(email.calls).toBe(1);
  });

  it('目標指定未啟用渠道時記錄並繼續，不中斷其餘投遞', async () => {
    const email = fakeChannel('email', [{ status: 'delivered' }]);
    const { dispatcher } = createDispatcher([email], [slackTarget, emailTarget]);

    const records = await dispatcher.dispatch(event);

    expect(records).toContainEqual(
      expect.objectContaining({
        channel: 'slack',
        status: 'rejected',
        reason: '渠道未啟用'
      })
    );
    expect(email.calls).toBe(1);
  });

  it('同一事件重複派送不會重送已送達的目標', async () => {
    const slack = fakeChannel('slack', [{ status: 'delivered' }]);
    const { dispatcher } = createDispatcher([slack], [slackTarget]);

    await dispatcher.dispatch(event);
    const second = await dispatcher.dispatch(event);

    // outbox 事件可能被重複取出，冪等由 delivery log 保證。
    expect(second).toEqual([]);
    expect(slack.calls).toBe(1);
  });

  it('先前失敗的目標在重新派送時會再試', async () => {
    const slack = fakeChannel('slack', [
      { status: 'rejected', reason: '暫時設定錯誤' },
      { status: 'delivered' }
    ]);
    const { dispatcher } = createDispatcher([slack], [slackTarget]);

    await dispatcher.dispatch(event);
    const [record] = await dispatcher.dispatch(event);

    expect(record).toMatchObject({ status: 'delivered' });
  });

  it('派送結果全數記錄，供運維排查', async () => {
    const slack = fakeChannel('slack', [{ status: 'delivered' }]);
    const { dispatcher, log } = createDispatcher([slack], [slackTarget]);

    await dispatcher.dispatch(event);

    expect(log.list()).toEqual([
      {
        eventId: 'event-1',
        channel: 'slack',
        endpoint: slackTarget.endpoint,
        status: 'delivered',
        attempts: 1
      }
    ]);
  });

  it('依收件人解析目標，不對未訂閱者發送', async () => {
    const slack = fakeChannel('slack', [{ status: 'delivered' }]);
    const dispatcher = new NotificationDispatcher({
      channels: [slack],
      directory: new StaticRecipientDirectory(
        new Map([['other-user', [slackTarget]]])
      ),
      log: new MemoryDeliveryLog()
    });

    expect(await dispatcher.dispatch(event)).toEqual([]);
    expect(slack.calls).toBe(0);
  });

  it('渲染只做一次，多渠道共用同一份內容', async () => {
    const received: unknown[] = [];
    const capture = (kind: NotificationChannelKind): NotificationChannel => ({
      kind,
      async deliver(_target, content) {
        received.push(content);
        return { status: 'delivered' };
      }
    });
    const { dispatcher } = createDispatcher(
      [capture('slack'), capture('email')],
      [slackTarget, emailTarget]
    );

    await dispatcher.dispatch(event);

    expect(received).toHaveLength(2);
    expect(received[0]).toBe(received[1]);
  });
});

describe('收件人目錄', () => {
  it('回傳副本，呼叫端修改不影響後續解析', async () => {
    const directory = new StaticRecipientDirectory(
      new Map([['e12345', [slackTarget]]])
    );

    const first = await directory.resolveTargets('e12345');
    first[0]!.endpoint = 'https://tampered.example.com';

    expect((await directory.resolveTargets('e12345'))[0]?.endpoint).toBe(
      slackTarget.endpoint
    );
  });

  it('未知收件人回傳空陣列而非拋錯', async () => {
    const directory = new StaticRecipientDirectory(new Map());

    expect(await directory.resolveTargets('nobody')).toEqual([]);
  });
});
