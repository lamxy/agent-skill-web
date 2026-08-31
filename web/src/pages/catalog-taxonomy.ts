// Copyright (c) 2026 lamxy and Contributors
// SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
//
// Author: lamxy <pytho5170@hotmail.com>
// GitHub: https://github.com/lamxy

/**
 * 技能列表分類標籤的顯示對照表。
 *
 * Task 17 後來源、發布者、分類、分級四組標籤都由後端提供，
 * 本檔案只負責把後端的列舉值翻成中文與視覺權重，不再持有任何示範資料。
 *
 * 熱度的兩個指標來源不同：安裝數是 installations 表的真實資料，
 * 下載數尚未埋點，見任務 18。
 */
import type {
  PackageCategoryCode,
  PackageGrade,
  PackageSource,
  PublisherKind
} from '../api/types.js';

export const SOURCE_LABEL: Record<PackageSource, string> = {
  opensource: '開源',
  custom: '自定義'
};

export const CATEGORY_LABEL: Record<PackageCategoryCode, string> = {
  frontend: '前端',
  backend: '後端',
  data: '資料',
  testing: '測試',
  devops: '部署運維',
  security: '安全',
  product_design: '產品設計',
  general: '通用'
};

export const GRADE_LABEL: Record<PackageGrade, string> = {
  basic: '基礎',
  premium: '精品',
  general: '通用',
  company_wide: '全員推廣',
  open_sourced: '對外開源'
};

/**
 * 分級的視覺權重：只有需要引導採用的分級才著色，
 * 基礎與通用維持中性，避免整張列表都在強調。
 */
export const GRADE_TONE: Record<PackageGrade, 'neutral' | 'ok' | 'seal'> = {
  basic: 'neutral',
  premium: 'seal',
  general: 'neutral',
  company_wide: 'ok',
  open_sourced: 'seal'
};

/**
 * 下載次數。伺服器端尚未埋點，因此固定為 0 並在畫面上標記「未埋點」，
 * 不以估算值填充，見任務 18。
 */
export function packageDownloads(_packageId: string): number {
  return 0;
}
