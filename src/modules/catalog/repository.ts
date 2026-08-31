// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import type {
  CatalogAggregate,
  CopyScriptTargetRevisionInput,
  ResolvedCreatePackageInput,
  CreatePackageVersionInput,
  CreateScriptTargetInput,
  PackageRecord,
  PackageVersionRecord,
  SaveScriptTargetRevisionInput,
  ScriptTargetRecord,
  SetPackageGradeInput,
  UpdatePackageInput,
  UpdatePackageVersionInput
} from './types.js';

export interface CatalogRepository {
  listAggregates(): Promise<CatalogAggregate[]>;
  findAggregate(packageId: string): Promise<CatalogAggregate | undefined>;
  createPackage(
    actorUid: string,
    input: ResolvedCreatePackageInput,
    occurredAt: Date
  ): Promise<PackageRecord>;
  updatePackage(
    actorUid: string,
    packageId: string,
    input: UpdatePackageInput,
    occurredAt: Date
  ): Promise<PackageRecord | undefined>;
  setPackageGrade(
    actorUid: string,
    packageId: string,
    input: SetPackageGradeInput,
    occurredAt: Date
  ): Promise<PackageRecord | undefined>;
  archivePackage(
    actorUid: string,
    packageId: string,
    occurredAt: Date
  ): Promise<PackageRecord | undefined>;
  createVersion(
    actorUid: string,
    packageId: string,
    input: CreatePackageVersionInput,
    occurredAt: Date
  ): Promise<PackageVersionRecord>;
  updateVersion(
    actorUid: string,
    packageId: string,
    version: string,
    input: UpdatePackageVersionInput,
    occurredAt: Date
  ): Promise<PackageVersionRecord | undefined>;
  findScriptTarget(
    packageId: string,
    version: string,
    targetId: string,
    includeDeleted?: boolean
  ): Promise<ScriptTargetRecord | undefined>;
  createScriptTarget(
    actorUid: string,
    packageId: string,
    version: string,
    input: CreateScriptTargetInput,
    occurredAt: Date
  ): Promise<ScriptTargetRecord>;
  saveScriptTargetRevision(
    actorUid: string,
    packageId: string,
    version: string,
    targetId: string,
    input: SaveScriptTargetRevisionInput,
    occurredAt: Date
  ): Promise<ScriptTargetRecord>;
  copyScriptTargetRevision(
    actorUid: string,
    packageId: string,
    version: string,
    targetId: string,
    input: CopyScriptTargetRevisionInput,
    occurredAt: Date
  ): Promise<ScriptTargetRecord>;
  softDeleteScriptTarget(
    actorUid: string,
    packageId: string,
    version: string,
    targetId: string,
    expectedScriptVersion: number,
    occurredAt: Date
  ): Promise<ScriptTargetRecord>;
}
