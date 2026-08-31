// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

export type SupportChannelType = 'im_group' | 'email' | 'ticket_system' | 'doc';

export interface SupportChannel {
  id: string;
  packageId: string;
  channelType: SupportChannelType;
  label: string;
  address: string;
  instructions?: string;
  displayOrder: number;
  updatedByUid: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface SupportChannelContent {
  channelType: SupportChannelType;
  label: string;
  address: string;
  instructions?: string;
  displayOrder: number;
}

export type FeedbackIssueCategory =
  | 'install_failure'
  | 'uninstall_failure'
  | 'documentation'
  | 'performance'
  | 'compatibility'
  | 'feature_request'
  | 'other';

export type FeedbackStatus = 'open' | 'acknowledged' | 'resolved';

export const FEEDBACK_ISSUE_CATEGORIES: FeedbackIssueCategory[] = [
  'install_failure',
  'uninstall_failure',
  'documentation',
  'performance',
  'compatibility',
  'feature_request',
  'other'
];

export const SUPPORT_CHANNEL_TYPES: SupportChannelType[] = [
  'im_group',
  'email',
  'ticket_system',
  'doc'
];

export interface FeedbackRecord {
  id: string;
  packageId: string;
  version: string;
  authorRefType: 'uid' | 'uuid';
  authorRef: string;
  satisfaction: number;
  issueCategory: FeedbackIssueCategory;
  detail: string;
  needsHumanSupport: boolean;
  status: FeedbackStatus;
  createdAt: Date;
}

export interface SubmitFeedbackInput {
  packageId: string;
  version: string;
  satisfaction: number;
  issueCategory: FeedbackIssueCategory;
  detail: string;
  needsHumanSupport: boolean;
}

export interface FeedbackListFilters {
  packageId: string;
  version?: string;
  issueCategory?: FeedbackIssueCategory;
  needsHumanSupport?: boolean;
  status?: FeedbackStatus;
}

export interface FeedbackCategoryCount {
  issueCategory: FeedbackIssueCategory;
  count: number;
}

export interface FeedbackSatisfactionBucket {
  satisfaction: number;
  count: number;
}

/**
 * 反饋統計。滿意度為自願填寫的自我聲明，樣本不代表全體使用者，
 * 與遙測同屬 best-effort，前端必須標示參考性質。
 */
export interface FeedbackSummary {
  packageId: string;
  total: number;
  averageSatisfaction: number | null;
  satisfactionDistribution: FeedbackSatisfactionBucket[];
  byCategory: FeedbackCategoryCount[];
  needsHumanSupport: number;
  openNeedsHumanSupport: number;
}
