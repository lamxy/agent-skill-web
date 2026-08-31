-- Copyright (c) 2026 lamxy and Contributors
-- SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
--
-- Author: lamxy <pytho5170@hotmail.com>
-- GitHub: https://github.com/lamxy

ALTER TABLE package_versions
  ADD COLUMN IF NOT EXISTS published_at timestamptz;

ALTER TABLE package_versions
  ADD COLUMN IF NOT EXISTS script_manifest_digest text;

ALTER TABLE validation_runs
  ADD COLUMN IF NOT EXISTS contract_version integer NOT NULL DEFAULT 1;

ALTER TABLE validation_runs
  ADD COLUMN IF NOT EXISTS target_snapshots jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE validation_runs
  ADD COLUMN IF NOT EXISTS manifest_digest text;

ALTER TABLE installations
  ADD COLUMN IF NOT EXISTS script_version integer;

ALTER TABLE installations
  ADD COLUMN IF NOT EXISTS options jsonb;

CREATE INDEX IF NOT EXISTS installations_package_version_script_status_started_idx
  ON installations (package_id, version, script_version, status, started_at);
