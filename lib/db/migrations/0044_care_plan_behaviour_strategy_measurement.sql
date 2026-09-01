-- 0044_care_plan_behaviour_strategy_measurement.sql
-- Append-only measurement records for care_plan Behavioural Management strategy
-- classification and APO confirmation/correction events.

CREATE TABLE IF NOT EXISTS care_plan_behaviour_strategy_measurements (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  completed_work_id TEXT REFERENCES completed_work(id) ON DELETE CASCADE,
  completed_work_version_id TEXT REFERENCES completed_work_versions(id) ON DELETE SET NULL,
  participant_id TEXT,
  strategy_fingerprint TEXT NOT NULL,
  strategy_text TEXT NOT NULL,
  bsp_source_quote TEXT NOT NULL,
  model_folds JSONB NOT NULL DEFAULT '[]'::jsonb,
  apo_folds JSONB NOT NULL DEFAULT '[]'::jsonb,
  confirmation_status TEXT NOT NULL,
  actor_user_id TEXT,
  confirmed_at TIMESTAMPTZ,
  corrected_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_care_plan_behaviour_measurements_org
  ON care_plan_behaviour_strategy_measurements (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_care_plan_behaviour_measurements_work
  ON care_plan_behaviour_strategy_measurements (completed_work_id, completed_work_version_id);

CREATE INDEX IF NOT EXISTS idx_care_plan_behaviour_measurements_fingerprint
  ON care_plan_behaviour_strategy_measurements (organization_id, strategy_fingerprint, created_at DESC);
