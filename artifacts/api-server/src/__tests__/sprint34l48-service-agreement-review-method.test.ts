import { describe, expect, it } from "vitest";
import {
  BLUEPRINT_REGISTRY,
  getRegistryEntry,
  resolveRegistryProfessionalOwner,
} from "../services/blueprintRegistry.js";
import { resolveIntent } from "../services/blueprintIntentMap.js";

const CODE = "service_agreement_review";
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

describe("Sprint 34L.48 service agreement review method", () => {
  it("1. removes USER_DEFINITION_REQUIRED_METHOD from service agreement review", () => {
    expect(sectionCodes()).not.toContain("USER_DEFINITION_REQUIRED_METHOD");
    expect(sections()[0]?.sectionCode).toBe("DOCUMENT_AUTHORITY_AND_STATUS");
  });

  it("2. removes human_professional_method_owner from service agreement review", () => {
    expect(entry().requiredApprovals).not.toHaveProperty("human_professional_method_owner");
    expect(methodPendingCodes()).not.toContain(CODE);
  });

  it("3. uses the approved contract readiness title and purpose", () => {
    expect(entry().title).toBe("Participant Service Agreement Review & Contract Readiness Assessment");
    expect(entry().purpose).toContain("complete, current, internally consistent");
    expect(entry().purpose).toContain("funding and pricing authority");
    expect(entry().primaryDeliverable).toBe("Participant Service Agreement Review & Contract Readiness Assessment");
  });

  it("4. preserves Policy Governance ownership and domain approval gates", () => {
    expect(resolveRegistryProfessionalOwner(entry())).toBe("policy_governance_specialist");
    expect(entry().supportingSpecialists).toEqual([
      "service_delivery_coordinator",
      "finance_officer",
      "knowledge_documentation_specialist",
    ]);
    expect(entry().requiredApprovals).toMatchObject({
      policy_governance_owner: true,
      finance_owner: true,
      service_delivery_owner: true,
      agreement_action_owner: true,
    });
  });

  it("5. preserves agreement review and revise routing", () => {
    expect(resolveIntent("agreements.review")).toMatchObject({ code: CODE });
    expect(resolveIntent("agreements.revise")).toMatchObject({ code: CODE });
  });

  it("6. requires live agreement, material terms, participant, authority and funding evidence", () => {
    expect(entry().evidenceContract?.requiredEvidenceCategories).toEqual([
      "service_agreement",
      "service_agreement_terms",
      "participant_record",
      "current_authority",
      "funding_record",
    ]);
    expect(entry().evidenceContract?.missingEvidenceBehaviour).toBe("block_completion");
    expect(entry().evidenceContract?.requiredEntityTypes).toContain("participant");
  });

  it("7. permits the real service-agreement evidence universe", () => {
    expect(entry().evidenceContract?.allowedSourceTypes).toEqual(expect.arrayContaining([
      "terms_and_conditions",
      "service_agreement_template",
      "schedule_of_supports",
      "agreement_signature_record",
      "representative_authority",
      "supported_decision_making_record",
      "pricing_authority",
      "cancellation_record",
      "disaster_emergency_plan",
      "continuity_record",
      "mealtime_plan",
      "dysphagia_assessment",
      "worker_competency_record",
    ]));
  });

  it("8. blocks weak source classes and signature-only reasoning", () => {
    expect(entry().evidenceContract?.restrictedSourceTypes).toEqual(expect.arrayContaining([
      "memory_only",
      "user_assertion_only",
      "uncontrolled_copy",
      "draft_template_only",
      "signature_only",
    ]));
  });

  it("9. captures currentness and signature separation rules in evidence freshness", () => {
    expect(entry().evidenceContract?.freshnessRules).toMatchObject({
      signedDoesNotProveComplete: true,
      signedDoesNotProveInformedConsent: true,
      termsNotConfiguredBlocksReadiness: true,
      newestTemplateDoesNotAutomaticallySupersedeLiveAgreement: true,
      currentAuthorityRequiredForPricingCancellationAndMaterialTerms: true,
      effectiveDateMustMatchAgreementOrServicePeriod: true,
    });
  });

  it("10. requires controlled DOCX/PDF artifact and forbids live agreement actions", () => {
    expect(entry().deliverableContract).toMatchObject({
      artifactRequired: true,
      primaryFormat: "docx",
      templateRequired: true,
    });
    expect(entry().deliverableContract?.prohibitedDeliverables).toEqual(expect.arrayContaining([
      "legal_advice",
      "unilateral_agreement_change",
      "agreement_signature",
      "agreement_acceptance",
      "participant_funding_change",
      "ndis_claim_submission",
      "pricing_change",
      "live_agreement_mutation",
    ]));
  });

  it("11. establishes document authority before review", () => {
    expect(section("DOCUMENT_AUTHORITY_AND_STATUS").description).toContain("Agreement number");
    expect(section("DOCUMENT_AUTHORITY_AND_STATUS").description).toContain("terms-and-conditions configuration");
    expect(section("DOCUMENT_AUTHORITY_AND_STATUS").instructions).toContain("Newest file does not automatically govern");
    expect(section("DOCUMENT_AUTHORITY_AND_STATUS").instructions).toContain("signed status does not prove");
  });

  it("12. preserves the material terms missing blocker", () => {
    const text = allText();
    expect(section("MATERIAL_TERMS_COMPLETENESS_GATE").instructions).toContain("AGREEMENT_NOT_READY_MATERIAL_TERMS_MISSING");
    expect(text).toContain("terms_and_conditions_missing_or_unconfigured");
    expect(text).toContain("AGREEMENT_NOT_READY_MATERIAL_TERMS_MISSING");
  });

  it("13. separates parties representative authority and participant consent", () => {
    expect(section("PARTIES_REPRESENTATIVE_AND_AUTHORITY").description).toContain("nominee");
    expect(section("PARTIES_REPRESENTATIVE_AND_AUTHORITY").instructions).toContain("Representative signature does not prove lawful authority");
    expect(section("PARTICIPANT_UNDERSTANDING_AND_CONSENT").description).toContain("Easy English");
    expect(section("PARTICIPANT_UNDERSTANDING_AND_CONSENT").instructions).toContain("Signature is not informed consent");
  });

  it("14. requires clause preservation before amendment assessment", () => {
    expect(section("CLAUSE_PRESERVATION_INVENTORY").description).toContain("Complete clause inventory");
    expect(section("CLAUSE_PRESERVATION_INVENTORY").description).toContain("clause number");
    expect(section("CLAUSE_PRESERVATION_INVENTORY").instructions).toContain("Every existing clause is presumed purposeful");
    expect(section("READINESS_FINDINGS_AND_CHANGE_HISTORY").description).toContain("change history");
  });

  it("15. supports the evidenced 17-clause live MH&R architecture", () => {
    const description = section("EVIDENCED_LIVE_CLAUSE_ARCHITECTURE").description;
    for (const heading of [
      "The NDIS and This Service Agreement",
      "Scope of Supports",
      "Delivery of Supports",
      "Provider Responsibilities",
      "Participant / Representative Responsibilities",
      "Continuity of Support",
      "Payment Terms",
      "Pricing and Adjustments",
      "Cancellations",
      "Disaster Management & Emergency Planning",
      "Mealtime Management (If Applicable)",
      "Feedback, Complaints, and Disputes",
      "Privacy and Confidentiality",
      "Changes to this Agreement",
      "Termination",
      "GST",
      "Signatures and Acceptance",
    ]) {
      expect(description).toContain(heading);
    }
    expect(section("EVIDENCED_LIVE_CLAUSE_ARCHITECTURE").instructions).toContain("not an eternal universal clause list");
  });

  it("16. enforces bidirectional authority completeness", () => {
    expect(section("BIDIRECTIONAL_AUTHORITY_COMPLETENESS_REVIEW").description).toContain("Direction A");
    expect(section("BIDIRECTIONAL_AUTHORITY_COMPLETENESS_REVIEW").description).toContain("Direction B");
    expect(section("BIDIRECTIONAL_AUTHORITY_COMPLETENESS_REVIEW").instructions).toContain("POTENTIAL_NEW_CLAUSE_REQUIRED");
    expect(entry().validationRules?.map((rule) => rule.rule)).toContain("bidirectional_authority_completeness_required");
  });

  it("17. preserves KRS current-authority architecture", () => {
    expect(section("KRS_CURRENT_AUTHORITY_PACKAGE").description).toContain("KRS/source registry");
    expect(section("KRS_CURRENT_AUTHORITY_PACKAGE").description).toContain("effective date");
    expect(section("KRS_CURRENT_AUTHORITY_PACKAGE").instructions).toContain("Runtime does not independently decide");
  });

  it("18. declares the required current authority source classes", () => {
    expect(entry().externalAuthorityRequiredFor).toEqual(expect.arrayContaining([
      "NDIS framework",
      "NDIS Practice Standards",
      "NDIS Pricing Arrangements and Price Limits",
      "cancellation/no-show",
      "provider travel",
      "participant transport",
      "non-face-to-face support",
      "establishment fees",
      "GST/tax treatment",
      "privacy",
      "complaints",
      "emergency/disaster",
      "continuity of support",
      "mealtime management",
      "representative/nominee/guardian authority",
      "variation",
      "termination",
      "transition",
    ]));
  });

  it("19. separates proposed funded agreed delivered invoiced claimable and paid states", () => {
    expect(section("SCOPE_OF_SUPPORTS_AND_SERVICE_FORMATION").instructions).toContain("service proposed is not service funded");
    expect(section("SCOPE_OF_SUPPORTS_AND_SERVICE_FORMATION").instructions).toContain("delivered service is not automatically correctly invoiced or claimable");
    expect(entry().validationRules?.map((rule) => rule.rule)).toContain("participant_service_funding_pricing_states_separated");
  });

  it("20. checks operational deliverability rather than accepting contractual promises", () => {
    expect(section("DELIVERY_OF_SUPPORTS_AND_OPERATIONAL_CAPABILITY").description).toContain("workforce capability");
    expect(section("DELIVERY_OF_SUPPORTS_AND_OPERATIONAL_CAPABILITY").instructions).toContain("cannot evidence operationally");
    expect(section("DELIVERY_OF_SUPPORTS_AND_OPERATIONAL_CAPABILITY").instructions).toContain("Agreement wording cannot make");
  });

  it("21. reviews provider responsibilities individually", () => {
    const description = section("PROVIDER_RESPONSIBILITIES_REVIEW").description;
    expect(description).toContain("replacement workers");
    expect(description).toContain("alternate-provider support");
    expect(description).toContain("disaster management");
    expect(description).toContain("mealtime-plan compliance");
    expect(section("PROVIDER_RESPONSIBILITIES_REVIEW").instructions).toContain("Do not collapse provider obligations");
  });

  it("22. reviews participant responsibilities for fairness and proportionality", () => {
    expect(section("PARTICIPANT_REPRESENTATIVE_RESPONSIBILITIES_REVIEW").description).toContain("communicating needs/preferences");
    expect(section("PARTICIPANT_REPRESENTATIVE_RESPONSIBILITIES_REVIEW").description).toContain("non-NDIS expenses");
    expect(section("PARTICIPANT_REPRESENTATIVE_RESPONSIBILITIES_REVIEW").instructions).toContain("Do not transfer provider regulatory obligations");
  });

  it("23. treats continuity of support as first-class and capability-bound", () => {
    expect(section("CONTINUITY_OF_SUPPORT_REVIEW").description).toContain("Worker absence");
    expect(section("CONTINUITY_OF_SUPPORT_REVIEW").description).toContain("secure handover");
    expect(section("CONTINUITY_OF_SUPPORT_REVIEW").instructions).toContain("must not exceed evidenced operational continuity capability");
  });

  it("24. keeps payment terms separate from claimability", () => {
    expect(section("PAYMENT_TERMS_REVIEW").description).toContain("plan-managed");
    expect(section("PAYMENT_TERMS_REVIEW").description).toContain("establishment fees");
    expect(section("PAYMENT_TERMS_REVIEW").instructions).toContain("proof a charge is claimable");
  });

  it("25. makes pricing adjustments an effective-period authority gate", () => {
    expect(section("PRICING_AND_ADJUSTMENTS_REVIEW").description).toContain("Support item");
    expect(section("PRICING_AND_ADJUSTMENTS_REVIEW").description).toContain("unit price");
    expect(section("PRICING_AND_ADJUSTMENTS_REVIEW").instructions).toContain("Do not hard-code NDIS prices");
    expect(entry().validationRules?.map((rule) => rule.rule)).toContain("pricing_and_cancellation_authority_effective_date_required");
  });

  it("26. treats the schedule of supports as a first-class evidence object", () => {
    expect(section("SCHEDULE_OF_SUPPORTS_RECONCILIATION").description).toContain("support item code");
    expect(section("SCHEDULE_OF_SUPPORTS_RECONCILIATION").description).toContain("hours/frequency");
    expect(section("SCHEDULE_OF_SUPPORTS_RECONCILIATION").instructions).toContain("Arithmetic consistency is not proof");
  });

  it("27. surfaces support item code description mismatch for verification", () => {
    expect(section("SUPPORT_ITEM_CODE_DESCRIPTION_VALIDATION").description).toContain("Description/code mismatch");
    expect(section("SUPPORT_ITEM_CODE_DESCRIPTION_VALIDATION").description).toContain("duplicate code");
    expect(section("SUPPORT_ITEM_CODE_DESCRIPTION_VALIDATION").instructions).toContain("SUPPORT_ITEM_DESCRIPTION_CODE_MISMATCH_REQUIRES_VERIFICATION");
  });

  it("28. preserves historical pricing authority by effective period", () => {
    expect(section("HISTORICAL_PRICING_AND_EFFECTIVE_PERIOD").description).toContain("Authority version");
    expect(section("HISTORICAL_PRICING_AND_EFFECTIVE_PERIOD").description).toContain("service date/period");
    expect(section("HISTORICAL_PRICING_AND_EFFECTIVE_PERIOD").instructions).toContain("without checking effective dates");
  });

  it("29. treats cancellation no-show and rescheduling as first-class", () => {
    expect(section("CANCELLATION_NO_SHOW_AND_RESCHEDULING").description).toContain("short-notice cancellation");
    expect(section("CANCELLATION_NO_SHOW_AND_RESCHEDULING").description).toContain("emergency exceptions");
    expect(section("CANCELLATION_NO_SHOW_AND_RESCHEDULING").instructions).toContain("Do not assume percentages");
  });

  it("30. treats disaster and emergency planning as first-class", () => {
    expect(section("DISASTER_MANAGEMENT_EMERGENCY_PLANNING").description).toContain("participant-specific emergency needs");
    expect(section("DISASTER_MANAGEMENT_EMERGENCY_PLANNING").description).toContain("service resumption");
    expect(section("DISASTER_MANAGEMENT_EMERGENCY_PLANNING").instructions).toContain("Generic disaster wording is not a substitute");
  });

  it("31. preserves continuity vs disaster distinction", () => {
    expect(section("CONTINUITY_VS_DISASTER_DISTINCTION").description).toContain("intersect with");
    expect(section("CONTINUITY_VS_DISASTER_DISTINCTION").instructions).toContain("Do not merge Disaster Management and Continuity of Support");
  });

  it("32. treats mealtime management as participant safety without inventing clinical instructions", () => {
    expect(section("MEALTIME_MANAGEMENT_IF_APPLICABLE").description).toContain("Mealtime Management Plan");
    expect(section("MEALTIME_MANAGEMENT_IF_APPLICABLE").description).toContain("dysphagia assessment");
    expect(section("MEALTIME_MANAGEMENT_IF_APPLICABLE").description).toContain("worker competency");
    expect(section("MEALTIME_MANAGEMENT_IF_APPLICABLE").instructions).toContain("must not invent clinical instructions");
  });

  it("33. preserves participant rights privacy complaints advocacy and termination domains", () => {
    expect(section("PARTICIPANT_RIGHTS_PRIVACY_COMPLAINTS_AND_ADVOCACY").description).toContain("Choice and control");
    expect(section("PARTICIPANT_RIGHTS_PRIVACY_COMPLAINTS_AND_ADVOCACY").description).toContain("complaints");
    expect(section("TERMINATION_EXIT_AND_TRANSITION").description).toContain("Participant termination");
    expect(section("TERMINATION_EXIT_AND_TRANSITION").description).toContain("final invoices/payments");
  });

  it("34. covers variation amendment GST tax and non-NDIS expenses", () => {
    expect(section("VARIATION_CHANGE_AND_AMENDMENT_CONTROL").description).toContain("price changes");
    expect(section("VARIATION_CHANGE_AND_AMENDMENT_CONTROL").description).toContain("effective date");
    expect(section("GST_TAX_AND_NON_NDIS_EXPENSES").description).toContain("non-NDIS expenses");
    expect(section("GST_TAX_AND_NON_NDIS_EXPENSES").instructions).toContain("route tax/statutory questions");
  });

  it("35. exposes the required readiness findings", () => {
    const description = section("CONTRACT_READINESS_CONCLUSION").description;
    expect(description).toContain("AGREEMENT_READY_FOR_AUTHORISED_ACTION");
    expect(description).toContain("AGREEMENT_NOT_READY_MATERIAL_TERMS_MISSING");
    expect(description).toContain("AGREEMENT_NOT_READY_PRICING_OR_FUNDING_GAP");
    expect(description).toContain("PARTICIPANT_CONSENT_EVIDENCE_REQUIRED");
  });

  it("36. routes specialist boundary conditions to the right owners", () => {
    const description = section("PROFESSIONAL_BOUNDARIES_AND_HANDOFFS").description;
    expect(description).toContain("funding_utilisation_review");
    expect(description).toContain("operational_finance_reconciliation_review");
    expect(description).toContain("controlled_document_assembly");
    expect(description).toContain("document_control_review");
    expect(description).toContain("safeguarding");
    expect(description).toContain("clinical/mealtime");
  });

  it("37. prohibits legal advice live mutation claims pricing and funding actions", () => {
    const instructions = section("PROFESSIONAL_BOUNDARIES_AND_HANDOFFS").instructions;
    expect(instructions).toContain("formal legal advice");
    expect(instructions).toContain("alter live agreements");
    expect(instructions).toContain("sign/accept agreements");
    expect(instructions).toContain("change participant funding");
    expect(instructions).toContain("submit claims");
    expect(instructions).toContain("change prices");
  });

  it("38. defines validation rules for the Product Owner doctrine", () => {
    expect(entry().validationRules?.map((rule) => rule.rule)).toEqual(expect.arrayContaining([
      "approved_service_agreement_readiness_method_applied",
      "material_terms_configuration_required",
      "every_existing_clause_preserved",
      "bidirectional_authority_completeness_required",
      "signature_does_not_cure_defects",
      "continuity_disaster_and_mealtime_domains_first_class",
      "clinical_legal_claim_and_agreement_action_boundaries_preserved",
    ]));
  });

  it("39. preserves mandatory citation requirements", () => {
    expect(entry().mandatoryCitations).toEqual([
      "service_agreement",
      "service_agreement_terms",
      "participant_record",
      "current_authority",
      "funding_record",
    ]);
  });

  it("40. removes service agreement from the method-pending accounting", () => {
    expect(methodPendingCodes()).toHaveLength(0);
    expect(methodPendingCodes()).not.toContain(CODE);
    expect(compatibilityRoutes()).toHaveLength(1);
    expect(BLUEPRINT_REGISTRY.length - methodPendingCodes().length - compatibilityRoutes().length).toBe(74);
  });
});
