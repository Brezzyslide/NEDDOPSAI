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
] as const;
export type AuditEventType = (typeof AUDIT_EVENTS)[number];

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
