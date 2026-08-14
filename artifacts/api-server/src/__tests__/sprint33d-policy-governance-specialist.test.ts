/**
 * Sprint 33D — Policy & Governance Specialist v2
 *
 * Proves Policy & Governance is a current-v2 professional owner for policy
 * architecture and governance work without becoming CQM, KDS, domain expert,
 * clinical authority or legal authority.
 */

import { describe, expect, it, vi } from "vitest";

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
  POLICY_GOVERNANCE_SPECIALIST_DNA,
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
import {
  evaluateWorkerProfileAuthority,
} from "../services/executionActionService.js";

const ORG_ID = "org-sprint33d";

describe("Sprint 33D current-v2 activation", () => {
  it("activates Policy & Governance Specialist as a complete current-v2 role", () => {
    const pgs = getSpecialistByCode("policy_governance_specialist");
    expect(pgs).toBeDefined();
    expect(pgs!.executionStatus).toBe("available");
    expect(pgs!.dnaStatus).toBe("approved");
    expect(pgs!.workerProfileCodes).toEqual(["policy_governance_specialist_profile"]);
    expect(hasActiveIntelligence("policy_governance_specialist")).toBe(true);
  });

  it("resolves active DNA and canonical WorkforceDNA without Employee File dependency", () => {
    const legacy = getDNAProfile("policy_governance_specialist");
    const canonical = getCanonicalDNAProfile("policy_governance_specialist");

    expect(legacy).toBe(POLICY_GOVERNANCE_SPECIALIST_DNA);
    expect(canonical).not.toBeNull();
    expect(canonical!.identity.specialistId).toBe("policy_governance_specialist");
    expect(canonical!.professionalMission.missionStatement).toContain("policy architecture");
    expect(canonical!.domainExpertise.competencies.length).toBeGreaterThanOrEqual(9);
    expect(canonical!.reasoningModel.decisionMethodology.some(step => step.stepId.startsWith("pgs."))).toBe(true);
    expect(canonical!.requiredWorkerProfile.profileCode).toBe("policy_governance_specialist_profile");
  });

  it("is available for conversation and dispatch", async () => {
    _clearWorkforceCache();
    const ctx = await getConversationWorkforceContext(ORG_ID);
    const pgs = ctx.specialists.find(s => s.code === "policy_governance_specialist");

    expect(pgs).toBeDefined();
    expect(pgs!.availableForConversation).toBe(true);
    expect(pgs!.availableForDispatch).toBe(true);
    expect(pgs!.runtimeReady).toBe(true);
  });
});

describe("Sprint 33D professional policy evidence and boundaries", () => {
  it("preserves current-source hierarchy and rejects stale/sampled authority", () => {
    const standards = JSON.stringify(POLICY_GOVERNANCE_SPECIALIST_DNA.evidenceStandards);
    const decision = JSON.stringify(POLICY_GOVERNANCE_SPECIALIST_DNA.decisionFramework);

    expect(standards).toContain("Current authoritative legislation");
    expect(standards).toContain("Superseded policies");
    expect(standards).toContain("User assertions");
    expect(standards).toContain("Sample policy");
    expect(decision).toContain("Current authoritative external source over stale organisational policy");
  });

  it("encodes policy is not compliance proof", () => {
    const dnaText = JSON.stringify(POLICY_GOVERNANCE_SPECIALIST_DNA);

    expect(dnaText).toContain("Policy existence is not compliance proof");
    expect(dnaText).toContain("Certify implementation, compliance");
    expect(dnaText).toContain("Systemic assurance and audit certification owned by CQM");
  });

  it("defers domain authority instead of becoming a universal policy expert", () => {
    const defers = POLICY_GOVERNANCE_SPECIALIST_DNA.conflictPolicy.defersTo.join(" ");

    expect(defers).toContain("authorised_program_officer");
    expect(defers).toContain("behaviour_support_implementation_specialist");
    expect(defers).toContain("incident_safeguarding_specialist");
    expect(defers).toContain("compliance_quality_manager");
    expect(defers).toContain("knowledge_documentation_specialist");
    expect(defers).toContain("legal or external authority");
  });
});

