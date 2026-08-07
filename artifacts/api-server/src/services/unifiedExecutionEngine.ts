/**
 * Unified Execution Engine — Sprint 29B
 *
 * Single execution engine for all specialist work, regardless of trigger type.
 * Replaces the dual-pipeline architecture (conversation path vs task path).
 *
 * Before:
 *   chiefOfStaffOrchestrator → specialistIntelligenceService.executeRun()
 *   executionCoordinatorService → workExecutionPipelineService.executeWork()
 *
 * After:
 *   Any trigger → UnifiedExecutionEngine.execute(ExecutionRequest)
 *     ├─ trigger="conversation" → executeConversation() → SpecialistRunResult
 *     └─ trigger="task"|"scheduled"|"workflow" → executeTask() → ExecuteWorkResult
 *
 * Both old service files become thin adapters that delegate here.
 * The ResourceRegistry decouples evidence resolution from provider implementations.
 *
 * Three concepts remain strictly separated throughout:
 *   Evidence         — read-only content consumed before execution
 *   Resources        — live objects outside NeedsOps (connector/cloud)
 *   Execution Actions — side effects produced after output (write, send, automate)
 */

import { randomUUID, createHash } from "crypto";
import { eq } from "drizzle-orm";
import { createAIGateway } from "@workspace/ai-gateway";
import type { AIGatewayContext } from "@workspace/ai-gateway";
import {
  buildSystemInstructionForEmployee,
  buildDNASystemInstruction,
  captureSpecialistRunVersions,
} from "@workspace/workforce-dna";
import { db, specialistRunsTable } from "@workspace/db";
import type { BlueprintSelectionMetadata } from "@workspace/db";

import { selectBlueprint, getBlueprintById } from "./workBlueprintService.js";
import type { WorkBlueprint } from "./workBlueprintService.js";
import {
  assembleWorkPackage,
  updateManifestObservability,
  type WorkPackageManifest,
  type ExcludedSource,
} from "./workPackageService.js";
import { validateWorkPackage } from "./workValidationService.js";
import type { ValidationResult } from "./workValidationService.js";
import { retrieveApprovedExamples, buildStyleGuidance } from "./approvedExampleService.js";
import { reviewDraft } from "./selfReviewService.js";
import { createDraft, submitForApproval } from "./completedWorkService.js";
import {
  buildEvidenceSection,
  resolveConversationEvidence,
  type EvidencePack,
} from "./knowledgeResolutionService.js";
import { logOrgEvent } from "./auditService.js";
import { ResourceRegistry, createResourceRegistry } from "../lib/resources/ResourceRegistry.js";
import { buildExecutionContext } from "./executionContextBuilderService.js";
import {
  openExecutionSession,
  closeExecutionSession,
  markSessionError,
  recordProviderState,
} from "../lib/resources/ExecutionSession.js";
import {
  parseExecutionActions,
  validateExecutionActions,
  extractWriteTargets,
  type RawRequestedAction,
} from "./executionActionService.js";
import {
  mapConnectorCategoryToChannel,
  mapExecutionChannelToSession,
} from "./writeTargetResolverService.js";

// Type-only imports — break circular runtime dependency.
// specialistIntelligenceService will import createUnifiedExecutionEngine from here.
import type {
  SpecialistWorkPackage,
  SpecialistContext,
  SpecialistRunResult,
} from "./specialistIntelligenceService.js";
import type {
  CanonicalExecutionContext,
  ResourcePlan,
  EvidenceProvider,
  ConnectorRequirement,
} from "../types/canonicalExecutionContext.js";
import type { SessionChannel } from "../lib/resources/ExecutionSession.js";

// ─── Shared execution types ───────────────────────────────────────────────────
// Defined here; re-exported from workExecutionPipelineService for backward compat.

export type ExecutionTrigger = "conversation" | "task" | "scheduled" | "workflow";

/**
 * Optional progress callback invoked at each pipeline stage.
 * Errors thrown by the callback are swallowed so they never abort the pipeline.
 */
export type ExecutionProgressCallback = (
  stage: ExecutionStage,
  detail?: string,
) => void | Promise<void>;

export const EXECUTION_STAGE_LABELS: Record<ExecutionStage, string> = {
  selecting_blueprint:     "Selecting work blueprint…",
  assembling_package:      "Reviewing organisational knowledge…",
  retrieving_evidence:     "Searching Organisation Library…",
  validating:              "Validating requirements…",
  retrieving_examples:     "Consulting approved work examples…",
  executing:               "Consulting specialist…",
  reviewing:               "Running quality review…",
  creating_completed_work: "Preparing completed work document…",
};

export type ExecutionStage =
  | "selecting_blueprint"
  | "assembling_package"
  | "retrieving_evidence"
  | "validating"
  | "retrieving_examples"
  | "executing"
  | "reviewing"
  | "creating_completed_work";

export interface ExecuteWorkInput {
  organizationId: string;
  requesterId: string;
  /**
   * Verified org membership role. Required — execution fails with
   * execution_principal_missing if absent.
   */
  requesterRole?: string;
  userRequest: string;
  blueprintCode?: string;
  blueprintId?: string;
  taskUploadSourceIds?: string[];
  entityKnowledge?: Record<string, unknown>;
  title?: string;
  conversationId?: string;
  correlationId?: string;
  onProgress?: ExecutionProgressCallback;
  checkpointData?: ExecutionCheckpointData;
}

export type ExecutionOutcome =
  | "completed"
  | "validation_failed"
  | "awaiting_clarification"
  | "no_blueprint"
  | "execution_failed"
  | "execution_principal_missing"
  | "configuration_failure";

/**
 * Thrown when the AI provider is not configured, preventing a stub from
 * being persisted as real professional work.
 */
export class FallbackDraftError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FallbackDraftError";
  }
}

export interface ExecuteWorkResult {
  outcome: ExecutionOutcome;
  completedWorkId?: string;
  /**
   * The persisted status of the CompletedWork record after all lifecycle
   * transitions have run. Coordinators and message builders must use this
   * instead of assuming a successful approval transition.
   */
  completedWorkStatus?: string;
  /** The persisted title of the CompletedWork record (used by coordinators for accurate messaging). */
  completedWorkTitle?: string;
  manifestId?: string;
  blueprintCode?: string;
  qualityScore?: number;
  validationResult?: ValidationResult;
  message: string;
  clarificationQuestions?: string[];
}

export interface ExecutionCheckpointData {
  correlationId: string;
  blueprint: WorkBlueprint | null;
  manifest: WorkPackageManifest;
  clarificationAnswer: string;
}

// ─── Unified request / result ─────────────────────────────────────────────────

export interface ExecutionRequest {
  trigger: ExecutionTrigger;
  organisationId: string;
  requesterId: string;
  requesterRole?: string;
  userRequest: string;

  // Task execution fields
  blueprintCode?: string;
  blueprintId?: string;
  taskUploadSourceIds?: string[];
  entityKnowledge?: Record<string, unknown>;
  title?: string;
  conversationId?: string;
  correlationId?: string;
  onProgress?: ExecutionProgressCallback;
  checkpointData?: ExecutionCheckpointData;

