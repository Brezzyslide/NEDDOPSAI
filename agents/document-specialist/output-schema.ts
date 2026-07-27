/**
 * Document Specialist Output Schema — Sprint 9.5
 *
 * @version 1.0.0
 */

import type { SpecialistRunResult } from "../../artifacts/api-server/src/services/specialistIntelligenceService.js";

export type DocumentSpecialistOutput = SpecialistRunResult & {
  documentMeta: {
    documentType: "policy" | "procedure" | "template" | "register" | "letter" | "report" | "summary" | "other";
    suggestedTitle: string;
    suggestedVersion: string;
    suggestedReviewDate: string; // ISO date
    suggestedApproverRole: string;
    wordCount?: number;
    completionStatus: "complete" | "partial" | "requires_input";
    missingContent: string[];
  };
};

/**
 * Deterministic test output for the Document Specialist
 */
export function buildDeterministicDocumentOutput(params: {
  specialistRunId: string;
  capabilityCode: string;
  objective: string;
}): SpecialistRunResult {
  return {
    specialistRunId: params.specialistRunId,
    workforceRoleCode: "document_specialist",
    capabilityCode: params.capabilityCode,
    status: "completed",
    summary: `[Deterministic] Document task complete. Objective: "${params.objective}". No actual AI reasoning was performed.`,
    findings: [
      {
        title: "Document Task Completed (Test Mode)",
        description: "## DRAFT — VERSION 1\n\nDeterministic test output. Connect an OpenAI provider for real document generation.\n\n*This is a placeholder document produced by the test provider.*",
        severity: "low",
        confidence: 1.0,
        evidenceReferences: [],
      },
    ],
    recommendations: [
      {
        action: "Configure AI_PROVIDER=openai to enable real Document Specialist reasoning",
        reason: "Deterministic test provider cannot generate real documents",
        priority: "medium",
        approvalRequired: false,
      },
    ],
    risks: [],
    assumptions: ["This is a deterministic test response."],
    unresolvedQuestions: [],
    requestedExternalActions: [],
    expectedOutputs: [{ outputType: "document", description: "Draft document (test placeholder)" }],
    confidence: 1.0,
    completedAt: new Date().toISOString(),
  };
}
