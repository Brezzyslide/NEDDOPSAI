/**
 * Capability Registry — Sprint 9.4
 *
 * Canonical, static list of all NeedsOps business capabilities.
 * This is the authoritative allowlist — no capability code that is not in this
 * registry may ever be used. Invented codes from LLM output are rejected here.
 *
 * Structure:
 *   code          — e.g. "accounting.bas_preparation"  (category.specific_action)
 *   capabilityLevel — the HIGHEST level this capability supports
 *   informationAllowed  — true when general information may be given without pack
 *   analysisAllowed     — true when professional analysis requires the pack
 *   executionAllowed    — true when execution requires pack + channel + approval
 *
 * The three-level model:
 *   general_information  — educational, no org data, no pack required
 *   professional_analysis— uses org records, requires relevant Workforce Pack
 *   execution            — submits actions, requires pack + channel + connector + approval
 *
 * Owning pack:
 *   null = available in all plans (core)
 *   "compliance" | "finance" | "hr" | "operations" | "marketing" = requires that pack
 */

export type CapabilityCategory =
  | "compliance"
  | "quality"
  | "policy"
  | "incident"
  | "operations"
  | "service_delivery"
  | "roster"
  | "human_resources"
  | "staff_compliance"
  | "learning"
  | "finance"
  | "accounting"
  | "payroll"
  | "invoicing"
  | "budgeting"
  | "reporting"
  | "marketing"
  | "communications"
  | "documents"
  | "research"
  | "calendar"
  | "administration";

export type CapabilityLevel =
  | "general_information"
  | "professional_analysis"
  | "execution";

export type CapabilityStatus =
  | "active"
  | "beta"
  | "coming_soon"
  | "deprecated";

export interface BusinessCapability {
  /** Canonical code, e.g. "accounting.bas_preparation" */
  code: string;
  displayName: string;
  description: string;
  category: CapabilityCategory;
  /** null = available to all plans (core). Otherwise the pack code required. */
  packCode: string | null;
  /** Specialist codes eligible to perform this capability */
  eligibleRoles: string[];
  /** Worker profile codes required (empty = any profile) */
  requiredWorkerProfiles: string[];
  /** Execution channel codes required for execution level */
  requiredExecutionChannels: string[];
  /** Connector category codes required for execution level */
  requiredConnectorCategories: string[];
  defaultRiskLevel: "low" | "medium" | "high" | "critical";
  defaultApprovalRequired: boolean;
  /** General educational answers allowed without pack */
  informationAllowed: boolean;
  /** Professional analysis requires the owning pack */
  analysisAllowed: boolean;
  /** Execution requires pack + channel + connector + approval */
  executionAllowed: boolean;
  status: CapabilityStatus;
  version: string;
  effectiveDate: string;
}

// ─── Capability definitions ────────────────────────────────────────────────────

