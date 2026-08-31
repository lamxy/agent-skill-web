// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { randomUUID } from 'node:crypto';

import { and, asc, desc, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import * as schema from '../../shared/database/schema.js';
import type {
  ExperienceRepository,
  SaveSupportChannelsInput,
  SubmitFeedbackCommand,
  UpdateFeedbackStatusInput
} from './repository.js';
import type {
  FeedbackIssueCategory,
  FeedbackListFilters,
  FeedbackRecord,
  FeedbackStatus,
  SupportChannel,
  SupportChannelType
} from './types.js';

type ExperienceDatabase = NodePgDatabase<typeof schema>;

function mapChannel(
  row: typeof schema.packageSupportChannels.$inferSelect
): SupportChannel {
  return {
    id: row.id,
    packageId: row.packageId,
    channelType: row.channelType as SupportChannelType,
    label: row.label,
    address: row.address,
    ...(row.instructions ? { instructions: row.instructions } : {}),
    displayOrder: row.displayOrder,
    updatedByUid: row.updatedByUid,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function mapFeedback(
  row: typeof schema.packageFeedback.$inferSelect
): FeedbackRecord {
  return {
    id: row.id,
    packageId: row.packageId,
    version: row.version,
    authorRefType: row.authorRefType as 'uid' | 'uuid',
    authorRef: row.authorRef,
    satisfaction: row.satisfaction,
    issueCategory: row.issueCategory as FeedbackIssueCategory,
    detail: row.detail,
    needsHumanSupport: row.needsHumanSupport,
    status: row.status as FeedbackStatus,
    createdAt: row.createdAt
  };
}

export class PostgresExperienceRepository implements ExperienceRepository {
  constructor(private readonly database: ExperienceDatabase) {}

  async listSupportChannels(packageId: string): Promise<SupportChannel[]> {
    const rows = await this.database
      .select()
      .from(schema.packageSupportChannels)
      .where(eq(schema.packageSupportChannels.packageId, packageId))
      .orderBy(
        asc(schema.packageSupportChannels.displayOrder),
        asc(schema.packageSupportChannels.createdAt)
      );
    return rows.map(mapChannel);
  }

  /**
   * 整組覆寫。先刪後插保持「送出的清單即為完整結果」語義；
   * 同一交易內寫 audit 與 outbox，避免只留下一半狀態。
   */
  async saveSupportChannels(
    input: SaveSupportChannelsInput
  ): Promise<SupportChannel[]> {
    return this.database.transaction(async (transaction) => {
      const existing = await transaction
        .select()
        .from(schema.packageSupportChannels)
        .where(eq(schema.packageSupportChannels.packageId, input.packageId));
      const previousIds = new Map(
        existing.map((row) => [`${row.channelType}::${row.address}`, row])
      );

      await transaction
        .delete(schema.packageSupportChannels)
        .where(eq(schema.packageSupportChannels.packageId, input.packageId));

      const rows = input.channels.length === 0
        ? []
        : await transaction
            .insert(schema.packageSupportChannels)
            .values(input.channels.map((channel) => {
              const previous = previousIds.get(
                `${channel.channelType}::${channel.address}`
              );
              return {
                id: previous?.id ?? randomUUID(),
                packageId: input.packageId,
                channelType: channel.channelType,
                label: channel.label,
                address: channel.address,
                instructions: channel.instructions ?? null,
                displayOrder: channel.displayOrder,
                updatedByUid: input.actorUid,
                createdAt: previous?.createdAt ?? input.occurredAt,
                updatedAt: input.occurredAt
              };
            }))
            .returning();

      await transaction.insert(schema.auditLogs).values({
        eventType: 'support_channel.replaced',
        actorUid: input.actorUid,
        targetType: 'support_channel',
        targetId: input.packageId,
        action: 'replace_support_channels',
        details: {
          channelCount: input.channels.length,
          channelTypes: input.channels.map((channel) => channel.channelType)
        },
        occurredAt: input.occurredAt
      });
      await transaction.insert(schema.domainEvents).values({
        aggregateType: 'package',
        aggregateId: input.packageId,
        eventType: 'support_channel.replaced',
        payload: {
          actorUid: input.actorUid,
          packageId: input.packageId,
          channelCount: input.channels.length
        },
        occurredAt: input.occurredAt
      });

      return rows.map(mapChannel).sort(
        (left, right) =>
          left.displayOrder - right.displayOrder ||
          left.createdAt.getTime() - right.createdAt.getTime()
      );
    });
  }

  /**
   * 反饋不寫 audit：提交者可能是匿名 UUID，而 audit_logs 的語義是
   * 具名操作者的不可抵賴紀錄。反饋本身即是明細，供維護者查詢。
   */
  async submitFeedback(input: SubmitFeedbackCommand): Promise<FeedbackRecord> {
    const rows = await this.database
      .insert(schema.packageFeedback)
      .values({
        id: randomUUID(),
        packageId: input.packageId,
        version: input.version,
        authorRefType: input.authorRefType,
        authorRef: input.authorRef,
        satisfaction: input.satisfaction,
        issueCategory: input.issueCategory,
        detail: input.detail,
        needsHumanSupport: input.needsHumanSupport,
        status: 'open',
        createdAt: input.occurredAt
      })
      .returning();
    return mapFeedback(rows[0]!);
  }

  async listFeedback(filters: FeedbackListFilters): Promise<FeedbackRecord[]> {
    const conditions = [eq(schema.packageFeedback.packageId, filters.packageId)];
    if (filters.version !== undefined) {
      conditions.push(eq(schema.packageFeedback.version, filters.version));
    }
    if (filters.issueCategory !== undefined) {
      conditions.push(
        eq(schema.packageFeedback.issueCategory, filters.issueCategory)
      );
    }
    if (filters.needsHumanSupport !== undefined) {
      conditions.push(
        eq(schema.packageFeedback.needsHumanSupport, filters.needsHumanSupport)
      );
    }
    if (filters.status !== undefined) {
      conditions.push(eq(schema.packageFeedback.status, filters.status));
    }
    const rows = await this.database
      .select()
      .from(schema.packageFeedback)
      .where(and(...conditions))
      .orderBy(
        desc(schema.packageFeedback.createdAt),
        desc(schema.packageFeedback.id)
      );
    return rows.map(mapFeedback);
  }

  async findFeedback(feedbackId: string): Promise<FeedbackRecord | undefined> {
    const rows = await this.database
      .select()
      .from(schema.packageFeedback)
      .where(eq(schema.packageFeedback.id, feedbackId))
      .limit(1);
    return rows[0] ? mapFeedback(rows[0]) : undefined;
  }

  async updateFeedbackStatus(
    input: UpdateFeedbackStatusInput
  ): Promise<FeedbackRecord | undefined> {
    return this.database.transaction(async (transaction) => {
      const rows = await transaction
        .update(schema.packageFeedback)
        .set({ status: input.status })
        .where(eq(schema.packageFeedback.id, input.feedbackId))
        .returning();
      if (!rows[0]) return undefined;

      await transaction.insert(schema.auditLogs).values({
        eventType: 'feedback.status_changed',
        actorUid: input.actorUid,
        targetType: 'feedback',
        targetId: input.feedbackId,
        action: 'update_feedback_status',
        details: { status: input.status, packageId: rows[0].packageId },
        occurredAt: input.occurredAt
      });
      return mapFeedback(rows[0]);
    });
  }
}
