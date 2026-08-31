// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import { describe, expect, it } from 'vitest';

import {
  buildCreatePackagePayload,
  describeCreateFailure,
  emptyCreateDraft,
  validateCreateDraft
} from '../../web/src/pages/create-package-model.js';
import type { CreatePackageDraft } from '../../web/src/pages/create-package-model.js';

function validDraft(overrides: Partial<CreatePackageDraft> = {}): CreatePackageDraft {
  return {
    ...emptyCreateDraft(),
    packageId: 'code-review',
    name: '程式碼審查助手',
    purpose: '對變更集執行結構化審查',
    ownerTeam: 'platform',
    categoryCode: 'backend',
    sourceUri: 'https://git.example/code-review',
    license: 'MIT',
    ...overrides
  };
}

describe('建立技能的欄位驗證', () => {
  it('完整草稿沒有錯誤', () => {
    expect(validateCreateDraft(validDraft())).toEqual({});
  });

  it('空白草稿逐欄回報，不只回報第一個', () => {
    // 一次只報一欄會讓使用者來回送出多次。
    const errors = validateCreateDraft(emptyCreateDraft());

    /*
     * category 由所選的 categoryCode 導出，使用者不再自己填。
     * sourceUri 與 license 皆為選填：內部技能未必有可公開的
     * 來源位址或明確授權。
     */
    expect(Object.keys(errors).sort()).toEqual([
      'name',
      'ownerTeam',
      'packageId',
      'purpose'
    ]);
  });

  it('選填欄位留空不算錯誤', () => {
    const errors = validateCreateDraft(validDraft({ sourceUri: '', license: '' }));

    expect(errors.sourceUri).toBeUndefined();
    expect(errors.license).toBeUndefined();
  });

  it('只有空白字元不算填寫', () => {
    const errors = validateCreateDraft(validDraft({ name: '   ' }));

    expect(errors.name).toBeDefined();
  });
});

describe('識別碼格式與後端一致', () => {
  it.each(['code-review', 'a', 'skill.v2', 'my_skill', 'x1-2_3.4'])(
    '接受合法識別碼 %s',
    (packageId) => {
      expect(validateCreateDraft(validDraft({ packageId })).packageId).toBeUndefined();
    }
  );

  it.each(['Code-Review', '-leading', '.dot', 'has space', '中文'])(
    '拒絕不合法識別碼 %s',
    (packageId) => {
      expect(validateCreateDraft(validDraft({ packageId })).packageId).toBeDefined();
    }
  );

  it('超過 200 字元時回報長度', () => {
    const errors = validateCreateDraft(validDraft({ packageId: 'a'.repeat(201) }));

    expect(errors.packageId).toContain('200');
  });

  it('剛好 200 字元可接受', () => {
    // 邊界值與後端 maxLength 相同，前端不得比後端嚴格。
    const errors = validateCreateDraft(validDraft({ packageId: 'a'.repeat(200) }));

    expect(errors.packageId).toBeUndefined();
  });
});

describe('來源位址驗證', () => {
  it.each(['https://git.example/x', 'http://git.example/x'])(
    '接受 %s',
    (sourceUri) => {
      expect(validateCreateDraft(validDraft({ sourceUri })).sourceUri).toBeUndefined();
    }
  );

  it.each(['git@example:x.git', 'ftp://example/x', 'example.com/x'])(
    '拒絕 %s',
    (sourceUri) => {
      expect(validateCreateDraft(validDraft({ sourceUri })).sourceUri).toBeDefined();
    }
  );
});

describe('送出前的資料整理', () => {
  it('前後空白會被去除', () => {
    const payload = buildCreatePackagePayload(
      validDraft({ packageId: '  code-review  ', name: '  助手  ' })
    );

    expect(payload.packageId).toBe('code-review');
    expect(payload.name).toBe('助手');
  });

  it('只送出後端 schema 接受的欄位，不含由審核人核定的 grade', () => {
    const payload = buildCreatePackagePayload(validDraft());

    expect(Object.keys(payload).sort()).toEqual([
      'category',
      'categoryCode',
      'license',
      'name',
      'ownerTeam',
      'packageId',
      'purpose',
      'source',
      'sourceUri',
      'type',
      'visibility'
    ]);
  });

  it('legacy category 由所選分類導出，不讓使用者自己填', () => {
    // backend 與 後端 並存正是舊資料無法篩選的原因，真實來源是 categoryCode。
    const payload = buildCreatePackagePayload(validDraft({ categoryCode: 'devops' }));

    expect(payload.categoryCode).toBe('devops');
    expect(payload.category).toBe('部署運維');
  });

  /*
   * 發布者不再由前端決定：技能屬團隊資產，發布者即所屬團隊，
   * 由後端從 ownerTeam 推導（見 catalog-service.createPackage）。
   */
  it('不送出發布者欄位，交由後端從所屬團隊推導', () => {
    const payload = buildCreatePackagePayload(validDraft());

    expect(payload.publisher).toBeUndefined();
  });
});

describe('伺服器錯誤轉為可行動的說明', () => {
  it('識別碼重複時指引回維護清單更新版本', () => {
    // 換一個識別碼再建一個重複的技能是錯的動作，說明必須指出正確路徑。
    const message = describeCreateFailure(new Error('套件識別碼已存在'));

    expect(message).toContain('我維護的技能');
  });

  it('權限不足時說明如何取得權限', () => {
    // 團隊已改為下拉，不可能填錯名稱；剩下的原因是不屬於該團隊。
    const message = describeCreateFailure(new Error('沒有維護此套件的權限'));

    expect(message).toContain('所屬的團隊');
  });

  it('未知錯誤時保留原訊息', () => {
    expect(describeCreateFailure(new Error('伺服器暫時無法使用'))).toBe(
      '伺服器暫時無法使用'
    );
  });

  it('非 Error 值也有可讀的回退訊息', () => {
    expect(describeCreateFailure(undefined)).toBe('建立技能失敗，請稍後再試。');
  });
});
