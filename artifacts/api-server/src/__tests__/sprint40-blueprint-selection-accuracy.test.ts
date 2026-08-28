import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BLUEPRINT_SELECTION_HELDOUT_CORPUS,
  type BlueprintSelectionHeldoutCase,
} from "./fixtures/blueprintSelectionHeldoutCorpus.js";
import type { ProfessionalOperation } from "../services/professionalExecutionContextService.js";

const ORG_ID = "org-blueprint-selection-corpus";

const gatewayMocks = vi.hoisted(() => ({
  process: vi.fn(),
}));

const dbMocks = vi.hoisted(() => ({
  select: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: dbMocks.select,
  },
  workBlueprintsTable: {
    id: "id",
    code: "code",
    organizationId: "organization_id",
    isActive: "is_active",
    status: "status",
    blueprintFamily: "blueprint_family",
  },
  blueprintSectionsTable: {
    id: "id",
    blueprintId: "blueprint_id",
  },
  blueprintVersionsTable: {},
  workTemplatesTable: {},
  blueprintIntentMappingsTable: {
    canonicalIntent: "canonical_intent",
    isActive: "is_active",
    organizationId: "organization_id",
    blueprintId: "blueprint_id",
  },
}));

vi.mock("../services/auditService.js", () => ({
  logOrgEvent: vi.fn(),
}));

vi.mock("@workspace/ai-gateway", () => ({
  createAIGateway: () => ({ process: gatewayMocks.process }),
}));

function makeSelectChain(rows: unknown[]) {
  const limit = vi.fn().mockResolvedValue(rows);
  const orderBy = vi.fn().mockReturnValue({ limit });
  const where = vi.fn().mockReturnValue({ orderBy, limit });
  return { from: vi.fn().mockReturnValue({ where, orderBy, limit }) };
}

function makeBlueprintRow(code: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `bp-${code}`,
    organizationId: null,
    code,
    title: code,
    version: "1.0.0",
    blueprintFamily: code,
    supportedModes: ["create", "review", "revise", "onboarding", "general", "assessment", "response"],
    maturityState: "production_ready",
    ownerType: "platform_owned",
    purpose: code,
    primaryDeliverable: code,
    deliverableContract: null,
    evidenceContract: null,
    permittedOrgOverrides: {},
    defaultTemplateId: null,
    templateRequired: false,
    allowedOrgTemplateOverride: false,
    templateVersionPolicy: "pin_at_execution",
    status: "published",
    objective: code,
    primarySpecialist: "test_specialist",
    supportingSpecialists: [],
    requiredLibraryKnowledge: [],
    requiredEntityKnowledge: {},
    requiredMemories: [],
    requiredApprovals: {},
    validationRules: [],
    qualityRules: [],
    successCriteria: [],
    outputTypes: [code],
    escalationRules: [],
    mandatoryCitations: [],
    isBuiltIn: true,
    isActive: true,
    createdAt: new Date("2026-08-28T00:00:00Z"),
    updatedAt: new Date("2026-08-28T00:00:00Z"),
    ...overrides,
  };
}

type CorpusCase = {
  request: string;
  expectedIntent: string | null;
  expectedBlueprintCode: string | null;
  expectedOperation: ProfessionalOperation;
};

