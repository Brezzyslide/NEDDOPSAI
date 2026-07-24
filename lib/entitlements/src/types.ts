/**
 * @workspace/entitlements — Sprint 3
 *
 * Entitlements is intentionally separate from @workspace/permissions.
 *
 * @workspace/permissions answers: "Can this user perform this action?" (RBAC)
 * @workspace/entitlements answers: "Does this organisation's subscription include this feature?" (billing gates)
 *
 * An org can have a user with admin RBAC but still be blocked from activating a
 * workforce pack because their subscription doesn't include it. Both checks must pass.
 *
 * Resolution order:
 *   1. Subscription state (inactive → deny everything restricted)
 *   2. Plan version features
 *   3. Included workforce packs
 *   4. Add-ons
 *   5. Tenant overrides (may grant or explicitly deny)
 *   6. Trials
 *   7. Explicit denial (highest precedence — overrides everything)
 *   8. Final decision
 */

import type {
  FeatureCode,
  UsageDimensionCode,
  WorkforcePackCode,
  ExecutionChannel,
  ConnectorCode,
} from "@workspace/shared";

// ─── Entitlement result ───────────────────────────────────────────────────────

export type EntitlementSource =
  | "subscription"
  | "addon"
  | "override"
  | "trial"
  | "explicit_denial"
  | "no_subscription";

export type EntitlementDenialReason =
  | "no_subscription"
  | "subscription_inactive"
  | "subscription_expired"
  | "trial_expired"
  | "feature_not_in_plan"
  | "workforce_pack_not_included"
  | "usage_hard_limit_reached"
  | "explicit_denial"
  | "override_expired";

export interface EntitlementResult {
  /** True if the feature/capability is granted */
  allowed: boolean;
  /** Human-readable reason for the decision */
  reason: string;
  /** How this entitlement was resolved */
  source: EntitlementSource;
  /** When this entitlement was evaluated */
  evaluatedAt: Date;
  /** When this entitlement expires (null = indefinite / subscription-based) */
  effectiveUntil: Date | null;
  /** Structured denial reason for UI logic */
  denialReason?: EntitlementDenialReason;
  /** Configuration data relevant to this entitlement (e.g. seat count) */
  configuration?: Record<string, unknown>;
}

// ─── Usage result ─────────────────────────────────────────────────────────────

export interface UsageAllowance {
  dimensionCode: UsageDimensionCode;
  /** null = unlimited */
  hardLimit: number | null;
  softLimitPct: number; // e.g. 80.0
  currentUsage: number;
  /** Derived: hardLimit !== null ? currentUsage / hardLimit * 100 : 0 */
  usagePct: number;
  /** Warning level: null | "warn" | "critical" | "at_limit" */
  warningLevel: null | "warn" | "critical" | "at_limit";
  periodStart: Date | null;
  periodEnd: Date | null;
}

export interface UsageCheckResult {
  allowed: boolean;
  dimensionCode: UsageDimensionCode;
  currentUsage: number;
  hardLimit: number | null;
  usagePct: number;
  warningLevel: null | "warn" | "critical" | "at_limit";
  reason: string;
}

// ─── Seat result ──────────────────────────────────────────────────────────────

export interface SeatInfo {
  /** From plan version (null = configurable enterprise) */
  includedSeats: number | null;
  /** Effective limit after overrides and addons */
  effectiveLimit: number | null;
  /** Active memberships (invited/suspended/revoked are excluded) */
  seatsUsed: number;
  seatsRemaining: number | null;
  canInvite: boolean;
  /** Set when seatsUsed >= 80% of effectiveLimit */
  warningLevel: null | "warn" | "critical" | "at_limit";
  seatOverride: number | null;
}

// ─── Context ──────────────────────────────────────────────────────────────────

export interface EntitlementContext {
  organizationId: string;
  /** Loaded from tenant_subscriptions */
  subscriptionStatus: string;
  /** Active plan version ID */
  planVersionId: string;
  /** Plan code for UI labelling */
  planCode: string;
  /** Whether this org is currently on a trial */
  isTrial: boolean;
  trialEndAt: Date | null;
}

// ─── Legacy Sprint 0 types (kept for backwards compatibility) ─────────────────
// These are deprecated. Use FeatureCode and the Sprint 3 service instead.

/** @deprecated Use FeatureCode from @workspace/shared */
export type FeatureFlag = string;

/** @deprecated Use UsageAllowance */
export type UsageDimension = string;

/** @deprecated Use EntitlementResult */
export interface EntitlementServiceLegacy {
  checkFeature(
    context: { organizationId: string; subscriptionTier: string },
    feature: FeatureFlag,
  ): Promise<{ granted: boolean; message: string }>;
}

export type { FeatureCode, UsageDimensionCode, WorkforcePackCode, ExecutionChannel, ConnectorCode };
