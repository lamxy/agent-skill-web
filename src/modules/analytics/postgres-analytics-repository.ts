// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { and, eq, gte, inArray, lte } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import type { AnalyticsRepository } from './repository.js';
import type {
  AnalyticsPeriod,
  PackageAnalyticsMetadata,
  UserAnalyticsDataset
} from './types.js';
import { mapPackageRow } from '../catalog/package-row.js';
import type { PackageVersionRecord } from '../catalog/types.js';
import type { TelemetryRecord } from '../telemetry/types.js';
import * as schema from '../../shared/database/schema.js';

type AnalyticsDatabase = NodePgDatabase<typeof schema>;

const mapPackage = mapPackageRow;

function mapVersion(
  row: typeof schema.packageVersions.$inferSelect
): PackageVersionRecord {
  return {
    id: String(row.id),
    packageId: row.packageId,
    version: row.version,
    ...(row.releaseNotes ? { releaseNotes: row.releaseNotes } : {}),
    supportedOs: [...row.supportedOs],
    supportedClients: row.supportedClients.map((client) => ({ ...client })),
    lifecycle: row.lifecycle,
    ...(row.scriptDigest ? { scriptDigest: row.scriptDigest } : {}),
    installCommand: row.installCommand,
    uninstallCommand: row.uninstallCommand,
    hasResidualEffects: row.hasResidualEffects,
    ...(row.residualDescription
      ? { residualDescription: row.residualDescription }
      : {}),
    ...(row.manualCleanupSteps
      ? { manualCleanupSteps: row.manualCleanupSteps }
      : {}),
    authorUid: row.authorUid,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function mapTelemetry(
  row: typeof schema.installations.$inferSelect
): TelemetryRecord {
  return {
    id: String(row.id),
    idempotencyKey: row.idempotencyKey,
    packageId: row.packageId,
    version: row.version,
    userRef: row.userRef,
    userRefType: row.userRefType,
    osType: row.osType as TelemetryRecord['osType'],
    clientRuntime: row.clientRuntime,
    status: row.status,
    errorCode: row.errorCode as TelemetryRecord['errorCode'],
    startedAt: row.startedAt,
    endedAt: row.endedAt ?? row.startedAt,
    payloadFingerprint: row.payloadFingerprint,
    receivedAt: row.createdAt
  };
}

export class PostgresAnalyticsRepository implements AnalyticsRepository {
  constructor(private readonly database: AnalyticsDatabase) {}

  async findPackageMetadata(packageId: string): Promise<PackageAnalyticsMetadata> {
    const [packageRows, versionRows] = await Promise.all([
      this.database
        .select()
        .from(schema.packages)
        .where(eq(schema.packages.packageId, packageId))
        .limit(1),
      this.database
        .select()
        .from(schema.packageVersions)
        .where(eq(schema.packageVersions.packageId, packageId))
    ]);

    return {
      package: packageRows[0] ? mapPackage(packageRows[0]) : undefined,
      versions: versionRows.map(mapVersion)
    };
  }

  async findPackageTelemetry(
    packageId: string,
    period: AnalyticsPeriod
  ): Promise<TelemetryRecord[]> {
    const telemetryRows = await this.database
      .select()
      .from(schema.installations)
      .where(and(
        eq(schema.installations.packageId, packageId),
        gte(schema.installations.startedAt, period.start),
        lte(schema.installations.startedAt, period.end)
      ))
      .orderBy(
        schema.installations.startedAt,
        schema.installations.endedAt,
        schema.installations.createdAt,
        schema.installations.id
      );
    return telemetryRows.map(mapTelemetry);
  }

  async findUserDataset(uid: string): Promise<UserAnalyticsDataset> {
    const telemetryRows = await this.database
      .select()
      .from(schema.installations)
      .where(and(
        eq(schema.installations.userRefType, 'uid'),
        eq(schema.installations.userRef, uid)
      ))
      .orderBy(schema.installations.createdAt, schema.installations.id);
    const packageIds = [...new Set(telemetryRows.map((row) => row.packageId))];
    if (packageIds.length === 0) {
      return { packages: [], versions: [], telemetry: [] };
    }
    const [packageRows, versionRows] = await Promise.all([
      this.database
        .select()
        .from(schema.packages)
        .where(inArray(schema.packages.packageId, packageIds)),
      this.database
        .select()
        .from(schema.packageVersions)
        .where(inArray(schema.packageVersions.packageId, packageIds))
    ]);

    return {
      packages: packageRows.map(mapPackage),
      versions: versionRows.map(mapVersion),
      telemetry: telemetryRows.map(mapTelemetry)
    };
  }
}
