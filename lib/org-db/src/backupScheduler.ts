/**
 * Backup Scheduler — Sprint 7.1
 *
 * Processes due backups for all active organisations. Runs on server startup
 * and at a configurable interval.
 *
 * Design:
 *   • Queries org_database_registry for orgs where next_backup_at <= NOW()
 *     and status = 'active'
 *   • Uses PostgreSQL advisory locks (pg_try_advisory_lock) per org to prevent
 *     duplicate backups across server instances or restart races
 *   • Idempotent: same backup window cannot be processed twice
 *   • Rate-limited: max CONCURRENT_BACKUP_LIMIT orgs backed up per cycle
 *   • Failures update backup_status = 'failed' in registry — do not crash server
 *
 * Advisory lock:
 *   Lock key = hashCode(orgId) as BIGINT.
 *   pg_try_advisory_lock returns false if another session holds the lock.
 *   The lock is released automatically when the session ends (connection returns
 *   to pool). This prevents duplicate concurrent backups for the same org.
 *
 * Scheduling:
 *   next_backup_at is set to NOW() + backup_config.intervalHours on completion.
 *   The scheduler runs every SCHEDULER_INTERVAL_MS milliseconds.
 */

import { sql, eq, lte, and } from "drizzle-orm";
import { db as platformDb, orgDatabaseRegistryTable } from "@workspace/db";
import { createOrgBackup } from "./orgBackupService";
import { type BackupStorageProvider, getDefaultBackupStorageProvider } from "./backupStorage";

// ─── Configuration ────────────────────────────────────────────────────────────

const SCHEDULER_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const CONCURRENT_BACKUP_LIMIT = 3; // max orgs backed up per cycle
const DEFAULT_BACKUP_INTERVAL_HOURS = 24;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BackupSchedulerOptions {
  provider?: BackupStorageProvider;
  intervalMs?: number;
  concurrentLimit?: number;
}

export interface SchedulerRun {
  runAt: Date;
  orgsProcessed: number;
  orgsSucceeded: number;
  orgsFailed: number;
  orgIds: string[];
}

// ─── Advisory lock helper ─────────────────────────────────────────────────────

/**
 * Converts an org UUID to a stable BIGINT advisory lock key.
 * Uses a simple djb2-style hash of the first 12 hex chars.
 */
function orgLockKey(organizationId: string): bigint {
  const hex = organizationId.replace(/-/g, "").slice(0, 12);
  return BigInt("0x" + hex) & BigInt("0x7FFFFFFFFFFFFFFF"); // keep positive
}

// ─── Core scheduler function ──────────────────────────────────────────────────

/**
 * Processes all due backups in one scheduler cycle.
 * Returns a run report for monitoring/logging.
 */
