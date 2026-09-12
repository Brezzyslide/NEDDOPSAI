-- ─── Sprint 7.1 — Production Boundary Close-Out ─────────────────────────────
-- Migration: sprint71-write-restrictions.sql
--
-- Applies the write restrictions that were specified in the Sprint 7 migration
-- but not applied to the live database, plus org classification columns.
--
-- Audit tables are always directly write-restricted. Task/approval table
-- write restrictions are schema-per-tenant preparation only; keep them gated
-- until org-schema task routing is active, otherwise current shared-public
-- task creation breaks before it has a destination.
--
-- Idempotent: safe to run multiple times.
-- Applied: 2026-07-25
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── 1. Revoke INSERT / UPDATE / DELETE on legacy shared operational tables ────
--
-- The needsops_app role must not write to these tables after Sprint 7.1.
-- Data reads (SELECT) remain permitted for backward compatibility during
-- the legacy retention period.
--
-- Use a superuser connection (e.g. the Replit DATABASE_URL which connects
-- as the postgres superuser) to run REVOKE commands.

DO $$
BEGIN
  -- audit_log: REVOKE INSERT (was already in sprint7 SQL but not applied to live DB)
  EXECUTE 'REVOKE INSERT, UPDATE, DELETE ON public.audit_log FROM needsops_app';
  RAISE NOTICE 'Revoked INSERT/UPDATE/DELETE on audit_log from needsops_app';
EXCEPTION WHEN undefined_object OR insufficient_privilege THEN
  RAISE NOTICE 'Could not revoke on audit_log (role may not exist or already revoked)';
END;
$$;

DO $$
BEGIN
  -- org_audit_log: legacy shared table — writes must go to org schema
  EXECUTE 'REVOKE INSERT, UPDATE, DELETE ON public.org_audit_log FROM needsops_app';
  RAISE NOTICE 'Revoked INSERT/UPDATE/DELETE on org_audit_log from needsops_app';
EXCEPTION WHEN undefined_object OR insufficient_privilege THEN
  RAISE NOTICE 'Could not revoke on org_audit_log';
END;
$$;

DO $$
DECLARE
  enforce_task_boundary BOOLEAN;
BEGIN
  SELECT
    COALESCE(NULLIF(current_setting('app.enforce_legacy_public_task_write_restrictions', TRUE), ''), 'false') = 'true'
    OR EXISTS (SELECT 1 FROM public.org_database_registry LIMIT 1)
  INTO enforce_task_boundary;

  IF enforce_task_boundary THEN
    -- Legacy shared task tables — no new writes once org-schema task routing exists.
    EXECUTE 'REVOKE INSERT, UPDATE, DELETE ON public.tasks FROM needsops_app';
    EXECUTE 'REVOKE INSERT, UPDATE, DELETE ON public.approvals FROM needsops_app';
    EXECUTE 'REVOKE INSERT, UPDATE, DELETE ON public.approval_history FROM needsops_app';
    EXECUTE 'REVOKE INSERT, UPDATE, DELETE ON public.task_execution_plans FROM needsops_app';
    EXECUTE 'REVOKE INSERT, UPDATE, DELETE ON public.task_specialists FROM needsops_app';
    EXECUTE 'REVOKE INSERT, UPDATE, DELETE ON public.task_participants FROM needsops_app';
    RAISE NOTICE 'Revoked INSERT/UPDATE/DELETE on legacy public task subsystem from needsops_app';
  ELSE
    RAISE NOTICE 'Skipped public task write revokes: org-schema task routing is not active.';
  END IF;
EXCEPTION WHEN undefined_object OR insufficient_privilege THEN
  RAISE NOTICE 'Could not apply conditional public task write revokes';
END;
$$;

-- ── 2. Mark legacy tables with comments ──────────────────────────────────────

COMMENT ON TABLE public.audit_log IS
  'LEGACY — read-only from Sprint 7. New platform events go to platform_audit_log; org events go to org-schema org_audit_log. Do not insert here.';

COMMENT ON TABLE public.org_audit_log IS
  'LEGACY — read-only from Sprint 7.1. New org events go to org-schema org_audit_log. Do not insert here.';

COMMENT ON TABLE public.tasks IS
  'Shared tenant table from Sprint 6. Writable under RLS until org-schema task routing is active; then legacy/read-only.';

COMMENT ON TABLE public.approvals IS
  'Shared tenant table from Sprint 6. Writable under RLS until org-schema approval routing is active; then legacy/read-only.';

COMMENT ON TABLE public.approval_history IS
  'Shared tenant table from Sprint 6. Writable under RLS until org-schema approval routing is active; then legacy/read-only.';

COMMENT ON TABLE public.task_execution_plans IS
  'Shared tenant table from Sprint 6. Writable under RLS until org-schema task routing is active; then legacy/read-only.';

COMMENT ON TABLE public.task_specialists IS
  'Shared tenant table from Sprint 6. Writable under RLS until org-schema task routing is active; then legacy/read-only.';

-- ── 3. Organisation classification columns ────────────────────────────────────
-- Stored as metadata; not inferred from name or slug.
-- is_test_organisation: excludes from billing/analytics/production dashboards.
-- environment: 'internal' | 'test' | 'production'

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS is_test_organisation BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS environment TEXT NOT NULL DEFAULT 'production';

COMMENT ON COLUMN public.organizations.is_test_organisation IS
  'True for test/sandbox organisations. Excluded from billing reports, customer counts, and production analytics. Set explicitly — never inferred from name.';

COMMENT ON COLUMN public.organizations.environment IS
  'Classification: internal | test | production. Use this, not name matching, to identify org type.';

COMMIT;