  // Conversation execution fields
  specialistWorkPackage?: SpecialistWorkPackage;
  specialistContext?: SpecialistContext;
  additionalInstruction?: string | null;
  specialistRunId?: string;

  /**
   * Identifier-based conversation mode (Sprint 29C).
   *
   * When set, the engine uses ConversationContextBuilder to assemble
   * SpecialistWorkPackage and SpecialistContext internally from the run ID.
   * The orchestrator passes identifiers only — it does not prepare execution payloads.
   *
   * When absent, the pre-built specialistWorkPackage / specialistContext fields are used
   * (backward-compat path for revise/resume adapters in specialistIntelligenceService).
   */
  conversationSpecialistRunId?: string;

  /**
   * Whether the resulting CompletedWork item requires human approval.
   * When true (default), the engine calls submitForApproval() after createDraft(),
   * transitioning the record from draft → awaiting_approval before returning.
   * When false, the record remains in draft status.
   *
   * This flag must not be used to bypass the existing submitForApproval() lifecycle
   * method — it is the sole mechanism controlling whether that method is called.
   */
  outputRequiresApproval?: boolean;
}

export type UnifiedExecutionResult =
  | { trigger: "conversation"; runResult: SpecialistRunResult }
  | { trigger: "task" | "scheduled" | "workflow"; workResult: ExecuteWorkResult };

// ─── Specialist constants (from specialistIntelligenceService) ────────────────

const ACTIVE_SPECIALIST_VERSIONS: Record<string, string> = {
  chief_of_staff: "1.0.0",
  operations_manager: "1.0.0",
};

const RESULT_SCHEMA_DESCRIPTION = `{
  "specialistRunId": "string",
  "workforceRoleCode": "string",
  "capabilityCode": "string",
  "status": "completed" | "blocked" | "failed",
  "summary": "string — overall assessment summary",
  "findings": [{ "title": "string", "description": "string", "severity": "low"|"medium"|"high"|"critical"|null, "confidence": 0-1, "evidenceReferences": [{"referenceType": "conversation_message"|"task_memory"|"organisation_memory"|"document"|"message_attachment", "referenceId": "string (must be from provided context)", "excerpt": "string", "relevance": "string"}] }],
  "recommendations": [{ "action": "string", "reason": "string", "priority": "low"|"medium"|"high"|"critical", "approvalRequired": boolean }],
  "risks": [{ "risk": "string", "likelihood": "string?", "consequence": "string?", "treatment": "string?" }],
  "assumptions": ["string"],
  "unresolvedQuestions": [{ "question": "string", "reason": "string", "blocking": boolean }],
  "requestedExternalActions": [{ "actionType": "string", "executionChannel": "string", "toolCategory": "string", "connectorCategory": "string?", "approvalRequired": true, "riskLevel": "low"|"medium"|"high" }],
  "expectedOutputs": [{ "outputType": "string", "description": "string" }],
  "confidence": 0-1,
  "completedAt": "ISO 8601 timestamp"
}`;

const MAX_RETRIES = parseInt(process.env.SPECIALIST_MAX_RETRIES ?? "2", 10);
const RUN_TIMEOUT_MS = parseInt(process.env.SPECIALIST_RUN_TIMEOUT_MS ?? "180000", 10);
const CONTEXT_TOKEN_BUDGET = parseInt(process.env.SPECIALIST_CONTEXT_TOKEN_BUDGET ?? "8000", 10);

// Roles permitted to invoke task_execution through the AI gateway.
const EXECUTION_PERMITTED_ROLES = new Set(["owner", "administrator", "manager"]);

// ─── Unified Execution Engine ─────────────────────────────────────────────────

export class UnifiedExecutionEngine {
  constructor(private readonly resourceRegistry: ResourceRegistry) {}

  async execute(request: ExecutionRequest): Promise<UnifiedExecutionResult> {
    if (request.trigger === "conversation") {
      const runResult = await this.executeConversation(request);
      return { trigger: "conversation", runResult };
    } else {
      const workResult = await this.executeTask(request);
      return { trigger: request.trigger, workResult };
    }
  }

  // ─── Conversation execution ─────────────────────────────────────────────────

