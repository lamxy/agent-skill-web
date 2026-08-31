// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import type {
  AuditRepository,
  AuditRepositoryListInput
} from './repository.js';
import type { AuditLog, RecordAuditInput } from './types.js';

function cloneAuditLog(log: AuditLog): AuditLog {
  return {
    ...log,
    details: structuredClone(log.details),
    occurredAt: new Date(log.occurredAt)
  };
}

function compareIdsDescending(left: string, right: string): number {
  if (/^\d+$/.test(left) && /^\d+$/.test(right)) {
    const leftId = BigInt(left);
    const rightId = BigInt(right);
    return leftId === rightId ? 0 : leftId > rightId ? -1 : 1;
  }
  return right.localeCompare(left);
}

function compareLogsDescending(left: AuditLog, right: AuditLog): number {
  const byTime = right.occurredAt.getTime() - left.occurredAt.getTime();
  return byTime === 0 ? compareIdsDescending(left.id, right.id) : byTime;
}

export class MemoryAuditRepository implements AuditRepository {
  private readonly logs: AuditLog[];
  private nextId: bigint;

  constructor(logs: AuditLog[] = []) {
    this.logs = logs.map(cloneAuditLog);
    const numericIds = logs
      .map((log) => (/^\d+$/.test(log.id) ? BigInt(log.id) : 0n));
    this.nextId = numericIds.reduce(
      (largest, id) => (id > largest ? id : largest),
      0n
    ) + 1n;
  }

  async append(
    input: Required<Pick<RecordAuditInput, 'occurredAt'>> & RecordAuditInput
  ): Promise<AuditLog> {
    const log: AuditLog = {
      id: String(this.nextId++),
      eventType: input.eventType,
      actorUid: input.actorUid,
      targetType: input.targetType,
      targetId: input.targetId,
      action: input.action,
      details: structuredClone(input.details),
      ...(input.ipAddress ? { ipAddress: input.ipAddress } : {}),
      ...(input.userAgent ? { userAgent: input.userAgent } : {}),
      occurredAt: new Date(input.occurredAt)
    };
    this.logs.push(log);
    return cloneAuditLog(log);
  }

  async list(input: AuditRepositoryListInput): Promise<AuditLog[]> {
    return this.logs
      .filter((log) => {
        if (input.eventType && log.eventType !== input.eventType) return false;
        if (input.actorUid && log.actorUid !== input.actorUid) return false;
        if (input.targetType && log.targetType !== input.targetType) return false;
        if (input.targetId && log.targetId !== input.targetId) return false;
        if (input.from && log.occurredAt < input.from) return false;
        if (input.to && log.occurredAt > input.to) return false;
        if (input.cursor) {
          const time = log.occurredAt.getTime();
          const cursorTime = input.cursor.occurredAt.getTime();
          if (time > cursorTime) return false;
          if (
            time === cursorTime &&
            compareIdsDescending(log.id, input.cursor.id) <= 0
          ) {
            return false;
          }
        }
        return true;
      })
      .sort(compareLogsDescending)
      .slice(0, input.limit)
      .map(cloneAuditLog);
  }
}
