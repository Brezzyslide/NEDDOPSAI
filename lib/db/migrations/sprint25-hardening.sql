-- Sprint 25 Hardening — Server-backed comment resolution
--
-- Adds comment lifecycle columns to completed_work_comments so that
-- resolve / reopen state is persisted in the database rather than
-- localStorage.

ALTER TABLE completed_work_comments
  ADD COLUMN IF NOT EXISTS status              TEXT        NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS resolved_by_user_id TEXT,
  ADD COLUMN IF NOT EXISTS resolved_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reopened_by_user_id TEXT,
  ADD COLUMN IF NOT EXISTS reopened_at         TIMESTAMPTZ;

-- Constraint: status must be a known value
ALTER TABLE completed_work_comments
  DROP CONSTRAINT IF EXISTS completed_work_comments_status_check;
ALTER TABLE completed_work_comments
  ADD CONSTRAINT completed_work_comments_status_check
  CHECK (status IN ('open', 'resolved', 'reopened'));

-- Index to support filtering by status
CREATE INDEX IF NOT EXISTS idx_completed_work_comments_status
  ON completed_work_comments (completed_work_id, status);
