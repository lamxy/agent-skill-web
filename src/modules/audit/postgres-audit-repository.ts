// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { and, desc, eq, gt, lt, or, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import type {
  AuditRepository,
  AuditRepositoryListInput
} from './repository.js';
import type {
  AuditEventType,
  AuditLog,
  AuditTargetType,
  RecordAuditInput
} from './types.js';
import * as schema from '../../shared/database/schema.js';

type AuditDatabase = NodePgDatabase<typeof schema>;

function mapAuditLog(row: typeof schema.auditLogs.$inferSelect): AuditLog {
  return {
    id: String(row.id),
    eventType: row.eventType as AuditEventType,
    actorUid: row.actorUid,
    targetType: row.targetType as AuditTargetType,
    targetId: row.targetId,
    action: row.action,
    details: row.details,
    ...(row.ipAddress ? { ipAddress: row.ipAddress } : {}),
    ...(row.userAgent ? { userAgent: row.userAgent } : {}),
    occurredAt: row.occurredAt
  };
}

export class PostgresAuditRepository implements AuditRepository {
  constructor(private readonly database: AuditDatabase) {}

  async append(
    input: Required<Pick<RecordAuditInput, 'occurredAt'>> & RecordAuditInput
  ): Promise<AuditLog> {
    const rows = await this.database
      .insert(schema.auditLogs)
      .values({
        eventType: input.eventType,
        actorUid: input.actorUid,
        targetType: input.targetType,
        targetId: input.targetId,
        action: input.action,
        details: input.details,
        ...(input.ipAddress ? { ipAddress: input.ipAddress } : {}),
        ...(input.userAgent ? { userAgent: input.userAgent } : {}),
        occurredAt: input.occurredAt
      })
      .returning();
    const created = rows[0];
    if (!created) {
      throw new Error('審計事件寫入後未返回記錄');
    }
    return mapAuditLog(created);
  }

  async list(input: AuditRepositoryListInput): Promise<AuditLog[]> {
    const conditions: SQL[] = [];
    if (input.eventType) {
      conditions.push(eq(schema.auditLogs.eventType, input.eventType));
    }
    if (input.actorUid) {
      conditions.push(eq(schema.auditLogs.actorUid, input.actorUid));
    }
    if (input.targetType) {
      conditions.push(eq(schema.auditLogs.targetType, input.targetType));
    }
    if (input.targetId) {
      conditions.push(eq(schema.auditLogs.targetId, input.targetId));
    }
    if (input.from) {
      conditions.push(gt(schema.auditLogs.occurredAt, input.from));
    }
    if (input.to) {
      conditions.push(lt(schema.auditLogs.occurredAt, input.to));
    }
    if (input.cursor) {
      conditions.push(
        or(
          lt(schema.auditLogs.occurredAt, input.cursor.occurredAt),
          and(
            eq(schema.auditLogs.occurredAt, input.cursor.occurredAt),
            lt(schema.auditLogs.id, BigInt(input.cursor.id))
          )
        ) as SQL
      );
    }

    const query = this.database
      .select()
      .from(schema.auditLogs)
      .orderBy(desc(schema.auditLogs.occurredAt), desc(schema.auditLogs.id))
      .limit(input.limit);
    const rows =
      conditions.length > 0 ? await query.where(and(...conditions)) : await query;
    return rows.map(mapAuditLog);
  }
}
