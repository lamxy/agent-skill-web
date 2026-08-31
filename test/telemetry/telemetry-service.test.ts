// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { describe, expect, it } from 'vitest';

import type {
  CanonicalTelemetryEvent,
  TelemetryReport,
  TelemetryRecord
} from '../../src/modules/telemetry/types.js';
import type { TelemetryRepository } from '../../src/modules/telemetry/repository.js';
import {
  TELEMETRY_ALLOWED_FIELDS,
  TelemetryService
} from '../../src/modules/telemetry/telemetry-service.js';

const receivedAt = new Date('2026-08-25T12:00:00.000Z');

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    idempotency_key: '123e4567-e89b-42d3-a456-426614174000',
    package_id: 'quality-skill',
    version: '1.0.0',
    user_ref: 'user-1',
    user_ref_type: 'uid',
    os_type: 'linux',
    client_runtime: 'codex',
    status: 'succeeded',
    start_time: '2026-08-25T10:00:00.000Z',
    end_time: '2026-08-25T10:01:00.000Z',
    ...overrides
  };
}

function task13Payload(overrides: Record<string, unknown> = {}) {
  return validPayload({
    script_version: 3,
    options: { '--scope': 'workspace', '--verify': true },
    ...overrides
  });
}

function legacyFailedPayload(errorCode: string): TelemetryReport {
  return {
    idempotency_key: '123e4567-e89b-42d3-a456-426614174000',
    package_id: 'quality-skill',
    version: '1.0.0',
    user_ref: 'user-1',
    user_ref_type: 'uid',
    os_type: 'linux',
    client_runtime: 'codex',
    status: 'failed',
    error_code: errorCode,
    start_time: '2026-08-25T10:00:00.000Z',
    end_time: '2026-08-25T10:01:00.000Z'
  };
}

function createService() {
  const events: CanonicalTelemetryEvent[] = [];
  const repository: TelemetryRepository = {
    async ingest(event) {
      events.push(event);
      const record: TelemetryRecord = { id: 'telemetry-1', ...event };
      return { record, duplicate: false };
    }
  };
  return { service: new TelemetryService(repository, () => receivedAt), events };
}

