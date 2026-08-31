// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { describe, expect, it } from 'vitest';

import { buildAnalyticsPath } from '../../web/src/api/analytics.js';
import {
  buildFailureMatrix,
  formatAnalyticsRate,
  formatDateInputValue
} from '../../web/src/pages/analytics-model.js';

describe('作者分析頁資料模型', () => {
  it('把日期範圍轉成後端接受的 RFC 3339 閉區間', () => {
    expect(
      buildAnalyticsPath('pkg / analytics', '2026-08-25', '2026-08-26')
    ).toBe(
      '/api/packages/pkg%20%2F%20analytics/analytics?start=2026-08-25T00%3A00%3A00.000Z&end=2026-08-26T23%3A59%3A59.999Z'
    );
  });

  it('拒絕反向日期範圍，避免送出必然失敗的請求', () => {
    expect(() =>
      buildAnalyticsPath('pkg-analytics', '2026-08-27', '2026-08-26')
    ).toThrow('開始日期不得晚於結束日期');
  });

  it('拒絕超過後端上限的分析期間', () => {
    expect(() =>
      buildAnalyticsPath('pkg-analytics', '2025-08-25', '2026-08-27')
    ).toThrow('分析期間不得超過 366 天');
  });

  it('成功率沒有分母時顯示尚無數據而不是 0%', () => {
    expect(formatAnalyticsRate(null)).toBe('尚無數據');
    expect(formatAnalyticsRate(2 / 3)).toBe('66.7%');
  });

  it('預設日期使用瀏覽器當地日曆日，不受 UTC 跨日影響', () => {
    expect(formatDateInputValue(new Date(2026, 7, 27, 0, 30))).toBe(
      '2026-08-27'
    );
  });

  it('把 failureCells 組成版本與作業系統的稀疏熱力矩陣', () => {
    expect(
      buildFailureMatrix([
        {
          version: '1.9.0',
          osType: 'linux',
          errorCode: 'E002',
          count: 1
        },
        {
          version: '1.10.0-beta.1',
          osType: 'windows',
          errorCode: 'E004',
          count: 2
        }
      ])
    ).toEqual({
      errorCodes: ['E002', 'E004'],
      rows: [
        {
          key: '1.9.0\u0000linux',
          version: '1.9.0',
          osType: 'linux',
          counts: [1, 0],
          total: 1
        },
        {
          key: '1.10.0-beta.1\u0000windows',
          version: '1.10.0-beta.1',
          osType: 'windows',
          counts: [0, 2],
          total: 2
        }
      ]
    });
  });
});
