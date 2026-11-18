ALTER TABLE work_blueprints
  ADD COLUMN IF NOT EXISTS outcome_label TEXT,
  ADD COLUMN IF NOT EXISTS requires_participant BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS composes_with JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS execution_surface TEXT NOT NULL DEFAULT 'task_only';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_work_blueprints_execution_surface'
  ) THEN
    ALTER TABLE work_blueprints
      ADD CONSTRAINT chk_work_blueprints_execution_surface
      CHECK (execution_surface IN ('task_only', 'conversation_allowed'));
  END IF;
END $$;
