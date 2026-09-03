-- 0046_rls_policy_normalisation.sql
--
-- Corrects live-confirmed RLS policy gaps before the application connection is
-- moved from the RLS-bypassing admin role to a restricted request-serving role.
--
-- The platform schema stores organisation identifiers as TEXT, so policies use
-- text comparison against app.current_organization_id. Empty or missing tenant
-- context must match zero tenant rows.

BEGIN;

-- Keep platform secrets deliberately fail-closed for request-serving roles.
ALTER TABLE platform_secrets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON platform_secrets;
DROP POLICY IF EXISTS needsops_app_access ON platform_secrets;
DROP POLICY IF EXISTS platform_access ON platform_secrets;
COMMENT ON TABLE platform_secrets IS
  'Platform-only secret references. RLS intentionally has no access policy for request-serving roles; bootstrap/platform roles must use broader credentials.';

-- Built-in blueprints are platform rows with organization_id IS NULL and must
-- remain visible to every tenant. Tenant-owned blueprints stay scoped.
ALTER TABLE work_blueprints ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON work_blueprints;
DROP POLICY IF EXISTS needsops_app_access ON work_blueprints;
CREATE POLICY tenant_isolation ON work_blueprints
  FOR ALL
  USING (
    organization_id IS NULL
    OR organization_id = NULLIF(current_setting('app.current_organization_id', true), '')
  )
  WITH CHECK (
    organization_id = NULLIF(current_setting('app.current_organization_id', true), '')
  );

-- blueprint_sections inherits visibility through its parent blueprint.
ALTER TABLE blueprint_sections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON blueprint_sections;
DROP POLICY IF EXISTS needsops_app_access ON blueprint_sections;
CREATE POLICY tenant_isolation ON blueprint_sections
  FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM work_blueprints wb
      WHERE wb.id = blueprint_sections.blueprint_id
        AND (
          wb.organization_id IS NULL
          OR wb.organization_id = NULLIF(current_setting('app.current_organization_id', true), '')
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM work_blueprints wb
      WHERE wb.id = blueprint_sections.blueprint_id
        AND wb.organization_id = NULLIF(current_setting('app.current_organization_id', true), '')
    )
  );

-- Platform price versions are global catalogue data, not tenant protection.
ALTER TABLE workforce_pack_price_versions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON workforce_pack_price_versions;
DROP POLICY IF EXISTS platform_access ON workforce_pack_price_versions;
CREATE POLICY platform_catalogue_read ON workforce_pack_price_versions
  FOR SELECT
  USING (true);

-- Platform/internal tables that are not safe tenant data. Keep them RLS-enabled
-- and deliberately unavailable to request-serving tenant roles.
ALTER TABLE platform_internal_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON platform_internal_notes;
DROP POLICY IF EXISTS needsops_app_access ON platform_internal_notes;
DROP POLICY IF EXISTS platform_access ON platform_internal_notes;
CREATE POLICY platform_internal_notes_no_tenant_access ON platform_internal_notes
  FOR ALL
  USING (false)
  WITH CHECK (false);

-- Tenant-scoped tables. This block also replaces the permissive policies on
-- conversation_memory, ingestion_jobs, organisation_memory and seat_overrides,
-- and normalises policies that referenced older tenant-context setting names.
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'blueprint_intent_mappings',
    'care_plan_behaviour_strategy_measurements',
    'conversation_memory',
    'device_access_tokens',
    'device_auth_challenges',
    'device_refresh_tokens',
    'device_task_dispatch',
    'device_ws_sessions',
    'execution_checkpoints',
    'execution_graph_nodes',
    'execution_history',
    'ingestion_jobs',
    'installer_download_events',
    'notification_reads',
    'org_configuration',
    'org_database_registry',
    'org_delegated_authority',
    'org_departments',
    'org_escalation_paths',
    'org_positions',
    'org_reporting_lines',
    'org_resources',
    'org_teams',
    'organisation_memory',
    'organisation_provisioning_jobs',
    'organisation_specialist_configuration',
    'platform_audit_log',
    'seat_overrides',
    'specialist_conflicts',
    'specialist_queue',
    'specialist_run_memory',
    'specialist_runs',
    'work_artifacts',
    'workforce_pack_access_requests'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS needsops_app_access ON %I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS needsops_app ON %I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS platform_access ON %I', tbl);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL USING (%I = NULLIF(current_setting(%L, true), %L)) WITH CHECK (%I = NULLIF(current_setting(%L, true), %L))',
      tbl,
      'organization_id',
      'app.current_organization_id',
      '',
      'organization_id',
      'app.current_organization_id',
      ''
    );
  END LOOP;
END $$;

-- These production blueprint tables contain platform rows with NULL
-- organization_id and tenant-owned override rows.
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'work_templates',
    'blueprint_intent_mappings'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS needsops_app_access ON %I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS needsops_app ON %I', tbl);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL USING (%I IS NULL OR %I = NULLIF(current_setting(%L, true), %L)) WITH CHECK (%I = NULLIF(current_setting(%L, true), %L))',
      tbl,
      'organization_id',
      'organization_id',
      'app.current_organization_id',
      '',
      'organization_id',
      'app.current_organization_id',
      ''
    );
  END LOOP;
END $$;

COMMIT;
