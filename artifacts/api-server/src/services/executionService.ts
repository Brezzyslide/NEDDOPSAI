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

import { randomUUID, createHash } from "crypto";
import { eq, and, desc } from "drizzle-orm";
import {
  db,
  tasksTable,
  taskExecutionPlansTable,
  executionSessionsTable,
  executionEventsTable,
} from "@workspace/db";
import type {
  BlueprintExecutionContractSnapshot,
  ExecutionAuthorityValidationSnapshot,
  ExecutionPackage,
  ExecutionSessionInfo,
  CompiledRuntimeInstructions,
} from "@workspace/agent-runtime";
import { assembleRuntimeInstructions } from "@workspace/agent-runtime";
import {
  OpenClawExecutionEngine,
  loadOpenClawConfig,
  isOpenClawConfigured,
  getStatusMessage,
} from "@workspace/openclaw";
import { getActiveWorkerProfilesForRole, type WorkerProfile } from "../lib/workerProfileRegistry.js";
import { checkExecutionAccess } from "./executionPolicy.js";
import { executeWork } from "./workExecutionPipelineService.js";
import { getMembershipForUser } from "./membershipService.js";
import {
  reconcileTaskExecutionFailure,
  reconcileTaskExecutionSuccess,
} from "./taskService.js";
import {
  resolveAndCompileManifest,
  buildManifestAuditRecord,
  MissingDNAError,
  InactiveDNAError,
} from "./specialistRuntimeManifestService.js";
import { loadSpecialistContext } from "./specialistContextService.js";
import {
  getBlueprintById,
  getBlueprintExecutionContract,
  type BlueprintExecutionContract,
} from "./workBlueprintService.js";
import { getRegistryEntry, resolveRegistryCodeForNewWork, resolveRegistryProfessionalOwner } from "./blueprintRegistry.js";

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

