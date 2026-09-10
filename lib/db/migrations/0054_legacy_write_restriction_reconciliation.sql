-- 0054 - Legacy write restriction reconciliation
--
-- Re-applies the Sprint 7.1 write boundary through the ordered migration
-- runner. Live databases may have sprint71-write-restrictions recorded while
-- still retaining needsops_app write privileges from manual remediation.

BEGIN;

REVOKE INSERT, UPDATE, DELETE ON TABLE public.audit_log FROM needsops_app;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.org_audit_log FROM needsops_app;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.tasks FROM needsops_app;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.approvals FROM needsops_app;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.approval_history FROM needsops_app;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.task_execution_plans FROM needsops_app;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.task_specialists FROM needsops_app;

COMMIT;
