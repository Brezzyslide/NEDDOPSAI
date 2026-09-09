BEGIN;

-- Authenticated notification badge reads join message_reads to exclude messages
-- the current user has already read. Keep the grant to the joined columns only.
GRANT SELECT (
  id,
  organization_id,
  message_id,
  user_id,
  read_at
) ON TABLE public.message_reads TO needsops_app;

COMMIT;
