/**
 * Platform Runtime routes — /v1/platform/runtime/*
 *
 * Sprint 8: OpenClaw Runtime Integration
 *
 * Provides monitoring and status endpoints for NeedsOps platform staff.
 *
 * Routes:
 *   GET /status        — runtime health, version, connection state
 *   GET /capabilities  — runtime capability declaration
 *
 * Restricted to platform roles. Never exposes runtime credentials.
 */

import { Router } from "express";
import { requireAuth } from "../../middlewares/tenantContext.js";
import { requirePlatformAuth } from "../../middlewares/requirePlatformRole.js";
import { getRuntimeHealth } from "../../services/executionService.js";
import { isOpenClawConfigured, loadOpenClawConfig } from "@workspace/openclaw";
import { count, eq } from "drizzle-orm";
import { db, executionSessionsTable } from "@workspace/db";

const router = Router();
const auth = [requireAuth, requirePlatformAuth];

// GET /v1/platform/runtime/status
router.get("/status", ...auth, async (_req, res, next) => {
  try {
    const config = loadOpenClawConfig();
    const health = await getRuntimeHealth();

    const [activeSessions] = await db
      .select({ n: count() })
      .from(executionSessionsTable)
      .where(eq(executionSessionsTable.currentStatus, "running"));

    const [queuedSessions] = await db
      .select({ n: count() })
      .from(executionSessionsTable)
      .where(eq(executionSessionsTable.currentStatus, "submitted"));

    const [failedSessions] = await db
      .select({ n: count() })
      .from(executionSessionsTable)
      .where(eq(executionSessionsTable.currentStatus, "failed"));

    res.json({
      runtime: {
        name: "openclaw",
        configured: isOpenClawConfigured(config),
        runtimeUrl: config.runtimeUrl ? "[configured]" : null,
        status: health.status,
        version: health.version,
        lastHeartbeatAt: health.lastHeartbeatAt,
        connectedAt: health.connectedAt,
        message: health.message ?? null,
      },
      executions: {
        active: activeSessions?.n ?? 0,
        queued: queuedSessions?.n ?? 0,
        failed: failedSessions?.n ?? 0,
      },
      capabilities: health.capabilities,
      retrievedAt: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

// GET /v1/platform/runtime/capabilities
router.get("/capabilities", ...auth, async (_req, res, next) => {
  try {
    const health = await getRuntimeHealth();

    if (!health.capabilities) {
      res.json({
        available: false,
        message: "OpenClaw Runtime not connected.",
        capabilities: null,
      });
      return;
    }

    res.json({
      available: true,
      capabilities: health.capabilities,
      retrievedAt: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
