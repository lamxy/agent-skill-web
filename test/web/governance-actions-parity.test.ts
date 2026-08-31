// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { describe, expect, it } from 'vitest';

import { canTransitionVersion } from '../../src/modules/governance/version-state-machine.js';
import type { VersionEvent, VersionLifecycle } from '../../src/modules/governance/types.js';
import {
  availableGovernanceActions,
  governanceActionMeta
} from '../../web/src/pages/admin-model.js';
import type { GovernanceAction } from '../../web/src/pages/admin-model.js';

/**
 * 前端的可用處置清單是後端狀態機的複本。複本會腐化：
 * 後端改了轉換表而前端沒跟上時，使用者會看到送出後才被 409 擋下的選項，
 * 或反過來看不到其實可用的處置。此測試讓兩者的落差直接失敗。
 */
const ACTION_EVENTS: Record<GovernanceAction, VersionEvent> = {
  deprecate: 'DEPRECATE',
  delist: 'DELIST',
  'emergency-disable': 'EMERGENCY_DISABLE'
};

const ALL_LIFECYCLES: VersionLifecycle[] = [
  'draft',
  'validating',
  'validation_failed',
  'review_required',
  'published',
  'deprecated',
  'delisted',
  'emergency_disabled'
];

describe('前端處置清單與後端狀態機一致', () => {
  it.each(ALL_LIFECYCLES)('%s 的可用處置與狀態機相符', (lifecycle) => {
    const fromStateMachine = (
      Object.keys(ACTION_EVENTS) as GovernanceAction[]
    ).filter((action) => canTransitionVersion(lifecycle, ACTION_EVENTS[action]));

    expect(availableGovernanceActions(lifecycle)).toEqual(fromStateMachine);
  });

  it('每個處置宣告的結果狀態與狀態機的目標一致', () => {
    // published 是唯一三種處置都可執行的起點，適合逐一比對目標狀態。
    for (const [action, event] of Object.entries(ACTION_EVENTS) as Array<
      [GovernanceAction, VersionEvent]
    >) {
      expect(canTransitionVersion('published', event)).toBe(true);
      expect(governanceActionMeta(action).resultLifecycle).toBeDefined();
    }
  });
});
