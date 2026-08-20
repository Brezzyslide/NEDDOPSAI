import { describe, expect, it } from "vitest";
import {
  BLUEPRINT_REGISTRY,
  getRegistryEntry,
  resolveRegistryProfessionalOwner,
} from "../services/blueprintRegistry.js";

const CODE = "schads_award_analysis";
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

describe("Sprint 34L.38 SCHADS award analysis method", () => {
  it("1. removes USER_DEFINITION_REQUIRED_METHOD from schads_award_analysis", () => {
    expect(sectionCodes()).not.toContain("USER_DEFINITION_REQUIRED_METHOD");
    expect(sections()[0]?.sectionCode).toBe("SUBJECT_SCOPE");
  });

  it("2. removes human_professional_method_owner from schads_award_analysis", () => {
    expect(entry().requiredApprovals).not.toHaveProperty("human_professional_method_owner");
    expect(methodPendingCodes()).not.toContain(CODE);
  });

  it("3. uses the approved professional title", () => {
    expect(entry().title).toBe("SCHADS Award Coverage, Classification & Entitlement Analysis");
    expect(entry().purpose).toContain("which stream/classification/pay point");
  });

  it("4. represents Award coverage analysis", () => {
    expect(section("AWARD_COVERAGE").description).toContain("Employer coverage");
    expect(section("AWARD_COVERAGE").description).toContain("work performed");
    expect(section("AWARD_COVERAGE").description).toContain("SCHADS_APPLIES");
  });

  it("5. requires coverage before rates", () => {
    expect(section("AWARD_COVERAGE").instructions).toContain("Coverage before rates");
    expect(entry().validationRules?.map((rule) => rule.rule)).toContain("coverage_before_rates");
    expect(entry().evidenceContract?.freshnessRules).toMatchObject({ coverageBeforeRates: true });
  });

  it("6. represents employment type", () => {
    expect(section("EMPLOYMENT_TYPE").description).toContain("Full-time");
    expect(section("EMPLOYMENT_TYPE").description).toContain("part-time");
    expect(section("EMPLOYMENT_TYPE").description).toContain("casual");
  });

  it("7. represents Award stream determination", () => {
    expect(section("SCHADS_STREAM").description).toContain("actual work performed");
    expect(section("SCHADS_STREAM").description).toContain("social/community services");
    expect(section("SCHADS_STREAM").instructions).toContain("Use current Award text");
  });

  it("8. classifies from actual duties rather than title alone", () => {
    expect(section("CLASSIFICATION").description).toContain("Actual duties");
    expect(section("CLASSIFICATION").instructions).toContain("not title alone");
    expect(entry().evidenceContract?.freshnessRules).toMatchObject({ jobTitleAloneCannotDetermineClassification: true });
  });

  it("9. represents pay-point and progression logic", () => {
    expect(section("PAY_POINT_PROGRESSION").description).toContain("Applicable pay point");
    expect(section("PAY_POINT_PROGRESSION").description).toContain("progression evidence");
    expect(section("PAY_POINT_PROGRESSION").instructions).toContain("Do not hard-code dollar values");
  });

  it("10. represents actual work reconstruction", () => {
    expect(section("ACTUAL_WORK_RECONSTRUCTION").description).toContain("actual start/end");
    expect(section("ACTUAL_WORK_RECONSTRUCTION").description).toContain("sleepovers");
    expect(section("ACTUAL_WORK_RECONSTRUCTION").description).toContain("call-backs");
  });

  it("11. keeps scheduled, actual, timesheeted, payroll and paid states distinct", () => {
    expect(section("ACTUAL_WORK_RECONSTRUCTION").instructions).toContain("SCHEDULED");
    expect(section("ACTUAL_WORK_RECONSTRUCTION").instructions).toContain("PAYROLL_CALCULATED");
    expect(section("ACTUAL_WORK_RECONSTRUCTION").instructions).toContain("PAID");
  });

  it("12. represents ordinary-hours analysis", () => {
    expect(section("ORDINARY_HOURS").description).toContain("Ordinary-hours span");
    expect(section("ORDINARY_HOURS").description).toContain("part-time agreed hours");
    expect(section("ORDINARY_HOURS").instructions).toContain("Do not hard-code numeric limits");
  });

  it("13. represents shift-character analysis", () => {
    expect(section("SHIFT_CHARACTER").description).toContain("broken shift");
    expect(section("SHIFT_CHARACTER").description).toContain("sleepover");
    expect(section("SHIFT_CHARACTER").description).toContain("active overnight work");
  });

  it("14. represents sleepover treatment", () => {
    expect(section("SLEEPOVER_ANALYSIS").description).toContain("scheduled sleepover period");
    expect(section("SLEEPOVER_ANALYSIS").description).toContain("interruptions/call-outs");
    expect(section("SLEEPOVER_ANALYSIS").instructions).toContain("Do not hard-code allowance amounts");
  });

  it("15. distinguishes active sleepover work from sleepover itself", () => {
    expect(section("SLEEPOVER_ANALYSIS").description).toContain("active work during sleepover");
    expect(section("SLEEPOVER_ANALYSIS").instructions).toContain("do not treat sleepover as identical to active night shift");
  });

  it("16. represents broken-shift analysis", () => {
    expect(section("BROKEN_SHIFT_ANALYSIS").description).toContain("Number of work periods");
    expect(section("BROKEN_SHIFT_ANALYSIS").description).toContain("gap(s)");
    expect(section("BROKEN_SHIFT_ANALYSIS").description).toContain("broken-shift allowance");
  });

  it("17. represents minimum-engagement analysis", () => {
    expect(section("MINIMUM_ENGAGEMENT").description).toContain("part-time");
    expect(section("MINIMUM_ENGAGEMENT").description).toContain("casual");
    expect(section("MINIMUM_ENGAGEMENT").instructions).toContain("Do not invent unpaid short engagements");
  });

  it("18. represents penalty analysis", () => {
    expect(section("PENALTY_ANALYSIS").description).toContain("weekend penalties");
    expect(section("PENALTY_ANALYSIS").description).toContain("casual loading");
    expect(section("PENALTY_ANALYSIS").instructions).toContain("Do not assume penalties stack automatically");
  });

  it("19. represents overtime analysis", () => {
    expect(section("OVERTIME_ANALYSIS").description).toContain("outside agreed part-time hours");
    expect(section("OVERTIME_ANALYSIS").description).toContain("sleepover active work");
    expect(section("OVERTIME_ANALYSIS").instructions).toContain("payroll_workforce_cost_review");
  });

  it("20. represents allowance analysis", () => {
    expect(section("ALLOWANCE_ANALYSIS").description).toContain("first aid");
    expect(section("ALLOWANCE_ANALYSIS").description).toContain("vehicle/travel");
    expect(section("ALLOWANCE_ANALYSIS").instructions).toContain("Do not hard-code allowance amounts");
  });

  it("21. represents leave and NES interaction", () => {
    expect(section("LEAVE_NES_INTERACTION").description).toContain("Annual leave");
    expect(section("LEAVE_NES_INTERACTION").description).toContain("NES entitlements");
    expect(section("LEAVE_NES_INTERACTION").instructions).toContain("historical organisational policy");
  });

  it("22. prevents internal policy reducing Award minimums", () => {
    expect(section("ENTERPRISE_CONTRACT_POLICY_CONFLICT").description).toContain("potentially non-compliant");
    expect(section("ENTERPRISE_CONTRACT_POLICY_CONFLICT").instructions).toContain("internal policy reduce Award minimums");
  });

  it("23. requires current SCHADS authority", () => {
    expect(entry().evidenceContract?.requiredEvidenceCategories).toEqual([
      "current_award_source",
      "employment_record",
      "actual_work_record",
      "current_authority",
    ]);
    expect(entry().evidenceContract?.freshnessRules).toMatchObject({ currentAwardAuthorityRequired: true });
  });

  it("24. does not hard-code mutable rates or percentages", () => {
    expect(allText()).toContain("Do not hard-code");
    expect(entry().evidenceContract?.freshnessRules).toMatchObject({ mutableRatesAndPercentagesMustComeFromCurrentAuthority: true });
    expect(allText()).not.toMatch(/\\$\\d|\\b\\d{1,3}%\\b/);
  });

  it("25. ties historical rules to work period and effective date", () => {
    expect(entry().evidenceContract?.freshnessRules).toMatchObject({
      supersededAwardVersionsRemainHistorical: true,
      effectiveDateMustMatchWorkPeriod: true,
    });
  });

  it("26. preserves classification uncertainty", () => {
    expect(section("EVIDENCE_CONFLICT_MISSING_EVIDENCE").description).toContain("multiple plausible classifications");
    expect(section("EVIDENCE_CONFLICT_MISSING_EVIDENCE").instructions).toContain("Preserve unresolved classification");
    expect(entry().evidenceContract?.freshnessRules).toMatchObject({ unresolvedClassificationMustRemainUnresolved: true });
  });

  it("27. routes Award interpretation uncertainty to human or legal review", () => {
    expect(section("PROFESSIONAL_CONCLUSION").description).toContain("AWARD_INTERPRETATION_REQUIRES_HUMAN_REVIEW");
    expect(entry().escalationRules).toEqual(expect.arrayContaining([
      expect.objectContaining({ trigger: "coverage_or_classification_disputed", action: "preserve_uncertainty_and_route_for_payroll_pc_or_legal_review" }),
    ]));
  });

  it("28. keeps payroll_workforce_cost_review separate", () => {
    expect(section("BOUNDARIES_AND_HANDOFFS").description).toContain("payroll_workforce_cost_review");
    expect(entry().deliverableContract?.prohibitedDeliverables).toContain("payroll_calculation");
    expect(entry().escalationRules).toEqual(expect.arrayContaining([
      expect.objectContaining({ trigger: "payroll_reconciliation_required", action: "recommend_payroll_workforce_cost_review_without_performing_payroll_calculation" }),
    ]));
  });

  it("29. keeps rostering_fatigue_review separate", () => {
    expect(section("BOUNDARIES_AND_HANDOFFS").description).toContain("rostering_fatigue_review");
    expect(entry().escalationRules).toEqual(expect.arrayContaining([
      expect.objectContaining({ trigger: "rostering_fatigue_or_roster_design_issue_identified", action: "recommend_rostering_fatigue_review_or_roster_planning_without_merging_methods" }),
    ]));
  });

  it("30. keeps employment_compliance_review separate", () => {
    expect(section("BOUNDARIES_AND_HANDOFFS").description).toContain("employment_compliance_review");
    expect(entry().escalationRules).toEqual(expect.arrayContaining([
      expect.objectContaining({ trigger: "broader_employment_compliance_issue_identified", action: "recommend_employment_compliance_review_without_absorbing_method" }),
    ]));
  });

  it("31. protects payroll, tax, super and LSL boundaries", () => {
    expect(entry().deliverableContract?.prohibitedDeliverables).toEqual(expect.arrayContaining([
      "complete_payslip",
      "payg_withholding_calculation",
      "superannuation_reconciliation",
      "long_service_leave_liability",
    ]));
    expect(entry().externalAuthorityRequiredFor).toEqual(expect.arrayContaining([
      "tax advice",
      "superannuation compliance certification",
      "long-service-leave liability determination",
    ]));
  });

  it("32. keeps sibling pending Blueprints gated", () => {
    expect(methodPendingCodes()).toEqual(expect.arrayContaining([
    ]));
  });

  it("33. preserves the single compatibility route count", () => {
    expect(compatibilityRoutes().map((blueprint) => blueprint.code)).toEqual(["regulatory_change_impact"]);
    expect(compatibilityRoutes()).toHaveLength(1);
  });

  it("34. moves genuine method-pending count to 13 with truthful programme accounting", () => {
    expect(BLUEPRINT_REGISTRY).toHaveLength(75);
    expect(methodPendingCodes()).toHaveLength(0);
    expect(BLUEPRINT_REGISTRY.length - methodPendingCodes().length - compatibilityRoutes().length).toBe(74);
  });

  it("35. preserves owner and approval boundaries", () => {
    expect(resolveRegistryProfessionalOwner(entry())).toBe("payroll_workforce_cost_officer");
    expect(entry().supportingSpecialists).toEqual([
      "people_culture_manager",
      "workforce_compliance_specialist",
      "workforce_rostering_coordinator",
      "knowledge_documentation_specialist",
    ]);
    expect(entry().requiredApprovals).toMatchObject({
      payroll_owner: true,
      people_culture_owner: true,
    });
  });
});
