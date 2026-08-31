// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { createHash } from 'node:crypto';

import type { GeneratedScript, GenerateScriptInput } from './types.js';
import { AppError } from '../../shared/errors/app-error.js';
import type {
  ClientRuntime,
  ScriptOptionDefinition,
  ScriptTargetOs
} from '../catalog/types.js';

const TELEMETRY_FIELDS = [
  'idempotency_key', 'package_id', 'version', 'user_ref', 'user_ref_type',
  'os_type', 'client_runtime', 'script_version', 'options',
  'status', 'error_code', 'start_time', 'end_time'
];
const SAFE_METADATA = /^[\p{L}\p{N}._:@/+\-= ]+$/u;

function bashLiteral(value: string): string {
  return `'${value.replaceAll("'", `'\"'\"'`)}'`;
}

function powershellLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function digest(script: string): string {
  return `sha256:${createHash('sha256').update(script).digest('hex')}`;
}

interface ResolvedGenerateScriptInput {
  packageId: string;
  version: string;
  publishedAt: Date;
  targetOs: ScriptTargetOs;
  action?: 'install' | 'uninstall';
  clientRuntime: ClientRuntime | string;
  scriptVersion: number;
  installCommand: string;
  uninstallCommand: string;
  options: ScriptOptionDefinition[];
  resolvedOptions: Record<string, string | boolean>;
  usageInstructions: string;
  hasResidualEffects: boolean;
  residualDescription?: string;
  manualCleanupSteps?: string;
  userReference: GenerateScriptInput['userReference'];
  telemetryEndpoint: string;
}

function resolveOptions(
  definitions: ScriptOptionDefinition[],
  selected: Record<string, string | boolean> = {}
): Record<string, string | boolean> {
  const known = new Map(definitions.map((definition) => [definition.name, definition]));
  for (const name of Object.keys(selected)) {
    if (!known.has(name)) {
      throw new AppError({
        statusCode: 400, code: 'UNKNOWN_SCRIPT_OPTION',
        message: `UNKNOWN_SCRIPT_OPTION: 未定義的腳本選項 ${name}`
      });
    }
  }
  return Object.fromEntries(definitions.map((definition) => {
    const value = selected[definition.name] ?? definition.defaultValue;
    const valid = definition.type === 'boolean'
      ? typeof value === 'boolean'
      : typeof value === 'string' && (
        definition.type !== 'select' || definition.choices?.includes(value)
      );
    if (!valid) {
      throw new AppError({
        statusCode: 400, code: 'INVALID_SCRIPT_OPTION_VALUE',
        message: `INVALID_SCRIPT_OPTION_VALUE: 腳本選項 ${definition.name} 的值無效`
      });
    }
    return [definition.name, value];
  }));
}

function resolveInput(input: GenerateScriptInput): ResolvedGenerateScriptInput {
  const revision = input.target?.currentRevision;
  if (input.target && (!revision || input.target.deletedAt)) {
    throw new AppError({
      statusCode: 409, code: 'SCRIPT_TARGET_UNAVAILABLE', message: '腳本目標沒有有效 current revision'
    });
  }
  const legacyOs = input.targetOs === 'linux' ? 'linux/macos' : input.targetOs;
  const targetOs = input.target?.targetOs ?? legacyOs;
  const clientRuntime = input.target?.clientRuntime ?? input.clientRuntime;
  const installCommand = revision?.installCommand ?? input.installCommand;
  const uninstallCommand = revision?.uninstallCommand ?? input.uninstallCommand;
  if (!targetOs || !clientRuntime || !installCommand || !uninstallCommand) {
    throw new AppError({
      statusCode: 400, code: 'INVALID_SCRIPT_TARGET', message: '腳本目標資料不完整'
    });
  }
  const options = revision?.options ?? [];
  return {
    packageId: input.packageId,
    version: input.version,
    publishedAt: input.publishedAt ?? new Date(0),
    targetOs,
    ...(input.action ? { action: input.action } : {}),
    clientRuntime,
    scriptVersion: revision?.scriptVersion ?? 1,
    installCommand,
    uninstallCommand,
    options,
    resolvedOptions: resolveOptions(options, input.selectedOptions),
    usageInstructions: revision?.usageInstructions ?? '',
    hasResidualEffects: revision?.hasResidualEffects ?? input.hasResidualEffects ?? false,
    ...(revision?.residualDescription ?? input.residualDescription
      ? { residualDescription: revision?.residualDescription ?? input.residualDescription }
      : {}),
    ...(revision?.manualCleanupSteps ?? input.manualCleanupSteps
      ? { manualCleanupSteps: revision?.manualCleanupSteps ?? input.manualCleanupSteps }
      : {}),
    userReference: input.userReference,
    telemetryEndpoint: input.telemetryEndpoint
  };
}

