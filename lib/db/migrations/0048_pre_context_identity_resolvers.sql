-- 0048_pre_context_identity_resolvers.sql
--
-- Adds narrow SECURITY DEFINER resolvers for pre-tenant opaque identity flows.
-- These functions are intentionally not general lookup APIs: each accepts only
-- an opaque token hash or Clerk external user id and returns one resolved
-- context or no rows.

BEGIN;

CREATE OR REPLACE FUNCTION public.resolve_device_credential_context(
  p_token_hash TEXT
)
RETURNS TABLE (
  credential_id TEXT,
  device_id TEXT,
  organization_id TEXT,
  credential_state TEXT,
  device_state TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    c.id,
    c.device_id,
    c.organization_id,
    CASE
      WHEN c.revoked_at IS NOT NULL THEN 'revoked'
      WHEN c.expires_at IS NOT NULL AND c.expires_at <= NOW() THEN 'expired'
      ELSE 'valid'
    END,
    CASE
      WHEN d.id IS NULL OR d.revoked_at IS NOT NULL OR d.status = 'revoked' THEN 'device_revoked'
      WHEN d.is_platform_disabled THEN 'platform_disabled'
      ELSE d.status::TEXT
    END
  FROM public.device_credentials c
  LEFT JOIN public.devices d ON d.id = c.device_id
  WHERE c.token_hash = p_token_hash
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.resolve_device_refresh_token_context(
  p_token_hash TEXT
)
RETURNS TABLE (
  refresh_token_id TEXT,
  device_id TEXT,
  organization_id TEXT,
  token_state TEXT,
  device_state TEXT,
  expires_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    r.id,
    r.device_id,
    r.organization_id,
    CASE
      WHEN r.revoked_at IS NOT NULL THEN 'revoked'
      WHEN r.rotated_at IS NOT NULL THEN 'reused'
      WHEN r.expires_at <= NOW() THEN 'expired'
      ELSE 'valid'
    END,
    CASE
      WHEN d.id IS NULL OR d.revoked_at IS NOT NULL OR d.status = 'revoked' THEN 'device_revoked'
      WHEN d.is_platform_disabled THEN 'platform_disabled'
      ELSE d.status::TEXT
    END,
    r.expires_at
  FROM public.device_refresh_tokens r
  LEFT JOIN public.devices d ON d.id = r.device_id
  WHERE r.token_hash = p_token_hash
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.consume_device_refresh_token(
  p_token_hash TEXT,
  p_superseded_by_id TEXT
)
RETURNS TABLE (
  refresh_token_id TEXT,
  device_id TEXT,
  organization_id TEXT,
  token_state TEXT,
  device_state TEXT,
  expires_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  WITH consumed AS (
    UPDATE public.device_refresh_tokens r
       SET rotated_at = NOW(),
           superseded_by_id = p_superseded_by_id
      FROM public.devices d
     WHERE r.token_hash = p_token_hash
       AND d.id = r.device_id
       AND d.revoked_at IS NULL
       AND d.status <> 'revoked'
       AND NOT d.is_platform_disabled
       AND d.status <> 'pending'
       AND r.revoked_at IS NULL
       AND r.rotated_at IS NULL
       AND r.expires_at > NOW()
     RETURNING
       r.id,
       r.device_id,
       r.organization_id,
       r.expires_at,
       d.status::TEXT AS device_state
  )
  SELECT
    c.id,
    c.device_id,
    c.organization_id,
    'valid'::TEXT,
    c.device_state,
    c.expires_at
  FROM consumed c
  UNION ALL
  SELECT
    resolved.refresh_token_id,
    resolved.device_id,
    resolved.organization_id,
    resolved.token_state,
    resolved.device_state,
    resolved.expires_at
  FROM public.resolve_device_refresh_token_context(p_token_hash) resolved
  WHERE NOT EXISTS (SELECT 1 FROM consumed)
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.resolve_device_access_token_context(
  p_token_hash TEXT
)
RETURNS TABLE (
  access_token_id TEXT,
  device_id TEXT,
  organization_id TEXT,
  token_state TEXT,
  device_state TEXT,
  audience TEXT,
  expires_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    a.id,
    a.device_id,
    a.organization_id,
    CASE
      WHEN a.revoked_at IS NOT NULL THEN 'revoked'
      WHEN a.expires_at <= NOW() THEN 'expired'
      ELSE 'valid'
    END,
    CASE
      WHEN d.id IS NULL OR d.revoked_at IS NOT NULL OR d.status = 'revoked' THEN 'device_revoked'
      WHEN d.is_platform_disabled THEN 'platform_disabled'
      ELSE d.status::TEXT
    END,
    a.audience,
    a.expires_at
  FROM public.device_access_tokens a
  LEFT JOIN public.devices d ON d.id = a.device_id
  WHERE a.token_hash = p_token_hash
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.resolve_invitation_token_context(
  p_token_hash TEXT,
  p_external_user_id TEXT
)
RETURNS TABLE (
  invitation_id TEXT,
  organization_id TEXT,
  user_id TEXT,
  invitation_email TEXT,
  invitation_role membership_role,
  invited_by TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    i.id,
    i.organization_id,
    u.id,
    i.email,
    i.role,
    i.invited_by
  FROM public.invitations i
  JOIN public.users u
    ON u.external_id = p_external_user_id
   AND lower(u.email) = lower(i.email)
   AND u.status NOT IN ('suspended', 'deactivated')
  JOIN public.organizations o
    ON o.id = i.organization_id
   AND o.status NOT IN ('closed', 'suspended')
  WHERE i.token_hash = p_token_hash
    AND i.status = 'pending'
    AND i.expires_at > NOW()
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.resolve_user_self_context(
  p_external_user_id TEXT
)
RETURNS TABLE (
  user_id TEXT,
  user_external_id TEXT,
  user_email TEXT,
  user_first_name TEXT,
  user_last_name TEXT,
  user_display_name TEXT,
  user_status user_status
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  resolved_user public.users%ROWTYPE;
BEGIN
  IF NULLIF(BTRIM(p_external_user_id), '') IS NULL THEN
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

  RETURN QUERY
  SELECT
    resolved_user.id,
    resolved_user.external_id,
    resolved_user.email,
    resolved_user.first_name,
    resolved_user.last_name,
    resolved_user.display_name,
    resolved_user.status;
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_user_organisations(
  p_external_user_id TEXT
)
RETURNS TABLE (
  membership_id TEXT,
  membership_role membership_role,
  membership_status membership_status,
  joined_at TIMESTAMPTZ,
  organization_id TEXT,
  organization_slug TEXT,
  organization_name TEXT,
  organization_display_name TEXT,
  organization_status org_status,
  subscription_tier subscription_tier
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    m.id,
    m.role,
    m.status,
    m.joined_at,
    o.id,
    o.slug,
    o.name,
    o.display_name,
    o.status,
    o.subscription_tier
  FROM public.users u
  JOIN public.memberships m ON m.user_id = u.id
  JOIN public.organizations o ON o.id = m.organization_id
  WHERE u.external_id = p_external_user_id
    AND u.status NOT IN ('suspended', 'deactivated')
    AND m.status IN ('active', 'invited')
    AND o.status NOT IN ('closed', 'suspended')
  ORDER BY o.name ASC, o.id ASC;
$$;

COMMENT ON FUNCTION public.resolve_device_credential_context(TEXT) IS
  'Narrow SECURITY DEFINER resolver for one device credential token hash. No enumeration; no writes.';
COMMENT ON FUNCTION public.resolve_device_refresh_token_context(TEXT) IS
  'Narrow SECURITY DEFINER resolver for one device refresh token hash. No enumeration; no writes.';
COMMENT ON FUNCTION public.consume_device_refresh_token(TEXT, TEXT) IS
  'Narrow SECURITY DEFINER refresh-token consumer. It atomically marks only the supplied token hash as rotated, links the caller-supplied replacement token id, and returns no enumerable data.';
COMMENT ON FUNCTION public.resolve_device_access_token_context(TEXT) IS
  'Narrow SECURITY DEFINER resolver for one device access token hash. No enumeration; no writes; caller updates last-used inside tenant context.';
COMMENT ON FUNCTION public.resolve_invitation_token_context(TEXT, TEXT) IS
  'Narrow SECURITY DEFINER resolver for one invitation token hash and authenticated Clerk external user id. Returns no rows for invalid, expired, mismatched, or inaccessible invitations.';
COMMENT ON FUNCTION public.resolve_user_self_context(TEXT) IS
  'Narrow SECURITY DEFINER resolver for the authenticated Clerk external user id. JIT-creates only that user row when absent.';
COMMENT ON FUNCTION public.resolve_user_organisations(TEXT) IS
  'Narrow SECURITY DEFINER resolver returning only organisations for the authenticated Clerk external user id.';

REVOKE ALL ON FUNCTION public.resolve_device_credential_context(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_device_refresh_token_context(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consume_device_refresh_token(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_device_access_token_context(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_invitation_token_context(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_user_self_context(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_user_organisations(TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.resolve_device_credential_context(TEXT) TO needsops_app;
GRANT EXECUTE ON FUNCTION public.resolve_device_refresh_token_context(TEXT) TO needsops_app;
GRANT EXECUTE ON FUNCTION public.consume_device_refresh_token(TEXT, TEXT) TO needsops_app;
GRANT EXECUTE ON FUNCTION public.resolve_device_access_token_context(TEXT) TO needsops_app;
GRANT EXECUTE ON FUNCTION public.resolve_invitation_token_context(TEXT, TEXT) TO needsops_app;
GRANT EXECUTE ON FUNCTION public.resolve_user_self_context(TEXT) TO needsops_app;
GRANT EXECUTE ON FUNCTION public.resolve_user_organisations(TEXT) TO needsops_app;

REVOKE SELECT ON public.users FROM needsops_app;
REVOKE SELECT ON public.organizations FROM needsops_app;
REVOKE SELECT ON public.memberships FROM needsops_app;
REVOKE SELECT ON public.device_credentials FROM needsops_app;
REVOKE SELECT ON public.device_refresh_tokens FROM needsops_app;
REVOKE SELECT ON public.device_access_tokens FROM needsops_app;
REVOKE SELECT ON public.invitations FROM needsops_app;

COMMIT;
