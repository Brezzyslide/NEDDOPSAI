/**
 * Sprint 33K — Workforce Compliance Specialist v2
 *
 * Proves WCS is the current-v2 owner for worker-level compliance and
 * deployment eligibility truth without becoming Rostering, Operations, HR,
 * Payroll/SCHADS, CQM, clinical, BSP, RP, legal or OpenClaw authority.
 */

import { describe, expect, it, vi } from "vitest";
import type { ExecutionPackage } from "@workspace/agent-runtime";

vi.mock("../services/specialistCatalogueService.js", () => ({
  listCatalogue: vi.fn(async () => ({ entries: [] })),
}));

vi.mock("../services/entitlementService.js", () => ({
  tenantCanUseSpecialist: vi.fn(async () => ({ allowed: true })),
  tenantHasWorkforcePack: vi.fn(async () => ({ allowed: true, source: "plan" })),
  tenantCanUseFeature: vi.fn(async () => true),
  checkUsage: vi.fn(async () => ({ allowed: true })),
}));

vi.mock("../services/auditService.js", () => ({
  logOrgEvent: vi.fn(async () => undefined),
}));

import {
  WORKFORCE_COMPLIANCE_SPECIALIST_DNA,
  WORKFORCE_ROSTERING_COORDINATOR_DNA,
  getCanonicalDNAProfile,
  getDNAProfile,
} from "@workspace/workforce-dna";
import { getSpecialistByCode } from "../lib/workforceRegistry.js";
import { getCapability } from "../lib/capabilityRegistry.js";
import {
  getWorkerProfileByCode,
  getWorkerProfilesForRole,
} from "../lib/workerProfileRegistry.js";
import {
  hasActiveIntelligence,
  validateSpecialistEligibilitySync,
} from "../services/specialistEligibilityService.js";
import {
  getConversationWorkforceContext,
  _clearWorkforceCache,
} from "../services/conversationWorkforceContextService.js";
import { getRegistryEntry } from "../services/blueprintRegistry.js";
import { resolveIntent } from "../services/blueprintIntentMap.js";
import { evaluateWorkerProfileAuthority } from "../services/executionActionService.js";
import {
  buildWorkerProfileExecutionConstraints,
  validateOpenClawExecutionPackageAuthority,
} from "../services/executionService.js";

const ORG_ID = "org-sprint33k";
const profile = getWorkerProfileByCode("workforce_compliance_specialist_profile")!;

type EligibilityState =
  | "ELIGIBLE"
  | "ELIGIBLE_WITH_CONDITIONS"
  | "NOT_ELIGIBLE"
  | "PENDING_VERIFICATION"
  | "EVIDENCE_MISSING"
  | "EXPIRED"
  | "SUSPENDED_RESTRICTED"
  | "UNKNOWN";

interface CredentialFixture {
  requirementMandatory: boolean;
  evidenceSource: "authoritative_current" | "verified_current" | "verified_historical" | "user_assertion" | "memory" | "missing";
  verified: boolean;
  effectiveFrom?: string;
  expiresAt?: string;
  superseded?: boolean;
  restricted?: boolean;
}

function assessCredential(fixture: CredentialFixture, at = "2026-08-17T00:00:00.000Z"): EligibilityState {
  const now = new Date(at).getTime();
  if (fixture.restricted) return "SUSPENDED_RESTRICTED";
  if (fixture.evidenceSource === "missing") return "EVIDENCE_MISSING";
  if (fixture.evidenceSource === "user_assertion" || fixture.evidenceSource === "memory") return "PENDING_VERIFICATION";
  if (!fixture.verified) return "PENDING_VERIFICATION";
  if (fixture.superseded) return "EXPIRED";
  if (fixture.expiresAt && new Date(fixture.expiresAt).getTime() < now) return "EXPIRED";
  if (fixture.effectiveFrom && new Date(fixture.effectiveFrom).getTime() > now) return "PENDING_VERIFICATION";
  return fixture.requirementMandatory ? "ELIGIBLE" : "ELIGIBLE_WITH_CONDITIONS";
}

