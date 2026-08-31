// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { createHash } from 'node:crypto';

import type {
  ClientRuntime,
  PackageVersionRecord,
  ScriptOptionDefinition,
  ScriptTargetOs,
  ScriptTargetRecord,
  ScriptTargetRevision
} from '../catalog/types.js';
import { validateScriptOptions } from '../catalog/script-target-model.js';
import { AppError } from '../../shared/errors/app-error.js';

export const SCRIPT_TARGET_CONTRACT_VERSION = 2;

export interface ValidationTargetSnapshot {
  targetId: string;
  targetOs: ScriptTargetOs;
  clientRuntime: ClientRuntime;
  scriptVersion: number;
  contentDigest: string;
  installCommand: string;
  uninstallCommand: string;
  options: ScriptOptionDefinition[];
  usageInstructions: string;
  hasResidualEffects: boolean;
  residualDescription?: string;
  manualCleanupSteps?: string;
}

function incomplete(): never {
  throw new AppError({
    statusCode: 409,
    code: 'SCRIPT_TARGETS_INCOMPLETE',
    message: '至少需要一個完整、非 legacy 的有效腳本目標才能送審'
  });
}

function toSnapshot(revision: ScriptTargetRevision): ValidationTargetSnapshot {
  try {
    validateScriptOptions(revision.options);
  } catch {
    return incomplete();
  }
  if (
    revision.legacyImported ||
    !revision.installCommand.trim() ||
    !revision.uninstallCommand.trim() ||
    !revision.usageInstructions.trim() ||
    !revision.contentDigest.trim() ||
    !Number.isInteger(revision.scriptVersion) ||
    revision.scriptVersion < 1 ||
    (revision.hasResidualEffects && (
      !revision.residualDescription?.trim() ||
      !revision.manualCleanupSteps?.trim()
    ))
  ) {
    return incomplete();
  }
  return {
    targetId: revision.targetId,
    targetOs: revision.targetOs,
    clientRuntime: revision.clientRuntime,
    scriptVersion: revision.scriptVersion,
    contentDigest: revision.contentDigest,
    installCommand: revision.installCommand,
    uninstallCommand: revision.uninstallCommand,
    options: revision.options.map((option) => ({
      ...option,
      ...(option.choices ? { choices: [...option.choices] } : {})
    })),
    usageInstructions: revision.usageInstructions,
    hasResidualEffects: revision.hasResidualEffects,
    ...(revision.residualDescription !== undefined
      ? { residualDescription: revision.residualDescription }
      : {}),
    ...(revision.manualCleanupSteps !== undefined
      ? { manualCleanupSteps: revision.manualCleanupSteps }
      : {})
  };
}

export function requireCompleteTargetSnapshots(
  version: PackageVersionRecord
): ValidationTargetSnapshot[] {
  const active = (version.scriptTargets ?? []).filter((target) => !target.deletedAt);
  if (active.length === 0) return incomplete();
  const snapshots = active.map((target) => {
    if (!target.currentRevision) return incomplete();
    if (
      target.currentRevision.targetId !== target.id ||
      target.currentRevision.targetOs !== target.targetOs ||
      target.currentRevision.clientRuntime !== target.clientRuntime
    ) {
      return incomplete();
    }
    return toSnapshot(target.currentRevision);
  });
  const keys = new Set<string>();
  for (const snapshot of snapshots) {
    const key = `${snapshot.targetOs}\0${snapshot.clientRuntime}`;
    if (keys.has(key)) return incomplete();
    keys.add(key);
  }
  return snapshots.sort((left, right) =>
    left.targetOs.localeCompare(right.targetOs) ||
    left.clientRuntime.localeCompare(right.clientRuntime));
}

export function scriptManifestDigest(snapshots: readonly ValidationTargetSnapshot[]): string {
  const tuples = snapshots
    .map(({ targetOs, clientRuntime, scriptVersion, contentDigest }) => [
      targetOs, clientRuntime, scriptVersion, contentDigest
    ] as const)
    .sort((left, right) =>
      left[0].localeCompare(right[0]) || left[1].localeCompare(right[1]));
  return `sha256:${createHash('sha256').update(JSON.stringify(tuples)).digest('hex')}`;
}

export function scriptTargetRecordFromSnapshot(
  snapshot: ValidationTargetSnapshot,
  packageId: string,
  packageVersion: string
): ScriptTargetRecord {
  const createdAt = new Date(0);
  const currentRevision: ScriptTargetRevision = {
    id: `${snapshot.targetId}-validation`,
    ...snapshot,
    legacyImported: false,
    createdByUid: 'validation-runner',
    createdAt
  };
  return {
    id: snapshot.targetId,
    packageId,
    packageVersion,
    targetOs: snapshot.targetOs,
    clientRuntime: snapshot.clientRuntime,
    currentRevision,
    revisions: [currentRevision],
    createdAt,
    updatedAt: createdAt
  };
}
