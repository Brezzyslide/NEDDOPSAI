/**
 * Entitlement Service — Sprint 3
 *
 * Resolves whether an organisation's subscription grants access to a feature,
 * workforce pack, execution channel, or connector.
 *
 * Resolution order:
 *  1. Subscription state — inactive/cancelled blocks restricted capabilities
 *  2. Plan version features (DB-backed plan_features table)
 *  3. Included workforce packs (plan_workforce_packs)
 *  4. Add-ons (tenant_addons)
 *  5. Tenant overrides (may grant OR explicitly deny)
 *  6. Trials (grant temporary capabilities)
 *  7. Explicit denial (highest precedence — overrides everything)
 *  8. Final decision
 *
 * Do NOT use this service for RBAC (user permissions).
 * Do NOT log every entitlement check — only log grants/denials at the audit level.
 */

import { db } from "@workspace/db";
import {
  tenantSubscriptionsTable,
  planVersionsTable,
  planFeaturesTable,
  planWorkforcePacksTable,
  tenantEntitlementsTable,
  tenantWorkforcePacksTable,
  tenantOverridesTable,
  planUsageAllowancesTable,
  tenantUsageAllowancesTable,
  usagePeriodSummariesTable,
  membershipsTable,
} from "@workspace/db";
import { eq, and, or, isNull, gte, lte, gt } from "drizzle-orm";
import type {
  FeatureCode,
  UsageDimensionCode,
  WorkforcePackCode,
} from "@workspace/shared";
import {
  PLAN_INCLUDED_FEATURES,
  PLAN_INCLUDED_SEATS,
  PLAN_USAGE_LIMITS,
  computeWarningLevel,
  computeUsagePct,
  buildDeniedResult,
  buildGrantedResult,
  buildUsageCheckResult,
} from "@workspace/entitlements";
import type {
  EntitlementResult,
  UsageAllowance,
  SeatInfo,
  UsageCheckResult,
} from "@workspace/entitlements";

// ─── Subscription loading ─────────────────────────────────────────────────────

async function loadSubscription(organizationId: string) {
  const [sub] = await db
    .select()
    .from(tenantSubscriptionsTable)
    .where(eq(tenantSubscriptionsTable.organizationId, organizationId))
    .limit(1);
  return sub ?? null;
}

function isSubscriptionActive(status: string): boolean {
  return status === "active" || status === "trial";
}

// ─── tenantCanUseFeature ──────────────────────────────────────────────────────

export async function tenantCanUseFeature(
  organizationId: string,
  featureCode: FeatureCode,
): Promise<EntitlementResult> {
  const now = new Date();

  // 1. Load subscription
  const sub = await loadSubscription(organizationId);
  if (!sub) {
    return buildDeniedResult("No active subscription found.", "no_subscription");
  }

  // 2. Check subscription state
  const isActive = isSubscriptionActive(sub.status);
  if (!isActive) {
    return buildDeniedResult(
      `Subscription is ${sub.status}. Please contact support.`,
      "subscription_inactive",
    );
  }

  // 3. Check for explicit denial override (highest precedence)
  const [explicitDenial] = await db
    .select()
    .from(tenantEntitlementsTable)
    .where(
      and(
        eq(tenantEntitlementsTable.organizationId, organizationId),
        eq(tenantEntitlementsTable.featureCode, featureCode),
        eq(tenantEntitlementsTable.state, "denied"),
        or(
          isNull(tenantEntitlementsTable.expiresAt),
          gt(tenantEntitlementsTable.expiresAt, now),
        ),
      ),
    )
    .limit(1);

  if (explicitDenial) {
    return buildDeniedResult(
      explicitDenial.reason ?? "This feature has been explicitly denied by platform administration.",
      "explicit_denial",
    );
  }

  // 4. Check for explicit override grant
  const [overrideGrant] = await db
    .select()
    .from(tenantEntitlementsTable)
    .where(
      and(
        eq(tenantEntitlementsTable.organizationId, organizationId),
        eq(tenantEntitlementsTable.featureCode, featureCode),
        eq(tenantEntitlementsTable.state, "granted"),
        or(
          isNull(tenantEntitlementsTable.expiresAt),
          gt(tenantEntitlementsTable.expiresAt, now),
        ),
      ),
    )
    .limit(1);

  if (overrideGrant) {
    return buildGrantedResult("override", overrideGrant.expiresAt);
  }

  // 5. Check plan version features
  const [planFeature] = await db
    .select()
    .from(planFeaturesTable)
    .where(
      and(
        eq(planFeaturesTable.planVersionId, sub.planVersionId),
        eq(planFeaturesTable.featureCode, featureCode),
      ),
    )
    .limit(1);

  if (planFeature) {
    return buildGrantedResult("subscription");
  }

  // 6. Trial: if on trial, check if the trial plan grants it
  if (sub.status === "trial" && sub.trialEndAt && sub.trialEndAt > now) {
    // Trials use the Foundation plan feature set + any trial-specific overrides
    // Foundation features are already checked above via plan_features.
    // Trials don't grant extra features beyond the plan unless there's an override.
  }

  return buildDeniedResult(
    `Your current plan does not include ${featureCode}.`,
    "feature_not_in_plan",
  );
}

