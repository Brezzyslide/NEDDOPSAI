// ─── Platform ─────────────────────────────────────────────────────────────────

export const PLATFORM_NAME = "NeedsOps AI+" as const;
export const PLATFORM_VERSION = "0.2.0" as const;

// ─── Subscription tiers ───────────────────────────────────────────────────────

export const SUBSCRIPTION_TIERS = ["starter", "professional", "enterprise"] as const;
export type SubscriptionTier = (typeof SUBSCRIPTION_TIERS)[number];

export const SUBSCRIPTION_TIER_LABELS: Record<SubscriptionTier, string> = {
  starter: "Starter",
  professional: "Professional",
  enterprise: "Enterprise",
};

// ─── Organisation statuses ────────────────────────────────────────────────────

export const ORG_STATUSES = ["onboarding", "active", "suspended", "closed"] as const;
export type OrgStatus = (typeof ORG_STATUSES)[number];

export const ORG_STATUS_LABELS: Record<OrgStatus, string> = {
  onboarding: "Onboarding",
  active: "Active",
  suspended: "Suspended",
  closed: "Closed",
};

// ─── User statuses ────────────────────────────────────────────────────────────

export const USER_STATUSES = [
  "pending_verification",
  "active",
  "suspended",
  "deactivated",
] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

// ─── Membership roles (Sprint 1) ──────────────────────────────────────────────

export const MEMBERSHIP_ROLES = [
  "owner",
  "administrator",
  "manager",
  "member",
  "viewer",
  "auditor",
] as const;
export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];

export const MEMBERSHIP_ROLE_LABELS: Record<MembershipRole, string> = {
  owner: "Owner",
  administrator: "Administrator",
  manager: "Manager",
  member: "Member",
  viewer: "Viewer",
  auditor: "Auditor",
};

// ─── Membership statuses ──────────────────────────────────────────────────────

export const MEMBERSHIP_STATUSES = [
  "invited",
  "active",
  "suspended",
  "revoked",
] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

// ─── Invitation statuses ──────────────────────────────────────────────────────

export const INVITATION_STATUSES = [
  "pending",
  "accepted",
  "expired",
  "revoked",
] as const;
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

// ─── User roles (Sprint 0 — kept for backwards compat) ───────────────────────

/** @deprecated Use MembershipRole for Sprint 1+ multi-tenant membership roles */
export const USER_ROLES = ["owner", "admin", "member", "viewer"] as const;
/** @deprecated Use MembershipRole */
export type UserRole = (typeof USER_ROLES)[number];
/** @deprecated */
export const USER_ROLE_LABELS: Record<UserRole, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
  viewer: "Viewer",
};

// ─── Workforce pack tiers & statuses (Sprint 0 — unchanged) ──────────────────

export const PACK_TIERS = ["starter", "professional", "enterprise"] as const;
export type PackTier = (typeof PACK_TIERS)[number];

export const PACK_STATUSES = ["available", "coming_soon"] as const;
export type PackStatus = (typeof PACK_STATUSES)[number];

// ─── Industries ───────────────────────────────────────────────────────────────

export const INDUSTRIES = [
  "ndis_provider",
  "disability_services",
  "aged_care",
  "healthcare",
  "education",
  "professional_services",
  "other_regulated",
  "other",
] as const;
export type Industry = (typeof INDUSTRIES)[number];

export const INDUSTRY_LABELS: Record<Industry, string> = {
  ndis_provider: "NDIS Provider",
  disability_services: "Disability Services",
  aged_care: "Aged Care",
  healthcare: "Healthcare",
  education: "Education",
  professional_services: "Professional Services",
  other_regulated: "Other Regulated Organisation",
  other: "Other",
};

// ─── AI Worker roles (Sprint 0 — unchanged) ───────────────────────────────────

export const AI_WORKER_ROLES = [
  "chief_of_staff",
  "compliance_officer",
  "hr_manager",
  "finance_officer",
  "operations_manager",
  "quality_manager",
  "risk_manager",
  "support_coordinator",
] as const;
export type AIWorkerRole = (typeof AI_WORKER_ROLES)[number];

export const AI_WORKER_ROLE_LABELS: Record<AIWorkerRole, string> = {
  chief_of_staff: "Chief of Staff",
  compliance_officer: "Compliance Officer",
  hr_manager: "HR Manager",
  finance_officer: "Finance Officer",
  operations_manager: "Operations Manager",
  quality_manager: "Quality Manager",
  risk_manager: "Risk Manager",
  support_coordinator: "Support Coordinator",
};

