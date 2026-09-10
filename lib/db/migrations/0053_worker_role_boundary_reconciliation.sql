BEGIN;

-- Reconcile the worker runtime boundary after the A4 hand-applied grant pass:
-- the worker remains NOINHERIT at rest, then withSystemTenantContext uses
-- transaction-scoped SET LOCAL ROLE needsops_app for tenant-bound work.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'needsops_worker_app') THEN
    ALTER ROLE needsops_worker_app NOINHERIT;
    GRANT needsops_app TO needsops_worker_app;
  END IF;
END;
$$;

COMMIT;
