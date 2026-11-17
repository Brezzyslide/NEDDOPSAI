ALTER TABLE completed_work_versions
  ADD COLUMN IF NOT EXISTS evidence_gap_declaration jsonb;
