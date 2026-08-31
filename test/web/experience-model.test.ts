// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { describe, expect, it } from 'vitest';

import { buildFeedbackPath } from '../../web/src/api/experience.js';
import type {
  FeedbackRecord,
  ScriptTargetDiff,
  UserNotification
} from '../../web/src/api/types.js';
import {
  diffFlags,
  filterFeedback,
  filterNotifications,
  hasOptionChanges,
  payloadText,
  toSupportChannelPayload,
  validateFeedback,
  validateSupportChannels,
  versionDiffPath,
  type SupportChannelDraft
} from '../../web/src/pages/experience-model.js';

const imChannel: SupportChannelDraft = {
  channelType: 'im_group',
  label: '技能支援群',
  address: 'https://im.example.invalid/g/skill-support',
  displayOrder: 0
};

describe('支援渠道模型', () => {
  it('擋下空白名稱或位址，不發出必然失敗的請求', () => {
    expect(validateSupportChannels([{ ...imChannel, label: '   ' }])).toMatch(/必填/);
    expect(validateSupportChannels([{ ...imChannel, address: ' ' }])).toMatch(/必填/);
  });

  it('擋下同類型下重複的位址', () => {
    expect(
      validateSupportChannels([imChannel, { ...imChannel, label: '重複群' }])
    ).toMatch(/不能重複/);
  });

  it('同位址但不同渠道類型視為合法', () => {
    expect(
      validateSupportChannels([
        imChannel,
        { ...imChannel, channelType: 'doc', label: '說明文件' }
      ])
    ).toBeUndefined();
  });

  it('超過十筆時擋下', () => {
    const many = Array.from({ length: 11 }, (_, index) => ({
      ...imChannel,
      address: `https://im.example.invalid/g/${index}`
    }));
    expect(validateSupportChannels(many)).toMatch(/最多/);
  });

  it('送出前去除空白、重編順序並丟掉本地 id', () => {
    const payload = toSupportChannelPayload([
      { ...imChannel, id: 'existing', label: '  技能支援群  ', displayOrder: 9 },
      {
        channelType: 'email',
        label: '支援信箱',
        address: '  support@example.invalid ',
        instructions: '   ',
        displayOrder: 3
      }
    ]);

    expect(payload).toEqual([
      {
        channelType: 'im_group',
        label: '技能支援群',
        address: 'https://im.example.invalid/g/skill-support',
        displayOrder: 0
      },
      {
        channelType: 'email',
        label: '支援信箱',
        address: 'support@example.invalid',
        displayOrder: 1
      }
    ]);
    expect(payload[0]).not.toHaveProperty('id');
    // 全空白的補充說明不送出空字串欄位
    expect(payload[1]).not.toHaveProperty('instructions');
  });
});

describe('反饋模型', () => {
  it('滿意度、分類與描述皆為必填', () => {
    expect(
      validateFeedback({
        satisfaction: null, issueCategory: 'other', detail: 'x', needsHumanSupport: false
      })
    ).toMatch(/滿意度/);
    expect(
      validateFeedback({
        satisfaction: 3, issueCategory: '', detail: 'x', needsHumanSupport: false
      })
    ).toMatch(/分類/);
    expect(
      validateFeedback({
        satisfaction: 3, issueCategory: 'other', detail: '   ', needsHumanSupport: false
      })
    ).toMatch(/空白/);
    expect(
      validateFeedback({
        satisfaction: 3, issueCategory: 'other', detail: '可行的描述', needsHumanSupport: false
      })
    ).toBeUndefined();
  });

  it('只把後端支援的篩選送進查詢字串', () => {
    expect(buildFeedbackPath('pkg-one', {})).toBe('/api/packages/pkg-one/feedback');
    expect(
      buildFeedbackPath('pkg-one', {
        issueCategory: 'install_failure',
        needsHumanSupport: false,
        status: 'open'
      })
    ).toBe(
      '/api/packages/pkg-one/feedback?issueCategory=install_failure&needsHumanSupport=false&status=open'
    );
  });

  it('needsHumanSupport 為 false 時仍要送出，不能被當成未設定', () => {
    expect(buildFeedbackPath('pkg-one', { needsHumanSupport: false })).toContain(
      'needsHumanSupport=false'
    );
  });

  it('依分類、人工協助與狀態篩選明細', () => {
    const base: FeedbackRecord = {
      id: 'f1', packageId: 'pkg-one', version: '1.0.0',
      authorRefType: 'uid', authorRef: 'employee-1', satisfaction: 3,
      issueCategory: 'documentation', detail: 'a',
      needsHumanSupport: false, status: 'open', createdAt: '2026-08-29T00:00:00.000Z'
    };
    const records: FeedbackRecord[] = [
      base,
      { ...base, id: 'f2', issueCategory: 'install_failure', needsHumanSupport: true },
      { ...base, id: 'f3', status: 'resolved' }
    ];

    expect(filterFeedback(records, {})).toHaveLength(3);
    expect(filterFeedback(records, { issueCategory: 'install_failure' })).toHaveLength(1);
    expect(filterFeedback(records, { needsHumanSupport: true })).toHaveLength(1);
    expect(filterFeedback(records, { needsHumanSupport: false })).toHaveLength(2);
    expect(filterFeedback(records, { status: 'resolved' })).toHaveLength(1);
  });
});

