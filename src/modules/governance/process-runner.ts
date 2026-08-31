// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface ProcessRunnerOptions {
  timeoutMs?: number;
  maxOutputBytes?: number;
}

export interface ProcessRunOptions extends ProcessRunnerOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export interface ProcessRunResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  terminationMode: 'none' | 'process_group' | 'parent_only';
  outputTruncated: boolean;
  errorCode?: 'runner_timeout' | 'runner_unavailable';
}

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024;

/**
 * 以參數陣列啟動子程序，避免把發布者資料交給 shell 解譯。
 */
export class ProcessRunner {
  constructor(private readonly defaults: ProcessRunnerOptions = {}) {}

  run(command: string, args: readonly string[], options: ProcessRunOptions = {}): Promise<ProcessRunResult> {
    const timeoutMs = options.timeoutMs ?? this.defaults.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxOutputBytes = options.maxOutputBytes
      ?? this.defaults.maxOutputBytes
      ?? DEFAULT_MAX_OUTPUT_BYTES;
    if (!command || timeoutMs <= 0 || maxOutputBytes < 0) {
      throw new TypeError('ProcessRunner 參數無效');
    }

    return new Promise((resolve) => {
      const child = spawn(command, [...args], {
        shell: false,
        // Unix/WSL 以子程序 PID 建立獨立 process group，timeout 才能終止整棵樹。
        detached: process.platform !== 'win32',
        ...(options.cwd ? { cwd: options.cwd } : {}),
        ...(options.env ? { env: options.env } : {})
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let capturedBytes = 0;
      let outputTruncated = false;
      let timedOut = false;
      let unavailable = false;
      let terminationMode: ProcessRunResult['terminationMode'] = 'none';

      const capture = (destination: Buffer[], chunk: Buffer | string) => {
        const source = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        const remaining = Math.max(0, maxOutputBytes - capturedBytes);
        if (remaining > 0) {
          const accepted = source.subarray(0, remaining);
          destination.push(accepted);
          capturedBytes += accepted.byteLength;
        }
        if (source.byteLength > remaining) outputTruncated = true;
      };
      child.stdout?.on('data', (chunk: Buffer) => capture(stdout, chunk));
      child.stderr?.on('data', (chunk: Buffer) => capture(stderr, chunk));
      child.once('error', () => {
        unavailable = true;
      });

      const timer = setTimeout(() => {
        timedOut = true;
        terminationMode = terminateProcessTree(child.pid, () => child.kill('SIGKILL'));
      }, timeoutMs);

      child.once('close', (exitCode, signal) => {
        clearTimeout(timer);
        resolve({
          exitCode: timedOut || unavailable ? null : exitCode,
          signal,
          stdout: Buffer.concat(stdout).toString('utf8'),
          stderr: Buffer.concat(stderr).toString('utf8'),
          timedOut,
          terminationMode,
          outputTruncated,
          ...(timedOut
            ? { errorCode: 'runner_timeout' as const }
            : unavailable ? { errorCode: 'runner_unavailable' as const } : {})
        });
      });
    });
  }
}

function terminateProcessTree(
  childPid: number | undefined,
  killParent: () => boolean
): ProcessRunResult['terminationMode'] {
  const safePid = childPid !== undefined
    && Number.isSafeInteger(childPid)
    && childPid > 1
    && childPid !== process.pid;
  if (process.platform !== 'win32' && safePid) {
    try {
      // detached=true 保證負 PID 只指向本次 runner 的 process group。
      process.kill(-childPid, 'SIGKILL');
      return 'process_group';
    } catch {
      // 啟動與 timeout 競態時 group 可能已離開，退回只終止已知 parent。
    }
  }
  killParent();
  // Windows 的 Node child_process 沒有可靠的跨版本 group kill，明確標記降級證據。
  return 'parent_only';
}

/** 臨時目錄的生命週期固定包住單次 runner，callback 失敗也會清理。 */
export async function withTemporaryDirectory<T>(
  prefix: string,
  callback: (directory: string) => Promise<T>
): Promise<T> {
  if (!/^[a-z0-9-]+$/i.test(prefix)) throw new TypeError('臨時目錄 prefix 無效');
  const directory = await mkdtemp(join(tmpdir(), prefix));
  try {
    return await callback(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
