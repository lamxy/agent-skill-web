-- Copyright (c) 2026 lamxy and Contributors
-- SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
--
-- Author: lamxy <pytho5170@hotmail.com>
-- GitHub: https://github.com/lamxy

-- 記錄技能建立者，讓「我的技能」列得出自己剛發布、還沒有任何版本的技能。
-- 依第一期反範式規則：不建立外鍵，只保存邏輯 uid。

/*
 * 維護權限仍然綁團隊而非綁個人（人會離職換組，綁個人會讓技能失去維護者），
 * 此欄位不參與授權判斷，只用於「我的技能」預設清單的收錄。
 *
 * ownerTeam 由發布者自由填寫，未必等於自己隸屬的 team，因此只靠 teamIds
 * 比對會讓人在「我的技能」裡找不到自己剛建立的技能。已有版本的技能可以用
 * package_versions.author_uid 回推，但剛建立、還沒有任何版本的技能不行——
 * 而那正是最需要出現在清單上的狀態。
 */
ALTER TABLE packages ADD COLUMN IF NOT EXISTS created_by_uid text;

-- 既有資料以最早版本的作者回填；完全沒有版本的舊資料留空，不猜測。
UPDATE packages p SET created_by_uid = (
  SELECT v.author_uid FROM package_versions v
  WHERE v.package_id = p.package_id
  ORDER BY v.created_at ASC
  LIMIT 1
) WHERE p.created_by_uid IS NULL;

CREATE INDEX IF NOT EXISTS packages_created_by_updated_idx
  ON packages (created_by_uid, updated_at DESC);
