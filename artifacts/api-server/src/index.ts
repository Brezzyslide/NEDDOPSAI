import app from "./app";
import { logger } from "./lib/logger";
import { drainAllPools, startPoolReaper } from "@workspace/org-db";
import { startBackupScheduler, stopBackupScheduler, FilesystemBackupProvider } from "@workspace/org-db";
import { runRLSStartupCheck } from "./startup/rlsStartupCheck";

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

  // 3. Start backup scheduler
  //    Uses FilesystemBackupProvider for dev; swap for GCS/S3 in production.
  startBackupScheduler({
    provider: new FilesystemBackupProvider(),
    intervalMs: 5 * 60 * 1000, // 5 minutes
  });

  // 4. Start listening
  const server = app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }
    logger.info({ port }, "Server listening");
  });

  // ── Graceful shutdown ───────────────────────────────────────────────────────

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Shutdown signal received — draining connections");

    // Stop backup scheduler
    stopBackupScheduler();

    // Stop accepting new requests
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

    // Force exit if graceful shutdown takes too long
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
