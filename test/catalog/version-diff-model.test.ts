// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { describe, expect, it } from 'vitest';

import { compareSemanticVersions } from '../../src/shared/version/semantic-version.js';
import { createInitialRevision } from '../../src/modules/catalog/script-target-model.js';
import { calculateVersionDiff } from '../../src/modules/catalog/version-diff-model.js';
import type {
  ClientRuntime,
  PackageVersionRecord,
  ScriptOptionDefinition,
  ScriptTargetOs,
  ScriptTargetRecord,
  ScriptTargetRevisionContent
} from '../../src/modules/catalog/types.js';

const actor = 'maintainer-1';
const now = new Date('2026-08-29T01:00:00.000Z');

const baseContent: ScriptTargetRevisionContent = {
  installCommand: 'install v1',
  uninstallCommand: 'uninstall v1',
  options: [],
  usageInstructions: '執行產生的腳本。',
  hasResidualEffects: false
};

function target(
  targetOs: ScriptTargetOs,
  clientRuntime: ClientRuntime,
  content: Partial<ScriptTargetRevisionContent> = {},
  options: { deleted?: boolean } = {}
): ScriptTargetRecord {
  const id = `${targetOs}-${clientRuntime}`;
  const revision = createInitialRevision(
    { id, targetOs, clientRuntime },
    { ...baseContent, ...content },
    actor,
    now
  );
  return {
    id,
    packageId: 'demo-package',
    packageVersion: '1.0.0',
    targetOs,
    clientRuntime,
    currentRevision: revision,
    revisions: [revision],
    ...(options.deleted ? { deletedAt: now, deletedByUid: actor } : {}),
    createdAt: now,
    updatedAt: now
  };
}

function version(
  versionNumber: string,
  scriptTargets: ScriptTargetRecord[],
  releaseNotes?: string
): PackageVersionRecord {
  return {
    id: `version-${versionNumber}`,
    packageId: 'demo-package',
    version: versionNumber,
    ...(releaseNotes ? { releaseNotes } : {}),
    supportedOs: ['linux/macos'],
    supportedClients: [
      { name: 'Codex', adaptationSource: 'publisher', maintainer: actor }
    ],
    lifecycle: 'published',
    installCommand: 'legacy install',
    uninstallCommand: 'legacy uninstall',
    hasResidualEffects: false,
    scriptTargets,
    authorUid: actor,
    createdAt: now,
    updatedAt: now
  };
}

function diff(
  current: PackageVersionRecord,
  next: PackageVersionRecord
) {
  return calculateVersionDiff('demo-package', current, next, compareSemanticVersions);
}

const scopeOption: ScriptOptionDefinition = {
  name: '--scope',
  type: 'select',
  description: '安裝範圍',
  defaultValue: 'user',
  choices: ['user', 'project']
};

