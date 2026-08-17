/**
 * Workforce Registry — Sprint 11 (Catalogue Streamlining: 32 → 17 AI Employees)
 *
 * Static metadata describing every Workforce Role (customer-facing: "AI Specialist")
 * and the supporting catalogue of capabilities and packs.
 *
 * Internal concept: Workforce Role — defines business purpose, responsibilities,
 * capabilities, approval requirements, and which Worker Profiles it may use.
 *
 * Customer-facing term: AI Specialist — the name shown in the UI.
 *
 * No AI, no LLM, no live execution. Pure metadata.
 *
 * Used to seed the database and serve the /v1/workforce/* endpoints.
 *
 * catalogueVersion "2" = current 19-employee catalogue (Sprint 11+ / Sprint 33B)
 * catalogueVersion "1" = deprecated legacy roles
 */

export interface RegistryCapability {
  id: string;
  code: string;
  name: string;
  description: string;
}

/**
 * RegistrySpecialist describes a Workforce Role.
 *
 * Internal concept: Workforce Role — defines who is responsible and what expertise applies.
 * Customer-facing term: AI Specialist — shown in the UI and API responses.
 *
 * A Workforce Role references one or more Worker Profiles, which define which tools
 * and execution surfaces may be used when OpenClaw executes on behalf of this role.
 */
export interface RegistrySpecialist {
  id: string;
  code: string;
  displayName: string;
  packCode: string;
  description: string;
  icon: string;
  colour: string;
  capabilities: string[]; // capability codes
  requiredPermissions: string[];
  requiredEntitlements: string[];
  approvalRequirements: string;
  executionStatus: "available" | "beta" | "coming_soon" | "deprecated" | "dna_pending" | "archived";
  version: string;
  /**
   * Worker Profile codes this Workforce Role may execute through.
   * OpenClaw (future) selects the appropriate profile at execution time.
   * Empty until Sprint 2 Architecture Correction seeding.
   */
  workerProfileCodes: string[];
  // ── Sprint 11 catalogue fields ──────────────────────────────────────────────
  /** Department grouping code */
  departmentCode: 'executive' | 'compliance_governance' | 'operations' | 'finance' | 'people_culture' | 'marketing' | 'shared_professional_services';
  /** DNA design sign-off status */
  dnaStatus: 'approved' | 'pending_design' | 'not_applicable';
  /** Display position within department (global ordering proxy) */
  displayOrder: number;
  /** '1' = legacy catalogue, '2' = Sprint 11 streamlined catalogue */
  catalogueVersion: '1' | '2';
  /** For deprecated roles: the new role code that replaces this one (null = capability distributed) */
  replacementRoleCode?: string | null;
  /** How this role was absorbed into the new catalogue */
  replacementType: 'merged' | 'renamed' | 'capability_distribution' | 'none';
  /** ISO date string when this role was deprecated */
  deprecatedAt?: string;
  /** Human-readable deprecation reason */
  deprecationReason?: string;
}

export interface RegistryPack {
  id: string;
  code: string;
  name: string;
  description: string;
  industry: string;
  tier: "starter" | "professional" | "enterprise";
  status: "available" | "coming_soon";
  specialists: string[]; // specialist codes
}

// ─── Capabilities ─────────────────────────────────────────────────────────────

export const CAPABILITIES: RegistryCapability[] = [
  // Core
  { id: "cap_route_task", code: "route_task", name: "Route Task", description: "Analyse and route a task to the correct specialist(s)" },
  { id: "cap_orchestrate", code: "orchestrate", name: "Orchestrate Workflow", description: "Coordinate multiple specialists to complete a complex task" },
  { id: "cap_manage_calendar", code: "manage_calendar", name: "Manage Calendar", description: "Schedule meetings, reminders, and calendar events" },
  { id: "cap_draft_communication", code: "draft_communication", name: "Draft Communication", description: "Draft emails, letters, and other communications" },
  { id: "cap_research", code: "research", name: "Research", description: "Research topics, regulations, and best practices" },
  { id: "cap_draft_document", code: "draft_document", name: "Draft Document", description: "Create, format, and review documents" },
  { id: "cap_summarise", code: "summarise", name: "Summarise", description: "Summarise long documents or meeting notes" },
  { id: "cap_schedule_meeting", code: "schedule_meeting", name: "Schedule Meeting", description: "Arrange meetings and send invitations" },
  // Compliance
  { id: "cap_review_policy", code: "review_policy", name: "Review Policy", description: "Review and validate organisational policies" },
  { id: "cap_review_incident", code: "review_incident", name: "Review Incident", description: "Investigate and document incidents" },
  { id: "cap_audit_preparation", code: "audit_preparation", name: "Audit Preparation", description: "Prepare documentation and evidence for audits" },
  { id: "cap_restrictive_practice_review", code: "restrictive_practice_review", name: "Restrictive Practice Review", description: "Review and document restrictive practice use" },
  { id: "cap_restrictive_practice_governance", code: "restrictive_practice_governance", name: "Restrictive Practice Governance", description: "Monitor restrictive practice authorisation, registers, usage reconciliation, and governance actions" },
  { id: "cap_monthly_rp_reporting", code: "monthly_rp_reporting", name: "Monthly Restrictive Practice Reporting", description: "Prepare governance review and reconciliation for monthly restrictive practice reporting" },
  { id: "cap_bsp_implementation", code: "bsp_implementation", name: "BSP Implementation", description: "Operationalise approved Behaviour Support Plans and monitor implementation fidelity" },
  { id: "cap_quality_review", code: "quality_review", name: "Quality Review", description: "Assess service quality against standards" },
  { id: "cap_corrective_action", code: "corrective_action", name: "Corrective Action", description: "Develop and track corrective action plans" },
  { id: "cap_draft_policy", code: "draft_policy", name: "Draft Policy", description: "Draft and update organisational policies" },
  { id: "cap_governance_framework", code: "governance_framework", name: "Governance Framework", description: "Design and review organisational governance frameworks" },
  { id: "cap_regulatory_change_impact", code: "regulatory_change_impact", name: "Regulatory Change Impact", description: "Assess how verified regulatory changes affect organisational instruments and controls" },
  { id: "cap_governance_gap_analysis", code: "governance_gap_analysis", name: "Governance Gap Analysis", description: "Identify missing, conflicting, obsolete or duplicated governance requirements" },
  // Operations
  { id: "cap_review_roster", code: "review_roster", name: "Review Roster", description: "Analyse and optimise staff rosters" },
  { id: "cap_create_workflow", code: "create_workflow", name: "Create Workflow", description: "Design and document operational workflows" },
  { id: "cap_capacity_analysis", code: "capacity_analysis", name: "Capacity Analysis", description: "Analyse service capacity and resource allocation" },
  { id: "cap_service_delivery_review", code: "service_delivery_review", name: "Service Delivery Review", description: "Review and report on service delivery performance" },
  { id: "cap_asset_management", code: "asset_management", name: "Asset Management", description: "Track and manage organisational assets" },
  // Finance
  { id: "cap_review_invoice", code: "review_invoice", name: "Review Invoice", description: "Review and validate invoices" },
  { id: "cap_budget_summary", code: "budget_summary", name: "Budget Summary", description: "Generate budget summaries and variance reports" },
  { id: "cap_payroll_review", code: "payroll_review", name: "Payroll Review", description: "Review and reconcile payroll data" },
  { id: "cap_financial_reporting", code: "financial_reporting", name: "Financial Reporting", description: "Prepare financial reports and statements" },
  { id: "cap_accounts_reconciliation", code: "accounts_reconciliation", name: "Accounts Reconciliation", description: "Reconcile accounts and identify discrepancies" },
  // HR
  { id: "cap_recruitment_support", code: "recruitment_support", name: "Recruitment Support", description: "Screen candidates and prepare recruitment materials" },
  { id: "cap_performance_review", code: "performance_review", name: "Performance Review", description: "Coordinate and document performance reviews" },
  { id: "cap_learning_coordination", code: "learning_coordination", name: "Learning Coordination", description: "Coordinate staff training and development activities" },
  { id: "cap_staff_compliance_check", code: "staff_compliance_check", name: "Staff Compliance Check", description: "Verify staff credentials, certifications, and compliance" },
  { id: "cap_worker_eligibility_review", code: "worker_eligibility_review", name: "Worker Eligibility Review", description: "Review whether a worker is eligible for a defined duty from current verified workforce compliance evidence" },
  { id: "cap_credential_review", code: "credential_review", name: "Credential Review", description: "Review credential, screening/check, licence, registration and verification evidence" },
  { id: "cap_training_competency_review", code: "training_competency_review", name: "Training and Competency Review", description: "Review training and competency evidence against mandatory workforce requirements" },
  { id: "cap_expiry_monitoring", code: "expiry_monitoring", name: "Expiry Monitoring", description: "Monitor upcoming, expired and superseded workforce compliance evidence" },
  { id: "cap_deployment_eligibility", code: "deployment_eligibility", name: "Deployment Eligibility", description: "Determine deployment eligibility or restrictions for a specific duty or service" },
  { id: "cap_hr_policy_review", code: "hr_policy_review", name: "HR Policy Review", description: "Review and update HR policies" },
  // Marketing
  { id: "cap_campaign_planning", code: "campaign_planning", name: "Campaign Planning", description: "Plan and manage marketing campaigns" },
  { id: "cap_content_strategy", code: "content_strategy", name: "Content Strategy", description: "Develop content strategy and editorial plans" },
  { id: "cap_brand_management", code: "brand_management", name: "Brand Management", description: "Maintain and develop brand identity" },
  { id: "cap_social_media", code: "social_media", name: "Social Media Management", description: "Manage social media content and engagement" },
  { id: "cap_marketing_reporting", code: "marketing_reporting", name: "Marketing Reporting", description: "Report on campaign performance and ROI" },
];

