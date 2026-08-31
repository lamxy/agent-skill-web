// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

import { ScriptGeneratorService } from '../script-generator/script-generator-service.js';
import type { ValidationMatrixResult, ValidationMatrixTarget, ValidationRunnerInput } from './validation-runner.js';
import { scriptTargetRecordFromSnapshot } from './script-target-governance.js';
import { ProcessRunner, type ProcessRunResult, withTemporaryDirectory } from './process-runner.js';

// 固定官方版本，避免驗證期間隱式拉取或切回 host Bash。
//
// 選型條件三項，缺一不可：
//   1. bash —— 下方以 `bash scriptPath` 執行產生的腳本
//   2. node 與 npm —— 發布者的安裝指令可能是 npm（如 npm i -g @internal/mysql-mcp）。
//      image 缺 npm 時該類套件驗證必然失敗，且失敗會被誤判為發布者腳本有問題，
//      實際上是驗證環境缺工具。
//   3. 貼近真實使用者環境，驗證結果才有意義
//
// 因此不可換成 alpine 系列（預設無 bash），也不可換回不含 node 的基礎 image。
// validation-runners 有一項測試專門驗證此 image 具備 node 與 npm，
// 換 image 時該測試會擋下不符條件的選擇。
const DOCKER_IMAGE = 'node:22-bookworm-slim';
const RUNNER_NAME = 'docker-linux';
const RUNNER_VERSION = `${RUNNER_NAME}/${DOCKER_IMAGE}`;

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

type ContainerNameFactory = (action: 'install' | 'uninstall') => string;

interface DockerScriptResult {
  process: ProcessRunResult;
  containerRemoved: boolean;
}

export class DockerLinuxValidationRunner {
  constructor(
    private readonly scriptGenerator = new ScriptGeneratorService(),
    private readonly processRunner = new ProcessRunner({ timeoutMs: 20_000 }),
    private readonly containerNameFactory: ContainerNameFactory = (action) =>
      `agent-platform-validation-${action}-${randomUUID()}`
  ) {}

  async runTarget(
    input: ValidationRunnerInput,
    target: ValidationMatrixTarget
  ): Promise<ValidationMatrixResult> {
    const startedAt = new Date();
    try {
      return await withTemporaryDirectory('docker-validation-', async (temporaryDirectory) => {
        const snapshot = input.targetSnapshots.find((candidate) => candidate.targetId === target.targetId);
        if (!snapshot) throw new Error('validation target snapshot missing');
        const inputDirectory = join(temporaryDirectory, 'input');
        const workDirectory = join(temporaryDirectory, 'work');
        const homeDirectory = join(workDirectory, 'home');
        const evidenceDirectory = join(workDirectory, 'evidence');
        const telemetryPath = join(evidenceDirectory, 'telemetry.jsonl');
        await Promise.all([
          mkdir(join(inputDirectory, 'bin'), { recursive: true }),
          mkdir(homeDirectory, { recursive: true }),
          mkdir(evidenceDirectory, { recursive: true })
        ]);
        await writeFile(
          join(inputDirectory, 'bin', 'curl'),
          '#!/usr/bin/env bash\nset -euo pipefail\nprintf \'%s\\n\' "${@: -1}" >> "$ASP_CAPTURE_FILE"\nprintf 200\n',
          { mode: 0o555 }
        );

        const common = {
          packageId: input.package.packageId,
          version: input.version.version,
          publishedAt: input.version.publishedAt ?? input.version.updatedAt,
          target: scriptTargetRecordFromSnapshot(snapshot, input.version.packageId, input.version.version),
          userReference: { type: 'uid' as const, value: input.requestedByUid },
          telemetryEndpoint: 'http://telemetry.invalid'
        };
        const installScript = this.scriptGenerator.generate({ ...common, action: 'install' });
        const uninstallScript = this.scriptGenerator.generate({ ...common, action: 'uninstall' });
        await Promise.all([
          writeFile(join(inputDirectory, 'install.sh'), installScript.script, { mode: 0o444 }),
          writeFile(join(inputDirectory, 'uninstall.sh'), uninstallScript.script, { mode: 0o444 })
        ]);

        const installBaseline = await readTelemetry(telemetryPath);
        const install = await this.runDockerScript(
          inputDirectory,
          workDirectory,
          '/runner/input/install.sh',
          'install',
          input.validationRunId
        );
        const afterInstallTelemetry = await readTelemetry(telemetryPath);
        const installTelemetry = afterInstallTelemetry.slice(installBaseline.length);
        const uninstall = await this.runDockerScript(
          inputDirectory,
          workDirectory,
          '/runner/input/uninstall.sh',
          'uninstall',
          input.validationRunId
        );
        const afterUninstallTelemetry = await readTelemetry(telemetryPath);
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
        const residualPaths = await collectResidualPaths(workDirectory, [
          relative(workDirectory, telemetryPath),
          relative(workDirectory, join(homeDirectory, '.agent-platform', 'pending_reports.jsonl'))
        ], [
          relative(workDirectory, homeDirectory),
          relative(workDirectory, evidenceDirectory),
          relative(workDirectory, join(homeDirectory, '.agent-platform'))
        ]);
        const cleanupSucceeded = install.process.exitCode === 0
          && uninstall.process.exitCode === 0
          && install.containerRemoved
          && uninstall.containerRemoved
          && residualPaths.length === 0;
        const errorCode = install.process.errorCode
          ?? uninstall.process.errorCode
          ?? (!install.containerRemoved || !uninstall.containerRemoved ? 'container_cleanup_failed'
            : install.process.exitCode !== 0 ? 'install_failed'
              : uninstall.process.exitCode !== 0 ? 'uninstall_failed'
              : !installTelemetrySeen || !uninstallTelemetrySeen ? 'telemetry_missing'
                : !cleanupSucceeded ? 'cleanup_failed' : undefined);

        return {
          targetId: snapshot.targetId,
          scriptVersion: snapshot.scriptVersion,
          contentDigest: snapshot.contentDigest,
          os: target.os,
          client: target.client,
          runnerName: RUNNER_NAME,
          runnerVersion: RUNNER_VERSION,
          scriptDigest: installScript.digest,
          installScriptDigest: installScript.digest,
          uninstallScriptDigest: uninstallScript.digest,
          startedAt,
          endedAt: new Date(),
          ...(install.process.exitCode !== null ? { installExitCode: install.process.exitCode } : {}),
          telemetrySeen: installTelemetrySeen && uninstallTelemetrySeen,
          ...(uninstall.process.exitCode !== null ? { uninstallExitCode: uninstall.process.exitCode } : {}),
          cleanupSucceeded,
          status: errorCode ? 'failed' : 'passed',
          ...(errorCode ? { errorCode } : {})
        };
      });
    } catch {
      return failedResult(target, startedAt, 'runner_error');
    }
  }

