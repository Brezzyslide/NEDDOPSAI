-- 0047_auth_tenant_resolver.sql
--
-- Adds the narrow pre-tenant auth resolver needed before the request-serving
-- API can move to an RLS-enforced role. The function is intentionally not a
-- general lookup: callers provide only the Clerk external user id and org slug,
-- and receive either one resolved tenant context or zero rows.

BEGIN;

CREATE OR REPLACE FUNCTION public.resolve_auth_tenant_context(
  p_external_user_id TEXT,
  p_org_slug TEXT
)
RETURNS TABLE (
  user_id TEXT,
  user_external_id TEXT,
  user_email TEXT,
  user_first_name TEXT,
  user_last_name TEXT,
  user_display_name TEXT,
  user_status user_status,
  organization_id TEXT,
  organization_slug TEXT,
  organization_status org_status,
  membership_id TEXT,
  membership_role membership_role,
  membership_status membership_status
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  resolved_user public.users%ROWTYPE;
  resolved_org public.organizations%ROWTYPE;
  resolved_membership public.memberships%ROWTYPE;
BEGIN
  IF NULLIF(BTRIM(p_external_user_id), '') IS NULL
     OR NULLIF(BTRIM(p_org_slug), '') IS NULL THEN
    RETURN;
  END IF;

  SELECT *
    INTO resolved_user
    FROM public.users AS u
   WHERE u.external_id = p_external_user_id
   LIMIT 1;

  IF NOT FOUND THEN
    INSERT INTO public.users (
      id,
      external_id,
      email,
      status
    )
    VALUES (
      gen_random_uuid()::TEXT,
      p_external_user_id,
      p_external_user_id || '@unknown.clerk',
      'active'
    )
    RETURNING * INTO resolved_user;
  END IF;

  IF resolved_user.status IN ('suspended', 'deactivated') THEN
    RETURN;
  END IF;

  SELECT *
    INTO resolved_org
    FROM public.organizations AS o
   WHERE o.slug = p_org_slug
   LIMIT 1;

  IF NOT FOUND OR resolved_org.status IN ('closed', 'suspended') THEN
    RETURN;
  END IF;

  SELECT *
    INTO resolved_membership
    FROM public.memberships AS m
   WHERE m.organization_id = resolved_org.id
     AND m.user_id = resolved_user.id
   LIMIT 1;

  IF NOT FOUND OR resolved_membership.status <> 'active' THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    resolved_user.id,
    resolved_user.external_id,
    resolved_user.email,
    resolved_user.first_name,
    resolved_user.last_name,
    resolved_user.display_name,
    resolved_user.status,
    resolved_org.id,
    resolved_org.slug,
    resolved_org.status,
    resolved_membership.id,
    resolved_membership.role,
    resolved_membership.status;
END;
$$;

COMMENT ON FUNCTION public.resolve_auth_tenant_context(TEXT, TEXT) IS
  'Narrow SECURITY DEFINER boundary for resolving one authenticated Clerk user and one organisation slug into a tenant context. Returns zero rows for all invalid, inaccessible, or non-member cases.';

REVOKE ALL ON FUNCTION public.resolve_auth_tenant_context(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_auth_tenant_context(TEXT, TEXT) TO needsops_app;

REVOKE SELECT ON public.users FROM needsops_app;
REVOKE SELECT ON public.organizations FROM needsops_app;
REVOKE SELECT ON public.memberships FROM needsops_app;

COMMIT;
