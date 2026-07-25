/**
 * Organisation Backup and Restore Service — Sprint 7
 *
 * Provides independent backup and restore for each organisation's operational
 * database/schema. Each org's backup is independent — restoring Alpha does
 * not change or interrupt Beta's data.
 *
 * Backup implementation:
 *   Type: "logical" — SQL-level row capture via SELECT queries, stored as
 *   encrypted JSON. In production this would be supplemented with pg_dump
 *   and point-in-time recovery (WAL archiving on a managed PostgreSQL cluster).
 *
 * Security:
 *   • Backup payloads are AES-256-GCM encrypted (same scheme as secrets service)
 *   • Backup storage references point to object storage (abstracted)
 *   • Platform Console can see backup status but never backup contents
 *   • Restoring does not touch any other org's schema
 *
 * Test requirement (Sprint 7 acceptance):
 *   Restore Alpha → Beta data unchanged (proven in sprint7-backup-restore.test.ts)
 */

import { randomUUID } from "crypto";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { sql, eq, desc } from "drizzle-orm";
import { db as platformDb, orgDatabaseRegistryTable, platformAuditLogTable } from "@workspace/db";

// ─── Encryption helpers (same scheme as secretsService) ───────────────────────

const ALGO = "aes-256-gcm";
const IV_BYTES = 16;
const TAG_BYTES = 16;

function getMasterKey(): Buffer {
  const raw = process.env["SESSION_SECRET"] ?? "dev-backup-key-change-in-production-12345";
  return createHash("sha256").update(raw).digest();
}

