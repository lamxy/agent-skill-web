// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { and, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import type { TelemetryRepository } from './repository.js';
import type {
  CanonicalTelemetryEvent,
  InstallErrorCode,
  TelemetryRecord,
  TelemetryStatus
} from './types.js';
import * as schema from '../../shared/database/schema.js';
import { AppError } from '../../shared/errors/app-error.js';

type TelemetryDatabase = NodePgDatabase<typeof schema>;
type InstallationRow = typeof schema.installations.$inferSelect;

function mapRecord(row: InstallationRow): TelemetryRecord {
  return {
    id: String(row.id),
    idempotencyKey: row.idempotencyKey,
    packageId: row.packageId,
    version: row.version,
    userRef: row.userRef,
    userRefType: row.userRefType,
    osType: row.osType as CanonicalTelemetryEvent['osType'],
    clientRuntime: row.clientRuntime,
    status: row.status as TelemetryStatus,
    errorCode: row.errorCode as InstallErrorCode | null,
    scriptVersion: row.scriptVersion,
    options: row.options,
    startedAt: row.startedAt,
    endedAt: row.endedAt!,
    payloadFingerprint: row.payloadFingerprint,
    receivedAt: row.createdAt
  };
}

export class PostgresTelemetryRepository implements TelemetryRepository {
  constructor(private readonly database: TelemetryDatabase) {}

  async ingest(event: CanonicalTelemetryEvent): Promise<{
    record: TelemetryRecord;
    duplicate: boolean;
  }> {
    const versionRows = await this.database
      .select({ id: schema.packageVersions.id })
      .from(schema.packageVersions)
      .where(and(
        eq(schema.packageVersions.packageId, event.packageId),
        eq(schema.packageVersions.version, event.version)
      ))
      .limit(1);
    if (!versionRows[0]) {
      throw new AppError({
        statusCode: 404,
        code: 'PACKAGE_VERSION_NOT_FOUND',
        message: '找不到套件版本'
      });
    }

    const insertedRows = await this.database
      .insert(schema.installations)
      .values({
        legacyPackageVersionId: null,
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
        startedAt: event.startedAt,
        endedAt: event.endedAt,
        payloadFingerprint: event.payloadFingerprint,
        createdAt: event.receivedAt
      })
      .onConflictDoNothing({ target: schema.installations.idempotencyKey })
      .returning();
    if (insertedRows[0]) {
      return { record: mapRecord(insertedRows[0]), duplicate: false };
    }

    const existingRows = await this.database
      .select()
      .from(schema.installations)
      .where(eq(schema.installations.idempotencyKey, event.idempotencyKey))
      .limit(1);
    const existing = existingRows[0];
    if (!existing || existing.payloadFingerprint !== event.payloadFingerprint) {
      throw new AppError({
        statusCode: 409,
        code: 'IDEMPOTENCY_KEY_CONFLICT',
        message: '冪等鍵已對應不同的遙測內容'
      });
    }

    return { record: mapRecord(existing), duplicate: true };
  }
}
