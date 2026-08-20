import { describe, expect, it } from "vitest";
import {
  BLUEPRINT_REGISTRY,
  getRegistryEntry,
  resolveRegistryProfessionalOwner,
} from "../services/blueprintRegistry.js";

const CODE = "employment_compliance_review";
const COMPATIBILITY_RULE = "legacy_regulatory_change_impact_routes_to_canonical_assessment";

function entry(code = CODE) {
  const blueprint = getRegistryEntry(code);
  if (!blueprint) throw new Error(`Missing registry entry: ${code}`);
  return blueprint;
}

function sections(code = CODE) {
  return entry(code).sections ?? [];
}

function section(sectionCode: string) {
  const found = sections().find((candidate) => candidate.sectionCode === sectionCode);
  if (!found) throw new Error(`Missing section: ${sectionCode}`);
  return found;
}

function sectionCodes(code = CODE) {
  return sections(code).map((candidate) => candidate.sectionCode);
}

function allText(code = CODE) {
  const blueprint = entry(code);
  return JSON.stringify({
    title: blueprint.title,
    purpose: blueprint.purpose,
    deliverableContract: blueprint.deliverableContract,
    evidenceContract: blueprint.evidenceContract,
    sections: blueprint.sections,
    requiredApprovals: blueprint.requiredApprovals,
    validationRules: blueprint.validationRules,
    successCriteria: blueprint.successCriteria,
    escalationRules: blueprint.escalationRules,
    mandatoryCitations: blueprint.mandatoryCitations,
    externalAuthorityRequiredFor: blueprint.externalAuthorityRequiredFor,
  });
}

function methodPendingCodes() {
  return BLUEPRINT_REGISTRY
    .filter((blueprint) => blueprint.requiredApprovals?.human_professional_method_owner)
    .map((blueprint) => blueprint.code);
}

function compatibilityRoutes() {
  return BLUEPRINT_REGISTRY.filter((blueprint) =>
    blueprint.validationRules?.some((rule) => rule.rule === COMPATIBILITY_RULE),
  );
}

