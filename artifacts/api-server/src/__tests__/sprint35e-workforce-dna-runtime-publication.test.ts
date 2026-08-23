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

    const workerProfiles = src.indexOf("Reconciling WorkerProfiles and role mappings");
    const dna = src.indexOf("Reconciling published Workforce DNA");
    const acceptance = src.indexOf("Running Workforce runtime acceptance");
    const blueprints = src.indexOf("Running Blueprint bootstrap acceptance");

    expect(workerProfiles).toBeGreaterThan(0);
    expect(dna).toBeGreaterThan(workerProfiles);
    expect(acceptance).toBeGreaterThan(dna);
    expect(blueprints).toBeGreaterThan(acceptance);
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
});
