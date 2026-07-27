/**
 * Compliance Officer Output Schema — Sprint 9.5
 *
 * Defines the structured output shape for the Compliance Officer specialist.
 * All fields are required unless marked optional.
 *
 * @version 1.0.0
 */

import type { SpecialistRunResult } from "../../artifacts/api-server/src/services/specialistIntelligenceService.js";

export type ComplianceOfficerOutput = SpecialistRunResult & {
  /** Domain-specific extension for compliance analysis */
  complianceMeta: {
    /** Overall compliance posture */
    overallPosture: "strong" | "satisfactory" | "requires_attention" | "urgent_action_required";
    /** NDIS Practice Standards assessed */
    standardsAssessed: string[];
    /** Findings by severity count */
    findingsBySeverity: {
      critical: number;
      high: number;
      medium: number;
      low: number;
    };
    /** Reportable incident classification if applicable */
    incidentClassification?: {
      isReportable: boolean;
      category?: string;
      reportingDeadlineHours?: number;
      basis: string;
    };
    /** Corrective actions with deadlines */
    correctiveActions: Array<{
      action: string;
      relatedStandard: string;
      suggestedDeadlineDays: number;
      priority: "immediate" | "high" | "medium" | "low";
    }>;
  };
};

/**
 * Compliance posture thresholds — for deterministic test provider
 */
export const COMPLIANCE_POSTURE_RULES = {
  urgent_action_required: { criticalMin: 1 },
  requires_attention: { highMin: 1 },
  satisfactory: { mediumMax: 3 },
  strong: {},
} as const;

/**
 * Deterministic test output for the Compliance Officer
 * Used when AI_PROVIDER is not "openai"
 */
export function buildDeterministicComplianceOutput(params: {
  specialistRunId: string;
  capabilityCode: string;
  objective: string;
}): SpecialistRunResult {
  return {
    specialistRunId: params.specialistRunId,
    workforceRoleCode: "compliance_officer",
    capabilityCode: params.capabilityCode,
    status: "completed",
    summary: `[Deterministic] Compliance analysis complete. Objective: "${params.objective}". No actual AI reasoning was performed — this is a test/development response.`,
    findings: [
      {
        title: "Compliance Analysis Completed (Test Mode)",
        description: "Deterministic test output. Connect an OpenAI provider for real analysis.",
        severity: "low",
        confidence: 1.0,
        evidenceReferences: [],
      },
    ],
    recommendations: [
      {
        action: "Configure AI_PROVIDER=openai to enable real Compliance Officer reasoning",
        reason: "Deterministic test provider cannot perform domain analysis",
        priority: "medium",
        approvalRequired: false,
      },
    ],
    risks: [],
    assumptions: ["This is a deterministic test response. No actual analysis was performed."],
    unresolvedQuestions: [],
    requestedExternalActions: [],
    expectedOutputs: [],
    confidence: 1.0,
    completedAt: new Date().toISOString(),
  };
}
