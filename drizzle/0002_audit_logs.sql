-- Copyright (c) 2026 lamxy and Contributors
-- SPDX-License-Identifier: LicenseRef-PolyForm-Internal-Use-1.0.0
--
-- Author: lamxy <pytho5170@hotmail.com>
-- GitHub: https://github.com/lamxy

CREATE TABLE IF NOT EXISTS audit_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_type text NOT NULL,
  actor_uid text NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  action text NOT NULL,
  details jsonb NOT NULL,
  ip_address text,
  user_agent text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_logs_required_text_check CHECK (
    length(event_type) > 0 AND
    length(actor_uid) > 0 AND
    length(target_id) > 0 AND
    length(action) > 0
  ),
  CONSTRAINT audit_logs_target_type_check CHECK (
    target_type IN ('package', 'version', 'user', 'role')
  )
);

CREATE INDEX IF NOT EXISTS audit_logs_occurred_at_id_idx
  ON audit_logs (occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS audit_logs_event_type_occurred_at_id_idx
  ON audit_logs (event_type, occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS audit_logs_actor_uid_occurred_at_id_idx
  ON audit_logs (actor_uid, occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS audit_logs_target_occurred_at_id_idx
  ON audit_logs (target_type, target_id, occurred_at DESC, id DESC);

CREATE OR REPLACE FUNCTION reject_audit_logs_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $audit_immutable$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only'
    USING ERRCODE = '55000';
END;
$audit_immutable$;

DROP TRIGGER IF EXISTS audit_logs_immutable ON audit_logs;
CREATE TRIGGER audit_logs_immutable
BEFORE UPDATE OR DELETE ON audit_logs
FOR EACH ROW
EXECUTE FUNCTION reject_audit_logs_mutation();
