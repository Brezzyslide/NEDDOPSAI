import { describe, expect, it } from "vitest";
import {
  BLUEPRINT_REGISTRY,
  getRegistryEntry,
  resolveRegistryProfessionalOwner,
} from "../services/blueprintRegistry.js";
import { resolveIntent } from "../services/blueprintIntentMap.js";

const CODE = "marketing_communications_review";
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

describe("Sprint 34L.46 marketing communications review method", () => {
  it("1. removes USER_DEFINITION_REQUIRED_METHOD from marketing communications", () => {
    expect(sectionCodes()).not.toContain("USER_DEFINITION_REQUIRED_METHOD");
    expect(sections()[0]?.sectionCode).toBe("COMMUNICATION_SCOPE");
  });

  it("2. removes human_professional_method_owner from marketing communications", () => {
    expect(entry().requiredApprovals).not.toHaveProperty("human_professional_method_owner");
    expect(methodPendingCodes()).not.toContain(CODE);
  });

  it("3. uses the approved communications assurance title", () => {
    expect(entry().title).toBe("Marketing, Public Communications & Claims Assurance Review");
    expect(entry().purpose).toContain("public communications");
    expect(entry().purpose).toContain("participant rights");
    expect(entry().purpose).toContain("publication readiness");
  });

  it("4. preserves Marketing Communications Manager ownership", () => {
    expect(resolveRegistryProfessionalOwner(entry())).toBe("marketing_communications_manager");
    expect(entry().supportingSpecialists).toEqual([
      "compliance_quality_manager",
      "policy_governance_specialist",
      "knowledge_documentation_specialist",
    ]);
    expect(entry().requiredApprovals).toMatchObject({
      marketing_owner: true,
      external_publication_owner: true,
    });
  });

  it("5. preserves marketing campaign routing to communications review", () => {
    expect(resolveIntent("marketing.campaign")).toMatchObject({ code: CODE });
  });

  it("6. scopes communication before review", () => {
    expect(section("COMMUNICATION_SCOPE").description).toContain("communication type");
    expect(section("COMMUNICATION_SCOPE").description).toContain("intended audience");
    expect(section("COMMUNICATION_SCOPE").description).toContain("publication status");
    expect(section("COMMUNICATION_SCOPE").instructions).toContain("Do not apply identical criteria");
  });

  it("7. represents audience analysis", () => {
    expect(section("AUDIENCE_ANALYSIS").description).toContain("Support Coordinators");
    expect(section("AUDIENCE_ANALYSIS").description).toContain("professional sector audience");
    expect(section("AUDIENCE_ANALYSIS").instructions).toContain("risk of misunderstanding");
  });

  it("8. separates communication objective from conversion optimisation", () => {
    expect(section("COMMUNICATION_OBJECTIVE").description).toContain("explain rights");
    expect(section("COMMUNICATION_OBJECTIVE").description).toContain("communicate safeguarding");
    expect(section("COMMUNICATION_OBJECTIVE").instructions).toContain("Do not optimise for conversion");
  });

  it("9. discovers organisational and authority evidence before reviewing claims", () => {
    expect(section("SOURCE_EVIDENCE_DISCOVERY").description).toContain("service catalogue");
    expect(section("SOURCE_EVIDENCE_DISCOVERY").description).toContain("privacy/consent evidence");
    expect(section("SOURCE_EVIDENCE_DISCOVERY").instructions).toContain("Do not create another evidence system");
  });

  it("10. decomposes material communications into claim inventory", () => {
    expect(section("CLAIM_INVENTORY").description).toContain("registration");
    expect(section("CLAIM_INVENTORY").description).toContain("testimonial");
    expect(section("CLAIM_INVENTORY").instructions).toContain("claim class");
  });

  it("11. defines claim status and evidence gate", () => {
    expect(section("CLAIM_STATUS_AND_EVIDENCE_GATE").description).toContain("CLAIM_SUPPORTED_WITH_QUALIFICATION");
    expect(section("CLAIM_STATUS_AND_EVIDENCE_GATE").description).toContain("PUBLICATION_NOT_READY");
    expect(section("CLAIM_STATUS_AND_EVIDENCE_GATE").instructions).toContain("management remembers it");
    expect(entry().validationRules?.map((rule) => rule.rule)).toContain("material_public_claims_require_current_evidence");
  });

  it("12. treats existing public content as evidence not authority", () => {
    expect(section("EXISTING_PUBLIC_CONTENT_BOUNDARY").description).toContain("Current website statements");
    expect(section("EXISTING_PUBLIC_CONTENT_BOUNDARY").instructions).toContain("not automatic professional evidence");
    expect(entry().validationRules?.map((rule) => rule.rule)).toContain("existing_public_content_is_evidence_not_authority");
  });

  it("13. supports website review without creating a separate website audit Blueprint", () => {
    expect(section("WEBSITE_REVIEW_METHOD").description).toContain("Homepage");
    expect(section("WEBSITE_REVIEW_METHOD").description).toContain("downloadable documents");
    expect(section("WEBSITE_REVIEW_METHOD").instructions).toContain("without creating a separate website-audit Blueprint");
  });

  it("14. represents website claim register", () => {
    expect(section("WEBSITE_CLAIM_REGISTER").description).toContain("evidence required");
    expect(section("WEBSITE_CLAIM_REGISTER").description).toContain("publication readiness");
    expect(section("WEBSITE_CLAIM_REGISTER").instructions).toContain("tested systematically");
  });

  it("15. validates service claims against actual capability", () => {
    expect(section("SERVICE_CLAIM_VALIDATION").description).toContain("current availability");
    expect(section("SERVICE_CLAIM_VALIDATION").description).toContain("safeguarding capability");
    expect(section("SERVICE_CLAIM_VALIDATION").instructions).toContain("Do not infer service capability from marketing material");
  });

  it("16. requires current evidence for registration and authority claims", () => {
    expect(section("REGISTRATION_AND_AUTHORITY_CLAIMS").description).toContain("Registered NDIS provider");
    expect(section("REGISTRATION_AND_AUTHORITY_CLAIMS").description).toContain("certification");
    expect(section("REGISTRATION_AND_AUTHORITY_CLAIMS").instructions).toContain("KRS/current-authority");
  });

  it("17. keeps professional capability claims outside marketing self-certification", () => {
    expect(section("PROFESSIONAL_CAPABILITY_CLAIMS").description).toContain("trauma-informed");
    expect(section("PROFESSIONAL_CAPABILITY_CLAIMS").description).toContain("high-intensity");
    expect(section("PROFESSIONAL_CAPABILITY_CLAIMS").instructions).toContain("Marketing does not decide clinical or professional competence");
  });

  it("18. constrains outcome and comparative claims", () => {
    expect(section("OUTCOME_AND_COMPARATIVE_CLAIMS").description).toContain("prevents hospitalisation");
    expect(section("OUTCOME_AND_COMPARATIVE_CLAIMS").description).toContain("most trusted");
    expect(section("OUTCOME_AND_COMPARATIVE_CLAIMS").instructions).toContain("Do not imply guaranteed participant outcomes");
  });

  it("19. protects NDIS funding and pricing claims", () => {
    expect(section("NDIS_FUNDING_AND_PRICING_CLAIMS").description).toContain("guaranteeing approvals");
    expect(section("NDIS_FUNDING_AND_PRICING_CLAIMS").description).toContain("price limits");
    expect(section("NDIS_FUNDING_AND_PRICING_CLAIMS").instructions).toContain("provider controls NDIA funding decisions");
  });

  it("20. routes regulatory, compliance and clinical claims to professional evidence", () => {
    expect(section("REGULATORY_COMPLIANCE_AND_CLINICAL_CLAIMS").description).toContain("Practice Standards");
    expect(section("REGULATORY_COMPLIANCE_AND_CLINICAL_CLAIMS").description).toContain("dysphagia");
    expect(section("REGULATORY_COMPLIANCE_AND_CLINICAL_CLAIMS").instructions).toContain("Marketing packages approved professional knowledge");
    expect(entry().validationRules?.map((rule) => rule.rule)).toContain("marketing_cannot_certify_professional_or_regulated_claims");
  });

  it("21. preserves thought leadership accuracy boundary", () => {
    expect(section("THOUGHT_LEADERSHIP_BOUNDARY").description).toContain("authority positioning");
    expect(section("THOUGHT_LEADERSHIP_BOUNDARY").instructions).toContain("Do not manufacture controversy");
  });

  it("22. reviews participant rights", () => {
    expect(section("PARTICIPANT_RIGHTS_REVIEW").description).toContain("Choice");
    expect(section("PARTICIPANT_RIGHTS_REVIEW").description).toContain("advocacy");
    expect(section("PARTICIPANT_RIGHTS_REVIEW").instructions).toContain("must not coerce");
  });

  it("23. treats accessibility as communication quality", () => {
    expect(section("ACCESSIBILITY_REVIEW").description).toContain("Easy Read");
    expect(section("ACCESSIBILITY_REVIEW").description).toContain("screen-reader");
    expect(section("ACCESSIBILITY_REVIEW").instructions).toContain("not formatting polish");
  });

  it("24. requires privacy, confidentiality and consent evidence", () => {
    expect(section("PRIVACY_CONFIDENTIALITY_AND_CONSENT").description).toContain("image/video");
    expect(section("PRIVACY_CONFIDENTIALITY_AND_CONSENT").description).toContain("revocation evidence");
    expect(section("PRIVACY_CONFIDENTIALITY_AND_CONSENT").instructions).toContain("Consent assumed is not consent evidenced");
  });

  it("25. protects photo, video and re-identification risk", () => {
    expect(section("PHOTO_VIDEO_AND_REIDENTIFICATION").description).toContain("forensic history");
    expect(section("PHOTO_VIDEO_AND_REIDENTIFICATION").instructions).toContain("a name was removed");
    expect(section("PHOTO_VIDEO_AND_REIDENTIFICATION").instructions).toContain("not publication-ready");
  });

  it("26. protects safeguarding and trauma from exploitation", () => {
    expect(section("SAFEGUARDING_TRAUMA_AND_INCIDENT_BOUNDARY").description).toContain("restrictive practice");
    expect(section("SAFEGUARDING_TRAUMA_AND_INCIDENT_BOUNDARY").description).toContain("forensic history");
    expect(section("SAFEGUARDING_TRAUMA_AND_INCIDENT_BOUNDARY").instructions).toContain("Do not exploit participant harm");
  });

  it("27. reviews complaints information", () => {
    expect(section("COMPLAINTS_INFORMATION_REVIEW").description).toContain("freedom from retaliation");
    expect(section("COMPLAINTS_INFORMATION_REVIEW").instructions).toContain("discourage complaints");
  });

  it("28. reviews service access and operational information", () => {
    expect(section("SERVICE_ACCESS_AND_OPERATIONAL_INFO").description).toContain("commencement");
    expect(section("SERVICE_ACCESS_AND_OPERATIONAL_INFO").description).toContain("office hours");
    expect(section("SERVICE_ACCESS_AND_OPERATIONAL_INFO").instructions).toContain("false urgency");
  });

  it("29. checks public document currentness and routes document lifecycle review", () => {
    expect(section("PUBLIC_DOCUMENT_CURRENTNESS").description).toContain("publication date");
    expect(section("PUBLIC_DOCUMENT_CURRENTNESS").instructions).toContain("PUBLIC_DOCUMENT_CURRENTNESS_NOT_VERIFIED");
    expect(section("PUBLIC_DOCUMENT_CURRENTNESS").instructions).toContain("document_control_review");
  });

  it("30. consumes strategy and market analysis without recreating them", () => {
    expect(section("BRAND_STRATEGY_AND_MARKET_ALIGNMENT").description).toContain("ndis_marketing_strategy");
    expect(section("BRAND_STRATEGY_AND_MARKET_ALIGNMENT").description).toContain("ndis_market_analysis");
    expect(section("BRAND_STRATEGY_AND_MARKET_ALIGNMENT").instructions).toContain("without recreating those methods");
  });

  it("31. reviews CTA and channel suitability", () => {
    expect(section("CALL_TO_ACTION_AND_CHANNEL_SUITABILITY").description).toContain("CTA clarity");
    expect(section("CALL_TO_ACTION_AND_CHANNEL_SUITABILITY").description).toContain("referral-partner channel");
    expect(section("CALL_TO_ACTION_AND_CHANNEL_SUITABILITY").instructions).toContain("pathway that is not operationally supported");
  });

  it("32. separates publication readiness from publication authority", () => {
    expect(section("PUBLICATION_READINESS_AND_TREATMENT").description).toContain("specialist review requirements");
    expect(section("PUBLICATION_READINESS_AND_TREATMENT").instructions).toContain("not publication-ready");
    expect(section("PUBLICATION_READINESS_AND_TREATMENT").instructions).toContain("Separate content review from publication authority");
    expect(entry().validationRules?.map((rule) => rule.rule)).toContain("publication_requires_separate_authority");
  });

  it("33. preserves neighbouring Blueprint boundaries", () => {
    expect(section("PROFESSIONAL_BOUNDARIES").description).toContain("ndis_marketing_strategy");
    expect(section("PROFESSIONAL_BOUNDARIES").description).toContain("ndis_market_analysis");
    expect(section("PROFESSIONAL_BOUNDARIES").description).toContain("formal_stakeholder_correspondence");
    expect(section("PROFESSIONAL_BOUNDARIES").description).toContain("controlled_document_assembly");
    expect(section("PROFESSIONAL_BOUNDARIES").instructions).toContain("does not create strategy");
  });

  it("34. prohibits publishing, sending, contact and spend execution", () => {
    expect(section("APPROVAL_PUBLICATION_LIMITS").description).toContain("website/social account change");
    expect(section("APPROVAL_PUBLICATION_LIMITS").description).toContain("stakeholder communication");
    expect(section("APPROVAL_PUBLICATION_LIMITS").instructions).toContain("Do not publish");
    expect(entry().deliverableContract?.prohibitedDeliverables).toEqual(expect.arrayContaining([
      "public_publication",
      "website_change",
      "social_media_post",
      "stakeholder_communication_send",
      "participant_or_family_contact",
      "referral_partner_contact",
      "campaign_launch",
      "ad_spend_approval",
      "public_document_alteration",
    ]));
  });

  it("35. defines professional conclusion states", () => {
    expect(section("PROFESSIONAL_CONCLUSION").description).toContain("CLAIM_SUPPORTED");
    expect(section("PROFESSIONAL_CONCLUSION").description).toContain("PRIVACY_CONSENT_BLOCKER");
    expect(section("PROFESSIONAL_CONCLUSION").description).toContain("PUBLICATION_NOT_READY");
  });

  it("36. requires the approved communications evidence categories", () => {
    expect(entry().evidenceContract?.requiredEvidenceCategories).toEqual([
      "communications_record",
      "approved_claim_source",
      "audience_research",
      "brand_guideline",
      "privacy_consent_record",
    ]);
    expect(entry().mandatoryCitations).toEqual([
      "communications_record",
      "approved_claim_source",
      "audience_research",
      "brand_guideline",
      "privacy_consent_record",
    ]);
  });

  it("37. exposes website, rights, accessibility, current authority and publication evidence", () => {
    expect(entry().evidenceContract?.allowedSourceTypes).toEqual(expect.arrayContaining([
      "website_page",
      "website_download",
      "public_document",
      "service_catalogue",
      "registration_record",
      "workforce_capability_record",
      "current_authority",
      "participant_rights_information",
      "safeguarding_material",
      "complaints_information",
      "accessibility_evidence",
      "marketing_strategy_output",
      "market_analysis_output",
      "publication_approval",
    ]));
  });

  it("38. exposes claim, currentness, rights, accessibility and publication rules", () => {
    expect(entry().evidenceContract?.freshnessRules).toMatchObject({
      existingPublicContentIsEvidenceNotAuthority: true,
      materialClaimsRequireEvidence: true,
      currentEvidenceRequiredForCurrentClaims: true,
      serviceCapabilityMustPrecedePublicClaim: true,
      marketingCannotCertifyProfessionalClaims: true,
      participantRightsAccessibilityPrivacyAndConsentRequired: true,
      publicationRequiresSeparateApproval: true,
    });
    expect(entry().evidenceContract?.restrictedSourceTypes).toEqual(expect.arrayContaining([
      "website_statement_only",
      "management_memory_only",
      "consent_assumed",
      "unapproved_participant_story",
      "unverified_registration_claim",
    ]));
  });

  it("39. remains template-bound as a controlled communications work product", () => {
    expect(entry().deliverableContract).toMatchObject({
      artifactRequired: true,
      primaryFormat: "docx",
      templateRequired: true,
    });
  });

  it("40. leaves no sibling method-pending Blueprints gated", () => {
    expect(methodPendingCodes()).toEqual([]);
  });

  it("41. preserves the single compatibility route count", () => {
    expect(compatibilityRoutes().map((blueprint) => blueprint.code)).toEqual(["regulatory_change_impact"]);
    expect(compatibilityRoutes()).toHaveLength(1);
  });

  it("42. moves genuine method-pending count to 1 with truthful programme accounting", () => {
    expect(BLUEPRINT_REGISTRY).toHaveLength(75);
    expect(methodPendingCodes()).toHaveLength(0);
    expect(BLUEPRINT_REGISTRY.length - methodPendingCodes().length - compatibilityRoutes().length).toBe(74);
  });

  it("43. keeps full communications assurance boundaries visible", () => {
    expect(allText()).toContain("ndis_marketing_strategy");
    expect(allText()).toContain("ndis_market_analysis");
    expect(allText()).toContain("formal_stakeholder_correspondence");
    expect(allText()).toContain("controlled_document_assembly");
    expect(allText()).toContain("regulator_response_submission");
    expect(allText()).toContain("publish content");
  });
});
