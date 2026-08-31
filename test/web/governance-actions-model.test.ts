// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { afterEach, describe, expect, it } from 'vitest';

import {
  buildDeprecatePayload,
  buildVersionGovernancePath,
  delistVersion,
  deprecateVersion,
  emergencyDisableVersion
} from '../../web/src/api/admin.js';
import {
  GOVERNANCE_ACTIONS,
  availableGovernanceActions,
  governanceActionMeta,
  governanceUnavailableReason
} from '../../web/src/pages/admin-model.js';

describe('下架處置的可用性對照版本狀態機', () => {
  it('已發布版本三種處置都可執行', () => {
    expect(availableGovernanceActions('published')).toEqual([
      'deprecate',
      'delist',
      'emergency-disable'
    ]);
  });

  it('已棄用版本不能再棄用一次', () => {
    // 對照 version-state-machine 的 deprecated 轉換表。
    expect(availableGovernanceActions('deprecated')).toEqual([
      'delist',
      'emergency-disable'
    ]);
  });

  it('已撤下版本只剩緊急停用', () => {
    expect(availableGovernanceActions('delisted')).toEqual(['emergency-disable']);
  });

  it('緊急停用是最終狀態，沒有任何後續處置', () => {
    expect(availableGovernanceActions('emergency_disabled')).toEqual([]);
  });

  it.each(['draft', 'validating', 'validation_failed', 'review_required'] as const)(
    '未發布狀態 %s 沒有下架處置',
    (lifecycle) => {
      expect(availableGovernanceActions(lifecycle)).toEqual([]);
    }
  );
});

describe('無可用處置時說明原因', () => {
  it('緊急停用說明它是最終狀態', () => {
    expect(governanceUnavailableReason('emergency_disabled')).toContain('最終狀態');
  });

  it('未發布狀態說明只有已發布版本需要下架', () => {
    // 說「沒有權限」會誤導：權限沒問題，是狀態不適用。
    expect(governanceUnavailableReason('draft')).toContain('已發布');
  });
});

describe('處置的中繼資料', () => {
  it('每個處置的結果生命週期與狀態機一致', () => {
    expect(governanceActionMeta('deprecate').resultLifecycle).toBe('deprecated');
    expect(governanceActionMeta('delist').resultLifecycle).toBe('delisted');
    expect(governanceActionMeta('emergency-disable').resultLifecycle).toBe(
      'emergency_disabled'
    );
  });

  it('只有緊急停用限管理員', () => {
    expect(governanceActionMeta('deprecate').adminOnly).toBe(false);
    expect(governanceActionMeta('delist').adminOnly).toBe(false);
    expect(governanceActionMeta('emergency-disable').adminOnly).toBe(true);
  });

  it('棄用的原因選填，另外兩者必填', () => {
    // 後端 delist 與 emergency-disable 會擋空原因，deprecate 不會。
    expect(governanceActionMeta('deprecate').reasonRequired).toBe(false);
    expect(governanceActionMeta('delist').reasonRequired).toBe(true);
    expect(governanceActionMeta('emergency-disable').reasonRequired).toBe(true);
  });

  it('未知處置直接拋錯而非回退為預設值', () => {
    // 靜默回退會讓使用者以為執行了 A，實際送出 B。
    expect(() =>
      governanceActionMeta('restore' as never)
    ).toThrow('未知的治理處置');
  });

  it('三個處置都有可辨識的送出按鈕文案', () => {
    const labels = GOVERNANCE_ACTIONS.map((item) => item.submitLabel);

    expect(new Set(labels).size).toBe(3);
  });
});

describe('棄用的 payload 形狀與另外兩者不同', () => {
  it('只送 reason，不含 reasonCode 與 effectiveAt', () => {
    // 後端 deprecate 是 additionalProperties: false，多送欄位會被擋下。
    expect(buildDeprecatePayload('superseded：改用 2.0')).toEqual({
      reason: 'superseded：改用 2.0'
    });
  });

  it('原因空白時整個欄位省略而非送空字串', () => {
    expect(buildDeprecatePayload('   ')).toEqual({});
  });

  it('路徑涵蓋三種處置', () => {
    expect(buildVersionGovernancePath('demo', '1.0.0', 'deprecate')).toBe(
      '/api/packages/demo/versions/1.0.0/deprecate'
    );
  });
});

describe('三個端點的回應形狀不同，呼叫端不該感知', () => {
  const version = { id: '1', packageId: 'demo', version: '1.0.0', lifecycle: 'delisted' };
  const original = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = original;
  });

  function stubFetch(body: unknown): void {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })) as typeof fetch;
  }

  it('撤下回傳包在 version 裡的版本，取出後才是版本本身', async () => {
    /*
     * 後端撤下與緊急停用回 { version, delisting, notifications }，
     * 棄用則直接回版本。不統一的話呼叫端讀 lifecycle 會拿到 undefined，
     * 成功訊息會顯示「已更新為 undefined」。
     */
    stubFetch({ version, delisting: { id: 'd1' }, notifications: [] });

    const result = await delistVersion('demo', '1.0.0', { reasonCode: 'policy_change' });

    expect(result.lifecycle).toBe('delisted');
  });

  it('緊急停用同樣取出版本', async () => {
    stubFetch({
      version: { ...version, lifecycle: 'emergency_disabled' },
      delisting: { id: 'd2' },
      notifications: []
    });

    const result = await emergencyDisableVersion('demo', '1.0.0', {
      reasonCode: 'critical_issue'
    });

    expect(result.lifecycle).toBe('emergency_disabled');
  });

  it('棄用的回應本身就是版本，不需取出', async () => {
    stubFetch({ ...version, lifecycle: 'deprecated' });

    const result = await deprecateVersion('demo', '1.0.0', 'superseded');

    expect(result.lifecycle).toBe('deprecated');
  });
});
