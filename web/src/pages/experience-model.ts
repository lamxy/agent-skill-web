// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import type {
  FeedbackIssueCategory,
  FeedbackRecord,
  FeedbackStatus,
  NotificationType,
  ScriptTargetChangeKind,
  ScriptTargetDiff,
  SupportChannelContent,
  SupportChannelType,
  UserNotification
} from '../api/types.js';

export const SUPPORT_CHANNEL_LABEL: Record<SupportChannelType, string> = {
  im_group: 'IM 群組',
  email: '電子郵件',
  ticket_system: '工單系統',
  doc: '說明文件'
};

export const FEEDBACK_CATEGORY_LABEL: Record<FeedbackIssueCategory, string> = {
  install_failure: '安裝失敗',
  uninstall_failure: '解除安裝失敗',
  documentation: '說明文件',
  performance: '效能',
  compatibility: '相容性',
  feature_request: '功能建議',
  other: '其他'
};

export const FEEDBACK_STATUS_LABEL: Record<FeedbackStatus, string> = {
  open: '待處理',
  acknowledged: '已受理',
  resolved: '已解決'
};

export const SATISFACTION_LABEL: Record<number, string> = {
  1: '很差',
  2: '不佳',
  3: '普通',
  4: '良好',
  5: '很好'
};

export const CHANGE_LABEL: Record<ScriptTargetChangeKind, string> = {
  added: '新增目標',
  removed: '移除目標',
  changed: '已變更',
  unchanged: '無變更'
};

export const MAX_SUPPORT_CHANNELS = 10;

export interface SupportChannelDraft extends SupportChannelContent {
  /** 既有渠道的 id；新增列為 undefined。僅供 React key 使用，不送往後端。 */
  id?: string;
}

/**
 * 前端先擋掉必然被後端拒絕的送出，避免無意義的網路請求。
 * 回傳 undefined 表示通過；否則回傳可直接顯示的錯誤訊息。
 */
export function validateSupportChannels(
  channels: SupportChannelDraft[]
): string | undefined {
  if (channels.length > MAX_SUPPORT_CHANNELS) {
    return `支援渠道最多 ${MAX_SUPPORT_CHANNELS} 筆。`;
  }
  if (channels.some((channel) => !channel.label.trim() || !channel.address.trim())) {
    return '每一列的顯示名稱與位址都必填。';
  }
  const seen = new Set<string>();
  for (const channel of channels) {
    const key = `${channel.channelType}::${channel.address.trim()}`;
    if (seen.has(key)) return '同一渠道類型下的位址不能重複。';
    seen.add(key);
  }
  return undefined;
}

/** 送出前正規化：去除空白、依畫面順序重編 displayOrder、丟掉本地 id。 */
export function toSupportChannelPayload(
  channels: SupportChannelDraft[]
): SupportChannelContent[] {
  return channels.map((channel, index) => {
    const instructions = channel.instructions?.trim();
    return {
      channelType: channel.channelType,
      label: channel.label.trim(),
      address: channel.address.trim(),
      ...(instructions ? { instructions } : {}),
      displayOrder: index
    };
  });
}

export interface FeedbackFormValue {
  satisfaction: number | null;
  issueCategory: FeedbackIssueCategory | '';
  detail: string;
  needsHumanSupport: boolean;
}

export function validateFeedback(value: FeedbackFormValue): string | undefined {
  if (!value.satisfaction) return '請選擇整體滿意度。';
  if (!value.issueCategory) return '請選擇問題分類。';
  if (!value.detail.trim()) return '詳細描述不能為空白。';
  return undefined;
}

export type FeedbackFilter = {
  issueCategory?: FeedbackIssueCategory;
  needsHumanSupport?: boolean;
  status?: FeedbackStatus;
};

export function filterFeedback(
  records: FeedbackRecord[],
  filter: FeedbackFilter
): FeedbackRecord[] {
  return records.filter(
    (record) =>
      (filter.issueCategory === undefined ||
        record.issueCategory === filter.issueCategory) &&
      (filter.needsHumanSupport === undefined ||
        record.needsHumanSupport === filter.needsHumanSupport) &&
      (filter.status === undefined || record.status === filter.status)
  );
}

/**
 * 差異頁的變更旗標。unchanged 的目標不需要逐項列旗標，
 * 但仍必須顯示在清單中，否則使用者無法確認該組合「確實沒變」。
 */
export function diffFlags(
  diff: ScriptTargetDiff
): Array<{ label: string; changed: boolean }> {
  return [
    { label: '安裝命令', changed: diff.installCommandChanged },
    { label: '解除安裝命令', changed: diff.uninstallCommandChanged },
    { label: '使用說明', changed: diff.usageInstructionsChanged },
    { label: '殘留副作用', changed: diff.residualEffectsChanged }
  ];
}

export function hasOptionChanges(diff: ScriptTargetDiff): boolean {
  return (
    diff.addedOptions.length > 0 ||
    diff.removedOptions.length > 0 ||
    diff.changedOptions.length > 0
  );
}

export function versionDiffPath(
  packageId: string,
  currentVersion: string,
  targetVersion: string
): string {
  return `/packages/${encodeURIComponent(packageId)}/versions/${encodeURIComponent(currentVersion)}/diff/${encodeURIComponent(targetVersion)}`;
}

interface NotificationCopy {
  title: string;
  tone: 'ok' | 'warn' | 'stop';
}

const NOTIFICATION_COPY: Record<NotificationType, NotificationCopy> = {
  version_published: { title: '有新版本可用', tone: 'ok' },
  version_delisted: { title: '版本已撤下', tone: 'warn' },
  version_emergency_disabled: { title: '版本緊急停用', tone: 'stop' }
};

export function notificationCopy(type: NotificationType): NotificationCopy {
  return NOTIFICATION_COPY[type];
}

/** payload 是後端的自由欄位，取值前必須確認型別，不能假設一定存在。 */
export function payloadText(
  notification: UserNotification,
  key: string
): string | undefined {
  const value = notification.payload[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

export type NotificationFilter = 'unread' | 'all' | 'upgrade' | 'risk';

export function filterNotifications(
  items: UserNotification[],
  filter: NotificationFilter
): UserNotification[] {
  if (filter === 'unread') return items.filter((item) => item.status === 'unread');
  if (filter === 'upgrade') {
    return items.filter((item) => item.notificationType === 'version_published');
  }
  if (filter === 'risk') {
    return items.filter((item) => item.notificationType !== 'version_published');
  }
  return items;
}