function makePackage(overrides: Partial<ExecutionPackage> = {}): ExecutionPackage {
  const workerProfile = buildWorkerProfileExecutionConstraints(profile);
  return {
    executionId: "exec-33k",
    taskId: "task-33k",
    tenantId: ORG_ID,
    workforceRole: "workforce_compliance_specialist",
    specialistManifest: {
      manifestVersion: 1,
      workforceRole: "workforce_compliance_specialist",
      displayName: "Workforce Compliance Specialist",
      domain: "workforce compliance",
      dnaProfileId: "workforce_compliance_specialist",
      dnaVersion: "1.0.0",
      manifestHash: "sha256:wcs-manifest",
      generatedAt: new Date().toISOString(),
      specialistId: "workforce_compliance_specialist",
    } as ExecutionPackage["specialistManifest"],
    runtimeInstructions: {
      instruction: "Execute workforce compliance assessment only.",
      instructionHash: "sha256:wcs-instruction",
      manifestHash: "sha256:wcs-manifest",
      dnaVersion: "1.0.0",
      specialistId: "workforce_compliance_specialist",
      compiledAt: new Date().toISOString(),
    },
    workerProfile,
    steps: [{
      sequence: 1,
      specialist: "workforce_compliance_specialist",
      action: "execute",
      description: "Assess worker eligibility",
      requiresApproval: false,
    }],
    requestedTools: [...profile.allowedToolCategories],
    requestedChannels: [...workerProfile.allowedChannels],
    requestedConnectorCategories: [...profile.allowedConnectorCategories],
    approvalState: "not_required",
    constraints: {
      maxDurationSeconds: 300,
      requireHumanApprovalBeforeSubmit: false,
      allowedDataCategories: ["task_context", "worker_compliance_evidence"],
    },
    callbackUrl: "",
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
    issuedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("Sprint 33K current-v2 activation", () => {
  it("activates WCS as a complete current-v2 role", () => {
    const specialist = getSpecialistByCode("workforce_compliance_specialist");

    expect(specialist).toBeDefined();
    expect(specialist!.executionStatus).toBe("available");
    expect(specialist!.dnaStatus).toBe("approved");
    expect(specialist!.workerProfileCodes).toEqual(["workforce_compliance_specialist_profile"]);
    expect(hasActiveIntelligence("workforce_compliance_specialist")).toBe(true);
  });

  it("resolves active DNA and canonical WorkforceDNA", () => {
    const legacy = getDNAProfile("workforce_compliance_specialist");
    const canonical = getCanonicalDNAProfile("workforce_compliance_specialist");

    expect(legacy).toBe(WORKFORCE_COMPLIANCE_SPECIALIST_DNA);
    expect(canonical).not.toBeNull();
    expect(canonical!.identity.specialistId).toBe("workforce_compliance_specialist");
    expect(canonical!.professionalMission.missionStatement).toContain("worker");
    expect(canonical!.domainExpertise.competencies.length).toBeGreaterThanOrEqual(10);
    expect(canonical!.requiredWorkerProfile.profileCode).toBe("workforce_compliance_specialist_profile");
  });

  it("resolves WorkerProfile and runtime dispatchability", async () => {
    _clearWorkforceCache();
    const profiles = getWorkerProfilesForRole("workforce_compliance_specialist");
    const ctx = await getConversationWorkforceContext(ORG_ID);
    const wcs = ctx.specialists.find(s => s.code === "workforce_compliance_specialist");

    expect(profiles.map(p => p.code)).toEqual(["workforce_compliance_specialist_profile"]);
    expect(profile.riskLevel).toBe("high");
    expect(wcs).toBeDefined();
    expect(wcs!.availableForConversation).toBe(true);
    expect(wcs!.availableForDispatch).toBe(true);
    expect(wcs!.runtimeReady).toBe(true);
  });
});

describe("Sprint 33K capability and blueprint ownership", () => {
  it("owns workforce compliance truth capabilities", () => {
    const capabilityCodes = [
      "staff_compliance.qualification_review",
      "staff_compliance.worker_eligibility_review",
      "staff_compliance.credential_review",
      "staff_compliance.training_competency_review",
      "staff_compliance.expiry_monitoring",
      "staff_compliance.onboarding_readiness",
      "staff_compliance.deployment_eligibility",
      "staff_compliance.exception_review",
    ];

    for (const code of capabilityCodes) {
      const cap = getCapability(code);
      expect(cap, `${code} should exist`).toBeDefined();
      expect(cap!.eligibleRoles[0]).toBe("workforce_compliance_specialist");
      expect(cap!.requiredWorkerProfiles).toContain("workforce_compliance_specialist_profile");
      expect(validateSpecialistEligibilitySync("workforce_compliance_specialist", code)).toBe(true);
    }
  });

  it("routes WCS blueprint intents to the workforce compliance assessment blueprint", () => {
    const entry = getRegistryEntry("workforce_compliance_assessment");
    const intent = resolveIntent("workforce_compliance.eligibility_review");

    expect(entry).toBeDefined();
    expect(entry!.futureOwnerRoleCode).toBe("workforce_compliance_specialist");
    expect(entry!.purpose).toContain("deployment eligibility");
    expect(intent?.isAction).toBe(false);
    if (intent && !intent.isAction) {
      expect(intent.family).toBe("workforce_compliance");
      expect(intent.mode).toBe("eligibility_review");
      expect(intent.code).toBe("workforce_compliance_assessment");
    }
  });
});

describe("Sprint 33K professional workforce compliance scenarios", () => {
  it("current verified credential can support eligibility", () => {
    expect(assessCredential({
      requirementMandatory: true,
      evidenceSource: "verified_current",
      verified: true,
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      expiresAt: "2027-01-01T00:00:00.000Z",
    })).toBe("ELIGIBLE");
  });

  it("expired credential cannot support current eligibility", () => {
    expect(assessCredential({
      requirementMandatory: true,
      evidenceSource: "verified_historical",
      verified: true,
      expiresAt: "2026-01-01T00:00:00.000Z",
    })).toBe("EXPIRED");
  });

  it("missing evidence does not become compliant", () => {
    expect(assessCredential({
      requirementMandatory: true,
      evidenceSource: "missing",
      verified: false,
    })).toBe("EVIDENCE_MISSING");
  });

  it("historical evidence and user assertion do not become current truth", () => {
    expect(assessCredential({
      requirementMandatory: true,
      evidenceSource: "user_assertion",
      verified: false,
    })).toBe("PENDING_VERIFICATION");
    expect(JSON.stringify(WORKFORCE_COMPLIANCE_SPECIALIST_DNA)).toContain("Historical rosters, old credentials, memory, manager statements and worker assertions");
  });

  it("WRC cannot override WCS eligibility or certify credentials", () => {
    const wrc = JSON.stringify(WORKFORCE_ROSTERING_COORDINATOR_DNA);
    const wcs = JSON.stringify(WORKFORCE_COMPLIANCE_SPECIALIST_DNA);

    expect(wrc).toContain("Do not self-certify expired or unverified credentials");
    expect(wcs).toContain("WCS supplies eligibility truth. WRC rosters");
    expect(validateSpecialistEligibilitySync("workforce_rostering_coordinator", "staff_compliance.deployment_eligibility")).toBe(false);
  });

  it("staffing shortage does not waive mandatory compliance", () => {
    const dna = JSON.stringify(WORKFORCE_COMPLIANCE_SPECIALIST_DNA);

    expect(dna).toContain("Do not relax mandatory requirements because staffing is difficult");
    expect(dna).toContain("Operational pressure cannot alter compliance truth");
  });

  it("does not become roster planner, payroll/SCHADS, HR, CQM, clinical, BSP, RP or legal authority", () => {
    const cannotDo = WORKFORCE_COMPLIANCE_SPECIALIST_DNA.professionalBoundaries.cannotDo.join(" ");
    const outOfScope = WORKFORCE_COMPLIANCE_SPECIALIST_DNA.professionalBoundaries.outOfScope.join(" ");
    const defers = WORKFORCE_COMPLIANCE_SPECIALIST_DNA.conflictPolicy.defersTo.join(" ");

    expect(cannotDo).toContain("publish rosters");
    expect(cannotDo).toContain("make HR disciplinary decisions");
    expect(cannotDo).toContain("payroll, SCHADS");
    expect(cannotDo).toContain("clinical decisions");
    expect(cannotDo).toContain("authorise restrictive practices");
    expect(outOfScope).toContain("organisational compliance-system assurance");
    expect(defers).toContain("compliance_quality_manager");
    expect(defers).toContain("legal_or_industrial_authority");
  });
});

describe("Sprint 33K evidence, memory and authority discipline", () => {
  it("authority/currentness precedence resolves conflicting evidence", () => {
    const dna = JSON.stringify(WORKFORCE_COMPLIANCE_SPECIALIST_DNA);

    expect(dna).toContain("Prefer current authoritative source over lower-authority or older organisational records");
    expect(dna).toContain("If employee file and authoritative source conflict");
  });

  it("memory cannot override current evidence", () => {
    expect(assessCredential({
      requirementMandatory: true,
      evidenceSource: "memory",
      verified: false,
    })).toBe("PENDING_VERIFICATION");
    expect(WORKFORCE_COMPLIANCE_SPECIALIST_DNA.memoryPolicy.readCategories).toContain("previous_workforce_compliance_findings");
    expect(WORKFORCE_COMPLIANCE_SPECIALIST_DNA.learningPolicy.conflictLearning).toContain("Memory must not become proof");
  });

  it("WorkerProfile prohibits credential fabrication and expiry override", () => {
    const fabricate = evaluateWorkerProfileAuthority({
      specialistCode: "workforce_compliance_specialist",
      workerProfile: profile,
      actionIdentifier: "fabricate_worker_credential",
      actionType: "update_file",
      executionChannel: "internal_api",
      toolCategory: "data_tools",
    });
    const updateStatus = evaluateWorkerProfileAuthority({
      specialistCode: "workforce_compliance_specialist",
      workerProfile: profile,
      actionIdentifier: "update_worker_compliance_status",
      actionType: "update_file",
      executionChannel: "internal_api",
      toolCategory: "data_tools",
      connectorCategory: "hr_system",
    });

    expect(fabricate.decision).toBe("PROHIBITED");
    expect(updateStatus.decision).toBe("APPROVAL_REQUIRED");
  });

  it("OpenClaw execution package preserves WorkerProfile boundaries", () => {
    const pkg = makePackage();
    const decision = validateOpenClawExecutionPackageAuthority({ pkg, workerProfile: profile });

    expect(decision.decision).toBe("PERMITTED");
    expect(pkg.workforceRole).toBe("workforce_compliance_specialist");
    expect(pkg.workerProfile.prohibitedActions).toContain("override_credential_expiry");
    expect(pkg.workerProfile.requiresApprovalFor).toContain("update_worker_compliance_status");
  });

  it("OpenClaw package fails if WorkerProfile prohibitions are removed", () => {
    const pkg = makePackage({
      workerProfile: {
        ...buildWorkerProfileExecutionConstraints(profile),
        prohibitedActions: [],
      },
    });
    const decision = validateOpenClawExecutionPackageAuthority({ pkg, workerProfile: profile });

    expect(decision.decision).toBe("PROHIBITED");
    expect(decision.reason).toContain("removed WorkerProfile prohibitions");
  });
});
