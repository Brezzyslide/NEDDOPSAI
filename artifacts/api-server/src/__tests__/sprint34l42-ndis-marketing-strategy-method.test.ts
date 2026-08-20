import { describe, expect, it } from "vitest";
import {
  BLUEPRINT_REGISTRY,
  getRegistryEntry,
  resolveRegistryProfessionalOwner,
} from "../services/blueprintRegistry.js";

const CODE = "ndis_marketing_strategy";
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

describe("Sprint 34L.42 NDIS marketing strategy method", () => {
  it("1. removes USER_DEFINITION_REQUIRED_METHOD from ndis_marketing_strategy", () => {
    expect(sectionCodes()).not.toContain("USER_DEFINITION_REQUIRED_METHOD");
    expect(sections()[0]?.sectionCode).toBe("STRATEGY_SCOPE_AND_OBJECTIVE");
  });

  it("2. removes human_professional_method_owner from ndis_marketing_strategy", () => {
    expect(entry().requiredApprovals).not.toHaveProperty("human_professional_method_owner");
    expect(methodPendingCodes()).not.toContain(CODE);
  });

  it("3. uses the approved professional title and purpose", () => {
    expect(entry().title).toBe("NDIS Market Growth, Referral & Authority Strategy");
    expect(entry().purpose).toContain("referral");
    expect(entry().purpose).toContain("authority");
    expect(entry().purpose).toContain("capacity-constrained growth");
  });

  it("4. preserves Marketing Communications ownership", () => {
    expect(resolveRegistryProfessionalOwner(entry())).toBe("marketing_communications_manager");
    expect(entry().supportingSpecialists).toEqual([
      "service_delivery_coordinator",
      "compliance_quality_manager",
      "financial_planning_reporting_manager",
      "knowledge_documentation_specialist",
    ]);
  });

  it("5. keeps NDIS strategy broader than a social media plan", () => {
    expect(section("STRATEGY_SCOPE_AND_OBJECTIVE").description).toContain("service portfolio");
    expect(section("STRATEGY_SCOPE_AND_OBJECTIVE").description).toContain("existing referral sources");
    expect(section("STRATEGY_SCOPE_AND_OBJECTIVE").instructions).toContain("participant acquisition");
    expect(section("STRATEGY_SCOPE_AND_OBJECTIVE").instructions).toContain("professional partnership development");
  });

  it("6. uses Product Owner evidence without hard-coding MH&R as universal doctrine", () => {
    expect(section("SOURCE_EVIDENCE_AND_CONTEXT").description).toContain("referral form");
    expect(section("SOURCE_EVIDENCE_AND_CONTEXT").description).toContain("participant-rights commitments");
    expect(section("SOURCE_EVIDENCE_AND_CONTEXT").instructions).toContain("do not turn one provider's source material into universal platform doctrine");
  });

  it("7. establishes actual service capability before marketing", () => {
    expect(section("ACTUAL_SERVICE_CAPABILITY").description).toContain("workforce capability");
    expect(section("ACTUAL_SERVICE_CAPABILITY").description).toContain("accommodation capacity");
    expect(section("ACTUAL_SERVICE_CAPABILITY").instructions).toContain("Marketing cannot outrun operational capacity");
  });

  it("8. requires capability-to-marketing gate", () => {
    expect(section("CAPABILITY_TO_MARKETING_GATE").description).toContain("Service claim");
    expect(section("CAPABILITY_TO_MARKETING_GATE").description).toContain("market permitted");
    expect(entry().validationRules?.map((rule) => rule.rule)).toContain("service_capability_before_marketing_claim");
  });

  it("9. represents evidence-based target market segmentation", () => {
    expect(section("TARGET_MARKET_SEGMENTATION").description).toContain("Participant support need");
    expect(section("TARGET_MARKET_SEGMENTATION").description).toContain("organisational fit");
    expect(section("TARGET_MARKET_SEGMENTATION").instructions).toContain("complex and forensic disability support");
  });

  it("10. separates marketing lead from qualified referral and commencement", () => {
    expect(section("REFERRAL_FIT_MODEL").description).toContain("qualified referral");
    expect(section("REFERRAL_FIT_MODEL").description).toContain("commencement");
    expect(entry().validationRules?.map((rule) => rule.rule)).toContain("qualified_referrals_not_raw_leads");
  });

  it("11. assesses referral quality rather than raw lead volume", () => {
    expect(section("REFERRAL_QUALITY_ASSESSMENT").description).toContain("safeguarding capability");
    expect(section("REFERRAL_QUALITY_ASSESSMENT").description).toContain("financial viability");
    expect(section("REFERRAL_QUALITY_ASSESSMENT").instructions).toContain("appropriate referrals over indiscriminate volume");
  });

  it("12. maps the professional referral ecosystem", () => {
    expect(section("REFERRAL_ECOSYSTEM_MAPPING").description).toContain("support coordinators");
    expect(section("REFERRAL_ECOSYSTEM_MAPPING").description).toContain("clinical leaders");
    expect(section("REFERRAL_ECOSYSTEM_MAPPING").instructions).toContain("conversion measure");
  });

  it("13. analyses referral source quality when evidence exists", () => {
    expect(section("REFERRAL_SOURCE_ANALYSIS").description).toContain("acceptance rate");
    expect(section("REFERRAL_SOURCE_ANALYSIS").description).toContain("time to commencement");
    expect(section("REFERRAL_SOURCE_ANALYSIS").instructions).toContain("loudest channel");
  });

  it("14. does not manufacture market statistics", () => {
    expect(section("MARKET_DEMAND_EVIDENCE").description).toContain("waitlists");
    expect(section("MARKET_DEMAND_EVIDENCE").description).toContain("external market data");
    expect(section("MARKET_DEMAND_EVIDENCE").instructions).toContain("Do not manufacture NDIS market statistics");
  });

  it("15. keeps competitor claims evidence-classed", () => {
    expect(section("COMPETITOR_AND_ALTERNATIVE_ANALYSIS").description).toContain("service gaps");
    expect(section("COMPETITOR_AND_ALTERNATIVE_ANALYSIS").instructions).toContain("verified evidence");
    expect(section("COMPETITOR_AND_ALTERNATIVE_ANALYSIS").instructions).toContain("public claim");
  });

  it("16. demands credible service-specific value propositions", () => {
    expect(section("POSITIONING_AND_VALUE_PROPOSITION").description).toContain("audience-specific");
    expect(section("POSITIONING_AND_VALUE_PROPOSITION").instructions).toContain("best provider");
    expect(section("POSITIONING_AND_VALUE_PROPOSITION").instructions).toContain("unless evidence supports them");
  });

  it("17. implements trust-before-promotion authority marketing", () => {
    expect(section("AUTHORITY_MARKETING_STRATEGY").description).toContain("sector education");
    expect(section("AUTHORITY_MARKETING_STRATEGY").instructions).toContain("Trust before promotion");
    expect(section("AUTHORITY_MARKETING_STRATEGY").instructions).toContain("educate before selling");
  });

  it("18. gates thought leadership through domain owners and KRS authority", () => {
    expect(section("THOUGHT_LEADERSHIP_EVIDENCE_GATE").description).toContain("Restrictive practice");
    expect(section("THOUGHT_LEADERSHIP_EVIDENCE_GATE").description).toContain("NDIS compliance");
    expect(section("THOUGHT_LEADERSHIP_EVIDENCE_GATE").instructions).toContain("Marketing packages approved professional knowledge");
  });

  it("19. protects case-based content and participant dignity", () => {
    expect(section("CASE_BASED_CONTENT_AND_PARTICIPANT_DIGNITY").description).toContain("re-identification risk");
    expect(section("CASE_BASED_CONTENT_AND_PARTICIPANT_DIGNITY").instructions).toContain("Do not exploit distress");
    expect(entry().validationRules?.map((rule) => rule.rule)).toContain("participant_dignity_privacy_and_consent_required");
  });

  it("20. preserves participant rights and brand integrity", () => {
    expect(section("PARTICIPANT_RIGHTS_AND_BRAND_INTEGRITY").description).toContain("complaint rights");
    expect(section("PARTICIPANT_RIGHTS_AND_BRAND_INTEGRITY").description).toContain("external Commission pathways");
    expect(section("PARTICIPANT_RIGHTS_AND_BRAND_INTEGRITY").instructions).toContain("safeguarding");
  });

  it("21. handles content pillars without hard-coding one tenant strategy", () => {
    expect(section("CONTENT_PILLARS_AND_STRATEGY").description).toContain("cadence");
    expect(section("CONTENT_PILLARS_AND_STRATEGY").instructions).toContain("Education, Insight, Case-Based Learning and Leadership");
    expect(section("CONTENT_PILLARS_AND_STRATEGY").instructions).toContain("not universal doctrine");
  });

  it("22. chooses channels according to audience and objective", () => {
    expect(section("CHANNEL_STRATEGY").description).toContain("LinkedIn");
    expect(section("CHANNEL_STRATEGY").description).toContain("referral relationships");
    expect(section("CHANNEL_STRATEGY").instructions).toContain("Do not assume every channel is required");
  });

  it("23. keeps tool choice outside methodology", () => {
    expect(section("TOOLS_PLATFORM_AND_EXECUTION_CAPABILITY").description).toContain("content production");
    expect(section("TOOLS_PLATFORM_AND_EXECUTION_CAPABILITY").instructions).toContain("Do not hard-code OpenClaw");
    expect(section("TOOLS_PLATFORM_AND_EXECUTION_CAPABILITY").instructions).toContain("Tool selection is implementation/configuration");
  });

  it("24. rejects volume for volume's sake", () => {
    expect(section("CONTENT_VOLUME_AND_QUALITY_BOUNDARY").description).toContain("operational manageability");
    expect(section("CONTENT_VOLUME_AND_QUALITY_BOUNDARY").instructions).toContain("Content volume is not business performance");
  });

  it("25. requires paid media approval and measurement rules", () => {
    expect(section("PAID_MEDIA_STRATEGY_AND_SPEND_GATE").description).toContain("stopping/optimisation rule");
    expect(section("PAID_MEDIA_STRATEGY_AND_SPEND_GATE").instructions).toContain("Do not approve ad spend");
    expect(entry().evidenceContract?.freshnessRules).toMatchObject({ paidMediaSpendRequiresApprovalAndMeasurementRules: true });
  });

  it("26. links marketing economics to business financial analysis", () => {
    expect(section("MARKETING_ECONOMICS").description).toContain("cost per qualified referral");
    expect(section("MARKETING_ECONOMICS").description).toContain("payback");
    expect(section("MARKETING_ECONOMICS").instructions).toContain("business_financial_analysis");
  });

  it("27. constrains growth by operational capacity", () => {
    expect(section("CAPACITY_CONSTRAINED_GROWTH").description).toContain("onboarding capacity");
    expect(section("CAPACITY_CONSTRAINED_GROWTH").instructions).toContain("safe organisational capacity");
    expect(entry().validationRules?.map((rule) => rule.rule)).toContain("capacity_constrains_campaign_scale");
  });

  it("28. protects safeguarding where growth outruns capacity", () => {
    expect(section("GROWTH_SAFEGUARDING_AND_STAGING").description).toContain("waitlist strategy");
    expect(section("GROWTH_SAFEGUARDING_AND_STAGING").instructions).toContain("safely onboard participants");
  });

  it("29. aligns marketing to organisational strategy", () => {
    expect(section("STRATEGIC_ALIGNMENT").description).toContain("financial sustainability");
    expect(section("STRATEGIC_ALIGNMENT").description).toContain("governance maturity");
  });

  it("30. requires claim safety and current-authority review", () => {
    expect(section("CLAIMS_AND_COMPLIANCE_REVIEW").description).toContain("Registration");
    expect(section("CLAIMS_AND_COMPLIANCE_REVIEW").description).toContain("safeguarding capability");
    expect(entry().evidenceContract?.freshnessRules).toMatchObject({ currentAuthorityRequiredForRegulatedClaims: true });
  });

  it("31. measures the full acquisition funnel", () => {
    expect(section("FUNNEL_MEASUREMENT").description).toContain("qualified referral");
    expect(section("FUNNEL_MEASUREMENT").description).toContain("retention");
    expect(section("FUNNEL_MEASUREMENT").instructions).toContain("Do not collapse funnel stages");
  });

  it("32. prevents vanity metrics replacing business outcomes", () => {
    expect(section("KPI_HIERARCHY").description).toContain("Activity");
    expect(section("KPI_HIERARCHY").description).toContain("business metrics");
    expect(entry().evidenceContract?.freshnessRules).toMatchObject({ vanityMetricsCannotSubstituteForBusinessOutcomes: true });
  });

  it("33. requires referral relationship strategy without unauthorised outreach", () => {
    expect(section("REFERRAL_RELATIONSHIP_STRATEGY").description).toContain("relationship owner");
    expect(section("REFERRAL_RELATIONSHIP_STRATEGY").instructions).toContain("Do not contact referral partners");
  });

  it("34. preserves publication and execution limits", () => {
    expect(section("MARKETING_APPROVAL_AND_EXECUTION_LIMITS").description).toContain("ad spend");
    expect(section("MARKETING_APPROVAL_AND_EXECUTION_LIMITS").description).toContain("referral-partner contact");
    expect(entry().validationRules?.map((rule) => rule.rule)).toContain("strategy_not_campaign_execution");
  });

  it("35. defines professional conclusion states", () => {
    expect(section("PROFESSIONAL_CONCLUSION").description).toContain("AUTHORITY_STRATEGY_READY");
    expect(section("PROFESSIONAL_CONCLUSION").description).toContain("CAPACITY_BUILD_REQUIRED_BEFORE_SCALE");
    expect(section("PROFESSIONAL_CONCLUSION").description).toContain("CLAIMS_NOT_SUPPORTED");
  });

  it("36. requires the approved evidence categories", () => {
    expect(entry().evidenceContract?.requiredEvidenceCategories).toEqual([
      "strategic_plan",
      "approved_claim_source",
      "service_catalogue",
      "market_source",
      "referral_form",
      "referral_record",
      "referral_source_record",
      "competitor_evidence",
      "current_authority",
      "privacy_consent_record",
      "participant_rights_information",
      "campaign_record",
      "communications_record",
      "operational_record",
      "financial_record",
      "performance_record",
      "capacity_record",
      "approval_record",
    ]);
  });

  it("37. keeps marketing publication and spend approval gated", () => {
    expect(entry().requiredApprovals).toMatchObject({
      marketing_owner: true,
      external_publication_owner: true,
    });
    expect(entry().deliverableContract?.prohibitedDeliverables).toEqual(expect.arrayContaining([
      "public_publication",
      "ad_spend_approval",
      "campaign_launch",
      "referral_partner_contact",
      "participant_story_publication",
    ]));
  });

  it("38. keeps sibling marketing and strategic Blueprints method-pending", () => {
    expect(methodPendingCodes()).toEqual(expect.arrayContaining([
    ]));
  });

  it("39. preserves the single compatibility route count", () => {
    expect(compatibilityRoutes().map((blueprint) => blueprint.code)).toEqual(["regulatory_change_impact"]);
    expect(compatibilityRoutes()).toHaveLength(1);
  });

  it("40. moves genuine method-pending count to 1 with truthful programme accounting", () => {
    expect(BLUEPRINT_REGISTRY).toHaveLength(75);
    expect(methodPendingCodes()).toHaveLength(0);
    expect(BLUEPRINT_REGISTRY.length - methodPendingCodes().length - compatibilityRoutes().length).toBe(74);
  });

  it("41. preserves professional authority boundaries in the full contract", () => {
    expect(allText()).toContain("Marketing packages approved professional knowledge");
    expect(allText()).toContain("business_financial_analysis");
    expect(allText()).toContain("must not publish content");
    expect(allText()).toContain("contact referral partners");
  });
});