// ─── tenantHasWorkforcePack ───────────────────────────────────────────────────

export async function tenantHasWorkforcePack(
  organizationId: string,
  packCode: WorkforcePackCode,
): Promise<EntitlementResult> {
  const now = new Date();

  const sub = await loadSubscription(organizationId);
  if (!sub) return buildDeniedResult("No active subscription found.", "no_subscription");

  const isActive = isSubscriptionActive(sub.status);
  if (!isActive) {
    return buildDeniedResult(`Subscription is ${sub.status}.`, "subscription_inactive");
  }

  // Check for explicit denial override
  const featureCode = `workforce_pack.${packCode}` as FeatureCode;
  const [explicitDenial] = await db
    .select()
    .from(tenantEntitlementsTable)
    .where(
      and(
        eq(tenantEntitlementsTable.organizationId, organizationId),
        eq(tenantEntitlementsTable.featureCode, featureCode),
        eq(tenantEntitlementsTable.state, "denied"),
        or(isNull(tenantEntitlementsTable.expiresAt), gt(tenantEntitlementsTable.expiresAt, now)),
      ),
    )
    .limit(1);

  if (explicitDenial) {
    return buildDeniedResult(
      explicitDenial.reason ?? "Workforce pack access has been denied.",
      "explicit_denial",
    );
  }

  // Check active tenant workforce pack record (subscription, addon, override, trial)
  const [activePack] = await db
    .select()
    .from(tenantWorkforcePacksTable)
    .where(
      and(
        eq(tenantWorkforcePacksTable.organizationId, organizationId),
        eq(tenantWorkforcePacksTable.packCode, packCode),
        isNull(tenantWorkforcePacksTable.revokedAt),
        or(
          isNull(tenantWorkforcePacksTable.expiresAt),
          gt(tenantWorkforcePacksTable.expiresAt, now),
        ),
      ),
    )
    .limit(1);

  if (activePack) {
    return buildGrantedResult(activePack.source as EntitlementResult["source"], activePack.expiresAt);
  }

  // Check plan version workforce packs
  const [planPack] = await db
    .select()
    .from(planWorkforcePacksTable)
    .where(
      and(
        eq(planWorkforcePacksTable.planVersionId, sub.planVersionId),
        eq(planWorkforcePacksTable.packCode, packCode),
        eq(planWorkforcePacksTable.isIncluded, true),
      ),
    )
    .limit(1);

  if (planPack) return buildGrantedResult("subscription");

  return buildDeniedResult(
    `The ${packCode} workforce pack is not included in your plan.`,
    "workforce_pack_not_included",
  );
}

// ─── tenantCanUseSpecialist ───────────────────────────────────────────────────

export async function tenantCanUseSpecialist(
  organizationId: string,
  specialistCode: string,
  packCode: WorkforcePackCode,
): Promise<EntitlementResult> {
  // A specialist is accessible if its pack is accessible
  const packResult = await tenantHasWorkforcePack(organizationId, packCode);
  if (!packResult.allowed) {
    return {
      ...packResult,
      reason: `Specialist '${specialistCode}' requires the ${packCode} workforce pack, which is not included in your plan.`,
    };
  }
  return buildGrantedResult(packResult.source, packResult.effectiveUntil);
}

// ─── tenantCanUseExecutionChannel ────────────────────────────────────────────

