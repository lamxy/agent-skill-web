// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import type { ScriptTargetRecord, ScriptTargetRevision } from '../../src/modules/catalog/types.js';
import { ScriptGeneratorService } from '../../src/modules/script-generator/script-generator-service.js';
import type { GenerateScriptInput } from '../../src/modules/script-generator/types.js';
import { hasCommand } from '../support/host-tools.js';

const publishedAt = new Date('2026-08-28T10:00:00.000Z');

function target(
  targetOs: ScriptTargetRecord['targetOs'],
  clientRuntime: ScriptTargetRecord['clientRuntime']
): ScriptTargetRecord {
  const id = `target-${targetOs}-${clientRuntime}`;
  const currentRevision: ScriptTargetRevision = {
    id: `${id}-v3`, targetId: id, targetOs, clientRuntime, scriptVersion: 3,
    installCommand: targetOs === 'windows'
      ? `Write-Output 'install-${targetOs}-${clientRuntime}'`
      : `printf '%s\n' 'install-${targetOs}-${clientRuntime}'`,
    uninstallCommand: targetOs === 'windows'
      ? `Write-Output 'uninstall-${targetOs}-${clientRuntime}'`
      : `printf '%s\n' 'uninstall-${targetOs}-${clientRuntime}'`,
    options: [
      { name: '--scope', type: 'select', description: '安裝範圍', defaultValue: 'team', choices: ['team', "owner's"] },
      { name: '--dry-run', type: 'boolean', description: '試跑', defaultValue: false },
      { name: '--label', type: 'text', description: '標籤', defaultValue: 'default' }
    ],
    usageInstructions: '使用 --scope 選擇安裝範圍。', hasResidualEffects: false,
    contentDigest: `digest-${id}-v3`, legacyImported: false,
    createdByUid: 'publisher-1', createdAt: publishedAt
  };
  return {
    id, packageId: 'matrix-skill', packageVersion: '2.4.0', targetOs, clientRuntime,
    currentRevision, revisions: [currentRevision], createdAt: publishedAt, updatedAt: publishedAt
  };
}

function input(scriptTarget: ScriptTargetRecord): GenerateScriptInput {
  return {
    packageId: 'matrix-skill', version: '2.4.0', publishedAt,
    target: scriptTarget,
    userReference: { type: 'uid', value: 'user-1' },
    telemetryEndpoint: 'https://telemetry.example.test'
  };
}

