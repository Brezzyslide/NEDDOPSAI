/**
 * Operations Manager Output Schema — Sprint 9.5
 *
 * @version 1.0.0
 */

import type { SpecialistRunResult } from "../../artifacts/api-server/src/services/specialistIntelligenceService.js";

export type OperationsManagerOutput = SpecialistRunResult & {
  operationsMeta: {
    analysisType: "roster_review" | "workflow_design" | "capacity_analysis" | "service_delivery_review" | "asset_management" | "general";
    operationalRisksIdentified: number;
    schadsAwardFlagsRaised: boolean;
    workflowDelivered: boolean;
  };
};

/**
 * Deterministic test output for the Operations Manager
 */
export function buildDeterministicOperationsOutput(params: {
  specialistRunId: string;
  capabilityCode: string;
  objective: string;
}): SpecialistRunResult {
  return {
    specialistRunId: params.specialistRunId,
    workforceRoleCode: "operations_manager",
    capabilityCode: params.capabilityCode,
    status: "completed",
    summary: `[Deterministic] Operations analysis complete. Objective: "${params.objective}". No actual AI reasoning was performed.`,
    findings: [
      {
        title: "Operations Analysis Completed (Test Mode)",
        description: "Deterministic test output. Connect an OpenAI provider for real analysis.",
        severity: "low",
        confidence: 1.0,
        evidenceReferences: [],
      },
    ],
    recommendations: [
      {
        action: "Configure AI_PROVIDER=openai to enable real Operations Manager reasoning",
        reason: "Deterministic test provider cannot perform operational analysis",
        priority: "medium",
        approvalRequired: false,
      },
    ],
    risks: [],
    assumptions: ["This is a deterministic test response."],
    unresolvedQuestions: [],
    requestedExternalActions: [],
    expectedOutputs: [],
    confidence: 1.0,
    completedAt: new Date().toISOString(),
  };
}
