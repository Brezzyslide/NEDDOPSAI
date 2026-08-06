-- Sprint 29F.1 — Persisted ExecutionAction Lifecycle
-- Creates the execution_actions table with full lifecycle columns.
-- RLS is added to enforce tenant isolation via organisation_id.

BEGIN;

-- ── Table ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS execution_actions (
  id                   text         PRIMARY KEY,
  execution_id         text         NOT NULL,
  organisation_id      text         NOT NULL,
  conversation_id      text,
  task_id              text,

  specialist_code      text         NOT NULL,

  action_type          text         NOT NULL,
  target               text,
  parameters_summary   jsonb,
  risk_level           text         NOT NULL  DEFAULT 'medium',
  approval_required    boolean      NOT NULL  DEFAULT TRUE,

  requested_by         text,
  approved_by          text,
  rejected_by          text,

  connector_device_id  text,
  session_id           text,
  idempotency_key      text,

  status               text         NOT NULL  DEFAULT 'proposed',

  proposed_at          timestamptz  NOT NULL,
  approved_at          timestamptz,
  rejected_at          timestamptz,
  execution_started_at timestamptz,
  completed_at         timestamptz,
  failed_at            timestamptz,
  cancelled_at         timestamptz,

  result_summary       jsonb,
  error_details        jsonb,

  correlation_id       text,

  created_at           timestamptz  NOT NULL  DEFAULT now(),
  updated_at           timestamptz  NOT NULL  DEFAULT now()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS execution_actions_execution_id_idx    ON execution_actions (execution_id);
CREATE INDEX IF NOT EXISTS execution_actions_organisation_id_idx ON execution_actions (organisation_id);
CREATE INDEX IF NOT EXISTS execution_actions_status_idx          ON execution_actions (status);
CREATE INDEX IF NOT EXISTS execution_actions_idempotency_key_idx ON execution_actions (idempotency_key);

-- ── Row-Level Security ────────────────────────────────────────────────────────

ALTER TABLE execution_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON execution_actions
  USING (organisation_id = current_setting('app.current_organization_id', TRUE));

-- ── Constraint: valid status values ──────────────────────────────────────────

ALTER TABLE execution_actions
  ADD CONSTRAINT execution_actions_status_check
  CHECK (status IN (
    'proposed',
    'awaiting_approval',
    'approved',
    'rejected',
    'executing',
    'completed',
    'failed',
    'cancelled'
  ));

COMMIT;
