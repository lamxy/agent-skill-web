// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

import type {
  CreatePackageInput,
  PackageCategoryCode,
  PackageSource,
  PackageType,
  PackageVisibility
} from '../api/types.js';
import { CATEGORY_LABEL } from './catalog-taxonomy.js';

export interface CreatePackageDraft {
  packageId: string;
  name: string;
  purpose: string;
  ownerTeam: string;
  type: PackageType;
  category: string;
  categoryCode: PackageCategoryCode;
  visibility: PackageVisibility;
  sourceUri: string;
  license: string;
  source: PackageSource;
}

export type CreatePackageErrors = Partial<Record<keyof CreatePackageDraft, string>>;

export function emptyCreateDraft(): CreatePackageDraft {
  return {
    packageId: '',
    name: '',
    purpose: '',
    ownerTeam: '',
    type: 'skill',
    category: '',
    categoryCode: 'general',
    visibility: 'internal',
    sourceUri: '',
    license: 'MIT',
    source: 'custom'
  };
}

/**
 * 後端 packageId 的格式限制，逐字對齊 catalog/index.ts 的 packageIdParams。
 * 前端比後端嚴格會擋掉合法的識別碼，比後端寬鬆則讓錯誤延到送出後才浮現。
 */
const PACKAGE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const PACKAGE_ID_MAX_LENGTH = 200;

export function validateCreateDraft(draft: CreatePackageDraft): CreatePackageErrors {
  const errors: CreatePackageErrors = {};

  const packageId = draft.packageId.trim();
  if (!packageId) {
    errors.packageId = '請填寫技能識別碼。';
  } else if (!PACKAGE_ID_PATTERN.test(packageId)) {
    errors.packageId =
      '只能使用小寫英文、數字與 . _ - 三種符號，且須以小寫英文或數字開頭。';
  } else if (packageId.length > PACKAGE_ID_MAX_LENGTH) {
    errors.packageId = `識別碼不能超過 ${PACKAGE_ID_MAX_LENGTH} 個字元。`;
  }

  if (!draft.name.trim()) errors.name = '請填寫技能名稱。';
  if (!draft.purpose.trim()) errors.purpose = '請說明這個技能的用途。';
  if (!draft.ownerTeam.trim()) errors.ownerTeam = '請填寫所有團隊。';

  /*
   * 來源位址與授權條款皆為選填：內部技能未必有可公開的來源位址，
   * 也未必挑過授權條款。有填才驗格式，空白直接放行。
   */
  const sourceUri = draft.sourceUri.trim();
  if (sourceUri && !/^https?:\/\/\S+$/i.test(sourceUri)) {
    errors.sourceUri = '來源位址需為 http 或 https 開頭的網址。';
  }

  return errors;
}

export function buildCreatePackagePayload(draft: CreatePackageDraft): CreatePackageInput {
  return {
    packageId: draft.packageId.trim(),
    type: draft.type,
    name: draft.name.trim(),
    purpose: draft.purpose.trim(),
    ownerTeam: draft.ownerTeam.trim(),
    /*
     * 後端仍要求 category（legacy 自由文字欄位），但表單不再讓使用者
     * 自己填一個近乎重複的值——那正是 backend 與 後端 並存的來源。
     * 一律由所選分類的中文標籤導出，真實來源是 categoryCode。
     */
    category: CATEGORY_LABEL[draft.categoryCode],
    categoryCode: draft.categoryCode,
    visibility: draft.visibility,
    sourceUri: draft.sourceUri.trim(),
    license: draft.license.trim(),
    source: draft.source
    /*
     * 不送 publisher：技能屬團隊資產，發布者即所屬團隊，
     * 由後端從 ownerTeam 推導，避免前端存一份可能不一致的副本。
     */
  };
}

/**
 * 把伺服器錯誤轉成可行動的說明。
 *
 * 409 代表平台上已有同名技能，此時正確的動作是回維護清單為既有技能
 * 更新版本，而不是換一個識別碼再建一個重複的技能。
 */
export function describeCreateFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (/已存在/.test(message)) {
    return '這個識別碼已被使用。若是你自己的技能，請回「我維護的技能」為它更新版本。';
  }
  if (/權限/.test(message)) {
    return '你沒有在這個團隊建立技能的權限。請改選自己所屬的團隊，或請管理員將你加入該團隊。';
  }
  return message || '建立技能失敗，請稍後再試。';
}
