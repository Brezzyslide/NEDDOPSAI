/**
 * NeedsOps Runtime Broker — Express Application Factory
 *
 * Creates and configures the Express app used by the Runtime Broker HTTP server.
 * Separated from index.ts so it can be imported by tests without starting a
 * live process.
 */

import express, { type Express, type Request, type Response } from "express";
import type { BrokerConfig } from "./types.js";
import type { ExecutionStore } from "./store.js";
import type { IGatewayAdapter } from "./gatewayAdapter.js";
import type { WebhookDeliveryWorker } from "./webhookDelivery.js";
import { createAuthMiddleware } from "./auth.js";
import { createHealthRouter } from "./routes/health.js";
import { createExecutionRouter } from "./routes/executions.js";
import type pino from "pino";

export function createBrokerApp(
  config: BrokerConfig,
  store: ExecutionStore,
  gateway: IGatewayAdapter,
  webhookWorker: WebhookDeliveryWorker,
  logger: pino.Logger,
): Express {
  const app = express();

  // ─── Request body parsing ────────────────────────────────────────────────────
  // Hard limit on body size to prevent abuse
  app.use(express.json({ limit: config.maxBodyBytes }));

  // ─── Request logging ─────────────────────────────────────────────────────────
  app.use((req: Request, _res: Response, next) => {
    logger.debug(
      { method: req.method, path: req.path, ip: req.ip },
      "[broker] Incoming request",
    );
    next();
  });

  // ─── Unauthenticated routes ──────────────────────────────────────────────────
  // Health check is intentionally unauthenticated for tunnel probes
  app.use("/v1", createHealthRouter(config, store, gateway));

  // ─── Authenticated routes ────────────────────────────────────────────────────
  const auth = createAuthMiddleware(config.authToken);
  app.use("/v1", auth, createExecutionRouter(config, store, gateway, webhookWorker, logger));

  // ─── 404 fallthrough ─────────────────────────────────────────────────────────
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Route not found" } });
  });

  // ─── Global error handler ────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: Error, _req: Request, res: Response, _next: unknown) => {
    logger.error({ err: err.message, stack: err.stack }, "[broker] Unhandled error");
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
  });

  return app;
}
