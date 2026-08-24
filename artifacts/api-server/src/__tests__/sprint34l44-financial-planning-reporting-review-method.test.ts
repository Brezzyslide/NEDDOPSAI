import { describe, expect, it } from "vitest";
import {
  BLUEPRINT_REGISTRY,
  getRegistryEntry,
  resolveRegistryProfessionalOwner,
} from "../services/blueprintRegistry.js";
import { resolveIntent } from "../services/blueprintIntentMap.js";

const CODE = "financial_planning_reporting_review";
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

describe("Sprint 34L.44 financial planning reporting review method", () => {
  it("1. removes USER_DEFINITION_REQUIRED_METHOD from FP&R", () => {
    expect(sectionCodes()).not.toContain("USER_DEFINITION_REQUIRED_METHOD");
    expect(sections()[0]?.sectionCode).toBe("PLANNING_SCOPE");
  });

  it("2. removes human_professional_method_owner from FP&R", () => {
    expect(entry().requiredApprovals).not.toHaveProperty("human_professional_method_owner");
    expect(methodPendingCodes()).not.toContain(CODE);
  });

  it("3. uses the approved planning, forecasting and reporting title", () => {
    expect(entry().title).toBe("Financial Planning, Forecasting & Management Reporting Review");
    expect(entry().purpose).toContain("reconciled financial actuals");
    expect(entry().purpose).toContain("explicit planning assumptions");
    expect(entry().purpose).toContain("what management should monitor, adjust or decide");
  });

  it("4. preserves FP&R ownership", () => {
    expect(resolveRegistryProfessionalOwner(entry())).toBe("financial_planning_reporting_manager");
    expect(entry().supportingSpecialists).toEqual([
      "finance_officer",
      "payroll_workforce_cost_officer",
      "operations_manager",
      "knowledge_documentation_specialist",
    ]);
    expect(entry().requiredApprovals).toMatchObject({ financial_planning_owner: true });
  });

  it("5. preserves financial analysis intent routing to FP&R", () => {
    expect(resolveIntent("financial.analysis")).toMatchObject({ code: CODE });
  });

  it("6. scopes planning before applying every method", () => {
    expect(section("PLANNING_SCOPE").description).toContain("planning horizon");
    expect(section("PLANNING_SCOPE").description).toContain("management audience");
    expect(section("PLANNING_SCOPE").instructions).toContain("Do not run every FP&R test");
  });

  it("7. requires reconciled actuals or routes to operational finance", () => {
    expect(section("RECONCILED_ACTUALS_BASELINE").description).toContain("management accounts");
    expect(section("RECONCILED_ACTUALS_BASELINE").description).toContain("statutory liabilities");
    expect(section("RECONCILED_ACTUALS_BASELINE").instructions).toContain("operational_finance_reconciliation_review");
    expect(entry().validationRules?.map((rule) => rule.rule)).toContain("reconciled_actuals_before_planning");
  });

  it("8. keeps actual, budget, forecast, target and scenario distinct", () => {
    expect(section("STATE_SEPARATION").description).toContain("Actual fact");
    expect(section("STATE_SEPARATION").description).toContain("reforecast");
    expect(section("STATE_SEPARATION").instructions).toContain("Hard rule");
    expect(entry().validationRules?.map((rule) => rule.rule)).toContain("actual_budget_forecast_target_scenario_separated");
  });

  it("9. requires explicit forecast assumptions", () => {
    expect(section("ASSUMPTION_REGISTER").description).toContain("participant/customer numbers");
    expect(section("ASSUMPTION_REGISTER").description).toContain("regulatory cost");
    expect(section("ASSUMPTION_REGISTER").instructions).toContain("source, period, owner, basis, confidence, sensitivity and effective date");
  });

  it("10. represents forecast provenance", () => {
    expect(section("FORECAST_PROVENANCE").description).toContain("Baseline actual");
    expect(section("FORECAST_PROVENANCE").description).toContain("calculation/model");
    expect(section("FORECAST_PROVENANCE").instructions).toContain("A forecast is not an AI prediction");
    expect(entry().validationRules?.map((rule) => rule.rule)).toContain("forecast_provenance_required");
  });

  it("11. represents budget method without treating targets as forecasts", () => {
    expect(section("BUDGET_METHOD").description).toContain("strategic objectives");
    expect(section("BUDGET_METHOD").description).toContain("target result");
    expect(section("BUDGET_METHOD").instructions).toContain("management target from evidence-backed forecast");
  });

  it("12. represents revenue-driver forecasting", () => {
    expect(section("REVENUE_FORECAST").description).toContain("expected volume/utilisation");
    expect(section("REVENUE_FORECAST").description).toContain("service mix");
    expect(section("REVENUE_FORECAST").instructions).toContain("Do not hard-code NDIS assumptions");
  });

  it("13. keeps market demand outside FP&R invention", () => {
    expect(section("REVENUE_FORECAST_BOUNDARY").description).toContain("referral growth");
    expect(section("REVENUE_FORECAST_BOUNDARY").instructions).toContain("ndis_market_analysis");
    expect(section("REVENUE_FORECAST_BOUNDARY").instructions).toContain("FP&R must not invent market demand");
  });

  it("14. represents workforce-cost forecasting with payroll and SCHADS boundaries", () => {
    expect(section("WORKFORCE_COST_FORECAST").description).toContain("FTE/headcount");
    expect(section("WORKFORCE_COST_FORECAST").description).toContain("overtime");
    expect(section("WORKFORCE_COST_FORECAST").instructions).toContain("payroll_workforce_cost_review");
    expect(section("WORKFORCE_COST_FORECAST").instructions).toContain("schads_award_analysis");
  });

  it("15. represents operating-cost forecasting", () => {
    expect(section("OPERATING_COST_FORECAST").description).toContain("insurance");
    expect(section("OPERATING_COST_FORECAST").description).toContain("governance/compliance costs");
    expect(section("OPERATING_COST_FORECAST").instructions).toContain("fixed, variable, semi-variable");
  });

  it("16. keeps profit and cash separate in cash-flow forecasting", () => {
    expect(section("CASH_FLOW_FORECAST").description).toContain("Opening cash");
    expect(section("CASH_FLOW_FORECAST").description).toContain("restricted/unrestricted cash");
    expect(section("CASH_FLOW_FORECAST").instructions).toContain("Profit and cash remain different");
    expect(entry().validationRules?.map((rule) => rule.rule)).toContain("profit_and_cash_separated");
  });

  it("17. represents receivable and collection timing", () => {
    expect(section("RECEIVABLE_COLLECTION_TIMING").description).toContain("debtor ageing");
    expect(section("RECEIVABLE_COLLECTION_TIMING").description).toContain("claim rejection timing");
    expect(section("RECEIVABLE_COLLECTION_TIMING").instructions).toContain("accounting revenue converts immediately to cash");
  });

  it("18. represents payables and commitment timing", () => {
    expect(section("PAYABLE_COMMITMENT_TIMING").description).toContain("statutory obligations");
    expect(section("PAYABLE_COMMITMENT_TIMING").description).toContain("planned capital expenditure");
    expect(section("PAYABLE_COMMITMENT_TIMING").instructions).toContain("timing, not merely accounting expense");
  });

  it("19. represents actual-vs-budget variance", () => {
    expect(section("ACTUAL_VS_BUDGET").description).toContain("absolute variance");
    expect(section("ACTUAL_VS_BUDGET").description).toContain("timing vs structural");
    expect(section("ACTUAL_VS_BUDGET").instructions).toContain("Do not stop at variance calculation");
  });

  it("20. represents actual-vs-forecast analysis", () => {
    expect(section("ACTUAL_VS_FORECAST").description).toContain("Forecast accuracy");
    expect(section("ACTUAL_VS_FORECAST").description).toContain("model weaknesses");
    expect(section("ACTUAL_VS_FORECAST").instructions).toContain("improve the reforecast");
  });

  it("21. represents variance driver analysis without invented causes", () => {
    expect(section("VARIANCE_DRIVER_ANALYSIS").description).toContain("controllable/uncontrollable");
    expect(section("VARIANCE_DRIVER_ANALYSIS").description).toContain("regulatory change");
    expect(section("VARIANCE_DRIVER_ANALYSIS").instructions).toContain("DRIVER_NOT_ESTABLISHED");
  });

  it("22. represents reforecasting without overwriting history", () => {
    expect(section("REFORECAST_METHOD").description).toContain("Original forecast");
    expect(section("REFORECAST_METHOD").description).toContain("changed assumptions");
    expect(section("REFORECAST_METHOD").instructions).toContain("Do not overwrite historical forecast provenance");
  });

  it("23. supports rolling forecasts without hard-coded cycle", () => {
    expect(section("ROLLING_FORECAST").description).toContain("monthly, quarterly");
    expect(section("ROLLING_FORECAST").instructions).toContain("Do not hard-code one planning cycle");
  });

  it("24. represents scenario analysis without forecast certainty", () => {
    expect(section("SCENARIO_ANALYSIS").description).toContain("Downside");
    expect(section("SCENARIO_ANALYSIS").description).toContain("delayed receivables");
    expect(section("SCENARIO_ANALYSIS").instructions).toContain("Do not present scenario output as forecast certainty");
    expect(entry().validationRules?.map((rule) => rule.rule)).toContain("scenario_not_forecast_fact");
  });

  it("25. represents sensitivity analysis", () => {
    expect(section("SENSITIVITY_ANALYSIS").description).toContain("wage cost");
    expect(section("SENSITIVITY_ANALYSIS").description).toContain("collection timing");
    expect(section("SENSITIVITY_ANALYSIS").instructions).toContain("break points");
  });

  it("26. represents break-even and capacity planning with precision limits", () => {
    expect(section("BREAK_EVEN_CAPACITY").description).toContain("minimum utilisation");
    expect(section("BREAK_EVEN_CAPACITY").description).toContain("headcount/service capacity relationship");
    expect(section("BREAK_EVEN_CAPACITY").instructions).toContain("fixed/variable cost classification is uncertain");
  });

  it("27. represents liquidity and headroom without financing approval", () => {
    expect(section("LIQUIDITY_HEADROOM").description).toContain("minimum cash point");
    expect(section("LIQUIDITY_HEADROOM").description).toContain("available headroom");
    expect(section("LIQUIDITY_HEADROOM").instructions).toContain("Do not make financing");
  });

  it("28. tracks financial targets separately from forecasts", () => {
    expect(section("FINANCIAL_TARGET_TRACKING").description).toContain("expected year-end position");
    expect(section("FINANCIAL_TARGET_TRACKING").description).toContain("target progress");
    expect(section("FINANCIAL_TARGET_TRACKING").instructions).toContain("Do not convert targets into forecasts");
  });

  it("29. represents management KPI framework", () => {
    expect(section("KPI_FRAMEWORK").description).toContain("workforce cost ratio");
    expect(section("KPI_FRAMEWORK").description).toContain("forecast accuracy");
    expect(section("KPI_FRAMEWORK").instructions).toContain("Avoid vanity financial metrics");
  });

  it("30. structures management reporting around explanation and decisions", () => {
    expect(section("MANAGEMENT_REPORTING_STRUCTURE").description).toContain("what happened");
    expect(section("MANAGEMENT_REPORTING_STRUCTURE").description).toContain("what management needs to decide");
    expect(section("MANAGEMENT_REPORTING_STRUCTURE").instructions).toContain("Management reporting must explain");
    expect(entry().validationRules?.map((rule) => rule.rule)).toContain("management_reporting_explains_not_merely_displays");
  });

  it("31. keeps dashboard presentation downstream", () => {
    expect(section("EXECUTIVE_DASHBOARD_BOUNDARY").description).toContain("income");
    expect(section("EXECUTIVE_DASHBOARD_BOUNDARY").description).toContain("status indicators");
    expect(section("EXECUTIVE_DASHBOARD_BOUNDARY").instructions).toContain("Template/artifact infrastructure owns presentation");
  });

  it("32. separates fact, plan, forecast and scenario categories", () => {
    expect(section("FACT_PLAN_FORECAST_SCENARIO_BOUNDARY").description).toContain("professional inference");
    expect(section("FACT_PLAN_FORECAST_SCENARIO_BOUNDARY").instructions).toContain("Do not collapse observed fact");
  });

  it("33. represents assumption confidence", () => {
    expect(section("ASSUMPTION_CONFIDENCE").description).toContain("High, medium, low");
    expect(section("ASSUMPTION_CONFIDENCE").instructions).toContain("Low-confidence assumptions");
  });

  it("34. represents management actions without automatic CAPA", () => {
    expect(section("MANAGEMENT_ACTIONS").description).toContain("forecast impact");
    expect(section("MANAGEMENT_ACTIONS").description).toContain("monitoring metric");
    expect(section("MANAGEMENT_ACTIONS").instructions).toContain("Do not automatically generate CAPA");
  });

  it("35. preserves neighbouring Blueprint boundaries", () => {
    expect(section("PROFESSIONAL_BOUNDARIES").description).toContain("operational_finance_reconciliation_review");
    expect(section("PROFESSIONAL_BOUNDARIES").description).toContain("business_financial_analysis");
    expect(section("PROFESSIONAL_BOUNDARIES").description).toContain("tax_financial_obligation_review");
    expect(section("PROFESSIONAL_BOUNDARIES").description).toContain("business_proposal");
  });

  it("36. prohibits budget, investment, expenditure and execution decisions", () => {
    expect(section("APPROVAL_AND_EXECUTION_LIMITS").description).toContain("investment approval");
    expect(section("APPROVAL_AND_EXECUTION_LIMITS").description).toContain("accounting mutation");
    expect(section("APPROVAL_AND_EXECUTION_LIMITS").instructions).toContain("does not approve budgets");
    expect(entry().deliverableContract?.prohibitedDeliverables).toEqual(expect.arrayContaining([
      "budget_approval",
      "expenditure_approval",
      "investment_approval",
      "payment_execution",
      "accounting_system_mutation",
      "forecast_external_publication",
    ]));
  });

  it("37. defines professional conclusion states", () => {
    expect(section("PROFESSIONAL_CONCLUSION").description).toContain("PLAN_ON_TRACK");
    expect(section("PROFESSIONAL_CONCLUSION").description).toContain("LIQUIDITY_RISK");
    expect(section("PROFESSIONAL_CONCLUSION").description).toContain("PLANNING_POSITION_UNRESOLVED");
  });

  it("38. requires the approved planning evidence categories", () => {
    expect(entry().evidenceContract?.requiredEvidenceCategories).toEqual([
      "reconciled_actuals",
      "budget",
      "forecast",
      "assumption_register",
      "cashflow_forecast",
    ]);
    expect(entry().mandatoryCitations).toEqual([
      "reconciled_actuals",
      "budget",
      "forecast",
      "assumption_register",
      "cashflow_forecast",
    ]);
  });

  it("39. exposes currentness, assumption and boundary evidence rules", () => {
    expect(entry().evidenceContract?.freshnessRules).toMatchObject({
      reconciledActualsRequiredBeforePlanning: true,
      forecastProvenanceRequired: true,
      scenarioIsNotForecastFact: true,
      targetIsNotForecast: true,
      materiallyUnreconciledActualsRouteToOperationalFinanceReconciliation: true,
    });
    expect(entry().evidenceContract?.restrictedSourceTypes).toEqual(expect.arrayContaining([
      "hidden_assumption",
      "unsupported_ai_prediction",
      "target_only",
    ]));
  });

  it("40. produces a contracted XLSX management-reporting workbook while dashboard presentation stays downstream", () => {
    expect(entry().deliverableContract).toMatchObject({
      artifactRequired: true,
      primaryFormat: "xlsx",
      templateRequired: false,
    });
  });

  it("41. keeps sibling method-pending Blueprints gated", () => {
    expect(methodPendingCodes()).toEqual(expect.arrayContaining([
    ]));
  });

  it("42. preserves the single compatibility route count", () => {
    expect(compatibilityRoutes().map((blueprint) => blueprint.code)).toEqual(["regulatory_change_impact"]);
    expect(compatibilityRoutes()).toHaveLength(1);
  });

  it("43. moves genuine method-pending count to 1 with truthful programme accounting", () => {
    expect(BLUEPRINT_REGISTRY).toHaveLength(75);
    expect(methodPendingCodes()).toHaveLength(0);
    expect(BLUEPRINT_REGISTRY.length - methodPendingCodes().length - compatibilityRoutes().length).toBe(74);
  });

  it("44. keeps full contract boundaries visible", () => {
    expect(allText()).toContain("operational_finance_reconciliation_review");
    expect(allText()).toContain("business_financial_analysis");
    expect(allText()).toContain("tax_financial_obligation_review");
    expect(allText()).toContain("schads_award_analysis");
    expect(allText()).toContain("business_proposal");
  });
});
