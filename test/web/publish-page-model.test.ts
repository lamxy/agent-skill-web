// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildPackageVersionPath,
  buildRevisionHistoryPath,
  buildScriptTargetPath,
  buildScriptTargetsPath,
  copyScriptTargetRevision,
  createScriptTarget,
  deleteScriptTarget,
  fetchPackageVersion,
  fetchScriptTargetRevisions,
  saveScriptTargetRevision
} from '../../web/src/api/publish.js';
import type {
  PackageSummary,
  PackageVersionSummary,
  ScriptTargetRecord,
  ScriptTargetRevision
} from '../../web/src/api/types.js';
import {
  TARGET_MATRIX,
  applyTargetRecord,
  buildCopyRevisionPayload,
  buildCreateVersionPayload,
  buildSaveRevisionPayload,
  changeScriptOptionType,
  createLatestRequestGate,
  hydratePublishSession,
  optionEnvironmentBinding,
  optionEditorRowKey,
  publishPackageOptions,
  reviewReadiness,
  scriptFilenamePattern,
  sortRevisionHistory,
  targetDraftFromRecord,
  targetKey,
  targetRowPresentation,
  validateTargetDraft
} from '../../web/src/pages/publish-model.js';

const now = '2026-08-28T01:00:00.000Z';

function revision(scriptVersion: number, overrides: Partial<ScriptTargetRevision> = {}): ScriptTargetRevision {
  return {
    id: `revision-${scriptVersion}`,
    targetId: 'target-linux-codex',
    targetOs: 'linux/macos',
    clientRuntime: 'codex',
    scriptVersion,
    installCommand: `install v${scriptVersion}`,
    uninstallCommand: `uninstall v${scriptVersion}`,
    options: [],
    usageInstructions: '下載後執行腳本。',
    hasResidualEffects: false,
    contentDigest: `digest-${scriptVersion}`,
    legacyImported: false,
    createdByUid: 'publisher-1',
    createdAt: now,
    ...overrides
  };
}