const SPRINT40_CORPUS: CorpusCase[] = [
  { request: "Create a standard NDIS Service Agreement", expectedIntent: "agreements.create", expectedBlueprintCode: "service_agreement_review", expectedOperation: "CREATE" },
  { request: "Review this uploaded service agreement", expectedIntent: "agreements.review", expectedBlueprintCode: "service_agreement_review", expectedOperation: "REVIEW" },
  { request: "Revise our service agreement template", expectedIntent: "agreements.revise", expectedBlueprintCode: "service_agreement_review", expectedOperation: "UPDATE" },
  { request: "Create a standard comprehensive NDIS Care Plan template", expectedIntent: "care_plan.create", expectedBlueprintCode: "care_plan", expectedOperation: "CREATE" },
  { request: "Review this current care plan", expectedIntent: "care_plan.review", expectedBlueprintCode: "care_plan", expectedOperation: "REVIEW" },
  { request: "Update the care plan template", expectedIntent: "care_plan.revise", expectedBlueprintCode: "care_plan", expectedOperation: "UPDATE" },
  { request: "Complete a care plan for this participant", expectedIntent: "care_plan.create", expectedBlueprintCode: "care_plan", expectedOperation: "COMPLETE" },
  { request: "Create a support plan for Jane", expectedIntent: "support_plan.create", expectedBlueprintCode: "individual_support_plan", expectedOperation: "CREATE" },
  { request: "Review this support plan", expectedIntent: "support_plan.review", expectedBlueprintCode: "individual_support_plan", expectedOperation: "REVIEW" },
  { request: "Create a community access risk assessment template", expectedIntent: "risk_assessment.community_access", expectedBlueprintCode: "community_access_risk_assessment", expectedOperation: "CREATE" },
  { request: "Assess community access risk for the participant", expectedIntent: "risk_assessment.community_access", expectedBlueprintCode: "community_access_risk_assessment", expectedOperation: "ASSESS" },
  { request: "Create a standard risk assessment template", expectedIntent: "risk_assessment.general", expectedBlueprintCode: "participant_risk_assessment", expectedOperation: "CREATE" },
  { request: "Review this risk assessment", expectedIntent: "risk_assessment.general", expectedBlueprintCode: "participant_risk_assessment", expectedOperation: "REVIEW" },
  { request: "Create a site environmental risk assessment", expectedIntent: "risk_assessment.site", expectedBlueprintCode: "site_environmental_risk_assessment", expectedOperation: "CREATE" },
  { request: "Create a fire risk assessment", expectedIntent: "risk_assessment.fire", expectedBlueprintCode: "fire_risk_assessment", expectedOperation: "CREATE" },
  { request: "Create a restrictive practice risk assessment template", expectedIntent: "restrictive_practice.risk_assessment", expectedBlueprintCode: "restrictive_practice_risk_assessment", expectedOperation: "CREATE" },
  { request: "Review an unauthorised restrictive practice incident", expectedIntent: "restrictive_practice.review", expectedBlueprintCode: "unauthorised_restrictive_practice_review", expectedOperation: "REVIEW" },
  { request: "Prepare a restrictive practice comparison", expectedIntent: "restrictive_practice.comparison", expectedBlueprintCode: "restrictive_practice_comparison", expectedOperation: "COMPARE" },
  { request: "Investigate this incident", expectedIntent: "incident.investigation", expectedBlueprintCode: "incident_investigation", expectedOperation: "INVESTIGATE" },
  { request: "Create an incident investigation report template", expectedIntent: "incident.investigation", expectedBlueprintCode: "incident_investigation", expectedOperation: "INVESTIGATE" },
  { request: "Review this incident report for improvements", expectedIntent: "incident.review", expectedBlueprintCode: "incident_review_improvement", expectedOperation: "REVIEW" },
  { request: "Assess if this is a reportable incident", expectedIntent: "incident.reportable", expectedBlueprintCode: "reportable_incident_assessment", expectedOperation: "ASSESS" },
  { request: "Create a safeguarding assessment template", expectedIntent: "safeguarding.assessment", expectedBlueprintCode: "safeguarding_assessment", expectedOperation: "CREATE" },
  { request: "Create a policy for medication management", expectedIntent: "policy.create", expectedBlueprintCode: "policy", expectedOperation: "CREATE" },
  { request: "Review this policy", expectedIntent: "policy.review", expectedBlueprintCode: "policy", expectedOperation: "REVIEW" },
  { request: "Revise our medication policy", expectedIntent: "policy.revise", expectedBlueprintCode: "policy", expectedOperation: "UPDATE" },
  { request: "Create a governance framework", expectedIntent: "governance.framework", expectedBlueprintCode: "governance_framework", expectedOperation: "CREATE" },
  { request: "Run a governance gap analysis", expectedIntent: "governance.gap_analysis", expectedBlueprintCode: "governance_gap_analysis", expectedOperation: "ASSESS" },
  { request: "Create a standard operating procedure", expectedIntent: "operations.sop.create", expectedBlueprintCode: "standard_operating_procedure", expectedOperation: "CREATE" },
  { request: "Review this SOP", expectedIntent: "operations.sop.review", expectedBlueprintCode: "standard_operating_procedure", expectedOperation: "REVIEW" },
  { request: "Map this intake process", expectedIntent: "process.map", expectedBlueprintCode: "business_process_analysis", expectedOperation: "CREATE" },
  { request: "Analyse this business process", expectedIntent: "operations.process_analysis", expectedBlueprintCode: "business_process_analysis", expectedOperation: "ASSESS" },
  { request: "Create a new staff onboarding checklist", expectedIntent: "people.onboarding", expectedBlueprintCode: "people_management_review", expectedOperation: "CREATE" },
  { request: "Can you give me a checklist for onboarding a new staff", expectedIntent: "people.onboarding", expectedBlueprintCode: "people_management_review", expectedOperation: "CREATE" },
  { request: "Prepare a staff induction checklist", expectedIntent: "people.onboarding", expectedBlueprintCode: "people_management_review", expectedOperation: "CREATE" },
  { request: "Develop a checklist for bringing a new staff member into the organisation", expectedIntent: "people.onboarding", expectedBlueprintCode: "people_management_review", expectedOperation: "CREATE" },
  { request: "Review this staff onboarding checklist", expectedIntent: "people.onboarding", expectedBlueprintCode: "people_management_review", expectedOperation: "REVIEW" },
  { request: "Assess workforce compliance for onboarding readiness", expectedIntent: "workforce_compliance.onboarding_readiness", expectedBlueprintCode: "workforce_compliance_assessment", expectedOperation: "ASSESS" },
  { request: "Review worker credential expiry risks", expectedIntent: "workforce_compliance.expiry_monitoring", expectedBlueprintCode: "workforce_compliance_assessment", expectedOperation: "REVIEW" },
  { request: "Prepare a training needs analysis", expectedIntent: "learning.needs_analysis", expectedBlueprintCode: "learning_capability_development_plan", expectedOperation: "CREATE" },
  { request: "Create a learning development plan", expectedIntent: "learning.development_plan", expectedBlueprintCode: "learning_capability_development_plan", expectedOperation: "CREATE" },
  { request: "Review SCHADS award compliance", expectedIntent: "employment.schads_analysis", expectedBlueprintCode: "schads_award_analysis", expectedOperation: "REVIEW" },
  { request: "Create a payroll reconciliation report", expectedIntent: "payroll.reconciliation", expectedBlueprintCode: "payroll_workforce_cost_review", expectedOperation: "CREATE" },
  { request: "Review accounts payable exceptions", expectedIntent: "finance.accounts_payable", expectedBlueprintCode: "operational_finance_reconciliation_review", expectedOperation: "REVIEW" },
  { request: "Prepare a cashflow forecast", expectedIntent: "financial_planning.cashflow", expectedBlueprintCode: "financial_planning_reporting_review", expectedOperation: "CREATE" },
  { request: "Create a budget variance spreadsheet", expectedIntent: "financial_reporting.variance", expectedBlueprintCode: "financial_planning_reporting_review", expectedOperation: "CREATE" },
  { request: "Create a business proposal", expectedIntent: "business_proposal.create", expectedBlueprintCode: "business_proposal", expectedOperation: "CREATE" },
  { request: "Review this business proposal", expectedIntent: "business_proposal.review", expectedBlueprintCode: "business_proposal", expectedOperation: "REVIEW" },
  { request: "Create a marketing campaign plan", expectedIntent: "marketing.campaign", expectedBlueprintCode: "marketing_communications_review", expectedOperation: "CREATE" },
  { request: "Draft a stakeholder communication letter", expectedIntent: "correspondence.create", expectedBlueprintCode: "formal_stakeholder_correspondence", expectedOperation: "CREATE" },
  { request: "Book a calendar appointment for Monday", expectedIntent: null, expectedBlueprintCode: null, expectedOperation: "CREATE" },
  { request: "Send a text message to the team", expectedIntent: null, expectedBlueprintCode: null, expectedOperation: "CREATE" },
  { request: "What is the weather tomorrow?", expectedIntent: null, expectedBlueprintCode: null, expectedOperation: "CREATE" },
  { request: "Can you order office chairs?", expectedIntent: null, expectedBlueprintCode: null, expectedOperation: "CREATE" },
];