export const BUSINESS_CAPABILITIES: BusinessCapability[] = [
  // ── CORE / ADMINISTRATION ──────────────────────────────────────────────────
  {
    code: "administration.general",
    displayName: "General Administration",
    description: "General administrative support, scheduling, and coordination",
    category: "administration", packCode: null,
    eligibleRoles: ["chief_of_staff", "executive_assistant"],
    requiredWorkerProfiles: [], requiredExecutionChannels: [], requiredConnectorCategories: [],
    defaultRiskLevel: "low", defaultApprovalRequired: false,
    informationAllowed: true, analysisAllowed: true, executionAllowed: true,
    status: "active", version: "1.0", effectiveDate: "2025-01-01",
  },
  {
    code: "calendar.management",
    displayName: "Calendar Management",
    description: "Schedule meetings, manage calendars, send invitations",
    category: "calendar", packCode: null,
    eligibleRoles: ["executive_assistant", "chief_of_staff"],
    requiredWorkerProfiles: [], requiredExecutionChannels: ["browser_session"], requiredConnectorCategories: ["calendar"],
    defaultRiskLevel: "low", defaultApprovalRequired: false,
    informationAllowed: true, analysisAllowed: true, executionAllowed: true,
    status: "active", version: "1.0", effectiveDate: "2025-01-01",
  },
  {
    code: "communications.draft",
    displayName: "Draft Communications",
    description: "Draft emails, letters, memos and other communications",
    category: "communications", packCode: null,
    eligibleRoles: ["executive_assistant", "document_specialist", "chief_of_staff", "marketing_director"],
    requiredWorkerProfiles: [], requiredExecutionChannels: [], requiredConnectorCategories: [],
    defaultRiskLevel: "low", defaultApprovalRequired: false,
    informationAllowed: true, analysisAllowed: true, executionAllowed: true,
    status: "active", version: "1.0", effectiveDate: "2025-01-01",
  },
  {
    code: "documents.draft",
    displayName: "Draft Documents",
    description: "Create, format and review operational documents and reports",
    category: "documents", packCode: null,
    eligibleRoles: ["document_specialist", "chief_of_staff", "research_specialist"],
    requiredWorkerProfiles: [], requiredExecutionChannels: [], requiredConnectorCategories: [],
    defaultRiskLevel: "low", defaultApprovalRequired: false,
    informationAllowed: true, analysisAllowed: true, executionAllowed: true,
    status: "active", version: "1.0", effectiveDate: "2025-01-01",
  },
  {
    code: "research.general",
    displayName: "Research",
    description: "Research regulations, best practices, and industry standards",
    category: "research", packCode: null,
    eligibleRoles: ["research_specialist", "chief_of_staff"],
    requiredWorkerProfiles: [], requiredExecutionChannels: [], requiredConnectorCategories: [],
    defaultRiskLevel: "low", defaultApprovalRequired: false,
    informationAllowed: true, analysisAllowed: true, executionAllowed: false,
    status: "active", version: "1.0", effectiveDate: "2025-01-01",
  },

  // ── COMPLIANCE ─────────────────────────────────────────────────────────────
  {
    code: "compliance.audit_readiness",
    displayName: "Audit Readiness Assessment",
    description: "Assess organisation readiness for NDIS Quality and Safeguards audits",
    category: "compliance", packCode: "compliance",
    eligibleRoles: ["compliance_officer"],
    requiredWorkerProfiles: ["compliance_auditor"], requiredExecutionChannels: [], requiredConnectorCategories: [],
    defaultRiskLevel: "high", defaultApprovalRequired: true,
    informationAllowed: true, analysisAllowed: true, executionAllowed: true,
    status: "active", version: "1.0", effectiveDate: "2025-01-01",
  },
  {
    code: "compliance.gap_analysis",
    displayName: "Compliance Gap Analysis",
    description: "Identify compliance gaps against NDIS Practice Standards",
    category: "compliance", packCode: "compliance",
    eligibleRoles: ["compliance_officer"],
    requiredWorkerProfiles: ["compliance_auditor"], requiredExecutionChannels: [], requiredConnectorCategories: [],
    defaultRiskLevel: "high", defaultApprovalRequired: false,
    informationAllowed: true, analysisAllowed: true, executionAllowed: false,
    status: "active", version: "1.0", effectiveDate: "2025-01-01",
  },
  {
    code: "compliance.evidence_review",
    displayName: "Evidence Review",
    description: "Review and assess compliance evidence documentation",
    category: "compliance", packCode: "compliance",
    eligibleRoles: ["compliance_officer"],
    requiredWorkerProfiles: ["compliance_auditor"], requiredExecutionChannels: [], requiredConnectorCategories: [],
    defaultRiskLevel: "medium", defaultApprovalRequired: false,
    informationAllowed: true, analysisAllowed: true, executionAllowed: false,
    status: "active", version: "1.0", effectiveDate: "2025-01-01",
  },
  {
    code: "compliance.corrective_actions",
    displayName: "Corrective Action Planning",
    description: "Plan and track corrective actions for compliance findings",
    category: "compliance", packCode: "compliance",
    eligibleRoles: ["compliance_officer"],
    requiredWorkerProfiles: ["compliance_auditor"], requiredExecutionChannels: [], requiredConnectorCategories: [],
    defaultRiskLevel: "high", defaultApprovalRequired: true,
    informationAllowed: true, analysisAllowed: true, executionAllowed: true,
    status: "active", version: "1.0", effectiveDate: "2025-01-01",
  },
  {
    code: "policy.review",
    displayName: "Policy Review",
    description: "Review and validate organisational policies against NDIS requirements",
    category: "policy", packCode: "compliance",
    eligibleRoles: ["compliance_officer", "document_specialist"],
    requiredWorkerProfiles: [], requiredExecutionChannels: [], requiredConnectorCategories: [],
    defaultRiskLevel: "medium", defaultApprovalRequired: false,
    informationAllowed: true, analysisAllowed: true, executionAllowed: false,
    status: "active", version: "1.0", effectiveDate: "2025-01-01",
  },
  {
    code: "incident.review",
    displayName: "Incident Review",
    description: "Investigate, document, and analyse incidents and near-misses",
    category: "incident", packCode: "compliance",
    eligibleRoles: ["compliance_officer"],
    requiredWorkerProfiles: ["compliance_auditor"], requiredExecutionChannels: [], requiredConnectorCategories: [],
    defaultRiskLevel: "critical", defaultApprovalRequired: true,
    informationAllowed: true, analysisAllowed: true, executionAllowed: true,
    status: "active", version: "1.0", effectiveDate: "2025-01-01",
  },
  {
    code: "restrictive_practice.review",
    displayName: "Restrictive Practice Review",
    description: "Review and document use of restrictive practices per NDIS requirements",
    category: "compliance", packCode: "compliance",
    eligibleRoles: ["compliance_officer"],
    requiredWorkerProfiles: ["compliance_auditor"], requiredExecutionChannels: [], requiredConnectorCategories: [],
    defaultRiskLevel: "critical", defaultApprovalRequired: true,
    informationAllowed: true, analysisAllowed: true, executionAllowed: false,
    status: "active", version: "1.0", effectiveDate: "2025-01-01",
  },
  {
    code: "quality.practice_standard_review",
    displayName: "Practice Standard Review",
    description: "Review organisation practices against NDIS Practice Standards",
    category: "quality", packCode: "compliance",
    eligibleRoles: ["compliance_officer"],
    requiredWorkerProfiles: [], requiredExecutionChannels: [], requiredConnectorCategories: [],
    defaultRiskLevel: "high", defaultApprovalRequired: false,
    informationAllowed: true, analysisAllowed: true, executionAllowed: false,
    status: "active", version: "1.0", effectiveDate: "2025-01-01",
  },

  // ── FINANCE ────────────────────────────────────────────────────────────────
  {
    code: "finance.invoice_review",
    displayName: "Invoice Review",
    description: "Review and validate invoices against service agreements",
    category: "finance", packCode: "finance",
    eligibleRoles: ["accounts_officer"],
    requiredWorkerProfiles: ["finance_analyst"], requiredExecutionChannels: [], requiredConnectorCategories: [],
    defaultRiskLevel: "medium", defaultApprovalRequired: false,
    informationAllowed: true, analysisAllowed: true, executionAllowed: false,
    status: "active", version: "1.0", effectiveDate: "2025-01-01",
  },
  {
    code: "finance.budget_analysis",
    displayName: "Budget Analysis",
    description: "Analyse budgets, variances, and financial performance",
    category: "finance", packCode: "finance",
    eligibleRoles: ["accounts_officer"],
    requiredWorkerProfiles: ["finance_analyst"], requiredExecutionChannels: [], requiredConnectorCategories: [],
    defaultRiskLevel: "medium", defaultApprovalRequired: false,
    informationAllowed: true, analysisAllowed: true, executionAllowed: false,
    status: "active", version: "1.0", effectiveDate: "2025-01-01",
  },
  {
    code: "finance.cost_impact_analysis",
    displayName: "Cost Impact Analysis",
    description: "Analyse the financial impact of operational decisions or compliance issues",
    category: "finance", packCode: "finance",
    eligibleRoles: ["accounts_officer"],
    requiredWorkerProfiles: ["finance_analyst"], requiredExecutionChannels: [], requiredConnectorCategories: [],
    defaultRiskLevel: "medium", defaultApprovalRequired: false,
    informationAllowed: true, analysisAllowed: true, executionAllowed: false,
    status: "active", version: "1.0", effectiveDate: "2025-01-01",
  },
  {
    code: "finance.financial_reporting",
    displayName: "Financial Reporting",
    description: "Prepare financial statements, management reports, and dashboards",
    category: "reporting", packCode: "finance",
    eligibleRoles: ["accounts_officer"],
    requiredWorkerProfiles: ["finance_analyst"], requiredExecutionChannels: ["browser_session"], requiredConnectorCategories: ["accounting"],
    defaultRiskLevel: "high", defaultApprovalRequired: true,
    informationAllowed: true, analysisAllowed: true, executionAllowed: true,
    status: "active", version: "1.0", effectiveDate: "2025-01-01",
  },
  {
    code: "accounting.reconciliation",
    displayName: "Account Reconciliation",
    description: "Reconcile accounts, bank statements, and NDIS claiming records",
    category: "accounting", packCode: "finance",
    eligibleRoles: ["accounts_officer"],
    requiredWorkerProfiles: ["finance_analyst"], requiredExecutionChannels: ["browser_session"], requiredConnectorCategories: ["accounting"],
    defaultRiskLevel: "high", defaultApprovalRequired: true,
    informationAllowed: true, analysisAllowed: true, executionAllowed: true,
    status: "active", version: "1.0", effectiveDate: "2025-01-01",
  },
  {
    code: "accounting.bas_analysis",
    displayName: "BAS Analysis",
    description: "Analyse Business Activity Statement data and GST obligations",
    category: "accounting", packCode: "finance",
    eligibleRoles: ["accounts_officer"],
    requiredWorkerProfiles: ["finance_analyst"], requiredExecutionChannels: [], requiredConnectorCategories: ["accounting"],
    defaultRiskLevel: "high", defaultApprovalRequired: false,
    informationAllowed: true, analysisAllowed: true, executionAllowed: false,
    status: "active", version: "1.0", effectiveDate: "2025-01-01",
  },
  {
    code: "accounting.bas_preparation",
    displayName: "BAS Preparation",
    description: "Prepare and lodge Business Activity Statements through accounting systems",
    category: "accounting", packCode: "finance",
    eligibleRoles: ["accounts_officer"],
    requiredWorkerProfiles: ["finance_analyst"], requiredExecutionChannels: ["browser_session"], requiredConnectorCategories: ["accounting"],
    defaultRiskLevel: "critical", defaultApprovalRequired: true,
    informationAllowed: true, analysisAllowed: false, executionAllowed: true,
    status: "active", version: "1.0", effectiveDate: "2025-01-01",
  },
  {
    code: "payroll.review",
    displayName: "Payroll Review",
    description: "Review payroll records for accuracy and compliance",
    category: "payroll", packCode: "finance",
    eligibleRoles: ["accounts_officer"],
    requiredWorkerProfiles: ["finance_analyst"], requiredExecutionChannels: [], requiredConnectorCategories: [],
    defaultRiskLevel: "high", defaultApprovalRequired: false,
    informationAllowed: true, analysisAllowed: true, executionAllowed: false,
    status: "active", version: "1.0", effectiveDate: "2025-01-01",
  },
  {
    code: "payroll.schads_analysis",
    displayName: "SCHADS Award Analysis",
    description: "Analyse payroll records against SCHADS Award rates and conditions",
    category: "payroll", packCode: "finance",
    eligibleRoles: ["accounts_officer"],
    requiredWorkerProfiles: ["finance_analyst"], requiredExecutionChannels: [], requiredConnectorCategories: [],
    defaultRiskLevel: "high", defaultApprovalRequired: false,
    informationAllowed: true, analysisAllowed: true, executionAllowed: false,
    status: "active", version: "1.0", effectiveDate: "2025-01-01",
  },
  {
    code: "invoicing.create_draft",
    displayName: "Create Invoice Draft",
    description: "Create and submit draft invoices for NDIS services",
    category: "invoicing", packCode: "finance",
    eligibleRoles: ["accounts_officer"],
    requiredWorkerProfiles: ["finance_analyst"], requiredExecutionChannels: ["browser_session"], requiredConnectorCategories: ["accounting"],
    defaultRiskLevel: "high", defaultApprovalRequired: true,
    informationAllowed: true, analysisAllowed: false, executionAllowed: true,
    status: "active", version: "1.0", effectiveDate: "2025-01-01",
  },

  // ── HUMAN RESOURCES ────────────────────────────────────────────────────────
  {
    code: "hr.recruitment",
    displayName: "Recruitment",
    description: "Support recruitment processes, job descriptions, and candidate screening",
    category: "human_resources", packCode: "hr",
    eligibleRoles: ["hr_officer"],
    requiredWorkerProfiles: [], requiredExecutionChannels: [], requiredConnectorCategories: [],
    defaultRiskLevel: "medium", defaultApprovalRequired: false,
    informationAllowed: true, analysisAllowed: true, executionAllowed: false,
    status: "active", version: "1.0", effectiveDate: "2025-01-01",
  },
  {
    code: "hr.onboarding",
    displayName: "Staff Onboarding",
    description: "Manage employee onboarding, welcome packs, and setup",
    category: "human_resources", packCode: "hr",
    eligibleRoles: ["hr_officer"],
    requiredWorkerProfiles: [], requiredExecutionChannels: ["browser_session"], requiredConnectorCategories: ["hrms"],
    defaultRiskLevel: "medium", defaultApprovalRequired: false,
    informationAllowed: true, analysisAllowed: true, executionAllowed: true,
    status: "active", version: "1.0", effectiveDate: "2025-01-01",
  },
  {
    code: "hr.performance",
    displayName: "Performance Management",
    description: "Support performance review processes and development plans",
    category: "human_resources", packCode: "hr",
    eligibleRoles: ["hr_officer"],
    requiredWorkerProfiles: [], requiredExecutionChannels: [], requiredConnectorCategories: [],
    defaultRiskLevel: "medium", defaultApprovalRequired: false,
    informationAllowed: true, analysisAllowed: true, executionAllowed: false,
    status: "active", version: "1.0", effectiveDate: "2025-01-01",
  },
  {
    code: "staff_compliance.qualification_review",
    displayName: "Staff Qualification Review",
    description: "Review staff qualifications, training records, and NDIS worker screening",
    category: "staff_compliance", packCode: "hr",
    eligibleRoles: ["hr_officer", "compliance_officer"],
    requiredWorkerProfiles: [], requiredExecutionChannels: [], requiredConnectorCategories: [],
    defaultRiskLevel: "high", defaultApprovalRequired: false,
    informationAllowed: true, analysisAllowed: true, executionAllowed: false,
    status: "active", version: "1.0", effectiveDate: "2025-01-01",
  },
  {
    code: "learning.training_gap_analysis",
    displayName: "Training Gap Analysis",
    description: "Identify training gaps against NDIS mandatory training requirements",
    category: "learning", packCode: "hr",
    eligibleRoles: ["hr_officer"],
    requiredWorkerProfiles: [], requiredExecutionChannels: [], requiredConnectorCategories: [],
    defaultRiskLevel: "medium", defaultApprovalRequired: false,
    informationAllowed: true, analysisAllowed: true, executionAllowed: false,
    status: "active", version: "1.0", effectiveDate: "2025-01-01",
  },

  // ── OPERATIONS ─────────────────────────────────────────────────────────────
  {
    code: "operations.workflow_review",
    displayName: "Workflow Review",
    description: "Review and improve operational workflows and service processes",
    category: "operations", packCode: "operations",
    eligibleRoles: ["operations_manager"],
    requiredWorkerProfiles: [], requiredExecutionChannels: [], requiredConnectorCategories: [],
    defaultRiskLevel: "medium", defaultApprovalRequired: false,
    informationAllowed: true, analysisAllowed: true, executionAllowed: false,
    status: "active", version: "1.0", effectiveDate: "2025-01-01",
  },
  {
    code: "operations.capacity_analysis",
    displayName: "Capacity Analysis",
    description: "Analyse workforce capacity against service delivery requirements",
    category: "operations", packCode: "operations",
    eligibleRoles: ["operations_manager"],
    requiredWorkerProfiles: [], requiredExecutionChannels: [], requiredConnectorCategories: [],
    defaultRiskLevel: "medium", defaultApprovalRequired: false,
    informationAllowed: true, analysisAllowed: true, executionAllowed: false,
    status: "active", version: "1.0", effectiveDate: "2025-01-01",
  },
  {
    code: "roster.review",
    displayName: "Roster Review",
    description: "Review rosters for SCHADS compliance, coverage, and optimal scheduling",
    category: "roster", packCode: "operations",
    eligibleRoles: ["operations_manager"],
    requiredWorkerProfiles: [], requiredExecutionChannels: [], requiredConnectorCategories: [],
    defaultRiskLevel: "medium", defaultApprovalRequired: false,
    informationAllowed: true, analysisAllowed: true, executionAllowed: false,
    status: "active", version: "1.0", effectiveDate: "2025-01-01",
  },
  {
    code: "service_delivery.review",
    displayName: "Service Delivery Review",
    description: "Review service delivery quality, participant outcomes, and support plans",
    category: "service_delivery", packCode: "operations",
    eligibleRoles: ["operations_manager"],
    requiredWorkerProfiles: [], requiredExecutionChannels: [], requiredConnectorCategories: [],
    defaultRiskLevel: "high", defaultApprovalRequired: false,
    informationAllowed: true, analysisAllowed: true, executionAllowed: false,
    status: "active", version: "1.0", effectiveDate: "2025-01-01",
  },
  {
    code: "asset.review",
    displayName: "Asset Review",
    description: "Review and manage organisational assets and resources",
    category: "administration", packCode: "operations",
    eligibleRoles: ["operations_manager"],
    requiredWorkerProfiles: [], requiredExecutionChannels: [], requiredConnectorCategories: [],
    defaultRiskLevel: "low", defaultApprovalRequired: false,
    informationAllowed: true, analysisAllowed: true, executionAllowed: false,
    status: "active", version: "1.0", effectiveDate: "2025-01-01",
  },

  // ── MARKETING ──────────────────────────────────────────────────────────────
  {
    code: "marketing.campaign_planning",
    displayName: "Campaign Planning",
    description: "Plan and coordinate marketing campaigns for NDIS services",
    category: "marketing", packCode: "marketing",
    eligibleRoles: ["marketing_director"],
    requiredWorkerProfiles: [], requiredExecutionChannels: [], requiredConnectorCategories: [],
    defaultRiskLevel: "low", defaultApprovalRequired: false,
    informationAllowed: true, analysisAllowed: true, executionAllowed: true,
    status: "active", version: "1.0", effectiveDate: "2025-01-01",
  },
  {
    code: "marketing.brand_management",
    displayName: "Brand Management",
    description: "Manage brand assets, guidelines, and consistency",
    category: "marketing", packCode: "marketing",
    eligibleRoles: ["marketing_director"],
    requiredWorkerProfiles: [], requiredExecutionChannels: [], requiredConnectorCategories: [],
    defaultRiskLevel: "low", defaultApprovalRequired: false,
    informationAllowed: true, analysisAllowed: true, executionAllowed: false,
    status: "active", version: "1.0", effectiveDate: "2025-01-01",
  },
  {
    code: "marketing.content_strategy",
    displayName: "Content Strategy",
    description: "Develop content plans, social media strategy, and participant communications",
    category: "marketing", packCode: "marketing",
    eligibleRoles: ["marketing_director"],
    requiredWorkerProfiles: [], requiredExecutionChannels: [], requiredConnectorCategories: [],
    defaultRiskLevel: "low", defaultApprovalRequired: false,
    informationAllowed: true, analysisAllowed: true, executionAllowed: true,
    status: "active", version: "1.0", effectiveDate: "2025-01-01",
  },
  {
    code: "reporting.marketing",
    displayName: "Marketing Reporting",
    description: "Analyse marketing performance, reach, and return on investment",
    category: "reporting", packCode: "marketing",
    eligibleRoles: ["marketing_director"],
    requiredWorkerProfiles: [], requiredExecutionChannels: [], requiredConnectorCategories: [],
    defaultRiskLevel: "low", defaultApprovalRequired: false,
    informationAllowed: true, analysisAllowed: true, executionAllowed: false,
    status: "active", version: "1.0", effectiveDate: "2025-01-01",
  },
];

