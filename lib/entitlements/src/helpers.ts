/**
 * @workspace/entitlements — Sprint 3 helpers
 *
 * Synchronous helper utilities for entitlement checks.
 * The async EntitlementService (in api-server) handles DB-backed resolution.
 */

import {
  USAGE_WARNING_THRESHOLDS,
  EXECUTION_CAPABILITY_CODES,
  CONNECTOR_CODES,
  WORKFORCE_PACK_FEATURE_CODES,
  PLATFORM_FEATURE_CODES,
  PLAN_CODES,
  type FeatureCode,
  type UsageDimensionCode,
  type PlanCode,
} from "@workspace/shared";

import type { UsageAllowance, EntitlementResult, UsageCheckResult } from "./types.js";

// ─── Plan feature maps ────────────────────────────────────────────────────────
// Static defaults used when the DB plan version hasn't loaded yet.
// The DB-backed plan version is authoritative at runtime.

export const PLAN_INCLUDED_FEATURES: Record<PlanCode, readonly FeatureCode[]> = {
  foundation: [
    "workforce_pack.core",
    "workforce_pack.compliance",
    "platform.mobile_access",
    "platform.audit_history_basic",
  ],
  professional: [
    "workforce_pack.core",
    "workforce_pack.compliance",
    "workforce_pack.operations",
    "platform.mobile_access",
    "platform.audit_history_basic",
    "platform.approval_workflows",
    "execution.scheduled_tasks",
    "connector.microsoft_365",
    "connector.google_workspace",
  ],
  business: [
    "workforce_pack.core",
    "workforce_pack.compliance",
    "workforce_pack.operations",
    "workforce_pack.finance",
    "workforce_pack.hr",
    "workforce_pack.marketing",
    "platform.mobile_access",
    "platform.audit_history_advanced",
    "platform.approval_workflows",
    "platform.api_access",
    "platform.advanced_reporting",
    "execution.scheduled_tasks",
    "execution.browser_session",
    "execution.api_connectors",
    "execution.multi_agent_workflows",
    "connector.microsoft_365",
    "connector.google_workspace",
    "connector.xero",
    "connector.myob",
    "connector.needscare",
    "connector.need2comply",
    "connector.needs2learn",
    "connector.browser_based_system",
  ],
  enterprise: [
    "workforce_pack.core",
    "workforce_pack.compliance",
    "workforce_pack.operations",
    "workforce_pack.finance",
    "workforce_pack.hr",
    "workforce_pack.marketing",
    "platform.mobile_access",
    "platform.audit_history_advanced",
    "platform.approval_workflows",
    "platform.api_access",
    "platform.advanced_reporting",
    "platform.sso",
    "platform.scim",
    "platform.custom_branding",
    "platform.custom_connectors",
    "platform.custom_retention",
    "platform.regional_hosting",
    "platform.sla",
    "platform.dedicated_infrastructure",
    "platform.dedicated_runtime",
    "execution.openclaw_runtime",
    "execution.scheduled_tasks",
    "execution.browser_session",
    "execution.browser_extension",
    "execution.local_device",
    "execution.local_files",
    "execution.local_applications",
    "execution.api_connectors",
    "execution.multi_agent_workflows",
    "connector.microsoft_365",
    "connector.google_workspace",
    "connector.xero",
    "connector.myob",
    "connector.zoho",
    "connector.needscare",
    "connector.need2comply",
    "connector.needs2learn",
    "connector.custom_crm",
    "connector.browser_based_system",
  ],
};

export const PLAN_INCLUDED_SEATS: Record<PlanCode, number | null> = {
  foundation: 3,
  professional: 10,
  business: 30,
  enterprise: null, // configurable
};