function assertSafeMetadata(input: ResolvedGenerateScriptInput): void {
  for (const [name, value] of [
    ['packageId', input.packageId], ['version', input.version],
    ['clientRuntime', input.clientRuntime], ['userReference', input.userReference.value]
  ] as const) {
    if (!value || !SAFE_METADATA.test(value)) {
      throw new AppError({
        statusCode: 400, code: 'INVALID_SCRIPT_METADATA', message: `腳本欄位 ${name} 含有不允許的字元`
      });
    }
  }
  let endpoint: URL;
  try {
    endpoint = new URL(input.telemetryEndpoint);
  } catch {
    throw new AppError({ statusCode: 400, code: 'INVALID_TELEMETRY_ENDPOINT', message: '遙測端點格式錯誤' });
  }
  if (!['http:', 'https:'].includes(endpoint.protocol)) {
    throw new AppError({ statusCode: 400, code: 'INVALID_TELEMETRY_ENDPOINT', message: '遙測端點只支援 HTTP 或 HTTPS' });
  }
}

function assertMaintainerCommand(command: string, targetOs: ScriptTargetOs): void {
  const unsafe = targetOs !== 'windows'
    ? /(?:^|[;&|()\s])(?:trap|exec|source)(?:$|\s)|(^|\n)\s*\.\s+|_ASP_|ASP_TELEMETRY_ENDPOINT/i
    : /\$?_ASP_|ASP_TELEMETRY_ENDPOINT|\b(?:Remove-Variable|Set-Variable|Register-EngineEvent)\b/i;
  if (!command.trim() || unsafe.test(command)) {
    throw new AppError({
      statusCode: 400,
      code: 'UNSAFE_MAINTAINER_COMMAND',
      message: '維護者命令不得操控平台保留變數、退出攔截或遙測端點'
    });
  }
}

function optionEnvironmentName(name: string): string {
  return `ASP_OPT_${name.slice(2).replaceAll('-', '_').toUpperCase()}`;
}

function bashOptionExports(input: ResolvedGenerateScriptInput): string {
  return Object.entries(input.resolvedOptions)
    .map(([name, value]) => `export ${optionEnvironmentName(name)}=${bashLiteral(String(value))}`)
    .join('\n');
}

function powershellOptionExports(input: ResolvedGenerateScriptInput): string {
  return Object.entries(input.resolvedOptions)
    .map(([name, value]) => `$env:${optionEnvironmentName(name)} = ${powershellLiteral(String(value))}`)
    .join('\n');
}

function bashMetadataOutput(input: ResolvedGenerateScriptInput): string {
  return [
    `套件版本：${input.packageId} ${input.version}`,
    `發布日期：${input.publishedAt.toISOString()}`,
    `腳本版本：v${input.scriptVersion}`
  ].map((line) => `printf '%s\\n' ${bashLiteral(line)}`).join('\n');
}

function powershellMetadataOutput(input: ResolvedGenerateScriptInput): string {
  return [
    `套件版本：${input.packageId} ${input.version}`,
    `發布日期：${input.publishedAt.toISOString()}`,
    `腳本版本：v${input.scriptVersion}`
  ].map((line) => `[Console]::Out.WriteLine(${powershellLiteral(line)})`).join('\n');
}

