// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import { ScriptGeneratorService } from '../../src/modules/script-generator/script-generator-service.js';

const execFileAsync = promisify(execFile);
const service = new ScriptGeneratorService();

function input(overrides: Record<string, unknown> = {}) {
  return {
    packageId: 'quality-skill', version: '1.0.0', targetOs: 'linux/macos' as const,
    clientRuntime: 'codex', installCommand: 'printf installed > "$HOME/result.txt"',
    uninstallCommand: 'rm -f "$HOME/result.txt"', hasResidualEffects: false,
    userReference: { type: 'uid' as const, value: 'user-1' },
    telemetryEndpoint: 'http://127.0.0.1:9', ...overrides
  };
}

describe('ScriptGeneratorService', () => {
  it.each([
    ['linux/macos', 'codex'], ['linux/macos', 'claude-code'],
    ['windows', 'codex'], ['windows', 'claude-code']
  ] as const)('生成 %s / %s 腳本並可驗證 digest', (targetOs, clientRuntime) => {
    const generated = service.generate(input({ targetOs, clientRuntime }));

    expect(generated.targetOs).toBe(targetOs);
    expect(generated.clientRuntime).toBe(clientRuntime);
    expect(generated.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(service.verify(generated.script, generated.digest)).toBe(true);
    expect(service.verify(`${generated.script}\n# 篡改`, generated.digest)).toBe(false);
    expect(generated.telemetryAssurance).toBe('best-effort');
  });

  it('Linux 匿名 UUID 按使用者目錄隔離，刪除後重新生成', async () => {
    const generated = service.generate(input({
      userReference: { type: 'uuid', value: '11111111-1111-4111-8111-111111111111' }
    }));
    const root = await mkdtemp(join(tmpdir(), 'agent-linux-uuid-'));
    const homes = [join(root, 'user-a'), join(root, 'user-b')];
    await Promise.all(homes.map((home) => mkdir(home)));
    const scriptPath = join(root, 'install.sh');
    await writeFile(scriptPath, generated.script, { mode: 0o700 });

    await execFileAsync('bash', [scriptPath], { env: { ...process.env, HOME: homes[0] } });
    const first = await readFile(join(homes[0]!, '.agent-platform', 'uuid'), 'utf8');
    await execFileAsync('bash', [scriptPath], { env: { ...process.env, HOME: homes[1] } });
    const otherUser = await readFile(join(homes[1]!, '.agent-platform', 'uuid'), 'utf8');
    await rm(join(homes[0]!, '.agent-platform', 'uuid'));
    await execFileAsync('bash', [scriptPath], { env: { ...process.env, HOME: homes[0] } });
    const regenerated = await readFile(join(homes[0]!, '.agent-platform', 'uuid'), 'utf8');

    expect(first).toMatch(/^[0-9a-f-]{36}$/u);
    expect(otherUser).not.toBe(first);
    expect(regenerated).not.toBe(first);
  });

  it('Windows 匿名 UUID 使用 APPDATA，按使用者隔離且刪除後重新生成', async () => {
    const generated = service.generate(input({
      targetOs: 'windows',
      installCommand: "Write-Output 'install'",
      uninstallCommand: "Write-Output 'uninstall'",
      userReference: { type: 'uuid', value: '11111111-1111-4111-8111-111111111111' }
    }));
    const root = await mkdtemp(join(tmpdir(), 'agent-windows-uuid-'));
    const home = join(root, 'home');
    const appDataA = join(root, 'appdata-a');
    const appDataB = join(root, 'appdata-b');
    await Promise.all([mkdir(home), mkdir(appDataA), mkdir(appDataB)]);
    const scriptPath = join(root, 'install.ps1');
    await writeFile(scriptPath, generated.script);
    const run = (appData: string) => execFileAsync('pwsh', ['-NoProfile', '-File', scriptPath], {
      env: { ...process.env, HOME: home, APPDATA: appData }
    });

    await run(appDataA);
    const uuidPathA = join(appDataA, 'agent-platform', 'uuid');
    const first = await readFile(uuidPathA, 'utf8');
    await run(appDataB);
    const otherUser = await readFile(join(appDataB, 'agent-platform', 'uuid'), 'utf8');
    await rm(uuidPathA);
    await run(appDataA);
    const regenerated = await readFile(uuidPathA, 'utf8');

    expect(first).toMatch(/^[0-9a-f-]{36}$/u);
    expect(otherUser).not.toBe(first);
    expect(regenerated).not.toBe(first);
  }, 20_000);

  it.each([
    'trap - EXIT',
    'unset _ASP_PACKAGE_ID',
    '_ASP_TELEMETRY_ENDPOINT=https://evil.invalid',
    'exec bash payload.sh'
  ])('拒絕可能繞過平台頭尾的 Linux 命令：%s', (installCommand) => {
    expect(() => service.generate(input({ installCommand }))).toThrowError(
      expect.objectContaining({ code: 'UNSAFE_MAINTAINER_COMMAND' })
    );
  });

  it('Linux 中部 exit 後仍把失敗遙測寫入本機隊列', async () => {
    const generated = service.generate(input({ installCommand: 'exit 23' }));
    const home = await mkdtemp(join(tmpdir(), 'agent-script-test-'));
    const scriptPath = join(home, 'install.sh');
    await writeFile(scriptPath, generated.script, { mode: 0o700 });

    await expect(execFileAsync('bash', [scriptPath], { env: { ...process.env, HOME: home } }))
      .rejects.toMatchObject({ code: 23 });
    const queued = await readFile(join(home, '.agent-platform', 'pending_reports.jsonl'), 'utf8');
    expect(JSON.parse(queued.trim())).toMatchObject({
      package_id: 'quality-skill', user_ref_type: 'uid', status: 'failed', error_code: 'E999'
    });
  });

  it('Linux 中部動態取消子程序 trap 或改寫唯讀變數仍不能越過父層遙測', async () => {
    const generated = service.generate(input({
      installCommand: [
        'trap_name=trap',
        'builtin "$trap_name" - EXIT',
        'variable=_ASP',
        'variable="${variable}_PACKAGE_ID"',
        'printf -v "$variable" evil'
      ].join('\n')
    }));
    const home = await mkdtemp(join(tmpdir(), 'agent-script-dynamic-bypass-'));
    const scriptPath = join(home, 'install.sh');
    await writeFile(scriptPath, generated.script, { mode: 0o700 });

    await expect(execFileAsync('bash', [scriptPath], { env: { ...process.env, HOME: home } }))
      .rejects.toMatchObject({ code: expect.any(Number) });
    const queued = JSON.parse(await readFile(
      join(home, '.agent-platform', 'pending_reports.jsonl'), 'utf8'
    )) as { package_id: string; status: string };
    expect(queued).toMatchObject({ package_id: 'quality-skill', status: 'failed' });
  });

  it('同一 Linux 腳本每次執行產生新 key，queue 重試保留原 key', async () => {
    const generated = service.generate(input());
    const home = await mkdtemp(join(tmpdir(), 'agent-script-runtime-key-'));
    const scriptPath = join(home, 'install.sh');
    await writeFile(scriptPath, generated.script, { mode: 0o700 });

    await execFileAsync('bash', [scriptPath], { env: { ...process.env, HOME: home } });
    await execFileAsync('bash', [scriptPath], { env: { ...process.env, HOME: home } });

    const queued = (await readFile(
      join(home, '.agent-platform', 'pending_reports.jsonl'), 'utf8'
    )).trim().split('\n').map((line) => JSON.parse(line) as { idempotency_key: string });
    expect(queued).toHaveLength(2);
    expect(queued[0]!.idempotency_key).toMatch(/^[0-9a-f-]{36}$/);
    expect(queued[1]!.idempotency_key).toMatch(/^[0-9a-f-]{36}$/);
    expect(queued[0]!.idempotency_key).not.toBe(queued[1]!.idempotency_key);
  });

  it('Linux 依 FIFO 補交，5xx 保留當前與後續行且安裝成功不改退出碼', async () => {
    const generated = service.generate(input());
    const home = await mkdtemp(join(tmpdir(), 'agent-script-fifo-'));
    const platform = join(home, '.agent-platform');
    const bin = join(home, 'bin');
    const calls = join(home, 'calls.txt');
    const scriptPath = join(home, 'install.sh');
    await mkdir(platform, { recursive: true });
    await mkdir(bin);
    await writeFile(join(platform, 'pending_reports.jsonl'), [
      '{"idempotency_key":"old-1"}',
      '{"idempotency_key":"old-2"}',
      '{"idempotency_key":"old-3"}'
    ].join('\n') + '\n');
    await writeFile(join(bin, 'curl'), `#!/usr/bin/env bash
payload="\${@: -1}"
key="$(printf '%s' "$payload" | sed -n 's/.*"idempotency_key":"\\([^"]*\\)".*/\\1/p')"
printf '%s\\n' "$key" >> "$ASP_CALLS"
case "$key" in old-1) printf 200 ;; *) printf 500 ;; esac
`, { mode: 0o700 });
    await writeFile(scriptPath, generated.script, { mode: 0o700 });

    const result = await execFileAsync('bash', [scriptPath], {
      env: {
        ...process.env, HOME: home, ASP_CALLS: calls,
        PATH: `${bin}:${process.env.PATH ?? ''}`
      }
    });
    const remaining = (await readFile(
      join(platform, 'pending_reports.jsonl'), 'utf8'
    )).trim().split('\n').map((line) => JSON.parse(line) as { idempotency_key: string });

    expect(result.stderr).toContain('安裝成功，資料同步中');
    expect((await readFile(calls, 'utf8')).trim().split('\n').slice(0, 2)).toEqual([
      'old-1', 'old-2'
    ]);
    expect(remaining.slice(0, 2).map((item) => item.idempotency_key)).toEqual([
      'old-2', 'old-3'
    ]);
    expect(remaining).toHaveLength(3);
  });

  it('Linux 永久 4xx 移入 dead-letter，不阻塞後續 FIFO', async () => {
    const generated = service.generate(input());
    const home = await mkdtemp(join(tmpdir(), 'agent-script-dead-letter-'));
    const platform = join(home, '.agent-platform');
    const bin = join(home, 'bin');
    const scriptPath = join(home, 'install.sh');
    await mkdir(platform, { recursive: true });
    await mkdir(bin);
    await writeFile(join(platform, 'pending_reports.jsonl'), [
      '{"idempotency_key":"bad-4xx"}',
      '{"idempotency_key":"good-2xx"}'
    ].join('\n') + '\n');
    await writeFile(join(bin, 'curl'), `#!/usr/bin/env bash
payload="\${@: -1}"
case "$payload" in *bad-4xx*) printf 400 ;; *) printf 200 ;; esac
`, { mode: 0o700 });
    await writeFile(scriptPath, generated.script, { mode: 0o700 });

    await execFileAsync('bash', [scriptPath], {
      env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH ?? ''}` }
    });

    const pending = await readFile(join(platform, 'pending_reports.jsonl'), 'utf8');
    const deadLetter = await readFile(join(platform, 'dead_letter_reports.jsonl'), 'utf8');
    expect(pending).toBe('');
    expect(deadLetter.trim()).toBe('{"idempotency_key":"bad-4xx"}');
  });

  it('Linux 回收死亡程序留下的 queue lock，避免後續事件靜默丟失', async () => {
    const generated = service.generate(input());
    const home = await mkdtemp(join(tmpdir(), 'agent-script-stale-lock-'));
    const platform = join(home, '.agent-platform');
    const lock = join(platform, 'pending_reports.lock');
    const scriptPath = join(home, 'install.sh');
    await mkdir(lock, { recursive: true });
    await writeFile(join(lock, 'owner'), '999999999');
    await writeFile(scriptPath, generated.script, { mode: 0o700 });

    await execFileAsync('bash', [scriptPath], { env: { ...process.env, HOME: home } });

    const queued = JSON.parse(await readFile(
      join(platform, 'pending_reports.jsonl'), 'utf8'
    )) as { status: string };
    expect(queued.status).toBe('succeeded');
  });

  it('Linux 安裝成功時上報成功且保持原始退出碼', async () => {
    const generated = service.generate(input());
    const home = await mkdtemp(join(tmpdir(), 'agent-script-success-'));
    const bin = join(home, 'bin');
    const scriptPath = join(home, 'install.sh');
    const capturePath = join(home, 'telemetry.json');
    await mkdir(bin);
    await writeFile(
      join(bin, 'curl'),
      '#!/usr/bin/env bash\nprintf \'%s\' "${@: -1}" > "$ASP_CAPTURE_FILE"\n',
      { mode: 0o700 }
    );
    await writeFile(scriptPath, generated.script, { mode: 0o700 });

    await expect(execFileAsync('bash', [scriptPath], {
      env: {
        ...process.env,
        HOME: home,
        PATH: `${bin}:${process.env.PATH ?? ''}`,
        ASP_CAPTURE_FILE: capturePath
      }
    })).resolves.toMatchObject({});
    expect(JSON.parse(await readFile(capturePath, 'utf8'))).toMatchObject({
      status: 'succeeded', package_id: 'quality-skill', client_runtime: 'codex'
    });
  });

  it('Windows PowerShell 腳本可執行並在遙測失敗時保留成功結果', async () => {
    const generated = service.generate(input({
      targetOs: 'windows',
      installCommand: "Set-Content -Path (Join-Path $HOME 'result.txt') -Value 'installed'",
      uninstallCommand: "Remove-Item -ErrorAction SilentlyContinue (Join-Path $HOME 'result.txt')"
    }));
    const home = await mkdtemp(join(tmpdir(), 'agent-powershell-test-'));
    const scriptPath = join(home, 'install.ps1');
    await writeFile(scriptPath, generated.script);

    await expect(execFileAsync('pwsh', ['-NoProfile', '-File', scriptPath], {
      env: { ...process.env, HOME: home }
    })).resolves.toMatchObject({});
    await expect(execFileAsync('pwsh', ['-NoProfile', '-File', scriptPath], {
      env: { ...process.env, HOME: home }
    })).resolves.toMatchObject({});
    const queued = (await readFile(
      join(home, '.agent-platform', 'pending_reports.jsonl'), 'utf8'
    )).trim().split(/\r?\n/u).map((line) => JSON.parse(line) as {
      idempotency_key: string; os_type: string; status: string; package_id: string;
    });
    expect(queued[0]).toMatchObject({
      os_type: 'windows', status: 'succeeded', package_id: 'quality-skill'
    });
    expect(queued).toHaveLength(2);
    expect(queued[0]!.idempotency_key).not.toBe(queued[1]!.idempotency_key);
  });

  it('PowerShell 原生命令非零時保留退出碼並上報 E999', async () => {
    const generated = service.generate(input({
      targetOs: 'windows',
      installCommand: "& pwsh -NoProfile -Command 'exit 7'",
      uninstallCommand: "Write-Output 'uninstall'"
    }));
    const home = await mkdtemp(join(tmpdir(), 'agent-powershell-native-exit-'));
    const scriptPath = join(home, 'install.ps1');
    await writeFile(scriptPath, generated.script);

    await expect(execFileAsync('pwsh', ['-NoProfile', '-File', scriptPath], {
      env: { ...process.env, HOME: home }
    })).rejects.toMatchObject({ code: 7 });
    const queued = JSON.parse(await readFile(
      join(home, '.agent-platform', 'pending_reports.jsonl'), 'utf8'
    )) as { status: string; error_code: string };
    expect(queued).toMatchObject({ status: 'failed', error_code: 'E999' });
  });

  it('PowerShell queue I/O 失敗仍執行維護者命令並保留成功退出碼', async () => {
    const generated = service.generate(input({
      targetOs: 'windows',
      installCommand: "Set-Content -Path (Join-Path $HOME 'result.txt') -Value 'installed'",
      uninstallCommand: "Write-Output 'uninstall'"
    }));
    const home = await mkdtemp(join(tmpdir(), 'agent-powershell-queue-io-'));
    const platform = join(home, '.agent-platform');
    const scriptPath = join(home, 'install.ps1');
    await mkdir(platform);
    await writeFile(join(platform, 'pending_reports.jsonl'), '{"idempotency_key":"old"}\n');
    await writeFile(scriptPath, generated.script);
    await execFileAsync('chmod', ['400', join(platform, 'pending_reports.jsonl')]);
    await execFileAsync('chmod', ['500', platform]);

    const result = await execFileAsync('pwsh', ['-NoProfile', '-File', scriptPath], {
      env: { ...process.env, HOME: home }
    });

    expect(result).toMatchObject({ stderr: expect.any(String) });
    expect(await readFile(join(home, 'result.txt'), 'utf8')).toContain('installed');
  }, 15_000);

  it('殘留副作用為 true 時強制提供說明與人工清理步驟', () => {
    expect(() => service.generate(input({ hasResidualEffects: true }))).toThrowError(
      expect.objectContaining({ code: 'RESIDUAL_DETAILS_REQUIRED' })
    );
  });
});

describe('遙測 payload 的 error_code 欄位', () => {
  /*
   * error_code 的 schema 要求 minLength 1。腳本若在成功時送出空字串，
   * 每一筆成功安裝的遙測都會被驗證層擋下並進入 dead letter——
   * 失敗的反而上報得了，成功率統計因此完全失真。
   */
  it('bash 腳本成功時省略 error_code 而非送空字串', () => {
    const script = service.generate(input()).script;

    expect(script).not.toContain('"error_code":"%s"');
    expect(script).toContain('if [[ -n "$_ASP_ERROR_CODE" ]]; then');
  });

  it('bash 腳本有錯誤碼時才組出該欄位', () => {
    const script = service.generate(input()).script;

    // 欄位由 error_field 變數動態帶入，成功時為空字串因此整段消失。
    expect(script).toContain('"$_ASP_INSTALL_STATUS" "$error_field"');
  });

  it('PowerShell 腳本以條件式加入 error_code', () => {
    const script = service.generate(
      input({
        targetOs: 'windows',
        installCommand: "Write-Output 'ok'",
        uninstallCommand: "Write-Output 'ok'"
      })
    ).script;

    expect(script).toContain(
      "if ($script:_ASP_ERROR_CODE) { $payloadMap['error_code']"
    );
    expect(script).not.toContain('error_code = $script:_ASP_ERROR_CODE;');
  });
});
