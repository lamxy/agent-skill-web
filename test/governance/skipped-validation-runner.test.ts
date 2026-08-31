// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { describe, expect, it } from 'vitest';

import {
  SKIPPED_RUNNER_VERSION,
  SkippedValidationRunner
} from '../../src/modules/governance/validation-runner.js';

/**
 * VALIDATION_MODE=manual 時的 runner。關鍵性質是「不偽裝成通過」：
 * 若回報 passed，審核者會誤以為腳本已通過自動驗證，實際上沒跑過任何檢查。
 */
describe('SkippedValidationRunner', () => {
  it('回報 skipped 而非 passed，避免審核者誤判已通過機器驗證', async () => {
    const result = await new SkippedValidationRunner().run();

    expect(result.status).toBe('skipped');
    expect(result.status).not.toBe('passed');
  });

  it('runnerVersion 可辨識為人工審核模式，供前端顯示提示', () => {
    expect(SKIPPED_RUNNER_VERSION).toContain('manual-review');
  });

  it('不產生任何矩陣結果：沒有實際執行過驗證', async () => {
    const result = await new SkippedValidationRunner().run();

    expect(result.matrixResults).toEqual([]);
  });

  it('不帶 errorCode：跳過不是失敗', async () => {
    const result = await new SkippedValidationRunner().run();

    expect(result.errorCode).toBeUndefined();
  });
});
