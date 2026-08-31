// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import type {
  ClientRuntime,
  CopyScriptTargetRevisionInput,
  CreatePackageVersionInput,
  PackageSummary,
  PackageVersionSummary,
  SaveScriptTargetRevisionInput,
  ScriptOptionDefinition,
  ScriptTargetRecord,
  ScriptTargetRevision,
  TargetOs
} from '../api/types.js';

export type TargetKey = `${TargetOs}:${ClientRuntime}`;

export const TARGET_MATRIX = [
  { key: 'linux/macos:claude-code', targetOs: 'linux/macos', clientRuntime: 'claude-code', osLabel: 'Linux / macOS', clientLabel: 'Claude Code', language: 'bash' },
  { key: 'linux/macos:codex', targetOs: 'linux/macos', clientRuntime: 'codex', osLabel: 'Linux / macOS', clientLabel: 'Codex', language: 'bash' },
  { key: 'windows:claude-code', targetOs: 'windows', clientRuntime: 'claude-code', osLabel: 'Windows', clientLabel: 'Claude Code', language: 'PowerShell' },
  { key: 'windows:codex', targetOs: 'windows', clientRuntime: 'codex', osLabel: 'Windows', clientLabel: 'Codex', language: 'PowerShell' },
  { key: 'wsl:claude-code', targetOs: 'wsl', clientRuntime: 'claude-code', osLabel: 'WSL', clientLabel: 'Claude Code', language: 'bash' },
  { key: 'wsl:codex', targetOs: 'wsl', clientRuntime: 'codex', osLabel: 'WSL', clientLabel: 'Codex', language: 'bash' }
] as const;

export interface TargetDraft {
  expectedScriptVersion: number;
  installCommand: string;
  uninstallCommand: string;
  options: ScriptOptionDefinition[];
  usageInstructions: string;
  hasResidualEffects: boolean;
  residualDescription: string;
  manualCleanupSteps: string;
  changeDescription: string;
}

export interface PublishSession {
  packageId: string;
  packageVersion: string;
  releaseNotes: string;
  selectedTarget: TargetKey | undefined;
  targets: Partial<Record<TargetKey, ScriptTargetRecord>>;
  deletedTargets: ScriptTargetRecord[];
}

export interface LatestRequestGate {
  begin: () => number;
  invalidate: () => void;
  isCurrent: (token: number) => boolean;
}

export function targetKey(targetOs: TargetOs, clientRuntime: ClientRuntime): TargetKey {
  return `${targetOs}:${clientRuntime}`;
}

export function targetMeta(targetOs: TargetOs, clientRuntime: ClientRuntime) {
  return TARGET_MATRIX.find((item) => item.targetOs === targetOs && item.clientRuntime === clientRuntime)!;
}

export function scriptFilenamePattern(packageId: string, packageVersion: string, target: ScriptTargetRecord): string {
  const version = currentScriptVersion(target);
  const normalizedOs = target.targetOs.replace('/', '-');
  const extension = target.targetOs === 'windows' ? 'ps1' : 'sh';
  return `install-${packageId}-${packageVersion}-${normalizedOs}-${target.clientRuntime}-{userRef}-v${version}.${extension}`;
}

export function hydratePublishSession(version: PackageVersionSummary): PublishSession {
  const targets: Partial<Record<TargetKey, ScriptTargetRecord>> = {};
  const deletedTargets: ScriptTargetRecord[] = [];
  for (const target of version.scriptTargets ?? []) {
    if (target.deletedAt) deletedTargets.push(target);
    else targets[targetKey(target.targetOs, target.clientRuntime)] = target;
  }
  return {
    packageId: version.packageId,
    packageVersion: version.version,
    releaseNotes: version.releaseNotes ?? '',
    selectedTarget: TARGET_MATRIX.find((item) => targets[item.key])?.key,
    targets,
    deletedTargets
  };
}

export function applyTargetRecord(session: PublishSession, target: ScriptTargetRecord): PublishSession {
  const key = targetKey(target.targetOs, target.clientRuntime);
  const targets = { ...session.targets };
  const deletedTargets = session.deletedTargets.filter((item) => item.id !== target.id);
  if (target.deletedAt) {
    delete targets[key];
    deletedTargets.push(target);
  } else {
    targets[key] = target;
  }
  return {
    ...session,
    targets,
    deletedTargets,
    selectedTarget: target.deletedAt
      ? session.selectedTarget === key
        ? TARGET_MATRIX.find((item) => targets[item.key])?.key
        : session.selectedTarget
      : key
  };
}

