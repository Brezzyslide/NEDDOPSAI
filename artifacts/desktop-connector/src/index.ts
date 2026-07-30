/**
 * NeedsOps AI+ Desktop Connector — Runtime Broker
 *
 * This service runs on your Mac and bridges the NeedsOps AI+ platform
 * (hosted in Replit) to the OpenClaw execution gateway running locally.
 *
 * Architecture:
 *
 *   Replit NeedsOps API (OPENCLAW_RUNTIME_URL → tunnel URL)
 *         ↓  HTTPS (Cloudflare Tunnel or ngrok)
 *   Runtime Broker HTTP server (127.0.0.1:BROKER_PORT)
 *         ↓  IGatewayAdapter
 *   OpenClaw Gateway (127.0.0.1:19001) — Phase 4
 *         ↓
 *   Browser automation
 *
 * What this service provides:
 *   - GET  /v1/health
 *   - POST /v1/executions
 *   - GET  /v1/executions/:id?tenantId=...
 *   - POST /v1/executions/:id/cancel
 *   - POST /v1/executions/:id/pause
 *   - POST /v1/executions/:id/resume
 *
 * Required environment variables (see .env.example):
 *   BROKER_PORT              HTTP port (default: 19002)
 *   BROKER_AUTH_TOKEN        Bearer token NeedsOps must send
 *   OPENCLAW_WEBHOOK_SECRET  HMAC-SHA256 secret for signing webhook events
 *   OPENCLAW_GATEWAY_MODE    "simulated" (default) or "live" (Phase 4)
 *
 * Startup:
 *   node artifacts/desktop-connector/dist/index.mjs
 */

import http from "node:http";
import os from "node:os";
import path from "node:path";
import { mkdirSync } from "node:fs";
import pino from "pino";
import { loadBrokerConfig } from "./broker/types.js";
import { ExecutionStore } from "./broker/store.js";
import { createGatewayAdapter, SimulatedGatewayAdapter } from "./broker/gatewayAdapter.js";
import { WebhookDeliveryWorker } from "./broker/webhookDelivery.js";
import { createBrokerApp } from "./broker/server.js";
import { RelayClient } from "./broker/relayClient.js";

// ─── Logger ───────────────────────────────────────────────────────────────────

const logger = pino({
  transport:
    process.env.NODE_ENV !== "production"
      ? { target: "pino-pretty", options: { colorize: true } }
      : undefined,
});

// ─── Startup ──────────────────────────────────────────────────────────────────

