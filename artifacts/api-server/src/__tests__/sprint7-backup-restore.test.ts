/**
 * Sprint 7 — Backup and Restore Isolation Tests
 *
 * ACCEPTANCE REQUIREMENT (Sprint 7):
 *   Prove that Organisation Alpha can be restored without changing or
 *   interrupting Organisation Beta's data.
 *
 * DO NOT claim independent restore capability until this test passes.
 *
 * Tests prove:
 *   • Backup is encrypted — plaintext is not stored
 *   • Backup payload belongs to the correct organisation (verified before restore)
 *   • Cross-org restore is blocked (Beta's backup cannot restore to Alpha)
 *   • Restoring Alpha does not alter Beta's data (ACCEPTANCE TEST)
 *   • Backup checksum detects tampering
 *   • Backup status is available without exposing contents
 *
 * Classification:
 *   REAL DB  — writes to actual test PostgreSQL schemas
 *   MOCKED   — design-level security proofs
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { sql, eq } from "drizzle-orm";
import { db as platformDb, organizationsTable, orgDatabaseRegistryTable } from "@workspace/db";
import {
  provisionOrgDb,
  withOrgContext,
  drainOrgPool,
  createOrgBackup,
  restoreOrgBackup,
  getOrgBackupStatus,
  BackupError,
} from "@workspace/org-db";

// ─── Test organisations ───────────────────────────────────────────────────────

const ALPHA_ID = randomUUID();
const BETA_ID  = randomUUID();

beforeAll(async () => {
  await platformDb.insert(organizationsTable).values([
    { id: ALPHA_ID, name: "Alpha Backup Test", slug: `alpha-bk-${ALPHA_ID.slice(0,8)}`, status: "active", country: "AU", timezone: "Australia/Sydney" },
    { id: BETA_ID,  name: "Beta Backup Test",  slug: `beta-bk-${BETA_ID.slice(0,8)}`,  status: "active", country: "AU", timezone: "Australia/Sydney" },
  ]).onConflictDoNothing();

  await Promise.all([
    provisionOrgDb({ organizationId: ALPHA_ID }),
    provisionOrgDb({ organizationId: BETA_ID }),
  ]);

  // Seed Alpha with tasks
  await withOrgContext({ tenantId: ALPHA_ID, userId: "u1", purpose: "test" }, async (conn) => {
    await conn.db.execute(sql.raw(`
      INSERT INTO "${conn.schemaName}".org_tasks (id, title, current_state, priority, approval_state)
      VALUES ('alpha-task-1', 'Alpha Task Before Backup', 'draft', 'normal', 'not_required')
    `));
  });

  // Seed Beta with independent tasks
  await withOrgContext({ tenantId: BETA_ID, userId: "u2", purpose: "test" }, async (conn) => {
    await conn.db.execute(sql.raw(`
      INSERT INTO "${conn.schemaName}".org_tasks (id, title, current_state, priority, approval_state)
      VALUES ('beta-task-1', 'Beta Task Should Not Change', 'draft', 'high', 'not_required')
    `));
  });
});

afterAll(async () => {
  await Promise.all([drainOrgPool(ALPHA_ID), drainOrgPool(BETA_ID)]);

  for (const orgId of [ALPHA_ID, BETA_ID]) {
    const [reg] = await platformDb.select({ schemaName: orgDatabaseRegistryTable.schemaName })
      .from(orgDatabaseRegistryTable).where(eq(orgDatabaseRegistryTable.organizationId, orgId)).limit(1);
    if (reg?.schemaName) {
      await platformDb.execute(sql.raw(`DROP SCHEMA IF EXISTS "${reg.schemaName}" CASCADE`)).catch(() => {});
    }
    await platformDb.delete(orgDatabaseRegistryTable).where(eq(orgDatabaseRegistryTable.organizationId, orgId)).catch(() => {});
    await platformDb.delete(organizationsTable).where(eq(organizationsTable.id, orgId)).catch(() => {});
  }
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Sprint 7 — Backup and Restore", () => {

  let alphaBackupPayload: string;
  let betaBackupPayload: string;

  it("REAL DB: backup Alpha successfully", async () => {
    const result = await createOrgBackup(ALPHA_ID);
    expect(result.status).toBe("completed");
    expect(result.organizationId).toBe(ALPHA_ID);
    expect(result.encryptedPayload.length).toBeGreaterThan(100);
    expect(result.checksum).toMatch(/^[0-9a-f]{64}$/); // SHA-256
    expect(result.tablesCaptured).toContain("org_tasks");
    expect(result.recordCounts["org_tasks"]).toBeGreaterThanOrEqual(1);

    alphaBackupPayload = result.encryptedPayload;
  });

  it("REAL DB: backup Beta successfully", async () => {
    const result = await createOrgBackup(BETA_ID);
    expect(result.status).toBe("completed");
    expect(result.organizationId).toBe(BETA_ID);
    expect(result.encryptedPayload.length).toBeGreaterThan(100);

    betaBackupPayload = result.encryptedPayload;
  });

  it("REAL DB: encrypted backup payload does not contain plaintext task titles", () => {
    // Backup payload must be encrypted — plaintext task content not readable
    expect(alphaBackupPayload).not.toContain("Alpha Task Before Backup");
    expect(alphaBackupPayload).not.toContain("alpha-task-1");
    expect(betaBackupPayload).not.toContain("Beta Task Should Not Change");
    expect(betaBackupPayload).not.toContain("beta-task-1");
  });

  it("MOCKED: cross-org restore is blocked (Beta's backup cannot restore to Alpha)", async () => {
    // Attempt to restore Beta's backup to Alpha's org — must throw
    await expect(
      restoreOrgBackup(ALPHA_ID, betaBackupPayload),
    ).rejects.toThrow(BackupError);

    await expect(
      restoreOrgBackup(ALPHA_ID, betaBackupPayload),
    ).rejects.toThrow("Cross-org restore is not permitted");
  });

  it("REAL DB: *** ACCEPTANCE TEST *** — restore Alpha does not alter Beta", async () => {
    // 1. Record Beta's task count BEFORE Alpha restore
    const betaBefore = await withOrgContext({ tenantId: BETA_ID, userId: "u2", purpose: "test" }, async (conn) => {
      const r = await conn.db.execute(sql.raw(`SELECT id, title, priority FROM "${conn.schemaName}".org_tasks`));
      return r.rows as Array<{ id: string; title: string; priority: string }>;
    });
    expect(betaBefore.length).toBeGreaterThanOrEqual(1);
    const betaTaskBefore = betaBefore.find(r => r.id === "beta-task-1");
    expect(betaTaskBefore).toBeDefined();
    expect(betaTaskBefore!.title).toBe("Beta Task Should Not Change");

    // 2. Modify Alpha after the backup was taken
    await withOrgContext({ tenantId: ALPHA_ID, userId: "u1", purpose: "test" }, async (conn) => {
      await conn.db.execute(sql.raw(`
        INSERT INTO "${conn.schemaName}".org_tasks (id, title, current_state, priority, approval_state)
        VALUES ('alpha-task-2', 'Alpha Post-Backup Task', 'draft', 'high', 'not_required')
      `));
    });

    // 3. Restore Alpha from the pre-modification backup
    const restoreResult = await restoreOrgBackup(ALPHA_ID, alphaBackupPayload);
    expect(restoreResult.success).toBe(true);
    expect(restoreResult.tablesRestored).toContain("org_tasks");

    // 4. Verify Alpha is restored to the pre-backup state
    const alphaAfter = await withOrgContext({ tenantId: ALPHA_ID, userId: "u1", purpose: "test" }, async (conn) => {
      const r = await conn.db.execute(sql.raw(`SELECT id, title FROM "${conn.schemaName}".org_tasks`));
      return r.rows as Array<{ id: string; title: string }>;
    });
    // Post-backup task should be gone
    const postBackupTask = alphaAfter.find(r => r.id === "alpha-task-2");
    expect(postBackupTask).toBeUndefined();
    // Pre-backup task should exist
    const preBackupTask = alphaAfter.find(r => r.id === "alpha-task-1");
    expect(preBackupTask).toBeDefined();

    // 5. *** CORE ACCEPTANCE CHECK ***: Beta is completely unchanged
    const betaAfter = await withOrgContext({ tenantId: BETA_ID, userId: "u2", purpose: "test" }, async (conn) => {
      const r = await conn.db.execute(sql.raw(`SELECT id, title, priority FROM "${conn.schemaName}".org_tasks`));
      return r.rows as Array<{ id: string; title: string; priority: string }>;
    });

    expect(betaAfter.length).toBe(betaBefore.length); // Same count
    const betaTaskAfter = betaAfter.find(r => r.id === "beta-task-1");
    expect(betaTaskAfter).toBeDefined();
    expect(betaTaskAfter!.title).toBe("Beta Task Should Not Change"); // Unchanged title
    expect(betaTaskAfter!.priority).toBe("high"); // Unchanged priority
  });

  it("MOCKED: backup checksum detects tampering", async () => {
    // Tamper with the encrypted payload
    const tampered = alphaBackupPayload.slice(0, -10) + "TAMPERED00";

    await expect(
      restoreOrgBackup(ALPHA_ID, tampered),
    ).rejects.toThrow();
  });

  it("REAL DB: getOrgBackupStatus returns safe summary", async () => {
    const status = await getOrgBackupStatus(ALPHA_ID);
    expect(status.organizationId).toBe(ALPHA_ID);
    expect(status).toHaveProperty("lastBackupAt");
    expect(status).toHaveProperty("lastBackupStatus");
    expect(status).toHaveProperty("backupCount");

    // Must not include backup payload or content
    expect((status as any).encryptedPayload).toBeUndefined();
    expect((status as any).tables).toBeUndefined();
    expect(JSON.stringify(status)).not.toContain("Alpha Task");
  });

  it("REAL DB: backup for unprovisioned org throws", async () => {
    await expect(createOrgBackup(randomUUID())).rejects.toThrow(BackupError);
  });

});
