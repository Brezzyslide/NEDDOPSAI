-- Sprint 10 — Digital Workforce Intelligence & Execution
-- Adds version tracking columns to specialist_runs, creates execution_intents table.
-- Idempotent throughout.

BEGIN;

-- ── 1. Add version tracking columns to specialist_runs ────────────────────────
ALTER TABLE specialist_runs
  ADD COLUMN IF NOT EXISTS dna_version             TEXT NOT NULL DEFAULT 'N/A',
  ADD COLUMN IF NOT EXISTS worker_profile_version  TEXT NOT NULL DEFAULT '1.0.0',
  ADD COLUMN IF NOT EXISTS capability_version      TEXT NOT NULL DEFAULT '1.0.0',
  ADD COLUMN IF NOT EXISTS reasoning_version       TEXT NOT NULL DEFAULT 'N/A',
  ADD COLUMN IF NOT EXISTS output_schema_version   TEXT NOT NULL DEFAULT 'N/A',
  ADD COLUMN IF NOT EXISTS model_version           TEXT NOT NULL DEFAULT 'internal';

-- ── 2. Create execution_intents table ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS execution_intents (
  id                      TEXT          PRIMARY KEY,
  organization_id         TEXT          NOT NULL,
  specialist_run_id       TEXT          NOT NULL,
  task_id                 TEXT          NOT NULL,
  intent_type             TEXT          NOT NULL,
  description             TEXT          NOT NULL,
  execution_channel       TEXT          NOT NULL,
  tool_category           TEXT          NOT NULL,
  connector_category      TEXT,
  risk_level              TEXT          NOT NULL DEFAULT 'medium',
  approval_required       BOOLEAN       NOT NULL DEFAULT TRUE,
  sequence_order          INTEGER       NOT NULL DEFAULT 1,
  parameters              JSONB         NOT NULL DEFAULT '{}',
  status                  TEXT          NOT NULL DEFAULT 'prepared',
  approved_by             TEXT,
  approved_at             TIMESTAMPTZ,
  rejected_by             TEXT,
  rejected_at             TIMESTAMPTZ,
  rejection_reason        TEXT,
  dispatched_at           TIMESTAMPTZ,
  openclaw_execution_id   TEXT,
  created_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS execution_intents_run_idx
  ON execution_intents(specialist_run_id);

CREATE INDEX IF NOT EXISTS execution_intents_task_idx
  ON execution_intents(task_id);

CREATE INDEX IF NOT EXISTS execution_intents_org_status_idx
  ON execution_intents(organization_id, status);

CREATE INDEX IF NOT EXISTS execution_intents_pending_approval_idx
  ON execution_intents(organization_id, approval_required, status);

-- ── 3. RLS on execution_intents (tenant-scoped) ───────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'execution_intents' AND policyname = 'tenant_isolation'
  ) THEN
    ALTER TABLE execution_intents ENABLE ROW LEVEL SECURITY;
    CREATE POLICY tenant_isolation ON execution_intents
      USING (organization_id = current_setting('app.current_organization_id', TRUE));
  END IF;
END$$;

COMMIT;

DO $$
BEGIN
  RAISE NOTICE 'Sprint 10 migration complete. specialist_runs now has % columns, execution_intents created.',
    (SELECT count(*) FROM information_schema.columns WHERE table_name = 'specialist_runs');
END$$;
