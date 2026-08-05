/**
 * Specialist Runs Routes — Sprint 9.5
 *
 * GET  /organisations/:slug/tasks/:taskId/specialist-runs              — list runs for task
 * GET  /organisations/:slug/tasks/:taskId/specialist-runs/consolidated — consolidated result
 * GET  /organisations/:slug/tasks/:taskId/specialist-runs/:id          — single run
 * POST /organisations/:slug/tasks/:taskId/specialist-runs/:id/clarification — submit clarification
 * POST /organisations/:slug/tasks/:taskId/specialist-runs/:id/cancel   — cancel run
 */

import { Router } from "express";
import { requireAuth, resolveTenantFromSlug } from "../../middlewares/tenantContext.js";
import {
  getRunsByTask,
  getSpecialistRunById,
  transitionRunStatus,
} from "../../services/specialistRunService.js";
import {
  consolidateTaskResults,
  resumeAfterClarification,
} from "../../services/chiefOfStaffOrchestrator.js";
import { markCancelled } from "../../services/specialistQueueService.js";
import { logOrgEvent } from "../../services/auditService.js";

const router = Router({ mergeParams: true });

// All routes require authentication + org context
const auth = [requireAuth, resolveTenantFromSlug] as const;

// GET /organisations/:slug/tasks/:taskId/specialist-runs
router.get("/", ...auth, async (req, res, next) => {
  try {
    const ctx = req.tenantContext!;
    const runs = await getRunsByTask(req.params.taskId!, ctx.tenantId);

    res.json({
      runs: runs.map(r => ({
        id: r.id,
        workforceRoleCode: r.workforceRoleCode,
        workerProfileCode: r.workerProfileCode,
        status: r.status,
        priority: r.priority,
        attemptNumber: r.attemptNumber,
        maximumAttempts: r.maximumAttempts,
        approvalRequired: r.approvalRequired,
        externalExecutionRequired: r.externalExecutionRequired,
        clarificationRequired: r.clarificationRequired,
        confidence: r.confidence ? parseFloat(r.confidence.toString()) : null,
        resultSummary: r.resultSummary,
        lastError: r.lastError,
        specialistInstructionVersion: r.specialistInstructionVersion,
        modelProvider: r.modelProvider,
        modelName: r.modelName,
        queuedAt: r.queuedAt,
        startedAt: r.startedAt,
        completedAt: r.completedAt,
        failedAt: r.failedAt,
        createdAt: r.createdAt,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// GET /organisations/:slug/tasks/:taskId/specialist-runs/consolidated
router.get("/consolidated", ...auth, async (req, res, next) => {
  try {
    const ctx = req.tenantContext!;
    const consolidated = await consolidateTaskResults(req.params.taskId!, ctx.tenantId);
    res.json({ consolidated });
  } catch (err) {
    next(err);
  }
});

// GET /organisations/:slug/tasks/:taskId/specialist-runs/:id
router.get("/:id", ...auth, async (req, res, next) => {
  try {
    const ctx = req.tenantContext!;
    const run = await getSpecialistRunById(req.params.id!, ctx.tenantId);
    if (!run || run.taskId !== req.params.taskId) {
      return res.status(404).json({ error: "Specialist run not found" });
    }

    let resultData = null;
    if (run.resultData) {
      try { resultData = JSON.parse(run.resultData); } catch { /* ignore */ }
    }

    res.json({
      run: {
        id: run.id,
        taskId: run.taskId,
        workforceRoleCode: run.workforceRoleCode,
        workerProfileCode: run.workerProfileCode,
        status: run.status,
        priority: run.priority,
        attemptNumber: run.attemptNumber,
        maximumAttempts: run.maximumAttempts,
        approvalRequired: run.approvalRequired,
        externalExecutionRequired: run.externalExecutionRequired,
        clarificationRequired: run.clarificationRequired,
        confidence: run.confidence ? parseFloat(run.confidence.toString()) : null,
        resultSummary: run.resultSummary,
        resultData,
        lastError: run.lastError,
        specialistInstructionVersion: run.specialistInstructionVersion,
        modelProvider: run.modelProvider,
        modelName: run.modelName,
        queuedAt: run.queuedAt,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
        failedAt: run.failedAt,
        cancelledAt: run.cancelledAt,
        createdAt: run.createdAt,
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /organisations/:slug/tasks/:taskId/specialist-runs/:id/clarification
router.post("/:id/clarification", ...auth, async (req, res, next) => {
  try {
    const ctx = req.tenantContext!;
    const run = await getSpecialistRunById(req.params.id!, ctx.tenantId);
    if (!run || run.taskId !== req.params.taskId) {
      return res.status(404).json({ error: "Specialist run not found" });
    }
    if (run.status !== "awaiting_clarification") {
      return res.status(409).json({ error: "Specialist run is not awaiting clarification" });
    }

    const { response } = req.body as { response?: string };
    if (!response || typeof response !== "string" || response.trim().length === 0) {
      return res.status(400).json({ error: "A clarification response is required" });
    }
    if (response.length > 4000) {
      return res.status(400).json({ error: "Clarification response too long (max 4000 chars)" });
    }

    await resumeAfterClarification(run.id, ctx.tenantId, response);

    await logOrgEvent({
      eventType: "specialist.clarification_resolved",
      organizationId: ctx.tenantId,
      actorUserId: req.user!.id,
      actorType: "user",
      resourceType: "specialist_run",
      resourceId: run.id,
      metadata: { responseLength: response.length },
    });

    res.json({ success: true, message: "Clarification submitted. Run will resume shortly." });
  } catch (err) {
    next(err);
  }
});

// POST /organisations/:slug/tasks/:taskId/specialist-runs/:id/cancel
router.post("/:id/cancel", ...auth, async (req, res, next) => {
  try {
    const ctx = req.tenantContext!;
    const run = await getSpecialistRunById(req.params.id!, ctx.tenantId);
    if (!run || run.taskId !== req.params.taskId) {
      return res.status(404).json({ error: "Specialist run not found" });
    }

    const nonCancellable = ["completed", "failed", "cancelled"];
    if (nonCancellable.includes(run.status)) {
      return res.status(409).json({
        error: `Cannot cancel a run with status "${run.status}"`,
      });
    }

    await markCancelled(run.id, ctx.tenantId);
    await transitionRunStatus(run.id, ctx.tenantId, "cancelled");

    await logOrgEvent({
      eventType: "specialist.run_cancelled",
      organizationId: ctx.tenantId,
      actorUserId: req.user!.id,
      actorType: "user",
      resourceType: "specialist_run",
      resourceId: run.id,
      metadata: { reason: (req.body as { reason?: string }).reason },
    });

    res.json({ success: true, message: "Specialist run cancelled." });
  } catch (err) {
    next(err);
  }
});

export default router;
