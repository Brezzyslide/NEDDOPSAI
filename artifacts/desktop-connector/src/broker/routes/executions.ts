/**
 * Execution routes — authenticated
 *
 *   POST   /v1/executions
 *   GET    /v1/executions/:executionId?tenantId=...
 *   POST   /v1/executions/:executionId/cancel
 *   POST   /v1/executions/:executionId/pause
 *   POST   /v1/executions/:executionId/resume
 *
 * The route shapes match exactly what RuntimeBrokerClient in
 * lib/openclaw/src/runtimeBrokerClient.ts sends and expects.
 */

import { Router, type Request, type Response } from "express";
import { randomUUID } from "crypto";
import type { IGatewayAdapter } from "../gatewayAdapter.js";
import type { ExecutionStore } from "../store.js";
import type { WebhookDeliveryWorker } from "../webhookDelivery.js";
import type { BrokerConfig, BrokerExecutionStatus } from "../types.js";
import { isTerminal } from "../types.js";
import { validateInboundPackage, validateControlRequest } from "../validation.js";
import type pino from "pino";

export function createExecutionRouter(
  config: BrokerConfig,
  store: ExecutionStore,
  gateway: IGatewayAdapter,
  webhookWorker: WebhookDeliveryWorker,
  logger: pino.Logger,
): Router {
  const router = Router();

  // ─── POST /v1/executions ────────────────────────────────────────────────────

  router.post("/executions", async (req: Request, res: Response) => {
    const body = req.body as unknown;

    // 1. Validate the execution package
    const validation = validateInboundPackage(body, {
      allowLocalCallbacks: config.gatewayMode === "simulated",
    });

    if (!validation.valid || !validation.package) {
      res.status(422).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Execution package validation failed",
          details: validation.errors,
        },
      });
      return;
    }

    const pkg = validation.package;

    // 2. Reject duplicate execution IDs
    const existing = store.getExecution(pkg.executionId);
    if (existing) {
      // Idempotent — return the existing submission response rather than erroring
      logger.info(
        { executionId: pkg.executionId, existingStatus: existing.status },
        "[executions] Duplicate submission — returning existing record",
      );
      res.status(200).json({
        runtimeExecutionId: existing.runtimeExecutionId,
        status: existing.status === "queued" || existing.status === "submitted"
          ? "queued"
          : "accepted",
        runtimeVersion: config.brokerVersion,
      });
      return;
    }

    // 3. Persist the execution record
    const runtimeExecutionId = randomUUID();
    const now = new Date().toISOString();

    store.insertExecution({
      id: pkg.executionId,
      tenantId: pkg.tenantId,
      runtimeExecutionId,
      status: "queued",
      packageJson: JSON.stringify(pkg),
      gatewaySessionId: null,
      errorMessage: null,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      completedAt: null,
      expiresAt: pkg.expiresAt,
      callbackUrl: pkg.callbackUrl,
    });

    logger.info(
      { executionId: pkg.executionId, tenantId: pkg.tenantId, runtimeExecutionId },
      "[executions] Execution accepted — submitting to gateway",
    );

    // 4. Submit to gateway (async — don't block the HTTP response)
    setImmediate(async () => {
      try {
        store.updateStatus(pkg.executionId, "submitted");

        const accepted = await gateway.submit({
          executionId:    pkg.executionId,
          tenantId:       pkg.tenantId,
          workforceRole:  pkg.workforceRole,
          // Sprint SRM: manifest and workerProfile must travel to the gateway.
          // pkg.specialistManifest is guaranteed present — the backward-compat
          // check above would have returned early if it were absent.
          specialistManifest: pkg.specialistManifest as Record<string, unknown>,
          workerProfile: {
            allowedChannels:             pkg.workerProfile.allowedChannels,
            allowedBrowserDomains:       pkg.workerProfile.allowedBrowserDomains,
            allowedLocalPathCategories:  pkg.workerProfile.allowedLocalPathCategories,
            allowedApplicationCategories: pkg.workerProfile.allowedApplicationCategories,
            prohibitedActions:           pkg.workerProfile.prohibitedActions,
            riskLevel:                   pkg.workerProfile.riskLevel,
            requiresApprovalFor:         pkg.workerProfile.requiresApprovalFor,
          },
          steps:       pkg.steps,
          constraints: { maxDurationSeconds: pkg.constraints.maxDurationSeconds },
        });

        store.updateStatus(pkg.executionId, "submitted", {
          gatewaySessionId: accepted.gatewaySessionId,
        });

        // Queue an "accepted" webhook
        const exec = store.getExecution(pkg.executionId);
        if (exec) webhookWorker.queueEvent(exec, "submitted");

        logger.info(
          { executionId: pkg.executionId, gatewaySessionId: accepted.gatewaySessionId },
          "[executions] Gateway accepted execution",
        );
      } catch (err) {
        const errorMessage = (err as Error).message;
        const now = new Date().toISOString();
        store.updateStatus(pkg.executionId, "failed", { errorMessage, completedAt: now });

        const exec = store.getExecution(pkg.executionId);
        if (exec) webhookWorker.queueEvent(exec, "failed", { errorMessage });

        logger.error({ executionId: pkg.executionId, err: errorMessage }, "[executions] Gateway submission failed");
      }
    });

    // 5. Respond immediately — broker has accepted the package
    res.status(202).json({
      runtimeExecutionId,
      status: "queued",
      runtimeVersion: config.brokerVersion,
    });
  });

  // ─── GET /v1/executions/:executionId?tenantId=... ───────────────────────────

  router.get("/executions/:executionId", async (req: Request, res: Response) => {
    const { executionId } = req.params;
    const tenantId = req.query.tenantId as string | undefined;

    if (!tenantId) {
      res.status(400).json({
        error: { code: "BAD_REQUEST", message: "tenantId query parameter is required" },
      });
      return;
    }

    const exec = store.getExecutionForTenant(executionId, tenantId);
    if (!exec) {
      res.status(404).json({
        error: { code: "NOT_FOUND", message: `Execution ${executionId} not found for tenant ${tenantId}` },
      });
      return;
    }

    // Optionally refresh from gateway if non-terminal
    if (!isTerminal(exec.status) && exec.gatewaySessionId) {
      try {
        const gwStatus = await gateway.getStatus(exec.gatewaySessionId);
        if (gwStatus.status !== exec.status) {
          store.updateStatus(exec.id, gwStatus.status, {
            startedAt: gwStatus.startedAt ?? undefined,
            completedAt: gwStatus.completedAt ?? undefined,
            errorMessage: gwStatus.errorMessage ?? undefined,
          });
          const updated = store.getExecution(exec.id);
          if (updated) {
            return respondWithStatus(res, updated, config.brokerVersion);
          }
        }
      } catch {
        // Gateway poll failed — return what we have in the DB
      }
    }

    respondWithStatus(res, exec, config.brokerVersion);
  });

  // ─── POST /v1/executions/:executionId/cancel ────────────────────────────────

  router.post("/executions/:executionId/cancel", async (req: Request, res: Response) => {
    await handleControl(req, res, "cancel", async (exec) => {
      if (isTerminal(exec.status)) {
        // Already done — idempotent OK
        return;
      }
      if (exec.gatewaySessionId) {
        await gateway.cancel(exec.gatewaySessionId);
      }
      const now = new Date().toISOString();
      store.updateStatus(exec.id, "cancelled", { completedAt: now });
      const updated = store.getExecution(exec.id);
      if (updated) webhookWorker.queueEvent(updated, "cancelled");
    }, store, logger, config);
  });

  // ─── POST /v1/executions/:executionId/pause ─────────────────────────────────

  router.post("/executions/:executionId/pause", async (req: Request, res: Response) => {
    await handleControl(req, res, "pause", async (exec) => {
      if (exec.status !== "running") {
        throw Object.assign(
          new Error(`Cannot pause execution in status: ${exec.status}`),
          { code: "INVALID_STATE", statusCode: 409 },
        );
      }
      if (exec.gatewaySessionId) {
        await gateway.pause(exec.gatewaySessionId);
      }
      store.updateStatus(exec.id, "paused");
      const updated = store.getExecution(exec.id);
      if (updated) webhookWorker.queueEvent(updated, "paused");
    }, store, logger, config);
  });

  // ─── POST /v1/executions/:executionId/resume ────────────────────────────────

  router.post("/executions/:executionId/resume", async (req: Request, res: Response) => {
    await handleControl(req, res, "resume", async (exec) => {
      if (exec.status !== "paused") {
        throw Object.assign(
          new Error(`Cannot resume execution in status: ${exec.status}`),
          { code: "INVALID_STATE", statusCode: 409 },
        );
      }
      if (exec.gatewaySessionId) {
        await gateway.resume(exec.gatewaySessionId);
      }
      store.updateStatus(exec.id, "running");
      const updated = store.getExecution(exec.id);
      if (updated) webhookWorker.queueEvent(updated, "running", {
        startedAt: updated.startedAt ?? new Date().toISOString(),
      });
    }, store, logger, config);
  });

  return router;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function respondWithStatus(
  res: Response,
  exec: ReturnType<ExecutionStore["getExecution"]> & object,
  brokerVersion: string,
): void {
  res.json({
    executionId: exec.id,
    runtimeExecutionId: exec.runtimeExecutionId,
    tenantId: exec.tenantId,
    status: exec.status,
    startedAt: exec.startedAt,
    completedAt: exec.completedAt,
    errorMessage: exec.errorMessage,
    runtimeVersion: brokerVersion,
  });
}