async function main() {
  logger.info("NeedsOps Runtime Broker starting");

  // 1. Load configuration (throws on missing required vars)
  const config = loadBrokerConfig();

  // 2. Ensure DB directory exists
  const dbDir = path.dirname(config.dbPath);
  try {
    mkdirSync(dbDir, { recursive: true });
  } catch {
    // Directory may already exist
  }

  logger.info(
    {
      port: config.port,
      gatewayMode: config.gatewayMode,
      dbPath: config.dbPath,
    },
    "Broker configuration loaded",
  );

  // 3. Open SQLite store
  const store = new ExecutionStore(config.dbPath);
  logger.info({ dbPath: config.dbPath }, "SQLite execution store opened");

  // 4. Create webhook delivery worker
  const webhookWorker = new WebhookDeliveryWorker(
    store,
    config.webhookSecret,
    config.webhookRetryAttempts,
    config.webhookRetryBaseMs,
    config.webhookWorkerIntervalMs,
    logger,
    config.brokerVersion,
  );

  // 5. Create gateway adapter
  //    onStatusChange: called by the adapter whenever an execution changes state.
  //    Persists the new status and queues a webhook event.
  function onStatusChange(
    executionId: string,
    status: import("./broker/types.js").BrokerExecutionStatus,
    extra?: { startedAt?: string; completedAt?: string; errorMessage?: string },
  ) {
    try {
      store.updateStatus(executionId, status, extra);
      const exec = store.getExecution(executionId);
      if (exec) {
        webhookWorker.queueEvent(exec, status, extra);
        logger.info({ executionId, status }, "[broker] Execution status changed");
      }
    } catch (err) {
      logger.error({ executionId, status, err: (err as Error).message }, "[broker] Failed to persist status change");
    }
  }

  const gateway = createGatewayAdapter(
    config.gatewayMode,
    {
      gatewayUrl:      config.gatewayUrl,
      liveMode:        config.liveMode,
      openclawBin:     config.openclawBin,
      gatewayTimeoutMs: config.gatewayTimeoutMs,
    },
    onStatusChange,
  );
  logger.info({ adapter: gateway.name, liveMode: config.liveMode }, "Gateway adapter created");

  // 6. Verify gateway health before accepting traffic
  const gwHealth = await gateway.healthCheck().catch(() => ({ ok: false, version: "unknown" }));
  if (gwHealth.ok) {
    logger.info({ version: gwHealth.version }, "Gateway health check passed");
  } else {
    logger.warn({ detail: (gwHealth as { detail?: string }).detail }, "Gateway health check failed — broker will still start but executions may fail");
  }

  // 7. Build and start the HTTP server
  const app = createBrokerApp(config, store, gateway, webhookWorker, logger);
  const server = http.createServer(app);

  await new Promise<void>((resolve, reject) => {
    server.listen(config.port, "127.0.0.1", () => resolve());
    server.once("error", reject);
  });

  logger.info(
    {
      address: `http://127.0.0.1:${config.port}`,
      gatewayMode: config.gatewayMode,
    },
    `Runtime Broker listening — expose with: cloudflared tunnel --url http://127.0.0.1:${config.port}`,
  );

  // 8. Start background workers
  webhookWorker.start();

  // 9. Stale execution cleanup
  const staleCleanupTimer = setInterval(() => {
    try {
      const expired = store.expireStaleExecutions();
      if (expired > 0) {
        logger.info({ expired }, "[stale-cleanup] Marked stale executions as timed_out");
      }
    } catch (err) {
      logger.error({ err: (err as Error).message }, "[stale-cleanup] Error during stale cleanup");
    }
  }, config.staleCleanupIntervalMs);

  // 10. Graceful shutdown
  let shuttingDown = false;

  async function shutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info({ signal }, "Shutdown signal received — stopping gracefully");

    clearInterval(staleCleanupTimer);
    webhookWorker.stop();

    // Both SimulatedGatewayAdapter and LiveGatewayAdapter expose destroy()
    if ("destroy" in gateway && typeof (gateway as { destroy(): void }).destroy === "function") {
      (gateway as { destroy(): void }).destroy();
    }

    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();

    logger.info("Runtime Broker stopped cleanly");
    process.exit(0);
  }

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT",  () => void shutdown("SIGINT"));

  process.on("uncaughtException", (err) => {
    logger.error({ err: err.message, stack: err.stack }, "Uncaught exception — broker remains running");
  });

  process.on("unhandledRejection", (reason) => {
    logger.error({ reason: String(reason) }, "Unhandled rejection — broker remains running");
  });

  // 11. Start outbound WebSocket relay client (Sprint 15)
  //     Connects to the NeedsOps platform relay instead of relying on a Cloudflare tunnel.
  //     Only started when NEEDSOPS_DEVICE_ID and NEEDSOPS_API_BASE_URL are set
  //     (i.e. the broker has been activated).
  let relayClient: import("./broker/relayClient.js").RelayClient | null = null;

  const deviceId = process.env["NEEDSOPS_DEVICE_ID"];
  const apiBaseUrl = process.env["NEEDSOPS_API_BASE_URL"];
  const deviceToken = process.env["NEEDSOPS_DEVICE_TOKEN"];

  if (deviceId && apiBaseUrl && deviceToken) {
    // getAccessToken: returns the legacy long-lived token from env for now.
    // In a full Sprint 15 client implementation, this would exchange a refresh token
    // via POST /v1/devices/auth/refresh and cache the short-lived access token.
    const getAccessToken = async (): Promise<string> => {
      return deviceToken;
    };

    const { RelayClient } = await import("./broker/relayClient.js");
    relayClient = new RelayClient({
      apiBaseUrl,
      deviceId,
      organizationId: process.env["NEEDSOPS_ORG_SLUG"] ?? "",
      appVersion: config.brokerVersion,
      osPlatform: process.platform,
      arch: process.arch,
      getAccessToken,
      onTaskDispatch: async (payload) => {
        const executionId = String(payload["executionId"] ?? "");
        logger.info({ executionId }, "[relay] Task dispatched — executing");
        // Execution is handled by the gateway adapter (existing logic)
        // For now, emit a safe test result
        relayClient?.sendTaskResult({ executionId, result: { status: "delegated" } });
      },
      onRevoked: () => {
        logger.warn("[relay] Device has been revoked — shutting down broker");
        void shutdown("DEVICE_REVOKED");
      },
      onStateChange: (state) => {
        logger.info({ state }, "[relay] Connection state changed");
        // Broadcast to Electron main process if running in embedded mode
        if (process.send) {
          process.send({ type: "relay:state", state });
        }
      },
      logger,
    });

    relayClient.start().catch((err: Error) => {
      logger.error({ err: err.message }, "[relay] Relay client start failed");
    });

    logger.info({ apiBaseUrl, deviceId }, "[relay] Outbound WebSocket relay client started");
  } else {
    logger.info("[relay] Outbound relay not started — NEEDSOPS_DEVICE_ID or NEEDSOPS_API_BASE_URL not set");
    logger.info("[relay] Set DESKTOP_TRANSPORT=cloudflare-dev for development tunnel mode");
  }

  logger.info(`Runtime Broker ready. Host network: ${os.hostname()}`);

  // Extend shutdown to also stop relay client
  const originalShutdown = shutdown;
  const extendedShutdown = async (signal: string) => {
    if (relayClient) {
      logger.info("[relay] Stopping relay client");
      relayClient.destroy();
    }
    return originalShutdown(signal);
  };

  // Re-register signal handlers with extended shutdown
  process.removeAllListeners("SIGTERM");
  process.removeAllListeners("SIGINT");
  process.on("SIGTERM", () => void extendedShutdown("SIGTERM"));
  process.on("SIGINT",  () => void extendedShutdown("SIGINT"));
}

main().catch((err: Error) => {
  // Use console.error here — logger may not be initialised yet
  console.error("Fatal error starting Runtime Broker:", err.message);
  if (process.env.NODE_ENV !== "production") console.error(err.stack);
  process.exit(1);
});
