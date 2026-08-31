-- Copyright (c) 2026 lamxy and Contributors
-- SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
--
-- Author: lamxy <pytho5170@hotmail.com>
-- GitHub: https://github.com/lamxy

ALTER TABLE package_versions
  DROP CONSTRAINT IF EXISTS package_versions_package_id_fkey;
ALTER TABLE package_versions
  DROP CONSTRAINT IF EXISTS package_versions_package_id_packages_id_fk;
ALTER TABLE installations
  DROP CONSTRAINT IF EXISTS installations_package_version_id_fkey;
ALTER TABLE installations
  DROP CONSTRAINT IF EXISTS installations_package_version_id_package_versions_id_fk;
ALTER TABLE publication_reviews
  DROP CONSTRAINT IF EXISTS publication_reviews_package_version_id_fkey;
ALTER TABLE publication_reviews
  DROP CONSTRAINT IF EXISTS publication_reviews_package_version_id_package_versions_id_fk;

CREATE TABLE IF NOT EXISTS identities (
  uid text PRIMARY KEY,
  display_name text NOT NULL,
  team_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  provider_type text NOT NULL CONSTRAINT identities_provider_type_check
    CHECK (provider_type IN ('development', 'oidc')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS identities_active_updated_at_idx
  ON identities (active, updated_at);

CREATE TABLE IF NOT EXISTS identity_sessions (
  session_digest text PRIMARY KEY,
  uid text NOT NULL,
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS identity_sessions_uid_revoked_at_idx
  ON identity_sessions (uid, revoked_at);
CREATE INDEX IF NOT EXISTS identity_sessions_expires_at_idx
  ON identity_sessions (expires_at);

CREATE TABLE IF NOT EXISTS role_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  uid text NOT NULL,
  role text NOT NULL CONSTRAINT role_assignments_role_check
    CHECK (role IN ('employee', 'maintainer', 'reviewer', 'platform_admin')),
  scope_type text NOT NULL CONSTRAINT role_assignments_scope_type_check
    CHECK (scope_type IN ('global', 'team', 'package_type', 'category', 'package')),
  scope_value text NOT NULL DEFAULT '',
  assigned_by_uid text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CONSTRAINT role_assignments_scope_value_check CHECK (
    (scope_type = 'global' AND scope_value = '') OR
    (scope_type <> 'global' AND length(scope_value) > 0)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS role_assignments_active_uidx
  ON role_assignments (uid, role, scope_type, scope_value)
  WHERE active = true;
CREATE INDEX IF NOT EXISTS role_assignments_uid_active_idx
  ON role_assignments (uid, active);

CREATE TABLE IF NOT EXISTS reviewer_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reviewer_uid text NOT NULL,
  package_type text NOT NULL,
  category text NOT NULL,
  assigned_by_uid text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by_uid text,
  CONSTRAINT reviewer_assignments_scope_nonempty CHECK (
    length(package_type) > 0 AND length(category) > 0
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS reviewer_assignments_active_scope_uidx
  ON reviewer_assignments (reviewer_uid, package_type, category)
  WHERE active = true;
CREATE INDEX IF NOT EXISTS reviewer_assignments_reviewer_active_idx
  ON reviewer_assignments (reviewer_uid, active);
