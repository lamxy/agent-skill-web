// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import type {
  FeedbackListFilters,
  FeedbackRecord,
  FeedbackStatus,
  SubmitFeedbackInput,
  SupportChannel,
  SupportChannelContent
} from './types.js';

export interface SaveSupportChannelsInput {
  packageId: string;
  channels: SupportChannelContent[];
  actorUid: string;
  occurredAt: Date;
}

export interface SubmitFeedbackCommand extends SubmitFeedbackInput {
  authorRefType: 'uid' | 'uuid';
  authorRef: string;
  occurredAt: Date;
}

export interface UpdateFeedbackStatusInput {
  feedbackId: string;
  status: FeedbackStatus;
  actorUid: string;
  occurredAt: Date;
}

export interface ExperienceRepository {
  listSupportChannels(packageId: string): Promise<SupportChannel[]>;
  /** 整組覆寫：維護者送出的清單即為完整結果，缺席者視為刪除。 */
  saveSupportChannels(input: SaveSupportChannelsInput): Promise<SupportChannel[]>;
  submitFeedback(input: SubmitFeedbackCommand): Promise<FeedbackRecord>;
  listFeedback(filters: FeedbackListFilters): Promise<FeedbackRecord[]>;
  findFeedback(feedbackId: string): Promise<FeedbackRecord | undefined>;
  updateFeedbackStatus(
    input: UpdateFeedbackStatusInput
  ): Promise<FeedbackRecord | undefined>;
}
