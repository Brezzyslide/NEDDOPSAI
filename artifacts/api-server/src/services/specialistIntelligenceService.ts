/**
 * Specialist Intelligence Service — Sprint 29B (Thin Adapter)
 *
 * All execution logic has moved to UnifiedExecutionEngine.
 * This file is a backward-compatible adapter that:
 *   1. Retains all exported types (SpecialistRunResult, SpecialistWorkPackage, etc.)
 *   2. Implements the SpecialistIntelligenceService interface as thin delegates
 *
 * External callers (chiefOfStaffOrchestrator, tests) continue to use the same
 * createSpecialistIntelligenceService() factory and interface — no changes required upstream.
 *
 * Active specialists (approved DNA): chief_of_staff, executive_assistant, operations_manager
 * DNA Pending (not yet dispatchable): compliance_quality_manager, knowledge_documentation_specialist
 */

import { createUnifiedExecutionEngine } from "./unifiedExecutionEngine.js";

// ─── Types ────────────────────────────────────────────────────────────────────
// Retained here so all existing importers continue to resolve these types.

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

// ─── Service interface ────────────────────────────────────────────────────────

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

// ─── Factory (thin adapter) ───────────────────────────────────────────────────

/**
 * Creates the specialist intelligence service backed by UnifiedExecutionEngine.
 * The engine handles all provider routing, retry logic, output validation,
 * and audit logging — identical behaviour to the previous direct implementation.
 */
export function createSpecialistIntelligenceService(): SpecialistIntelligenceService {
  return {
    async executeRun(workPackage, context) {
      const engine = createUnifiedExecutionEngine();
      const result = await engine.execute({
        trigger: "conversation",
        organisationId: workPackage.organizationId,
        requesterId: "system",
        requesterRole: "system",
        userRequest: workPackage.objective,
        specialistWorkPackage: workPackage,
        specialistContext: context,
        additionalInstruction: null,
        specialistRunId: workPackage.specialistRunId,
      });
      if (result.trigger !== "conversation") {
        throw new Error("[SpecialistIntelligence] Unexpected task result from conversation trigger");
      }
      return result.runResult;
    },

    async reviseRun(specialistRunId, originalWorkPackage, originalContext, feedback) {
      const engine = createUnifiedExecutionEngine();
      const result = await engine.execute({
        trigger: "conversation",
        organisationId: originalWorkPackage.organizationId,
        requesterId: "system",
        requesterRole: "system",
        userRequest: originalWorkPackage.objective,
        specialistWorkPackage: originalWorkPackage,
        specialistContext: originalContext,
        additionalInstruction: `REVISION REQUEST:\n${feedback}`,
        specialistRunId,
      });
      if (result.trigger !== "conversation") {
        throw new Error("[SpecialistIntelligence] Unexpected task result from conversation trigger");
      }
      return result.runResult;
    },

    async resumeAfterClarification(specialistRunId, workPackage, context, clarificationResponse) {
      const engine = createUnifiedExecutionEngine();
      const result = await engine.execute({
        trigger: "conversation",
        organisationId: workPackage.organizationId,
        requesterId: "system",
        requesterRole: "system",
        userRequest: workPackage.objective,
        specialistWorkPackage: workPackage,
        specialistContext: context,
        additionalInstruction: `CLARIFICATION PROVIDED:\n${clarificationResponse}`,
        specialistRunId,
      });
      if (result.trigger !== "conversation") {
        throw new Error("[SpecialistIntelligence] Unexpected task result from conversation trigger");
      }
      return result.runResult;
    },
  };
}
