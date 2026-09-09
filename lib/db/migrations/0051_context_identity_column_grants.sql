BEGIN;

-- A4 follow-up: context assembly reads must use explicit, narrow identity
-- columns. Keep users.email excluded from the normal API role.
GRANT SELECT (
  id,
  external_id,
  first_name,
  last_name,
  display_name
) ON TABLE public.users TO needsops_app;

GRANT SELECT (
  id,
  name,
  display_name,
  slug,
  type,
  industry,
  country,
  state,
  timezone,
  ndis_registration_number,
  subscription_tier,
  status,
  execution_frozen
) ON TABLE public.organizations TO needsops_app;

COMMIT;
