// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { randomUUID } from 'node:crypto';

import type { CatalogRepository } from './repository.js';
import { AppError } from '../../shared/errors/app-error.js';
import {
  MemoryPlatformStore,
  memoryVersionKey
} from './memory-platform-store.js';
import { deriveSupportFromTargets } from './script-target-support.js';
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
import {
  copyRevision,
  createInitialRevision,
  createNextRevision
} from './script-target-model.js';

interface MemoryCatalogState {
  /**
   * Task 17 的分類標籤欄位在此可以省略。資料庫對它們都有 DEFAULT，
   * 測試 fixture 同樣不該為了無關的欄位而全部改寫。
   */
  packages?: Array<
    Omit<
      PackageRecord,
      'categoryCode' | 'source' | 'publisher' | 'grade'
    > &
      Partial<
        Pick<PackageRecord, 'categoryCode' | 'source' | 'publisher' | 'grade'>
      >
  >;
  versions?: PackageVersionRecord[];
  adoption?: Record<string, { installations: number; succeeded: number }>;
}

/** 補上 Task 17 欄位的預設值，與 0014 migration 的 DEFAULT 一致 */
function withTaxonomyDefaults(
  record: NonNullable<MemoryCatalogState['packages']>[number]
): PackageRecord {
  return {
    ...record,
    categoryCode: record.categoryCode ?? 'general',
    source: record.source ?? 'custom',
    publisher: record.publisher ?? { kind: 'organization', name: '' },
    grade: record.grade ?? 'basic'
  };
}

function cloneVersion(version: PackageVersionRecord): PackageVersionRecord {
  // 與 Postgres 實作一致：有 target 時由 target 導出可安裝目標，
  // 沒有 target 的舊資料才回退到版本層級的宣告欄位。
  const derived = deriveSupportFromTargets(
    version.scriptTargets ?? [],
    version.supportedClients
  );
  return {
    ...version,
    supportedOs: derived ? derived.supportedOs : [...version.supportedOs],
    supportedClients: derived
      ? derived.supportedClients
      : version.supportedClients.map((client) => ({ ...client })),
    ...(version.scriptTargets
      ? { scriptTargets: version.scriptTargets.map(cloneTarget) }
      : {}),
    createdAt: new Date(version.createdAt),
    updatedAt: new Date(version.updatedAt)
  };
}

function cloneTarget(target: ScriptTargetRecord): ScriptTargetRecord {
  const cloneRevision = (revision: NonNullable<ScriptTargetRecord['currentRevision']>) => ({
    ...revision,
    options: revision.options.map((option) => ({
      ...option,
      ...(option.choices ? { choices: [...option.choices] } : {})
    })),
    ...(revision.copiedFrom ? { copiedFrom: { ...revision.copiedFrom } } : {}),
    createdAt: new Date(revision.createdAt)
  });
  return {
    ...target,
    ...(target.currentRevision ? { currentRevision: cloneRevision(target.currentRevision) } : {}),
    revisions: target.revisions.map(cloneRevision),
    ...(target.deletedAt ? { deletedAt: new Date(target.deletedAt) } : {}),
    createdAt: new Date(target.createdAt),
    updatedAt: new Date(target.updatedAt)
  };
}

function cloneAggregate(aggregate: CatalogAggregate): CatalogAggregate {
  return {
    package: {
      ...aggregate.package,
      // publisher 是巢狀物件；此處展開只做淺拷貝，需要單獨複製。
      publisher: { ...aggregate.package.publisher },
      createdAt: new Date(aggregate.package.createdAt),
      updatedAt: new Date(aggregate.package.updatedAt)
    },
    versions: aggregate.versions.map(cloneVersion),
    adoption: { ...aggregate.adoption }
  };
}

export class MemoryCatalogRepository implements CatalogRepository {
  readonly store: MemoryPlatformStore;
  private readonly scriptTargets = new Map<string, ScriptTargetRecord>();

  constructor(
    state: MemoryCatalogState = {},
    store: MemoryPlatformStore = new MemoryPlatformStore()
  ) {
    this.store = store;
    const next = store.snapshot();
    for (const packageRecord of state.packages ?? []) {
      next.packages[packageRecord.packageId] = withTaxonomyDefaults(packageRecord);
      next.adoption[packageRecord.packageId] = {
        installations: state.adoption?.[packageRecord.packageId]?.installations ?? 0,
        succeeded: state.adoption?.[packageRecord.packageId]?.succeeded ?? 0
      };
    }
    for (const version of state.versions ?? []) {
      if (next.packages[version.packageId]) {
        next.versions[memoryVersionKey(version.packageId, version.version)] =
          cloneVersion(version);
        for (const target of version.scriptTargets ?? []) {
          this.scriptTargets.set(target.id, cloneTarget(target));
        }
      }
    }
    store.replace(next);
  }

