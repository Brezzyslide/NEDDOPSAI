/**
 * Sprint 33N - Talent & Learning Specialist v2
 *
 * Proves Talent & Learning owns learning needs, capability development,
 * induction, training design and learning effectiveness without becoming
 * People & Culture, Workforce Compliance, Operations, CQM, Policy, SDC, BSI,
 * APO, ISS, clinical, BSP/RP, legal or OpenClaw authority.
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
  PEOPLE_CULTURE_MANAGER_DNA,
  TALENT_LEARNING_SPECIALIST_DNA,
  WORKFORCE_COMPLIANCE_SPECIALIST_DNA,
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

const ORG_ID = "org-sprint33n";
const profile = getWorkerProfileByCode("talent_learning_specialist_profile")!;

type LearningStatus =
  | "ATTENDED"
  | "COMPLETED"
  | "PASSED_KNOWLEDGE_CHECK"
  | "DEMONSTRATED_SKILL"
  | "ASSESSED_COMPETENT"
  | "VERIFIED_CURRENT"
  | "EXPIRED"
  | "PENDING_REASSESSMENT";

type RootCause = "KNOWLEDGE" | "SKILL" | "POLICY_AMBIGUITY" | "CONDUCT" | "CAPACITY" | "COMPLIANCE_TRUTH" | "CLINICAL_AUTHORITY";
type LearningRecommendation = "TRAINING_APPROPRIATE" | "ROUTE_POLICY" | "ROUTE_PEOPLE_CULTURE" | "ROUTE_OPERATIONS" | "ROUTE_WCS" | "ROUTE_EXTERNAL_AUTHORITY";
type EffectivenessFinding = "SUPPORTED" | "INSUFFICIENT_POST_TRAINING_EVIDENCE" | "CORRELATION_NOT_CAUSATION";

function mapRootCause(cause: RootCause): LearningRecommendation {
  switch (cause) {
    case "KNOWLEDGE":
    case "SKILL":
      return "TRAINING_APPROPRIATE";
    case "POLICY_AMBIGUITY":
      return "ROUTE_POLICY";
    case "CONDUCT":
      return "ROUTE_PEOPLE_CULTURE";
    case "CAPACITY":
      return "ROUTE_OPERATIONS";
    case "COMPLIANCE_TRUTH":
      return "ROUTE_WCS";
    case "CLINICAL_AUTHORITY":
      return "ROUTE_EXTERNAL_AUTHORITY";
  }
}

function provesCompetence(status: LearningStatus): boolean {
  return status === "ASSESSED_COMPETENT" || status === "VERIFIED_CURRENT";
}

function evaluateLearningEvidence(input: {
  status?: LearningStatus;
  historical?: boolean;
  futureScheduled?: boolean;
  memoryOnly?: boolean;
  supersededPolicy?: boolean;
}): "CURRENT_COMPETENCE" | "COMPLETION_ONLY" | "HISTORICAL_ONLY" | "NOT_CURRENT" | "MISSING_EVIDENCE" {
  if (!input.status || input.memoryOnly) return "MISSING_EVIDENCE";
  if (input.futureScheduled || input.supersededPolicy || input.status === "EXPIRED") return "NOT_CURRENT";
  if (input.historical) return "HISTORICAL_ONLY";
  return provesCompetence(input.status) ? "CURRENT_COMPETENCE" : "COMPLETION_ONLY";
}

function assessEffectiveness(input: {
  postTrainingEvidence?: boolean;
  improvementAfterTraining?: boolean;
  causalEvidence?: boolean;
}): EffectivenessFinding {
  if (!input.postTrainingEvidence) return "INSUFFICIENT_POST_TRAINING_EVIDENCE";
  if (input.improvementAfterTraining && !input.causalEvidence) return "CORRELATION_NOT_CAUSATION";
  return "SUPPORTED";
}

function makePackage(overrides: Partial<ExecutionPackage> = {}): ExecutionPackage {
  const workerProfile = buildWorkerProfileExecutionConstraints(profile);
  return {
    executionId: "exec-33n",
    taskId: "task-33n",
    tenantId: ORG_ID,
    workforceRole: "talent_learning_specialist",
    specialistManifest: {
      manifestVersion: 1,
      workforceRole: "talent_learning_specialist",
      displayName: "Talent & Learning Specialist",
      domain: "learning and capability development",
      dnaProfileId: "talent_learning_specialist",
      dnaVersion: "1.0.0",
      manifestHash: "sha256:tls-manifest",
      generatedAt: new Date().toISOString(),
      specialistId: "talent_learning_specialist",
    } as ExecutionPackage["specialistManifest"],
    runtimeInstructions: {
      instruction: "Execute learning and capability-development assessment only.",
      instructionHash: "sha256:tls-instruction",
      manifestHash: "sha256:tls-manifest",
      dnaVersion: "1.0.0",
      specialistId: "talent_learning_specialist",
      compiledAt: new Date().toISOString(),
    },
    workerProfile,
    steps: [{
      sequence: 1,
      specialist: "talent_learning_specialist",
      action: "execute",
      description: "Assess learning need and capability response",
      requiresApproval: false,
    }],
    requestedTools: [...profile.allowedToolCategories],
    requestedChannels: [...workerProfile.allowedChannels],
    requestedConnectorCategories: [...profile.allowedConnectorCategories],
    approvalState: "not_required",
    constraints: {
      maxDurationSeconds: 300,
      requireHumanApprovalBeforeSubmit: false,
      allowedDataCategories: ["task_context", "learning_records", "competency_evidence", "policy_evidence"],
    },
    callbackUrl: "",
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
    issuedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("Sprint 33N current-v2 activation", () => {
  it("activates Talent & Learning Specialist as complete current-v2 role", () => {
    const specialist = getSpecialistByCode("talent_learning_specialist");

    expect(specialist).toBeDefined();
    expect(specialist!.executionStatus).toBe("available");
    expect(specialist!.dnaStatus).toBe("approved");
    expect(specialist!.workerProfileCodes).toEqual(["talent_learning_specialist_profile"]);
    expect(hasActiveIntelligence("talent_learning_specialist")).toBe(true);
  });

  it("resolves active DNA and canonical WorkforceDNA", () => {
    const legacy = getDNAProfile("talent_learning_specialist");
    const canonical = getCanonicalDNAProfile("talent_learning_specialist");

    expect(legacy).toBe(TALENT_LEARNING_SPECIALIST_DNA);
    expect(canonical).not.toBeNull();
    expect(canonical!.identity.specialistId).toBe("talent_learning_specialist");
    expect(canonical!.professionalMission.missionStatement).toContain("workforce capability");
    expect(canonical!.domainExpertise.competencies.length).toBeGreaterThanOrEqual(24);
    expect(canonical!.requiredWorkerProfile.profileCode).toBe("talent_learning_specialist_profile");
  });

  it("resolves WorkerProfile and runtime dispatchability", async () => {
    _clearWorkforceCache();
    const profiles = getWorkerProfilesForRole("talent_learning_specialist");
    const ctx = await getConversationWorkforceContext(ORG_ID);
    const learning = ctx.specialists.find(s => s.code === "talent_learning_specialist");

    expect(profiles.map(p => p.code)).toEqual(["talent_learning_specialist_profile"]);
    expect(profile.riskLevel).toBe("high");
    expect(learning).toBeDefined();
    expect(learning!.availableForConversation).toBe(true);
    expect(learning!.availableForDispatch).toBe(true);
    expect(learning!.runtimeReady).toBe(true);
  });

  it("satisfies static DB publication prerequisites", () => {
    const specialist = getSpecialistByCode("talent_learning_specialist")!;
    const dna = getDNAProfile("talent_learning_specialist")!;
    const workerProfiles = getWorkerProfilesForRole("talent_learning_specialist");

    expect(specialist.executionStatus).toBe("available");
    expect(specialist.dnaStatus).toBe("approved");
    expect(dna.currentVersion.isActive).toBe(true);
    expect(dna.currentVersion.version).toBe("1.0.0");
    expect(workerProfiles).toHaveLength(1);
    expect(workerProfiles[0]!.status).toBe("active");
  });
});

describe("Sprint 33N capability and blueprint ownership", () => {
  it("owns learning and capability-development capabilities", () => {
    const capabilityCodes = [
      "learning.needs_analysis",
      "learning.competency_gap_analysis",
      "learning.training_gap_analysis",
      "learning.induction",
      "learning.onboarding",
      "learning.mandatory_training",
      "learning.refresher_training",
      "learning.development_plan",
      "learning.training_plan",
      "learning.effectiveness_review",
      "learning.capability_review",
      "learning.remediation",
      "learning.professional_development",
    ];

    for (const code of capabilityCodes) {
      const cap = getCapability(code);
      expect(cap).toBeDefined();
      expect(cap!.eligibleRoles).toEqual(["talent_learning_specialist"]);
      expect(cap!.requiredWorkerProfiles).toEqual(["talent_learning_specialist_profile"]);
      expect(validateSpecialistEligibilitySync("talent_learning_specialist", code)).toBe(true);
    }
  });

  it("routes learning Blueprints and intents to Talent & Learning", () => {
    const blueprint = getRegistryEntry("learning_capability_development_plan");
    const needsIntent = resolveIntent("learning.needs_analysis");
    const effectivenessIntent = resolveIntent("learning.effectiveness_review");

    expect(blueprint).toBeDefined();
    expect(blueprint!.futureOwnerRoleCode).toBe("talent_learning_specialist");
    expect(blueprint!.supportedModes).toContain("effectiveness_review");
    expect(needsIntent?.isAction).toBe(false);
    expect(effectivenessIntent?.isAction).toBe(false);
    if (effectivenessIntent && !effectivenessIntent.isAction) {
      expect(effectivenessIntent.family).toBe("talent_learning");
      expect(effectivenessIntent.mode).toBe("effectiveness_review");
      expect(effectivenessIntent.code).toBe("learning_capability_development_plan");
    }
  });

  it("preserves P&C, WCS, Operations, CQM and Policy boundaries", () => {
    expect(getCapability("people.performance_management")!.eligibleRoles[0]).toBe("people_culture_manager");
    expect(getCapability("staff_compliance.deployment_eligibility")!.eligibleRoles[0]).toBe("workforce_compliance_specialist");
    expect(getCapability("operations.capacity_analysis")!.eligibleRoles[0]).toBe("operations_manager");
    expect(getCapability("compliance.corrective_actions")!.eligibleRoles[0]).toBe("compliance_quality_manager");
    expect(getCapability("policy.review")!.eligibleRoles[0]).toBe("policy_governance_specialist");
    expect(validateSpecialistEligibilitySync("talent_learning_specialist", "people.performance_management")).toBe(false);
    expect(validateSpecialistEligibilitySync("talent_learning_specialist", "staff_compliance.deployment_eligibility")).toBe(false);
    expect(PEOPLE_CULTURE_MANAGER_DNA.conflictPolicy.defersTo).toContain("talent_learning_specialist");
    expect(WORKFORCE_COMPLIANCE_SPECIALIST_DNA.conflictPolicy.defersTo).toContain("talent_learning_specialist");
  });
});

describe("Sprint 33N learning evidence and root-cause controls", () => {
  it("selects training only for learning or skill root causes", () => {
    expect(mapRootCause("KNOWLEDGE")).toBe("TRAINING_APPROPRIATE");
    expect(mapRootCause("SKILL")).toBe("TRAINING_APPROPRIATE");
    expect(mapRootCause("POLICY_AMBIGUITY")).toBe("ROUTE_POLICY");
    expect(mapRootCause("CONDUCT")).toBe("ROUTE_PEOPLE_CULTURE");
    expect(mapRootCause("CAPACITY")).toBe("ROUTE_OPERATIONS");
    expect(mapRootCause("COMPLIANCE_TRUTH")).toBe("ROUTE_WCS");
    expect(mapRootCause("CLINICAL_AUTHORITY")).toBe("ROUTE_EXTERNAL_AUTHORITY");
  });

  it("distinguishes training completion from competence", () => {
    expect(provesCompetence("ATTENDED")).toBe(false);
    expect(provesCompetence("COMPLETED")).toBe(false);
    expect(provesCompetence("PASSED_KNOWLEDGE_CHECK")).toBe(false);
    expect(provesCompetence("DEMONSTRATED_SKILL")).toBe(false);
    expect(provesCompetence("ASSESSED_COMPETENT")).toBe(true);
    expect(provesCompetence("VERIFIED_CURRENT")).toBe(true);
  });

  it("future scheduled training does not equal current compliance", () => {
    expect(evaluateLearningEvidence({ status: "COMPLETED", futureScheduled: true })).toBe("NOT_CURRENT");
    expect(TALENT_LEARNING_SPECIALIST_DNA.evidenceStandards.insufficiencyIndicators).toContain("future booked training, memory or user assertion is used as current training completion");
  });

  it("historical training does not become current evidence", () => {
    expect(evaluateLearningEvidence({ status: "ASSESSED_COMPETENT", historical: true })).toBe("HISTORICAL_ONLY");
    expect(TALENT_LEARNING_SPECIALIST_DNA.evidenceStandards.contradictionPolicy).toContain("historical attendance");
  });

  it("current policy supersedes stale learning content", () => {
    expect(evaluateLearningEvidence({ status: "COMPLETED", supersededPolicy: true })).toBe("NOT_CURRENT");
    expect(JSON.stringify(TALENT_LEARNING_SPECIALIST_DNA)).toContain("superseded policy");
  });

  it("memory does not prove completion or competence", () => {
    expect(evaluateLearningEvidence({ status: "VERIFIED_CURRENT", memoryOnly: true })).toBe("MISSING_EVIDENCE");
    expect(TALENT_LEARNING_SPECIALIST_DNA.learningPolicy.conflictLearning).toContain("Memory must not become proof");
  });

  it("learning need can be identified from a verified performance gap", () => {
    expect(evaluateLearningEvidence({ status: "PENDING_REASSESSMENT" })).toBe("COMPLETION_ONLY");
    expect(mapRootCause("SKILL")).toBe("TRAINING_APPROPRIATE");
    expect(TALENT_LEARNING_SPECIALIST_DNA.reasoningMethodology.steps.map(step => step.stepId)).toContain("tls.identify_gap");
  });

  it("attendance is not evidence-free competency certification", () => {
    expect(evaluateLearningEvidence({ status: "ATTENDED" })).toBe("COMPLETION_ONLY");
    expect(profile.prohibitedActions).toContain("evidence_free_competency_certification");
    expect(profile.prohibitedActions).toContain("treat_attendance_as_competence");
  });

  it("effectiveness review blocks definitive conclusion without post-training evidence", () => {
    expect(assessEffectiveness({ improvementAfterTraining: true })).toBe("INSUFFICIENT_POST_TRAINING_EVIDENCE");
    expect(TALENT_LEARNING_SPECIALIST_DNA.outputSchema.validationRules.join(" ")).toContain("effectiveness review requires post-training evidence");
  });

  it("training before improvement does not prove causation", () => {
    expect(assessEffectiveness({ postTrainingEvidence: true, improvementAfterTraining: true, causalEvidence: false })).toBe("CORRELATION_NOT_CAUSATION");
    expect(JSON.stringify(TALENT_LEARNING_SPECIALIST_DNA)).toContain("false causation");
  });

  it("uses common authority registry for Talent & Learning relevance", () => {
    const ndisCommission = getAuthorityRegistryEntries().find(entry => entry.id === "ar-au-002")!;
    const fwo = getAuthorityRegistryEntries().find(entry => entry.id === "ar-au-004")!;
    const staleMemory: typeof ndisCommission = {
      ...ndisCommission,
      id: "memory-training-old",
      name: "Old training memory",
      sourceClass: "memory",
      evidenceAuthorityClass: "supporting",
      currentness: { status: "historical", verifiedAt: "2025-01-01" },
      applicableWorkforceDomains: ["talent_learning"],
    };

    expect(ndisCommission.applicableWorkforceDomains).toContain("talent_learning");
    expect(fwo.applicableWorkforceDomains).toContain("talent_learning");
    expect(scoreAuthorityForContext(ndisCommission, { jurisdiction: "AU", subjectArea: "provider_registration", workforceDomain: "talent_learning", professionalDomain: "WORKFORCE", requireCurrent: true }))
      .toBeGreaterThan(scoreAuthorityForContext(staleMemory, { jurisdiction: "AU", subjectArea: "provider_registration", workforceDomain: "talent_learning", professionalDomain: "WORKFORCE", requireCurrent: true }));
  });
});

describe("Sprint 33N WorkerProfile and OpenClaw boundaries", () => {
  it("permits learning report drafting but approval-gates publishing learning programs", () => {
    const draft = evaluateWorkerProfileAuthority({
      specialistCode: "talent_learning_specialist",
      workerProfile: profile,
      actionIdentifier: "draft_learning_needs_analysis",
      actionType: "create_file",
      executionChannel: "document_store",
      toolCategory: "document_tools",
      connectorCategory: "document_management",
    });
    const publishProgram = evaluateWorkerProfileAuthority({
      specialistCode: "talent_learning_specialist",
      workerProfile: profile,
      actionIdentifier: "publish_organisation_wide_learning_program",
      actionType: "update_file",
      executionChannel: "internal_api",
      toolCategory: "data_tools",
      connectorCategory: "hr_system",
    });

    expect(draft.decision).toBe("PERMITTED");
    expect(publishProgram.decision).toBe("APPROVAL_REQUIRED");
  });

  it("cannot certify deployment eligibility or competency even with approval", () => {
    for (const actionIdentifier of [
      "certify_competency_without_authority",
      "evidence_free_competency_certification",
      "declare_deployment_eligibility",
    ]) {
      const decision = evaluateWorkerProfileAuthority({
        specialistCode: "talent_learning_specialist",
        workerProfile: profile,
        actionIdentifier,
        actionType: "update_file",
        executionChannel: "internal_api",
        toolCategory: "data_tools",
        connectorCategory: "hr_system",
        approvalGranted: true,
      });
      expect(decision.decision).toBe("PROHIBITED");
    }
  });

  it("cannot make disciplinary, payroll, roster, clinical, BSP, RP or legal decisions", () => {
    for (const actionIdentifier of [
      "make_disciplinary_decision",
      "make_payroll_determination",
      "publish_roster",
      "make_clinical_decision",
      "author_behaviour_support_plan",
      "authorise_restrictive_practice",
      "provide_legal_advice",
    ]) {
      const decision = evaluateWorkerProfileAuthority({
        specialistCode: "talent_learning_specialist",
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
    expect(pkg.workforceRole).toBe("talent_learning_specialist");
    expect(pkg.workerProfile.prohibitedActions).toContain("evidence_free_competency_certification");
    expect(pkg.workerProfile.prohibitedActions).toContain("declare_deployment_eligibility");
    expect(pkg.workerProfile.requiresApprovalFor).toContain("publish_organisation_wide_learning_program");
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
