/**
 * NeedsOps AI+ Worker Service
 *
 * Sprint 0 shell — this service is the background processing backbone for the
 * NeedsOps AI+ platform. In future sprints it will handle:
 *
 *  - AI task orchestration via OpenClaw
 *  - Async AI workforce job processing
 *  - Document intelligence pipelines
 *  - Approval workflow state machines
 *  - Notification dispatch
 *  - Scheduled compliance checks
 *  - Audit log compaction
 *
 * For Sprint 0, this service starts, connects to the database, runs a health
 * loop, and shuts down gracefully.
 */

import pino from "pino";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { PLATFORM_NAME, PLATFORM_VERSION } from "@workspace/shared";

const logger = pino({
  transport:
    process.env.NODE_ENV !== "production"
      ? { target: "pino-pretty", options: { colorize: true } }
      : undefined,
});

// ─── Health loop ──────────────────────────────────────────────────────────────

let isRunning = true;
const HEALTH_INTERVAL_MS = 30_000;

async function checkDatabaseHealth(): Promise<boolean> {
  try {
    await db.execute(sql`SELECT 1`);
    return true;
  } catch (err) {
    logger.error({ err }, "Database health check failed");
    return false;
  }
}

async function healthLoop() {
  while (isRunning) {
    const dbOk = await checkDatabaseHealth();
    logger.info({ dbHealthy: dbOk }, "Worker health check");
    await new Promise((resolve) => setTimeout(resolve, HEALTH_INTERVAL_MS));
  }
}

// ─── Graceful shutdown ────────────────────────────────────────────────────────

async function shutdown(signal: string) {
  logger.info({ signal }, "Shutdown signal received — stopping worker");
  isRunning = false;
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// ─── Bootstrap ────────────────────────────────────────────────────────────────

async function main() {
  logger.info({ platform: PLATFORM_NAME, version: PLATFORM_VERSION }, "Worker service starting");

  const dbOk = await checkDatabaseHealth();
  if (!dbOk) {
    logger.error("Cannot connect to database — aborting startup");
    process.exit(1);
  }

  logger.info("Worker service ready — entering health loop");
  await healthLoop();
}

main().catch((err) => {
  logger.error({ err }, "Unhandled error in worker — shutting down");
  process.exit(1);
});