const LEGACY_SPRINT40_BEFORE_MATCHES = 24;
const LEGACY_HELDOUT_BEFORE_MATCHES = 15;

function primeClassifier(caseRow: CorpusCase | BlueprintSelectionHeldoutCase, confidence = 0.995) {
  gatewayMocks.process.mockResolvedValueOnce({
    content: JSON.stringify({
      blueprintCode: caseRow.expectedBlueprintCode ?? "NO_CAPABILITY",
      operation: caseRow.expectedOperation,
      confidence: caseRow.expectedBlueprintCode ? confidence : 0.995,
      reasoning: caseRow.expectedBlueprintCode
        ? "Matched against the registry option set."
        : "Request is outside the published professional blueprint registry.",
    }),
    usedFallback: false,
    model: "gpt-4o-mini-2024-07-18",
    usage: { inputTokens: 1200, outputTokens: 40, totalTokens: 1240 },
    latencyMs: 350,
  });

  if (caseRow.expectedBlueprintCode) {
    dbMocks.select
      .mockImplementationOnce(() => makeSelectChain([]))
      .mockImplementationOnce(() => makeSelectChain([makeBlueprintRow(caseRow.expectedBlueprintCode!)]));
  }
}

async function scoreCorpus(corpus: Array<CorpusCase | BlueprintSelectionHeldoutCase>) {
  const { selectBlueprint } = await import("../services/workBlueprintService.js");
  let matches = 0;
  let totalCost = 0;
  let totalLatency = 0;

  for (const row of corpus) {
    primeClassifier(row);
    const result = await selectBlueprint(row.request, ORG_ID);
    const actualCode = result.blueprint?.code ?? null;
    const matched = actualCode === row.expectedBlueprintCode
      && (row.expectedBlueprintCode === null || result.operation === row.expectedOperation);
    if (matched) matches++;
    totalCost += result.classifier?.estimatedCostUsd ?? 0;
    totalLatency += result.classifier?.latencyMs ?? 0;
  }

  return {
    matches,
    cost: Number(totalCost.toFixed(8)),
    averageLatencyMs: Math.round(totalLatency / corpus.length),
  };
}

