/**
 * Organisation Backup and Restore Service — Sprint 7.1
 *
 * Provides independent backup and restore for each organisation's operational
 * database/schema. Each org's backup is independent — restoring Alpha does
 * not change or interrupt Beta's data.
 *
 * Sprint 7.1 changes:
 *   • createOrgBackup() now accepts an optional BackupStorageProvider.
 *     When provided, the encrypted payload is written to durable storage
 *     and the BackupResult contains a storageRef instead of the raw payload.
 *   • restoreOrgBackup() accepts either an encryptedPayload (legacy) or
 *     a storageRef + provider for storage-backed restore.
 *
 * Backup type: "logical" — SQL-level row capture, AES-256-GCM encrypted.
 *
 * Security:
 *   • Payloads are AES-256-GCM encrypted before any storage write.
 *   • Cross-org restore is rejected (organizationId embedded in payload).
 *   • Checksum detects tampered payloads before restore begins.
 *   • Platform Console sees only metadata — never backup contents.
 */

import { randomUUID } from "crypto";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { sql, eq } from "drizzle-orm";
import { db as platformDb, orgDatabaseRegistryTable, platformAuditLogTable } from "@workspace/db";
import { type BackupStorageProvider, getDefaultBackupStorageProvider } from "./backupStorage";

// ─── Encryption helpers ───────────────────────────────────────────────────────

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
  /** Set when a BackupStorageProvider is used — reference for restore */
  storageRef?: string;
  /** Set when no provider is used (legacy / in-memory) — the raw encrypted payload */
  encryptedPayload?: string;
  startedAt: Date;
  completedAt: Date;
  tablesCaptured: string[];
  recordCounts: Record<string, number>;
  error?: string;
}

export interface RestoreOptions {
  /** Backup storage provider — required when restoring by storageRef */
  provider?: BackupStorageProvider;
}

export interface RestoreResult {
  backupId: string;
  organizationId: string;
  schemaName: string;
  success: boolean;
  tablesRestored: string[];
  recordCounts: Record<string, number>;
  betaUnaffected?: boolean;
  error?: string;
}

export interface BackupStatus {
  organizationId: string;
  lastBackupAt: Date | null;
  lastBackupStatus: string;
  backupCount: number;
  nextBackupAt?: Date | null;
}

interface BackupPayload {
  version: "1";
  organizationId: string;
  schemaName: string;
  capturedAt: string;
  tables: Record<string, any[]>;
  checksum: string;
}

// ─── Tables to back up / restore ─────────────────────────────────────────────

const ORG_TABLES = [
  "org_settings", "org_memberships", "org_workforce_packs",
  "org_tasks", "org_task_execution_plans", "org_task_specialists",
  "org_approvals", "org_approval_rules", "org_approval_history",
  "org_audit_log",
] as const;

const RESTORE_ORDER = [
  "org_approval_history", "org_approval_rules", "org_approvals",
  "org_task_specialists", "org_task_execution_plans", "org_tasks",
  "org_workforce_packs", "org_memberships", "org_settings",
] as const;

// ─── Core: createOrgBackup ────────────────────────────────────────────────────

/**
 * Creates a logical backup of an organisation's operational schema.
 *
 * @param organizationId  - The org UUID (never a slug or display name)
 * @param provider        - Optional storage provider. When provided, the encrypted
 *                          payload is written to durable storage and storageRef is
 *                          returned. When omitted, encryptedPayload is returned
 *                          directly (in-memory / legacy mode).
 */
export async function createOrgBackup(
  organizationId: string,
  provider?: BackupStorageProvider,
): Promise<BackupResult> {
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

  try {
    for (const tbl of ORG_TABLES) {
      const result = await platformDb.execute(sql.raw(
        `SELECT * FROM "${s}"."${tbl}" ORDER BY (SELECT NULL)`,
      ));
      tables[tbl] = result.rows as any[];
      recordCounts[tbl] = result.rows.length;
      tablesCaptured.push(tbl);
    }

    // Build payload and compute checksum (over JSON with checksum="")
    const payloadForChecksum: BackupPayload = {
      version: "1", organizationId, schemaName: s,
      capturedAt: startedAt.toISOString(), tables, checksum: "",
    };
    const plaintextForChecksum = JSON.stringify(payloadForChecksum);
    const checksum = createHash("sha256").update(plaintextForChecksum).digest("hex");

    const payload: BackupPayload = { ...payloadForChecksum, checksum };
    const encryptedPayload = encryptBackup(JSON.stringify(payload));
    const sizeBytes = Buffer.byteLength(encryptedPayload, "utf8");

    // Store to provider (durable) or keep in-memory (legacy)
    let storageRef: string | undefined;
    let resultEncryptedPayload: string | undefined;

    if (provider) {
      storageRef = await provider.store(organizationId, backupId, encryptedPayload);
    } else {
      resultEncryptedPayload = encryptedPayload;
      storageRef = `dev-in-memory:${backupId}`;
    }

    const completedAt = new Date();

    // Write backup record to org's backup log
    await platformDb.execute(sql.raw(`
      INSERT INTO "${s}".org_backup_log
        (id, backup_type, status, started_at, completed_at, size_bytes, checksum, storage_ref, metadata)
      VALUES (
        '${backupId}', 'logical', 'completed',
        '${startedAt.toISOString()}', '${completedAt.toISOString()}',
        ${sizeBytes}, '${checksum}',
        '${storageRef?.replace(/'/g, "''")}',
        '${JSON.stringify({ tables: tablesCaptured, recordCounts, provider: provider?.providerName ?? "in-memory" }).replace(/'/g, "''")}'
      )
    `)).catch(() => {});

    // Update registry
    await platformDb
      .update(orgDatabaseRegistryTable)
      .set({ lastBackupAt: completedAt, backupStatus: "completed", updatedAt: completedAt })
      .where(eq(orgDatabaseRegistryTable.organizationId, organizationId));

    // Platform audit event
    await platformDb.insert(platformAuditLogTable).values({
      id: randomUUID(), organizationId, actorUserId: null, actorType: "system",
      eventType: "platform.org_backup_completed", resourceType: "org_database", resourceId: s,
      metadata: { backupId, sizeBytes, tablesCaptured, recordCounts, storageRef },
    }).catch(() => {});

    return {
      backupId, organizationId, schemaName: s, status: "completed",
      sizeBytes, checksum, storageRef, encryptedPayload: resultEncryptedPayload,
      startedAt, completedAt, tablesCaptured, recordCounts,
    };

  } catch (err: any) {
    await platformDb
      .update(orgDatabaseRegistryTable)
      .set({ backupStatus: "failed", updatedAt: new Date() })
      .where(eq(orgDatabaseRegistryTable.organizationId, organizationId))
      .catch(() => {});

    return {
      backupId, organizationId, schemaName: s, status: "failed",
      sizeBytes: 0, checksum: "", startedAt, completedAt: new Date(),
      tablesCaptured, recordCounts, error: err?.message ?? "Backup failed",
    };
  }
}

