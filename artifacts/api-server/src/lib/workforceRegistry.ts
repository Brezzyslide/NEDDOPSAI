/**
 * Workforce Registry — Sprint 2
 *
 * Static metadata describing every workforce pack and specialist.
 * No AI, no LLM. This is pure data.
 *
 * Used to seed the database and serve the /v1/workforce/* endpoints.
 */

export interface RegistryCapability {
  id: string;
  code: string;
  name: string;
  description: string;
}

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
  executionStatus: "available" | "beta" | "coming_soon" | "deprecated";
  version: string;
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
  { id: "cap_quality_review", code: "quality_review", name: "Quality Review", description: "Assess service quality against standards" },
  { id: "cap_corrective_action", code: "corrective_action", name: "Corrective Action", description: "Develop and track corrective action plans" },
  { id: "cap_draft_policy", code: "draft_policy", name: "Draft Policy", description: "Draft and update organisational policies" },
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
  { id: "cap_hr_policy_review", code: "hr_policy_review", name: "HR Policy Review", description: "Review and update HR policies" },
  // Marketing
  { id: "cap_campaign_planning", code: "campaign_planning", name: "Campaign Planning", description: "Plan and manage marketing campaigns" },
  { id: "cap_content_strategy", code: "content_strategy", name: "Content Strategy", description: "Develop content strategy and editorial plans" },
  { id: "cap_brand_management", code: "brand_management", name: "Brand Management", description: "Maintain and develop brand identity" },
  { id: "cap_social_media", code: "social_media", name: "Social Media Management", description: "Manage social media content and engagement" },
  { id: "cap_marketing_reporting", code: "marketing_reporting", name: "Marketing Reporting", description: "Report on campaign performance and ROI" },
];

// ─── Specialists ──────────────────────────────────────────────────────────────

export const SPECIALISTS: RegistrySpecialist[] = [
  // ── Core Workforce ───────────────────────────────────────────────────────────
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
    version: "1.0.0",
  },
  {
    id: "spec_executive_assistant",
    code: "executive_assistant",
    displayName: "Executive Assistant",
    packCode: "core",
    description: "Manages scheduling, communications, and administrative tasks on behalf of leadership.",
    icon: "📅",
    colour: "#4A90D9",
    capabilities: ["manage_calendar", "draft_communication", "schedule_meeting", "summarise"],
    requiredPermissions: [],
    requiredEntitlements: [],
    approvalRequirements: "no_approval",
    executionStatus: "available",
    version: "1.0.0",
  },
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
    executionStatus: "available",
    version: "1.0.0",
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
    executionStatus: "available",
    version: "1.0.0",
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
    executionStatus: "available",
    version: "1.0.0",
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
    executionStatus: "available",
    version: "1.0.0",
  },
  // ── Compliance Workforce ─────────────────────────────────────────────────────
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
    executionStatus: "available",
    version: "1.0.0",
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
    executionStatus: "available",
    version: "1.0.0",
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
    executionStatus: "available",
    version: "1.0.0",
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
    executionStatus: "available",
    version: "1.0.0",
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
    executionStatus: "available",
    version: "1.0.0",
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
    executionStatus: "available",
    version: "1.0.0",
  },
  // ── Operations Workforce ─────────────────────────────────────────────────────
  {
    id: "spec_operations_manager",
    code: "operations_manager",
    displayName: "Operations Manager",
    packCode: "operations",
    description: "Oversees operational workflows, resource allocation, and service capacity planning.",
    icon: "⚙️",
    colour: "#1E90FF",
    capabilities: ["review_roster", "create_workflow", "capacity_analysis"],
    requiredPermissions: ["operations:read"],
    requiredEntitlements: ["operations_workforce"],
    approvalRequirements: "no_approval",
    executionStatus: "available",
    version: "1.0.0",
  },
  {
    id: "spec_service_delivery_coordinator",
    code: "service_delivery_coordinator",
    displayName: "Service Delivery Coordinator",
    packCode: "operations",
    description: "Coordinates service delivery activities and monitors participant outcomes.",
    icon: "🚀",
    colour: "#00CED1",
    capabilities: ["service_delivery_review", "create_workflow", "summarise"],
    requiredPermissions: ["operations:read"],
    requiredEntitlements: ["operations_workforce"],
    approvalRequirements: "no_approval",
    executionStatus: "available",
    version: "1.0.0",
  },
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
    executionStatus: "available",
    version: "1.0.0",
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
    executionStatus: "available",
    version: "1.0.0",
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
    executionStatus: "available",
    version: "1.0.0",
  },
  // ── Finance Workforce ────────────────────────────────────────────────────────
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
    executionStatus: "available",
    version: "1.0.0",
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
    executionStatus: "available",
    version: "1.0.0",
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
    executionStatus: "available",
    version: "1.0.0",
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
    executionStatus: "available",
    version: "1.0.0",
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
    executionStatus: "available",
    version: "1.0.0",
  },
  // ── HR Workforce ─────────────────────────────────────────────────────────────
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
    executionStatus: "available",
    version: "1.0.0",
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
    executionStatus: "available",
    version: "1.0.0",
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
    executionStatus: "available",
    version: "1.0.0",
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
    executionStatus: "available",
    version: "1.0.0",
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
    executionStatus: "available",
    version: "1.0.0",
  },
  // ── Marketing Workforce ───────────────────────────────────────────────────────
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
    executionStatus: "coming_soon",
    version: "1.0.0",
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
    executionStatus: "coming_soon",
    version: "1.0.0",
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
    executionStatus: "coming_soon",
    version: "1.0.0",
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
    executionStatus: "coming_soon",
    version: "1.0.0",
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
    executionStatus: "coming_soon",
    version: "1.0.0",
  },
];