describe("Sprint 33D capabilities and Blueprint contracts", () => {
  it("makes policy review professionally PGS-owned while preserving support roles", () => {
    const cap = getCapability("policy.review");

    expect(cap).toBeDefined();
    expect(cap!.eligibleRoles[0]).toBe("policy_governance_specialist");
    expect(cap!.eligibleRoles).toEqual(expect.arrayContaining([
      "compliance_quality_manager",
      "knowledge_documentation_specialist",
    ]));
    expect(validateSpecialistEligibilitySync("policy_governance_specialist", "policy.review")).toBe(true);
  });

  it("adds narrow governance capabilities rather than a generic super capability", () => {
    for (const code of [
      "policy.development",
      "governance.framework",
      "governance.regulatory_change_impact",
      "governance.gap_analysis",
      "governance.delegation_framework",
    ]) {
      const cap = getCapability(code);
      expect(cap, code).toBeDefined();
      expect(cap!.eligibleRoles).toContain("policy_governance_specialist");
    }
  });

  it("Blueprints identify PGS as owner without granting legal/domain/publishing authority", () => {
    const policy = getRegistryEntry("policy");
    const regulatoryImpact = getRegistryEntry("regulatory_change_impact_assessment");

    expect(policy?.futureOwnerRoleCode).toBe("policy_governance_specialist");
    expect(policy?.externalAuthorityRequiredFor).toEqual(expect.arrayContaining([
      "formal legal opinion",
      "domain professional conclusion",
      "policy approval or publication",
    ]));
    expect(regulatoryImpact?.futureOwnerRoleCode).toBe("policy_governance_specialist");
    expect(regulatoryImpact?.professionalAuthority).toBe("mixed");
  });

  it("resolves governance intent keys to the correct work-product contracts", () => {
    expect(resolveIntent("governance.framework")?.code).toBe("governance_framework");
    expect(resolveIntent("governance.regulatory_change_impact")?.code).toBe("regulatory_change_impact_assessment");
    expect(resolveIntent("governance.gap_analysis")?.code).toBe("governance_gap_analysis");
    expect(resolveIntent("governance.delegation_framework")?.code).toBe("delegation_framework");
  });
});

describe("Sprint 33D WorkerProfile authority", () => {
  const pgs = getWorkerProfileByCode("policy_governance_specialist_profile")!;

  it("resolves profile mapping for the PGS role", () => {
    expect(pgs).toBeDefined();
    expect(getWorkerProfilesForRole("policy_governance_specialist").map(p => p.code))
      .toEqual(["policy_governance_specialist_profile"]);
  });

  it("permits internal policy drafting in allowed surfaces", () => {
    const decision = evaluateWorkerProfileAuthority({
      specialistCode: "policy_governance_specialist",
      workerProfile: pgs,
      actionIdentifier: "draft_policy_revision",
      actionType: "create_file",
      executionChannel: "document_store",
      toolCategory: "document_tools",
    });

    expect(decision.decision).toBe("PERMITTED");
  });

  it("holds publishing and controlled-status changes for approval", () => {
    const publish = evaluateWorkerProfileAuthority({
      specialistCode: "policy_governance_specialist",
      workerProfile: pgs,
      actionIdentifier: "publish_policy",
      actionType: "update_file",
      executionChannel: "document_store",
      toolCategory: "document_tools",
    });
    const statusChange = evaluateWorkerProfileAuthority({
      specialistCode: "policy_governance_specialist",
      workerProfile: pgs,
      actionIdentifier: "change_controlled_governance_status",
      actionType: "update_file",
      executionChannel: "internal_api",
      toolCategory: "form_tools",
    });

    expect(publish.decision).toBe("APPROVAL_REQUIRED");
    expect(statusChange.decision).toBe("APPROVAL_REQUIRED");
  });

  it("allows approved publishing only through approval path", () => {
    const decision = evaluateWorkerProfileAuthority({
      specialistCode: "policy_governance_specialist",
      workerProfile: pgs,
      actionIdentifier: "publish_policy",
      actionType: "update_file",
      executionChannel: "document_store",
      toolCategory: "document_tools",
      approvalGranted: true,
    });

    expect(decision.decision).toBe("PERMITTED");
    expect(decision.approved).toBe(true);
  });

  it("keeps self-approval, legal invention and domain actions prohibited even with approval", () => {
    for (const actionIdentifier of [
      "self_approve_policy",
      "invent_legal_authority",
      "make_clinical_decision",
      "make_practitioner_decision",
      "evidence_free_compliance_certification",
      "alter_technical_access_permissions",
    ]) {
      const decision = evaluateWorkerProfileAuthority({
        specialistCode: "policy_governance_specialist",
        workerProfile: pgs,
        actionIdentifier,
        actionType: "update_file",
        executionChannel: "internal_api",
        toolCategory: "form_tools",
        approvalGranted: true,
      });

      expect(decision.decision, actionIdentifier).toBe("PROHIBITED");
    }
  });

  it("fails closed for unknown executable action", () => {
    const decision = evaluateWorkerProfileAuthority({
      specialistCode: "policy_governance_specialist",
      workerProfile: pgs,
      actionIdentifier: "",
      actionType: "",
      executionChannel: "internal_api",
      toolCategory: "document_tools",
    });

    expect(decision.decision).toBe("UNMAPPED_AUTHORITY");
  });

  it("Blueprint cannot grant browser or regulator submission access", () => {
    const browser = evaluateWorkerProfileAuthority({
      specialistCode: "policy_governance_specialist",
      workerProfile: pgs,
      actionIdentifier: "browse_regulator_portal",
      actionType: "browser_interaction",
      executionChannel: "web_browser",
      toolCategory: "search_tools",
      approvalGranted: true,
    });
    const regulator = evaluateWorkerProfileAuthority({
      specialistCode: "policy_governance_specialist",
      workerProfile: pgs,
      actionIdentifier: "submit_regulator_policy_attestation",
      actionType: "update_file",
      executionChannel: "internal_api",
      toolCategory: "form_tools",
      connectorCategory: "ndis_portal",
      approvalGranted: true,
    });

    expect(browser.decision).toBe("PROHIBITED");
    expect(regulator.decision).toBe("PROHIBITED");
  });
});
