// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { randomUUID } from 'node:crypto';

import { AppError } from '../../shared/errors/app-error.js';
import {
  MemoryPlatformStore,
  memoryVersionKey
} from '../catalog/memory-platform-store.js';
import type { InstallationSnapshot } from '../governance/repository.js';
import type { TelemetryRepository } from './repository.js';
import type {
  CanonicalTelemetryEvent,
  TelemetryRecord
} from './types.js';

function clone<T>(value: T): T {
  return structuredClone(value);
}

function packageVersionNotFound(): AppError {
  return new AppError({
    statusCode: 404,
    code: 'PACKAGE_VERSION_NOT_FOUND',
    message: '找不到套件版本'
  });
}

function idempotencyConflict(): AppError {
  return new AppError({
    statusCode: 409,
    code: 'IDEMPOTENCY_KEY_CONFLICT',
    message: '冪等鍵已對應不同遙測內容'
  });
}

function installationSnapshot(record: TelemetryRecord): InstallationSnapshot {
  return {
    id: record.id,
    packageId: record.packageId,
    version: record.version,
    userRefType: record.userRefType,
    userRef: record.userRef,
    status: record.status
  };
}

export class MemoryTelemetryRepository implements TelemetryRepository {
  constructor(readonly store: MemoryPlatformStore) {}

  async ingest(event: CanonicalTelemetryEvent): Promise<{
    record: TelemetryRecord;
    duplicate: boolean;
  }> {
    const state = this.store.snapshot();
    if (
      !state.packages[event.packageId] ||
      !state.versions[memoryVersionKey(event.packageId, event.version)]
    ) {
      throw packageVersionNotFound();
    }
    const existing = state.telemetryRecords.find(
      (record) => record.idempotencyKey === event.idempotencyKey
    );
    if (existing) {
      if (existing.payloadFingerprint !== event.payloadFingerprint) throw idempotencyConflict();
      return { record: clone(existing), duplicate: true };
    }

    const next = clone(state);
    const record: TelemetryRecord = { id: randomUUID(), ...clone(event) };
    next.telemetryRecords.push(record);
    next.installations.push(installationSnapshot(record));
    const adoption = next.adoption[record.packageId] ?? { installations: 0, succeeded: 0 };
    next.adoption[record.packageId] = {
      installations: adoption.installations + 1,
      succeeded: adoption.succeeded + Number(record.status === 'succeeded')
    };
    this.store.replace(next);
    return { record: clone(record), duplicate: false };
  }
}
