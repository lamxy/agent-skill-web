// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { describe, expect, it } from 'vitest';

import {
  copyRevision,
  createInitialRevision,
  createNextRevision,
  validateScriptOptions
} from '../../src/modules/catalog/script-target-model.js';
import type {
  ScriptOptionDefinition,
  ScriptTargetRevision
} from '../../src/modules/catalog/types.js';

const actor = 'maintainer-1';
const now = new Date('2026-08-28T01:00:00.000Z');
const later = new Date('2026-08-28T02:00:00.000Z');

const validContent = {
  installCommand: 'install source',
  uninstallCommand: 'uninstall source',
  options: [
    {
      name: '--scope',
      type: 'select' as const,
      description: '安裝範圍',
      defaultValue: 'user',
      choices: ['user', 'project']
    }
  ],
  usageInstructions: '執行產生的腳本。',
  hasResidualEffects: false
};

function sourceRevision(): ScriptTargetRevision {
  return createInitialRevision(
    { id: 'source-target', targetOs: 'linux/macos', clientRuntime: 'codex' },
    validContent,
    actor,
    now
  );
}

describe('script target domain', () => {
  it('rejects duplicate option names after normalization', () => {
    expect(() =>
      validateScriptOptions([
        { name: ' --scope ', type: 'text', description: 'A', defaultValue: '' },
        { name: '--scope', type: 'text', description: 'B', defaultValue: '' }
      ])
    ).toThrowError(/INVALID_SCRIPT_OPTIONS/);
  });

  it.each<{ options: ScriptOptionDefinition[] }>([
    { options: [{ name: 'scope', type: 'text', description: 'A', defaultValue: '' }] },
    { options: [{ name: '--scope', type: 'select', description: 'A', defaultValue: 'user' }] },
    { options: [{ name: '--scope', type: 'select', description: 'A', defaultValue: 'x', choices: ['x', 'x'] }] },
    { options: [{ name: '--scope', type: 'boolean', description: 'A', defaultValue: 'true' }] }
  ])('rejects malformed option definitions', ({ options }) => {
    expect(() => validateScriptOptions(options)).toThrowError(/INVALID_SCRIPT_OPTIONS/);
  });

  it('rejects more than twenty options', () => {
    const options = Array.from({ length: 21 }, (_, index) => ({
      name: `--option-${index}`,
      type: 'text' as const,
      description: 'A',
      defaultValue: ''
    }));

    expect(() => validateScriptOptions(options)).toThrowError(/INVALID_SCRIPT_OPTIONS/);
  });

  it('rejects incomplete residual cleanup details', () => {
    expect(() =>
      createInitialRevision(
        { id: 'target-1', targetOs: 'windows', clientRuntime: 'claude-code' },
        {
          ...validContent,
          hasResidualEffects: true,
          residualDescription: '保留設定',
          manualCleanupSteps: '   '
        },
        actor,
        now
      )
    ).toThrowError(/INVALID_SCRIPT_TARGET_REVISION/);
  });

  it('keeps copied target data independent from its source', () => {
    const source = sourceRevision();
    const copy = copyRevision(
      source,
      { id: 'destination-target', targetOs: 'windows', clientRuntime: 'claude-code' },
      actor,
      now
    );
    const edited = createNextRevision(
      copy,
      { installCommand: 'changed' },
      actor,
      later
    );

    expect(source.installCommand).toBe('install source');
    expect(copy.options).not.toBe(source.options);
    expect(copy.copiedFrom).toEqual({
      targetId: 'source-target',
      targetOs: 'linux/macos',
      clientRuntime: 'codex',
      scriptVersion: 1
    });
    expect(edited.scriptVersion).toBe(2);
    expect(edited.copiedFrom).toBeUndefined();
  });

  it('changes the SHA-256 digest when revision content changes', () => {
    const first = sourceRevision();
    const second = createNextRevision(
      first,
      { usageInstructions: '新的使用說明。' },
      actor,
      later
    );

    expect(first.contentDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(second.contentDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(second.contentDigest).not.toBe(first.contentDigest);
    expect(second.id).not.toBe(first.id);
  });
});
