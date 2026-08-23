import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "..");

function source(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), "utf8");
}

describe("Sprint 35E workforce DNA runtime publication readiness", () => {
  it("defines runtime-required canonical specialists from current approved available roles", () => {
    const src = source("services/workerProfilePublicationService.ts");

    expect(src).toContain("getRuntimeRequiredSpecialistCodes");
    expect(src).toContain('s.catalogueVersion === "2"');
    expect(src).toContain('s.executionStatus === "available"');
    expect(src).toContain('s.executionStatus === "beta"');
    expect(src).toContain('s.dnaStatus === "approved"');
  });

  it("seeds WorkerProfiles and workforce-role mappings from canonical source", () => {
    const src = source("services/workerProfilePublicationService.ts");

    expect(src).toContain("WORKER_PROFILES");
    expect(src).toContain("ROLE_TO_PROFILES");
    expect(src).toContain("workerProfilesTable");
    expect(src).toContain("workforceRoleProfilesTable");
    expect(src).toContain("reconcileWorkerProfilePublication");
  });

  it("uses existing immutable DNA publication reconciliation rather than static fallback", () => {
    const src = source("services/workerProfilePublicationService.ts");

    expect(src).toContain("buildWorkforceDnaPublicationInventory");
    expect(src).toContain("activePublishedDnaExists");
    expect(src).not.toContain("ALLOW_STATIC_DNA_FALLBACK=true");
  });

  it("bootstrap runs WorkerProfile, DNA and runtime acceptance before Blueprint acceptance", () => {
    const src = source("scripts/db-bootstrap.ts");

    const subscriptions = src.indexOf("Reconciling onboarding trial subscriptions");
    const workerProfiles = src.indexOf("Reconciling WorkerProfiles and role mappings");
    const dna = src.indexOf("Reconciling published Workforce DNA");
    const acceptance = src.indexOf("Running Workforce runtime acceptance");
    const blueprints = src.indexOf("Running Blueprint bootstrap acceptance");

    expect(subscriptions).toBeGreaterThan(0);
    expect(workerProfiles).toBeGreaterThan(0);
    expect(workerProfiles).toBeGreaterThan(subscriptions);
    expect(dna).toBeGreaterThan(workerProfiles);
    expect(acceptance).toBeGreaterThan(dna);
    expect(blueprints).toBeGreaterThan(acceptance);
    expect(src).toContain("reconcileMissingOnboardingTrialSubscriptions");
    expect(src).toContain("assertWorkforceRuntimeAcceptance");
  });

  it("acceptance checker blocks missing publication and duplicate active DNA", () => {
    const src = source("services/workerProfilePublicationService.ts");

    expect(src).toContain("missing.length > 0");
    expect(src).toContain("duplicateActive.length > 0");
    expect(src).toContain("Workforce runtime acceptance failed");
  });

  it("execution access uses the Blueprint primary specialist, not the first CoS orchestration step", () => {
    const src = source("services/executionService.ts");

    expect(src).toContain("primarySpecialist?: string");
    expect(src).toContain("planData.primarySpecialist ?? planData.assignedSpecialists?.[0]");
    expect(src).not.toContain("const primaryRole = planData.assignedSpecialists?.[0] ?? \"chief_of_staff\"");
  });

  it("AWS-native professional execution does not require the OpenClaw desktop broker", () => {
    const src = source("services/executionService.ts");

    expect(src).toContain("requiresOpenClawRuntime");
    expect(src).toContain("aws_native_professional_work");
    expect(src).toContain("executeWork({");
    expect(src).toContain('runtimeName: "aws_native"');
    expect(src).toContain("no browser, local file, or local application channel requested");
    expect(src).toContain("requestedConnectorCategories currently represents the WorkerProfile's");
  });

  it("OpenClaw remains reserved for browser and local desktop execution channels", () => {
    const src = source("services/executionService.ts");

    expect(src).toContain('"browser"');
    expect(src).toContain('"local_files"');
    expect(src).toContain('"local_applications"');
    expect(src).toContain("openclaw_required");
    expect(src).toContain("Package requested browser, local file, or local application execution");
  });

  it("can resume an executing task that is parked on a pending runtime session", () => {
    const src = source("services/executionService.ts");

    expect(src).toContain("getTaskForExecutionSubmission");
    expect(src).toContain("already 'executing' with a pending runtime session");
    expect(src).toContain("resumedFromPendingBrokerSession");
    expect(src).toContain("existingPendingSession?.currentStatus === \"pending\"");
  });

  it("org provisioning creates the subscription gate required by execution entitlements", () => {
    const src = source("services/orgProvisioningService.ts");

    expect(src).toContain("ensureTrialSubscriptionForOrg");
    expect(src).toContain("Created during organisation provisioning so onboarding packs satisfy subscription entitlement gates.");
    expect(src.indexOf("ensureTrialSubscriptionForOrg")).toBeLessThan(src.indexOf("provisionPacksForNewOrg("));
  });

  it("subscription reconciliation repairs onboarding pack grants that lack subscriptions", () => {
    const src = source("services/subscriptionProvisioningService.ts");

    expect(src).toContain("reconcileMissingOnboardingTrialSubscriptions");
    expect(src).toContain("LEFT JOIN tenant_subscriptions");
    expect(src).toContain("ts.id IS NULL");
    expect(src).toContain("twp.source IN ('core_auto', 'onboarding_trial')");
    expect(src).toContain("planCode: row.has_non_core_pack ? \"professional\" : \"foundation\"");
  });

  it("v1 error handler preserves coded execution-gate failures instead of masking them as 500", () => {
    const src = source("lib/errors.ts");

    expect(src).toContain("EXECUTION_ACCESS_DENIED: 403");
    expect(src).toContain("SPECIALIST_DNA_UNAVAILABLE: 503");
    expect(src).toContain("coded.code && status");
  });
});