// ─── Workforce Packs ──────────────────────────────────────────────────────────

export const WORKFORCE_PACKS: RegistryPack[] = [
  {
    id: "pack_core",
    code: "core",
    name: "Core Workforce",
    description: "The essential AI workforce for every NeedsOps AI+ organisation. Contains the Chief of Staff and core specialist roles.",
    industry: "ndis_provider",
    tier: "starter",
    status: "available",
    specialists: SPECIALISTS.filter(s => s.packCode === "core").map(s => s.code),
  },
  {
    id: "pack_compliance",
    code: "compliance",
    name: "Compliance Workforce",
    description: "Specialist AI workers focused on NDIS compliance, quality, policy, incidents, and restrictive practices.",
    industry: "ndis_provider",
    tier: "professional",
    status: "available",
    specialists: SPECIALISTS.filter(s => s.packCode === "compliance").map(s => s.code),
  },
  {
    id: "pack_operations",
    code: "operations",
    name: "Operations Workforce",
    description: "Specialist AI workers for operational management including rosters, workflows, assets, and service delivery.",
    industry: "ndis_provider",
    tier: "professional",
    status: "available",
    specialists: SPECIALISTS.filter(s => s.packCode === "operations").map(s => s.code),
  },
  {
    id: "pack_finance",
    code: "finance",
    name: "Finance Workforce",
    description: "Specialist AI workers for financial operations including invoicing, payroll, budgets, and reporting.",
    industry: "ndis_provider",
    tier: "professional",
    status: "available",
    specialists: SPECIALISTS.filter(s => s.packCode === "finance").map(s => s.code),
  },
  {
    id: "pack_hr",
    code: "hr",
    name: "HR Workforce",
    description: "Specialist AI workers for human resources including recruitment, performance, learning, and staff compliance.",
    industry: "ndis_provider",
    tier: "professional",
    status: "available",
    specialists: SPECIALISTS.filter(s => s.packCode === "hr").map(s => s.code),
  },
  {
    id: "pack_marketing",
    code: "marketing",
    name: "Marketing Workforce",
    description: "Specialist AI workers for marketing strategy, content, campaigns, brand, and social media.",
    industry: "ndis_provider",
    tier: "enterprise",
    status: "coming_soon",
    specialists: SPECIALISTS.filter(s => s.packCode === "marketing").map(s => s.code),
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
