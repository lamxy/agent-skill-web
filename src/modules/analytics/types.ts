// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import type { PackageRecord, PackageVersionRecord } from '../catalog/types.js';
import type { TelemetryRecord } from '../telemetry/types.js';

export interface AnalyticsPeriod {
  start: Date;
  end: Date;
}

export interface PackageAnalyticsDataset {
  package: PackageRecord | undefined;
  versions: PackageVersionRecord[];
  telemetry: TelemetryRecord[];
}

export type PackageAnalyticsMetadata = Omit<PackageAnalyticsDataset, 'telemetry'>;

export interface UserAnalyticsDataset {
  packages: PackageRecord[];
  versions: PackageVersionRecord[];
  telemetry: TelemetryRecord[];
}

export interface WilsonScoreInterval {
  lower: number;
  upper: number;
}

export interface FunnelMetrics {
  downloads: number;
  installs: number;
  uninstalls: number;
  downloadToInstall: number | null;
  installToUninstall: number | null;
}

export interface SuccessRateMetrics {
  successes: number;
  total: number;
  rate: number | null;
  confidenceInterval: WilsonScoreInterval | null;
}

export interface FailureCell {
  version: string;
  osType: TelemetryRecord['osType'];
  errorCode: string;
  count: number;
}

export interface FailureDistribution {
  byVersion: Array<{ version: string; count: number }>;
  byOs: Array<{ osType: TelemetryRecord['osType']; count: number }>;
  byErrorCode: Array<{ errorCode: string; count: number }>;
  heatmap: FailureCell[];
}

export interface TimeDistributionMetrics {
  sampleSize: number;
  medianMilliseconds: number | null;
  p90Milliseconds: number | null;
  p95Milliseconds: number | null;
}

export interface TimeToRunnableMetrics {
  platform: TimeDistributionMetrics;
  employee: TimeDistributionMetrics & { approximate: true };
}

export interface VersionDistributionItem {
  version: string;
  installations: number;
}

export interface UpgradeCandidate {
  uid: string;
  currentVersion: string;
  availableVersion: string;
}

export interface AnalyticsDataGap {
  code: 'MISSING_DOWNLOAD_EVENTS';
  missingCount: number;
  message: string;
}

export interface PackageAnalyticsReport {
  packageId: string;
  period: AnalyticsPeriod;
  funnel: FunnelMetrics;
  successRates: {
    uid: SuccessRateMetrics;
    uuid: SuccessRateMetrics;
  };
  failureCells: FailureCell[];
  failureDistribution: FailureDistribution;
  timeToRunnable: TimeToRunnableMetrics;
  versionDistribution: VersionDistributionItem[];
  upgradeCandidates: UpgradeCandidate[];
  telemetryAssurance: 'best-effort';
  dataNotice: '數據僅供參考';
  dataGaps: AnalyticsDataGap[];
}

export interface MyInstallation {
  packageId: string;
  packageName: string;
  currentVersion: string;
  status: 'installed';
  availableVersion: string;
  upgradeAvailable: boolean;
}
