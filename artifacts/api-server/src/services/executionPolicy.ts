/**
 * Execution Policy — Sprint 8
 *
 * Provider-independent gate that determines whether a tenant may submit
 * an execution request.
 *
 * The authoritative commercial sources are NeedsOps-internal tables only:
 *   - tenant_subscriptions       (operational state)
 *   - tenant_entitlements        (feature grants and explicit denials)
 *   - plan_features              (included feature codes per plan version)
 *   - tenant_workforce_packs     (pack access)
 *   - plan_workforce_packs       (packs included in plan version)
 *   - tenant_usage_allowances    (per-tenant limits)
 *   - usage_period_summaries     (current period consumption)
 *
 * Stripe is a billing provider that later updates NeedsOps commercial state
 * via verified webhooks. It is NOT called here — not referenced, not imported,
 * not checked. Execution must work for subscriptions created through any
 * acquisition method:
 *   manual platform assignment | free trial | invoice agreement |
 *   enterprise contract | pilot agreement | future Stripe billing
 *
 * Gate order (mirrors spec §1–11, steps 1–3 and 10–11 handled by middleware):
 *   Step 4  — operational tenant subscription state
 *   Step 5  — required feature entitlement (execution.professional_work; legacy: execution.openclaw_runtime)
 *   Step 6  — required Workforce Pack entitlement
 *   Step 7  — required execution-channel entitlement
 *   Step 8  — available usage allowance (ai_tasks dimension)
 */

import {
  tenantCanUseFeature,
  tenantHasWorkforcePack,
  tenantCanUseExecutionChannel,
  checkUsage,
} from "./entitlementService.js";
import type { WorkforcePackCode } from "@workspace/shared";

// ─── Shared interface (from spec) ─────────────────────────────────────────────

/**
 * Provider-independent subscription state decision.
 *
 * `operational` is true for any active subscription regardless of how it was
 * acquired (manual, trial, invoice, enterprise contract, or Stripe-billed).
 * The `source` field records which subscription state permitted access.
 */
export interface SubscriptionAccessDecision {
  /** Whether the tenant's subscription is in an operational state. */
  operational: boolean;
  /** Subscription status string that was checked (e.g. "active", "trial"). */
  status: string;
  /**
   * Origin of the access grant or denial.
   * Possible values: "active_subscription" | "trial" | "override" |
   *                  "no_subscription" | "subscription_inactive" |
   *                  "feature_denied" | "pack_denied" | "channel_denied" |
   *                  "usage_exhausted"
   */
  source: string;
  /** Human-readable reason — surfaced to the requester on denial. */
  reason: string;
}

// ─── Execution access result ──────────────────────────────────────────────────

export interface ExecutionAccessResult {
  allowed: boolean;
  decision: SubscriptionAccessDecision;
  /** Step that caused the denial, null on allow. */
  deniedAt:
    | "subscription_state"
    | "runtime_entitlement"
    | "workforce_pack"
    | "execution_channel"
    | "usage_allowance"
    | null;
}

// ─── Specialist → pack mapping ────────────────────────────────────────────────

/**
 * Maps workforce role codes to the Workforce Pack they belong to.
 * Used for Step 6 — workforce pack entitlement check.
 *
 * Roles not listed here are assumed to be core specialists (no extra pack
 * required beyond an active subscription with the core pack).
 */
const SPECIALIST_PACK_MAP: Record<string, WorkforcePackCode> = {
  // Core specialists — covered by the core pack
  chief_of_staff:       "core",
  operations_manager:   "core",
  executive_assistant:  "core",
  // Compliance pack
  compliance_manager:   "compliance",
  quality_auditor:      "compliance",
  // Finance pack
  finance_manager:      "finance",
  bookkeeper:           "finance",
  // HR pack
  hr_manager:           "hr",
  recruitment_officer:  "hr",
  // Marketing pack
  marketing_manager:    "marketing",
  content_creator:      "marketing",
  // Operations pack (extended)
  process_analyst:      "operations",
  workflow_coordinator: "operations",
};

function resolvePackForRole(workforceRole: string): WorkforcePackCode {
  return SPECIALIST_PACK_MAP[workforceRole] ?? "core";
}

// ─── Execution channel → ExecutionCapabilityCode mapping ────────────────────

/**
 * Maps the execution channel strings in an ExecutionPackage to the channel
 * identifiers that tenantCanUseExecutionChannel() understands.
 */
const CHANNEL_MAP: Record<string, string> = {
  api:             "internal_api",
  internal:        "internal_api",
  browser:         "web_browser",
  web_browser:     "web_browser",
  local_files:     "local_files",
  calendar_system: "calendar_system",
  email_system:    "email_system",
  database_query:  "database_query",
};

