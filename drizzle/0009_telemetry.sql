-- Copyright (c) 2026 lamxy and Contributors
-- SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
--
-- Author: lamxy <pytho5170@hotmail.com>
-- GitHub: https://github.com/lamxy

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'installations'
      AND column_name = 'package_version_id'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'installations'
      AND column_name = 'legacy_package_version_id'
  ) THEN
    ALTER TABLE installations
      RENAME COLUMN package_version_id TO legacy_package_version_id;
  END IF;
END $$;

ALTER TABLE installations
  ADD COLUMN IF NOT EXISTS legacy_package_version_id bigint;
ALTER TABLE installations
  ADD COLUMN IF NOT EXISTS package_id text;
ALTER TABLE installations
  ADD COLUMN IF NOT EXISTS version text;
ALTER TABLE installations
  ADD COLUMN IF NOT EXISTS payload_fingerprint text;

ALTER TABLE installations ALTER COLUMN package_id SET DEFAULT NULL;
ALTER TABLE installations ALTER COLUMN version SET DEFAULT NULL;
ALTER TABLE installations ALTER COLUMN payload_fingerprint SET DEFAULT NULL;

UPDATE installations AS installation
SET
  package_id = COALESCE(
    installation.package_id,
    (
      SELECT package_version.package_id
      FROM package_versions AS package_version
      WHERE package_version.id = installation.legacy_package_version_id
    ),
    'legacy-package-version-' || installation.legacy_package_version_id::text
  ),
  version = COALESCE(
    installation.version,
    (
      SELECT package_version.version
      FROM package_versions AS package_version
      WHERE package_version.id = installation.legacy_package_version_id
    ),
    'legacy'
  ),
  payload_fingerprint = COALESCE(
    installation.payload_fingerprint,
    'legacy:' || installation.id::text
  )
WHERE installation.package_id IS NULL
   OR installation.version IS NULL
   OR installation.payload_fingerprint IS NULL;

ALTER TABLE installations ALTER COLUMN package_id SET NOT NULL;
ALTER TABLE installations ALTER COLUMN version SET NOT NULL;
ALTER TABLE installations ALTER COLUMN payload_fingerprint SET NOT NULL;
ALTER TABLE installations ALTER COLUMN legacy_package_version_id DROP NOT NULL;

CREATE OR REPLACE FUNCTION fill_legacy_installation_snapshot()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.package_id IS NULL OR NEW.version IS NULL THEN
    SELECT package_version.package_id, package_version.version
    INTO NEW.package_id, NEW.version
    FROM package_versions AS package_version
    WHERE package_version.id = NEW.legacy_package_version_id;

    NEW.package_id := COALESCE(
      NEW.package_id,
      'legacy-package-version-' || NEW.legacy_package_version_id::text
    );
    NEW.version := COALESCE(NEW.version, 'legacy');
  END IF;
  NEW.payload_fingerprint := COALESCE(
    NEW.payload_fingerprint,
    'legacy:' || NEW.id::text
  );
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS installations_legacy_snapshot_trigger ON installations;
CREATE TRIGGER installations_legacy_snapshot_trigger
BEFORE INSERT ON installations
FOR EACH ROW
EXECUTE FUNCTION fill_legacy_installation_snapshot();

DROP INDEX IF EXISTS installations_package_version_id_idx;
DROP INDEX IF EXISTS installations_package_status_created_at_idx;
DROP INDEX IF EXISTS installations_user_ref_idx;

CREATE INDEX IF NOT EXISTS installations_package_version_status_started_idx
  ON installations (package_id, version, status, started_at);
CREATE INDEX IF NOT EXISTS installations_user_ref_created_idx
  ON installations (user_ref_type, user_ref, created_at);
