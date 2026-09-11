-- 0055 - Worker ingestion recovery function
--
-- Adds a bounded SECURITY DEFINER function for queue-wide lease recovery.
-- The worker role can execute this without receiving direct table privileges.

BEGIN;

CREATE OR REPLACE FUNCTION public.recover_stuck_ingestion_jobs(
  p_stuck_before TIMESTAMPTZ DEFAULT NOW() - INTERVAL '2 minutes',
  p_limit INTEGER DEFAULT 50
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_recovered INTEGER;
BEGIN
  WITH stuck AS (
    SELECT id, status, attempt_count, max_attempts
      FROM public.ingestion_jobs
     WHERE status IN ('fetching', 'extracting', 'normalising', 'chunking', 'embedding', 'cancelling')
       AND lease_expires_at < p_stuck_before
     ORDER BY lease_expires_at ASC, id ASC
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 500)
     FOR UPDATE SKIP LOCKED
  ),
  recovered AS (
    UPDATE public.ingestion_jobs j
       SET status = CASE
                      WHEN stuck.attempt_count >= stuck.max_attempts THEN 'dead_lettered'
                      ELSE 'queued'
                    END,
           claimed_by = NULL,
           lease_expires_at = NULL,
           heartbeat_at = NULL,
           recovery_count = j.recovery_count + 1,
           dead_lettered_at = CASE
                                WHEN stuck.attempt_count >= stuck.max_attempts THEN NOW()
                                ELSE NULL
                              END,
           next_attempt_at = CASE
                               WHEN stuck.attempt_count < stuck.max_attempts THEN NOW() + INTERVAL '30 seconds'
                               ELSE NULL
                             END,
           last_error_code = CASE
                               WHEN stuck.attempt_count >= stuck.max_attempts
                                 THEN COALESCE(j.last_error_code, 'LEASE_EXPIRED')
                               ELSE j.last_error_code
                             END,
           last_error_message = CASE
                                  WHEN stuck.attempt_count >= stuck.max_attempts
                                    AND j.last_error_message IS NULL
                                    THEN 'Job lease expired during stage ''' || stuck.status || ''' after ' || stuck.attempt_count || ' attempt(s). Worker likely crashed or hung.'
                                  ELSE j.last_error_message
                                END,
           last_failed_at = CASE
                              WHEN stuck.attempt_count >= stuck.max_attempts
                                AND j.last_failed_at IS NULL
                                THEN NOW()
                              ELSE j.last_failed_at
                            END,
           metadata = COALESCE(j.metadata, '{}'::jsonb) || jsonb_build_object(
             'recoveredFromLease', true,
             'stageAtRecovery', stuck.status
           ),
           updated_at = NOW()
      FROM stuck
     WHERE j.id = stuck.id
     RETURNING j.id
  )
  SELECT COUNT(*) INTO v_recovered FROM recovered;

  RETURN v_recovered;
END;
$$;

COMMENT ON FUNCTION public.recover_stuck_ingestion_jobs(TIMESTAMPTZ, INTEGER) IS
  'Worker-only bounded ingestion lease recovery using FOR UPDATE SKIP LOCKED; requeues retryable expired leases and dead-letters exhausted jobs.';

REVOKE ALL ON FUNCTION public.recover_stuck_ingestion_jobs(TIMESTAMPTZ, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recover_stuck_ingestion_jobs(TIMESTAMPTZ, INTEGER) TO needsops_worker_app;

COMMIT;
