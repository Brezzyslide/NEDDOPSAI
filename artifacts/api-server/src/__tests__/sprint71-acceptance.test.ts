/**
 * Sprint 7.1 — Production Boundary Close-Out Acceptance Test Suite
 *
 * 14 tests covering all Sprint 7.1 Definition of Done items:
 *
 *  1. Legacy table write restrictions applied — needsops_app has no INSERT/UPDATE/DELETE
 *  2. verifyLegacyTablesReadOnly() returns allReadOnly = true
 *  3. LegacyWriteError is thrown correctly when a table is writeable (design test)
 *  4. Org audit events write to org schema (not public.org_audit_log)
 *  5. Alpha org events do not appear in Beta's org audit log (isolation)
 *  6. Org audit fallback writes to public.org_audit_log for unprovisioned orgs
 *  7. SecretsProvider interface: DatabaseSecretsProvider implements store/retrieve/rotate
 *  8. createSecretsProvider("database") resolves without error
 *  9. withOrgMemberContext() BLOCKS access when membership is missing
 * 10. withOrgMemberContext() ALLOWS access when membership is active
 * 11. withOrgMemberContext() BLOCKS access when membership is suspended
 * 12. FilesystemBackupProvider stores encrypted payload to filesystem
 * 13. restoreOrgBackup() with provider round-trips correctly
 * 14. is_test_organisation and environment columns exist; test-org never auto-created
 *
 * Classification:
 *   REAL DB  — tests marked [DB] run against actual PostgreSQL
 *   DESIGN   — tests marked [D] verify interface/type-level guarantees
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { sql, eq } from "drizzle-orm";
import { db as platformDb, organizationsTable, orgDatabaseRegistryTable } from "@workspace/db";
import {
  provisionOrgDb,
  withOrgContext,
  OrgConnectionError,
  drainOrgPool,
  verifyLegacyTablesReadOnly,
  LegacyWriteError,
  LegacyWriteCheckResult,
  withOrgMemberContext,
  OrgMembershipError,
  checkLocalMembership,
  FilesystemBackupProvider,
  createOrgBackup,
  restoreOrgBackup,
} from "@workspace/org-db";
import { DatabaseSecretsProvider, createSecretsProvider } from "@workspace/secrets";
import { existsSync } from "fs";
import { join } from "path";

// ─── Test org identifiers (generated fresh per test run) ──────────────────────

const ALPHA_ID = randomUUID();
const BETA_ID  = randomUUID();
const TEST_RUN = `sprint71-${Date.now()}`;

// ─── Setup / teardown ─────────────────────────────────────────────────────────

beforeAll(async () => {
  // Create test org records — explicitly marked as test orgs
  await platformDb.insert(organizationsTable).values([
    {
      id: ALPHA_ID,
      name: `Sprint71 Alpha ${TEST_RUN}`,
      slug: `s71-alpha-${ALPHA_ID.slice(0, 8)}`,
      status: "active",
      isTestOrganisation: true,
      environment: "test",
    } as any,
    {
      id: BETA_ID,
      name: `Sprint71 Beta ${TEST_RUN}`,
      slug: `s71-beta-${BETA_ID.slice(0, 8)}`,
      status: "active",
      isTestOrganisation: true,
      environment: "test",
    } as any,
  ]).onConflictDoNothing();

  // Provision both orgs
  await Promise.all([
    provisionOrgDb({ organizationId: ALPHA_ID }),
    provisionOrgDb({ organizationId: BETA_ID }),
  ]);

  // Add an active membership for ALPHA_ID (for membership guard tests)
  await withOrgContext({ tenantId: ALPHA_ID, userId: "test-user-active", purpose: "test_setup" }, async (conn) => {
    await conn.db.execute(sql.raw(`
      INSERT INTO "${conn.schemaName}".org_memberships
        (id, platform_user_id, role, status, permissions, clinical_access, can_approve_ai_outputs)
      VALUES
        ('mbr-active-${ALPHA_ID.slice(0,8)}', 'test-user-active', 'member', 'active', '{}', 'none', false),
        ('mbr-suspended-${ALPHA_ID.slice(0,8)}', 'test-user-suspended', 'member', 'suspended', '{}', 'none', false)
      ON CONFLICT DO NOTHING
    `));
  });
}, 60_000);

afterAll(async () => {
  // Only delete rows this test run created — never delete persistent orgs
  for (const orgId of [ALPHA_ID, BETA_ID]) {
    await platformDb.delete(orgDatabaseRegistryTable)
      .where(eq(orgDatabaseRegistryTable.organizationId, orgId))
      .catch(() => {});
    await platformDb.execute(sql.raw(
      `DROP SCHEMA IF EXISTS "${`org_${orgId.replace(/-/g, "_")}`}" CASCADE`,
    )).catch(() => {});
    await platformDb.delete(organizationsTable)
      .where(eq(organizationsTable.id, orgId))
      .catch(() => {});
  }

  await Promise.all([
    drainOrgPool(ALPHA_ID).catch(() => {}),
    drainOrgPool(BETA_ID).catch(() => {}),
  ]);
}, 30_000);

// ─── Tests ────────────────────────────────────────────────────────────────────

// ── Test 1 [DB]: Legacy table write restrictions applied to live DB ───────────

it("[1][DB] needsops_app has no INSERT/UPDATE/DELETE on legacy tables", async () => {
  const result = await platformDb.execute(sql.raw(`
    SELECT table_name, privilege_type
    FROM information_schema.role_table_grants
    WHERE grantee = 'needsops_app'
      AND table_schema = 'public'
      AND table_name IN (
        'audit_log', 'org_audit_log', 'tasks', 'approvals',
        'approval_history', 'task_execution_plans', 'task_specialists'
      )
      AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE')
    ORDER BY table_name, privilege_type
  `));

  expect(result.rows).toHaveLength(0);
}, 15_000);

// ── Test 2 [DB]: verifyLegacyTablesReadOnly() passes ─────────────────────────

it("[2][DB] verifyLegacyTablesReadOnly() returns allReadOnly = true", async () => {
  const result = await verifyLegacyTablesReadOnly();

  expect(result.allReadOnly).toBe(true);
  expect(result.writeableTable).toHaveLength(0);
  expect(result.checkedAt).toBeInstanceOf(Date);
}, 10_000);

// ── Test 3 [D]: LegacyWriteError carries table names ─────────────────────────

it("[3][D] LegacyWriteError correctly surfaces writeable table names", () => {
  const mockResult: LegacyWriteCheckResult = {
    allReadOnly: false,
    writeableTable: [
      { tableName: "tasks", privileges: ["INSERT", "UPDATE"] },
      { tableName: "approvals", privileges: ["DELETE"] },
    ],
    checkedAt: new Date(),
  };

  const err = new LegacyWriteError(mockResult);

  expect(err.name).toBe("LegacyWriteError");
  expect(err.writeableTables).toContain("tasks");
  expect(err.writeableTables).toContain("approvals");
  expect(err.message).toContain("SECURITY");
  expect(err.message).toContain("sprint71-write-restrictions.sql");
});

// ── Test 4 [DB]: Org audit events write to org schema (not public.org_audit_log) ─

it("[4][DB] Org audit events route to org-schema org_audit_log", async () => {
  const { writeAuditEvent } = await import("../services/auditService.js");

  await writeAuditEvent({
    organizationId: ALPHA_ID,
    eventType: "task.created" as any,
    resourceType: "task",
    resourceId: "test-task-audit-1",
    actorUserId: "test-actor",
    actorType: "user",
    metadata: { testRun: TEST_RUN, test: "sprint71-test4" },
  });

  // Verify event is in org schema (not just public)
  const orgSchema = `org_${ALPHA_ID.replace(/-/g, "_")}`;
  const result = await platformDb.execute(sql.raw(`
    SELECT id, event_type, resource_id, actor_user_id
    FROM "${orgSchema}".org_audit_log
    WHERE resource_id = 'test-task-audit-1'
    LIMIT 1
  `));

  expect(result.rows).toHaveLength(1);
  expect((result.rows[0] as any).event_type).toBe("task.created");
}, 20_000);

// ── Test 5 [DB]: Alpha's audit events do NOT appear in Beta's org schema ──────

it("[5][DB] Alpha org audit events are isolated from Beta's org schema", async () => {
  const { writeAuditEvent } = await import("../services/auditService.js");

  // Write event for Alpha only
  await writeAuditEvent({
    organizationId: ALPHA_ID,
    eventType: "task.updated" as any,
    resourceType: "task",
    resourceId: `alpha-only-${TEST_RUN}`,
    actorUserId: "alpha-actor",
    actorType: "user",
    metadata: { testRun: TEST_RUN },
  });

  // Beta's org schema must NOT contain Alpha's event
  const betaSchema = `org_${BETA_ID.replace(/-/g, "_")}`;
  const result = await platformDb.execute(sql.raw(`
    SELECT id FROM "${betaSchema}".org_audit_log
    WHERE resource_id = 'alpha-only-${TEST_RUN}'
    LIMIT 1
  `));

  expect(result.rows).toHaveLength(0);
}, 20_000);

// ── Test 6 [DB]: Fallback to public.org_audit_log for unprovisioned orgs ─────

it("[6][DB] Org audit falls back to public.org_audit_log for unprovisioned orgs", async () => {
  const { writeAuditEvent } = await import("../services/auditService.js");

  // Create an org record that EXISTS in organizations but has no provisioned schema
  const unprovisionedOrgId = randomUUID();
  await platformDb.insert(organizationsTable).values({
    id: unprovisionedOrgId,
    name: `Unprovisioned Test Org ${unprovisionedOrgId.slice(0, 8)}`,
    slug: `unprovisioned-${unprovisionedOrgId.slice(0, 8)}`,
    status: "onboarding",
    isTestOrganisation: true,
    environment: "test",
  } as any).onConflictDoNothing();

  const legacyResourceId = `legacy-fallback-${unprovisionedOrgId.slice(0, 8)}`;

  // Write to an org that has no registry entry — must not throw
  await expect(
    writeAuditEvent({
      organizationId: unprovisionedOrgId,
      eventType: "task.created" as any,
      resourceType: "task",
      resourceId: legacyResourceId,
      actorUserId: "test",
      metadata: { testRun: TEST_RUN },
    }),
  ).resolves.not.toThrow();

  // Event should land in public.org_audit_log
  const result = await platformDb.execute(sql.raw(`
    SELECT id FROM public.org_audit_log
    WHERE resource_id = '${legacyResourceId}'
    LIMIT 1
  `));

  // Cleanup
  await platformDb.execute(sql.raw(
    `DELETE FROM public.org_audit_log WHERE resource_id = '${legacyResourceId}'`,
  )).catch(() => {});
  await platformDb.delete(organizationsTable)
    .where(eq(organizationsTable.id, unprovisionedOrgId))
    .catch(() => {});

  expect(result.rows).toHaveLength(1);
}, 20_000);

// ── Test 7 [D]: DatabaseSecretsProvider implements SecretsProvider interface ──

it("[7][D] DatabaseSecretsProvider implements SecretsProvider interface", () => {
  const provider = new DatabaseSecretsProvider();

  expect(typeof provider.store).toBe("function");
  expect(typeof provider.retrieve).toBe("function");
  expect(typeof provider.rotate).toBe("function");
  expect(typeof provider.revoke).toBe("function");
  expect(typeof provider.getStatus).toBe("function");
  expect(typeof provider.markValidated).toBe("function");
  expect(provider.providerName).toBe("database");
});

// ── Test 8 [D]: createSecretsProvider factory resolves ───────────────────────

it("[8] createSecretsProvider('database') resolves without error", async () => {
  const provider = await createSecretsProvider();

  expect(provider).toBeDefined();
  expect(typeof provider.store).toBe("function");
}, 10_000);

// ── Test 9 [DB]: withOrgMemberContext blocks missing membership ───────────────

it("[9][DB] withOrgMemberContext() BLOCKS access when membership is missing", async () => {
  await expect(
    withOrgMemberContext(
      { tenantId: ALPHA_ID, userId: "no-membership-user", purpose: "test" },
      async () => "should-not-reach",
    ),
  ).rejects.toMatchObject({
    name: "OrgMembershipError",
    code: "MISSING_MEMBERSHIP",
  });
}, 15_000);

// ── Test 10 [DB]: withOrgMemberContext allows active membership ───────────────

it("[10][DB] withOrgMemberContext() ALLOWS access for active member", async () => {
  const result = await withOrgMemberContext(
    { tenantId: ALPHA_ID, userId: "test-user-active", purpose: "test" },
    async ({ membership, role }) => ({ role, status: membership.status }),
  );

  expect(result.status).toBe("active");
  expect(result.role).toBe("member");
}, 15_000);

// ── Test 11 [DB]: withOrgMemberContext blocks suspended membership ─────────────

it("[11][DB] withOrgMemberContext() BLOCKS access for suspended member", async () => {
  await expect(
    withOrgMemberContext(
      { tenantId: ALPHA_ID, userId: "test-user-suspended", purpose: "test" },
      async () => "should-not-reach",
    ),
  ).rejects.toMatchObject({
    name: "OrgMembershipError",
    code: "SUSPENDED_MEMBERSHIP",
  });
}, 15_000);

// ── Test 12 [DB]: FilesystemBackupProvider stores to disk ─────────────────────

it("[12][DB] createOrgBackup() with FilesystemBackupProvider stores encrypted file", async () => {
  const provider = new FilesystemBackupProvider("/tmp/sprint71-backup-test");
  const result = await createOrgBackup(ALPHA_ID, provider);

  expect(result.status).toBe("completed");
  expect(result.storageRef).toBeDefined();
  expect(result.encryptedPayload).toBeUndefined(); // not returned when provider is used

  // File must exist on disk
  const filePath = join("/tmp/sprint71-backup-test", ALPHA_ID, `${result.storageRef!}.enc`);
  expect(existsSync(filePath)).toBe(true);

  // Storage ref must be a UUID
  expect(result.storageRef).toMatch(/^[0-9a-f-]{36}$/);

  // Provider list must include the backup
  const refs = await provider.list(ALPHA_ID);
  expect(refs).toContain(result.storageRef!);
}, 30_000);

// ── Test 13 [DB]: restoreOrgBackup() round-trip via provider ──────────────────

it("[13][DB] restoreOrgBackup() round-trip: backup → restore → data present", async () => {
  const provider = new FilesystemBackupProvider("/tmp/sprint71-backup-test");

  // Seed Alpha with a task to verify after restore
  await withOrgContext({ tenantId: ALPHA_ID, userId: "t", purpose: "test" }, async (conn) => {
    await conn.db.execute(sql.raw(`
      INSERT INTO "${conn.schemaName}".org_tasks
        (id, title, current_state, priority, approval_state)
      VALUES ('s71-task-restore-check', 'Sprint71 Restore Test Task', 'draft', 'normal', 'not_required')
      ON CONFLICT DO NOTHING
    `));
  });

  // Backup
  const backup = await createOrgBackup(ALPHA_ID, provider);
  expect(backup.status).toBe("completed");

  // Clear the task
  await withOrgContext({ tenantId: ALPHA_ID, userId: "t", purpose: "test" }, async (conn) => {
    await conn.db.execute(sql.raw(
      `DELETE FROM "${conn.schemaName}".org_tasks WHERE id = 's71-task-restore-check'`,
    ));
  });

  // Restore
  const restore = await restoreOrgBackup(ALPHA_ID, backup.storageRef!, { provider });
  expect(restore.success).toBe(true);

  // Verify task is back
  const check = await withOrgContext({ tenantId: ALPHA_ID, userId: "t", purpose: "test" }, async (conn) => {
    return conn.db.execute(sql.raw(
      `SELECT id FROM "${conn.schemaName}".org_tasks WHERE id = 's71-task-restore-check'`,
    ));
  });

  expect(check.rows).toHaveLength(1);

  // Beta must be unaffected
  const betaSchema = `org_${BETA_ID.replace(/-/g, "_")}`;
  const betaCheck = await platformDb.execute(sql.raw(
    `SELECT id FROM "${betaSchema}".org_tasks WHERE id = 's71-task-restore-check'`,
  ));
  expect(betaCheck.rows).toHaveLength(0);
}, 60_000);

// ── Test 14 [DB]: is_test_organisation and environment columns ────────────────

it("[14][DB] is_test_organisation and environment columns exist; test org rows are identifiable", async () => {
  // Query both test orgs — both should be marked
  const rows = await platformDb.execute(sql.raw(`
    SELECT id, is_test_organisation, environment
    FROM public.organizations
    WHERE id IN ('${ALPHA_ID}', '${BETA_ID}')
    ORDER BY id
  `));

  expect(rows.rows).toHaveLength(2);

  for (const row of rows.rows as any[]) {
    expect(row.is_test_organisation).toBe(true);
    expect(row.environment).toBe("test");
  }

  // Verify no production orgs have is_test_organisation=true accidentally
  const prodRows = await platformDb.execute(sql.raw(`
    SELECT COUNT(*) AS cnt
    FROM public.organizations
    WHERE is_test_organisation = TRUE
      AND environment = 'production'
  `));

  // Should be zero — test flag and production environment are mutually exclusive
  const cnt = Number((prodRows.rows[0] as any).cnt);
  expect(cnt).toBe(0);
}, 10_000);
