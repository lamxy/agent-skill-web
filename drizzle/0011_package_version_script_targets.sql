-- Copyright (c) 2026 lamxy and Contributors
-- SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
--
-- Author: lamxy <pytho5170@hotmail.com>
-- GitHub: https://github.com/lamxy

CREATE TABLE IF NOT EXISTS package_version_script_targets (
  id text PRIMARY KEY,
  package_id text NOT NULL,
  package_version text NOT NULL,
  target_os text NOT NULL,
  client_runtime text NOT NULL,
  current_revision_id text,
  deleted_at timestamptz,
  deleted_by_uid text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT package_version_script_targets_os_check
    CHECK (target_os IN ('linux/macos', 'windows', 'wsl')),
  CONSTRAINT package_version_script_targets_client_check
    CHECK (client_runtime IN ('claude-code', 'codex'))
);

CREATE UNIQUE INDEX IF NOT EXISTS package_version_script_targets_matrix_uidx
  ON package_version_script_targets (package_id, package_version, target_os, client_runtime);
CREATE INDEX IF NOT EXISTS package_version_script_targets_active_idx
  ON package_version_script_targets (package_id, package_version, deleted_at);

CREATE TABLE IF NOT EXISTS script_target_revisions (
  id text PRIMARY KEY,
  target_id text NOT NULL,
  target_os text NOT NULL,
  client_runtime text NOT NULL,
  script_version integer NOT NULL,
  install_command text NOT NULL,
  uninstall_command text NOT NULL,
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  usage_instructions text NOT NULL,
  has_residual_effects boolean NOT NULL DEFAULT false,
  residual_description text,
  manual_cleanup_steps text,
  change_description text,
  copied_from_target_id text,
  copied_from_target_os text,
  copied_from_client_runtime text,
  copied_from_script_version integer,
  content_digest text NOT NULL,
  legacy_imported boolean NOT NULL DEFAULT false,
  created_by_uid text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT script_target_revisions_version_check CHECK (script_version >= 1),
  CONSTRAINT script_target_revisions_os_check
    CHECK (target_os IN ('linux/macos', 'windows', 'wsl')),
  CONSTRAINT script_target_revisions_client_check
    CHECK (client_runtime IN ('claude-code', 'codex'))
);

CREATE UNIQUE INDEX IF NOT EXISTS script_target_revisions_target_version_uidx
  ON script_target_revisions (target_id, script_version);
CREATE INDEX IF NOT EXISTS script_target_revisions_target_created_idx
  ON script_target_revisions (target_id, created_at);

ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS audit_logs_target_type_check;
ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_target_type_check
  CHECK (target_type IN ('package', 'version', 'script_target', 'user', 'role'));

WITH safe_legacy AS (
  SELECT
    version.id,
    version.package_id,
    version.version,
    version.install_command,
    version.uninstall_command,
    version.has_residual_effects,
    version.residual_description,
    version.manual_cleanup_steps,
    version.author_uid,
    version.created_at,
    version.updated_at,
    CASE lower(version.supported_os ->> 0)
      WHEN 'linux' THEN 'linux/macos'
      WHEN 'macos' THEN 'linux/macos'
      WHEN 'linux/macos' THEN 'linux/macos'
      WHEN 'windows' THEN 'windows'
      WHEN 'wsl' THEN 'wsl'
    END AS target_os,
    CASE lower(replace(version.supported_clients -> 0 ->> 'name', ' ', '-'))
      WHEN 'claude-code' THEN 'claude-code'
      WHEN 'codex' THEN 'codex'
    END AS client_runtime
  FROM package_versions AS version
  WHERE jsonb_array_length(version.supported_os) = 1
    AND jsonb_array_length(version.supported_clients) = 1
), importable AS (
  SELECT * FROM safe_legacy
  WHERE target_os IS NOT NULL AND client_runtime IS NOT NULL
), inserted_targets AS (
  INSERT INTO package_version_script_targets (
    id, package_id, package_version, target_os, client_runtime,
    current_revision_id, created_at, updated_at
  )
  SELECT
    'legacy-target-' || id::text,
    package_id,
    version,
    target_os,
    client_runtime,
    'legacy-revision-' || id::text,
    created_at,
    updated_at
  FROM importable
  ON CONFLICT (package_id, package_version, target_os, client_runtime) DO NOTHING
  RETURNING id
)
INSERT INTO script_target_revisions (
  id, target_id, target_os, client_runtime, script_version,
  install_command, uninstall_command, options, usage_instructions,
  has_residual_effects, residual_description, manual_cleanup_steps,
  content_digest, legacy_imported, created_by_uid, created_at
)
SELECT
  'legacy-revision-' || legacy.id::text,
  'legacy-target-' || legacy.id::text,
  legacy.target_os,
  legacy.client_runtime,
  1,
  legacy.install_command,
  legacy.uninstall_command,
  '[]'::jsonb,
  '舊版匯入：未保存使用說明。',
  legacy.has_residual_effects,
  legacy.residual_description,
  legacy.manual_cleanup_steps,
  encode(sha256(convert_to(jsonb_build_object(
    'targetOs', legacy.target_os,
    'clientRuntime', legacy.client_runtime,
    'installCommand', legacy.install_command,
    'uninstallCommand', legacy.uninstall_command,
    'options', '[]'::jsonb,
    'usageInstructions', '舊版匯入：未保存使用說明。',
    'hasResidualEffects', legacy.has_residual_effects,
    'residualDescription', legacy.residual_description,
    'manualCleanupSteps', legacy.manual_cleanup_steps,
    'legacyImported', true
  )::text, 'UTF8')), 'hex'),
  true,
  legacy.author_uid,
  legacy.created_at
FROM importable AS legacy
JOIN inserted_targets AS inserted
  ON inserted.id = 'legacy-target-' || legacy.id::text
ON CONFLICT (target_id, script_version) DO NOTHING;