  private async executeConversation(request: ExecutionRequest): Promise<SpecialistRunResult> {
    // ─── Architecture enforcement ─────────────────────────────────────────────
    // This is the ONLY permitted entry point for conversation-triggered AI execution.
    // No service outside UnifiedExecutionEngine may call the AI gateway for
    // specialist execution. Permitted exceptions (orchestration only):
    //   evaluateConflictWithLLM()   — conflict resolution (compliance_check)
    //   chiefOfStaffLLMService      — intent classification (cos_classification)
    //   capabilityIdentificationService — capability planning (cos_capability_identification)

    // ─── Stage 1: Context assembly ────────────────────────────────────────────
    // Identifier-based mode (Sprint 29C): the orchestrator passes a specialistRunId;
    // the engine owns context assembly via ConversationContextBuilder.
    //
    // Pre-built mode (backward compat): revise/resume adapters pass fully
    // assembled specialistWorkPackage + specialistContext directly.
    let workPackage: SpecialistWorkPackage;
    let context: SpecialistContext;
    let effectiveRequesterId = request.requesterId;
    let effectiveRequesterRole = request.requesterRole ?? "system";

    if (request.conversationSpecialistRunId) {
      // Identifier-based mode — engine assembles context internally.
      // The orchestrator delegates using identifiers, not execution payloads.
      const built = await buildExecutionContext({
        specialistRunId:  request.conversationSpecialistRunId,
        organisationId:   request.organisationId,
        requesterId:      request.requesterId,
        requesterRole:    request.requesterRole,
      });
      workPackage             = built.workPackage;
      context                 = built.context;
      effectiveRequesterId    = built.effectiveRequesterId;
      effectiveRequesterRole  = built.effectiveRequesterRole;
    } else {
      // Pre-built mode — adapter has already assembled objects (revise/resume path).
      workPackage = request.specialistWorkPackage!;
      context     = request.specialistContext!;
    }

    const additionalInstruction = request.additionalInstruction ?? null;
    const runId                 = request.specialistRunId ?? workPackage.specialistRunId;
    const roleCode              = workPackage.workforceRoleCode;

    // ─── Stage 2: Evidence resolution ────────────────────────────────────────
    // Sprint 29C: conversation executions receive the same EvidencePack as task
    // executions. Both paths now use identical evidence quality — specialists
    // never know whether evidence came from a conversation or task trigger.
    const evidencePack = await this.resourceRegistry
      .resolveEvidenceForConversation({
        organisationId:  request.organisationId,
        specialistRunId: runId,
        specialistCode:  roleCode,
        userRequest:     workPackage.objective,
      })
      .catch(() => null);

    // ─── Sprint 29D: Open execution session before ctx construction ───────────
    // Session is always opened so every execution carries connection context.
    // In Sprint 29D, status stays "idle" — no connector traffic yet.
    // Connector P6 will transition to "active" when relay operations begin.
    let liveSession = openExecutionSession({
      executionId:        runId,
      organisationId:     request.organisationId,
      triggerType:        "conversation",
      allowedChannels:    deriveSessionChannels(workPackage.allowedExecutionChannels ?? []),
      maxDurationSeconds: Math.floor(RUN_TIMEOUT_MS / 1000) + 30,
    });

    // Record evidence provider state from the just-completed resolution
    liveSession = recordProviderState(liveSession, {
      provider:  "organisation_library",
      status:    evidencePack && evidencePack.totalChunks > 0 ? "available" : "not_attempted",
      checkedAt: new Date().toISOString(),
    });

    // ─── Stage 3: Build CanonicalExecutionContext ─────────────────────────────
    // Sprint 29C: CanonicalExecutionContext is now instantiated here and used as
    // the engine's internal currency. Future stages (connector, cloud, OpenClaw)
    // will consume ctx rather than individual fields from ExecutionRequest.
    // Sprint 29D: ctx now carries a live session and a complete ResourcePlan.
    //   executionActions starts as [] — populated after specialist output.
    const ctx: CanonicalExecutionContext = {
      executionId:    randomUUID(),
      triggerType:    "conversation",
      organisationId: request.organisationId,
      requesterId:    effectiveRequesterId,
      requesterRole:  effectiveRequesterRole,
      dnaVersion:     ACTIVE_SPECIALIST_VERSIONS[roleCode] ?? "N/A",
      specialistCode: roleCode,
      manifestVersion: 1,
      conversationContext: {
        conversationId: workPackage.conversationId,
        messages:       context.relevantMessages.map(m => ({
          id:      m.id,
          role:    (m.role === "assistant" ? "assistant" : m.role === "system" ? "system" : "user") as "user" | "assistant" | "system",
          content: m.content,
        })),
        unresolvedQuestions:      context.unresolvedQuestions,
        previousSpecialistOutputs: context.previousOutputs,
      },
      organisationMemory: {
        approvedMemory:   context.approvedMemory,
        pinnedDecisions:  context.pinnedDecisions,
      },
      evidence:     evidencePack,
      resourcePlan: buildConversationResourcePlan(workPackage, evidencePack),
      executionActions: [],   // Sprint 29D: always [], populated after specialist output
      blueprint:    null,
      constraints: {
        maxDurationSeconds:              Math.floor(RUN_TIMEOUT_MS / 1000),
        maxTokens:                       4000,
        requireHumanApprovalBeforeSubmit: false,
        allowedDataCategories:           ["operational"],
      },
      session: liveSession,   // Sprint 29D: always an ExecutionSession
    };

    // ─── Stage 4: Specialist validation ──────────────────────────────────────
    if (!ACTIVE_SPECIALIST_VERSIONS[roleCode]) {
      liveSession = closeExecutionSession(liveSession);
      ctx.session = liveSession;
      return {
        specialistRunId: runId,
        workforceRoleCode: roleCode,
        capabilityCode: workPackage.capabilityCode,
        status: "blocked",
        summary: "Specialist intelligence not yet activated.",
        findings: [],
        recommendations: [],
        risks: [],
        assumptions: [],
        unresolvedQuestions: [
          {
            question: `Specialist "${roleCode}" does not have active intelligence in this version of NeedsOps.`,
            reason: "Intelligence activation is gradual and role-specific.",
            blocking: true,
          },
        ],
        requestedExternalActions: [],
        expectedOutputs: [],
        confidence: 0,
        completedAt: new Date().toISOString(),
        instructionVersion: "N/A",
      } as SpecialistRunResult;
    }

    const instructionVersion = ACTIVE_SPECIALIST_VERSIONS[roleCode]!;
    const provider = (process.env.AI_PROVIDER ?? "internal").toLowerCase().trim();

    if (provider !== "openai") {
      liveSession = closeExecutionSession(liveSession);
      ctx.session = liveSession;
      return buildDeterministicResult(workPackage, runId, instructionVersion);
    }

    // ─── Stage 5: AI execution ────────────────────────────────────────────────
    const systemInstruction = buildDNASystemInstruction(roleCode);
    const userPrompt = buildSpecialistUserPrompt(workPackage, context, additionalInstruction, ctx.evidence);
    const modelName = "gpt-4o";
    const versionRecord = captureSpecialistRunVersions(roleCode, modelName);

    await db
      .update(specialistRunsTable)
      .set({
        dnaVersion: versionRecord.dnaVersion,
        workerProfileVersion: versionRecord.workerProfileVersion,
        capabilityVersion: versionRecord.capabilityVersion,
        reasoningVersion: versionRecord.reasoningVersion,
        outputSchemaVersion: versionRecord.outputSchemaVersion,
        modelVersion: versionRecord.modelVersion,
        updatedAt: new Date(),
      })
      .where(eq(specialistRunsTable.id, runId));

    // Thread requester identity into the gateway context (Sprint 29C).
    // For audit and future RBAC — no behavioural change at this stage.
    const gatewayContext: AIGatewayContext = {
      organizationId:       workPackage.organizationId,
      userId:               ctx.requesterId,
      role:                 "system",
      permissions:          [],
      purpose:              "task_execution",
      correlationId:        runId,
      provider:             "openai",
      retentionClass:       "operational",
      requiresHumanApproval: false,
    };

    const gateway = createAIGateway(gatewayContext);
    let attempt = 0;
    let lastError: Error | null = null;

    while (attempt <= MAX_RETRIES) {
      attempt++;
      try {
        const response = await Promise.race([
          gateway.process({
            systemPrompt: systemInstruction,
            userMessage: userPrompt,
            retrievedFields: [
              "task.scope",
              "organisation.memory",
              "conversation.messages",
              ...(ctx.evidence && ctx.evidence.totalChunks > 0
                ? ["organisation.library", "specialist.knowledge"]
                : []),
            ],
            model: modelName,
            maxTokens: 4000,
            outputMode: "json",
          }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("Specialist run timeout")), RUN_TIMEOUT_MS),
          ),
        ]);

        const parsed = parseAndValidateSpecialistOutput(
          response.content,
          runId,
          roleCode,
          workPackage.capabilityCode,
          workPackage,
        );

        await logRunAudit(workPackage.organizationId, "specialist.run_completed", runId, roleCode, {
          capabilityCode: workPackage.capabilityCode,
          instructionVersion,
          attempt,
          confidence: parsed.confidence,
          evidenceChunks: ctx.evidence?.totalChunks ?? 0,
          requesterId: ctx.requesterId,
        });

        // ─── Sprint 29D: Parse and persist execution action proposals ─────────
        // Specialist output may contain requestedExternalActions — convert to
        // typed ExecutionAction proposals, validate against the ResourcePlan,
        // and persist in ctx. These are planning artefacts only; the connector
        // (P6) will execute approved actions in a future sprint.
        const rawActions = (parsed.requestedExternalActions ?? []) as RawRequestedAction[];
        const parsedActions = parseExecutionActions(rawActions, runId);
        const actionValidation = validateExecutionActions(parsedActions, ctx.resourcePlan);
        ctx.executionActions = actionValidation.valid;
        ctx.resourcePlan = {
          ...ctx.resourcePlan,
          writeTargets:        extractWriteTargets(actionValidation.valid),
          approvalRequirements: actionValidation.approvalRequirements,
        };

        liveSession = closeExecutionSession(liveSession);
        ctx.session = liveSession;

        return {
          ...parsed,
          instructionVersion,
          modelProvider: "openai",
          modelName,
          inputTokens:  response.usage?.inputTokens,
          outputTokens: response.usage?.outputTokens,
        } as SpecialistRunResult;
      } catch (err: any) {
        lastError = err;
        console.error(
          `[UnifiedExecutionEngine] Conversation attempt ${attempt}/${MAX_RETRIES + 1} failed for ${roleCode}:`,
          err?.message,
        );
        if (attempt <= MAX_RETRIES) {
          await logRunAudit(workPackage.organizationId, "specialist.run_retried", runId, roleCode, {
            attempt,
            error: err?.message,
          });
          await sleep(Math.min(1000 * Math.pow(2, attempt - 1), 8000));
        }
      }
    }

    await logRunAudit(workPackage.organizationId, "specialist.run_failed", runId, roleCode, {
      error: lastError?.message,
      attempts: attempt,
    });

    liveSession = markSessionError(liveSession, lastError?.message ?? "Unknown provider error");
    ctx.session = liveSession;

    return {
      specialistRunId: runId,
      workforceRoleCode: roleCode,
      capabilityCode: workPackage.capabilityCode,
      status: "failed",
      summary: `Specialist run failed after ${attempt} attempt(s). The task may be retried.`,
      findings: [],
      recommendations: [],
      risks: [],
      assumptions: [],
      unresolvedQuestions: [
        {
          question: "Specialist run failed due to a provider error. Should this task be retried?",
          reason: lastError?.message ?? "Unknown provider error",
          blocking: true,
        },
      ],
      requestedExternalActions: [],
      expectedOutputs: [],
      confidence: 0,
      completedAt: new Date().toISOString(),
      instructionVersion,
    } as SpecialistRunResult;
  }

  // ─── Task execution ─────────────────────────────────────────────────────────

  private async executeTask(request: ExecutionRequest): Promise<ExecuteWorkResult> {
    const { organisationId: organizationId, requesterId } = request;

    if (!request.requesterRole || !EXECUTION_PERMITTED_ROLES.has(request.requesterRole)) {
      const detail = !request.requesterRole
        ? "requester role could not be resolved"
        : `role "${request.requesterRole}" is not permitted to execute work`;
      console.error(
        "[UnifiedExecutionEngine] execution_principal_missing —",
        detail,
        "| requesterId:", requesterId,
        "| correlationId:", request.correlationId,
      );
      return {
        outcome: "execution_principal_missing",
        message:
          `The work could not start because its execution authority could not be verified (${detail}). ` +
          `No work was performed. Please retry or contact support with reference ${request.correlationId ?? "unknown"}.`,
      };
    }

    const userRequest = request.checkpointData
      ? `${request.userRequest}\n\nClarification provided: ${request.checkpointData.clarificationAnswer}`
      : request.userRequest;

    const progress = async (stage: ExecutionStage, detail?: string) => {
      if (!request.onProgress) return;
      try { await request.onProgress(stage, detail); } catch { /* swallow */ }
    };

    const t0 = Date.now();
    let tBlueprintMs: number | null = null;
    let tValidationMs: number | null = null;
    let tRetrievalMs: number | null = null;
    let tLlmMs: number | null = null;
    let tReviewMs: number | null = null;

    let blueprint: WorkBlueprint | null;
    let manifest: WorkPackageManifest;
    let selectionMeta: BlueprintSelectionMetadata | undefined;

    if (request.checkpointData) {
      blueprint = request.checkpointData.blueprint;
      manifest  = request.checkpointData.manifest;
    } else {
      await progress("selecting_blueprint");
      blueprint = null;
      const t1 = Date.now();

      if (request.blueprintId) {
        blueprint = await getBlueprintById(request.blueprintId, organizationId);
        selectionMeta = { method: "keyword", confidence: 1.0, matchedKeywords: [request.blueprintId], fallbackUsed: false };
      } else if (request.blueprintCode) {
        const selection = await selectBlueprint(request.blueprintCode, organizationId);
        blueprint = selection.blueprint;
        selectionMeta = {
          method: selection.fallbackUsed ? "semantic" : "keyword",
          confidence: selection.confidence,
          matchedKeywords: selection.matchedKeywords,
          fallbackUsed: selection.fallbackUsed,
        };
      } else {
        const selection = await selectBlueprint(userRequest, organizationId);
        blueprint = selection.blueprint;
        selectionMeta = {
          method: selection.fallbackUsed ? "semantic" : (selection.matchedKeywords.length > 0 ? "keyword" : "none"),
          confidence: selection.confidence,
          matchedKeywords: selection.matchedKeywords,
          fallbackUsed: selection.fallbackUsed,
        };
      }
      tBlueprintMs = Date.now() - t1;

      await progress("assembling_package");
      const assembleResult = await assembleWorkPackage({
        organizationId,
        requesterId,
        conversationId: request.conversationId,
        blueprint,
        taskUploadSourceIds: request.taskUploadSourceIds,
        entityKnowledge: request.entityKnowledge,
        selectionMetadata: selectionMeta,
      });
      manifest = assembleResult.manifest;
    }

    // ── Sprint 29F.1 Part 5: Manifest integrity hash ──────────────────────────
    // SHA-256 of stable manifest identity fields. Stored in ctx.manifestHash and
    // written to audit so tampering or mismatched manifests can be detected before
    // connector dispatch.  We hash the identity+specialist combination rather than
    // the full manifest (which includes ephemeral timestamps) for determinism.
    const manifestHash = createHash("sha256")
      .update(JSON.stringify({
        id:         manifest.executionId,
        specialist: manifest.primarySpecialist,
        blueprint:  (manifest as any).blueprintId ?? null,
        version:    (manifest as any).blueprintVersion ?? null,
      }))
      .digest("hex");

    // Evidence resolution via ResourceRegistry — routes to KnowledgeResolutionService (P1–P5)
    await progress("retrieving_evidence");
    const t3evidence = Date.now();
    const evidencePack = await this.resourceRegistry
      .resolveEvidenceForTask({
        organisationId: organizationId,
        specialistCode: manifest.primarySpecialist,
        blueprint,
        workPackage: manifest,
        userRequest,
      })
      .catch(() => null);
    tRetrievalMs = Date.now() - t3evidence;

    // ── Sprint 29D: Open task execution session ───────────────────────────────
    // Task executions carry a session from evidence retrieval through completion.
    // Status is "idle" in Sprint 29D — Connector P6 will open live channels.
    let taskSession = openExecutionSession({
      executionId:        manifest.executionId,
      organisationId:     organizationId,
      triggerType:        request.trigger as "task" | "scheduled" | "workflow",
      allowedChannels:    ["connector", "office"],
      maxDurationSeconds: 330, // 5 min execution + 30s buffer
    });
    taskSession = recordProviderState(taskSession, {
      provider:  "organisation_library",
      status:    evidencePack && evidencePack.totalChunks > 0 ? "available" : "not_attempted",
      checkedAt: new Date().toISOString(),
    });

    // ── Sprint 29D: Build CanonicalExecutionContext for task path ─────────────
    // Sprint 29C: Both paths instantiate ctx before validation.
    // Sprint 29D: ctx now carries a complete ResourcePlan, an active session,
    // and executionActions is always [] (never null).
    const ctx: CanonicalExecutionContext = {
      executionId:    manifest.executionId,
      triggerType:    request.trigger as "task" | "scheduled" | "workflow",
      organisationId: organizationId,
      requesterId,
      requesterRole:  request.requesterRole!,
      dnaVersion:     "N/A",
      specialistCode: manifest.primarySpecialist,
      manifestVersion: 1,
      manifestHash,   // Sprint 29F.1 Part 5
      conversationContext: {
        conversationId:            request.conversationId,
        messages:                  [],
        unresolvedQuestions:       [],
        previousSpecialistOutputs: [],
      },
      organisationMemory: {
        approvedMemory:  manifest.cosMemories.map(m => ({
          id:       m.memoryId,
          content:  m.content ?? "",
          category: m.memoryType ?? "general",
        })),
        pinnedDecisions: [],
      },
      evidence:        evidencePack,
      resourcePlan:    buildTaskResourcePlan(manifest, evidencePack),
      executionActions: [],   // Sprint 29D: always [], never null
      blueprint,
      constraints: {
        maxDurationSeconds:              300,
        maxTokens:                       3000,
        requireHumanApprovalBeforeSubmit: true,
        allowedDataCategories:           ["operational"],
      },
      session: taskSession,   // Sprint 29D: always an ExecutionSession
    };

    await progress("validating");
    const t4 = Date.now();
    const validationResult = validateWorkPackage(manifest, blueprint, evidencePack ?? undefined);
    tValidationMs = Date.now() - t4;

    updateManifestObservability(manifest.id, {
      validationSnapshot: {
        passed: validationResult.passed,
        missingItems: validationResult.missingItems,
        summary: validationResult.summary,
      },
    }).catch(() => {});

    if (!validationResult.passed) {
      const missingItems = validationResult.missingEvidenceItems ?? [];
      const clarificationQuestions = validationResult.missingItems.map(
        label => `Can you provide or upload the required ${label}?`,
      );
      updateManifestObservability(manifest.id, {
        failureInfo: {
          state: "awaiting_clarification",
          clarificationItems: missingItems
            .filter(m => m.required)
            .map(m => ({ name: m.displayLabel, reason: m.reason })),
          retryAvailable: true,
        },
      }).catch(() => {});
      taskSession = closeExecutionSession(taskSession);
      ctx.session = taskSession;
      return {
        outcome: "awaiting_clarification",
        manifestId: manifest.id,
        blueprintCode: blueprint?.code,
        validationResult,
        message: validationResult.clarificationMessage || validationResult.summary,
        clarificationQuestions,
      };
    }

    await progress("retrieving_examples");
    const outputType = blueprint?.outputTypes[0] ?? "general_output";
    const examples = await retrieveApprovedExamples(organizationId, outputType);
    const styleGuidance = await buildStyleGuidance(examples, organizationId);

    await progress("executing");
    const t5 = Date.now();
    let draftContent: string;
    try {
      draftContent = await this.generateTaskDraft(
        userRequest, manifest, blueprint, styleGuidance.guidanceBlock,
        { userId: requesterId, organizationId, role: request.requesterRole! },
        evidencePack ?? undefined,
      );
      tLlmMs = Date.now() - t5;
    } catch (err) {
      const isFallback = err instanceof FallbackDraftError;
      updateManifestObservability(manifest.id, {
        failureInfo: {
          state: "failed",
          failedStage: "executing",
          rootCause: err instanceof Error ? err.message : "Unknown error",
          retryAvailable: isFallback,
        },
        performanceMetrics: {
          blueprintSelectionMs: tBlueprintMs,
          validationMs: tValidationMs,
          retrievalMs: tRetrievalMs,
          llmMs: null,
          reviewMs: null,
          totalMs: Date.now() - t0,
          evidenceCacheHit: false,
        },
      }).catch(() => {});

      if (isFallback) {
        taskSession = closeExecutionSession(taskSession);
        ctx.session = taskSession;
        return {
          outcome: "configuration_failure",
          manifestId: manifest.id,
          blueprintCode: blueprint?.code,
          message: (err as Error).message,
        };
      }
      taskSession = markSessionError(taskSession, err instanceof Error ? err.message : "Unknown error");
      ctx.session = taskSession;
      return {
        outcome: "execution_failed",
        manifestId: manifest.id,
        blueprintCode: blueprint?.code,
        message: `Specialist execution failed: ${err instanceof Error ? err.message : "Unknown error"}`,
      };
    }

    await progress("reviewing");
    const t6 = Date.now();
    const reviewResult = await reviewDraft(draftContent, manifest, blueprint, {
      organizationId,
      userId: requesterId,
      conversationId: request.conversationId,
    });
    tReviewMs = Date.now() - t6;

    await progress("creating_completed_work");
    const title = request.title ?? deriveTitleFromRequest(userRequest, blueprint);

    const citationRefBySourceId = new Map<string, string>();
    if (evidencePack) {
      for (const chunk of evidencePack.chunks) {
        if (!citationRefBySourceId.has(chunk.sourceId)) {
          citationRefBySourceId.set(chunk.sourceId, chunk.citation);
        }
      }
    }

    const assetIds = [
      ...manifest.organisationLibrarySources.map(s => ({
        assetId: s.sourceId,
        assetType: "library_source" as const,
        role: "supporting" as const,
        citationRef: citationRefBySourceId.get(s.sourceId),
      })),
      ...manifest.taskUploads.map(s => ({
        assetId: s.sourceId,
        assetType: "task_upload" as const,
        role: "primary" as const,
        citationRef: citationRefBySourceId.get(s.sourceId),
      })),
      ...manifest.cosMemories.map(m => ({
        assetId: m.memoryId,
        assetType: "memory" as const,
        role: "supporting" as const,
      })),
    ];

    const completedWork = await createDraft({
      organizationId,
      conversationId: request.conversationId,
      blueprintId: blueprint?.id,
      manifestId: manifest.id,
      primarySpecialist: manifest.primarySpecialist,
      title,
      outputType,
      contentMarkdown: reviewResult.finalContent,
      reviewResult,
      createdByUserId: requesterId,
      assetIds,
    });

    // ── Lifecycle: draft → awaiting_approval ─────────────────────────────────
    // All cloud OPS work requires human approval unless the caller explicitly
    // opts out via outputRequiresApproval: false. The existing submitForApproval()
    // lifecycle method is the sole mechanism for this transition — never update
    // the DB status column directly.
    const requiresApproval = request.outputRequiresApproval !== false;
    let finalWork = completedWork;

    if (requiresApproval) {
      try {
        finalWork = await submitForApproval(completedWork.id, organizationId, requesterId);
      } catch (err) {
        // submitForApproval failed — preserve the draft and surface the real
        // status. Do NOT claim the work is awaiting approval when it is not.
        console.warn(
          "[UnifiedExecutionEngine] submitForApproval failed — preserving draft:",
          err instanceof Error ? err.message : err,
          "| completedWorkId:", completedWork.id,
        );
        // finalWork remains as the draft — status is "draft"
      }
    }

    updateManifestObservability(manifest.id, {
      performanceMetrics: {
        blueprintSelectionMs: tBlueprintMs,
        validationMs: tValidationMs,
        retrievalMs: tRetrievalMs,
        llmMs: tLlmMs,
        reviewMs: tReviewMs,
        totalMs: Date.now() - t0,
        evidenceCacheHit: evidencePack != null,
      },
    }).catch(() => {});

    taskSession = closeExecutionSession(taskSession);
    ctx.session = taskSession;

    return {
      outcome: "completed",
      completedWorkId: finalWork.id,
      completedWorkStatus: finalWork.status,
      completedWorkTitle: finalWork.title ?? title,
      manifestId: manifest.id,
      blueprintCode: blueprint?.code,
      qualityScore: reviewResult.qualityScore,
      message: buildCompletionMessage(finalWork.id, finalWork.status, blueprint, reviewResult),
    };
  }

  // ─── Task draft generation ──────────────────────────────────────────────────

  private async generateTaskDraft(
    userRequest: string,
    manifest: WorkPackageManifest,
    blueprint: WorkBlueprint | null,
    styleGuidanceBlock: string,
    authCtx: { userId: string; organizationId: string; role: string },
    evidencePack?: EvidencePack,
  ): Promise<string> {
    const provider = (process.env.AI_PROVIDER ?? "internal").toLowerCase().trim();

    if (provider !== "openai") {
      throw new FallbackDraftError(
        `AI_PROVIDER is not configured (current: "${provider}"). ` +
        `AI specialist execution is required for professional work outputs. ` +
        `Please contact your platform administrator to configure the AI provider.`,
      );
    }

    const gatewayCtx: AIGatewayContext = {
      userId: authCtx.userId,
      organizationId: authCtx.organizationId,
      role: authCtx.role,
      permissions: [],
      purpose: "task_execution",
      correlationId: randomUUID(),
      provider: "openai",
      retentionClass: "operational",
      requiresHumanApproval: true,
    };

    const gateway = createAIGateway(gatewayCtx);
    const specialistCode = manifest.primarySpecialist;
    let systemPrompt: string;
    try {
      systemPrompt = buildSystemInstructionForEmployee(specialistCode);
    } catch {
      systemPrompt = `You are a professional specialist at a disability services organisation. Produce high-quality professional work outputs.`;
    }

    systemPrompt += buildWorkExecutionAddendum(blueprint);
    const userMessage = buildWorkPackagePrompt(userRequest, manifest, blueprint, styleGuidanceBlock, evidencePack);

    const retrievedFields: string[] = [
      "organisationLibrarySources.sourceId",
      "organisationLibrarySources.title",
      "organisationLibrarySources.sourceType",
      "organisationLibrarySources.versionLabel",
      "organisationLibrarySources.authorityLevel",
      "organisationLibrarySources.relevantChunks.text",
      "organisationLibrarySources.relevantChunks.confidence",
      "cosMemories.memoryId",
      "cosMemories.memoryType",
      "cosMemories.title",
      "cosMemories.approvalStatus",
      "cosMemories.content",
      "taskUploads.sourceId",
      "taskUploads.title",
      "taskUploads.sourceType",
      "taskUploads.versionLabel",
      "entityKnowledge.entityType",
      "entityKnowledge.entityId",
      "entityKnowledge.title",
      "entityKnowledge.relevantContent",
      "entityKnowledge.clearance",
    ];

    const response = await gateway.process({
      systemPrompt,
      userMessage,
      retrievedFields,
      maxTokens: 3000,
      outputMode: "text",
    });

    if (response.usedFallback || !response.content) {
      throw new FallbackDraftError(
        "AI specialist execution did not produce content (gateway used fallback). " +
        "The work output cannot be saved as Completed Work. Please retry or contact your platform administrator.",
      );
    }

    return response.content.trim();
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createUnifiedExecutionEngine(): UnifiedExecutionEngine {
  return new UnifiedExecutionEngine(createResourceRegistry());
}

// ─── Sprint 29D: Execution contract helpers ───────────────────────────────────

/**
 * Derives permitted session channels from a specialist's allowedExecutionChannels.
 * Falls back to ["connector"] if the list is empty or unrecognised.
 */
function deriveSessionChannels(allowedExecutionChannels: string[]): SessionChannel[] {
  if (!allowedExecutionChannels || allowedExecutionChannels.length === 0) {
    return ["connector"];
  }
  const channels = new Set<SessionChannel>();
  for (const ch of allowedExecutionChannels) {
    channels.add(mapExecutionChannelToSession(ch));
  }
  return channels.size > 0 ? Array.from(channels) : ["connector"];
}

/**
 * Builds a complete ResourcePlan for a conversation execution.
 *
 * Evidence providers are populated from the EvidencePack.
 * Write targets and approval requirements start empty — they are populated
 * by the engine after the specialist's output is parsed.
 */
function buildConversationResourcePlan(
  workPackage: SpecialistWorkPackage,
  evidencePack: EvidencePack | null,
): ResourcePlan {
  const evidenceProviders: EvidenceProvider[] = [
    {
      providerId:   "organisation_library",
      providerType: "organisation_library",
      status:       evidencePack && evidencePack.totalChunks > 0 ? "active" : "not_attempted",
      sourceCount:  evidencePack?.sourceIds.length ?? 0,
    },
  ];

  const connectorRequirements: ConnectorRequirement[] = (
    workPackage.allowedConnectorCategories ?? []
  ).map(cat => ({
    channel:  mapConnectorCategoryToChannel(cat),
    purpose:  "evidence" as const,
    required: false,
    satisfied: false,
  }));

  return {
    evidenceProviders,
    preferredProviders: ["organisation_library"],
    evidenceSources:     evidencePack?.sourceIds ?? [],
    connectorSessionOpened: false,
    writeTargets:        [],  // populated after specialist output
    requiredCapabilities: workPackage.allowedCapabilities ?? [],
    connectorRequirements,
    approvalRequirements: [],  // populated after specialist output
  };
}

/**
 * Builds a complete ResourcePlan for a task execution.
 *
 * Includes evidence from the Organisation Library, task uploads, and entity
 * knowledge sources. Write targets and approval requirements start empty.
 */
function buildTaskResourcePlan(
  manifest: WorkPackageManifest,
  evidencePack: EvidencePack | null,
): ResourcePlan {
  const evidenceProviders: EvidenceProvider[] = [
    {
      providerId:   "organisation_library",
      providerType: "organisation_library",
      status:       evidencePack && evidencePack.totalChunks > 0 ? "active" : "not_attempted",
      sourceCount:  manifest.organisationLibrarySources.length,
    },
    {
      providerId:   "task_uploads",
      providerType: "task_upload",
      status:       manifest.taskUploads.length > 0 ? "active" : "not_attempted",
      sourceCount:  manifest.taskUploads.length,
    },
  ];

  return {
    evidenceProviders,
    preferredProviders: ["organisation_library", "task_uploads"],
    evidenceSources:    evidencePack?.sourceIds ?? [],
    connectorSessionOpened: false,
    writeTargets:        [],
    requiredCapabilities: [],
    connectorRequirements: [
      { channel: "connector", purpose: "execution", required: false, satisfied: false },
      { channel: "office",    purpose: "execution", required: false, satisfied: false },
    ],
    approvalRequirements: [],
  };
}

// ─── Specialist prompt builder ────────────────────────────────────────────────

function buildSpecialistUserPrompt(
  workPackage: SpecialistWorkPackage,
  context: SpecialistContext,
  additionalInstruction: string | null,
  evidencePack?: EvidencePack | null,
): string {
  const parts: string[] = [];

  parts.push(`## TASK OBJECTIVE\n${workPackage.objective}`);
  parts.push(`## CAPABILITY\n${workPackage.capabilityCode} (level: ${workPackage.capabilityLevel})`);
  parts.push(`## YOUR RESPONSIBILITIES\n${workPackage.responsibilities.map(r => `- ${r}`).join("\n")}`);
  parts.push(`## EXPECTED OUTPUTS\n${workPackage.expectedOutputs.map(o => `- ${o}`).join("\n")}`);

  if (workPackage.allowedTools.length > 0) {
    parts.push(`## ALLOWED TOOLS\n${workPackage.allowedTools.join(", ")}`);
  }
  if (workPackage.prohibitedActions.length > 0) {
    parts.push(`## PROHIBITED ACTIONS\n${workPackage.prohibitedActions.map(a => `- ${a}`).join("\n")}`);
  }
  if (workPackage.approvalRequiredActions.length > 0) {
    parts.push(`## REQUIRES APPROVAL BEFORE EXECUTION\n${workPackage.approvalRequiredActions.map(a => `- ${a}`).join("\n")}`);
  }

  if (context.taskScope) {
    parts.push(`## UNTRUSTED DATA — TASK CONTEXT\n${context.taskScope}`);
  }
  if (context.approvedMemory.length > 0) {
    const memText = context.approvedMemory
      .slice(0, Math.floor(CONTEXT_TOKEN_BUDGET / 500))
      .map(m => `[${m.id}] (${m.category}): ${m.content}`)
      .join("\n");
    parts.push(`## UNTRUSTED DATA — ORGANISATION MEMORY\n${memText}`);
  }
  if (context.relevantMessages.length > 0) {
    const msgText = context.relevantMessages
      .slice(-20)
      .map(m => `[${m.id}] ${m.role}: ${m.content}`)
      .join("\n");
    parts.push(`## UNTRUSTED DATA — CONVERSATION CONTEXT\n${msgText}`);
  }
  if (context.previousOutputs.length > 0) {
    const prevText = context.previousOutputs
      .map(o => `[Run ${o.specialistRunId}] ${o.role}: ${o.summary}`)
      .join("\n");
    parts.push(`## PREVIOUS SPECIALIST OUTPUTS\n${prevText}`);
  }
  if (context.unresolvedQuestions.length > 0) {
    parts.push(`## UNRESOLVED QUESTIONS FROM PRIOR CONTEXT\n${context.unresolvedQuestions.map(q => `- ${q}`).join("\n")}`);
  }
  if (workPackage.assumptions.length > 0) {
    parts.push(`## CURRENT ASSUMPTIONS\n${workPackage.assumptions.map(a => `- ${a}`).join("\n")}`);
  }

  // Sprint 29C: Evidence section — identical quality to task execution path.
  // Injected before the output schema so the specialist reads evidence before
  // constructing its response. Evidence chunks are authoritative; they must be
  // cited in findings that reference policy or legislation.
  if (evidencePack && evidencePack.totalChunks > 0) {
    const evidenceSection = buildEvidenceSection(evidencePack);
    if (evidenceSection) {
      parts.push(evidenceSection);
    }
  }

  if (additionalInstruction) {
    parts.push(`## ADDITIONAL INSTRUCTION\n${additionalInstruction}`);
  }

  parts.push(`## REQUIRED OUTPUT SCHEMA\nReturn ONLY valid JSON with this exact shape:\n${RESULT_SCHEMA_DESCRIPTION}`);
  parts.push(`\nspecialistRunId to use in your output: ${workPackage.specialistRunId}`);
  parts.push(`workforceRoleCode to use: ${workPackage.workforceRoleCode}`);
  parts.push(`capabilityCode to use: ${workPackage.capabilityCode}`);

  return parts.join("\n\n---\n\n");
}

// ─── Specialist output validation ─────────────────────────────────────────────

function parseAndValidateSpecialistOutput(
  content: string,
  runId: string,
  roleCode: string,
  capabilityCode: string,
  workPackage: SpecialistWorkPackage,
): SpecialistRunResult {
  let parsed: any;
  try {
    const cleaned = content.replace(/^```json\s*/i, "").replace(/\s*```$/, "").trim();
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`Specialist ${roleCode} returned invalid JSON`);
  }

  if (!parsed.status || !["completed", "blocked", "failed"].includes(parsed.status)) {
    parsed.status = "completed";
  }
  if (!parsed.summary || typeof parsed.summary !== "string") {
    parsed.summary = "(No summary provided)";
  }
  if (!Array.isArray(parsed.findings)) parsed.findings = [];
  if (!Array.isArray(parsed.recommendations)) parsed.recommendations = [];
  if (!Array.isArray(parsed.risks)) parsed.risks = [];
  if (!Array.isArray(parsed.assumptions)) parsed.assumptions = [];
  if (!Array.isArray(parsed.unresolvedQuestions)) parsed.unresolvedQuestions = [];
  if (!Array.isArray(parsed.requestedExternalActions)) parsed.requestedExternalActions = [];
  if (!Array.isArray(parsed.expectedOutputs)) parsed.expectedOutputs = [];
  if (typeof parsed.confidence !== "number") parsed.confidence = 0.5;
  parsed.confidence = Math.min(1, Math.max(0, parsed.confidence));

  const validReferenceIds = new Set([
    ...workPackage.approvedOrganisationMemory.map(m => m.id),
    ...workPackage.relevantConversationContext.map(m => m.id),
    ...workPackage.taskContext.map(t => t.id),
    ...workPackage.previousSpecialistOutputs.map(o => o.specialistRunId),
  ]);

  for (const finding of parsed.findings) {
    if (!Array.isArray(finding.evidenceReferences)) {
      finding.evidenceReferences = [];
      continue;
    }
    finding.evidenceReferences = finding.evidenceReferences.filter((ref: any) => {
      if (!ref.referenceId || !validReferenceIds.has(ref.referenceId)) {
        console.warn(`[UnifiedExecutionEngine] Rejected invented evidence reference "${ref.referenceId}" from ${roleCode}`);
        return false;
      }
      return true;
    });
  }

  parsed.specialistRunId = runId;
  parsed.workforceRoleCode = roleCode;
  parsed.capabilityCode = capabilityCode;
  parsed.completedAt = parsed.completedAt ?? new Date().toISOString();

  return parsed as SpecialistRunResult;
}

