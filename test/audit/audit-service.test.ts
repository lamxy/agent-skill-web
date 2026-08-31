// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { describe, expect, it } from 'vitest';

import { AuditService } from '../../src/modules/audit/audit-service.js';
import { MemoryAuditRepository } from '../../src/modules/audit/memory-audit-repository.js';
import type { AuditLog } from '../../src/modules/audit/types.js';

function log(
  id: string,
  occurredAt: string,
  overrides: Partial<AuditLog> = {}
): AuditLog {
  return {
    id,
    eventType: 'reviewer.assigned',
    actorUid: 'admin-1',
    targetType: 'role',
    targetId: 'assignment-1',
    action: 'assign_reviewer',
    details: { category: 'frontend' },
    occurredAt: new Date(occurredAt),
    ...overrides
  };
}

describe('AuditService', () => {
  it('寫入完整的結構化審計事件', async () => {
    const repository = new MemoryAuditRepository();
    const service = new AuditService(repository, () =>
      new Date('2026-08-25T03:00:00.000Z')
    );

    const created = await service.record({
      eventType: 'admin.role_granted',
      actorUid: 'admin-1',
      targetType: 'role',
      targetId: 'role-1',
      action: 'grant_role',
      details: { role: 'reviewer' },
      ipAddress: '127.0.0.1',
      userAgent: 'vitest'
    });

    expect(created).toEqual({
      id: '1',
      eventType: 'admin.role_granted',
      actorUid: 'admin-1',
      targetType: 'role',
      targetId: 'role-1',
      action: 'grant_role',
      details: { role: 'reviewer' },
      ipAddress: '127.0.0.1',
      userAgent: 'vitest',
      occurredAt: new Date('2026-08-25T03:00:00.000Z')
    });
  });

  it('組合套用事件、操作者、目標與時間範圍過濾', async () => {
    const repository = new MemoryAuditRepository([
      log('1', '2026-08-25T01:00:00.000Z'),
      log('2', '2026-08-25T02:00:00.000Z', {
        eventType: 'reviewer.revoked'
      }),
      log('3', '2026-08-25T03:00:00.000Z', {
        actorUid: 'admin-2',
        targetId: 'assignment-2'
      })
    ]);
    const service = new AuditService(repository);

    const page = await service.list({
      eventType: 'reviewer.assigned',
      actorUid: 'admin-1',
      targetType: 'role',
      targetId: 'assignment-1',
      from: new Date('2026-08-25T00:30:00.000Z'),
      to: new Date('2026-08-25T01:30:00.000Z'),
      limit: 20
    });

    expect(page).toEqual({
      items: [log('1', '2026-08-25T01:00:00.000Z')]
    });
  });

  it('以 occurredAt 與 id 的穩定游標分頁且不重複資料', async () => {
    const repository = new MemoryAuditRepository([
      log('1', '2026-08-25T01:00:00.000Z'),
      log('2', '2026-08-25T02:00:00.000Z'),
      log('3', '2026-08-25T03:00:00.000Z')
    ]);
    const service = new AuditService(repository);

    const first = await service.list({ limit: 2 });
    if (!first.nextCursor) throw new Error('第一頁缺少下一頁游標');
    const second = await service.list({ limit: 2, cursor: first.nextCursor });

    expect(first.items.map((item) => item.id)).toEqual(['3', '2']);
    expect(first.nextCursor).toEqual(expect.any(String));
    expect(second).toEqual({
      items: [log('1', '2026-08-25T01:00:00.000Z')]
    });
  });
});
