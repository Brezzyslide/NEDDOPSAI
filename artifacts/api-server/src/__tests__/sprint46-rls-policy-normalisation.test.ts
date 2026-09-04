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
const tenantMiddleware = readFileSync(
  resolve(root, "middlewares/tenantContext.ts"),
  "utf8",
);

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
});
