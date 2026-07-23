/**
 * @workspace/entitlements — Static entitlement helpers
 *
 * Sprint 0: synchronous helpers that derive entitlements directly from a
 * subscription tier string. No database access required.
 *
 * Sprint 2+: replace calls to these with the async `EntitlementService`
 * backed by the live subscription record.
 */

import type {
  EntitlementContext,
  EntitlementResult,
  FeatureFlag,
  UsageDimension,
} from "./types.js";
import { TIER_FEATURES, TIER_USAGE_LIMITS } from "./types.js";

/**
 * Synchronously check whether a tier includes a feature flag.
 * Use this in Sprint 0/1 before the full EntitlementService is implemented.
 */
export function checkEntitlementFromTier(
  context: Pick<EntitlementContext, "subscriptionTier">,
  feature: FeatureFlag,
): EntitlementResult {
  const features = TIER_FEATURES[context.subscriptionTier] ?? [];
  const granted = features.includes(feature);

  if (granted) {
    return { granted: true, message: "Entitlement granted." };
  }

  // Find the lowest tier that includes this feature
  const tiers = ["starter", "professional", "enterprise"] as const;
  const requiredTier = tiers.find((t) => TIER_FEATURES[t].includes(feature));

  return {
    granted: false,
    denialReason: "feature_not_on_tier",
    message: `Your ${context.subscriptionTier} plan does not include this feature.${
      requiredTier ? ` Upgrade to ${requiredTier} to unlock it.` : ""
    }`,
    requiredTier,
  };
}

/**
 * Synchronously check a usage limit against a current count.
 */
export function checkUsageFromTier(
  context: Pick<EntitlementContext, "subscriptionTier" | "currentUsage">,
  dimension: UsageDimension,
  requested = 1,
): EntitlementResult {
  const limits = TIER_USAGE_LIMITS[context.subscriptionTier] ?? [];
  const limit = limits.find((l) => l.dimension === dimension);
  const current = context.currentUsage?.[dimension] ?? 0;

  if (!limit || limit.hardLimit === null) {
    return { granted: true, message: "No usage limit applies." };
  }

  if (current + requested > limit.hardLimit) {
    return {
      granted: false,
      denialReason: "usage_hard_limit_reached",
      message: `You have reached the ${limit.unit} limit (${limit.hardLimit}) for your ${context.subscriptionTier} plan.`,
    };
  }

  return { granted: true, message: "Within usage limit." };
}

/**
 * Returns all feature flags available on a given tier.
 */
export function featuresForTier(
  tier: EntitlementContext["subscriptionTier"],
): FeatureFlag[] {
  return TIER_FEATURES[tier] ?? [];
}
