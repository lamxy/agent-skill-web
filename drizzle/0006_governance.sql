-- Copyright (c) 2026 lamxy and Contributors
-- SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
--
-- Author: lamxy <pytho5170@hotmail.com>
-- GitHub: https://github.com/lamxy

DO $governance_enum$
BEGIN
  IF to_regtype('public.publication_review_status') IS NULL THEN
    EXECUTE 'CREATE TYPE publication_review_status AS ENUM (''pending'', ''approved'', ''rejected'', ''superseded'')';
  ELSIF NOT EXISTS (
    SELECT 1
    FROM pg_type AS type
    JOIN pg_namespace AS namespace ON namespace.oid = type.typnamespace
    JOIN pg_enum AS enum_value ON enum_value.enumtypid = type.oid
    WHERE namespace.nspname = 'public'
      AND type.typname = 'publication_review_status'
      AND enum_value.enumlabel = 'superseded'
  ) THEN
    IF to_regtype('public.publication_review_status_legacy') IS NOT NULL THEN
      RAISE EXCEPTION 'publication_review_status 存在未完成的舊 enum 演進';
    END IF;
    EXECUTE 'ALTER TYPE publication_review_status RENAME TO publication_review_status_legacy';
    EXECUTE 'CREATE TYPE publication_review_status AS ENUM (''pending'', ''approved'', ''rejected'', ''superseded'')';
    IF to_regclass('public.publication_reviews') IS NOT NULL THEN
      EXECUTE 'ALTER TABLE publication_reviews ALTER COLUMN status DROP DEFAULT';
      EXECUTE 'ALTER TABLE publication_reviews ALTER COLUMN status TYPE publication_review_status USING status::text::publication_review_status';
      EXECUTE 'ALTER TABLE publication_reviews ALTER COLUMN status SET DEFAULT ''pending''';
    END IF;
    EXECUTE 'DROP TYPE publication_review_status_legacy';
  END IF;
END
$governance_enum$;

DO $governance_reviews$
DECLARE
  primary_key_name text;
BEGIN
  IF to_regclass('public.publication_reviews') IS NULL THEN
    RAISE EXCEPTION '找不到 publication_reviews 基線資料表';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'publication_reviews'
      AND column_name = 'id'
      AND data_type = 'bigint'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'publication_reviews'
      AND column_name = 'legacy_record_id'
  ) THEN
    SELECT constraint_name
    INTO primary_key_name
    FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'publication_reviews'
      AND constraint_type = 'PRIMARY KEY';
    IF primary_key_name IS NOT NULL THEN
      EXECUTE format('ALTER TABLE publication_reviews DROP CONSTRAINT %I', primary_key_name);
    END IF;
    ALTER TABLE publication_reviews RENAME COLUMN id TO legacy_record_id;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'publication_reviews'
      AND column_name = 'package_version_id'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'publication_reviews'
      AND column_name = 'legacy_package_version_id'
  ) THEN
    ALTER TABLE publication_reviews
      RENAME COLUMN package_version_id TO legacy_package_version_id;
  END IF;

  ALTER TABLE publication_reviews
    ADD COLUMN IF NOT EXISTS legacy_record_id bigint,
    ADD COLUMN IF NOT EXISTS legacy_package_version_id bigint,
    ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid(),
    ADD COLUMN IF NOT EXISTS package_id text,
    ADD COLUMN IF NOT EXISTS version text,
    ADD COLUMN IF NOT EXISTS package_type text,
    ADD COLUMN IF NOT EXISTS category text,
    ADD COLUMN IF NOT EXISTS owner_team text,
    ADD COLUMN IF NOT EXISTS author_uid text,
    ADD COLUMN IF NOT EXISTS validation_run_id uuid;

  UPDATE publication_reviews SET id = gen_random_uuid() WHERE id IS NULL;
  ALTER TABLE publication_reviews ALTER COLUMN id SET DEFAULT gen_random_uuid();
  ALTER TABLE publication_reviews ALTER COLUMN id SET NOT NULL;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.publication_reviews'::regclass
      AND contype = 'p'
  ) THEN
    ALTER TABLE publication_reviews
      ADD CONSTRAINT publication_reviews_pkey PRIMARY KEY (id);
  END IF;

  ALTER TABLE publication_reviews ALTER COLUMN reviewer_uid DROP NOT NULL;
END
$governance_reviews$;

DROP INDEX IF EXISTS publication_reviews_package_version_id_idx;

UPDATE publication_reviews AS review
SET package_id = COALESCE(review.package_id, version.package_id),
    version = COALESCE(review.version, version.version),
    package_type = COALESCE(review.package_type, package.type),
    category = COALESCE(review.category, package.category),
    owner_team = COALESCE(review.owner_team, package.owner_team),
    author_uid = COALESCE(review.author_uid, version.author_uid),
    validation_run_id = COALESCE(review.validation_run_id, gen_random_uuid())
FROM package_versions AS version
JOIN packages AS package ON package.package_id = version.package_id
WHERE version.id = review.legacy_package_version_id
  AND (
    review.package_id IS NULL OR review.version IS NULL OR
    review.package_type IS NULL OR review.category IS NULL OR
    review.owner_team IS NULL OR review.author_uid IS NULL OR
    review.validation_run_id IS NULL
  );