describe('TelemetryService', () => {
  it('將可公開接收範圍固定為已審核的十三欄', () => {
    expect(TELEMETRY_ALLOWED_FIELDS).toEqual([
      'idempotency_key',
      'package_id',
      'version',
      'user_ref',
      'user_ref_type',
      'os_type',
      'client_runtime',
      'status',
      'error_code',
      'start_time',
      'end_time',
      'script_version',
      'options'
    ]);
  });

  it('只保留十三欄白名單並只回傳額外欄位名稱', async () => {
    const { service, events } = createService();

    const receipt = await service.ingest({
      ...validPayload(),
      secret: '不得記錄',
      shell_output: '不得記錄'
    });

    expect(receipt.droppedFields).toEqual(['secret', 'shell_output']);
    expect(receipt.record.errorCode).toBeNull();
    expect(events[0]).toMatchObject({
      idempotencyKey: '123e4567-e89b-42d3-a456-426614174000',
      packageId: 'quality-skill',
      version: '1.0.0',
      userRef: 'user-1',
      userRefType: 'uid',
      osType: 'linux',
      clientRuntime: 'codex',
      status: 'succeeded',
      errorCode: null,
      scriptVersion: null,
      options: null,
      startedAt: new Date('2026-08-25T10:00:00.000Z'),
      endedAt: new Date('2026-08-25T10:01:00.000Z'),
      receivedAt
    });
    expect(events[0]?.payloadFingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it('legacy payload 缺少 Task 13 欄位時明確保存 null', async () => {
    const { service } = createService();

    const receipt = await service.ingest(validPayload());

    expect(receipt.record).toMatchObject({ scriptVersion: null, options: null });
  });

  it('新 payload 保存 script version 與最多二十個 primitive options', async () => {
    const { service } = createService();
    const options = Object.fromEntries(
      Array.from({ length: 20 }, (_, index) => [`--option-${index}`, index % 2 === 0])
    );

    const receipt = await service.ingest(task13Payload({ options }));

    expect(receipt.record.scriptVersion).toBe(3);
    expect(receipt.record.options).toEqual(options);
    expect(receipt.droppedFields).toEqual([]);
  });

  it.each([
    ['script version 不是正整數', task13Payload({ script_version: 0 })],
    ['只傳 script version', validPayload({ script_version: 1 })],
    ['只傳 options', validPayload({ options: {} })],
    ['options 超過二十個', task13Payload({
      options: Object.fromEntries(Array.from({ length: 21 }, (_, index) => [`--option-${index}`, true]))
    })],
    ['option 名稱不合法', task13Payload({ options: { scope: 'workspace' } })],
    ['option 值是數值', task13Payload({ options: { '--scope': 1 } })],
    ['option 值是物件', task13Payload({ options: { '--scope': { secret: true } } })],
    ['option 文字超過上限', task13Payload({ options: { '--scope': 'x'.repeat(1_001) } })]
  ])('拒絕%s', async (_reason, payload) => {
    const { service } = createService();

    await expect(service.ingest(payload)).rejects.toMatchObject({
      statusCode: 400,
      code: 'INVALID_TELEMETRY_PAYLOAD'
    });
  });

  it('fingerprint 納入 script version/options 且不受 option key 順序影響', async () => {
    const baseline = await createService().service.ingest(task13Payload());
    const changedVersion = await createService().service.ingest(task13Payload({ script_version: 4 }));
    const changedOption = await createService().service.ingest(task13Payload({
      options: { '--scope': 'user', '--verify': true }
    }));
    const reordered = await createService().service.ingest(task13Payload({
      options: { '--verify': true, '--scope': 'workspace' }
    }));

    expect(changedVersion.record.payloadFingerprint).not.toBe(baseline.record.payloadFingerprint);
    expect(changedOption.record.payloadFingerprint).not.toBe(baseline.record.payloadFingerprint);
    expect(reordered.record.payloadFingerprint).toBe(baseline.record.payloadFingerprint);
  });

  it.each([
    ['冪等鍵不是 UUID', validPayload({ idempotency_key: 'not-a-uuid' })],
    ['uuid 使用者參考不是 UUID', validPayload({ user_ref_type: 'uuid', user_ref: 'not-a-uuid' })],
    ['uid 使用者參考含控制字元', validPayload({ user_ref: 'user-1\nsecret' })],
    ['開始時間不是 RFC 3339', validPayload({ start_time: '2026-08-25' })],
    ['開始時間不是有效日曆日期', validPayload({ start_time: '2026-02-30T10:00:00.000Z' })],
    ['結束時間小時超過範圍', validPayload({ end_time: '2026-08-25T24:00:00Z' })],
    ['結束時間分鐘超過範圍', validPayload({ end_time: '2026-08-25T12:60:00Z' })],
    ['結束時間秒數超過範圍', validPayload({ end_time: '2026-08-25T12:00:60Z' })],
    ['結束時間早於開始時間', validPayload({ end_time: '2026-08-25T09:59:59.000Z' })],
    ['失敗事件缺少錯誤碼', validPayload({ status: 'failed' })],
    ['失敗事件使用未知錯誤碼', validPayload({ status: 'failed', error_code: 'bad_error' })]
  ])('拒絕%s', async (_reason, payload) => {
    const { service } = createService();

    await expect(service.ingest(payload)).rejects.toMatchObject({
      statusCode: 400,
      code: 'INVALID_TELEMETRY_PAYLOAD'
    });
  });

  it.each([
    ['exit_23', 'E999'],
    ['powershell_error', 'E999'],
    ['E003', 'E003']
  ] as const)('failed 將 %s 正規化為 %s', async (sourceError, expectedError) => {
    const { service } = createService();

    const receipt = await service.ingest(validPayload({
      status: 'failed',
      error_code: sourceError
    }));

    expect(receipt.record.errorCode).toBe(expectedError);
  });

  it.each([
    ['exit_23', 'E999'],
    ['powershell_error', 'E999']
  ] as const)('公開 TelemetryReport 可傳入 legacy %s 並映射為 %s', async (sourceError, expectedError) => {
    const { service } = createService();

    const receipt = await service.ingest(legacyFailedPayload(sourceError));

    expect(receipt.record.errorCode).toBe(expectedError);
  });

  it('接受數日前事件且 fingerprint 不受接收時間與額外欄位影響', async () => {
    const first = createService();
    const second = createService();
    const payload = validPayload({
      start_time: '2026-08-20T10:00:00.000Z',
      end_time: '2026-08-20T10:01:00.000Z'
    });

    const accepted = await first.service.ingest(payload);
    const withDroppedField = await second.service.ingest({ ...payload, secret: '不得記錄' });

    expect(accepted.record.startedAt).toEqual(new Date('2026-08-20T10:00:00.000Z'));
    expect(withDroppedField.droppedFields).toEqual(['secret']);
    expect(withDroppedField.record.payloadFingerprint).toBe(accepted.record.payloadFingerprint);
  });
});
