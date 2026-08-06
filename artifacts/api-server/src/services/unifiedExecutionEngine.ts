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

import { randomUUID } from "crypto";
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
import { createDraft } from "./completedWorkService.js";
import {
  buildEvidenceSection,
  type EvidencePack,
} from "./knowledgeResolutionService.js";
import { logOrgEvent } from "./auditService.js";
import { ResourceRegistry, createResourceRegistry } from "../lib/resources/ResourceRegistry.js";

// Type-only import — breaks circular runtime dependency.
// specialistIntelligenceService will import createUnifiedExecutionEngine from here.
import type {
  SpecialistWorkPackage,
  SpecialistContext,
  SpecialistRunResult,
} from "./specialistIntelligenceService.js";

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
    const workPackage = request.specialistWorkPackage!;
    const context = request.specialistContext!;
    const additionalInstruction = request.additionalInstruction ?? null;
    const runId = request.specialistRunId ?? workPackage.specialistRunId;
    const roleCode = workPackage.workforceRoleCode;

    // Guard: inactive specialist
    if (!ACTIVE_SPECIALIST_VERSIONS[roleCode]) {
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
      return buildDeterministicResult(workPackage, runId, instructionVersion);
    }

    // AI path
    const systemInstruction = buildDNASystemInstruction(roleCode);
    const userPrompt = buildSpecialistUserPrompt(workPackage, context, additionalInstruction);
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

    const gatewayContext: AIGatewayContext = {
      organizationId: workPackage.organizationId,
      userId: "system",
      role: "system",
      permissions: [],
      purpose: "task_execution",
      correlationId: runId,
      provider: "openai",
      retentionClass: "operational",
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
            retrievedFields: ["task.scope", "organisation.memory", "conversation.messages"],
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
        });

        return {
          ...parsed,
          instructionVersion,
          modelProvider: "openai",
          modelName,
          inputTokens: response.usage?.inputTokens,
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
        return {
          outcome: "configuration_failure",
          manifestId: manifest.id,
          blueprintCode: blueprint?.code,
          message: (err as Error).message,
        };
      }
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

    return {
      outcome: "completed",
      completedWorkId: completedWork.id,
      manifestId: manifest.id,
      blueprintCode: blueprint?.code,
      qualityScore: reviewResult.qualityScore,
      message: buildCompletionMessage(completedWork.id, blueprint, reviewResult),
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

// ─── Specialist prompt builder ────────────────────────────────────────────────

function buildSpecialistUserPrompt(
  workPackage: SpecialistWorkPackage,
  context: SpecialistContext,
  additionalInstruction: string | null,
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
  blueprint: WorkBlueprint | null,
  reviewResult: Awaited<ReturnType<typeof reviewDraft>>,
): string {
  const score = reviewResult.qualityScore;
  const revised = reviewResult.revised;
  const bpName = blueprint?.title ?? "work output";

  let msg = `I've completed the ${bpName} (quality score: ${score}/100`;
  if (revised) msg += ", with one automatic revision applied";
  msg += `). The draft is ready for your review and approval.`;

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
