-- 0036_work_package_manifest_observability.sql
-- Additive reconciliation for Sprint 27.4 manifest observability fields.
--
-- These columns are nullable by design. They are populated by runtime stages
-- after manifest assembly and must not block historical manifests or rewrite
-- existing work-package records.

ALTER TABLE work_package_manifests
  ADD COLUMN IF NOT EXISTS selection_metadata JSONB,
  ADD COLUMN IF NOT EXISTS validation_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS performance_metrics JSONB,
  ADD COLUMN IF NOT EXISTS failure_info JSONB;

COMMENT ON COLUMN work_package_manifests.selection_metadata IS
  'Runtime observability: how the blueprint/specialist was selected for this execution.';
COMMENT ON COLUMN work_package_manifests.validation_snapshot IS
  'Runtime observability: prerequisite validation outcome captured during execution.';
COMMENT ON COLUMN work_package_manifests.performance_metrics IS
  'Runtime observability: per-stage timing captured as execution progresses.';
COMMENT ON COLUMN work_package_manifests.failure_info IS
  'Runtime observability: failure or clarification state for execution inspector diagnostics.';
