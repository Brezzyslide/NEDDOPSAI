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