// ─── Reserved organisation slugs ─────────────────────────────────────────────

export const RESERVED_SLUGS = new Set([
  "admin",
  "api",
  "login",
  "logout",
  "register",
  "signup",
  "signin",
  "support",
  "security",
  "billing",
  "settings",
  "system",
  "needsops",
  "platform",
  "dashboard",
  "app",
  "onboarding",
  "invitations",
  "users",
  "tenants",
  "health",
  "static",
  "assets",
  "public",
  "www",
]);

// ─── Pagination ───────────────────────────────────────────────────────────────

export const DEFAULT_PAGE = 1;
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export type Paginated<T> = {
  items: T[];
  total: number;
  page: number;
  limit: number;
};

// ─── Service status ───────────────────────────────────────────────────────────

export type ServiceStatus = "operational" | "degraded" | "outage";

// ─── Audit event types ────────────────────────────────────────────────────────

export const AUDIT_EVENTS = [
  "user.registered",
  "user.email_verified",
  "user.logged_in",
  "user.logged_out",
  "user.profile_updated",
  "organisation.created",
  "organisation.updated",
  "organisation.switched",
  "membership.created",
  "membership.role_changed",
  "membership.suspended",
  "membership.reactivated",
  "membership.revoked",
  "invitation.created",
  "invitation.resent",
  "invitation.revoked",
  "invitation.accepted",
  "invitation.email_delivery_attempted",
  "invitation.email_sent",
  "invitation.email_failed",
  "invitation.email_preview_created",
  "security.session_revoked",
  // Sprint 2 — AI Workforce
  "task.created",
  "task.planned",
  "task.state_changed",
  "task.cancelled",
  "specialist.assigned",
  "approval.requested",
  "approval.granted",
  "approval.rejected",
  // Sprint 3 — Plans and entitlements
  "plan.created",
  "plan.version_created",
  "plan.version_activated",
  "plan.archived",
  "tenant.subscription_created",
  "tenant.subscription_changed",
  "tenant.subscription_suspended",
  "tenant.subscription_cancelled",
  "tenant.trial_started",
  "tenant.trial_extended",
  "tenant.trial_expired",
  "tenant.entitlement_granted",
  "tenant.entitlement_denied",
  "tenant.entitlement_revoked",
  "tenant.override_created",
  "tenant.override_revoked",
  "usage.event_recorded",
  "usage.limit_warning",
  "usage.hard_limit_reached",
  "seat.limit_warning",
  "seat.limit_reached",
  // Sprint 3 — Platform Console
  "platform.organisation_viewed",
  "platform.organisation_suspended",
  "platform.organisation_reactivated",
  "platform.trial_extended",
  "platform.subscription_changed",
  "platform.override_created",
  "platform.override_revoked",
  "platform.internal_note_added",
  "platform.security_review_flagged",
  // Sprint 4 — Expanded Platform Console
  "platform.plan_created",
  "platform.plan_updated",
  "platform.plan_changed",
  "platform.plan_version_created",
  "platform.plan_version_activated",
  "platform.plan_version_archived",
  "platform.trial_started",
  "platform.trial_cancelled",
  "platform.trial_convert",
  "platform.high_priority_flagged",
  "platform.seat_override_created",
  "platform.seat_override_revoked",
  "platform.subscription_paused",
  "platform.subscription_resumed",
  "platform.subscription_cancelled",
  "platform.subscription_created",
  "platform.feature_flag_updated",
  "platform.platform_setting_updated",
  "platform.platform_role_granted",
  "platform.platform_role_revoked",
  // Sprint 9.7 — Staff management
  "platform.platform_staff_suspended",
  // Sprint 9.4 — Capability management
  "capability.created",
  "capability.updated",
  "capability.version_created",
  "capability.activated",
  "capability.deprecated",
  // Sprint 9.5 — Specialist Eligibility and Runtime
  "specialist.eligibility_checked",
  "specialist.assignment_allowed",
  "specialist.assignment_blocked",
  "specialist.run_created",
  "specialist.run_queued",
  "specialist.run_started",
  "specialist.run_blocked",
  "specialist.run_completed",
  "specialist.run_failed",
  "specialist.run_retried",
  "specialist.run_cancelled",
  "specialist.work_package_created",
  "specialist.context_built",
  "specialist.output_validated",
  "specialist.clarification_requested",
  "specialist.clarification_resolved",
  "specialist.conflict_detected",
  "specialist.conflict_resolved",
  "chief_of_staff.specialists_dispatched",
  "chief_of_staff.consolidation_started",
  "chief_of_staff.consolidation_completed",
  "execution_intent.approved",
  "execution_intent.dispatched",
  "execution_coordinator.dispatch_started",
  "execution_coordinator.completed",
  "execution_coordinator.pipeline_outcome",
  "execution_coordinator.error",
  "execution_coordinator.principal_missing",
  "openclaw.handoff_package_created",
  "ai_gateway.field_access_denied",
  // Sprint 9.7 — Owner Control Plane
  "platform.organisation_updated",
  "platform.organisation_closed",
  "platform.execution_frozen",
  "platform.execution_unfrozen",
  "platform.logins_disabled",
  "platform.logins_enabled",
  "platform.pack_granted",
  "platform.pack_revoked",
  "platform.pack_trial_started",
  "platform.pack_trial_extended",
] as const;
export type AuditEventType = (typeof AUDIT_EVENTS)[number];

