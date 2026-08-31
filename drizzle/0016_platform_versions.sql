-- Copyright (c) 2026 lamxy and Contributors
-- SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
--
-- Author: lamxy <pytho5170@hotmail.com>
-- GitHub: https://github.com/lamxy

-- 平台版本管理表。支撐頂欄的版本選單：哪些版本存在、各版本是否開放使用，
-- 全部由這張表決定，前端不再寫死版本清單。
-- 依第一期反範式規則：不建立外鍵。

/*
 * 版本號直接作為主鍵。版本號本身就是穩定且唯一的業務識別，
 * 再加一個代理鍵只會多一層對照，查詢時反而要多繞一次。
 */
CREATE TABLE IF NOT EXISTS platform_versions (
  version text PRIMARY KEY,
  is_available boolean NOT NULL DEFAULT false,
  is_current boolean NOT NULL DEFAULT false,
  note text,
  released_at timestamptz,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_versions_version_nonempty CHECK (length(version) > 0),
  CONSTRAINT platform_versions_order_check CHECK (display_order >= 0)
);

/*
 * 預設版本至多一個。若允許多筆為真，前端載入時會拿到不確定的預設值，
 * 因此用部分唯一索引在資料庫層擋住，而不是只靠寫入端自律。
 */
CREATE UNIQUE INDEX IF NOT EXISTS platform_versions_current_uidx
  ON platform_versions (is_current)
  WHERE is_current = true;

CREATE INDEX IF NOT EXISTS platform_versions_order_idx
  ON platform_versions (display_order, version);

-- 初始資料：v0.0.1 為目前開放的版本，v1.0.0 已規劃但尚未開放。
-- display_order 大的排在前面，新版本自然浮到清單頂端。
INSERT INTO platform_versions (
  version, is_available, is_current, note, released_at, display_order
) VALUES
  ('v0.0.1', true, true, '目前運行中的版本。', now(), 10),
  ('v1.0.0', false, false, '規劃中，暫未開放。', NULL, 20)
ON CONFLICT (version) DO NOTHING;
