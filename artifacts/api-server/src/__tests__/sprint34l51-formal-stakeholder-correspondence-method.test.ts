import { describe, expect, it } from "vitest";
import {
  BLUEPRINT_REGISTRY,
  LEGACY_CODE_MAP,
  getRegistryEntry,
  resolveRegistryProfessionalOwner,
} from "../services/blueprintRegistry.js";
import { resolveIntent } from "../services/blueprintIntentMap.js";

const CODE = "formal_stakeholder_correspondence";
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

describe("Sprint 34L.51 formal stakeholder correspondence method", () => {
  it("1. removes USER_DEFINITION_REQUIRED_METHOD from formal correspondence", () => {
    expect(sectionCodes()).not.toContain("USER_DEFINITION_REQUIRED_METHOD");
    expect(sections()[0]?.sectionCode).toBe("CORRESPONDENCE_TRIGGER_AND_CLASS");
  });

  it("2. removes human_professional_method_owner from formal correspondence", () => {
    expect(entry().requiredApprovals).not.toHaveProperty("human_professional_method_owner");
    expect(methodPendingCodes()).not.toContain(CODE);
  });

  it("3. uses the approved stakeholder correspondence and position communication title", () => {
    expect(entry().title).toBe("Formal Stakeholder Correspondence & Organisational Position Communication");
    expect(entry().purpose).toContain("authorised organisational position");
    expect(entry().primaryDeliverable).toBe("Formal Stakeholder Correspondence & Organisational Position Communication");
  });

  it("4. preserves Executive Assistant ownership without decision authority", () => {
    expect(resolveRegistryProfessionalOwner(entry())).toBe("executive_assistant");
    expect(entry().requiredApprovals).toMatchObject({ correspondence_owner: true, send_authority_owner: true });
    expect(allText()).toContain("Executive Assistant drafted does not mean Executive Assistant authorised to sign or send");
  });

  it("5. preserves routing and customer response compatibility", () => {
    expect(resolveIntent("correspondence.create")).toMatchObject({ code: CODE, mode: "create" });
    expect(resolveIntent("correspondence.review")).toMatchObject({ code: CODE, mode: "review" });
    expect(LEGACY_CODE_MAP.customer_response).toBe(CODE);
    expect(entry().legacyCode).toBe("customer_response");
  });

  it("6. remains a controlled DOCX correspondence artifact without sending", () => {
    expect(entry().deliverableContract).toMatchObject({
      artifactRequired: true,
      primaryFormat: "docx",
      templateRequired: true,
      primaryDeliverable: "formal_stakeholder_correspondence_position_communication",
    });
    expect(entry().deliverableContract?.prohibitedDeliverables).toEqual(expect.arrayContaining([
      "sent_correspondence",
      "email_message_send",
      "external_notification",
      "legal_commitment",
      "financial_commitment",
      "service_commitment",
      "contractual_commitment",
      "employment_decision",
      "clinical_position",
      "regulatory_position",
      "safeguarding_finding",
      "complaint_finding",
      "legal_admission",
      "agreement_termination",
      "agreement_variation",
      "regulator_notification",
      "participant_record_mutation",
      "marketing_publication",
    ]));
  });

  it("7. requires correspondence trigger stakeholder position approval and controlled evidence", () => {
    expect(entry().evidenceContract?.requiredEvidenceCategories).toEqual([
      "correspondence_trigger",
      "stakeholder_contact",
      "organisational_position",
      "approval_record",
      "controlled_document",
    ]);
    expect(entry().evidenceContract?.minimumEvidenceCount).toBe(5);
    expect(entry().evidenceContract?.missingEvidenceBehaviour).toBe("block_completion");
  });

  it("8. restricts weak correspondence source types", () => {
    expect(entry().evidenceContract?.restrictedSourceTypes).toEqual(expect.arrayContaining([
      "memory_only",
      "user_assertion_only",
      "uncontrolled_copy",
      "unauthorised_draft_only",
      "recipient_involvement_only",
      "model_memory_authority",
    ]));
  });

  it("9. enforces disclosure send and authority evidence doctrine", () => {
    expect(entry().evidenceContract?.freshnessRules).toMatchObject({
      positionMustHaveSourceAndOwner: true,
      stakeholderInvolvementDoesNotEqualDisclosureEntitlement: true,
      minimumNecessaryDisclosureRequired: true,
      draftingDoesNotEqualSendAuthority: true,
      writingAuthorityDoesNotEqualDecisionAuthority: true,
      consequentialStatementsRequireAuthority: true,
    });
  });

  it("10. covers correspondence trigger and class", () => {
    expect(section("CORRESPONDENCE_TRIGGER_AND_CLASS").description).toContain("meeting outcome");
    expect(section("CORRESPONDENCE_TRIGGER_AND_CLASS").description).toContain("contractual notice");
    expect(section("CORRESPONDENCE_TRIGGER_AND_CLASS").instructions).toContain("Classify the communication before drafting");
  });

  it("11. identifies stakeholder identity and relationship", () => {
    expect(section("STAKEHOLDER_IDENTITY_AND_RELATIONSHIP").description).toContain("Support Coordinator");
    expect(section("STAKEHOLDER_IDENTITY_AND_RELATIONSHIP").description).toContain("authorised representative status");
    expect(section("STAKEHOLDER_IDENTITY_AND_RELATIONSHIP").instructions).toContain("Do not assume recipient authority");
  });

  it("12. represents recipient entitlement and authority", () => {
    expect(section("RECIPIENT_ENTITLEMENT_AND_DISCLOSURE_AUTHORITY").description).toContain("guardian/nominee authority");
    expect(section("RECIPIENT_ENTITLEMENT_AND_DISCLOSURE_AUTHORITY").description).toContain("minimum information needed");
    expect(section("RECIPIENT_ENTITLEMENT_AND_DISCLOSURE_AUTHORITY").instructions).toContain("Stakeholder involved does not equal stakeholder entitled to all information");
  });

  it("13. requires communication purpose and underlying matter", () => {
    expect(section("COMMUNICATION_PURPOSE_AND_UNDERLYING_MATTER").description).toContain("preserve a formal record");
    expect(section("COMMUNICATION_PURPOSE_AND_UNDERLYING_MATTER").description).toContain("commercial agreement");
    expect(section("COMMUNICATION_PURPOSE_AND_UNDERLYING_MATTER").instructions).toContain("Do not draft before purpose is clear");
  });

  it("14. requires source-of-truth and professional position dependency", () => {
    expect(section("SOURCE_OF_TRUTH_AND_PROFESSIONAL_POSITION").description).toContain("complaints_review_response");
    expect(section("SOURCE_OF_TRUTH_AND_PROFESSIONAL_POSITION").description).toContain("regulator_response_submission");
    expect(section("SOURCE_OF_TRUTH_AND_PROFESSIONAL_POSITION").instructions).toContain("No approved position means no invented organisational position");
  });

  it("15. requires a statement authority matrix", () => {
    expect(section("STATEMENT_AUTHORITY_MATRIX").description).toContain("statement type");
    expect(section("STATEMENT_AUTHORITY_MATRIX").description).toContain("safe-to-communicate status");
    expect(section("STATEMENT_AUTHORITY_MATRIX").instructions).toContain("does not create professional authority");
  });

  it("16. disciplines factual and organisational position statements", () => {
    expect(section("FACTUAL_AND_ORGANISATIONAL_POSITION_DISCIPLINE").description).toContain("meeting date");
    expect(section("FACTUAL_AND_ORGANISATIONAL_POSITION_DISCIPLINE").description).toContain("matter resolved");
    expect(section("FACTUAL_AND_ORGANISATIONAL_POSITION_DISCIPLINE").instructions).toContain("Do not present assumption or recollection as fact");
  });

  it("17. requires closure evidence", () => {
    expect(section("FACTUAL_AND_ORGANISATIONAL_POSITION_DISCIPLINE").instructions).toContain("Do not infer closure");
    expect(entry().evidenceContract?.freshnessRules).toMatchObject({ closureLanguageRequiresUnderlyingClosureEvidence: true });
  });

  it("18. separates expectations from formal directions and detects commitments", () => {
    expect(section("CLOSURE_EXPECTATIONS_DIRECTIONS_AND_COMMITMENTS").description).toContain("expectation/reminder versus formal direction");
    expect(section("CLOSURE_EXPECTATIONS_DIRECTIONS_AND_COMMITMENTS").description).toContain("settlement");
    expect(section("CLOSURE_EXPECTATIONS_DIRECTIONS_AND_COMMITMENTS").instructions).toContain("Formal directions and commitments require underlying authority");
  });

  it("19. represents service commitment authority", () => {
    expect(section("SERVICE_FINANCE_WORKFORCE_CLINICAL_REGULATORY_LEGAL_GATES").description).toContain("Service commitments");
    expect(entry().externalAuthorityRequiredFor).toContain("service commitment");
  });

  it("20. represents financial commitment authority", () => {
    expect(section("SERVICE_FINANCE_WORKFORCE_CLINICAL_REGULATORY_LEGAL_GATES").description).toContain("financial commitments");
    expect(entry().externalAuthorityRequiredFor).toContain("financial commitment");
  });

  it("21. preserves workforce decision boundary", () => {
    expect(section("SERVICE_FINANCE_WORKFORCE_CLINICAL_REGULATORY_LEGAL_GATES").description).toContain("workforce/employment decisions");
    expect(entry().externalAuthorityRequiredFor).toContain("employment/workforce decision");
  });

  it("22. preserves clinical position boundary", () => {
    expect(section("SERVICE_FINANCE_WORKFORCE_CLINICAL_REGULATORY_LEGAL_GATES").description).toContain("clinical/practice statements");
    expect(entry().externalAuthorityRequiredFor).toContain("clinical position");
  });

  it("23. preserves regulatory position boundary", () => {
    expect(section("SERVICE_FINANCE_WORKFORCE_CLINICAL_REGULATORY_LEGAL_GATES").description).toContain("regulatory statements");
    expect(entry().externalAuthorityRequiredFor).toContain("regulatory position");
  });

  it("24. preserves legal admission boundary", () => {
    expect(section("SERVICE_FINANCE_WORKFORCE_CLINICAL_REGULATORY_LEGAL_GATES").description).toContain("legal admissions");
    expect(entry().externalAuthorityRequiredFor).toContain("admission or settlement");
  });

  it("25. keeps complaint method separate", () => {
    expect(section("SPECIALIST_METHOD_BOUNDARIES").description).toContain("complaints_review_response");
    expect(section("SPECIALIST_METHOD_BOUNDARIES").instructions).toContain("does not redo complaint findings");
  });

  it("26. keeps regulator response separate", () => {
    expect(section("SPECIALIST_METHOD_BOUNDARIES").description).toContain("regulator_response_submission");
    expect(section("SPECIALIST_METHOD_BOUNDARIES").instructions).toContain("regulator submissions");
  });

  it("27. keeps marketing communications separate", () => {
    expect(section("SPECIALIST_METHOD_BOUNDARIES").description).toContain("marketing_communications_review");
    expect(section("SPECIALIST_METHOD_BOUNDARIES").instructions).toContain("marketing/publication assurance");
  });

  it("28. keeps document assembly separate", () => {
    expect(section("SPECIALIST_METHOD_BOUNDARIES").description).toContain("controlled_document_assembly");
    expect(section("SPECIALIST_METHOD_BOUNDARIES").instructions).toContain("document formatting");
  });

  it("29. requires stakeholder-specific disclosure", () => {
    expect(section("STAKEHOLDER_SPECIFIC_DISCLOSURE").description).toContain("SDA provider");
    expect(section("STAKEHOLDER_SPECIFIC_DISCLOSURE").description).toContain("funding-body");
    expect(section("STAKEHOLDER_SPECIFIC_DISCLOSURE").instructions).toContain("Do not apply one disclosure rule universally");
  });

  it("30. supports participant correspondence accessibility", () => {
    expect(section("PARTICIPANT_FAMILY_GUARDIAN_AND_SUPPORT_COORDINATOR_COMMUNICATION").description).toContain("plain language");
    expect(section("PARTICIPANT_FAMILY_GUARDIAN_AND_SUPPORT_COORDINATOR_COMMUNICATION").description).toContain("accessibility");
  });

  it("31. supports family and advocate authority review", () => {
    expect(section("PARTICIPANT_FAMILY_GUARDIAN_AND_SUPPORT_COORDINATOR_COMMUNICATION").description).toContain("family/advocate authority");
    expect(section("PARTICIPANT_FAMILY_GUARDIAN_AND_SUPPORT_COORDINATOR_COMMUNICATION").instructions).toContain("without authority");
  });

  it("32. supports guardian and nominee authority review", () => {
    expect(section("PARTICIPANT_FAMILY_GUARDIAN_AND_SUPPORT_COORDINATOR_COMMUNICATION").description).toContain("guardian/nominee decision domain");
  });

  it("33. protects Support Coordinator disclosure boundary", () => {
    expect(section("PARTICIPANT_FAMILY_GUARDIAN_AND_SUPPORT_COORDINATOR_COMMUNICATION").description).toContain("Support Coordinator role");
    expect(section("PARTICIPANT_FAMILY_GUARDIAN_AND_SUPPORT_COORDINATOR_COMMUNICATION").instructions).toContain("confidential HR information");
  });

  it("34. preserves hospital and health boundary", () => {
    expect(section("HEALTH_POLICE_EMERGENCY_AND_COMMERCIAL_PARTNER_BOUNDARIES").description).toContain("Hospital/health consent");
    expect(section("HEALTH_POLICE_EMERGENCY_AND_COMMERCIAL_PARTNER_BOUNDARIES").instructions).toContain("Do not invent clinical facts");
  });

  it("35. preserves police and emergency factual discipline", () => {
    expect(section("HEALTH_POLICE_EMERGENCY_AND_COMMERCIAL_PARTNER_BOUNDARIES").description).toContain("police/emergency chronology");
    expect(section("HEALTH_POLICE_EMERGENCY_AND_COMMERCIAL_PARTNER_BOUNDARIES").description).toContain("allegation/finding separation");
  });

  it("36. preserves SDA and commercial partner boundary", () => {
    expect(section("HEALTH_POLICE_EMERGENCY_AND_COMMERCIAL_PARTNER_BOUNDARIES").description).toContain("SDA/commercial partner");
    expect(section("HEALTH_POLICE_EMERGENCY_AND_COMMERCIAL_PARTNER_BOUNDARIES").instructions).toContain("commercial rights/obligations");
  });

  it("37. makes contractual notice detection mandatory", () => {
    expect(section("CONTRACTUAL_NOTICE_DETECTION_AND_REQUIREMENTS").description).toContain("termination");
    expect(section("CONTRACTUAL_NOTICE_DETECTION_AND_REQUIREMENTS").instructions).toContain("Underlying contract evidence is required");
    expect(entry().validationRules?.map((rule) => rule.rule)).toContain("contractual_notice_requirements_checked_where_applicable");
  });

  it("38. represents authorised notice sender", () => {
    expect(section("CONTRACTUAL_NOTICE_DETECTION_AND_REQUIREMENTS").description).toContain("authorised sender");
  });

  it("39. represents notice recipient and address", () => {
    expect(section("CONTRACTUAL_NOTICE_DETECTION_AND_REQUIREMENTS").description).toContain("recipient");
    expect(section("CONTRACTUAL_NOTICE_DETECTION_AND_REQUIREMENTS").description).toContain("notice address");
  });

  it("40. represents delivery method", () => {
    expect(section("CONTRACTUAL_NOTICE_DETECTION_AND_REQUIREMENTS").description).toContain("delivery method");
  });

  it("41. separates deemed receipt and effective date", () => {
    expect(section("DATE_DEADLINE_AND_EFFECTIVE_DATE_DISCIPLINE").description).toContain("deemed received date");
    expect(section("DATE_DEADLINE_AND_EFFECTIVE_DATE_DISCIPLINE").description).toContain("effective date");
    expect(entry().evidenceContract?.freshnessRules).toMatchObject({ letterDateSendDateReceivedDateDeemedReceivedDateAndEffectiveDateMustRemainSeparate: true });
  });

  it("42. classifies deadlines by source and authority", () => {
    expect(section("DATE_DEADLINE_AND_EFFECTIVE_DATE_DISCIPLINE").description).toContain("contractual deadline");
    expect(section("DATE_DEADLINE_AND_EFFECTIVE_DATE_DISCIPLINE").description).toContain("calculation basis");
    expect(section("DATE_DEADLINE_AND_EFFECTIVE_DATE_DISCIPLINE").instructions).toContain("do not convert an internal preference into a legal deadline");
  });

  it("43. represents privacy and confidentiality", () => {
    expect(section("PRIVACY_CONFIDENTIALITY_AND_MINIMUM_DISCLOSURE").description).toContain("health information");
    expect(section("PRIVACY_CONFIDENTIALITY_AND_MINIMUM_DISCLOSURE").description).toContain("employee information");
  });

  it("44. requires minimum necessary disclosure", () => {
    expect(section("PRIVACY_CONFIDENTIALITY_AND_MINIMUM_DISCLOSURE").title).toContain("Minimum Necessary Disclosure");
    expect(section("PRIVACY_CONFIDENTIALITY_AND_MINIMUM_DISCLOSURE").instructions).toContain("Disclose only what the recipient needs");
  });

  it("45. requires attachment review", () => {
    expect(section("ATTACHMENT_AND_RECORD_DISCLOSURE_REVIEW").description).toContain("redacted version");
    expect(section("ATTACHMENT_AND_RECORD_DISCLOSURE_REVIEW").description).toContain("summary/extract");
    expect(entry().validationRules?.map((rule) => rule.rule)).toContain("attachments_require_disclosure_review");
  });

  it("46. blocks automatic full investigation report disclosure", () => {
    expect(section("ATTACHMENT_AND_RECORD_DISCLOSURE_REVIEW").instructions).toContain("investigation reports");
    expect(section("ATTACHMENT_AND_RECORD_DISCLOSURE_REVIEW").instructions).toContain("without relevance, authority");
  });

  it("47. blocks automatic participant record attachment", () => {
    expect(section("ATTACHMENT_AND_RECORD_DISCLOSURE_REVIEW").instructions).toContain("care plans");
    expect(section("ATTACHMENT_AND_RECORD_DISCLOSURE_REVIEW").instructions).toContain("medication charts");
    expect(entry().externalAuthorityRequiredFor).toContain("participant record disclosure");
  });

  it("48. represents professional correspondence structure", () => {
    expect(section("CORRESPONDENCE_STRUCTURE_AND_REFERENCE").description).toContain("subject/reference");
    expect(section("CORRESPONDENCE_STRUCTURE_AND_REFERENCE").description).toContain("signatory");
  });

  it("49. makes tone audience and purpose specific", () => {
    expect(section("TONE_SUPPORT_AND_REQUESTED_ACTION").description).toContain("audience");
    expect(section("TONE_SUPPORT_AND_REQUESTED_ACTION").description).toContain("firm/supportive");
    expect(section("TONE_SUPPORT_AND_REQUESTED_ACTION").instructions).toContain("Professional does not mean aggressive");
  });

  it("50. requires support offerings to be evidenced", () => {
    expect(section("TONE_SUPPORT_AND_REQUESTED_ACTION").description).toContain("real support offerings");
    expect(section("TONE_SUPPORT_AND_REQUESTED_ACTION").instructions).toContain("without evidence the support exists and is authorised");
  });

  it("51. requires authority for requested actions", () => {
    expect(section("TONE_SUPPORT_AND_REQUESTED_ACTION").description).toContain("requested action");
    expect(section("TONE_SUPPORT_AND_REQUESTED_ACTION").description).toContain("authority");
  });

  it("52. represents signatory authority", () => {
    expect(section("FOLLOW_UP_SIGNATORY_APPROVAL_AND_SEND_READINESS").description).toContain("signatory authority");
    expect(entry().externalAuthorityRequiredFor).toContain("sending correspondence");
  });

  it("53. separates drafting owner from signatory", () => {
    expect(section("FOLLOW_UP_SIGNATORY_APPROVAL_AND_SEND_READINESS").description).toContain("drafting owner versus signatory");
    expect(section("FOLLOW_UP_SIGNATORY_APPROVAL_AND_SEND_READINESS").instructions).toContain("Drafting does not equal send authority");
  });

  it("54. represents approval gate", () => {
    expect(section("FOLLOW_UP_SIGNATORY_APPROVAL_AND_SEND_READINESS").description).toContain("required approvals");
    expect(entry().requiredApprovals).toMatchObject({ correspondence_owner: true, send_authority_owner: true });
  });

  it("55. represents send-readiness", () => {
    expect(section("FOLLOW_UP_SIGNATORY_APPROVAL_AND_SEND_READINESS").description).toContain("send-readiness");
    expect(section("PROFESSIONAL_CONCLUSION").description).toContain("CORRESPONDENCE_READY_FOR_SIGNATORY");
  });

  it("56. drafting does not equal send authority", () => {
    expect(entry().validationRules?.map((rule) => rule.rule)).toContain("drafting_not_sending");
    expect(section("PROFESSIONAL_CONCLUSION").instructions).toContain("must not email, post, upload, message, submit, notify");
  });

  it("57. preserves KRS and current-authority boundary", () => {
    expect(section("KRS_CURRENT_AUTHORITY_AND_EVIDENCE_ROLE_SEPARATION").description).toContain("KRS/source registry");
    expect(section("KRS_CURRENT_AUTHORITY_AND_EVIDENCE_ROLE_SEPARATION").instructions).toContain("Do not hard-code regulatory truth");
  });

  it("58. separates evidence roles from wording", () => {
    expect(section("KRS_CURRENT_AUTHORITY_AND_EVIDENCE_ROLE_SEPARATION").description).toContain("source fact");
    expect(section("KRS_CURRENT_AUTHORITY_AND_EVIDENCE_ROLE_SEPARATION").description).toContain("correspondence wording");
    expect(section("KRS_CURRENT_AUTHORITY_AND_EVIDENCE_ROLE_SEPARATION").instructions).toContain("wording layer");
  });

  it("59. requires contradiction handling", () => {
    expect(section("CONTRADICTION_UNCERTAINTY_AND_ACCESSIBILITY").description).toContain("management says closed while register says open");
    expect(section("CONTRADICTION_UNCERTAINTY_AND_ACCESSIBILITY").instructions).toContain("Do not choose whichever evidence makes drafting easier");
  });

  it("60. preserves uncertainty", () => {
    expect(section("CONTRADICTION_UNCERTAINTY_AND_ACCESSIBILITY").description).toContain("uncertainty preservation");
    expect(section("CONTRADICTION_UNCERTAINTY_AND_ACCESSIBILITY").instructions).toContain("not confirmed into did not occur");
  });

  it("61. represents accessibility supports", () => {
    expect(section("CONTRADICTION_UNCERTAINTY_AND_ACCESSIBILITY").description).toContain("Easy English");
    expect(section("CONTRADICTION_UNCERTAINTY_AND_ACCESSIBILITY").description).toContain("interpreter");
  });

  it("62. preserves output states without creating a platform status framework", () => {
    const description = section("PROFESSIONAL_CONCLUSION").description;
    expect(description).toContain("CORRESPONDENCE_NOT_READY_EVIDENCE_GAP");
    expect(description).toContain("CORRESPONDENCE_NOT_READY_POSITION_NOT_AUTHORISED");
    expect(description).toContain("SEND_NOT_AUTHORISED");
  });

  it("63. preserves compatibility count", () => {
    expect(compatibilityRoutes()).toHaveLength(1);
  });

  it("64. leaves zero genuine method-pending Blueprints and 74 canonical professional entries", () => {
    expect(methodPendingCodes()).toHaveLength(0);
    expect(methodPendingCodes()).toEqual([]);
    expect(BLUEPRINT_REGISTRY.length).toBe(75);
    expect(BLUEPRINT_REGISTRY.length - methodPendingCodes().length - compatibilityRoutes().length).toBe(74);
  });
});
