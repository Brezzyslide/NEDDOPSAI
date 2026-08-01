/**
 * Execution Service — Sprint 8
 *
 * Orchestrates the lifecycle of runtime execution sessions.
 *
 * Responsibilities:
 *   - Building ExecutionPackages from approved task plans and worker profiles
 *   - Delegating to the ExecutionEngine (OpenClaw adapter)
 *   - Querying execution session status
 *   - Enforcing pre-submission checks (task must be approved, plan must exist)
 *
 * This service does NOT communicate with OpenClaw directly.
 * All runtime communication goes through the ExecutionEngine.
 */

import { randomUUID } from "crypto";
import { eq, and, desc } from "drizzle-orm";
import {
  db,
  tasksTable,
  taskExecutionPlansTable,
  executionSessionsTable,
  executionEventsTable,
} from "@workspace/db";
import type { ExecutionPackage, ExecutionSessionInfo } from "@workspace/agent-runtime";
import {
  OpenClawExecutionEngine,
  loadOpenClawConfig,
  isOpenClawConfigured,
  getStatusMessage,
} from "@workspace/openclaw";
import { getActiveWorkerProfilesForRole } from "../lib/workerProfileRegistry.js";
import { checkExecutionAccess } from "./executionPolicy.js";
import {
  compileSpecialistManifest,
  buildManifestAuditRecord,
  MissingDNAError,
  InactiveDNAError,
} from "./specialistRuntimeManifestService.js";

// ─── Singleton engine ─────────────────────────────────────────────────────────

let _engine: OpenClawExecutionEngine | null = null;

