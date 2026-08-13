/**
 * Sprint 33B — Professional Authority Realignment
 *
 * Proves the current-v2 workforce can recognise APO/BSI professional destinations
 * without making either role executable before canonical DNA and WorkerProfiles exist.
 */

import { describe, it, expect, vi } from "vitest";

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
  getCurrentSpecialists,
  getSpecialistByCode,
  resolveAlias,
} from "../lib/workforceRegistry.js";
import { getCapability } from "../lib/capabilityRegistry.js";
import { getRegistryEntry } from "../services/blueprintRegistry.js";
import { resolveIntent } from "../services/blueprintIntentMap.js";
import {
  hasActiveIntelligence,
  validateSpecialistEligibilitySync,
} from "../services/specialistEligibilityService.js";
import {
  getConversationWorkforceContext,
  _clearWorkforceCache,
} from "../services/conversationWorkforceContextService.js";

const ORG_ID = "org-sprint33b";

describe("Sprint 33B current-v2 catalogue expansion", () => {
  it("contains exactly 19 current-v2 roles", () => {
    const current = getCurrentSpecialists();
    expect(current).toHaveLength(19);
    expect(current.map(s => s.code)).toEqual(expect.arrayContaining([
      "authorised_program_officer",
      "behaviour_support_implementation_specialist",
    ]));
  });

  it("adds Authorised Program Officer as dna_pending and non-runtime", () => {
    const apo = getSpecialistByCode("authorised_program_officer");
    expect(apo).toBeDefined();
    expect(apo!.displayName).toBe("Authorised Program Officer");
    expect(apo!.executionStatus).toBe("dna_pending");
    expect(apo!.dnaStatus).toBe("pending_design");
    expect(apo!.workerProfileCodes).toEqual([]);
    expect(hasActiveIntelligence(apo!.code)).toBe(false);
  });

  it("adds Behaviour Support Implementation Specialist as dna_pending and non-runtime", () => {
    const bsi = getSpecialistByCode("behaviour_support_implementation_specialist");
    expect(bsi).toBeDefined();
    expect(bsi!.displayName).toBe("Behaviour Support Implementation Specialist");
    expect(bsi!.executionStatus).toBe("dna_pending");
    expect(bsi!.dnaStatus).toBe("pending_design");
    expect(bsi!.workerProfileCodes).toEqual([]);
    expect(hasActiveIntelligence(bsi!.code)).toBe(false);
  });

  it("keeps completed current specialists runtime-active", () => {
    for (const code of [
      "executive_assistant",
      "compliance_quality_manager",
      "incident_safeguarding_specialist",
      "operations_manager",
    ]) {
      expect(getSpecialistByCode(code)?.executionStatus, code).toBe("available");
      expect(getSpecialistByCode(code)?.dnaStatus, code).toBe("approved");
      expect(hasActiveIntelligence(code), code).toBe(true);
    }
    expect(getSpecialistByCode("chief_of_staff")?.executionStatus).toBe("available");
    expect(getSpecialistByCode("chief_of_staff")?.dnaStatus).toBe("approved");
  });
});

describe("Sprint 33B restrictive practice authority boundaries", () => {
  it("maps legacy restrictive_practice_officer toward future APO governance rather than ISS", () => {
    expect(resolveAlias("restrictive_practice_officer")).toBe("authorised_program_officer");
    expect(getSpecialistByCode("restrictive_practice_officer")?.replacementRoleCode).toBe("authorised_program_officer");
  });

  it("distinguishes RP incident/safeguarding review from APO governance", () => {
    const incidentReview = getCapability("restrictive_practice.review");
    const governance = getCapability("restrictive_practice.governance");

    expect(incidentReview?.displayName).toMatch(/Incident\/Safeguarding/);
    expect(incidentReview?.description).toMatch(/incident|safeguarding/i);
    expect(incidentReview?.description).toMatch(/governance belongs to the future Authorised Program Officer/i);
    expect(incidentReview?.eligibleRoles).toEqual(expect.arrayContaining([
      "incident_safeguarding_specialist",
      "authorised_program_officer",
    ]));

    expect(governance?.eligibleRoles).toEqual(["authorised_program_officer"]);
    expect(validateSpecialistEligibilitySync("incident_safeguarding_specialist", "restrictive_practice.review")).toBe(true);
    expect(validateSpecialistEligibilitySync("incident_safeguarding_specialist", "restrictive_practice.governance")).toBe(false);
  });

  it("blocks APO-owned work while APO DNA is pending and does not fall back to ISS, OM or CoS", () => {
    expect(validateSpecialistEligibilitySync("authorised_program_officer", "restrictive_practice.governance")).toBe(false);
    expect(validateSpecialistEligibilitySync("incident_safeguarding_specialist", "restrictive_practice.governance")).toBe(false);
    expect(validateSpecialistEligibilitySync("operations_manager", "restrictive_practice.governance")).toBe(false);
    expect(validateSpecialistEligibilitySync("chief_of_staff", "restrictive_practice.governance")).toBe(false);
  });

  it("establishes monthly RP reporting as future APO-owned and non-executable", () => {
    const cap = getCapability("restrictive_practice.monthly_reporting");
    expect(cap).toBeDefined();
    expect(cap!.eligibleRoles).toEqual(["authorised_program_officer"]);
    expect(cap!.executionAllowed).toBe(false);
    expect(validateSpecialistEligibilitySync("authorised_program_officer", cap!.code)).toBe(false);
  });
});

