/**
 * Runtime Events webhook — POST /v1/runtime/events
 *
 * Sprint 8: OpenClaw Runtime Integration
 *
 * This is the single inbound endpoint where the OpenClaw Runtime Broker
 * POSTs execution events back to NeedsOps.
 *
 * Security:
 *   - HMAC-SHA256 signature verified against OPENCLAW_WEBHOOK_SECRET
 *   - Tenant boundary verified against execution session record
 *   - Unknown execution IDs are rejected immediately
 *   - Rejected events are logged but do not crash the server
 *
 * The raw request body must be preserved for HMAC verification.
 * Express's json() parser must NOT be applied before this route.
 */

import { Router, type Request, type Response } from "express";
import { OpenClawExecutionEngine, loadOpenClawConfig } from "@workspace/openclaw";
import type { OpenClawWebhookEvent } from "@workspace/openclaw";
import { logger } from "../../lib/logger.js";

const router = Router();

// Singleton engine instance — shared with executionService
let _engine: OpenClawExecutionEngine | null = null;

function getEngine(): OpenClawExecutionEngine {
  if (!_engine) {
    const config = loadOpenClawConfig();
    _engine = new OpenClawExecutionEngine(config);
  }
  return _engine;
}

/**
 * POST /v1/runtime/events
 *
 * Receives execution events from the OpenClaw Runtime Broker.
 * Raw body is captured before JSON parsing to allow HMAC verification.
 */
router.post("/runtime/events", (req: Request, res: Response) => {
  // Collect raw body chunks
  const chunks: Buffer[] = [];
  req.on("data", (chunk: Buffer) => chunks.push(chunk));

  req.on("end", async () => {
    const rawBody = Buffer.concat(chunks);
    let parsedBody: OpenClawWebhookEvent;

    // Parse JSON
    try {
      parsedBody = JSON.parse(rawBody.toString("utf-8")) as OpenClawWebhookEvent;
    } catch {
      res.status(400).json({
        error: { code: "INVALID_JSON", message: "Request body is not valid JSON." },
      });
      return;
    }

    const signatureHeader = req.headers["x-openclaw-signature"] as string | undefined;
    const engine = getEngine();

    try {
      await engine.processWebhookEvent(rawBody, signatureHeader, parsedBody);

      logger.info(
        {
          eventId: parsedBody.eventId,
          eventType: parsedBody.eventType,
          executionId: parsedBody.executionId,
          tenantId: parsedBody.tenantId,
        },
        "[runtime-events] OpenClaw event processed",
      );

      res.status(200).json({ received: true });
    } catch (err) {
      const code = (err as { code?: string }).code;
      const message = (err as Error).message;

      if (code === "INVALID_SIGNATURE") {
        logger.warn(
          { eventId: parsedBody.eventId, eventType: parsedBody.eventType },
          "[runtime-events] Webhook signature verification failed — event rejected",
        );
        res.status(401).json({
          error: { code: "INVALID_SIGNATURE", message: "Webhook signature verification failed." },
        });
        return;
      }

      if (code === "TENANT_ISOLATION_VIOLATION") {
        logger.error(
          { eventId: parsedBody.eventId, executionId: parsedBody.executionId, tenantId: parsedBody.tenantId },
          "[runtime-events] Tenant boundary violation — event rejected",
        );
        res.status(403).json({
          error: { code: "FORBIDDEN", message: "Tenant boundary violation." },
        });
        return;
      }

      logger.error(
        { err: message, eventId: parsedBody.eventId, eventType: parsedBody.eventType },
        "[runtime-events] Error processing OpenClaw event",
      );

      // Return 200 to prevent OpenClaw from retrying events that are genuinely
      // invalid (e.g. unknown execution ID). For transient failures, return 500.
      const isTransient = !code || code === "DATABASE_ERROR";
      res.status(isTransient ? 500 : 200).json({
        received: !isTransient,
        error: isTransient ? message : undefined,
      });
    }
  });

  req.on("error", (err) => {
    logger.error({ err: err.message }, "[runtime-events] Request stream error");
    res.status(500).json({ error: { code: "STREAM_ERROR", message: "Failed to read request body." } });
  });
});

export default router;