function getEngine(): OpenClawExecutionEngine {
  if (!_engine) {
    const config = loadOpenClawConfig();
    _engine = new OpenClawExecutionEngine(config);
    _engine.startHeartbeat();
  }
  return _engine!;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SubmitExecutionInput {
  taskId: string;
  organizationId: string;
  requestedByUserId: string;
}

export interface ExecutionSubmitResult {
  executionId: string;
  outcome: "accepted" | "queued" | "rejected" | "not_connected";
  statusMessage: string;
  runtimeExecutionId: string | null;
  estimatedStartAt?: string;
  rejectionReason?: string;
}

// ─── Pre-submission checks ────────────────────────────────────────────────────

async function getApprovedTask(taskId: string, organizationId: string) {
  const [task] = await db
    .select()
    .from(tasksTable)
    .where(and(eq(tasksTable.id, taskId), eq(tasksTable.organizationId, organizationId)))
    .limit(1);

  if (!task) {
    throw Object.assign(new Error("Task not found"), { code: "RESOURCE_NOT_FOUND" });
  }

  if (task.currentState !== "approved") {
    throw Object.assign(
      new Error(
        `Task must be in 'approved' state before submission. Current state: '${task.currentState}'`,
      ),
      { code: "VALIDATION_ERROR" },
    );
  }

  return task;
}

async function getTaskPlan(taskId: string) {
  const [plan] = await db
    .select()
    .from(taskExecutionPlansTable)
    .where(eq(taskExecutionPlansTable.taskId, taskId))
    .limit(1);

  if (!plan) {
    throw Object.assign(
      new Error("No execution plan found for this task. The task must be planned before submission."),
      { code: "RESOURCE_NOT_FOUND" },
    );
  }

  return plan;
}

// ─── Package builder ──────────────────────────────────────────────────────────

function buildExecutionPackage(
  task: typeof tasksTable.$inferSelect,
  planRow: typeof taskExecutionPlansTable.$inferSelect,
  config: ReturnType<typeof loadOpenClawConfig>,
): ExecutionPackage {
  const executionId = randomUUID();
  const now = new Date();

  // Extract plan data from JSONB
  const planData = planRow.planData as {
    assignedSpecialists?: string[];
    steps?: Array<{
      specialist?: string;
      action?: string;
      description?: string;
      requiresApproval?: boolean;
    }>;
    requiresApproval?: boolean;
    approvalType?: string;
  };

  const primaryRole = planData.assignedSpecialists?.[0] ?? "chief_of_staff";

  // Retrieve the worker profile for the primary specialist
  const profiles = getActiveWorkerProfilesForRole(primaryRole);
  const profile = profiles[0];

  // Default profile values when the specialist has no specific profile
  const workerProfileConstraints: ExecutionPackage["workerProfile"] = profile
    ? {
        allowedChannels: profile.allowedChannels as ExecutionPackage["workerProfile"]["allowedChannels"],
        allowedBrowserDomains: profile.allowedBrowserDomains ?? [],
        allowedLocalPathCategories: profile.allowedLocalPathCategories ?? [],
        allowedApplicationCategories: profile.allowedApplicationCategories ?? [],
        prohibitedActions: profile.prohibitedActions ?? [],
        riskLevel: profile.riskLevel as "low" | "medium" | "high",
        requiresApprovalFor: profile.requiresApprovalFor ?? [],
      }
    : {
        allowedChannels: ["api", "internal"],
        allowedBrowserDomains: [],
        allowedLocalPathCategories: [],
        allowedApplicationCategories: [],
        prohibitedActions: [],
        riskLevel: "low",
        requiresApprovalFor: [],
      };

  // Map plan steps into ExecutionPackage steps
  const steps: ExecutionPackage["steps"] =
    planData.steps && planData.steps.length > 0
      ? planData.steps.map((s, i) => ({
          sequence: i + 1,
          specialist: s.specialist ?? primaryRole,
          action: s.action ?? "execute",
          description: s.description ?? `Step ${i + 1}`,
          requiresApproval: s.requiresApproval ?? false,
        }))
      : [
          {
            sequence: 1,
            specialist: primaryRole,
            action: "execute",
            description: task.title,
            requiresApproval: planData.requiresApproval ?? false,
          },
        ];

  const expiresAt = new Date(
    now.getTime() + config.executionTtlSeconds * 1000,
  ).toISOString();

  // Compile the Specialist Runtime Manifest from the active DNA profile.
  // This must happen AFTER the eligibility/entitlement check in submitTaskExecution.
  // Throws MissingDNAError or InactiveDNAError — callers must handle these.
  const specialistManifest = compileSpecialistManifest(primaryRole);

  return {
    executionId,
    taskId: task.id,
    tenantId: task.organizationId,
    workforceRole: primaryRole,
    specialistManifest,
    workerProfile: workerProfileConstraints,
    steps,
    requestedTools: workerProfileConstraints.allowedChannels.includes("api")
      ? ["api_call"]
      : ["internal"],
    requestedChannels: workerProfileConstraints.allowedChannels,
    requestedConnectorCategories: [],
    approvalState: task.approvalState,
    constraints: {
      maxDurationSeconds: 300,
      requireHumanApprovalBeforeSubmit: planData.requiresApproval ?? false,
      allowedDataCategories: ["task_context", "internal"],
    },
    callbackUrl: "", // resolved by engine from OPENCLAW_CALLBACK_BASE_URL
    expiresAt,
    issuedAt: now.toISOString(),
  };
}

// ─── Submit execution ─────────────────────────────────────────────────────────

export async function submitTaskExecution(
  input: SubmitExecutionInput,
): Promise<ExecutionSubmitResult> {
  const engine = getEngine();
  const config = loadOpenClawConfig();

  // 1. Verify task is approved and has a plan
  const [task, planRow] = await Promise.all([
    getApprovedTask(input.taskId, input.organizationId),
    getTaskPlan(input.taskId),
  ]);

  // 2. Provider-independent execution gate (Steps 4–8)
  //    Checks subscription state, feature entitlement, workforce pack,
  //    execution channels, and usage allowance — using NeedsOps internal
  //    tables only. No billing provider is consulted here.
  const planData = planRow.planData as { assignedSpecialists?: string[] };
  const primaryRole = planData.assignedSpecialists?.[0] ?? "chief_of_staff";

  const access = await checkExecutionAccess(
    input.organizationId,
    primaryRole,
    ["api", "internal"],  // base channels — updated from pkg once built
  );

  if (!access.allowed) {
    // Revert task state — it was not yet changed, so nothing to undo
    throw Object.assign(
      new Error(access.decision.reason),
      { code: "EXECUTION_ACCESS_DENIED", decision: access.decision },
    );
  }

  // 3. Build the package (compiles specialist manifest from DNA)
  let pkg: ReturnType<typeof buildExecutionPackage>;
  try {
    pkg = buildExecutionPackage(task, planRow, config);
  } catch (err) {
    if (err instanceof MissingDNAError || err instanceof InactiveDNAError) {
      throw Object.assign(
        new Error(
          `Cannot compile execution package: ${(err as Error).message}`,
        ),
        { code: "SPECIALIST_DNA_UNAVAILABLE", cause: err },
      );
    }
    throw err;
  }

  // 3a. Record manifest audit event
  const auditRecord = buildManifestAuditRecord(pkg.specialistManifest, pkg.executionId);

  // 4. Transition task to executing
  await db
    .update(tasksTable)
    .set({ currentState: "executing", updatedAt: new Date() })
    .where(eq(tasksTable.id, input.taskId));

  // 5. Check if runtime is configured
  if (!isOpenClawConfigured(config)) {
    // Runtime not configured — create a pending session for when it connects
    await db.insert(executionSessionsTable).values({
      id: pkg.executionId,
      taskId: task.id,
      organizationId: task.organizationId,
      runtimeName: "openclaw",
      currentStatus: "pending",
      executionPackage: pkg as unknown as Record<string, unknown>,
      metadata: {
        note: "Runtime not configured. Session pending runtime connection.",
        manifestAudit: auditRecord,
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    return {
      executionId: pkg.executionId,
      outcome: "not_connected",
      statusMessage: "Runtime not connected. Execution pending.",
      runtimeExecutionId: null,
    };
  }

  // 6. Submit to engine
  const result = await engine.submitExecution(pkg);

  return {
    executionId: pkg.executionId,
    outcome: result.outcome,
    statusMessage: getStatusMessage(
      result.outcome === "accepted"
        ? "accepted"
        : result.outcome === "queued"
        ? "submitted"
        : "failed",
    ),
    runtimeExecutionId: result.runtimeExecutionId,
    estimatedStartAt: result.estimatedStartAt,
    rejectionReason: result.rejectionReason,
  };
}

// ─── Get execution status ─────────────────────────────────────────────────────

export async function getTaskExecutionStatus(
  taskId: string,
  organizationId: string,
): Promise<ExecutionSessionInfo | null> {
  // Find the latest session for this task
  const [session] = await db
    .select()
    .from(executionSessionsTable)
    .where(
      and(
        eq(executionSessionsTable.taskId, taskId),
        eq(executionSessionsTable.organizationId, organizationId),
      ),
    )
    .orderBy(desc(executionSessionsTable.createdAt))
    .limit(1);

  if (!session) return null;

  const engine = getEngine();
  const sessionInfo = await engine.getExecutionStatus(session.id, organizationId);

  if (sessionInfo) return sessionInfo;

  // Fallback from DB if engine returns null
  return {
    executionId: session.id,
    runtimeExecutionId: session.runtimeExecutionId,
    status: session.currentStatus as ExecutionSessionInfo["status"],
    statusMessage: getStatusMessage(session.currentStatus),
    submittedAt: session.submittedAt?.toISOString() ?? null,
    startedAt: session.startedAt?.toISOString() ?? null,
    completedAt: session.completedAt?.toISOString() ?? null,
    errorMessage: session.errorMessage,
  };
}

// ─── Execution control ────────────────────────────────────────────────────────

export async function cancelTaskExecution(
  taskId: string,
  organizationId: string,
): Promise<void> {
  const [session] = await db
    .select()
    .from(executionSessionsTable)
    .where(
      and(
        eq(executionSessionsTable.taskId, taskId),
        eq(executionSessionsTable.organizationId, organizationId),
      ),
    )
    .orderBy(desc(executionSessionsTable.createdAt))
    .limit(1);

  if (!session) {
    throw Object.assign(new Error("No active execution session found"), { code: "RESOURCE_NOT_FOUND" });
  }

  const engine = getEngine();
  await engine.cancelExecution(session.id, organizationId);
}

export async function pauseTaskExecution(
  taskId: string,
  organizationId: string,
): Promise<void> {
  const [session] = await db
    .select()
    .from(executionSessionsTable)
    .where(
      and(
        eq(executionSessionsTable.taskId, taskId),
        eq(executionSessionsTable.organizationId, organizationId),
      ),
    )
    .orderBy(desc(executionSessionsTable.createdAt))
    .limit(1);

  if (!session) {
    throw Object.assign(new Error("No active execution session found"), { code: "RESOURCE_NOT_FOUND" });
  }

  const engine = getEngine();
  await engine.pauseExecution(session.id, organizationId);
}

export async function resumeTaskExecution(
  taskId: string,
  organizationId: string,
): Promise<void> {
  const [session] = await db
    .select()
    .from(executionSessionsTable)
    .where(
      and(
        eq(executionSessionsTable.taskId, taskId),
        eq(executionSessionsTable.organizationId, organizationId),
      ),
    )
    .orderBy(desc(executionSessionsTable.createdAt))
    .limit(1);

  if (!session) {
    throw Object.assign(new Error("No active execution session found"), { code: "RESOURCE_NOT_FOUND" });
  }

  const engine = getEngine();
  await engine.resumeExecution(session.id, organizationId);
}

// ─── Execution events ─────────────────────────────────────────────────────────

export async function getExecutionEvents(
  taskId: string,
  organizationId: string,
  limit = 50,
) {
  const [session] = await db
    .select({ id: executionSessionsTable.id })
    .from(executionSessionsTable)
    .where(
      and(
        eq(executionSessionsTable.taskId, taskId),
        eq(executionSessionsTable.organizationId, organizationId),
      ),
    )
    .orderBy(desc(executionSessionsTable.createdAt))
    .limit(1);

  if (!session) return [];

  return db
    .select()
    .from(executionEventsTable)
    .where(
      and(
        eq(executionEventsTable.executionSessionId, session.id),
        eq(executionEventsTable.organizationId, organizationId),
      ),
    )
    .orderBy(desc(executionEventsTable.occurredAt))
    .limit(limit);
}

// ─── Platform monitoring ──────────────────────────────────────────────────────

export async function getRuntimeHealth() {
  const engine = getEngine();
  return engine.getHealth();
}

export { getEngine as getExecutionEngine };
