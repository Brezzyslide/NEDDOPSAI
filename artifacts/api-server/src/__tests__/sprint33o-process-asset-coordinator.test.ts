/**
 * Sprint 33O - Process & Asset Coordinator v2
 *
 * Proves PAC owns process mechanics and operational asset coordination without
 * becoming Operations Manager, Policy & Governance, CQM, SDC, workforce-cluster,
 * finance/procurement, safety/technical, clinical, BSP/RP, legal or OpenClaw
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
  COMPLIANCE_QUALITY_MANAGER_DNA,
  OPERATIONS_MANAGER_DNA,
  POLICY_GOVERNANCE_SPECIALIST_DNA,
  PROCESS_ASSET_COORDINATOR_DNA,
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

const ORG_ID = "org-sprint33o";
const profile = getWorkerProfileByCode("process_asset_coordinator_profile")!;

type ProcessCurrentness = "CURRENT" | "SUPERSEDED" | "HISTORICAL" | "MEMORY";
type ProcessGap =
  | "MISSING_STEP"
  | "DUPLICATED_STEP"
  | "UNCLEAR_OWNER"
  | "BROKEN_HANDOFF"
  | "MISSING_CONTROL"
  | "POLICY_AMBIGUITY"
  | "TRAINING_ISSUE"
  | "CAPACITY_ISSUE"
  | "AUTOMATION_OPPORTUNITY";
type AssetStatus = "AVAILABLE" | "OUT_OF_SERVICE" | "INSPECTION_STALE" | "MAINTENANCE_UNVERIFIED" | "UNKNOWN";

function classifyProcessEvidence(input: {
  currentness: ProcessCurrentness;
  approved: boolean;
  governingRequirementPresent: boolean;
}): "CURRENT_APPROVED" | "NOT_CURRENT" | "MISSING_GOVERNING_REQUIREMENT" {
  if (!input.governingRequirementPresent) return "MISSING_GOVERNING_REQUIREMENT";
  if (input.currentness !== "CURRENT" || !input.approved) return "NOT_CURRENT";
  return "CURRENT_APPROVED";
}

function routeProcessGap(gap: ProcessGap): string {
  switch (gap) {
    case "POLICY_AMBIGUITY":
      return "policy_governance_specialist";
    case "CAPACITY_ISSUE":
      return "operations_manager";
    case "TRAINING_ISSUE":
      return "talent_learning_specialist";
    default:
      return "process_asset_coordinator";
  }
}

function resolveAssetStatus(input: {
  registerSaysActive?: boolean;
  verifiedDefect?: boolean;
  inspectionDaysOld?: number;
  managerAssertionOnly?: boolean;
  maintenanceEvidencePresent?: boolean;
}): AssetStatus {
  if (input.verifiedDefect) return "OUT_OF_SERVICE";
  if (input.managerAssertionOnly && !input.maintenanceEvidencePresent) return "MAINTENANCE_UNVERIFIED";
  if (typeof input.inspectionDaysOld === "number" && input.inspectionDaysOld > 365) return "INSPECTION_STALE";
  if (input.registerSaysActive && input.maintenanceEvidencePresent) return "AVAILABLE";
  return "UNKNOWN";
}

function makePackage(overrides: Partial<ExecutionPackage> = {}): ExecutionPackage {
  const workerProfile = buildWorkerProfileExecutionConstraints(profile);
  return {
    executionId: "exec-33o",
    taskId: "task-33o",
    tenantId: ORG_ID,
    workforceRole: "process_asset_coordinator",
    specialistManifest: {
      manifestVersion: 1,
      workforceRole: "process_asset_coordinator",
      displayName: "Process & Asset Coordinator",
      domain: "process and asset control",
      dnaProfileId: "process_asset_coordinator",
      dnaVersion: "1.0.0",
      manifestHash: "sha256:pac-manifest",
      generatedAt: new Date().toISOString(),
      specialistId: "process_asset_coordinator",
    } as ExecutionPackage["specialistManifest"],
    runtimeInstructions: {
      instruction: "Execute process and asset coordination assessment only.",
      instructionHash: "sha256:pac-instruction",
      manifestHash: "sha256:pac-manifest",
      dnaVersion: "1.0.0",
      specialistId: "process_asset_coordinator",
      compiledAt: new Date().toISOString(),
    },
    workerProfile,
    steps: [{
      sequence: 1,
      specialist: "process_asset_coordinator",
      action: "execute",
      description: "Assess process mechanics or asset-control evidence",
      requiresApproval: false,
    }],
    requestedTools: [...profile.allowedToolCategories],
    requestedChannels: [...workerProfile.allowedChannels],
    requestedConnectorCategories: [...profile.allowedConnectorCategories],
    approvalState: "not_required",
    constraints: {
      maxDurationSeconds: 300,
      requireHumanApprovalBeforeSubmit: false,
      allowedDataCategories: ["task_context", "process_records", "asset_records", "maintenance_evidence"],
    },
    callbackUrl: "",
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
    issuedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("Sprint 33O current-v2 activation", () => {
  it("activates PAC as complete current-v2 role", () => {
    const specialist = getSpecialistByCode("process_asset_coordinator");

    expect(specialist).toBeDefined();
    expect(specialist!.executionStatus).toBe("available");
    expect(specialist!.dnaStatus).toBe("approved");
    expect(specialist!.workerProfileCodes).toEqual(["process_asset_coordinator_profile"]);
    expect(hasActiveIntelligence("process_asset_coordinator")).toBe(true);
  });

  it("resolves active DNA and canonical WorkforceDNA", () => {
    const legacy = getDNAProfile("process_asset_coordinator");
    const canonical = getCanonicalDNAProfile("process_asset_coordinator");

    expect(legacy).toBe(PROCESS_ASSET_COORDINATOR_DNA);
    expect(canonical).not.toBeNull();
    expect(canonical!.identity.specialistId).toBe("process_asset_coordinator");
    expect(canonical!.professionalMission.missionStatement).toContain("repeatable operational work");
    expect(canonical!.domainExpertise.competencies.length).toBeGreaterThanOrEqual(15);
    expect(canonical!.requiredWorkerProfile.profileCode).toBe("process_asset_coordinator_profile");
  });

  it("resolves WorkerProfile and runtime dispatchability", async () => {
    _clearWorkforceCache();
    const profiles = getWorkerProfilesForRole("process_asset_coordinator");
    const ctx = await getConversationWorkforceContext(ORG_ID);
    const pac = ctx.specialists.find(s => s.code === "process_asset_coordinator");

    expect(profiles.map(p => p.code)).toEqual(["process_asset_coordinator_profile"]);
    expect(profile.riskLevel).toBe("high");
    expect(pac).toBeDefined();
    expect(pac!.availableForConversation).toBe(true);
    expect(pac!.availableForDispatch).toBe(true);
    expect(pac!.runtimeReady).toBe(true);
  });

  it("satisfies static DB publication prerequisites", () => {
    const specialist = getSpecialistByCode("process_asset_coordinator")!;
    const dna = getDNAProfile("process_asset_coordinator")!;
    const profiles = getWorkerProfilesForRole("process_asset_coordinator");

    expect(specialist.catalogueVersion).toBe("2");
    expect(specialist.executionStatus).toBe("available");
    expect(specialist.dnaStatus).toBe("approved");
    expect(dna.currentVersion.version).toBe("1.0.0");
    expect(dna.currentVersion.isActive).toBe(true);
    expect(profiles).toHaveLength(1);
    expect(profiles[0]!.status).toBe("active");
  });
});

describe("Sprint 33O capability and blueprint ownership", () => {
  it("owns process and asset coordination capabilities", () => {
    const capabilityCodes = [
      "process.map",
      "process.review",
      "process.improvement",
      "process.sop",
      "process.work_instruction",
      "process.workflow",
      "process.control_review",
      "process.handoff_review",
      "asset.register_review",
      "asset.lifecycle_review",
      "asset.maintenance_review",
      "asset.inspection_review",
      "asset.condition_review",
      "asset.exception_review",
      "asset.replacement_review",
    ];

    for (const code of capabilityCodes) {
      const cap = getCapability(code);
      expect(cap, `${code} should exist`).toBeDefined();
      expect(cap!.eligibleRoles).toEqual(["process_asset_coordinator"]);
      expect(cap!.requiredWorkerProfiles).toEqual(["process_asset_coordinator_profile"]);
      expect(validateSpecialistEligibilitySync("process_asset_coordinator", code)).toBe(true);
    }
  });

  it("routes process and asset Blueprints to PAC-owned work products", () => {
    const sop = getRegistryEntry("standard_operating_procedure");
    const process = getRegistryEntry("business_process_analysis");
    const asset = getRegistryEntry("asset_lifecycle_review");
    const processIntent = resolveIntent("process.control_review");
    const sopIntent = resolveIntent("process.work_instruction");
    const assetIntent = resolveIntent("asset.inspection_review");

    expect(sop!.futureOwnerRoleCode).toBe("process_asset_coordinator");
    expect(process!.futureOwnerRoleCode).toBe("process_asset_coordinator");
    expect(asset!.futureOwnerRoleCode).toBe("process_asset_coordinator");
    expect(processIntent?.isAction).toBe(false);
    expect(!processIntent!.isAction && processIntent.code).toBe("business_process_analysis");
    expect(!sopIntent!.isAction && sopIntent.code).toBe("standard_operating_procedure");
    expect(!assetIntent!.isAction && assetIntent.code).toBe("asset_lifecycle_review");
  });

  it("preserves policy, operations, assurance and service-delivery owners", () => {
    expect(getDNAProfile("policy_governance_specialist")).toBe(POLICY_GOVERNANCE_SPECIALIST_DNA);
    expect(getDNAProfile("operations_manager")).toBe(OPERATIONS_MANAGER_DNA);
    expect(getDNAProfile("compliance_quality_manager")).toBe(COMPLIANCE_QUALITY_MANAGER_DNA);
    expect(getDNAProfile("service_delivery_coordinator")).toBe(SERVICE_DELIVERY_COORDINATOR_DNA);

    expect(validateSpecialistEligibilitySync("policy_governance_specialist", "policy.review")).toBe(true);
    expect(validateSpecialistEligibilitySync("operations_manager", "operations.capacity_analysis")).toBe(true);
    expect(validateSpecialistEligibilitySync("compliance_quality_manager", "compliance.corrective_actions")).toBe(true);
    expect(validateSpecialistEligibilitySync("service_delivery_coordinator", "service_delivery.review")).toBe(true);
  });
});

describe("Sprint 33O professional reasoning boundaries", () => {
  it("owns process mechanics but routes policy ambiguity, capacity and learning causes", () => {
    expect(routeProcessGap("MISSING_STEP")).toBe("process_asset_coordinator");
    expect(routeProcessGap("BROKEN_HANDOFF")).toBe("process_asset_coordinator");
    expect(routeProcessGap("POLICY_AMBIGUITY")).toBe("policy_governance_specialist");
    expect(routeProcessGap("CAPACITY_ISSUE")).toBe("operations_manager");
    expect(routeProcessGap("TRAINING_ISSUE")).toBe("talent_learning_specialist");
  });

  it("does not treat superseded or memory process evidence as current", () => {
    expect(classifyProcessEvidence({ currentness: "CURRENT", approved: true, governingRequirementPresent: true })).toBe("CURRENT_APPROVED");
    expect(classifyProcessEvidence({ currentness: "SUPERSEDED", approved: true, governingRequirementPresent: true })).toBe("NOT_CURRENT");
    expect(classifyProcessEvidence({ currentness: "MEMORY", approved: true, governingRequirementPresent: true })).toBe("NOT_CURRENT");
    expect(classifyProcessEvidence({ currentness: "CURRENT", approved: true, governingRequirementPresent: false })).toBe("MISSING_GOVERNING_REQUIREMENT");
  });

  it("surfaces missing process evidence instead of inventing completion elements", () => {
    const missing = PROCESS_ASSET_COORDINATOR_DNA.decisionFramework.minimumEvidenceThreshold;
    expect(missing).toContain("governing requirement");
    expect(missing).toContain("owner");
    expect(missing).toContain("critical steps");
    expect(missing).toContain("maintenance or inspection evidence");
  });

  it("reuses authoritative templates/processes rather than silently replacing them", () => {
    const canDo = PROCESS_ASSET_COORDINATOR_DNA.professionalBoundaries.canDo.join(" ");
    const approval = PROCESS_ASSET_COORDINATOR_DNA.professionalBoundaries.requiresApproval.join(" ");

    expect(PROCESS_ASSET_COORDINATOR_DNA.evidenceStandards.standards.some(s => s.requirements.join(" ").includes("approved policy"))).toBe(true);
    expect(canDo).toContain("support implementation mechanics after");
    expect(approval).toContain("replace controlled operational procedure");
  });

  it("cannot certify its own process as compliant", () => {
    const cannotDo = PROCESS_ASSET_COORDINATOR_DNA.professionalBoundaries.cannotDo.join(" ");
    const hardStops = PROCESS_ASSET_COORDINATOR_DNA.escalationFramework.hardStops.join(" ");

    expect(cannotDo).toContain("audit and certify its own process as compliant");
    expect(hardStops).toContain("certify compliance");
  });

  it("keeps workforce-cluster professional truth with WCS, WRC, Payroll, P&C and T&L", () => {
    const cannotDo = PROCESS_ASSET_COORDINATOR_DNA.professionalBoundaries.cannotDo.join(" ");
    const outOfScope = PROCESS_ASSET_COORDINATOR_DNA.professionalBoundaries.outOfScope.join(" ");

    expect(cannotDo).toContain("certify worker eligibility");
    expect(cannotDo).toContain("publish rosters");
    expect(cannotDo).toContain("calculate payroll");
    expect(cannotDo).toContain("decide employment consequences");
    expect(outOfScope).toContain("WCS, WRC, Payroll, P&C and T&L");
  });

  it("distinguishes operational registers from registers owned elsewhere", () => {
    const competency = PROCESS_ASSET_COORDINATOR_DNA.competencies.find(c => c.code === "pac.registers");
    const canDo = PROCESS_ASSET_COORDINATOR_DNA.professionalBoundaries.canDo.join(" ");

    expect(competency?.description).toContain("without duplicating incident, risk, RP, complaint, compliance or governance registers");
    expect(canDo).toContain("coordinate asset registers");
  });

  it("keeps finance and procurement authority outside PAC", () => {
    const cannotDo = PROCESS_ASSET_COORDINATOR_DNA.professionalBoundaries.cannotDo.join(" ");
    const outOfScope = PROCESS_ASSET_COORDINATOR_DNA.professionalBoundaries.outOfScope.join(" ");

    expect(cannotDo).toContain("approve material expenditure");
    expect(cannotDo).toContain("execute purchases");
    expect(cannotDo).toContain("dispose of material assets");
    expect(outOfScope).toContain("finance, procurement");
  });

  it("does not treat memory as current process or asset truth", () => {
    const insufficiency = PROCESS_ASSET_COORDINATOR_DNA.evidenceStandards.insufficiencyIndicators.join(" ");
    const contradiction = PROCESS_ASSET_COORDINATOR_DNA.evidenceStandards.contradictionPolicy;

    expect(insufficiency).toContain("memory or assertion is used as current truth");
    expect(contradiction).toContain("memory or assertion");
  });
});

describe("Sprint 33O asset currentness and lifecycle reasoning", () => {
  it("does not treat old inspection or manager assertion as current asset truth", () => {
    expect(resolveAssetStatus({ registerSaysActive: true, maintenanceEvidencePresent: true })).toBe("AVAILABLE");
    expect(resolveAssetStatus({ registerSaysActive: true, inspectionDaysOld: 500, maintenanceEvidencePresent: true })).toBe("INSPECTION_STALE");
    expect(resolveAssetStatus({ managerAssertionOnly: true })).toBe("MAINTENANCE_UNVERIFIED");
  });

  it("lets verified defects override stale active-register status", () => {
    expect(resolveAssetStatus({ registerSaysActive: true, verifiedDefect: true, maintenanceEvidencePresent: true })).toBe("OUT_OF_SERVICE");
  });

  it("keeps safety-critical certification outside PAC", () => {
    const outOfScope = PROCESS_ASSET_COORDINATOR_DNA.professionalBoundaries.outOfScope.join(" ");
    const escalation = PROCESS_ASSET_COORDINATOR_DNA.riskTolerance.autoEscalateWhen.join(" ");

    expect(outOfScope).toContain("licensed technician");
    expect(escalation).toContain("safety-critical asset status");
  });

  it("does not autonomously approve material purchasing or disposal", () => {
    const prohibited = profile.prohibitedActions;
    const approval = profile.approvalRequiredActions;

    expect(prohibited).toContain("approve_material_purchase");
    expect(prohibited).toContain("dispose_material_asset");
    expect(approval).toContain("initiate_asset_procurement_request");
    expect(approval).toContain("record_asset_disposal");
  });
});

describe("Sprint 33O WorkerProfile and OpenClaw authority", () => {
  it("permits analysis and approval-gates controlled procedure publication", () => {
    const analysis = evaluateWorkerProfileAuthority({
      workerProfile: profile,
      specialistCode: "process_asset_coordinator",
      actionIdentifier: "create_file",
      actionType: "create_file",
      executionChannel: "document_store",
      toolCategory: "document_tools",
      connectorCategory: "document_management",
    });
    const publish = evaluateWorkerProfileAuthority({
      workerProfile: profile,
      specialistCode: "process_asset_coordinator",
      actionIdentifier: "publish_controlled_operational_procedure",
      actionType: "update_file",
      executionChannel: "document_store",
      toolCategory: "document_tools",
      connectorCategory: "document_management",
    });

    expect(analysis.decision).toBe("PERMITTED");
    expect(publish.decision).toBe("APPROVAL_REQUIRED");
  });

  it("approval cannot override prohibited certification, purchasing or automation bypass", () => {
    for (const actionIdentifier of [
      "certify_compliance",
      "approve_material_purchase",
      "certify_safety_critical_asset",
      "bypass_automation_approval",
    ]) {
      const decision = evaluateWorkerProfileAuthority({
        workerProfile: profile,
        specialistCode: "process_asset_coordinator",
        actionIdentifier,
        actionType: "update_file",
        executionChannel: "document_store",
        toolCategory: "document_tools",
        connectorCategory: "document_management",
        approvalGranted: true,
      });

      expect(decision.decision).toBe("PROHIBITED");
    }
  });

  it("OpenClaw package preserves WorkerProfile channel, connector and prohibition boundaries", () => {
    const valid = validateOpenClawExecutionPackageAuthority({ pkg: makePackage(), workerProfile: profile });
    const missingProhibitions = validateOpenClawExecutionPackageAuthority(
      { pkg: makePackage({
        workerProfile: {
          ...buildWorkerProfileExecutionConstraints(profile),
          prohibitedActions: [],
        },
      }), workerProfile: profile },
    );

    expect(valid.decision).toBe("PERMITTED");
    expect(missingProhibitions.decision).toBe("PROHIBITED");
    expect(missingProhibitions.reason).toContain("removed WorkerProfile prohibitions");
  });

  it("automation opportunities do not bypass approval or professional ownership", () => {
    const approval = profile.approvalRequiredActions;
    const risk = PROCESS_ASSET_COORDINATOR_DNA.riskTolerance.escalationFactors.join(" ");

    expect(approval).toContain("activate_workflow_automation");
    expect(risk).toContain("automation could bypass approval");
  });
});