export const PLAN_USAGE_LIMITS: Record<PlanCode, Record<UsageDimensionCode, number | null>> = {
  foundation: {
    ai_tasks: 200,
    task_plans: 200,
    specialist_runs: 500,
    browser_actions: 0,
    local_device_actions: 0,
    api_connector_actions: 0,
    scheduled_runs: 0,
    document_pages: 100,
    storage_bytes: 1_000_000_000, // 1 GB
    generated_files: 50,
    input_tokens: 500_000,
    output_tokens: 200_000,
    active_users: 3,
  },
  professional: {
    ai_tasks: 1_000,
    task_plans: 1_000,
    specialist_runs: 5_000,
    browser_actions: 0,
    local_device_actions: 0,
    api_connector_actions: 0,
    scheduled_runs: 100,
    document_pages: 2_000,
    storage_bytes: 10_000_000_000, // 10 GB
    generated_files: 500,
    input_tokens: 2_000_000,
    output_tokens: 1_000_000,
    active_users: 10,
  },
  business: {
    ai_tasks: 5_000,
    task_plans: 5_000,
    specialist_runs: 25_000,
    browser_actions: 1_000,
    local_device_actions: 0,
    api_connector_actions: 5_000,
    scheduled_runs: 1_000,
    document_pages: 10_000,
    storage_bytes: 100_000_000_000, // 100 GB
    generated_files: 5_000,
    input_tokens: 10_000_000,
    output_tokens: 5_000_000,
    active_users: 30,
  },
  enterprise: {
    ai_tasks: null,
    task_plans: null,
    specialist_runs: null,
    browser_actions: null,
    local_device_actions: null,
    api_connector_actions: null,
    scheduled_runs: null,
    document_pages: null,
    storage_bytes: null,
    generated_files: null,
    input_tokens: null,
    output_tokens: null,
    active_users: null,
  },
};

// ─── Usage helpers ────────────────────────────────────────────────────────────

export function computeWarningLevel(
  current: number,
  hardLimit: number | null,
): null | "warn" | "critical" | "at_limit" {
  if (hardLimit === null) return null; // unlimited
  if (hardLimit === 0) return current > 0 ? "at_limit" : null;
  const pct = (current / hardLimit) * 100;
  if (pct >= USAGE_WARNING_THRESHOLDS.hard_limit) return "at_limit";
  if (pct >= USAGE_WARNING_THRESHOLDS.critical) return "critical";
  if (pct >= USAGE_WARNING_THRESHOLDS.warn) return "warn";
  return null;
}

export function computeUsagePct(current: number, hardLimit: number | null): number {
  if (hardLimit === null || hardLimit === 0) return 0;
  return Math.round((current / hardLimit) * 100 * 10) / 10;
}

export function buildUsageCheckResult(
  dimensionCode: UsageDimensionCode,
  currentUsage: number,
  hardLimit: number | null,
  requested = 1,
): UsageCheckResult {
  const wouldExceed = hardLimit !== null && currentUsage + requested > hardLimit;
  const warningLevel = computeWarningLevel(currentUsage + (wouldExceed ? 0 : requested), hardLimit);
  return {
    allowed: !wouldExceed,
    dimensionCode,
    currentUsage,
    hardLimit,
    usagePct: computeUsagePct(currentUsage, hardLimit),
    warningLevel,
    reason: wouldExceed
      ? `Hard limit of ${hardLimit} reached for ${dimensionCode}.`
      : "Within usage limit.",
  };
}

export function buildDeniedResult(reason: string, denialReason?: string): EntitlementResult {
  return {
    allowed: false,
    reason,
    source: "no_subscription",
    evaluatedAt: new Date(),
    effectiveUntil: null,
    denialReason: denialReason as EntitlementResult["denialReason"],
  };
}

export function buildGrantedResult(
  source: EntitlementResult["source"],
  effectiveUntil: Date | null = null,
  configuration?: Record<string, unknown>,
): EntitlementResult {
  return {
    allowed: true,
    reason: "Entitlement granted.",
    source,
    evaluatedAt: new Date(),
    effectiveUntil,
    configuration,
  };
}

/**
 * Static check: does a plan code include a feature code?
 * Use this when the DB plan version is not yet available.
 */
export function planIncludesFeature(planCode: PlanCode, featureCode: FeatureCode): boolean {
  return (PLAN_INCLUDED_FEATURES[planCode] as readonly string[]).includes(featureCode);
}

/**
 * Returns all features included in a given plan code (static defaults).
 */
export function featuresForPlan(planCode: PlanCode): readonly FeatureCode[] {
  return PLAN_INCLUDED_FEATURES[planCode] ?? [];
}

/**
 * Returns the seat limit for a plan code.
 */
export function seatsForPlan(planCode: PlanCode): number | null {
  return PLAN_INCLUDED_SEATS[planCode] ?? null;
}

/**
 * Returns the hard limit for a given usage dimension on a plan code.
 */
export function usageLimitForPlan(
  planCode: PlanCode,
  dimensionCode: UsageDimensionCode,
): number | null {
  return PLAN_USAGE_LIMITS[planCode]?.[dimensionCode] ?? null;
}

// Re-export constants for convenience
export {
  EXECUTION_CAPABILITY_CODES,
  CONNECTOR_CODES,
  WORKFORCE_PACK_FEATURE_CODES,
  PLATFORM_FEATURE_CODES,
  PLAN_CODES,
  USAGE_WARNING_THRESHOLDS,
};