describe("Sprint 33B behaviour support and external professional authority", () => {
  it("recognises BSI implementation work without making BSI dispatchable", () => {
    const cap = getCapability("behaviour_support.implementation");
    expect(cap).toBeDefined();
    expect(cap!.eligibleRoles).toEqual(["behaviour_support_implementation_specialist"]);
    expect(cap!.description).toMatch(/not practitioner authority/i);
    expect(validateSpecialistEligibilitySync("behaviour_support_implementation_specialist", cap!.code)).toBe(false);
    expect(validateSpecialistEligibilitySync("operations_manager", cap!.code)).toBe(false);
    expect(validateSpecialistEligibilitySync("incident_safeguarding_specialist", cap!.code)).toBe(false);
  });

  it("formal BSP work remains external or credentialed authority", () => {
    const bsp = getRegistryEntry("behaviour_support_plan_review");
    expect(bsp?.futureOwnerRoleCode).toBe("behaviour_support_implementation_specialist");
    expect(bsp?.professionalAuthority).toBe("mixed");
    expect(bsp?.externalAuthorityRequiredFor).toEqual(expect.arrayContaining([
      "formal Behaviour Support Plan authorship",
      "formal Behaviour Support Plan amendment",
      "practitioner-level functional behaviour assessment",
    ]));
  });

  it("Blueprint intent can identify BSI implementation without treating BSI as Behaviour Support Practitioner", () => {
    const resolved = resolveIntent("behaviour_support.implementation");
    expect(resolved && !resolved.isAction ? resolved.code : null).toBe("behaviour_support_plan_review");
    const bsp = getRegistryEntry("behaviour_support_plan_review");
    expect(bsp?.title).toBe("Behaviour Support Plan Review");
    expect(bsp?.futureOwnerRoleCode).toBe("behaviour_support_implementation_specialist");
    expect(bsp?.externalAuthorityRequiredFor?.join(" ")).toMatch(/Behaviour Support Plan authorship/);
  });
});

describe("Sprint 33B care, policy, performance and fallback boundaries", () => {
  it("clinical care-plan authority remains external/credentialed", () => {
    const care = getRegistryEntry("care_plan");
    expect(care?.professionalAuthority).toBe("mixed");
    expect(care?.futureOwnerRoleCode).toBe("service_delivery_coordinator");
    expect(care?.externalAuthorityRequiredFor).toEqual(expect.arrayContaining([
      "clinical assessment",
      "medication judgement",
      "dysphagia or mealtime professional judgement",
    ]));
  });

  it("policy ownership points to Policy & Governance without making it executable", () => {
    const policyCap = getCapability("policy.review");
    const policyBlueprint = getRegistryEntry("policy");
    expect(policyCap?.eligibleRoles[0]).toBe("policy_governance_specialist");
    expect(policyBlueprint?.futureOwnerRoleCode).toBe("policy_governance_specialist");
    expect(validateSpecialistEligibilitySync("policy_governance_specialist", "policy.review")).toBe(false);
    expect(validateSpecialistEligibilitySync("compliance_quality_manager", "policy.review")).toBe(true);
  });

  it("performance review ownership points to People & Culture, not Workforce Compliance as HR owner", () => {
    const performance = getRegistryEntry("workforce_performance_review");
    expect(performance?.futureOwnerRoleCode).toBe("people_culture_manager");
    expect(performance?.purpose).toMatch(/workforce compliance limited to credential/i);
  });

  it("conversation context can mention APO and BSI but cannot dispatch them", async () => {
    _clearWorkforceCache();
    const ctx = await getConversationWorkforceContext(ORG_ID);
    for (const code of ["authorised_program_officer", "behaviour_support_implementation_specialist"]) {
      const entry = ctx.specialists.find(s => s.code === code);
      expect(entry, code).toBeDefined();
      expect(entry!.availableForConversation).toBe(true);
      expect(entry!.availableForDispatch).toBe(false);
      expect(entry!.runtimeReady).toBe(false);
      expect(entry!.unavailableReason).toBe("Professional design pending");
    }
  });
});