export async function processDueBackups(options: BackupSchedulerOptions = {}): Promise<SchedulerRun> {
  const provider = options.provider ?? getDefaultBackupStorageProvider();
  const limit = options.concurrentLimit ?? CONCURRENT_BACKUP_LIMIT;
  const runAt = new Date();

  // Find orgs due for backup
  const dueOrgs = await platformDb
    .select({
      organizationId: orgDatabaseRegistryTable.organizationId,
      backupConfig: orgDatabaseRegistryTable.backupConfig,
    })
    .from(orgDatabaseRegistryTable)
    .where(
      and(
        eq(orgDatabaseRegistryTable.status, "active"),
        lte(orgDatabaseRegistryTable.nextBackupAt, runAt),
      ),
    )
    .limit(limit);

  if (dueOrgs.length === 0) {
    return { runAt, orgsProcessed: 0, orgsSucceeded: 0, orgsFailed: 0, orgIds: [] };
  }

  let succeeded = 0;
  let failed = 0;
  const processed: string[] = [];

  // Process each org — try advisory lock first
  for (const { organizationId, backupConfig } of dueOrgs) {
    const lockKey = orgLockKey(organizationId);

    try {
      // Try to acquire advisory lock — skip if another instance is processing
      const lockResult = await platformDb.execute(
        sql`SELECT pg_try_advisory_lock(${lockKey}::BIGINT) AS acquired`,
      );
      const acquired = (lockResult.rows[0] as any)?.acquired;

      if (!acquired) {
        // Another instance is already backing up this org — skip safely
        continue;
      }

      processed.push(organizationId);

      // Run the backup
      const config = (backupConfig as Record<string, unknown>) ?? {};
      const result = await createOrgBackup(organizationId, provider);

      if (result.status === "completed") {
        // Update registry: last_backup_at, backup_status, next_backup_at
        const intervalHours = (config["intervalHours"] as number) ?? DEFAULT_BACKUP_INTERVAL_HOURS;
        const nextBackupAt = new Date(Date.now() + intervalHours * 60 * 60 * 1000);

        await platformDb
          .update(orgDatabaseRegistryTable)
          .set({
            lastBackupAt: result.completedAt,
            backupStatus: "completed",
            nextBackupAt,
            updatedAt: new Date(),
          })
          .where(eq(orgDatabaseRegistryTable.organizationId, organizationId));

        succeeded++;
      } else {
        await platformDb
          .update(orgDatabaseRegistryTable)
          .set({ backupStatus: "failed", updatedAt: new Date() })
          .where(eq(orgDatabaseRegistryTable.organizationId, organizationId));
        failed++;
      }
    } catch (err: any) {
      // Backup failure must not crash the scheduler
      console.error(`[BackupScheduler] Backup failed for org ${organizationId}:`, err?.message ?? err);

      await platformDb
        .update(orgDatabaseRegistryTable)
        .set({ backupStatus: "failed", updatedAt: new Date() })
        .where(eq(orgDatabaseRegistryTable.organizationId, organizationId))
        .catch(() => {/* best-effort registry update */});

      failed++;
    } finally {
      // Release advisory lock
      await platformDb
        .execute(sql`SELECT pg_advisory_unlock(${lockKey}::BIGINT)`)
        .catch(() => {/* non-fatal */});
    }
  }

  return {
    runAt,
    orgsProcessed: processed.length,
    orgsSucceeded: succeeded,
    orgsFailed: failed,
    orgIds: processed,
  };
}

// ─── Scheduler lifecycle ──────────────────────────────────────────────────────

let _schedulerHandle: ReturnType<typeof setInterval> | null = null;

/**
 * Starts the backup scheduler.
 *
 * Runs one cycle immediately on start (to catch any backups that fell due
 * during a server restart), then repeats at intervalMs.
 *
 * Safe to call multiple times — only one scheduler runs at a time.
 */
export function startBackupScheduler(options: BackupSchedulerOptions = {}): void {
  if (_schedulerHandle) return; // already running

  const intervalMs = options.intervalMs ?? SCHEDULER_INTERVAL_MS;

  // Run immediately on startup (async — don't block server start)
  processDueBackups(options).then(run => {
    if (run.orgsProcessed > 0) {
      console.log(
        `[BackupScheduler] Startup run: ${run.orgsSucceeded}/${run.orgsProcessed} orgs backed up`,
      );
    }
  }).catch(err => {
    console.error("[BackupScheduler] Startup run failed:", err?.message ?? err);
  });

  // Recurring runs
  _schedulerHandle = setInterval(async () => {
    try {
      const run = await processDueBackups(options);
      if (run.orgsProcessed > 0) {
        console.log(
          `[BackupScheduler] Cycle: ${run.orgsSucceeded}/${run.orgsProcessed} orgs backed up, ` +
          `${run.orgsFailed} failed`,
        );
      }
    } catch (err: any) {
      console.error("[BackupScheduler] Cycle error:", err?.message ?? err);
    }
  }, intervalMs);

  // Allow Node.js to exit even if scheduler is still pending
  if (_schedulerHandle.unref) _schedulerHandle.unref();

  console.log(`[BackupScheduler] Started (interval: ${intervalMs / 1000}s)`);
}

/**
 * Stops the backup scheduler.
 */
export function stopBackupScheduler(): void {
  if (_schedulerHandle) {
    clearInterval(_schedulerHandle);
    _schedulerHandle = null;
  }
}