// ─── Specialists ──────────────────────────────────────────────────────────────
// Catalogue v2: 19 active AI employees, grouped by department.
// Catalogue v1: 28 deprecated legacy roles, grouped at the bottom.

export const SPECIALISTS: RegistrySpecialist[] = [

  // ════════════════════════════════════════════════════════════════════════════
  // CATALOGUE v2 — 19 Current AI Employees (Sprint 11 + Sprint 33B)
  // ════════════════════════════════════════════════════════════════════════════

  // ── EXECUTIVE DEPARTMENT ───────────────────────────────────────────────────

  {
    id: "spec_chief_of_staff",
    code: "chief_of_staff",
    displayName: "Chief of Staff",
    packCode: "core",
    description: "The central orchestrator. Every task enters through the Chief of Staff, who analyses intent and coordinates the workforce.",
    icon: "⭐",
    colour: "#00D4FF",
    capabilities: ["route_task", "orchestrate", "summarise"],
    requiredPermissions: [],
    requiredEntitlements: [],
    approvalRequirements: "no_approval",
    executionStatus: "available",
    version: "2.0.0",
    workerProfileCodes: ["chief_of_staff_profile"],
    departmentCode: "executive",
    dnaStatus: "approved",
    displayOrder: 1,
    catalogueVersion: "2",
    replacementType: "none",
  },
  {
    id: "spec_executive_assistant",
    code: "executive_assistant",
    displayName: "Executive Assistant",
    packCode: "core",
    description: "Manages calendars, schedules meetings, drafts professional communications, prepares briefing notes, and supports leadership administration.",
    icon: "📅",
    colour: "#4A90D9",
    capabilities: ["manage_calendar", "draft_communication", "schedule_meeting", "summarise", "research"],
    requiredPermissions: [],
    requiredEntitlements: [],
    approvalRequirements: "no_approval",
    executionStatus: "available",
    version: "2.0.0",
    workerProfileCodes: ["executive_assistant_profile"],
    departmentCode: "executive",
    dnaStatus: "approved",
    displayOrder: 2,
    catalogueVersion: "2",
    replacementType: "none",
  },

  // ── COMPLIANCE & GOVERNANCE DEPARTMENT ────────────────────────────────────

  {
    id: "spec_compliance_quality_manager",
    code: "compliance_quality_manager",
    displayName: "Compliance & Quality Manager",
    packCode: "compliance",
    description: "Reviews policies, prepares for audits, manages quality reviews, and develops corrective action plans to ensure NDIS regulatory compliance.",
    icon: "⚖️",
    colour: "#E05C00",
    capabilities: ["review_policy", "audit_preparation", "review_incident", "quality_review", "corrective_action"],
    requiredPermissions: ["compliance:read"],
    requiredEntitlements: ["compliance_workforce"],
    approvalRequirements: "manager_approval",
    executionStatus: "available",
    version: "2.0.0",
    workerProfileCodes: ["compliance_quality_manager_profile"],
    departmentCode: "compliance_governance",
    dnaStatus: "approved",
    displayOrder: 3,
    catalogueVersion: "2",
    replacementType: "none",
  },
  {
    id: "spec_incident_safeguarding_specialist",
    code: "incident_safeguarding_specialist",
    displayName: "Incident & Safeguarding Specialist",
    packCode: "compliance",
    description: "Investigates incidents, reviews and documents restrictive practice use, and ensures safeguarding obligations are met under NDIS requirements.",
    icon: "🚨",
    colour: "#C0143C",
    capabilities: ["review_incident", "restrictive_practice_review", "audit_preparation", "draft_document"],
    requiredPermissions: ["compliance:read", "incidents:read"],
    requiredEntitlements: ["compliance_workforce"],
    approvalRequirements: "compliance_approval",
    executionStatus: "available",
    version: "2.0.0",
    workerProfileCodes: ["incident_safeguarding_specialist_profile"],
    departmentCode: "compliance_governance",
    dnaStatus: "approved",
    displayOrder: 4,
    catalogueVersion: "2",
    replacementType: "none",
  },
  {
    id: "spec_policy_governance_specialist",
    code: "policy_governance_specialist",
    displayName: "Policy & Governance Specialist",
    packCode: "compliance",
    description: "Owns organisational policy and governance architecture, including policy development/review, governance frameworks, regulatory-change impact, delegations, controlled-policy lifecycle, registers, implementation requirements and approval-ready governance briefs.",
    icon: "📜",
    colour: "#7B5A14",
    capabilities: ["draft_policy", "review_policy", "governance_framework", "regulatory_change_impact", "governance_gap_analysis", "draft_document"],
    requiredPermissions: ["compliance:read"],
    requiredEntitlements: ["compliance_workforce"],
    approvalRequirements: "administrator_approval",
    executionStatus: "available",
    version: "2.0.0",
    workerProfileCodes: ["policy_governance_specialist_profile"],
    departmentCode: "compliance_governance",
    dnaStatus: "approved",
    displayOrder: 5,
    catalogueVersion: "2",
    replacementType: "none",
  },
  {
    id: "spec_authorised_program_officer",
    code: "authorised_program_officer",
    displayName: "Authorised Program Officer",
    packCode: "compliance",
    description: "Owns restrictive-practice governance, authority pathway checking, consent/authority verification, RP register oversight, usage reconciliation, monthly RP reporting, unauthorised-use escalation, and reduction/elimination governance.",
    icon: "🔐",
    colour: "#8B1E3F",
    capabilities: ["restrictive_practice_governance", "monthly_rp_reporting", "restrictive_practice_review", "audit_preparation", "draft_document"],
    requiredPermissions: ["compliance:read"],
    requiredEntitlements: ["compliance_workforce"],
    approvalRequirements: "compliance_approval",
    executionStatus: "available",
    version: "2.0.0",
    workerProfileCodes: ["authorised_program_officer_profile"],
    departmentCode: "compliance_governance",
    dnaStatus: "approved",
    displayOrder: 18,
    catalogueVersion: "2",
    replacementType: "none",
  },

  // ── OPERATIONS DEPARTMENT ─────────────────────────────────────────────────

  {
    id: "spec_operations_manager",
    code: "operations_manager",
    displayName: "Operations Manager",
    packCode: "operations",
    description: "Oversees operational workflows, resource allocation, service capacity planning, and service delivery performance.",
    icon: "⚙️",
    colour: "#1E90FF",
    capabilities: ["review_roster", "create_workflow", "capacity_analysis", "service_delivery_review"],
    requiredPermissions: ["operations:read"],
    requiredEntitlements: ["operations_workforce"],
    approvalRequirements: "no_approval",
    executionStatus: "available",
    version: "2.0.0",
    workerProfileCodes: ["operations_manager_profile"],
    departmentCode: "operations",
    dnaStatus: "approved",
    displayOrder: 6,
    catalogueVersion: "2",
    replacementType: "none",
  },
  {
    id: "spec_service_delivery_coordinator",
    code: "service_delivery_coordinator",
    displayName: "Service Delivery Coordinator",
    packCode: "operations",
    description: "Coordinates approved support requirements into day-to-day service delivery, reviews planned versus actual delivery evidence, identifies service gaps and escalates specialist boundaries.",
    icon: "🚀",
    colour: "#00CED1",
    capabilities: ["service_delivery_review", "create_workflow", "summarise"],
    requiredPermissions: ["operations:read"],
    requiredEntitlements: ["operations_workforce"],
    approvalRequirements: "no_approval",
    executionStatus: "available",
    version: "2.0.0",
    workerProfileCodes: ["service_delivery_coordinator_profile"],
    departmentCode: "operations",
    dnaStatus: "approved",
    displayOrder: 7,
    catalogueVersion: "2",
    replacementType: "none",
  },
  {
    id: "spec_workforce_rostering_coordinator",
    code: "workforce_rostering_coordinator",
    displayName: "Workforce Rostering Coordinator",
    packCode: "operations",
    description: "Constructs rosters, allocates shifts, analyses coverage and vacancies, resolves scheduling conflicts, and escalates service, capacity, credential, payroll or HR boundaries.",
    icon: "📊",
    colour: "#B8860B",
    capabilities: ["review_roster", "capacity_analysis", "manage_calendar", "draft_document"],
    requiredPermissions: ["operations:read", "roster:read"],
    requiredEntitlements: ["operations_workforce"],
    approvalRequirements: "no_approval",
    executionStatus: "available",
    version: "2.0.0",
    workerProfileCodes: ["workforce_rostering_coordinator_profile"],
    departmentCode: "operations",
    dnaStatus: "approved",
    displayOrder: 8,
    catalogueVersion: "2",
    replacementType: "none",
  },
  {
    id: "spec_process_asset_coordinator",
    code: "process_asset_coordinator",
    displayName: "Process & Asset Coordinator",
    packCode: "operations",
    description: "Designs, documents, and optimises business processes, operational workflows, and tracks organisational assets.",
    icon: "🔄",
    colour: "#5B8C5A",
    capabilities: ["create_workflow", "service_delivery_review", "asset_management", "draft_document"],
    requiredPermissions: ["operations:read"],
    requiredEntitlements: ["operations_workforce"],
    approvalRequirements: "no_approval",
    executionStatus: "dna_pending",
    version: "2.0.0",
    workerProfileCodes: ["process_asset_coordinator_profile"],
    departmentCode: "operations",
    dnaStatus: "pending_design",
    displayOrder: 9,
    catalogueVersion: "2",
    replacementType: "none",
  },
  {
    id: "spec_behaviour_support_implementation_specialist",
    code: "behaviour_support_implementation_specialist",
    displayName: "Behaviour Support Implementation Specialist",
    packCode: "operations",
    description: "Operationalises approved Behaviour Support Plans, reviews implementation fidelity, analyses behaviour/context evidence, supports staff practice guidance, monitors reduction/elimination implementation, and escalates practitioner-review triggers. This is not a Behaviour Support Practitioner role.",
    icon: "🧭",
    colour: "#4F46E5",
    capabilities: ["bsp_implementation", "service_delivery_review", "restrictive_practice_review", "draft_document"],
    requiredPermissions: ["operations:read", "compliance:read"],
    requiredEntitlements: ["operations_workforce"],
    approvalRequirements: "manager_approval",
    executionStatus: "available",
    version: "2.0.0",
    workerProfileCodes: ["behaviour_support_implementation_specialist_profile"],
    departmentCode: "operations",
    dnaStatus: "approved",
    displayOrder: 19,
    catalogueVersion: "2",
    replacementType: "none",
  },

  // ── FINANCE DEPARTMENT ────────────────────────────────────────────────────

  {
    id: "spec_finance_officer",
    code: "finance_officer",
    displayName: "Finance Officer",
    packCode: "finance",
    description: "Manages accounts payable/receivable, reviews and validates invoices, performs account reconciliation, and prepares financial reports.",
    icon: "💰",
    colour: "#1A7A32",
    capabilities: ["accounts_reconciliation", "review_invoice", "financial_reporting", "draft_document"],
    requiredPermissions: ["finance:read"],
    requiredEntitlements: ["finance_workforce"],
    approvalRequirements: "manager_approval",
    executionStatus: "dna_pending",
    version: "2.0.0",
    workerProfileCodes: ["finance_officer_profile"],
    departmentCode: "finance",
    dnaStatus: "pending_design",
    displayOrder: 10,
    catalogueVersion: "2",
    replacementType: "none",
  },
  {
    id: "spec_payroll_workforce_cost_officer",
    code: "payroll_workforce_cost_officer",
    displayName: "Payroll & Workforce Cost Officer",
    packCode: "finance",
    description: "Reviews payroll data, processes pay runs, ensures award compliance, and reconciles workforce cost accounts.",
    icon: "💳",
    colour: "#1E3A8A",
    capabilities: ["payroll_review", "accounts_reconciliation", "draft_document"],
    requiredPermissions: ["finance:read", "payroll:read"],
    requiredEntitlements: ["finance_workforce"],
    approvalRequirements: "administrator_approval",
    executionStatus: "dna_pending",
    version: "2.0.0",
    workerProfileCodes: ["payroll_workforce_cost_officer_profile"],
    departmentCode: "finance",
    dnaStatus: "pending_design",
    displayOrder: 11,
    catalogueVersion: "2",
    replacementType: "none",
  },
  {
    id: "spec_financial_planning_reporting_manager",
    code: "financial_planning_reporting_manager",
    displayName: "Financial Planning & Reporting Manager",
    packCode: "finance",
    description: "Analyses budgets, identifies variances, prepares financial statements, management reports, and board-level financial summaries.",
    icon: "📈",
    colour: "#6B2A2A",
    capabilities: ["budget_summary", "financial_reporting", "research", "draft_document"],
    requiredPermissions: ["finance:read"],
    requiredEntitlements: ["finance_workforce"],
    approvalRequirements: "administrator_approval",
    executionStatus: "dna_pending",
    version: "2.0.0",
    workerProfileCodes: ["financial_planning_reporting_manager_profile"],
    departmentCode: "finance",
    dnaStatus: "pending_design",
    displayOrder: 12,
    catalogueVersion: "2",
    replacementType: "none",
  },

  // ── PEOPLE & CULTURE DEPARTMENT ───────────────────────────────────────────

  {
    id: "spec_people_culture_manager",
    code: "people_culture_manager",
    displayName: "People & Culture Manager",
    packCode: "hr",
    description: "Manages HR administration, policy review, employee relations, and facilitates performance review cycles and development planning.",
    icon: "👥",
    colour: "#DB2777",
    capabilities: ["hr_policy_review", "performance_review", "draft_document", "summarise"],
    requiredPermissions: ["hr:read"],
    requiredEntitlements: ["hr_workforce"],
    approvalRequirements: "no_approval",
    executionStatus: "dna_pending",
    version: "2.0.0",
    workerProfileCodes: ["people_culture_manager_profile"],
    departmentCode: "people_culture",
    dnaStatus: "pending_design",
    displayOrder: 13,
    catalogueVersion: "2",
    replacementType: "none",
  },
  {
    id: "spec_talent_learning_specialist",
    code: "talent_learning_specialist",
    displayName: "Talent & Learning Specialist",
    packCode: "hr",
    description: "Supports candidate screening, job posting, onboarding documentation, and coordinates staff training programs and development activities.",
    icon: "🎓",
    colour: "#7C3AED",
    capabilities: ["recruitment_support", "learning_coordination", "draft_communication", "research"],
    requiredPermissions: ["hr:read"],
    requiredEntitlements: ["hr_workforce"],
    approvalRequirements: "no_approval",
    executionStatus: "dna_pending",
    version: "2.0.0",
    workerProfileCodes: ["talent_learning_specialist_profile"],
    departmentCode: "people_culture",
    dnaStatus: "pending_design",
    displayOrder: 14,
    catalogueVersion: "2",
    replacementType: "none",
  },
  {
    id: "spec_workforce_compliance_specialist",
    code: "workforce_compliance_specialist",
    displayName: "Workforce Compliance Specialist",
    packCode: "hr",
    description: "Determines worker-level compliance and deployment eligibility from verified credentials, screening/checks, training, competency evidence, expiry/currentness and applicable workforce requirements.",
    icon: "🛡️",
    colour: "#0369A1",
    capabilities: [
      "staff_compliance_check",
      "worker_eligibility_review",
      "credential_review",
      "training_competency_review",
      "expiry_monitoring",
      "deployment_eligibility",
      "audit_preparation",
      "draft_document",
    ],
    requiredPermissions: ["hr:read", "compliance:read"],
    requiredEntitlements: ["hr_workforce"],
    approvalRequirements: "no_approval",
    executionStatus: "available",
    version: "2.0.0",
    workerProfileCodes: ["workforce_compliance_specialist_profile"],
    departmentCode: "people_culture",
    dnaStatus: "approved",
    displayOrder: 15,
    catalogueVersion: "2",
    replacementType: "none",
  },

  // ── MARKETING DEPARTMENT ──────────────────────────────────────────────────

  {
    id: "spec_marketing_communications_manager",
    code: "marketing_communications_manager",
    displayName: "Marketing & Communications Manager",
    packCode: "marketing",
    description: "Leads marketing strategy, brand positioning, campaign oversight, content planning, social media management, and marketing performance reporting.",
    icon: "📣",
    colour: "#D97706",
    capabilities: ["campaign_planning", "content_strategy", "brand_management", "social_media", "marketing_reporting", "draft_communication"],
    requiredPermissions: ["marketing:read"],
    requiredEntitlements: ["marketing_workforce"],
    approvalRequirements: "manager_approval",
    executionStatus: "dna_pending",
    version: "2.0.0",
    workerProfileCodes: ["marketing_communications_manager_profile"],
    departmentCode: "marketing",
    dnaStatus: "pending_design",
    displayOrder: 16,
    catalogueVersion: "2",
    replacementType: "none",
  },

  // ── SHARED PROFESSIONAL SERVICES DEPARTMENT ───────────────────────────────

  {
    id: "spec_knowledge_documentation_specialist",
    code: "knowledge_documentation_specialist",
    displayName: "Knowledge & Documentation Specialist",
    packCode: "core",
    description: "Creates, formats, and reviews organisational documents to professional standards; summarises long documents and conducts research.",
    icon: "📚",
    colour: "#0D9488",
    capabilities: ["draft_document", "summarise", "review_policy", "research"],
    requiredPermissions: [],
    requiredEntitlements: [],
    approvalRequirements: "no_approval",
    executionStatus: "dna_pending",
    version: "2.0.0",
    workerProfileCodes: ["knowledge_documentation_specialist_profile"],
    departmentCode: "shared_professional_services",
    dnaStatus: "pending_design",
    displayOrder: 17,
    catalogueVersion: "2",
    replacementType: "none",
  },

  // ════════════════════════════════════════════════════════════════════════════
  // CATALOGUE v1 — 28 Deprecated Legacy Roles (Sprint 11 consolidation)
  // These are retained for audit trail, API backwards-compatibility, and migration.
  // DO NOT surface these in the active catalogue UI.
  // ════════════════════════════════════════════════════════════════════════════

  // ── Deprecated: Executive / Core ─────────────────────────────────────────

  {
    id: "spec_research_specialist",
    code: "research_specialist",
    displayName: "Research Specialist",
    packCode: "core",
    description: "Conducts in-depth research on regulations, industry standards, and best practices.",
    icon: "🔍",
    colour: "#7B68EE",
    capabilities: ["research", "summarise", "draft_document"],
    requiredPermissions: [],
    requiredEntitlements: [],
    approvalRequirements: "no_approval",
    executionStatus: "deprecated",
    version: "1.0.0",
    workerProfileCodes: ["research_specialist_profile"],
    departmentCode: "shared_professional_services",
    dnaStatus: "not_applicable",
    displayOrder: 100,
    catalogueVersion: "1",
    replacementRoleCode: null,
    replacementType: "capability_distribution",
    deprecatedAt: "2026-07-28",
    deprecationReason: "Research capability distributed across compliance, policy, finance, marketing, and talent roles.",
  },
  {
    id: "spec_calendar_specialist",
    code: "calendar_specialist",
    displayName: "Calendar Specialist",
    packCode: "core",
    description: "Manages complex scheduling, multi-party meetings, and calendar optimisation.",
    icon: "🗓️",
    colour: "#4169E1",
    capabilities: ["manage_calendar", "schedule_meeting"],
    requiredPermissions: [],
    requiredEntitlements: [],
    approvalRequirements: "no_approval",
    executionStatus: "deprecated",
    version: "1.0.0",
    workerProfileCodes: ["calendar_specialist_profile"],
    departmentCode: "executive",
    dnaStatus: "not_applicable",
    displayOrder: 101,
    catalogueVersion: "1",
    replacementRoleCode: "executive_assistant",
    replacementType: "merged",
    deprecatedAt: "2026-07-28",
    deprecationReason: "Merged into Executive Assistant (executive_assistant).",
  },
  {
    id: "spec_communication_specialist",
    code: "communication_specialist",
    displayName: "Communication Specialist",
    packCode: "core",
    description: "Drafts professional emails, letters, announcements, and stakeholder communications.",
    icon: "💬",
    colour: "#32CD32",
    capabilities: ["draft_communication", "summarise"],
    requiredPermissions: [],
    requiredEntitlements: [],
    approvalRequirements: "no_approval",
    executionStatus: "deprecated",
    version: "1.0.0",
    workerProfileCodes: ["communication_specialist_profile"],
    departmentCode: "executive",
    dnaStatus: "not_applicable",
    displayOrder: 102,
    catalogueVersion: "1",
    replacementRoleCode: "executive_assistant",
    replacementType: "merged",
    deprecatedAt: "2026-07-28",
    deprecationReason: "Merged into Executive Assistant (executive_assistant).",
  },
  {
    id: "spec_document_specialist",
    code: "document_specialist",
    displayName: "Document Specialist",
    packCode: "core",
    description: "Creates, formats, and reviews organisational documents to professional standards.",
    icon: "📄",
    colour: "#20B2AA",
    capabilities: ["draft_document", "summarise", "review_policy"],
    requiredPermissions: [],
    requiredEntitlements: [],
    approvalRequirements: "no_approval",
    executionStatus: "deprecated",
    version: "1.0.0",
    workerProfileCodes: ["document_specialist_profile"],
    departmentCode: "shared_professional_services",
    dnaStatus: "not_applicable",
    displayOrder: 103,
    catalogueVersion: "1",
    replacementRoleCode: "knowledge_documentation_specialist",
    replacementType: "renamed",
    deprecatedAt: "2026-07-28",
    deprecationReason: "Renamed and expanded into Knowledge & Documentation Specialist (knowledge_documentation_specialist).",
  },

  // ── Deprecated: Compliance ────────────────────────────────────────────────

  {
    id: "spec_compliance_officer",
    code: "compliance_officer",
    displayName: "Compliance Officer",
    packCode: "compliance",
    description: "Reviews policies, prepares for audits, and ensures NDIS regulatory compliance.",
    icon: "⚖️",
    colour: "#FF8C00",
    capabilities: ["review_policy", "audit_preparation", "review_incident"],
    requiredPermissions: ["compliance:read"],
    requiredEntitlements: ["compliance_workforce"],
    approvalRequirements: "manager_approval",
    executionStatus: "deprecated",
    version: "1.0.0",
    workerProfileCodes: ["compliance_officer_profile"],
    departmentCode: "compliance_governance",
    dnaStatus: "not_applicable",
    displayOrder: 104,
    catalogueVersion: "1",
    replacementRoleCode: "compliance_quality_manager",
    replacementType: "merged",
    deprecatedAt: "2026-07-28",
    deprecationReason: "Merged into Compliance & Quality Manager (compliance_quality_manager).",
  },
  {
    id: "spec_quality_officer",
    code: "quality_officer",
    displayName: "Quality Officer",
    packCode: "compliance",
    description: "Assesses service quality, identifies improvement opportunities, and monitors standards.",
    icon: "✅",
    colour: "#228B22",
    capabilities: ["quality_review", "review_policy", "audit_preparation"],
    requiredPermissions: ["compliance:read"],
    requiredEntitlements: ["compliance_workforce"],
    approvalRequirements: "no_approval",
    executionStatus: "deprecated",
    version: "1.0.0",
    workerProfileCodes: ["quality_officer_profile"],
    departmentCode: "compliance_governance",
    dnaStatus: "not_applicable",
    displayOrder: 105,
    catalogueVersion: "1",
    replacementRoleCode: "compliance_quality_manager",
    replacementType: "merged",
    deprecatedAt: "2026-07-28",
    deprecationReason: "Merged into Compliance & Quality Manager (compliance_quality_manager).",
  },
  {
    id: "spec_corrective_action_officer",
    code: "corrective_action_officer",
    displayName: "Corrective Action Officer",
    packCode: "compliance",
    description: "Develops and tracks corrective action plans following audits or incidents.",
    icon: "🔧",
    colour: "#FF6347",
    capabilities: ["corrective_action", "review_incident", "draft_document"],
    requiredPermissions: ["compliance:read"],
    requiredEntitlements: ["compliance_workforce"],
    approvalRequirements: "manager_approval",
    executionStatus: "deprecated",
    version: "1.0.0",
    workerProfileCodes: ["corrective_action_officer_profile"],
    departmentCode: "compliance_governance",
    dnaStatus: "not_applicable",
    displayOrder: 106,
    catalogueVersion: "1",
    replacementRoleCode: "compliance_quality_manager",
    replacementType: "merged",
    deprecatedAt: "2026-07-28",
    deprecationReason: "Merged into Compliance & Quality Manager (compliance_quality_manager).",
  },
  {
    id: "spec_incident_review_officer",
    code: "incident_review_officer",
    displayName: "Incident Review Officer",
    packCode: "compliance",
    description: "Investigates incidents, documents findings, and ensures reportable events are handled correctly.",
    icon: "🚨",
    colour: "#DC143C",
    capabilities: ["review_incident", "draft_document", "audit_preparation"],
    requiredPermissions: ["compliance:read", "incidents:read"],
    requiredEntitlements: ["compliance_workforce"],
    approvalRequirements: "manager_approval",
    executionStatus: "deprecated",
    version: "1.0.0",
    workerProfileCodes: ["incident_review_officer_profile"],
    departmentCode: "compliance_governance",
    dnaStatus: "not_applicable",
    displayOrder: 107,
    catalogueVersion: "1",
    replacementRoleCode: "incident_safeguarding_specialist",
    replacementType: "merged",
    deprecatedAt: "2026-07-28",
    deprecationReason: "Merged into Incident & Safeguarding Specialist (incident_safeguarding_specialist).",
  },
  {
    id: "spec_restrictive_practice_officer",
    code: "restrictive_practice_officer",
    displayName: "Restrictive Practice Officer",
    packCode: "compliance",
    description: "Reviews, documents, and reports on the use of restrictive practices in accordance with NDIS requirements.",
    icon: "🔒",
    colour: "#9400D3",
    capabilities: ["restrictive_practice_review", "review_incident", "audit_preparation"],
    requiredPermissions: ["compliance:read", "restrictive_practices:read"],
    requiredEntitlements: ["compliance_workforce"],
    approvalRequirements: "compliance_approval",
    executionStatus: "deprecated",
    version: "1.0.0",
    workerProfileCodes: ["restrictive_practice_officer_profile"],
    departmentCode: "compliance_governance",
    dnaStatus: "not_applicable",
    displayOrder: 108,
    catalogueVersion: "1",
    replacementRoleCode: "authorised_program_officer",
    replacementType: "capability_distribution",
    deprecatedAt: "2026-07-28",
    deprecationReason: "Historical restrictive-practice officer is preserved. Future RP governance maps to Authorised Program Officer; incident/safeguarding consequences remain with Incident & Safeguarding Specialist.",
  },
  {
    id: "spec_policy_officer",
    code: "policy_officer",
    displayName: "Policy Officer",
    packCode: "compliance",
    description: "Drafts, reviews, and maintains organisational policies aligned to NDIS standards.",
    icon: "📜",
    colour: "#8B6914",
    capabilities: ["draft_policy", "review_policy", "research"],
    requiredPermissions: ["compliance:read"],
    requiredEntitlements: ["compliance_workforce"],
    approvalRequirements: "administrator_approval",
    executionStatus: "deprecated",
    version: "1.0.0",
    workerProfileCodes: ["policy_officer_profile"],
    departmentCode: "compliance_governance",
    dnaStatus: "not_applicable",
    displayOrder: 109,
    catalogueVersion: "1",
    replacementRoleCode: "policy_governance_specialist",
    replacementType: "merged",
    deprecatedAt: "2026-07-28",
    deprecationReason: "Merged into Policy & Governance Specialist (policy_governance_specialist).",
  },

  // ── Deprecated: Operations ────────────────────────────────────────────────

  {
    id: "spec_roster_coordinator",
    code: "roster_coordinator",
    displayName: "Roster Coordinator",
    packCode: "operations",
    description: "Manages staff rosters, shift allocations, and scheduling conflicts.",
    icon: "📊",
    colour: "#DAA520",
    capabilities: ["review_roster", "capacity_analysis", "manage_calendar"],
    requiredPermissions: ["operations:read", "roster:read"],
    requiredEntitlements: ["operations_workforce"],
    approvalRequirements: "no_approval",
    executionStatus: "deprecated",
    version: "1.0.0",
    workerProfileCodes: ["roster_coordinator_profile"],
    departmentCode: "operations",
    dnaStatus: "not_applicable",
    displayOrder: 110,
    catalogueVersion: "1",
    replacementRoleCode: "workforce_rostering_coordinator",
    replacementType: "renamed",
    deprecatedAt: "2026-07-28",
    deprecationReason: "Renamed and expanded into Workforce Rostering Coordinator (workforce_rostering_coordinator).",
  },
  {
    id: "spec_asset_coordinator",
    code: "asset_coordinator",
    displayName: "Asset Coordinator",
    packCode: "operations",
    description: "Tracks organisational assets, maintenance schedules, and procurement needs.",
    icon: "🏗️",
    colour: "#FF7F50",
    capabilities: ["asset_management", "create_workflow", "summarise"],
    requiredPermissions: ["operations:read"],
    requiredEntitlements: ["operations_workforce"],
    approvalRequirements: "no_approval",
    executionStatus: "deprecated",
    version: "1.0.0",
    workerProfileCodes: ["asset_coordinator_profile"],
    departmentCode: "operations",
    dnaStatus: "not_applicable",
    displayOrder: 111,
    catalogueVersion: "1",
    replacementRoleCode: "process_asset_coordinator",
    replacementType: "merged",
    deprecatedAt: "2026-07-28",
    deprecationReason: "Merged into Process & Asset Coordinator (process_asset_coordinator).",
  },
  {
    id: "spec_workflow_coordinator",
    code: "workflow_coordinator",
    displayName: "Workflow Coordinator",
    packCode: "operations",
    description: "Designs, documents, and optimises business processes and operational workflows.",
    icon: "🔄",
    colour: "#98FB98",
    capabilities: ["create_workflow", "service_delivery_review", "draft_document"],
    requiredPermissions: ["operations:read"],
    requiredEntitlements: ["operations_workforce"],
    approvalRequirements: "no_approval",
    executionStatus: "deprecated",
    version: "1.0.0",
    workerProfileCodes: ["workflow_coordinator_profile"],
    departmentCode: "operations",
    dnaStatus: "not_applicable",
    displayOrder: 112,
    catalogueVersion: "1",
    replacementRoleCode: "process_asset_coordinator",
    replacementType: "merged",
    deprecatedAt: "2026-07-28",
    deprecationReason: "Merged into Process & Asset Coordinator (process_asset_coordinator).",
  },

  // ── Deprecated: Finance ───────────────────────────────────────────────────

  {
    id: "spec_accounts_officer",
    code: "accounts_officer",
    displayName: "Accounts Officer",
    packCode: "finance",
    description: "Manages accounts payable/receivable and performs account reconciliation.",
    icon: "💰",
    colour: "#32CD32",
    capabilities: ["accounts_reconciliation", "review_invoice", "financial_reporting"],
    requiredPermissions: ["finance:read"],
    requiredEntitlements: ["finance_workforce"],
    approvalRequirements: "manager_approval",
    executionStatus: "deprecated",
    version: "1.0.0",
    workerProfileCodes: ["accounts_officer_profile"],
    departmentCode: "finance",
    dnaStatus: "not_applicable",
    displayOrder: 113,
    catalogueVersion: "1",
    replacementRoleCode: "finance_officer",
    replacementType: "merged",
    deprecatedAt: "2026-07-28",
    deprecationReason: "Merged into Finance Officer (finance_officer).",
  },
  {
    id: "spec_invoice_specialist",
    code: "invoice_specialist",
    displayName: "Invoice Specialist",
    packCode: "finance",
    description: "Reviews, validates, and processes NDIS invoices and service bookings.",
    icon: "🧾",
    colour: "#20B2AA",
    capabilities: ["review_invoice", "accounts_reconciliation", "draft_document"],
    requiredPermissions: ["finance:read"],
    requiredEntitlements: ["finance_workforce"],
    approvalRequirements: "manager_approval",
    executionStatus: "deprecated",
    version: "1.0.0",
    workerProfileCodes: ["invoice_specialist_profile"],
    departmentCode: "finance",
    dnaStatus: "not_applicable",
    displayOrder: 114,
    catalogueVersion: "1",
    replacementRoleCode: "finance_officer",
    replacementType: "merged",
    deprecatedAt: "2026-07-28",
    deprecationReason: "Merged into Finance Officer (finance_officer).",
  },
  {
    id: "spec_payroll_officer",
    code: "payroll_officer",
    displayName: "Payroll Officer",
    packCode: "finance",
    description: "Reviews payroll data, processes pay runs, and ensures award compliance.",
    icon: "💳",
    colour: "#4169E1",
    capabilities: ["payroll_review", "accounts_reconciliation"],
    requiredPermissions: ["finance:read", "payroll:read"],
    requiredEntitlements: ["finance_workforce"],
    approvalRequirements: "administrator_approval",
    executionStatus: "deprecated",
    version: "1.0.0",
    workerProfileCodes: ["payroll_officer_profile"],
    departmentCode: "finance",
    dnaStatus: "not_applicable",
    displayOrder: 115,
    catalogueVersion: "1",
    replacementRoleCode: "payroll_workforce_cost_officer",
    replacementType: "renamed",
    deprecatedAt: "2026-07-28",
    deprecationReason: "Renamed and expanded into Payroll & Workforce Cost Officer (payroll_workforce_cost_officer).",
  },
  {
    id: "spec_budget_analyst",
    code: "budget_analyst",
    displayName: "Budget Analyst",
    packCode: "finance",
    description: "Analyses budgets, identifies variances, and prepares financial summaries.",
    icon: "📈",
    colour: "#DAA520",
    capabilities: ["budget_summary", "financial_reporting", "research"],
    requiredPermissions: ["finance:read"],
    requiredEntitlements: ["finance_workforce"],
    approvalRequirements: "no_approval",
    executionStatus: "deprecated",
    version: "1.0.0",
    workerProfileCodes: ["budget_analyst_profile"],
    departmentCode: "finance",
    dnaStatus: "not_applicable",
    displayOrder: 116,
    catalogueVersion: "1",
    replacementRoleCode: "financial_planning_reporting_manager",
    replacementType: "merged",
    deprecatedAt: "2026-07-28",
    deprecationReason: "Merged into Financial Planning & Reporting Manager (financial_planning_reporting_manager).",
  },
  {
    id: "spec_financial_reporting_officer",
    code: "financial_reporting_officer",
    displayName: "Financial Reporting Officer",
    packCode: "finance",
    description: "Prepares financial statements, management reports, and board-level financial summaries.",
    icon: "📊",
    colour: "#8B0000",
    capabilities: ["financial_reporting", "budget_summary", "draft_document"],
    requiredPermissions: ["finance:read"],
    requiredEntitlements: ["finance_workforce"],
    approvalRequirements: "administrator_approval",
    executionStatus: "deprecated",
    version: "1.0.0",
    workerProfileCodes: ["financial_reporting_officer_profile"],
    departmentCode: "finance",
    dnaStatus: "not_applicable",
    displayOrder: 117,
    catalogueVersion: "1",
    replacementRoleCode: "financial_planning_reporting_manager",
    replacementType: "merged",
    deprecatedAt: "2026-07-28",
    deprecationReason: "Merged into Financial Planning & Reporting Manager (financial_planning_reporting_manager).",
  },

  // ── Deprecated: HR ────────────────────────────────────────────────────────

  {
    id: "spec_hr_officer",
    code: "hr_officer",
    displayName: "HR Officer",
    packCode: "hr",
    description: "Manages HR administration, policy review, and employee relations support.",
    icon: "👤",
    colour: "#FF69B4",
    capabilities: ["hr_policy_review", "draft_document", "summarise"],
    requiredPermissions: ["hr:read"],
    requiredEntitlements: ["hr_workforce"],
    approvalRequirements: "no_approval",
    executionStatus: "deprecated",
    version: "1.0.0",
    workerProfileCodes: ["hr_officer_profile"],
    departmentCode: "people_culture",
    dnaStatus: "not_applicable",
    displayOrder: 118,
    catalogueVersion: "1",
    replacementRoleCode: "people_culture_manager",
    replacementType: "merged",
    deprecatedAt: "2026-07-28",
    deprecationReason: "Merged into People & Culture Manager (people_culture_manager).",
  },
  {
    id: "spec_performance_officer",
    code: "performance_officer",
    displayName: "Performance Officer",
    packCode: "hr",
    description: "Facilitates performance review cycles, goal setting, and development planning.",
    icon: "🎯",
    colour: "#FF8C00",
    capabilities: ["performance_review", "draft_document", "manage_calendar"],
    requiredPermissions: ["hr:read"],
    requiredEntitlements: ["hr_workforce"],
    approvalRequirements: "manager_approval",
    executionStatus: "deprecated",
    version: "1.0.0",
    workerProfileCodes: ["performance_officer_profile"],
    departmentCode: "people_culture",
    dnaStatus: "not_applicable",
    displayOrder: 119,
    catalogueVersion: "1",
    replacementRoleCode: "people_culture_manager",
    replacementType: "merged",
    deprecatedAt: "2026-07-28",
    deprecationReason: "Merged into People & Culture Manager (people_culture_manager).",
  },
  {
    id: "spec_recruitment_officer",
    code: "recruitment_officer",
    displayName: "Recruitment Officer",
    packCode: "hr",
    description: "Supports candidate screening, job posting, and onboarding documentation.",
    icon: "🤝",
    colour: "#9370DB",
    capabilities: ["recruitment_support", "draft_communication", "research"],
    requiredPermissions: ["hr:read"],
    requiredEntitlements: ["hr_workforce"],
    approvalRequirements: "no_approval",
    executionStatus: "deprecated",
    version: "1.0.0",
    workerProfileCodes: ["recruitment_officer_profile"],
    departmentCode: "people_culture",
    dnaStatus: "not_applicable",
    displayOrder: 120,
    catalogueVersion: "1",
    replacementRoleCode: "talent_learning_specialist",
    replacementType: "merged",
    deprecatedAt: "2026-07-28",
    deprecationReason: "Merged into Talent & Learning Specialist (talent_learning_specialist).",
  },
  {
    id: "spec_learning_coordinator",
    code: "learning_coordinator",
    displayName: "Learning Coordinator",
    packCode: "hr",
    description: "Coordinates staff training programs, tracks certifications, and manages compliance learning.",
    icon: "📚",
    colour: "#3CB371",
    capabilities: ["learning_coordination", "staff_compliance_check", "schedule_meeting"],
    requiredPermissions: ["hr:read"],
    requiredEntitlements: ["hr_workforce"],
    approvalRequirements: "no_approval",
    executionStatus: "deprecated",
    version: "1.0.0",
    workerProfileCodes: ["learning_coordinator_profile"],
    departmentCode: "people_culture",
    dnaStatus: "not_applicable",
    displayOrder: 121,
    catalogueVersion: "1",
    replacementRoleCode: "talent_learning_specialist",
    replacementType: "merged",
    deprecatedAt: "2026-07-28",
    deprecationReason: "Merged into Talent & Learning Specialist (talent_learning_specialist).",
  },
  {
    id: "spec_staff_compliance_officer",
    code: "staff_compliance_officer",
    displayName: "Staff Compliance Officer",
    packCode: "hr",
    description: "Verifies staff credentials, NDIS worker screening, and regulatory compliance requirements.",
    icon: "📋",
    colour: "#4682B4",
    capabilities: ["staff_compliance_check", "hr_policy_review", "audit_preparation"],
    requiredPermissions: ["hr:read", "compliance:read"],
    requiredEntitlements: ["hr_workforce"],
    approvalRequirements: "no_approval",
    executionStatus: "deprecated",
    version: "1.0.0",
    workerProfileCodes: ["staff_compliance_officer_profile"],
    departmentCode: "people_culture",
    dnaStatus: "not_applicable",
    displayOrder: 122,
    catalogueVersion: "1",
    replacementRoleCode: "workforce_compliance_specialist",
    replacementType: "renamed",
    deprecatedAt: "2026-07-28",
    deprecationReason: "Renamed into Workforce Compliance Specialist (workforce_compliance_specialist).",
  },

  // ── Deprecated: Marketing ─────────────────────────────────────────────────

  {
    id: "spec_marketing_director",
    code: "marketing_director",
    displayName: "Marketing Director",
    packCode: "marketing",
    description: "Leads marketing strategy, brand positioning, and campaign oversight.",
    icon: "📣",
    colour: "#FF1493",
    capabilities: ["campaign_planning", "brand_management", "content_strategy"],
    requiredPermissions: [],
    requiredEntitlements: ["marketing_workforce"],
    approvalRequirements: "administrator_approval",
    executionStatus: "deprecated",
    version: "1.0.0",
    workerProfileCodes: ["marketing_director_profile"],
    departmentCode: "marketing",
    dnaStatus: "not_applicable",
    displayOrder: 123,
    catalogueVersion: "1",
    replacementRoleCode: "marketing_communications_manager",
    replacementType: "merged",
    deprecatedAt: "2026-07-28",
    deprecationReason: "Merged into Marketing & Communications Manager (marketing_communications_manager).",
  },
  {
    id: "spec_content_strategist",
    code: "content_strategist",
    displayName: "Content Strategist",
    packCode: "marketing",
    description: "Develops content plans, editorial calendars, and audience-targeted messaging.",
    icon: "✍️",
    colour: "#00BFFF",
    capabilities: ["content_strategy", "draft_document", "research"],
    requiredPermissions: [],
    requiredEntitlements: ["marketing_workforce"],
    approvalRequirements: "no_approval",
    executionStatus: "deprecated",
    version: "1.0.0",
    workerProfileCodes: ["content_strategist_profile"],
    departmentCode: "marketing",
    dnaStatus: "not_applicable",
    displayOrder: 124,
    catalogueVersion: "1",
    replacementRoleCode: "marketing_communications_manager",
    replacementType: "merged",
    deprecatedAt: "2026-07-28",
    deprecationReason: "Merged into Marketing & Communications Manager (marketing_communications_manager).",
  },
  {
    id: "spec_campaign_manager",
    code: "campaign_manager",
    displayName: "Campaign Manager",
    packCode: "marketing",
    description: "Plans, executes, and reports on marketing campaigns across channels.",
    icon: "🎯",
    colour: "#FFA500",
    capabilities: ["campaign_planning", "marketing_reporting", "manage_calendar"],
    requiredPermissions: [],
    requiredEntitlements: ["marketing_workforce"],
    approvalRequirements: "manager_approval",
    executionStatus: "deprecated",
    version: "1.0.0",
    workerProfileCodes: ["campaign_manager_profile"],
    departmentCode: "marketing",
    dnaStatus: "not_applicable",
    displayOrder: 125,
    catalogueVersion: "1",
    replacementRoleCode: "marketing_communications_manager",
    replacementType: "merged",
    deprecatedAt: "2026-07-28",
    deprecationReason: "Merged into Marketing & Communications Manager (marketing_communications_manager).",
  },
  {
    id: "spec_brand_manager",
    code: "brand_manager",
    displayName: "Brand Manager",
    packCode: "marketing",
    description: "Maintains brand integrity, develops brand guidelines, and oversees visual identity.",
    icon: "🏷️",
    colour: "#8A2BE2",
    capabilities: ["brand_management", "content_strategy", "draft_document"],
    requiredPermissions: [],
    requiredEntitlements: ["marketing_workforce"],
    approvalRequirements: "no_approval",
    executionStatus: "deprecated",
    version: "1.0.0",
    workerProfileCodes: ["brand_manager_profile"],
    departmentCode: "marketing",
    dnaStatus: "not_applicable",
    displayOrder: 126,
    catalogueVersion: "1",
    replacementRoleCode: "marketing_communications_manager",
    replacementType: "merged",
    deprecatedAt: "2026-07-28",
    deprecationReason: "Merged into Marketing & Communications Manager (marketing_communications_manager).",
  },
  {
    id: "spec_social_media_specialist",
    code: "social_media_specialist",
    displayName: "Social Media Specialist",
    packCode: "marketing",
    description: "Manages social media presence, creates content calendars, and monitors engagement.",
    icon: "📱",
    colour: "#00FA9A",
    capabilities: ["social_media", "content_strategy", "marketing_reporting"],
    requiredPermissions: [],
    requiredEntitlements: ["marketing_workforce"],
    approvalRequirements: "no_approval",
    executionStatus: "deprecated",
    version: "1.0.0",
    workerProfileCodes: ["social_media_specialist_profile"],
    departmentCode: "marketing",
    dnaStatus: "not_applicable",
    displayOrder: 127,
    catalogueVersion: "1",
    replacementRoleCode: "marketing_communications_manager",
    replacementType: "merged",
    deprecatedAt: "2026-07-28",
    deprecationReason: "Merged into Marketing & Communications Manager (marketing_communications_manager).",
  },
];