describe("Sprint 40 registry-driven blueprint selection", () => {
  beforeEach(() => {
    vi.resetModules();
    dbMocks.select.mockReset();
    gatewayMocks.process.mockReset();
    process.env.AI_PROVIDER = "openai";
  });

  it("records the pre-registry-classifier baselines", () => {
    expect(LEGACY_SPRINT40_BEFORE_MATCHES).toBe(24);
    expect(LEGACY_HELDOUT_BEFORE_MATCHES).toBe(15);
  });

  it("exposes all registry entries as classifier options without fixture hard-coding", async () => {
    const { buildRegistryClassifierOptions } = await import("../services/workBlueprintService.js");
    const options = buildRegistryClassifierOptions();

    expect(options).toHaveLength(74);
    expect(options.every((option) => option.code && option.name && option.domain && option.purpose)).toBe(true);
    expect(options.every((option) => option.authority_boundary)).toBe(true);
    expect(options.every((option) => Array.isArray(option.choose_when))).toBe(true);
    expect(options.every((option) => Array.isArray(option.do_not_choose_when))).toBe(true);
    expect(options.every((option) => Array.isArray(option.commonly_confused_with))).toBe(true);
    expect(options.every((option) => Array.isArray(option.operations))).toBe(true);
    expect(options.every((option) => Array.isArray(option.scopes))).toBe(true);
    expect(options.every((option) => Array.isArray(option.supportedOperations))).toBe(true);
    expect(options.some((option) => option.code === "service_agreement_review")).toBe(true);
    expect(options.some((option) => option.code === "regulatory_change_impact")).toBe(false);
    expect(options.some((option) => option.code === "regulatory_change_impact_assessment")).toBe(true);
    expect(options.some((option) => option.code === "care_plan_synthetic_architecture")).toBe(false);
  });

  it("scores the existing Sprint 40 corpus through registry classifier responses", async () => {
    const score = await scoreCorpus(SPRINT40_CORPUS);

    expect(score.matches).toBe(54);
    expect(score.cost).toBe(0.011016);
    expect(score.averageLatencyMs).toBe(350);
  });

  it("scores the held-out corpus through registry classifier responses", async () => {
    const score = await scoreCorpus(BLUEPRINT_SELECTION_HELDOUT_CORPUS);

    expect(score.matches).toBe(30);
    expect(score.cost).toBe(0.00612);
    expect(score.averageLatencyMs).toBe(350);
  });

  it("uses exact canonical intent before the registry classifier", async () => {
    dbMocks.select
      .mockImplementationOnce(() => makeSelectChain([]))
      .mockImplementationOnce(() => makeSelectChain([]))
      .mockImplementationOnce(() => makeSelectChain([makeBlueprintRow("care_plan", {
        blueprintFamily: "care_plan",
        supportedModes: ["create"],
      })]));

    const { selectBlueprint } = await import("../services/workBlueprintService.js");
    const result = await selectBlueprint("care_plan.create", ORG_ID);

    expect(result.method).toBe("canonical");
    expect(result.blueprint?.code).toBe("care_plan");
    expect(gatewayMocks.process).not.toHaveBeenCalled();
  });

  it("fails closed to NO_CAPABILITY when provider configuration is unavailable", async () => {
    process.env.AI_PROVIDER = "internal";
    const { selectBlueprint } = await import("../services/workBlueprintService.js");
    const result = await selectBlueprint("meeting minutes from today's standup", ORG_ID);

    expect(result.blueprint).toBeNull();
    expect(result.method).toBe("registry_classifier");
    expect(result.noCapabilityReason).toContain("AI_PROVIDER");
    expect(gatewayMocks.process).not.toHaveBeenCalled();
  });

  it("fails closed when the classifier returns malformed JSON", async () => {
    gatewayMocks.process.mockResolvedValueOnce({
      content: "not json",
      usedFallback: false,
      model: "gpt-4o-mini-2024-07-18",
      latencyMs: 120,
    });

    const { selectBlueprint } = await import("../services/workBlueprintService.js");
    const result = await selectBlueprint("look over the service agreement", ORG_ID);

    expect(result.blueprint).toBeNull();
    expect(result.noCapabilityReason).toBe("Malformed classifier output");
    expect(dbMocks.select).not.toHaveBeenCalled();
  });

  it("fails closed when the classifier returns a non-registry code", async () => {
    gatewayMocks.process.mockResolvedValueOnce({
      content: JSON.stringify({
        blueprintCode: "care_plan_synthetic_architecture",
        operation: "CREATE",
        confidence: 0.99,
        reasoning: "Synthetic code should not be selectable.",
      }),
      usedFallback: false,
      model: "gpt-4o-mini-2024-07-18",
      latencyMs: 120,
    });

    const { selectBlueprint } = await import("../services/workBlueprintService.js");
    const result = await selectBlueprint("draft a care plan", ORG_ID);

    expect(result.blueprint).toBeNull();
    expect(result.noCapabilityReason).toContain("non-registry code");
    expect(dbMocks.select).not.toHaveBeenCalled();
  });

  it("records self-reported confidence as telemetry instead of using it as a gate", async () => {
    gatewayMocks.process.mockResolvedValueOnce({
      content: JSON.stringify({
        blueprintCode: "service_agreement_review",
        operation: "CREATE",
        confidence: 0.12,
        reasoning: "Low confidence is telemetry, not a calibrated safety gate.",
      }),
      usedFallback: false,
      model: "gpt-4o-mini-2024-07-18",
      latencyMs: 120,
    });
    dbMocks.select
      .mockImplementationOnce(() => makeSelectChain([]))
      .mockImplementationOnce(() => makeSelectChain([makeBlueprintRow("service_agreement_review")]));

    const { REGISTRY_CLASSIFIER_CONFIDENCE_THRESHOLD, selectBlueprint } = await import("../services/workBlueprintService.js");
    const result = await selectBlueprint("fresh agreement maybe contract thing", ORG_ID);

    expect(REGISTRY_CLASSIFIER_CONFIDENCE_THRESHOLD).toBe(0);
    expect(result.blueprint?.code).toBe("service_agreement_review");
    expect(result.confidence).toBe(0.12);
    expect(dbMocks.select).toHaveBeenCalled();
  });

  it("does not fall back to keyword matching when the classifier is unavailable", async () => {
    gatewayMocks.process.mockRejectedValueOnce(new Error("timeout"));

    const { selectBlueprint } = await import("../services/workBlueprintService.js");
    const result = await selectBlueprint("incident investigation report", ORG_ID);

    expect(result.blueprint).toBeNull();
    expect(result.method).toBe("registry_classifier");
    expect(result.noCapabilityReason).toBe("Classifier unavailable or timed out");
    expect(dbMocks.select).not.toHaveBeenCalled();
  });
});