describe('version diff', () => {
  it('reports no reapproval when nothing meaningful changed', () => {
    const result = diff(
      version('1.0.0', [target('linux/macos', 'codex')]),
      version('1.1.0', [target('linux/macos', 'codex')], '效能改善')
    );

    expect(result.direction).toBe('upgrade');
    expect(result.releaseNotes).toBe('效能改善');
    expect(result.scriptTargets).toHaveLength(1);
    expect(result.scriptTargets[0]!.change).toBe('unchanged');
    expect(result.requiresReapproval).toBe(false);
    expect(result.reapprovalReasons).toEqual([]);
  });

  it('requires reapproval when the install command changes', () => {
    const result = diff(
      version('1.0.0', [target('linux/macos', 'codex')]),
      version('2.0.0', [
        target('linux/macos', 'codex', { installCommand: 'install v2' })
      ])
    );

    expect(result.scriptTargets[0]!.change).toBe('changed');
    expect(result.scriptTargets[0]!.installCommandChanged).toBe(true);
    expect(result.scriptTargets[0]!.uninstallCommandChanged).toBe(false);
    expect(result.requiresReapproval).toBe(true);
    expect(result.reapprovalReasons.map((reason) => reason.code)).toEqual([
      'INSTALL_COMMAND_CHANGED'
    ]);
  });

  it('flags newly introduced residual effects', () => {
    const result = diff(
      version('1.0.0', [target('linux/macos', 'codex')]),
      version('2.0.0', [
        target('linux/macos', 'codex', {
          hasResidualEffects: true,
          residualDescription: '保留設定檔',
          manualCleanupSteps: '刪除 ~/.demo'
        })
      ])
    );

    expect(result.residualEffects).toEqual({
      current: false,
      target: true,
      introduced: true
    });
    expect(result.reapprovalReasons[0]!.code).toBe('RESIDUAL_EFFECTS_INTRODUCED');
  });

  it('does not flag residual effects that already existed', () => {
    const residual = {
      hasResidualEffects: true,
      residualDescription: '保留設定檔',
      manualCleanupSteps: '刪除 ~/.demo'
    };
    const result = diff(
      version('1.0.0', [target('linux/macos', 'codex', residual)]),
      version('2.0.0', [target('linux/macos', 'codex', residual)])
    );

    expect(result.residualEffects.introduced).toBe(false);
    expect(result.requiresReapproval).toBe(false);
  });

  it('detects added and removed script targets', () => {
    const result = diff(
      version('1.0.0', [target('linux/macos', 'codex')]),
      version('2.0.0', [target('windows', 'claude-code')])
    );

    const changes = result.scriptTargets.map((entry) => [
      entry.targetOs,
      entry.clientRuntime,
      entry.change
    ]);
    expect(changes).toEqual([
      ['linux/macos', 'codex', 'removed'],
      ['windows', 'claude-code', 'added']
    ]);
    expect(result.reapprovalReasons.map((reason) => reason.code).sort()).toEqual([
      'SCRIPT_TARGET_ADDED',
      'SCRIPT_TARGET_REMOVED'
    ]);
  });

  it('ignores soft-deleted targets on both sides', () => {
    const result = diff(
      version('1.0.0', [
        target('linux/macos', 'codex'),
        target('windows', 'claude-code', {}, { deleted: true })
      ]),
      version('2.0.0', [target('linux/macos', 'codex')])
    );

    expect(result.scriptTargets).toHaveLength(1);
    expect(result.requiresReapproval).toBe(false);
  });

  it('diffs option parameters by name', () => {
    const result = diff(
      version('1.0.0', [target('linux/macos', 'codex', { options: [scopeOption] })]),
      version('2.0.0', [
        target('linux/macos', 'codex', {
          options: [
            { ...scopeOption, description: '安裝作用範圍' },
            { name: '--dry-run', type: 'boolean', description: '試跑', defaultValue: false }
          ]
        })
      ])
    );

    const entry = result.scriptTargets[0]!;
    expect(entry.addedOptions.map((option) => option.name)).toEqual(['--dry-run']);
    expect(entry.removedOptions).toEqual([]);
    expect(entry.changedOptions.map((option) => option.name)).toEqual(['--scope']);
    expect(result.reapprovalReasons.map((reason) => reason.code)).toEqual([
      'SCRIPT_OPTIONS_CHANGED'
    ]);
  });

  it('reports downgrade and same direction', () => {
    const older = version('1.0.0', [target('linux/macos', 'codex')]);
    const newer = version('2.0.0', [target('linux/macos', 'codex')]);

    expect(diff(newer, older).direction).toBe('downgrade');
    expect(diff(older, older).direction).toBe('same');
  });

  it('never exposes command text in the diff payload', () => {
    const result = diff(
      version('1.0.0', [target('linux/macos', 'codex')]),
      version('2.0.0', [
        target('linux/macos', 'codex', { installCommand: 'install v2' })
      ])
    );

    expect(JSON.stringify(result)).not.toContain('install v2');
    expect(JSON.stringify(result)).not.toContain('install v1');
  });
});