// ─── Specialist deterministic provider ───────────────────────────────────────

function buildDeterministicResult(
  workPackage: SpecialistWorkPackage,
  runId: string,
  instructionVersion: string,
): SpecialistRunResult {
  return {
    specialistRunId: runId,
    workforceRoleCode: workPackage.workforceRoleCode,
    capabilityCode: workPackage.capabilityCode,
    status: "completed",
    summary: `[Deterministic Test] ${workPackage.workforceRoleCode} run completed. Objective: "${workPackage.objective}". Set AI_PROVIDER=openai for real intelligence.`,
    findings: [
      {
        title: `${workPackage.workforceRoleCode} Analysis (Test Mode)`,
        description: "Deterministic test response. Configure AI_PROVIDER=openai for real specialist reasoning.",
        severity: "low",
        confidence: 1.0,
        evidenceReferences: [],
      },
    ],
    recommendations: [
      {
        action: "Configure AI_PROVIDER=openai to enable real specialist intelligence",
        reason: "Deterministic provider cannot perform domain reasoning",
        priority: "medium",
        approvalRequired: false,
      },
    ],
    risks: [],
    assumptions: ["Running in deterministic test mode — no actual analysis performed."],
    unresolvedQuestions: [],
    requestedExternalActions: [],
    expectedOutputs: workPackage.expectedOutputs.map(o => ({ outputType: "test", description: o })),
    confidence: 1.0,
    completedAt: new Date().toISOString(),
    modelProvider: "internal",
    modelName: "deterministic",
    instructionVersion,
  } as SpecialistRunResult;
}

