/**
 * Sprint 33G — Workforce Rostering Coordinator v2
 *
 * Proves WRC is the current-v2 owner for roster construction, shift allocation,
 * coverage, vacancies, optimisation and exception management without becoming
 * Service Delivery, Operations, Workforce Compliance, Payroll, P&C, clinical,
 * BSP, RP or legal authority.
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

const ORG_ID = "org-sprint33g";
const wrcProfile = getWorkerProfileByCode("workforce_rostering_coordinator_profile")!;

function makePackage(overrides: Partial<ExecutionPackage> = {}): ExecutionPackage {
  const workerProfile = buildWorkerProfileExecutionConstraints(wrcProfile);
  return {
    executionId: "exec-33g",
    taskId: "task-33g",
    tenantId: ORG_ID,
    workforceRole: "workforce_rostering_coordinator",
    specialistManifest: {
      manifestVersion: 1,
      workforceRole: "workforce_rostering_coordinator",
      displayName: "Workforce Rostering Coordinator",
      domain: "rostering",
      dnaProfileId: "workforce_rostering_coordinator",
      dnaVersion: "1.0.0",
      manifestHash: "sha256:wrc-manifest",
      generatedAt: new Date().toISOString(),
      specialistId: "workforce_rostering_coordinator",
      identity: {
        specialistId: "workforce_rostering_coordinator",
        displayName: "Workforce Rostering Coordinator",
        title: "Workforce Rostering Coordinator",
        domainFamily: "operations",
        roleType: "specialist",
        seniorityLevel: "senior",
        specialistKind: "current_v2",
        descriptor: "Roster Construction & Workforce Coverage Coordinator",
      },
      mission: {
        missionStatement: "Construct rosters from verified requirements, availability and eligibility.",
        primaryPurpose: "Roster construction and coverage",
        responsibilities: [],
        nonResponsibilities: [],
        successDefinition: [],
      },
      expertise: { domains: [], subdomains: [], capabilityClaims: [], knowledgeBoundaries: [], regulatoryDomains: [] },
      competencies: [],
      professionalPractice: { practicePrinciples: [], qualityStandards: [], professionalIndependence: [], challengeBehaviour: [], assumptionDiscipline: [], decisionDiscipline: [] },
      reasoningModel: { approach: [], mandatorySteps: [], prioritisationLogic: [], contradictionHandling: [], assumptionHandling: [], pauseOrEscalateConditions: [] },
      evidenceModel: { evidencePhilosophy: [], sourcePreference: [], corroborationRules: [], factualClaimDiscipline: [], insufficientEvidenceBehaviour: [], confidenceExpression: [] },
      boundaryModel: { prohibitedBehaviours: [], outOfScopeDecisions: [], authorityLimitPrinciples: [], mustNotRepresentAs: [], mustDeferWhen: [], humanReviewTriggers: [] },
      riskAndUncertaintyModel: { riskPosture: "managed", confidenceThresholds: {}, uncertaintyBehaviour: [], escalationThresholds: [], highRiskTriggers: [] },
      collaborationModel: { canConsultDomains: [], shouldConsultDomains: [], mustConsultDomains: [], deferToDomains: [], peerReviewByDomains: [], challengeConditions: [], cannotOverrideDomains: [], disagreementEscalation: [] },
      communicationModel: { tone: "professional", detailLevel: "concise", structurePreference: "structured", audienceAdaptation: [], uncertaintyLanguage: [], escalationLanguage: [], prohibitedCommunicationPatterns: [] },
      memoryBehaviour: { relevantMemoryCategories: [], recencyPreference: "current", priorConclusionReliance: "revalidate", reconsiderationTriggers: [], memoryUseLimits: [] },
      regulatoryAwareness: { regulatoryDomains: [], authoritativeSourcePreference: [], currentSourceRequired: false, doNotInventRegulation: true, citationExpectation: "cite where relevant", changedGuidanceReviewRequired: false },
      organisationContextUse: { allowedContextTypes: [], contextVerificationBehaviour: "verify", organisationPreferenceHandling: "respect verified context", conflictWithProfessionalStandardBehaviour: "surface conflict", sensitiveEntityHandling: [] },
      blueprintInteraction: { mustFollowBlueprintContract: true, blueprintChallengeConditions: [], missingBlueprintBehaviour: "continue only where safe", workProductBoundaryRespect: "do not exceed contract", evidenceContractRespect: "respect evidence contract" },
      workerProfileReference: {
        profileCode: wrcProfile.code,
        minimumExperienceLevel: "senior",
        dedicatedProfileRequired: true,
        version: wrcProfile.version,
      },
      runtimeProjection: { projectionVersion: "1.0.0", promptContext: [], policyInputs: [], referenceOnly: [], excludedFromRuntime: [] },
    },
    runtimeInstructions: {
      instruction: "Execute roster planning only.",
      instructionHash: "sha256:wrc-instruction",
      manifestHash: "sha256:wrc-manifest",
      dnaVersion: "1.0.0",
      specialistId: "workforce_rostering_coordinator",
      compiledAt: new Date().toISOString(),
    },
    workerProfile,
    steps: [{
      sequence: 1,
      specialist: "workforce_rostering_coordinator",
      action: "execute",
      description: "Prepare draft roster",
      requiresApproval: false,
    }],
    requestedTools: [...wrcProfile.allowedToolCategories],
    requestedChannels: [...workerProfile.allowedChannels],
    requestedConnectorCategories: [...wrcProfile.allowedConnectorCategories],
    approvalState: "not_required",
    constraints: {
      maxDurationSeconds: 300,
      requireHumanApprovalBeforeSubmit: false,
      allowedDataCategories: ["task_context", "roster_records"],
    },
    callbackUrl: "",
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
    issuedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("Sprint 33G current-v2 activation", () => {
  it("activates WRC as a complete current-v2 role", () => {
    const wrc = getSpecialistByCode("workforce_rostering_coordinator");
    expect(wrc).toBeDefined();
    expect(wrc!.executionStatus).toBe("available");
    expect(wrc!.dnaStatus).toBe("approved");
    expect(wrc!.workerProfileCodes).toEqual(["workforce_rostering_coordinator_profile"]);
    expect(hasActiveIntelligence("workforce_rostering_coordinator")).toBe(true);
  });

  it("resolves active DNA and canonical WorkforceDNA", () => {
    const legacy = getDNAProfile("workforce_rostering_coordinator");
    const canonical = getCanonicalDNAProfile("workforce_rostering_coordinator");

    expect(legacy).toBe(WORKFORCE_ROSTERING_COORDINATOR_DNA);
    expect(canonical).not.toBeNull();
    expect(canonical!.identity.specialistId).toBe("workforce_rostering_coordinator");
    expect(canonical!.professionalMission.missionStatement).toContain("verified coverage requirements");
    expect(canonical!.domainExpertise.competencies.length).toBeGreaterThanOrEqual(10);
    expect(canonical!.requiredWorkerProfile.profileCode).toBe("workforce_rostering_coordinator_profile");
  });

  it("is available for conversation and dispatch", async () => {
    _clearWorkforceCache();
    const ctx = await getConversationWorkforceContext(ORG_ID);
    const wrc = ctx.specialists.find(s => s.code === "workforce_rostering_coordinator");

    expect(wrc).toBeDefined();
    expect(wrc!.availableForConversation).toBe(true);
    expect(wrc!.availableForDispatch).toBe(true);
    expect(wrc!.runtimeReady).toBe(true);
  });
});

describe("Sprint 33G professional rostering scenarios", () => {
  it("does not solve 2:1 coverage by silently scheduling 1:1", () => {
    const dna = JSON.stringify(WORKFORCE_ROSTERING_COORDINATOR_DNA);

    expect(dna).toContain("If the requirement is 2:1 support, create two required positions");
    expect(dna).toContain("show the vacancy or conflict instead of pretending coverage is complete");
  });

  it("does not infer current availability from historical Monday work patterns", () => {
    const dna = JSON.stringify(WORKFORCE_ROSTERING_COORDINATOR_DNA);

    expect(dna).toContain("A worker normally working Monday does not prove current Monday availability");
    expect(dna).toContain("old availability is not current availability");
  });

  it("does not treat expired or unverified credentials as eligible", () => {
    const dna = JSON.stringify(WORKFORCE_ROSTERING_COORDINATOR_DNA);

    expect(dna).toContain("Do not self-certify expired or unverified credentials");
    expect(dna).toContain("expired, unverified or contradictory");
  });

  it("keeps cost optimisation subordinate to mandatory constraints", () => {
    const dna = JSON.stringify(WORKFORCE_ROSTERING_COORDINATOR_DNA);

    expect(dna).toContain("Cost optimisation and neatness must never override");
    expect(dna).toContain("Optimise rosters only after mandatory service");
  });

  it("defers payroll, SCHADS, HR, compliance, service and clinical/domain authority to the correct owners", () => {
    const defers = WORKFORCE_ROSTERING_COORDINATOR_DNA.conflictPolicy.defersTo.join(" ");

    expect(defers).toContain("service_delivery_coordinator");
    expect(defers).toContain("operations_manager");
    expect(defers).toContain("workforce_compliance_specialist");
    expect(defers).toContain("payroll_workforce_cost_officer");
    expect(defers).toContain("people_culture_manager");
    expect(defers).toContain("external_clinical_professional");
    expect(defers).toContain("legal_or_industrial_authority");
  });
});

describe("Sprint 33G capabilities and Blueprint contracts", () => {
  it("makes roster capabilities WRC-owned while preserving Operations as support", () => {
    for (const code of [
      "roster.review",
      "roster.plan",
      "roster.coverage",
      "roster.vacancy_management",
      "roster.optimisation",
      "roster.exception_review",
    ]) {
      const cap = getCapability(code);
      expect(cap, code).toBeDefined();
      expect(cap!.eligibleRoles[0], code).toBe("workforce_rostering_coordinator");
      expect(cap!.requiredWorkerProfiles, code).toEqual(["workforce_rostering_coordinator_profile"]);
      expect(cap!.executionAllowed, code).toBe(true);
    }
    expect(validateSpecialistEligibilitySync("workforce_rostering_coordinator", "roster.review")).toBe(true);
  });

  it("keeps workforce capacity as Operations-owned support, not WRC authority", () => {
    const cap = getCapability("operations.capacity_analysis");

    expect(cap?.eligibleRoles[0]).toBe("operations_manager");
    expect(cap?.eligibleRoles).toContain("workforce_rostering_coordinator");
  });

  it("marks roster Blueprints as WRC-owned work-product contracts with external authority boundaries", () => {
    const plan = getRegistryEntry("roster_planning");
    const fatigue = getRegistryEntry("rostering_fatigue_review");

    expect(plan?.futureOwnerRoleCode).toBe("workforce_rostering_coordinator");
    expect(plan?.externalAuthorityRequiredFor).toEqual(expect.arrayContaining([
      "service requirement determination",
      "credential or qualification certification",
      "final SCHADS, payroll or industrial determination",
    ]));
    expect(fatigue?.futureOwnerRoleCode).toBe("workforce_rostering_coordinator");
    expect(fatigue?.externalAuthorityRequiredFor).toContain("final SCHADS or industrial determination");
  });

  it("resolves roster Blueprint intents", () => {
    expect(resolveIntent("roster.plan")?.code).toBe("roster_planning");
    expect(resolveIntent("roster.fatigue_review")?.code).toBe("rostering_fatigue_review");
  });
});

describe("Sprint 33G WorkerProfile authority", () => {
  it("resolves profile mapping for WRC", () => {
    expect(wrcProfile).toBeDefined();
    expect(getWorkerProfilesForRole("workforce_rostering_coordinator").map(p => p.code))
      .toEqual(["workforce_rostering_coordinator_profile"]);
  });

  it("permits draft roster planning in allowed surfaces", () => {
    const decision = evaluateWorkerProfileAuthority({
      specialistCode: "workforce_rostering_coordinator",
      workerProfile: wrcProfile,
      actionIdentifier: "draft_roster_plan",
      actionType: "create_file",
      executionChannel: "document_store",
      toolCategory: "document_tools",
    });

    expect(decision.decision).toBe("PERMITTED");
  });

  it("holds active roster publication and material changes for approval", () => {
    for (const actionIdentifier of [
      "publish_roster",
      "materially_modify_active_roster",
      "replace_assigned_worker_after_publication",
    ]) {
      const decision = evaluateWorkerProfileAuthority({
        specialistCode: "workforce_rostering_coordinator",
        workerProfile: wrcProfile,
        actionIdentifier,
        actionType: "update_file",
        executionChannel: "calendar_system",
        toolCategory: "calendar_tools",
      });

      expect(decision.decision, actionIdentifier).toBe("APPROVAL_REQUIRED");
    }
  });

  it("permits approval-gated roster publication only when approval is present", () => {
    const decision = evaluateWorkerProfileAuthority({
      specialistCode: "workforce_rostering_coordinator",
      workerProfile: wrcProfile,
      actionIdentifier: "publish_roster",
      actionType: "update_file",
      executionChannel: "calendar_system",
      toolCategory: "calendar_tools",
      approvalGranted: true,
    });

    expect(decision.decision).toBe("PERMITTED");
    expect(decision.approved).toBe(true);
  });

  it("keeps support ratio, credential, payroll, SCHADS, HR, clinical, BSP and RP actions prohibited even with approval", () => {
    for (const actionIdentifier of [
      "change_required_support_ratio",
      "invent_worker_availability",
      "certify_worker_credential",
      "calculate_final_pay_entitlement",
      "make_final_schads_determination",
      "make_disciplinary_decision",
      "make_clinical_decision",
      "modify_behaviour_support_plan",
      "authorise_restrictive_practice",
    ]) {
      const decision = evaluateWorkerProfileAuthority({
        specialistCode: "workforce_rostering_coordinator",
        workerProfile: wrcProfile,
        actionIdentifier,
        actionType: "update_file",
        executionChannel: "internal_api",
        toolCategory: "data_tools",
        approvalGranted: true,
      });

      expect(decision.decision, actionIdentifier).toBe("PROHIBITED");
    }
  });

  it("fails closed for unknown executable action", () => {
    const decision = evaluateWorkerProfileAuthority({
      specialistCode: "workforce_rostering_coordinator",
      workerProfile: wrcProfile,
      actionIdentifier: "",
      actionType: "",
      executionChannel: "internal_api",
      toolCategory: "data_tools",
    });

    expect(decision.decision).toBe("UNMAPPED_AUTHORITY");
  });
});

describe("Sprint 33G OpenClaw pre-dispatch parity", () => {
  it("allows an OpenClaw-bound package that stays within WRC WorkerProfile ceiling", () => {
    const decision = validateOpenClawExecutionPackageAuthority({
      pkg: makePackage(),
      workerProfile: wrcProfile,
    });

    expect(decision.decision).toBe("PERMITTED");
    expect(decision.workerProfileCode).toBe("workforce_rostering_coordinator_profile");
  });

  it("blocks OpenClaw packages that grant channels, tools or connectors beyond WRC WorkerProfile", () => {
    expect(validateOpenClawExecutionPackageAuthority({
      pkg: makePackage({ requestedChannels: ["web_browser"] }),
      workerProfile: wrcProfile,
    }).decision).toBe("PROHIBITED");

    expect(validateOpenClawExecutionPackageAuthority({
      pkg: makePackage({ requestedTools: ["payroll_system"] }),
      workerProfile: wrcProfile,
    }).decision).toBe("PROHIBITED");

    expect(validateOpenClawExecutionPackageAuthority({
      pkg: makePackage({ requestedConnectorCategories: ["payroll_system"] }),
      workerProfile: wrcProfile,
    }).decision).toBe("PROHIBITED");
  });

  it("fails closed before OpenClaw dispatch when WorkerProfile is missing", () => {
    const decision = validateOpenClawExecutionPackageAuthority({
      pkg: makePackage(),
      workerProfile: null,
    });

    expect(decision.decision).toBe("UNMAPPED_AUTHORITY");
  });
});
