/**
 * Capability Registry — Sprint 11 (role remapping: 32 → 17 AI employees)
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
  | "administration"
  | "meeting"
  | "actions"
  | "contacts"
  | "resource";

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
    eligibleRoles: ["executive_assistant", "knowledge_documentation_specialist", "chief_of_staff", "marketing_communications_manager"],
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
    eligibleRoles: ["knowledge_documentation_specialist", "chief_of_staff"],
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
    eligibleRoles: [
      "chief_of_staff",
      "knowledge_documentation_specialist",
      "compliance_quality_manager",
      "policy_governance_specialist",
      "marketing_communications_manager",
      "financial_planning_reporting_manager",
      "talent_learning_specialist",
    ],
    requiredWorkerProfiles: [], requiredExecutionChannels: [], requiredConnectorCategories: [],
    defaultRiskLevel: "low", defaultApprovalRequired: false,
    informationAllowed: true, analysisAllowed: true, executionAllowed: false,
    status: "active", version: "1.0", effectiveDate: "2025-01-01",
  },

  // ── CALENDAR (EA-specific) ────────────────────────────────────────────────
  {
    code: "calendar.read",
    displayName: "Read Calendar",
    description: "Read and review calendar events, availability and scheduling information",
    category: "calendar", packCode: null,
    eligibleRoles: ["executive_assistant", "chief_of_staff"],
    requiredWorkerProfiles: [], requiredExecutionChannels: [], requiredConnectorCategories: ["calendar"],
    defaultRiskLevel: "low", defaultApprovalRequired: false,
    informationAllowed: true, analysisAllowed: true, executionAllowed: false,
    status: "active", version: "1.0", effectiveDate: "2025-01-01",
  },
  {
    code: "calendar.propose_times",
    displayName: "Propose Meeting Times",
    description: "Identify and propose available meeting times based on attendee calendars",
    category: "calendar", packCode: null,
    eligibleRoles: ["executive_assistant", "chief_of_staff"],
    requiredWorkerProfiles: [], requiredExecutionChannels: [], requiredConnectorCategories: ["calendar"],
    defaultRiskLevel: "low", defaultApprovalRequired: false,
    informationAllowed: true, analysisAllowed: true, executionAllowed: true,
    status: "active", version: "1.0", effectiveDate: "2025-01-01",
  },

  // ── COMMUNICATIONS (EA-specific) ──────────────────────────────────────────
  {
    code: "communications.summarise",
    displayName: "Summarise Communications",
    description: "Summarise correspondence threads, identify commitments and extract key information",
    category: "communications", packCode: null,
    eligibleRoles: ["executive_assistant", "chief_of_staff"],
    requiredWorkerProfiles: [], requiredExecutionChannels: [], requiredConnectorCategories: [],
    defaultRiskLevel: "low", defaultApprovalRequired: false,
    informationAllowed: true, analysisAllowed: true, executionAllowed: false,
    status: "active", version: "1.0", effectiveDate: "2025-01-01",
  },
  {
    code: "communications.send",
    displayName: "Send Communications",
    description: "Send approved communications via email or messaging connectors",
    category: "communications", packCode: null,
    eligibleRoles: ["executive_assistant"],
    requiredWorkerProfiles: [], requiredExecutionChannels: ["email_connector"], requiredConnectorCategories: ["email"],
    defaultRiskLevel: "medium", defaultApprovalRequired: true,
    informationAllowed: false, analysisAllowed: false, executionAllowed: true,
    status: "active", version: "1.0", effectiveDate: "2025-01-01",
  },

  // ── MEETING (EA-specific) ─────────────────────────────────────────────────
  {
    code: "meeting.prepare_agenda",
    displayName: "Prepare Meeting Agenda",
    description: "Prepare structured meeting agendas with topics, owners and time allocations",
    category: "meeting", packCode: null,
    eligibleRoles: ["executive_assistant"],
    requiredWorkerProfiles: [], requiredExecutionChannels: [], requiredConnectorCategories: [],
    defaultRiskLevel: "low", defaultApprovalRequired: false,
    informationAllowed: true, analysisAllowed: true, executionAllowed: true,
    status: "active", version: "1.0", effectiveDate: "2025-01-01",
  },
  {
    code: "meeting.prepare_brief",
    displayName: "Prepare Meeting Brief",
    description: "Compile background information and briefing packs for scheduled meetings",
    category: "meeting", packCode: null,
    eligibleRoles: ["executive_assistant"],
    requiredWorkerProfiles: [], requiredExecutionChannels: [], requiredConnectorCategories: [],
    defaultRiskLevel: "low", defaultApprovalRequired: false,
    informationAllowed: true, analysisAllowed: true, executionAllowed: true,
    status: "active", version: "1.0", effectiveDate: "2025-01-01",
  },
  {
    code: "meeting.capture_notes",
    displayName: "Capture Meeting Notes",
    description: "Record structured meeting notes from provided conversation or transcript context",
    category: "meeting", packCode: null,
    eligibleRoles: ["executive_assistant"],
    requiredWorkerProfiles: [], requiredExecutionChannels: [], requiredConnectorCategories: [],
    defaultRiskLevel: "low", defaultApprovalRequired: false,
    informationAllowed: true, analysisAllowed: true, executionAllowed: true,
    status: "active", version: "1.0", effectiveDate: "2025-01-01",
  },
  {
    code: "meeting.extract_actions",
    displayName: "Extract Meeting Actions",
    description: "Extract action items, owners and due dates from meeting notes or transcripts",
    category: "meeting", packCode: null,
    eligibleRoles: ["executive_assistant"],
    requiredWorkerProfiles: [], requiredExecutionChannels: [], requiredConnectorCategories: [],
    defaultRiskLevel: "low", defaultApprovalRequired: false,
    informationAllowed: true, analysisAllowed: true, executionAllowed: true,
    status: "active", version: "1.0", effectiveDate: "2025-01-01",
  },
  {
    code: "meeting.prepare_follow_up",
    displayName: "Prepare Meeting Follow-up",
    description: "Prepare post-meeting summaries and draft follow-up communications",
    category: "meeting", packCode: null,
    eligibleRoles: ["executive_assistant"],
    requiredWorkerProfiles: [], requiredExecutionChannels: [], requiredConnectorCategories: [],
    defaultRiskLevel: "low", defaultApprovalRequired: false,
    informationAllowed: true, analysisAllowed: true, executionAllowed: true,
    status: "active", version: "1.0", effectiveDate: "2025-01-01",
  },

  // ── ACTIONS (EA-specific) ─────────────────────────────────────────────────
  {
    code: "actions.create",
    displayName: "Create Action Items",
    description: "Create and register action items with owner, due date and description",
    category: "actions", packCode: null,
    eligibleRoles: ["executive_assistant"],
    requiredWorkerProfiles: [], requiredExecutionChannels: [], requiredConnectorCategories: [],
    defaultRiskLevel: "low", defaultApprovalRequired: false,
    informationAllowed: true, analysisAllowed: true, executionAllowed: true,
    status: "active", version: "1.0", effectiveDate: "2025-01-01",
  },
  {
    code: "actions.track",
    displayName: "Track Action Items",
    description: "Monitor and report on outstanding action items and their completion status",
    category: "actions", packCode: null,
    eligibleRoles: ["executive_assistant"],
    requiredWorkerProfiles: [], requiredExecutionChannels: [], requiredConnectorCategories: [],
    defaultRiskLevel: "low", defaultApprovalRequired: false,
    informationAllowed: true, analysisAllowed: true, executionAllowed: true,
    status: "active", version: "1.0", effectiveDate: "2025-01-01",
  },
  {
    code: "actions.escalate",
    displayName: "Escalate Overdue Actions",
    description: "Identify and escalate overdue or blocked action items to the appropriate person",
    category: "actions", packCode: null,
    eligibleRoles: ["executive_assistant"],
    requiredWorkerProfiles: [], requiredExecutionChannels: [], requiredConnectorCategories: [],
    defaultRiskLevel: "low", defaultApprovalRequired: false,
    informationAllowed: true, analysisAllowed: true, executionAllowed: true,
    status: "active", version: "1.0", effectiveDate: "2025-01-01",
  },

  // ── DOCUMENTS (EA-specific) ───────────────────────────────────────────────
  {
    code: "documents.read",
    displayName: "Read Documents",
    description: "Read and retrieve authorised documents from connected document storage",
    category: "documents", packCode: null,
    eligibleRoles: ["executive_assistant", "chief_of_staff"],
    requiredWorkerProfiles: [], requiredExecutionChannels: [], requiredConnectorCategories: ["document_storage"],
    defaultRiskLevel: "low", defaultApprovalRequired: false,
    informationAllowed: true, analysisAllowed: true, executionAllowed: false,
    status: "active", version: "1.0", effectiveDate: "2025-01-01",
  },
  {
    code: "documents.organise",
    displayName: "Organise Documents",
    description: "Organise and file documents in authorised document storage locations",
    category: "documents", packCode: null,
    eligibleRoles: ["executive_assistant"],
    requiredWorkerProfiles: [], requiredExecutionChannels: [], requiredConnectorCategories: ["document_storage"],
    defaultRiskLevel: "low", defaultApprovalRequired: false,
    informationAllowed: true, analysisAllowed: true, executionAllowed: true,
    status: "active", version: "1.0", effectiveDate: "2025-01-01",
  },

  // ── CONTACTS (EA-specific) ────────────────────────────────────────────────
  {
    code: "contacts.lookup",
    displayName: "Look Up Contacts",
    description: "Look up contact details from authorised contact directories",
    category: "contacts", packCode: null,
    eligibleRoles: ["executive_assistant", "chief_of_staff"],
    requiredWorkerProfiles: [], requiredExecutionChannels: [], requiredConnectorCategories: ["contacts"],
    defaultRiskLevel: "low", defaultApprovalRequired: false,
    informationAllowed: true, analysisAllowed: false, executionAllowed: false,
    status: "active", version: "1.0", effectiveDate: "2025-01-01",
  },

  // ── COMPLIANCE ─────────────────────────────────────────────────────────────
  {
    code: "compliance.audit_readiness",
    displayName: "Audit Readiness Assessment",
    description: "Assess organisation readiness for NDIS Quality and Safeguards audits",
    category: "compliance", packCode: "compliance",
    eligibleRoles: ["compliance_quality_manager"],
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
    eligibleRoles: ["compliance_quality_manager"],
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
    eligibleRoles: ["compliance_quality_manager"],
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
    eligibleRoles: ["compliance_quality_manager"],
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
    eligibleRoles: ["compliance_quality_manager", "knowledge_documentation_specialist"],
    requiredWorkerProfiles: [], requiredExecutionChannels: [], requiredConnectorCategories: [],
    defaultRiskLevel: "medium", defaultApprovalRequired: false,
    informationAllowed: true, analysisAllowed: true, executionAllowed: false,
    status: "active", version: "1.0", effectiveDate: "2025-01-01",
  },
  {
    code: "incident.review",
    displayName: "Incident Review",
    description: "Investigate, document, and analyse incidents and near-misses. Until incident_safeguarding_specialist is approved for production, routed to operations_manager.",
    category: "incident", packCode: "compliance",
    // Sprint 29H Part B: operations_manager is the approved production specialist for incident
    // management operational review until incident_safeguarding_specialist completes DNA design.
    eligibleRoles: ["operations_manager", "compliance_quality_manager", "incident_safeguarding_specialist"],
    requiredWorkerProfiles: [], requiredExecutionChannels: [], requiredConnectorCategories: [],
    defaultRiskLevel: "critical", defaultApprovalRequired: true,
    informationAllowed: true, analysisAllowed: true, executionAllowed: true,
    status: "active", version: "1.1", effectiveDate: "2026-08-07",
  },
  {
    code: "restrictive_practice.review",
    displayName: "Restrictive Practice Review",
    description: "Review and document use of restrictive practices per NDIS requirements",
    category: "compliance", packCode: "compliance",
    eligibleRoles: ["incident_safeguarding_specialist"],
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
    eligibleRoles: ["compliance_quality_manager"],
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
    eligibleRoles: ["finance_officer"],
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
    eligibleRoles: ["financial_planning_reporting_manager"],
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
    eligibleRoles: ["financial_planning_reporting_manager"],
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
    eligibleRoles: ["finance_officer", "financial_planning_reporting_manager"],
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
    eligibleRoles: ["finance_officer", "payroll_workforce_cost_officer"],
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
    eligibleRoles: ["finance_officer"],
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
    eligibleRoles: ["finance_officer"],
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
    eligibleRoles: ["payroll_workforce_cost_officer"],
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
    eligibleRoles: ["payroll_workforce_cost_officer"],
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
    eligibleRoles: ["finance_officer"],
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
    eligibleRoles: ["talent_learning_specialist"],
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
    eligibleRoles: ["people_culture_manager"],
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
    eligibleRoles: ["people_culture_manager"],
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
    eligibleRoles: ["people_culture_manager", "compliance_quality_manager", "workforce_compliance_specialist"],
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
    eligibleRoles: ["talent_learning_specialist"],
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
    eligibleRoles: ["operations_manager", "process_asset_coordinator"],
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
    eligibleRoles: ["operations_manager", "workforce_rostering_coordinator"],
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
    eligibleRoles: ["operations_manager", "workforce_rostering_coordinator"],
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
    eligibleRoles: ["operations_manager", "service_delivery_coordinator", "process_asset_coordinator"],
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
    eligibleRoles: ["operations_manager", "process_asset_coordinator"],
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
    eligibleRoles: ["marketing_communications_manager"],
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
    eligibleRoles: ["marketing_communications_manager"],
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
    eligibleRoles: ["marketing_communications_manager"],
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
    eligibleRoles: ["marketing_communications_manager"],
    requiredWorkerProfiles: [], requiredExecutionChannels: [], requiredConnectorCategories: [],
    defaultRiskLevel: "low", defaultApprovalRequired: false,
    informationAllowed: true, analysisAllowed: true, executionAllowed: false,
    status: "active", version: "1.0", effectiveDate: "2025-01-01",
  },

  // ── RESOURCE ───────────────────────────────────────────────────────────────
  {
    code: "resource.locate",
    displayName: "Resource Location",
    description: "Locate organisational resources through the Organisation Resource Registry without requiring knowledge of physical storage technology",
    category: "resource", packCode: null,
    eligibleRoles: [
      "chief_of_staff",
      "executive_assistant",
      "compliance_quality_manager",
      "operations_manager",
      "knowledge_documentation_specialist",
      "policy_governance_specialist",
      "incident_safeguarding_specialist",
      "workforce_compliance_specialist",
      "finance_officer",
      "marketing_communications_manager",
      "service_delivery_coordinator",
    ],
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
    // Sprint 29H.6: Expanded keyword and phrase patterns to correctly distinguish
    // work-product deliverables (professional_analysis) from external-state changes (execution).
    // "Produce/prepare an improvement plan" → analysisPhrase → professional_analysis.
    // "Implement/apply corrective actions" → executionPhrase → execution.
    keywords: ["corrective action", "corrective actions", "remediation", "non-conformance",
               "improvement plan", "corrective action plan", "action plan", "remediation plan"],
    executionPhrases: ["create corrective", "submit corrective", "lodge corrective",
                       "implement corrective", "apply corrective", "execute corrective",
                       "apply the corrective", "implement the corrective",
                       "apply these corrective", "implement these corrective"],
    analysisPhrases: ["plan corrective", "review corrective", "recommend corrective",
                      "prepare corrective", "produce corrective", "prioritise corrective",
                      "prepare improvement", "develop improvement", "produce improvement",
                      "prioritised improvement plan", "corrective action plan",
                      "remediation plan", "develop a remediation", "prepare a remediation",
                      "prepare an improvement", "action plan"] },
  { capabilityCode: "policy.review",
    // Fix 29H.3 Defect 1: bare "policy" / "policies" / "procedure" / "procedures" matched
    // document names (e.g. "Incident Management Policy") — not service intent.
    // Replaced with multi-word phrases that can only match explicit policy-review requests.
    keywords: ["policy review", "policy audit", "policy and procedure", "policies and procedures", "procedure review"],
    executionPhrases: [],
    analysisPhrases: ["review our policy", "check our policy", "assess our policy", "conduct a policy review", "update our policy", "audit our policy"] },
  { capabilityCode: "incident.review",
    // Sprint 29H.6 Fix D: Bare "incident"/"incidents" matched document names
    // (e.g. "Incident Management Policy") without signalling a service request.
    // Replaced with multi-word phrases that confirm explicit incident-management intent.
    // Multi-word keywords score +4 each (vs +2 for single words), pushing confidence
    // above the 0.7 deterministic threshold so the LLM path is bypassed.
    // "incident management policy" added as analysisPhrase: appearing in an analysis
    // request confirms the user wants the incident review service (not just references the doc).
    keywords: ["incident management", "incident review", "incident investigation",
               "incident response", "incident reporting", "incident procedure",
               "near miss", "adverse event", "reportable incident"],
    executionPhrases: ["submit incident", "lodge incident", "report incident", "create incident"],
    analysisPhrases: ["review incident management", "analyse incident management",
                      "incident management review", "incident management policy",
                      "review our incident", "investigate incident", "analyse incident"] },
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
    keywords: ["bas preparation", "prepare bas", "lodge bas", "submit bas", "prepare business activity", "our bas", "quarterly bas"],
    executionPhrases: ["prepare bas", "lodge bas", "submit bas", "file bas", "lodge our bas", "submit our bas", "prepare our bas", "lodge the bas", "submit the bas"],
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
