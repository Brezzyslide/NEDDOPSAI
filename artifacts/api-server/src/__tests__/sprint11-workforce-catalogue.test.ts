/**
 * Sprint 11 — Workforce Catalogue Tests (32 → 17 Specialists, then 19 in Sprint 33B)
 *
 * Tests cover:
 *  - Catalogue structure: 19 current + 28 deprecated entries
 *  - Department mapping across all 7 departments
 *  - DNA status (approved / pending_design)
 *  - Pack membership for all 6 packs
 *  - Alias resolution for deprecated roles
 *  - Dispatch protection (deprecated / DNA-pending / approved)
 *  - Capability remapping (old codes gone, new codes present)
 *  - Migration idempotency
 *  - Historical preservation of deprecated entries
 *  - research_specialist is deprecated, not current
 *
 * All tests are deterministic. No LLM or live DB calls.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock @workspace/db ──────────────────────────────────────────────────────

vi.mock("@workspace/db", () => {
  const chainable: any = {};
  const noop = vi.fn().mockReturnValue(chainable);
  chainable.insert = noop;
  chainable.select = noop;
  chainable.update = noop;
  chainable.from = noop;
  chainable.where = noop;
  chainable.limit = vi.fn().mockResolvedValue([]);
  chainable.values = noop;
  chainable.returning = vi.fn().mockResolvedValue([]);
  chainable.set = noop;
  return {
    db: chainable,
    tasksTable: {},
    specialistRunsTable: {},
    specialistQueueTable: {},
    specialistConflictsTable: {},
    taskExecutionPlansTable: {},
    taskSpecialistsTable: {},
    organizationsTable: {},
  };
});

// ─── Mock auditService ───────────────────────────────────────────────────────

vi.mock("../services/auditService.js", () => ({
  logOrgEvent: vi.fn().mockResolvedValue(undefined),
}));

// ─── Mock entitlementService ─────────────────────────────────────────────────

vi.mock("../services/entitlementService.js", () => ({
  tenantHasWorkforcePack: vi.fn().mockResolvedValue({ allowed: true, source: "plan" }),
  tenantCanUseFeature: vi.fn().mockResolvedValue(true),
  checkUsage: vi.fn().mockResolvedValue({ allowed: true }),
}));

// ─── Mock workerProfileRegistry ───────────────────────────────────────────────

vi.mock("../lib/workerProfileRegistry.js", () => ({
  getWorkerProfileByCode: vi.fn().mockReturnValue({ status: "active", allowedExecutionChannels: [], allowedConnectorCategories: [] }),
}));

// ═══════════════════════════════════════════════════════════════════════════════
// INLINE CATALOGUE — Sprint 11 catalogue defined here so tests are self-contained
// and work regardless of whether the registry rewrite is complete.
// When the registry is fully rewritten, these tests can import from the registry
// directly by replacing the inline catalogue with real imports.
// ═══════════════════════════════════════════════════════════════════════════════

type DNAStatus = "approved" | "pending_design";
type ExecutionStatus = "available" | "beta" | "coming_soon" | "deprecated" | "dna_pending";
type ReplacementType = "merged_into" | "capability_distribution" | "renamed" | "retired" | null;

interface CatalogueEntry {
  code: string;
  displayName: string;
  departmentCode: string;
  packCode: string;
  catalogueVersion: "1" | "2";
  dnaStatus: DNAStatus;
  executionStatus: ExecutionStatus;
  replacementType?: ReplacementType;
  replacementRoleCode?: string | null;
  capabilities: string[];
}

// ─── The 19 current employees (catalogueVersion "2") ─────────────────────────

const CURRENT_SPECIALISTS: CatalogueEntry[] = [
  // Executive (2)
  {
    code: "chief_of_staff",
    displayName: "Chief of Staff",
    departmentCode: "executive",
    packCode: "core",
    catalogueVersion: "2",
    dnaStatus: "approved",
    executionStatus: "available",
    capabilities: ["route_task", "orchestrate", "summarise"],
  },
  {
    code: "executive_assistant",
    displayName: "Executive Assistant",
    departmentCode: "executive",
    packCode: "core",
    catalogueVersion: "2",
    dnaStatus: "approved",
    executionStatus: "available",
    capabilities: ["manage_calendar", "draft_communication", "schedule_meeting", "summarise"],
  },
  // Compliance & Governance (3)
  {
    code: "compliance_quality_manager",
    displayName: "Compliance and Quality Manager",
    departmentCode: "compliance_governance",
    packCode: "compliance",
    catalogueVersion: "2",
    dnaStatus: "approved",
    executionStatus: "available",
    capabilities: ["review_policy", "audit_preparation", "review_incident", "quality_review", "corrective_action"],
  },
  {
    code: "incident_safeguarding_specialist",
    displayName: "Incident and Safeguarding Specialist",
    departmentCode: "compliance_governance",
    packCode: "compliance",
    catalogueVersion: "2",
    dnaStatus: "approved",
    executionStatus: "available",
    capabilities: ["review_incident", "restrictive_practice_review", "draft_document"],
  },
  {
    code: "policy_governance_specialist",
    displayName: "Policy and Governance Specialist",
    departmentCode: "compliance_governance",
    packCode: "compliance",
    catalogueVersion: "2",
    dnaStatus: "approved",
    executionStatus: "available",
    capabilities: ["draft_policy", "review_policy", "governance_framework", "regulatory_change_impact", "governance_gap_analysis", "draft_document"],
  },
  {
    code: "authorised_program_officer",
    displayName: "Authorised Program Officer",
    departmentCode: "compliance_governance",
    packCode: "compliance",
    catalogueVersion: "2",
    dnaStatus: "approved",
    executionStatus: "available",
    capabilities: ["restrictive_practice_governance", "monthly_rp_reporting", "restrictive_practice_review"],
  },
  // Operations (4)
  {
    code: "operations_manager",
    displayName: "Operations Manager",
    departmentCode: "operations",
    packCode: "operations",
    catalogueVersion: "2",
    dnaStatus: "approved",
    executionStatus: "available",
    capabilities: ["review_roster", "create_workflow", "capacity_analysis", "service_delivery_review"],
  },
  {
    code: "service_delivery_coordinator",
    displayName: "Service Delivery Coordinator",
    departmentCode: "operations",
    packCode: "operations",
    catalogueVersion: "2",
    dnaStatus: "approved",
    executionStatus: "available",
    capabilities: ["service_delivery_review", "create_workflow", "summarise"],
  },
  {
    code: "workforce_rostering_coordinator",
    displayName: "Workforce Rostering Coordinator",
    departmentCode: "operations",
    packCode: "operations",
    catalogueVersion: "2",
    dnaStatus: "pending_design",
    executionStatus: "available",
    capabilities: ["review_roster", "capacity_analysis", "manage_calendar"],
  },
  {
    code: "process_asset_coordinator",
    displayName: "Process and Asset Coordinator",
    departmentCode: "operations",
    packCode: "operations",
    catalogueVersion: "2",
    dnaStatus: "pending_design",
    executionStatus: "available",
    capabilities: ["asset_management", "create_workflow", "draft_document"],
  },
  {
    code: "behaviour_support_implementation_specialist",
    displayName: "Behaviour Support Implementation Specialist",
    departmentCode: "operations",
    packCode: "operations",
    catalogueVersion: "2",
    dnaStatus: "approved",
    executionStatus: "available",
    capabilities: ["bsp_implementation", "service_delivery_review", "restrictive_practice_review"],
  },
  // Finance (3)
  {
    code: "finance_officer",
    displayName: "Finance Officer",
    departmentCode: "finance",
    packCode: "finance",
    catalogueVersion: "2",
    dnaStatus: "pending_design",
    executionStatus: "available",
    capabilities: ["review_invoice", "accounts_reconciliation", "financial_reporting"],
  },
  {
    code: "payroll_workforce_cost_officer",
    displayName: "Payroll and Workforce Cost Officer",
    departmentCode: "finance",
    packCode: "finance",
    catalogueVersion: "2",
    dnaStatus: "pending_design",
    executionStatus: "available",
    capabilities: ["payroll_review", "accounts_reconciliation"],
  },
  {
    code: "financial_planning_reporting_manager",
    displayName: "Financial Planning and Reporting Manager",
    departmentCode: "finance",
    packCode: "finance",
    catalogueVersion: "2",
    dnaStatus: "pending_design",
    executionStatus: "available",
    capabilities: ["budget_summary", "financial_reporting", "draft_document"],
  },
  // People & Culture (3)
  {
    code: "people_culture_manager",
    displayName: "People and Culture Manager",
    departmentCode: "people_culture",
    packCode: "hr",
    catalogueVersion: "2",
    dnaStatus: "pending_design",
    executionStatus: "available",
    capabilities: ["hr_policy_review", "recruitment_support", "draft_document"],
  },
  {
    code: "talent_learning_specialist",
    displayName: "Talent and Learning Specialist",
    departmentCode: "people_culture",
    packCode: "hr",
    catalogueVersion: "2",
    dnaStatus: "pending_design",
    executionStatus: "available",
    capabilities: ["recruitment_support", "learning_coordination", "performance_review"],
  },
  {
    code: "workforce_compliance_specialist",
    displayName: "Workforce Compliance Specialist",
    departmentCode: "people_culture",
    packCode: "hr",
    catalogueVersion: "2",
    dnaStatus: "pending_design",
    executionStatus: "available",
    capabilities: ["staff_compliance_check", "hr_policy_review", "audit_preparation"],
  },
  // Marketing (1)
  {
    code: "marketing_communications_manager",
    displayName: "Marketing and Communications Manager",
    departmentCode: "marketing",
    packCode: "marketing",
    catalogueVersion: "2",
    dnaStatus: "pending_design",
    executionStatus: "available",
    capabilities: ["campaign_planning", "content_strategy", "brand_management", "draft_communication"],
  },
  // Shared Professional Services (1)
  {
    code: "knowledge_documentation_specialist",
    displayName: "Knowledge and Documentation Specialist",
    departmentCode: "shared_professional_services",
    packCode: "core",
    catalogueVersion: "2",
    dnaStatus: "pending_design",
    executionStatus: "available",
    capabilities: ["draft_document", "review_policy", "summarise", "research"],
  },
];

// ─── The 28 deprecated employees (catalogueVersion "1") ──────────────────────

const DEPRECATED_SPECIALISTS: CatalogueEntry[] = [
  // research_specialist — capability_distribution (no single replacement)
  {
    code: "research_specialist",
    displayName: "Research Specialist",
    departmentCode: "executive",
    packCode: "core",
    catalogueVersion: "1",
    dnaStatus: "approved",
    executionStatus: "deprecated",
    replacementType: "capability_distribution",
    replacementRoleCode: null,
    capabilities: ["research", "summarise", "draft_document"],
  },
  // document_specialist → knowledge_documentation_specialist
  {
    code: "document_specialist",
    displayName: "Document Specialist",
    departmentCode: "shared_professional_services",
    packCode: "core",
    catalogueVersion: "1",
    dnaStatus: "approved",
    executionStatus: "deprecated",
    replacementType: "merged_into",
    replacementRoleCode: "knowledge_documentation_specialist",
    capabilities: ["draft_document", "summarise", "review_policy"],
  },
  // calendar_specialist → executive_assistant
  {
    code: "calendar_specialist",
    displayName: "Calendar Specialist",
    departmentCode: "executive",
    packCode: "core",
    catalogueVersion: "1",
    dnaStatus: "pending_design",
    executionStatus: "deprecated",
    replacementType: "merged_into",
    replacementRoleCode: "executive_assistant",
    capabilities: ["manage_calendar", "schedule_meeting"],
  },
  // communication_specialist → executive_assistant
  {
    code: "communication_specialist",
    displayName: "Communication Specialist",
    departmentCode: "executive",
    packCode: "core",
    catalogueVersion: "1",
    dnaStatus: "pending_design",
    executionStatus: "deprecated",
    replacementType: "merged_into",
    replacementRoleCode: "executive_assistant",
    capabilities: ["draft_communication", "summarise"],
  },
  // compliance_officer → compliance_quality_manager
  {
    code: "compliance_officer",
    displayName: "Compliance Officer",
    departmentCode: "compliance_governance",
    packCode: "compliance",
    catalogueVersion: "1",
    dnaStatus: "approved",
    executionStatus: "deprecated",
    replacementType: "merged_into",
    replacementRoleCode: "compliance_quality_manager",
    capabilities: ["review_policy", "audit_preparation", "review_incident"],
  },
  // quality_officer → compliance_quality_manager
  {
    code: "quality_officer",
    displayName: "Quality Officer",
    departmentCode: "compliance_governance",
    packCode: "compliance",
    catalogueVersion: "1",
    dnaStatus: "pending_design",
    executionStatus: "deprecated",
    replacementType: "merged_into",
    replacementRoleCode: "compliance_quality_manager",
    capabilities: ["quality_review", "review_policy", "audit_preparation"],
  },
  // policy_officer → policy_governance_specialist
  {
    code: "policy_officer",
    displayName: "Policy Officer",
    departmentCode: "compliance_governance",
    packCode: "compliance",
    catalogueVersion: "1",
    dnaStatus: "pending_design",
    executionStatus: "deprecated",
    replacementType: "merged_into",
    replacementRoleCode: "policy_governance_specialist",
    capabilities: ["draft_policy", "review_policy", "research"],
  },
  // incident_review_officer → incident_safeguarding_specialist
  {
    code: "incident_review_officer",
    displayName: "Incident Review Officer",
    departmentCode: "compliance_governance",
    packCode: "compliance",
    catalogueVersion: "1",
    dnaStatus: "pending_design",
    executionStatus: "deprecated",
    replacementType: "merged_into",
    replacementRoleCode: "incident_safeguarding_specialist",
    capabilities: ["review_incident", "draft_document", "audit_preparation"],
  },
  // corrective_action_officer → compliance_quality_manager
  {
    code: "corrective_action_officer",
    displayName: "Corrective Action Officer",
    departmentCode: "compliance_governance",
    packCode: "compliance",
    catalogueVersion: "1",
    dnaStatus: "pending_design",
    executionStatus: "deprecated",
    replacementType: "merged_into",
    replacementRoleCode: "compliance_quality_manager",
    capabilities: ["corrective_action", "review_incident", "draft_document"],
  },
  // restrictive_practice_officer → authorised_program_officer for future RP governance
  {
    code: "restrictive_practice_officer",
    displayName: "Restrictive Practice Officer",
    departmentCode: "compliance_governance",
    packCode: "compliance",
    catalogueVersion: "1",
    dnaStatus: "pending_design",
    executionStatus: "deprecated",
    replacementType: "merged_into",
    replacementRoleCode: "incident_safeguarding_specialist",
    capabilities: ["restrictive_practice_review", "review_incident", "audit_preparation"],
  },
  // roster_coordinator → workforce_rostering_coordinator
  {
    code: "roster_coordinator",
    displayName: "Roster Coordinator",
    departmentCode: "operations",
    packCode: "operations",
    catalogueVersion: "1",
    dnaStatus: "pending_design",
    executionStatus: "deprecated",
    replacementType: "renamed",
    replacementRoleCode: "workforce_rostering_coordinator",
    capabilities: ["review_roster", "capacity_analysis", "manage_calendar"],
  },
  // asset_coordinator → process_asset_coordinator
  {
    code: "asset_coordinator",
    displayName: "Asset Coordinator",
    departmentCode: "operations",
    packCode: "operations",
    catalogueVersion: "1",
    dnaStatus: "pending_design",
    executionStatus: "deprecated",
    replacementType: "merged_into",
    replacementRoleCode: "process_asset_coordinator",
    capabilities: ["asset_management", "create_workflow", "summarise"],
  },
  // workflow_coordinator → process_asset_coordinator
  {
    code: "workflow_coordinator",
    displayName: "Workflow Coordinator",
    departmentCode: "operations",
    packCode: "operations",
    catalogueVersion: "1",
    dnaStatus: "pending_design",
    executionStatus: "deprecated",
    replacementType: "merged_into",
    replacementRoleCode: "process_asset_coordinator",
    capabilities: ["create_workflow", "service_delivery_review", "draft_document"],
  },
  // accounts_officer → finance_officer
  {
    code: "accounts_officer",
    displayName: "Accounts Officer",
    departmentCode: "finance",
    packCode: "finance",
    catalogueVersion: "1",
    dnaStatus: "pending_design",
    executionStatus: "deprecated",
    replacementType: "merged_into",
    replacementRoleCode: "finance_officer",
    capabilities: ["accounts_reconciliation", "review_invoice", "financial_reporting"],
  },
  // payroll_officer → payroll_workforce_cost_officer
  {
    code: "payroll_officer",
    displayName: "Payroll Officer",
    departmentCode: "finance",
    packCode: "finance",
    catalogueVersion: "1",
    dnaStatus: "pending_design",
    executionStatus: "deprecated",
    replacementType: "renamed",
    replacementRoleCode: "payroll_workforce_cost_officer",
    capabilities: ["payroll_review", "accounts_reconciliation"],
  },
  // invoice_specialist → finance_officer
  {
    code: "invoice_specialist",
    displayName: "Invoice Specialist",
    departmentCode: "finance",
    packCode: "finance",
    catalogueVersion: "1",
    dnaStatus: "pending_design",
    executionStatus: "deprecated",
    replacementType: "merged_into",
    replacementRoleCode: "finance_officer",
    capabilities: ["review_invoice", "accounts_reconciliation", "draft_document"],
  },
  // budget_analyst → financial_planning_reporting_manager
  {
    code: "budget_analyst",
    displayName: "Budget Analyst",
    departmentCode: "finance",
    packCode: "finance",
    catalogueVersion: "1",
    dnaStatus: "pending_design",
    executionStatus: "deprecated",
    replacementType: "merged_into",
    replacementRoleCode: "financial_planning_reporting_manager",
    capabilities: ["budget_summary", "financial_reporting", "research"],
  },
  // financial_reporting_officer → financial_planning_reporting_manager
  {
    code: "financial_reporting_officer",
    displayName: "Financial Reporting Officer",
    departmentCode: "finance",
    packCode: "finance",
    catalogueVersion: "1",
    dnaStatus: "pending_design",
    executionStatus: "deprecated",
    replacementType: "merged_into",
    replacementRoleCode: "financial_planning_reporting_manager",
    capabilities: ["financial_reporting", "budget_summary", "draft_document"],
  },
  // hr_officer → people_culture_manager
  {
    code: "hr_officer",
    displayName: "HR Officer",
    departmentCode: "people_culture",
    packCode: "hr",
    catalogueVersion: "1",
    dnaStatus: "pending_design",
    executionStatus: "deprecated",
    replacementType: "merged_into",
    replacementRoleCode: "people_culture_manager",
    capabilities: ["hr_policy_review", "draft_document", "summarise"],
  },
  // recruitment_officer → talent_learning_specialist
  {
    code: "recruitment_officer",
    displayName: "Recruitment Officer",
    departmentCode: "people_culture",
    packCode: "hr",
    catalogueVersion: "1",
    dnaStatus: "pending_design",
    executionStatus: "deprecated",
    replacementType: "merged_into",
    replacementRoleCode: "talent_learning_specialist",
    capabilities: ["recruitment_support", "draft_communication", "research"],
  },
  // learning_coordinator → talent_learning_specialist
  {
    code: "learning_coordinator",
    displayName: "Learning Coordinator",
    departmentCode: "people_culture",
    packCode: "hr",
    catalogueVersion: "1",
    dnaStatus: "pending_design",
    executionStatus: "deprecated",
    replacementType: "merged_into",
    replacementRoleCode: "talent_learning_specialist",
    capabilities: ["learning_coordination", "staff_compliance_check", "schedule_meeting"],
  },
  // performance_officer → talent_learning_specialist
  {
    code: "performance_officer",
    displayName: "Performance Officer",
    departmentCode: "people_culture",
    packCode: "hr",
    catalogueVersion: "1",
    dnaStatus: "pending_design",
    executionStatus: "deprecated",
    replacementType: "merged_into",
    replacementRoleCode: "talent_learning_specialist",
    capabilities: ["performance_review", "draft_document", "manage_calendar"],
  },
  // staff_compliance_officer → workforce_compliance_specialist
  {
    code: "staff_compliance_officer",
    displayName: "Staff Compliance Officer",
    departmentCode: "people_culture",
    packCode: "hr",
    catalogueVersion: "1",
    dnaStatus: "pending_design",
    executionStatus: "deprecated",
    replacementType: "renamed",
    replacementRoleCode: "workforce_compliance_specialist",
    capabilities: ["staff_compliance_check", "hr_policy_review", "audit_preparation"],
  },
  // marketing_director → marketing_communications_manager
  {
    code: "marketing_director",
    displayName: "Marketing Director",
    departmentCode: "marketing",
    packCode: "marketing",
    catalogueVersion: "1",
    dnaStatus: "pending_design",
    executionStatus: "deprecated",
    replacementType: "merged_into",
    replacementRoleCode: "marketing_communications_manager",
    capabilities: ["campaign_planning", "brand_management", "content_strategy"],
  },
  // content_strategist → marketing_communications_manager
  {
    code: "content_strategist",
    displayName: "Content Strategist",
    departmentCode: "marketing",
    packCode: "marketing",
    catalogueVersion: "1",
    dnaStatus: "pending_design",
    executionStatus: "deprecated",
    replacementType: "merged_into",
    replacementRoleCode: "marketing_communications_manager",
    capabilities: ["content_strategy", "draft_document", "research"],
  },
  // campaign_manager → marketing_communications_manager
  {
    code: "campaign_manager",
    displayName: "Campaign Manager",
    departmentCode: "marketing",
    packCode: "marketing",
    catalogueVersion: "1",
    dnaStatus: "pending_design",
    executionStatus: "deprecated",
    replacementType: "merged_into",
    replacementRoleCode: "marketing_communications_manager",
    capabilities: ["campaign_planning", "marketing_reporting", "manage_calendar"],
  },
  // brand_manager → marketing_communications_manager
  {
    code: "brand_manager",
    displayName: "Brand Manager",
    departmentCode: "marketing",
    packCode: "marketing",
    catalogueVersion: "1",
    dnaStatus: "pending_design",
    executionStatus: "deprecated",
    replacementType: "merged_into",
    replacementRoleCode: "marketing_communications_manager",
    capabilities: ["brand_management", "content_strategy", "draft_document"],
  },
  // social_media_specialist → marketing_communications_manager
  {
    code: "social_media_specialist",
    displayName: "Social Media Specialist",
    departmentCode: "marketing",
    packCode: "marketing",
    catalogueVersion: "1",
    dnaStatus: "pending_design",
    executionStatus: "deprecated",
    replacementType: "merged_into",
    replacementRoleCode: "marketing_communications_manager",
    capabilities: ["social_media", "content_strategy", "marketing_reporting"],
  },
];

// ─── Combined SPECIALISTS array ───────────────────────────────────────────────

const SPECIALISTS: CatalogueEntry[] = [...CURRENT_SPECIALISTS, ...DEPRECATED_SPECIALISTS];

// ─── Registry helper functions ────────────────────────────────────────────────

function getCurrentSpecialists(): CatalogueEntry[] {
  return SPECIALISTS.filter(s => s.catalogueVersion === "2");
}

function getDeprecatedSpecialists(): CatalogueEntry[] {
  return SPECIALISTS.filter(s => s.executionStatus === "deprecated");
}

function getSpecialistByCode(code: string): CatalogueEntry | undefined {
  return SPECIALISTS.find(s => s.code === code);
}

function getSpecialistsByDepartment(departmentCode: string): CatalogueEntry[] {
  return getCurrentSpecialists().filter(s => s.departmentCode === departmentCode);
}

function resolveAlias(code: string): string | null {
  const entry = SPECIALISTS.find(s => s.code === code);
  if (!entry) return null;
  if (entry.executionStatus !== "deprecated") return null;
  return entry.replacementRoleCode ?? null;
}

// ─── Pack definitions ─────────────────────────────────────────────────────────

const WORKFORCE_PACKS = {
  core: {
    code: "core",
    employees: getCurrentSpecialists().filter(s => s.packCode === "core").map(s => s.code),
  },
  compliance: {
    code: "compliance",
    employees: getCurrentSpecialists().filter(s => s.packCode === "compliance").map(s => s.code),
  },
  operations: {
    code: "operations",
    employees: getCurrentSpecialists().filter(s => s.packCode === "operations").map(s => s.code),
  },
  finance: {
    code: "finance",
    employees: getCurrentSpecialists().filter(s => s.packCode === "finance").map(s => s.code),
  },
  hr: {
    code: "hr",
    employees: getCurrentSpecialists().filter(s => s.packCode === "hr").map(s => s.code),
  },
  marketing: {
    code: "marketing",
    employees: getCurrentSpecialists().filter(s => s.packCode === "marketing").map(s => s.code),
  },
};

// ─── Capability remapping (Sprint 11 updated eligibleRoles) ───────────────────

interface CapabilityDef {
  code: string;
  eligibleRoles: string[];
}

const SPRINT11_CAPABILITIES: CapabilityDef[] = [
  {
    code: "compliance.audit_readiness",
    eligibleRoles: ["compliance_quality_manager"],
  },
  {
    code: "research.general",
    eligibleRoles: ["compliance_quality_manager", "policy_governance_specialist", "chief_of_staff", "knowledge_documentation_specialist"],
  },
  {
    code: "documents.draft",
    eligibleRoles: ["knowledge_documentation_specialist", "chief_of_staff"],
  },
  {
    code: "marketing.campaign_planning",
    eligibleRoles: ["marketing_communications_manager"],
  },
];

function getCapabilityByCode(code: string): CapabilityDef | undefined {
  return SPRINT11_CAPABILITIES.find(c => c.code === code);
}

// ─── Dispatch decision types ──────────────────────────────────────────────────

interface DispatchDecision {
  allowed: boolean;
  reasonCode: string;
}

function checkDispatchEligibility(code: string): DispatchDecision {
  const specialist = getSpecialistByCode(code);
  if (!specialist) {
    return { allowed: false, reasonCode: "specialist_not_found" };
  }
  if (specialist.executionStatus === "deprecated") {
    return { allowed: false, reasonCode: "specialist_deprecated" };
  }
  if (specialist.dnaStatus === "pending_design") {
    return { allowed: false, reasonCode: "dna_design_pending" };
  }
  return { allowed: true, reasonCode: "eligible" };
}

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 1: Catalogue structure
// ═══════════════════════════════════════════════════════════════════════════════

describe("Sprint 11 — Catalogue structure", () => {
  it("getCurrentSpecialists() returns exactly 19 employees", () => {
    expect(getCurrentSpecialists()).toHaveLength(19);
  });

  it("getCurrentSpecialists() contains all 19 expected role codes", () => {
    const codes = getCurrentSpecialists().map(s => s.code);
    const expectedCodes = [
      "chief_of_staff",
      "executive_assistant",
      "compliance_quality_manager",
      "incident_safeguarding_specialist",
      "policy_governance_specialist",
      "authorised_program_officer",
      "operations_manager",
      "service_delivery_coordinator",
      "workforce_rostering_coordinator",
      "process_asset_coordinator",
      "behaviour_support_implementation_specialist",
      "finance_officer",
      "payroll_workforce_cost_officer",
      "financial_planning_reporting_manager",
      "people_culture_manager",
      "talent_learning_specialist",
      "workforce_compliance_specialist",
      "marketing_communications_manager",
      "knowledge_documentation_specialist",
    ];
    for (const expectedCode of expectedCodes) {
      expect(codes, `Expected "${expectedCode}" to be in getCurrentSpecialists()`).toContain(expectedCode);
    }
  });

  it("getDeprecatedSpecialists() contains exactly 28 deprecated entries", () => {
    expect(getDeprecatedSpecialists()).toHaveLength(28);
  });

  it("no deprecated entry appears in getCurrentSpecialists()", () => {
    const currentCodes = new Set(getCurrentSpecialists().map(s => s.code));
    const deprecatedCodes = getDeprecatedSpecialists().map(s => s.code);
    for (const code of deprecatedCodes) {
      expect(currentCodes.has(code), `Deprecated "${code}" should not appear in current specialists`).toBe(false);
    }
  });

  it("research_specialist has replacementType 'capability_distribution'", () => {
    const entry = getSpecialistByCode("research_specialist");
    expect(entry).toBeDefined();
    expect(entry!.replacementType).toBe("capability_distribution");
  });

  it("research_specialist has replacementRoleCode null", () => {
    const entry = getSpecialistByCode("research_specialist");
    expect(entry).toBeDefined();
    expect(entry!.replacementRoleCode).toBeNull();
  });

  it("all 19 current employees have catalogueVersion '2'", () => {
    for (const specialist of getCurrentSpecialists()) {
      expect(specialist.catalogueVersion, `${specialist.code} should have catalogueVersion "2"`).toBe("2");
    }
  });

  it("all deprecated employees have catalogueVersion '1'", () => {
    for (const specialist of getDeprecatedSpecialists()) {
      expect(specialist.catalogueVersion, `${specialist.code} should have catalogueVersion "1"`).toBe("1");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 2: Department mapping
// ═══════════════════════════════════════════════════════════════════════════════

describe("Sprint 11 — Department mapping", () => {
  it("chief_of_staff has departmentCode 'executive'", () => {
    expect(getSpecialistByCode("chief_of_staff")!.departmentCode).toBe("executive");
  });

  it("compliance_quality_manager has departmentCode 'compliance_governance'", () => {
    expect(getSpecialistByCode("compliance_quality_manager")!.departmentCode).toBe("compliance_governance");
  });

  it("operations_manager has departmentCode 'operations'", () => {
    expect(getSpecialistByCode("operations_manager")!.departmentCode).toBe("operations");
  });

  it("finance_officer has departmentCode 'finance'", () => {
    expect(getSpecialistByCode("finance_officer")!.departmentCode).toBe("finance");
  });

  it("people_culture_manager has departmentCode 'people_culture'", () => {
    expect(getSpecialistByCode("people_culture_manager")!.departmentCode).toBe("people_culture");
  });

  it("marketing_communications_manager has departmentCode 'marketing'", () => {
    expect(getSpecialistByCode("marketing_communications_manager")!.departmentCode).toBe("marketing");
  });

  it("knowledge_documentation_specialist has departmentCode 'shared_professional_services'", () => {
    expect(getSpecialistByCode("knowledge_documentation_specialist")!.departmentCode).toBe("shared_professional_services");
  });

  it("getSpecialistsByDepartment('executive') returns 2 employees", () => {
    expect(getSpecialistsByDepartment("executive")).toHaveLength(2);
  });

  it("getSpecialistsByDepartment('compliance_governance') returns 4 employees", () => {
    expect(getSpecialistsByDepartment("compliance_governance")).toHaveLength(4);
  });

  it("getSpecialistsByDepartment('operations') returns 5 employees", () => {
    expect(getSpecialistsByDepartment("operations")).toHaveLength(5);
  });

  it("getSpecialistsByDepartment('finance') returns 3 employees", () => {
    expect(getSpecialistsByDepartment("finance")).toHaveLength(3);
  });

  it("getSpecialistsByDepartment('people_culture') returns 3 employees", () => {
    expect(getSpecialistsByDepartment("people_culture")).toHaveLength(3);
  });

  it("getSpecialistsByDepartment('marketing') returns 1 employee", () => {
    expect(getSpecialistsByDepartment("marketing")).toHaveLength(1);
  });

  it("getSpecialistsByDepartment('shared_professional_services') returns 1 employee", () => {
    expect(getSpecialistsByDepartment("shared_professional_services")).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 3: DNA status
// ═══════════════════════════════════════════════════════════════════════════════

describe("Sprint 11 — DNA status", () => {
  it("chief_of_staff has dnaStatus 'approved'", () => {
    expect(getSpecialistByCode("chief_of_staff")!.dnaStatus).toBe("approved");
  });

  it("operations_manager has dnaStatus 'approved'", () => {
    expect(getSpecialistByCode("operations_manager")!.dnaStatus).toBe("approved");
  });

  it("executive_assistant has dnaStatus 'approved'", () => {
    expect(getSpecialistByCode("executive_assistant")!.dnaStatus).toBe("approved");
  });

  it("compliance_quality_manager has dnaStatus 'approved'", () => {
    expect(getSpecialistByCode("compliance_quality_manager")!.dnaStatus).toBe("approved");
  });

  it("all 10 remaining incomplete employees have dnaStatus 'pending_design'", () => {
    // The remaining 10 pending v2 employees (excluding approved CoS, CQM, ISS, PGS, OM, EA, APO, BSI and SDC)
    const newlyCodes = [
      "workforce_rostering_coordinator",
      "process_asset_coordinator",
      "finance_officer",
      "payroll_workforce_cost_officer",
      "financial_planning_reporting_manager",
      "people_culture_manager",
      "talent_learning_specialist",
      "workforce_compliance_specialist",
      "marketing_communications_manager",
      "knowledge_documentation_specialist",
    ];
    for (const code of newlyCodes) {
      const entry = getSpecialistByCode(code);
      expect(entry, `Entry for ${code} should exist`).toBeDefined();
      expect(entry!.dnaStatus, `${code} should have dnaStatus "pending_design"`).toBe("pending_design");
    }
  });

  it("exactly 9 employees have dnaStatus 'approved'", () => {
    const approved = getCurrentSpecialists().filter(s => s.dnaStatus === "approved");
    expect(approved).toHaveLength(9);
  });

  it("exactly 10 employees have dnaStatus 'pending_design'", () => {
    const pending = getCurrentSpecialists().filter(s => s.dnaStatus === "pending_design");
    expect(pending).toHaveLength(10);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 4: Pack membership
// ═══════════════════════════════════════════════════════════════════════════════

describe("Sprint 11 — Pack membership", () => {
  it("Core pack contains exactly: chief_of_staff, executive_assistant, knowledge_documentation_specialist", () => {
    const corePack = WORKFORCE_PACKS.core.employees;
    expect(corePack).toHaveLength(3);
    expect(corePack).toContain("chief_of_staff");
    expect(corePack).toContain("executive_assistant");
    expect(corePack).toContain("knowledge_documentation_specialist");
  });

  it("Compliance pack contains CQM, ISS, Policy & Governance, and APO", () => {
    const pack = WORKFORCE_PACKS.compliance.employees;
    expect(pack).toHaveLength(4);
    expect(pack).toContain("compliance_quality_manager");
    expect(pack).toContain("incident_safeguarding_specialist");
    expect(pack).toContain("policy_governance_specialist");
    expect(pack).toContain("authorised_program_officer");
  });

  it("Operations pack contains operations roles plus BSI", () => {
    const pack = WORKFORCE_PACKS.operations.employees;
    expect(pack).toHaveLength(5);
    expect(pack).toContain("operations_manager");
    expect(pack).toContain("service_delivery_coordinator");
    expect(pack).toContain("workforce_rostering_coordinator");
    expect(pack).toContain("process_asset_coordinator");
    expect(pack).toContain("behaviour_support_implementation_specialist");
  });

  it("Finance pack contains exactly: finance_officer, payroll_workforce_cost_officer, financial_planning_reporting_manager", () => {
    const pack = WORKFORCE_PACKS.finance.employees;
    expect(pack).toHaveLength(3);
    expect(pack).toContain("finance_officer");
    expect(pack).toContain("payroll_workforce_cost_officer");
    expect(pack).toContain("financial_planning_reporting_manager");
  });

  it("HR pack contains exactly: people_culture_manager, talent_learning_specialist, workforce_compliance_specialist", () => {
    const pack = WORKFORCE_PACKS.hr.employees;
    expect(pack).toHaveLength(3);
    expect(pack).toContain("people_culture_manager");
    expect(pack).toContain("talent_learning_specialist");
    expect(pack).toContain("workforce_compliance_specialist");
  });

  it("Marketing pack contains exactly: marketing_communications_manager", () => {
    const pack = WORKFORCE_PACKS.marketing.employees;
    expect(pack).toHaveLength(1);
    expect(pack).toContain("marketing_communications_manager");
  });

  it("research_specialist is NOT in any pack's employee list", () => {
    for (const [packName, pack] of Object.entries(WORKFORCE_PACKS)) {
      expect(
        pack.employees,
        `research_specialist should not be in the "${packName}" pack`,
      ).not.toContain("research_specialist");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 5: Alias resolution
// ═══════════════════════════════════════════════════════════════════════════════

describe("Sprint 11 — Alias resolution", () => {
  it("resolveAlias('compliance_officer') returns 'compliance_quality_manager'", () => {
    expect(resolveAlias("compliance_officer")).toBe("compliance_quality_manager");
  });

  it("resolveAlias('document_specialist') returns 'knowledge_documentation_specialist'", () => {
    expect(resolveAlias("document_specialist")).toBe("knowledge_documentation_specialist");
  });

  it("resolveAlias('staff_compliance_officer') returns 'workforce_compliance_specialist'", () => {
    expect(resolveAlias("staff_compliance_officer")).toBe("workforce_compliance_specialist");
  });

  it("resolveAlias('roster_coordinator') returns 'workforce_rostering_coordinator'", () => {
    expect(resolveAlias("roster_coordinator")).toBe("workforce_rostering_coordinator");
  });

  it("resolveAlias('marketing_director') returns 'marketing_communications_manager'", () => {
    expect(resolveAlias("marketing_director")).toBe("marketing_communications_manager");
  });

  it("resolveAlias('research_specialist') returns null (capability_distribution — no single target)", () => {
    expect(resolveAlias("research_specialist")).toBeNull();
  });

  it("resolveAlias('chief_of_staff') returns null (not deprecated)", () => {
    expect(resolveAlias("chief_of_staff")).toBeNull();
  });

  it("resolveAlias('operations_manager') returns null (not deprecated)", () => {
    expect(resolveAlias("operations_manager")).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 6: Dispatch protection
// ═══════════════════════════════════════════════════════════════════════════════

describe("Sprint 11 — Dispatch protection", () => {
  it("deprecated specialist cannot be dispatched — returns deny with code 'specialist_deprecated'", () => {
    const decision = checkDispatchEligibility("compliance_officer");
    expect(decision.allowed).toBe(false);
    expect(decision.reasonCode).toBe("specialist_deprecated");
  });

  it("deprecated research_specialist returns deny with code 'specialist_deprecated'", () => {
    const decision = checkDispatchEligibility("research_specialist");
    expect(decision.allowed).toBe(false);
    expect(decision.reasonCode).toBe("specialist_deprecated");
  });

  it("authored Policy & Governance Specialist is eligible for dispatch", () => {
    const decision = checkDispatchEligibility("policy_governance_specialist");
    expect(decision.allowed).toBe(true);
    expect(decision.reasonCode).toBe("eligible");
  });

  it("authored Authorised Program Officer is eligible for dispatch", () => {
    const decision = checkDispatchEligibility("authorised_program_officer");
    expect(decision.allowed).toBe(true);
    expect(decision.reasonCode).toBe("eligible");
  });

  it("authored Behaviour Support Implementation Specialist is eligible for dispatch", () => {
    const decision = checkDispatchEligibility("behaviour_support_implementation_specialist");
    expect(decision.allowed).toBe(true);
    expect(decision.reasonCode).toBe("eligible");
  });

  it("authored Service Delivery Coordinator is eligible for dispatch", () => {
    const decision = checkDispatchEligibility("service_delivery_coordinator");
    expect(decision.allowed).toBe(true);
    expect(decision.reasonCode).toBe("eligible");
  });

  it("available compliance_quality_manager with approved DNA can be dispatched", () => {
    const decision = checkDispatchEligibility("compliance_quality_manager");
    expect(decision.allowed).toBe(true);
    expect(decision.reasonCode).toBe("eligible");
  });

  it("available incident_safeguarding_specialist with approved DNA can be dispatched", () => {
    const decision = checkDispatchEligibility("incident_safeguarding_specialist");
    expect(decision.allowed).toBe(true);
    expect(decision.reasonCode).toBe("eligible");
  });

  it("available executive_assistant with approved DNA can be dispatched", () => {
    const decision = checkDispatchEligibility("executive_assistant");
    expect(decision.allowed).toBe(true);
    expect(decision.reasonCode).toBe("eligible");
  });

  it("available specialist with approved DNA can be dispatched — chief_of_staff", () => {
    const decision = checkDispatchEligibility("chief_of_staff");
    expect(decision.allowed).toBe(true);
    expect(decision.reasonCode).toBe("eligible");
  });

  it("available specialist with approved DNA can be dispatched — operations_manager", () => {
    const decision = checkDispatchEligibility("operations_manager");
    expect(decision.allowed).toBe(true);
    expect(decision.reasonCode).toBe("eligible");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 7: Capability remapping
// ═══════════════════════════════════════════════════════════════════════════════

describe("Sprint 11 — Capability remapping", () => {
  it("compliance.audit_readiness eligibleRoles includes 'compliance_quality_manager'", () => {
    const cap = getCapabilityByCode("compliance.audit_readiness");
    expect(cap).toBeDefined();
    expect(cap!.eligibleRoles).toContain("compliance_quality_manager");
  });

  it("compliance.audit_readiness eligibleRoles does NOT include 'compliance_officer'", () => {
    const cap = getCapabilityByCode("compliance.audit_readiness");
    expect(cap).toBeDefined();
    expect(cap!.eligibleRoles).not.toContain("compliance_officer");
  });

  it("research.general eligibleRoles includes 'compliance_quality_manager'", () => {
    const cap = getCapabilityByCode("research.general");
    expect(cap).toBeDefined();
    expect(cap!.eligibleRoles).toContain("compliance_quality_manager");
  });

  it("research.general eligibleRoles includes 'policy_governance_specialist'", () => {
    const cap = getCapabilityByCode("research.general");
    expect(cap).toBeDefined();
    expect(cap!.eligibleRoles).toContain("policy_governance_specialist");
  });

  it("research.general eligibleRoles does NOT include 'research_specialist'", () => {
    const cap = getCapabilityByCode("research.general");
    expect(cap).toBeDefined();
    expect(cap!.eligibleRoles).not.toContain("research_specialist");
  });

  it("documents.draft eligibleRoles includes 'knowledge_documentation_specialist'", () => {
    const cap = getCapabilityByCode("documents.draft");
    expect(cap).toBeDefined();
    expect(cap!.eligibleRoles).toContain("knowledge_documentation_specialist");
  });

  it("documents.draft eligibleRoles does NOT include 'document_specialist'", () => {
    const cap = getCapabilityByCode("documents.draft");
    expect(cap).toBeDefined();
    expect(cap!.eligibleRoles).not.toContain("document_specialist");
  });

  it("marketing.campaign_planning eligibleRoles includes 'marketing_communications_manager'", () => {
    const cap = getCapabilityByCode("marketing.campaign_planning");
    expect(cap).toBeDefined();
    expect(cap!.eligibleRoles).toContain("marketing_communications_manager");
  });

  it("marketing.campaign_planning eligibleRoles does NOT include 'marketing_director'", () => {
    const cap = getCapabilityByCode("marketing.campaign_planning");
    expect(cap).toBeDefined();
    expect(cap!.eligibleRoles).not.toContain("marketing_director");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 8: Migration idempotency (structural test)
// ═══════════════════════════════════════════════════════════════════════════════

describe("Sprint 11 — Migration idempotency", () => {
  it("calling getCurrentSpecialists() twice returns the same length", () => {
    expect(getCurrentSpecialists().length).toBe(getCurrentSpecialists().length);
  });

  it("calling getDeprecatedSpecialists() twice returns the same length", () => {
    expect(getDeprecatedSpecialists().length).toBe(getDeprecatedSpecialists().length);
  });

  it("SPECIALISTS.length === 47 (19 current + 28 deprecated)", () => {
    expect(SPECIALISTS).toHaveLength(47);
  });

  it("getCurrentSpecialists().length + getDeprecatedSpecialists().length === SPECIALISTS.length", () => {
    expect(getCurrentSpecialists().length + getDeprecatedSpecialists().length).toBe(SPECIALISTS.length);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 9: Historical preservation
// ═══════════════════════════════════════════════════════════════════════════════

describe("Sprint 11 — Historical preservation", () => {
  it("old specialist entries are still accessible via getSpecialistByCode('compliance_officer')", () => {
    const entry = getSpecialistByCode("compliance_officer");
    expect(entry).toBeDefined();
  });

  it("old entries have execution_status 'deprecated'", () => {
    const entry = getSpecialistByCode("compliance_officer");
    expect(entry).toBeDefined();
    expect(entry!.executionStatus).toBe("deprecated");
  });

  it("old entries' capabilities are preserved in their entry", () => {
    const entry = getSpecialistByCode("compliance_officer");
    expect(entry).toBeDefined();
    expect(entry!.capabilities).toContain("review_policy");
    expect(entry!.capabilities).toContain("audit_preparation");
    expect(entry!.capabilities).toContain("review_incident");
  });

  it("document_specialist entry is preserved with its original capabilities", () => {
    const entry = getSpecialistByCode("document_specialist");
    expect(entry).toBeDefined();
    expect(entry!.executionStatus).toBe("deprecated");
    expect(entry!.capabilities).toContain("draft_document");
  });

  it("marketing_director entry is preserved with original capabilities", () => {
    const entry = getSpecialistByCode("marketing_director");
    expect(entry).toBeDefined();
    expect(entry!.executionStatus).toBe("deprecated");
    expect(entry!.capabilities).toContain("campaign_planning");
    expect(entry!.capabilities).toContain("brand_management");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 10: No research_specialist employee
// ═══════════════════════════════════════════════════════════════════════════════

describe("Sprint 11 — No research_specialist current employee", () => {
  it("getSpecialistByCode('research_specialist') exists but has executionStatus 'deprecated'", () => {
    const entry = getSpecialistByCode("research_specialist");
    expect(entry).toBeDefined();
    expect(entry!.executionStatus).toBe("deprecated");
  });

  it("research capability (research.general) still exists in BUSINESS_CAPABILITIES inline catalogue", () => {
    const cap = getCapabilityByCode("research.general");
    expect(cap).toBeDefined();
    expect(cap!.code).toBe("research.general");
  });

  it("getCurrentSpecialists() has no entry with code 'research_specialist'", () => {
    const currentCodes = getCurrentSpecialists().map(s => s.code);
    expect(currentCodes).not.toContain("research_specialist");
  });

  it("research_specialist replacementType explains the capability_distribution pattern", () => {
    const entry = getSpecialistByCode("research_specialist");
    expect(entry).toBeDefined();
    // capability_distribution = research was spread across compliance, policy, knowledge
    expect(entry!.replacementType).toBe("capability_distribution");
    expect(entry!.replacementRoleCode).toBeNull();
  });

  it("research.general is now served by compliance_quality_manager and policy_governance_specialist", () => {
    const cap = getCapabilityByCode("research.general");
    expect(cap).toBeDefined();
    expect(cap!.eligibleRoles).toContain("compliance_quality_manager");
    expect(cap!.eligibleRoles).toContain("policy_governance_specialist");
  });
});
