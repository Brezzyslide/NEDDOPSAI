/**
 * @workspace/shared
 *
 * Shared constants, types, and utilities used across the NeedsOps AI+ platform.
 * No runtime dependencies — pure TypeScript.
 */

// ─── Platform constants ───────────────────────────────────────────────────────

export const PLATFORM_NAME = "NeedsOps AI+" as const;
export const PLATFORM_VERSION = "0.1.0" as const;

// ─── Subscription tiers ───────────────────────────────────────────────────────

export const SUBSCRIPTION_TIERS = ["starter", "professional", "enterprise"] as const;
export type SubscriptionTier = (typeof SUBSCRIPTION_TIERS)[number];

export const SUBSCRIPTION_TIER_LABELS: Record<SubscriptionTier, string> = {
  starter: "Starter",
  professional: "Professional",
  enterprise: "Enterprise",
};

// ─── Organization status ──────────────────────────────────────────────────────

export const ORG_STATUSES = ["active", "suspended", "trial", "inactive"] as const;
export type OrgStatus = (typeof ORG_STATUSES)[number];

// ─── User roles ───────────────────────────────────────────────────────────────

export const USER_ROLES = ["owner", "admin", "member", "viewer"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  owner: "Owner",
  admin: "Administrator",
  member: "Member",
  viewer: "Viewer",
};

// ─── Workforce pack tiers ─────────────────────────────────────────────────────

export const PACK_TIERS = ["starter", "professional", "enterprise"] as const;
export type PackTier = (typeof PACK_TIERS)[number];

export const PACK_STATUSES = ["available", "coming_soon"] as const;
export type PackStatus = (typeof PACK_STATUSES)[number];

// ─── Industries ───────────────────────────────────────────────────────────────

export const INDUSTRIES = [
  "ndis",
  "healthcare",
  "aged_care",
  "education",
  "legal",
  "finance",
  "general",
] as const;
export type Industry = (typeof INDUSTRIES)[number];

export const INDUSTRY_LABELS: Record<Industry, string> = {
  ndis: "NDIS / Disability Services",
  healthcare: "Healthcare",
  aged_care: "Aged Care",
  education: "Education",
  legal: "Legal",
  finance: "Finance",
  general: "General",
};

// ─── AI Worker roles ──────────────────────────────────────────────────────────

export const AI_WORKER_ROLES = [
  "compliance_officer",
  "operations_manager",
  "executive_assistant",
  "policy_officer",
  "hr_manager",
  "finance_officer",
  "marketing_director",
  "quality_manager",
  "incident_review_officer",
] as const;
export type AIWorkerRole = (typeof AI_WORKER_ROLES)[number];

export const AI_WORKER_ROLE_LABELS: Record<AIWorkerRole, string> = {
  compliance_officer: "Compliance Officer",
  operations_manager: "Operations Manager",
  executive_assistant: "Executive Assistant",
  policy_officer: "Policy Officer",
  hr_manager: "HR Manager",
  finance_officer: "Finance Officer",
  marketing_director: "Marketing Director",
  quality_manager: "Quality Manager",
  incident_review_officer: "Incident Review Officer",
};

// ─── Pagination defaults ──────────────────────────────────────────────────────

export const DEFAULT_PAGE = 1;
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

// ─── Utility types ────────────────────────────────────────────────────────────

export type Paginated<T> = {
  items: T[];
  total: number;
  page: number;
  limit: number;
};

export type ServiceStatus = "operational" | "degraded" | "outage";
