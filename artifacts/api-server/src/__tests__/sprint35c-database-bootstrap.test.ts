import { mkdtempSync, writeFileSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";
import {
  migrationChecksum,
  PLATFORM_MIGRATIONS,
  runPlatformMigrations,
  type MigrationDbClient,
  type PlatformMigration,
} from "../bootstrap/platformMigrations";
import {
  assertBlueprintAcceptance,
  BLUEPRINT_ACCEPTANCE_TARGETS,
  expectedProfessionalSectionCount,
  type BlueprintAcceptanceResult,
} from "../bootstrap/blueprintAcceptance";

class FakeMigrationClient implements MigrationDbClient {
  public readonly queries: Array<{ text: string; values?: unknown[] }> = [];
  public readonly ledger = new Map<string, { checksum: string }>();
  public failOnSql?: string;

  async query<T = unknown>(text: string, values?: unknown[]): Promise<{ rows: T[] }> {
    this.queries.push({ text, values });

    if (this.failOnSql && text.includes(this.failOnSql)) {
      throw new Error(`forced failure for ${this.failOnSql}`);
    }

    if (text.includes("SELECT migration_id")) {
      return {
        rows: Array.from(this.ledger.entries()).map(([migrationId, row]) => ({
          migrationId,
          checksum: row.checksum,
        })) as T[],
      };
    }

    if (text.includes("INSERT INTO platform_schema_migrations")) {
      const migrationId = String(values?.[0]);
      const checksum = String(values?.[1]);
      this.ledger.set(migrationId, { checksum });
    }

    return { rows: [] };
  }
}

function makeMigrationFixture(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "needsops-migrations-"));
  const migrations: PlatformMigration[] = Object.entries(files).map(([file, sqlText], index) => {
    writeFileSync(join(dir, file), sqlText);
    return {
      id: file.replace(".sql", ""),
      file,
      transactional: index !== 1,
    };
  });
  return { dir, migrations };
}

function passingAcceptance(overrides: Partial<BlueprintAcceptanceResult> = {}): BlueprintAcceptanceResult {
  return {
    registryCodes: BLUEPRINT_ACCEPTANCE_TARGETS.registryCodes,
    persistedExpectedBlueprints: BLUEPRINT_ACCEPTANCE_TARGETS.registryCodes,
    expectedProfessionalSections: BLUEPRINT_ACCEPTANCE_TARGETS.professionalSections,
    persistedMatchingProfessionalSections: BLUEPRINT_ACCEPTANCE_TARGETS.professionalSections,
    titleDrift: [],
    methodDrift: [],
    serviceDeliveryReview: { present: true, status: "published", isActive: true },
    complianceImpactAssessmentRoute: "regulatory_change_impact_assessment",
    compatibilityRoutes: {
      regulatory_change_impact: "regulatory_change_impact",
      regulatory_change_impact_assessment: "regulatory_change_impact_assessment",
      formal_stakeholder_correspondence: "formal_stakeholder_correspondence",
    },
    legacyAliases: {
      customer_response: "formal_stakeholder_correspondence",
    },
    passed: true,
    ...overrides,
  };
}

