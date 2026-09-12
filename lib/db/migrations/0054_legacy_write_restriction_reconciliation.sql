-- 0054 - Legacy write restriction reconciliation
--
-- Re-applies the Sprint 7.1 audit write boundary through the ordered
-- migration runner. The original Sprint 7.1 task-table restriction was a
-- schema-per-tenant preparation step, but current production still writes
-- tasks/approvals to public tables under RLS. Enforcing those task revokes
-- before org-schema task routing exists breaks task creation.
--
-- The task/approval revokes below are gated on evidence that the org-schema
-- path is active: at least one org_database_registry row, or an explicit
-- database feature flag:
--   app.enforce_legacy_public_task_write_restrictions = 'true'
--
-- Audit tables remain directly non-writable; org audit writes go through the
-- bounded public.write_org_audit_event(...) function.

BEGIN;

REVOKE INSERT, UPDATE, DELETE ON TABLE public.audit_log FROM needsops_app;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.org_audit_log FROM needsops_app;

DO $$
DECLARE
  enforce_task_boundary BOOLEAN;
BEGIN
  SELECT
    COALESCE(NULLIF(current_setting('app.enforce_legacy_public_task_write_restrictions', TRUE), ''), 'false') = 'true'
    OR EXISTS (SELECT 1 FROM public.org_database_registry LIMIT 1)
  INTO enforce_task_boundary;

  IF enforce_task_boundary THEN
    REVOKE INSERT, UPDATE, DELETE ON TABLE public.tasks FROM needsops_app;
    REVOKE INSERT, UPDATE, DELETE ON TABLE public.approvals FROM needsops_app;
    REVOKE INSERT, UPDATE, DELETE ON TABLE public.approval_history FROM needsops_app;
    REVOKE INSERT, UPDATE, DELETE ON TABLE public.task_execution_plans FROM needsops_app;
    REVOKE INSERT, UPDATE, DELETE ON TABLE public.task_specialists FROM needsops_app;
    REVOKE INSERT, UPDATE, DELETE ON TABLE public.task_participants FROM needsops_app;
  ELSE
    RAISE NOTICE 'Skipping public task write revokes: org-schema task routing is not active.';
  END IF;
END $$;

COMMIT;
