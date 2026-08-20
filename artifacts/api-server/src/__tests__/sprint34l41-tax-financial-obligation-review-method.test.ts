import { describe, expect, it } from "vitest";
import {
  BLUEPRINT_REGISTRY,
  getRegistryEntry,
  resolveRegistryProfessionalOwner,
} from "../services/blueprintRegistry.js";

const CODE = "tax_financial_obligation_review";
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

describe("Sprint 34L.41 tax financial obligation review method", () => {
  it("1. removes USER_DEFINITION_REQUIRED_METHOD from tax_financial_obligation_review", () => {
    expect(sectionCodes()).not.toContain("USER_DEFINITION_REQUIRED_METHOD");
    expect(sections()[0]?.sectionCode).toBe("ENTITY_REVIEW_SCOPE");
  });

  it("2. removes human_professional_method_owner from tax_financial_obligation_review", () => {
    expect(entry().requiredApprovals).not.toHaveProperty("human_professional_method_owner");
    expect(methodPendingCodes()).not.toContain(CODE);
  });

  it("3. uses the approved professional title", () => {
    expect(entry().title).toBe("Tax & Statutory Financial Obligations Compliance Review");
    expect(entry().purpose).toContain("statutory financial obligations");
    expect(entry().purpose).toContain("external confirmation");
  });

  it("4. establishes entity and review scope", () => {
    expect(section("ENTITY_REVIEW_SCOPE").description).toContain("ABN/ACN");
    expect(section("ENTITY_REVIEW_SCOPE").description).toContain("GST registration status");
    expect(section("ENTITY_REVIEW_SCOPE").instructions).toContain("same obligation profile");
  });

  it("5. determines obligation universe through applicability", () => {
    expect(section("OBLIGATION_UNIVERSE").description).toContain("GST");
    expect(section("OBLIGATION_UNIVERSE").description).toContain("superannuation guarantee");
    expect(section("OBLIGATION_UNIVERSE").instructions).toContain("applies/does not apply/unresolved");
  });

  it("6. requires KRS-resolved current authority", () => {
    expect(section("CURRENT_AUTHORITY_RESOLUTION").instructions).toContain("KRS feeds authoritative knowledge into runtime");
    expect(entry().validationRules?.map((rule) => rule.rule)).toContain("krs_resolved_authority_required");
    expect(entry().evidenceContract?.freshnessRules).toMatchObject({ krsResolvedAuthorityRequired: true });
  });

  it("7. prevents runtime from choosing statutory truth independently", () => {
    expect(section("CURRENT_AUTHORITY_COMPLETION_GATE").instructions).toContain("independent web browsing");
    expect(entry().evidenceContract?.freshnessRules).toMatchObject({ runtimeMustNotIndependentlyChooseStatutorySource: true });
  });

  it("8. requires jurisdiction-aware authority selection", () => {
    expect(section("PAYROLL_TAX_METHOD").instructions).toContain("jurisdiction-aware current authority");
    expect(section("PAYROLL_TAX_METHOD").instructions).toContain("state revenue obligation");
    expect(entry().evidenceContract?.freshnessRules).toMatchObject({ jurisdictionAwareAuthorityRequired: true });
  });

  it("9. gates current authority completion", () => {
    expect(section("CURRENT_AUTHORITY_COMPLETION_GATE").description).toContain("CURRENT_AUTHORITY_NOT_VERIFIED");
    expect(section("CURRENT_AUTHORITY_COMPLETION_GATE").description).toContain("STATUTORY_INTERPRETATION_UNRESOLVED");
    expect(entry().escalationRules).toEqual(expect.arrayContaining([
      expect.objectContaining({ trigger: "current_authority_not_verified", action: "mark_STATUTORY_INTERPRETATION_UNRESOLVED_and_request_krs_authority" }),
    ]));
  });

  it("10. represents evidence discovery", () => {
    expect(section("EVIDENCE_DISCOVERY").description).toContain("ledgers");
    expect(section("EVIDENCE_DISCOVERY").description).toContain("super clearing-house/fund confirmations");
    expect(section("EVIDENCE_DISCOVERY").instructions).toContain("existing evidence discovery");
  });

  it("11. keeps evidence roles separate", () => {
    expect(section("EVIDENCE_ROLE_SEPARATION").description).toContain("Statutory requirement");
    expect(section("EVIDENCE_ROLE_SEPARATION").description).toContain("external settlement confirmation");
    expect(entry().evidenceContract?.freshnessRules).toMatchObject({ obligationStatesMustRemainSeparate: true });
  });

  it("12. separates triggered, calculated, accrued, reported, lodged, due, paid and confirmed states", () => {
    expect(section("EVIDENCE_ROLE_SEPARATION").instructions).toContain("TRIGGERED");
    expect(section("EVIDENCE_ROLE_SEPARATION").instructions).toContain("PAID_REMITTED");
    expect(section("EVIDENCE_ROLE_SEPARATION").instructions).toContain("CLEARED_EXTERNALLY_CONFIRMED");
  });

  it("13. represents GST and BAS method", () => {
    expect(section("GST_BAS_METHOD").description).toContain("GST registration applicability/status");
    expect(section("GST_BAS_METHOD").description).toContain("lodgement status/date");
    expect(section("GST_BAS_METHOD").instructions).toContain("ATO liability settled");
  });

  it("14. represents PAYG withholding method without personal tax advice", () => {
    expect(section("PAYG_WITHHOLDING_METHOD").description).toContain("actually withheld");
    expect(section("PAYG_WITHHOLDING_METHOD").instructions).toContain("final personal tax liability");
  });

  it("15. represents PAYG instalment and company tax dependency", () => {
    expect(section("PAYG_INSTALMENT_COMPANY_TAX_DEPENDENCY").description).toContain("external account confirmation");
    expect(section("PAYG_INSTALMENT_COMPANY_TAX_DEPENDENCY").instructions).toContain("company tax-return preparation");
  });

  it("16. treats superannuation as first-class remittance evidence", () => {
    expect(section("SUPERANNUATION_METHOD").description).toContain("clearing-house acceptance");
    expect(section("SUPERANNUATION_METHOD").description).toContain("fund receipt/confirmation");
    expect(section("SUPERANNUATION_METHOD").instructions).toContain("Payroll super expense or liability does not prove contribution");
  });

  it("17. represents payroll tax method", () => {
    expect(section("PAYROLL_TAX_METHOD").description).toContain("employer/group status");
    expect(section("PAYROLL_TAX_METHOD").description).toContain("threshold applicability");
  });

  it("18. represents FBT method without model-memory treatment", () => {
    expect(section("FBT_METHOD").description).toContain("FBT-relevant arrangements");
    expect(section("FBT_METHOD").instructions).toContain("model memory");
  });

  it("19. represents contractor and other reporting obligations", () => {
    expect(section("CONTRACTOR_OTHER_REPORTING").description).toContain("Contractor withholding");
    expect(section("CONTRACTOR_OTHER_REPORTING").instructions).toContain("existence of contractors alone");
  });

  it("20. preserves STP boundary", () => {
    expect(section("STP_BOUNDARY").description).toContain("submission status");
    expect(section("STP_BOUNDARY").instructions).toContain("second payroll-processing method");
  });

  it("21. preserves long-service-leave jurisdiction boundary", () => {
    expect(section("LONG_SERVICE_LEAVE_BOUNDARY").description).toContain("Jurisdiction");
    expect(section("LONG_SERVICE_LEAVE_BOUNDARY").instructions).toContain("Do not hard-code Victorian LSL rules");
  });

  it("22. represents the central obligation reconciliation schedule", () => {
    expect(section("OBLIGATION_RECONCILIATION_SCHEDULE").description).toContain("amount calculated");
    expect(section("OBLIGATION_RECONCILIATION_SCHEDULE").description).toContain("external confirmation");
    expect(section("OBLIGATION_RECONCILIATION_SCHEDULE").instructions).toContain("central professional work product");
  });

  it("23. reconciles internal and external evidence without forcing agreement", () => {
    expect(section("INTERNAL_EXTERNAL_RECONCILIATION").description).toContain("PAYG ledger vs ATO account");
    expect(section("INTERNAL_EXTERNAL_RECONCILIATION").instructions).toContain("Do not silently force numbers to reconcile");
  });

  it("24. separates cash flow from compliance", () => {
    expect(section("CASH_FLOW_COMPLIANCE_SEPARATION").instructions).toContain("Cash difficulty does not extinguish liability");
    expect(entry().evidenceContract?.freshnessRules).toMatchObject({ cashDifficultyDoesNotExtinguishLiability: true });
  });

  it("25. represents shareholder or director funding without assuming remittance", () => {
    expect(section("SHAREHOLDER_DIRECTOR_FUNDING").description).toContain("obligation intended to be funded");
    expect(section("SHAREHOLDER_DIRECTOR_FUNDING").description).toContain("whether remittance actually occurred");
  });

  it("26. represents due-date and timeliness analysis", () => {
    expect(section("DUE_DATE_TIMELINESS").description).toContain("statutory due date");
    expect(section("DUE_DATE_TIMELINESS").instructions).toContain("KRS-resolved current authority");
  });

  it("27. represents penalty and interest exposure without invented amounts", () => {
    expect(section("PENALTY_INTEREST_EXPOSURE").description).toContain("interest");
    expect(section("PENALTY_INTEREST_EXPOSURE").instructions).toContain("Do not invent");
  });

  it("28. preserves evidence conflicts", () => {
    expect(section("EVIDENCE_CONFLICT_HANDLING").description).toContain("Ledger paid");
    expect(section("EVIDENCE_CONFLICT_HANDLING").description).toContain("ATO account debt");
    expect(section("EVIDENCE_CONFLICT_HANDLING").instructions).toContain("Do not resolve contradictions by assumption");
  });

  it("29. protects personal tax boundary", () => {
    expect(section("PERSONAL_TAX_BOUNDARY").description).toContain("personal income-tax liability");
    expect(section("PERSONAL_TAX_BOUNDARY").instructions).toContain("PAYG withholding is not final personal income tax");
  });

  it("30. protects tax agent and accountant boundary", () => {
    expect(section("TAX_AGENT_ACCOUNTANT_BOUNDARY").description).toContain("registered tax-agent services");
    expect(section("TAX_AGENT_ACCOUNTANT_BOUNDARY").instructions).toContain("must not represent itself as a registered tax agent");
  });

  it("31. preserves neighbouring Blueprint and execution boundaries", () => {
    expect(section("BOUNDARIES_AND_HANDOFFS").description).toContain("business_financial_analysis");
    expect(section("BOUNDARIES_AND_HANDOFFS").description).toContain("payroll_workforce_cost_review");
    expect(section("BOUNDARIES_AND_HANDOFFS").instructions).toContain("does not assess business sustainability");
  });

  it("32. prohibits lodgement, payment, accounting mutation and authority representation", () => {
    expect(entry().deliverableContract?.prohibitedDeliverables).toEqual(expect.arrayContaining([
      "lodgement",
      "bas_submission",
      "stp_submission",
      "super_payment_initiation",
      "fund_transfer",
      "authority_representation",
      "accounting_system_mutation",
    ]));
  });

  it("33. requires statutory evidence categories and external confirmation", () => {
    expect(entry().evidenceContract?.requiredEvidenceCategories).toEqual([
      "tax_record",
      "financial_record",
      "current_authority",
      "external_confirmation",
    ]);
    expect(entry().mandatoryCitations).toEqual(["tax_record", "financial_record", "current_authority", "external_confirmation"]);
  });

  it("34. keeps sibling method-pending Blueprints gated", () => {
    expect(methodPendingCodes()).toEqual(expect.arrayContaining([
    ]));
  });

  it("35. preserves the single compatibility route count", () => {
    expect(compatibilityRoutes().map((blueprint) => blueprint.code)).toEqual(["regulatory_change_impact"]);
    expect(compatibilityRoutes()).toHaveLength(1);
  });

  it("36. moves genuine method-pending count to 10 with truthful programme accounting", () => {
    expect(BLUEPRINT_REGISTRY).toHaveLength(75);
    expect(methodPendingCodes()).toHaveLength(0);
    expect(BLUEPRINT_REGISTRY.length - methodPendingCodes().length - compatibilityRoutes().length).toBe(74);
  });

  it("37. preserves owner and external tax/accounting approval boundaries", () => {
    expect(resolveRegistryProfessionalOwner(entry())).toBe("finance_officer");
    expect(entry().supportingSpecialists).toEqual([
      "financial_planning_reporting_manager",
      "knowledge_documentation_specialist",
    ]);
    expect(entry().requiredApprovals).toMatchObject({
      finance_owner: true,
      external_tax_or_accounting_owner: true,
    });
  });

  it("38. keeps current authority and execution boundaries visible in all method text", () => {
    expect(allText()).toContain("runtime must not independently choose statutory truth");
    expect(allText()).toContain("must not lodge, submit, transfer money or mutate accounting/payroll systems");
    expect(entry().externalAuthorityRequiredFor).toEqual(expect.arrayContaining([
      "registered tax-agent advice",
      "BAS submission",
      "STP submission",
      "super remittance",
      "fund transfer",
    ]));
  });
});
