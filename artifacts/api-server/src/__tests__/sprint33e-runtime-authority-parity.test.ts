import { describe, expect, it } from "vitest";
import type { BlueprintExecutionContractSnapshot, ExecutionPackage } from "@workspace/agent-runtime";
import { translateToOpenClawPackage, loadOpenClawConfig } from "@workspace/openclaw";
import { getWorkerProfileByCode } from "../lib/workerProfileRegistry.js";
import {
  buildWorkerProfileExecutionConstraints,
  validateOpenClawExecutionPackageAuthority,
} from "../services/executionService.js";
import {
  evaluateWorkerProfileAuthority,
  parseExecutionActions,
  validateExecutionActions,
} from "../services/executionActionService.js";

const operationsProfile = getWorkerProfileByCode("operations_manager_profile")!;

function makePackage(overrides: Partial<ExecutionPackage> = {}): ExecutionPackage {
  const workerProfile = buildWorkerProfileExecutionConstraints(operationsProfile);
  return {
    executionId: "exec-33e",
    taskId: "task-33e",
    tenantId: "org-33e",
    workforceRole: "operations_manager",
    specialistManifest: {
      manifestVersion: 1,
      workforceRole: "operations_manager",
      displayName: "Operations Manager",
      domain: "operations",
      dnaProfileId: "operations_manager",
      dnaVersion: "2.0.0",
      manifestHash: "sha256:test-manifest",
      generatedAt: new Date().toISOString(),
      specialistId: "operations_manager",
      identity: {
        specialistId: "operations_manager",
        displayName: "Operations Manager",
        title: "Operations Manager",
        domainFamily: "operations",
        roleType: "specialist",
        seniorityLevel: "manager",
        specialistKind: "current_v2",
        descriptor: "Operations Manager",
      },
      mission: {
        missionStatement: "Coordinate operational execution.",
        primaryPurpose: "Operations delivery",
        responsibilities: [],
        nonResponsibilities: [],
        successDefinition: [],
      },
      expertise: {
        domains: [],
        subdomains: [],
        capabilityClaims: [],
        knowledgeBoundaries: [],
        regulatoryDomains: [],
      },
      competencies: [],
      professionalPractice: {
        practicePrinciples: [],
        qualityStandards: [],
        professionalIndependence: [],
        challengeBehaviour: [],
        assumptionDiscipline: [],
        decisionDiscipline: [],
      },
      reasoningModel: {
        approach: [],
        mandatorySteps: [],
        prioritisationLogic: [],
        contradictionHandling: [],
        assumptionHandling: [],
        pauseOrEscalateConditions: [],
      },
      evidenceModel: {
        evidencePhilosophy: [],
        sourcePreference: [],
        corroborationRules: [],
        factualClaimDiscipline: [],
        insufficientEvidenceBehaviour: [],
        confidenceExpression: [],
      },
      boundaryModel: {
        prohibitedBehaviours: [],
        outOfScopeDecisions: [],
        authorityLimitPrinciples: [],
        mustNotRepresentAs: [],
        mustDeferWhen: [],
        humanReviewTriggers: [],
      },
      riskAndUncertaintyModel: {
        riskPosture: "managed",
        confidenceThresholds: {},
        uncertaintyBehaviour: [],
        escalationThresholds: [],
        highRiskTriggers: [],
      },
      collaborationModel: {
        canConsultDomains: [],
        shouldConsultDomains: [],
        mustConsultDomains: [],
        deferToDomains: [],
        peerReviewByDomains: [],
        challengeConditions: [],
        cannotOverrideDomains: [],
        disagreementEscalation: [],
      },
      communicationModel: {
        tone: "professional",
        detailLevel: "concise",
        structurePreference: "structured",
        audienceAdaptation: [],
        uncertaintyLanguage: [],
        escalationLanguage: [],
        prohibitedCommunicationPatterns: [],
      },
      memoryBehaviour: {
        relevantMemoryCategories: [],
        recencyPreference: "current",
        priorConclusionReliance: "revalidate",
        reconsiderationTriggers: [],
        memoryUseLimits: [],
      },
      regulatoryAwareness: {
        regulatoryDomains: [],
        authoritativeSourcePreference: [],
        currentSourceRequired: false,
        doNotInventRegulation: true,
        citationExpectation: "cite where relevant",
        changedGuidanceReviewRequired: false,
      },
      organisationContextUse: {
        allowedContextTypes: [],
        contextVerificationBehaviour: "verify",
        organisationPreferenceHandling: "respect verified context",
        conflictWithProfessionalStandardBehaviour: "surface conflict",
        sensitiveEntityHandling: [],
      },
      blueprintInteraction: {
        mustFollowBlueprintContract: true,
        blueprintChallengeConditions: [],
        missingBlueprintBehaviour: "continue only where safe",
        workProductBoundaryRespect: "do not exceed contract",
        evidenceContractRespect: "respect evidence contract",
      },
      workerProfileReference: {
        profileCode: operationsProfile.code,
        minimumExperienceLevel: "current_v2",
        dedicatedProfileRequired: true,
        version: operationsProfile.version,
      },
      runtimeProjection: {
        projectionVersion: "1.0.0",
        promptContext: [],
        policyInputs: [],
        referenceOnly: [],
        excludedFromRuntime: [],
      },
    },
    runtimeInstructions: {
      instruction: "Execute within NeedsOps authority.",
      instructionHash: "sha256:test-instruction",
      manifestHash: "sha256:test-manifest",
      dnaVersion: "2.0.0",
      specialistId: "operations_manager",
      compiledAt: new Date().toISOString(),
    },
    workerProfile,
    steps: [{
      sequence: 1,
      specialist: "operations_manager",
      action: "execute",
      description: "Execute approved operations work",
      requiresApproval: false,
    }],
    requestedTools: [...operationsProfile.allowedToolCategories],
    requestedChannels: [...workerProfile.allowedChannels],
    requestedConnectorCategories: [...operationsProfile.allowedConnectorCategories],
    approvalState: "approved",
    constraints: {
      maxDurationSeconds: 300,
      requireHumanApprovalBeforeSubmit: false,
      allowedDataCategories: ["task_context", "internal"],
    },
    callbackUrl: "",
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
    issuedAt: new Date().toISOString(),
    ...overrides,
  };
}