export async function tenantCanUseExecutionChannel(
  organizationId: string,
  channel: string,
): Promise<EntitlementResult> {
  // Map execution channels to feature codes
  const channelFeatureMap: Record<string, FeatureCode> = {
    internal_api: "platform.api_access",
    document_store: "platform.api_access",
    calendar_system: "execution.api_connectors",
    email_system: "execution.api_connectors",
    web_browser: "execution.browser_session",
    local_files: "execution.local_files",
    database_query: "platform.api_access",
  };

  const featureCode = channelFeatureMap[channel];
  if (!featureCode) {
    return buildDeniedResult(`Unknown execution channel: ${channel}.`);
  }

  // internal_api and document_store are always available to active subscribers
  if (channel === "internal_api" || channel === "document_store" || channel === "database_query") {
    const sub = await loadSubscription(organizationId);
    if (!sub || !isSubscriptionActive(sub.status)) {
      return buildDeniedResult("No active subscription.", "subscription_inactive");
    }
    return buildGrantedResult("subscription");
  }

  return tenantCanUseFeature(organizationId, featureCode);
}

// ─── tenantCanUseConnector ────────────────────────────────────────────────────

export async function tenantCanUseConnector(
  organizationId: string,
  connectorCode: string,
): Promise<EntitlementResult> {
  const featureCode = `connector.${connectorCode}` as FeatureCode;
  return tenantCanUseFeature(organizationId, featureCode);
}

// ─── tenantCanUsePlatformCapability ──────────────────────────────────────────

export async function tenantCanUsePlatformCapability(
  organizationId: string,
  capability: string,
): Promise<EntitlementResult> {
  const featureCode = `platform.${capability}` as FeatureCode;
  return tenantCanUseFeature(organizationId, featureCode);
}

// ─── getUsageAllowance ────────────────────────────────────────────────────────

export async function getUsageAllowance(
  organizationId: string,
  dimensionCode: UsageDimensionCode,
): Promise<UsageAllowance> {
  const now = new Date();
  const sub = await loadSubscription(organizationId);

  let hardLimit: number | null = null;
  let softLimitPct = 80.0;
  let periodStart: Date | null = sub?.currentPeriodStart ?? null;
  let periodEnd: Date | null = sub?.currentPeriodEnd ?? null;

  // 1. Try tenant override first
  const [tenantOverride] = await db
    .select()
    .from(tenantUsageAllowancesTable)
    .where(
      and(
        eq(tenantUsageAllowancesTable.organizationId, organizationId),
        eq(tenantUsageAllowancesTable.dimensionCode, dimensionCode),
        or(
          isNull(tenantUsageAllowancesTable.expiresAt),
          gt(tenantUsageAllowancesTable.expiresAt, now),
        ),
      ),
    )
    .limit(1);

  if (tenantOverride) {
    hardLimit = tenantOverride.hardLimit;
    softLimitPct = tenantOverride.softLimitPct ?? 80.0;
  } else if (sub) {
    // 2. Plan version allowance
    const [planAllowance] = await db
      .select()
      .from(planUsageAllowancesTable)
      .where(
        and(
          eq(planUsageAllowancesTable.planVersionId, sub.planVersionId),
          eq(planUsageAllowancesTable.dimensionCode, dimensionCode),
        ),
      )
      .limit(1);

    if (planAllowance) {
      hardLimit = planAllowance.hardLimit;
      softLimitPct = planAllowance.softLimitPct ?? 80.0;
    }
  }

  // 3. Get current usage from period summary
  let currentUsage = 0;
  if (periodStart) {
    const [summary] = await db
      .select()
      .from(usagePeriodSummariesTable)
      .where(
        and(
          eq(usagePeriodSummariesTable.organizationId, organizationId),
          eq(usagePeriodSummariesTable.dimensionCode, dimensionCode),
          eq(usagePeriodSummariesTable.periodStart, periodStart),
        ),
      )
      .limit(1);
    currentUsage = summary?.totalQuantity ?? 0;
  }

  const usagePct = computeUsagePct(currentUsage, hardLimit);
  const warningLevel = computeWarningLevel(currentUsage, hardLimit);

  return {
    dimensionCode,
    hardLimit,
    softLimitPct,
    currentUsage,
    usagePct,
    warningLevel,
    periodStart,
    periodEnd,
  };
}

// ─── getCurrentUsage ──────────────────────────────────────────────────────────

export async function getCurrentUsage(
  organizationId: string,
  dimensionCode: UsageDimensionCode,
): Promise<number> {
  const sub = await loadSubscription(organizationId);
  if (!sub?.currentPeriodStart) return 0;

  const [summary] = await db
    .select()
    .from(usagePeriodSummariesTable)
    .where(
      and(
        eq(usagePeriodSummariesTable.organizationId, organizationId),
        eq(usagePeriodSummariesTable.dimensionCode, dimensionCode),
        eq(usagePeriodSummariesTable.periodStart, sub.currentPeriodStart),
      ),
    )
    .limit(1);

  return summary?.totalQuantity ?? 0;
}

