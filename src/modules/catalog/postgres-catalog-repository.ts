// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { randomUUID } from 'node:crypto';

import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import type { CatalogRepository } from './repository.js';
import { mapPackageRow } from './package-row.js';
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
  ScriptTargetRevision,
  SetPackageGradeInput,
  UpdatePackageInput,
  UpdatePackageVersionInput
} from './types.js';
import {
  copyRevision,
  createInitialRevision,
  createNextRevision
} from './script-target-model.js';
import * as schema from '../../shared/database/schema.js';
import { AppError } from '../../shared/errors/app-error.js';

type CatalogDatabase = NodePgDatabase<typeof schema>;
type CatalogTransaction = Parameters<Parameters<CatalogDatabase['transaction']>[0]>[0];

const SCRIPT_TARGET_MATRIX_CONSTRAINT = 'package_version_script_targets_matrix_uidx';

function hasPostgresConstraint(error: unknown, constraint: string): boolean {
  let current = error;
  const seen = new Set<unknown>();
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    const candidate = current as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (candidate.code === '23505' && candidate.constraint === constraint) return true;
    current = candidate.cause;
  }
  return false;
}

const mapPackage = mapPackageRow;

/**
 * PackageRecord 的 publisher 是巢狀物件，資料表是兩個平欄位。
 * 建立與更新都要走這裡，否則 drizzle 會收到一個它不認得的 publisher 鍵。
 */
function toPackageColumns(
  input: Partial<Pick<PackageRecord, 'publisher'>> & Record<string, unknown>
): Record<string, unknown> {
  const { publisher, ...rest } = input;
  return {
    ...rest,
    ...(publisher
      ? { publisherKind: publisher.kind, publisherName: publisher.name }
      : {})
  };
}