function encryptBackup(plaintext: string): string {
  const key = getMasterKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

function decryptBackup(encoded: string): string {
  const key = getMasterKey();
  const buf = Buffer.from(encoded, "base64");
  const iv = buf.subarray(0, IV_BYTES);
  const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = buf.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(ciphertext, undefined, "utf8") + decipher.final("utf8");
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BackupResult {
  backupId: string;
  organizationId: string;
  schemaName: string;
  status: "completed" | "failed";
  sizeBytes: number;
  checksum: string;
  /** Encrypted backup payload — store to external storage in production */
  encryptedPayload: string;
  startedAt: Date;
  completedAt: Date;
  tablesCaptured: string[];
  recordCounts: Record<string, number>;
  error?: string;
}

export interface RestoreResult {
  backupId: string;
  organizationId: string;
  schemaName: string;
  success: boolean;
  tablesRestored: string[];
  recordCounts: Record<string, number>;
  betaUnaffected?: boolean; // set to true when cross-org isolation verified
  error?: string;
}

export interface BackupStatus {
  organizationId: string;
  lastBackupAt: Date | null;
  lastBackupStatus: string;
  backupCount: number;
  nextBackupAt?: Date | null;
}

// ─── Internal backup payload format ──────────────────────────────────────────

interface BackupPayload {
  version: "1";
  organizationId: string;
  schemaName: string;
  capturedAt: string;
  tables: Record<string, any[]>;
  checksum: string;
}

// ─── Core: createBackup ───────────────────────────────────────────────────────

/**
 * Creates a logical backup of an organisation's operational schema.
 * Returns an encrypted payload — store to object storage in production.
 *
 * This backup is independent of all other organisations.
 */
export async function createOrgBackup(organizationId: string): Promise<BackupResult> {
  const startedAt = new Date();
  const backupId = randomUUID();

  const [entry] = await platformDb
    .select()
    .from(orgDatabaseRegistryTable)
    .where(eq(orgDatabaseRegistryTable.organizationId, organizationId))
    .limit(1);

  if (!entry) throw new BackupError(`No registry entry for org ${organizationId}`);
  if (entry.status !== "active") throw new BackupError(`Org status is "${entry.status}" — cannot backup`);

  const s = entry.schemaName;
  const tablesCaptured: string[] = [];
  const recordCounts: Record<string, number> = {};
  const tables: Record<string, any[]> = {};

  const ORG_TABLES = [
    "org_settings", "org_memberships", "org_workforce_packs",
    "org_tasks", "org_task_execution_plans", "org_task_specialists",
    "org_approvals", "org_approval_rules", "org_approval_history",
    "org_audit_log",
  ];

  try {
    for (const tbl of ORG_TABLES) {
      const result = await platformDb.execute(sql.raw(
        `SELECT * FROM "${s}"."${tbl}" ORDER BY (SELECT NULL)`,
      ));
      tables[tbl] = result.rows as any[];
      recordCounts[tbl] = result.rows.length;
      tablesCaptured.push(tbl);
    }

    const payload: BackupPayload = {
      version: "1",
      organizationId,
      schemaName: s,
      capturedAt: startedAt.toISOString(),
      tables,
      checksum: "",
    };

    // Compute checksum over the data (before encryption)
    const plaintextJson = JSON.stringify(payload);
    const checksum = createHash("sha256").update(plaintextJson).digest("hex");
    payload.checksum = checksum;

    const encryptedPayload = encryptBackup(JSON.stringify(payload));
    const sizeBytes = Buffer.byteLength(encryptedPayload, "utf8");

    // Write backup record to org's backup log
    await platformDb.execute(sql.raw(`
      INSERT INTO "${s}".org_backup_log
        (id, backup_type, status, started_at, completed_at, size_bytes, checksum, storage_ref, metadata)
      VALUES (
        '${backupId}', 'logical', 'completed',
        '${startedAt.toISOString()}', '${new Date().toISOString()}',
        ${sizeBytes}, '${checksum}',
        'dev-in-memory:${backupId}',
        '${JSON.stringify({ tables: tablesCaptured, recordCounts }).replace(/'/g, "''")}'
      )
    `)).catch(() => {}); // non-fatal if org backup log table doesn't exist yet

    // Update registry last backup timestamp
    await platformDb
      .update(orgDatabaseRegistryTable)
      .set({
        lastBackupAt: new Date(),
        backupStatus: "completed",
        updatedAt: new Date(),
      })
      .where(eq(orgDatabaseRegistryTable.organizationId, organizationId));

    // Platform audit event
    await platformDb.insert(platformAuditLogTable).values({
      id: randomUUID(),
      organizationId,
      actorUserId: null,
      actorType: "system",
      eventType: "platform.org_backup_completed",
      resourceType: "org_database",
      resourceId: s,
      metadata: { backupId, sizeBytes, tablesCaptured, recordCounts },
    }).catch(() => {});

    return {
      backupId,
      organizationId,
      schemaName: s,
      status: "completed",
      sizeBytes,
      checksum,
      encryptedPayload,
      startedAt,
      completedAt: new Date(),
      tablesCaptured,
      recordCounts,
    };

  } catch (err: any) {
    await platformDb
      .update(orgDatabaseRegistryTable)
      .set({ backupStatus: "failed", updatedAt: new Date() })
      .where(eq(orgDatabaseRegistryTable.organizationId, organizationId))
      .catch(() => {});

    return {
      backupId,
      organizationId,
      schemaName: s,
      status: "failed",
      sizeBytes: 0,
      checksum: "",
      encryptedPayload: "",
      startedAt,
      completedAt: new Date(),
      tablesCaptured,
      recordCounts,
      error: err?.message ?? "Backup failed",
    };
  }
}

// ─── Core: restoreBackup ──────────────────────────────────────────────────────

/**
 * Restores an organisation's operational schema from an encrypted backup payload.
 *
 * ISOLATION GUARANTEE: This function operates only on the org's own schema.
 * It cannot read, write, or affect any other organisation's schema or data.
 *
 * The restore:
 *   1. Verifies the backup belongs to this organisation
 *   2. Verifies the checksum
 *   3. Truncates the org schema tables (org only)
 *   4. Re-inserts all rows from the backup
 */
export async function restoreOrgBackup(
  organizationId: string,
  encryptedPayload: string,
): Promise<RestoreResult> {
  const [entry] = await platformDb
    .select()
    .from(orgDatabaseRegistryTable)
    .where(eq(orgDatabaseRegistryTable.organizationId, organizationId))
    .limit(1);

  if (!entry) throw new BackupError(`No registry entry for org ${organizationId}`);

  const s = entry.schemaName;
  const tablesRestored: string[] = [];
  const recordCounts: Record<string, number> = {};

  let payload: BackupPayload;
  try {
    payload = JSON.parse(decryptBackup(encryptedPayload)) as BackupPayload;
  } catch {
    throw new BackupError(`Failed to decrypt backup payload — key may have changed`);
  }

  // Verify this backup belongs to this org — prevents cross-org restore
  if (payload.organizationId !== organizationId) {
    throw new BackupError(
      `Backup belongs to org ${payload.organizationId} but restore was requested for ${organizationId}. ` +
      "Cross-org restore is not permitted.",
    );
  }

  // Verify checksum
  const expectedChecksum = payload.checksum;
  const dataForCheck = JSON.parse(decryptBackup(encryptedPayload)) as BackupPayload;
  dataForCheck.checksum = "";
  const actualChecksum = createHash("sha256").update(JSON.stringify(dataForCheck)).digest("hex");
  if (actualChecksum !== expectedChecksum) {
    throw new BackupError(`Backup checksum mismatch — backup may be corrupt`);
  }

  // Restore tables in reverse dependency order
  const RESTORE_ORDER = [
    "org_approval_history", "org_approval_rules", "org_approvals",
    "org_task_specialists", "org_task_execution_plans", "org_tasks",
    "org_workforce_packs", "org_memberships", "org_settings",
  ];

  // Truncate in reverse FK order
  for (const tbl of RESTORE_ORDER) {
    await platformDb.execute(sql.raw(`TRUNCATE TABLE "${s}"."${tbl}" CASCADE`));
  }

  // Re-insert data
  for (const tbl of [...RESTORE_ORDER].reverse()) {
    const rows: any[] = payload.tables[tbl] ?? [];
    if (rows.length === 0) {
      recordCounts[tbl] = 0;
      tablesRestored.push(tbl);
      continue;
    }

    // Use json_populate_recordset so PostgreSQL handles all type casts automatically.
    // This avoids the jsonb vs text ambiguity that manual SQL value interpolation suffers from.
    const rowsJson = JSON.stringify(rows).replace(/'/g, "''");
    await platformDb.execute(sql.raw(
      `INSERT INTO "${s}"."${tbl}"
       SELECT * FROM json_populate_recordset(null::"${s}"."${tbl}", '${rowsJson}')
       ON CONFLICT DO NOTHING`,
    ));

    recordCounts[tbl] = rows.length;
    tablesRestored.push(tbl);
  }

  // Audit the restore
  await platformDb.insert(platformAuditLogTable).values({
    id: randomUUID(),
    organizationId,
    actorUserId: null,
    actorType: "system",
    eventType: "platform.org_backup_restored",
    resourceType: "org_database",
    resourceId: s,
    metadata: { schemaName: s, tablesRestored, recordCounts },
  }).catch(() => {});

  return {
    backupId: payload.version,
    organizationId,
    schemaName: s,
    success: true,
    tablesRestored,
    recordCounts,
  };
}

/**
 * Returns backup status for an organisation — safe for Platform Console display.
 * Never includes backup contents.
 */
export async function getOrgBackupStatus(organizationId: string): Promise<BackupStatus> {
  const [entry] = await platformDb
    .select({
      lastBackupAt: orgDatabaseRegistryTable.lastBackupAt,
      backupStatus: (orgDatabaseRegistryTable as any).backupStatus,
      nextBackupAt: (orgDatabaseRegistryTable as any).nextBackupAt,
    })
    .from(orgDatabaseRegistryTable)
    .where(eq(orgDatabaseRegistryTable.organizationId, organizationId))
    .limit(1);

  return {
    organizationId,
    lastBackupAt: entry?.lastBackupAt ?? null,
    lastBackupStatus: (entry as any)?.backupStatus ?? "not_configured",
    backupCount: 0, // would query backup storage in production
    nextBackupAt: (entry as any)?.nextBackupAt ?? null,
  };
}

// ─── Error type ───────────────────────────────────────────────────────────────

export class BackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackupError";
  }
}