  async listAggregates(): Promise<CatalogAggregate[]> {
    const state = this.store.snapshot();
    return Object.values(state.packages).map((packageRecord) =>
      cloneAggregate(this.aggregateFromState(state, packageRecord))
    );
  }

  async findAggregate(packageId: string): Promise<CatalogAggregate | undefined> {
    const state = this.store.snapshot();
    const packageRecord = state.packages[packageId];
    return packageRecord
      ? cloneAggregate(this.aggregateFromState(state, packageRecord))
      : undefined;
  }

  async createPackage(
    actorUid: string,
    input: ResolvedCreatePackageInput,
    occurredAt: Date
  ): Promise<PackageRecord> {
    const record: PackageRecord = {
      ...input,
      // 分級不由建立者決定，一律從預設值開始，等待審核人核定。
      grade: 'basic',
      createdByUid: actorUid,
      lifecycle: 'active',
      createdAt: occurredAt,
      updatedAt: occurredAt
    };
    const next = this.store.snapshot();
    next.packages[record.packageId] = record;
    next.adoption[record.packageId] = { installations: 0, succeeded: 0 };
    this.store.replace(next);
    return { ...record };
  }

  async updatePackage(
    _actorUid: string,
    packageId: string,
    input: UpdatePackageInput,
    occurredAt: Date
  ): Promise<PackageRecord | undefined> {
    const next = this.store.snapshot();
    const current = next.packages[packageId];
    if (!current) return undefined;
    const updated = { ...current, ...input, updatedAt: occurredAt };
    next.packages[packageId] = updated;
    this.store.replace(next);
    return { ...updated };
  }

  async setPackageGrade(
    actorUid: string,
    packageId: string,
    input: SetPackageGradeInput,
    occurredAt: Date
  ): Promise<PackageRecord | undefined> {
    const next = this.store.snapshot();
    const current = next.packages[packageId];
    if (!current) return undefined;
    const updated: PackageRecord = {
      ...current,
      grade: input.grade,
      gradeDecidedByUid: actorUid,
      gradeDecidedAt: occurredAt,
      updatedAt: occurredAt
    };
    next.packages[packageId] = updated;
    this.store.replace(next);
    return { ...updated, publisher: { ...updated.publisher } };
  }

  async archivePackage(
    actorUid: string,
    packageId: string,
    occurredAt: Date
  ): Promise<PackageRecord | undefined> {
    return this.updatePackage(actorUid, packageId, {}, occurredAt).then((record) => {
      if (!record) return undefined;
      const next = this.store.snapshot();
      const current = next.packages[packageId]!;
      next.packages[packageId] = { ...current, lifecycle: 'archived' };
      this.store.replace(next);
      return { ...next.packages[packageId]! };
    });
  }

  async createVersion(
    actorUid: string,
    packageId: string,
    input: CreatePackageVersionInput,
    occurredAt: Date
  ): Promise<PackageVersionRecord> {
    const next = this.store.snapshot();
    if (!next.packages[packageId]) throw new Error('套件不存在');
    const record: PackageVersionRecord = {
      version: input.version,
      ...(input.releaseNotes ? { releaseNotes: input.releaseNotes } : {}),
      supportedOs: [],
      supportedClients: [],
      installCommand: '',
      uninstallCommand: '',
      hasResidualEffects: false,
      scriptTargets: [],
      id: String(Object.keys(next.versions).length + 1),
      packageId,
      lifecycle: 'draft',
      authorUid: actorUid,
      createdAt: occurredAt,
      updatedAt: occurredAt
    };
    next.versions[memoryVersionKey(packageId, input.version)] = cloneVersion(record);
    this.store.replace(next);
    return cloneVersion(record);
  }

  async updateVersion(
    _actorUid: string,
    packageId: string,
    version: string,
    input: UpdatePackageVersionInput,
    occurredAt: Date
  ): Promise<PackageVersionRecord | undefined> {
    if (Object.hasOwn(input as object, 'lifecycle')) {
      throw new AppError({ statusCode: 400, code: 'LIFECYCLE_MANAGED_BY_GOVERNANCE', message: '版本生命週期只能由發布治理流程變更' });
    }
    const next = this.store.snapshot();
    const key = memoryVersionKey(packageId, version);
    const current = next.versions[key];
    if (!current) return undefined;
    const updated = { ...current, ...input, updatedAt: occurredAt };
    next.versions[key] = cloneVersion(updated);
    this.store.replace(next);
    return cloneVersion(updated);
  }

