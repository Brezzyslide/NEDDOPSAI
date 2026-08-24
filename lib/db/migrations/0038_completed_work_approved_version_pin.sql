-- 0038_completed_work_approved_version_pin.sql
-- Add the approved version pin expected by Completed Work approval/export code.
--
-- The application schema has supported completed_work.approved_version_id since
-- Sprint 29J, but fresh AWS Dev bootstrap did not include the additive column.
-- Keep this nullable for legacy/non-approved rows.

ALTER TABLE completed_work
  ADD COLUMN IF NOT EXISTS approved_version_id TEXT;

COMMENT ON COLUMN completed_work.approved_version_id IS
  'Pins the exact completed_work_versions row approved by a human; null for legacy or non-approved work.';
