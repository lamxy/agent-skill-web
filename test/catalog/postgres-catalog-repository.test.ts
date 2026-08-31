// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { randomUUID } from 'node:crypto';

import { eq, sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { runMigrations } from '../../scripts/migrate-database.js';
import { PostgresCatalogRepository } from '../../src/modules/catalog/postgres-catalog-repository.js';
import { createPostgresDatabase } from '../../src/shared/database/postgres-database.js';
import {
  auditLogs,
  domainEvents,
  packageVersions,
  packageVersionScriptTargets,
  packages,
  scriptTargetRevisions
} from '../../src/shared/database/schema.js';
import type { ClientRuntime, ScriptTargetOs } from '../../src/modules/catalog/types.js';

const databaseUrl = process.env.TEST_DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:55432/agent_skill_platform';
const migrationPool = new Pool({ connectionString: databaseUrl, max: 1 });
const database = createPostgresDatabase(databaseUrl);
const repository = new PostgresCatalogRepository(database.client);
const now = new Date('2026-08-25T00:00:00.000Z');

beforeAll(async () => runMigrations(migrationPool));
beforeEach(async () => {
  await database.client.delete(scriptTargetRevisions);
  await database.client.delete(packageVersionScriptTargets);
  await database.client.delete(packageVersions);
  await database.client.delete(packages);
  await database.client.delete(domainEvents);
});
afterAll(async () => Promise.all([database.close(), migrationPool.end()]));

describe('PostgresCatalogRepository', () => {
  it('以邏輯 package_id 保存套件版本並同交易寫入審計與 outbox', async () => {
    const actorUid = `catalog-admin-${randomUUID()}`;
    await repository.createPackage(actorUid, {
      packageId: 'postgres-skill', type: 'skill', name: 'Postgres 技能',
      purpose: '優化資料庫', ownerTeam: 'database', category: 'backend',
      categoryCode: 'backend', visibility: 'public',
      sourceUri: 'https://example.invalid/postgres-skill', license: 'MIT',
      source: 'custom', publisher: { kind: 'organization', name: '資料庫組' }
    }, now);
    await repository.createVersion(actorUid, 'postgres-skill', {
      version: '1.0.0', releaseNotes: '首版'
    }, now);
    await repository.updateVersion(actorUid, 'postgres-skill', '1.0.0', {
      releaseNotes: '更新後首版'
    }, new Date('2026-08-25T01:00:00.000Z'));
    const publishedAt = new Date('2026-08-25T02:00:00.000Z');
    await database.client.update(packageVersions)
      .set({
        publishedAt,
        scriptManifestDigest: 'sha256:manifest-contract'
      })
      .where(eq(packageVersions.packageId, 'postgres-skill'));

    const aggregate = await repository.findAggregate('postgres-skill');
    const events = await database.client.select({ eventType: domainEvents.eventType })
      .from(domainEvents).where(eq(domainEvents.aggregateId, 'postgres-skill@1.0.0'))
      .orderBy(domainEvents.occurredAt);
    const audits = await database.client.select({ eventType: auditLogs.eventType })
      .from(auditLogs).where(eq(auditLogs.actorUid, actorUid))
      .orderBy(auditLogs.occurredAt);
    const foreignKeys = await database.client.execute<{ count: string }>(sql`
      select count(*)::text as count from pg_constraint
      where contype = 'f' and connamespace = 'public'::regnamespace
    `);

    expect(aggregate).toMatchObject({
      package: { packageId: 'postgres-skill', purpose: '優化資料庫' },
      versions: [{
        packageId: 'postgres-skill',
        lifecycle: 'draft',
        authorUid: actorUid,
        publishedAt,
        scriptManifestDigest: 'sha256:manifest-contract'
      }]
    });
    expect(events).toEqual([{ eventType: 'version.created' }, { eventType: 'version.updated' }]);
    expect(audits.map((item) => item.eventType)).toEqual([
      'package.created', 'version.created', 'version.updated'
    ]);
    expect(foreignKeys.rows[0]?.count).toBe('0');
  });

  async function createDraft(actorUid: string, packageId: string, version: string) {
    await repository.createPackage(actorUid, {
      packageId,
      type: 'skill',
      name: 'Matrix skill',
      purpose: '驗證腳本矩陣',
      ownerTeam: 'platform',
      category: 'backend',
      categoryCode: 'backend',
      visibility: 'internal',
      sourceUri: 'https://example.invalid/matrix',
      license: 'MIT',
      source: 'custom',
      publisher: { kind: 'organization', name: '平台組' }
    }, now);
    await repository.createVersion(actorUid, packageId, { version }, now);
  }

  const revisionInput = (label: string, expectedScriptVersion: number) => ({
    expectedScriptVersion,
    installCommand: `install ${label}`,
    uninstallCommand: `uninstall ${label}`,
    options: [],
    usageInstructions: `使用 ${label}`,
    hasResidualEffects: false,
    changeDescription: `建立 ${label}`
  });

  it('六個 OS 與 Client 組合各自保存而不互相覆寫', async () => {
    const actorUid = `matrix-${randomUUID()}`;
    await createDraft(actorUid, 'matrix-six', '1.0.0');
    const combinations: Array<[ScriptTargetOs, ClientRuntime]> = [
      ['linux/macos', 'claude-code'],
      ['linux/macos', 'codex'],
      ['windows', 'claude-code'],
      ['windows', 'codex'],
      ['wsl', 'claude-code'],
      ['wsl', 'codex']
    ];

    for (const [targetOs, clientRuntime] of combinations) {
      const target = await repository.createScriptTarget(
        actorUid,
        'matrix-six',
        '1.0.0',
        { targetOs, clientRuntime },
        now
      );
      await repository.saveScriptTargetRevision(
        actorUid,
        'matrix-six',
        '1.0.0',
        target.id,
        revisionInput(`${targetOs}:${clientRuntime}`, 0),
        now
      );
    }

    const aggregate = await repository.findAggregate('matrix-six');
    const targets = aggregate?.versions[0]?.scriptTargets ?? [];
    expect(targets).toHaveLength(6);
    expect(
      targets.map((target) => target.currentRevision?.installCommand).sort()
    ).toEqual(
      combinations.map(([os, client]) => `install ${os}:${client}`).sort()
    );
  });

  it('CAS 衝突不建立 revision 並回傳 SCRIPT_TARGET_REVISION_CONFLICT', async () => {
    const actorUid = `cas-${randomUUID()}`;
    await createDraft(actorUid, 'matrix-cas', '1.0.0');
    const target = await repository.createScriptTarget(
      actorUid, 'matrix-cas', '1.0.0',
      { targetOs: 'linux/macos', clientRuntime: 'codex' }, now
    );
    await repository.saveScriptTargetRevision(
      actorUid, 'matrix-cas', '1.0.0', target.id,
      revisionInput('first', 0), now
    );

    await expect(repository.saveScriptTargetRevision(
      actorUid, 'matrix-cas', '1.0.0', target.id,
      revisionInput('stale', 0), now
    )).rejects.toMatchObject({ code: 'SCRIPT_TARGET_REVISION_CONFLICT' });
    const reloaded = await repository.findScriptTarget(
      'matrix-cas', '1.0.0', target.id, true
    );
    expect(reloaded?.revisions.map((revision) => revision.scriptVersion)).toEqual([1]);
  });

  it('copy 建立獨立快照且手動更新不修改來源', async () => {
    const actorUid = `copy-${randomUUID()}`;
    await createDraft(actorUid, 'matrix-copy', '1.0.0');
    const source = await repository.createScriptTarget(
      actorUid, 'matrix-copy', '1.0.0',
      { targetOs: 'linux/macos', clientRuntime: 'codex' }, now
    );
    const destination = await repository.createScriptTarget(
      actorUid, 'matrix-copy', '1.0.0',
      { targetOs: 'windows', clientRuntime: 'claude-code' }, now
    );
    await repository.saveScriptTargetRevision(
      actorUid, 'matrix-copy', '1.0.0', source.id,
      revisionInput('source', 0), now
    );
    const copied = await repository.copyScriptTargetRevision(
      actorUid, 'matrix-copy', '1.0.0', destination.id,
      { sourceTargetId: source.id, expectedScriptVersion: 0 }, now
    );
    await repository.saveScriptTargetRevision(
      actorUid, 'matrix-copy', '1.0.0', destination.id,
      revisionInput('destination-edited', 1), new Date('2026-08-28T03:00:00.000Z')
    );

    const sourceReloaded = await repository.findScriptTarget(
      'matrix-copy', '1.0.0', source.id, true
    );
    const destinationReloaded = await repository.findScriptTarget(
      'matrix-copy', '1.0.0', destination.id, true
    );
    expect(copied.currentRevision?.copiedFrom).toMatchObject({
      targetId: source.id,
      scriptVersion: 1
    });
    expect(sourceReloaded?.currentRevision?.installCommand).toBe('install source');
    expect(destinationReloaded?.currentRevision).toMatchObject({
      installCommand: 'install destination-edited',
      scriptVersion: 2
    });
    expect(destinationReloaded?.currentRevision?.copiedFrom).toBeUndefined();
  });

  it('soft delete 隱藏 current revision，restore 從歷史最大版本加一', async () => {
    const actorUid = `restore-${randomUUID()}`;
    await createDraft(actorUid, 'matrix-restore', '1.0.0');
    const target = await repository.createScriptTarget(
      actorUid, 'matrix-restore', '1.0.0',
      { targetOs: 'wsl', clientRuntime: 'codex' }, now
    );
    await repository.saveScriptTargetRevision(
      actorUid, 'matrix-restore', '1.0.0', target.id,
      revisionInput('before-delete', 0), now
    );
    const deleted = await repository.softDeleteScriptTarget(
      actorUid, 'matrix-restore', '1.0.0', target.id, 1,
      new Date('2026-08-28T03:00:00.000Z')
    );
    const hiddenAggregate = await repository.findAggregate('matrix-restore');
    const restored = await repository.createScriptTarget(
      actorUid, 'matrix-restore', '1.0.0',
      { targetOs: 'wsl', clientRuntime: 'codex' },
      new Date('2026-08-28T04:00:00.000Z')
    );
    const saved = await repository.saveScriptTargetRevision(
      actorUid, 'matrix-restore', '1.0.0', restored.id,
      revisionInput('restored', 1),
      new Date('2026-08-28T05:00:00.000Z')
    );

    expect(deleted.currentRevision).toBeUndefined();
    expect(deleted.revisions.map((revision) => revision.scriptVersion)).toEqual([1]);
    expect(hiddenAggregate?.versions[0]?.scriptTargets).toEqual([]);
    expect(restored.id).toBe(target.id);
    expect(restored.currentRevision).toBeUndefined();
    expect(saved.currentRevision?.scriptVersion).toBe(2);
    expect(saved.revisions.map((revision) => revision.scriptVersion)).toEqual([1, 2]);

    const events = await database.client.select({ eventType: domainEvents.eventType })
      .from(domainEvents)
      .where(eq(domainEvents.aggregateId, target.id));
    const audits = await database.client.select({ eventType: auditLogs.eventType })
      .from(auditLogs)
      .where(eq(auditLogs.actorUid, actorUid));
    expect(events.map((entry) => entry.eventType)).toEqual([
      'script_target.created',
      'script_target.revision_saved',
      'script_target.deleted',
      'script_target.restored',
      'script_target.revision_saved'
    ]);
    expect(audits.filter((entry) => entry.eventType.startsWith('script_target.'))).toHaveLength(5);
  });

  it.each(['create', 'save', 'copy', 'delete'] as const)(
    'repository transaction 在版本離開 draft 後拒絕 %s target mutation',
    async (operation) => {
      const actorUid = `lifecycle-${operation}-${randomUUID()}`;
      const packageId = `matrix-lifecycle-${operation}`;
      await createDraft(actorUid, packageId, '1.0.0');
      const source = await repository.createScriptTarget(
        actorUid, packageId, '1.0.0',
        { targetOs: 'linux/macos', clientRuntime: 'codex' }, now
      );
      const destination = await repository.createScriptTarget(
        actorUid, packageId, '1.0.0',
        { targetOs: 'windows', clientRuntime: 'claude-code' }, now
      );
      await repository.saveScriptTargetRevision(
        actorUid, packageId, '1.0.0', source.id,
        revisionInput('source', 0), now
      );
      await database.client.update(packageVersions)
        .set({ lifecycle: 'validating' })
        .where(eq(packageVersions.packageId, packageId));

      const mutation = operation === 'create'
        ? repository.createScriptTarget(
            actorUid, packageId, '1.0.0',
            { targetOs: 'wsl', clientRuntime: 'codex' }, now
          )
        : operation === 'save'
          ? repository.saveScriptTargetRevision(
              actorUid, packageId, '1.0.0', source.id,
              revisionInput('late-save', 1), now
            )
          : operation === 'copy'
            ? repository.copyScriptTargetRevision(
                actorUid, packageId, '1.0.0', destination.id,
                { sourceTargetId: source.id, expectedScriptVersion: 0 }, now
              )
            : repository.softDeleteScriptTarget(
                actorUid, packageId, '1.0.0', source.id, 1, now
              );

      await expect(mutation).rejects.toMatchObject({
        statusCode: 409,
        code: 'INVALID_VERSION_TRANSITION'
      });
    }
  );

  it('併發建立撞 Matrix unique constraint 時穩定回傳 409', async () => {
    const actorUid = `duplicate-${randomUUID()}`;
    await createDraft(actorUid, 'matrix-concurrent-create', '1.0.0');
    const winner = await migrationPool.connect();
    try {
      await winner.query('begin');
      await winner.query(
        `insert into package_version_script_targets (
          id, package_id, package_version, target_os, client_runtime, created_at, updated_at
        ) values ($1, $2, $3, $4, $5, $6, $6)`,
        [
          `winner-${randomUUID()}`,
          'matrix-concurrent-create',
          '1.0.0',
          'wsl',
          'codex',
          now
        ]
      );
      const competingCreate = repository.createScriptTarget(
        actorUid,
        'matrix-concurrent-create',
        '1.0.0',
        { targetOs: 'wsl', clientRuntime: 'codex' },
        now
      );
      await new Promise((resolve) => setTimeout(resolve, 25));
      await winner.query('commit');

      await expect(competingCreate).rejects.toMatchObject({
        statusCode: 409,
        code: 'SCRIPT_TARGET_ALREADY_EXISTS'
      });
    } finally {
      await winner.query('rollback');
      winner.release();
    }
  });
});
