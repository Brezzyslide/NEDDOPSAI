import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";
import { PLATFORM_MIGRATIONS } from "../bootstrap/platformMigrations";

const root = resolve(__dirname, "..");
const migration = readFileSync(
  resolve(root, "../../../lib/db/migrations/0046_rls_policy_normalisation.sql"),
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
});