async function handleControl(
  req: Request,
  res: Response,
  action: string,
  handler: (exec: NonNullable<ReturnType<ExecutionStore["getExecution"]>>) => Promise<void>,
  store: ExecutionStore,
  logger: pino.Logger,
  config: BrokerConfig,
): Promise<void> {
  const { executionId } = req.params;

  // Validate body (tenantId required)
  const validation = validateControlRequest(req.body as unknown);
  if (!validation.valid) {
    res.status(422).json({
      error: { code: "VALIDATION_ERROR", details: validation.errors },
    });
    return;
  }

  const tenantId = (req.body as { tenantId: string }).tenantId;
  const exec = store.getExecutionForTenant(executionId, tenantId);

  if (!exec) {
    res.status(404).json({
      error: {
        code: "NOT_FOUND",
        message: `Execution ${executionId} not found for tenant ${tenantId}`,
      },
    });
    return;
  }

  try {
    await handler(exec);
    logger.info({ executionId, tenantId, action }, `[executions] ${action} succeeded`);
    res.status(200).json({ ok: true });
  } catch (err) {
    const code = (err as { code?: string }).code ?? "INTERNAL_ERROR";
    const statusCode = (err as { statusCode?: number }).statusCode ?? 500;
    const message = (err as Error).message;

    logger.error({ executionId, tenantId, action, err: message }, `[executions] ${action} failed`);
    res.status(statusCode).json({ error: { code, message } });
  }
}