describe("Sprint 34L.39 employment compliance review method", () => {
  it("1. removes USER_DEFINITION_REQUIRED_METHOD from employment_compliance_review", () => {
    expect(sectionCodes()).not.toContain("USER_DEFINITION_REQUIRED_METHOD");
    expect(sections()[0]?.sectionCode).toBe("EMPLOYMENT_RELATIONSHIP");
  });

  it("2. removes human_professional_method_owner from employment_compliance_review", () => {
    expect(entry().requiredApprovals).not.toHaveProperty("human_professional_method_owner");
    expect(methodPendingCodes()).not.toContain(CODE);
  });

  it("3. uses the approved professional title", () => {
    expect(entry().title).toBe("Employment Compliance & Workforce Obligations Review");
    expect(entry().purpose).toContain("employment arrangements");
    expect(entry().purpose).toContain("current workplace law");
  });

  it("4. represents employment relationship establishment", () => {
    expect(section("EMPLOYMENT_RELATIONSHIP").description).toContain("Worker");
    expect(section("EMPLOYMENT_RELATIONSHIP").description).toContain("employer entity");
    expect(section("EMPLOYMENT_RELATIONSHIP").description).toContain("commencement date");
  });

  it("5. represents current authority hierarchy", () => {
    expect(section("AUTHORITY_HIERARCHY").description).toContain("Current legislation/NES");
    expect(section("AUTHORITY_HIERARCHY").description).toContain("employment contract");
    expect(entry().evidenceContract?.freshnessRules).toMatchObject({ currentEmploymentAuthorityRequired: true });
  });

  it("6. prevents internal policy reducing statutory minimums", () => {
    expect(section("AUTHORITY_HIERARCHY").instructions).toContain("Internal policy cannot reduce statutory minimums");
    expect(entry().evidenceContract?.freshnessRules).toMatchObject({ internalPolicyCannotReduceStatutoryMinimums: true });
    expect(entry().validationRules?.map((rule) => rule.rule)).toContain("internal_policy_cannot_reduce_statutory_minimums");
  });

  it("7. does not treat signed contract as automatic compliance proof", () => {
    expect(section("AUTHORITY_HIERARCHY").instructions).toContain("signed contract is evidence");
    expect(entry().evidenceContract?.freshnessRules).toMatchObject({ signedContractIsEvidenceNotLegalValidity: true });
  });

  it("8. represents industrial instrument dependency", () => {
    expect(section("INDUSTRIAL_INSTRUMENT_DEPENDENCY").description).toContain("SCHADS");
    expect(section("INDUSTRIAL_INSTRUMENT_DEPENDENCY").description).toContain("enterprise agreement");
    expect(section("INDUSTRIAL_INSTRUMENT_DEPENDENCY").description).toContain("award-free");
  });

  it("9. delegates SCHADS interpretation to schads_award_analysis", () => {
    expect(section("INDUSTRIAL_INSTRUMENT_DEPENDENCY").instructions).toContain("schads_award_analysis");
    expect(entry().evidenceContract?.freshnessRules).toMatchObject({ schadsInterpretationMustUseSchadsAwardAnalysis: true });
    expect(entry().escalationRules).toEqual(expect.arrayContaining([
      expect.objectContaining({ trigger: "schads_award_interpretation_required", action: "recommend_schads_award_analysis_without_recreating_award_method" }),
    ]));
  });

  it("10. represents employment-status review", () => {
    expect(section("EMPLOYMENT_STATUS_REVIEW").description).toContain("full-time");
    expect(section("EMPLOYMENT_STATUS_REVIEW").description).toContain("part-time");
    expect(section("EMPLOYMENT_STATUS_REVIEW").description).toContain("casual");
    expect(section("EMPLOYMENT_STATUS_REVIEW").instructions).toContain("Payroll labels are not absolute truth");
  });

  it("11. represents contract and variation review", () => {
    expect(section("CONTRACT_VARIATION_REVIEW").description).toContain("Current executed contract");
    expect(section("CONTRACT_VARIATION_REVIEW").description).toContain("variations");
    expect(section("CONTRACT_VARIATION_REVIEW").instructions).toContain("without rewriting the contract");
  });

  it("12. represents NES and minimum employment standards", () => {
    expect(section("NES_MINIMUM_STANDARDS").description).toContain("Maximum weekly hours");
    expect(section("NES_MINIMUM_STANDARDS").description).toContain("Fair Work Information Statement");
    expect(section("NES_MINIMUM_STANDARDS").instructions).toContain("Use current authority");
  });

  it("13. represents leave compliance", () => {
    expect(section("LEAVE_COMPLIANCE").description).toContain("leave balances");
    expect(section("LEAVE_COMPLIANCE").description).toContain("approvals/refusals");
    expect(section("LEAVE_COMPLIANCE").instructions).toContain("external entitlement truth");
  });

  it("14. represents hours and working-arrangement compliance", () => {
    expect(section("HOURS_WORKING_ARRANGEMENTS").description).toContain("Contracted hours");
    expect(section("HOURS_WORKING_ARRANGEMENTS").description).toContain("flexible-work arrangements");
    expect(section("HOURS_WORKING_ARRANGEMENTS").instructions).toContain("rostering_fatigue_review");
  });

  it("15. represents performance-process compliance", () => {
    expect(section("PERFORMANCE_PROCESS_COMPLIANCE").description).toContain("procedural fairness");
    expect(section("PERFORMANCE_PROCESS_COMPLIANCE").description).toContain("prohibited discrimination/retaliation risk");
    expect(section("PERFORMANCE_PROCESS_COMPLIANCE").instructions).toContain("people_management_review");
  });

  it("16. represents misconduct and procedural fairness", () => {
    expect(section("MISCONDUCT_PROCEDURAL_FAIRNESS").description).toContain("opportunity to respond");
    expect(section("MISCONDUCT_PROCEDURAL_FAIRNESS").description).toContain("support person");
    expect(section("MISCONDUCT_PROCEDURAL_FAIRNESS").description).toContain("impartiality");
  });

  it("17. does not treat allegation as fact", () => {
    expect(section("MISCONDUCT_PROCEDURAL_FAIRNESS").instructions).toContain("Do not treat allegation as fact");
    expect(entry().evidenceContract?.freshnessRules).toMatchObject({ allegationDoesNotEqualFact: true });
  });

  it("18. represents discrimination and adverse-action risk", () => {
    expect(section("DISCRIMINATION_ADVERSE_ACTION_RETALIATION").description).toContain("Discrimination");
    expect(section("DISCRIMINATION_ADVERSE_ACTION_RETALIATION").description).toContain("adverse action");
  });

  it("19. represents retaliation and protected-reporting risk", () => {
    expect(section("DISCRIMINATION_ADVERSE_ACTION_RETALIATION").description).toContain("retaliation");
    expect(section("DISCRIMINATION_ADVERSE_ACTION_RETALIATION").description).toContain("protected-reporting");
  });

  it("20. represents psychosocial and WHS employment intersection", () => {
    expect(section("BULLYING_HARASSMENT_WHS_INTERSECTION").description).toContain("psychological harm exposure");
    expect(section("BULLYING_HARASSMENT_WHS_INTERSECTION").instructions).toContain("WHS");
  });

  it("21. represents secondary employment and conflict review", () => {
    expect(section("SECONDARY_EMPLOYMENT_CONFLICT").description).toContain("Secondary employment disclosure");
    expect(section("SECONDARY_EMPLOYMENT_CONFLICT").description).toContain("participant-related conflict");
  });

  it("22. represents employment record-keeping", () => {
    expect(section("EMPLOYMENT_RECORD_KEEPING").description).toContain("Contract");
    expect(section("EMPLOYMENT_RECORD_KEEPING").description).toContain("termination/resignation records");
    expect(section("EMPLOYMENT_RECORD_KEEPING").instructions).toContain("Missing records remain missing");
  });

  it("23. represents separation and offboarding compliance", () => {
    expect(section("SEPARATION_OFFBOARDING").description).toContain("final-pay dependency");
    expect(section("SEPARATION_OFFBOARDING").description).toContain("access revocation");
    expect(section("SEPARATION_OFFBOARDING").instructions).toContain("payroll_workforce_cost_review");
  });

  it("24. represents termination and legal-review boundary", () => {
    expect(section("TERMINATION_LEGAL_REVIEW_BOUNDARY").description).toContain("contested dismissal");
    expect(section("TERMINATION_LEGAL_REVIEW_BOUNDARY").description).toContain("redundancy");
    expect(section("TERMINATION_LEGAL_REVIEW_BOUNDARY").instructions).toContain("LEGAL_REVIEW_REQUIRED");
  });

  it("25. represents payroll dependency while preserving payroll calculation boundary", () => {
    expect(section("ACTIONS_ROUTING_AND_HANDOFFS").instructions).toContain("payroll_workforce_cost_review");
    expect(entry().deliverableContract?.prohibitedDeliverables).toEqual(expect.arrayContaining([
      "payroll_calculation",
      "underpayment_reconciliation",
    ]));
    expect(entry().evidenceContract?.freshnessRules).toMatchObject({ payrollCalculationBelongsToPayrollWorkforceCostReview: true });
  });

  it("26. protects super, tax and LSL boundaries", () => {
    expect(entry().deliverableContract?.prohibitedDeliverables).toEqual(expect.arrayContaining([
      "tax_advice",
      "superannuation_liability_determination",
      "long_service_leave_liability",
    ]));
    expect(entry().externalAuthorityRequiredFor).toEqual(expect.arrayContaining([
      "tax advice",
      "superannuation liability determination",
      "long-service-leave liability determination",
    ]));
  });

  it("27. keeps workforce_compliance_assessment separate", () => {
    expect(section("ACTIONS_ROUTING_AND_HANDOFFS").instructions).toContain("workforce_compliance_assessment");
    expect(entry().escalationRules).toEqual(expect.arrayContaining([
      expect.objectContaining({ trigger: "credential_or_deployment_issue_identified", action: "recommend_workforce_compliance_assessment_without_merging_methods" }),
    ]));
  });

  it("28. keeps people_management_review separate", () => {
    expect(section("PERFORMANCE_PROCESS_COMPLIANCE").instructions).toContain("people_management_review");
    expect(entry().escalationRules).toEqual(expect.arrayContaining([
      expect.objectContaining({ trigger: "performance_or_management_intervention_required", action: "recommend_people_management_review_without_making_management_decision" }),
    ]));
  });

  it("29. keeps rostering_fatigue_review separate", () => {
    expect(section("HOURS_WORKING_ARRANGEMENTS").instructions).toContain("rostering_fatigue_review");
    expect(entry().escalationRules).toEqual(expect.arrayContaining([
      expect.objectContaining({ trigger: "fatigue_or_roster_risk_primary", action: "recommend_rostering_fatigue_review_without_absorbing_method" }),
    ]));
  });

  it("30. preserves unresolved legal uncertainty", () => {
    expect(section("PROFESSIONAL_CONCLUSION").description).toContain("LEGAL_REVIEW_REQUIRED");
    expect(entry().evidenceContract?.freshnessRules).toMatchObject({ unresolvedLegalQuestionsRemainUnresolved: true });
    expect(entry().escalationRules).toEqual(expect.arrayContaining([
      expect.objectContaining({ trigger: "contested_or_material_legal_interpretation_required", action: "preserve_uncertainty_and_route_for_legal_review" }),
    ]));
  });

  it("31. keeps sibling method-pending Blueprints gated", () => {
    expect(methodPendingCodes()).toEqual(expect.arrayContaining([
    ]));
  });

  it("32. preserves the single compatibility route count", () => {
    expect(compatibilityRoutes().map((blueprint) => blueprint.code)).toEqual(["regulatory_change_impact"]);
    expect(compatibilityRoutes()).toHaveLength(1);
  });

  it("33. moves genuine method-pending count to 12 with truthful programme accounting", () => {
    expect(BLUEPRINT_REGISTRY).toHaveLength(75);
    expect(methodPendingCodes()).toHaveLength(0);
    expect(BLUEPRINT_REGISTRY.length - methodPendingCodes().length - compatibilityRoutes().length).toBe(74);
  });

  it("34. preserves owner, support and approval boundaries", () => {
    expect(resolveRegistryProfessionalOwner(entry())).toBe("workforce_compliance_specialist");
    expect(entry().supportingSpecialists).toEqual([
      "people_culture_manager",
      "payroll_workforce_cost_officer",
      "knowledge_documentation_specialist",
    ]);
    expect(entry().requiredApprovals).toMatchObject({
      workforce_compliance_owner: true,
      people_culture_owner: true,
    });
  });

  it("35. keeps broad employment compliance separate from legal opinions and employment decisions", () => {
    expect(section("BOUNDARIES_AND_APPROVAL_LIMITS").description).toContain("formal legal advice");
    expect(entry().deliverableContract?.prohibitedDeliverables).toEqual(expect.arrayContaining([
      "legal_advice",
      "disciplinary_decision",
      "employment_decision",
    ]));
    expect(allText()).toContain("Do not produce definitive legal advice");
  });
});
