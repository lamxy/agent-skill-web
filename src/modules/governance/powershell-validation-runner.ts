// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { ScriptGeneratorService } from '../script-generator/script-generator-service.js';
import type { ValidationMatrixResult, ValidationMatrixTarget, ValidationRunnerInput } from './validation-runner.js';
import { ProcessRunner, withTemporaryDirectory } from './process-runner.js';
import { scriptTargetRecordFromSnapshot } from './script-target-governance.js';

const RUNNER_NAME = 'powershell-wsl';

interface TelemetryPayload {
  idempotency_key?: string;
  package_id?: string;
  version?: string;
  user_ref?: string;
  user_ref_type?: string;
  client_runtime?: string;
  os_type?: string;
  script_version?: number;
  options?: unknown;
  status?: string;
}

export class PowerShellValidationRunner {
  constructor(
    private readonly scriptGenerator = new ScriptGeneratorService(),
    private readonly processRunner = new ProcessRunner({ timeoutMs: 20_000 })
  ) {}

  async runTarget(
    input: ValidationRunnerInput,
    target: ValidationMatrixTarget
  ): Promise<ValidationMatrixResult> {
    const startedAt = new Date();
    const snapshot = input.targetSnapshots.find((candidate) => candidate.targetId === target.targetId);
    if (!snapshot) return failedResult(target, startedAt, `${RUNNER_NAME}/unavailable`, 'snapshot_missing');
    const versionProbe = await this.processRunner.run(
      'pwsh',
      ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()']
    );
    const runnerVersion = `${RUNNER_NAME}/${versionProbe.stdout.trim() || 'unavailable'}`;
    if (versionProbe.exitCode !== 0) {
      return failedResult(target, startedAt, runnerVersion, versionProbe.errorCode ?? 'runner_unavailable');
    }

    try {
      return await withTemporaryDirectory('powershell-validation-', async (temporaryDirectory) => {
        const homeDirectory = join(temporaryDirectory, 'home');
        const appDataDirectory = join(homeDirectory, 'AppData', 'Roaming');
        const inputDirectory = join(temporaryDirectory, 'input');
        await Promise.all([
          mkdir(homeDirectory, { recursive: true }),
          mkdir(appDataDirectory, { recursive: true }),
          mkdir(inputDirectory, { recursive: true })
        ]);
        const common = {
          packageId: input.package.packageId,
          version: input.version.version,
          publishedAt: input.version.publishedAt ?? input.version.updatedAt,
          target: scriptTargetRecordFromSnapshot(snapshot, input.version.packageId, input.version.version),
          userReference: { type: 'uid' as const, value: input.requestedByUid },
          telemetryEndpoint: 'http://127.0.0.1:9'
        };
        const installScript = this.scriptGenerator.generate({ ...common, action: 'install' });
        const uninstallScript = this.scriptGenerator.generate({ ...common, action: 'uninstall' });
        const installPath = join(inputDirectory, 'install.ps1');
        const uninstallPath = join(inputDirectory, 'uninstall.ps1');
        await Promise.all([
          writeFile(installPath, installScript.script, { mode: 0o400 }),
          writeFile(uninstallPath, uninstallScript.script, { mode: 0o400 })
        ]);
        const environment = { ...process.env, HOME: homeDirectory, APPDATA: appDataDirectory };
        // 先讓 pwsh 建立自己的 cache，再以路徑快照區分 runtime 足跡與套件殘留。
        await this.processRunner.run('pwsh', ['-NoProfile', '-Command', '$null'], { env: environment });
        const platformPath = 'AppData/Roaming/agent-platform';
        const queuePath = join(appDataDirectory, 'agent-platform', 'pending_reports.jsonl');
        const baselinePaths = await collectPowerShellPaths(homeDirectory, [], [platformPath]);
        const installBaseline = await readTelemetry(queuePath);
        const install = await this.processRunner.run(
          'pwsh', ['-NoProfile', '-File', installPath], { env: environment }
        );
        const afterInstallTelemetry = await readTelemetry(queuePath);
        const installTelemetry = afterInstallTelemetry.slice(installBaseline.length);
        const uninstall = await this.processRunner.run(
          'pwsh', ['-NoProfile', '-File', uninstallPath], { env: environment }
        );
        const afterUninstallTelemetry = await readTelemetry(queuePath);
        const uninstallTelemetry = afterUninstallTelemetry.slice(afterInstallTelemetry.length);
        const installTelemetryMatch = findTelemetry(
          installTelemetry, input, target, 'succeeded'
        );
        const uninstallTelemetryMatch = findTelemetry(
          uninstallTelemetry, input, target, 'uninstalled'
        );
        const installTelemetrySeen = Boolean(installTelemetryMatch);
        const uninstallTelemetrySeen = Boolean(uninstallTelemetryMatch)
          && installTelemetryMatch?.idempotency_key !== uninstallTelemetryMatch?.idempotency_key;
        const finalPaths = await collectPowerShellPaths(
          homeDirectory,
          [
            `${platformPath}/pending_reports.jsonl`,
            `${platformPath}/pending_reports.lock`,
            `${platformPath}/dead_letter_reports.jsonl`
          ],
          [platformPath]
        );
        const residualPaths = finalPaths.filter((path) => !baselinePaths.includes(path));
        const cleanupSucceeded = install.exitCode === 0
          && uninstall.exitCode === 0
          && residualPaths.length === 0;
        const errorCode = install.errorCode
          ?? uninstall.errorCode
          ?? (install.exitCode !== 0 ? 'install_failed'
            : uninstall.exitCode !== 0 ? 'uninstall_failed'
              : !installTelemetrySeen || !uninstallTelemetrySeen ? 'telemetry_missing'
                : !cleanupSucceeded ? 'cleanup_failed' : undefined);

        return {
          targetId: snapshot.targetId,
          scriptVersion: snapshot.scriptVersion,
          contentDigest: snapshot.contentDigest,
          os: target.os,
          client: target.client,
          runnerName: RUNNER_NAME,
          runnerVersion,
          scriptDigest: installScript.digest,
          installScriptDigest: installScript.digest,
          uninstallScriptDigest: uninstallScript.digest,
          startedAt,
          endedAt: new Date(),
          ...(install.exitCode !== null ? { installExitCode: install.exitCode } : {}),
          telemetrySeen: installTelemetrySeen && uninstallTelemetrySeen,
          ...(uninstall.exitCode !== null ? { uninstallExitCode: uninstall.exitCode } : {}),
          cleanupSucceeded,
          status: errorCode ? 'failed' : 'passed',
          ...(errorCode ? { errorCode } : {})
        };
      });
    } catch {
      return failedResult(target, startedAt, runnerVersion, 'runner_error');
    }
  }
}

