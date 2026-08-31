// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { createHash } from 'node:crypto';

import { AppError } from '../../shared/errors/app-error.js';
import type { TelemetryRepository } from './repository.js';
import type {
  CanonicalTelemetryEvent,
  InstallErrorCode,
  TelemetryReceipt,
  TelemetryStatus
} from './types.js';

export const TELEMETRY_ALLOWED_FIELDS = [
  'idempotency_key',
  'package_id',
  'version',
  'user_ref',
  'user_ref_type',
  'os_type',
  'client_runtime',
  'status',
  'error_code',
  'start_time',
  'end_time',
  'script_version',
  'options'
] as const;

const allowedFields = new Set<string>(TELEMETRY_ALLOWED_FIELDS);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const rfc3339Pattern = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i;
const safeUidPattern = /^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/;
const statuses = new Set<TelemetryStatus>([
  'downloaded',
  'succeeded',
  'failed',
  'uninstalled'
]);
const osTypes = new Set<CanonicalTelemetryEvent['osType']>([
  'macos',
  'linux',
  'windows',
  'wsl'
]);
const errorCodes = new Set<InstallErrorCode>([
  'E001',
  'E002',
  'E003',
  'E004',
  'E005',
  'E006',
  'E999'
]);
const optionNamePattern = /^--[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

function invalidPayload(): AppError {
  return new AppError({
    statusCode: 400,
    code: 'INVALID_TELEMETRY_PAYLOAD',
    message: '遙測資料格式不正確'
  });
}

function requiredString(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') throw invalidPayload();
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) throw invalidPayload();
  return normalized;
}

function parseTimestamp(value: unknown): Date {
  if (typeof value !== 'string' || !rfc3339Pattern.test(value)) throw invalidPayload();
  const calendar = value.slice(0, 10);
  const calendarDate = new Date(`${calendar}T00:00:00.000Z`);
  if (
    !Number.isFinite(calendarDate.getTime()) ||
    calendarDate.toISOString().slice(0, 10) !== calendar
  ) {
    throw invalidPayload();
  }
  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.getTime())) throw invalidPayload();
  return timestamp;
}

function canonicalErrorCode(status: TelemetryStatus, value: unknown): InstallErrorCode | null {
  if (status !== 'failed') return null;
  const errorCode = requiredString(value, 64);
  if (/^exit_\d+$/i.test(errorCode) || errorCode === 'powershell_error') return 'E999';
  if (!errorCodes.has(errorCode as InstallErrorCode)) throw invalidPayload();
  return errorCode as InstallErrorCode;
}

function optionalTask13Fields(payload: Record<string, unknown>): {
  scriptVersion: number | null;
  options: Record<string, string | boolean> | null;
} {
  const hasScriptVersion = Object.hasOwn(payload, 'script_version');
  const hasOptions = Object.hasOwn(payload, 'options');
  if (hasScriptVersion !== hasOptions) throw invalidPayload();
  if (!hasScriptVersion) return { scriptVersion: null, options: null };

  const scriptVersion = payload.script_version;
  if (
    typeof scriptVersion !== 'number' ||
    !Number.isSafeInteger(scriptVersion) ||
    scriptVersion < 1 ||
    scriptVersion > 2_147_483_647
  ) {
    throw invalidPayload();
  }

  const rawOptions = payload.options;
  if (!rawOptions || typeof rawOptions !== 'object' || Array.isArray(rawOptions)) {
    throw invalidPayload();
  }
  const entries = Object.entries(rawOptions);
  if (entries.length > 20) throw invalidPayload();
  const options: Record<string, string | boolean> = {};
  for (const [name, value] of entries.sort(([left], [right]) => left.localeCompare(right))) {
    if (name.length > 64 || !optionNamePattern.test(name)) throw invalidPayload();
    if (typeof value === 'string') {
      if (value.length > 1_000) throw invalidPayload();
      options[name] = value;
      continue;
    }
    if (typeof value !== 'boolean') throw invalidPayload();
    options[name] = value;
  }
  return { scriptVersion, options };
}

function fingerprint(event: Omit<CanonicalTelemetryEvent, 'payloadFingerprint' | 'receivedAt'>): string {
  const canonicalPayload = JSON.stringify({
    idempotencyKey: event.idempotencyKey,
    packageId: event.packageId,
    version: event.version,
    userRef: event.userRef,
    userRefType: event.userRefType,
    osType: event.osType,
    clientRuntime: event.clientRuntime,
    status: event.status,
    errorCode: event.errorCode,
    scriptVersion: event.scriptVersion ?? null,
    options: event.options ?? null,
    startedAt: event.startedAt.toISOString(),
    endedAt: event.endedAt.toISOString()
  });
  return createHash('sha256').update(canonicalPayload).digest('hex');
}

export class TelemetryService {
  constructor(
    private readonly repository: TelemetryRepository,
    private readonly clock: () => Date = () => new Date()
  ) {}

  async ingest(payload: Record<string, unknown>): Promise<TelemetryReceipt> {
    if (!payload || Array.isArray(payload)) throw invalidPayload();
    const droppedFields = Object.keys(payload).filter((field) => !allowedFields.has(field));
    const idempotencyKey = requiredString(payload.idempotency_key, 64);
    if (!uuidPattern.test(idempotencyKey)) throw invalidPayload();
    const rawUserRefType = payload.user_ref_type;
    if (rawUserRefType !== 'uid' && rawUserRefType !== 'uuid') throw invalidPayload();
    const userRefType: CanonicalTelemetryEvent['userRefType'] = rawUserRefType;
    const userRef = requiredString(payload.user_ref, 255);
    if (userRefType === 'uuid' && !uuidPattern.test(userRef)) throw invalidPayload();
    if (userRefType === 'uid' && !safeUidPattern.test(userRef)) throw invalidPayload();
    const osType = payload.os_type;
    if (typeof osType !== 'string' || !osTypes.has(osType as CanonicalTelemetryEvent['osType'])) {
      throw invalidPayload();
    }
    const status = payload.status;
    if (typeof status !== 'string' || !statuses.has(status as TelemetryStatus)) throw invalidPayload();
    const startedAt = parseTimestamp(payload.start_time);
    const endedAt = parseTimestamp(payload.end_time);
    if (endedAt.getTime() < startedAt.getTime()) throw invalidPayload();
    const task13Fields = optionalTask13Fields(payload);
    const baseEvent = {
      idempotencyKey: idempotencyKey.toLowerCase(),
      packageId: requiredString(payload.package_id, 255),
      version: requiredString(payload.version, 255),
      userRef: userRefType === 'uuid' ? userRef.toLowerCase() : userRef,
      userRefType,
      osType: osType as CanonicalTelemetryEvent['osType'],
      clientRuntime: requiredString(payload.client_runtime, 255),
      status: status as TelemetryStatus,
      errorCode: canonicalErrorCode(status as TelemetryStatus, payload.error_code),
      ...task13Fields,
      startedAt,
      endedAt
    };
    const event: CanonicalTelemetryEvent = {
      ...baseEvent,
      payloadFingerprint: fingerprint(baseEvent),
      receivedAt: new Date(this.clock())
    };
    const result = await this.repository.ingest(event);
    return { ...result, droppedFields };
  }
}
