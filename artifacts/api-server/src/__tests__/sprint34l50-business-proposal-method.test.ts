import { describe, expect, it } from "vitest";
import {
  BLUEPRINT_REGISTRY,
  getRegistryEntry,
  resolveRegistryProfessionalOwner,
} from "../services/blueprintRegistry.js";
import { resolveIntent } from "../services/blueprintIntentMap.js";

const CODE = "business_proposal";
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

describe("Sprint 34L.50 business proposal method", () => {
  it("1. removes USER_DEFINITION_REQUIRED_METHOD from business proposal", () => {
    expect(sectionCodes()).not.toContain("USER_DEFINITION_REQUIRED_METHOD");
    expect(sections()[0]?.sectionCode).toBe("BUSINESS_CASE_IDENTITY");
  });

  it("2. removes human_professional_method_owner from business proposal", () => {
    expect(entry().requiredApprovals).not.toHaveProperty("human_professional_method_owner");
    expect(methodPendingCodes()).not.toContain(CODE);
  });

  it("3. uses the approved business case and investment proposal identity", () => {
    expect(entry().title).toBe("Business Case & Investment Proposal Assessment");
    expect(entry().purpose).toContain("complete and defensible business case");
    expect(entry().purpose).toContain("exact approval requested");
    expect(entry().primaryDeliverable).toBe("Business Case & Investment Proposal Assessment");
  });

  it("4. preserves Chief of Staff ownership and specialist support", () => {
    expect(resolveRegistryProfessionalOwner(entry())).toBe("chief_of_staff");
    expect(entry().supportingSpecialists).toEqual([
      "financial_planning_reporting_manager",
      "finance_officer",
      "operations_manager",
      "marketing_communications_manager",
      "knowledge_documentation_specialist",
    ]);
    expect(entry().requiredApprovals).toMatchObject({ executive_owner: true, financial_planning_owner: true });
  });

  it("5. preserves business proposal routing", () => {
    expect(resolveIntent("business_proposal.create")).toMatchObject({ code: CODE, mode: "create" });
    expect(resolveIntent("business_proposal.review")).toMatchObject({ code: CODE, mode: "review" });
  });

  it("6. remains a controlled DOCX decision-case artifact", () => {
    expect(entry().deliverableContract).toMatchObject({
      artifactRequired: true,
      primaryFormat: "docx",
      templateRequired: true,
      primaryDeliverable: "business_case_investment_proposal_assessment",
    });
    expect(entry().deliverableContract?.prohibitedDeliverables).toEqual(expect.arrayContaining([
      "investment_approval",
      "budget_approval",
      "expenditure_approval",
      "contract_commitment",
      "commercial_commitment",
      "service_launch_approval",
      "initiative_launch",
      "hiring_decision",
      "property_acquisition",
      "registration_submission",
      "payment_execution",
      "legal_advice",
      "generic_document_assembly",
    ]));
  });

  it("7. requires decision-case evidence rather than a sales pitch", () => {
    expect(entry().evidenceContract?.requiredEvidenceCategories).toEqual([
      "business_case",
      "business_objective",
      "strategic_plan",
      "financial_record",
      "approval_record",
      "risk_register",
    ]);
    expect(entry().evidenceContract?.minimumEvidenceCount).toBe(6);
    expect(entry().evidenceContract?.missingEvidenceBehaviour).toBe("block_completion");
    expect(entry().evidenceContract?.restrictedSourceTypes).toEqual(expect.arrayContaining([
      "management_preference_only",
      "optimistic_projection_only",
      "sales_pitch_only",
    ]));
  });

  it("8. protects proposal evidence freshness and state separation", () => {
    expect(entry().evidenceContract?.freshnessRules).toMatchObject({
      assumptionsMustBeExplicit: true,
      assumptionDoesNotEqualFact: true,
      forecastDoesNotEqualActual: true,
      targetDoesNotEqualForecast: true,
      scenarioDoesNotEqualExpectedResult: true,
      recommendationMustFollowEvidence: true,
      approvalSoughtMustBeExplicit: true,
      decisionRightsRequireAuthorityEvidence: true,
    });
  });

  it("9. establishes business case identity and decision authority without invention", () => {
    expect(section("BUSINESS_CASE_IDENTITY").description).toContain("decision-maker or approval authority");
    expect(section("BUSINESS_CASE_IDENTITY").description).toContain("version and status");
    expect(section("BUSINESS_CASE_IDENTITY").instructions).toContain("Do not invent approval authority");
  });

  it("10. includes a decision-oriented executive summary", () => {
    expect(section("EXECUTIVE_DECISION_SUMMARY").description).toContain("exact decision requested");
    expect(section("EXECUTIVE_DECISION_SUMMARY").description).toContain("unresolved dependencies");
    expect(section("EXECUTIVE_DECISION_SUMMARY").instructions).toContain("not a sales pitch");
  });

  it("11. requires problem opportunity and evidence of need", () => {
    expect(section("PROBLEM_OPPORTUNITY_AND_EVIDENCE_OF_NEED").description).toContain("unmet need");
    expect(section("PROBLEM_OPPORTUNITY_AND_EVIDENCE_OF_NEED").description).toContain("regulatory change");
    expect(section("PROBLEM_OPPORTUNITY_AND_EVIDENCE_OF_NEED").instructions).toContain("Do not invent urgency");
  });

  it("12. represents strategic alignment and current base case", () => {
    expect(section("STRATEGIC_ALIGNMENT_AND_BASE_CASE").description).toContain("risk appetite");
    expect(section("STRATEGIC_ALIGNMENT_AND_BASE_CASE").description).toContain("current revenue/cost");
    expect(section("STRATEGIC_ALIGNMENT_AND_BASE_CASE").instructions).toContain("merely because the proposal could make money");
  });

  it("13. includes status quo and do nothing where meaningful", () => {
    expect(section("STATUS_QUO_DO_NOTHING_CASE").description).toContain("lost opportunity");
    expect(section("STATUS_QUO_DO_NOTHING_CASE").description).toContain("opportunity cost");
    expect(section("STATUS_QUO_DO_NOTHING_CASE").instructions).toContain("not zero cost by default");
  });

  it("14. represents credible options and alternatives", () => {
    expect(section("OPTIONS_CONSIDERED").description).toContain("staged/pilot implementation");
    expect(section("OPTIONS_CONSIDERED").description).toContain("do nothing");
    expect(section("OPTIONS_CONSIDERED").instructions).toContain("must not manufacture meaningless alternatives");
  });

  it("15. compares options on a common professional frame", () => {
    expect(section("OPTIONS_COMPARISON").description).toContain("financial viability");
    expect(section("OPTIONS_COMPARISON").description).toContain("reversibility");
    expect(section("OPTIONS_COMPARISON").instructions).toContain("Recommendation follows evidence");
  });

  it("16. consumes growth, market and marketing evidence without duplication", () => {
    const description = section("GROWTH_MARKET_AND_MARKETING_INPUTS").description;
    expect(description).toContain("Business_growth_analysis");
    expect(description).toContain("ndis_market_analysis");
    expect(description).toContain("ndis_marketing_strategy");
    expect(section("GROWTH_MARKET_AND_MARKETING_INPUTS").instructions).toContain("Consume specialist growth, market and marketing outputs");
  });

  it("17. defines scope and operating model", () => {
    expect(section("SCOPE_AND_OPERATING_MODEL").description).toContain("In-scope and out-of-scope");
    expect(section("SCOPE_AND_OPERATING_MODEL").description).toContain("suppliers");
    expect(section("SCOPE_AND_OPERATING_MODEL").instructions).toContain("what approval would actually cover");
  });

  it("18. represents the financial case without recreating finance methods", () => {
    expect(section("FINANCIAL_CASE").description).toContain("working capital");
    expect(section("FINANCIAL_CASE").description).toContain("payback");
    expect(section("FINANCIAL_CASE").instructions).toContain("business_financial_analysis");
    expect(section("FINANCIAL_CASE").instructions).toContain("financial_planning_reporting_review");
  });

  it("19. separates actuals forecasts targets scenarios and assumptions", () => {
    expect(section("FINANCIAL_STATE_AND_ASSUMPTION_DISCIPLINE").description).toContain("actual historical result");
    expect(section("FINANCIAL_STATE_AND_ASSUMPTION_DISCIPLINE").description).toContain("effective period");
    expect(section("FINANCIAL_STATE_AND_ASSUMPTION_DISCIPLINE").instructions).toContain("Assumption is not fact");
  });

  it("20. requires calculation provenance and fit-for-purpose return measures", () => {
    expect(section("CALCULATION_PROVENANCE_AND_RETURN_MEASURES").description).toContain("source data plus assumptions plus calculation");
    expect(section("CALCULATION_PROVENANCE_AND_RETURN_MEASURES").description).toContain("ROI");
    expect(section("CALCULATION_PROVENANCE_AND_RETURN_MEASURES").instructions).toContain("unexplained financial numbers");
  });

  it("21. includes startup working capital and break-even", () => {
    expect(section("STARTUP_WORKING_CAPITAL_AND_BREAK_EVEN").description).toContain("contingency");
    expect(section("STARTUP_WORKING_CAPITAL_AND_BREAK_EVEN").description).toContain("time to break-even");
    expect(section("STARTUP_WORKING_CAPITAL_AND_BREAK_EVEN").instructions).toContain("profitable proposal can still fail");
  });

  it("22. requires benefits evidence and benefits realisation", () => {
    expect(section("BENEFITS_CASE_AND_REALISATION").description).toContain("baseline");
    expect(section("BENEFITS_CASE_AND_REALISATION").description).toContain("KPIs");
    expect(section("BENEFITS_CASE_AND_REALISATION").instructions).toContain("Project completion is not proof benefits were realised");
  });

  it("23. represents workforce case and dependencies", () => {
    expect(section("WORKFORCE_CASE_AND_DEPENDENCIES").description).toContain("screening");
    expect(section("WORKFORCE_CASE_AND_DEPENDENCIES").description).toContain("fatigue/rostering");
    expect(section("WORKFORCE_CASE_AND_DEPENDENCIES").instructions).toContain("undeliverable without suitable people");
  });

  it("24. represents operational property technology and supplier case", () => {
    expect(section("OPERATIONAL_PROPERTY_TECHNOLOGY_AND_SUPPLIER_CASE").description).toContain("Operational_readiness_assessment");
    expect(section("OPERATIONAL_PROPERTY_TECHNOLOGY_AND_SUPPLIER_CASE").description).toContain("privacy/security");
    expect(section("OPERATIONAL_PROPERTY_TECHNOLOGY_AND_SUPPLIER_CASE").instructions).toContain("Supplier or partner commitment must be evidenced");
  });

  it("25. preserves regulatory compliance and KRS authority architecture", () => {
    expect(section("REGULATORY_COMPLIANCE_AND_KRS_AUTHORITY").description).toContain("registration");
    expect(section("REGULATORY_COMPLIANCE_AND_KRS_AUTHORITY").description).toContain("timing risk");
    expect(section("REGULATORY_COMPLIANCE_AND_KRS_AUTHORITY").instructions).toContain("Runtime does not independently decide");
  });

  it("26. makes safeguarding and safety a hard decision-case domain", () => {
    expect(section("SAFEGUARDING_AND_SAFETY_CASE").description).toContain("emergency/disaster");
    expect(section("SAFEGUARDING_AND_SAFETY_CASE").description).toContain("clinical dependencies");
    expect(section("SAFEGUARDING_AND_SAFETY_CASE").instructions).toContain("Financial attractiveness cannot override");
  });

  it("27. requires risk register downside and sensitivity", () => {
    expect(section("RISK_REGISTER_DOWNSIDE_AND_SENSITIVITY").description).toContain("residual risk");
    expect(section("RISK_REGISTER_DOWNSIDE_AND_SENSITIVITY").description).toContain("downside scenarios");
    expect(section("RISK_REGISTER_DOWNSIDE_AND_SENSITIVITY").instructions).toContain("base, downside and upside scenarios separate");
  });

  it("28. represents implementation milestones and critical path", () => {
    expect(section("IMPLEMENTATION_CASE_MILESTONES_AND_CRITICAL_PATH").description).toContain("stabilisation");
    expect(section("IMPLEMENTATION_CASE_MILESTONES_AND_CRITICAL_PATH").description).toContain("completion evidence");
    expect(section("IMPLEMENTATION_CASE_MILESTONES_AND_CRITICAL_PATH").instructions).toContain("Critical path controls earliest feasible implementation");
  });

  it("29. represents governance decision rights and controls", () => {
    expect(section("GOVERNANCE_DECISION_RIGHTS_AND_CONTROLS").description).toContain("decision rights");
    expect(section("GOVERNANCE_DECISION_RIGHTS_AND_CONTROLS").description).toContain("go/no-go criteria");
    expect(section("GOVERNANCE_DECISION_RIGHTS_AND_CONTROLS").instructions).toContain("only where authority is evidenced");
  });

  it("30. requires review points stop exit and reversibility", () => {
    expect(section("REVIEW_POINTS_STOP_EXIT_AND_REVERSIBILITY").description).toContain("pause, stop, redesign");
    expect(section("REVIEW_POINTS_STOP_EXIT_AND_REVERSIBILITY").description).toContain("contract lock-in");
    expect(section("REVIEW_POINTS_STOP_EXIT_AND_REVERSIBILITY").instructions).toContain("Stop/exit conditions are mandatory");
  });

  it("31. requires explicit decision request and approval boundary", () => {
    expect(section("DECISION_REQUEST_AND_APPROVAL_BOUNDARY").description).toContain("Exact approval sought");
    expect(section("DECISION_REQUEST_AND_APPROVAL_BOUNDARY").description).toContain("what is not being approved");
    expect(section("DECISION_REQUEST_AND_APPROVAL_BOUNDARY").instructions).toContain("does not approve spend");
  });

  it("32. protects neighbouring method boundaries and controlled document assembly", () => {
    const description = section("PROFESSIONAL_BOUNDARIES_AND_HANDOFFS").description;
    expect(description).toContain("business_growth_analysis");
    expect(description).toContain("business_financial_analysis");
    expect(description).toContain("financial_planning_reporting_review");
    expect(description).toContain("ndis_market_analysis");
    expect(description).toContain("ndis_marketing_strategy");
    expect(description).toContain("operational_readiness_assessment");
    expect(description).toContain("controlled_document_assembly");
    expect(section("PROFESSIONAL_BOUNDARIES_AND_HANDOFFS").instructions).toContain("does not rerun specialist methods");
  });

  it("33. defines professional conclusion states without approving", () => {
    const description = section("PROFESSIONAL_CONCLUSION").description;
    expect(description).toContain("DECISION_CASE_COMPLETE_FOR_REVIEW");
    expect(description).toContain("APPROVAL_SCOPE_UNCLEAR");
    expect(description).toContain("FINANCIAL_CASE_UNSUBSTANTIATED");
    expect(description).toContain("NOT_READY_FOR_DECISION");
    expect(section("PROFESSIONAL_CONCLUSION").instructions).toContain("not approval itself");
  });

  it("34. pins the approved validation doctrine", () => {
    expect(entry().validationRules?.map((rule) => rule.rule)).toEqual(expect.arrayContaining([
      "approved_business_case_investment_proposal_method_applied",
      "business_case_not_sales_pitch",
      "recommendation_follows_evidence",
      "credible_options_and_status_quo_considered_where_applicable",
      "costs_benefits_risks_dependencies_visible",
      "assumptions_forecasts_targets_scenarios_separated",
      "approval_sought_explicit",
      "specialist_outputs_consumed_not_duplicated",
      "proposal_does_not_approve_or_commit",
    ]));
  });

  it("35. escalates unresolved evidence and authority without executing decisions", () => {
    expect(entry().escalationRules).toEqual(expect.arrayContaining([
      expect.objectContaining({ trigger: "approval_scope_or_decision_rights_unclear" }),
      expect.objectContaining({ trigger: "financial_numbers_lack_provenance" }),
      expect.objectContaining({ trigger: "regulatory_or_registration_dependency_unresolved" }),
      expect.objectContaining({ trigger: "safeguarding_or_safety_risk_unresolved" }),
      expect.objectContaining({ trigger: "investment_budget_expenditure_contract_launch_hiring_property_registration_payment_or_legal_commitment_required" }),
    ]));
  });

  it("36. preserves current authority boundaries", () => {
    expect(entry().externalAuthorityRequiredFor).toEqual(expect.arrayContaining([
      "investment approval",
      "budget approval",
      "contract commitment",
      "registration submission",
      "payment execution",
      "legal advice",
      "regulatory/compliance determination",
      "safeguarding/safety authority",
      "tax/accounting treatment",
    ]));
  });

  it("37. keeps formal stakeholder correspondence approved and separate", () => {
    expect(methodPendingCodes()).not.toContain("formal_stakeholder_correspondence");
    expect(entry("formal_stakeholder_correspondence").requiredApprovals).not.toHaveProperty("human_professional_method_owner");
    expect(entry("formal_stakeholder_correspondence").purpose).toContain("authorised organisational position");
  });

  it("38. preserves compatibility accounting", () => {
    expect(compatibilityRoutes()).toHaveLength(1);
  });

  it("39. leaves no genuine method-pending Blueprints", () => {
    expect(methodPendingCodes()).toHaveLength(0);
    expect(methodPendingCodes()).toEqual([]);
  });

  it("40. updates canonical professional accounting to 74", () => {
    expect(BLUEPRINT_REGISTRY.length).toBe(75);
    expect(BLUEPRINT_REGISTRY.length - methodPendingCodes().length - compatibilityRoutes().length).toBe(74);
  });

  it("41. carries the business-case doctrine across registry metadata", () => {
    const text = allText();
    expect(text).toContain("not a sales pitch");
    expect(text).toContain("Recommendation follows evidence");
    expect(text).toContain("Assumption is not fact");
    expect(text).toContain("Project completion is not proof benefits were realised");
    expect(text).toContain("The proposal may state approval required only where authority is evidenced");
  });
});
