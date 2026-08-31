// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import type { AuthorizationService } from '../identity/authorization-service.js';
import type { ResolvedIdentity } from '../identity/types.js';
import type { TelemetryRecord } from '../telemetry/types.js';
import { AppError } from '../../shared/errors/app-error.js';
import {
  compareNatural,
  compareSemanticVersions,
  compareText
} from '../../shared/version/semantic-version.js';
import type { AnalyticsRepository } from './repository.js';
import type {
  AnalyticsPeriod,
  FailureCell,
  FailureDistribution,
  MyInstallation,
  PackageAnalyticsDataset,
  PackageAnalyticsMetadata,
  PackageAnalyticsReport,
  SuccessRateMetrics,
  TimeDistributionMetrics,
  TimeToRunnableMetrics,
  UpgradeCandidate,
  VersionDistributionItem,
  WilsonScoreInterval
} from './types.js';

export { compareSemanticVersions };

const z95 = 1.959963984540054;

export function wilsonScoreInterval(
  successes: number,
  total: number
): WilsonScoreInterval | null {
  if (total === 0) return null;
  const p = successes / total;
  const denominator = 1 + (z95 * z95) / total;
  const center = (p + (z95 * z95) / (2 * total)) / denominator;
  const margin =
    z95 *
    Math.sqrt((p * (1 - p) + (z95 * z95) / (4 * total)) / total) /
    denominator;
  return { lower: center - margin, upper: center + margin };
}


function latestPublishedVersionRecord(
  dataset: PackageAnalyticsDataset
): PackageAnalyticsDataset['versions'][number] | undefined {
  return dataset.versions
    .filter((item) => item.lifecycle === 'published')
    .sort((left, right) =>
      compareSemanticVersions(left.version, right.version) ||
      compareText(left.version, right.version) ||
      compareText(left.id, right.id)
    )
    .at(-1);
}

function latestPublishedVersion(dataset: PackageAnalyticsDataset): string | undefined {
  return latestPublishedVersionRecord(dataset)?.version;
}

function calculateSuccessRate(records: TelemetryRecord[]): SuccessRateMetrics {
  const terminal = records.filter(
    (record) => record.status === 'succeeded' || record.status === 'failed'
  );
  const successes = terminal.filter((record) => record.status === 'succeeded').length;
  const total = terminal.length;
  return {
    successes,
    total,
    rate: total === 0 ? null : successes / total,
    confidenceInterval: wilsonScoreInterval(successes, total)
  };
}

function failureDistribution(records: TelemetryRecord[]): FailureDistribution {
  const cells = new Map<string, FailureCell>();
  const versions = new Map<string, number>();
  const operatingSystems = new Map<TelemetryRecord['osType'], number>();
  const errorCodes = new Map<string, number>();
  for (const record of records) {
    if (record.status !== 'failed') continue;
    const errorCode = record.errorCode ?? 'E999';
    versions.set(record.version, (versions.get(record.version) ?? 0) + 1);
    operatingSystems.set(record.osType, (operatingSystems.get(record.osType) ?? 0) + 1);
    errorCodes.set(errorCode, (errorCodes.get(errorCode) ?? 0) + 1);
    const key = `${record.version}\u0000${record.osType}\u0000${errorCode}`;
    const existing = cells.get(key);
    if (existing) existing.count += 1;
    else cells.set(key, { version: record.version, osType: record.osType, errorCode, count: 1 });
  }
  return {
    byVersion: [...versions.entries()]
      .map(([version, count]) => ({ version, count }))
      .sort((left, right) => compareSemanticVersions(left.version, right.version)),
    byOs: [...operatingSystems.entries()]
      .map(([osType, count]) => ({ osType, count }))
      .sort((left, right) => compareText(left.osType, right.osType)),
    byErrorCode: [...errorCodes.entries()]
      .map(([errorCode, count]) => ({ errorCode, count }))
      .sort((left, right) => compareNatural(left.errorCode, right.errorCode)),
    heatmap: [...cells.values()].sort((left, right) =>
      compareSemanticVersions(left.version, right.version) ||
      compareText(left.osType, right.osType) ||
      compareNatural(left.errorCode, right.errorCode)
    )
  };
}

function nearestRank(sortedValues: number[], percentile: number): number {
  const rank = Math.max(1, Math.ceil(percentile * sortedValues.length));
  return sortedValues[rank - 1] as number;
}

function timeDistribution(durations: number[]): TimeDistributionMetrics {
  const sortedDurations = [...durations].sort((left, right) => left - right);
  if (sortedDurations.length === 0) {
    return {
      sampleSize: 0,
      medianMilliseconds: null,
      p90Milliseconds: null,
      p95Milliseconds: null
    };
  }
  return {
    sampleSize: sortedDurations.length,
    medianMilliseconds: nearestRank(sortedDurations, 0.5),
    p90Milliseconds: nearestRank(sortedDurations, 0.9),
    p95Milliseconds: nearestRank(sortedDurations, 0.95)
  };
}