function targetDiff(overrides: Partial<ScriptTargetDiff> = {}): ScriptTargetDiff {
  return {
    targetOs: 'linux/macos',
    clientRuntime: 'codex',
    change: 'changed',
    installCommandChanged: true,
    uninstallCommandChanged: false,
    usageInstructionsChanged: false,
    residualEffectsChanged: false,
    addedOptions: [],
    removedOptions: [],
    changedOptions: [],
    ...overrides
  };
}

describe('升級差異模型', () => {
  it('旗標順序固定且反映各項變更', () => {
    expect(diffFlags(targetDiff())).toEqual([
      { label: '安裝命令', changed: true },
      { label: '解除安裝命令', changed: false },
      { label: '使用說明', changed: false },
      { label: '殘留副作用', changed: false }
    ]);
  });

  it('任一種選項異動都算有變更', () => {
    expect(hasOptionChanges(targetDiff())).toBe(false);
    expect(
      hasOptionChanges(
        targetDiff({
          addedOptions: [
            { name: '--scope', type: 'text', description: 'a', defaultValue: '' }
          ]
        })
      )
    ).toBe(true);
    expect(
      hasOptionChanges(
        targetDiff({
          removedOptions: [
            { name: '--scope', type: 'text', description: 'a', defaultValue: '' }
          ]
        })
      )
    ).toBe(true);
    expect(
      hasOptionChanges(
        targetDiff({
          changedOptions: [
            {
              name: '--scope',
              current: { name: '--scope', type: 'text', description: 'a', defaultValue: '' },
              target: { name: '--scope', type: 'text', description: 'b', defaultValue: '' }
            }
          ]
        })
      )
    ).toBe(true);
  });

  it('差異路徑對版本號做編碼', () => {
    expect(versionDiffPath('pkg-one', '1.0.0', '2.0.0')).toBe(
      '/packages/pkg-one/versions/1.0.0/diff/2.0.0'
    );
    expect(versionDiffPath('pkg-one', '1.0.0+build/1', '2.0.0')).toBe(
      '/packages/pkg-one/versions/1.0.0%2Bbuild%2F1/diff/2.0.0'
    );
  });
});

function notification(overrides: Partial<UserNotification> = {}): UserNotification {
  return {
    id: 'n1',
    recipientUid: 'employee-1',
    notificationType: 'version_published',
    packageId: 'pkg-one',
    version: '2.0.0',
    payload: {},
    status: 'unread',
    createdAt: '2026-08-29T00:00:00.000Z',
    ...overrides
  };
}

describe('通知模型', () => {
  it('依未讀、新版本與風險類分流', () => {
    const items = [
      notification(),
      notification({ id: 'n2', status: 'read' }),
      notification({ id: 'n3', notificationType: 'version_delisted' }),
      notification({ id: 'n4', notificationType: 'version_emergency_disabled' })
    ];

    expect(filterNotifications(items, 'all')).toHaveLength(4);
    expect(filterNotifications(items, 'unread').map((item) => item.id)).toEqual([
      'n1', 'n3', 'n4'
    ]);
    expect(filterNotifications(items, 'upgrade').map((item) => item.id)).toEqual([
      'n1', 'n2'
    ]);
    expect(filterNotifications(items, 'risk').map((item) => item.id)).toEqual([
      'n3', 'n4'
    ]);
  });

  it('payload 取值必須容忍缺欄位與非字串', () => {
    expect(payloadText(notification(), 'installedVersion')).toBeUndefined();
    expect(
      payloadText(notification({ payload: { installedVersion: '1.0.0' } }), 'installedVersion')
    ).toBe('1.0.0');
    // 舊通知可能沒有該欄位，或型別不是字串；不得直接當字串用
    expect(
      payloadText(notification({ payload: { installedVersion: 3 } }), 'installedVersion')
    ).toBeUndefined();
    expect(
      payloadText(notification({ payload: { installedVersion: '  ' } }), 'installedVersion')
    ).toBeUndefined();
  });
});
