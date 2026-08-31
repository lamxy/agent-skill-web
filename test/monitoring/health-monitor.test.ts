// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { describe, expect, it, vi } from 'vitest';

import {
  HealthMonitor,
  startHealthMonitor,
  type HealthAlertSink,
  type HealthProbe
} from '../../src/modules/monitoring/health-monitor.js';
import { NotificationAlertSink } from '../../src/modules/monitoring/notification-alert-sink.js';
import type {
  DeliveryOutcome,
  NotificationChannel,
  RenderedNotification
} from '../../src/modules/notification/types.js';

function collectingSink(): HealthAlertSink & { sent: RenderedNotification[] } {
  const sent: RenderedNotification[] = [];
  return {
    sent,
    async send(content) {
      sent.push(content);
    }
  };
}

/** 依序回傳成功或失敗的探針。true 代表該次檢查失敗。 */
function scriptedProbe(failures: boolean[]): HealthProbe {
  let index = 0;
  return {
    async check() {
      const shouldFail = failures[Math.min(index, failures.length - 1)];
      index += 1;
      if (shouldFail) {
        throw new Error('資料庫無回應');
      }
    }
  };
}

function createMonitor(
  failures: boolean[],
  failureThreshold = 3
): { monitor: HealthMonitor; sink: ReturnType<typeof collectingSink> } {
  const sink = collectingSink();
  return {
    sink,
    monitor: new HealthMonitor({
      probe: scriptedProbe(failures),
      sink,
      failureThreshold,
      clock: () => new Date('2026-08-29T12:00:00.000Z')
    })
  };
}

describe('健康輪詢', () => {
  it('檢查通過時維持 healthy 且不告警', async () => {
    const { monitor, sink } = createMonitor([false]);

    expect(await monitor.runOnce()).toBe('healthy');
    expect(sink.sent).toEqual([]);
  });

  it('未達連續失敗門檻不告警，避免單次抖動觸發', async () => {
    const { monitor, sink } = createMonitor([true]);

    await monitor.runOnce();
    await monitor.runOnce();

    expect(monitor.currentState).toBe('healthy');
    expect(sink.sent).toEqual([]);
  });

  it('達到門檻後轉為 unhealthy 並送出 critical 告警', async () => {
    const { monitor, sink } = createMonitor([true]);

    await monitor.runOnce();
    await monitor.runOnce();
    await monitor.runOnce();

    expect(monitor.currentState).toBe('unhealthy');
    expect(sink.sent).toHaveLength(1);
    expect(sink.sent[0]).toMatchObject({
      severity: 'critical',
      title: '平台健康檢查失敗'
    });
    expect(sink.sent[0]?.facts).toContainEqual({
      label: '失敗原因',
      value: '資料庫無回應'
    });
  });

  it('持續異常不重複告警，否則每個週期都會產生訊息而被當雜訊', async () => {
    const { monitor, sink } = createMonitor([true]);

    for (let attempt = 0; attempt < 8; attempt += 1) {
      await monitor.runOnce();
    }

    expect(sink.sent).toHaveLength(1);
  });

  it('恢復時送出一則 info 告警', async () => {
    const { monitor, sink } = createMonitor([true, true, true, false]);

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await monitor.runOnce();
    }

    expect(monitor.currentState).toBe('healthy');
    expect(sink.sent).toHaveLength(2);
    expect(sink.sent[1]).toMatchObject({
      severity: 'info',
      title: '平台健康檢查已恢復'
    });
  });

  it('中途恢復會重設失敗計數，不累加到下一輪異常', async () => {
    const { monitor, sink } = createMonitor([true, true, false, true, true]);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await monitor.runOnce();
    }

    // 兩次失敗、恢復、再兩次失敗：都未達連續三次，因此不告警。
    expect(sink.sent).toEqual([]);
    expect(monitor.currentState).toBe('healthy');
  });

  it('告警送出失敗不中斷輪詢，否則後續恢復也偵測不到', async () => {
    const warn = vi.fn();
    const monitor = new HealthMonitor({
      probe: scriptedProbe([true, true, true, false]),
      sink: {
        async send() {
          throw new Error('webhook 不可用');
        }
      },
      failureThreshold: 3,
      logger: { warn }
    });

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await expect(monitor.runOnce()).resolves.toBeDefined();
    }

    expect(monitor.currentState).toBe('healthy');
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ title: '平台健康檢查失敗' }),
      '健康告警送出失敗'
    );
  });
});

describe('排程器', () => {
  it('stop 之後不再執行檢查', async () => {
    vi.useFakeTimers();
    try {
      const probe = { check: vi.fn(async () => undefined) };
      const monitor = new HealthMonitor({ probe, sink: collectingSink() });
      const schedule = startHealthMonitor(monitor, 1000);

      await vi.advanceTimersByTimeAsync(2500);
      const callsBeforeStop = probe.check.mock.calls.length;
      schedule.stop();
      await vi.advanceTimersByTimeAsync(5000);

      expect(callsBeforeStop).toBeGreaterThan(0);
      expect(probe.check.mock.calls.length).toBe(callsBeforeStop);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('告警送往通知渠道', () => {
  function recordingChannel(
    kind: NotificationChannel['kind'],
    outcome: DeliveryOutcome = { status: 'delivered' }
  ): NotificationChannel & { received: RenderedNotification[] } {
    const received: RenderedNotification[] = [];
    return {
      kind,
      received,
      async deliver(_target, content) {
        received.push(content);
        return outcome;
      }
    };
  }

  const alert: RenderedNotification = {
    title: '平台健康檢查失敗',
    body: '服務無回應',
    severity: 'critical',
    link: '/',
    facts: []
  };

  it('送往所有已配置的目標', async () => {
    const slack = recordingChannel('slack');
    const lark = recordingChannel('lark');
    const sink = new NotificationAlertSink(
      [slack, lark],
      [
        { kind: 'slack', endpoint: 'https://hooks.example.com/a' },
        { kind: 'lark', endpoint: 'https://open.example.com/b' }
      ]
    );

    await sink.send(alert);

    expect(slack.received).toEqual([alert]);
    expect(lark.received).toEqual([alert]);
  });

  it('未啟用的渠道被略過而不拋錯', async () => {
    const sink = new NotificationAlertSink(
      [],
      [{ kind: 'slack', endpoint: 'https://hooks.example.com/a' }]
    );

    await expect(sink.send(alert)).resolves.toBeUndefined();
  });

  it('沒有配置任何目標時靜默結束', async () => {
    const sink = new NotificationAlertSink([recordingChannel('slack')], []);

    await expect(sink.send(alert)).resolves.toBeUndefined();
  });
});