function installationVersionKey(record: TelemetryRecord): string {
  return `${record.packageId}\u0000${record.userRefType}\u0000${record.userRef}\u0000${record.version}`;
}

function timeToRunnable(records: TelemetryRecord[]): TimeToRunnableMetrics {
  const groups = new Map<string, { downloads: TelemetryRecord[]; successes: TelemetryRecord[] }>();
  const platformDurations: number[] = [];
  for (const record of records) {
    if (record.status !== 'downloaded' && record.status !== 'succeeded') continue;
    const group = groups.get(installationVersionKey(record)) ?? { downloads: [], successes: [] };
    if (record.status === 'downloaded') group.downloads.push(record);
    else {
      group.successes.push(record);
      platformDurations.push(Math.max(0, record.endedAt.getTime() - record.startedAt.getTime()));
    }
    groups.set(installationVersionKey(record), group);
  }
  const employeeDurations: number[] = [];
  for (const group of groups.values()) {
    group.downloads.sort((left, right) => left.startedAt.getTime() - right.startedAt.getTime());
    for (const success of group.successes) {
      let lower = 0;
      let upper = group.downloads.length;
      while (lower < upper) {
        const middle = Math.floor((lower + upper) / 2);
        const candidate = group.downloads[middle] as TelemetryRecord;
        if (candidate.startedAt <= success.startedAt) lower = middle + 1;
        else upper = middle;
      }
      const download = group.downloads[lower - 1];
      if (download) {
        employeeDurations.push(
          Math.max(0, success.endedAt.getTime() - download.startedAt.getTime())
        );
      }
    }
  }
  return {
    platform: timeDistribution(platformDurations),
    employee: {
      ...timeDistribution(employeeDurations),
      approximate: true
    }
  };
}

interface CurrentInstallation {
  userRef: string;
  userRefType: 'uid' | 'uuid';
  packageId: string;
  version: string;
  osType: TelemetryRecord['osType'];
  clientRuntime: string;
}

function foldCurrentInstallations(records: TelemetryRecord[]): CurrentInstallation[] {
  const current = new Map<string, CurrentInstallation>();
  const chronological = [...records].sort(
    (left, right) =>
      left.startedAt.getTime() - right.startedAt.getTime() ||
      left.endedAt.getTime() - right.endedAt.getTime() ||
      left.receivedAt.getTime() - right.receivedAt.getTime() ||
      compareText(left.id, right.id)
  );
  for (const record of chronological) {
    const key = `${record.userRefType}\u0000${record.userRef}\u0000${record.packageId}`;
    if (record.status === 'succeeded') {
      current.set(key, {
        userRef: record.userRef,
        userRefType: record.userRefType,
        packageId: record.packageId,
        version: record.version,
        osType: record.osType,
        clientRuntime: record.clientRuntime
      });
    } else if (record.status === 'uninstalled') {
      current.delete(key);
    }
  }
  return [...current.values()];
}

