// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import type { RenderedNotification } from '../notification/types.js';

/**
 * 單機 MVP 的健康輪詢。不引入 Prometheus 或外部 APM：
 * 週期性檢查資料庫可用性，狀態轉換時經通知渠道送出。
 * 見 docs/待決策與延後事項.md 的 D-5。
 */

export interface HealthProbe {
  /** 可用時 resolve，不可用時拋錯 */
  check(): Promise<void>;
}

export interface HealthAlertSink {
  send(content: RenderedNotification): Promise<void>;
}

export interface HealthMonitorOptions {
  probe: HealthProbe;
  sink: HealthAlertSink;
  /** 連續失敗幾次才視為異常。避免單次抖動就告警。 */
  failureThreshold?: number;
  clock?: () => Date;
  logger?: { warn: (details: object, message: string) => void };
}

export type HealthState = 'healthy' | 'unhealthy';

const DEFAULT_FAILURE_THRESHOLD = 3;

export class HealthMonitor {
  private readonly probe: HealthProbe;
  private readonly sink: HealthAlertSink;
  private readonly failureThreshold: number;
  private readonly clock: () => Date;
  private readonly logger: HealthMonitorOptions['logger'];

  private consecutiveFailures = 0;
  private state: HealthState = 'healthy';

  constructor(options: HealthMonitorOptions) {
    this.probe = options.probe;
    this.sink = options.sink;
    this.failureThreshold =
      options.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD;
    this.clock = options.clock ?? (() => new Date());
    this.logger = options.logger;
  }

  get currentState(): HealthState {
    return this.state;
  }

  /**
   * 執行一次檢查。只在狀態「轉換」時告警，持續異常不重複發送——
   * 否則每個輪詢週期都會產生一則訊息，很快就會被當成雜訊忽略。
   */
  async runOnce(): Promise<HealthState> {
    let failed = false;
    let reason = '';
    try {
      await this.probe.check();
    } catch (error) {
      failed = true;
      reason = error instanceof Error ? error.message : String(error);
    }

    if (failed) {
      this.consecutiveFailures += 1;
      if (
        this.state === 'healthy' &&
        this.consecutiveFailures >= this.failureThreshold
      ) {
        this.state = 'unhealthy';
        await this.emit({
          title: '平台健康檢查失敗',
          body: `連續 ${this.consecutiveFailures} 次檢查未通過，服務可能無法正常運作。`,
          severity: 'critical',
          link: '/',
          facts: [
            { label: '失敗原因', value: reason || '未提供' },
            { label: '發生時間', value: this.clock().toISOString() }
          ]
        });
      }
      return this.state;
    }

    const recovered = this.state === 'unhealthy';
    this.consecutiveFailures = 0;
    this.state = 'healthy';

    if (recovered) {
      await this.emit({
        title: '平台健康檢查已恢復',
        body: '服務已回復正常回應。',
        severity: 'info',
        link: '/',
        facts: [{ label: '恢復時間', value: this.clock().toISOString() }]
      });
    }

    return this.state;
  }

  private async emit(content: RenderedNotification): Promise<void> {
    this.logger?.warn(
      { severity: content.severity, title: content.title },
      '健康狀態轉換'
    );
    try {
      await this.sink.send(content);
    } catch {
      // 告警送不出去不能讓輪詢中斷，否則後續恢復也不會被偵測到。
      this.logger?.warn({ title: content.title }, '健康告警送出失敗');
    }
  }
}

export interface HealthMonitorSchedule {
  stop(): void;
}

/**
 * 以固定間隔驅動監視器。回傳的 stop 必須在程序關閉時呼叫，
 * 否則 timer 會讓行程無法退出。
 */
export function startHealthMonitor(
  monitor: HealthMonitor,
  intervalMs: number
): HealthMonitorSchedule {
  const timer = setInterval(() => {
    void monitor.runOnce();
  }, intervalMs);
  // 不阻止行程退出：監控不是行程存活的理由。
  timer.unref?.();

  return {
    stop: () => clearInterval(timer)
  };
}
