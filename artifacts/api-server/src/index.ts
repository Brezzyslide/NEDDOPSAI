import app from "./app";
import { logger } from "./lib/logger";
import { drainAllPools, startPoolReaper } from "@workspace/org-db";
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
  // 1. Verify RLS policies before accepting any traffic
  //    Throws RLSVerificationError (exits with code 1) if policies are missing.
  //    This prevents silent RLS removal from going undetected after drizzle push.
  try {
    await runRLSStartupCheck();
  } catch (err: any) {
    if (err.name === "RLSVerificationError") {
      logger.error(
        { missingRLS: err.missingRLS, missingPolicies: err.missingPolicies },
        "[FATAL] RLS startup check failed. Run lib/db/migrations/sprint7-platform-boundary.sql to restore policies. Server will not start.",
      );
      process.exit(1);
    }
    // Non-RLS errors (e.g. DB unreachable at startup) — log but continue
    // to allow the app to start and surface errors through health checks
    logger.warn({ err }, "[startup] RLS check encountered an error — continuing (DB may not be ready yet)");
  }

  // 2. Start idle pool reaper for org connection pools
  startPoolReaper();
  logger.info("[startup] Organisation connection pool reaper started");

  // 3. Start listening
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

    // Stop accepting new requests
    server.close(async () => {
      try {
        // Drain all organisation connection pools
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