  async findScriptTarget(
    packageId: string,
    version: string,
    targetId: string,
    includeDeleted = false
  ): Promise<ScriptTargetRecord | undefined> {
    const target = this.scriptTargets.get(targetId);
    if (
      !target ||
      target.packageId !== packageId ||
      target.packageVersion !== version ||
      (target.deletedAt && !includeDeleted)
    ) return undefined;
    return cloneTarget(target);
  }

  async createScriptTarget(
    actorUid: string,
    packageId: string,
    version: string,
    input: CreateScriptTargetInput,
    occurredAt: Date
  ): Promise<ScriptTargetRecord> {
    this.requireDraftVersion(packageId, version);
    const existing = [...this.scriptTargets.values()].find((target) =>
      target.packageId === packageId &&
      target.packageVersion === version &&
      target.targetOs === input.targetOs &&
      target.clientRuntime === input.clientRuntime
    );
    if (existing && !existing.deletedAt) {
      throw new AppError({
        statusCode: 409,
        code: 'SCRIPT_TARGET_ALREADY_EXISTS',
        message: '此系統與 Client 組合已存在'
      });
    }
    const record: ScriptTargetRecord = existing
      ? (({ currentRevision: _current, deletedAt: _deletedAt, deletedByUid: _deletedBy, ...rest }) => ({
          ...rest,
          updatedAt: occurredAt
        }))(existing)
      : {
          id: randomUUID(),
          packageId,
          packageVersion: version,
          targetOs: input.targetOs,
          clientRuntime: input.clientRuntime,
          revisions: [],
          createdAt: occurredAt,
          updatedAt: occurredAt
        };
    this.scriptTargets.set(record.id, cloneTarget(record));
    this.syncVersionTargets(packageId, version);
    this.appendTargetEvent(
      actorUid,
      record,
      existing ? 'script_target.restored' : 'script_target.created',
      occurredAt,
      { targetOs: input.targetOs, clientRuntime: input.clientRuntime }
    );
    return cloneTarget(record);
  }

  async saveScriptTargetRevision(
    actorUid: string,
    packageId: string,
    version: string,
    targetId: string,
    input: SaveScriptTargetRevisionInput,
    occurredAt: Date
  ): Promise<ScriptTargetRecord> {
    this.requireDraftVersion(packageId, version);
    const current = this.requireActiveTarget(packageId, version, targetId);
    const last = current.revisions.at(-1);
    if (input.expectedScriptVersion !== (last?.scriptVersion ?? 0)) {
      throw this.revisionConflict();
    }
    const { expectedScriptVersion: _, ...content } = input;
    const revision = last
      ? createNextRevision(last, content, actorUid, occurredAt)
      : createInitialRevision(current, content, actorUid, occurredAt);
    const updated: ScriptTargetRecord = {
      ...current,
      currentRevision: revision,
      revisions: [...current.revisions, revision],
      updatedAt: occurredAt
    };
    this.scriptTargets.set(targetId, cloneTarget(updated));
    this.syncVersionTargets(packageId, version);
    this.appendTargetEvent(actorUid, updated, 'script_target.revision_saved', occurredAt, {
      scriptVersion: revision.scriptVersion
    });
    return cloneTarget(updated);
  }

  async copyScriptTargetRevision(
    actorUid: string,
    packageId: string,
    version: string,
    targetId: string,
    input: CopyScriptTargetRevisionInput,
    occurredAt: Date
  ): Promise<ScriptTargetRecord> {
    this.requireDraftVersion(packageId, version);
    const destination = this.requireActiveTarget(packageId, version, targetId);
    const source = this.requireActiveTarget(packageId, version, input.sourceTargetId);
    if (source.id === destination.id || !source.currentRevision) {
      throw new AppError({ statusCode: 404, code: 'SCRIPT_TARGET_NOT_FOUND', message: '找不到可複製的腳本目標' });
    }
    const actualVersion = destination.revisions.at(-1)?.scriptVersion ?? 0;
    if (input.expectedScriptVersion !== actualVersion) throw this.revisionConflict();
    const revision = copyRevision(
      source.currentRevision,
      destination,
      actorUid,
      occurredAt,
      actualVersion + 1,
      input.changeDescription
    );
    const updated: ScriptTargetRecord = {
      ...destination,
      currentRevision: revision,
      revisions: [...destination.revisions, revision],
      updatedAt: occurredAt
    };
    this.scriptTargets.set(targetId, cloneTarget(updated));
    this.syncVersionTargets(packageId, version);
    this.appendTargetEvent(actorUid, updated, 'script_target.revision_copied', occurredAt, {
      scriptVersion: revision.scriptVersion,
      sourceTargetId: source.id,
      sourceScriptVersion: source.currentRevision.scriptVersion
    });
    return cloneTarget(updated);
  }

