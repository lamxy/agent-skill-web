// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { describe, expect, it } from 'vitest';

import { deriveSupportFromTargets } from '../../src/modules/catalog/script-target-support.js';
import type {
  ScriptTargetOs,
  ScriptTargetRecord
} from '../../src/modules/catalog/types.js';

const now = new Date('2026-08-29T00:00:00.000Z');

function target(
  targetOs: ScriptTargetOs,
  clientRuntime: 'claude-code' | 'codex',
  overrides: Partial<ScriptTargetRecord> = {}
): ScriptTargetRecord {
  return {
    id: `${targetOs}-${clientRuntime}`,
    packageId: 'demo',
    packageVersion: '1.0.0',
    targetOs,
    clientRuntime,
    currentRevision: {
      id: 'rev-1',
      revision: 1,
      installCommand: 'true',
      uninstallCommand: 'true',
      usageGuide: '說明',
      hasResidualEffects: false,
      options: [],
      changeSummary: '初版',
      createdAt: now,
      createdByUid: 'author-1'
    },
    revisions: [],
    createdAt: now,
    updatedAt: now,
    ...overrides
  } as ScriptTargetRecord;
}

describe('由 script targets 導出可安裝目標', () => {
  it('沒有 target 時回傳 undefined，讓呼叫端回退到舊欄位', () => {
    expect(deriveSupportFromTargets([])).toBeUndefined();
  });

  it('linux/macos 展開為兩個宣告值', () => {
    const derived = deriveSupportFromTargets([
      target('linux/macos', 'claude-code')
    ]);

    expect(derived?.supportedOs).toEqual(['linux', 'macos']);
  });

  it('多個 target 的作業系統去重合併', () => {
    const derived = deriveSupportFromTargets([
      target('linux/macos', 'claude-code'),
      target('linux/macos', 'codex'),
      target('windows', 'codex')
    ]);

    expect(derived?.supportedOs).toEqual(['linux', 'macos', 'windows']);
  });

  it('client 以顯示名稱去重', () => {
    const derived = deriveSupportFromTargets([
      target('linux/macos', 'codex'),
      target('windows', 'codex')
    ]);

    expect(derived?.supportedClients).toEqual([
      {
        name: 'Codex',
        clientRuntime: 'codex',
        adaptationSource: 'publisher',
        maintainer: ''
      }
    ]);
  });

  it('保留舊欄位既有的 maintainer 與 adaptationSource', () => {
    const derived = deriveSupportFromTargets(
      [target('linux/macos', 'codex')],
      [{ name: 'Codex', adaptationSource: 'maintainer', maintainer: 'team-a' }]
    );

    expect(derived?.supportedClients).toEqual([
      {
        name: 'Codex',
        clientRuntime: 'codex',
        adaptationSource: 'maintainer',
        maintainer: 'team-a'
      }
    ]);
  });

  it('舊資料以 runtime 識別碼記錄 client 名稱時仍能對上', () => {
    // 既有資料可能寫 'codex' 而非顯示名 'Codex'，不得因此遺失 maintainer。
    const derived = deriveSupportFromTargets(
      [target('linux/macos', 'codex')],
      [{ name: 'codex', adaptationSource: 'publisher', maintainer: 'team-a' }]
    );

    expect(derived?.supportedClients[0]).toMatchObject({
      maintainer: 'team-a'
    });
  });

  it('已刪除的 target 不構成可安裝目標', () => {
    const derived = deriveSupportFromTargets([
      target('linux/macos', 'codex', { deletedAt: now })
    ]);

    expect(derived).toBeUndefined();
  });

  it('沒有現行版次的 target 不構成可安裝目標', () => {
    // 已建立但尚未填寫命令的 target 還不能安裝。
    const pending = target('linux/macos', 'codex');
    delete (pending as { currentRevision?: unknown }).currentRevision;

    expect(deriveSupportFromTargets([pending])).toBeUndefined();
  });

  it('混合有效與無效 target 時只採計有效者', () => {
    const derived = deriveSupportFromTargets([
      target('linux/macos', 'claude-code'),
      target('windows', 'codex', { deletedAt: now })
    ]);

    expect(derived?.supportedOs).toEqual(['linux', 'macos']);
    expect(derived?.supportedClients).toHaveLength(1);
  });

  it('wsl 目標獨立宣告，不併入 linux', () => {
    const derived = deriveSupportFromTargets([target('wsl', 'claude-code')]);

    expect(derived?.supportedOs).toEqual(['wsl']);
  });
});

describe('client 識別碼供前端呼叫 API 使用', () => {
  it('導出的 client 帶 clientRuntime 而不只有顯示名稱', () => {
    const derived = deriveSupportFromTargets([
      target('linux/macos', 'claude-code')
    ]);

    // 顯示名稱是 Claude Code，但 API 只接受 claude-code。
    expect(derived?.supportedClients[0]).toMatchObject({
      name: 'Claude Code',
      clientRuntime: 'claude-code'
    });
  });

  it('沿用舊欄位中繼資料時仍補上 clientRuntime', () => {
    const derived = deriveSupportFromTargets(
      [target('linux/macos', 'codex')],
      [{ name: 'Codex', adaptationSource: 'maintainer', maintainer: 'team-a' }]
    );

    expect(derived?.supportedClients[0]).toMatchObject({
      maintainer: 'team-a',
      clientRuntime: 'codex'
    });
  });

  it('每個 client 的 clientRuntime 都是 API 接受的值', () => {
    const derived = deriveSupportFromTargets([
      target('linux/macos', 'claude-code'),
      target('windows', 'codex')
    ]);

    for (const client of derived?.supportedClients ?? []) {
      expect(['claude-code', 'codex']).toContain(client.clientRuntime);
    }
  });
});
