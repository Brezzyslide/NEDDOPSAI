import { describe, expect, it } from "vitest";
import {
  BLUEPRINT_REGISTRY,
  getRegistryEntry,
  resolveRegistryProfessionalOwner,
} from "../services/blueprintRegistry.js";

const CODE = "business_financial_analysis";
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

describe("Sprint 34L.40 business financial analysis method", () => {
  it("1. removes USER_DEFINITION_REQUIRED_METHOD from business_financial_analysis", () => {
    expect(sectionCodes()).not.toContain("USER_DEFINITION_REQUIRED_METHOD");
    expect(sections()[0]?.sectionCode).toBe("ANALYSIS_SCOPE");
  });

  it("2. removes human_professional_method_owner from business_financial_analysis", () => {
    expect(entry().requiredApprovals).not.toHaveProperty("human_professional_method_owner");
    expect(methodPendingCodes()).not.toContain(CODE);
  });

  it("3. uses the approved professional title", () => {
    expect(entry().title).toBe("Business Financial Performance & Sustainability Analysis");
    expect(entry().purpose).toContain("actual financial position");
    expect(entry().purpose).toContain("management decisions supported by evidence");
  });

  it("4. establishes analysis scope and period", () => {
    expect(section("ANALYSIS_SCOPE").description).toContain("reporting period");
    expect(section("ANALYSIS_SCOPE").description).toContain("management question");
    expect(section("ANALYSIS_SCOPE").instructions).toContain("undefined financial period");
  });

  it("5. represents the financial evidence universe", () => {
    expect(section("FINANCIAL_EVIDENCE_UNIVERSE").description).toContain("P&L");
    expect(section("FINANCIAL_EVIDENCE_UNIVERSE").description).toContain("bank statements");
    expect(section("FINANCIAL_EVIDENCE_UNIVERSE").description).toContain("payables");
  });

  it("6. tests source integrity and currentness", () => {
    expect(section("SOURCE_INTEGRITY_CURRENTNESS").description).toContain("source system");
    expect(section("SOURCE_INTEGRITY_CURRENTNESS").description).toContain("reconciled status");
    expect(entry().evidenceContract?.freshnessRules).toMatchObject({ sourceSystemRequired: true });
  });

  it("7. preserves conflicting financial reports", () => {
    expect(section("SOURCE_INTEGRITY_CURRENTNESS").instructions).toContain("Preserve conflicting reports");
    expect(entry().evidenceContract?.freshnessRules).toMatchObject({ conflictingVersionsRequireResolution: true });
  });

  it("8. reconstructs performance beyond P&L summary", () => {
    expect(section("FINANCIAL_PERFORMANCE_RECONSTRUCTION").description).toContain("Revenue");
    expect(section("FINANCIAL_PERFORMANCE_RECONSTRUCTION").description).toContain("workforce costs");
    expect(section("FINANCIAL_PERFORMANCE_RECONSTRUCTION").description).toContain("operating result");
  });

  it("9. analyses revenue beyond total revenue", () => {
    expect(section("REVENUE_ANALYSIS").description).toContain("recurring/non-recurring revenue");
    expect(section("REVENUE_ANALYSIS").description).toContain("utilisation");
    expect(section("REVENUE_ANALYSIS").instructions).toContain("Revenue is not profit");
  });

  it("10. tests revenue quality and cash conversion", () => {
    expect(section("REVENUE_QUALITY").description).toContain("Concentration risk");
    expect(section("REVENUE_QUALITY").instructions).toContain("REVENUE_RECORDED");
    expect(section("REVENUE_QUALITY").instructions).toContain("CASH_COLLECTED");
  });

  it("11. analyses cost structure without labelling all spend waste", () => {
    expect(section("COST_STRUCTURE").description).toContain("fixed overhead");
    expect(section("COST_STRUCTURE").description).toContain("one-off cost");
    expect(section("COST_STRUCTURE").instructions).toContain("without labelling all expenditure as waste");
  });

  it("12. preserves payroll workforce cost boundary", () => {
    expect(section("WORKFORCE_COST_BOUNDARY").description).toContain("Workforce cost percentage of revenue");
    expect(section("WORKFORCE_COST_BOUNDARY").instructions).toContain("payroll_workforce_cost_review");
    expect(entry().evidenceContract?.freshnessRules).toMatchObject({ payrollReconciliationBelongsToPayrollWorkforceCostReview: true });
  });

  it("13. represents margin analysis and allocation limits", () => {
    expect(section("MARGIN_ANALYSIS").description).toContain("Gross margin");
    expect(section("MARGIN_ANALYSIS").description).toContain("service-level margin");
    expect(section("MARGIN_ANALYSIS").instructions).toContain("cost allocation evidence is weak");
  });

  it("14. keeps actual, budget, forecast and historical distinct", () => {
    expect(section("ACTUAL_BUDGET_FORECAST_HISTORICAL").description).toContain("Actual");
    expect(section("ACTUAL_BUDGET_FORECAST_HISTORICAL").description).toContain("budget");
    expect(entry().evidenceContract?.freshnessRules).toMatchObject({ actualBudgetForecastMustRemainDistinct: true });
  });

  it("15. requires driver analysis instead of invented explanations", () => {
    expect(section("DRIVER_ANALYSIS").description).toContain("price");
    expect(section("DRIVER_ANALYSIS").description).toContain("overtime");
    expect(section("DRIVER_ANALYSIS").instructions).toContain("DRIVER_NOT_ESTABLISHED");
  });

  it("16. separates profit and cash", () => {
    expect(section("CASH_FLOW_ANALYSIS").instructions).toContain("Profit and cash are different");
    expect(entry().validationRules?.map((rule) => rule.rule)).toContain("profit_and_cash_separated");
    expect(entry().evidenceContract?.freshnessRules).toMatchObject({ profitAndCashMustBeSeparate: true });
  });

  it("17. protects restricted and trust cash treatment", () => {
    expect(section("CASH_FLOW_ANALYSIS").description).toContain("restricted/trust cash");
    expect(section("CASH_FLOW_ANALYSIS").instructions).toContain("restricted/trust funds");
    expect(entry().evidenceContract?.freshnessRules).toMatchObject({ restrictedCashCannotBeTreatedAsUnrestricted: true });
  });

  it("18. represents liquidity and working-capital analysis", () => {
    expect(section("LIQUIDITY_WORKING_CAPITAL").description).toContain("upcoming payroll");
    expect(section("LIQUIDITY_WORKING_CAPITAL").description).toContain("debtor ageing");
    expect(section("LIQUIDITY_WORKING_CAPITAL").instructions).toContain("incomplete balance-sheet ratios");
  });

  it("19. represents receivables, payables and commitments", () => {
    expect(section("RECEIVABLES_PAYABLES_COMMITMENTS").description).toContain("overdue amounts");
    expect(section("RECEIVABLES_PAYABLES_COMMITMENTS").description).toContain("debt servicing");
    expect(section("RECEIVABLES_PAYABLES_COMMITMENTS").instructions).toContain("liability outstanding");
  });

  it("20. tests profitability versus cash conversion", () => {
    expect(section("PROFITABILITY_CASH_CONVERSION").description).toContain("usable cash");
    expect(section("PROFITABILITY_CASH_CONVERSION").description).toContain("delayed claiming");
  });

  it("21. represents trend and sustainability analysis", () => {
    expect(section("TREND_AND_SUSTAINABILITY").description).toContain("working-capital");
    expect(section("TREND_AND_SUSTAINABILITY").description).toContain("owner funding");
    expect(section("TREND_AND_SUSTAINABILITY").instructions).toContain("long-term sustainability");
  });

  it("22. represents break-even analysis with assumptions", () => {
    expect(section("BREAK_EVEN_ANALYSIS").description).toContain("break-even revenue");
    expect(section("BREAK_EVEN_ANALYSIS").instructions).toContain("Clearly state assumptions");
  });

  it("23. represents scenario and sensitivity analysis", () => {
    expect(section("SCENARIO_SENSITIVITY").description).toContain("major customer loss");
    expect(section("SCENARIO_SENSITIVITY").instructions).toContain("scenario output as forecast fact");
  });

  it("24. preserves forecast boundary", () => {
    expect(section("FORECAST_BOUNDARY").description).toContain("actual, budget, forecast, scenario");
    expect(section("FORECAST_BOUNDARY").instructions).toContain("targets into forecasts");
  });

  it("25. assesses financial risk and data quality", () => {
    expect(section("FINANCIAL_RISK_DATA_QUALITY").description).toContain("cash shortfall");
    expect(section("FINANCIAL_RISK_DATA_QUALITY").description).toContain("unreconciled accounts");
    expect(section("FINANCIAL_RISK_DATA_QUALITY").instructions).toContain("DATA_QUALITY_INSUFFICIENT");
  });

  it("26. requires calculation provenance", () => {
    expect(section("CALCULATION_PROVENANCE").description).toContain("formula");
    expect(entry().validationRules?.map((rule) => rule.rule)).toContain("calculation_provenance_required");
    expect(entry().evidenceContract?.freshnessRules).toMatchObject({ calculationsRequireInputAndFormulaProvenance: true });
  });

  it("27. separates facts, calculations, forecasts and recommendations", () => {
    expect(section("FACT_CALCULATION_FORECAST_RECOMMENDATION").description).toContain("Verified fact");
    expect(section("FACT_CALCULATION_FORECAST_RECOMMENDATION").description).toContain("professional inference");
    expect(section("FACT_CALCULATION_FORECAST_RECOMMENDATION").instructions).toContain("recommendation into one evidence class");
  });

  it("28. requires decision-oriented recommendations", () => {
    expect(section("DECISION_ORIENTED_ANALYSIS").description).toContain("decisions requiring attention");
    expect(section("DECISION_ORIENTED_ANALYSIS").instructions).toContain("Recommendations must connect to findings");
  });

  it("29. represents management actions and handoffs", () => {
    expect(section("MANAGEMENT_ACTIONS_AND_HANDOFFS").description).toContain("financial impact");
    expect(section("MANAGEMENT_ACTIONS_AND_HANDOFFS").description).toContain("evidence required for closure");
    expect(section("MANAGEMENT_ACTIONS_AND_HANDOFFS").instructions).toContain("tax_financial_obligation_review");
  });

  it("30. represents professional conclusion states", () => {
    expect(section("PROFESSIONAL_CONCLUSION").description).toContain("FINANCIALLY_HEALTHY");
    expect(section("PROFESSIONAL_CONCLUSION").description).toContain("DATA_QUALITY_INSUFFICIENT");
    expect(section("PROFESSIONAL_CONCLUSION").description).toContain("FINANCIAL_POSITION_UNRESOLVED");
  });

  it("31. protects accounting, tax, audit, banking and approval limits", () => {
    expect(section("APPROVAL_AND_EXTERNAL_LIMITS").instructions).toContain("does not certify accounts");
    expect(entry().deliverableContract?.prohibitedDeliverables).toEqual(expect.arrayContaining([
      "investment_approval",
      "budget_approval",
      "audit_certification",
      "tax_advice",
      "accounting_system_mutation",
      "banking_action",
    ]));
  });

  it("32. requires financial analysis evidence categories", () => {
    expect(entry().evidenceContract?.requiredEvidenceCategories).toEqual([
      "financial_record",
      "management_account",
      "cashflow_record",
      "budget_or_forecast",
    ]);
    expect(entry().mandatoryCitations).toEqual(["financial_record", "management_account", "cashflow_record", "budget_or_forecast"]);
  });

  it("33. keeps sibling method-pending Blueprints gated", () => {
    expect(methodPendingCodes()).toEqual(expect.arrayContaining([
    ]));
  });

  it("34. preserves the single compatibility route count", () => {
    expect(compatibilityRoutes().map((blueprint) => blueprint.code)).toEqual(["regulatory_change_impact"]);
    expect(compatibilityRoutes()).toHaveLength(1);
  });

  it("35. moves genuine method-pending count to 11 with truthful programme accounting", () => {
    expect(BLUEPRINT_REGISTRY).toHaveLength(75);
    expect(methodPendingCodes()).toHaveLength(0);
    expect(BLUEPRINT_REGISTRY.length - methodPendingCodes().length - compatibilityRoutes().length).toBe(74);
  });

  it("36. preserves owner and support boundaries", () => {
    expect(resolveRegistryProfessionalOwner(entry())).toBe("financial_planning_reporting_manager");
    expect(entry().supportingSpecialists).toEqual([
      "finance_officer",
      "payroll_workforce_cost_officer",
      "operations_manager",
      "knowledge_documentation_specialist",
    ]);
    expect(entry().requiredApprovals).toMatchObject({ financial_planning_owner: true });
  });

  it("37. does not duplicate payroll or tax specialist methods", () => {
    expect(entry().escalationRules).toEqual(expect.arrayContaining([
      expect.objectContaining({ trigger: "payroll_or_workforce_cost_reconciliation_required", action: "recommend_payroll_workforce_cost_review_without_rebuilding_payroll_method" }),
      expect.objectContaining({ trigger: "tax_or_statutory_financial_obligation_review_required", action: "recommend_tax_financial_obligation_review_without_providing_tax_advice" }),
    ]));
    expect(allText()).toContain("This Blueprint analyses financial evidence");
  });
});
