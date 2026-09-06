import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";
import { PLATFORM_MIGRATIONS } from "../bootstrap/platformMigrations";

const root = resolve(__dirname, "..");
const migration = readFileSync(
  resolve(root, "../../../lib/db/migrations/0046_rls_policy_normalisation.sql"),
  "utf8",
);
const authResolverMigration = readFileSync(
  resolve(root, "../../../lib/db/migrations/0047_auth_tenant_resolver.sql"),
  "utf8",
);
const preContextResolverMigration = readFileSync(
  resolve(root, "../../../lib/db/migrations/0048_pre_context_identity_resolvers.sql"),
  "utf8",
);
const checkpointStartupSweepMigration = readFileSync(
  resolve(root, "../../../lib/db/migrations/0049_checkpoint_startup_sweep_functions.sql"),
  "utf8",
);
const platformPublicWorkerBoundaryMigration = readFileSync(
  resolve(root, "../../../lib/db/migrations/0050_platform_public_worker_boundaries.sql"),
  "utf8",
);
const tenantMiddleware = readFileSync(
  resolve(root, "middlewares/tenantContext.ts"),
  "utf8",
);
const deviceService = readFileSync(resolve(root, "services/deviceService.ts"), "utf8");
const deviceAuthService = readFileSync(resolve(root, "services/deviceAuthService.ts"), "utf8");
const invitationService = readFileSync(resolve(root, "services/invitationService.ts"), "utf8");
const userService = readFileSync(resolve(root, "services/userService.ts"), "utf8");

