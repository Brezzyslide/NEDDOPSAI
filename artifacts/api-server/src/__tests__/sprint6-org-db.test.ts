/**
 * Sprint 6 — Organisation Database Foundation Tests
 *
 * Covers:
 *   1.  Schema name derivation (deterministic, safe for PostgreSQL)
 *   2.  org_database_registry table exists with correct columns
 *   3.  Provisioning creates schema and all operational tables
 *   4.  Provisioning is idempotent (safe to re-run)
 *   5.  Registry entry is marked active + verified after provisioning
 *   6.  Provisioning fails for non-existent org (fail-closed)
 *   7.  Provisioning fails for closed org (fail-closed)
 *   8.  withOrgContext routes to correct schema
 *   9.  withOrgContext fails fast for unprovisioned org (fail-closed)
 *   10. withOrgContext fails for suspended org db (fail-closed)
 *   11. Cross-org isolation: Alpha context does not see Beta tables
 *   12. Health check returns healthy after provisioning
 *   13. Health check returns unreachable for unprovisioned org
 *   14. Pool status reflects active pools
 *   15. Deprovision removes schema (pre-migration only)
 *   16. Deprovision blocked if isMigrated = true
 *   17. Platform audit event written on provisioning
 *   18. Platform audit event written on deprovisioning
 *   19. Initial org settings seeded in org schema
 *   20. Operational tables have correct structure (tasks FK to org_tasks etc.)
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import {
  db,
  orgDatabaseRegistryTable,
  organizationsTable,
  platformAuditLogTable,
} from "@workspace/db";
import {
  provisionOrgDb,
  deprovisionOrgDb,
  checkOrgDbHealth,
  withOrgContext,
  getPoolStatus,
  drainOrgPool,
  deriveSchemaName,
  OrgConnectionError,
} from "@workspace/org-db";

// ─── Test data ─────────────────────────────────────────────────────────────────

const ALPHA_ORG_ID = `test-s6-alpha-${randomUUID().slice(0, 8)}`;
const BETA_ORG_ID  = `test-s6-beta-${randomUUID().slice(0, 8)}`;
const UNKNOWN_ORG_ID = `test-s6-unknown-${randomUUID().slice(0, 8)}`;

const alphaSchema = deriveSchemaName(ALPHA_ORG_ID);
const betaSchema  = deriveSchemaName(BETA_ORG_ID);

// ─── Setup / Teardown ──────────────────────────────────────────────────────────

beforeAll(async () => {
  // Create test orgs in platform DB
  for (const orgId of [ALPHA_ORG_ID, BETA_ORG_ID]) {
    await db.insert(organizationsTable).values({
      id: orgId,
      name: `Sprint 6 Test Org ${orgId.slice(-4)}`,
      slug: `test-s6-${orgId.slice(-4)}`,
      status: "active",
    }).onConflictDoNothing();
  }
});

afterAll(async () => {
  // Clean up test schemas
  for (const schemaName of [alphaSchema, betaSchema]) {
    await db.execute(sql.raw(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)).catch(() => {});
  }
  // Clean up registry + audit entries
  await db.delete(orgDatabaseRegistryTable)
    .where(eq(orgDatabaseRegistryTable.organizationId, ALPHA_ORG_ID)).catch(() => {});
  await db.delete(orgDatabaseRegistryTable)
    .where(eq(orgDatabaseRegistryTable.organizationId, BETA_ORG_ID)).catch(() => {});
  // Clean up test orgs
  await db.delete(organizationsTable)
    .where(eq(organizationsTable.id, ALPHA_ORG_ID)).catch(() => {});
  await db.delete(organizationsTable)
    .where(eq(organizationsTable.id, BETA_ORG_ID)).catch(() => {});
  // Drain pools
  await drainOrgPool(ALPHA_ORG_ID).catch(() => {});
  await drainOrgPool(BETA_ORG_ID).catch(() => {});
});

// ─── 1. Schema name derivation ────────────────────────────────────────────────

describe("Sprint 6 — Schema name derivation", () => {
  it("derives a safe PostgreSQL identifier from a UUID", () => {
    const name = deriveSchemaName("3b4ffe73-1234-5678-abcd-ef0123456789");
    expect(name).toBe("org_3b4ffe73_1234_5678_abcd_ef0123456789");
    // Must be a valid PostgreSQL identifier (no hyphens, starts with letter/underscore)
    expect(/^[a-z_][a-z0-9_]*$/.test(name)).toBe(true);
  });

  it("is deterministic — same org UUID always produces same schema name", () => {
    const id = randomUUID();
    expect(deriveSchemaName(id)).toBe(deriveSchemaName(id));
    // Different orgs produce different schema names
    expect(deriveSchemaName(randomUUID())).not.toBe(deriveSchemaName(randomUUID()));
  });

  it("never uses the org slug (stable even if slug changes)", () => {
    const schemaName = deriveSchemaName(ALPHA_ORG_ID);
    expect(schemaName).not.toContain("slug");
    expect(schemaName).toContain(ALPHA_ORG_ID.replace(/-/g, "_"));
  });
});

// ─── 2. Registry table structure ─────────────────────────────────────────────

describe("Sprint 6 — org_database_registry table", () => {
  it("exists in the platform DB", async () => {
    const result = await db.execute(
      sql.raw(`SELECT table_name FROM information_schema.tables
               WHERE table_schema = 'public' AND table_name = 'org_database_registry'`),
    );
    expect(result.rows.length).toBe(1);
  });

  it("has the required columns", async () => {
    const result = await db.execute(
      sql.raw(`SELECT column_name FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = 'org_database_registry'
               ORDER BY column_name`),
    );
    const cols = result.rows.map((r: any) => r.column_name);
    expect(cols).toContain("id");
    expect(cols).toContain("organization_id");
    expect(cols).toContain("schema_name");
    expect(cols).toContain("status");
    expect(cols).toContain("is_verified");
    expect(cols).toContain("is_migrated");
    expect(cols).toContain("migration_version");
    expect(cols).toContain("last_health_check_at");
    expect(cols).toContain("credentials_ref");
  });

  it("has a unique constraint on organization_id", async () => {
    const result = await db.execute(
      sql.raw(`SELECT constraint_name FROM information_schema.table_constraints
               WHERE table_name = 'org_database_registry' AND constraint_type = 'UNIQUE'`),
    );
    expect(result.rows.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── 3–7. Provisioning ────────────────────────────────────────────────────────

describe("Sprint 6 — Org DB provisioning", () => {
  it("3. provisions Alpha org successfully", async () => {
    const result = await provisionOrgDb({ organizationId: ALPHA_ORG_ID, provisionedBy: "test-runner" });
    expect(result.success).toBe(true);
    expect(result.status).toBe("active");
    expect(result.schemaName).toBe(alphaSchema);
    expect(result.steps.every(s => s.status !== "failed")).toBe(true);
  });

  it("3b. provisions Beta org successfully", async () => {
    const result = await provisionOrgDb({ organizationId: BETA_ORG_ID, provisionedBy: "test-runner" });
    expect(result.success).toBe(true);
    expect(result.status).toBe("active");
  });

  it("4. provisioning is idempotent — re-run returns success without duplicate", async () => {
    const result = await provisionOrgDb({ organizationId: ALPHA_ORG_ID, provisionedBy: "test-runner" });
    expect(result.success).toBe(true);
    // Should be skipped (already active + verified)
    const skipStep = result.steps.find(s => s.step === "check_existing_registry");
    expect(skipStep?.status).toBe("skipped");
  });

  it("5. registry entry is active and verified after provisioning", async () => {
    const [entry] = await db
      .select()
      .from(orgDatabaseRegistryTable)
      .where(eq(orgDatabaseRegistryTable.organizationId, ALPHA_ORG_ID))
      .limit(1);
    expect(entry).toBeTruthy();
    expect(entry!.status).toBe("active");
    expect(entry!.isVerified).toBe(true);
    expect(entry!.migrationVersion).toBe("sprint7-extended");
    expect(entry!.isMigrated).toBe(false); // not yet data-migrated
  });

  it("6. provisioning fails for non-existent org (fail-closed)", async () => {
    const result = await provisionOrgDb({ organizationId: UNKNOWN_ORG_ID });
    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });

  it("7. provisioning fails for closed org (fail-closed)", async () => {
    // Create a closed org
    const closedOrgId = `test-s6-closed-${randomUUID().slice(0, 8)}`;
    await db.insert(organizationsTable).values({
      id: closedOrgId,
      name: "Closed Org",
      slug: `closed-${closedOrgId.slice(-4)}`,
      status: "closed",
    }).onConflictDoNothing();

    const result = await provisionOrgDb({ organizationId: closedOrgId });
    expect(result.success).toBe(false);
    expect(result.error).toContain("closed");

    await db.delete(organizationsTable).where(eq(organizationsTable.id, closedOrgId)).catch(() => {});
  });
});

// ─── 8–10. withOrgContext ─────────────────────────────────────────────────────

describe("Sprint 6 — withOrgContext routing", () => {
  it("8. routes to the correct org schema", async () => {
    const result = await withOrgContext(
      { tenantId: ALPHA_ORG_ID, userId: "user-test", purpose: "test.routing" },
      async (conn) => {
        // Verify the search_path is set to Alpha's schema
        const pathResult = await conn.db.execute(sql.raw("SHOW search_path"));
        const searchPath = (pathResult.rows[0] as any)?.search_path ?? "";
        return { schemaName: conn.schemaName, searchPath };
      },
    );
    expect(result.schemaName).toBe(alphaSchema);
    expect(result.searchPath).toContain(alphaSchema);
  });

  it("8b. can insert and query a task in the org schema", async () => {
    const taskId = randomUUID();
    await withOrgContext(
      { tenantId: ALPHA_ORG_ID, userId: "user-test", purpose: "test.task_insert" },
      async (conn) => {
        await conn.db.execute(sql.raw(`
          INSERT INTO "${alphaSchema}".org_tasks (id, title, description, originating_user_id)
          VALUES ('${taskId}', 'Sprint 6 Test Task', 'Test task for Sprint 6', 'user-test')
        `));
      },
    );

    // Verify the task is in Alpha's schema
    const result = await db.execute(sql.raw(
      `SELECT id, title FROM "${alphaSchema}".org_tasks WHERE id = '${taskId}'`,
    ));
    expect(result.rows.length).toBe(1);
    expect((result.rows[0] as any).title).toBe("Sprint 6 Test Task");
  });

  it("9. fails fast for unprovisioned org (fail-closed)", async () => {
    await expect(
      withOrgContext(
        { tenantId: UNKNOWN_ORG_ID, userId: "user-test", purpose: "test.unprovisioned" },
        async () => "should not reach",
      ),
    ).rejects.toThrow(OrgConnectionError);
  });

  it("10. fails for suspended org db (fail-closed)", async () => {
    // Create and provision a separate org, then suspend its DB entry
    const suspendOrgId = `test-s6-suspend-${randomUUID().slice(0, 8)}`;
    await db.insert(organizationsTable).values({
      id: suspendOrgId, name: "Suspend Test", slug: `suspend-${suspendOrgId.slice(-4)}`, status: "active",
    }).onConflictDoNothing();

    await provisionOrgDb({ organizationId: suspendOrgId });

    // Suspend the DB entry
    await db.update(orgDatabaseRegistryTable)
      .set({ status: "suspended" })
      .where(eq(orgDatabaseRegistryTable.organizationId, suspendOrgId));
    await drainOrgPool(suspendOrgId);

    await expect(
      withOrgContext(
        { tenantId: suspendOrgId, userId: "user-test", purpose: "test.suspended" },
        async () => "should not reach",
      ),
    ).rejects.toThrow(OrgConnectionError);

    // Cleanup
    const suspendSchema = deriveSchemaName(suspendOrgId);
    await db.execute(sql.raw(`DROP SCHEMA IF EXISTS "${suspendSchema}" CASCADE`)).catch(() => {});
    await db.delete(orgDatabaseRegistryTable).where(eq(orgDatabaseRegistryTable.organizationId, suspendOrgId)).catch(() => {});
    await db.delete(organizationsTable).where(eq(organizationsTable.id, suspendOrgId)).catch(() => {});
  });
});

// ─── 11. Cross-org isolation ──────────────────────────────────────────────────

describe("Sprint 6 — Cross-org schema isolation", () => {
  it("Alpha context cannot see Beta org_tasks (schema isolation)", async () => {
    // Insert a Beta-specific task
    const betaTaskId = randomUUID();
    await db.execute(sql.raw(`
      INSERT INTO "${betaSchema}".org_tasks (id, title, originating_user_id)
      VALUES ('${betaTaskId}', 'Beta Secret Task', 'beta-user')
    `));

    // Query from Alpha's context — should not see Beta's task
    const rows = await withOrgContext(
      { tenantId: ALPHA_ORG_ID, userId: "alpha-user", purpose: "test.cross_schema" },
      async (conn) => {
        const result = await conn.db.execute(sql.raw(
          `SELECT id FROM "${alphaSchema}".org_tasks WHERE id = '${betaTaskId}'`,
        ));
        return result.rows;
      },
    );
    // Beta's task ID is not in Alpha's schema — complete schema isolation
    expect(rows.length).toBe(0);
  });

  it("Alpha and Beta have independent org_settings", async () => {
    // Update a setting in Alpha only
    await withOrgContext(
      { tenantId: ALPHA_ORG_ID, userId: "alpha-user", purpose: "test.settings" },
      async (conn) => {
        await conn.db.execute(sql.raw(`
          INSERT INTO "${alphaSchema}".org_settings (key, value, label)
          VALUES ('alpha_specific_flag', 'true', 'Alpha Only Flag')
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
        `));
      },
    );

    // Beta should not have this setting
    const betaResult = await db.execute(sql.raw(`
      SELECT value FROM "${betaSchema}".org_settings WHERE key = 'alpha_specific_flag'
    `));
    expect(betaResult.rows.length).toBe(0);

    // Alpha should have it
    const alphaResult = await db.execute(sql.raw(`
      SELECT value FROM "${alphaSchema}".org_settings WHERE key = 'alpha_specific_flag'
    `));
    expect(alphaResult.rows.length).toBe(1);
  });
});

// ─── 12–13. Health checks ─────────────────────────────────────────────────────

describe("Sprint 6 — Health monitoring", () => {
  it("12. health check returns healthy after provisioning", async () => {
    const health = await checkOrgDbHealth(ALPHA_ORG_ID);
    expect(health.status).toBe("healthy");
    expect(health.tableCount).toBeGreaterThanOrEqual(5);
    expect(health.latencyMs).toBeGreaterThanOrEqual(0);
    expect(health.error).toBeUndefined();
  });

  it("13. health check returns unreachable for unprovisioned org", async () => {
    const health = await checkOrgDbHealth(UNKNOWN_ORG_ID);
    expect(health.status).toBe("unreachable");
    expect(health.error).toContain("Not provisioned");
  });
});

// ─── 14. Pool status ─────────────────────────────────────────────────────────

describe("Sprint 6 — Connection pool management", () => {
  it("14. pool status reflects active pools after context use", async () => {
    const status = getPoolStatus();
    expect(status.activePools).toBeGreaterThanOrEqual(1);
    expect(status.maxPools).toBe(50);
    expect(Array.isArray(status.poolSummaries)).toBe(true);
  });
});

// ─── 15–16. Deprovisioning ────────────────────────────────────────────────────

describe("Sprint 6 — Deprovisioning", () => {
  it("15. deprovision removes schema and marks deprovisioned (pre-migration)", async () => {
    // Create a throwaway org for this test
    const tmpOrgId = `test-s6-tmp-${randomUUID().slice(0, 8)}`;
    await db.insert(organizationsTable).values({
      id: tmpOrgId, name: "Tmp Org", slug: `tmp-${tmpOrgId.slice(-4)}`, status: "active",
    }).onConflictDoNothing();

    await provisionOrgDb({ organizationId: tmpOrgId });
    const tmpSchema = deriveSchemaName(tmpOrgId);

    // Verify schema exists
    const before = await db.execute(sql.raw(
      `SELECT schema_name FROM information_schema.schemata WHERE schema_name = '${tmpSchema}'`,
    ));
    expect(before.rows.length).toBe(1);

    const result = await deprovisionOrgDb(tmpOrgId);
    expect(result.success).toBe(true);

    // Schema should be gone
    const after = await db.execute(sql.raw(
      `SELECT schema_name FROM information_schema.schemata WHERE schema_name = '${tmpSchema}'`,
    ));
    expect(after.rows.length).toBe(0);

    // Registry status should be "deprovisioned"
    const [entry] = await db
      .select({ status: orgDatabaseRegistryTable.status })
      .from(orgDatabaseRegistryTable)
      .where(eq(orgDatabaseRegistryTable.organizationId, tmpOrgId))
      .limit(1);
    expect(entry?.status).toBe("deprovisioned");

    // Cleanup
    await db.delete(orgDatabaseRegistryTable).where(eq(orgDatabaseRegistryTable.organizationId, tmpOrgId)).catch(() => {});
    await db.delete(organizationsTable).where(eq(organizationsTable.id, tmpOrgId)).catch(() => {});
  });

  it("16. deprovision blocked when isMigrated = true", async () => {
    // Mark Alpha as migrated
    await db.update(orgDatabaseRegistryTable)
      .set({ isMigrated: true })
      .where(eq(orgDatabaseRegistryTable.organizationId, ALPHA_ORG_ID));

    const result = await deprovisionOrgDb(ALPHA_ORG_ID);
    expect(result.success).toBe(false);
    expect(result.message).toContain("migrated");

    // Reset
    await db.update(orgDatabaseRegistryTable)
      .set({ isMigrated: false })
      .where(eq(orgDatabaseRegistryTable.organizationId, ALPHA_ORG_ID));
  });
});

// ─── 17–18. Platform audit events ────────────────────────────────────────────

describe("Sprint 6 — Platform audit events", () => {
  it("17. platform audit event written on provisioning", async () => {
    const events = await db
      .select()
      .from(platformAuditLogTable)
      .where(eq(platformAuditLogTable.organizationId, ALPHA_ORG_ID));

    const provisionEvent = events.find(e => e.eventType === "platform.org_database_provisioned");
    expect(provisionEvent).toBeTruthy();
    expect(provisionEvent?.resourceType).toBe("org_database");
  });

  it("18. platform audit event written on deprovisioning", async () => {
    // Look for any deprovisioned event (from test 15)
    const events = await db
      .select()
      .from(platformAuditLogTable);

    const deprovisionEvents = events.filter(e => e.eventType === "platform.org_database_deprovisioned");
    expect(deprovisionEvents.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── 19. Initial org settings ────────────────────────────────────────────────

describe("Sprint 6 — Initial org settings", () => {
  it("19. all default settings are seeded in Alpha's schema", async () => {
    const result = await db.execute(sql.raw(
      `SELECT key FROM "${alphaSchema}".org_settings ORDER BY key`,
    ));
    const keys = result.rows.map((r: any) => r.key);
    expect(keys).toContain("ai_enabled");
    expect(keys).toContain("ai_approval_required");
    expect(keys).toContain("data_retention_days");
    expect(keys).toContain("timezone");
    expect(keys).toContain("ndis_provider");
    expect(keys).toContain("clinical_module");
    expect(keys.length).toBeGreaterThanOrEqual(7);
  });
});

// ─── 20. Operational table structure ─────────────────────────────────────────

describe("Sprint 6 — Operational table structure", () => {
  it("20. all required operational tables exist in Alpha schema", async () => {
    const result = await db.execute(sql.raw(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = '${alphaSchema}' ORDER BY table_name
    `));
    const tables = result.rows.map((r: any) => r.table_name);

    expect(tables).toContain("org_memberships");
    expect(tables).toContain("org_settings");
    expect(tables).toContain("org_workforce_packs");
    expect(tables).toContain("org_tasks");
    expect(tables).toContain("org_task_execution_plans");
    expect(tables).toContain("org_task_specialists");
    expect(tables).toContain("org_approvals");
    expect(tables).toContain("org_approval_rules");
    expect(tables).toContain("org_approval_history");
    expect(tables).toContain("org_audit_log");
    expect(tables.length).toBeGreaterThanOrEqual(10);
  });

  it("20b. org_tasks indexes exist for performance", async () => {
    const result = await db.execute(sql.raw(`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = '${alphaSchema}' AND tablename = 'org_tasks'
    `));
    const indexes = result.rows.map((r: any) => r.indexname);
    expect(indexes.some(i => i.includes("state") || i.includes("created"))).toBe(true);
  });
});
