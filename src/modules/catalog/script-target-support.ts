// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import type {
  ClientSupport,
  ScriptTargetOs,
  ScriptTargetRecord
} from './types.js';

/**
 * 由 script targets 導出版本的 supportedOs 與 supportedClients。
 *
 * Task 13 把命令改成以「系統 × Client」為鍵的 target 表後，
 * `package_versions` 的 supported_os／supported_clients 兩個舊欄位
 * 在建立版本時固定寫入空陣列，且新增 target 時不回寫。目錄與詳情頁
 * 仍讀舊欄位，導致新建版本永遠沒有可選的系統與 Client，詳情頁因此
 * 不顯示下載入口。
 *
 * 真實來源是 target 表，因此在讀取層導出，讓所有消費端一致。
 * 沒有 target 的相容期舊資料回退到舊欄位，見 D-3 結案備註。
 */

/** target 的收斂 OS 對應到版本層級宣告的作業系統。 */
const TARGET_OS_DECLARATIONS: Record<ScriptTargetOs, string[]> = {
  'linux/macos': ['linux', 'macos'],
  windows: ['windows'],
  wsl: ['wsl']
};

const CLIENT_RUNTIME_LABELS: Record<string, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex'
};

export function clientRuntimeLabel(clientRuntime: string): string {
  return CLIENT_RUNTIME_LABELS[clientRuntime] ?? clientRuntime;
}

/** 舊資料的 client 名稱大小寫不一，比對時一律正規化。 */
function matchesClient(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

export interface DerivedVersionSupport {
  supportedOs: string[];
  supportedClients: ClientSupport[];
}

/** 只有 active（未刪除且有現行版次）的 target 才構成可安裝目標。 */
function isActive(target: ScriptTargetRecord): boolean {
  return !target.deletedAt && Boolean(target.currentRevision);
}

export function deriveSupportFromTargets(
  scriptTargets: readonly ScriptTargetRecord[],
  existingClients: readonly ClientSupport[] = []
): DerivedVersionSupport | undefined {
  const active = scriptTargets.filter(isActive);
  // 沒有任何 target 時回傳 undefined，讓呼叫端回退到舊欄位。
  if (active.length === 0) {
    return undefined;
  }

  const supportedOs: string[] = [];
  for (const target of active) {
    for (const declared of TARGET_OS_DECLARATIONS[target.targetOs] ?? []) {
      if (!supportedOs.includes(declared)) {
        supportedOs.push(declared);
      }
    }
  }

  const supportedClients: ClientSupport[] = [];
  for (const target of active) {
    const label = clientRuntimeLabel(target.clientRuntime);
    if (supportedClients.some((client) => matchesClient(client.name, label))) {
      continue;
    }
    // 保留舊欄位既有的 maintainer 與 adaptationSource，這些是 target
    // 不持有的中繼資料。舊資料可能以 runtime 識別碼（codex）而非顯示名
    // （Codex）記錄，因此比對時忽略大小寫並同時接受兩種寫法。
    const existing = existingClients.find(
      (client) =>
        matchesClient(client.name, label) ||
        matchesClient(client.name, target.clientRuntime)
    );
    // 一律帶上 runtime 識別碼：前端要用它呼叫腳本生成端點，
    // 顯示名稱（Claude Code）不是 API 接受的值（claude-code）。
    supportedClients.push({
      ...(existing ?? {
        name: label,
        adaptationSource: 'publisher' as const,
        maintainer: ''
      }),
      clientRuntime: target.clientRuntime
    });
  }

  return { supportedOs, supportedClients };
}
