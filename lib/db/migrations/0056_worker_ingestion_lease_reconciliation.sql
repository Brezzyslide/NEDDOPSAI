-- 0056 - Worker ingestion lease reconciliation
--
-- Ensures worker claims always set a lease and allows bounded recovery of
-- legacy claimed jobs that were left in fetching with a NULL lease.

BEGIN;

CREATE OR REPLACE FUNCTION public.claim_next_ingestion_job(
  p_worker_id TEXT
)
RETURNS TABLE (
  id TEXT,
  "organizationId" TEXT,
  "knowledgeSourceId" TEXT,
  "sourceVersionId" TEXT,
  status TEXT,
  "attemptCount" INTEGER
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  UPDATE public.ingestion_jobs
     SET status = 'fetching',
         claimed_by = p_worker_id,
         claimed_at = NOW(),
         heartbeat_at = NOW(),
         lease_expires_at = NOW() + INTERVAL '2 minutes',
         last_attempt_at = NOW(),
         attempt_count = attempt_count + 1,
         started_at = COALESCE(started_at, NOW()),
         updated_at = NOW()
   WHERE id = (
     SELECT id
       FROM public.ingestion_jobs
      WHERE status = 'queued'
         OR (status = 'failed' AND attempt_count < max_attempts)
      ORDER BY created_at ASC, id ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
   )
   RETURNING
     ingestion_jobs.id,
     ingestion_jobs.organization_id,
     ingestion_jobs.knowledge_source_id,
     ingestion_jobs.source_version_id,
     ingestion_jobs.status,
     ingestion_jobs.attempt_count;
$$;

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
       AND (
         lease_expires_at < p_stuck_before
         OR (lease_expires_at IS NULL AND updated_at < p_stuck_before)
       )
     ORDER BY COALESCE(lease_expires_at, updated_at) ASC, id ASC
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

REVOKE ALL ON FUNCTION public.claim_next_ingestion_job(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_next_ingestion_job(TEXT) TO needsops_worker_app;

REVOKE ALL ON FUNCTION public.recover_stuck_ingestion_jobs(TIMESTAMPTZ, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recover_stuck_ingestion_jobs(TIMESTAMPTZ, INTEGER) TO needsops_worker_app;

COMMIT;
