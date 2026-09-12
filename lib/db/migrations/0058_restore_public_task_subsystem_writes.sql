-- 0058 - Restore public task subsystem writes
--
-- Current production still creates and executes tasks in shared public tables
-- under tenant RLS. Sprint 7.1's legacy task write restriction is correct only
-- once org-schema task routing is active. Until then, needsops_app must retain
-- write privileges on the task subsystem tables so RLS can enforce org scope.
--
-- Direct writes to public.audit_log and public.org_audit_log remain revoked.
-- Org audit writes use public.write_org_audit_event(...).

BEGIN;

GRANT INSERT, UPDATE, DELETE ON TABLE public.tasks TO needsops_app;
GRANT INSERT, UPDATE, DELETE ON TABLE public.task_execution_plans TO needsops_app;
GRANT INSERT, UPDATE, DELETE ON TABLE public.task_specialists TO needsops_app;
GRANT INSERT, UPDATE, DELETE ON TABLE public.approvals TO needsops_app;
GRANT INSERT, UPDATE, DELETE ON TABLE public.approval_history TO needsops_app;
GRANT INSERT, UPDATE, DELETE ON TABLE public.task_participants TO needsops_app;

REVOKE INSERT, UPDATE, DELETE ON TABLE public.audit_log FROM needsops_app;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.org_audit_log FROM needsops_app;

COMMENT ON TABLE public.tasks IS
  'Shared tenant task table. Writable by needsops_app under RLS until org-schema task routing is active.';

COMMENT ON TABLE public.task_execution_plans IS
  'Shared tenant task execution plans. Writable by needsops_app under RLS until org-schema task routing is active.';

COMMENT ON TABLE public.task_specialists IS
  'Shared tenant task specialists. Writable by needsops_app under RLS until org-schema task routing is active.';

COMMENT ON TABLE public.approvals IS
  'Shared tenant approvals. Writable by needsops_app under RLS until org-schema approval routing is active.';

COMMENT ON TABLE public.approval_history IS
  'Shared tenant approval history. Writable by needsops_app under RLS until org-schema approval routing is active.';

COMMENT ON TABLE public.task_participants IS
  'Shared tenant task participant bindings. Writable by needsops_app under RLS until org-schema task routing is active.';

COMMIT;