export function createLatestRequestGate(): LatestRequestGate {
  let currentToken = 0;
  return {
    begin: () => ++currentToken,
    invalidate: () => { currentToken += 1; },
    isCurrent: (token) => token === currentToken
  };
}

export function optionEditorRowKey(index: number): string {
  return `option-row-${index}`;
}

export function changeScriptOptionType(
  option: ScriptOptionDefinition,
  type: ScriptOptionDefinition['type']
): ScriptOptionDefinition {
  if (type === 'boolean') {
    return {
      name: option.name,
      type,
      description: option.description,
      defaultValue: typeof option.defaultValue === 'boolean' ? option.defaultValue : false
    };
  }
  const defaultValue = typeof option.defaultValue === 'string' ? option.defaultValue : '';
  if (type === 'text') {
    return { name: option.name, type, description: option.description, defaultValue };
  }
  const choices = option.choices?.length
    ? [...option.choices]
    : defaultValue
      ? [defaultValue]
      : [];
  return { name: option.name, type, description: option.description, defaultValue, choices };
}

export function targetRowPresentation(
  target: ScriptTargetRecord | undefined,
  language: string
): { status: string; details: string } {
  if (!target) return { status: '未加入', details: `${language} · 尚未加入` };
  const revision = target.currentRevision;
  if (!revision) return { status: '待填寫', details: `${language} · 尚未填寫命令` };
  const copiedFrom = revision.copiedFrom;
  const status = copiedFrom
    ? `複製自 ${targetMeta(copiedFrom.targetOs, copiedFrom.clientRuntime).osLabel} · ${targetMeta(copiedFrom.targetOs, copiedFrom.clientRuntime).clientLabel} v${copiedFrom.scriptVersion}`
    : '已填寫';
  return {
    status,
    details: `${language} · ${revision.installCommand.length} 字元 · script v${revision.scriptVersion} · ${revision.options.length} 個選項`
  };
}

export function currentScriptVersion(target: ScriptTargetRecord): number {
  return target.currentRevision?.scriptVersion
    ?? Math.max(0, ...target.revisions.map((item) => item.scriptVersion));
}

export function targetDraftFromRecord(target: ScriptTargetRecord): TargetDraft {
  const revision = target.currentRevision;
  return {
    expectedScriptVersion: currentScriptVersion(target),
    installCommand: revision?.installCommand ?? '',
    uninstallCommand: revision?.uninstallCommand ?? '',
    options: revision?.options.map((item) => ({
      ...item,
      ...(item.choices ? { choices: [...item.choices] } : {})
    })) ?? [],
    usageInstructions: revision?.usageInstructions ?? '',
    hasResidualEffects: revision?.hasResidualEffects ?? false,
    residualDescription: revision?.residualDescription ?? '',
    manualCleanupSteps: revision?.manualCleanupSteps ?? '',
    changeDescription: ''
  };
}

function optionalTrimmed(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed || undefined;
}

export function buildSaveRevisionPayload(draft: TargetDraft): SaveScriptTargetRevisionInput {
  const changeDescription = optionalTrimmed(draft.changeDescription);
  return {
    expectedScriptVersion: draft.expectedScriptVersion,
    installCommand: draft.installCommand.trim(),
    uninstallCommand: draft.uninstallCommand.trim(),
    options: draft.options.map((option) => {
      const choices = option.choices?.map((choice) => choice.trim()).filter(Boolean);
      return {
        ...option,
        name: option.name.trim(),
        description: option.description.trim(),
        ...(choices ? { choices } : {})
      };
    }),
    usageInstructions: draft.usageInstructions.trim(),
    hasResidualEffects: draft.hasResidualEffects,
    ...(draft.hasResidualEffects ? {
      residualDescription: draft.residualDescription.trim(),
      manualCleanupSteps: draft.manualCleanupSteps.trim()
    } : {}),
    ...(changeDescription ? { changeDescription } : {})
  };
}

export function buildCopyRevisionPayload(
  sourceTargetId: string,
  destination: ScriptTargetRecord,
  changeDescription: string
): CopyScriptTargetRevisionInput {
  const description = optionalTrimmed(changeDescription);
  return {
    sourceTargetId,
    expectedScriptVersion: currentScriptVersion(destination),
    ...(description ? { changeDescription: description } : {})
  };
}

export function sortRevisionHistory(revisions: ScriptTargetRevision[]) {
  return [...revisions]
    .sort((left, right) => right.scriptVersion - left.scriptVersion)
    .map((item) => ({ ...item, displayDescription: item.changeDescription?.trim() || '無描述資訊' }));
}