// ─── Core: restoreOrgBackup ───────────────────────────────────────────────────

/**
 * Restores an organisation's operational schema from a backup.
 *
 * @param organizationId  - The org UUID to restore into
 * @param source          - Either an encrypted payload string (legacy) or a
 *                          storageRef string (when using a provider)
 * @param options.provider - Required when source is a storageRef
 *
 * ISOLATION GUARANTEE: Only affects the specified org's schema. Cannot read,
 * write, or affect any other organisation's data.
 *
 * @throws BackupError on ownership mismatch, checksum failure, or missing backup
 */
export async function restoreOrgBackup(
  organizationId: string,
  source: string,
  options: RestoreOptions = {},
): Promise<RestoreResult> {
  const [entry] = await platformDb
    .select()
    .from(orgDatabaseRegistryTable)
    .where(eq(orgDatabaseRegistryTable.organizationId, organizationId))
    .limit(1);

  if (!entry) throw new BackupError(`No registry entry for org ${organizationId}`);

  const s = entry.schemaName;

  // Retrieve encrypted payload (from storage or directly)
  let encryptedPayload: string;
  if (options.provider) {
    encryptedPayload = await options.provider.retrieve(organizationId, source);
  } else {
    encryptedPayload = source;
  }

  // Decrypt
  let payload: BackupPayload;
  try {
    payload = JSON.parse(decryptBackup(encryptedPayload)) as BackupPayload;
  } catch {
    throw new BackupError("Failed to decrypt backup payload — key may have changed or payload is corrupt");
  }

  // Cross-org ownership check
  if (payload.organizationId !== organizationId) {
    throw new BackupError(
      `Backup belongs to org ${payload.organizationId} but restore was requested for ${organizationId}. ` +
      "Cross-org restore is not permitted.",
    );
  }

  // Checksum verification
  const storedChecksum = payload.checksum;
  const payloadCopy: BackupPayload = { ...payload, checksum: "" };
  const actualChecksum = createHash("sha256").update(JSON.stringify(payloadCopy)).digest("hex");
  if (actualChecksum !== storedChecksum) {
    throw new BackupError("Backup checksum mismatch — payload may be corrupt or tampered");
  }

  const tablesRestored: string[] = [];
  const recordCounts: Record<string, number> = {};

  // Truncate in reverse FK order
  for (const tbl of RESTORE_ORDER) {
    await platformDb.execute(sql.raw(`TRUNCATE TABLE "${s}"."${tbl}" CASCADE`));
  }

  // Re-insert using json_populate_recordset (PostgreSQL handles all type casts)
  for (const tbl of [...RESTORE_ORDER].reverse()) {
    const rows: any[] = payload.tables[tbl] ?? [];
    if (rows.length > 0) {
      const rowsJson = JSON.stringify(rows).replace(/'/g, "''");
      await platformDb.execute(sql.raw(
        `INSERT INTO "${s}"."${tbl}"
         SELECT * FROM json_populate_recordset(null::"${s}"."${tbl}", '${rowsJson}')
         ON CONFLICT DO NOTHING`,
      ));
    }
    recordCounts[tbl] = rows.length;
    tablesRestored.push(tbl);
  }

  // Audit restore
  await platformDb.insert(platformAuditLogTable).values({
    id: randomUUID(), organizationId, actorUserId: null, actorType: "system",
    eventType: "platform.org_backup_restored", resourceType: "org_database", resourceId: s,
    metadata: { schemaName: s, tablesRestored, recordCounts },
  }).catch(() => {});

  return { backupId: payload.capturedAt, organizationId, schemaName: s, success: true, tablesRestored, recordCounts };
}

// ─── Backup status ────────────────────────────────────────────────────────────

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
    backupCount: 0,
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