describe("Sprint 46 RLS policy normalisation", () => {
  it("is registered in the ordered platform migration list", () => {
    expect(PLATFORM_MIGRATIONS).toContainEqual(
      expect.objectContaining({
        id: "0046-rls-policy-normalisation",
        file: "0046_rls_policy_normalisation.sql",
        transactional: true,
      }),
    );
  });

  it("normalises policies to the request-serving organization context setting", () => {
    expect(migration).toContain("app.current_organization_id");
    expect(migration).not.toContain("app.current_tenant");
    expect(migration).not.toContain("app.current_tenant_id");
    expect(migration).not.toContain("app.current_org_id");
  });

  it("replaces permissive tenant policies with fail-closed tenant checks", () => {
    for (const table of ["conversation_memory", "ingestion_jobs", "organisation_memory"]) {
      expect(migration).toContain(`'${table}'`);
    }
    expect(migration).toContain("NULLIF(current_setting('app.current_organization_id', true), '')");
    expect(migration).not.toMatch(/CREATE POLICY\s+\w+\s+ON\s+(conversation_memory|ingestion_jobs|organisation_memory)[\s\S]{0,120}USING\s+\(true\)/i);
  });

  it("uses explicit platform or no-tenant policies where rows are not tenant-owned data", () => {
    expect(migration).toContain("CREATE POLICY platform_catalogue_read ON workforce_pack_price_versions");
    expect(migration).toContain("CREATE POLICY platform_internal_notes_no_tenant_access ON platform_internal_notes");
    expect(migration).toContain("Platform-only secret references");
    expect(migration).not.toContain("CREATE POLICY tenant_isolation ON workforce_pack_price_versions");
  });

  it("adds missing coverage for work artifacts and blueprint sections", () => {
    expect(migration).toContain("'work_artifacts'");
    expect(migration).toContain("ALTER TABLE blueprint_sections ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("FROM work_blueprints wb");
    expect(migration).toContain("wb.organization_id IS NULL");
  });

  it("registers the narrow auth tenant resolver migration", () => {
    expect(PLATFORM_MIGRATIONS).toContainEqual(
      expect.objectContaining({
        id: "0047-auth-tenant-resolver",
        file: "0047_auth_tenant_resolver.sql",
        transactional: true,
      }),
    );
  });

  it("defines the auth resolver as a narrow SECURITY DEFINER function", () => {
    expect(authResolverMigration).toContain("CREATE OR REPLACE FUNCTION public.resolve_auth_tenant_context");
    expect(authResolverMigration).toContain("p_external_user_id TEXT");
    expect(authResolverMigration).toContain("p_org_slug TEXT");
    expect(authResolverMigration).not.toContain("p_user_id");
    expect(authResolverMigration).not.toContain("p_organization_id");
    expect(authResolverMigration).toContain("SECURITY DEFINER");
    expect(authResolverMigration).toContain("SET search_path = pg_catalog, public");
  });

  it("bounds auth resolver reads and returns no partial lookup rows", () => {
    expect(authResolverMigration).toContain("RETURNS TABLE");
    expect(authResolverMigration).toContain("IF NOT FOUND OR resolved_membership.status <> 'active' THEN");
    expect(authResolverMigration).toContain("RETURN;");
    expect(authResolverMigration).toContain("WHERE u.external_id = p_external_user_id");
    expect(authResolverMigration).toContain("WHERE o.slug = p_org_slug");
    expect(authResolverMigration).toContain("WHERE m.organization_id = resolved_org.id");
    expect(authResolverMigration).toContain("AND m.user_id = resolved_user.id");
    expect(authResolverMigration).not.toMatch(/RETURN\s+QUERY\s+SELECT[\s\S]*FROM\s+public\.(users|organizations|memberships)/i);
  });

  it("limits auth resolver writes and grants to the function boundary", () => {
    expect(authResolverMigration).toContain("INSERT INTO public.users");
    expect(authResolverMigration).toContain("p_external_user_id || '@unknown.clerk'");
    expect(authResolverMigration).toContain("'active'");
    expect(authResolverMigration).not.toMatch(/INSERT INTO public\.memberships/i);
    expect(authResolverMigration).not.toMatch(/INSERT INTO public\.organizations/i);
    expect(authResolverMigration).not.toMatch(/UPDATE\s+public\.(users|memberships|organizations)/i);
    expect(authResolverMigration).toContain(
      "GRANT EXECUTE ON FUNCTION public.resolve_auth_tenant_context(TEXT, TEXT) TO needsops_app",
    );
    expect(authResolverMigration).toContain("REVOKE SELECT ON public.users FROM needsops_app");
    expect(authResolverMigration).toContain("REVOKE SELECT ON public.organizations FROM needsops_app");
    expect(authResolverMigration).toContain("REVOKE SELECT ON public.memberships FROM needsops_app");
  });

  it("uses the auth resolver for slugged tenant routes", () => {
    expect(tenantMiddleware).toContain("req.params.slug");
    expect(tenantMiddleware).toContain("authExternalUserId");
    expect(tenantMiddleware).toContain("public.resolve_auth_tenant_context");
    expect(tenantMiddleware).toContain("req.appUser = {");
    expect(tenantMiddleware).toContain("req.tenantContext = tenantContext");
  });

  it("registers narrow pre-context identity resolver migration", () => {
    expect(PLATFORM_MIGRATIONS).toContainEqual(
      expect.objectContaining({
        id: "0048-pre-context-identity-resolvers",
        file: "0048_pre_context_identity_resolvers.sql",
        transactional: true,
      }),
    );
  });

  it("defines only narrow pre-context resolver inputs", () => {
    for (const fn of [
      "resolve_device_credential_context",
      "resolve_device_refresh_token_context",
      "consume_device_refresh_token",
      "resolve_device_access_token_context",
      "resolve_invitation_token_context",
      "resolve_user_self_context",
      "resolve_user_organisations",
    ]) {
      expect(preContextResolverMigration).toContain(`CREATE OR REPLACE FUNCTION public.${fn}`);
      expect(preContextResolverMigration).toContain("SECURITY DEFINER");
      expect(preContextResolverMigration).toContain("SET search_path = pg_catalog, public");
    }
    expect(preContextResolverMigration).toContain("p_token_hash TEXT");
    expect(preContextResolverMigration).toContain("p_external_user_id TEXT");
    expect(preContextResolverMigration).not.toMatch(/p_(user_id|organization_id|device_id|membership_id)\s+TEXT/i);
  });

  it("keeps pre-context resolvers non-enumerating and grants execute only", () => {
    for (const fn of [
      "resolve_device_credential_context(TEXT)",
      "resolve_device_refresh_token_context(TEXT)",
      "consume_device_refresh_token(TEXT, TEXT)",
      "resolve_device_access_token_context(TEXT)",
      "resolve_invitation_token_context(TEXT, TEXT)",
      "resolve_user_self_context(TEXT)",
      "resolve_user_organisations(TEXT)",
    ]) {
      expect(preContextResolverMigration).toContain(`REVOKE ALL ON FUNCTION public.${fn} FROM PUBLIC`);
      expect(preContextResolverMigration).toContain(`GRANT EXECUTE ON FUNCTION public.${fn} TO needsops_app`);
    }
    for (const table of [
      "users",
      "organizations",
      "memberships",
      "device_credentials",
      "device_refresh_tokens",
      "device_access_tokens",
      "invitations",
    ]) {
      expect(preContextResolverMigration).toContain(`REVOKE SELECT ON public.${table} FROM needsops_app`);
    }
  });

  it("keeps device resolvers read-only and returns lifecycle state for the supplied token only", () => {
    const deviceResolverSql = preContextResolverMigration.match(
      /CREATE OR REPLACE FUNCTION public\.resolve_device_credential_context[\s\S]*?CREATE OR REPLACE FUNCTION public\.resolve_invitation_token_context/,
    )?.[0] ?? "";
    expect(deviceResolverSql).toContain("WHERE c.token_hash = p_token_hash");
    expect(deviceResolverSql).toContain("WHERE r.token_hash = p_token_hash");
    expect(deviceResolverSql).toContain("WHERE a.token_hash = p_token_hash");
    expect(deviceResolverSql).toContain("UPDATE public.device_refresh_tokens r");
    expect(deviceResolverSql).toContain("r.token_hash = p_token_hash");
    expect(deviceResolverSql).toContain("superseded_by_id = p_superseded_by_id");
    expect(deviceResolverSql).toContain("'expired'");
    expect(deviceResolverSql).toContain("'reused'");
    expect(deviceResolverSql).not.toMatch(/\b(INSERT|DELETE)\b/i);
  });

  it("uses resolvers before tenant-scoped opaque-token follow-up writes", () => {
    expect(deviceService).toContain("public.resolve_device_credential_context");
    expect(deviceService).toContain("withDeviceTenant(cred.organization_id");
    expect(deviceAuthService).toContain("public.resolve_device_refresh_token_context");
    expect(deviceAuthService).toContain("public.consume_device_refresh_token");
    expect(deviceAuthService).toContain("public.resolve_device_access_token_context");
    expect(invitationService).toContain("public.resolve_invitation_token_context");
    expect(userService).toContain("public.resolve_user_self_context");
    expect(userService).toContain("public.resolve_user_organisations");
    expect(tenantMiddleware).toContain("public.resolve_user_self_context");
  });

  it("registers bounded checkpoint startup sweep functions", () => {
    expect(PLATFORM_MIGRATIONS).toContainEqual(
      expect.objectContaining({
        id: "0049-checkpoint-startup-sweep-functions",
        file: "0049_checkpoint_startup_sweep_functions.sql",
        transactional: true,
      }),
    );
  });

  it("defines startup checkpoint sweeps as narrow SECURITY DEFINER functions", () => {
    for (const fn of [
      "expire_stale_execution_checkpoints",
      "recover_stuck_execution_resumes",
    ]) {
      expect(checkpointStartupSweepMigration).toContain(`CREATE OR REPLACE FUNCTION public.${fn}`);
      expect(checkpointStartupSweepMigration).toContain("SECURITY DEFINER");
      expect(checkpointStartupSweepMigration).toContain("SET search_path = pg_catalog, public");
    }
    expect(checkpointStartupSweepMigration).toContain("LIMIT LEAST(GREATEST(COALESCE(p_limit, 500), 1), 5000)");
    expect(checkpointStartupSweepMigration).toContain("UPDATE public.execution_checkpoints");
    expect(checkpointStartupSweepMigration).toContain("RETURNING c.id");
    expect(checkpointStartupSweepMigration).toContain("SELECT COUNT(*)::INTEGER");
  });

  it("grants startup sweeps through execute-only function boundaries", () => {
    expect(checkpointStartupSweepMigration).toContain(
      "REVOKE ALL ON FUNCTION public.expire_stale_execution_checkpoints(INTEGER) FROM PUBLIC",
    );
    expect(checkpointStartupSweepMigration).toContain(
      "REVOKE ALL ON FUNCTION public.recover_stuck_execution_resumes(TIMESTAMPTZ, INTEGER) FROM PUBLIC",
    );
    expect(checkpointStartupSweepMigration).toContain(
      "GRANT EXECUTE ON FUNCTION public.expire_stale_execution_checkpoints(INTEGER) TO needsops_app",
    );
    expect(checkpointStartupSweepMigration).toContain(
      "GRANT EXECUTE ON FUNCTION public.recover_stuck_execution_resumes(TIMESTAMPTZ, INTEGER) TO needsops_app",
    );
    expect(checkpointStartupSweepMigration).not.toMatch(/GRANT\s+(SELECT|UPDATE|INSERT|DELETE)\s+ON\s+public\.execution_checkpoints\s+TO\s+needsops_app/i);
  });

  it("registers platform, public and worker boundary migration", () => {
    expect(PLATFORM_MIGRATIONS).toContainEqual(
      expect.objectContaining({
        id: "0050-platform-public-worker-boundaries",
        file: "0050_platform_public_worker_boundaries.sql",
        transactional: true,
      }),
    );
  });

  it("creates non-owner platform and worker app roles", () => {
    expect(platformPublicWorkerBoundaryMigration).toContain(
      "CREATE ROLE needsops_platform_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT",
    );
    expect(platformPublicWorkerBoundaryMigration).toContain(
      "CREATE ROLE needsops_worker_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT",
    );
    expect(platformPublicWorkerBoundaryMigration).toContain("GRANT needsops_app TO needsops_worker_app");
    expect(platformPublicWorkerBoundaryMigration).not.toMatch(/CREATE ROLE needsops_(platform|worker)_app\s+LOGIN\s+SUPERUSER/i);
    expect(platformPublicWorkerBoundaryMigration.replace(/--.*$/gm, "")).not.toMatch(/WITH\s+GRANT\s+OPTION/i);
    expect(platformPublicWorkerBoundaryMigration).not.toMatch(/ALTER SCHEMA public OWNER TO needsops_(platform|worker)_app/i);
  });

  it("uses column-level public grants for catalogue and installer reads", () => {
    for (const table of [
      "plans",
      "plan_versions",
      "installer_releases",
      "workforce_packs",
      "workforce_pack_price_versions",
      "specialist_catalogue",
    ]) {
      expect(platformPublicWorkerBoundaryMigration).toContain(`ON TABLE public.${table} TO needsops_app`);
    }
    expect(platformPublicWorkerBoundaryMigration).not.toMatch(/GRANT SELECT ON TABLE public\.(plans|plan_versions|installer_releases|workforce_packs|workforce_pack_price_versions|specialist_catalogue) TO needsops_app/i);
    expect(platformPublicWorkerBoundaryMigration).not.toMatch(/GRANT SELECT \([^)]*\b(notes|created_by|approved_by|changed_by)\b[^)]*\) ON TABLE public\.(plans|plan_versions|workforce_pack_price_versions|specialist_catalogue) TO needsops_app/is);
    expect(platformPublicWorkerBoundaryMigration).toContain(
      "GRANT INSERT (\n  id, release_id, organization_id, user_id, platform, arch, ip_hash, user_agent\n) ON TABLE public.installer_download_events TO needsops_app",
    );
    expect(platformPublicWorkerBoundaryMigration).not.toMatch(/GRANT SELECT ON TABLE public\.installer_download_events TO needsops_app/i);
  });

  it("defines worker-only bounded ingestion claim function", () => {
    expect(platformPublicWorkerBoundaryMigration).toContain("CREATE OR REPLACE FUNCTION public.claim_next_ingestion_job");
    expect(platformPublicWorkerBoundaryMigration).toContain("SECURITY DEFINER");
    expect(platformPublicWorkerBoundaryMigration).toContain("SET search_path = pg_catalog, public");
    expect(platformPublicWorkerBoundaryMigration).toContain("FOR UPDATE SKIP LOCKED");
    expect(platformPublicWorkerBoundaryMigration).toContain("RETURNS TABLE");
    expect(platformPublicWorkerBoundaryMigration).toContain("\"organizationId\" TEXT");
    expect(platformPublicWorkerBoundaryMigration).toContain("REVOKE ALL ON FUNCTION public.claim_next_ingestion_job(TEXT) FROM PUBLIC");
    expect(platformPublicWorkerBoundaryMigration).toContain("GRANT EXECUTE ON FUNCTION public.claim_next_ingestion_job(TEXT) TO needsops_worker_app");
    expect(platformPublicWorkerBoundaryMigration).not.toContain("GRANT EXECUTE ON FUNCTION public.claim_next_ingestion_job(TEXT) TO needsops_app");
    expect(platformPublicWorkerBoundaryMigration).not.toMatch(/GRANT\s+(SELECT|UPDATE|INSERT|DELETE)\s+ON\s+public\.ingestion_jobs\s+TO\s+needsops_worker_app/i);
  });
});
