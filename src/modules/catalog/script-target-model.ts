// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { createHash, randomUUID } from 'node:crypto';

import type {
  ScriptOptionDefinition,
  ScriptTargetLocator,
  ScriptTargetRevision,
  ScriptTargetRevisionContent
} from './types.js';

const OPTION_NAME = /^--[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

function invalidOptions(message: string): never {
  throw new Error(`INVALID_SCRIPT_OPTIONS: ${message}`);
}

function invalidRevision(message: string): never {
  throw new Error(`INVALID_SCRIPT_TARGET_REVISION: ${message}`);
}

function nonEmpty(value: string, maxLength: number, field: string): string {
  const normalized = value.trim();
  if (!normalized || value.length > maxLength) {
    invalidRevision(`${field} must be non-empty and at most ${maxLength} characters`);
  }
  return value;
}

export function validateScriptOptions(
  options: ScriptOptionDefinition[]
): ScriptOptionDefinition[] {
  if (options.length > 20) invalidOptions('at most 20 options are allowed');
  const names = new Set<string>();
  return options.map((option) => {
    const name = option.name.trim();
    if (name.length > 64 || !OPTION_NAME.test(name) || names.has(name)) {
      invalidOptions(`invalid or duplicate option name: ${name}`);
    }
    names.add(name);
    const description = option.description.trim();
    if (!description || option.description.length > 1000) {
      invalidOptions(`${name} requires a description of at most 1000 characters`);
    }

    if (option.type === 'boolean') {
      if (typeof option.defaultValue !== 'boolean' || option.choices !== undefined) {
        invalidOptions(`${name} boolean options require a boolean default and no choices`);
      }
      return { name, type: option.type, description, defaultValue: option.defaultValue };
    }

    if (typeof option.defaultValue !== 'string') {
      invalidOptions(`${name} requires a string default`);
    }
    if (option.type === 'text') {
      if (option.defaultValue.length > 1000 || option.choices !== undefined) {
        invalidOptions(`${name} text defaults are limited to 1000 characters and have no choices`);
      }
      return { name, type: option.type, description, defaultValue: option.defaultValue };
    }

    const choices = option.choices?.map((choice) => choice.trim()) ?? [];
    if (
      choices.length < 1 ||
      choices.length > 20 ||
      choices.some((choice) => !choice || choice.length > 1000) ||
      new Set(choices).size !== choices.length ||
      !choices.includes(option.defaultValue)
    ) {
      invalidOptions(`${name} select choices must be unique and contain the default`);
    }
    return {
      name,
      type: option.type,
      description,
      defaultValue: option.defaultValue,
      choices
    };
  });
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)])
    );
  }
  return value;
}

function contentDigest(
  target: ScriptTargetLocator,
  content: ScriptTargetRevisionContent,
  copiedFrom: ScriptTargetRevision['copiedFrom'],
  legacyImported: boolean
): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize({
      targetOs: target.targetOs,
      clientRuntime: target.clientRuntime,
      ...content,
      copiedFrom,
      legacyImported
    })))
    .digest('hex');
}

function validatedContent(
  input: ScriptTargetRevisionContent
): ScriptTargetRevisionContent {
  const installCommand = nonEmpty(input.installCommand, 100_000, 'installCommand');
  const uninstallCommand = nonEmpty(input.uninstallCommand, 100_000, 'uninstallCommand');
  const usageInstructions = nonEmpty(input.usageInstructions, 10_000, 'usageInstructions');
  const options = validateScriptOptions(input.options);
  const changeDescription = input.changeDescription?.trim();
  if (input.changeDescription !== undefined && input.changeDescription.length > 10_000) {
    invalidRevision('changeDescription is limited to 10000 characters');
  }
  if (input.hasResidualEffects) {
    nonEmpty(input.residualDescription ?? '', 10_000, 'residualDescription');
    nonEmpty(input.manualCleanupSteps ?? '', 10_000, 'manualCleanupSteps');
  }
  return {
    installCommand,
    uninstallCommand,
    options,
    usageInstructions,
    hasResidualEffects: input.hasResidualEffects,
    ...(input.hasResidualEffects
      ? {
          residualDescription: input.residualDescription!,
          manualCleanupSteps: input.manualCleanupSteps!
        }
      : {}),
    ...(changeDescription ? { changeDescription } : {})
  };
}

