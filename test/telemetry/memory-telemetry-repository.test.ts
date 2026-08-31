// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { describe, expect, it } from 'vitest';

import { MemoryPlatformStore } from '../../src/modules/catalog/memory-platform-store.js';
import { MemoryTelemetryRepository } from '../../src/modules/telemetry/memory-telemetry-repository.js';
import type { CanonicalTelemetryEvent } from '../../src/modules/telemetry/types.js';

const now = new Date('2026-08-25T12:00:00.000Z');

function createStore() {
  return new MemoryPlatformStore({
    packages: {
      'quality-skill': {
        packageId: 'quality-skill', type: 'skill', name: '品質技能', purpose: '驗證品質',
        ownerTeam: 'team-a', category: 'quality', categoryCode: 'testing', visibility: 'public',
        sourceUri: 'https://example.invalid/quality-skill', license: 'MIT', lifecycle: 'active',
        source: 'custom', publisher: { kind: 'organization', name: '平台組' }, grade: 'basic',
        createdAt: now, updatedAt: now
      }
    },
    versions: {
      ['quality-skill\u00001.0.0']: {
        id: 'version-1', packageId: 'quality-skill', version: '1.0.0', supportedOs: ['linux'],
        supportedClients: [{ name: 'codex', adaptationSource: 'publisher', maintainer: 'team-a' }],
        lifecycle: 'published', installCommand: 'install', uninstallCommand: 'uninstall',
        hasResidualEffects: false, authorUid: 'author-1', createdAt: now, updatedAt: now
      }
    },
    adoption: { 'quality-skill': { installations: 0, succeeded: 0 } }
  });
}

function event(overrides: Partial<CanonicalTelemetryEvent> = {}): CanonicalTelemetryEvent {
  return {
    idempotencyKey: '123e4567-e89b-42d3-a456-426614174000',
    packageId: 'quality-skill', version: '1.0.0', userRef: 'user-1', userRefType: 'uid',
    osType: 'linux', clientRuntime: 'codex', status: 'succeeded', errorCode: null,
    startedAt: new Date('2026-08-25T10:00:00.000Z'),
    endedAt: new Date('2026-08-25T10:01:00.000Z'),
    payloadFingerprint: 'a'.repeat(64), receivedAt: now,
    ...overrides
  };
}

describe('MemoryTelemetryRepository', () => {
  it('首次事件追加事實、治理 installation snapshot 與採用統計', async () => {
    const store = createStore();
    const repository = new MemoryTelemetryRepository(store);

    const result = await repository.ingest(event());
    const state = store.snapshot();

    expect(result.duplicate).toBe(false);
    expect(result.record).toMatchObject({ packageId: 'quality-skill', version: '1.0.0', status: 'succeeded' });
    expect(state.telemetryRecords).toHaveLength(1);
    expect(state.installations).toEqual([
      expect.objectContaining({ packageId: 'quality-skill', version: '1.0.0', userRef: 'user-1', status: 'succeeded' })
    ]);
    expect(state.adoption['quality-skill']).toEqual({ installations: 1, succeeded: 1 });
  });

  it('相同 key 與 fingerprint 回傳 duplicate 且不改寫任何狀態', async () => {
    const store = createStore();
    const repository = new MemoryTelemetryRepository(store);
    await repository.ingest(event());
    const beforeDuplicate = store.snapshot();

    const result = await repository.ingest(event());

    expect(result.duplicate).toBe(true);
    expect(store.snapshot()).toEqual(beforeDuplicate);
  });

  it('相同 key 但不同內容固定回傳冪等衝突', async () => {
    const repository = new MemoryTelemetryRepository(createStore());
    await repository.ingest(event());

    await expect(repository.ingest(event({ payloadFingerprint: 'b'.repeat(64) }))).rejects.toMatchObject({
      statusCode: 409,
      code: 'IDEMPOTENCY_KEY_CONFLICT'
    });
  });

  it.each([
    ['套件不存在', event({ packageId: 'missing-package' })],
    ['版本不存在', event({ version: '9.9.9' })]
  ])('拒絕%s的遙測', async (_reason, input) => {
    const repository = new MemoryTelemetryRepository(createStore());

    await expect(repository.ingest(input)).rejects.toMatchObject({
      statusCode: 404,
      code: 'PACKAGE_VERSION_NOT_FOUND'
    });
  });

  it('不同 key 的後續事件才更新採用統計', async () => {
    const store = createStore();
    const repository = new MemoryTelemetryRepository(store);
    await repository.ingest(event({ status: 'downloaded', idempotencyKey: '123e4567-e89b-42d3-a456-426614174001' }));
    await repository.ingest(event({ idempotencyKey: '123e4567-e89b-42d3-a456-426614174002' }));

    expect(store.snapshot().adoption['quality-skill']).toEqual({ installations: 2, succeeded: 1 });
  });

  it('round-trip 保留 script version/options 且 legacy null 不被改寫', async () => {
    const store = createStore();
    const repository = new MemoryTelemetryRepository(store);

    const current = await repository.ingest(event({
      scriptVersion: 4,
      options: { '--scope': 'workspace', '--verify': true }
    }));
    const legacy = await repository.ingest(event({
      idempotencyKey: '123e4567-e89b-42d3-a456-426614174001',
      scriptVersion: null,
      options: null
    }));

    expect(current.record).toMatchObject({
      scriptVersion: 4,
      options: { '--scope': 'workspace', '--verify': true }
    });
    expect(legacy.record).toMatchObject({ scriptVersion: null, options: null });
    expect(store.snapshot().telemetryRecords).toEqual(expect.arrayContaining([
      expect.objectContaining({ scriptVersion: 4, options: { '--scope': 'workspace', '--verify': true } }),
      expect.objectContaining({ scriptVersion: null, options: null })
    ]));
  });
});