// ─── Core gate ────────────────────────────────────────────────────────────────

/**
 * checkExecutionAccess — provider-independent execution gate.
 *
 * @param organizationId   NeedsOps organisation UUID (tenant boundary key)
 * @param workforceRole    Primary specialist role code (for pack check)
 * @param requestedChannels Channels the execution package requests
 * @returns ExecutionAccessResult — allowed or denied with reason
 */
export async function checkExecutionAccess(
  organizationId: string,
  workforceRole: string,
  requestedChannels: string[],
): Promise<ExecutionAccessResult> {

  // ── Step 4: Operational subscription state ──────────────────────────────────
  // We probe this by checking the runtime feature — entitlementService already
  // verifies subscription state before feature resolution. If the subscription
  // is inactive, the first feature check will deny with subscription_inactive.
  //
  // We also run a direct feature check so the denial source is unmistakable.
  //
  // ── Step 5: Cloud professional-work entitlement ──────────────────────────────
  // Check execution.professional_work first (Cloud UEE gate introduced in Sprint 29N.10).
  // Fall back to execution.openclaw_runtime for backwards compatibility with orgs
  // that already have that entitlement granted manually. Subscription failures are
  // authoritative and are NOT overridden by the fallback. Explicit denials are also
  // not overridden — they mean the platform has actively blocked access.
  let runtimeCheck = await tenantCanUseFeature(
    organizationId,
    "execution.professional_work",
  );

  if (
    !runtimeCheck.allowed &&
    runtimeCheck.source !== "no_subscription" &&
    runtimeCheck.source !== "subscription_inactive" &&
    runtimeCheck.source !== "explicit_denial"
  ) {
    const legacyCheck = await tenantCanUseFeature(
      organizationId,
      "execution.openclaw_runtime",
    );
    if (legacyCheck.allowed) {
      runtimeCheck = legacyCheck;
    }
  }

  if (!runtimeCheck.allowed) {
    const isSubIssue =
      runtimeCheck.source === "no_subscription" ||
      runtimeCheck.source === "subscription_inactive";

    if (isSubIssue) {
      return {
        allowed: false,
        decision: {
          operational: false,
          status: runtimeCheck.source === "no_subscription" ? "none" : "inactive",
          source: runtimeCheck.source ?? "subscription_inactive",
          reason: runtimeCheck.reason,
        },
        deniedAt: "subscription_state",
      };
    }

    // ── Step 5: Runtime feature entitlement ──────────────────────────────────
    return {
      allowed: false,
      decision: {
        operational: true,        // subscription is active, feature is just missing
        status: "active",
        source: runtimeCheck.source ?? "feature_denied",
        reason: runtimeCheck.reason,
      },
      deniedAt: "runtime_entitlement",
    };
  }

  // ── Step 6: Workforce Pack entitlement ────────────────────────────────────
  const requiredPack = resolvePackForRole(workforceRole);
  const packCheck = await tenantHasWorkforcePack(organizationId, requiredPack);

  if (!packCheck.allowed) {
    return {
      allowed: false,
      decision: {
        operational: true,
        status: "active",
        source: packCheck.source ?? "pack_denied",
        reason: packCheck.reason,
      },
      deniedAt: "workforce_pack",
    };
  }

  // ── Step 7: Execution-channel entitlement ─────────────────────────────────
  // Check all requested channels. Deny on the first channel that is not granted.
  // "internal" and "api" channels are always available to active subscribers.
  const nonCoreChannels = requestedChannels
    .map(ch => CHANNEL_MAP[ch] ?? ch)
    .filter(ch => ch !== "internal_api"); // internal_api is covered by subscription check

  for (const channel of nonCoreChannels) {
    const channelCheck = await tenantCanUseExecutionChannel(organizationId, channel);
    if (!channelCheck.allowed) {
      return {
        allowed: false,
        decision: {
          operational: true,
          status: "active",
          source: channelCheck.source ?? "channel_denied",
          reason: channelCheck.reason,
        },
        deniedAt: "execution_channel",
      };
    }
  }

  // ── Step 8: Usage allowance ───────────────────────────────────────────────
  const usageCheck = await checkUsage(organizationId, "ai_tasks", 1);

  if (!usageCheck.allowed) {
    return {
      allowed: false,
      decision: {
        operational: true,
        status: "active",
        source: "usage_exhausted",
        reason: usageCheck.reason ?? "AI task usage allowance exhausted for this billing period.",
      },
      deniedAt: "usage_allowance",
    };
  }

  // ── All steps passed ──────────────────────────────────────────────────────
  return {
    allowed: true,
    decision: {
      operational: true,
      status: "active",
      source: runtimeCheck.source ?? "active_subscription",
      reason: "Execution access granted.",
    },
    deniedAt: null,
  };
}