async function readTelemetry(path: string): Promise<TelemetryPayload[]> {
  try {
    const content = await readFile(path, 'utf8');
    return content.split(/\r?\n/u).filter(Boolean).flatMap((line) => {
      try {
        return [JSON.parse(line) as TelemetryPayload];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

function findTelemetry(
  telemetry: TelemetryPayload[],
  input: ValidationRunnerInput,
  target: ValidationMatrixTarget,
  expectedStatus: 'succeeded' | 'uninstalled'
): TelemetryPayload | undefined {
  return telemetry.find((payload) =>
    typeof payload.idempotency_key === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(payload.idempotency_key)
    && payload.package_id === input.package.packageId
    && payload.version === input.version.version
    && payload.user_ref === input.requestedByUid
    && payload.user_ref_type === 'uid'
    && payload.client_runtime === target.client
    && payload.os_type === target.os
    && payload.script_version === target.scriptVersion
    && hasExpectedOptions(payload.options, input, target)
    && payload.status === expectedStatus);
}

function hasExpectedOptions(
  value: unknown,
  input: ValidationRunnerInput,
  target: ValidationMatrixTarget
): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const snapshot = input.targetSnapshots.find((candidate) => candidate.targetId === target.targetId);
  if (!snapshot) return false;
  const actual = value as Record<string, unknown>;
  const expected = Object.fromEntries(snapshot.options.map((option) => [option.name, option.defaultValue]));
  const keys = Object.keys(actual);
  return keys.length === Object.keys(expected).length
    && keys.every((key) => actual[key] === expected[key]);
}

async function collectPowerShellPaths(
  homeDirectory: string,
  ignoredPaths: string[],
  infrastructureRoots: string[]
): Promise<string[]> {
  const paths: string[] = [];
  async function visit(directory: string, parentPath = ''): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relativePath = parentPath ? `${parentPath}/${entry.name}` : entry.name;
      if (ignoredPaths.includes(relativePath)) continue;
      if (!infrastructureRoots.includes(relativePath)) paths.push(relativePath);
      if (entry.isDirectory()) await visit(join(directory, entry.name), relativePath);
    }
  }
  await visit(homeDirectory);
  return paths.sort();
}

function failedResult(
  target: ValidationMatrixTarget,
  startedAt: Date,
  runnerVersion: string,
  errorCode: string
): ValidationMatrixResult {
  return {
    ...(target.targetId ? { targetId: target.targetId } : {}),
    ...(target.scriptVersion ? { scriptVersion: target.scriptVersion } : {}),
    ...(target.contentDigest ? { contentDigest: target.contentDigest } : {}),
    os: target.os,
    client: target.client,
    runnerName: RUNNER_NAME,
    runnerVersion,
    scriptDigest: '',
    startedAt,
    endedAt: new Date(),
    telemetrySeen: false,
    cleanupSucceeded: false,
    status: 'failed',
    errorCode
  };
}