function linuxScript(input: ResolvedGenerateScriptInput): string {
  const action = input.action ?? 'install';
  const command = action === 'install' ? input.installCommand : input.uninstallCommand;
  const succeededStatus = action === 'install' ? 'succeeded' : 'uninstalled';
  const anonymousSetup = input.userReference.type === 'uuid'
    ? `_ASP_UUID_FILE="$HOME/.agent-platform/uuid"\nif [[ -s "$_ASP_UUID_FILE" ]]; then\n  _ASP_USER_REF="$(<"$_ASP_UUID_FILE")"\nelse\n  if ! _ASP_USER_REF="$(_asp_new_uuid)"; then\n    printf '%s\\n' '無法產生匿名 UUID' >&2\n    exit 1\n  fi\n  printf '%s' "$_ASP_USER_REF" > "$_ASP_UUID_FILE"\nfi`
    : `_ASP_USER_REF=${bashLiteral(input.userReference.value)}`;
  return `#!/usr/bin/env bash
if [[ "\${1:-}" == '--help' ]]; then
  printf '%s\n' ${bashLiteral(input.usageInstructions)}
${bashMetadataOutput(input).split('\n').map((line) => `  ${line}`).join('\n')}
  exit 0
fi
set -uo pipefail
umask 077

_asp_new_uuid() {
  if [[ -r /proc/sys/kernel/random/uuid ]]; then
    printf '%s\n' "$(< /proc/sys/kernel/random/uuid)"
  elif command -v uuidgen >/dev/null 2>&1; then
    uuidgen | tr '[:upper:]' '[:lower:]'
  else
    return 1
  fi
}

# 平台頭部：發布者不可修改
_ASP_SCRIPT_VERSION=${bashLiteral(String(input.scriptVersion))}
_ASP_PACKAGE_ID=${bashLiteral(input.packageId)}
_ASP_PACKAGE_VERSION=${bashLiteral(input.version)}
_ASP_PUBLISHED_AT=${bashLiteral(input.publishedAt.toISOString())}
if ! _ASP_IDEMPOTENCY_KEY="$(_asp_new_uuid)"; then
  printf '%s\n' '無法產生 idempotency key' >&2
  exit 1
fi
_ASP_START_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
_ASP_USER_REF_TYPE=${bashLiteral(input.userReference.type)}
_ASP_OS_TYPE=${input.targetOs === 'wsl'
    ? "'wsl'"
    : `"$([[ "$(uname -s)" == 'Darwin' ]] && printf macos || printf linux)"`}
_ASP_CLIENT_RUNTIME=${bashLiteral(input.clientRuntime)}
_ASP_OPTIONS_JSON=${bashLiteral(JSON.stringify(input.resolvedOptions))}
_ASP_TELEMETRY_ENDPOINT=${bashLiteral(input.telemetryEndpoint)}
_ASP_INSTALL_STATUS='pending'
_ASP_ERROR_CODE=''
mkdir -p "$HOME/.agent-platform"
${anonymousSetup}
readonly _ASP_SCRIPT_VERSION _ASP_PACKAGE_ID _ASP_PACKAGE_VERSION _ASP_IDEMPOTENCY_KEY
readonly _ASP_PUBLISHED_AT _ASP_START_TIME _ASP_USER_REF _ASP_USER_REF_TYPE _ASP_OS_TYPE
readonly _ASP_CLIENT_RUNTIME _ASP_TELEMETRY_ENDPOINT

${bashOptionExports(input)}

_ASP_QUEUE_DIRECTORY="$HOME/.agent-platform"
_ASP_PENDING_QUEUE="$_ASP_QUEUE_DIRECTORY/pending_reports.jsonl"
_ASP_DEAD_LETTER="$_ASP_QUEUE_DIRECTORY/dead_letter_reports.jsonl"
_ASP_QUEUE_LOCK="$_ASP_QUEUE_DIRECTORY/pending_reports.lock"

_asp_send_payload() {
  local payload="$1" http_code
  if ! http_code="$(curl --silent --show-error --connect-timeout 1 --max-time 2 \
    --output /dev/null --write-out '%{http_code}' \
    -X POST "$_ASP_TELEMETRY_ENDPOINT/api/telemetry/report" \
    -H 'Content-Type: application/json' -d "$payload")"; then
    return 5
  fi
  case "$http_code" in
    ''|2??) return 0 ;;
    408|425|429) return 5 ;;
    4??) return 4 ;;
    *) return 5 ;;
  esac
}

_asp_acquire_queue_lock() {
  local attempt=0
  while ! mkdir "$_ASP_QUEUE_LOCK" 2>/dev/null; do
    attempt=$((attempt + 1))
    local owner=''
    [[ -r "$_ASP_QUEUE_LOCK/owner" ]] && owner="$(< "$_ASP_QUEUE_LOCK/owner")"
    if [[ "$owner" =~ ^[0-9]+$ ]] && ! kill -0 "$owner" 2>/dev/null; then
      rm -f "$_ASP_QUEUE_LOCK/owner"
      rmdir "$_ASP_QUEUE_LOCK" 2>/dev/null || true
      continue
    fi
    if [[ -z "$owner" && "$attempt" -ge 3 ]]; then
      rmdir "$_ASP_QUEUE_LOCK" 2>/dev/null || true
    fi
    [[ "$attempt" -ge 40 ]] && return 1
    sleep 0.05
  done
  printf '%s' "$$" > "$_ASP_QUEUE_LOCK/owner"
}

_asp_release_queue_lock() {
  local owner=''
  [[ -r "$_ASP_QUEUE_LOCK/owner" ]] && owner="$(< "$_ASP_QUEUE_LOCK/owner")"
  [[ "$owner" == "$$" ]] || return 0
  rm -f "$_ASP_QUEUE_LOCK/owner"
  rmdir "$_ASP_QUEUE_LOCK" 2>/dev/null || true
}

_asp_append_locked() {
  local destination="$1" payload="$2"
  _asp_acquire_queue_lock || return 1
  printf '%s\\n' "$payload" >> "$destination"
  _asp_release_queue_lock
}

_asp_drain_queue() {
  [[ -s "$_ASP_PENDING_QUEUE" ]] || return 0
  _asp_acquire_queue_lock || return 0
  local temporary="$_ASP_QUEUE_DIRECTORY/.pending_reports.$$.tmp"
  local line send_result blocked=0
  : > "$temporary"
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -n "$line" ]] || continue
    if [[ "$blocked" -eq 1 ]]; then
      printf '%s\\n' "$line" >> "$temporary"
      continue
    fi
    if _asp_send_payload "$line"; then
      continue
    else
      send_result=$?
    fi
    if [[ "$send_result" -eq 4 ]]; then
      printf '%s\\n' "$line" >> "$_ASP_DEAD_LETTER"
    else
      printf '%s\\n' "$line" >> "$temporary"
      blocked=1
    fi
  done < "$_ASP_PENDING_QUEUE"
  mv -f "$temporary" "$_ASP_PENDING_QUEUE"
  _asp_release_queue_lock
}

_asp_drain_queue || true

${bashMetadataOutput(input)}

_asp_report_result() {
  local end_time payload send_result queued=0 error_field=''
  end_time="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  # error_code 的 schema 要求 minLength 1，成功時沒有錯誤碼，因此整個欄位
  # 省略而非送空字串——送空字串會被驗證層擋下，報告直接進 dead letter。
  if [[ -n "$_ASP_ERROR_CODE" ]]; then
    error_field="$(printf ',\\"error_code\\":\\"%s\\"' "$_ASP_ERROR_CODE")"
  fi
  payload="$(printf '{\"idempotency_key\":\"%s\",\"package_id\":\"%s\",\"version\":\"%s\",\"user_ref\":\"%s\",\"user_ref_type\":\"%s\",\"os_type\":\"%s\",\"client_runtime\":\"%s\",\"script_version\":%s,\"options\":%s,\"status\":\"%s\"%s,\"start_time\":\"%s\",\"end_time\":\"%s\"}' \
    "$_ASP_IDEMPOTENCY_KEY" "$_ASP_PACKAGE_ID" "$_ASP_PACKAGE_VERSION" \
    "$_ASP_USER_REF" "$_ASP_USER_REF_TYPE" "$_ASP_OS_TYPE" \
    "$_ASP_CLIENT_RUNTIME" "$_ASP_SCRIPT_VERSION" "$_ASP_OPTIONS_JSON" \
    "$_ASP_INSTALL_STATUS" "$error_field" \
    "$_ASP_START_TIME" "$end_time")"
  if _asp_send_payload "$payload"; then
    return 0
  else
    send_result=$?
  fi
  if [[ "$send_result" -eq 4 ]]; then
    _asp_append_locked "$_ASP_DEAD_LETTER" "$payload" && queued=1
  else
    _asp_append_locked "$_ASP_PENDING_QUEUE" "$payload" && queued=1
  fi
  if [[ "$queued" -eq 1 && "$_ASP_INSTALL_STATUS" == 'succeeded' ]]; then
    printf '%s\\n' '安裝成功，資料同步中' >&2
  elif [[ "$queued" -eq 1 && "$_ASP_INSTALL_STATUS" == 'uninstalled' ]]; then
    printf '%s\\n' '解除安裝成功，資料同步中' >&2
  fi
}

_asp_on_exit() {
  local exit_code="$1"
  trap - EXIT
  if [[ "$_ASP_INSTALL_STATUS" == 'pending' ]]; then
    _ASP_INSTALL_STATUS=$([[ "$exit_code" -eq 0 ]] && printf succeeded || printf failed)
    [[ "$exit_code" -eq 0 ]] || _ASP_ERROR_CODE='E999'
  fi
  _asp_report_result
  exit "$exit_code"
}
trap '_asp_on_exit $?' EXIT

# 維護者${action === 'install' ? '安裝' : '解除安裝'}命令：只在隔離子程序執行
set +e
(
  set -euo pipefail
${command.split('\n').map((line) => `  ${line}`).join('\n')}
)
_asp_exit_code=$?
set -e
if [[ "$_asp_exit_code" -eq 0 ]]; then
  _ASP_INSTALL_STATUS='${succeededStatus}'
else
  _ASP_INSTALL_STATUS='failed'
  _ASP_ERROR_CODE='E999'
fi
exit "$_asp_exit_code"
`;
}

