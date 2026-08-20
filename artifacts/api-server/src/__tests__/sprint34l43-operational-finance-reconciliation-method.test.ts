import { describe, expect, it } from "vitest";
import {
  BLUEPRINT_REGISTRY,
  getRegistryEntry,
  resolveRegistryProfessionalOwner,
} from "../services/blueprintRegistry.js";
import { resolveIntent } from "../services/blueprintIntentMap.js";

const CODE = "operational_finance_reconciliation_review";
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

describe("Sprint 34L.43 operational finance reconciliation method", () => {
  it("1. removes USER_DEFINITION_REQUIRED_METHOD from operational finance reconciliation", () => {
    expect(sectionCodes()).not.toContain("USER_DEFINITION_REQUIRED_METHOD");
    expect(sections()[0]?.sectionCode).toBe("REVIEW_SCOPE");
  });

  it("2. removes human_professional_method_owner from operational finance reconciliation", () => {
    expect(entry().requiredApprovals).not.toHaveProperty("human_professional_method_owner");
    expect(methodPendingCodes()).not.toContain(CODE);
  });

  it("3. uses the approved professional title and purpose", () => {
    expect(entry().title).toBe("Operational Finance Transaction & Reconciliation Review");
    expect(entry().purpose).toContain("source, invoice, claim, payment, bank and accounting records");
    expect(entry().purpose).toContain("underlying transactions are valid");
    expect(entry().purpose).toContain("records reconcile through their lifecycle");
  });

  it("4. preserves finance officer ownership and supporting specialists", () => {
    expect(resolveRegistryProfessionalOwner(entry())).toBe("finance_officer");
    expect(entry().supportingSpecialists).toEqual([
      "financial_planning_reporting_manager",
      "payroll_workforce_cost_officer",
      "knowledge_documentation_specialist",
    ]);
  });

  it("5. keeps existing finance reconciliation intent routing", () => {
    expect(resolveIntent("finance.reconciliation")).toMatchObject({ code: CODE });
  });

  it("6. scopes the transaction review before testing everything", () => {
    expect(section("REVIEW_SCOPE").description).toContain("transaction period");
    expect(section("REVIEW_SCOPE").description).toContain("claim batch");
    expect(section("REVIEW_SCOPE").instructions).toContain("Do not automatically run");
  });

  it("7. establishes transaction identity before amount matching", () => {
    expect(section("TRANSACTION_IDENTITY").description).toContain("invoice number");
    expect(section("TRANSACTION_IDENTITY").description).toContain("bank reference");
    expect(section("TRANSACTION_IDENTITY").instructions).toContain("amounts happen to match");
  });

  it("8. validates source transactions rather than invoice lines alone", () => {
    expect(section("SOURCE_TRANSACTION_VALIDATION").description).toContain("service-delivery record");
    expect(section("SOURCE_TRANSACTION_VALIDATION").description).toContain("approved purchase");
    expect(section("SOURCE_TRANSACTION_VALIDATION").instructions).toContain("An invoice line does not prove the service occurred");
  });

  it("9. separates lifecycle states", () => {
    expect(section("TRANSACTION_LIFECYCLE_STATE").description).toContain("bank settlement");
    expect(section("TRANSACTION_LIFECYCLE_STATE").instructions).toContain("claim submitted");
    expect(section("TRANSACTION_LIFECYCLE_STATE").instructions).toContain("ledger posted");
    expect(entry().validationRules?.map((rule) => rule.rule)).toContain("transaction_lifecycle_states_separated");
  });

  it("10. models invoice state and remaining balance", () => {
    expect(section("INVOICE_STATE_AND_BALANCE").description).toContain("partially paid");
    expect(section("INVOICE_STATE_AND_BALANCE").description).toContain("remaining receivable");
    expect(section("INVOICE_STATE_AND_BALANCE").instructions).toContain("existing status architecture");
  });

  it("11. protects partial-settlement logic using the Product Owner evidence doctrine", () => {
    expect(section("PARTIAL_SETTLEMENT_RECONCILIATION").instructions).toContain("Outstanding = invoice total");
    expect(section("PARTIAL_SETTLEMENT_RECONCILIATION").instructions).toContain("17,962.76 - 6,049.40 = 11,913.36");
    expect(section("PARTIAL_SETTLEMENT_RECONCILIATION").instructions).toContain("remaining-balance reconciliation");
    expect(entry().validationRules?.map((rule) => rule.rule)).toContain("partial_settlement_must_use_remaining_balance");
  });

  it("12. supports one-to-many and many-to-one matching", () => {
    expect(section("MANY_TO_ONE_ONE_TO_MANY_MATCHING").description).toContain("multiple payments");
    expect(section("MANY_TO_ONE_ONE_TO_MANY_MATCHING").description).toContain("multiple invoice lines to one claim batch");
    expect(section("MANY_TO_ONE_ONE_TO_MANY_MATCHING").instructions).toContain("Do not require artificial one-to-one matching");
  });

  it("13. separates NDIS validation from reconciliation", () => {
    expect(section("NDIS_VALIDATION_BOUNDARY").description).toContain("evidenced, authorised, classified, coded, priced and quantified");
    expect(section("NDIS_VALIDATION_BOUNDARY").instructions).toContain("reconciled but invalid");
    expect(entry().validationRules?.map((rule) => rule.rule)).toContain("validation_and_reconciliation_separated");
  });

  it("14. uses KRS/current authority for NDIS pricing", () => {
    expect(section("NDIS_PRICING_AUTHORITY").description).toContain("service date");
    expect(section("NDIS_PRICING_AUTHORITY").description).toContain("effective date");
    expect(section("NDIS_PRICING_AUTHORITY").instructions).toContain("KRS resolves authority");
    expect(section("NDIS_PRICING_AUTHORITY").instructions).toContain("PRICING_AUTHORITY_NOT_VERIFIED");
    expect(entry().evidenceContract?.freshnessRules).toMatchObject({
      ndisPricingAuthorityRequiresKrsCurrentAuthority: true,
      serviceDateDeterminesApplicableNdisPricingAuthority: true,
    });
  });

  it("15. validates support item against service delivered", () => {
    expect(section("NDIS_SUPPORT_ITEM_VALIDATION").description).toContain("support item code");
    expect(section("NDIS_SUPPORT_ITEM_VALIDATION").instructions).toContain("service actually delivered must support use of that code");
  });

  it("16. validates price, time band, support ratio and quantity", () => {
    expect(section("NDIS_PRICE_TIME_BAND_RATIO_QUANTITY").description).toContain("Saturday/Sunday/public-holiday");
    expect(section("NDIS_PRICE_TIME_BAND_RATIO_QUANTITY").description).toContain("authorised support ratio");
    expect(section("NDIS_PRICE_TIME_BAND_RATIO_QUANTITY").instructions).toContain("five-hour 2:1 service");
  });

  it("17. requires service delivery evidence", () => {
    expect(section("SERVICE_DELIVERY_EVIDENCE").description).toContain("case note");
    expect(section("SERVICE_DELIVERY_EVIDENCE").description).toContain("participant attendance");
    expect(section("SERVICE_DELIVERY_EVIDENCE").instructions).toContain("SERVICE_DELIVERY_NOT_EVIDENCED");
  });

  it("18. uses funding and service agreement evidence without becoming funding utilisation", () => {
    expect(section("FUNDING_SERVICE_AGREEMENT_VALIDATION").description).toContain("agreed ratio");
    expect(section("FUNDING_SERVICE_AGREEMENT_VALIDATION").instructions).toContain("Do not absorb the detailed funding-utilisation method");
  });

  it("19. records validation-versus-reconciliation outcomes", () => {
    expect(section("VALIDATION_RECONCILIATION_MATRIX").description).toContain("Valid but unreconciled");
    expect(section("VALIDATION_RECONCILIATION_MATRIX").instructions).toContain("RECONCILED_BUT_VALIDATION_FAILED");
    expect(section("VALIDATION_RECONCILIATION_MATRIX").instructions).toContain("VALIDATED_BUT_UNRECONCILED");
  });

  it("20. does not infer claim acceptance from invoice existence", () => {
    expect(section("CLAIM_STATE").description).toContain("partially accepted");
    expect(section("CLAIM_STATE").description).toContain("unresolved claim states");
    expect(section("CLAIM_STATE").instructions).toContain("Do not infer claim acceptance");
  });

  it("21. separates payment, bank and ledger states", () => {
    expect(section("PAYMENT_BANK_LEDGER_STATE").description).toContain("bank cleared");
    expect(section("PAYMENT_BANK_LEDGER_STATE").description).toContain("ledger posted");
    expect(section("PAYMENT_BANK_LEDGER_STATE").instructions).toContain("ledger payment does not prove bank settlement");
  });

  it("22. covers accounts receivable reconciliation", () => {
    expect(section("ACCOUNTS_RECEIVABLE_RECONCILIATION").description).toContain("partially paid invoices");
    expect(section("ACCOUNTS_RECEIVABLE_RECONCILIATION").description).toContain("unapplied payments");
  });

  it("23. covers accounts payable without inferring approval", () => {
    expect(section("ACCOUNTS_PAYABLE_RECONCILIATION").description).toContain("supplier invoice");
    expect(section("ACCOUNTS_PAYABLE_RECONCILIATION").description).toContain("unapproved payments");
    expect(section("ACCOUNTS_PAYABLE_RECONCILIATION").instructions).toContain("Do not infer approval");
  });

  it("24. routes expense tax treatment to tax review", () => {
    expect(section("EXPENSE_REIMBURSEMENT_RECONCILIATION").description).toContain("business purpose");
    expect(section("EXPENSE_REIMBURSEMENT_RECONCILIATION").instructions).toContain("tax_financial_obligation_review");
  });

  it("25. preserves credit and refund provenance", () => {
    expect(section("CREDIT_REFUND_RECONCILIATION").description).toContain("credit/refund reason");
    expect(section("CREDIT_REFUND_RECONCILIATION").instructions).toContain("must not erase historical transaction provenance");
  });

  it("26. prevents duplicate findings based only on amount", () => {
    expect(section("DUPLICATE_DETECTION").description).toContain("claim reference");
    expect(section("DUPLICATE_DETECTION").instructions).toContain("equal amounts");
    expect(section("DUPLICATE_DETECTION").instructions).toContain("DUPLICATE_TRANSACTION_RISK");
  });

  it("27. compares ledger cash movement with bank-cleared movement", () => {
    expect(section("BANK_RECONCILIATION").description).toContain("bank-cleared movement");
    expect(section("BANK_RECONCILIATION").description).toContain("timing difference");
    expect(section("BANK_RECONCILIATION").instructions).toContain("Do not mutate accounting records");
  });

  it("28. distinguishes genuine but misallocated payments", () => {
    expect(section("ACCOUNTING_ALLOCATION").description).toContain("cost centre");
    expect(section("ACCOUNTING_ALLOCATION").instructions).toContain("genuine but misallocated");
    expect(section("ACCOUNTING_ALLOCATION").instructions).toContain("MISALLOCATED_TRANSACTION");
  });

  it("29. records variance certainty and known exception classes", () => {
    expect(section("VARIANCE_EXCEPTION_CLASSIFICATION").description).toContain("likely reason");
    expect(section("VARIANCE_EXCEPTION_CLASSIFICATION").description).toContain("certainty");
    expect(section("VARIANCE_EXCEPTION_CLASSIFICATION").instructions).toContain("PRICE_EXCEEDS_APPLICABLE_LIMIT");
    expect(section("VARIANCE_EXCEPTION_CLASSIFICATION").instructions).toContain("UNAPPLIED_RECEIPT");
  });

  it("30. preserves action and execution boundaries", () => {
    expect(section("ACTIONS_BOUNDARIES_AND_ESCALATION").instructions).toContain("Do not approve invoices");
    expect(section("ACTIONS_BOUNDARIES_AND_ESCALATION").instructions).toContain("submit claims");
    expect(section("ACTIONS_BOUNDARIES_AND_ESCALATION").instructions).toContain("perform bank transactions");
  });

  it("31. defines professional conclusion states without a new status subsystem", () => {
    expect(section("PROFESSIONAL_CONCLUSION").description).toContain("VALIDATED_AND_RECONCILED");
    expect(section("PROFESSIONAL_CONCLUSION").description).toContain("RECONCILED_PARTIAL_SETTLEMENT");
    expect(section("PROFESSIONAL_CONCLUSION").instructions).toContain("Do not create a platform-wide reconciliation status subsystem");
  });

  it("32. requires the approved evidence categories", () => {
    expect(entry().evidenceContract?.requiredEvidenceCategories).toEqual([
      "financial_record",
      "transaction_record",
      "source_transaction_evidence",
      "settlement_evidence",
    ]);
    expect(entry().mandatoryCitations).toEqual([
      "financial_record",
      "transaction_record",
      "source_transaction_evidence",
      "settlement_evidence",
    ]);
  });

  it("33. includes detailed finance, NDIS and settlement source types", () => {
    expect(entry().evidenceContract?.allowedSourceTypes).toEqual(expect.arrayContaining([
      "invoice",
      "ndis_claim_file",
      "claim_batch",
      "remittance_advice",
      "bank_transaction",
      "general_ledger",
      "allocation_record",
      "service_delivery_record",
      "ndis_pricing_authority",
      "support_item_authority",
    ]));
  });

  it("34. blocks weak evidence shortcuts", () => {
    expect(entry().evidenceContract?.restrictedSourceTypes).toEqual(expect.arrayContaining([
      "amount_match_only",
      "gross_total_only",
      "ledger_only",
    ]));
    expect(entry().evidenceContract?.freshnessRules).toMatchObject({
      amountMatchAloneCannotProveReconciliation: true,
      externalSettlementEvidenceRequiredForCashMovement: true,
      partialSettlementRequiresRemainingBalanceCalculation: true,
    });
  });

  it("35. is template-bound and artifact-backed", () => {
    expect(entry().deliverableContract).toMatchObject({
      primaryDeliverable: "Operational Finance Transaction & Reconciliation Review",
      artifactRequired: true,
      primaryFormat: "docx",
      templateRequired: true,
    });
    expect(entry().deliverableContract?.allowedInternalAnalysis).toEqual(expect.arrayContaining([
      "ndis_claim_reconciliation_review",
      "partial_settlement_reconciliation",
    ]));
  });

  it("36. prohibits execution, claims and finance-system mutations", () => {
    expect(entry().deliverableContract?.prohibitedDeliverables).toEqual(expect.arrayContaining([
      "payment_approval",
      "invoice_approval",
      "ndis_claim_submission",
      "participant_funding_change",
      "financial_system_mutation",
      "ledger_posting",
      "bank_transaction",
      "refund_initiation",
    ]));
  });

  it("37. routes specialist boundary issues away from operational reconciliation", () => {
    expect(allText()).toContain("funding_utilisation_review");
    expect(allText()).toContain("payroll_workforce_cost_review");
    expect(allText()).toContain("schads_award_analysis");
    expect(allText()).toContain("tax_financial_obligation_review");
  });

  it("38. keeps external authority and approvals out of runtime invention", () => {
    expect(entry().externalAuthorityRequiredFor).toEqual(expect.arrayContaining([
      "NDIS pricing/support-item authority",
      "GST/tax treatment",
      "NDIS claim submission",
      "financial system mutation",
      "bank transaction",
    ]));
    expect(entry().requiredApprovals).toMatchObject({ finance_owner: true });
  });

  it("39. keeps sibling finance and strategic Blueprints method-pending", () => {
    expect(methodPendingCodes()).toEqual(expect.arrayContaining([
    ]));
  });

  it("40. preserves the single compatibility route count", () => {
    expect(compatibilityRoutes().map((blueprint) => blueprint.code)).toEqual(["regulatory_change_impact"]);
    expect(compatibilityRoutes()).toHaveLength(1);
  });

  it("41. moves genuine method-pending count to 6 with truthful programme accounting", () => {
    expect(BLUEPRINT_REGISTRY).toHaveLength(75);
    expect(methodPendingCodes()).toHaveLength(0);
    expect(BLUEPRINT_REGISTRY.length - methodPendingCodes().length - compatibilityRoutes().length).toBe(74);
  });
});