describe('ScriptGeneratorService target contract', () => {
  it.each([
    ['linux/macos', 'claude-code'], ['linux/macos', 'codex'],
    ['windows', 'claude-code'], ['windows', 'codex'],
    ['wsl', 'claude-code'], ['wsl', 'codex']
  ] as const)('%s × %s 精確使用該 target current revision', (targetOs, clientRuntime) => {
    const generated = new ScriptGeneratorService().generate(input(target(targetOs, clientRuntime)));

    expect(generated).toMatchObject({
      targetOs, clientRuntime, scriptVersion: 3, publishedAt: publishedAt.toISOString(),
      resolvedOptions: { '--scope': 'team', '--dry-run': false, '--label': 'default' }
    });
    expect(generated.script).toContain(`install-${targetOs}-${clientRuntime}`);
    expect(generated.filename).toContain('-v3-');
    expect(generated.preview.usageInstructions).toContain('--scope');
  });

  it('套用 default/override 並以安全 literal 注入 ASP_OPT_*', () => {
    const generated = new ScriptGeneratorService().generate({
      ...input(target('linux/macos', 'codex')),
      selectedOptions: { '--scope': "owner's", '--label': '$(touch /tmp/should-not-run)', '--dry-run': true }
    });

    expect(generated.resolvedOptions).toEqual({
      '--scope': "owner's", '--dry-run': true, '--label': '$(touch /tmp/should-not-run)'
    });
    expect(generated.script).toContain("export ASP_OPT_SCOPE='owner'\"'\"'s'");
    expect(generated.script).toContain("export ASP_OPT_LABEL='$(touch /tmp/should-not-run)'");
    expect(generated.script).toContain("export ASP_OPT_DRY_RUN='true'");
  });

  it('拒絕未知 option 與錯誤型別／choice', () => {
    const service = new ScriptGeneratorService();
    const base = input(target('windows', 'codex'));

    expect(() => service.generate({ ...base, selectedOptions: { '--unknown': 'x' } }))
      .toThrowError(/UNKNOWN_SCRIPT_OPTION/u);
    expect(() => service.generate({ ...base, selectedOptions: { '--dry-run': 'true' } }))
      .toThrowError(/INVALID_SCRIPT_OPTION_VALUE/u);
    expect(() => service.generate({ ...base, selectedOptions: { '--scope': 'invalid' } }))
      .toThrowError(/INVALID_SCRIPT_OPTION_VALUE/u);
  });

  it('Bash --help 在建立 queue、UUID 與執行命令前離開且無副作用', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'script-help-'));
    const home = join(directory, 'home');
    const marker = join(directory, 'marker');
    const scriptTarget = target('wsl', 'codex');
    scriptTarget.currentRevision!.installCommand = `printf ran > '${marker}'`;
    const generated = new ScriptGeneratorService().generate(input(scriptTarget));
    const scriptPath = join(directory, generated.filename);
    await writeFile(scriptPath, generated.script, { mode: 0o700 });

    const result = await run('bash', [scriptPath, '--help'], { HOME: home });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('使用 --scope 選擇安裝範圍。');
    expect(result.stdout).toContain('matrix-skill');
    expect(result.stdout).toContain('2.4.0');
    expect(result.stdout).toContain('2026-08-28T10:00:00.000Z');
    expect(result.stdout).toContain('v3');
    await expect(readFile(marker, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(join(home, '.agent-platform', 'uuid'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  // 需要 bubblewrap：本測試以 bwrap 遮蔽 /proc 來模擬 macOS 環境。
  // CI runner 未安裝，跳過而非在 CI 裝工具去模擬另一個平台。
  it.skipIf(!hasCommand('bwrap'))('macOS 在沒有 /proc 時使用 uuidgen 建立匿名 UUID 與 idempotency key', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'script-macos-uuid-'));
    const home = join(directory, 'home');
    const bin = join(directory, 'bin');
    const counter = join(directory, 'uuid-counter');
    const capture = join(directory, 'telemetry.json');
    await Promise.all([mkdir(home), mkdir(bin)]);
    await writeFile(join(bin, 'uname'), '#!/usr/bin/env bash\nprintf Darwin\n', { mode: 0o700 });
    await writeFile(join(bin, 'uuidgen'), `#!/usr/bin/env bash
count=0
[[ -r "$UUID_COUNTER" ]] && count="$(< "$UUID_COUNTER")"
count=$((count + 1))
printf '%s' "$count" > "$UUID_COUNTER"
if [[ "$count" -eq 1 ]]; then
  printf '11111111-1111-4111-8111-111111111111\\n'
else
  printf '22222222-2222-4222-8222-222222222222\\n'
fi
`, { mode: 0o700 });
    await writeFile(join(bin, 'curl'), `#!/usr/bin/env bash
printf '%s' "\${@: -1}" > "$ASP_CAPTURE_FILE"
printf 200
`, { mode: 0o700 });
    const generated = new ScriptGeneratorService().generate({
      ...input(target('linux/macos', 'codex')),
      userReference: { type: 'uuid', value: '00000000-0000-4000-8000-000000000000' }
    });
    const scriptPath = join(directory, generated.filename);
    await writeFile(scriptPath, generated.script, { mode: 0o700 });

    const result = await run('bwrap', [
      '--ro-bind', '/', '/', '--tmpfs', '/proc', '--dev', '/dev',
      '--bind', directory, directory, '--', 'bash', scriptPath
    ], {
      HOME: home,
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      UUID_COUNTER: counter,
      ASP_CAPTURE_FILE: capture
    });

    expect(result.exitCode).toBe(0);
    expect(await readFile(join(home, '.agent-platform', 'uuid'), 'utf8'))
      .toBe('22222222-2222-4222-8222-222222222222');
    expect(JSON.parse(await readFile(capture, 'utf8'))).toMatchObject({
      idempotency_key: '11111111-1111-4111-8111-111111111111',
      os_type: 'macos'
    });
  });

  it('Bash 正常安裝在維護者命令前顯示套件、發布與腳本版本', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'script-bash-metadata-'));
    const home = join(directory, 'home');
    const bin = join(directory, 'bin');
    await Promise.all([mkdir(home), mkdir(bin)]);
    await writeFile(join(bin, 'curl'), '#!/usr/bin/env bash\nprintf 200\n', { mode: 0o700 });
    const generated = new ScriptGeneratorService().generate(input(target('wsl', 'codex')));
    const scriptPath = join(directory, generated.filename);
    await writeFile(scriptPath, generated.script, { mode: 0o700 });

    const result = await run('bash', [scriptPath], {
      HOME: home,
      PATH: `${bin}:${process.env.PATH ?? ''}`
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('matrix-skill');
    expect(result.stdout).toContain('2.4.0');
    expect(result.stdout).toContain('2026-08-28T10:00:00.000Z');
    expect(result.stdout).toContain('v3');
  });

  it('PowerShell --help 與正常安裝都顯示套件、發布與腳本版本', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'script-pwsh-metadata-'));
    const home = join(directory, 'home');
    const appData = join(directory, 'appdata');
    await Promise.all([mkdir(home), mkdir(appData)]);
    const generated = new ScriptGeneratorService().generate(input(target('windows', 'claude-code')));
    const scriptPath = join(directory, generated.filename);
    await writeFile(scriptPath, generated.script);
    const env = { HOME: home, APPDATA: appData };

    const help = await run('pwsh', ['-NoProfile', '-File', scriptPath, '--help'], env);
    const install = await run('pwsh', ['-NoProfile', '-File', scriptPath], env);

    for (const result of [help, install]) {
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('matrix-skill');
      expect(result.stdout).toContain('2.4.0');
      expect(result.stdout).toContain('2026-08-28T10:00:00.000Z');
      expect(result.stdout).toContain('v3');
    }
  }, 15_000);

  it('新腳本遙測必含 script_version 與 options', () => {
    const generated = new ScriptGeneratorService().generate(input(target('windows', 'claude-code')));

    expect(generated.preview.telemetryFields).toEqual(expect.arrayContaining(['script_version', 'options']));
    expect(generated.script).toContain('script_version');
    expect(generated.script).toContain('options');
    expect(generated.executionCommand).toContain(generated.filename);
  });
});

function run(
  command: string,
  args: string[],
  env: Record<string, string>
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: { ...process.env, ...env } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', reject);
    child.on('close', (exitCode) => resolve({ exitCode, stdout, stderr }));
  });
}