// ─── Lookup helpers ────────────────────────────────────────────────────────────

const _byCode = new Map<string, BusinessCapability>(
  BUSINESS_CAPABILITIES.map(c => [c.code, c])
);

/** Resolve a capability by its exact code. Returns undefined for unknown codes. */
export function getCapability(code: string): BusinessCapability | undefined {
  return _byCode.get(code);
}

/** Whether a capability code is in the canonical registry. */
export function isKnownCapabilityCode(code: string): boolean {
  return _byCode.has(code);
}

/** All active capability codes. */
export function getActiveCapabilityCodes(): string[] {
  return BUSINESS_CAPABILITIES.filter(c => c.status === "active").map(c => c.code);
}

/** All capabilities owned by a given workforce pack. */
export function getCapabilitiesForPack(packCode: string): BusinessCapability[] {
  return BUSINESS_CAPABILITIES.filter(c => c.packCode === packCode && c.status === "active");
}

/** All capabilities a given specialist role can perform. */
export function getCapabilitiesForRole(roleCode: string): BusinessCapability[] {
  return BUSINESS_CAPABILITIES.filter(c => c.eligibleRoles.includes(roleCode) && c.status === "active");
}

/** Capabilities that do NOT require any pack (general-information always available). */
export function getAllCapabilities(): BusinessCapability[] {
  return BUSINESS_CAPABILITIES;
}

