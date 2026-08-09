/**
 * Sprint 8 — Execution Policy Tests
 *
 * Proves that the execution gate is provider-independent — no Stripe,
 * no billing provider logic — only NeedsOps internal subscription and
 * entitlement tables.
 *
 * Classification:
 *   MOCKED  — uses vi.mock to isolate the policy logic from the DB
 *   STATIC  — file-level assertions (no DB, no network)
 *
 * Gate steps tested (per spec):
 *   Step 4 — operational tenant subscription state
 *   Step 5 — required feature entitlement (execution.openclaw_runtime)
 *   Step 6 — required Workforce Pack entitlement
 *   Step 7 — required execution-channel entitlement
 *   Step 8 — available usage allowance
 *
 * Provider-independence proof:
 *   - Stripe is not imported by the execution service
 *   - Stripe is not imported by the execution policy
 *   - OpenClaw adapter does not reference any billing provider
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

// ─── Mock the entitlement service ─────────────────────────────────────────────
// The policy layer delegates to entitlementService functions.
// We mock them here to isolate policy logic from DB state.

vi.mock("../services/entitlementService.js", () => ({
  tenantCanUseFeature: vi.fn(),
  tenantHasWorkforcePack: vi.fn(),
  tenantCanUseExecutionChannel: vi.fn(),
  checkUsage: vi.fn(),
}));

import * as entitlementService from "../services/entitlementService.js";
import { checkExecutionAccess } from "../services/executionPolicy.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const GRANTED = (source = "subscription") => ({
  allowed: true,
  source,
  reason: "Granted.",
  effectiveUntil: null,
});

const DENIED = (source: string, reason: string) => ({
  allowed: false,
  source,
  reason,
  effectiveUntil: null,
});

const USAGE_ALLOWED = { allowed: true, reason: "Within allowance.", current: 0, limit: 100 };
const USAGE_EXHAUSTED = { allowed: false, reason: "Usage allowance exhausted.", current: 100, limit: 100 };

const ORG_ID = "org-test-uuid-1234";
const ROLE = "operations_manager";
const CHANNELS = ["api", "internal"];

function setupFullGrant(runtimeSource = "subscription") {
  vi.mocked(entitlementService.tenantCanUseFeature).mockResolvedValue(GRANTED(runtimeSource));
  vi.mocked(entitlementService.tenantHasWorkforcePack).mockResolvedValue(GRANTED(runtimeSource));
  vi.mocked(entitlementService.tenantCanUseExecutionChannel).mockResolvedValue(GRANTED(runtimeSource));
  vi.mocked(entitlementService.checkUsage).mockResolvedValue(USAGE_ALLOWED as ReturnType<typeof entitlementService.checkUsage> extends Promise<infer T> ? T : never);
}

// ─── Suite 1: Subscription state (Step 4) ─────────────────────────────────────

describe("Execution Policy — Step 4: Subscription State", () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it("MOCKED: active manually-assigned subscription may execute", async () => {
    // A subscription in 'active' status — regardless of whether it was created
    // manually by a platform admin, via invoice, or enterprise contract —
    // must be permitted to execute.
    vi.mocked(entitlementService.tenantCanUseFeature).mockResolvedValue(
      GRANTED("subscription"),  // entitlementService returns "subscription" as source
    );
    vi.mocked(entitlementService.tenantHasWorkforcePack).mockResolvedValue(GRANTED());
    vi.mocked(entitlementService.tenantCanUseExecutionChannel).mockResolvedValue(GRANTED());
    vi.mocked(entitlementService.checkUsage).mockResolvedValue(USAGE_ALLOWED as never);

    const result = await checkExecutionAccess(ORG_ID, ROLE, CHANNELS);

    expect(result.allowed).toBe(true);
    expect(result.deniedAt).toBeNull();
    expect(result.decision.operational).toBe(true);
  });

  it("MOCKED: active trial subscription may execute within its entitlements", async () => {
    // A subscription in 'trial' status must be permitted to execute, provided
    // the plan or override grants execution.openclaw_runtime.
    vi.mocked(entitlementService.tenantCanUseFeature).mockResolvedValue(
      GRANTED("trial"),           // entitlementService identifies trial origin
    );
    vi.mocked(entitlementService.tenantHasWorkforcePack).mockResolvedValue(GRANTED("trial"));
    vi.mocked(entitlementService.tenantCanUseExecutionChannel).mockResolvedValue(GRANTED("trial"));
    vi.mocked(entitlementService.checkUsage).mockResolvedValue(USAGE_ALLOWED as never);

    const result = await checkExecutionAccess(ORG_ID, ROLE, CHANNELS);

    expect(result.allowed).toBe(true);
    expect(result.deniedAt).toBeNull();
    expect(result.decision.operational).toBe(true);
    // The policy records the source returned by the entitlement service
    expect(result.decision.source).toBe("trial");
  });

  it("MOCKED: enterprise-contract subscription (source=override) may execute", async () => {
    // Enterprise contracts may be granted via platform override. The policy
    // must accept any grant regardless of acquisition method.
    vi.mocked(entitlementService.tenantCanUseFeature).mockResolvedValue(
      GRANTED("override"),        // override = enterprise contract or manual override
    );
    vi.mocked(entitlementService.tenantHasWorkforcePack).mockResolvedValue(GRANTED("override"));
    vi.mocked(entitlementService.tenantCanUseExecutionChannel).mockResolvedValue(GRANTED("override"));
    vi.mocked(entitlementService.checkUsage).mockResolvedValue(USAGE_ALLOWED as never);

    const result = await checkExecutionAccess(ORG_ID, ROLE, CHANNELS);

    expect(result.allowed).toBe(true);
    expect(result.deniedAt).toBeNull();
    expect(result.decision.source).toBe("override");
  });

  it("MOCKED: inactive (suspended) subscription is blocked at Step 4", async () => {
    vi.mocked(entitlementService.tenantCanUseFeature).mockResolvedValue(
      DENIED("subscription_inactive", "Subscription is suspended. Please contact support."),
    );
    // tenantHasWorkforcePack and others should NOT be called when subscription is inactive
    vi.mocked(entitlementService.tenantHasWorkforcePack).mockResolvedValue(GRANTED());
    vi.mocked(entitlementService.tenantCanUseExecutionChannel).mockResolvedValue(GRANTED());
    vi.mocked(entitlementService.checkUsage).mockResolvedValue(USAGE_ALLOWED as never);

    const result = await checkExecutionAccess(ORG_ID, ROLE, CHANNELS);

    expect(result.allowed).toBe(false);
    expect(result.deniedAt).toBe("subscription_state");
    expect(result.decision.operational).toBe(false);
    expect(result.decision.reason).toMatch(/suspended/i);
  });

  it("MOCKED: cancelled subscription is blocked at Step 4", async () => {
    vi.mocked(entitlementService.tenantCanUseFeature).mockResolvedValue(
      DENIED("subscription_inactive", "Subscription is cancelled. Please contact support."),
    );
    vi.mocked(entitlementService.tenantHasWorkforcePack).mockResolvedValue(GRANTED());
    vi.mocked(entitlementService.tenantCanUseExecutionChannel).mockResolvedValue(GRANTED());
    vi.mocked(entitlementService.checkUsage).mockResolvedValue(USAGE_ALLOWED as never);

    const result = await checkExecutionAccess(ORG_ID, ROLE, CHANNELS);

    expect(result.allowed).toBe(false);
    expect(result.deniedAt).toBe("subscription_state");
    expect(result.decision.operational).toBe(false);
  });

  it("MOCKED: organisation with no subscription is blocked at Step 4", async () => {
    vi.mocked(entitlementService.tenantCanUseFeature).mockResolvedValue(
      DENIED("no_subscription", "No active subscription found."),
    );
    vi.mocked(entitlementService.tenantHasWorkforcePack).mockResolvedValue(GRANTED());
    vi.mocked(entitlementService.tenantCanUseExecutionChannel).mockResolvedValue(GRANTED());
    vi.mocked(entitlementService.checkUsage).mockResolvedValue(USAGE_ALLOWED as never);

    const result = await checkExecutionAccess(ORG_ID, ROLE, CHANNELS);

    expect(result.allowed).toBe(false);
    expect(result.deniedAt).toBe("subscription_state");
    expect(result.decision.status).toBe("none");
  });
});

// ─── Suite 2: Feature entitlement (Step 5) ────────────────────────────────────

describe("Execution Policy — Step 5: Feature Entitlement", () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it("MOCKED: missing execution.openclaw_runtime entitlement is blocked at Step 5", async () => {
    // Subscription is active but the plan does not include the runtime feature.
    vi.mocked(entitlementService.tenantCanUseFeature).mockResolvedValue(
      DENIED("feature_not_in_plan", "Your current plan does not include execution.openclaw_runtime."),
    );
    vi.mocked(entitlementService.tenantHasWorkforcePack).mockResolvedValue(GRANTED());
    vi.mocked(entitlementService.tenantCanUseExecutionChannel).mockResolvedValue(GRANTED());
    vi.mocked(entitlementService.checkUsage).mockResolvedValue(USAGE_ALLOWED as never);

    const result = await checkExecutionAccess(ORG_ID, ROLE, CHANNELS);

    expect(result.allowed).toBe(false);
    expect(result.deniedAt).toBe("runtime_entitlement");
    // Subscription itself was active — the feature is just missing from the plan
    expect(result.decision.operational).toBe(true);
    expect(result.decision.reason).toMatch(/plan/i);
  });

  it("MOCKED: explicit denial of execution.openclaw_runtime is blocked at Step 5", async () => {
    vi.mocked(entitlementService.tenantCanUseFeature).mockResolvedValue(
      DENIED("explicit_denial", "This feature has been explicitly denied by platform administration."),
    );
    vi.mocked(entitlementService.tenantHasWorkforcePack).mockResolvedValue(GRANTED());
    vi.mocked(entitlementService.tenantCanUseExecutionChannel).mockResolvedValue(GRANTED());
    vi.mocked(entitlementService.checkUsage).mockResolvedValue(USAGE_ALLOWED as never);

    const result = await checkExecutionAccess(ORG_ID, ROLE, CHANNELS);

    expect(result.allowed).toBe(false);
    expect(result.deniedAt).toBe("runtime_entitlement");
  });

  it("MOCKED: policy checks execution.professional_work as the primary Cloud UEE feature (Sprint 29N.10)", async () => {
    // Sprint 29N.10: the Cloud UEE gate is now execution.professional_work.
    // execution.openclaw_runtime is the legacy backwards-compat fallback only.
    // The first feature call must be for professional_work, not openclaw_runtime.
    vi.mocked(entitlementService.tenantCanUseFeature).mockResolvedValue(GRANTED());
    vi.mocked(entitlementService.tenantHasWorkforcePack).mockResolvedValue(GRANTED());
    vi.mocked(entitlementService.tenantCanUseExecutionChannel).mockResolvedValue(GRANTED());
    vi.mocked(entitlementService.checkUsage).mockResolvedValue(USAGE_ALLOWED as never);

    await checkExecutionAccess(ORG_ID, ROLE, CHANNELS);

    const featureArg = vi.mocked(entitlementService.tenantCanUseFeature).mock.calls[0]?.[1];
    expect(featureArg).toBe("execution.professional_work");
    expect(featureArg).not.toContain("stripe");
    expect(featureArg).not.toContain("billing");
  });
});

// ─── Suite 3: Workforce Pack (Step 6) ─────────────────────────────────────────

describe("Execution Policy — Step 6: Workforce Pack", () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it("MOCKED: missing workforce pack is blocked at Step 6", async () => {
    vi.mocked(entitlementService.tenantCanUseFeature).mockResolvedValue(GRANTED());
    vi.mocked(entitlementService.tenantHasWorkforcePack).mockResolvedValue(
      DENIED("workforce_pack_not_included", "The operations workforce pack is not included in your plan."),
    );
    vi.mocked(entitlementService.tenantCanUseExecutionChannel).mockResolvedValue(GRANTED());
    vi.mocked(entitlementService.checkUsage).mockResolvedValue(USAGE_ALLOWED as never);

    const result = await checkExecutionAccess(ORG_ID, "process_analyst", CHANNELS);

    expect(result.allowed).toBe(false);
    expect(result.deniedAt).toBe("workforce_pack");
    expect(result.decision.operational).toBe(true);
  });

  it("MOCKED: core role (chief_of_staff) requires only the core pack", async () => {
    setupFullGrant();

    await checkExecutionAccess(ORG_ID, "chief_of_staff", CHANNELS);

    const packArg = vi.mocked(entitlementService.tenantHasWorkforcePack).mock.calls[0]?.[1];
    expect(packArg).toBe("core");
  });

  it("MOCKED: compliance_manager requires the compliance pack", async () => {
    setupFullGrant();

    await checkExecutionAccess(ORG_ID, "compliance_manager", CHANNELS);

    const packArg = vi.mocked(entitlementService.tenantHasWorkforcePack).mock.calls[0]?.[1];
    expect(packArg).toBe("compliance");
  });
});

// ─── Suite 4: Execution Channel (Step 7) ──────────────────────────────────────

describe("Execution Policy — Step 7: Execution Channel", () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it("MOCKED: missing browser channel entitlement is blocked at Step 7", async () => {
    vi.mocked(entitlementService.tenantCanUseFeature).mockResolvedValue(GRANTED());
    vi.mocked(entitlementService.tenantHasWorkforcePack).mockResolvedValue(GRANTED());
    vi.mocked(entitlementService.tenantCanUseExecutionChannel).mockResolvedValue(
      DENIED("feature_not_in_plan", "Your current plan does not include execution.browser_session."),
    );
    vi.mocked(entitlementService.checkUsage).mockResolvedValue(USAGE_ALLOWED as never);

    const result = await checkExecutionAccess(ORG_ID, ROLE, ["browser"]);

    expect(result.allowed).toBe(false);
    expect(result.deniedAt).toBe("execution_channel");
  });

  it("MOCKED: internal/api channels do not trigger a channel check (always available)", async () => {
    // Internal channels (api, internal) are available to all active subscribers.
    // They should not trigger a tenantCanUseExecutionChannel call.
    setupFullGrant();

    await checkExecutionAccess(ORG_ID, ROLE, ["api", "internal"]);

    // Channel check should NOT be called for internal/api-only requests
    expect(vi.mocked(entitlementService.tenantCanUseExecutionChannel)).not.toHaveBeenCalled();
  });
});

// ─── Suite 5: Usage Allowance (Step 8) ────────────────────────────────────────

describe("Execution Policy — Step 8: Usage Allowance", () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it("MOCKED: exhausted ai_tasks allowance is blocked at Step 8", async () => {
    vi.mocked(entitlementService.tenantCanUseFeature).mockResolvedValue(GRANTED());
    vi.mocked(entitlementService.tenantHasWorkforcePack).mockResolvedValue(GRANTED());
    vi.mocked(entitlementService.tenantCanUseExecutionChannel).mockResolvedValue(GRANTED());
    vi.mocked(entitlementService.checkUsage).mockResolvedValue(USAGE_EXHAUSTED as never);

    const result = await checkExecutionAccess(ORG_ID, ROLE, CHANNELS);

    expect(result.allowed).toBe(false);
    expect(result.deniedAt).toBe("usage_allowance");
    expect(result.decision.source).toBe("usage_exhausted");
  });

  it("MOCKED: usage check uses the ai_tasks dimension code", async () => {
    setupFullGrant();

    await checkExecutionAccess(ORG_ID, ROLE, CHANNELS);

    const dimensionArg = vi.mocked(entitlementService.checkUsage).mock.calls[0]?.[1];
    expect(dimensionArg).toBe("ai_tasks");
  });
});

// ─── Suite 6: Decision shape ──────────────────────────────────────────────────

describe("Execution Policy — SubscriptionAccessDecision shape", () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it("MOCKED: access decision always contains all required fields", async () => {
    setupFullGrant();

    const result = await checkExecutionAccess(ORG_ID, ROLE, CHANNELS);

    expect(result).toHaveProperty("allowed");
    expect(result).toHaveProperty("deniedAt");
    expect(result.decision).toHaveProperty("operational");
    expect(result.decision).toHaveProperty("status");
    expect(result.decision).toHaveProperty("source");
    expect(result.decision).toHaveProperty("reason");
  });

  it("MOCKED: denied result always has a non-empty reason", async () => {
    vi.mocked(entitlementService.tenantCanUseFeature).mockResolvedValue(
      DENIED("subscription_inactive", "Subscription is suspended. Please contact support."),
    );
    vi.mocked(entitlementService.tenantHasWorkforcePack).mockResolvedValue(GRANTED());
    vi.mocked(entitlementService.tenantCanUseExecutionChannel).mockResolvedValue(GRANTED());
    vi.mocked(entitlementService.checkUsage).mockResolvedValue(USAGE_ALLOWED as never);

    const result = await checkExecutionAccess(ORG_ID, ROLE, CHANNELS);

    expect(result.decision.reason).toBeTruthy();
    expect(result.decision.reason.length).toBeGreaterThan(10);
  });
});

// ─── Suite 7: Provider independence — STATIC file checks ─────────────────────

describe("Execution Policy — Provider Independence", () => {
  const workspaceRoot = resolve(__dirname, "../../../..");

  function readSource(relativePath: string): string {
    return readFileSync(resolve(workspaceRoot, relativePath), "utf-8");
  }

  it("STATIC: Stripe is not imported or referenced in executionService.ts", () => {
    const src = readSource("artifacts/api-server/src/services/executionService.ts");
    expect(src.toLowerCase()).not.toContain("stripe");
  });

  it("STATIC: Stripe is not imported by executionPolicy.ts", () => {
    const src = readSource("artifacts/api-server/src/services/executionPolicy.ts");
    // Comments explaining the design rationale may mention Stripe — that is correct.
    // What must never appear is an actual import or require of Stripe.
    expect(src).not.toMatch(/import\s+.*from\s+['"]stripe['"]/);
    expect(src).not.toMatch(/require\s*\(\s*['"]stripe['"]\s*\)/);
    expect(src).not.toMatch(/from\s+['"]@stripe\//);
  });

  it("STATIC: OpenClaw adapter (openClawExecutionEngine.ts) does not reference any billing provider", () => {
    const src = readSource("lib/openclaw/src/openClawExecutionEngine.ts");
    expect(src.toLowerCase()).not.toContain("stripe");
    expect(src.toLowerCase()).not.toContain("billing provider");
    expect(src.toLowerCase()).not.toContain("payment");
  });

  it("STATIC: RuntimeBrokerClient does not reference any billing provider", () => {
    const src = readSource("lib/openclaw/src/runtimeBrokerClient.ts");
    expect(src.toLowerCase()).not.toContain("stripe");
    expect(src.toLowerCase()).not.toContain("billing");
    expect(src.toLowerCase()).not.toContain("payment");
  });

  it("STATIC: OpenClaw package types do not include billing concepts", () => {
    const src = readSource("lib/openclaw/src/types.ts");
    expect(src.toLowerCase()).not.toContain("stripe");
    expect(src.toLowerCase()).not.toContain("billing");
  });

  it("STATIC: executionPolicy.ts does not import drizzle, pg, or any DB driver directly", () => {
    const src = readSource("artifacts/api-server/src/services/executionPolicy.ts");
    // Policy must go through the entitlement service — never access DB directly
    expect(src).not.toContain("from \"drizzle-orm\"");
    expect(src).not.toContain("from '@workspace/db'");
    expect(src).not.toContain("from \"@workspace/db\"");
    expect(src).not.toContain("import pg");
  });

  it("STATIC: executionPolicy.ts does not import or call any billing-provider SDK", () => {
    const src = readSource("artifacts/api-server/src/services/executionPolicy.ts");
    // The policy may document that Stripe is excluded — comments are fine.
    // What it must never do is import, require, or call Stripe SDK symbols.
    expect(src).not.toMatch(/import\s+.*from\s+['"]stripe['"]/);
    expect(src).not.toMatch(/from\s+['"]@stripe\//);
    // Must not reference Stripe-specific API event shapes
    expect(src).not.toContain("payment_intent");
    expect(src).not.toContain("customer.subscription");
    expect(src).not.toContain("invoice.paid");
    // Must not call any Stripe client method
    expect(src).not.toMatch(/stripe\.(customers|subscriptions|invoices|payment)/);
  });

  it("STATIC: execution.professional_work is the primary feature code; openclaw_runtime retained as backwards-compat fallback", () => {
    const src = readSource("artifacts/api-server/src/services/executionPolicy.ts");
    // Sprint 29N.10: professional_work is checked first (Cloud UEE gate)
    expect(src).toContain("execution.professional_work");
    // Backwards-compat: openclaw_runtime fallback must still be present
    expect(src).toContain("execution.openclaw_runtime");
  });

  it("STATIC: subscription status sources reference NeedsOps internal states only", () => {
    const src = readSource("artifacts/api-server/src/services/executionPolicy.ts");
    // Should reference internal status strings
    expect(src).toContain("no_subscription");
    expect(src).toContain("subscription_inactive");
    // Should NOT reference Stripe-specific states
    expect(src).not.toContain("past_due_stripe");
    expect(src).not.toContain("stripe_subscription");
  });
});
