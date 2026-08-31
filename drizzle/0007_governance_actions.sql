-- Copyright (c) 2026 lamxy and Contributors
-- SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
--
-- Author: lamxy <pytho5170@hotmail.com>
-- GitHub: https://github.com/lamxy

DO $governance_notification_type$
DECLARE
  current_definition text;
BEGIN
  IF to_regclass('public.user_notifications') IS NULL THEN
    RAISE EXCEPTION '找不到 user_notifications 治理資料表';
  END IF;

  SELECT pg_get_constraintdef(constraint_record.oid)
  INTO current_definition
  FROM pg_constraint AS constraint_record
  WHERE constraint_record.conrelid = 'public.user_notifications'::regclass
    AND constraint_record.conname = 'user_notifications_type_check';

  IF current_definition IS NULL OR
     current_definition NOT LIKE '%version_emergency_disabled%' THEN
    ALTER TABLE user_notifications
      DROP CONSTRAINT IF EXISTS user_notifications_type_check;
    ALTER TABLE user_notifications
      ADD CONSTRAINT user_notifications_type_check
      CHECK (notification_type IN ('version_delisted', 'version_emergency_disabled'));
  END IF;
END
$governance_notification_type$;
