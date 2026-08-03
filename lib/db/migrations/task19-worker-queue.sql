-- Task #19: Knowledge Hub Queue Worker
-- Adds lease/heartbeat/backoff/recovery columns to ingestion_jobs.
-- Adds dead_lettered and cancelling to the status domain.
-- Safe to re-run (all ALTER TABLE ... ADD COLUMN IF NOT EXISTS).

ALTER TABLE ingestion_jobs
  ADD COLUMN IF NOT EXISTS lease_expires_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS heartbeat_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS next_attempt_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS recovery_count     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dead_lettered_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_failed_at     TIMESTAMPTZ;

-- Index: fast lookup of claimable jobs (queued + ready-to-retry failed)
CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_claimable
  ON ingestion_jobs (created_at ASC)
  WHERE status = 'queued'
     OR (status = 'failed' AND next_attempt_at IS NOT NULL);

-- Index: fast stuck-job sweep (processing jobs with expired lease)
CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_processing_lease
  ON ingestion_jobs (lease_expires_at ASC)
  WHERE status IN ('fetching','extracting','normalising','chunking','embedding','cancelling');