// ─── Specialist execution statuses (Sprint 2) ────────────────────────────────

export const SPECIALIST_EXECUTION_STATUSES = [
  "available",
  "beta",
  "coming_soon",
  "deprecated",
] as const;
export type SpecialistExecutionStatus = (typeof SPECIALIST_EXECUTION_STATUSES)[number];

// ─── Workforce pack codes (Sprint 2) ─────────────────────────────────────────

export const WORKFORCE_PACK_CODES = [
  "core",
  "compliance",
  "operations",
  "finance",
  "hr",
  "marketing",
] as const;
export type WorkforcePackCode = (typeof WORKFORCE_PACK_CODES)[number];

export const WORKFORCE_PACK_LABELS: Record<WorkforcePackCode, string> = {
  core: "Core Workforce",
  compliance: "Compliance Workforce",
  operations: "Operations Workforce",
  finance: "Finance Workforce",
  hr: "HR Workforce",
  marketing: "Marketing Workforce",
};

// ─── Task states (Sprint 2) ───────────────────────────────────────────────────

export const TASK_STATES = [
  "draft",
  "queued",
  "planning",
  "awaiting_approval",
  "approved",
  "executing",
  "completed",
  "cancelled",
  "failed",
] as const;
export type TaskState = (typeof TASK_STATES)[number];

export const TASK_STATE_LABELS: Record<TaskState, string> = {
  draft: "Draft",
  queued: "Queued",
  planning: "Planning",
  awaiting_approval: "Awaiting Approval",
  approved: "Approved",
  executing: "Executing",
  completed: "Completed",
  cancelled: "Cancelled",
  failed: "Failed",
};

// ─── Task priorities (Sprint 2) ───────────────────────────────────────────────

export const TASK_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

// ─── Approval types (Sprint 2) ────────────────────────────────────────────────

export const APPROVAL_TYPES = [
  "no_approval",
  "manager_approval",
  "administrator_approval",
  "owner_approval",
  "dual_approval",
  "compliance_approval",
  "platform_approval",
] as const;
export type ApprovalType = (typeof APPROVAL_TYPES)[number];

export const APPROVAL_TYPE_LABELS: Record<ApprovalType, string> = {
  no_approval: "No Approval Required",
  manager_approval: "Manager Approval",
  administrator_approval: "Administrator Approval",
  owner_approval: "Owner Approval",
  dual_approval: "Dual Approval",
  compliance_approval: "Compliance Approval",
  platform_approval: "Platform Approval",
};

// ─── Approval states (Sprint 2) ───────────────────────────────────────────────

export const APPROVAL_STATES = [
  "pending",
  "approved",
  "rejected",
  "expired",
] as const;
export type ApprovalState = (typeof APPROVAL_STATES)[number];

// ─── Plan codes (Sprint 3) ────────────────────────────────────────────────────

export const PLAN_CODES = [
  "foundation",
  "professional",
  "business",
  "enterprise",
] as const;
export type PlanCode = (typeof PLAN_CODES)[number];

export const PLAN_CODE_LABELS: Record<PlanCode, string> = {
  foundation: "Foundation",
  professional: "Professional",
  business: "Business",
  enterprise: "Enterprise",
};

// ─── Subscription statuses (Sprint 3) ────────────────────────────────────────

