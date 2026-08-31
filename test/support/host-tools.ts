// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/**
 * 少數測試驗證的是特定平台或特定工具下的行為，在 Linux CI runner 上不成立。
 * 與其在 CI 安裝工具去模擬另一個平台，不如明確跳過並顯示為 skipped——
 * 報告上看得見，不會被靜默忽略，也不會讓 CI 長期紅燈而失去警示作用。
 *
 * 注意：跳過的前提是該測試驗證的確實是平台專屬行為。
 * 一般測試不應因為環境缺東西就跳過，那會讓缺陷藏起來。
 */

/** 偵測宿主機是否具備某個指令。 */
export function hasCommand(command: string): boolean {
  const result = spawnSync('command', ['-v', command], {
    shell: true,
    stdio: 'ignore'
  });
  return result.status === 0;
}

/**
 * 偵測是否執行於 WSL。
 *
 * 用於區分「pwsh 存在」與「pwsh 在 WSL 下的行為」：CI 的 Ubuntu runner
 * 裝有 pwsh，多數 PowerShell 測試因此正常通過，但 WSL 專屬的 process group
 * 終止行為（Start-Process 建立的子程序如何被 kill）在原生 Linux 不重現。
 */
export function isWsl(): boolean {
  if (process.platform !== 'linux') {
    return false;
  }
  try {
    return readFileSync('/proc/version', 'utf8').toLowerCase().includes('microsoft');
  } catch {
    return false;
  }
}