function versionDistribution(current: CurrentInstallation[]): VersionDistributionItem[] {
  const counts = new Map<string, number>();
  for (const installation of current) {
    counts.set(installation.version, (counts.get(installation.version) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([version, installations]) => ({ version, installations }))
    .sort((left, right) => compareSemanticVersions(left.version, right.version));
}

function upgradeCandidates(
  current: CurrentInstallation[],
  available: PackageAnalyticsDataset['versions'][number] | undefined
): UpgradeCandidate[] {
  if (!available) return [];
  return current
    .filter(
      (installation) =>
        installation.userRefType === 'uid' &&
        compareSemanticVersions(installation.version, available.version) < 0 &&
        available.supportedOs.includes(installation.osType) &&
        available.supportedClients.some(
          (client) => client.name === installation.clientRuntime
        )
    )
    .map((installation) => ({
      uid: installation.userRef,
      currentVersion: installation.version,
      availableVersion: available.version
    }))
    .sort((left, right) => left.uid.localeCompare(right.uid));
}

export class AnalyticsService {
  constructor(
    private readonly repository: AnalyticsRepository,
    private readonly authorization: AuthorizationService
  ) {}

  async getPackageAnalytics(
    packageId: string,
    period: AnalyticsPeriod,
    identity: ResolvedIdentity
  ): Promise<PackageAnalyticsReport> {
    if (identity.kind !== 'authenticated') {
      throw new AppError({
        statusCode: 401,
        code: 'AUTHENTICATION_REQUIRED',
        message: '請先登入'
      });
    }
    const metadata = await this.repository.findPackageMetadata(packageId);
    if (!metadata.package) {
      throw new AppError({ statusCode: 404, code: 'PACKAGE_NOT_FOUND', message: '找不到套件' });
    }
    await this.requireAnalyticsAccess(identity, metadata);
    const dataset: PackageAnalyticsDataset = {
      ...metadata,
      telemetry: await this.repository.findPackageTelemetry(packageId, period)
    };

    const downloads = dataset.telemetry.filter((record) => record.status === 'downloaded').length;
    const installs = dataset.telemetry.filter((record) => record.status === 'succeeded').length;
    const uninstalls = dataset.telemetry.filter((record) => record.status === 'uninstalled').length;
    const terminalCount = dataset.telemetry.filter(
      (record) => record.status === 'succeeded' || record.status === 'failed'
    ).length;
    const missingDownloads = Math.max(0, terminalCount - downloads);
    const current = foldCurrentInstallations(dataset.telemetry);
    const availableVersion = latestPublishedVersionRecord(dataset);
    const failures = failureDistribution(dataset.telemetry);

    return {
      packageId,
      period: { start: new Date(period.start), end: new Date(period.end) },
      funnel: {
        downloads,
        installs,
        uninstalls,
        downloadToInstall: downloads === 0 ? null : installs / downloads,
        installToUninstall: installs === 0 ? null : uninstalls / installs
      },
      successRates: {
        uid: calculateSuccessRate(dataset.telemetry.filter((record) => record.userRefType === 'uid')),
        uuid: calculateSuccessRate(dataset.telemetry.filter((record) => record.userRefType === 'uuid'))
      },
      failureCells: failures.heatmap,
      failureDistribution: failures,
      timeToRunnable: timeToRunnable(dataset.telemetry),
      versionDistribution: versionDistribution(current),
      upgradeCandidates: upgradeCandidates(current, availableVersion),
      telemetryAssurance: 'best-effort',
      dataNotice: '數據僅供參考',
      dataGaps: missingDownloads === 0
        ? []
        : [{
            code: 'MISSING_DOWNLOAD_EVENTS',
            missingCount: missingDownloads,
            message: `終態事件比下載事件多 ${missingDownloads} 筆`
          }]
    };
  }

  async getMyInstallations(identity: ResolvedIdentity): Promise<MyInstallation[]> {
    if (identity.kind !== 'authenticated') {
      throw new AppError({
        statusCode: 401,
        code: 'AUTHENTICATION_REQUIRED',
        message: '請先登入'
      });
    }
    const dataset = await this.repository.findUserDataset(identity.uid);
    const current = foldCurrentInstallations(dataset.telemetry);
    const packages = new Map(dataset.packages.map((item) => [item.packageId, item]));
    const versionsByPackage = new Map<string, PackageAnalyticsDataset['versions']>();
    for (const item of dataset.versions) {
      const versions = versionsByPackage.get(item.packageId) ?? [];
      versions.push(item);
      versionsByPackage.set(item.packageId, versions);
    }
    return current.flatMap((installation) => {
      const packageRecord = packages.get(installation.packageId);
      if (!packageRecord) return [];
      const availableVersion = latestPublishedVersion({
        package: packageRecord,
        versions: versionsByPackage.get(installation.packageId) ?? [],
        telemetry: []
      }) ?? installation.version;
      return [{
        packageId: installation.packageId,
        packageName: packageRecord.name,
        currentVersion: installation.version,
        status: 'installed' as const,
        availableVersion,
        upgradeAvailable: compareSemanticVersions(installation.version, availableVersion) < 0
      }];
    }).sort((left, right) => left.packageName.localeCompare(right.packageName));
  }

  private async requireAnalyticsAccess(
    identity: ResolvedIdentity,
    dataset: PackageAnalyticsMetadata
  ): Promise<void> {
    if (identity.kind !== 'authenticated') {
      throw new AppError({
        statusCode: 401,
        code: 'AUTHENTICATION_REQUIRED',
        message: '請先登入'
      });
    }
    const isAuthor = dataset.versions.some((version) => version.authorUid === identity.uid);
    const isAdmin = await this.authorization.hasRole(identity.uid, 'platform_admin', { type: 'global' });
    const ownerTeam = dataset.package?.ownerTeam;
    const isOwnerMaintainer =
      ownerTeam !== undefined &&
      identity.teamIds.includes(ownerTeam) &&
      await this.authorization.hasRole(identity.uid, 'maintainer', {
        type: 'team',
        value: ownerTeam
      });
    if (!isAuthor && !isAdmin && !isOwnerMaintainer) {
      throw new AppError({ statusCode: 403, code: 'FORBIDDEN', message: '沒有查看套件分析的權限' });
    }
  }
}