// ─── checkUsage ──────────────────────────────────────────────────────────────

export async function checkUsage(
  organizationId: string,
  dimensionCode: UsageDimensionCode,
  requested = 1,
): Promise<UsageCheckResult> {
  const allowance = await getUsageAllowance(organizationId, dimensionCode);
  return buildUsageCheckResult(
    dimensionCode,
    allowance.currentUsage,
    allowance.hardLimit,
    requested,
  );
}

// ─── getUsagePercentage ───────────────────────────────────────────────────────

export async function getUsagePercentage(
  organizationId: string,
  dimensionCode: UsageDimensionCode,
): Promise<number> {
  const allowance = await getUsageAllowance(organizationId, dimensionCode);
  return allowance.usagePct;
}

// ─── getUsageWarnings ────────────────────────────────────────────────────────

export async function getUsageWarnings(
  organizationId: string,
): Promise<UsageAllowance[]> {
  const { USAGE_DIMENSION_CODES } = await import("@workspace/shared");
  const allowances = await Promise.all(
    USAGE_DIMENSION_CODES.map(dim => getUsageAllowance(organizationId, dim as UsageDimensionCode)),
  );
  return allowances.filter(a => a.warningLevel !== null);
}

// ─── getSeatAllowance ────────────────────────────────────────────────────────

export async function getSeatAllowance(organizationId: string): Promise<SeatInfo> {
  const now = new Date();
  const sub = await loadSubscription(organizationId);

  // Plan version seat limit
  let includedSeats: number | null = 3; // Foundation default
  if (sub) {
    const [planVersion] = await db
      .select()
      .from(planVersionsTable)
      .where(eq(planVersionsTable.id, sub.planVersionId))
      .limit(1);
    includedSeats = planVersion?.includedSeats ?? includedSeats;
    if (planVersion?.maxSeats === null) includedSeats = null; // Enterprise: configurable
  }

  // Check for seat overrides
  const [seatOverride] = await db
    .select()
    .from(tenantOverridesTable)
    .where(
      and(
        eq(tenantOverridesTable.organizationId, organizationId),
        eq(tenantOverridesTable.overrideType, "extra_seats"),
        eq(tenantOverridesTable.isActive, true),
        lte(tenantOverridesTable.effectiveFrom, now),
        or(
          isNull(tenantOverridesTable.effectiveTo),
          gte(tenantOverridesTable.effectiveTo, now),
        ),
      ),
    )
    .limit(1);

  let seatOverrideCount: number | null = null;
  let effectiveLimit = includedSeats;
  if (seatOverride?.value) {
    const v = seatOverride.value as Record<string, unknown>;
    seatOverrideCount = typeof v.seats === "number" ? v.seats : null;
    if (seatOverrideCount !== null && effectiveLimit !== null) {
      effectiveLimit = effectiveLimit + seatOverrideCount;
    }
  }

  // Count active memberships (invited/suspended/revoked excluded)
  const members = await db
    .select()
    .from(membershipsTable)
    .where(
      and(
        eq(membershipsTable.organizationId, organizationId),
        eq(membershipsTable.status, "active"),
      ),
    );

  const seatsUsed = members.length;
  const seatsRemaining = effectiveLimit !== null ? Math.max(0, effectiveLimit - seatsUsed) : null;
  const canInvite = effectiveLimit === null || seatsUsed < effectiveLimit;
  const warningLevel = computeWarningLevel(seatsUsed, effectiveLimit);

  return {
    includedSeats,
    effectiveLimit,
    seatsUsed,
    seatsRemaining,
    canInvite,
    warningLevel,
    seatOverride: seatOverrideCount,
  };
}

export async function getSeatsUsed(organizationId: string): Promise<number> {
  const info = await getSeatAllowance(organizationId);
  return info.seatsUsed;
}

export async function getSeatsRemaining(organizationId: string): Promise<number | null> {
  const info = await getSeatAllowance(organizationId);
  return info.seatsRemaining;
}

export async function canInviteMember(organizationId: string): Promise<boolean> {
  const info = await getSeatAllowance(organizationId);
  return info.canInvite;
}
