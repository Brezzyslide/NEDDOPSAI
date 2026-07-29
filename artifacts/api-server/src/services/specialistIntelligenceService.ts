/**
 * Specialist Intelligence Service — Sprint 11
 *
 * Provider-independent AI execution for active specialists.
 * ALL AI calls go through the AI Privacy Gateway.
 * No direct OpenAI SDK imports permitted here.
 *
 * Active specialists (approved DNA): chief_of_staff, operations_manager
 * DNA Pending (not yet dispatchable): compliance_quality_manager, knowledge_documentation_specialist
 * Inactive specialists: return "Specialist intelligence not yet activated."
 */

import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { createAIGateway } from "@workspace/ai-gateway";
import type { AIGatewayContext } from "@workspace/ai-gateway";
import { buildDNASystemInstruction, captureSpecialistRunVersions } from "@workspace/workforce-dna";
import { db, specialistRunsTable } from "@workspace/db";
import { logOrgEvent } from "./auditService.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EvidenceReference {
  referenceType: "conversation_message" | "task_memory" | "organisation_memory" | "document" | "message_attachment";
  referenceId: string;
  excerpt: string;
  relevance: string;
}

export interface SpecialistRunResult {
  specialistRunId: string;
  workforceRoleCode: string;
  capabilityCode: string;
  status: "completed" | "blocked" | "failed";
  summary: string;
  findings: Array<{
    title: string;
    description: string;
    severity?: "low" | "medium" | "high" | "critical";
    confidence: number;
    evidenceReferences: EvidenceReference[];
  }>;
  recommendations: Array<{
    action: string;
    reason: string;
    priority: string;
    approvalRequired: boolean;
  }>;
  risks: Array<{
    risk: string;
    likelihood?: string;
    consequence?: string;
    treatment?: string;
  }>;
  assumptions: string[];
  unresolvedQuestions: Array<{
    question: string;
    reason: string;
    blocking: boolean;
  }>;
  requestedExternalActions: Array<{
    actionType: string;
    executionChannel: string;
    toolCategory: string;
    connectorCategory?: string;
    approvalRequired: boolean;
    riskLevel: string;
  }>;
  expectedOutputs: Array<{
    outputType: string;
    description: string;
  }>;
  confidence: number;
  completedAt: string;
  modelProvider?: string;
  modelName?: string;
  inputTokens?: number;
  outputTokens?: number;
  instructionVersion?: string;
}

export interface SpecialistWorkPackage {
  specialistRunId: string;
  organizationId: string;
  conversationId?: string;
  taskId: string;
  capabilityCode: string;
  capabilityLevel: "general_information" | "professional_analysis" | "execution";
  workforceRoleCode: string;
  workerProfileCode: string;
  objective: string;
  responsibilities: string[];
  expectedOutputs: string[];
  approvedOrganisationMemory: Array<{ id: string; content: string; category: string }>;
  relevantConversationContext: Array<{ id: string; role: string; content: string }>;
  taskContext: Array<{ id: string; type: string; content: string }>;
  previousSpecialistOutputs: Array<{ specialistRunId: string; role: string; summary: string }>;
  allowedCapabilities: string[];
  allowedTools: string[];
  allowedConnectorCategories: string[];
  allowedExecutionChannels: string[];
  prohibitedActions: string[];
  approvalRequiredActions: string[];
  dependencies: Array<{ specialistRunId: string; requiredOutput: string }>;
  assumptions: string[];
  unresolvedQuestions: string[];
  riskLevel: string;
  expiresAt: string;
}

export interface SpecialistContext {
  taskScope: string;
  approvedMemory: Array<{ id: string; content: string; category: string }>;
  pinnedDecisions: Array<{ id: string; decision: string }>;
  unresolvedQuestions: string[];
  relevantMessages: Array<{ id: string; role: string; content: string }>;
  previousOutputs: Array<{ specialistRunId: string; role: string; summary: string }>;
  evidenceReferences: EvidenceReference[];
  approvalState: string;
  executionEntitlementState: string;
}

