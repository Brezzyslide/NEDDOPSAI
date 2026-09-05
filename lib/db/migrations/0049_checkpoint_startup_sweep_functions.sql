-- 0049_checkpoint_startup_sweep_functions.sql
--
-- Narrow SECURITY DEFINER functions for API startup checkpoint maintenance.
-- These are cross-organisation maintenance sweeps, so request-serving roles
-- receive EXECUTE only and no direct broad UPDATE privilege is required.

BEGIN;

CREATE OR REPLACE FUNCTION public.expire_stale_execution_checkpoints(
  p_limit INTEGER DEFAULT 500
)
RETURNS INTEGER
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  WITH expired AS (
    UPDATE public.execution_checkpoints c
       SET status = 'expired',
           updated_at = NOW()
     WHERE c.id IN (
       SELECT id
         FROM public.execution_checkpoints
        WHERE status IN ('active', 'awaiting_clarification', 'resuming')
          AND expires_at < NOW()
        ORDER BY expires_at ASC, id ASC
        LIMIT LEAST(GREATEST(COALESCE(p_limit, 500), 1), 5000)
     )
     RETURNING c.id
  )
  SELECT COUNT(*)::INTEGER FROM expired;
$$;

CREATE OR REPLACE FUNCTION public.recover_stuck_execution_resumes(
  p_stuck_before TIMESTAMPTZ DEFAULT NOW() - INTERVAL '5 minutes',
  p_limit INTEGER DEFAULT 500
)
RETURNS INTEGER
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  WITH recovered AS (
    UPDATE public.execution_checkpoints c
       SET status = 'awaiting_clarification',
           updated_at = NOW()
     WHERE c.id IN (
       SELECT id
         FROM public.execution_checkpoints
        WHERE status = 'resuming'
          AND updated_at < p_stuck_before
        ORDER BY updated_at ASC, id ASC
        LIMIT LEAST(GREATEST(COALESCE(p_limit, 500), 1), 5000)
     )
     RETURNING c.id
  )
  SELECT COUNT(*)::INTEGER FROM recovered;
$$;

COMMENT ON FUNCTION public.expire_stale_execution_checkpoints(INTEGER) IS
  'Bounded cross-org startup maintenance function that marks expired execution checkpoints as expired. EXECUTE-only for request-serving roles.';
COMMENT ON FUNCTION public.recover_stuck_execution_resumes(TIMESTAMPTZ, INTEGER) IS
  'Bounded cross-org startup maintenance function that returns stale resuming checkpoints to awaiting_clarification. EXECUTE-only for request-serving roles.';

REVOKE ALL ON FUNCTION public.expire_stale_execution_checkpoints(INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recover_stuck_execution_resumes(TIMESTAMPTZ, INTEGER) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.expire_stale_execution_checkpoints(INTEGER) TO needsops_app;
GRANT EXECUTE ON FUNCTION public.recover_stuck_execution_resumes(TIMESTAMPTZ, INTEGER) TO needsops_app;

COMMIT;
