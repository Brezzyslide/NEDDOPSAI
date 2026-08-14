/**
 * Sprint 33F — Service Delivery Coordinator v2
 *
 * Proves Service Delivery Coordinator is the current-v2 owner for approved
 * service/support implementation coordination and delivery-fidelity review,
 * without becoming Operations Manager, Rostering, BSI, APO, ISS, clinical,
 * disciplinary or legal authority.
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
  SERVICE_DELIVERY_COORDINATOR_DNA,
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

const ORG_ID = "org-sprint33f";
const sdcProfile = getWorkerProfileByCode("service_delivery_coordinator_profile")!;

function makePackage(overrides: Partial<ExecutionPackage> = {}): ExecutionPackage {
  const workerProfile = buildWorkerProfileExecutionConstraints(sdcProfile);
  return {
    executionId: "exec-33f",
    taskId: "task-33f",
    tenantId: ORG_ID,
    workforceRole: "service_delivery_coordinator",
    specialistManifest: {
      manifestVersion: 1,
      workforceRole: "service_delivery_coordinator",
      displayName: "Service Delivery Coordinator",
      domain: "service delivery",
      dnaProfileId: "service_delivery_coordinator",
      dnaVersion: "1.0.0",
      manifestHash: "sha256:sdc-manifest",
      generatedAt: new Date().toISOString(),
      specialistId: "service_delivery_coordinator",
      identity: {
        specialistId: "service_delivery_coordinator",
        displayName: "Service Delivery Coordinator",
        title: "Service Delivery Coordinator",
        domainFamily: "operations",
        roleType: "specialist",
        seniorityLevel: "senior",
        specialistKind: "current_v2",
        descriptor: "Service Implementation & Delivery Fidelity Coordinator",
      },
      mission: {
        missionStatement: "Coordinate approved support requirements into daily service delivery.",
        primaryPurpose: "Service delivery implementation",
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
        profileCode: sdcProfile.code,
        minimumExperienceLevel: "senior",
        dedicatedProfileRequired: true,
        version: sdcProfile.version,
      },
      runtimeProjection: { projectionVersion: "1.0.0", promptContext: [], policyInputs: [], referenceOnly: [], excludedFromRuntime: [] },
    },
    runtimeInstructions: {
      instruction: "Execute service delivery coordination only.",
      instructionHash: "sha256:sdc-instruction",
      manifestHash: "sha256:sdc-manifest",
      dnaVersion: "1.0.0",
      specialistId: "service_delivery_coordinator",
      compiledAt: new Date().toISOString(),
    },
    workerProfile,
    steps: [{
      sequence: 1,
      specialist: "service_delivery_coordinator",
      action: "execute",
      description: "Prepare service delivery review",
      requiresApproval: false,
    }],
    requestedTools: [...sdcProfile.allowedToolCategories],
    requestedChannels: [...workerProfile.allowedChannels],
    requestedConnectorCategories: [...sdcProfile.allowedConnectorCategories],
    approvalState: "not_required",
    constraints: {
      maxDurationSeconds: 300,
      requireHumanApprovalBeforeSubmit: false,
      allowedDataCategories: ["task_context", "service_delivery_records"],
    },
    callbackUrl: "",
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
    issuedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("Sprint 33F current-v2 activation", () => {
  it("activates Service Delivery Coordinator as a complete current-v2 role", () => {
    const sdc = getSpecialistByCode("service_delivery_coordinator");
    expect(sdc).toBeDefined();
    expect(sdc!.executionStatus).toBe("available");
    expect(sdc!.dnaStatus).toBe("approved");
    expect(sdc!.workerProfileCodes).toEqual(["service_delivery_coordinator_profile"]);
    expect(hasActiveIntelligence("service_delivery_coordinator")).toBe(true);
  });

  it("resolves active DNA and canonical WorkforceDNA without Employee File dependency", () => {
    const legacy = getDNAProfile("service_delivery_coordinator");
    const canonical = getCanonicalDNAProfile("service_delivery_coordinator");

    expect(legacy).toBe(SERVICE_DELIVERY_COORDINATOR_DNA);
    expect(canonical).not.toBeNull();
    expect(canonical!.identity.specialistId).toBe("service_delivery_coordinator");
    expect(canonical!.professionalMission.missionStatement).toContain("approved service");
    expect(canonical!.domainExpertise.competencies.length).toBeGreaterThanOrEqual(9);
    expect(canonical!.requiredWorkerProfile.profileCode).toBe("service_delivery_coordinator_profile");
  });

  it("is available for conversation and dispatch", async () => {
    _clearWorkforceCache();
    const ctx = await getConversationWorkforceContext(ORG_ID);
    const sdc = ctx.specialists.find(s => s.code === "service_delivery_coordinator");

    expect(sdc).toBeDefined();
    expect(sdc!.availableForConversation).toBe(true);
    expect(sdc!.availableForDispatch).toBe(true);
    expect(sdc!.runtimeReady).toBe(true);
  });
});

describe("Sprint 33F professional service-delivery discipline", () => {
  it("makes current approved requirements govern over historical arrangements", () => {
    const dna = JSON.stringify(SERVICE_DELIVERY_COORDINATOR_DNA);

    expect(dna).toContain("Current approved plans and agreements outrank historical arrangements");
    expect(dna).toContain("Historical arrangements must not silently remain active");
  });

  it("distinguishes ambiguous evidence from proven non-delivery", () => {
    const dna = JSON.stringify(SERVICE_DELIVERY_COORDINATOR_DNA);

    expect(dna).toContain("Missing documentation is not proof of non-delivery");
    expect(dna).toContain("ambiguous evidence");
  });

  it("does not treat activity as participant goal achievement", () => {
    const dna = JSON.stringify(SERVICE_DELIVERY_COORDINATOR_DNA);

    expect(dna).toContain("Activity is not the same as outcome achievement");
    expect(dna).toContain("Do not claim a goal was achieved merely because an activity occurred");
  });

  it("routes BSP, RP, incident, capacity, rostering, workforce and clinical boundaries to the correct owner", () => {
    const defers = SERVICE_DELIVERY_COORDINATOR_DNA.conflictPolicy.defersTo.join(" ");

    expect(defers).toContain("operations_manager");
    expect(defers).toContain("workforce_rostering_coordinator");
    expect(defers).toContain("behaviour_support_implementation_specialist");
    expect(defers).toContain("authorised_program_officer");
    expect(defers).toContain("incident_safeguarding_specialist");
    expect(defers).toContain("compliance_quality_manager");
    expect(defers).toContain("external_clinical_professional");
    expect(defers).toContain("external_behaviour_support_practitioner");
  });
});

describe("Sprint 33F capabilities and Blueprint contracts", () => {
  it("makes service delivery review SDC-owned while preserving operational support roles", () => {
    const cap = getCapability("service_delivery.review");

    expect(cap).toBeDefined();
    expect(cap!.eligibleRoles[0]).toBe("service_delivery_coordinator");
    expect(cap!.eligibleRoles).toEqual(expect.arrayContaining(["operations_manager", "process_asset_coordinator"]));
    expect(cap!.requiredWorkerProfiles).toEqual(["service_delivery_coordinator_profile"]);
    expect(cap!.executionAllowed).toBe(true);
    expect(validateSpecialistEligibilitySync("service_delivery_coordinator", "service_delivery.review")).toBe(true);
  });

  it("marks care/support Blueprints as SDC-owned work-product contracts with external professional boundaries", () => {
    const care = getRegistryEntry("care_plan");
    const individual = getRegistryEntry("individual_support_plan");
    const sil = getRegistryEntry("sil_support_plan");

    expect(care?.futureOwnerRoleCode).toBe("service_delivery_coordinator");
    expect(individual?.futureOwnerRoleCode).toBe("service_delivery_coordinator");
    expect(sil?.futureOwnerRoleCode).toBe("service_delivery_coordinator");
    expect(individual?.externalAuthorityRequiredFor).toEqual(expect.arrayContaining([
      "clinical assessment or care planning",
      "formal Behaviour Support Plan strategy, authorship or amendment",
      "restrictive-practice authorisation or governance",
    ]));
    expect(sil?.externalAuthorityRequiredFor).toContain("roster construction and individual staff allocation");
  });

  it("resolves care/support intents to service-delivery work-product contracts", () => {
    expect(resolveIntent("care_plan.create")?.code).toBe("care_plan");
    expect(resolveIntent("support_plan.create")?.code).toBe("individual_support_plan");
    expect(resolveIntent("support_plan.review")?.code).toBe("individual_support_plan");
  });
});

describe("Sprint 33F WorkerProfile authority", () => {
  it("resolves profile mapping for the SDC role", () => {
    expect(sdcProfile).toBeDefined();
    expect(getWorkerProfilesForRole("service_delivery_coordinator").map(p => p.code))
      .toEqual(["service_delivery_coordinator_profile"]);
  });

  it("permits internal drafting and analysis in allowed surfaces", () => {
    const decision = evaluateWorkerProfileAuthority({
      specialistCode: "service_delivery_coordinator",
      workerProfile: sdcProfile,
      actionIdentifier: "draft_service_delivery_review",
      actionType: "create_file",
      executionChannel: "document_store",
      toolCategory: "document_tools",
    });

    expect(decision.decision).toBe("PERMITTED");
  });

  it("holds participant outcome publication and material changes for approval", () => {
    for (const actionIdentifier of [
      "generate_participant_outcome_report",
      "recommend_material_service_plan_change",
      "send_external_service_communication",
    ]) {
      const decision = evaluateWorkerProfileAuthority({
        specialistCode: "service_delivery_coordinator",
        workerProfile: sdcProfile,
        actionIdentifier,
        actionType: "create_file",
        executionChannel: "internal_api",
        toolCategory: "reporting_tools",
      });

      expect(decision.decision, actionIdentifier).toBe("APPROVAL_REQUIRED");
    }
  });

  it("allows approved approval-gated service reporting", () => {
    const decision = evaluateWorkerProfileAuthority({
      specialistCode: "service_delivery_coordinator",
      workerProfile: sdcProfile,
      actionIdentifier: "generate_participant_outcome_report",
      actionType: "create_file",
      executionChannel: "internal_api",
      toolCategory: "reporting_tools",
      approvalGranted: true,
    });

    expect(decision.decision).toBe("PERMITTED");
    expect(decision.approved).toBe(true);
  });

  it("keeps clinical, BSP, RP, rostering, disciplinary, legal and evidence-free outcome actions prohibited even with approval", () => {
    for (const actionIdentifier of [
      "make_clinical_decision",
      "author_behaviour_support_plan",
      "amend_behaviour_support_plan",
      "authorise_restrictive_practice",
      "construct_roster",
      "assign_staff_to_shift",
      "make_disciplinary_finding",
      "make_legal_determination",
      "certify_participant_outcome_without_evidence",
    ]) {
      const decision = evaluateWorkerProfileAuthority({
        specialistCode: "service_delivery_coordinator",
        workerProfile: sdcProfile,
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
      specialistCode: "service_delivery_coordinator",
      workerProfile: sdcProfile,
      actionIdentifier: "",
      actionType: "",
      executionChannel: "internal_api",
      toolCategory: "data_tools",
    });

    expect(decision.decision).toBe("UNMAPPED_AUTHORITY");
  });
});

describe("Sprint 33F OpenClaw pre-dispatch parity", () => {
  it("allows an OpenClaw-bound package that stays within SDC WorkerProfile ceiling", () => {
    const decision = validateOpenClawExecutionPackageAuthority({
      pkg: makePackage(),
      workerProfile: sdcProfile,
    });

    expect(decision.decision).toBe("PERMITTED");
    expect(decision.workerProfileCode).toBe("service_delivery_coordinator_profile");
  });

  it("blocks OpenClaw packages that grant channels, tools or connectors beyond SDC WorkerProfile", () => {
    expect(validateOpenClawExecutionPackageAuthority({
      pkg: makePackage({ requestedChannels: ["web_browser"] }),
      workerProfile: sdcProfile,
    }).decision).toBe("PROHIBITED");

    expect(validateOpenClawExecutionPackageAuthority({
      pkg: makePackage({ requestedTools: ["rostering_write_tools"] }),
      workerProfile: sdcProfile,
    }).decision).toBe("PROHIBITED");

    expect(validateOpenClawExecutionPackageAuthority({
      pkg: makePackage({ requestedConnectorCategories: ["clinical_record_system"] }),
      workerProfile: sdcProfile,
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