function blueprintContract(overrides: Partial<BlueprintExecutionContractSnapshot> = {}): BlueprintExecutionContractSnapshot {
  return {
    blueprintCode: "operations_process_review",
    blueprintVersion: "1.0.0",
    blueprintId: "bp-33e",
    blueprintFamily: "operations",
    primarySpecialist: "operations_manager",
    supportingSpecialists: [],
    professionalAuthority: "needsops_ai",
    primaryDeliverable: "Operations review",
    deliverableContract: null,
    evidenceContract: null,
    requiredSections: ["findings", "recommendations"],
    requiredTemplate: null,
    prohibitedActions: ["delete_data"],
    approvalRequirements: ["publish_external"],
    externalAuthorityRequiredFor: [],
    ...overrides,
  };
}

describe("Sprint 33E.1 — fail-closed WorkerProfile authority", () => {
  it("permits OpenClaw package authority when WorkerProfile and package constraints match", () => {
    const pkg = makePackage();
    const decision = validateOpenClawExecutionPackageAuthority({
      pkg,
      workerProfile: operationsProfile,
    });

    expect(decision.decision).toBe("PERMITTED");
    expect(decision.workerProfileCode).toBe("operations_manager_profile");
    expect(decision.requestedChannels).toEqual(pkg.requestedChannels);
  });

  it("fails closed when WorkerProfile is missing or unresolved", () => {
    const pkg = makePackage();
    const decision = validateOpenClawExecutionPackageAuthority({
      pkg,
      workerProfile: null,
    });

    expect(decision.decision).toBe("UNMAPPED_AUTHORITY");
    expect(decision.workerProfileCode).toBe("UNRESOLVED");
    expect(decision.reason).toMatch(/missing or unresolved/i);
  });

  it("blocks channels, tools and connectors outside the resolved WorkerProfile", () => {
    expect(validateOpenClawExecutionPackageAuthority({
      pkg: makePackage({ requestedChannels: ["browser"] }),
      workerProfile: operationsProfile,
    }).decision).toBe("PROHIBITED");

    expect(validateOpenClawExecutionPackageAuthority({
      pkg: makePackage({ requestedTools: ["browser_tools"] }),
      workerProfile: operationsProfile,
    }).decision).toBe("PROHIBITED");

    expect(validateOpenClawExecutionPackageAuthority({
      pkg: makePackage({ requestedConnectorCategories: ["email_system"] }),
      workerProfile: operationsProfile,
    }).decision).toBe("PROHIBITED");
  });

  it("blocks packages that remove WorkerProfile prohibitions or approval gates", () => {
    const removedProhibition = makePackage({
      workerProfile: {
        ...buildWorkerProfileExecutionConstraints(operationsProfile),
        prohibitedActions: [],
      },
    });
    const removedApproval = makePackage({
      workerProfile: {
        ...buildWorkerProfileExecutionConstraints(operationsProfile),
        requiresApprovalFor: [],
      },
    });

    expect(validateOpenClawExecutionPackageAuthority({
      pkg: removedProhibition,
      workerProfile: operationsProfile,
    }).decision).toBe("PROHIBITED");

    expect(validateOpenClawExecutionPackageAuthority({
      pkg: removedApproval,
      workerProfile: operationsProfile,
    }).decision).toBe("PROHIBITED");
  });

  it("does not allow approval to convert prohibited or unmapped UEE actions into permission", () => {
    const prohibited = evaluateWorkerProfileAuthority({
      specialistCode: "operations_manager",
      workerProfile: operationsProfile,
      actionIdentifier: "modify_staff_records",
      actionType: "update_file",
      executionChannel: operationsProfile.allowedExecutionChannels[0],
      toolCategory: "data_tools",
      approvalGranted: true,
    });
    const unmapped = evaluateWorkerProfileAuthority({
      specialistCode: "operations_manager",
      workerProfile: operationsProfile,
      actionIdentifier: "unknown_action",
      actionType: "not_a_real_action",
      executionChannel: operationsProfile.allowedExecutionChannels[0],
      toolCategory: operationsProfile.allowedToolCategories[0],
      approvalGranted: true,
    });

    expect(prohibited.decision).toBe("PROHIBITED");
    expect(unmapped.decision).toBe("UNMAPPED_AUTHORITY");
  });
});