  async softDeleteScriptTarget(
    actorUid: string,
    packageId: string,
    version: string,
    targetId: string,
    expectedScriptVersion: number,
    occurredAt: Date
  ): Promise<ScriptTargetRecord> {
    this.requireDraftVersion(packageId, version);
    const current = this.requireActiveTarget(packageId, version, targetId);
    if (expectedScriptVersion !== (current.revisions.at(-1)?.scriptVersion ?? 0)) {
      throw this.revisionConflict();
    }
    const { currentRevision: _currentRevision, ...targetWithoutCurrent } = current;
    const deleted: ScriptTargetRecord = {
      ...targetWithoutCurrent,
      deletedAt: occurredAt,
      deletedByUid: actorUid,
      updatedAt: occurredAt
    };
    this.scriptTargets.set(targetId, cloneTarget(deleted));
    this.syncVersionTargets(packageId, version);
    this.appendTargetEvent(actorUid, deleted, 'script_target.deleted', occurredAt, {
      expectedScriptVersion
    });
    return cloneTarget(deleted);
  }

  private aggregateFromState(
    state: ReturnType<MemoryPlatformStore['snapshot']>,
    packageRecord: PackageRecord
  ): CatalogAggregate {
    const adoption = state.adoption[packageRecord.packageId] ?? {
      installations: 0,
      succeeded: 0
    };
    return {
      package: packageRecord,
      versions: Object.values(state.versions)
        .filter((version) => version.packageId === packageRecord.packageId)
        .map((version) => ({
          ...version,
          scriptTargets: [...this.scriptTargets.values()]
            .filter((target) =>
              target.packageId === version.packageId &&
              target.packageVersion === version.version &&
              !target.deletedAt
            )
            .map(cloneTarget)
        })),
      adoption: {
        ...adoption,
        successRate:
          adoption.installations > 0
            ? adoption.succeeded / adoption.installations
            : null
      }
    };
  }

  private requireVersion(packageId: string, version: string): PackageVersionRecord {
    const record = this.store.snapshot().versions[memoryVersionKey(packageId, version)];
    if (!record) {
      throw new AppError({ statusCode: 404, code: 'PACKAGE_VERSION_NOT_FOUND', message: '找不到套件版本' });
    }
    return record;
  }

  private requireDraftVersion(packageId: string, version: string): PackageVersionRecord {
    const record = this.requireVersion(packageId, version);
    if (record.lifecycle !== 'draft') {
      throw new AppError({
        statusCode: 409,
        code: 'INVALID_VERSION_TRANSITION',
        message: '只有草稿版本可以修改腳本目標'
      });
    }
    return record;
  }

  private requireActiveTarget(
    packageId: string,
    version: string,
    targetId: string
  ): ScriptTargetRecord {
    const target = this.scriptTargets.get(targetId);
    if (
      !target ||
      target.packageId !== packageId ||
      target.packageVersion !== version ||
      target.deletedAt
    ) {
      throw new AppError({ statusCode: 404, code: 'SCRIPT_TARGET_NOT_FOUND', message: '找不到腳本目標' });
    }
    return cloneTarget(target);
  }

  private revisionConflict(): AppError {
    return new AppError({
      statusCode: 409,
      code: 'SCRIPT_TARGET_REVISION_CONFLICT',
      message: '腳本目標已被其他請求更新，請重新載入後再試'
    });
  }

  private appendTargetEvent(
    actorUid: string,
    target: ScriptTargetRecord,
    eventType: string,
    occurredAt: Date,
    details: Record<string, unknown>
  ): void {
    const next = this.store.snapshot();
    next.auditLogs.push({
      id: randomUUID(),
      eventType,
      actorUid,
      packageId: target.packageId,
      version: target.packageVersion,
      details: { targetId: target.id, ...details },
      occurredAt
    });
    next.domainEvents.push({
      id: randomUUID(),
      aggregateType: 'package_version',
      aggregateId: target.id,
      eventType,
      payload: {
        actorUid,
        packageId: target.packageId,
        version: target.packageVersion,
        ...details
      },
      occurredAt
    });
    this.store.replace(next);
  }

  private syncVersionTargets(packageId: string, version: string): void {
    const next = this.store.snapshot();
    const key = memoryVersionKey(packageId, version);
    const current = next.versions[key];
    if (!current) return;
    next.versions[key] = {
      ...current,
      scriptTargets: [...this.scriptTargets.values()]
        .filter((target) =>
          target.packageId === packageId &&
          target.packageVersion === version &&
          !target.deletedAt
        )
        .map(cloneTarget)
    };
    this.store.replace(next);
  }

}