// ─── Active specialist configuration ─────────────────────────────────────────
// Sprint 11: Only specialists with approved DNA are listed here.
// compliance_quality_manager and knowledge_documentation_specialist are dna_pending — not yet dispatchable.

const ACTIVE_SPECIALIST_VERSIONS: Record<string, string> = {
  chief_of_staff: "1.0.0",
  operations_manager: "1.0.0",
};

/**
 * Returns the system instruction for a specialist role.
 * Uses the DNA profile from @workspace/workforce-dna when available,
 * falling back to a generic message for unactivated specialists.
 */
function getSystemInstruction(roleCode: string): string {
  return buildDNASystemInstruction(roleCode);
}

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

// ─── Config from environment ───────────────────────────────────────────────────

const MAX_RETRIES = parseInt(process.env.SPECIALIST_MAX_RETRIES ?? "2", 10);
const RUN_TIMEOUT_MS = parseInt(process.env.SPECIALIST_RUN_TIMEOUT_MS ?? "180000", 10);
const CONTEXT_TOKEN_BUDGET = parseInt(process.env.SPECIALIST_CONTEXT_TOKEN_BUDGET ?? "8000", 10);

// ─── Service ──────────────────────────────────────────────────────────────────

export interface SpecialistIntelligenceService {
  executeRun(
    workPackage: SpecialistWorkPackage,
    context: SpecialistContext,
  ): Promise<SpecialistRunResult>;
  reviseRun(
    specialistRunId: string,
    originalWorkPackage: SpecialistWorkPackage,
    originalContext: SpecialistContext,
    feedback: string,
  ): Promise<SpecialistRunResult>;
  resumeAfterClarification(
    specialistRunId: string,
    workPackage: SpecialistWorkPackage,
    context: SpecialistContext,
    clarificationResponse: string,
  ): Promise<SpecialistRunResult>;
}

/**
 * Creates the specialist intelligence service.
 * Routes to OpenAI (via gateway) or deterministic provider.
 */
export function createSpecialistIntelligenceService(): SpecialistIntelligenceService {
  return {
    async executeRun(workPackage, context) {
      return callSpecialist(workPackage, context, null);
    },
    async reviseRun(specialistRunId, workPackage, context, feedback) {
      return callSpecialist(workPackage, context, `REVISION REQUEST:\n${feedback}`, specialistRunId);
    },
    async resumeAfterClarification(specialistRunId, workPackage, context, clarificationResponse) {
      return callSpecialist(
        workPackage, context,
        `CLARIFICATION PROVIDED:\n${clarificationResponse}`,
        specialistRunId,
      );
    },
  };
}

// ─── Core call logic ──────────────────────────────────────────────────────────

async function callSpecialist(
  workPackage: SpecialistWorkPackage,
  context: SpecialistContext,
  additionalInstruction: string | null,
  specialistRunId?: string,
): Promise<SpecialistRunResult> {
  const runId = specialistRunId ?? workPackage.specialistRunId;
  const roleCode = workPackage.workforceRoleCode;

  // Not-yet-activated specialists return a clear blocked message
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
    };
  }

  const instructionVersion = ACTIVE_SPECIALIST_VERSIONS[roleCode]!;
  const provider = (process.env.AI_PROVIDER ?? "internal").toLowerCase().trim();

  if (provider !== "openai") {
    return buildDeterministicResult(workPackage, runId, instructionVersion);
  }

  // AI path — call through gateway
  const systemInstruction = getSystemInstruction(roleCode);
  const userPrompt = buildUserPrompt(workPackage, context, additionalInstruction);

  // Capture version record for reproducibility (Sprint 10)
  const modelName = "gpt-4o";
  const versionRecord = captureSpecialistRunVersions(roleCode, modelName);

  // Persist version fields to the specialist_runs record (Sprint 10)
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
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Specialist run timeout")), RUN_TIMEOUT_MS),
        ),
      ]);

      // Parse and validate the structured output
      const parsed = parseAndValidateOutput(response.content, runId, roleCode, workPackage.capabilityCode, workPackage);

      // Write audit event
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
      };
    } catch (err: any) {
      lastError = err;
      console.error(`[SpecialistIntelligence] Attempt ${attempt}/${MAX_RETRIES + 1} failed for ${roleCode}:`, err?.message);

      if (attempt <= MAX_RETRIES) {
        await logRunAudit(workPackage.organizationId, "specialist.run_retried", runId, roleCode, {
          attempt,
          error: err?.message,
        });
        await sleep(Math.min(1000 * Math.pow(2, attempt - 1), 8000));
      }
    }
  }

  // All retries exhausted — safe failure
  await logRunAudit(workPackage.organizationId, "specialist.run_failed", runId, roleCode, {
    error: lastError?.message,
    attempts: attempt,
  });

  return {
    specialistRunId: runId,
    workforceRoleCode: roleCode,
    capabilityCode: workPackage.capabilityCode,
    status: "failed",
    summary: `Specialist run failed after ${attempt} attempt(s). The task may be retried or the analyst may need to proceed without AI reasoning.`,
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
  };
}

