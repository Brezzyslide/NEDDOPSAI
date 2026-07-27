-- Sprint 9.5 — Specialist Runtime Migration
-- Creates: specialist_runs, specialist_queue, specialist_run_memory, specialist_conflicts
-- All tables use TEXT primary keys (matching project convention).
-- All tables have RLS for tenant isolation.
-- PostgreSQL note: CREATE POLICY does not support IF NOT EXISTS — use DROP + CREATE pattern.

-- ─── specialist_runs ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS specialist_runs (
  id                                  TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  organization_id                     TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  conversation_id                     TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  task_id                             TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  execution_plan_id                   TEXT REFERENCES task_execution_plans(id) ON DELETE SET NULL,
  execution_step_id                   TEXT,
  capability_decision_id              TEXT,
  specialist_eligibility_decision_id  TEXT,
  workforce_role_code                 VARCHAR(100) NOT NULL,
  worker_profile_code                 VARCHAR(100) NOT NULL,
  specialist_instruction_version      VARCHAR(20) NOT NULL DEFAULT '1.0.0',
  model_provider                      VARCHAR(50) NOT NULL DEFAULT 'internal',
  model_name                          VARCHAR(100) NOT NULL DEFAULT 'internal',
  status                              VARCHAR(50) NOT NULL DEFAULT 'created'
                                        CHECK (status IN (
                                          'created','queued','preparing','running',
                                          'awaiting_clarification','awaiting_approval',
                                          'waiting_for_dependency','waiting_for_runtime',
                                          'completed','failed','cancelled','expired'
                                        )),
  priority                            SMALLINT NOT NULL DEFAULT 5,
  attempt_number                      SMALLINT NOT NULL DEFAULT 0,
  maximum_attempts                    SMALLINT NOT NULL DEFAULT 3,
  approval_required                   BOOLEAN NOT NULL DEFAULT FALSE,
  external_execution_required         BOOLEAN NOT NULL DEFAULT FALSE,
  clarification_required              BOOLEAN NOT NULL DEFAULT FALSE,
  confidence                          NUMERIC(4,3),
  result_summary                      TEXT,
  result_data                         JSONB,
  last_error                          TEXT,
  queued_at                           TIMESTAMPTZ,
  started_at                          TIMESTAMPTZ,
  completed_at                        TIMESTAMPTZ,
  failed_at                           TIMESTAMPTZ,
  cancelled_at                        TIMESTAMPTZ,
  idempotency_key                     VARCHAR(255) NOT NULL,
  created_at                          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS specialist_runs_idempotency_key_idx
  ON specialist_runs (idempotency_key);

CREATE INDEX IF NOT EXISTS specialist_runs_task_id_idx
  ON specialist_runs (task_id, organization_id);

CREATE INDEX IF NOT EXISTS specialist_runs_org_status_idx
  ON specialist_runs (organization_id, status);

CREATE INDEX IF NOT EXISTS specialist_runs_created_at_idx
  ON specialist_runs (created_at DESC);

ALTER TABLE specialist_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON specialist_runs;
CREATE POLICY tenant_isolation
  ON specialist_runs
  USING (organization_id = current_setting('app.current_org_id', TRUE));

-- ─── specialist_queue ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS specialist_queue (
  id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  organization_id   TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  specialist_run_id TEXT NOT NULL REFERENCES specialist_runs(id) ON DELETE CASCADE,
  priority          SMALLINT NOT NULL DEFAULT 5,
  status            VARCHAR(30) NOT NULL DEFAULT 'waiting'
                      CHECK (status IN (
                        'waiting','claimed','running','retrying',
                        'blocked','completed','failed','cancelled'
                      )),
  available_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attempts          SMALLINT NOT NULL DEFAULT 0,
  last_error        TEXT,
  claimed_at        TIMESTAMPTZ,
  claimed_by        VARCHAR(100),
  lease_expires_at  TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS specialist_queue_run_id_idx
  ON specialist_queue (specialist_run_id);

CREATE INDEX IF NOT EXISTS specialist_queue_claim_idx
  ON specialist_queue (organization_id, status, available_at, priority DESC)
  WHERE status = 'waiting';

CREATE INDEX IF NOT EXISTS specialist_queue_lease_idx
  ON specialist_queue (lease_expires_at)
  WHERE status = 'claimed';

ALTER TABLE specialist_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON specialist_queue;
CREATE POLICY tenant_isolation
  ON specialist_queue
  USING (organization_id = current_setting('app.current_org_id', TRUE));

-- ─── specialist_run_memory ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS specialist_run_memory (
  id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  specialist_run_id TEXT NOT NULL REFERENCES specialist_runs(id) ON DELETE CASCADE,
  organization_id   TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  memory_type       VARCHAR(50) NOT NULL
                      CHECK (memory_type IN (
                        'input_context','output_summary','evidence_reference',
                        'assumption','unresolved_question','requested_action'
                      )),
  content           TEXT NOT NULL,
  metadata          JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS specialist_run_memory_run_id_idx
  ON specialist_run_memory (specialist_run_id);

CREATE INDEX IF NOT EXISTS specialist_run_memory_org_type_idx
  ON specialist_run_memory (organization_id, memory_type);

ALTER TABLE specialist_run_memory ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON specialist_run_memory;
CREATE POLICY tenant_isolation
  ON specialist_run_memory
  USING (organization_id = current_setting('app.current_org_id', TRUE));

-- ─── specialist_conflicts ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS specialist_conflicts (
  id                          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  organization_id             TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  task_id                     TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  specialist_run_ids          TEXT[] NOT NULL,
  conflicting_positions       JSONB NOT NULL,
  evidence_references         JSONB,
  risk                        VARCHAR(20) NOT NULL DEFAULT 'medium'
                                CHECK (risk IN ('low','medium','high','critical')),
  chief_of_staff_recommendation TEXT,
  resolution_required         BOOLEAN NOT NULL DEFAULT TRUE,
  resolved_by_user_id         TEXT REFERENCES users(id) ON DELETE SET NULL,
  resolution_notes            TEXT,
  resolved_at                 TIMESTAMPTZ,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS specialist_conflicts_task_id_idx
  ON specialist_conflicts (task_id, organization_id);

CREATE INDEX IF NOT EXISTS specialist_conflicts_org_unresolved_idx
  ON specialist_conflicts (organization_id)
  WHERE resolution_required = TRUE;

ALTER TABLE specialist_conflicts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON specialist_conflicts;
CREATE POLICY tenant_isolation
  ON specialist_conflicts
  USING (organization_id = current_setting('app.current_org_id', TRUE));

-- ─── Verify tables created ────────────────────────────────────────────────────

DO $$
DECLARE
  missing_tables TEXT[] := '{}';
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['specialist_runs','specialist_queue','specialist_run_memory','specialist_conflicts'] LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = t AND table_schema = 'public') THEN
      missing_tables := array_append(missing_tables, t);
    END IF;
  END LOOP;

  IF array_length(missing_tables, 1) > 0 THEN
    RAISE EXCEPTION 'Sprint 9.5 migration: tables not created: %', array_to_string(missing_tables, ', ');
  END IF;

  RAISE NOTICE 'Sprint 9.5 migration: all 4 specialist tables verified.';
END $$;