function buildRevision(
  target: ScriptTargetLocator,
  scriptVersion: number,
  input: ScriptTargetRevisionContent,
  actorUid: string,
  occurredAt: Date,
  copiedFrom?: ScriptTargetRevision['copiedFrom'],
  legacyImported = false
): ScriptTargetRevision {
  const content = validatedContent(input);
  return {
    id: randomUUID(),
    targetId: target.id,
    targetOs: target.targetOs,
    clientRuntime: target.clientRuntime,
    scriptVersion,
    ...content,
    ...(copiedFrom ? { copiedFrom: { ...copiedFrom } } : {}),
    contentDigest: contentDigest(target, content, copiedFrom, legacyImported),
    legacyImported,
    createdByUid: actorUid,
    createdAt: new Date(occurredAt)
  };
}

export function createInitialRevision(
  target: ScriptTargetLocator,
  input: ScriptTargetRevisionContent,
  actorUid: string,
  occurredAt: Date,
  legacyImported = false
): ScriptTargetRevision {
  return buildRevision(target, 1, input, actorUid, occurredAt, undefined, legacyImported);
}

export function createNextRevision(
  current: ScriptTargetRevision,
  patch: Partial<ScriptTargetRevisionContent>,
  actorUid: string,
  occurredAt: Date
): ScriptTargetRevision {
  return buildRevision(
    {
      id: current.targetId,
      targetOs: current.targetOs,
      clientRuntime: current.clientRuntime
    },
    current.scriptVersion + 1,
    {
      installCommand: patch.installCommand ?? current.installCommand,
      uninstallCommand: patch.uninstallCommand ?? current.uninstallCommand,
      options: patch.options ?? current.options.map((option) => ({
        ...option,
        ...(option.choices ? { choices: [...option.choices] } : {})
      })),
      usageInstructions: patch.usageInstructions ?? current.usageInstructions,
      hasResidualEffects: patch.hasResidualEffects ?? current.hasResidualEffects,
      ...((patch.residualDescription ?? current.residualDescription) !== undefined
        ? { residualDescription: patch.residualDescription ?? current.residualDescription }
        : {}),
      ...((patch.manualCleanupSteps ?? current.manualCleanupSteps) !== undefined
        ? { manualCleanupSteps: patch.manualCleanupSteps ?? current.manualCleanupSteps }
        : {}),
      ...(patch.changeDescription !== undefined
        ? { changeDescription: patch.changeDescription }
        : {})
    },
    actorUid,
    occurredAt
  );
}

export function copyRevision(
  source: ScriptTargetRevision,
  destination: ScriptTargetLocator,
  actorUid: string,
  occurredAt: Date,
  scriptVersion = 1,
  changeDescription?: string
): ScriptTargetRevision {
  return buildRevision(
    destination,
    scriptVersion,
    {
      installCommand: source.installCommand,
      uninstallCommand: source.uninstallCommand,
      options: source.options.map((option) => ({
        ...option,
        ...(option.choices ? { choices: [...option.choices] } : {})
      })),
      usageInstructions: source.usageInstructions,
      hasResidualEffects: source.hasResidualEffects,
      ...(source.residualDescription !== undefined
        ? { residualDescription: source.residualDescription }
        : {}),
      ...(source.manualCleanupSteps !== undefined
        ? { manualCleanupSteps: source.manualCleanupSteps }
        : {}),
      ...(changeDescription !== undefined ? { changeDescription } : {})
    },
    actorUid,
    occurredAt,
    {
      targetId: source.targetId,
      targetOs: source.targetOs,
      clientRuntime: source.clientRuntime,
      scriptVersion: source.scriptVersion
    }
  );
}
