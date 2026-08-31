// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import type { AuditRepository } from './repository.js';
import type {
  AuditCursor,
  AuditListInput,
  AuditPage,
  RecordAuditInput
} from './types.js';
import { AppError } from '../../shared/errors/app-error.js';

function encodeCursor(cursor: AuditCursor): string {
  return Buffer.from(
    JSON.stringify({ occurredAt: cursor.occurredAt.toISOString(), id: cursor.id })
  ).toString('base64url');
}

function decodeCursor(value: string): AuditCursor {
  try {
    const decoded = JSON.parse(
      Buffer.from(value, 'base64url').toString('utf8')
    ) as { occurredAt?: unknown; id?: unknown };
    if (
      typeof decoded.occurredAt !== 'string' ||
      typeof decoded.id !== 'string'
    ) {
      throw new Error('游標欄位不完整');
    }
    const occurredAt = new Date(decoded.occurredAt);
    if (Number.isNaN(occurredAt.getTime()) || !/^\d+$/.test(decoded.id)) {
      throw new Error('游標內容無效');
    }
    return { occurredAt, id: decoded.id };
  } catch (error) {
    throw new AppError({
      statusCode: 400,
      code: 'INVALID_AUDIT_CURSOR',
      message: '審計分頁游標無效',
      cause: error
    });
  }
}

export class AuditService {
  constructor(
    private readonly repository: AuditRepository,
    private readonly clock: () => Date = () => new Date()
  ) {}

  async record(input: RecordAuditInput) {
    return this.repository.append({
      ...input,
      occurredAt: input.occurredAt ?? this.clock()
    });
  }

  async list(input: AuditListInput): Promise<AuditPage> {
    const cursor = input.cursor ? decodeCursor(input.cursor) : undefined;
    const rows = await this.repository.list({
      ...(input.eventType ? { eventType: input.eventType } : {}),
      ...(input.actorUid ? { actorUid: input.actorUid } : {}),
      ...(input.targetType ? { targetType: input.targetType } : {}),
      ...(input.targetId ? { targetId: input.targetId } : {}),
      ...(input.from ? { from: input.from } : {}),
      ...(input.to ? { to: input.to } : {}),
      ...(cursor ? { cursor } : {}),
      limit: input.limit + 1
    });
    const items = rows.slice(0, input.limit);
    const last = items.at(-1);
    return {
      items,
      ...(rows.length > input.limit && last
        ? {
            nextCursor: encodeCursor({
              occurredAt: last.occurredAt,
              id: last.id
            })
          }
        : {})
    };
  }
}
