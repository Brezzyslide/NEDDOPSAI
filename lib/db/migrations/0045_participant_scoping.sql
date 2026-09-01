-- Sprint 45 — Participant-scoped knowledge retrieval
--
-- Adds first-class participant records and task-to-participant bindings.
-- This migration does not link any existing source to a participant.

BEGIN;

CREATE TABLE IF NOT EXISTS participants (
  id                       text PRIMARY KEY,
  organization_id          text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  display_name             text NOT NULL,
  preferred_name           text,
  external_participant_id  text,
  status                   text NOT NULL DEFAULT 'active',
  metadata                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  deleted_at               timestamptz
);

CREATE INDEX IF NOT EXISTS participants_org_status_idx
  ON participants (organization_id, status);

CREATE INDEX IF NOT EXISTS participants_org_name_idx
  ON participants (organization_id, display_name);

CREATE UNIQUE INDEX IF NOT EXISTS participants_org_external_unique
  ON participants (organization_id, external_participant_id)
  WHERE external_participant_id IS NOT NULL;

ALTER TABLE participants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON participants;
CREATE POLICY tenant_isolation ON participants
  USING (organization_id = current_setting('app.current_organization_id', TRUE));

DROP POLICY IF EXISTS needsops_app_access ON participants;
CREATE POLICY needsops_app_access ON participants
  AS PERMISSIVE FOR ALL
  TO needsops_app
  USING (organization_id = current_setting('app.current_organization_id', TRUE));

CREATE TABLE IF NOT EXISTS task_participants (
  id              text PRIMARY KEY,
  task_id         text NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  organization_id text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  participant_id  text NOT NULL REFERENCES participants (id) ON DELETE RESTRICT,
  role            text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT task_participants_role_check
    CHECK (role IN ('subject', 'related', 'guardian_context'))
);

CREATE UNIQUE INDEX IF NOT EXISTS task_participants_task_participant_role_unique
  ON task_participants (task_id, participant_id, role);

CREATE UNIQUE INDEX IF NOT EXISTS task_participants_single_subject_unique
  ON task_participants (task_id)
  WHERE role = 'subject';

CREATE INDEX IF NOT EXISTS task_participants_org_task_idx
  ON task_participants (organization_id, task_id);

CREATE INDEX IF NOT EXISTS task_participants_org_participant_idx
  ON task_participants (organization_id, participant_id);

ALTER TABLE task_participants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON task_participants;
CREATE POLICY tenant_isolation ON task_participants
  USING (organization_id = current_setting('app.current_organization_id', TRUE));

DROP POLICY IF EXISTS needsops_app_access ON task_participants;
CREATE POLICY needsops_app_access ON task_participants
  AS PERMISSIVE FOR ALL
  TO needsops_app
  USING (organization_id = current_setting('app.current_organization_id', TRUE));

COMMIT;