function mapVersion(
  row: typeof schema.packageVersions.$inferSelect,
  scriptTargets: ScriptTargetRecord[] = []
): PackageVersionRecord {
  const derived = deriveSupportFromTargets(
    scriptTargets,
    row.supportedClients
  );
  return {
    id: String(row.id),
    packageId: row.packageId,
    version: row.version,
    ...(row.releaseNotes ? { releaseNotes: row.releaseNotes } : {}),
    // Task 13 之後真實來源是 script targets；舊欄位只在沒有 target 的
    // 相容期資料上回退，見 docs/待決策與延後事項.md 的 D-3。
    supportedOs: derived ? derived.supportedOs : [...row.supportedOs],
    supportedClients: derived
      ? derived.supportedClients
      : row.supportedClients.map((client) => ({ ...client })),
    lifecycle: row.lifecycle,
    ...(row.scriptDigest ? { scriptDigest: row.scriptDigest } : {}),
    ...(row.scriptManifestDigest
      ? { scriptManifestDigest: row.scriptManifestDigest }
      : {}),
    ...(row.publishedAt ? { publishedAt: row.publishedAt } : {}),
    installCommand: row.installCommand,
    uninstallCommand: row.uninstallCommand,
    hasResidualEffects: row.hasResidualEffects,
    ...(row.residualDescription
      ? { residualDescription: row.residualDescription }
      : {}),
    ...(row.manualCleanupSteps
      ? { manualCleanupSteps: row.manualCleanupSteps }
      : {}),
    scriptTargets,
    authorUid: row.authorUid,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function mapRevision(
  row: typeof schema.scriptTargetRevisions.$inferSelect
): ScriptTargetRevision {
  const hasCopySource =
    row.copiedFromTargetId !== null &&
    row.copiedFromTargetOs !== null &&
    row.copiedFromClientRuntime !== null &&
    row.copiedFromScriptVersion !== null;
  return {
    id: row.id,
    targetId: row.targetId,
    targetOs: row.targetOs as ScriptTargetRevision['targetOs'],
    clientRuntime: row.clientRuntime as ScriptTargetRevision['clientRuntime'],
    scriptVersion: row.scriptVersion,
    installCommand: row.installCommand,
    uninstallCommand: row.uninstallCommand,
    options: row.options.map((option) => ({
      ...option,
      ...(option.choices ? { choices: [...option.choices] } : {})
    })),
    usageInstructions: row.usageInstructions,
    hasResidualEffects: row.hasResidualEffects,
    ...(row.residualDescription ? { residualDescription: row.residualDescription } : {}),
    ...(row.manualCleanupSteps ? { manualCleanupSteps: row.manualCleanupSteps } : {}),
    ...(row.changeDescription ? { changeDescription: row.changeDescription } : {}),
    ...(hasCopySource ? {
      copiedFrom: {
        targetId: row.copiedFromTargetId!,
        targetOs: row.copiedFromTargetOs as ScriptTargetRevision['targetOs'],
        clientRuntime: row.copiedFromClientRuntime as ScriptTargetRevision['clientRuntime'],
        scriptVersion: row.copiedFromScriptVersion!
      }
    } : {}),
    contentDigest: row.contentDigest,
    legacyImported: row.legacyImported,
    createdByUid: row.createdByUid,
    createdAt: row.createdAt
  };
}

function mapTarget(
  row: typeof schema.packageVersionScriptTargets.$inferSelect,
  revisions: ScriptTargetRevision[]
): ScriptTargetRecord {
  const currentRevision = row.deletedAt
    ? undefined
    : revisions.find((revision) => revision.id === row.currentRevisionId);
  return {
    id: row.id,
    packageId: row.packageId,
    packageVersion: row.packageVersion,
    targetOs: row.targetOs as ScriptTargetRecord['targetOs'],
    clientRuntime: row.clientRuntime as ScriptTargetRecord['clientRuntime'],
    ...(currentRevision ? { currentRevision } : {}),
    revisions,
    ...(row.deletedAt ? { deletedAt: row.deletedAt } : {}),
    ...(row.deletedByUid ? { deletedByUid: row.deletedByUid } : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function revisionValues(revision: ScriptTargetRevision) {
  return {
    id: revision.id,
    targetId: revision.targetId,
    targetOs: revision.targetOs,
    clientRuntime: revision.clientRuntime,
    scriptVersion: revision.scriptVersion,
    installCommand: revision.installCommand,
    uninstallCommand: revision.uninstallCommand,
    options: revision.options,
    usageInstructions: revision.usageInstructions,
    hasResidualEffects: revision.hasResidualEffects,
    residualDescription: revision.residualDescription ?? null,
    manualCleanupSteps: revision.manualCleanupSteps ?? null,
    changeDescription: revision.changeDescription ?? null,
    copiedFromTargetId: revision.copiedFrom?.targetId ?? null,
    copiedFromTargetOs: revision.copiedFrom?.targetOs ?? null,
    copiedFromClientRuntime: revision.copiedFrom?.clientRuntime ?? null,
    copiedFromScriptVersion: revision.copiedFrom?.scriptVersion ?? null,
    contentDigest: revision.contentDigest,
    legacyImported: revision.legacyImported,
    createdByUid: revision.createdByUid,
    createdAt: revision.createdAt
  };
}

function targetNotFound(): AppError {
  return new AppError({
    statusCode: 404,
    code: 'SCRIPT_TARGET_NOT_FOUND',
    message: '找不到腳本目標'
  });
}

function revisionConflict(): AppError {
  return new AppError({
    statusCode: 409,
    code: 'SCRIPT_TARGET_REVISION_CONFLICT',
    message: '腳本目標已被其他請求更新，請重新載入後再試'
  });
}

function scriptTargetAlreadyExists(): AppError {
  return new AppError({
    statusCode: 409,
    code: 'SCRIPT_TARGET_ALREADY_EXISTS',
    message: '此系統與 Client 組合已存在'
  });
}

function invalidVersionTransition(): AppError {
  return new AppError({
    statusCode: 409,
    code: 'INVALID_VERSION_TRANSITION',
    message: '只有草稿版本可以修改腳本目標'
  });
}

export class PostgresCatalogRepository implements CatalogRepository {
  constructor(private readonly database: CatalogDatabase) {}

  async listAggregates(): Promise<CatalogAggregate[]> {
    const packageRows = await this.database.select().from(schema.packages);
    if (packageRows.length === 0) return [];
    const versionRows = await this.database
      .select()
      .from(schema.packageVersions)
      .where(
        inArray(
          schema.packageVersions.packageId,
          packageRows.map((row) => row.packageId)
        )
      );
    const targets = await this.loadActiveTargets(packageRows.map((row) => row.packageId));
    const targetsByVersion = new Map<string, ScriptTargetRecord[]>();
    for (const target of targets) {
      const key = `${target.packageId}\u0000${target.packageVersion}`;
      const records = targetsByVersion.get(key) ?? [];
      records.push(target);
      targetsByVersion.set(key, records);
    }
    const versionsByPackage = new Map<string, PackageVersionRecord[]>();
    for (const row of versionRows) {
      const versions = versionsByPackage.get(row.packageId) ?? [];
      versions.push(mapVersion(
        row,
        targetsByVersion.get(`${row.packageId}\u0000${row.version}`) ?? []
      ));
      versionsByPackage.set(row.packageId, versions);
    }
    return packageRows.map((row) => ({
      package: mapPackage(row),
      versions: versionsByPackage.get(row.packageId) ?? [],
      adoption: { installations: 0, succeeded: 0, successRate: null }
    }));
  }

  async findAggregate(packageId: string): Promise<CatalogAggregate | undefined> {
    const packageRows = await this.database
      .select()
      .from(schema.packages)
      .where(eq(schema.packages.packageId, packageId))
      .limit(1);
    if (!packageRows[0]) return undefined;
    const versions = await this.database
      .select()
      .from(schema.packageVersions)
      .where(eq(schema.packageVersions.packageId, packageId));
    const adoptionRows = await this.database.select({
      installations: sql<number>`count(*)::int`,
      succeeded: sql<number>`count(*) filter (where ${schema.installations.status} = 'succeeded')::int`
    }).from(schema.installations).where(eq(schema.installations.packageId, packageId));
    const installations = adoptionRows[0]?.installations ?? 0;
    const succeeded = adoptionRows[0]?.succeeded ?? 0;
    const targets = await this.loadActiveTargets([packageId]);
    const targetsByVersion = new Map<string, ScriptTargetRecord[]>();
    for (const target of targets) {
      const records = targetsByVersion.get(target.packageVersion) ?? [];
      records.push(target);
      targetsByVersion.set(target.packageVersion, records);
    }
    return {
      package: mapPackage(packageRows[0]),
      versions: versions.map((row) => mapVersion(
        row,
        targetsByVersion.get(row.version) ?? []
      )),
      adoption: {
        installations,
        succeeded,
        successRate: installations > 0 ? succeeded / installations : null
      }
    };
  }

  async createPackage(
    actorUid: string,
    input: ResolvedCreatePackageInput,
    occurredAt: Date
  ): Promise<PackageRecord> {
    return this.database.transaction(async (transaction) => {
      const rows = await transaction.insert(schema.packages).values({
        ...toPackageColumns(input),
        // 分級不由建立者決定，一律從預設值開始，等待審核人核定。
        grade: 'basic',
        createdByUid: actorUid,
        lifecycle: 'active',
        createdAt: occurredAt,
        updatedAt: occurredAt
      } as typeof schema.packages.$inferInsert).returning();
      const record = rows[0];
      if (!record) throw new Error('建立套件後未取得資料');
      await transaction.insert(schema.auditLogs).values({
        eventType: 'package.created', actorUid, targetType: 'package',
        targetId: input.packageId, action: 'create_package', details: { ...input }, occurredAt
      });
      await transaction.insert(schema.domainEvents).values({
        aggregateType: 'package', aggregateId: input.packageId,
        eventType: 'package.created', payload: { actorUid, packageId: input.packageId }, occurredAt
      });
      return mapPackage(record);
    });
  }

  async updatePackage(
    actorUid: string,
    packageId: string,
    input: UpdatePackageInput,
    occurredAt: Date
  ): Promise<PackageRecord | undefined> {
    return this.database.transaction(async (transaction) => {
      const rows = await transaction.update(schema.packages)
        .set({ ...toPackageColumns(input), updatedAt: occurredAt })
        .where(eq(schema.packages.packageId, packageId)).returning();
      if (!rows[0]) return undefined;
      await transaction.insert(schema.auditLogs).values({
        eventType: 'package.updated', actorUid, targetType: 'package', targetId: packageId,
        action: 'update_package', details: { changedFields: Object.keys(input) }, occurredAt
      });
      await transaction.insert(schema.domainEvents).values({
        aggregateType: 'package', aggregateId: packageId, eventType: 'package.updated',
        payload: { actorUid, changedFields: Object.keys(input) }, occurredAt
      });
      return mapPackage(rows[0]);
    });
  }

  /**
   * 核定分級。與 updatePackage 分開是因為權限不同：
   * 前者是維護者，後者是審核人。混在同一個方法會讓授權判斷無從區分。
   */
  async setPackageGrade(
    actorUid: string,
    packageId: string,
    input: SetPackageGradeInput,
    occurredAt: Date
  ): Promise<PackageRecord | undefined> {
    return this.database.transaction(async (transaction) => {
      const previous = await transaction.select({ grade: schema.packages.grade })
        .from(schema.packages)
        .where(eq(schema.packages.packageId, packageId));
      const rows = await transaction.update(schema.packages)
        .set({
          grade: input.grade,
          gradeDecidedByUid: actorUid,
          gradeDecidedAt: occurredAt,
          updatedAt: occurredAt
        })
        .where(eq(schema.packages.packageId, packageId)).returning();
      if (!rows[0]) return undefined;
      const details = {
        previousGrade: previous[0]?.grade ?? null,
        grade: input.grade
      };
      await transaction.insert(schema.auditLogs).values({
        eventType: 'package.grade_decided', actorUid, targetType: 'package',
        targetId: packageId, action: 'set_package_grade', details, occurredAt
      });
      await transaction.insert(schema.domainEvents).values({
        aggregateType: 'package', aggregateId: packageId,
        eventType: 'package.grade_decided',
        payload: { actorUid, ...details }, occurredAt
      });
      return mapPackage(rows[0]);
    });
  }

  async archivePackage(
    actorUid: string,
    packageId: string,
    occurredAt: Date
  ): Promise<PackageRecord | undefined> {
    return this.database.transaction(async (transaction) => {
      const rows = await transaction.update(schema.packages)
        .set({ lifecycle: 'archived', updatedAt: occurredAt })
        .where(eq(schema.packages.packageId, packageId)).returning();
      if (!rows[0]) return undefined;
      await transaction.insert(schema.auditLogs).values({
        eventType: 'package.archived', actorUid, targetType: 'package', targetId: packageId,
        action: 'archive_package', details: {}, occurredAt
      });
      await transaction.insert(schema.domainEvents).values({
        aggregateType: 'package', aggregateId: packageId, eventType: 'package.archived',
        payload: { actorUid }, occurredAt
      });
      return mapPackage(rows[0]);
    });
  }

  async createVersion(
    actorUid: string,
    packageId: string,
    input: CreatePackageVersionInput,
    occurredAt: Date
  ): Promise<PackageVersionRecord> {
    return this.database.transaction(async (transaction) => {
      const rows = await transaction.insert(schema.packageVersions).values({
        packageId,
        version: input.version,
        releaseNotes: input.releaseNotes,
        supportedOs: [],
        supportedClients: [],
        installCommand: '',
        uninstallCommand: '',
        hasResidualEffects: false,
        lifecycle: 'draft', authorUid: actorUid,
        createdAt: occurredAt, updatedAt: occurredAt
      }).returning();
      const record = rows[0];
      if (!record) throw new Error('建立套件版本後未取得資料');
      const targetId = `${packageId}@${input.version}`;
      await transaction.insert(schema.auditLogs).values({
        eventType: 'version.created', actorUid, targetType: 'version', targetId,
        action: 'create_version', details: { lifecycle: 'draft' }, occurredAt
      });
      await transaction.insert(schema.domainEvents).values({
        aggregateType: 'package_version', aggregateId: targetId, eventType: 'version.created',
        payload: { actorUid, lifecycle: 'draft' }, occurredAt
      });
      return mapVersion(record);
    });
  }

  async updateVersion(
    actorUid: string,
    packageId: string,
    version: string,
    input: UpdatePackageVersionInput,
    occurredAt: Date
  ): Promise<PackageVersionRecord | undefined> {
    if (Object.hasOwn(input as object, 'lifecycle')) {
      throw new AppError({ statusCode: 400, code: 'LIFECYCLE_MANAGED_BY_GOVERNANCE', message: '版本生命週期只能由發布治理流程變更' });
    }
    return this.database.transaction(async (transaction) => {
      const rows = await transaction.update(schema.packageVersions)
        .set({ ...input, updatedAt: occurredAt })
        .where(and(eq(schema.packageVersions.packageId, packageId), eq(schema.packageVersions.version, version)))
        .returning();
      if (!rows[0]) return undefined;
      const targetId = `${packageId}@${version}`;
      const eventType = 'version.updated';
      await transaction.insert(schema.auditLogs).values({
        eventType, actorUid, targetType: 'version', targetId,
        action: 'update_version', details: { changedFields: Object.keys(input) }, occurredAt
      });
      await transaction.insert(schema.domainEvents).values({
        aggregateType: 'package_version', aggregateId: targetId, eventType,
        payload: { actorUid, changedFields: Object.keys(input) }, occurredAt
      });
      return mapVersion(rows[0]);
    });
  }

  async findScriptTarget(
    packageId: string,
    version: string,
    targetId: string,
    includeDeleted = false
  ): Promise<ScriptTargetRecord | undefined> {
    const rows = await this.database.select()
      .from(schema.packageVersionScriptTargets)
      .where(and(
        eq(schema.packageVersionScriptTargets.id, targetId),
        eq(schema.packageVersionScriptTargets.packageId, packageId),
        eq(schema.packageVersionScriptTargets.packageVersion, version)
      ))
      .limit(1);
    const row = rows[0];
    if (!row || (row.deletedAt && !includeDeleted)) return undefined;
    const revisionRows = await this.database.select()
      .from(schema.scriptTargetRevisions)
      .where(eq(schema.scriptTargetRevisions.targetId, targetId))
      .orderBy(asc(schema.scriptTargetRevisions.scriptVersion));
    return mapTarget(row, revisionRows.map(mapRevision));
  }

  async createScriptTarget(
    actorUid: string,
    packageId: string,
    version: string,
    input: CreateScriptTargetInput,
    occurredAt: Date
  ): Promise<ScriptTargetRecord> {
    let targetId: string;
    try {
      targetId = await this.database.transaction(async (transaction) => {
        await this.requireDraftVersionForUpdate(transaction, packageId, version);
        const existingRows = await transaction.select()
          .from(schema.packageVersionScriptTargets)
          .where(and(
            eq(schema.packageVersionScriptTargets.packageId, packageId),
            eq(schema.packageVersionScriptTargets.packageVersion, version),
            eq(schema.packageVersionScriptTargets.targetOs, input.targetOs),
            eq(schema.packageVersionScriptTargets.clientRuntime, input.clientRuntime)
          ))
          .limit(1)
          .for('update');
        const existing = existingRows[0];
        if (existing && !existing.deletedAt) {
          throw scriptTargetAlreadyExists();
        }
        const eventType = existing ? 'script_target.restored' : 'script_target.created';
        const id = existing?.id ?? randomUUID();
        if (existing) {
          await transaction.update(schema.packageVersionScriptTargets)
            .set({
              currentRevisionId: null,
              deletedAt: null,
              deletedByUid: null,
              updatedAt: occurredAt
            })
            .where(eq(schema.packageVersionScriptTargets.id, id));
        } else {
          await transaction.insert(schema.packageVersionScriptTargets).values({
            id,
            packageId,
            packageVersion: version,
            targetOs: input.targetOs,
            clientRuntime: input.clientRuntime,
            createdAt: occurredAt,
            updatedAt: occurredAt
          });
        }
        await this.appendTargetAuditAndEvent(transaction, {
          actorUid, targetId: id, packageId, version, eventType,
          action: existing ? 'restore_script_target' : 'create_script_target',
          details: { targetOs: input.targetOs, clientRuntime: input.clientRuntime },
          occurredAt
        });
        return id;
      });
    } catch (error) {
      if (hasPostgresConstraint(error, SCRIPT_TARGET_MATRIX_CONSTRAINT)) {
        throw scriptTargetAlreadyExists();
      }
      throw error;
    }
    const record = await this.findScriptTarget(packageId, version, targetId, true);
    if (!record) throw targetNotFound();
    return record;
  }

  async saveScriptTargetRevision(
    actorUid: string,
    packageId: string,
    version: string,
    targetId: string,
    input: SaveScriptTargetRevisionInput,
    occurredAt: Date
  ): Promise<ScriptTargetRecord> {
    await this.database.transaction(async (transaction) => {
      await this.requireDraftVersionForUpdate(transaction, packageId, version);
      const targetRows = await transaction.select()
        .from(schema.packageVersionScriptTargets)
        .where(and(
          eq(schema.packageVersionScriptTargets.id, targetId),
          eq(schema.packageVersionScriptTargets.packageId, packageId),
          eq(schema.packageVersionScriptTargets.packageVersion, version),
          isNull(schema.packageVersionScriptTargets.deletedAt)
        ))
        .limit(1)
        .for('update');
      const target = targetRows[0];
      if (!target) throw targetNotFound();
      const lastRows = await transaction.select()
        .from(schema.scriptTargetRevisions)
        .where(eq(schema.scriptTargetRevisions.targetId, targetId))
        .orderBy(desc(schema.scriptTargetRevisions.scriptVersion))
        .limit(1);
      const last = lastRows[0] ? mapRevision(lastRows[0]) : undefined;
      const actualVersion = last?.scriptVersion ?? 0;
      if (input.expectedScriptVersion !== actualVersion) throw revisionConflict();
      const { expectedScriptVersion: _, ...content } = input;
      const locator = {
        id: target.id,
        targetOs: target.targetOs as ScriptTargetRecord['targetOs'],
        clientRuntime: target.clientRuntime as ScriptTargetRecord['clientRuntime']
      };
      const revision = last
        ? createNextRevision(last, content, actorUid, occurredAt)
        : createInitialRevision(locator, content, actorUid, occurredAt);
      await transaction.insert(schema.scriptTargetRevisions).values(revisionValues(revision));
      await transaction.update(schema.packageVersionScriptTargets)
        .set({ currentRevisionId: revision.id, updatedAt: occurredAt })
        .where(eq(schema.packageVersionScriptTargets.id, targetId));
      await this.appendTargetAuditAndEvent(transaction, {
        actorUid, targetId, packageId, version,
        eventType: 'script_target.revision_saved',
        action: 'save_script_target_revision',
        details: { scriptVersion: revision.scriptVersion }, occurredAt
      });
    });
    const record = await this.findScriptTarget(packageId, version, targetId, true);
    if (!record) throw targetNotFound();
    return record;
  }

  async copyScriptTargetRevision(
    actorUid: string,
    packageId: string,
    version: string,
    targetId: string,
    input: CopyScriptTargetRevisionInput,
    occurredAt: Date
  ): Promise<ScriptTargetRecord> {
    await this.database.transaction(async (transaction) => {
      await this.requireDraftVersionForUpdate(transaction, packageId, version);
      const targetRows = await transaction.select()
        .from(schema.packageVersionScriptTargets)
        .where(and(
          inArray(schema.packageVersionScriptTargets.id, [targetId, input.sourceTargetId]),
          eq(schema.packageVersionScriptTargets.packageId, packageId),
          eq(schema.packageVersionScriptTargets.packageVersion, version),
          isNull(schema.packageVersionScriptTargets.deletedAt)
        ))
        .orderBy(asc(schema.packageVersionScriptTargets.id))
        .for('update');
      const destination = targetRows.find((row) => row.id === targetId);
      const source = targetRows.find((row) => row.id === input.sourceTargetId);
      if (!destination || !source || !source.currentRevisionId || source.id === destination.id) {
        throw targetNotFound();
      }
      const destinationLastRows = await transaction.select()
        .from(schema.scriptTargetRevisions)
        .where(eq(schema.scriptTargetRevisions.targetId, targetId))
        .orderBy(desc(schema.scriptTargetRevisions.scriptVersion))
        .limit(1);
      const actualVersion = destinationLastRows[0]?.scriptVersion ?? 0;
      if (input.expectedScriptVersion !== actualVersion) throw revisionConflict();
      const sourceRevisionRows = await transaction.select()
        .from(schema.scriptTargetRevisions)
        .where(eq(schema.scriptTargetRevisions.id, source.currentRevisionId))
        .limit(1);
      if (!sourceRevisionRows[0]) throw targetNotFound();
      const sourceRevision = mapRevision(sourceRevisionRows[0]);
      const revision = copyRevision(
        sourceRevision,
        {
          id: destination.id,
          targetOs: destination.targetOs as ScriptTargetRecord['targetOs'],
          clientRuntime: destination.clientRuntime as ScriptTargetRecord['clientRuntime']
        },
        actorUid,
        occurredAt,
        actualVersion + 1,
        input.changeDescription
      );
      await transaction.insert(schema.scriptTargetRevisions).values(revisionValues(revision));
      await transaction.update(schema.packageVersionScriptTargets)
        .set({ currentRevisionId: revision.id, updatedAt: occurredAt })
        .where(eq(schema.packageVersionScriptTargets.id, targetId));
      await this.appendTargetAuditAndEvent(transaction, {
        actorUid, targetId, packageId, version,
        eventType: 'script_target.revision_copied',
        action: 'copy_script_target_revision',
        details: {
          scriptVersion: revision.scriptVersion,
          sourceTargetId: sourceRevision.targetId,
          sourceScriptVersion: sourceRevision.scriptVersion
        },
        occurredAt
      });
    });
    const record = await this.findScriptTarget(packageId, version, targetId, true);
    if (!record) throw targetNotFound();
    return record;
  }

  async softDeleteScriptTarget(
    actorUid: string,
    packageId: string,
    version: string,
    targetId: string,
    expectedScriptVersion: number,
    occurredAt: Date
  ): Promise<ScriptTargetRecord> {
    await this.database.transaction(async (transaction) => {
      await this.requireDraftVersionForUpdate(transaction, packageId, version);
      const targetRows = await transaction.select()
        .from(schema.packageVersionScriptTargets)
        .where(and(
          eq(schema.packageVersionScriptTargets.id, targetId),
          eq(schema.packageVersionScriptTargets.packageId, packageId),
          eq(schema.packageVersionScriptTargets.packageVersion, version),
          isNull(schema.packageVersionScriptTargets.deletedAt)
        ))
        .limit(1)
        .for('update');
      if (!targetRows[0]) throw targetNotFound();
      const lastRows = await transaction.select({ scriptVersion: schema.scriptTargetRevisions.scriptVersion })
        .from(schema.scriptTargetRevisions)
        .where(eq(schema.scriptTargetRevisions.targetId, targetId))
        .orderBy(desc(schema.scriptTargetRevisions.scriptVersion))
        .limit(1);
      if (expectedScriptVersion !== (lastRows[0]?.scriptVersion ?? 0)) throw revisionConflict();
      await transaction.update(schema.packageVersionScriptTargets)
        .set({
          currentRevisionId: null,
          deletedAt: occurredAt,
          deletedByUid: actorUid,
          updatedAt: occurredAt
        })
        .where(eq(schema.packageVersionScriptTargets.id, targetId));
      await this.appendTargetAuditAndEvent(transaction, {
        actorUid, targetId, packageId, version,
        eventType: 'script_target.deleted',
        action: 'delete_script_target',
        details: { expectedScriptVersion }, occurredAt
      });
    });
    const record = await this.findScriptTarget(packageId, version, targetId, true);
    if (!record) throw targetNotFound();
    return record;
  }

  private async loadActiveTargets(packageIds: string[]): Promise<ScriptTargetRecord[]> {
    if (packageIds.length === 0) return [];
    const targetRows = await this.database.select()
      .from(schema.packageVersionScriptTargets)
      .where(and(
        inArray(schema.packageVersionScriptTargets.packageId, packageIds),
        isNull(schema.packageVersionScriptTargets.deletedAt)
      ));
    if (targetRows.length === 0) return [];
    const revisionRows = await this.database.select()
      .from(schema.scriptTargetRevisions)
      .where(inArray(
        schema.scriptTargetRevisions.targetId,
        targetRows.map((row) => row.id)
      ))
      .orderBy(asc(schema.scriptTargetRevisions.scriptVersion));
    const revisionsByTarget = new Map<string, ScriptTargetRevision[]>();
    for (const row of revisionRows) {
      const revisions = revisionsByTarget.get(row.targetId) ?? [];
      revisions.push(mapRevision(row));
      revisionsByTarget.set(row.targetId, revisions);
    }
    return targetRows.map((row) => mapTarget(row, revisionsByTarget.get(row.id) ?? []));
  }

  private async appendTargetAuditAndEvent(
    transaction: CatalogTransaction,
    input: {
      actorUid: string;
      targetId: string;
      packageId: string;
      version: string;
      eventType: string;
      action: string;
      details: Record<string, unknown>;
      occurredAt: Date;
    }
  ): Promise<void> {
    await transaction.insert(schema.auditLogs).values({
      eventType: input.eventType,
      actorUid: input.actorUid,
      targetType: 'script_target',
      targetId: input.targetId,
      action: input.action,
      details: { packageId: input.packageId, version: input.version, ...input.details },
      occurredAt: input.occurredAt
    });
    await transaction.insert(schema.domainEvents).values({
      aggregateType: 'script_target',
      aggregateId: input.targetId,
      eventType: input.eventType,
      payload: {
        actorUid: input.actorUid,
        packageId: input.packageId,
        version: input.version,
        ...input.details
      },
      occurredAt: input.occurredAt
    });
  }

  private async requireDraftVersionForUpdate(
    transaction: CatalogTransaction,
    packageId: string,
    version: string
  ): Promise<void> {
    const rows = await transaction.select({ lifecycle: schema.packageVersions.lifecycle })
      .from(schema.packageVersions)
      .where(and(
        eq(schema.packageVersions.packageId, packageId),
        eq(schema.packageVersions.version, version)
      ))
      .limit(1)
      .for('update');
    if (!rows[0]) {
      throw new AppError({
        statusCode: 404,
        code: 'PACKAGE_VERSION_NOT_FOUND',
        message: '找不到套件版本'
      });
    }
    if (rows[0].lifecycle !== 'draft') throw invalidVersionTransition();
  }
}