UPDATE publication_reviews
SET package_id = COALESCE(package_id, 'legacy-package-version-' || legacy_package_version_id::text),
    version = COALESCE(version, 'legacy'),
    package_type = COALESCE(package_type, 'skill'),
    category = COALESCE(category, 'legacy'),
    owner_team = COALESCE(owner_team, 'legacy-import'),
    author_uid = COALESCE(author_uid, 'legacy-import'),
    validation_run_id = COALESCE(validation_run_id, gen_random_uuid())
WHERE package_id IS NULL OR version IS NULL OR package_type IS NULL OR
      category IS NULL OR owner_team IS NULL OR author_uid IS NULL OR
      validation_run_id IS NULL;

WITH ranked_pending AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY package_id, version
           ORDER BY created_at DESC, legacy_record_id DESC NULLS LAST, id DESC
         ) AS row_number
  FROM publication_reviews
  WHERE status = 'pending'
)
UPDATE publication_reviews AS review
SET status = 'superseded',
    decided_at = COALESCE(review.decided_at, now())
FROM ranked_pending
WHERE review.id = ranked_pending.id
  AND ranked_pending.row_number > 1;

ALTER TABLE publication_reviews ALTER COLUMN package_id SET NOT NULL;
ALTER TABLE publication_reviews ALTER COLUMN version SET NOT NULL;
ALTER TABLE publication_reviews ALTER COLUMN package_type SET NOT NULL;
ALTER TABLE publication_reviews ALTER COLUMN category SET NOT NULL;
ALTER TABLE publication_reviews ALTER COLUMN owner_team SET NOT NULL;
ALTER TABLE publication_reviews ALTER COLUMN author_uid SET NOT NULL;
ALTER TABLE publication_reviews ALTER COLUMN validation_run_id SET NOT NULL;
ALTER TABLE publication_reviews ALTER COLUMN legacy_record_id DROP IDENTITY IF EXISTS;
ALTER TABLE publication_reviews ALTER COLUMN legacy_record_id DROP NOT NULL;
ALTER TABLE publication_reviews ALTER COLUMN legacy_package_version_id DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS publication_reviews_pending_version_uidx
  ON publication_reviews (package_id, version)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS publication_reviews_package_version_idx
  ON publication_reviews (package_id, version, created_at);
CREATE INDEX IF NOT EXISTS publication_reviews_status_created_at_idx
  ON publication_reviews (status, created_at);
CREATE INDEX IF NOT EXISTS publication_reviews_reviewer_decided_at_idx
  ON publication_reviews (reviewer_uid, decided_at);

CREATE TABLE IF NOT EXISTS validation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id text NOT NULL,
  version text NOT NULL,
  script_digest text NOT NULL,
  status text NOT NULL,
  requested_by_uid text NOT NULL,
  expected_matrix jsonb NOT NULL DEFAULT '[]'::jsonb,
  attempts jsonb NOT NULL DEFAULT '[]'::jsonb,
  retry_claim_token uuid,
  retry_claimed_at timestamptz,
  last_attempt_started_at timestamptz NOT NULL,
  runner_version text NOT NULL DEFAULT '',
  matrix_results jsonb NOT NULL DEFAULT '[]'::jsonb,
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  error_code text,
  CONSTRAINT validation_runs_status_check CHECK (status IN ('running', 'passed', 'failed'))
);
CREATE UNIQUE INDEX IF NOT EXISTS validation_runs_running_version_uidx
  ON validation_runs (package_id, version)
  WHERE status = 'running';
CREATE INDEX IF NOT EXISTS validation_runs_package_version_started_idx
  ON validation_runs (package_id, version, started_at);
CREATE INDEX IF NOT EXISTS validation_runs_status_started_idx
  ON validation_runs (status, started_at);

CREATE TABLE IF NOT EXISTS version_delistings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id text NOT NULL,
  version text NOT NULL,
  reason_code text NOT NULL,
  reason_detail text,
  effective_at timestamptz NOT NULL,
  actor_uid text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS version_delistings_package_version_created_idx
  ON version_delistings (package_id, version, created_at);
CREATE INDEX IF NOT EXISTS version_delistings_effective_at_idx
  ON version_delistings (effective_at);

CREATE TABLE IF NOT EXISTS user_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_uid text NOT NULL,
  notification_type text NOT NULL,
  package_id text NOT NULL,
  version text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'unread',
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  CONSTRAINT user_notifications_type_check CHECK (notification_type IN ('version_delisted')),
  CONSTRAINT user_notifications_status_check CHECK (status IN ('unread', 'read'))
);
CREATE UNIQUE INDEX IF NOT EXISTS user_notifications_recipient_type_version_uidx
  ON user_notifications (recipient_uid, notification_type, package_id, version);
CREATE INDEX IF NOT EXISTS user_notifications_recipient_status_created_idx
  ON user_notifications (recipient_uid, status, created_at);
CREATE INDEX IF NOT EXISTS user_notifications_package_version_idx
  ON user_notifications (package_id, version);