// ─── Prompt builder ───────────────────────────────────────────────────────────

function buildUserPrompt(
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

  // UNTRUSTED DATA sections
  if (context.taskScope) {
    parts.push(`## UNTRUSTED DATA — TASK CONTEXT\n${context.taskScope}`);
  }

  if (context.approvedMemory.length > 0) {
    const memText = context.approvedMemory
      .slice(0, Math.floor(CONTEXT_TOKEN_BUDGET / 500)) // rough token budget
      .map(m => `[${m.id}] (${m.category}): ${m.content}`)
      .join("\n");
    parts.push(`## UNTRUSTED DATA — ORGANISATION MEMORY\n${memText}`);
  }

  if (context.relevantMessages.length > 0) {
    const msgText = context.relevantMessages
      .slice(-20) // last 20 messages
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

// ─── Output validation ────────────────────────────────────────────────────────

function parseAndValidateOutput(
  content: string,
  runId: string,
  roleCode: string,
  capabilityCode: string,
  workPackage: SpecialistWorkPackage,
): SpecialistRunResult {
  let parsed: any;
  try {
    // Strip markdown code fences if present
    const cleaned = content.replace(/^```json\s*/i, "").replace(/\s*```$/, "").trim();
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`Specialist ${roleCode} returned invalid JSON`);
  }

  // Validate required fields
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

  // Build valid reference IDs from the work package context
  const validReferenceIds = new Set([
    ...workPackage.approvedOrganisationMemory.map(m => m.id),
    ...workPackage.relevantConversationContext.map(m => m.id),
    ...workPackage.taskContext.map(t => t.id),
    ...workPackage.previousSpecialistOutputs.map(o => o.specialistRunId),
  ]);

  // Reject invented evidence references
  for (const finding of parsed.findings) {
    if (!Array.isArray(finding.evidenceReferences)) {
      finding.evidenceReferences = [];
      continue;
    }
    finding.evidenceReferences = finding.evidenceReferences.filter((ref: any) => {
      if (!ref.referenceId || !validReferenceIds.has(ref.referenceId)) {
        console.warn(
          `[SpecialistIntelligence] Rejected invented evidence reference "${ref.referenceId}" from ${roleCode}`,
        );
        return false;
      }
      return true;
    });
  }

  // Enforce IDs in output
  parsed.specialistRunId = runId;
  parsed.workforceRoleCode = roleCode;
  parsed.capabilityCode = capabilityCode;
  parsed.completedAt = parsed.completedAt ?? new Date().toISOString();

  return parsed as SpecialistRunResult;
}

// ─── Deterministic provider ───────────────────────────────────────────────────

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
        description: "This is a deterministic test response. No actual AI analysis was performed. Configure AI_PROVIDER=openai for real specialist reasoning.",
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
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
