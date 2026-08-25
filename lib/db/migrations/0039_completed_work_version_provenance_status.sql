-- 0039_completed_work_version_provenance_status.sql
-- Add the durable provenance lifecycle column expected by claim persistence.
--
-- The application schema has exported completed_work_versions.provenance_status
-- since Sprint 29K.3, but the ordered AWS platform migrations did not add the
-- column to fresh Dev databases created from Sprint 22. Keep the default aligned
-- with the Drizzle schema so historical rows are explicitly legacy rather than
-- incorrectly marked failed.

ALTER TABLE completed_work_versions
  ADD COLUMN IF NOT EXISTS provenance_status TEXT NOT NULL DEFAULT 'not_available_legacy';

COMMENT ON COLUMN completed_work_versions.provenance_status IS
  'Version-level provenance lifecycle: not_available_legacy, pending, complete, partial, or failed.';
