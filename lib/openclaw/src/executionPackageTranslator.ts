/**
 * @workspace/openclaw — Execution Package Translator
 *
 * Translates a NeedsOps ExecutionPackage (from @workspace/agent-runtime) into
 * an OpenClawExecutionPackage (the wire format the broker expects).
 *
 * This is the only place where NeedsOps domain concepts are mapped to
 * OpenClaw wire types. The mapping is explicit and auditable.
 *
 * Internal platform-only data (database IDs, subscription details, internal
 * feature flags, etc.) must never appear in the translated package.
 */

import type { ExecutionPackage } from "@workspace/agent-runtime";
import type { OpenClawExecutionPackage } from "./types.js";
import type { OpenClawConfig } from "./config.js";
import { buildCallbackUrl } from "./config.js";

// ─── Status messages ──────────────────────────────────────────────────────────

/**
 * Human-readable status messages displayed to the customer during execution.
 * These must be truthful — do not claim activity that has not occurred.
 */
export const EXECUTION_STATUS_MESSAGES: Record<string, string> = {
  pending: "Preparing execution",
  submitted: "Connecting to runtime",
  accepted: "Runtime accepted task",
  running: "Execution in progress",
  paused: "Execution paused",
  awaiting_approval: "Waiting for approval",
  completed: "Execution completed",
  failed: "Execution failed",
  cancelled: "Execution cancelled",
  expired: "Execution request expired",
  not_connected: "Runtime not available",
};

export function getStatusMessage(status: string): string {
  return EXECUTION_STATUS_MESSAGES[status] ?? "Unknown status";
}

// ─── Validation ───────────────────────────────────────────────────────────────

export class ExecutionPackageValidationError extends Error {
  constructor(
    message: string,
    public readonly field: string,
  ) {
    super(message);
    this.name = "ExecutionPackageValidationError";
  }
}

/**
 * Validate a NeedsOps ExecutionPackage before translation.
 * Throws ExecutionPackageValidationError if any required field is missing or invalid.
 */
export function validateExecutionPackage(pkg: ExecutionPackage): void {
  if (!pkg.executionId || pkg.executionId.trim().length === 0) {
    throw new ExecutionPackageValidationError("executionId is required", "executionId");
  }

  if (!pkg.tenantId || pkg.tenantId.trim().length === 0) {
    throw new ExecutionPackageValidationError("tenantId is required", "tenantId");
  }

  if (!pkg.workforceRole || pkg.workforceRole.trim().length === 0) {
    throw new ExecutionPackageValidationError("workforceRole is required", "workforceRole");
  }

  if (!pkg.workerProfile) {
    throw new ExecutionPackageValidationError("workerProfile is required", "workerProfile");
  }

  if (!Array.isArray(pkg.steps) || pkg.steps.length === 0) {
    throw new ExecutionPackageValidationError(
      "steps must be a non-empty array",
      "steps",
    );
  }

  const now = new Date();
  const expiresAt = new Date(pkg.expiresAt);
  if (isNaN(expiresAt.getTime())) {
    throw new ExecutionPackageValidationError("expiresAt is not a valid ISO timestamp", "expiresAt");
  }
  if (expiresAt <= now) {
    throw new ExecutionPackageValidationError(
      `Execution package has already expired (expiresAt: ${pkg.expiresAt})`,
      "expiresAt",
    );
  }
}

// ─── Translation ──────────────────────────────────────────────────────────────

/**
 * Translate a NeedsOps ExecutionPackage into the OpenClaw wire format.
 *
 * The callback URL is injected from config here so the execution package
 * always contains the correct externally-reachable endpoint.
 */
export function translateToOpenClawPackage(
  pkg: ExecutionPackage,
  config: OpenClawConfig,
): OpenClawExecutionPackage {
  validateExecutionPackage(pkg);

  const callbackUrl = buildCallbackUrl(config) ?? pkg.callbackUrl;

  return {
    executionId: pkg.executionId,
    tenantId: pkg.tenantId,
    workforceRole: pkg.workforceRole,

    workerProfile: {
      allowedChannels: pkg.workerProfile.allowedChannels,
      allowedBrowserDomains: pkg.workerProfile.allowedBrowserDomains,
      allowedLocalPathCategories: pkg.workerProfile.allowedLocalPathCategories,
      allowedApplicationCategories: pkg.workerProfile.allowedApplicationCategories,
      prohibitedActions: pkg.workerProfile.prohibitedActions,
      riskLevel: pkg.workerProfile.riskLevel,
      requiresApprovalFor: pkg.workerProfile.requiresApprovalFor,
    },

    steps: pkg.steps.map(step => ({
      sequence: step.sequence,
      specialist: step.specialist,
      action: step.action,
      description: step.description,
      requiresApproval: step.requiresApproval,
      ...(step.estimatedDurationSeconds !== undefined
        ? { estimatedDurationSeconds: step.estimatedDurationSeconds }
        : {}),
    })),

    requestedTools: pkg.requestedTools,
    requestedChannels: pkg.requestedChannels,
    requestedConnectorCategories: pkg.requestedConnectorCategories,
    approvalState: pkg.approvalState,

    constraints: {
      maxDurationSeconds: pkg.constraints.maxDurationSeconds,
      requireHumanApprovalBeforeSubmit: pkg.constraints.requireHumanApprovalBeforeSubmit,
      allowedDataCategories: pkg.constraints.allowedDataCategories,
    },

    callbackUrl,
    expiresAt: pkg.expiresAt,
    issuedAt: pkg.issuedAt,
  };
}
