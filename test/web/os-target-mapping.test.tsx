// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { describe, expect, it } from 'vitest';

import { OS_TARGETS } from '../../web/src/pages/PackageDetailPage.js';
import { scriptTargetOsValues } from '../../src/modules/catalog/types.js';

/**
 * 前端的 OS 對照表與後端腳本生成端點的 enum 必須一致。
 *
 * 這兩處曾經不同步：Task 13 把後端收斂為 linux/macos、windows、wsl，
 * 前端仍送出舊的 linux，導致「檢視並下載」被驗證層擋下並回傳
 * VALIDATION_ERROR——使用者只看得到「請求欄位驗證失敗」，
 * 無從得知是哪個欄位。
 */
describe('前端 OS 對照表與後端 targetOs 詞彙', () => {
  it('送出的 targetOs 都是後端接受的值', () => {
    const accepted = new Set<string>(scriptTargetOsValues);

    for (const entry of OS_TARGETS) {
      expect(accepted).toContain(entry.targetOs);
    }
  });

  it('涵蓋後端支援的每一個目標，不遺漏選項', () => {
    const offered = new Set(OS_TARGETS.map((entry) => entry.targetOs));

    for (const value of scriptTargetOsValues) {
      expect(offered).toContain(value);
    }
  });

  it('WSL 與 Linux/macOS 是不同目標，不得合併', () => {
    // 兩者的腳本內容不同，合併會讓 WSL 使用者拿到錯誤的腳本。
    const wsl = OS_TARGETS.find((entry) => entry.declared.includes('wsl'));
    const linux = OS_TARGETS.find((entry) => entry.declared.includes('linux'));

    expect(wsl?.targetOs).toBe('wsl');
    expect(linux?.targetOs).not.toBe(wsl?.targetOs);
  });

  it('每個宣告值只對應一個目標，避免選項重複', () => {
    const declared = OS_TARGETS.flatMap((entry) => entry.declared);

    expect(new Set(declared).size).toBe(declared.length);
  });
});
