/**
 * NeedsOps AI+ Worker Service — Sprint 10
 *
 * Real polling worker that processes the specialist run queue.
 * Replaces the Sprint 0 health loop shell.
 *
 * Responsibilities:
 *  - Poll the specialist queue for available work
 *  - Claim and execute specialist runs via the orchestrator
 *  - Handle retries and failures with backoff
 *  - Release expired leases for other workers
 *  - Graceful shutdown on SIGTERM/SIGINT
 */

import { randomUUID } from "crypto";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import {
  claimNext,
  markRunning,
  markCompleted,
  markFailed,
  releaseExpiredLeases,
} from "../../api-server/src/services/specialistQueueService.js";
import { executeSpecialistStep } from "../../api-server/src/services/chiefOfStaffOrchestrator.js";

// ─── Config ───────────────────────────────────────────────────────────────────

const WORKER_INSTANCE_ID = randomUUID();
const POLL_INTERVAL_MS = parseInt(process.env.WORKER_POLL_MS ?? "5000", 10);
const MAX_RETRIES = 3;

let itemsProcessed = 0;

// ─── Poll all organizations ───────────────────────────────────────────────────

/**
 * Fetch all active organization IDs to poll across all tenants.
 * The worker is not tenant-scoped — it processes all available work.
 */
async function getActiveOrganizationIds(): Promise<string[]> {
  const rows = await db.execute(
    sql`SELECT DISTINCT organization_id FROM specialist_queue WHERE status IN ('waiting', 'retrying') LIMIT 100`,
  );
  return (rows.rows as Array<{ organization_id: string }>).map(r => r.organization_id);
}

// ─── Core work loop ───────────────────────────────────────────────────────────

/**
 * Attempts to claim and process one queue item from any available organization.
 */
async function processNextItem(): Promise<void> {
  // Get organizations with pending work
  const orgIds = await getActiveOrganizationIds();
  if (orgIds.length === 0) return;

  // Try each org until we find something to process
  for (const organizationId of orgIds) {
    const item = await claimNext(organizationId, WORKER_INSTANCE_ID);
    if (!item) continue;

    console.log("[worker] Claimed queue item", {
      itemId: item.id,
      specialistRunId: item.specialistRunId,
      organizationId: item.organizationId,
      attempt: item.attempts,
    });

    // Mark queue entry as running
    await markRunning(item.specialistRunId, item.organizationId);

    try {
      // Execute the specialist step (orchestrator handles context, AI, result saving)
      const result = await executeSpecialistStep(item.specialistRunId, item.organizationId);

      // Mark queue entry as completed
      await markCompleted(item.specialistRunId, item.organizationId);

      itemsProcessed++;
      console.log("[worker] Completed queue item", {
        itemId: item.id,
        specialistRunId: item.specialistRunId,
        workforceRoleCode: result.workforceRoleCode,
        confidence: result.confidence,
        itemsProcessed,
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const canRetry = item.attempts < MAX_RETRIES;

      console.error("[worker] Failed to process queue item", {
        itemId: item.id,
        specialistRunId: item.specialistRunId,
        attempt: item.attempts,
        canRetry,
        error: errorMessage,
      });

      if (canRetry) {
        // Exponential backoff: 30s, 60s, 120s
        const retryAfterSeconds = 30 * Math.pow(2, item.attempts - 1);
        await markFailed(item.specialistRunId, item.organizationId, errorMessage, retryAfterSeconds);
      } else {
        await markFailed(item.specialistRunId, item.organizationId, errorMessage);
      }
    }

    // Only process one item per poll cycle to avoid overloading
    return;
  }
}

// ─── Main poll loop ───────────────────────────────────────────────────────────

let shuttingDown = false;

const pollTimer = setInterval(async () => {
  if (shuttingDown) return;
  try {
    await processNextItem();
    await releaseExpiredLeases();
  } catch (err) {
    console.error("[worker] Unexpected error in poll cycle:", err);
  }
}, POLL_INTERVAL_MS);

// ─── Heartbeat ────────────────────────────────────────────────────────────────

setInterval(() => {
  console.log("[worker] Heartbeat", {
    instanceId: WORKER_INSTANCE_ID,
    itemsProcessed,
    timestamp: new Date().toISOString(),
  });
}, 60_000);

// ─── Graceful shutdown ────────────────────────────────────────────────────────

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("[worker] Shutting down on", signal);
  clearInterval(pollTimer);
  // Give in-flight work a moment to finish
  await new Promise(resolve => setTimeout(resolve, 1000));
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// ─── Bootstrap ────────────────────────────────────────────────────────────────

async function main() {
  // Verify database connectivity
  try {
    await db.execute(sql`SELECT 1`);
    console.log("[worker] Database connection verified");
  } catch (err) {
    console.error("[worker] Cannot connect to database — aborting startup", err);
    process.exit(1);
  }

  console.log("[worker] NeedsOps Queue Worker started", {
    instanceId: WORKER_INSTANCE_ID,
    pollIntervalMs: POLL_INTERVAL_MS,
  });
}

main().catch(err => {
  console.error("[worker] Fatal startup error:", err);
  process.exit(1);
});
