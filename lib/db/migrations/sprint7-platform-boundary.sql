-- ============================================================================
-- Sprint 7: Platform Database Boundary, Secrets, and Legacy Audit Migration
-- ============================================================================
-- Idempotent. Run inside a transaction (BEGIN / COMMIT).
-- Re-run after any drizzle push that recreates tables.
-- ============================================================================

BEGIN;

-- ── 1. platform_secrets table ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS platform_secrets (
  id                 TEXT PRIMARY KEY,
  secret_ref         TEXT NOT NULL UNIQUE,
  encrypted_value    TEXT NOT NULL,
  version            INTEGER NOT NULL DEFAULT 1,
  is_revoked         BOOLEAN NOT NULL DEFAULT FALSE,
  revoked_at         TIMESTAMPTZ,
  last_validated_at  TIMESTAMPTZ,
  expires_at         TIMESTAMPTZ,
  metadata           JSONB NOT NULL DEFAULT '{}',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_platform_secrets_ref     ON platform_secrets(secret_ref);
CREATE INDEX IF NOT EXISTS idx_platform_secrets_revoked ON platform_secrets(is_revoked) WHERE is_revoked = FALSE;

-- ── 2. org_database_registry: add Sprint 7 columns ───────────────────────────

ALTER TABLE org_database_registry
  ADD COLUMN IF NOT EXISTS is_dedicated_db   BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS cluster_ref       TEXT,
  ADD COLUMN IF NOT EXISTS backup_config     JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS backup_status     TEXT DEFAULT 'not_configured',
  ADD COLUMN IF NOT EXISTS next_backup_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS migration_state   TEXT DEFAULT 'not_started',
  ADD COLUMN IF NOT EXISTS suspension_reason TEXT,
  ADD COLUMN IF NOT EXISTS decommission_at   TIMESTAMPTZ;

COMMENT ON COLUMN org_database_registry.is_dedicated_db IS
  'TRUE = separate PostgreSQL database. FALSE = schema within shared cluster.';
COMMENT ON COLUMN org_database_registry.cluster_ref IS
  'Identifier for the managed PostgreSQL cluster. NULL = shared platform cluster.';
COMMENT ON COLUMN org_database_registry.backup_status IS
  'Last backup result: not_configured, pending, completed, failed.';
COMMENT ON COLUMN org_database_registry.migration_state IS
  'Data migration state: not_started, inventory, copying, validating, dual_write, reconciling, cutting_over, monitoring, finalised, failed.';

-- ── 3. Legacy audit_log: revoke INSERT for app role ──────────────────────────
-- The audit_log table is now READ-ONLY. New events go to platform_audit_log
-- or org_audit_log exclusively.

DO $rls_audit$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'needsops_app') THEN
    REVOKE INSERT ON audit_log FROM needsops_app;
  END IF;
END $rls_audit$;

COMMENT ON TABLE audit_log IS
  'LEGACY — read-only from Sprint 7. New events go to platform_audit_log or org_audit_log. Do not insert here.';

-- ── 4. platform_secrets: deny direct access to app role ──────────────────────
DO $secrets_perms$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'needsops_app') THEN
    REVOKE ALL ON platform_secrets FROM needsops_app;
  END IF;
END $secrets_perms$;

-- ── 5. RLS on platform_secrets (fail-closed: no policy = no access) ──────────
ALTER TABLE platform_secrets ENABLE ROW LEVEL SECURITY;
-- No USING policy added — this means NO rows visible to non-superusers.
-- The secrets service uses the platform connection (which has superuser/owner
-- privileges) to access this table. Application code must not query it directly.

-- ── 6. Re-apply RLS on all 19 operational tables ─────────────────────────────
-- Uses single-quoted string format inside EXECUTE to avoid nested $$ quoting.

