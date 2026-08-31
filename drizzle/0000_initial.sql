-- Copyright (c) 2026 lamxy and Contributors
-- SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
--
-- Author: lamxy <pytho5170@hotmail.com>
-- GitHub: https://github.com/lamxy

CREATE TYPE package_version_status AS ENUM (
  'draft', 'validating', 'validation_failed', 'review_required',
  'published', 'deprecated', 'delisted', 'emergency_disabled'
);
CREATE TYPE installation_status AS ENUM ('downloaded', 'succeeded', 'failed', 'uninstalled');
CREATE TYPE user_reference_type AS ENUM ('uid', 'uuid');
CREATE TYPE publication_review_status AS ENUM ('pending', 'approved', 'rejected');
CREATE TYPE domain_event_status AS ENUM ('pending', 'published', 'failed');

CREATE TABLE packages (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  package_id text NOT NULL,
  type text NOT NULL,
  name text NOT NULL,
  purpose text NOT NULL DEFAULT '',
  owner_team text NOT NULL,
  category text NOT NULL,
  visibility text NOT NULL DEFAULT 'internal',
  source_uri text NOT NULL,
  license text NOT NULL,
  lifecycle text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX packages_package_id_uidx ON packages (package_id);
ALTER TABLE packages ADD CONSTRAINT packages_type_check CHECK (type IN ('skill', 'tool'));
ALTER TABLE packages ADD CONSTRAINT packages_visibility_check CHECK (visibility IN ('public', 'internal'));
ALTER TABLE packages ADD CONSTRAINT packages_lifecycle_check CHECK (lifecycle IN ('active', 'archived'));
CREATE INDEX packages_category_name_idx ON packages (category, name);

CREATE TABLE package_versions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  package_id text NOT NULL,
  version text NOT NULL,
  release_notes text,
  supported_os jsonb NOT NULL DEFAULT '[]'::jsonb,
  supported_clients jsonb NOT NULL DEFAULT '[]'::jsonb,
  lifecycle package_version_status NOT NULL DEFAULT 'draft',
  script_digest text,
  install_command text NOT NULL,
  uninstall_command text NOT NULL,
  has_residual_effects boolean NOT NULL DEFAULT false,
  residual_description text,
  manual_cleanup_steps text,
  author_uid text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX package_versions_package_version_uidx ON package_versions (package_id, version);
CREATE INDEX package_versions_package_id_idx ON package_versions (package_id);
CREATE INDEX package_versions_lifecycle_created_at_idx ON package_versions (lifecycle, created_at);

CREATE TABLE installations (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  package_version_id bigint NOT NULL,
  idempotency_key text NOT NULL,
  user_ref text NOT NULL,
  user_ref_type user_reference_type NOT NULL,
  os_type text NOT NULL,
  client_runtime text NOT NULL,
  status installation_status NOT NULL,
  error_code text,
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX installations_idempotency_key_uidx ON installations (idempotency_key);
CREATE INDEX installations_package_version_id_idx ON installations (package_version_id);
CREATE INDEX installations_package_status_created_at_idx ON installations (package_version_id, status, created_at);
CREATE INDEX installations_user_ref_idx ON installations (user_ref_type, user_ref);

CREATE TABLE publication_reviews (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  package_version_id bigint NOT NULL,
  reviewer_uid text NOT NULL,
  status publication_review_status NOT NULL DEFAULT 'pending',
  decision_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz
);
CREATE INDEX publication_reviews_package_version_id_idx ON publication_reviews (package_version_id);
CREATE INDEX publication_reviews_status_created_at_idx ON publication_reviews (status, created_at);

CREATE TABLE domain_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  status domain_event_status NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0 CONSTRAINT domain_events_attempts_nonnegative CHECK (attempts >= 0),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  last_error text
);
CREATE INDEX domain_events_status_occurred_at_idx ON domain_events (status, occurred_at);
CREATE INDEX domain_events_aggregate_idx ON domain_events (aggregate_type, aggregate_id);
