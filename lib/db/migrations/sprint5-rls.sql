-- =============================================================================
-- Sprint 5 — Row Level Security + Join Table Tenant Ownership
-- =============================================================================
-- Run this AFTER drizzle-kit push (which adds the new columns).
-- Idempotent: uses IF NOT EXISTS / DO $$ ... END $$ guards throughout.
--
-- This migration:
--   1. Creates the needsops_app restricted DB role
--   2. Backfills organization_id on join tables from parent records
--   3. Reports orphaned/ambiguous records
--   4. Adds NOT NULL constraints and indexes on the new columns
--   5. Enables RLS on all tenant-owned operational tables
--   6. Creates tenant_isolation policies using session-variable context
--   7. Grants appropriate permissions to needsops_app
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Create restricted application role
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'needsops_app') THEN
    CREATE ROLE needsops_app NOSUPERUSER NOINHERIT NOCREATEDB NOCREATEROLE NOREPLICATION LOGIN
      PASSWORD 'app_role_password_rotate_immediately';
    RAISE NOTICE 'Created needsops_app role. IMPORTANT: Change the password immediately.';
  ELSE
    RAISE NOTICE 'needsops_app role already exists.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Backfill organization_id on join tables
-- ---------------------------------------------------------------------------

-- 2a. approval_history ← from approvals
DO $$
DECLARE
  updated_count INTEGER;
  orphan_count  INTEGER;
BEGIN
  UPDATE approval_history ah
  SET organization_id = a.organization_id
  FROM approvals a
  WHERE ah.approval_id = a.id
    AND ah.organization_id IS NULL;

  GET DIAGNOSTICS updated_count = ROW_COUNT;

  SELECT COUNT(*) INTO orphan_count
  FROM approval_history
  WHERE organization_id IS NULL;

  RAISE NOTICE 'approval_history: backfilled % rows; % orphaned (approval FK missing)', updated_count, orphan_count;

  IF orphan_count > 0 THEN
    RAISE WARNING 'ATTENTION: % approval_history rows have no organization_id. '
      'These are orphaned records whose parent approval has no organization. '
      'Investigate before adding NOT NULL constraint.', orphan_count;
  END IF;
END $$;

-- 2b. task_execution_plans ← from tasks
DO $$
DECLARE
  updated_count INTEGER;
  orphan_count  INTEGER;
BEGIN
  UPDATE task_execution_plans tep
  SET organization_id = t.organization_id
  FROM tasks t
  WHERE tep.task_id = t.id
    AND tep.organization_id IS NULL;

  GET DIAGNOSTICS updated_count = ROW_COUNT;

  SELECT COUNT(*) INTO orphan_count
  FROM task_execution_plans
  WHERE organization_id IS NULL;

  RAISE NOTICE 'task_execution_plans: backfilled % rows; % orphaned', updated_count, orphan_count;

  IF orphan_count > 0 THEN
    RAISE WARNING 'ATTENTION: % task_execution_plans rows have no organization_id.', orphan_count;
  END IF;
END $$;

-- 2c. task_specialists ← from tasks
DO $$
DECLARE
  updated_count INTEGER;
  orphan_count  INTEGER;
BEGIN
  UPDATE task_specialists ts
  SET organization_id = t.organization_id
  FROM tasks t
  WHERE ts.task_id = t.id
    AND ts.organization_id IS NULL;

  GET DIAGNOSTICS updated_count = ROW_COUNT;

  SELECT COUNT(*) INTO orphan_count
  FROM task_specialists
  WHERE organization_id IS NULL;

  RAISE NOTICE 'task_specialists: backfilled % rows; % orphaned', updated_count, orphan_count;

  IF orphan_count > 0 THEN
    RAISE WARNING 'ATTENTION: % task_specialists rows have no organization_id.', orphan_count;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Add NOT NULL constraints and indexes on new columns
--    (only after backfill succeeds and no orphans remain)
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  orphan_count INTEGER;
BEGIN
  -- approval_history
  SELECT COUNT(*) INTO orphan_count FROM approval_history WHERE organization_id IS NULL;
  IF orphan_count = 0 THEN
    ALTER TABLE approval_history ALTER COLUMN organization_id SET NOT NULL;
    RAISE NOTICE 'approval_history: NOT NULL constraint added.';
  ELSE
    RAISE WARNING 'Skipping NOT NULL on approval_history: % orphaned rows remain.', orphan_count;
  END IF;

  -- task_execution_plans
  SELECT COUNT(*) INTO orphan_count FROM task_execution_plans WHERE organization_id IS NULL;
  IF orphan_count = 0 THEN
    ALTER TABLE task_execution_plans ALTER COLUMN organization_id SET NOT NULL;
    RAISE NOTICE 'task_execution_plans: NOT NULL constraint added.';
  ELSE
    RAISE WARNING 'Skipping NOT NULL on task_execution_plans: % orphaned rows remain.', orphan_count;
  END IF;

  -- task_specialists
  SELECT COUNT(*) INTO orphan_count FROM task_specialists WHERE organization_id IS NULL;
  IF orphan_count = 0 THEN
    ALTER TABLE task_specialists ALTER COLUMN organization_id SET NOT NULL;
    RAISE NOTICE 'task_specialists: NOT NULL constraint added.';
  ELSE
    RAISE WARNING 'Skipping NOT NULL on task_specialists: % orphaned rows remain.', orphan_count;
  END IF;
END $$;

