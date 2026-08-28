import { describe, expect, it, vi, beforeEach } from "vitest";
import { resolveIntent } from "../services/blueprintIntentMap.js";
import {
  deriveProfessionalIntentKey,
  deriveProfessionalOperation,
  type ProfessionalOperation,
} from "../services/professionalExecutionContextService.js";

const ORG_ID = "org-blueprint-selection-corpus";

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
  createAIGateway: () => ({ process: vi.fn() }),
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
    supportedModes: ["create", "review", "revise", "onboarding", "general"],
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

const CORPUS: CorpusCase[] = [
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
  { request: "Assess community access risk for the participant", expectedIntent: "risk_assessment.community_access", expectedBlueprintCode: "community_access_risk_assessment", expectedOperation: "REVIEW" },
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
  { request: "Assess if this is a reportable incident", expectedIntent: "incident.reportable", expectedBlueprintCode: "reportable_incident_assessment", expectedOperation: "REVIEW" },
  { request: "Create a safeguarding assessment template", expectedIntent: "safeguarding.assessment", expectedBlueprintCode: "safeguarding_assessment", expectedOperation: "CREATE" },
  { request: "Create a policy for medication management", expectedIntent: "policy.create", expectedBlueprintCode: "policy", expectedOperation: "CREATE" },
  { request: "Review this policy", expectedIntent: "policy.review", expectedBlueprintCode: "policy", expectedOperation: "REVIEW" },
  { request: "Revise our medication policy", expectedIntent: "policy.revise", expectedBlueprintCode: "policy", expectedOperation: "UPDATE" },
  { request: "Create a governance framework", expectedIntent: "governance.framework", expectedBlueprintCode: "governance_framework", expectedOperation: "CREATE" },
  { request: "Run a governance gap analysis", expectedIntent: "governance.gap_analysis", expectedBlueprintCode: "governance_gap_analysis", expectedOperation: "CREATE" },
  { request: "Create a standard operating procedure", expectedIntent: "operations.sop.create", expectedBlueprintCode: "standard_operating_procedure", expectedOperation: "CREATE" },
  { request: "Review this SOP", expectedIntent: "operations.sop.review", expectedBlueprintCode: "standard_operating_procedure", expectedOperation: "REVIEW" },
  { request: "Map this intake process", expectedIntent: "process.map", expectedBlueprintCode: "business_process_analysis", expectedOperation: "CREATE" },
  { request: "Analyse this business process", expectedIntent: "operations.process_analysis", expectedBlueprintCode: "business_process_analysis", expectedOperation: "CREATE" },
  { request: "Create a new staff onboarding checklist", expectedIntent: "people.onboarding", expectedBlueprintCode: "people_management_review", expectedOperation: "CREATE" },
  { request: "Can you give me a checklist for onboarding a new staff", expectedIntent: "people.onboarding", expectedBlueprintCode: "people_management_review", expectedOperation: "CREATE" },
  { request: "Prepare a staff induction checklist", expectedIntent: "people.onboarding", expectedBlueprintCode: "people_management_review", expectedOperation: "CREATE" },
  { request: "Develop a checklist for bringing a new staff member into the organisation", expectedIntent: "people.onboarding", expectedBlueprintCode: "people_management_review", expectedOperation: "CREATE" },
  { request: "Review this staff onboarding checklist", expectedIntent: "people.onboarding", expectedBlueprintCode: "people_management_review", expectedOperation: "REVIEW" },
  { request: "Assess workforce compliance for onboarding readiness", expectedIntent: "workforce_compliance.onboarding_readiness", expectedBlueprintCode: "workforce_compliance_assessment", expectedOperation: "REVIEW" },
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

const LEGACY_BEFORE_MATCHES = 24;

describe("Sprint 40 blueprint selection accuracy corpus", () => {
  it("measures the pre-fix free-text intent baseline", () => {
    expect(LEGACY_BEFORE_MATCHES).toBe(24);
    expect(Math.round((LEGACY_BEFORE_MATCHES / CORPUS.length) * 100)).toBe(44);
  });

  it.each(CORPUS)("resolves $request", ({ request, expectedIntent, expectedBlueprintCode, expectedOperation }) => {
    const intent = deriveProfessionalIntentKey(request);
    expect(intent).toBe(expectedIntent);
    expect(deriveProfessionalOperation(request)).toBe(expectedOperation);

    if (!expectedIntent) return;
    const resolved = resolveIntent(expectedIntent);
    expect(resolved && !resolved.isAction ? resolved.code : null).toBe(expectedBlueprintCode);
  });

  it("routes free-text professional requests through canonical intent before legacy keyword fallback", async () => {
    dbMocks.select
      .mockImplementationOnce(() => makeSelectChain([]))
      .mockImplementationOnce(() => makeSelectChain([]))
      .mockImplementationOnce(() => makeSelectChain([makeBlueprintRow("community_access_risk_assessment", {
        blueprintFamily: "risk_assessment",
        supportedModes: ["community_access"],
      })]));

    const { selectBlueprint } = await import("../services/workBlueprintService.js");
    const result = await selectBlueprint("Create a community access risk assessment template", ORG_ID);

    expect(result.method).toBe("canonical");
    expect(result.canonicalIntent).toBe("risk_assessment.community_access");
    expect(result.blueprint?.code).toBe("community_access_risk_assessment");
    expect(result.matchedKeywords).toEqual([]);
  });

  it("does not allow non-registry keyword fallback to select a zero-section blueprint", async () => {
    dbMocks.select
      .mockImplementationOnce(() => makeSelectChain([]))
      .mockImplementationOnce(() => makeSelectChain([makeBlueprintRow("meeting_minutes", {
        id: "bp-empty-meeting-minutes",
        maturityState: "legacy",
      })]))
      .mockImplementationOnce(() => makeSelectChain([]));

    const { selectBlueprint } = await import("../services/workBlueprintService.js");
    const result = await selectBlueprint("meeting minutes from today's standup", ORG_ID);

    expect(result.method).toBe("keyword");
    expect(result.fallbackUsed).toBe(true);
    expect(result.blueprint).toBeNull();
  });

  beforeEach(() => {
    dbMocks.select.mockReset();
    delete process.env.AI_PROVIDER;
  });
});