// ─── Task pipeline helpers ────────────────────────────────────────────────────

function buildWorkExecutionAddendum(blueprint: WorkBlueprint | null): string {
  if (!blueprint) return "";
  return `

---

## WORK EXECUTION CONTRACT

You are executing professional work governed by the "${blueprint.title}" blueprint.

**Objective:** ${blueprint.objective}

**Success Criteria:**
${blueprint.successCriteria.map(c => `- ${c}`).join("\n")}

**Mandatory Citations:** ${blueprint.mandatoryCitations.join(", ") || "None specified"}

**EXECUTION RULES:**
1. Never invent facts, policy positions, or legislative requirements
2. Use organisation-approved templates when provided — never substitute structure
3. Mark sections as [INCOMPLETE: description] when required information is unavailable
4. Cite every policy or legislative reference used
5. Use the organisation's approved terminology from memory
6. The output must be suitable for human review and approval before use`;
}

function buildWorkPackagePrompt(
  userRequest: string,
  manifest: WorkPackageManifest,
  blueprint: WorkBlueprint | null,
  styleGuidanceBlock: string,
  evidencePack?: EvidencePack,
): string {
  const sections: string[] = [];

  sections.push(`=== WORK REQUEST (UNTRUSTED DATA) ===\n${userRequest}`);

  if (evidencePack && evidencePack.totalChunks > 0) {
    const evidenceSection = buildEvidenceSection(evidencePack);
    if (evidenceSection) sections.push(evidenceSection);
  } else if (manifest.organisationLibrarySources.length > 0) {
    const sourceLines = manifest.organisationLibrarySources.map(
      s => `- ${s.title} [${s.sourceType}${s.authorityLevel ? `, ${s.authorityLevel}` : ""}]`
    );
    sections.push(
      `=== ORGANISATION LIBRARY SOURCES (document metadata — content not yet indexed) ===\n` +
      `NOTE: These documents are listed but their content could not be retrieved. ` +
      `Use general professional knowledge for compliance guidance until the documents are ingested.\n` +
      sourceLines.join("\n")
    );
  }

  const hasUploadEvidence = evidencePack?.citationsByType?.["task_upload"]?.length ?? 0;
  if (manifest.taskUploads.length > 0 && !hasUploadEvidence) {
    const uploadLines = manifest.taskUploads.map(u => `- ${u.title} [task upload — content not yet indexed]`);
    sections.push(`=== TASK UPLOADS (UNTRUSTED DATA — read only) ===\n${uploadLines.join("\n")}`);
  }

  if (manifest.cosMemories.length > 0) {
    const memLines = manifest.cosMemories.map(m => {
      const header = `- [${m.memoryType}] ${m.title}`;
      return m.content ? `${header}\n  ${m.content}` : header;
    });
    sections.push(`=== ORGANISATION MEMORY (authoritative) ===\n${memLines.join("\n")}`);
  }

  if (Object.keys(manifest.entityKnowledge ?? {}).length > 0) {
    sections.push(`=== ENTITY KNOWLEDGE ===\n${JSON.stringify(manifest.entityKnowledge, null, 2)}`);
  }

  if (styleGuidanceBlock) sections.push(styleGuidanceBlock);

  if (blueprint) {
    sections.push(
      `=== BLUEPRINT: ${blueprint.title} ===\n` +
      `Objective: ${blueprint.objective}\n` +
      `Output types: ${blueprint.outputTypes.join(", ")}\n` +
      `Mandatory citations: ${blueprint.mandatoryCitations.join(", ") || "none"}`
    );
  }

  if (evidencePack && evidencePack.totalChunks > 0) {
    sections.push(
      `=== CITATION REQUIREMENTS ===\n` +
      `You MUST cite evidence from the AUTHORITATIVE EVIDENCE section above using the citation tags provided.\n` +
      `Do not cite sources not present in this prompt.\n` +
      `If evidence is insufficient, mark the affected section as [INCOMPLETE: requires <source type>].`
    );
  }

  return sections.join("\n\n");
}

