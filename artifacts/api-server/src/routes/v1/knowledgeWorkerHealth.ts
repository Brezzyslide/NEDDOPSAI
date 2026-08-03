/**
 * Knowledge Worker Health — /v1/platform/knowledge-worker
 *
 * Platform-admin-only endpoint. Returns the in-process worker state
 * and queue health metrics. Never exposes tenant document names or content.
 *
 * Routes:
 *   GET  /v1/platform/knowledge-worker/health
 *   POST /v1/platform/knowledge-worker/recover-stuck   (trigger sweep immediately)
 */

import { Router } from "express";
import { requireAuth } from "../../middlewares/tenantContext.js";
import { requirePlatformRole } from "../../middlewares/requirePlatformRole.js";
import { getWorkerHealth } from "../../services/workerHealthService.js";
import { getIngestionQueue } from "../../lib/ingestionQueue/index.js";
import { getInProcessWorker } from "../../workers/knowledgeIngestionWorker.js";

const router = Router({ mergeParams: true });

// ─── GET /v1/platform/knowledge-worker/health ─────────────────────────────────

router.get(
  "/knowledge-worker/health",
  requireAuth,
  requirePlatformRole("platform_admin"),
  async (_req, res, next) => {
    try {
      const [workerState, queueHealth] = await Promise.all([
        Promise.resolve(getWorkerHealth()),
        getIngestionQueue().health(),
      ]);

      const worker = getInProcessWorker();
      const isRunning = worker?.isRunning() ?? false;

      res.json({
        worker: {
          ...workerState,
          running: isRunning,
        },
        queue: queueHealth,
        mode:   process.env.KNOWLEDGE_WORKER_MODE ?? "in-process",
        provider: process.env.KNOWLEDGE_QUEUE_PROVIDER ?? "database",
      });
    } catch (err) {
      next(err);
    }
  },
);

// ─── POST /v1/platform/knowledge-worker/recover-stuck ────────────────────────

router.post(
  "/knowledge-worker/recover-stuck",
  requireAuth,
  requirePlatformRole("platform_admin"),
  async (_req, res, next) => {
    try {
      const recovered = await getIngestionQueue().recoverStuck();
      res.json({ recovered, message: `${recovered} stuck jobs recovered.` });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
