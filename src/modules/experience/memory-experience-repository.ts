// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { randomUUID } from 'node:crypto';

import type {
  ExperienceRepository,
  SaveSupportChannelsInput,
  SubmitFeedbackCommand,
  UpdateFeedbackStatusInput
} from './repository.js';
import type {
  FeedbackListFilters,
  FeedbackRecord,
  SupportChannel
} from './types.js';

function clone<T>(value: T): T {
  return structuredClone(value);
}

function byDisplayOrder(left: SupportChannel, right: SupportChannel): number {
  return (
    left.displayOrder - right.displayOrder ||
    left.createdAt.getTime() - right.createdAt.getTime() ||
    left.id.localeCompare(right.id)
  );
}

function newestFirst(left: FeedbackRecord, right: FeedbackRecord): number {
  return (
    right.createdAt.getTime() - left.createdAt.getTime() ||
    right.id.localeCompare(left.id)
  );
}

export class MemoryExperienceRepository implements ExperienceRepository {
  private readonly channels = new Map<string, SupportChannel[]>();
  private readonly feedback: FeedbackRecord[] = [];

  async listSupportChannels(packageId: string): Promise<SupportChannel[]> {
    return clone(this.channels.get(packageId) ?? []).sort(byDisplayOrder);
  }

  async saveSupportChannels(
    input: SaveSupportChannelsInput
  ): Promise<SupportChannel[]> {
    const existing = this.channels.get(input.packageId) ?? [];
    const saved = input.channels.map((channel): SupportChannel => {
      const previous = existing.find(
        (candidate) =>
          candidate.channelType === channel.channelType &&
          candidate.address === channel.address
      );
      return {
        id: previous?.id ?? randomUUID(),
        packageId: input.packageId,
        ...channel,
        updatedByUid: input.actorUid,
        createdAt: previous?.createdAt ?? new Date(input.occurredAt),
        updatedAt: new Date(input.occurredAt)
      };
    });
    this.channels.set(input.packageId, saved);
    return clone(saved).sort(byDisplayOrder);
  }

  async submitFeedback(input: SubmitFeedbackCommand): Promise<FeedbackRecord> {
    const record: FeedbackRecord = {
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
      createdAt: new Date(input.occurredAt)
    };
    this.feedback.push(record);
    return clone(record);
  }

  async listFeedback(filters: FeedbackListFilters): Promise<FeedbackRecord[]> {
    return clone(
      this.feedback.filter(
        (record) =>
          record.packageId === filters.packageId &&
          (filters.version === undefined || record.version === filters.version) &&
          (filters.issueCategory === undefined ||
            record.issueCategory === filters.issueCategory) &&
          (filters.needsHumanSupport === undefined ||
            record.needsHumanSupport === filters.needsHumanSupport) &&
          (filters.status === undefined || record.status === filters.status)
      )
    ).sort(newestFirst);
  }

  async findFeedback(feedbackId: string): Promise<FeedbackRecord | undefined> {
    const record = this.feedback.find((candidate) => candidate.id === feedbackId);
    return record ? clone(record) : undefined;
  }

  async updateFeedbackStatus(
    input: UpdateFeedbackStatusInput
  ): Promise<FeedbackRecord | undefined> {
    const record = this.feedback.find(
      (candidate) => candidate.id === input.feedbackId
    );
    if (!record) return undefined;
    record.status = input.status;
    return clone(record);
  }
}
