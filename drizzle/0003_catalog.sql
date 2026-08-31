-- Copyright (c) 2026 lamxy and Contributors
-- SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
--
-- Author: lamxy <pytho5170@hotmail.com>
-- GitHub: https://github.com/lamxy

ALTER TABLE packages ADD COLUMN IF NOT EXISTS purpose text;
UPDATE packages SET purpose = name WHERE purpose IS NULL;
ALTER TABLE packages ALTER COLUMN purpose SET NOT NULL;
ALTER TABLE packages ADD COLUMN IF NOT EXISTS lifecycle text NOT NULL DEFAULT 'active';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'packages_type_check') THEN
    ALTER TABLE packages ADD CONSTRAINT packages_type_check CHECK (type IN ('skill', 'tool'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'packages_visibility_check') THEN
    ALTER TABLE packages ADD CONSTRAINT packages_visibility_check CHECK (visibility IN ('public', 'internal'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'packages_lifecycle_check') THEN
    ALTER TABLE packages ADD CONSTRAINT packages_lifecycle_check CHECK (lifecycle IN ('active', 'archived'));
  END IF;
END $$;

DO $$
DECLARE package_id_type text;
BEGIN
  SELECT data_type INTO package_id_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'package_versions'
    AND column_name = 'package_id';

  IF package_id_type = 'bigint' THEN
    ALTER TABLE package_versions ADD COLUMN package_logical_id text;
    UPDATE package_versions AS version
    SET package_logical_id = COALESCE(package.package_id, version.package_id::text)
    FROM packages AS package
    WHERE package.id = version.package_id;
    UPDATE package_versions
    SET package_logical_id = package_id::text
    WHERE package_logical_id IS NULL;
    ALTER TABLE package_versions ALTER COLUMN package_logical_id SET NOT NULL;
    DROP INDEX IF EXISTS package_versions_package_version_uidx;
    DROP INDEX IF EXISTS package_versions_package_id_idx;
    ALTER TABLE package_versions DROP COLUMN package_id;
    ALTER TABLE package_versions RENAME COLUMN package_logical_id TO package_id;
    CREATE UNIQUE INDEX package_versions_package_version_uidx ON package_versions (package_id, version);
    CREATE INDEX package_versions_package_id_idx ON package_versions (package_id);
  END IF;
END $$;

ALTER TABLE package_versions ADD COLUMN IF NOT EXISTS has_residual_effects boolean NOT NULL DEFAULT false;
ALTER TABLE package_versions ADD COLUMN IF NOT EXISTS residual_description text;
ALTER TABLE package_versions ADD COLUMN IF NOT EXISTS author_uid text;
UPDATE package_versions SET author_uid = 'legacy-import' WHERE author_uid IS NULL;
ALTER TABLE package_versions ALTER COLUMN author_uid SET NOT NULL;
UPDATE package_versions SET install_command = '' WHERE install_command IS NULL;
UPDATE package_versions SET uninstall_command = '' WHERE uninstall_command IS NULL;
ALTER TABLE package_versions ALTER COLUMN install_command SET NOT NULL;
ALTER TABLE package_versions ALTER COLUMN uninstall_command SET NOT NULL;

CREATE INDEX IF NOT EXISTS packages_visibility_lifecycle_category_idx
  ON packages (visibility, lifecycle, category, updated_at DESC);
CREATE INDEX IF NOT EXISTS package_versions_package_lifecycle_updated_idx
  ON package_versions (package_id, lifecycle, updated_at DESC);