-- Indexes for the new columns (IF NOT EXISTS)
CREATE INDEX IF NOT EXISTS idx_approval_history_org ON approval_history(organization_id);
CREATE INDEX IF NOT EXISTS idx_task_execution_plans_org ON task_execution_plans(organization_id);
CREATE INDEX IF NOT EXISTS idx_task_specialists_org ON task_specialists(organization_id);

-- ---------------------------------------------------------------------------
-- 4. Enable RLS on tenant-owned operational tables
-- ---------------------------------------------------------------------------

ALTER TABLE memberships             ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations             ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_subscriptions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_entitlements     ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_overrides        ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_addons           ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_usage_allowances ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_workforce_packs  ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_settings         ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_events            ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_period_summaries  ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE approvals               ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_rules          ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_history        ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_execution_plans    ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_specialists        ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log               ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_audit_log           ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 5. Create RLS policies
--
-- Policy logic:
--   NULLIF(current_setting('app.current_organization_id', TRUE), '')
--   → Returns NULL if the setting is not set or is empty string
--   → organization_id = NULL is always FALSE → no rows visible (fail closed)
--   → When set to a valid org ID, only that org's rows are visible
--
-- Superusers bypass RLS unless FORCE ROW LEVEL SECURITY is used.
-- Application code using needsops_app role is always subject to RLS.
-- Platform routes using the admin/superuser connection bypass RLS by design
-- and must only access platform-level tables, not operational tables.
-- ---------------------------------------------------------------------------

-- Helper macro for the policy expression
-- organization_id = NULLIF(current_setting('app.current_organization_id', TRUE), '')

DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'memberships', 'invitations', 'tenant_subscriptions', 'tenant_entitlements',
    'tenant_overrides', 'tenant_addons', 'tenant_usage_allowances', 'tenant_workforce_packs',
    'tenant_settings', 'usage_events', 'usage_period_summaries',
    'tasks', 'approvals', 'approval_rules', 'approval_history',
    'task_execution_plans', 'task_specialists', 'org_audit_log'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('
      DROP POLICY IF EXISTS tenant_isolation ON %I;
      CREATE POLICY tenant_isolation ON %I
        USING (
          organization_id = NULLIF(current_setting(''app.current_organization_id'', TRUE), '''')
        )
        WITH CHECK (
          organization_id = NULLIF(current_setting(''app.current_organization_id'', TRUE), '''')
        );
    ', t, t);
    RAISE NOTICE 'RLS policy created on table: %', t;
  END LOOP;
END $$;

-- audit_log: may have NULL organizationId for platform events
-- Policy: visible if the org matches OR if organizationId is NULL (platform events)
-- Platform staff access all via superuser bypass; tenant users only see their org rows.
DROP POLICY IF EXISTS tenant_isolation ON audit_log;
CREATE POLICY tenant_isolation ON audit_log
  USING (
    organization_id IS NULL
    OR organization_id = NULLIF(current_setting('app.current_organization_id', TRUE), '')
  );

-- ---------------------------------------------------------------------------
-- 6. Grant permissions to needsops_app on operational tables
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'memberships', 'invitations', 'tenant_subscriptions', 'tenant_entitlements',
    'tenant_overrides', 'tenant_addons', 'tenant_usage_allowances', 'tenant_workforce_packs',
    'tenant_settings', 'usage_events', 'usage_period_summaries',
    'tasks', 'approvals', 'approval_rules', 'approval_history',
    'task_execution_plans', 'task_specialists', 'audit_log', 'org_audit_log',
    -- Platform tables (needsops_app needs read access for entitlement checks)
    'organizations', 'users', 'plans', 'plan_versions', 'plan_features',
    'plan_usage_allowances', 'plan_workforce_packs', 'features', 'usage_dimensions',
    'workforce_packs', 'specialists', 'worker_profiles', 'capabilities',
    'specialist_capabilities', 'workforce_role_profiles', 'workforce_pack_specialists',
    'feature_flags', 'platform_settings'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    BEGIN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO needsops_app;', t);
    EXCEPTION WHEN undefined_table THEN
      RAISE NOTICE 'Table % not found, skipping grant.', t;
    END;
  END LOOP;

  -- Grant sequence usage for tables that use sequences (none currently use serial, all use text PKs)
  RAISE NOTICE 'Permission grants to needsops_app completed.';
END $$;

-- ---------------------------------------------------------------------------
-- 7. Create SECURITY DEFINER aggregate functions for platform console
--    These allow the superuser/platform routes to get safe counts without
--    exposing operational row content.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION platform_get_org_task_count(p_org_id TEXT)
RETURNS BIGINT
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT COUNT(*) FROM tasks WHERE organization_id = p_org_id;
$$;

CREATE OR REPLACE FUNCTION platform_get_org_approval_count(p_org_id TEXT)
RETURNS BIGINT
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT COUNT(*) FROM approvals WHERE organization_id = p_org_id;
$$;

CREATE OR REPLACE FUNCTION platform_get_org_pending_approval_count(p_org_id TEXT)
RETURNS BIGINT
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT COUNT(*) FROM approvals WHERE organization_id = p_org_id AND state = 'pending';
$$;

GRANT EXECUTE ON FUNCTION platform_get_org_task_count(TEXT) TO needsops_app;
GRANT EXECUTE ON FUNCTION platform_get_org_approval_count(TEXT) TO needsops_app;
GRANT EXECUTE ON FUNCTION platform_get_org_pending_approval_count(TEXT) TO needsops_app;

COMMIT;

-- Verification query (run after migration to check RLS is enabled):
-- SELECT tablename, rowsecurity, forcerowsecurity
-- FROM pg_tables
-- WHERE schemaname = 'public'
--   AND tablename IN ('memberships','tasks','approvals','audit_log','org_audit_log')
-- ORDER BY tablename;
