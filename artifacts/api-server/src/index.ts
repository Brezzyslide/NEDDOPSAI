import { createServer } from "http";
import { WebSocketServer } from "ws";
import app from "./app";
import { logger } from "./lib/logger";
import { drainAllPools, startPoolReaper } from "@workspace/org-db";
import {
  startBackupScheduler, stopBackupScheduler,
  FilesystemBackupProvider, ObjectStorageBackupProvider,
  type BackupStorageProvider,
} from "@workspace/org-db";
import { runRLSStartupCheck } from "./startup/rlsStartupCheck";
import { attachRelayService } from "./services/deviceRelayService.js";
import {
  startInProcessWorker,
  stopInProcessWorker,
} from "./workers/knowledgeIngestionWorker.js";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// ── Startup sequence ──────────────────────────────────────────────────────────

async function start(): Promise<void> {
  // 1. Verify RLS policies and legacy write restrictions before accepting traffic.
  //    Throws RLSVerificationError or LegacyWriteError (exits with code 1).
  try {
    await runRLSStartupCheck();
  } catch (err: any) {
    if (err.name === "RLSVerificationError" || err.name === "LegacyWriteError") {
      logger.error(
        { errName: err.name, details: err.writeableTables ?? err.missingRLS },
        "[FATAL] Startup security check failed. Run the required migrations. Server will not start.",
      );
      process.exit(1);
    }
    // Non-security errors (e.g. DB unreachable at startup) — log but continue
    logger.warn({ err }, "[startup] Startup check encountered an error — continuing (DB may not be ready yet)");
  }

  // 2. Start idle pool reaper for org connection pools
  startPoolReaper();
  logger.info("[startup] Organisation connection pool reaper started");

  // 3. Start backup scheduler.
  let backupProvider: BackupStorageProvider;
  if (process.env["DEFAULT_OBJECT_STORAGE_BUCKET_ID"]) {
    backupProvider = new ObjectStorageBackupProvider();
    logger.info("[startup] Backup provider: Replit Object Storage (GCS)");
  } else {
    backupProvider = new FilesystemBackupProvider();
    logger.info("[startup] Backup provider: filesystem (.backup-store/) — set DEFAULT_OBJECT_STORAGE_BUCKET_ID for durable storage");
  }

  startBackupScheduler({
    provider: backupProvider,
    intervalMs: 5 * 60 * 1000,
  });

  // 4. Start in-process knowledge ingestion worker (default for Replit/local dev)
  //    Set KNOWLEDGE_WORKER_MODE=external to disable (use a separate worker process instead).
  const workerMode = (process.env.KNOWLEDGE_WORKER_MODE ?? "in-process").toLowerCase();
  if (workerMode === "in-process") {
    startInProcessWorker();
    logger.info("[startup] Knowledge ingestion worker started (in-process)");
  } else {
    logger.info(`[startup] Knowledge ingestion worker mode="${workerMode}" — not starting in-process`);
  }

  // 4b. Seed built-in Work Blueprints (idempotent — safe to run on every startup)
  try {
    const { seedBuiltInBlueprints, seedRegistryBlueprints, seedSyntheticCarePlanArchTest } = await import("./services/workBlueprintService.js");
    await seedBuiltInBlueprints();
    logger.info("[startup] Built-in Work Blueprints seeded");
    await seedRegistryBlueprints();
    logger.info("[startup] Production Blueprint Registry seeded");
    logger.info("[startup] Built-in Work Blueprints seeded");
    await seedSyntheticCarePlanArchTest();
    logger.info("[startup] Synthetic Care Plan architecture test blueprint seeded");
  } catch (err) {
    logger.warn({ err }, "[startup] Built-in Work Blueprints seeding failed — continuing");
  }

  // 4c. Seed specialist catalogue from registry (idempotent — safe to run on every startup)
  try {
    const { seedCatalogueFromRegistry } = await import("./services/specialistCatalogueService.js");
    const { inserted, updated } = await seedCatalogueFromRegistry();
    logger.info({ inserted, updated }, "[startup] Specialist catalogue seeded");
  } catch (err) {
    logger.warn({ err }, "[startup] Specialist catalogue seeding failed — continuing");
  }

  // 4d. Recover stuck execution checkpoints (Sprint 27.2).
  //     Any checkpoint left in 'resuming' state by a crashed server process is
  //     returned to 'awaiting_clarification' so the user can reply again.
  try {
    const { recoverStuckResumes, expireStaleCheckpoints } = await import("./services/executionCheckpointService.js");
    const stuck = await recoverStuckResumes();
    const expired = await expireStaleCheckpoints();
    if (stuck > 0 || expired > 0) {
      logger.info({ stuck, expired }, "[startup] Execution checkpoint recovery complete");
    }
  } catch (err) {
    logger.warn({ err }, "[startup] Checkpoint recovery failed — continuing");
  }

  // 5. Create HTTP server (wraps Express app so WS can share the same port)
  const server = createServer(app);

  // 5. Attach WebSocket relay server
  //    Path-restricted to /v1/devices/relay — all other WS upgrade requests are rejected
  const wss = new WebSocketServer({
    server,
    path: "/v1/devices/relay",
    maxPayload: 512 * 1024, // 512 KB — matches relayProtocol.ts MAX_MESSAGE_SIZE
    clientTracking: true,
  });

  attachRelayService(wss);
  logger.info("[startup] WebSocket relay server attached at /v1/devices/relay");

  // 6. Start listening
  server.listen(port, () => {
    logger.info({ port }, "Server listening (HTTP + WS relay)");
  });

  server.on("error", (err) => {
    logger.error({ err }, "Error starting server");
    process.exit(1);
  });

  // ── Graceful shutdown ───────────────────────────────────────────────────────

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Shutdown signal received — draining connections");

    // Stop knowledge ingestion worker
    await stopInProcessWorker().catch(() => {});

    // Stop backup scheduler
    stopBackupScheduler();

    // Close WS relay — all device connections will be terminated
    await new Promise<void>((resolve) => {
      wss.close(() => resolve());
    });

    // Stop accepting new HTTP requests
    server.close(async () => {
      try {
        await drainAllPools();
        logger.info("All organisation connection pools drained");
      } catch (err) {
        logger.error({ err }, "Error during pool drain");
      }
      logger.info("Server shutdown complete");
      process.exit(0);
    });

    setTimeout(() => {
      logger.error("Shutdown timeout — forcing exit");
      process.exit(1);
    }, 15_000).unref();
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT",  () => shutdown("SIGINT"));
}

start().catch((err) => {
  logger.error({ err }, "Fatal startup error");
  process.exit(1);
});
