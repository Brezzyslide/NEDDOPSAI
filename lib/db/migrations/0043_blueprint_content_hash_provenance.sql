-- 0043_blueprint_content_hash_provenance.sql
-- Adds hash-backed Blueprint provenance columns. Existing Completed Work was
-- produced before content hashes existed, so it remains explicitly unverified.

ALTER TABLE work_blueprints
  ADD COLUMN IF NOT EXISTS content_hash TEXT;

ALTER TABLE completed_work
  ADD COLUMN IF NOT EXISTS blueprint_content_hash TEXT,
  ADD COLUMN IF NOT EXISTS blueprint_provenance_status TEXT NOT NULL DEFAULT 'provenance_unverified';

UPDATE completed_work
SET blueprint_provenance_status = 'provenance_unverified'
WHERE blueprint_provenance_status IS NULL
   OR blueprint_provenance_status = '';

CREATE INDEX IF NOT EXISTS idx_work_blueprints_content_hash
  ON work_blueprints (content_hash);

CREATE INDEX IF NOT EXISTS idx_completed_work_blueprint_content_hash
  ON completed_work (blueprint_content_hash);
