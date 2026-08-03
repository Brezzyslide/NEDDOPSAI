-- Task #17: Knowledge Orchestration Engine — Expand retrieval_audit_events
-- Adds fields required for full retrieval audit as specified.
-- Safe to re-run (ADD COLUMN IF NOT EXISTS).

ALTER TABLE retrieval_audit_events
  ADD COLUMN IF NOT EXISTS entity_id           TEXT,
  ADD COLUMN IF NOT EXISTS memory_ids          JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS task_upload_ids     JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS retrieval_duration_ms INTEGER,
  ADD COLUMN IF NOT EXISTS conflict_count      INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ranking_details     JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS reason_selected     JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS reason_rejected     JSONB NOT NULL DEFAULT '{}';

-- Index: fast audit lookup by execution
CREATE INDEX IF NOT EXISTS idx_retrieval_audit_execution
  ON retrieval_audit_events (execution_id)
  WHERE execution_id IS NOT NULL;

-- Index: fast audit lookup by org + specialist
CREATE INDEX IF NOT EXISTS idx_retrieval_audit_org_specialist
  ON retrieval_audit_events (organization_id, specialist_id, created_at DESC);