DO $rls_block$
DECLARE
  tbl TEXT;
  tables TEXT[] := ARRAY[
    'tasks', 'task_specialists', 'task_execution_plans',
    'approvals', 'approval_rules', 'approval_history',
    'memberships', 'invitations',
    'tenant_subscriptions', 'tenant_entitlements', 'tenant_overrides',
    'tenant_settings', 'tenant_addons', 'tenant_usage_allowances',
    'tenant_workforce_packs',
    'usage_events', 'usage_period_summaries',
    'org_audit_log', 'audit_log'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', tbl);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (organization_id = NULLIF(current_setting(%L, TRUE), %L))',
      tbl, 'app.current_organization_id', ''
    );
  END LOOP;

  -- audit_log override: allow rows with NULL organization_id (platform events)
  EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON audit_log';
  EXECUTE 'CREATE POLICY tenant_isolation ON audit_log USING ((organization_id IS NULL) OR (organization_id = NULLIF(current_setting(''app.current_organization_id'', TRUE), '''')))';
END $rls_block$;

-- ── 7. SECURITY DEFINER aggregate functions with fixed search_path ────────────

CREATE OR REPLACE FUNCTION platform_get_org_task_count(org_id TEXT)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF org_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN 0;
  END IF;
  RETURN (SELECT COUNT(*) FROM public.tasks WHERE organization_id = org_id);
END $fn$;

CREATE OR REPLACE FUNCTION platform_get_org_approval_count(org_id TEXT)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF org_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN 0;
  END IF;
  RETURN (SELECT COUNT(*) FROM public.approvals WHERE organization_id = org_id);
END $fn$;

CREATE OR REPLACE FUNCTION platform_get_org_pending_approval_count(org_id TEXT)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF org_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN 0;
  END IF;
  RETURN (SELECT COUNT(*) FROM public.approvals WHERE organization_id = org_id AND state = 'pending');
END $fn$;

CREATE OR REPLACE FUNCTION platform_get_org_record_counts(org_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  task_count     BIGINT := 0;
  approval_count BIGINT := 0;
  member_count   BIGINT := 0;
BEGIN
  -- Validate UUID format to prevent injection in dynamic contexts
  IF org_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN jsonb_build_object('error', 'invalid_org_id');
  END IF;

  SELECT COUNT(*) INTO task_count     FROM public.tasks       WHERE organization_id = org_id;
  SELECT COUNT(*) INTO approval_count FROM public.approvals   WHERE organization_id = org_id;
  SELECT COUNT(*) INTO member_count   FROM public.memberships WHERE organization_id = org_id AND status = 'active';

  RETURN jsonb_build_object(
    'tasks',     task_count,
    'approvals', approval_count,
    'members',   member_count
  );
END $fn$;

-- Restrict execution: only needsops_app can call these functions
DO $grant_fns$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'needsops_app') THEN
    REVOKE ALL ON FUNCTION platform_get_org_task_count(TEXT)            FROM PUBLIC;
    REVOKE ALL ON FUNCTION platform_get_org_approval_count(TEXT)         FROM PUBLIC;
    REVOKE ALL ON FUNCTION platform_get_org_pending_approval_count(TEXT) FROM PUBLIC;
    REVOKE ALL ON FUNCTION platform_get_org_record_counts(TEXT)          FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION platform_get_org_task_count(TEXT)            TO needsops_app;
    GRANT EXECUTE ON FUNCTION platform_get_org_approval_count(TEXT)         TO needsops_app;
    GRANT EXECUTE ON FUNCTION platform_get_org_pending_approval_count(TEXT) TO needsops_app;
    GRANT EXECUTE ON FUNCTION platform_get_org_record_counts(TEXT)          TO needsops_app;
  END IF;
END $grant_fns$;

-- ── 8. Verification checkpoint ────────────────────────────────────────────────
DO $verify$
DECLARE
  missing_rls TEXT[] := '{}';
  tbl         TEXT;
  rls_on      BOOLEAN;
  tables      TEXT[] := ARRAY[
    'tasks','task_specialists','task_execution_plans',
    'approvals','approval_rules','approval_history',
    'memberships','invitations',
    'tenant_subscriptions','tenant_entitlements','tenant_overrides',
    'tenant_settings','tenant_addons','tenant_usage_allowances',
    'tenant_workforce_packs','usage_events','usage_period_summaries',
    'org_audit_log','audit_log'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    SELECT relrowsecurity INTO rls_on
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = tbl AND n.nspname = 'public';

    IF NOT FOUND OR NOT rls_on THEN
      missing_rls := array_append(missing_rls, tbl);
    END IF;
  END LOOP;

  IF array_length(missing_rls, 1) > 0 THEN
    RAISE EXCEPTION 'Sprint 7 migration failed: RLS not enabled on: %', array_to_string(missing_rls, ', ');
  END IF;

  RAISE NOTICE 'Sprint 7 platform boundary migration complete. All 19 RLS policies verified.';
END $verify$;

COMMIT;
