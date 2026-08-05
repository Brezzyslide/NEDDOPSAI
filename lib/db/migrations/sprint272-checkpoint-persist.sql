-- Sprint 27.2 — Durable Execution Checkpoints
-- Replaces the in-memory checkpoint store with a DB-backed table so
-- checkpoints survive API server restarts and support atomic state transitions.

CREATE TABLE IF NOT EXISTS execution_checkpoints (
  id                        TEXT        PRIMARY KEY,
  organization_id           TEXT        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  conversation_id           TEXT        NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  task_id                   TEXT        REFERENCES tasks(id) ON DELETE SET NULL,
  execution_intent_id       TEXT,
  execution_run_id          TEXT,
  specialist_code           TEXT,
  blueprint_id              TEXT,
  work_package_manifest_id  TEXT,
  correlation_id            TEXT        NOT NULL,
  paused_stage              TEXT,
  status                    TEXT        NOT NULL DEFAULT 'active',
  checkpoint_payload        JSONB       NOT NULL DEFAULT '{}',
  validation_result         JSONB,
  clarification_questions   JSONB       NOT NULL DEFAULT '[]',
  clarification_answer      TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at                TIMESTAMPTZ,
  resumed_at                TIMESTAMPTZ,
  completed_at              TIMESTAMPTZ,
  cancelled_at              TIMESTAMPTZ
);

-- Only one active clarification checkpoint per conversation
CREATE UNIQUE INDEX IF NOT EXISTS execution_checkpoints_conv_active_uidx
  ON execution_checkpoints (conversation_id)
  WHERE status IN ('active', 'awaiting_clarification', 'resuming');

CREATE INDEX IF NOT EXISTS execution_checkpoints_org_idx
  ON execution_checkpoints (organization_id);

CREATE INDEX IF NOT EXISTS execution_checkpoints_status_idx
  ON execution_checkpoints (status);

CREATE INDEX IF NOT EXISTS execution_checkpoints_expires_idx
  ON execution_checkpoints (expires_at)
  WHERE status IN ('active', 'awaiting_clarification');

-- RLS
ALTER TABLE execution_checkpoints ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON execution_checkpoints
  USING (organization_id = current_setting('app.current_tenant_id', true));
