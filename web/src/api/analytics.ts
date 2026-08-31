// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { request } from './client.js';
import type { PackageAnalyticsReport } from './types.js';

const calendarDatePattern = /^\d{4}-\d{2}-\d{2}$/;

function parseCalendarDate(value: string, endOfDay: boolean): Date {
  if (!calendarDatePattern.test(value)) {
    throw new Error('日期格式無效');
  }
  const timestamp = `${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`;
  const parsed = new Date(timestamp);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error('日期格式無效');
  }
  return parsed;
}

export function buildAnalyticsPath(
  packageId: string,
  startDate: string,
  endDate: string
): string {
  const start = parseCalendarDate(startDate, false);
  const end = parseCalendarDate(endDate, true);
  if (start.getTime() > end.getTime()) {
    throw new Error('開始日期不得晚於結束日期');
  }
  const maximumPeriodMilliseconds = 366 * 24 * 60 * 60 * 1_000;
  if (end.getTime() - start.getTime() > maximumPeriodMilliseconds) {
    throw new Error('分析期間不得超過 366 天');
  }

  const query = new URLSearchParams({
    start: start.toISOString(),
    end: end.toISOString()
  });
  return `/api/packages/${encodeURIComponent(packageId)}/analytics?${query.toString()}`;
}

export function fetchPackageAnalytics(
  packageId: string,
  startDate: string,
  endDate: string,
  signal: AbortSignal
): Promise<PackageAnalyticsReport> {
  return request<PackageAnalyticsReport>(
    buildAnalyticsPath(packageId, startDate, endDate),
    { signal }
  );
}
