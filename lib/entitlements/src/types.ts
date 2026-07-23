/**
 * @workspace/entitlements — Subscription, workforce pack, and access entitlement types
 *
 * Entitlements is intentionally separate from @workspace/permissions.
 *
 * @workspace/permissions answers: "Can this user perform this action?" (RBAC)
 * @workspace/entitlements answers: "Does this organisation's subscription include this feature?" (billing gates)
 *
 * An org can have a user with admin RBAC permissions but still be blocked from
 * activating a workforce pack because their subscription tier doesn't include it.
 * Both checks must pass for an action to proceed.
 */

import type { SubscriptionTier } from "@workspace/shared";

// ─── Feature flags ────────────────────────────────────────────────────────────

/**
 * Every gated feature in the platform has a flag here.
 * Sprint 2+: resolve these against the organisation's active subscription.
 */
export type FeatureFlag =
  // Workforce packs
  | "workforce:ndis-compliance"          // NDIS Compliance Officer pack
  | "workforce:ndis-operations"          // NDIS Operations Manager pack
  | "workforce:enterprise"               // Enterprise workforce pack
  | "workforce:healthcare"               // Healthcare pack (coming soon)
  // Connectors / integrations
  | "connector:google-workspace"
  | "connector:microsoft-365"
  | "connector:xero"
  | "connector:zoho"
  | "connector:custom-webhook"
  // Platform features
  | "feature:audit-log-export"
  | "feature:api-access"
  | "feature:sso"
  | "feature:custom-branding"
  | "feature:multi-location"
  | "feature:advanced-reporting"
  | "feature:bulk-user-import"
  // AI capabilities
  | "ai:document-processing"
  | "ai:scheduled-tasks"
  | "ai:human-approval-workflows"
  | "ai:multi-agent-orchestration";

// ─── Tier feature map ─────────────────────────────────────────────────────────

/**
 * Defines which features are available on each subscription tier.
 * Sprint 2+: loaded from a database-backed plan configuration,
 * not hardcoded, so plans can be customised per organisation.
 *
 * This map is the Sprint 0 default baseline.
 */
export const TIER_FEATURES: Record<SubscriptionTier, FeatureFlag[]> = {
  starter: [
    "workforce:ndis-compliance",
    "workforce:ndis-operations",
  ],
  professional: [
    "workforce:ndis-compliance",
    "workforce:ndis-operations",
    "workforce:enterprise",
    "connector:google-workspace",
    "connector:microsoft-365",
    "connector:xero",
    "feature:audit-log-export",
    "feature:api-access",
    "feature:advanced-reporting",
    "ai:document-processing",
    "ai:scheduled-tasks",
    "ai:human-approval-workflows",
  ],
  enterprise: [
    "workforce:ndis-compliance",
    "workforce:ndis-operations",
    "workforce:enterprise",
    "workforce:healthcare",
    "connector:google-workspace",
    "connector:microsoft-365",
    "connector:xero",
    "connector:zoho",
    "connector:custom-webhook",
    "feature:audit-log-export",
    "feature:api-access",
    "feature:sso",
    "feature:custom-branding",
    "feature:multi-location",
    "feature:advanced-reporting",
    "feature:bulk-user-import",
    "ai:document-processing",
    "ai:scheduled-tasks",
    "ai:human-approval-workflows",
    "ai:multi-agent-orchestration",
  ],
};

// ─── Usage limits ─────────────────────────────────────────────────────────────

export type UsageDimension =
  | "users"                    // Total users in the organisation
  | "workforce-packs"          // Active workforce packs
  | "ai-tasks-per-month"       // AI task executions per billing period
  | "document-pages-per-month" // Pages processed through document AI
  | "api-calls-per-month"      // External API calls
  | "connectors";              // Active third-party connectors

