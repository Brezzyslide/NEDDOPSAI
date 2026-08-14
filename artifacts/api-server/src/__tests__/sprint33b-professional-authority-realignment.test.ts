/**
 * Sprint 33B — Professional Authority Realignment
 *
 * Proves the current-v2 workforce recognises APO/BSI professional destinations.
 * APO and BSI are now authored and executable within WorkerProfile authority.
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

  it("keeps Authorised Program Officer as current-v2 available after profile authoring", () => {
    const apo = getSpecialistByCode("authorised_program_officer");
    expect(apo).toBeDefined();
    expect(apo!.displayName).toBe("Authorised Program Officer");
    expect(apo!.executionStatus).toBe("available");
    expect(apo!.dnaStatus).toBe("approved");
    expect(apo!.workerProfileCodes).toEqual(["authorised_program_officer_profile"]);
    expect(hasActiveIntelligence(apo!.code)).toBe(true);
  });

  it("keeps Behaviour Support Implementation Specialist as current-v2 available after profile authoring", () => {
    const bsi = getSpecialistByCode("behaviour_support_implementation_specialist");
    expect(bsi).toBeDefined();
    expect(bsi!.displayName).toBe("Behaviour Support Implementation Specialist");
    expect(bsi!.executionStatus).toBe("available");
    expect(bsi!.dnaStatus).toBe("approved");
    expect(bsi!.workerProfileCodes).toEqual(["behaviour_support_implementation_specialist_profile"]);
    expect(hasActiveIntelligence(bsi!.code)).toBe(true);
  });

  it("keeps completed current specialists runtime-active", () => {
    for (const code of [
      "executive_assistant",
      "authorised_program_officer",
      "behaviour_support_implementation_specialist",
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
  it("maps legacy restrictive_practice_officer toward current APO governance rather than ISS", () => {
    expect(resolveAlias("restrictive_practice_officer")).toBe("authorised_program_officer");
    expect(getSpecialistByCode("restrictive_practice_officer")?.replacementRoleCode).toBe("authorised_program_officer");
  });

  it("distinguishes RP incident/safeguarding review from APO governance", () => {
    const incidentReview = getCapability("restrictive_practice.review");
    const governance = getCapability("restrictive_practice.governance");

    expect(incidentReview?.displayName).toMatch(/Incident\/Safeguarding/);
    expect(incidentReview?.description).toMatch(/incident|safeguarding/i);
    expect(incidentReview?.description).toMatch(/RP governance, authority and monthly reporting questions belong to the Authorised Program Officer/i);
    expect(incidentReview?.eligibleRoles).toEqual(expect.arrayContaining([
      "incident_safeguarding_specialist",
      "authorised_program_officer",
    ]));

    expect(governance?.eligibleRoles).toEqual(["authorised_program_officer"]);
    expect(validateSpecialistEligibilitySync("incident_safeguarding_specialist", "restrictive_practice.review")).toBe(true);
    expect(validateSpecialistEligibilitySync("incident_safeguarding_specialist", "restrictive_practice.governance")).toBe(false);
  });

  it("routes APO-owned work to APO and does not fall back to ISS, OM or CoS", () => {
    expect(validateSpecialistEligibilitySync("authorised_program_officer", "restrictive_practice.governance")).toBe(true);
    expect(validateSpecialistEligibilitySync("incident_safeguarding_specialist", "restrictive_practice.governance")).toBe(false);
    expect(validateSpecialistEligibilitySync("operations_manager", "restrictive_practice.governance")).toBe(false);
    expect(validateSpecialistEligibilitySync("chief_of_staff", "restrictive_practice.governance")).toBe(false);
  });

  it("establishes monthly RP reporting as APO-owned and executable within approval-gated authority", () => {
    const cap = getCapability("restrictive_practice.monthly_reporting");
    expect(cap).toBeDefined();
    expect(cap!.eligibleRoles).toEqual(["authorised_program_officer"]);
    expect(cap!.executionAllowed).toBe(true);
    expect(validateSpecialistEligibilitySync("authorised_program_officer", cap!.code)).toBe(true);
  });
});

describe("Sprint 33B behaviour support and external professional authority", () => {
  it("routes BSI implementation work to BSI without making it practitioner authority", () => {
    const cap = getCapability("behaviour_support.implementation");
    expect(cap).toBeDefined();
    expect(cap!.eligibleRoles).toEqual(["behaviour_support_implementation_specialist"]);
    expect(cap!.description).toMatch(/not practitioner authority/i);
    expect(validateSpecialistEligibilitySync("behaviour_support_implementation_specialist", cap!.code)).toBe(true);
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
    expect(bsp?.title).toBe("Behaviour Support Implementation Review");
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
    expect(validateSpecialistEligibilitySync("policy_governance_specialist", "policy.review")).toBe(true);
    expect(validateSpecialistEligibilitySync("compliance_quality_manager", "policy.review")).toBe(true);
  });

  it("performance review ownership points to People & Culture, not Workforce Compliance as HR owner", () => {
    const performance = getRegistryEntry("workforce_performance_review");
    expect(performance?.futureOwnerRoleCode).toBe("people_culture_manager");
    expect(performance?.purpose).toMatch(/workforce compliance limited to credential/i);
  });

  it("conversation context can dispatch APO and BSI", async () => {
    _clearWorkforceCache();
    const ctx = await getConversationWorkforceContext(ORG_ID);
    const apo = ctx.specialists.find(s => s.code === "authorised_program_officer");
    expect(apo).toBeDefined();
    expect(apo!.availableForConversation).toBe(true);
    expect(apo!.availableForDispatch).toBe(true);
    expect(apo!.runtimeReady).toBe(true);

    const bsi = ctx.specialists.find(s => s.code === "behaviour_support_implementation_specialist");
    expect(bsi).toBeDefined();
    expect(bsi!.availableForConversation).toBe(true);
    expect(bsi!.availableForDispatch).toBe(true);
    expect(bsi!.runtimeReady).toBe(true);
  });
});
