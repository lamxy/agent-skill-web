-- Copyright (c) 2026 lamxy and Contributors
-- SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
--
-- Author: lamxy <pytho5170@hotmail.com>
-- GitHub: https://github.com/lamxy

-- Task 11 體驗完善：維護者支援入口、結構化反饋、新版本發布通知。
-- 依第一期反範式規則：不建立外鍵，關聯只保存邏輯 ID，完整性由應用層負責。

CREATE TABLE IF NOT EXISTS package_support_channels (
  id text PRIMARY KEY,
  package_id text NOT NULL,
  channel_type text NOT NULL,
  label text NOT NULL,
  address text NOT NULL,
  instructions text,
  display_order integer NOT NULL DEFAULT 0,
  updated_by_uid text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT package_support_channels_type_check
    CHECK (channel_type IN ('im_group', 'email', 'ticket_system', 'doc')),
  CONSTRAINT package_support_channels_order_check
    CHECK (display_order >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS package_support_channels_package_type_address_uidx
  ON package_support_channels (package_id, channel_type, address);
CREATE INDEX IF NOT EXISTS package_support_channels_package_order_idx
  ON package_support_channels (package_id, display_order, created_at);

CREATE TABLE IF NOT EXISTS package_feedback (
  id text PRIMARY KEY,
  package_id text NOT NULL,
  version text NOT NULL,
  author_ref_type text NOT NULL,
  author_ref text NOT NULL,
  satisfaction integer NOT NULL,
  issue_category text NOT NULL,
  detail text NOT NULL,
  needs_human_support boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT package_feedback_ref_type_check
    CHECK (author_ref_type IN ('uid', 'uuid')),
  CONSTRAINT package_feedback_satisfaction_check
    CHECK (satisfaction BETWEEN 1 AND 5),
  CONSTRAINT package_feedback_category_check
    CHECK (issue_category IN (
      'install_failure', 'uninstall_failure', 'documentation',
      'performance', 'compatibility', 'feature_request', 'other'
    )),
  CONSTRAINT package_feedback_status_check
    CHECK (status IN ('open', 'acknowledged', 'resolved'))
);

CREATE INDEX IF NOT EXISTS package_feedback_package_created_idx
  ON package_feedback (package_id, created_at DESC);
CREATE INDEX IF NOT EXISTS package_feedback_package_version_category_idx
  ON package_feedback (package_id, version, issue_category);
CREATE INDEX IF NOT EXISTS package_feedback_support_idx
  ON package_feedback (package_id, needs_human_support, status, created_at DESC);
CREATE INDEX IF NOT EXISTS package_feedback_author_created_idx
  ON package_feedback (author_ref_type, author_ref, created_at DESC);

-- 新版本發布通知沿用既有 user_notifications，只擴充型別白名單。
ALTER TABLE user_notifications DROP CONSTRAINT IF EXISTS user_notifications_type_check;
ALTER TABLE user_notifications ADD CONSTRAINT user_notifications_type_check
  CHECK (notification_type IN (
    'version_delisted', 'version_emergency_disabled', 'version_published'
  ));

ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS audit_logs_target_type_check;
ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_target_type_check
  CHECK (target_type IN (
    'package', 'version', 'script_target', 'user', 'role',
    'support_channel', 'feedback'
  ));