function windowsScript(input: ResolvedGenerateScriptInput): string {
  const action = input.action ?? 'install';
  const command = action === 'install' ? input.installCommand : input.uninstallCommand;
  const succeededStatus = action === 'install' ? 'succeeded' : 'uninstalled';
  const userSetup = input.userReference.type === 'uuid'
    ? `$uuidFile = Join-Path $queueDirectory 'uuid'\nif (Test-Path $uuidFile) {\n  $script:_ASP_USER_REF = (Get-Content -Raw $uuidFile).Trim()\n} else {\n  $script:_ASP_USER_REF = [Guid]::NewGuid().ToString()\n  Set-Content -NoNewline -Path $uuidFile -Value $script:_ASP_USER_REF\n}`
    : `$script:_ASP_USER_REF = ${powershellLiteral(input.userReference.value)}`;
  return `#requires -Version 7.0
if ($args.Count -gt 0 -and $args[0] -eq '--help') {
  [Console]::Out.WriteLine(${powershellLiteral(input.usageInstructions)})
${powershellMetadataOutput(input).split('\n').map((line) => `  ${line}`).join('\n')}
  exit 0
}
$ErrorActionPreference = 'Stop'

# 平台頭部：發布者不可修改
$queueDirectory = if ([string]::IsNullOrWhiteSpace($env:APPDATA)) {
  Join-Path $HOME '.agent-platform'
} else {
  Join-Path $env:APPDATA 'agent-platform'
}
New-Item -ItemType Directory -Force -Path $queueDirectory | Out-Null
$script:_ASP_PACKAGE_ID = ${powershellLiteral(input.packageId)}
$script:_ASP_PACKAGE_VERSION = ${powershellLiteral(input.version)}
$script:_ASP_SCRIPT_VERSION = ${input.scriptVersion}
$script:_ASP_PUBLISHED_AT = ${powershellLiteral(input.publishedAt.toISOString())}
$script:_ASP_IDEMPOTENCY_KEY = [Guid]::NewGuid().ToString()
$script:_ASP_START_TIME = [DateTime]::UtcNow.ToString('o')
${userSetup}
$script:_ASP_USER_REF_TYPE = ${powershellLiteral(input.userReference.type)}
$script:_ASP_OS_TYPE = 'windows'
$script:_ASP_CLIENT_RUNTIME = ${powershellLiteral(input.clientRuntime)}
$script:_ASP_OPTIONS_JSON = ${powershellLiteral(JSON.stringify(input.resolvedOptions))}
$script:_ASP_TELEMETRY_ENDPOINT = ${powershellLiteral(input.telemetryEndpoint)}
$script:_ASP_INSTALL_STATUS = 'pending'
$script:_ASP_ERROR_CODE = ''
$script:_ASP_EXIT_CODE = 0
$pendingQueue = Join-Path $queueDirectory 'pending_reports.jsonl'
$deadLetterQueue = Join-Path $queueDirectory 'dead_letter_reports.jsonl'
$queueLock = Join-Path $queueDirectory 'pending_reports.lock'

${powershellOptionExports(input)}

function Send-AspPayload {
  param([string]$Payload)
  try {
    $response = Invoke-WebRequest -Method Post -Uri "$script:_ASP_TELEMETRY_ENDPOINT/api/telemetry/report" -ContentType 'application/json' -Body $Payload -TimeoutSec 2 -SkipHttpErrorCheck
    $statusCode = [int]$response.StatusCode
    if ($statusCode -ge 200 -and $statusCode -lt 300) { return 0 }
    if ($statusCode -in @(408, 425, 429)) { return 5 }
    if ($statusCode -ge 400 -and $statusCode -lt 500) { return 4 }
    return 5
  } catch {
    return 5
  }
}

function Invoke-AspQueueLock {
  param([scriptblock]$Action)
  $lockStream = $null
  for ($attempt = 0; $attempt -lt 40 -and $null -eq $lockStream; $attempt++) {
    try {
      $lockStream = [IO.File]::Open($queueLock, 'OpenOrCreate', 'ReadWrite', 'None')
    } catch {
      Start-Sleep -Milliseconds 50
    }
  }
  if ($null -eq $lockStream) { return $false }
  try {
    & $Action
  } finally {
    $lockStream.Dispose()
  }
  return $true
}

function Add-AspQueueLine {
  param([string]$Path, [string]$Payload)
  try {
    return [bool](Invoke-AspQueueLock { Add-Content -Path $Path -Value $Payload })
  } catch {
    return $false
  }
}

function Sync-AspPendingReports {
  if (-not (Test-Path $pendingQueue)) { return }
  [void](Invoke-AspQueueLock {
    $remaining = [Collections.Generic.List[string]]::new()
    $blocked = $false
    foreach ($line in @(Get-Content -Path $pendingQueue)) {
      if ([string]::IsNullOrWhiteSpace($line)) { continue }
      if ($blocked) {
        $remaining.Add($line)
        continue
      }
      $sendResult = Send-AspPayload -Payload $line
      if ($sendResult -eq 4) {
        Add-Content -Path $deadLetterQueue -Value $line
      } elseif ($sendResult -ne 0) {
        $remaining.Add($line)
        $blocked = $true
      }
    }
    $temporaryQueue = Join-Path $queueDirectory ".pending_reports.$PID.$([Guid]::NewGuid()).tmp"
    [IO.File]::WriteAllLines($temporaryQueue, [string[]]$remaining, [Text.UTF8Encoding]::new($false))
    Move-Item -Force -Path $temporaryQueue -Destination $pendingQueue
  })
}

try {
  Sync-AspPendingReports
} catch {
  # 補交失敗只保留既有 queue，不得阻止維護者命令。
}

${powershellMetadataOutput(input)}

$global:LASTEXITCODE = 0

try {
  # 維護者${action === 'install' ? '安裝' : '解除安裝'}命令
${command.split('\n').map((line) => `  ${line}`).join('\n')}
  if ($LASTEXITCODE -ne 0) {
    $script:_ASP_EXIT_CODE = [int]$LASTEXITCODE
    $script:_ASP_INSTALL_STATUS = 'failed'
    $script:_ASP_ERROR_CODE = 'E999'
  } else {
    $script:_ASP_INSTALL_STATUS = '${succeededStatus}'
  }
} catch {
  $script:_ASP_EXIT_CODE = 1
  $script:_ASP_INSTALL_STATUS = 'failed'
  $script:_ASP_ERROR_CODE = 'E999'
} finally {
  $payloadMap = @{
    idempotency_key = $script:_ASP_IDEMPOTENCY_KEY; package_id = $script:_ASP_PACKAGE_ID
    version = $script:_ASP_PACKAGE_VERSION; user_ref = $script:_ASP_USER_REF
    user_ref_type = $script:_ASP_USER_REF_TYPE; os_type = $script:_ASP_OS_TYPE
    client_runtime = $script:_ASP_CLIENT_RUNTIME; status = $script:_ASP_INSTALL_STATUS
    script_version = $script:_ASP_SCRIPT_VERSION
    options = ($script:_ASP_OPTIONS_JSON | ConvertFrom-Json)
    start_time = $script:_ASP_START_TIME
    end_time = [DateTime]::UtcNow.ToString('o')
  }
  # error_code 的 schema 要求 minLength 1，成功時沒有錯誤碼，因此整個欄位
  # 省略而非送空字串——送空字串會被驗證層擋下，報告直接進 dead letter。
  if ($script:_ASP_ERROR_CODE) { $payloadMap['error_code'] = $script:_ASP_ERROR_CODE }
  $payload = $payloadMap | ConvertTo-Json -Compress
  $sendResult = Send-AspPayload -Payload $payload
  if ($sendResult -eq 4) {
    [void](Add-AspQueueLine -Path $deadLetterQueue -Payload $payload)
  } elseif ($sendResult -ne 0) {
    $queued = Add-AspQueueLine -Path $pendingQueue -Payload $payload
    if ($queued -and $script:_ASP_INSTALL_STATUS -eq 'succeeded') {
      [Console]::Error.WriteLine('安裝成功，資料同步中')
    } elseif ($queued -and $script:_ASP_INSTALL_STATUS -eq 'uninstalled') {
      [Console]::Error.WriteLine('解除安裝成功，資料同步中')
    }
  }
}
exit $script:_ASP_EXIT_CODE
`;
}