describe("Sprint 35C database bootstrap foundation", () => {
  it("executes fresh migrations and records ledger rows", async () => {
    const { dir, migrations } = makeMigrationFixture({
      "001-foundation.sql": "CREATE TABLE example_one(id text primary key);",
      "002-enum.sql": "DO $$ BEGIN RAISE NOTICE 'ok'; END $$;",
    });
    const client = new FakeMigrationClient();

    const result = await runPlatformMigrations(client, { migrationsDir: dir, migrations, sourceVersion: "sha-test" });

    expect(result.applied).toEqual(["001-foundation", "002-enum"]);
    expect(result.ledgerCount).toBe(2);
    expect(client.ledger.get("001-foundation")?.checksum).toBe(migrationChecksum(readFileSync(join(dir, "001-foundation.sql"), "utf8")));
  });

  it("does not rerun already applied migrations with matching checksum", async () => {
    const { dir, migrations } = makeMigrationFixture({
      "001-foundation.sql": "CREATE TABLE example_one(id text primary key);",
    });
    const client = new FakeMigrationClient();
    client.ledger.set("001-foundation", {
      checksum: migrationChecksum(readFileSync(join(dir, "001-foundation.sql"), "utf8")),
    });

    const result = await runPlatformMigrations(client, { migrationsDir: dir, migrations });

    expect(result.applied).toEqual([]);
    expect(result.skipped).toEqual(["001-foundation"]);
    expect(client.queries.some((query) => query.text.includes("CREATE TABLE example_one"))).toBe(false);
  });

  it("hard fails when an applied migration checksum changes", async () => {
    const { dir, migrations } = makeMigrationFixture({
      "001-foundation.sql": "CREATE TABLE changed(id text primary key);",
    });
    const client = new FakeMigrationClient();
    client.ledger.set("001-foundation", { checksum: "old-checksum" });

    await expect(runPlatformMigrations(client, { migrationsDir: dir, migrations }))
      .rejects.toThrow(/checksum mismatch/i);
  });

  it("does not mark a failed migration as applied", async () => {
    const { dir, migrations } = makeMigrationFixture({
      "001-fails.sql": "SELECT fail_here;",
    });
    const client = new FakeMigrationClient();
    client.failOnSql = "fail_here";

    await expect(runPlatformMigrations(client, { migrationsDir: dir, migrations }))
      .rejects.toThrow(/forced failure/);

    expect(client.ledger.has("001-fails")).toBe(false);
    expect(client.queries.some((query) => query.text === "ROLLBACK")).toBe(true);
  });

  it("uses the provided explicit migration order", async () => {
    const { dir, migrations } = makeMigrationFixture({
      "020-second.sql": "SELECT 20;",
      "010-first.sql": "SELECT 10;",
    });
    const client = new FakeMigrationClient();

    await runPlatformMigrations(client, { migrationsDir: dir, migrations });

    const executedSql = client.queries.map((query) => query.text);
    expect(executedSql.findIndex((text) => text.includes("SELECT 20"))).toBeLessThan(
      executedSql.findIndex((text) => text.includes("SELECT 10")),
    );
  });

  it("takes and releases a PostgreSQL advisory migration lock", async () => {
    const { dir, migrations } = makeMigrationFixture({
      "001-foundation.sql": "SELECT 1;",
    });
    const client = new FakeMigrationClient();

    await runPlatformMigrations(client, { migrationsDir: dir, migrations });

    expect(client.queries[0]?.text).toContain("pg_advisory_lock");
    expect(client.queries.at(-1)?.text).toContain("pg_advisory_unlock");
  });

  it("wraps transactional migrations but not explicitly non-transactional migrations", async () => {
    const { dir, migrations } = makeMigrationFixture({
      "001-transactional.sql": "SELECT 1;",
      "002-nontransactional.sql": "SELECT 2;",
    });
    const client = new FakeMigrationClient();

    await runPlatformMigrations(client, { migrationsDir: dir, migrations });

    const beforeNonTransactional = client.queries.findIndex((query) => query.text.includes("SELECT 2"));
    expect(client.queries.slice(0, beforeNonTransactional).some((query) => query.text === "BEGIN")).toBe(true);
    expect(client.queries[beforeNonTransactional - 1]?.text).not.toBe("BEGIN");
  });

  it("fails Blueprint acceptance when hard counts drift", () => {
    const result = passingAcceptance({
      persistedExpectedBlueprints: 74,
      passed: false,
    });

    expect(() => assertBlueprintAcceptance(result)).toThrow(/Blueprint bootstrap acceptance failed/);
  });

  it("keeps the expected professional section count pinned to 1,085", () => {
    expect(expectedProfessionalSectionCount()).toBe(1_085);
  });

  it("does not include raw DATABASE_URL logging in the canonical bootstrap command", () => {
    const source = readFileSync(join(process.cwd(), "src/scripts/db-bootstrap.ts"), "utf8");

    expect(source).not.toContain("console.log(process.env[\"DATABASE_URL\"]");
    expect(source).not.toContain("console.log(process.env.DATABASE_URL");
    expect(source).toContain("requiredEnv(\"DATABASE_URL\")");
  });

  it("lets seed failures fail the canonical bootstrap instead of being swallowed", () => {
    const source = readFileSync(join(process.cwd(), "src/scripts/db-bootstrap.ts"), "utf8");
    const seedBlock = source.slice(source.indexOf("Seeding platform defaults"), source.indexOf("Running RLS/startup"));

    expect(seedBlock).toContain("await seedPlatformDefaults()");
    expect(seedBlock).toContain("await runSeed({ includeSampleTenantData: false })");
    expect(seedBlock).toContain("await seedBuiltInBlueprints()");
    expect(seedBlock).not.toContain("catch");
  });

  it("keeps Drizzle schema push as an explicit opt-in helper, not the AWS bootstrap authority", () => {
    const source = readFileSync(join(process.cwd(), "src/scripts/db-bootstrap.ts"), "utf8");

    expect(source).toContain('process.env["NEEDSOPS_RUN_DRIZZLE_PUSH"] === "true"');
    expect(source).toContain("Skipping Drizzle schema push; ordered platform migrations are authoritative");
    expect(source).toContain("await runPlatformMigrations");
  });

  it("orders the manifest observability reconciliation after runtime conversation evidence RLS", () => {
    const migrationIds = PLATFORM_MIGRATIONS.map((migration) => migration.id);

    expect(migrationIds).toContain("0035-runtime-conversation-evidence-rls");
    expect(migrationIds).toContain("0036-work-package-manifest-observability");
    expect(migrationIds).toContain("0037-work-artifact-output-metadata");
    expect(migrationIds).toContain("0038-completed-work-approved-version-pin");
    expect(migrationIds).toContain("0039-completed-work-version-provenance-status");
    expect(migrationIds.indexOf("0036-work-package-manifest-observability")).toBe(
      migrationIds.indexOf("0035-runtime-conversation-evidence-rls") + 1,
    );
    expect(migrationIds.indexOf("0037-work-artifact-output-metadata")).toBe(
      migrationIds.indexOf("0036-work-package-manifest-observability") + 1,
    );
    expect(migrationIds.indexOf("0038-completed-work-approved-version-pin")).toBe(
      migrationIds.indexOf("0037-work-artifact-output-metadata") + 1,
    );
    expect(migrationIds.indexOf("0039-completed-work-version-provenance-status")).toBe(
      migrationIds.indexOf("0038-completed-work-approved-version-pin") + 1,
    );
  });

  it("keeps the manifest observability migration additive and historical-record safe", () => {
    const sql = readFileSync(
      join(process.cwd(), "../../lib/db/migrations/0036_work_package_manifest_observability.sql"),
      "utf8",
    );

    for (const column of ["selection_metadata", "validation_snapshot", "performance_metrics", "failure_info"]) {
      expect(sql).toContain(`ADD COLUMN IF NOT EXISTS ${column} JSONB`);
    }

    expect(sql).not.toMatch(/\bDROP\b/i);
    expect(sql).not.toMatch(/\bTRUNCATE\b/i);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(sql).not.toMatch(/\bUPDATE\s+work_package_manifests\b/i);
    expect(sql).not.toMatch(/\bNOT\s+NULL\b/i);
  });

  it("keeps generated artifact metadata migration additive and historical-record safe", () => {
    const sql = readFileSync(
      join(process.cwd(), "../../lib/db/migrations/0037_work_artifact_output_metadata.sql"),
      "utf8",
    );

    for (const column of ["storage_provider", "mime_type", "file_size", "checksum"]) {
      expect(sql).toContain(`ADD COLUMN IF NOT EXISTS ${column}`);
    }

    expect(sql).not.toMatch(/\bDROP\b/i);
    expect(sql).not.toMatch(/\bTRUNCATE\b/i);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(sql).not.toMatch(/\bUPDATE\s+work_artifacts\b/i);
    expect(sql).not.toMatch(/\bNOT\s+NULL\b/i);
  });

  it("keeps completed work version provenance migration additive and schema-aligned", () => {
    const sql = readFileSync(
      join(process.cwd(), "../../lib/db/migrations/0039_completed_work_version_provenance_status.sql"),
      "utf8",
    );

    expect(sql).toContain("ALTER TABLE completed_work_versions");
    expect(sql).toContain(
      "ADD COLUMN IF NOT EXISTS provenance_status TEXT NOT NULL DEFAULT 'not_available_legacy'",
    );
    expect(sql).not.toMatch(/\bDROP\b/i);
    expect(sql).not.toMatch(/\bTRUNCATE\b/i);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(sql).not.toMatch(/\bUPDATE\s+completed_work_versions\b/i);
  });
});
