-- 0066_notification_reads_grant_and_rls_grant_guard.sql
--
-- Notification state writes use notification_reads through the request-serving
-- app role. Keep that grant explicit so the table cannot rely on historical
-- broad grants or migration ordering side effects.

BEGIN;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.notification_reads TO needsops_app;

COMMENT ON TABLE public.notification_reads IS
  'Tenant-scoped notification read/archive/snooze state. Writable by needsops_app under RLS.';

COMMIT;