  private async runDockerScript(
    inputDirectory: string,
    workDirectory: string,
    scriptPath: string,
    action: 'install' | 'uninstall',
    validationRunId: string
  ): Promise<DockerScriptResult> {
    const containerName = this.containerNameFactory(action);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/u.test(containerName)) {
      throw new Error('Docker container name 無效');
    }
    const processResult = await this.processRunner.run('docker', [
      'run', '--name', containerName, '--rm', '--pull=never', '--network', 'none', '--read-only',
      '--label', `agent-platform.validation-run-id=${validationRunId.slice(0, 128)}`,
      '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--pids-limit', '64',
      '--memory', '128m', '--cpus', '0.5', '--tmpfs', '/tmp:rw,noexec,nosuid,size=16m',
      '--mount', `type=bind,src=${inputDirectory},dst=/runner/input,readonly`,
      '--mount', `type=bind,src=${workDirectory},dst=/runner/work`,
      '--user', `${process.getuid?.() ?? 65534}:${process.getgid?.() ?? 65534}`,
      '--env', 'HOME=/runner/work/home',
      '--env', 'ASP_CAPTURE_FILE=/runner/work/evidence/telemetry.jsonl',
      '--env', 'PATH=/runner/input/bin:/usr/local/bin:/usr/local/sbin:/usr/bin:/bin',
      '--workdir', '/runner/work',
      DOCKER_IMAGE, 'bash', scriptPath
    ]);
    return {
      process: processResult,
      containerRemoved: await this.ensureContainerRemoved(containerName)
    };
  }

  private async ensureContainerRemoved(containerName: string): Promise<boolean> {
    // 即使 `docker run --rm` 已完成，仍以具名 rm/inspect 確認 daemon 沒有遺留容器。
    await this.processRunner.run('docker', ['rm', '-f', containerName], { timeoutMs: 5_000 });
    const inspection = await this.processRunner.run(
      'docker', ['inspect', containerName], { timeoutMs: 5_000 }
    );
    return inspection.exitCode !== 0
      && inspection.errorCode === undefined
      && !inspection.timedOut;
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
    && payload.os_type === (target.os === 'linux/macos' ? 'linux' : target.os)
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

async function collectResidualPaths(
  root: string,
  ignoredPaths: string[],
  infrastructureRoots: string[]
): Promise<string[]> {
  const residuals: string[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const relativePath = relative(root, path);
      if (ignoredPaths.includes(relativePath)) continue;
      if (!infrastructureRoots.includes(relativePath)) residuals.push(relativePath);
      if (entry.isDirectory()) {
        await visit(path);
      }
    }
  }
  await visit(root);
  return [...new Set(residuals)].sort();
}

function failedResult(
  target: ValidationMatrixTarget,
  startedAt: Date,
  errorCode: string
): ValidationMatrixResult {
  return {
    ...(target.targetId ? { targetId: target.targetId } : {}),
    ...(target.scriptVersion ? { scriptVersion: target.scriptVersion } : {}),
    ...(target.contentDigest ? { contentDigest: target.contentDigest } : {}),
    os: target.os,
    client: target.client,
    runnerName: RUNNER_NAME,
    runnerVersion: RUNNER_VERSION,
    scriptDigest: '',
    startedAt,
    endedAt: new Date(),
    telemetrySeen: false,
    cleanupSucceeded: false,
    status: 'failed',
    errorCode
  };
}