function target(overrides: Partial<ScriptTargetRecord> = {}): ScriptTargetRecord {
  const currentRevision = revision(2);
  return {
    id: 'target-linux-codex',
    packageId: 'superpowers',
    packageVersion: '3.2.1',
    targetOs: 'linux/macos',
    clientRuntime: 'codex',
    currentRevision,
    revisions: [revision(1), currentRevision],
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function version(scriptTargets: ScriptTargetRecord[] = [target()]): PackageVersionSummary {
  return {
    id: 'version-1',
    packageId: 'superpowers',
    version: '3.2.1',
    releaseNotes: 'Matrix release',
    supportedOs: [],
    supportedClients: [],
    lifecycle: 'draft',
    installCommand: '',
    uninstallCommand: '',
    hasResidualEffects: false,
    scriptTargets,
    authorUid: 'publisher-1',
    createdAt: now,
    updatedAt: now
  };
}

const packageChoice: PackageSummary = {
  packageId: 'superpowers', type: 'skill', name: 'Superpowers',
  purpose: '提供規格與測試驅動工作流', ownerTeam: 'Developer Experience',
  category: '開發工具', categoryCode: 'backend', visibility: 'internal',
  sourceUri: 'https://git.example.com/platform/superpowers', license: 'MIT',
  source: 'custom', publisher: { kind: 'organization', name: 'Developer Experience' },
  grade: 'basic',
  lifecycle: 'active', createdAt: now, updatedAt: now, latestVersion: version([])
};

afterEach(() => vi.unstubAllGlobals());

describe('Task 13 上架 Matrix pure model', () => {
  it('六個 OS 與 Client key、標籤及語言都唯一且穩定', () => {
    expect(TARGET_MATRIX).toEqual([
      { key: 'linux/macos:claude-code', targetOs: 'linux/macos', clientRuntime: 'claude-code', osLabel: 'Linux / macOS', clientLabel: 'Claude Code', language: 'bash' },
      { key: 'linux/macos:codex', targetOs: 'linux/macos', clientRuntime: 'codex', osLabel: 'Linux / macOS', clientLabel: 'Codex', language: 'bash' },
      { key: 'windows:claude-code', targetOs: 'windows', clientRuntime: 'claude-code', osLabel: 'Windows', clientLabel: 'Claude Code', language: 'PowerShell' },
      { key: 'windows:codex', targetOs: 'windows', clientRuntime: 'codex', osLabel: 'Windows', clientLabel: 'Codex', language: 'PowerShell' },
      { key: 'wsl:claude-code', targetOs: 'wsl', clientRuntime: 'claude-code', osLabel: 'WSL', clientLabel: 'Claude Code', language: 'bash' },
      { key: 'wsl:codex', targetOs: 'wsl', clientRuntime: 'codex', osLabel: 'WSL', clientLabel: 'Codex', language: 'bash' }
    ]);
    expect(targetKey('wsl', 'codex')).toBe('wsl:codex');
  });

  it('檔名包含規範化目標、userRef placeholder 與腳本版本', () => {
    expect(scriptFilenamePattern('superpowers', '3.2.1', target())).toBe(
      'install-superpowers-3.2.1-linux-macos-codex-{userRef}-v2.sh'
    );
    expect(scriptFilenamePattern('pkg', '1.0.0', target({
      targetOs: 'windows', clientRuntime: 'claude-code',
      currentRevision: revision(4, { targetOs: 'windows', clientRuntime: 'claude-code' })
    }))).toBe('install-pkg-1.0.0-windows-claude-code-{userRef}-v4.ps1');
  });

  it('從 server version hydrate Matrix，不依賴舊頁面 state', () => {
    const hydrated = hydratePublishSession(version());
    expect(hydrated).toMatchObject({
      packageId: 'superpowers', packageVersion: '3.2.1',
      releaseNotes: 'Matrix release', selectedTarget: 'linux/macos:codex'
    });
    expect(Object.keys(hydrated.targets)).toEqual(['linux/macos:codex']);
    expect(hydrated.targets['linux/macos:codex']?.currentRevision?.installCommand).toBe('install v2');
    expect(hydrated.deletedTargets).toEqual([]);
  });

  it('軟刪除保留可追溯紀錄，重新加入後移回 active Matrix', () => {
    const removed = target({ deletedAt: now, deletedByUid: 'publisher-1', currentRevision: undefined });
    const deletedSession = hydratePublishSession(version([removed]));

    expect(deletedSession.targets).toEqual({});
    expect(deletedSession.deletedTargets.map((item) => item.id)).toEqual(['target-linux-codex']);

    const restored = target({ currentRevision: undefined, revisions: [revision(1), revision(3)] });
    const restoredSession = applyTargetRecord(deletedSession, restored);
    expect(restoredSession.targets['linux/macos:codex']?.id).toBe('target-linux-codex');
    expect(restoredSession.deletedTargets).toEqual([]);
  });

  it('刪除非目前 target 不會清空另一個 editor selection', () => {
    const first = target();
    const other = target({
      id: 'target-windows-codex', targetOs: 'windows', clientRuntime: 'codex',
      currentRevision: revision(1, { targetId: 'target-windows-codex', targetOs: 'windows' }),
      revisions: []
    });
    const selected = target({
      id: 'target-wsl-codex', targetOs: 'wsl', clientRuntime: 'codex',
      currentRevision: revision(1, { targetId: 'target-wsl-codex', targetOs: 'wsl' }),
      revisions: []
    });
    const session = { ...hydratePublishSession(version([first, other, selected])), selectedTarget: 'wsl:codex' as const };
    const removedOther = { ...other, currentRevision: undefined, deletedAt: now, deletedByUid: 'publisher-1' };

    expect(applyTargetRecord(session, removedOther).selectedTarget).toBe('wsl:codex');
  });

  it('copy response 顯示 provenance，後續 server edit response 清除且來源不變', () => {
    const source = target();
    const copied = target({
      id: 'target-windows-claude', targetOs: 'windows', clientRuntime: 'claude-code',
      currentRevision: revision(1, {
        id: 'copy-v1', targetId: 'target-windows-claude',
        targetOs: 'windows', clientRuntime: 'claude-code',
        copiedFrom: { targetId: source.id, targetOs: source.targetOs, clientRuntime: source.clientRuntime, scriptVersion: 2 }
      }),
      revisions: []
    });
    const edited = {
      ...copied,
      currentRevision: revision(2, {
        id: 'copy-v2', targetId: copied.id, targetOs: 'windows',
        clientRuntime: 'claude-code', installCommand: 'edited destination'
      })
    };
    const updated = applyTargetRecord(hydratePublishSession(version([source, copied])), edited);

    expect(buildCopyRevisionPayload(source.id, copied, '跨組合複製')).toEqual({
      sourceTargetId: 'target-linux-codex', expectedScriptVersion: 1,
      changeDescription: '跨組合複製'
    });
    expect(source.currentRevision?.installCommand).toBe('install v2');
    expect(updated.targets['windows:claude-code']?.currentRevision?.installCommand).toBe('edited destination');
    expect(updated.targets['windows:claude-code']?.currentRevision?.copiedFrom).toBeUndefined();
  });

  it('pending restore 以歷史最大版本作 CAS 並建立精確 save payload', () => {
    const draft = targetDraftFromRecord(target({
      currentRevision: undefined,
      revisions: [revision(1), revision(3)]
    }));
    expect(draft.expectedScriptVersion).toBe(3);
    expect(buildSaveRevisionPayload({
      ...draft,
      installCommand: ' install restored ', uninstallCommand: ' uninstall restored ',
      usageInstructions: ' 使用說明 ', changeDescription: ' restore v4 '
    })).toEqual({
      expectedScriptVersion: 3,
      installCommand: 'install restored', uninstallCommand: 'uninstall restored',
      options: [], usageInstructions: '使用說明', hasResidualEffects: false,
      changeDescription: 'restore v4'
    });
  });

  it('history 由新到舊且空描述顯示無描述資訊', () => {
    expect(sortRevisionHistory([
      revision(1), revision(3, { changeDescription: '修正 Windows' }),
      revision(2, { changeDescription: '  ' })
    ]).map((item) => ({ version: item.scriptVersion, description: item.displayDescription }))).toEqual([
      { version: 3, description: '修正 Windows' },
      { version: 2, description: '無描述資訊' },
      { version: 1, description: '無描述資訊' }
    ]);
  });

  it('option name 產生 ASP_OPT_ 環境變數預覽', () => {
    expect(optionEnvironmentBinding('--scope')).toEqual({ environmentName: 'ASP_OPT_SCOPE', shellPreview: '${ASP_OPT_SCOPE}' });
    expect(optionEnvironmentBinding('--with-hooks')).toEqual({ environmentName: 'ASP_OPT_WITH_HOOKS', shellPreview: '${ASP_OPT_WITH_HOOKS}' });
  });

  it('option row identity 不隨受控參數名改變', () => {
    expect(optionEditorRowKey(1)).toBe('option-row-1');
    expect(optionEditorRowKey(1)).toBe('option-row-1');
  });

  it('切換 option type 會同步正規化 default 與 choices', () => {
    const selectOption = {
      name: '--scope', type: 'select' as const, description: '安裝層級',
      defaultValue: 'user', choices: ['user', 'project']
    };

    expect(changeScriptOptionType(selectOption, 'boolean')).toEqual({
      name: '--scope', type: 'boolean', description: '安裝層級', defaultValue: false
    });
    expect(changeScriptOptionType({ ...selectOption, defaultValue: true }, 'text')).toEqual({
      name: '--scope', type: 'text', description: '安裝層級', defaultValue: ''
    });
    const { choices: _droppedChoices, ...textOption } = { ...selectOption, type: 'text' as const };
    expect(changeScriptOptionType(textOption, 'select')).toEqual({
      ...selectOption, choices: ['user']
    });
  });

  it('option 格式、重名與 select default 錯誤會阻擋保存', () => {
    const base = targetDraftFromRecord(target());
    expect(validateTargetDraft({
      ...base,
      options: [
        { name: 'scope', type: 'text', description: '', defaultValue: '' },
        { name: 'scope', type: 'select', description: '重名', defaultValue: 'team', choices: ['user'] }
      ]
    }).options).toContain('參數名');

    expect(validateTargetDraft({
      ...base,
      options: [{ name: '--scope', type: 'select', description: '安裝層級', defaultValue: 'team', choices: ['user'] }]
    }).options).toContain('預設值');
  });

  it('Matrix row 明確區分未加入、待填寫、已填寫與複製狀態並顯示字數', () => {
    expect(targetRowPresentation(undefined, 'bash')).toEqual({ status: '未加入', details: 'bash · 尚未加入' });
    expect(targetRowPresentation(target({ currentRevision: undefined, revisions: [] }), 'bash')).toEqual({
      status: '待填寫', details: 'bash · 尚未填寫命令'
    });
    expect(targetRowPresentation(target(), 'bash')).toEqual({
      status: '已填寫', details: 'bash · 10 字元 · script v2 · 0 個選項'
    });
    expect(targetRowPresentation(target({
      currentRevision: revision(2, {
        copiedFrom: { targetId: 'source', targetOs: 'wsl', clientRuntime: 'claude-code', scriptVersion: 1 }
      })
    }), 'bash').status).toBe('複製自 WSL · Claude Code v1');
  });

  it('新互動會讓舊 request token 失效，避免 stale response 覆蓋 editor', () => {
    const gate = createLatestRequestGate();
    const savingA = gate.begin();
    const loadingB = gate.begin();
    expect(gate.isCurrent(savingA)).toBe(false);
    expect(gate.isCurrent(loadingB)).toBe(true);
    gate.invalidate();
    expect(gate.isCurrent(loadingB)).toBe(false);
  });

  it('usage、命令與殘留必填錯誤會阻擋 current target 保存', () => {
    expect(validateTargetDraft({
      ...targetDraftFromRecord(target({ currentRevision: undefined, revisions: [] })),
      hasResidualEffects: true
    })).toEqual({
      installCommand: '請填寫安裝命令。',
      uninstallCommand: '請填寫解除安裝命令。',
      usageInstructions: '請填寫腳本使用說明。',
      residualDescription: '請說明解除安裝後留下的內容。',
      manualCleanupSteps: '請填寫手動清理步驟。'
    });
  });

  it('送審完整性以 active target 與 pending current revision 計算', () => {
    expect(reviewReadiness({})).toEqual({
      activeCount: 0, pendingCount: 0, canSubmit: false,
      message: '至少加入一個腳本組合後才能送出審核。'
    });
    expect(reviewReadiness({
      'linux/macos:codex': target(),
      'windows:codex': target({ id: 'pending', targetOs: 'windows', clientRuntime: 'codex', currentRevision: undefined, revisions: [] })
    })).toEqual({
      activeCount: 2, pendingCount: 1, canSubmit: false,
      message: '尚有 1 個組合未填寫完整命令。'
    });
  });

  it('版本建立 payload 不含任何 legacy command 或 target 欄位', () => {
    expect(buildCreateVersionPayload(' 3.2.1 ', ' 修正安裝路徑 ')).toEqual({ version: '3.2.1', releaseNotes: '修正安裝路徑' });
    expect(buildCreateVersionPayload('3.2.1', ' ')).toEqual({ version: '3.2.1' });
  });

  it('套件選單顯示名稱、真實 ID 與維護團隊', () => {
    expect(publishPackageOptions([packageChoice])).toEqual([{
      value: 'superpowers', label: 'Superpowers · superpowers · Developer Experience'
    }]);
  });
});

describe('Task 13 publish API client', () => {
  it('所有 target path 都逐段 URL encode', () => {
    expect(buildPackageVersionPath('pkg /一', '1.0 beta')).toBe('/api/packages/pkg%20%2F%E4%B8%80/versions/1.0%20beta');
    expect(buildScriptTargetsPath('pkg /一', '1.0 beta')).toBe('/api/packages/pkg%20%2F%E4%B8%80/versions/1.0%20beta/script-targets');
    expect(buildScriptTargetPath('pkg', '1.0', 'target /一')).toBe('/api/packages/pkg/versions/1.0/script-targets/target%20%2F%E4%B8%80');
    expect(buildRevisionHistoryPath('pkg', '1.0', 'target /一')).toBe('/api/packages/pkg/versions/1.0/script-targets/target%20%2F%E4%B8%80/revisions');
  });

  it('GET/create/save/copy/delete/history 使用精確 method 與 body', async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify(target()), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchSpy);

    await fetchPackageVersion('pkg', '1.0');
    await createScriptTarget('pkg', '1.0', { targetOs: 'wsl', clientRuntime: 'codex' });
    await saveScriptTargetRevision('pkg', '1.0', 'target-1', {
      expectedScriptVersion: 0, installCommand: 'install', uninstallCommand: 'uninstall',
      options: [], usageInstructions: 'help', hasResidualEffects: false
    });
    await copyScriptTargetRevision('pkg', '1.0', 'target-1', { sourceTargetId: 'source-1', expectedScriptVersion: 0 });
    await deleteScriptTarget('pkg', '1.0', 'target-1', 1);
    await fetchScriptTargetRevisions('pkg', '1.0', 'target-1');

    expect((fetchSpy.mock.calls as unknown as Array<[string, RequestInit]>).map(([path, options]) => ({
      path, method: options.method, body: options.body
    }))).toEqual([
      { path: '/api/packages/pkg/versions/1.0', method: 'GET', body: undefined },
      { path: '/api/packages/pkg/versions/1.0/script-targets', method: 'POST', body: JSON.stringify({ targetOs: 'wsl', clientRuntime: 'codex' }) },
      { path: '/api/packages/pkg/versions/1.0/script-targets/target-1', method: 'PUT', body: JSON.stringify({ expectedScriptVersion: 0, installCommand: 'install', uninstallCommand: 'uninstall', options: [], usageInstructions: 'help', hasResidualEffects: false }) },
      { path: '/api/packages/pkg/versions/1.0/script-targets/target-1/copy-from', method: 'POST', body: JSON.stringify({ sourceTargetId: 'source-1', expectedScriptVersion: 0 }) },
      { path: '/api/packages/pkg/versions/1.0/script-targets/target-1', method: 'DELETE', body: JSON.stringify({ expectedScriptVersion: 1 }) },
      { path: '/api/packages/pkg/versions/1.0/script-targets/target-1/revisions', method: 'GET', body: undefined }
    ]);
  });

  it('後端巢狀 error code 與訊息由 API client 原樣傳播', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      error: { code: 'SCRIPT_TARGET_REVISION_CONFLICT', message: '腳本目標已更新' }
    }), { status: 409, headers: { 'content-type': 'application/json' } })));

    await expect(createScriptTarget('pkg', '1.0', { targetOs: 'wsl', clientRuntime: 'codex' }))
      .rejects.toEqual(expect.objectContaining({
        statusCode: 409, code: 'SCRIPT_TARGET_REVISION_CONFLICT',
        message: '腳本目標已更新', retryable: false
      }));
  });
});
