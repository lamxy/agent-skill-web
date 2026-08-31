// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { DockerLinuxValidationRunner } from './docker-linux-validation-runner.js';
import { PowerShellValidationRunner } from './powershell-validation-runner.js';
import {
  normalizeClientName,
  normalizeOsName,
  type ValidationMatrixResult,
  type ValidationMatrixTarget,
  type ValidationRunner,
  type ValidationRunnerInput,
  type ValidationRunResult
} from './validation-runner.js';

const REGISTRY_VERSION = 'validation-runner-registry/1.1.0';

export interface TargetValidationRunner {
  runTarget(
    input: ValidationRunnerInput,
    target: ValidationMatrixTarget
  ): Promise<ValidationMatrixResult>;
}

export interface OsValidationAdapter {
  os: string;
  runner: TargetValidationRunner;
}

export interface ClientValidationAdapter {
  client: string;
}

export interface ValidationRunnerRegistryOptions {
  osAdapters?: readonly OsValidationAdapter[];
  clientAdapters?: readonly ClientValidationAdapter[];
}

export class ValidationRunnerRegistry implements ValidationRunner {
  private readonly osAdapters: ReadonlyMap<string, TargetValidationRunner>;
  private readonly clients: ReadonlySet<string>;

  constructor(options: ValidationRunnerRegistryOptions = {}) {
    const osAdapters = options.osAdapters ?? [
      { os: 'linux/macos', runner: new DockerLinuxValidationRunner() },
      { os: 'wsl', runner: new DockerLinuxValidationRunner() },
      { os: 'windows', runner: new PowerShellValidationRunner() }
    ];
    const clientAdapters = options.clientAdapters ?? [
      { client: 'codex' }, { client: 'claude-code' }
    ];
    this.osAdapters = new Map(osAdapters.map(({ os, runner }) => [normalizeOsName(os), runner]));
    this.clients = new Set(clientAdapters.map(({ client }) => normalizeClientName(client)));
  }

  async run(input: ValidationRunnerInput): Promise<ValidationRunResult> {
    const versionMatrix = createVersionMatrix(input);
    if (!sameMatrix(versionMatrix, input.expectedMatrix)) {
      return {
        status: 'failed',
        runnerVersion: REGISTRY_VERSION,
        matrixResults: [],
        errorCode: 'validation_matrix_mismatch'
      };
    }

    const matrixResults: ValidationMatrixResult[] = [];
    // 依序執行可避免 WSL 的 Docker Desktop 與多個 pwsh 同時爭用資源造成暫態假失敗。
    for (const target of versionMatrix) {
      const runner = this.osAdapters.get(target.os);
      if (!this.clients.has(target.client)) {
        matrixResults.push(unsupportedResult(input, target, 'failed', 'unknown_client'));
      } else if (!runner) {
        matrixResults.push(unsupportedResult(input, target, 'not_supported', 'unsupported_os'));
      } else {
        matrixResults.push(await this.safeRun(() => runner.runTarget(input, target), input, target));
      }
    }
    const passed = matrixResults.length > 0
      && matrixResults.every((result) => result.status === 'passed');
    return {
      status: passed ? 'passed' : 'failed',
      runnerVersion: REGISTRY_VERSION,
      matrixResults,
      ...(!passed ? { errorCode: 'validation_matrix_failed' } : {})
    };
  }

  private async safeRun(
    run: () => Promise<ValidationMatrixResult>,
    input: ValidationRunnerInput,
    target: ValidationMatrixTarget
  ): Promise<ValidationMatrixResult> {
    try {
      const result = await run();
      if (result.status === 'passed' && !hasCompletePassedEvidence(result)) {
        return { ...result, status: 'failed', errorCode: 'incomplete_evidence' };
      }
      return result;
    } catch {
      return unsupportedResult(input, target, 'failed', 'runner_error');
    }
  }
}

function hasCompletePassedEvidence(result: ValidationMatrixResult): boolean {
  return Boolean(
    result.runnerName
    && result.runnerVersion
    && result.scriptDigest
    && (!result.targetId || Boolean(
      result.scriptVersion && result.contentDigest &&
      result.installScriptDigest && result.uninstallScriptDigest
    ))
    && result.startedAt instanceof Date
    && result.endedAt instanceof Date
    && result.endedAt.getTime() >= result.startedAt.getTime()
    && result.installExitCode === 0
    && result.telemetrySeen === true
    && result.uninstallExitCode === 0
    && result.cleanupSucceeded
  );
}

function createVersionMatrix(input: ValidationRunnerInput): ValidationMatrixTarget[] {
  return input.targetSnapshots.map((snapshot) => ({
    targetId: snapshot.targetId,
    os: snapshot.targetOs,
    client: snapshot.clientRuntime,
    scriptVersion: snapshot.scriptVersion,
    contentDigest: snapshot.contentDigest
  })).sort((left, right) =>
    left.os.localeCompare(right.os) || left.client.localeCompare(right.client));
}

function sameMatrix(left: ValidationMatrixTarget[], right: ValidationMatrixTarget[]): boolean {
  const normalizedRight = new Map<string, ValidationMatrixTarget>();
  for (const target of right) {
    const normalized = {
      ...(target.targetId ? { targetId: target.targetId } : {}),
      os: normalizeOsName(target.os),
      client: normalizeClientName(target.client),
      ...(target.scriptVersion ? { scriptVersion: target.scriptVersion } : {}),
      ...(target.contentDigest ? { contentDigest: target.contentDigest } : {})
    };
    normalizedRight.set(`${normalized.os}\0${normalized.client}`, normalized);
  }
  const rightMatrix = [...normalizedRight.values()].sort((a, b) =>
    a.os.localeCompare(b.os) || a.client.localeCompare(b.client));
  return left.length === rightMatrix.length
    && left.every((target, index) => {
      const expected = rightMatrix[index];
      return expected?.os === target.os && expected.client === target.client
        && expected.targetId === target.targetId
        && expected.scriptVersion === target.scriptVersion
        && expected.contentDigest === target.contentDigest;
    });
}

function unsupportedResult(
  input: ValidationRunnerInput,
  target: ValidationMatrixTarget,
  status: 'failed' | 'not_supported',
  errorCode: string
): ValidationMatrixResult {
  const now = new Date();
  return {
    ...(target.targetId ? { targetId: target.targetId } : {}),
    ...(target.scriptVersion ? { scriptVersion: target.scriptVersion } : {}),
    ...(target.contentDigest ? { contentDigest: target.contentDigest } : {}),
    os: target.os,
    client: target.client,
    runnerName: 'validation-runner-registry',
    runnerVersion: REGISTRY_VERSION,
    scriptDigest: input.version.scriptDigest ?? '',
    startedAt: now,
    endedAt: now,
    telemetrySeen: false,
    cleanupSucceeded: false,
    status,
    errorCode
  };
}