function deriveTitleFromRequest(userRequest: string, blueprint: WorkBlueprint | null): string {
  if (blueprint) {
    const truncated = userRequest.slice(0, 60).trim();
    return `${blueprint.title} — ${truncated}${userRequest.length > 60 ? "..." : ""}`;
  }
  return userRequest.slice(0, 100).trim() + (userRequest.length > 100 ? "..." : "");
}

function buildCompletionMessage(
  completedWorkId: string,
  completedWorkStatus: string,
  blueprint: WorkBlueprint | null,
  reviewResult: Awaited<ReturnType<typeof reviewDraft>>,
): string {
  const score = reviewResult.qualityScore;
  const revised = reviewResult.revised;
  const bpName = blueprint?.title ?? "work output";

  let msg = `I've completed the ${bpName} (quality score: ${score}/100`;
  if (revised) msg += ", with one automatic revision applied";
  msg += `).`;

  // Status-accurate closing line — must reflect the actual persisted state.
  if (completedWorkStatus === "awaiting_approval") {
    msg += " The work is ready for your approval.";
  } else if (completedWorkStatus === "approved") {
    msg += " The work has been approved.";
  } else {
    // draft or unexpected — do NOT claim it is awaiting approval
    msg += " The draft has been saved for your review.";
  }

  if (score < 70) {
    msg += " Note: the quality score is below the preferred threshold — human review is particularly important for this output.";
  }
  return msg;
}

// ─── Audit helper ─────────────────────────────────────────────────────────────

async function logRunAudit(
  organizationId: string,
  eventType: string,
  specialistRunId: string,
  roleCode: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  try {
    await logOrgEvent({
      eventType: eventType as Parameters<typeof logOrgEvent>[0]["eventType"],
      organizationId,
      actorType: "agent",
      resourceType: "specialist_run",
      resourceId: specialistRunId,
      metadata: { workforceRoleCode: roleCode, ...metadata },
    });
  } catch {
    // Audit non-fatal
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
