// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import type {
  GovernanceAuditLog,
  GovernanceDomainEvent,
  InstallationSnapshot,
  PublicationReview,
  UserNotification,
  ValidationRun,
  VersionDelisting
} from '../governance/repository.js';
import type { PackageRecord, PackageVersionRecord } from './types.js';
import type { TelemetryRecord } from '../telemetry/types.js';

export interface MemoryPlatformState {
  packages: Record<string, PackageRecord>;
  versions: Record<string, PackageVersionRecord>;
  adoption: Record<string, { installations: number; succeeded: number }>;
  validationRuns: ValidationRun[];
  reviews: PublicationReview[];
  delistings: VersionDelisting[];
  notifications: UserNotification[];
  installations: InstallationSnapshot[];
  telemetryRecords: TelemetryRecord[];
  auditLogs: GovernanceAuditLog[];
  domainEvents: GovernanceDomainEvent[];
}

export function memoryVersionKey(packageId: string, version: string): string {
  return `${packageId}\u0000${version}`;
}

export class MemoryPlatformStore {
  private state: MemoryPlatformState;

  constructor(seed: Partial<MemoryPlatformState> = {}) {
    this.state = structuredClone({
      packages: seed.packages ?? {},
      versions: seed.versions ?? {},
      adoption: seed.adoption ?? {},
      validationRuns: seed.validationRuns ?? [],
      reviews: seed.reviews ?? [],
      delistings: seed.delistings ?? [],
      notifications: seed.notifications ?? [],
      installations: seed.installations ?? [],
      telemetryRecords: seed.telemetryRecords ?? [],
      auditLogs: seed.auditLogs ?? [],
      domainEvents: seed.domainEvents ?? []
    });
  }

  snapshot(): MemoryPlatformState {
    return structuredClone(this.state);
  }

  replace(next: MemoryPlatformState): void {
    this.state = structuredClone(next);
  }
}
