// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { randomUUID } from 'node:crypto';
import { access, readFile, writeFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import type {
  ClientRuntime,
  PackageVersionRecord,
  ScriptTargetOs,
  ScriptTargetRecord
} from '../../src/modules/catalog/types.js';
import { DockerLinuxValidationRunner } from '../../src/modules/governance/docker-linux-validation-runner.js';
import { PowerShellValidationRunner } from '../../src/modules/governance/powershell-validation-runner.js';
import { ProcessRunner, withTemporaryDirectory } from '../../src/modules/governance/process-runner.js';
import { isWsl } from '../support/host-tools.js';
import { ValidationRunnerRegistry } from '../../src/modules/governance/validation-runner-registry.js';
import type { ValidationRunnerInput } from '../../src/modules/governance/validation-runner.js';
import { requireCompleteTargetSnapshots } from '../../src/modules/governance/script-target-governance.js';
import { ScriptGeneratorService } from '../../src/modules/script-generator/script-generator-service.js';

const now = new Date('2026-08-25T00:00:00.000Z');

function version(overrides: Partial<PackageVersionRecord> = {}): PackageVersionRecord {
  const record: PackageVersionRecord = {
    id: 'version-1', packageId: 'quality-skill', version: '1.0.0', releaseNotes: '首版',
    supportedOs: ['linux'],
    supportedClients: [{ name: 'codex', adaptationSource: 'publisher', maintainer: 'platform' }],
    lifecycle: 'validating', scriptDigest: 'sha256:catalog-snapshot',
    installCommand: 'printf installed > "$HOME/package-state"',
    uninstallCommand: 'rm -f "$HOME/package-state"', hasResidualEffects: false,
    authorUid: 'publisher-1', createdAt: now, updatedAt: now,
    ...overrides
  };
  const declaredOs = record.supportedOs[0] === 'windows'
    ? 'windows'
    : record.supportedOs[0] === 'wsl' ? 'wsl' : 'linux/macos';
  const declaredClient = record.supportedClients[0]?.name === 'claude-code'
    ? 'claude-code' : 'codex';
  record.scriptTargets ??= [scriptTarget(
    declaredOs, declaredClient, record.installCommand, record.uninstallCommand
  )];
  return record;
}

function scriptTarget(
  targetOs: ScriptTargetOs,
  clientRuntime: ClientRuntime,
  installCommand = 'printf installed > "$HOME/package-state"',
  uninstallCommand = 'rm -f "$HOME/package-state"'
): ScriptTargetRecord {
  const id = `target-${targetOs}-${clientRuntime}`;
  const revision = {
    id: `${id}-v1`, targetId: id, targetOs, clientRuntime, scriptVersion: 1,
    installCommand, uninstallCommand, options: [], usageInstructions: '執行腳本',
    hasResidualEffects: false, contentDigest: `digest-${id}`, legacyImported: false,
    createdByUid: 'publisher-1', createdAt: now
  };
  return {
    id, packageId: 'quality-skill', packageVersion: '1.0.0', targetOs, clientRuntime,
    currentRevision: revision, revisions: [revision], createdAt: now, updatedAt: now
  };
}

function input(versionRecord: PackageVersionRecord): ValidationRunnerInput {
  const targetSnapshots = requireCompleteTargetSnapshots(versionRecord);
  return {
    validationRunId: 'run-1',
    package: {
      packageId: 'quality-skill', type: 'skill', name: 'Quality Skill', purpose: '驗證 runner',
      ownerTeam: 'platform', category: 'testing', categoryCode: 'testing', visibility: 'public',
      sourceUri: 'https://example.invalid/quality-skill', license: 'MIT', lifecycle: 'active',
      source: 'custom', publisher: { kind: 'organization', name: '平台組' }, grade: 'basic',
      createdAt: now, updatedAt: now
    },
    version: versionRecord,
    requestedByUid: 'publisher-1',
    targetSnapshots,
    expectedMatrix: targetSnapshots.map((snapshot) => ({
      targetId: snapshot.targetId, os: snapshot.targetOs, client: snapshot.clientRuntime,
      scriptVersion: snapshot.scriptVersion, contentDigest: snapshot.contentDigest
    }))
  };
}

describe('ProcessRunner', () => {
  it('只以 command 與 args 執行，限制輸出並回傳結構化結果', async () => {
    const result = await new ProcessRunner({ maxOutputBytes: 64 }).run(
      '/usr/bin/printf',
      ['x'.repeat(4096)]
    );

    expect(result).toMatchObject({ exitCode: 0, timedOut: false, outputTruncated: true });
    expect(Buffer.byteLength(result.stdout)).toBeLessThanOrEqual(64);
  });

  it('timeout 不 throw，保留 runner_timeout 證據', async () => {
    const result = await new ProcessRunner({ timeoutMs: 50 }).run(
      process.execPath,
      ['-e', 'setTimeout(() => {}, 10_000)']
    );

    expect(result).toMatchObject({ exitCode: null, timedOut: true, errorCode: 'runner_timeout' });
  });

  // 僅在 WSL 執行：驗證的是 pwsh 在 WSL 下的 process group 終止行為。
  // CI 的 Ubuntu runner 雖裝有 pwsh（其餘 PowerShell 測試均通過），
  // 但 Start-Process 建立子程序的方式與 WSL 不同，此情境在原生 Linux 不重現。
  it.skipIf(!isWsl())('WSL timeout 終止整個 pwsh process group，不留下背景子 PID', async () => {
    await withTemporaryDirectory('runner-process-group-', async (directory) => {
      const pidPath = `${directory}/child.pid`;
      const command = [
        "$child = Start-Process -FilePath 'pwsh' -ArgumentList @('-NoProfile','-Command','Start-Sleep -Seconds 60') -PassThru",
        'Set-Content -NoNewline -Path $env:RUNNER_CHILD_PID_PATH -Value $child.Id',
        'Wait-Process -Id $child.Id'
      ].join('; ');
      const result = await new ProcessRunner({ timeoutMs: 2_000 }).run(
        'pwsh', ['-NoProfile', '-Command', command],
        { env: { ...process.env, RUNNER_CHILD_PID_PATH: pidPath } }
      );
      const childPid = Number.parseInt(await readFile(pidPath, 'utf8'), 10);

      expect(result).toMatchObject({
        timedOut: true, errorCode: 'runner_timeout', terminationMode: 'process_group'
      });
      await waitUntil(() => !processExists(childPid));
      expect(processExists(childPid)).toBe(false);
    });
  }, 10_000);

  it('工作完成或失敗後都清理專用臨時目錄', async () => {
    let temporaryPath = '';
    await expect(withTemporaryDirectory('runner-test-', async (directory) => {
      temporaryPath = directory;
      await writeFile(`${directory}/evidence.txt`, 'ok');
      throw new Error('預期失敗');
    })).rejects.toThrow('預期失敗');

    await expect(access(temporaryPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('真實 validation runners', () => {
  it('Linux 使用固定官方 Docker image，捕獲安裝／卸載 JSON 遙測並確認無殘留', async () => {
    const target = version();
    const runInput = input(target);
    const result = await new DockerLinuxValidationRunner().runTarget(runInput, runInput.expectedMatrix[0]!);

    expect(result).toMatchObject({
      os: 'linux/macos', client: 'codex', runnerName: 'docker-linux',
      installExitCode: 0, telemetrySeen: true, uninstallExitCode: 0,
      cleanupSucceeded: true, status: 'passed'
    });
    expect(result.runnerVersion).toContain('node:22-bookworm-slim');
    expect(result.scriptDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
  }, 30_000);

  // 驗證 image 本身具備 node 與 npm：發布者的安裝指令可能是 npm，
  // image 缺 npm 時該類套件會驗證失敗，且失敗訊息看起來像發布者腳本的問題。
  // 本測試在換 image 時擋下不符條件的選擇（例如 alpine 或無 node 的基礎 image）。
  it('Linux image 具備 node 與 npm，可驗證 npm 類套件的安裝指令', async () => {
    const target = version({
      installCommand: 'set -euo pipefail\nnode --version\nnpm --version',
      uninstallCommand: 'set -euo pipefail\nnpm --version'
    });
    const runInput = input(target);
    const result = await new DockerLinuxValidationRunner().runTarget(runInput, runInput.expectedMatrix[0]!);

    expect(result).toMatchObject({
      installExitCode: 0, uninstallExitCode: 0, status: 'passed'
    });
  }, 30_000);

  it('PowerShell 7 在 WSL 以 powershell-wsl 能力執行成功並捕獲遙測', async () => {
    const target = version({
      supportedOs: ['windows'],
      installCommand: "if ([string]::IsNullOrWhiteSpace($env:APPDATA)) { throw '缺少 APPDATA' }; Set-Content -Path (Join-Path $env:APPDATA 'package-state') -Value 'installed'",
      uninstallCommand: "Remove-Item -Force (Join-Path $env:APPDATA 'package-state')"
    });
    const runInput = input(target);
    const result = await new PowerShellValidationRunner().runTarget(runInput, runInput.expectedMatrix[0]!);

    expect(result).toMatchObject({
      runnerName: 'powershell-wsl', installExitCode: 0, telemetrySeen: true,
      uninstallExitCode: 0, cleanupSucceeded: true, status: 'passed'
    });
    expect(result.runnerVersion).toMatch(/^powershell-wsl\/7\./);
    // 15 秒低於 runner 自身的預算：PowerShellValidationRunner 的 ProcessRunner
    // 是每次執行 20 秒逾時，而本測試會呼叫安裝與卸載兩次，等於測試可能在被測
    // 元件尚未判定逾時前就先被判失敗。其餘 PowerShell 測試 15 秒夠用，是因為
    // 它們或在安裝階段就失敗、或改用 stub generator，不跑完整循環。
    // 改用與同檔 Docker 完整循環一致的 30 秒。
  }, 30_000);

  it('Linux runner 不接受缺少 script_version 與 options 的 legacy telemetry', async () => {
    const target = version();
    const runInput = input(target);
    const legacyGenerator = {
      generate(generateInput: { action?: 'install' | 'uninstall' }) {
        const action = generateInput.action ?? 'install';
        const payload = JSON.stringify({
          idempotency_key: action === 'install'
            ? '11111111-1111-4111-8111-111111111111'
            : '22222222-2222-4222-8222-222222222222',
          package_id: 'quality-skill', version: '1.0.0', user_ref: 'publisher-1',
          user_ref_type: 'uid', client_runtime: 'codex', os_type: 'linux',
          status: action === 'install' ? 'succeeded' : 'uninstalled'
        });
        return {
          script: `#!/usr/bin/env bash\nprintf '%s\\n' '${payload}' >> "$ASP_CAPTURE_FILE"\n`,
          digest: `sha256:${action}`
        };
      }
    } as unknown as ScriptGeneratorService;

    const result = await new DockerLinuxValidationRunner(legacyGenerator)
      .runTarget(runInput, runInput.expectedMatrix[0]!);

    expect(result).toMatchObject({
      installExitCode: 0, uninstallExitCode: 0, telemetrySeen: false,
      status: 'failed', errorCode: 'telemetry_missing'
    });
  }, 30_000);

  it('PowerShell runner 不接受缺少 script_version 與 options 的 legacy telemetry', async () => {
    const target = version({
      supportedOs: ['windows'],
      installCommand: "Write-Output 'install'",
      uninstallCommand: "Write-Output 'uninstall'"
    });
    const runInput = input(target);
    const legacyGenerator = {
      generate(generateInput: { action?: 'install' | 'uninstall' }) {
        const action = generateInput.action ?? 'install';
        const payload = JSON.stringify({
          idempotency_key: action === 'install'
            ? '33333333-3333-4333-8333-333333333333'
            : '44444444-4444-4444-8444-444444444444',
          package_id: 'quality-skill', version: '1.0.0', user_ref: 'publisher-1',
          user_ref_type: 'uid', client_runtime: 'codex', os_type: 'windows',
          status: action === 'install' ? 'succeeded' : 'uninstalled'
        });
        return {
          script: [
            "$queueDirectory = Join-Path $env:APPDATA 'agent-platform'",
            'New-Item -ItemType Directory -Force -Path $queueDirectory | Out-Null',
            "$queuePath = Join-Path $queueDirectory 'pending_reports.jsonl'",
            `Add-Content -Path $queuePath -Value '${payload}'`
          ].join('\n'),
          digest: `sha256:${action}`
        };
      }
    } as unknown as ScriptGeneratorService;

    const result = await new PowerShellValidationRunner(legacyGenerator)
      .runTarget(runInput, runInput.expectedMatrix[0]!);

    expect(result).toMatchObject({
      installExitCode: 0, uninstallExitCode: 0, telemetrySeen: false,
      status: 'failed', errorCode: 'telemetry_missing'
    });
  }, 15_000);

  it('PowerShell 腳本失敗仍回傳退出碼、遙測與結構化失敗證據', async () => {
    const target = version({
      supportedOs: ['windows'],
      installCommand: "throw '安裝失敗'",
      uninstallCommand: "Write-Output '不應執行'"
    });
    const runInput = input(target);
    const result = await new PowerShellValidationRunner().runTarget(runInput, runInput.expectedMatrix[0]!);

    expect(result).toMatchObject({
      runnerName: 'powershell-wsl', installExitCode: 1, telemetrySeen: false,
      cleanupSucceeded: false, status: 'failed', errorCode: 'install_failed'
    });
  }, 15_000);

  it('Linux timeout 後明確移除具名 Docker container', async () => {
    const namePrefix = `agent-platform-timeout-${randomUUID().slice(0, 8)}`;
    const target = version({ installCommand: 'sleep 60', uninstallCommand: 'true' });
    const runner = new DockerLinuxValidationRunner(
      undefined,
      new ProcessRunner({ timeoutMs: 3_000 }),
      (action) => `${namePrefix}-${action}`
    );
    const inspector = new ProcessRunner({ timeoutMs: 5_000 });
    const runInput = input(target);
    const runPromise = runner.runTarget(runInput, runInput.expectedMatrix[0]!);
    const installContainerWasRunning = await waitUntilAsync(async () =>
      (await inspector.run('docker', ['inspect', `${namePrefix}-install`])).exitCode === 0,
    2_500);
    const result = await runPromise;
    const inspections = await Promise.all([
      inspector.run('docker', ['inspect', `${namePrefix}-install`]),
      inspector.run('docker', ['inspect', `${namePrefix}-uninstall`])
    ]);

    expect(result).toMatchObject({ status: 'failed', errorCode: 'runner_timeout' });
    expect(installContainerWasRunning).toBe(true);
    expect(inspections.every((inspection) => inspection.exitCode !== 0)).toBe(true);
  }, 20_000);

  it('Linux 不豁免 .agent-platform 內的套件殘留', async () => {
    const target = version({
      installCommand: 'printf leftover > "$HOME/.agent-platform/package-state"',
      uninstallCommand: 'true'
    });
    const runInput = input(target);
    const result = await new DockerLinuxValidationRunner().runTarget(runInput, runInput.expectedMatrix[0]!);

    expect(result).toMatchObject({
      installExitCode: 0, uninstallExitCode: 0, telemetrySeen: true,
      cleanupSucceeded: false, status: 'failed', errorCode: 'cleanup_failed'
    });
  }, 30_000);

  it('PowerShell 不豁免 APPDATA 平台目錄內的套件殘留', async () => {
    const target = version({
      supportedOs: ['windows'],
      installCommand: "Set-Content -Path (Join-Path $env:APPDATA 'agent-platform/package-state') -Value 'leftover'",
      uninstallCommand: "Write-Output '未清理'"
    });
    const runInput = input(target);
    const result = await new PowerShellValidationRunner().runTarget(runInput, runInput.expectedMatrix[0]!);

    expect(result).toMatchObject({
      installExitCode: 0, uninstallExitCode: 0, telemetrySeen: true,
      cleanupSucceeded: false, status: 'failed', errorCode: 'cleanup_failed'
    });
    // 與上一個殘留測試同樣跑完安裝與卸載兩次真實執行，逾時卻少一半；
    // 一併對齊 30 秒，避免它成為下一個在 CI 上時綠時紅的測試。
  }, 30_000);

  it('只有四個 marker 的偽造舊 telemetry 行不能冒充本次 Linux 執行證據', async () => {
    const forged = JSON.stringify({
      package_id: 'quality-skill', client_runtime: 'codex', os_type: 'linux', status: 'succeeded'
    });
    const target = version({
      installCommand: `printf '%s\\n' '${forged}' > "$ASP_CAPTURE_FILE"; chmod 400 "$ASP_CAPTURE_FILE"`,
      uninstallCommand: 'true'
    });
    const runInput = input(target);
    const result = await new DockerLinuxValidationRunner().runTarget(runInput, runInput.expectedMatrix[0]!);

    expect(result).toMatchObject({
      installExitCode: 0, telemetrySeen: false,
      status: 'failed', errorCode: 'telemetry_missing'
    });
  }, 30_000);

  it('安裝階段留下的舊 telemetry 行不能冒充解除安裝的新證據', async () => {
    const staleUninstall = JSON.stringify({
      package_id: 'quality-skill', client_runtime: 'codex', os_type: 'linux', status: 'uninstalled'
    });
    const target = version({
      installCommand: `printf '%s\\n' '${staleUninstall}' >> "$ASP_CAPTURE_FILE"`,
      uninstallCommand: 'chmod 400 "$ASP_CAPTURE_FILE"'
    });
    const runInput = input(target);
    const result = await new DockerLinuxValidationRunner().runTarget(runInput, runInput.expectedMatrix[0]!);

    expect(result).toMatchObject({
      installExitCode: 0, uninstallExitCode: 0, telemetrySeen: false,
      status: 'failed', errorCode: 'telemetry_missing'
    });
  }, 30_000);
});

describe('ValidationRunnerRegistry', () => {
  it('只執行 targetSnapshots 中的兩個組合，不建立 3×2 笛卡兒積', async () => {
    const calls: string[] = [];
    const adapter = {
      async runTarget(_input: ValidationRunnerInput, matrixTarget: { os: string; client: string; targetId?: string }) {
        calls.push(`${matrixTarget.os}/${matrixTarget.client}`);
        return {
          ...matrixTarget, runnerName: 'stub', runnerVersion: 'stub/1',
          scriptDigest: `sha256:${matrixTarget.targetId}`, installScriptDigest: 'sha256:install',
          uninstallScriptDigest: 'sha256:uninstall', startedAt: now, endedAt: now,
          installExitCode: 0, telemetrySeen: true, uninstallExitCode: 0,
          cleanupSucceeded: true, status: 'passed' as const
        };
      }
    };
    const record = version({
      supportedOs: ['linux/macos', 'windows', 'wsl'],
      supportedClients: [
        { name: 'codex', adaptationSource: 'publisher', maintainer: 'platform' },
        { name: 'claude-code', adaptationSource: 'publisher', maintainer: 'platform' }
      ],
      scriptTargets: [
        scriptTarget('linux/macos', 'codex'),
        scriptTarget('windows', 'claude-code', "Write-Output 'install'", "Write-Output 'uninstall'")
      ]
    });
    const result = await new ValidationRunnerRegistry({
      osAdapters: [
        { os: 'linux/macos', runner: adapter },
        { os: 'windows', runner: adapter },
        { os: 'wsl', runner: adapter }
      ]
    }).run(input(record));

    expect(result.status).toBe('passed');
    expect(calls).toEqual(['linux/macos/codex', 'windows/claude-code']);
  });

  it('依 active target snapshots 執行 Linux／Windows／WSL × Codex／Claude Code 完整 3×2 矩陣', async () => {
    const target = version({
      supportedOs: ['linux/macos', 'windows', 'wsl'],
      supportedClients: [
        { name: 'codex', adaptationSource: 'publisher', maintainer: 'platform' },
        { name: 'claude-code', adaptationSource: 'publisher', maintainer: 'platform' }
      ],
      installCommand: 'echo installed', uninstallCommand: 'echo uninstalled',
      scriptTargets: (['linux/macos', 'windows', 'wsl'] as const).flatMap((targetOs) =>
        (['codex', 'claude-code'] as const).map((clientRuntime) => scriptTarget(
          targetOs,
          clientRuntime,
          targetOs === 'windows' ? "Write-Output 'installed'" : 'echo installed',
          targetOs === 'windows' ? "Write-Output 'uninstalled'" : 'echo uninstalled'
        )))
    });
    const result = await new ValidationRunnerRegistry().run(input(target));

    expect(result.status).toBe('passed');
    expect(result.matrixResults.map(({ os, client }) => `${os}/${client}`).sort()).toEqual([
      'linux/macos/claude-code', 'linux/macos/codex',
      'windows/claude-code', 'windows/codex', 'wsl/claude-code', 'wsl/codex'
    ]);
    expect(result.matrixResults.every((item) => item.status === 'passed')).toBe(true);
  }, 60_000);

  it('缺少 WSL adapter 時明確 not_supported，整體失敗且不偽造 runner 能力', async () => {
    const target = version({ supportedOs: ['wsl'], scriptTargets: [scriptTarget('wsl', 'codex')] });
    const result = await new ValidationRunnerRegistry({ osAdapters: [] }).run(input(target));

    expect(result).toMatchObject({ status: 'failed', errorCode: 'validation_matrix_failed' });
    expect(result.matrixResults).toEqual([
      expect.objectContaining({ os: 'wsl', status: 'not_supported', errorCode: 'unsupported_os' })
    ]);
  });

  it('未註冊 client adapter 時拒絕且整體失敗', async () => {
    const target = version();
    const result = await new ValidationRunnerRegistry({ clientAdapters: [] }).run(input(target));

    expect(result).toMatchObject({ status: 'failed', errorCode: 'validation_matrix_failed' });
    expect(result.matrixResults).toEqual([
      expect.objectContaining({ client: 'codex', status: 'failed', errorCode: 'unknown_client' })
    ]);
  });

  it('替換 WSL 與 Claude Code adapter 不修改 registry 核心或遙測證據契約', async () => {
    const target = version({
      supportedOs: ['wsl'],
      supportedClients: [{ name: 'claude-code', adaptationSource: 'community', maintainer: 'external' }],
      scriptTargets: [scriptTarget('wsl', 'claude-code')]
    });
    const adapterRunner = {
      async runTarget(_input: ValidationRunnerInput, matrixTarget: { os: string; client: string }) {
        return {
          ...matrixTarget,
          runnerName: 'wsl-runner', runnerVersion: 'wsl-runner/1',
          scriptDigest: 'sha256:test', installScriptDigest: 'sha256:install',
          uninstallScriptDigest: 'sha256:uninstall', startedAt: now, endedAt: now,
          installExitCode: 0, telemetrySeen: true, uninstallExitCode: 0,
          cleanupSucceeded: true, status: 'passed' as const
        };
      }
    };
    const registry = new ValidationRunnerRegistry({
      osAdapters: [{ os: 'wsl', runner: adapterRunner }],
      clientAdapters: [{ client: 'claude-code' }]
    });

    const result = await registry.run(input(target));

    expect(result).toMatchObject({ status: 'passed' });
    expect(result.matrixResults).toEqual([
      expect.objectContaining({
        os: 'wsl', client: 'claude-code', telemetrySeen: true, status: 'passed'
      })
    ]);
  });

  it('版本矩陣與 begin snapshot 不一致時拒絕執行', async () => {
    const target = version();
    const runInput = input(target);
    runInput.expectedMatrix = [{ os: 'windows', client: 'codex' }];

    const result = await new ValidationRunnerRegistry().run(runInput);

    expect(result).toMatchObject({
      status: 'failed', errorCode: 'validation_matrix_mismatch', matrixResults: []
    });
  });

  it('adapter 偽造 passed 但缺少遙測證據時，registry 強制整體失敗', async () => {
    const target = version();
    const incompleteRunner = {
      async runTarget() {
        return {
          os: 'linux', client: 'codex', runnerName: 'stub', runnerVersion: 'stub/1',
          scriptDigest: 'sha256:test', startedAt: now, endedAt: now,
          installExitCode: 0, telemetrySeen: false, uninstallExitCode: 0,
          cleanupSucceeded: true, status: 'passed' as const
        };
      }
    };
    const result = await new ValidationRunnerRegistry({
      osAdapters: [{ os: 'linux/macos', runner: incompleteRunner }]
    }).run(input(target));

    expect(result.status).toBe('failed');
    expect(result.matrixResults).toEqual([
      expect.objectContaining({ status: 'failed', errorCode: 'incomplete_evidence' })
    ]);
  });
});

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitUntil(condition: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function waitUntilAsync(
  condition: () => Promise<boolean>,
  timeoutMs: number
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}
