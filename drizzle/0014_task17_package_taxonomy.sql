-- Copyright (c) 2026 lamxy and Contributors
-- SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
--
-- Author: lamxy <pytho5170@hotmail.com>
-- GitHub: https://github.com/lamxy

-- Task 17 技能列表分類標籤資料化：來源、發布者、分類、分級。
-- 依第一期反範式規則：不建立外鍵，關聯只保存邏輯 ID，完整性由應用層負責。

-- 來源：技能來自公開開源專案，或內部自行開發。
ALTER TABLE packages ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'custom';
ALTER TABLE packages DROP CONSTRAINT IF EXISTS packages_source_check;
ALTER TABLE packages ADD CONSTRAINT packages_source_check
  CHECK (source IN ('opensource', 'custom'));

-- 發布者：類型與名稱兩個維度。名稱是顯示用的自由文字（個人姓名或組織名），
-- 不是身份系統的 uid，因此不加約束也不與 identities 對齊。
ALTER TABLE packages ADD COLUMN IF NOT EXISTS publisher_kind text NOT NULL DEFAULT 'organization';
ALTER TABLE packages DROP CONSTRAINT IF EXISTS packages_publisher_kind_check;
ALTER TABLE packages ADD CONSTRAINT packages_publisher_kind_check
  CHECK (publisher_kind IN ('individual', 'organization'));

ALTER TABLE packages ADD COLUMN IF NOT EXISTS publisher_name text NOT NULL DEFAULT '';

/*
 * 分類：新增受約束的 category_code，不改造既有 category。
 *
 * 既有 category 是自由文字，實際資料同時存在 backend 與 後端、DBA 與 部署，
 * 且該值已被複製到 publication_reviews.category 與 reviewer_assignments.category。
 * 直接對舊欄位加 CHECK 需要連帶改寫三張表，風險遠大於收益。
 *
 * 因此 category_code 是篩選與標籤的真實來源，舊 category 降級為legacy 顯示標籤。
 */
ALTER TABLE packages ADD COLUMN IF NOT EXISTS category_code text NOT NULL DEFAULT 'general';
ALTER TABLE packages DROP CONSTRAINT IF EXISTS packages_category_code_check;
ALTER TABLE packages ADD CONSTRAINT packages_category_code_check
  CHECK (category_code IN (
    'frontend', 'backend', 'data', 'testing',
    'devops', 'security', 'product_design', 'general'
  ));

-- 由既有自由文字 category 歸納出 category_code。比對前先正規化大小寫與空白；
-- 無法歸類者留在預設的 general，不猜測。
UPDATE packages SET category_code = CASE
  WHEN lower(btrim(category)) IN ('frontend', 'front-end', 'fe', 'web', '前端') THEN 'frontend'
  WHEN lower(btrim(category)) IN ('backend', 'back-end', 'be', 'server', 'development', '後端', '开发', '開發') THEN 'backend'
  WHEN lower(btrim(category)) IN ('data', 'database', 'db', 'dba', 'bigdata', '資料', '数据', '數據') THEN 'data'
  WHEN lower(btrim(category)) IN ('testing', 'test', 'qa', 'quality', '測試', '测试', '品質') THEN 'testing'
  WHEN lower(btrim(category)) IN ('devops', 'ops', 'sre', 'deploy', 'deployment', 'infra', '部署', '運維', '运维') THEN 'devops'
  WHEN lower(btrim(category)) IN ('security', 'sec', 'appsec', '安全') THEN 'security'
  WHEN lower(btrim(category)) IN ('product', 'design', 'ux', 'ui', '產品', '产品', '設計', '设计') THEN 'product_design'
  ELSE 'general'
END;

/*
 * 分級：預設 basic，由審核人核定。
 *
 * 分級屬於 package 而非 version：它描述這個技能在組織內的推廣地位，
 * 不隨每次發版重新評定。核定記錄保存核定者與時間，供審計追溯。
 */
ALTER TABLE packages ADD COLUMN IF NOT EXISTS grade text NOT NULL DEFAULT 'basic';
ALTER TABLE packages DROP CONSTRAINT IF EXISTS packages_grade_check;
ALTER TABLE packages ADD CONSTRAINT packages_grade_check
  CHECK (grade IN ('basic', 'premium', 'general', 'company_wide', 'open_sourced'));

ALTER TABLE packages ADD COLUMN IF NOT EXISTS grade_decided_by_uid text;
ALTER TABLE packages ADD COLUMN IF NOT EXISTS grade_decided_at timestamptz;

-- 列表篩選路徑：分級、來源、分類三者都可單獨或組合篩選，且都與名稱排序併用。
CREATE INDEX IF NOT EXISTS packages_grade_name_idx ON packages (grade, name);
CREATE INDEX IF NOT EXISTS packages_source_name_idx ON packages (source, name);
CREATE INDEX IF NOT EXISTS packages_category_code_name_idx ON packages (category_code, name);
