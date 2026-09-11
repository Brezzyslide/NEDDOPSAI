-- 0057 - Shared org audit event function
--
-- The current dev/prod model stores org audit events in the shared public
-- org_audit_log table. Direct DML on that legacy table remains revoked from
-- needsops_app; callers must use this bounded SECURITY DEFINER function.

BEGIN;

CREATE OR REPLACE FUNCTION public.write_org_audit_event(
  p_id TEXT,
  p_organization_id TEXT,
  p_actor_user_id TEXT,
  p_actor_type TEXT,
  p_event_type TEXT,
  p_resource_type TEXT,
  p_resource_id TEXT,
  p_request_id TEXT,
  p_ip_address TEXT,
  p_user_agent TEXT,
  p_access_purpose TEXT,
  p_is_sensitive BOOLEAN,
  p_metadata JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_organization_id IS NULL OR btrim(p_organization_id) = '' THEN
    RAISE EXCEPTION 'write_org_audit_event requires organization_id';
  END IF;

  IF p_event_type IS NULL OR btrim(p_event_type) = '' THEN
    RAISE EXCEPTION 'write_org_audit_event requires event_type';
  END IF;

  IF p_resource_type IS NULL OR btrim(p_resource_type) = '' THEN
    RAISE EXCEPTION 'write_org_audit_event requires resource_type';
  END IF;

  INSERT INTO public.org_audit_log (
    id,
    organization_id,
    actor_user_id,
    actor_type,
    event_type,
    resource_type,
    resource_id,
    request_id,
    ip_address,
    user_agent,
    access_purpose,
    is_sensitive,
    metadata,
    occurred_at
  )
  VALUES (
    COALESCE(NULLIF(p_id, ''), gen_random_uuid()::text),
    p_organization_id,
    NULLIF(p_actor_user_id, ''),
    COALESCE(NULLIF(p_actor_type, ''), 'system'),
    p_event_type,
    p_resource_type,
    NULLIF(p_resource_id, ''),
    NULLIF(p_request_id, ''),
    NULLIF(p_ip_address, ''),
    NULLIF(p_user_agent, ''),
    NULLIF(p_access_purpose, ''),
    COALESCE(p_is_sensitive, FALSE),
    COALESCE(p_metadata, '{}'::jsonb),
    NOW()
  );
END;
$$;

ALTER FUNCTION public.write_org_audit_event(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, JSONB
) OWNER TO needsops_admin;

REVOKE ALL ON FUNCTION public.write_org_audit_event(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, JSONB
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.write_org_audit_event(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, JSONB
) TO needsops_app;

GRANT EXECUTE ON FUNCTION public.write_org_audit_event(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, JSONB
) TO needsops_worker_app;

COMMIT;
