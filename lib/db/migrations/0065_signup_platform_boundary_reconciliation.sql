-- 0065_signup_platform_boundary_reconciliation.sql
--
-- Public signup creates an organisation before tenant context exists. The
-- platform app role therefore needs explicit grants and RLS policies for the
-- tenant-owned rows created in that pre-context transaction.

BEGIN;

GRANT SELECT ON TABLE
  public.memberships,
  public.tenant_settings,
  public.onboarding_sessions
TO needsops_platform_app;

GRANT INSERT, UPDATE ON TABLE
  public.memberships,
  public.tenant_settings,
  public.onboarding_sessions
TO needsops_platform_app;

DROP POLICY IF EXISTS platform_console_insert ON public.memberships;
CREATE POLICY platform_console_insert ON public.memberships
  FOR INSERT TO needsops_platform_app
  WITH CHECK (true);

DROP POLICY IF EXISTS platform_console_update ON public.memberships;
CREATE POLICY platform_console_update ON public.memberships
  FOR UPDATE TO needsops_platform_app
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS platform_console_read ON public.tenant_settings;
CREATE POLICY platform_console_read ON public.tenant_settings
  FOR SELECT TO needsops_platform_app
  USING (true);

DROP POLICY IF EXISTS platform_console_insert ON public.tenant_settings;
CREATE POLICY platform_console_insert ON public.tenant_settings
  FOR INSERT TO needsops_platform_app
  WITH CHECK (true);

DROP POLICY IF EXISTS platform_console_update ON public.tenant_settings;
CREATE POLICY platform_console_update ON public.tenant_settings
  FOR UPDATE TO needsops_platform_app
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS platform_console_read ON public.onboarding_sessions;
CREATE POLICY platform_console_read ON public.onboarding_sessions
  FOR SELECT TO needsops_platform_app
  USING (true);

DROP POLICY IF EXISTS platform_console_insert ON public.onboarding_sessions;
CREATE POLICY platform_console_insert ON public.onboarding_sessions
  FOR INSERT TO needsops_platform_app
  WITH CHECK (true);

DROP POLICY IF EXISTS platform_console_update ON public.onboarding_sessions;
CREATE POLICY platform_console_update ON public.onboarding_sessions
  FOR UPDATE TO needsops_platform_app
  USING (true)
  WITH CHECK (true);

COMMIT;
