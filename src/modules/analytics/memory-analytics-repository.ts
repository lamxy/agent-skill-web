// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import type { MemoryPlatformStore } from '../catalog/memory-platform-store.js';
import type { AnalyticsRepository } from './repository.js';
import type {
  AnalyticsPeriod,
  PackageAnalyticsMetadata,
  UserAnalyticsDataset
} from './types.js';
import type { TelemetryRecord } from '../telemetry/types.js';

export class MemoryAnalyticsRepository implements AnalyticsRepository {
  constructor(private readonly store: MemoryPlatformStore) {}

  async findPackageMetadata(packageId: string): Promise<PackageAnalyticsMetadata> {
    const state = this.store.snapshot();
    return {
      package: state.packages[packageId],
      versions: Object.values(state.versions).filter(
        (item) => item.packageId === packageId
      )
    };
  }

  async findPackageTelemetry(
    packageId: string,
    period: AnalyticsPeriod
  ): Promise<TelemetryRecord[]> {
    const state = this.store.snapshot();
    return state.telemetryRecords.filter(
      (record) =>
        record.packageId === packageId &&
        record.startedAt >= period.start &&
        record.startedAt <= period.end
    );
  }

  async findUserDataset(uid: string): Promise<UserAnalyticsDataset> {
    const state = this.store.snapshot();
    return {
      packages: Object.values(state.packages),
      versions: Object.values(state.versions),
      telemetry: state.telemetryRecords.filter(
        (record) => record.userRefType === 'uid' && record.userRef === uid
      )
    };
  }
}
