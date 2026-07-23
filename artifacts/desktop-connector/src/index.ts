/**
 * NeedsOps AI+ Desktop Connector
 *
 * Sprint 0 shell — this service will bridge the NeedsOps AI+ platform with
 * secure local desktop and computer access. In future sprints it will provide:
 *
 *  - Secure WebSocket tunnel to the NeedsOps AI+ API
 *  - Local file system access for document processing
 *  - Local application automation (browser, desktop apps)
 *  - Printer and scanner integration
 *  - Local credential vault (encrypted)
 *  - Certificate-based mutual TLS authentication
 *  - Zero-trust network access model
 *
 * For Sprint 0, this shell establishes the process skeleton and configuration
 * model.
 */

import pino from "pino";
import { PLATFORM_NAME, PLATFORM_VERSION } from "@workspace/shared";

const logger = pino({
  transport:
    process.env.NODE_ENV !== "production"
      ? { target: "pino-pretty", options: { colorize: true } }
      : undefined,
});

// ─── Configuration ────────────────────────────────────────────────────────────

const config = {
  platformUrl: process.env.NEEDSOPS_PLATFORM_URL ?? "http://localhost:5001",
  connectorId: process.env.NEEDSOPS_CONNECTOR_ID ?? "local-dev",
  heartbeatIntervalMs: 30_000,
};

// ─── Graceful shutdown ────────────────────────────────────────────────────────

let running = true;

async function shutdown(signal: string) {
  logger.info({ signal }, "Shutdown signal received — disconnecting");
  running = false;
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// ─── Heartbeat loop ───────────────────────────────────────────────────────────

async function heartbeatLoop() {
  while (running) {
    logger.debug({ connectorId: config.connectorId }, "Heartbeat");
    await new Promise((resolve) => setTimeout(resolve, config.heartbeatIntervalMs));
  }
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

async function main() {
  logger.info(
    { platform: PLATFORM_NAME, version: PLATFORM_VERSION, connectorId: config.connectorId },
    "Desktop Connector starting"
  );

  logger.info(
    { platformUrl: config.platformUrl },
    "Desktop Connector ready — Sprint 0 shell mode (no active connection)"
  );

  await heartbeatLoop();
}

main().catch((err) => {
  logger.error({ err }, "Unhandled error in Desktop Connector — shutting down");
  process.exit(1);
});
