/**
 * Sprint 33M - People & Culture Manager v2
 *
 * Proves P&C owns employment and people-management consequences without
 * becoming Workforce Compliance, Rostering, Payroll, Talent & Learning,
 * Operations, CQM, ISS, Policy, legal/industrial, clinical, BSP/RP or OpenClaw
 * authority.
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
  PAYROLL_WORKFORCE_COST_OFFICER_DNA,
  PEOPLE_CULTURE_MANAGER_DNA,
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
import {
  getAuthorityRegistryEntries,
  scoreAuthorityForContext,
} from "../lib/authorityRegistry/index.js";

const ORG_ID = "org-sprint33m";
const profile = getWorkerProfileByCode("people_culture_manager_profile")!;

type EvidenceClass = "ALLEGATION" | "EVIDENCE" | "ESTABLISHED_FACT" | "EMPLOYEE_RESPONSE" | "INFERENCE";
type CurrentnessStatus = "CURRENT" | "SUPERSEDED" | "HISTORICAL" | "MEMORY";
type PeopleFinding = "COMPLETE" | "BLOCKED_MISSING_RESPONSE" | "INSUFFICIENT_EVIDENCE" | "CONFLICT_SURFACED";

function classifyEvidence(input: {
  source: "incident_report" | "manager_statement" | "employee_response" | "verified_record" | "memory";
  verified?: boolean;
}): EvidenceClass {
  if (input.source === "employee_response") return "EMPLOYEE_RESPONSE";
  if (input.source === "memory") return "INFERENCE";
  if (input.source === "verified_record" && input.verified) return "ESTABLISHED_FACT";
  if (input.verified) return "EVIDENCE";
  return "ALLEGATION";
}

function assessPeopleMatter(input: {
  allegationOnly?: boolean;
  employeeResponsePresent?: boolean;
  conflictingAccounts?: boolean;
  currentPolicy?: CurrentnessStatus;
  currentEvidenceImproved?: boolean;
  oldWarningOnly?: boolean;
}): PeopleFinding {
  if (input.conflictingAccounts) return "CONFLICT_SURFACED";
  if (input.allegationOnly || input.oldWarningOnly || input.currentPolicy !== "CURRENT") return "INSUFFICIENT_EVIDENCE";
  if (!input.employeeResponsePresent) return "BLOCKED_MISSING_RESPONSE";
  return input.currentEvidenceImproved ? "COMPLETE" : "COMPLETE";
}

function makePackage(overrides: Partial<ExecutionPackage> = {}): ExecutionPackage {
  const workerProfile = buildWorkerProfileExecutionConstraints(profile);
  return {
    executionId: "exec-33m",
    taskId: "task-33m",
    tenantId: ORG_ID,
    workforceRole: "people_culture_manager",
    specialistManifest: {
      manifestVersion: 1,
      workforceRole: "people_culture_manager",
      displayName: "People & Culture Manager",
      domain: "people culture",
      dnaProfileId: "people_culture_manager",
      dnaVersion: "1.0.0",
      manifestHash: "sha256:pcm-manifest",
      generatedAt: new Date().toISOString(),
      specialistId: "people_culture_manager",
    } as ExecutionPackage["specialistManifest"],
    runtimeInstructions: {
      instruction: "Execute people-management assessment only.",
      instructionHash: "sha256:pcm-instruction",
      manifestHash: "sha256:pcm-manifest",
      dnaVersion: "1.0.0",
      specialistId: "people_culture_manager",
      compiledAt: new Date().toISOString(),
    },
    workerProfile,
    steps: [{
      sequence: 1,
      specialist: "people_culture_manager",
      action: "execute",
      description: "Assess people-management matter",
      requiresApproval: false,
    }],
    requestedTools: [...profile.allowedToolCategories],
    requestedChannels: [...workerProfile.allowedChannels],
    requestedConnectorCategories: [...profile.allowedConnectorCategories],
    approvalState: "not_required",
    constraints: {
      maxDurationSeconds: 300,
      requireHumanApprovalBeforeSubmit: false,
      allowedDataCategories: ["task_context", "employee_records", "people_management_evidence"],
    },
    callbackUrl: "",
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
    issuedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("Sprint 33M current-v2 activation", () => {
  it("activates People & Culture Manager as complete current-v2 role", () => {
    const specialist = getSpecialistByCode("people_culture_manager");

    expect(specialist).toBeDefined();
    expect(specialist!.executionStatus).toBe("available");
    expect(specialist!.dnaStatus).toBe("approved");
    expect(specialist!.workerProfileCodes).toEqual(["people_culture_manager_profile"]);
    expect(hasActiveIntelligence("people_culture_manager")).toBe(true);
  });

  it("resolves active DNA and canonical WorkforceDNA", () => {
    const legacy = getDNAProfile("people_culture_manager");
    const canonical = getCanonicalDNAProfile("people_culture_manager");

    expect(legacy).toBe(PEOPLE_CULTURE_MANAGER_DNA);
    expect(canonical).not.toBeNull();
    expect(canonical!.identity.specialistId).toBe("people_culture_manager");
    expect(canonical!.professionalMission.missionStatement).toContain("people-management");
    expect(canonical!.domainExpertise.competencies.length).toBeGreaterThanOrEqual(24);
    expect(canonical!.requiredWorkerProfile.profileCode).toBe("people_culture_manager_profile");
  });

  it("resolves WorkerProfile and runtime dispatchability", async () => {
    _clearWorkforceCache();
    const profiles = getWorkerProfilesForRole("people_culture_manager");
    const ctx = await getConversationWorkforceContext(ORG_ID);
    const pcm = ctx.specialists.find(s => s.code === "people_culture_manager");

    expect(profiles.map(p => p.code)).toEqual(["people_culture_manager_profile"]);
    expect(profile.riskLevel).toBe("high");
    expect(pcm).toBeDefined();
    expect(pcm!.availableForConversation).toBe(true);
    expect(pcm!.availableForDispatch).toBe(true);
    expect(pcm!.runtimeReady).toBe(true);
  });

  it("satisfies static DB publication prerequisites", () => {
    const specialist = getSpecialistByCode("people_culture_manager")!;
    const canonical = getCanonicalDNAProfile("people_culture_manager");
    const profiles = getWorkerProfilesForRole("people_culture_manager");

    expect(specialist.catalogueVersion).toBe("2");
    expect(specialist.executionStatus).toBe("available");
    expect(specialist.dnaStatus).toBe("approved");
    expect(canonical).not.toBeNull();
    expect(profiles.some(p => p.status === "active")).toBe(true);
  });
});

describe("Sprint 33M capability and blueprint ownership", () => {
  it("owns people-management capabilities", () => {
    const capabilityCodes = [
      "people.performance_review",
      "people.performance_management",
      "people.probation_review",
      "people.employee_relations",
      "people.grievance_review",
      "people.conduct_review",
      "people.recruitment_support",
      "people.onboarding",
      "people.workplace_adjustment",
      "people.supervision_framework",
      "people.retention_review",
      "people.offboarding",
      "hr.performance",
      "hr.onboarding",
    ];

    for (const code of capabilityCodes) {
      const cap = getCapability(code);
      expect(cap, `${code} should exist`).toBeDefined();
      expect(cap!.eligibleRoles[0]).toBe("people_culture_manager");
      expect(cap!.requiredWorkerProfiles).toContain("people_culture_manager_profile");
      expect(validateSpecialistEligibilitySync("people_culture_manager", code)).toBe(true);
    }
  });

  it("routes performance-review and people-management Blueprints to P&C", () => {
    const performance = getRegistryEntry("workforce_performance_review");
    const peopleManagement = getRegistryEntry("people_management_review");
    const performanceIntent = resolveIntent("people.performance_review");
    const grievanceIntent = resolveIntent("people.grievance_review");

    expect(performance!.futureOwnerRoleCode).toBe("people_culture_manager");
    expect(peopleManagement!.futureOwnerRoleCode).toBe("people_culture_manager");
    expect(performanceIntent?.isAction).toBe(false);
    expect(grievanceIntent?.isAction).toBe(false);
    if (grievanceIntent && !grievanceIntent.isAction) {
      expect(grievanceIntent.family).toBe("people_culture");
      expect(grievanceIntent.mode).toBe("grievance_review");
      expect(grievanceIntent.code).toBe("people_management_review");
    }
  });

  it("preserves WCS, WRC, Payroll and Talent & Learning boundaries", () => {
    expect(getCapability("staff_compliance.deployment_eligibility")!.eligibleRoles[0]).toBe("workforce_compliance_specialist");
    expect(getCapability("roster.plan")!.eligibleRoles[0]).toBe("workforce_rostering_coordinator");
    expect(getCapability("payroll.review")!.eligibleRoles[0]).toBe("payroll_workforce_cost_officer");
    expect(getCapability("learning.training_gap_analysis")!.eligibleRoles[0]).toBe("talent_learning_specialist");
    expect(validateSpecialistEligibilitySync("people_culture_manager", "staff_compliance.deployment_eligibility")).toBe(false);
    expect(validateSpecialistEligibilitySync("people_culture_manager", "roster.plan")).toBe(false);
    expect(validateSpecialistEligibilitySync("people_culture_manager", "payroll.review")).toBe(false);
    expect(validateSpecialistEligibilitySync("people_culture_manager", "learning.training_gap_analysis")).toBe(false);
    expect(WORKFORCE_COMPLIANCE_SPECIALIST_DNA.conflictPolicy.defersTo).toContain("payroll_workforce_cost_officer");
    expect(WORKFORCE_ROSTERING_COORDINATOR_DNA.conflictPolicy.defersTo).toContain("people_culture_manager");
    expect(PAYROLL_WORKFORCE_COST_OFFICER_DNA.conflictPolicy.defersTo).toContain("people_culture_manager");
  });
});

describe("Sprint 33M procedural fairness and people evidence", () => {
  it("does not convert allegation into established fact", () => {
    expect(classifyEvidence({ source: "manager_statement", verified: false })).toBe("ALLEGATION");
    expect(classifyEvidence({ source: "verified_record", verified: true })).toBe("ESTABLISHED_FACT");
    expect(PEOPLE_CULTURE_MANAGER_DNA.outputSchema.validationRules.join(" ")).toContain("allegation");
  });

  it("does not discard employee response where required", () => {
    expect(assessPeopleMatter({
      employeeResponsePresent: false,
      currentPolicy: "CURRENT",
    })).toBe("BLOCKED_MISSING_RESPONSE");
    expect(PEOPLE_CULTURE_MANAGER_DNA.professionalBoundaries.cannotDo).toContain("ignore employee response where required for procedural fairness");
  });

  it("old warning or memory does not prove current misconduct", () => {
    expect(assessPeopleMatter({
      oldWarningOnly: true,
      employeeResponsePresent: true,
      currentPolicy: "CURRENT",
    })).toBe("INSUFFICIENT_EVIDENCE");
    expect(classifyEvidence({ source: "memory" })).toBe("INFERENCE");
    expect(PEOPLE_CULTURE_MANAGER_DNA.learningPolicy.conflictLearning).toContain("Memory must not become proof");
  });

  it("superseded policy is not current policy", () => {
    expect(assessPeopleMatter({
      employeeResponsePresent: true,
      currentPolicy: "SUPERSEDED",
    })).toBe("INSUFFICIENT_EVIDENCE");
    expect(JSON.stringify(PEOPLE_CULTURE_MANAGER_DNA)).toContain("superseded");
  });

  it("staffing pressure does not bypass procedural fairness", () => {
    const dna = JSON.stringify(PEOPLE_CULTURE_MANAGER_DNA);

    expect(dna).toContain("Staffing pressure does not remove procedural fairness");
    expect(dna).toContain("staffing pressure being used to bypass fair process");
  });

  it("missing evidence prevents evidence-free misconduct findings", () => {
    expect(assessPeopleMatter({
      allegationOnly: true,
      employeeResponsePresent: true,
      currentPolicy: "CURRENT",
    })).toBe("INSUFFICIENT_EVIDENCE");
    expect(profile.prohibitedActions).toContain("evidence_free_misconduct_finding");
  });

  it("current evidence can supersede stale performance history", () => {
    expect(assessPeopleMatter({
      currentEvidenceImproved: true,
      employeeResponsePresent: true,
      currentPolicy: "CURRENT",
    })).toBe("COMPLETE");
    expect(PEOPLE_CULTURE_MANAGER_DNA.confidenceModel.confidenceReducers).toContain("policy, contract or role expectation is superseded or unverified");
  });

  it("authority/currentness conflict handling favours current authority over stale memory", () => {
    const fwo = getAuthorityRegistryEntries().find(entry => entry.id === "ar-au-004")!;
    const staleMemory: typeof fwo = {
      ...fwo,
      id: "memory-old-hr-practice",
      name: "Old HR practice memory",
      sourceClass: "organisation_policy",
      evidenceAuthorityClass: "supporting",
      currentness: { status: "historical", verifiedAt: "2025-01-01" },
      applicableWorkforceDomains: ["people_culture"],
    };

    expect(scoreAuthorityForContext(fwo, { jurisdiction: "AU", subjectArea: "employment", workforceDomain: "people_culture", professionalDomain: "WORKFORCE", requireCurrent: true }))
      .toBeGreaterThan(scoreAuthorityForContext(staleMemory, { jurisdiction: "AU", subjectArea: "employment", workforceDomain: "people_culture", professionalDomain: "WORKFORCE", requireCurrent: true }));
  });

  it("surfaces conflicting employee and manager accounts instead of inventing certainty", () => {
    expect(assessPeopleMatter({
      conflictingAccounts: true,
      employeeResponsePresent: true,
      currentPolicy: "CURRENT",
    })).toBe("CONFLICT_SURFACED");
    expect(PEOPLE_CULTURE_MANAGER_DNA.evidenceStandards.contradictionPolicy).toContain("present the conflict");
  });

  it("handles workplace adjustment and inclusion without unsupported health inferences", () => {
    const dna = JSON.stringify(PEOPLE_CULTURE_MANAGER_DNA);
    const ahrc = getAuthorityRegistryEntries().find(entry => entry.id === "ar-au-011")!;

    expect(dna).toContain("without inferring health conditions or protected attributes without evidence");
    expect(ahrc.applicableWorkforceDomains).toContain("people_culture");
  });
});

describe("Sprint 33M WorkerProfile and OpenClaw boundaries", () => {
  it("permits HR report drafting but approval-gates formal outcomes", () => {
    const draft = evaluateWorkerProfileAuthority({
      specialistCode: "people_culture_manager",
      workerProfile: profile,
      actionIdentifier: "draft_employee_relations_report",
      actionType: "create_file",
      executionChannel: "document_store",
      toolCategory: "document_tools",
      connectorCategory: "document_management",
    });
    const formalOutcome = evaluateWorkerProfileAuthority({
      specialistCode: "people_culture_manager",
      workerProfile: profile,
      actionIdentifier: "publish_performance_outcome",
      actionType: "update_file",
      executionChannel: "internal_api",
      toolCategory: "data_tools",
      connectorCategory: "hr_system",
    });

    expect(draft.decision).toBe("PERMITTED");
    expect(formalOutcome.decision).toBe("APPROVAL_REQUIRED");
  });

  it("cannot autonomously terminate and approval cannot override prohibited actions", () => {
    const terminate = evaluateWorkerProfileAuthority({
      specialistCode: "people_culture_manager",
      workerProfile: profile,
      actionIdentifier: "terminate_employee",
      actionType: "update_file",
      executionChannel: "internal_api",
      toolCategory: "data_tools",
      connectorCategory: "hr_system",
      approvalGranted: true,
    });

    expect(terminate.decision).toBe("PROHIBITED");
  });

  it("cannot certify credentials, calculate payroll, publish rosters or make legal decisions", () => {
    for (const actionIdentifier of [
      "certify_worker_credential",
      "make_payroll_determination",
      "publish_roster",
      "provide_legal_advice",
    ]) {
      const decision = evaluateWorkerProfileAuthority({
        specialistCode: "people_culture_manager",
        workerProfile: profile,
        actionIdentifier,
        actionType: "update_file",
        executionChannel: "internal_api",
        toolCategory: "data_tools",
        approvalGranted: true,
      });
      expect(decision.decision).toBe("PROHIBITED");
    }
  });

  it("OpenClaw execution package remains constrained by WorkerProfile", () => {
    const pkg = makePackage();
    const decision = validateOpenClawExecutionPackageAuthority({ pkg, workerProfile: profile });

    expect(decision.decision).toBe("PERMITTED");
    expect(pkg.workforceRole).toBe("people_culture_manager");
    expect(pkg.workerProfile.prohibitedActions).toContain("terminate_employee");
    expect(pkg.workerProfile.prohibitedActions).toContain("evidence_free_misconduct_finding");
    expect(pkg.workerProfile.requiresApprovalFor).toContain("publish_performance_outcome");
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