async function getTaskForExecutionSubmission(taskId: string, organizationId: string) {
  const [task] = await db
    .select()
    .from(tasksTable)
    .where(and(eq(tasksTable.id, taskId), eq(tasksTable.organizationId, organizationId)))
    .limit(1);

  if (!task) {
    throw Object.assign(new Error("Task not found"), { code: "RESOURCE_NOT_FOUND" });
  }

  if (task.currentState === "approved") {
    return task;
  }

  if (task.currentState === "executing") {
    const [session] = await db
      .select()
      .from(executionSessionsTable)
      .where(and(
        eq(executionSessionsTable.taskId, taskId),
        eq(executionSessionsTable.organizationId, organizationId),
      ))
      .orderBy(desc(executionSessionsTable.createdAt))
      .limit(1);

    if (session?.currentStatus === "pending") {
      return task;
    }
  }

  throw Object.assign(
    new Error(
      `Task must be in 'approved' state before submission, or already 'executing' with a pending runtime session. Current state: '${task.currentState}'`,
    ),
    { code: "VALIDATION_ERROR" },
  );
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

interface ContextAudit {
  injectedMemoryIds: string[];
  hasOrganisationContext: boolean;
  tokenBudgetUsed: number;
}

function mapWorkerProfileChannelToRuntimeChannel(
  channel: string,
): ExecutionPackage["workerProfile"]["allowedChannels"][number] {
  switch (channel) {
    case "web_browser":
      return "browser";
    case "local_files":
      return "local_files";
    case "internal_api":
    case "document_store":
    case "calendar_system":
    case "email_system":
    case "database_query":
      return "internal";
    default:
      return "internal";
  }
}

function mapWorkerProfileRiskLevel(
  riskLevel: string,
): ExecutionPackage["workerProfile"]["riskLevel"] {
  return riskLevel === "critical" ? "high" : riskLevel as ExecutionPackage["workerProfile"]["riskLevel"];
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

export class PreDispatchAuthorityError extends Error {
  code = "PRE_DISPATCH_AUTHORITY_DENIED";
  decision: ExecutionAuthorityValidationSnapshot;

  constructor(message: string, decision: ExecutionAuthorityValidationSnapshot) {
    super(message);
    this.name = "PreDispatchAuthorityError";
    this.decision = decision;
  }
}

export function buildWorkerProfileExecutionConstraints(
  profile: WorkerProfile,
): ExecutionPackage["workerProfile"] {
  return {
    allowedChannels: unique(
      profile.allowedExecutionChannels.map(mapWorkerProfileChannelToRuntimeChannel),
    ),
    allowedBrowserDomains: profile.allowedBrowserDomains ?? [],
    allowedLocalPathCategories: profile.allowedLocalPathCategories ?? [],
    allowedApplicationCategories: profile.allowedApplicationCategories ?? [],
    prohibitedActions: profile.prohibitedActions ?? [],
    riskLevel: mapWorkerProfileRiskLevel(profile.riskLevel),
    requiresApprovalFor: profile.approvalRequiredActions ?? [],
  };
}

function failClosedDecision(input: {
  reason: string;
  organizationId: string;
  taskId: string;
  executionId: string;
  specialistRole: string;
  dnaVersion: string;
  dnaHash: string;
  workerProfileCode?: string | null;
  workerProfileVersion?: string | null;
  requestedChannels?: ExecutionPackage["requestedChannels"];
  requestedTools?: string[];
  requestedConnectorCategories?: string[];
  prohibitedActions?: string[];
  approvalRequiredActions?: string[];
  blueprintCode?: string | null;
  blueprintVersion?: string | null;
  decision?: ExecutionAuthorityValidationSnapshot["decision"];
}): ExecutionAuthorityValidationSnapshot {
  return {
    decision: input.decision ?? "UNMAPPED_AUTHORITY",
    reason: input.reason,
    validatedAt: new Date().toISOString(),
    organizationId: input.organizationId,
    taskId: input.taskId,
    executionId: input.executionId,
    specialistRole: input.specialistRole,
    dnaVersion: input.dnaVersion,
    dnaHash: input.dnaHash,
    workerProfileCode: input.workerProfileCode ?? "UNRESOLVED",
    workerProfileVersion: input.workerProfileVersion ?? "UNRESOLVED",
    blueprintCode: input.blueprintCode ?? null,
    blueprintVersion: input.blueprintVersion ?? null,
    requestedChannels: input.requestedChannels ?? [],
    requestedTools: input.requestedTools ?? [],
    requestedConnectorCategories: input.requestedConnectorCategories ?? [],
    prohibitedActions: input.prohibitedActions ?? [],
    approvalRequiredActions: input.approvalRequiredActions ?? [],
  };
}

function resolvePrimaryWorkerProfileOrThrow(input: {
  primaryRole: string;
  organizationId: string;
  taskId: string;
  executionId: string;
  dnaVersion: string;
  dnaHash: string;
}): WorkerProfile {
  const profiles = getActiveWorkerProfilesForRole(input.primaryRole);
  const profile = profiles[0];
  if (!profile) {
    const decision = failClosedDecision({
      reason: `No active WorkerProfile resolves for runtime-ready specialist "${input.primaryRole}"`,
      organizationId: input.organizationId,
      taskId: input.taskId,
      executionId: input.executionId,
      specialistRole: input.primaryRole,
      dnaVersion: input.dnaVersion,
      dnaHash: input.dnaHash,
    });
    throw new PreDispatchAuthorityError(decision.reason, decision);
  }
  return profile;
}

function getPlanBlueprintId(planData: Record<string, unknown>): string | null {
  const direct = planData.blueprintId;
  if (typeof direct === "string" && direct.trim()) return direct;
  const nested = planData.blueprint;
  if (nested && typeof nested === "object" && "id" in nested) {
    const id = (nested as { id?: unknown }).id;
    if (typeof id === "string" && id.trim()) return id;
  }
  return null;
}

function getPlanBlueprintCode(planData: Record<string, unknown>): string | null {
  const direct = planData.blueprintCode ?? planData.canonicalIntent;
  if (typeof direct === "string" && direct.trim()) return direct;
  const nested = planData.blueprint;
  if (nested && typeof nested === "object" && "code" in nested) {
    const code = (nested as { code?: unknown }).code;
    if (typeof code === "string" && code.trim()) return code;
  }
  return null;
}

function buildBlueprintSnapshotFromExecutionContract(
  contract: BlueprintExecutionContract,
): BlueprintExecutionContractSnapshot {
  const sectionNames = contract.sections.map(section => section.title ?? section.code ?? section.id);
  const deliverableContract = contract.blueprint.deliverableContract as Record<string, unknown> | null;
  const evidenceContract = contract.blueprint.evidenceContract as Record<string, unknown> | null;
  const prohibitedDeliverables = Array.isArray(deliverableContract?.prohibitedDeliverables)
    ? deliverableContract.prohibitedDeliverables.filter((v): v is string => typeof v === "string")
    : [];

  return {
    blueprintId: contract.blueprint.id,
    blueprintCode: contract.blueprint.code,
    blueprintVersion: contract.blueprint.version,
    blueprintFamily: contract.blueprint.blueprintFamily,
    primarySpecialist: contract.blueprint.primarySpecialist,
    supportingSpecialists: contract.blueprint.supportingSpecialists,
    primaryDeliverable: contract.blueprint.primaryDeliverable,
    deliverableContract,
    evidenceContract,
    requiredSections: sectionNames,
    requiredTemplate: contract.template?.id ?? contract.blueprint.defaultTemplateId ?? null,
    prohibitedActions: prohibitedDeliverables,
    approvalRequirements: Object.keys(contract.blueprint.requiredApprovals ?? {}),
    externalAuthorityRequiredFor: [],
    professionalAuthority: "needsops_ai",
  };
}

function buildBlueprintSnapshotFromRegistryCode(
  code: string,
): BlueprintExecutionContractSnapshot | null {
  const entry = getRegistryEntry(resolveRegistryCodeForNewWork(code));
  if (!entry) return null;
  return {
    blueprintCode: entry.code,
    blueprintVersion: "registry-placeholder",
    blueprintId: null,
    blueprintFamily: entry.blueprintFamily,
    primarySpecialist: resolveRegistryProfessionalOwner(entry),
    supportingSpecialists: [],
    professionalAuthority: entry.professionalAuthority ?? null,
    primaryDeliverable: entry.primaryDeliverable,
    deliverableContract: null,
    evidenceContract: null,
    requiredSections: [],
    requiredTemplate: null,
    prohibitedActions: [],
    approvalRequirements: [],
    externalAuthorityRequiredFor: entry.externalAuthorityRequiredFor ?? [],
  };
}

async function resolveBlueprintContractSnapshot(
  planData: Record<string, unknown>,
  organizationId: string,
): Promise<BlueprintExecutionContractSnapshot | null> {
  const blueprintId = getPlanBlueprintId(planData);
  if (blueprintId) {
    const blueprint = await getBlueprintById(blueprintId, organizationId);
    if (!blueprint) {
      throw Object.assign(new Error(`Blueprint "${blueprintId}" could not be resolved for execution`), {
        code: "BLUEPRINT_CONTRACT_UNRESOLVED",
      });
    }
    return buildBlueprintSnapshotFromExecutionContract(
      await getBlueprintExecutionContract(blueprint, organizationId),
    );
  }

  const blueprintCode = getPlanBlueprintCode(planData);
  if (!blueprintCode) return null;

  const snapshot = buildBlueprintSnapshotFromRegistryCode(blueprintCode);
  if (!snapshot) {
    throw Object.assign(new Error(`Blueprint code "${blueprintCode}" could not be resolved for execution`), {
      code: "BLUEPRINT_CONTRACT_UNRESOLVED",
    });
  }
  return snapshot;
}

export function validateOpenClawExecutionPackageAuthority(input: {
  pkg: ExecutionPackage;
  workerProfile?: WorkerProfile | null;
  blueprintContract?: BlueprintExecutionContractSnapshot | null;
}): ExecutionAuthorityValidationSnapshot {
  const { pkg, workerProfile, blueprintContract } = input;
  if (!workerProfile) {
    return failClosedDecision({
      reason: "WorkerProfile authority is missing or unresolved; OpenClaw dispatch is not permitted",
      organizationId: pkg.tenantId,
      taskId: pkg.taskId,
      executionId: pkg.executionId,
      specialistRole: pkg.workforceRole,
      dnaVersion: pkg.specialistManifest.dnaVersion,
      dnaHash: pkg.specialistManifest.manifestHash,
      requestedChannels: pkg.requestedChannels,
      requestedTools: pkg.requestedTools,
      requestedConnectorCategories: pkg.requestedConnectorCategories,
      prohibitedActions: pkg.workerProfile?.prohibitedActions ?? [],
      approvalRequiredActions: pkg.workerProfile?.requiresApprovalFor ?? [],
      blueprintCode: blueprintContract?.blueprintCode ?? null,
      blueprintVersion: blueprintContract?.blueprintVersion ?? null,
    });
  }

  const expectedChannels = buildWorkerProfileExecutionConstraints(workerProfile).allowedChannels;
  const allowedTools = new Set(workerProfile.allowedToolCategories);
  const allowedConnectors = new Set(workerProfile.allowedConnectorCategories);
  const requestedOutsideChannels = pkg.requestedChannels.filter(ch => !expectedChannels.includes(ch));
  const requestedOutsideTools = pkg.requestedTools.filter(tool => !allowedTools.has(tool as never));
  const requestedOutsideConnectors = pkg.requestedConnectorCategories.filter(cc => !allowedConnectors.has(cc as never));
  const profileProhibitions = workerProfile.prohibitedActions ?? [];
  const missingProfileProhibitions = profileProhibitions.filter(action => !pkg.workerProfile.prohibitedActions.includes(action));
  const blueprintProhibitions = blueprintContract?.prohibitedActions ?? [];
  const missingBlueprintProhibitions = blueprintProhibitions.filter(action => !pkg.workerProfile.prohibitedActions.includes(action));
  const missingApprovals = (workerProfile.approvalRequiredActions ?? [])
    .filter(action => !pkg.workerProfile.requiresApprovalFor.includes(action));

  const failure =
    requestedOutsideChannels.length > 0
      ? `Execution package requests channels outside WorkerProfile: ${requestedOutsideChannels.join(", ")}`
      : requestedOutsideTools.length > 0
      ? `Execution package requests tools outside WorkerProfile: ${requestedOutsideTools.join(", ")}`
      : requestedOutsideConnectors.length > 0
      ? `Execution package requests connectors outside WorkerProfile: ${requestedOutsideConnectors.join(", ")}`
      : missingProfileProhibitions.length > 0
      ? `Execution package removed WorkerProfile prohibitions: ${missingProfileProhibitions.join(", ")}`
      : missingBlueprintProhibitions.length > 0
      ? `Execution package removed Blueprint prohibitions: ${missingBlueprintProhibitions.join(", ")}`
      : missingApprovals.length > 0
      ? `Execution package removed WorkerProfile approval gates: ${missingApprovals.join(", ")}`
      : null;

  if (failure) {
    return failClosedDecision({
      decision: "PROHIBITED",
      reason: failure,
      organizationId: pkg.tenantId,
      taskId: pkg.taskId,
      executionId: pkg.executionId,
      specialistRole: pkg.workforceRole,
      dnaVersion: pkg.specialistManifest.dnaVersion,
      dnaHash: pkg.specialistManifest.manifestHash,
      workerProfileCode: workerProfile.code,
      workerProfileVersion: workerProfile.version,
      requestedChannels: pkg.requestedChannels,
      requestedTools: pkg.requestedTools,
      requestedConnectorCategories: pkg.requestedConnectorCategories,
      prohibitedActions: pkg.workerProfile.prohibitedActions,
      approvalRequiredActions: pkg.workerProfile.requiresApprovalFor,
      blueprintCode: blueprintContract?.blueprintCode ?? null,
      blueprintVersion: blueprintContract?.blueprintVersion ?? null,
    });
  }

  return failClosedDecision({
    decision: "PERMITTED",
    reason: "NeedsOps pre-dispatch authority validation passed",
    organizationId: pkg.tenantId,
    taskId: pkg.taskId,
    executionId: pkg.executionId,
    specialistRole: pkg.workforceRole,
    dnaVersion: pkg.specialistManifest.dnaVersion,
    dnaHash: pkg.specialistManifest.manifestHash,
    workerProfileCode: workerProfile.code,
    workerProfileVersion: workerProfile.version,
    requestedChannels: pkg.requestedChannels,
    requestedTools: pkg.requestedTools,
    requestedConnectorCategories: pkg.requestedConnectorCategories,
    prohibitedActions: pkg.workerProfile.prohibitedActions,
    approvalRequiredActions: pkg.workerProfile.requiresApprovalFor,
    blueprintCode: blueprintContract?.blueprintCode ?? null,
    blueprintVersion: blueprintContract?.blueprintVersion ?? null,
  });
}

async function buildExecutionPackage(
  task: typeof tasksTable.$inferSelect,
  planRow: typeof taskExecutionPlansTable.$inferSelect,
  config: ReturnType<typeof loadOpenClawConfig>,
): Promise<ExecutionPackage & { dnaSource: "database" | "static_fallback"; contextAudit: ContextAudit }> {
  const executionId = randomUUID();
  const now = new Date();

  // Extract plan data from JSONB
  const planData = planRow.planData as {
    assignedSpecialists?: string[];
    primarySpecialist?: string;
    steps?: Array<{
      specialist?: string;
      action?: string;
      description?: string;
      requiresApproval?: boolean;
    }>;
    requiresApproval?: boolean;
    approvalType?: string;
  };

  const primaryRole = planData.primarySpecialist ?? planData.assignedSpecialists?.[0] ?? "chief_of_staff";

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
  // Uses the DB-first resolver (resolveAndCompileManifest) with the static
  // registry as a fallback when ALLOW_STATIC_DNA_FALLBACK=true.
  //
  // This must happen AFTER the eligibility/entitlement check in submitTaskExecution.
  // Throws MissingDNAError or InactiveDNAError — callers must handle these.
  const { dnaSource, ...specialistManifest } = await resolveAndCompileManifest(
    primaryRole,
    task.organizationId,
  );

  const profile = resolvePrimaryWorkerProfileOrThrow({
    primaryRole,
    organizationId: task.organizationId,
    taskId: task.id,
    executionId,
    dnaVersion: specialistManifest.dnaVersion,
    dnaHash: specialistManifest.manifestHash,
  });
  const blueprintContract = await resolveBlueprintContractSnapshot(
    planData as Record<string, unknown>,
    task.organizationId,
  );
  const workerProfileConstraints = buildWorkerProfileExecutionConstraints(profile);
  workerProfileConstraints.prohibitedActions = unique([
    ...workerProfileConstraints.prohibitedActions,
    ...(blueprintContract?.prohibitedActions ?? []),
  ]);

  const constraints: ExecutionPackage["constraints"] = {
    maxDurationSeconds: 300,
    requireHumanApprovalBeforeSubmit: planData.requiresApproval ?? false,
    allowedDataCategories: ["task_context", "internal"],
  };

  // ── Phase A (Knowledge Bridge): Load per-specialist organisation context ──
  // Retrieves approved org memory (scoped to this specialist or org-wide),
  // specialist config (goals, style, escalation), language profile, and
  // (Task #17) retrieved knowledge document chunks from the Organisation Library.
  // Degrades gracefully — never blocks execution if any context load fails.
  const specialistContext = await loadSpecialistContext(
    task.organizationId,
    primaryRole,
    undefined,  // use default token budget
    {
      // Use task title + description as query for hybrid retrieval
      query:        task.description ? `${task.title}: ${task.description}` : task.title,
      taskId:       task.id,
      executionId,
      writeAudit:   true,
    },
  );

  // ── Phase 1 (SRM Hardening): Assemble runtime instructions ──────────────
  // This is the ACTIVE instruction string passed to OpenClaw.
  // It is generated immediately before the OpenClaw call from:
  //   - specialistManifest   (identity + behaviour layer)
  //   - steps                (current task)
  //   - constraints          (hard limits)
  //   - specialistContext    (organisation-specific context — Task #14)
  //
  // The raw specialistManifest is also retained in the package for auditability.
  // The workerProfile is NOT included in the instruction text — it is enforced
  // structurally by the broker and tool layer.
  const assembled = assembleRuntimeInstructions(
    specialistManifest,
    steps,
    constraints,
    specialistContext,
  );
  const instructionHash = createHash("sha256")
    .update(assembled.instruction, "utf8")
    .digest("hex");

  const runtimeInstructions: CompiledRuntimeInstructions = {
    instruction:     assembled.instruction,
    instructionHash,
    manifestHash:    specialistManifest.manifestHash,
    dnaVersion:      specialistManifest.dnaVersion,
    specialistId:    specialistManifest.specialistId,
    compiledAt:      new Date().toISOString(),
  };

  const pkg: ExecutionPackage & { dnaSource: "database" | "static_fallback"; contextAudit: ContextAudit } = {
    executionId,
    taskId: task.id,
    tenantId: task.organizationId,
    workforceRole: primaryRole,
    specialistManifest,
    runtimeInstructions,
    workerProfile: workerProfileConstraints,
    steps,
    requestedTools: profile.allowedToolCategories,
    requestedChannels: workerProfileConstraints.allowedChannels,
    requestedConnectorCategories: profile.allowedConnectorCategories,
    blueprintContract,
    approvalState: task.approvalState,
    constraints,
    callbackUrl: "", // resolved by engine from OPENCLAW_CALLBACK_BASE_URL
    expiresAt,
    issuedAt: now.toISOString(),
    dnaSource,
    contextAudit: {
      injectedMemoryIds: assembled.injectedMemoryIds,
      hasOrganisationContext: assembled.hasOrganisationContext,
      tokenBudgetUsed: specialistContext.tokenBudgetUsed,
    },
  };

  const authorityValidation = validateOpenClawExecutionPackageAuthority({
    pkg,
    workerProfile: profile,
    blueprintContract,
  });
  pkg.authorityValidation = authorityValidation;
  if (authorityValidation.decision !== "PERMITTED") {
    throw new PreDispatchAuthorityError(authorityValidation.reason, authorityValidation);
  }

  return pkg;
}

function requiresOpenClawRuntime(pkg: ExecutionPackage): boolean {
  const desktopChannels = new Set<ExecutionPackage["requestedChannels"][number]>([
    "browser",
    "local_files",
    "local_applications",
  ]);
  // requestedConnectorCategories currently represents the WorkerProfile's
  // permitted connector surface, not a task-specific connector requirement.
  // Do not force AWS-native professional work through a desktop broker merely
  // because a specialist may use document management in other tasks.
  return pkg.requestedChannels.some(channel => desktopChannels.has(channel));
}

async function getLatestExecutionSession(taskId: string, organizationId: string) {
  const [session] = await db
    .select()
    .from(executionSessionsTable)
    .where(and(
      eq(executionSessionsTable.taskId, taskId),
      eq(executionSessionsTable.organizationId, organizationId),
    ))
    .orderBy(desc(executionSessionsTable.createdAt))
    .limit(1);
  return session ?? null;
}

async function persistExecutionEvent(input: {
  executionSessionId: string;
  organizationId: string;
  eventType: string;
  eventSource: string;
  payload: Record<string, unknown>;
}) {
  await db.insert(executionEventsTable).values({
    id: randomUUID(),
    executionSessionId: input.executionSessionId,
    organizationId: input.organizationId,
    eventType: input.eventType,
    eventSource: input.eventSource,
    payload: input.payload,
    occurredAt: new Date(),
  }).catch(() => {});
}

async function startAwsNativeExecution(input: {
  task: typeof tasksTable.$inferSelect;
  pkg: ExecutionPackage & { dnaSource?: "database" | "static_fallback"; contextAudit?: ContextAudit };
  requestedByUserId: string;
  manifestAudit?: Record<string, unknown>;
  resumeExistingSession?: boolean;
}) {
  const now = new Date();
  const taskDescription = input.task.description ?? input.task.title;
  const membership = await getMembershipForUser(input.task.organizationId, input.requestedByUserId);
  const requesterRole = membership?.role;

  await db.insert(executionSessionsTable).values({
    id: input.pkg.executionId,
    taskId: input.task.id,
    organizationId: input.task.organizationId,
    runtimeName: "aws_native",
    currentStatus: "running",
    executionPackage: input.pkg as unknown as Record<string, unknown>,
    metadata: {
      runtimeSelection: "aws_native_professional_work",
      runtimeReason: "Package requires only AWS-internal API/model/database execution; no browser, local file, or local application channel requested.",
      manifestAudit: input.manifestAudit ?? null,
      resumedFromPendingBrokerSession: input.resumeExistingSession === true,
    },
    submittedAt: now,
    startedAt: now,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: executionSessionsTable.id,
    set: {
      runtimeName: "aws_native",
      currentStatus: "running",
      metadata: {
        runtimeSelection: "aws_native_professional_work",
        runtimeReason: "Package requires only AWS-internal API/model/database execution; no browser, local file, or local application channel requested.",
        manifestAudit: input.manifestAudit ?? null,
        resumedFromPendingBrokerSession: input.resumeExistingSession === true,
      },
      submittedAt: now,
      startedAt: now,
      updatedAt: now,
      errorMessage: null,
    },
  });

  await db
    .update(tasksTable)
    .set({ currentState: "executing", updatedAt: now })
    .where(eq(tasksTable.id, input.task.id));

  await persistExecutionEvent({
    executionSessionId: input.pkg.executionId,
    organizationId: input.task.organizationId,
    eventType: "execution.started",
    eventSource: "aws_native",
    payload: {
      taskId: input.task.id,
      workforceRole: input.pkg.workforceRole,
      blueprintCode: input.pkg.blueprintContract?.blueprintCode ?? null,
    },
  });

  const run = async () => {
    try {
      const result = await executeWork({
        organizationId: input.task.organizationId,
        requesterId: input.requestedByUserId,
        requesterRole,
        userRequest: taskDescription,
        blueprintCode: input.pkg.blueprintContract?.blueprintCode ?? undefined,
        blueprintId: input.pkg.blueprintContract?.blueprintId ?? undefined,
        canonicalIntent: input.pkg.blueprintContract?.blueprintCode ?? undefined,
        title: input.task.title,
        taskId: input.task.id,
        outputRequiresApproval: true,
      });

      if (result.outcome === "completed") {
        const reconciliation = await reconcileTaskExecutionSuccess({
          taskId: input.task.id,
          organizationId: input.task.organizationId,
          completedWorkId: result.completedWorkId,
          completedWorkStatus: result.completedWorkStatus,
          correlationId: input.pkg.executionId,
          requestedByUserId: input.requestedByUserId,
        });
        await db
          .update(executionSessionsTable)
          .set({
            currentStatus: "completed",
            completedAt: new Date(),
            updatedAt: new Date(),
            metadata: {
              runtimeSelection: "aws_native_professional_work",
              runtimeReason: "Package requires only AWS-internal API/model/database execution; no browser, local file, or local application channel requested.",
              manifestAudit: input.manifestAudit ?? null,
              resumedFromPendingBrokerSession: input.resumeExistingSession === true,
              outcome: result.outcome,
              completedWorkId: result.completedWorkId,
              completedWorkStatus: result.completedWorkStatus,
              taskReconciliation: reconciliation.status,
              workPackageManifestId: result.manifestId,
              blueprintCode: result.blueprintCode,
            },
          })
          .where(eq(executionSessionsTable.id, input.pkg.executionId));
        await persistExecutionEvent({
          executionSessionId: input.pkg.executionId,
          organizationId: input.task.organizationId,
          eventType: "execution.completed",
          eventSource: "aws_native",
          payload: {
            completedWorkId: result.completedWorkId,
            completedWorkStatus: result.completedWorkStatus,
            taskReconciliation: reconciliation.status,
            manifestId: result.manifestId,
          },
        });
        return;
      }

      const terminalStatus = result.outcome === "awaiting_clarification" ? "awaiting_approval" : "failed";
      if (terminalStatus === "failed") {
        await reconcileTaskExecutionFailure({
          taskId: input.task.id,
          organizationId: input.task.organizationId,
          errorMessage: result.message,
          correlationId: input.pkg.executionId,
        });
      }
      await db
        .update(executionSessionsTable)
        .set({
          currentStatus: terminalStatus,
          completedAt: new Date(),
          errorMessage: terminalStatus === "failed" ? result.message : null,
          updatedAt: new Date(),
          metadata: {
            runtimeSelection: "aws_native_professional_work",
            runtimeReason: "Package requires only AWS-internal API/model/database execution; no browser, local file, or local application channel requested.",
            manifestAudit: input.manifestAudit ?? null,
            resumedFromPendingBrokerSession: input.resumeExistingSession === true,
            outcome: result.outcome,
            message: result.message,
            workPackageManifestId: result.manifestId,
            blueprintCode: result.blueprintCode,
          },
        })
        .where(eq(executionSessionsTable.id, input.pkg.executionId));
      await persistExecutionEvent({
        executionSessionId: input.pkg.executionId,
        organizationId: input.task.organizationId,
        eventType: terminalStatus === "failed" ? "execution.failed" : "execution.awaiting_approval",
        eventSource: "aws_native",
        payload: { outcome: result.outcome, message: result.message, manifestId: result.manifestId },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown AWS-native execution error";
      await reconcileTaskExecutionFailure({
        taskId: input.task.id,
        organizationId: input.task.organizationId,
        errorMessage: message,
        correlationId: input.pkg.executionId,
      }).catch(() => {});
      await db
        .update(executionSessionsTable)
        .set({
          currentStatus: "failed",
          completedAt: new Date(),
          errorMessage: message,
          updatedAt: new Date(),
        })
        .where(eq(executionSessionsTable.id, input.pkg.executionId));
      await persistExecutionEvent({
        executionSessionId: input.pkg.executionId,
        organizationId: input.task.organizationId,
        eventType: "execution.failed",
        eventSource: "aws_native",
        payload: { error: message },
      });
    }
  };

  void run();
}

// ─── Submit execution ─────────────────────────────────────────────────────────

export async function submitTaskExecution(
  input: SubmitExecutionInput,
): Promise<ExecutionSubmitResult> {
  const engine = getEngine();
  const config = loadOpenClawConfig();

  // 1. Verify task is approved, or resume an already executing task whose
  //    only session is still pending runtime connection.
  const [task, planRow] = await Promise.all([
    getTaskForExecutionSubmission(input.taskId, input.organizationId),
    getTaskPlan(input.taskId),
  ]);

  const existingPendingSession = task.currentState === "executing"
    ? await getLatestExecutionSession(task.id, task.organizationId)
    : null;

  if (existingPendingSession?.currentStatus === "pending") {
    const storedPackage = existingPendingSession.executionPackage as unknown as
      (ExecutionPackage & { dnaSource?: "database" | "static_fallback"; contextAudit?: ContextAudit }) | null;
    if (!storedPackage?.executionId) {
      throw Object.assign(
        new Error("Pending execution session does not contain a resumable execution package."),
        { code: "VALIDATION_ERROR" },
      );
    }
    if (!requiresOpenClawRuntime(storedPackage)) {
      await startAwsNativeExecution({
        task,
        pkg: storedPackage,
        requestedByUserId: input.requestedByUserId,
        manifestAudit: (existingPendingSession.metadata as Record<string, unknown> | null)?.manifestAudit as Record<string, unknown> | undefined,
        resumeExistingSession: true,
      });
      return {
        executionId: storedPackage.executionId,
        outcome: "accepted",
        statusMessage: "AWS-native professional execution accepted.",
        runtimeExecutionId: storedPackage.executionId,
      };
    }
  }

  // 2. Provider-independent execution gate (Steps 4–8)
  //    Checks subscription state, feature entitlement, workforce pack,
  //    execution channels, and usage allowance — using NeedsOps internal
  //    tables only. No billing provider is consulted here.
  const planData = planRow.planData as { assignedSpecialists?: string[]; primarySpecialist?: string };
  const primaryRole = planData.primarySpecialist ?? planData.assignedSpecialists?.[0] ?? "chief_of_staff";

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

  // 3. Build the package (compiles specialist manifest from DNA + assembles runtime instructions)
  let pkg: Awaited<ReturnType<typeof buildExecutionPackage>>;
  try {
    pkg = await buildExecutionPackage(task, planRow, config);
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

  if (pkg.authorityValidation?.decision !== "PERMITTED") {
    const decision = pkg.authorityValidation ?? failClosedDecision({
      reason: "Execution package is missing NeedsOps pre-dispatch authority validation",
      organizationId: task.organizationId,
      taskId: task.id,
      executionId: pkg.executionId,
      specialistRole: pkg.workforceRole,
      dnaVersion: pkg.specialistManifest.dnaVersion,
      dnaHash: pkg.specialistManifest.manifestHash,
      requestedChannels: pkg.requestedChannels,
      requestedTools: pkg.requestedTools,
      requestedConnectorCategories: pkg.requestedConnectorCategories,
      prohibitedActions: pkg.workerProfile.prohibitedActions,
      approvalRequiredActions: pkg.workerProfile.requiresApprovalFor,
      blueprintCode: pkg.blueprintContract?.blueprintCode ?? null,
      blueprintVersion: pkg.blueprintContract?.blueprintVersion ?? null,
    });
    throw new PreDispatchAuthorityError(decision.reason, decision);
  }

  // 3a. Record manifest + instruction audit event (including injected context IDs)
  const auditRecord = buildManifestAuditRecord(
    pkg.specialistManifest,
    pkg.executionId,
    {
      instructionHash: pkg.runtimeInstructions.instructionHash,
      dnaSource: pkg.dnaSource,
      injectedMemoryIds: pkg.contextAudit?.injectedMemoryIds ?? [],
      hasOrganisationContext: pkg.contextAudit?.hasOrganisationContext ?? false,
    },
  );

  // 4. AWS-native professional work does not require a desktop OpenClaw broker.
  //    OpenClaw remains the runtime for browser/local-file/local-application
  //    work and external connector operations.
  if (!requiresOpenClawRuntime(pkg)) {
    await startAwsNativeExecution({
      task,
      pkg,
      requestedByUserId: input.requestedByUserId,
      manifestAudit: auditRecord,
    });

    return {
      executionId: pkg.executionId,
      outcome: "accepted",
      statusMessage: "AWS-native professional execution accepted.",
      runtimeExecutionId: pkg.executionId,
    };
  }

  // 5. Check if desktop/runtime broker is configured for broker-required work.
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
        note: "OpenClaw runtime not configured. Session pending runtime connection for broker-required channels.",
        runtimeSelection: "openclaw_required",
        runtimeReason: "Package requested browser, local file, or local application execution that must not run AWS-native.",
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

  // 6. Submit broker-required work to OpenClaw.
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