export const SUBSCRIPTION_STATUSES = [
  "active",
  "suspended",
  "cancelled",
  "trial",
  "trial_expired",
  "past_due",
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const SUBSCRIPTION_STATUS_LABELS: Record<SubscriptionStatus, string> = {
  active: "Active",
  suspended: "Suspended",
  cancelled: "Cancelled",
  trial: "Trial",
  trial_expired: "Trial Expired",
  past_due: "Past Due",
};

// ─── Feature categories (Sprint 3) ───────────────────────────────────────────

export const FEATURE_CATEGORIES = [
  "execution_capability",
  "connector",
  "workforce_pack",
  "platform",
] as const;
export type FeatureCategory = (typeof FEATURE_CATEGORIES)[number];

// ─── Execution capability feature codes (Sprint 3) ───────────────────────────

export const EXECUTION_CAPABILITY_CODES = [
  "execution.openclaw_runtime",
  "execution.browser_session",
  "execution.browser_extension",
  "execution.local_device",
  "execution.local_files",
  "execution.local_applications",
  "execution.api_connectors",
  "execution.scheduled_tasks",
  "execution.multi_agent_workflows",
] as const;
export type ExecutionCapabilityCode = (typeof EXECUTION_CAPABILITY_CODES)[number];

// ─── Connector eligibility feature codes (Sprint 3) ──────────────────────────

export const CONNECTOR_CODES = [
  "connector.google_workspace",
  "connector.microsoft_365",
  "connector.xero",
  "connector.myob",
  "connector.zoho",
  "connector.needscare",
  "connector.need2comply",
  "connector.needs2learn",
  "connector.custom_crm",
  "connector.browser_based_system",
] as const;
export type ConnectorCode = (typeof CONNECTOR_CODES)[number];

// ─── Platform feature codes (Sprint 3) ───────────────────────────────────────

export const PLATFORM_FEATURE_CODES = [
  "platform.mobile_access",
  "platform.audit_history_basic",
  "platform.audit_history_advanced",
  "platform.approval_workflows",
  "platform.api_access",
  "platform.sso",
  "platform.scim",
  "platform.custom_branding",
  "platform.advanced_reporting",
  "platform.dedicated_runtime",
  "platform.custom_connectors",
  "platform.custom_retention",
  "platform.regional_hosting",
  "platform.sla",
  "platform.dedicated_infrastructure",
] as const;
export type PlatformFeatureCode = (typeof PLATFORM_FEATURE_CODES)[number];

// ─── Workforce pack feature codes (Sprint 3) ──────────────────────────────────

export const WORKFORCE_PACK_FEATURE_CODES = [
  "workforce_pack.core",
  "workforce_pack.compliance",
  "workforce_pack.operations",
  "workforce_pack.finance",
  "workforce_pack.hr",
  "workforce_pack.marketing",
] as const;
export type WorkforcePackFeatureCode = (typeof WORKFORCE_PACK_FEATURE_CODES)[number];

/** Union of all feature codes used as entitlement keys */
export type FeatureCode =
  | ExecutionCapabilityCode
  | ConnectorCode
  | PlatformFeatureCode
  | WorkforcePackFeatureCode;

export const ALL_FEATURE_CODES: readonly FeatureCode[] = [
  ...EXECUTION_CAPABILITY_CODES,
  ...CONNECTOR_CODES,
  ...PLATFORM_FEATURE_CODES,
  ...WORKFORCE_PACK_FEATURE_CODES,
] as const;

// ─── Usage dimension codes (Sprint 3) ────────────────────────────────────────

export const USAGE_DIMENSION_CODES = [
  "ai_tasks",
  "task_plans",
  "specialist_runs",
  "browser_actions",
  "local_device_actions",
  "api_connector_actions",
  "scheduled_runs",
  "document_pages",
  "storage_bytes",
  "generated_files",
  "input_tokens",
  "output_tokens",
  "active_users",
] as const;
export type UsageDimensionCode = (typeof USAGE_DIMENSION_CODES)[number];

export const USAGE_DIMENSION_LABELS: Record<UsageDimensionCode, string> = {
  ai_tasks: "AI Tasks",
  task_plans: "Task Plans",
  specialist_runs: "Specialist Runs",
  browser_actions: "Browser Actions",
  local_device_actions: "Local Device Actions",
  api_connector_actions: "API Connector Actions",
  scheduled_runs: "Scheduled Runs",
  document_pages: "Document Pages",
  storage_bytes: "Storage",
  generated_files: "Generated Files",
  input_tokens: "Input Tokens",
  output_tokens: "Output Tokens",
  active_users: "Active Users",
};

export const USAGE_DIMENSION_UNITS: Record<UsageDimensionCode, string> = {
  ai_tasks: "tasks",
  task_plans: "plans",
  specialist_runs: "runs",
  browser_actions: "actions",
  local_device_actions: "actions",
  api_connector_actions: "actions",
  scheduled_runs: "runs",
  document_pages: "pages",
  storage_bytes: "bytes",
  generated_files: "files",
  input_tokens: "tokens",
  output_tokens: "tokens",
  active_users: "users",
};

// ─── Platform roles (Sprint 3) ────────────────────────────────────────────────

export const PLATFORM_ROLES = [
  "platform_super_admin",
  "platform_operations_admin",
  "platform_support_admin",
  "platform_billing_admin",
  "platform_security_auditor",
  // Sprint 4 additions
  "platform_auditor",
  "platform_developer",
  // Sprint 9.7 additions — canonical role names from spec
  "platform_admin",
  "platform_commercial",
  "platform_operations",
  "platform_support",
  "platform_security",
] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export const PLATFORM_ROLE_LABELS: Record<PlatformRole, string> = {
  platform_super_admin: "Super Admin",
  platform_operations_admin: "Operations Admin",
  platform_support_admin: "Support Admin",
  platform_billing_admin: "Billing Admin",
  platform_security_auditor: "Security Auditor",
  platform_auditor: "Auditor",
  platform_developer: "Developer",
  platform_admin: "Admin",
  platform_commercial: "Commercial",
  platform_operations: "Operations",
  platform_support: "Support",
  platform_security: "Security",
};

// ─── Tenant override types (Sprint 3) ────────────────────────────────────────

export const OVERRIDE_TYPES = [
  "extra_seats",
  "workforce_pack",
  "extra_usage",
  "execution_capability",
  "connector_access",
  "feature_denial",
  "trial_extension",
] as const;
export type OverrideType = (typeof OVERRIDE_TYPES)[number];

// ─── Usage warning thresholds (Sprint 3) ─────────────────────────────────────

export const USAGE_WARNING_THRESHOLDS = {
  warn: 80,
  critical: 95,
  hard_limit: 100,
} as const;

// ─── Worker Profile — Sprint 2 Architecture Correction ───────────────────────
//
// A Workforce Role (customer-facing: "AI Specialist") defines who is responsible
// and what expertise applies. A Worker Profile defines which tools and execution
// surfaces a future OpenClaw runtime may use when executing on behalf of that role.
//
// Relationship:
//   Chief of Staff → Workforce Role → Worker Profile → Future OpenClaw Runtime

export const WORKER_PROFILE_STATUSES = [
  "active",
  "beta",
  "coming_soon",
  "deprecated",
] as const;
export type WorkerProfileStatus = (typeof WORKER_PROFILE_STATUSES)[number];

/** Execution surfaces a Worker Profile may be permitted to access */
export const EXECUTION_CHANNELS = [
  "internal_api",
  "document_store",
  "calendar_system",
  "email_system",
  "web_browser",
  "local_files",
  "database_query",
] as const;
export type ExecutionChannel = (typeof EXECUTION_CHANNELS)[number];

/** Logical groupings of tools that may be made available to a Worker Profile */
export const TOOL_CATEGORIES = [
  "document_tools",
  "calendar_tools",
  "communication_tools",
  "data_tools",
  "search_tools",
  "form_tools",
  "reporting_tools",
] as const;
export type ToolCategory = (typeof TOOL_CATEGORIES)[number];

/** External system connector families a Worker Profile may be granted access to */
export const CONNECTOR_CATEGORIES = [
  "ndis_portal",
  "payroll_system",
  "hr_system",
  "finance_system",
  "calendar_system",
  "email_system",
  "document_management",
] as const;
export type ConnectorCategory = (typeof CONNECTOR_CATEGORIES)[number];

/** Risk classification for a Worker Profile — determines oversight and audit requirements */
export const RISK_LEVELS = ["low", "medium", "high", "critical"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

// ─── API error codes ──────────────────────────────────────────────────────────

export const API_ERROR_CODES = [
  "AUTHENTICATION_REQUIRED",
  "EMAIL_VERIFICATION_REQUIRED",
  "USER_SUSPENDED",
  "TENANT_NOT_FOUND",
  "TENANT_INACTIVE",
  "MEMBERSHIP_REQUIRED",
  "MEMBERSHIP_SUSPENDED",
  "PERMISSION_DENIED",
  "RESOURCE_NOT_FOUND",
  "VALIDATION_ERROR",
  "CONFLICT",
  "INVITATION_EXPIRED",
  "INVITATION_INVALID",
  "INVITATION_ALREADY_USED",
  "INVITATION_EMAIL_MISMATCH",
  "DUPLICATE_MEMBERSHIP",
  "OWNER_PROTECTION",
  "EMAIL_DELIVERY_FAILED",
  "RATE_LIMITED",
  "INTERNAL_ERROR",
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];
