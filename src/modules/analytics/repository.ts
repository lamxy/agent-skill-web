// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import type {
  AnalyticsPeriod,
  PackageAnalyticsMetadata,
  UserAnalyticsDataset
} from './types.js';
import type { TelemetryRecord } from '../telemetry/types.js';

export interface AnalyticsRepository {
  findPackageMetadata(packageId: string): Promise<PackageAnalyticsMetadata>;

  findPackageTelemetry(
    packageId: string,
    period: AnalyticsPeriod
  ): Promise<TelemetryRecord[]>;

  findUserDataset(uid: string): Promise<UserAnalyticsDataset>;
}