export function optionEnvironmentBinding(name: string): { environmentName: string; shellPreview: string } {
  const environmentName = `ASP_OPT_${name.trim().replace(/^--/, '').replace(/[^a-zA-Z0-9]+/g, '_').toUpperCase()}`;
  return { environmentName, shellPreview: `\${${environmentName}}` };
}

export function validateTargetDraft(draft: TargetDraft): Partial<Record<keyof TargetDraft, string>> {
  const errors: Partial<Record<keyof TargetDraft, string>> = {};
  if (!draft.installCommand.trim()) errors.installCommand = '請填寫安裝命令。';
  if (!draft.uninstallCommand.trim()) errors.uninstallCommand = '請填寫解除安裝命令。';
  if (!draft.usageInstructions.trim()) errors.usageInstructions = '請填寫腳本使用說明。';
  else if (draft.usageInstructions.length > 10_000) errors.usageInstructions = '腳本使用說明不可超過 10,000 字元。';
  if (draft.hasResidualEffects && !draft.residualDescription.trim()) errors.residualDescription = '請說明解除安裝後留下的內容。';
  else if (draft.residualDescription.length > 10_000) errors.residualDescription = '殘留內容說明不可超過 10,000 字元。';
  if (draft.hasResidualEffects && !draft.manualCleanupSteps.trim()) errors.manualCleanupSteps = '請填寫手動清理步驟。';
  else if (draft.manualCleanupSteps.length > 10_000) errors.manualCleanupSteps = '手動清理步驟不可超過 10,000 字元。';
  if (draft.changeDescription.length > 10_000) errors.changeDescription = '本次變更描述不可超過 10,000 字元。';

  if (draft.options.length > 20) {
    errors.options = '選項參數最多 20 個。';
  } else {
    const names = new Set<string>();
    for (const option of draft.options) {
      const name = option.name.trim();
      if (!/^--[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(name) || name.length > 64 || names.has(name)) {
        errors.options = '參數名必須使用 --lower-kebab-case、不可重複且最多 64 字元。';
        break;
      }
      names.add(name);
      if (!option.description.trim() || option.description.length > 1000) {
        errors.options = `${name} 必須填寫 1–1,000 字元的說明。`;
        break;
      }
      if (option.type === 'boolean') {
        if (typeof option.defaultValue !== 'boolean' || option.choices !== undefined) {
          errors.options = `${name} 的開關預設值必須是 true 或 false。`;
          break;
        }
        continue;
      }
      if (typeof option.defaultValue !== 'string' || option.defaultValue.length > 1000) {
        errors.options = `${name} 的預設值格式錯誤。`;
        break;
      }
      if (option.type === 'text') {
        if (option.choices !== undefined) errors.options = `${name} 的文字類型不可包含選項清單。`;
        if (errors.options) break;
        continue;
      }
      const choices = option.choices ?? [];
      if (choices.length < 1 || choices.length > 20 || choices.some((choice) => !choice.trim() || choice.length > 1000) || new Set(choices).size !== choices.length) {
        errors.options = `${name} 必須提供 1–20 個不重複的有效選項。`;
        break;
      }
      if (!choices.includes(option.defaultValue)) {
        errors.options = `${name} 的預設值必須是選項之一。`;
        break;
      }
    }
  }
  return errors;
}

export function reviewReadiness(targets: Partial<Record<TargetKey, ScriptTargetRecord>>) {
  const active = Object.values(targets).filter((target): target is ScriptTargetRecord => Boolean(target));
  const pendingCount = active.filter((target) => !target.currentRevision).length;
  if (active.length === 0) return { activeCount: 0, pendingCount: 0, canSubmit: false, message: '至少加入一個腳本組合後才能送出審核。' };
  if (pendingCount > 0) return { activeCount: active.length, pendingCount, canSubmit: false, message: `尚有 ${pendingCount} 個組合未填寫完整命令。` };
  return { activeCount: active.length, pendingCount: 0, canSubmit: true, message: `${active.length} 個組合已可送出審核。` };
}

export function buildCreateVersionPayload(version: string, releaseNotes: string): CreatePackageVersionInput {
  const notes = optionalTrimmed(releaseNotes);
  return { version: version.trim(), ...(notes ? { releaseNotes: notes } : {}) };
}

export function publishPackageOptions(packages: PackageSummary[]): Array<{ value: string; label: string }> {
  return packages.map((item) => ({ value: item.packageId, label: `${item.name} · ${item.packageId} · ${item.ownerTeam}` }));
}