export interface UsageLimit {
  dimension: UsageDimension;
  /** Hard limit — request is blocked at this value. null = unlimited */
  hardLimit: number | null;
  /** Soft limit — warning triggered at this value. null = no warning */
  softLimit: number | null;
  /** Unit label for display, e.g. "users", "tasks", "pages" */
  unit: string;
}

/**
 * Default usage limits per subscription tier.
 * Sprint 2+: override per organisation for enterprise custom plans.
 */
export const TIER_USAGE_LIMITS: Record<SubscriptionTier, UsageLimit[]> = {
  starter: [
    { dimension: "users", hardLimit: 10, softLimit: 8, unit: "users" },
    { dimension: "workforce-packs", hardLimit: 2, softLimit: null, unit: "packs" },
    { dimension: "ai-tasks-per-month", hardLimit: 500, softLimit: 400, unit: "tasks" },
    { dimension: "document-pages-per-month", hardLimit: 100, softLimit: 80, unit: "pages" },
    { dimension: "api-calls-per-month", hardLimit: null, softLimit: null, unit: "calls" },
    { dimension: "connectors", hardLimit: 0, softLimit: null, unit: "connectors" },
  ],
  professional: [
    { dimension: "users", hardLimit: 50, softLimit: 40, unit: "users" },
    { dimension: "workforce-packs", hardLimit: 5, softLimit: null, unit: "packs" },
    { dimension: "ai-tasks-per-month", hardLimit: 5000, softLimit: 4000, unit: "tasks" },
    { dimension: "document-pages-per-month", hardLimit: 2000, softLimit: 1600, unit: "pages" },
    { dimension: "api-calls-per-month", hardLimit: 10000, softLimit: 8000, unit: "calls" },
    { dimension: "connectors", hardLimit: 3, softLimit: null, unit: "connectors" },
  ],
  enterprise: [
    { dimension: "users", hardLimit: null, softLimit: null, unit: "users" },
    { dimension: "workforce-packs", hardLimit: null, softLimit: null, unit: "packs" },
    { dimension: "ai-tasks-per-month", hardLimit: null, softLimit: null, unit: "tasks" },
    { dimension: "document-pages-per-month", hardLimit: null, softLimit: null, unit: "pages" },
    { dimension: "api-calls-per-month", hardLimit: null, softLimit: null, unit: "calls" },
    { dimension: "connectors", hardLimit: null, softLimit: null, unit: "connectors" },
  ],
};

// ─── Entitlement check ────────────────────────────────────────────────────────

export interface EntitlementContext {
  organizationId: string;
  subscriptionTier: SubscriptionTier;
  /** The organisation's current usage counters */
  currentUsage?: Partial<Record<UsageDimension, number>>;
}

export type EntitlementDenialReason =
  | "feature_not_on_tier"
  | "usage_hard_limit_reached"
  | "subscription_inactive"
  | "workforce_pack_not_assigned";

export interface EntitlementResult {
  /** True if the entitlement is granted */
  granted: boolean;
  /** Set when granted=false */
  denialReason?: EntitlementDenialReason;
  /** Human-readable message for display */
  message: string;
  /** The tier required to unlock this feature (for upgrade prompts) */
  requiredTier?: SubscriptionTier;
}

// ─── Entitlement service interface ───────────────────────────────────────────

/**
 * Sprint 2+: implement this against the live subscription DB.
 * Sprint 0: use `checkEntitlementFromTier` helper for static tier checks.
 */
export interface EntitlementService {
  /** Check whether an organisation has a specific feature flag enabled */
  checkFeature(
    context: EntitlementContext,
    feature: FeatureFlag,
  ): Promise<EntitlementResult>;

  /** Check whether an organisation is within a usage dimension's limit */
  checkUsage(
    context: EntitlementContext,
    dimension: UsageDimension,
    requested?: number,
  ): Promise<EntitlementResult>;

  /** Get a summary of all current usage against limits */
  getUsageSummary(
    context: EntitlementContext,
  ): Promise<Array<UsageLimit & { current: number }>>;
}