describe("Sprint 33E.1 — UEE/OpenClaw package parity", () => {
  it("carries canonical identity, WorkerProfile restrictions, approval gates, risk and Blueprint contract to OpenClaw", () => {
    const bp = blueprintContract();
    const pkg = makePackage({
      blueprintContract: bp,
      workerProfile: {
        ...buildWorkerProfileExecutionConstraints(operationsProfile),
        prohibitedActions: [
          ...buildWorkerProfileExecutionConstraints(operationsProfile).prohibitedActions,
          ...bp.prohibitedActions,
        ],
      },
    });
    const decision = validateOpenClawExecutionPackageAuthority({ pkg, workerProfile: operationsProfile, blueprintContract: bp });
    pkg.authorityValidation = decision;

    const wire = translateToOpenClawPackage(pkg, loadOpenClawConfig());

    expect(wire.specialistManifest.workforceRole).toBe("operations_manager");
    expect(wire.workerProfile.allowedChannels).toEqual(pkg.workerProfile.allowedChannels);
    expect(wire.requestedTools).toEqual(operationsProfile.allowedToolCategories);
    expect(wire.requestedConnectorCategories).toEqual(operationsProfile.allowedConnectorCategories);
    expect(wire.workerProfile.requiresApprovalFor).toEqual(operationsProfile.approvalRequiredActions);
    expect(wire.workerProfile.riskLevel).toBe(pkg.workerProfile.riskLevel);
    expect(wire.blueprintContract?.blueprintCode).toBe(bp.blueprintCode);
    expect(wire.blueprintContract?.prohibitedActions).toContain("delete_data");
    expect(wire.authorityValidation?.decision).toBe("PERMITTED");
  });

  it("blocks an OpenClaw-bound package that removes a Blueprint prohibition", () => {
    const bp = blueprintContract({ prohibitedActions: ["delete_data", "publish_without_approval"] });
    const pkg = makePackage({ blueprintContract: bp });

    const decision = validateOpenClawExecutionPackageAuthority({
      pkg,
      workerProfile: operationsProfile,
      blueprintContract: bp,
    });

    expect(decision.decision).toBe("PROHIBITED");
    expect(decision.reason).toMatch(/Blueprint prohibitions/i);
  });

  it("preserves equivalent approval-required semantics between UEE action validation and package authority", () => {
    const approvalAction = operationsProfile.approvalRequiredActions[0];
    expect(approvalAction).toBeDefined();

    const [action] = parseExecutionActions([{
      actionIdentifier: approvalAction,
      actionType: "create_file",
      executionChannel: operationsProfile.allowedExecutionChannels[0],
      toolCategory: "reporting_tools",
      approvalRequired: false,
      riskLevel: "medium",
      description: "Approval-gated operational update",
      path: "/operations/review",
    }], "run-33e-parity");

    expect(action).toBeDefined();
    const uee = validateExecutionActions(action ? [action] : [], {
      allowedWriteTargets: [],
      allowedReadTargets: [],
      connectorPermissions: [],
      policyGuards: [],
    }, {
      specialistCode: "operations_manager",
      workerProfile: operationsProfile,
      workerProfileCode: operationsProfile.code,
    });
    const pkg = makePackage();
    const packageDecision = validateOpenClawExecutionPackageAuthority({ pkg, workerProfile: operationsProfile });

    expect(uee.authorityDecisions[0]?.decision).toBe("APPROVAL_REQUIRED");
    expect(uee.approvalRequirements.length).toBe(1);
    expect(packageDecision.decision).toBe("PERMITTED");
    expect(packageDecision.approvalRequiredActions).toContain(approvalAction);
  });
});