export function getCoreCapabilities(): BusinessCapability[] {
  return BUSINESS_CAPABILITIES.filter(c => c.packCode === null && c.status === "active");
}

/** Check whether the requested level is supported by a capability. */
export function isLevelSupported(cap: BusinessCapability, level: CapabilityLevel): boolean {
  if (level === "general_information") return cap.informationAllowed;
  if (level === "professional_analysis") return cap.analysisAllowed;
  if (level === "execution") return cap.executionAllowed;
  return false;
}

/** Map of all pack codes that appear in the registry. */
export const KNOWN_PACK_CODES = new Set<string>(
  BUSINESS_CAPABILITIES
    .filter(c => c.packCode !== null)
    .map(c => c.packCode as string)
);

// ─── Keyword mapping for deterministic identification ─────────────────────────
// Used by capabilityIdentificationService to score intent without an LLM call.

export interface CapabilityKeywordPattern {
  capabilityCode: string;
  /** Lower-cased keywords/phrases that strongly suggest this capability */
  keywords: string[];
  /** Phrases that suggest execution level */
  executionPhrases: string[];
  /** Phrases that suggest analysis level */
  analysisPhrases: string[];
}

export const CAPABILITY_KEYWORD_PATTERNS: CapabilityKeywordPattern[] = [
  // Compliance
  { capabilityCode: "compliance.audit_readiness",
    keywords: ["audit", "audit ready", "audit preparation", "audit readiness", "ndis audit"],
    executionPhrases: ["prepare for audit", "complete audit", "submit audit"],
    analysisPhrases: ["check audit", "assess audit", "review audit", "audit gap"] },
  { capabilityCode: "compliance.gap_analysis",
    keywords: ["gap analysis", "compliance gap", "compliance check", "standards gap", "practice standard"],
    executionPhrases: [],
    analysisPhrases: ["identify gaps", "find gaps", "compare against", "gap report"] },
  { capabilityCode: "compliance.evidence_review",
    keywords: ["evidence", "documentation review", "compliance evidence", "proof of"],
    executionPhrases: [],
    analysisPhrases: ["review evidence", "assess evidence", "check evidence"] },
  { capabilityCode: "compliance.corrective_actions",
    keywords: ["corrective action", "corrective actions", "remediation", "non-conformance"],
    executionPhrases: ["create corrective", "submit corrective", "lodge corrective"],
    analysisPhrases: ["plan corrective", "review corrective"] },
  { capabilityCode: "policy.review",
    keywords: ["policy", "policies", "procedure", "procedures", "policy review"],
    executionPhrases: [],
    analysisPhrases: ["review policy", "check policy", "assess policy", "update policy"] },
  { capabilityCode: "incident.review",
    keywords: ["incident", "incidents", "near miss", "adverse event", "reportable incident"],
    executionPhrases: ["submit incident", "lodge incident", "report incident", "create incident"],
    analysisPhrases: ["review incident", "investigate incident", "analyse incident"] },
  { capabilityCode: "restrictive_practice.review",
    keywords: ["restrictive practice", "restrictive practices", "behaviour support", "bsp", "restrictive intervention"],
    executionPhrases: [],
    analysisPhrases: ["review restrictive", "assess restrictive", "check restrictive practice"] },
  { capabilityCode: "quality.practice_standard_review",
    keywords: ["practice standard", "ndis practice standard", "quality indicator", "quality framework"],
    executionPhrases: [],
    analysisPhrases: ["review standard", "assess standard", "check standard", "practice standard review"] },

  // Finance/Accounting
  { capabilityCode: "finance.invoice_review",
    keywords: ["invoice", "invoices", "invoice review", "billing"],
    executionPhrases: [],
    analysisPhrases: ["review invoice", "check invoice", "audit invoice"] },
  { capabilityCode: "finance.budget_analysis",
    keywords: ["budget", "budgets", "budget analysis", "budget review", "financial plan"],
    executionPhrases: [],
    analysisPhrases: ["analyse budget", "review budget", "check budget", "budget variance"] },
  { capabilityCode: "finance.cost_impact_analysis",
    keywords: ["cost impact", "financial impact", "cost analysis", "cost of", "financial consequence"],
    executionPhrases: [],
    analysisPhrases: ["calculate financial", "cost impact", "financial effect"] },
  { capabilityCode: "finance.financial_reporting",
    keywords: ["financial report", "financial statement", "management report", "p&l", "profit and loss"],
    executionPhrases: ["prepare financial report", "generate report", "submit report"],
    analysisPhrases: ["review financial", "analyse financial", "check financial"] },
  { capabilityCode: "accounting.reconciliation",
    keywords: ["reconciliation", "reconcile", "bank reconciliation", "account reconciliation"],
    executionPhrases: ["reconcile accounts", "do reconciliation", "complete reconciliation"],
    analysisPhrases: ["review reconciliation", "check reconciliation"] },
  { capabilityCode: "accounting.bas_analysis",
    keywords: ["bas", "business activity statement", "gst", "tax return"],
    executionPhrases: [],
    analysisPhrases: ["analyse bas", "review bas", "check bas", "bas analysis", "gst analysis"] },
  { capabilityCode: "accounting.bas_preparation",
    keywords: ["bas preparation", "prepare bas", "lodge bas", "submit bas", "prepare business activity"],
    executionPhrases: ["prepare bas", "lodge bas", "submit bas", "file bas"],
    analysisPhrases: ["draft bas", "prepare bas"] },
  { capabilityCode: "payroll.review",
    keywords: ["payroll", "pay run", "wages", "salary", "pay review"],
    executionPhrases: [],
    analysisPhrases: ["review payroll", "check payroll", "audit payroll"] },
  { capabilityCode: "payroll.schads_analysis",
    keywords: ["schads", "award rate", "schads award", "pay rate", "overtime", "penalty rate", "allowances"],
    executionPhrases: [],
    analysisPhrases: ["schads analysis", "check schads", "overtime analysis", "award compliance"] },
  { capabilityCode: "invoicing.create_draft",
    keywords: ["create invoice", "draft invoice", "new invoice", "generate invoice"],
    executionPhrases: ["create invoice", "generate invoice", "issue invoice", "send invoice"],
    analysisPhrases: [] },

  // HR
  { capabilityCode: "hr.recruitment",
    keywords: ["recruitment", "recruit", "hiring", "job description", "candidate", "vacancy"],
    executionPhrases: [],
    analysisPhrases: ["review recruitment", "help recruit", "draft job description"] },
  { capabilityCode: "hr.onboarding",
    keywords: ["onboarding", "onboard", "new employee", "new staff", "induction"],
    executionPhrases: ["onboard employee", "set up new staff", "create employee"],
    analysisPhrases: ["plan onboarding", "review onboarding"] },
  { capabilityCode: "hr.performance",
    keywords: ["performance review", "performance management", "kpi", "appraisal", "performance plan"],
    executionPhrases: [],
    analysisPhrases: ["review performance", "performance analysis"] },
  { capabilityCode: "staff_compliance.qualification_review",
    keywords: ["qualification", "qualifications", "worker screening", "police check", "ndis check", "training record"],
    executionPhrases: [],
    analysisPhrases: ["review qualification", "check qualification", "screening review"] },
  { capabilityCode: "learning.training_gap_analysis",
    keywords: ["training gap", "training needs", "training plan", "mandatory training", "cpr", "first aid"],
    executionPhrases: [],
    analysisPhrases: ["training gap", "identify training", "training analysis"] },

  // Operations
  { capabilityCode: "operations.workflow_review",
    keywords: ["workflow", "process review", "operational process", "process improvement"],
    executionPhrases: [],
    analysisPhrases: ["review workflow", "improve workflow", "process analysis"] },
  { capabilityCode: "operations.capacity_analysis",
    keywords: ["capacity", "capacity planning", "staffing level", "resource planning"],
    executionPhrases: [],
    analysisPhrases: ["capacity analysis", "review capacity", "staffing analysis"] },
  { capabilityCode: "roster.review",
    keywords: ["roster", "rosters", "schedule", "shift", "rostering"],
    executionPhrases: [],
    analysisPhrases: ["review roster", "check roster", "roster analysis", "roster compliance"] },
  { capabilityCode: "service_delivery.review",
    keywords: ["service delivery", "participant outcome", "support plan", "ndis plan", "support coordination"],
    executionPhrases: [],
    analysisPhrases: ["review service", "service quality", "outcome review"] },
  { capabilityCode: "asset.review",
    keywords: ["asset", "assets", "equipment", "vehicle", "property"],
    executionPhrases: [],
    analysisPhrases: ["asset review", "review asset", "asset management"] },

  // Marketing
  { capabilityCode: "marketing.campaign_planning",
    keywords: ["campaign", "marketing campaign", "marketing plan", "promotional"],
    executionPhrases: ["launch campaign", "run campaign"],
    analysisPhrases: ["plan campaign", "design campaign"] },
  { capabilityCode: "marketing.brand_management",
    keywords: ["brand", "branding", "brand guideline", "brand identity"],
    executionPhrases: [],
    analysisPhrases: ["brand review", "brand analysis"] },
  { capabilityCode: "marketing.content_strategy",
    keywords: ["content", "social media", "content strategy", "content plan", "post", "newsletter"],
    executionPhrases: ["create content", "publish content", "schedule post"],
    analysisPhrases: ["content strategy", "content plan"] },

  // Core
  { capabilityCode: "communications.draft",
    keywords: ["email", "letter", "communication", "draft email", "correspondence"],
    executionPhrases: ["send email", "send letter"],
    analysisPhrases: ["draft email", "draft letter", "write email"] },
  { capabilityCode: "documents.draft",
    keywords: ["document", "report", "draft", "write", "template"],
    executionPhrases: [],
    analysisPhrases: ["draft document", "write document", "create document"] },
  { capabilityCode: "research.general",
    keywords: ["research", "what is", "how does", "explain", "definition", "what are", "tell me about"],
    executionPhrases: [],
    analysisPhrases: ["research", "find information", "look into"] },
];