// ─── Workforce Packs ──────────────────────────────────────────────────────────
// Pack specialist lists are derived from active (v2) specialists only.

/** Active v2 specialist codes for a given pack */
function _v2SpecialistsForPack(packCode: string): string[] {
  return SPECIALISTS
    .filter(s => s.packCode === packCode && s.catalogueVersion === "2")
    .map(s => s.code);
}

export const WORKFORCE_PACKS: RegistryPack[] = [
  {
    id: "pack_core",
    code: "core",
    name: "Core Workforce",
    description: "The essential AI workforce for every NeedsOps AI+ organisation. Contains the Chief of Staff, Executive Assistant, and Knowledge & Documentation Specialist.",
    industry: "ndis_provider",
    tier: "starter",
    status: "available",
    specialists: _v2SpecialistsForPack("core"),
  },
  {
    id: "pack_compliance",
    code: "compliance",
    name: "Compliance Workforce",
    description: "Specialist AI workers focused on NDIS compliance, quality, policy, incidents, and restrictive practices.",
    industry: "ndis_provider",
    tier: "professional",
    status: "available",
    specialists: _v2SpecialistsForPack("compliance"),
  },
  {
    id: "pack_operations",
    code: "operations",
    name: "Operations Workforce",
    description: "Specialist AI workers for operational management including rosters, workflows, assets, and service delivery.",
    industry: "ndis_provider",
    tier: "professional",
    status: "available",
    specialists: _v2SpecialistsForPack("operations"),
  },
  {
    id: "pack_finance",
    code: "finance",
    name: "Finance Workforce",
    description: "Specialist AI workers for financial operations including invoicing, payroll, budgets, and reporting.",
    industry: "ndis_provider",
    tier: "professional",
    status: "available",
    specialists: _v2SpecialistsForPack("finance"),
  },
  {
    id: "pack_hr",
    code: "hr",
    name: "People and Culture Workforce",
    description: "Specialist AI workers for people and culture including talent, performance, learning, and workforce compliance.",
    industry: "ndis_provider",
    tier: "professional",
    status: "available",
    specialists: _v2SpecialistsForPack("hr"),
  },
  {
    id: "pack_marketing",
    code: "marketing",
    name: "Marketing Workforce",
    description: "Specialist AI workers for marketing strategy, content, campaigns, brand, and social media.",
    industry: "ndis_provider",
    tier: "enterprise",
    status: "available",
    specialists: _v2SpecialistsForPack("marketing"),
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function getSpecialistByCode(code: string): RegistrySpecialist | undefined {
  return SPECIALISTS.find(s => s.code === code);
}

export function getCapabilityByCode(code: string): RegistryCapability | undefined {
  return CAPABILITIES.find(c => c.code === code);
}

export function getSpecialistsByCapability(capabilityCode: string): RegistrySpecialist[] {
  return SPECIALISTS.filter(s => s.capabilities.includes(capabilityCode));
}

export function getSpecialistsByPack(packCode: string): RegistrySpecialist[] {
  return SPECIALISTS.filter(s => s.packCode === packCode);
}

/** Resolve a specialist's capabilities to full objects */
export function getSpecialistCapabilities(specialistCode: string): RegistryCapability[] {
  const specialist = getSpecialistByCode(specialistCode);
  if (!specialist) return [];
  return specialist.capabilities
    .map(code => getCapabilityByCode(code))
    .filter((c): c is RegistryCapability => !!c);
}

// ── Sprint 11 new helpers ─────────────────────────────────────────────────────

/**
 * Sprint 11: Alias map for deprecated role codes to their current replacements.
 * Used by the CoS routing layer to transparently reroute legacy role codes.
 * Only includes roles with a direct single replacement (replacementType: "renamed").
 */
export const DEPRECATED_ROLE_ALIASES: Record<string, string> = {
  compliance_officer: "compliance_quality_manager",
  document_specialist: "knowledge_documentation_specialist",
  restrictive_practice_officer: "authorised_program_officer",
};

/**
 * Returns all active catalogue v2 specialists (status: available or dna_pending).
 * Use this for the active workforce catalogue UI.
 */
export function getCurrentSpecialists(): RegistrySpecialist[] {
  return SPECIALISTS.filter(
    s => s.catalogueVersion === "2" &&
      (s.executionStatus === "available" || s.executionStatus === "dna_pending")
  );
}

/**
 * Returns all deprecated legacy specialists (catalogue v1).
 * Use this for migration tooling, audit trails, and backwards-compatible API responses.
 */
export function getDeprecatedSpecialists(): RegistrySpecialist[] {
  return SPECIALISTS.filter(s => s.executionStatus === "deprecated");
}

/**
 * Returns all catalogue v2 specialists in a given department.
 * @param dept — one of the departmentCode values
 */
export function getSpecialistsByDepartment(dept: string): RegistrySpecialist[] {
  return SPECIALISTS.filter(
    s => s.departmentCode === dept && s.catalogueVersion === "2"
  );
}

/**
 * Given a deprecated (v1) role code, returns the replacement role code,
 * or null if capabilities were distributed rather than consolidated.
 * Returns null for unknown codes.
 */
export function resolveAlias(code: string): string | null {
  const specialist = SPECIALISTS.find(s => s.code === code && s.catalogueVersion === "1");
  if (!specialist) return null;
  return specialist.replacementRoleCode ?? null;
}