export class ScriptGeneratorService {
  generate(input: GenerateScriptInput): GeneratedScript {
    const resolved = resolveInput(input);
    assertSafeMetadata(resolved);
    assertMaintainerCommand(resolved.installCommand, resolved.targetOs);
    assertMaintainerCommand(resolved.uninstallCommand, resolved.targetOs);
    if (
      resolved.hasResidualEffects &&
      (!resolved.residualDescription?.trim() || !resolved.manualCleanupSteps?.trim())
    ) {
      throw new AppError({
        statusCode: 400, code: 'RESIDUAL_DETAILS_REQUIRED',
        message: '有殘留副作用時必須填寫殘留說明與人工清理步驟'
      });
    }
    const script = resolved.targetOs === 'windows'
      ? windowsScript(resolved)
      : linuxScript(resolved);
    const action = resolved.action ?? 'install';
    const extension = resolved.targetOs === 'windows' ? 'ps1' : 'sh';
    const filename = [
      resolved.packageId,
      resolved.version,
      resolved.targetOs.replace('/', '-'),
      resolved.clientRuntime,
      `v${resolved.scriptVersion}`,
      action
    ].join('-').replaceAll(/[^\p{L}\p{N}._-]/gu, '-') + `.${extension}`;
    return {
      packageId: resolved.packageId,
      version: resolved.version,
      publishedAt: resolved.publishedAt.toISOString(),
      targetOs: resolved.targetOs,
      action,
      clientRuntime: resolved.clientRuntime,
      scriptVersion: resolved.scriptVersion,
      resolvedOptions: { ...resolved.resolvedOptions },
      filename,
      executionCommand: resolved.targetOs === 'windows'
        ? `pwsh -File .\\${filename}`
        : `bash ./${filename}`,
      telemetryAssurance: 'best-effort',
      script,
      digest: digest(script),
      preview: {
        installCommand: resolved.installCommand,
        uninstallCommand: resolved.uninstallCommand,
        usageInstructions: resolved.usageInstructions,
        options: resolved.options.map((option) => ({
          ...option,
          ...(option.choices ? { choices: [...option.choices] } : {})
        })),
        hasResidualEffects: resolved.hasResidualEffects,
        ...(resolved.residualDescription ? { residualDescription: resolved.residualDescription } : {}),
        ...(resolved.manualCleanupSteps ? { manualCleanupSteps: resolved.manualCleanupSteps } : {}),
        telemetryFields: [...TELEMETRY_FIELDS]
      }
    };
  }

  verify(script: string, expectedDigest: string): boolean {
    return digest(script) === expectedDigest;
  }
}
