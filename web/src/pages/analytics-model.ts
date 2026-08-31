// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import type { FailureCell } from '../api/types.js';

export interface FailureMatrixRow {
  key: string;
  version: string;
  osType: string;
  counts: number[];
  total: number;
}

export interface FailureMatrix {
  errorCodes: string[];
  rows: FailureMatrixRow[];
}

export function formatDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatAnalyticsRate(rate: number | null): string {
  return rate === null ? '尚無數據' : `${(rate * 100).toFixed(1)}%`;
}

export function buildFailureMatrix(cells: FailureCell[]): FailureMatrix {
  const errorCodes: string[] = [];
  const rowKeys: string[] = [];
  const cellsByRow = new Map<string, Map<string, number>>();

  for (const cell of cells) {
    if (!errorCodes.includes(cell.errorCode)) errorCodes.push(cell.errorCode);
    const key = `${cell.version}\u0000${cell.osType}`;
    if (!cellsByRow.has(key)) {
      rowKeys.push(key);
      cellsByRow.set(key, new Map());
    }
    const row = cellsByRow.get(key) as Map<string, number>;
    row.set(cell.errorCode, (row.get(cell.errorCode) ?? 0) + cell.count);
  }

  return {
    errorCodes,
    rows: rowKeys.map((key) => {
      const separator = key.indexOf('\u0000');
      const row = cellsByRow.get(key) as Map<string, number>;
      const counts = errorCodes.map((code) => row.get(code) ?? 0);
      return {
        key,
        version: key.slice(0, separator),
        osType: key.slice(separator + 1),
        counts,
        total: counts.reduce((sum, count) => sum + count, 0)
      };
    })
  };
}
