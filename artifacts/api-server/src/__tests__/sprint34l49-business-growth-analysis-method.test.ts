import { describe, expect, it } from "vitest";
import {
  BLUEPRINT_REGISTRY,
  getRegistryEntry,
  resolveRegistryProfessionalOwner,
} from "../services/blueprintRegistry.js";
import { resolveIntent } from "../services/blueprintIntentMap.js";

const CODE = "business_growth_analysis";
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

describe("Sprint 34L.49 business growth analysis method", () => {
  it("1. removes USER_DEFINITION_REQUIRED_METHOD from business growth analysis", () => {
    expect(sectionCodes()).not.toContain("USER_DEFINITION_REQUIRED_METHOD");
    expect(sections()[0]?.sectionCode).toBe("GROWTH_OBJECTIVE_AND_DECISION_SCOPE");
  });

  it("2. removes human_professional_method_owner from business growth analysis", () => {
    expect(entry().requiredApprovals).not.toHaveProperty("human_professional_method_owner");
    expect(methodPendingCodes()).not.toContain(CODE);
  });

  it("3. uses the approved growth viability title and progression purpose", () => {
    expect(entry().title).toBe("Business Growth & Service Expansion Viability Analysis");
    expect(entry().purpose).toContain("financial viability");
    expect(entry().purpose).toContain("justify progression to a formal business case");
    expect(entry().primaryDeliverable).toBe("Business Growth & Service Expansion Viability Analysis");
  });

  it("4. preserves Chief of Staff ownership and strategic synthesis role", () => {
    expect(resolveRegistryProfessionalOwner(entry())).toBe("chief_of_staff");
    expect(entry().supportingSpecialists).toEqual([
      "financial_planning_reporting_manager",
      "marketing_communications_manager",
      "operations_manager",
      "finance_officer",
      "knowledge_documentation_specialist",
    ]);
    expect(entry().requiredApprovals).toMatchObject({ executive_owner: true });
  });

  it("5. preserves strategic growth routing", () => {
    expect(resolveIntent("strategic.growth_analysis")).toMatchObject({ code: CODE });
  });

  it("6. keeps business growth as structured analysis rather than a proposal artifact", () => {
    expect(entry().deliverableContract).toMatchObject({
      artifactRequired: false,
      templateRequired: false,
    });
    expect(entry().deliverableContract?.prohibitedDeliverables).toEqual(expect.arrayContaining([
      "investment_approval",
      "budget_approval",
      "service_expansion_approval",
      "service_launch_approval",
      "contract_commitment",
      "property_acquisition",
      "hiring_decision",
      "registration_submission",
      "public_growth_claim",
      "business_case_document",
    ]));
  });

  it("7. requires cross-functional viability evidence", () => {
    expect(entry().evidenceContract?.requiredEvidenceCategories).toEqual([
      "business_objective",
      "strategic_plan",
      "market_analysis_output",
      "financial_analysis_output",
      "workforce_plan",
      "operational_record",
    ]);
    expect(entry().evidenceContract?.minimumEvidenceCount).toBe(6);
    expect(entry().evidenceContract?.missingEvidenceBehaviour).toBe("block_completion");
  });

  it("8. supports growth objective and option comparison with status quo", () => {
    expect(section("GROWTH_OBJECTIVE_AND_DECISION_SCOPE").description).toContain("Proposed growth objective");
    expect(section("GROWTH_OBJECTIVE_AND_DECISION_SCOPE").description).toContain("decision required");
    expect(section("OPTION_DEFINITION_AND_BASELINE").description).toContain("status quo/do-nothing comparator");
    expect(section("OPTION_DEFINITION_AND_BASELINE").instructions).toContain("Growth analysis compares options");
  });

  it("9. represents strategic fit and governance maturity", () => {
    expect(section("STRATEGIC_FIT_AND_GOVERNANCE_ALIGNMENT").description).toContain("risk appetite");
    expect(section("STRATEGIC_FIT_AND_GOVERNANCE_ALIGNMENT").description).toContain("governance maturity");
    expect(section("STRATEGIC_FIT_AND_GOVERNANCE_ALIGNMENT").instructions).toContain("profitable opportunity may still be strategically inappropriate");
  });

  it("10. consumes market evidence without duplicating market analysis", () => {
    expect(section("MARKET_EVIDENCE_CONSUMPTION").description).toContain("ndis_market_analysis");
    expect(section("MARKET_EVIDENCE_CONSUMPTION").instructions).toContain("Market opportunity is not business viability");
    expect(section("MARKET_EVIDENCE_CONSUMPTION").instructions).toContain("do not recreate the full market-analysis method");
  });

  it("11. represents demand confidence", () => {
    expect(section("DEMAND_CONFIDENCE").description).toContain("High-confidence demand");
    expect(section("DEMAND_CONFIDENCE").description).toContain("insufficient evidence");
    expect(section("DEMAND_CONFIDENCE").instructions).toContain("management optimism");
  });

  it("12. protects the NDIS marketing strategy boundary", () => {
    expect(section("MARKETING_STRATEGY_INTERFACE").description).toContain("ndis_marketing_strategy");
    expect(section("MARKETING_STRATEGY_INTERFACE").instructions).toContain("position and generate appropriate referrals");
    expect(section("MARKETING_STRATEGY_INTERFACE").instructions).toContain("whether the option is viable enough to progress");
  });

  it("13. consumes business financial analysis without duplicating it", () => {
    expect(section("FINANCIAL_BASELINE_AND_CAPACITY").description).toContain("profitability");
    expect(section("FINANCIAL_BASELINE_AND_CAPACITY").description).toContain("liquidity");
    expect(section("FINANCIAL_BASELINE_AND_CAPACITY").instructions).toContain("repeating the full business_financial_analysis method");
  });

  it("14. represents the growth financial model", () => {
    expect(section("GROWTH_FINANCIAL_MODEL").description).toContain("Start-up cost");
    expect(section("GROWTH_FINANCIAL_MODEL").description).toContain("working capital");
    expect(section("GROWTH_FINANCIAL_MODEL").description).toContain("downside exposure");
    expect(section("GROWTH_FINANCIAL_MODEL").instructions).toContain("Financial attractiveness is not enough");
  });

  it("15. consumes FP&R forecasts and scenarios without recreating FP&R", () => {
    expect(section("FORECAST_AND_SCENARIO_DEPENDENCY").description).toContain("Financial_planning_reporting_review");
    expect(section("FORECAST_AND_SCENARIO_DEPENDENCY").description).toContain("cash-flow scenario");
    expect(section("FORECAST_AND_SCENARIO_DEPENDENCY").instructions).toContain("Do not recreate full FP&R methodology");
  });

  it("16. covers startup ramp break-even cash and liquidity", () => {
    const description = section("REVENUE_RAMP_BREAK_EVEN_AND_CASH").description;
    expect(description).toContain("Revenue driver model");
    expect(description).toContain("ramp-up period");
    expect(description).toContain("break-even revenue/volume");
    expect(description).toContain("peak cash outflow");
    expect(section("REVENUE_RAMP_BREAK_EVEN_AND_CASH").instructions).toContain("Profit does not equal liquidity");
  });

  it("17. represents workforce requirements and supply risk", () => {
    expect(section("WORKFORCE_REQUIREMENT_AND_SUPPLY_RISK").description).toContain("Role types");
    expect(section("WORKFORCE_REQUIREMENT_AND_SUPPLY_RISK").description).toContain("credential scarcity");
    expect(section("WORKFORCE_REQUIREMENT_AND_SUPPLY_RISK").instructions).toContain("Participant demand can coexist with workforce-constrained non-viability");
  });

  it("18. consumes specialist workforce methods without reinterpreting them", () => {
    const description = section("WORKFORCE_COMPLIANCE_AND_CAPABILITY_INTERFACE").description;
    expect(description).toContain("workforce_compliance_assessment");
    expect(description).toContain("schads_award_analysis");
    expect(description).toContain("roster_planning");
    expect(description).toContain("rostering_fatigue_review");
    expect(section("WORKFORCE_COMPLIANCE_AND_CAPABILITY_INTERFACE").instructions).toContain("without independently reinterpreting");
  });

  it("19. represents capability gaps", () => {
    expect(section("CAPABILITY_GAP_ANALYSIS").description).toContain("current organisational capability");
    expect(section("CAPABILITY_GAP_ANALYSIS").description).toContain("safeguarding");
    expect(section("CAPABILITY_GAP_ANALYSIS").instructions).toContain("Do not describe capability as available without evidence");
  });

  it("20. consumes operational readiness rather than duplicating it", () => {
    expect(section("OPERATIONAL_READINESS_INTERFACE").description).toContain("Operational_readiness_assessment");
    expect(section("OPERATIONAL_READINESS_INTERFACE").description).toContain("contingency");
    expect(section("OPERATIONAL_READINESS_INTERFACE").instructions).toContain("Do not duplicate the full operational-readiness method");
  });

  it("21. represents infrastructure property and SIL/SDA dependencies", () => {
    expect(section("INFRASTRUCTURE_PROPERTY_AND_SIL_SDA_DEPENDENCY").description).toContain("SDA/SIL separation");
    expect(section("INFRASTRUCTURE_PROPERTY_AND_SIL_SDA_DEPENDENCY").description).toContain("participant choice");
    expect(section("INFRASTRUCTURE_PROPERTY_AND_SIL_SDA_DEPENDENCY").instructions).toContain("Property availability does not prove service viability");
  });

  it("22. represents partnership dependency risk", () => {
    expect(section("PARTNERSHIP_DEPENDENCY").description).toContain("exclusivity");
    expect(section("PARTNERSHIP_DEPENDENCY").description).toContain("termination risk");
    expect(section("PARTNERSHIP_DEPENDENCY").instructions).toContain("should not be treated as permanent");
  });

  it("23. preserves regulatory feasibility and KRS authority", () => {
    expect(section("REGULATORY_FEASIBILITY_AND_KRS_AUTHORITY").description).toContain("registration groups");
    expect(section("REGULATORY_FEASIBILITY_AND_KRS_AUTHORITY").description).toContain("Practice Standards");
    expect(section("REGULATORY_FEASIBILITY_AND_KRS_AUTHORITY").instructions).toContain("Runtime does not independently decide regulatory truth");
  });

  it("24. represents registration timing risk", () => {
    expect(section("REGISTRATION_TIMING_RISK").description).toContain("expected dependency");
    expect(section("REGISTRATION_TIMING_RISK").instructions).toContain("Do not assume approval will be granted");
    expect(section("REGISTRATION_TIMING_RISK").instructions).toContain("REGULATORY_DEPENDENCY_UNRESOLVED");
  });

  it("25. makes safeguarding and participant cohort complexity mandatory", () => {
    const description = section("SAFEGUARDING_AND_PARTICIPANT_COHORT_COMPLEXITY").description;
    expect(description).toContain("restrictive practice governance");
    expect(description).toContain("mealtime/clinical needs");
    expect(section("SAFEGUARDING_AND_PARTICIPANT_COHORT_COMPLEXITY").instructions).toContain("Participant safety is a non-negotiable gate");
  });

  it("26. represents service quality governance and systems capacity", () => {
    expect(section("SERVICE_QUALITY_GOVERNANCE_AND_SYSTEMS_CAPACITY").description).toContain("Supervision dilution");
    expect(section("SERVICE_QUALITY_GOVERNANCE_AND_SYSTEMS_CAPACITY").description).toContain("CRM/service systems");
    expect(section("SERVICE_QUALITY_GOVERNANCE_AND_SYSTEMS_CAPACITY").instructions).toContain("governance or systems scale automatically");
  });

  it("27. requires downside scenario using existing risk architecture", () => {
    expect(section("RISK_MATERIALITY_AND_DOWNSIDE_SCENARIO").description).toContain("lower demand");
    expect(section("RISK_MATERIALITY_AND_DOWNSIDE_SCENARIO").description).toContain("incident/safeguarding event");
    expect(section("RISK_MATERIALITY_AND_DOWNSIDE_SCENARIO").instructions).toContain("Downside scenario is mandatory");
  });

  it("28. represents base upside downside and sensitivity separation", () => {
    expect(section("BASE_UPSIDE_DOWNSIDE_AND_SENSITIVITY").description).toContain("Downside, base and upside");
    expect(section("BASE_UPSIDE_DOWNSIDE_AND_SENSITIVITY").description).toContain("referral conversion");
    expect(section("BASE_UPSIDE_DOWNSIDE_AND_SENSITIVITY").instructions).toContain("Do not represent upside as expected outcome");
  });

  it("29. represents option comparison without arbitrary scores", () => {
    expect(section("OPTION_COMPARISON_MATRIX").description).toContain("strategic fit");
    expect(section("OPTION_COMPARISON_MATRIX").description).toContain("time to value");
    expect(section("OPTION_COMPARISON_MATRIX").instructions).toContain("arbitrary numeric score");
  });

  it("30. separates opportunity capability and dependencies", () => {
    expect(section("OPPORTUNITY_CAPABILITY_AND_DEPENDENCY_REGISTER").description).toContain("Separate market opportunity and organisational capability");
    expect(section("OPPORTUNITY_CAPABILITY_AND_DEPENDENCY_REGISTER").description).toContain("registration");
    expect(section("OPPORTUNITY_CAPABILITY_AND_DEPENDENCY_REGISTER").instructions).toContain("HIGH MARKET OPPORTUNITY");
  });

  it("31. represents critical path timing staging and reversibility", () => {
    expect(section("CRITICAL_PATH_TIMING_STAGING_AND_REVERSIBILITY").description).toContain("earliest realistic launch");
    expect(section("CRITICAL_PATH_TIMING_STAGING_AND_REVERSIBILITY").description).toContain("pilot");
    expect(section("CRITICAL_PATH_TIMING_STAGING_AND_REVERSIBILITY").description).toContain("ability to exit");
    expect(section("CRITICAL_PATH_TIMING_STAGING_AND_REVERSIBILITY").instructions).toContain("Do not promise launch dates");
  });

  it("32. represents opportunity cost and cannibalisation", () => {
    expect(section("OPPORTUNITY_COST_AND_CANNIBALISATION").description).toContain("Management attention");
    expect(section("OPPORTUNITY_COST_AND_CANNIBALISATION").description).toContain("workforce diversion");
    expect(section("OPPORTUNITY_COST_AND_CANNIBALISATION").instructions).toContain("all new revenue as incremental");
  });

  it("33. represents evidence confidence and professional viability conclusions", () => {
    const description = section("EVIDENCE_CONFIDENCE_AND_PROGRESSION_CONCLUSION").description;
    expect(description).toContain("VIABLE_FOR_BUSINESS_CASE");
    expect(description).toContain("VIABLE_FOR_STAGED_PILOT");
    expect(description).toContain("NOT_CURRENTLY_VIABLE");
    expect(description).toContain("FINANCIAL_CAPACITY_CONSTRAINED");
    expect(description).toContain("WORKFORCE_CAPACITY_CONSTRAINED");
    expect(description).toContain("SAFEGUARDING_CAPABILITY_GAP");
  });

  it("34. keeps progression distinct from approval", () => {
    expect(section("EVIDENCE_CONFIDENCE_AND_PROGRESSION_CONCLUSION").instructions).toContain("does not approve investment");
    expect(entry().validationRules?.map((rule) => rule.rule)).toContain("progression_not_approval");
  });

  it("35. protects boundaries with completed neighbouring methods", () => {
    const description = section("PROFESSIONAL_BOUNDARIES_AND_HANDOFFS").description;
    expect(description).toContain("ndis_market_analysis");
    expect(description).toContain("ndis_marketing_strategy");
    expect(description).toContain("business_financial_analysis");
    expect(description).toContain("financial_planning_reporting_review");
    expect(description).toContain("operational_readiness_assessment");
    expect(section("PROFESSIONAL_BOUNDARIES_AND_HANDOFFS").instructions).toContain("does not duplicate");
  });

  it("36. preserves business proposal as the separate decision-case boundary", () => {
    expect(section("PROFESSIONAL_BOUNDARIES_AND_HANDOFFS").description).toContain("business_proposal");
    expect(methodPendingCodes()).not.toContain("business_proposal");
    expect(entry("business_proposal").requiredApprovals).not.toHaveProperty("human_professional_method_owner");
    expect(entry("business_proposal").purpose).toContain("complete and defensible business case");
  });

  it("37. preserves formal stakeholder correspondence as the final approved correspondence method", () => {
    expect(methodPendingCodes()).not.toContain("formal_stakeholder_correspondence");
    expect(entry("formal_stakeholder_correspondence").requiredApprovals).not.toHaveProperty("human_professional_method_owner");
    expect(entry("formal_stakeholder_correspondence").purpose).toContain("authorised organisational position");
  });

  it("38. blocks execution and external commitments", () => {
    const text = allText();
    expect(section("APPROVAL_AND_EXECUTION_LIMITS").instructions).toContain("must not approve");
    expect(text).toContain("property_acquisition");
    expect(text).toContain("hiring_decision");
    expect(text).toContain("registration_submission");
    expect(text).toContain("public_growth_claim");
  });

  it("39. defines validation rules for the Product Owner doctrine", () => {
    expect(entry().validationRules?.map((rule) => rule.rule)).toEqual(expect.arrayContaining([
      "approved_business_growth_viability_method_applied",
      "market_opportunity_not_business_viability",
      "financial_attractiveness_does_not_override_constraints",
      "growth_options_compared_not_described_only",
      "downside_scenario_required_for_material_options",
      "specialist_outputs_consumed_not_duplicated",
      "progression_not_approval",
    ]));
  });

  it("40. preserves current-authority source classes for growth feasibility", () => {
    expect(entry().externalAuthorityRequiredFor).toEqual(expect.arrayContaining([
      "registration requirement",
      "registration groups",
      "NDIS Practice Standards",
      "SIL requirements",
      "restrictive practice requirements",
      "worker screening",
      "clinical/professional requirements",
      "building/property requirements",
      "privacy",
      "pricing authority",
    ]));
  });

  it("41. removes business growth from method-pending accounting", () => {
    expect(methodPendingCodes()).toHaveLength(0);
    expect(methodPendingCodes()).not.toContain(CODE);
    expect(methodPendingCodes()).toEqual([]);
    expect(compatibilityRoutes()).toHaveLength(1);
    expect(BLUEPRINT_REGISTRY.length - methodPendingCodes().length - compatibilityRoutes().length).toBe(74);
  });
});
