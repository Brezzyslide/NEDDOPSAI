-- ─── Sprint 7.1 — Production Boundary Close-Out ─────────────────────────────
-- Migration: sprint71-write-restrictions.sql
--
-- Applies the write restrictions that were specified in the Sprint 7 migration
-- but not applied to the live database, plus org classification columns.
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
BEGIN
  -- tasks: legacy shared table — no new writes
  EXECUTE 'REVOKE INSERT, UPDATE, DELETE ON public.tasks FROM needsops_app';
  RAISE NOTICE 'Revoked INSERT/UPDATE/DELETE on tasks from needsops_app';
EXCEPTION WHEN undefined_object OR insufficient_privilege THEN
  RAISE NOTICE 'Could not revoke on tasks';
END;
$$;

DO $$
BEGIN
  -- approvals: legacy shared table
  EXECUTE 'REVOKE INSERT, UPDATE, DELETE ON public.approvals FROM needsops_app';
  RAISE NOTICE 'Revoked INSERT/UPDATE/DELETE on approvals from needsops_app';
EXCEPTION WHEN undefined_object OR insufficient_privilege THEN
  RAISE NOTICE 'Could not revoke on approvals';
END;
$$;

DO $$
BEGIN
  -- approval_history: legacy shared table
  EXECUTE 'REVOKE INSERT, UPDATE, DELETE ON public.approval_history FROM needsops_app';
  RAISE NOTICE 'Revoked INSERT/UPDATE/DELETE on approval_history from needsops_app';
EXCEPTION WHEN undefined_object OR insufficient_privilege THEN
  RAISE NOTICE 'Could not revoke on approval_history';
END;
$$;

DO $$
BEGIN
  -- task_execution_plans: legacy shared table
  EXECUTE 'REVOKE INSERT, UPDATE, DELETE ON public.task_execution_plans FROM needsops_app';
  RAISE NOTICE 'Revoked INSERT/UPDATE/DELETE on task_execution_plans from needsops_app';
EXCEPTION WHEN undefined_object OR insufficient_privilege THEN
  RAISE NOTICE 'Could not revoke on task_execution_plans';
END;
$$;

DO $$
BEGIN
  -- task_specialists: legacy shared table
  EXECUTE 'REVOKE INSERT, UPDATE, DELETE ON public.task_specialists FROM needsops_app';
  RAISE NOTICE 'Revoked INSERT/UPDATE/DELETE on task_specialists from needsops_app';
EXCEPTION WHEN undefined_object OR insufficient_privilege THEN
  RAISE NOTICE 'Could not revoke on task_specialists';
END;
$$;

-- ── 2. Mark legacy tables with comments ──────────────────────────────────────

COMMENT ON TABLE public.audit_log IS
  'LEGACY — read-only from Sprint 7. New platform events go to platform_audit_log; org events go to org-schema org_audit_log. Do not insert here.';

COMMENT ON TABLE public.org_audit_log IS
  'LEGACY — read-only from Sprint 7.1. New org events go to org-schema org_audit_log. Do not insert here.';

COMMENT ON TABLE public.tasks IS
  'LEGACY — shared tenant table from Sprint 6. Read-only after Sprint 7.1 boundary close. Operational data lives in org-schema org_tasks.';

COMMENT ON TABLE public.approvals IS
  'LEGACY — shared tenant table from Sprint 6. Read-only after Sprint 7.1 boundary close.';

COMMENT ON TABLE public.approval_history IS
  'LEGACY — shared tenant table from Sprint 6. Read-only after Sprint 7.1 boundary close.';

COMMENT ON TABLE public.task_execution_plans IS
  'LEGACY — shared tenant table from Sprint 6. Read-only after Sprint 7.1 boundary close.';

COMMENT ON TABLE public.task_specialists IS
  'LEGACY — shared tenant table from Sprint 6. Read-only after Sprint 7.1 boundary close.';

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
