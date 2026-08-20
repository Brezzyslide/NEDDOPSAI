import { describe, expect, it } from "vitest";
import {
  BLUEPRINT_REGISTRY,
  getRegistryEntry,
  resolveRegistryProfessionalOwner,
} from "../services/blueprintRegistry.js";
import { resolveIntent } from "../services/blueprintIntentMap.js";

const CODE = "ndis_market_analysis";
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

describe("Sprint 34L.45 NDIS market analysis method", () => {
  it("1. removes USER_DEFINITION_REQUIRED_METHOD from NDIS market analysis", () => {
    expect(sectionCodes()).not.toContain("USER_DEFINITION_REQUIRED_METHOD");
    expect(sections()[0]?.sectionCode).toBe("DEFINED_MARKET_SCOPE");
  });

  it("2. removes human_professional_method_owner from NDIS market analysis", () => {
    expect(entry().requiredApprovals).not.toHaveProperty("human_professional_method_owner");
    expect(methodPendingCodes()).not.toContain(CODE);
  });

  it("3. uses the approved market intelligence title and purpose", () => {
    expect(entry().title).toBe("NDIS Market Intelligence, Demand & Competitive Analysis");
    expect(entry().purpose).toContain("participant and referral demand");
    expect(entry().purpose).toContain("supply and competitive capacity");
    expect(entry().purpose).toContain("management conclusions reasonably supported");
  });

  it("4. preserves marketing communications ownership for market intelligence", () => {
    expect(resolveRegistryProfessionalOwner(entry())).toBe("marketing_communications_manager");
    expect(entry().supportingSpecialists).toEqual([
      "financial_planning_reporting_manager",
      "operations_manager",
      "knowledge_documentation_specialist",
    ]);
    expect(entry().requiredApprovals).toMatchObject({ marketing_owner: true });
  });

  it("5. preserves strategic market analysis routing", () => {
    expect(resolveIntent("strategic.market_analysis")).toMatchObject({ code: CODE });
  });

  it("6. requires defined market scope before analysis", () => {
    expect(section("DEFINED_MARKET_SCOPE").description).toContain("Geography");
    expect(section("DEFINED_MARKET_SCOPE").description).toContain("service type");
    expect(section("DEFINED_MARKET_SCOPE").description).toContain("participant cohort");
    expect(section("DEFINED_MARKET_SCOPE").description).toContain("time period");
    expect(section("DEFINED_MARKET_SCOPE").instructions).toContain("Define the market before analysing it");
  });

  it("7. surfaces broad or ambiguous scope instead of false precision", () => {
    expect(section("MARKET_SCOPE_CONFIDENCE").description).toContain("too broad/ambiguous");
    expect(section("MARKET_SCOPE_CONFIDENCE").instructions).toContain("CURRENT_MARKET_NOT_VERIFIED");
    expect(entry().validationRules?.map((rule) => rule.rule)).toContain("market_scope_required_before_conclusion");
  });

  it("8. represents internal demand evidence", () => {
    expect(section("INTERNAL_DEMAND_SIGNALS").description).toContain("Enquiries");
    expect(section("INTERNAL_DEMAND_SIGNALS").description).toContain("waiting list");
    expect(section("INTERNAL_DEMAND_SIGNALS").description).toContain("reasons for refusal");
  });

  it("9. prevents internal referrals being treated as total market size", () => {
    expect(section("INTERNAL_DEMAND_BOUNDARY").instructions).toContain("internal referrals are not total addressable demand");
    expect(section("INTERNAL_DEMAND_BOUNDARY").instructions).toContain("waiting list is not market size");
    expect(entry().validationRules?.map((rule) => rule.rule)).toContain("internal_referrals_not_market_size");
  });

  it("10. represents demand taxonomy", () => {
    expect(section("DEMAND_TAXONOMY").description).toContain("Participant need");
    expect(section("DEMAND_TAXONOMY").description).toContain("funded demand");
    expect(section("DEMAND_TAXONOMY").description).toContain("capturable demand");
  });

  it("11. represents external market evidence", () => {
    expect(section("EXTERNAL_MARKET_EVIDENCE").description).toContain("NDIA participant datasets");
    expect(section("EXTERNAL_MARKET_EVIDENCE").description).toContain("provider datasets");
    expect(section("EXTERNAL_MARKET_EVIDENCE").description).toContain("SDA/housing vacancy evidence");
  });

  it("12. preserves the KRS/current-source path", () => {
    expect(section("KRS_MARKET_SOURCE_PATH").description).toContain("KRS/knowledge orchestration");
    expect(section("KRS_MARKET_SOURCE_PATH").description).toContain("approved retrieval transport");
    expect(section("KRS_MARKET_SOURCE_PATH").instructions).toContain("must not independently decide");
  });

  it("13. requires currentness and provenance for current market claims", () => {
    expect(section("CURRENTNESS_PROVENANCE_GATE").description).toContain("reporting period");
    expect(section("CURRENTNESS_PROVENANCE_GATE").description).toContain("retrieval date");
    expect(section("CURRENTNESS_PROVENANCE_GATE").instructions).toContain("without sufficiently current evidence");
    expect(entry().validationRules?.map((rule) => rule.rule)).toContain("current_market_claim_requires_current_evidence");
  });

  it("14. represents participant and demand analysis without broad-count shortcuts", () => {
    expect(section("PARTICIPANT_DEMAND_ANALYSIS").description).toContain("Participant volumes");
    expect(section("PARTICIPANT_DEMAND_ANALYSIS").description).toContain("service-type demand");
    expect(section("PARTICIPANT_DEMAND_ANALYSIS").instructions).toContain("total NDIS participant count");
  });

  it("15. keeps funding context distinct from funding utilisation analysis", () => {
    expect(section("FUNDING_CONTEXT").description).toContain("Funded participant population");
    expect(section("FUNDING_CONTEXT").description).toContain("service funding availability");
    expect(section("FUNDING_CONTEXT").instructions).toContain("Do not perform detailed participant funding-utilisation analysis");
  });

  it("16. maps provider supply without treating registration as active supply", () => {
    expect(section("SUPPLY_PROVIDER_MAPPING").description).toContain("Registered providers");
    expect(section("SUPPLY_PROVIDER_MAPPING").description).toContain("vacancies/capacity");
    expect(section("SUPPLY_PROVIDER_MAPPING").instructions).toContain("Registered provider is not active provider");
    expect(entry().validationRules?.map((rule) => rule.rule)).toContain("registered_provider_not_active_supply");
  });

  it("17. represents competitor analysis", () => {
    expect(section("COMPETITOR_ANALYSIS").description).toContain("service portfolio");
    expect(section("COMPETITOR_ANALYSIS").description).toContain("public positioning");
    expect(section("COMPETITOR_ANALYSIS").instructions).toContain("Do not invent competitor quality");
  });

  it("18. keeps competitor public claims separate from verified fact", () => {
    expect(section("COMPETITOR_EVIDENCE_CLASSES").description).toContain("Verified fact");
    expect(section("COMPETITOR_EVIDENCE_CLASSES").description).toContain("public claim");
    expect(section("COMPETITOR_EVIDENCE_CLASSES").instructions).toContain("Do not turn public claim into verified fact");
    expect(entry().validationRules?.map((rule) => rule.rule)).toContain("competitor_claims_are_not_verified_fact");
  });

  it("19. represents pricing environment without hard-coded NDIS prices", () => {
    expect(section("PRICING_ENVIRONMENT").description).toContain("support item price limits");
    expect(section("PRICING_ENVIRONMENT").description).toContain("labour/cost environment");
    expect(section("PRICING_ENVIRONMENT").instructions).toContain("Do not hard-code NDIS prices");
  });

  it("20. separates price limits, provider price, funding, cost and margin", () => {
    expect(section("PRICE_COMMERCIAL_BOUNDARY").description).toContain("NDIS price limit");
    expect(section("PRICE_COMMERCIAL_BOUNDARY").description).toContain("provider margin");
    expect(section("PRICE_COMMERCIAL_BOUNDARY").instructions).toContain("high price ceiling does not automatically mean");
  });

  it("21. represents regulatory market conditions", () => {
    expect(section("REGULATORY_MARKET_CONDITIONS").description).toContain("Registration requirements");
    expect(section("REGULATORY_MARKET_CONDITIONS").description).toContain("provider entry barriers/exits");
    expect(section("REGULATORY_MARKET_CONDITIONS").instructions).toContain("regulatory_change_impact_assessment");
  });

  it("22. protects the SIL and SDA distinction", () => {
    expect(section("SIL_SDA_MARKET_STRUCTURE").description).toContain("SIL provider availability");
    expect(section("SIL_SDA_MARKET_STRUCTURE").description).toContain("SDA provider/property availability");
    expect(section("SIL_SDA_MARKET_STRUCTURE").instructions).toContain("Do not treat SIL and SDA as the same service");
  });

  it("23. represents partnership and access structure", () => {
    expect(section("PARTNERSHIP_ACCESS_STRUCTURE").description).toContain("collaboration agreements");
    expect(section("PARTNERSHIP_ACCESS_STRUCTURE").description).toContain("marketing permissions");
    expect(section("PARTNERSHIP_ACCESS_STRUCTURE").instructions).toContain("not permanent market ownership");
  });

  it("24. represents referral ecosystem analysis", () => {
    expect(section("REFERRAL_ECOSYSTEM").description).toContain("Support Coordinators");
    expect(section("REFERRAL_ECOSYSTEM").description).toContain("discharge teams");
    expect(section("REFERRAL_ECOSYSTEM").instructions).toContain("derive actual stakeholder importance from evidence");
  });

  it("25. represents referral concentration risk", () => {
    expect(section("REFERRAL_CONCENTRATION").description).toContain("Referral volume by source");
    expect(section("REFERRAL_CONCENTRATION").description).toContain("dependency/concentration");
    expect(section("REFERRAL_CONCENTRATION").instructions).toContain("may face strategic risk");
  });

  it("26. requires demand and supply evidence for service-gap logic", () => {
    expect(section("SERVICE_GAP_ANALYSIS").description).toContain("insufficient suitable supply");
    expect(section("SERVICE_GAP_ANALYSIS").description).toContain("commercial/operational plausibility");
    expect(section("SERVICE_GAP_ANALYSIS").instructions).toContain("more than low competitor count");
  });

  it("27. separates unmet need from commercial opportunity", () => {
    expect(section("UNMET_NEED").description).toContain("participants unable to find suitable provider");
    expect(section("UNMET_NEED").description).toContain("workforce constraints");
    expect(section("UNMET_NEED").instructions).toContain("Distinguish unmet need from commercial opportunity");
  });

  it("28. keeps addressable opportunity evidence-bound", () => {
    expect(section("ADDRESSABLE_OPPORTUNITY").description).toContain("organisation capability");
    expect(section("ADDRESSABLE_OPPORTUNITY").description).toContain("service capacity");
    expect(section("ADDRESSABLE_OPPORTUNITY").instructions).toContain("only where evidence permits");
  });

  it("29. prevents fabricated TAM, SAM and SOM market sizing", () => {
    expect(section("MARKET_SIZING_BOUNDARY").description).toContain("TAM");
    expect(section("MARKET_SIZING_BOUNDARY").description).toContain("SOM");
    expect(section("MARKET_SIZING_BOUNDARY").instructions).toContain("Do not fabricate numbers");
  });

  it("30. represents trend analysis", () => {
    expect(section("MARKET_TREND_ANALYSIS").description).toContain("Participant trend");
    expect(section("MARKET_TREND_ANALYSIS").description).toContain("provider supply trend");
    expect(section("MARKET_TREND_ANALYSIS").instructions).toContain("sustained trend");
  });

  it("31. represents market risk without creating another risk engine", () => {
    expect(section("MARKET_RISK_ANALYSIS").description).toContain("workforce shortage");
    expect(section("MARKET_RISK_ANALYSIS").description).toContain("entry barriers");
    expect(section("MARKET_RISK_ANALYSIS").instructions).toContain("Do not create another risk engine");
  });

  it("32. represents opportunity confidence", () => {
    expect(section("OPPORTUNITY_CONFIDENCE").description).toContain("High, moderate, low");
    expect(section("OPPORTUNITY_CONFIDENCE").instructions).toContain("source quality");
    expect(section("OPPORTUNITY_CONFIDENCE").instructions).toContain("currentness");
  });

  it("33. represents source triangulation", () => {
    expect(section("SOURCE_TRIANGULATION").description).toContain("Internal referral evidence");
    expect(section("SOURCE_TRIANGULATION").description).toContain("provider/supply evidence");
    expect(section("SOURCE_TRIANGULATION").instructions).toContain("Do not manufacture triangulation");
  });

  it("34. structures market conclusions around evidence, confidence and limits", () => {
    expect(section("MARKET_CONCLUSION_STRUCTURE").description).toContain("Defined market");
    expect(section("MARKET_CONCLUSION_STRUCTURE").description).toContain("confidence");
    expect(section("MARKET_CONCLUSION_STRUCTURE").description).toContain("recommended next analysis");
  });

  it("35. preserves neighbouring Blueprint boundaries", () => {
    expect(section("PROFESSIONAL_BOUNDARIES").description).toContain("ndis_marketing_strategy");
    expect(section("PROFESSIONAL_BOUNDARIES").description).toContain("marketing_communications_review");
    expect(section("PROFESSIONAL_BOUNDARIES").description).toContain("business_growth_analysis");
    expect(section("PROFESSIONAL_BOUNDARIES").description).toContain("financial_planning_reporting_review");
    expect(section("PROFESSIONAL_BOUNDARIES").instructions).toContain("what market evidence says");
  });

  it("36. prohibits service expansion, campaign and contact execution", () => {
    expect(section("APPROVAL_AND_EXECUTION_LIMITS").description).toContain("marketing spend");
    expect(section("APPROVAL_AND_EXECUTION_LIMITS").description).toContain("referral-partner contact");
    expect(section("APPROVAL_AND_EXECUTION_LIMITS").instructions).toContain("does not approve service expansion");
    expect(entry().deliverableContract?.prohibitedDeliverables).toEqual(expect.arrayContaining([
      "service_expansion_approval",
      "campaign_launch",
      "public_market_claim",
      "competitor_contact",
      "referral_partner_contact",
      "ndis_registration_change",
    ]));
  });

  it("37. defines market-intelligence conclusion states", () => {
    expect(section("PROFESSIONAL_CONCLUSION").description).toContain("MARKET_OPPORTUNITY_SUPPORTED");
    expect(section("PROFESSIONAL_CONCLUSION").description).toContain("CURRENT_MARKET_NOT_VERIFIED");
    expect(section("PROFESSIONAL_CONCLUSION").description).toContain("OPPORTUNITY_REQUIRES_GROWTH_ANALYSIS");
  });

  it("38. requires the approved NDIS market evidence categories", () => {
    expect(entry().evidenceContract?.requiredEvidenceCategories).toEqual([
      "market_scope",
      "market_source",
      "internal_market_signal",
      "external_market_source",
      "competitor_evidence",
      "current_authority",
    ]);
    expect(entry().mandatoryCitations).toEqual([
      "market_scope",
      "market_source",
      "internal_market_signal",
      "external_market_source",
      "competitor_evidence",
      "current_authority",
    ]);
  });

  it("39. exposes internal, external, competitor, pricing and strategic evidence sources", () => {
    expect(entry().evidenceContract?.allowedSourceTypes).toEqual(expect.arrayContaining([
      "referral_record",
      "waiting_list_record",
      "service_refusal_record",
      "participant_dataset",
      "provider_dataset",
      "provider_directory",
      "competitor_public_claim",
      "ndis_pricing_authority",
      "regulatory_market_condition",
      "operational_capacity_record",
      "marketing_strategy_output",
      "sda_property_evidence",
      "collaboration_agreement",
    ]));
  });

  it("40. exposes currentness, triangulation and boundary evidence rules", () => {
    expect(entry().evidenceContract?.freshnessRules).toMatchObject({
      marketScopeRequiredBeforeConclusion: true,
      geographyServiceCohortAndPeriodRequired: true,
      currentMarketClaimRequiresCurrentEvidence: true,
      krsResolvedMarketEvidenceRequired: true,
      runtimeMustNotIndependentlyChooseMarketTruth: true,
      internalSignalsAreNotMarketSize: true,
      internalExternalAndSupplyEvidenceShouldBeTriangulated: true,
      registeredProviderIsNotActiveAvailableSupply: true,
      tamSamSomMustNotBeFabricated: true,
      marketOpportunityIsNotGrowthApproval: true,
    });
    expect(entry().evidenceContract?.restrictedSourceTypes).toEqual(expect.arrayContaining([
      "stale_market_claim",
      "unsupported_competitor_claim",
      "single_signal_market_size",
      "registered_provider_count_only",
    ]));
  });

  it("41. remains structured analysis while strategy execution stays downstream", () => {
    expect(entry().deliverableContract).toMatchObject({
      artifactRequired: false,
      primaryFormat: "structured_analysis",
      templateRequired: false,
    });
  });

  it("42. leaves no sibling method-pending Blueprints gated", () => {
    expect(methodPendingCodes()).toEqual([]);
  });

  it("43. preserves the single compatibility route count", () => {
    expect(compatibilityRoutes().map((blueprint) => blueprint.code)).toEqual(["regulatory_change_impact"]);
    expect(compatibilityRoutes()).toHaveLength(1);
  });

  it("44. moves genuine method-pending count to 1 with truthful programme accounting", () => {
    expect(BLUEPRINT_REGISTRY).toHaveLength(75);
    expect(methodPendingCodes()).toHaveLength(0);
    expect(BLUEPRINT_REGISTRY.length - methodPendingCodes().length - compatibilityRoutes().length).toBe(74);
  });

  it("45. keeps full market-analysis boundaries visible", () => {
    expect(allText()).toContain("ndis_marketing_strategy");
    expect(allText()).toContain("marketing_communications_review");
    expect(allText()).toContain("business_growth_analysis");
    expect(allText()).toContain("business_financial_analysis");
    expect(allText()).toContain("financial_planning_reporting_review");
    expect(allText()).toContain("operational_readiness_assessment");
  });

  it("46. distinguishes authoritative, commercial, professional-network and social source classes", () => {
    expect(section("SOURCE_CLASS_HIERARCHY").description).toContain("Tier 1 authoritative/government sources");
    expect(section("SOURCE_CLASS_HIERARCHY").description).toContain("Tier 2 direct organisational/commercial sources");
    expect(section("SOURCE_CLASS_HIERARCHY").description).toContain("Tier 3 professional-network evidence");
    expect(section("SOURCE_CLASS_HIERARCHY").description).toContain("Tier 4 public community/social signals");
    expect(section("SOURCE_CLASS_HIERARCHY").instructions).toContain("Weight sources by authority");
    expect(entry().validationRules?.map((rule) => rule.rule)).toContain("source_class_hierarchy_and_weighting_required");
  });

  it("47. supports official provider discovery without overclaiming individual Support Coordinator coverage", () => {
    expect(section("OFFICIAL_PROVIDER_DISCOVERY").description).toContain("Official NDIS/provider-register discovery");
    expect(section("OFFICIAL_PROVIDER_DISCOVERY").description).toContain("registered provider organisations");
    expect(section("OFFICIAL_PROVIDER_DISCOVERY").instructions).toContain("Distinguish registered organisation");
    expect(section("OFFICIAL_PROVIDER_DISCOVERY").instructions).toContain("individual Support Coordinator");
  });

  it("48. keeps the supply funnel evidence-based at every stage", () => {
    expect(section("MARKET_SUPPLY_FUNNEL").description).toContain("providers publicly accepting referrals");
    expect(section("MARKET_SUPPLY_FUNNEL").description).toContain("apparently capable of serving the defined cohort");
    expect(section("MARKET_SUPPLY_FUNNEL").instructions).toContain("Each funnel stage requires evidence");
  });

  it("49. expands competitor footprint intelligence beyond websites", () => {
    expect(section("COMPETITOR_FOOTPRINT_INTELLIGENCE").description).toContain("LinkedIn organisational footprint");
    expect(section("COMPETITOR_FOOTPRINT_INTELLIGENCE").description).toContain("job advertisements");
    expect(section("COMPETITOR_FOOTPRINT_INTELLIGENCE").description).toContain("partnership announcements");
    expect(section("COMPETITOR_FOOTPRINT_INTELLIGENCE").instructions).toContain("OBSERVED SIGNAL");
  });

  it("50. formalises referral ecosystem mapping", () => {
    expect(section("REFERRAL_ECOSYSTEM_MAP").description).toContain("Specialist Support Coordinators");
    expect(section("REFERRAL_ECOSYSTEM_MAP").description).toContain("Disability Liaison Officers");
    expect(section("REFERRAL_ECOSYSTEM_MAP").description).toContain("forensic mental health pathways");
    expect(section("REFERRAL_ECOSYSTEM_MAP").instructions).toContain("Derive node relevance");
    expect(entry().validationRules?.map((rule) => rule.rule)).toContain("referral_ecosystem_mapping_uses_public_professional_evidence_ethically");
  });

  it("51. represents ecosystem entities without creating personal dossiers", () => {
    expect(section("ECOSYSTEM_ENTITY_STRUCTURE").description).toContain("entity/person");
    expect(section("ECOSYSTEM_ENTITY_STRUCTURE").description).toContain("tenant relationship status only where internal CRM/relationship evidence exists");
    expect(section("ECOSYSTEM_ENTITY_STRUCTURE").instructions).toContain("Do not create personal dossiers");
    expect(section("ECOSYSTEM_ENTITY_STRUCTURE").instructions).toContain("infer tenant relationship from public professional presence");
  });

  it("52. represents hospital and health referral pathways without outreach", () => {
    expect(section("HOSPITAL_HEALTH_REFERRAL_PATHWAYS").description).toContain("Disability Liaison Officers");
    expect(section("HOSPITAL_HEALTH_REFERRAL_PATHWAYS").description).toContain("forensic mental health transition");
    expect(section("HOSPITAL_HEALTH_REFERRAL_PATHWAYS").instructions).toContain("before needing the relevant NDIS service");
    expect(section("HOSPITAL_HEALTH_REFERRAL_PATHWAYS").instructions).toContain("Do not initiate contact");
  });

  it("53. supports public demand-signal discovery with duplicate and currentness discipline", () => {
    expect(section("PUBLIC_DEMAND_SIGNAL_DISCOVERY").description).toContain("seeking SIL provider");
    expect(section("PUBLIC_DEMAND_SIGNAL_DISCOVERY").description).toContain("hospital discharge");
    expect(section("PUBLIC_DEMAND_SIGNAL_DISCOVERY").instructions).toContain("not a permanent keyword list");
    expect(section("PUBLIC_DEMAND_SIGNAL_DISCOVERY").instructions).toContain("duplication risk");
  });

  it("54. treats social signals as weak unless triangulated", () => {
    expect(section("SOCIAL_SIGNAL_DISCIPLINE").description).toContain("reposts");
    expect(section("SOCIAL_SIGNAL_DISCIPLINE").description).toContain("source date");
    expect(section("SOCIAL_SIGNAL_DISCIPLINE").instructions).toContain("One social-media post is not market demand");
    expect(section("SOCIAL_SIGNAL_DISCIPLINE").instructions).toContain("do not count reposts");
    expect(entry().validationRules?.map((rule) => rule.rule)).toContain("social_and_public_demand_signals_require_independence_and_triangulation");
  });

  it("55. aggregates demand signals without converting them into revenue forecasts", () => {
    expect(section("DEMAND_SIGNAL_AGGREGATION").description).toContain("support ratio");
    expect(section("DEMAND_SIGNAL_AGGREGATION").instructions).toContain("Aggregate only independent");
    expect(section("DEMAND_SIGNAL_AGGREGATION").instructions).toContain("do not convert it automatically into a revenue forecast");
  });

  it("56. supports housing, SDA and SIL marketplace intelligence with vacancy currentness", () => {
    expect(section("HOUSING_SDA_SIL_MARKETPLACE_INTELLIGENCE").description).toContain("SDA listings");
    expect(section("HOUSING_SDA_SIL_MARKETPLACE_INTELLIGENCE").description).toContain("listing age");
    expect(section("HOUSING_SDA_SIL_MARKETPLACE_INTELLIGENCE").instructions).toContain("advertised availability at retrieval time");
    expect(section("HOUSING_SDA_SIL_MARKETPLACE_INTELLIGENCE").instructions).toContain("not proof of current actual capacity");
  });

  it("57. handles vacancy duration and relisting without inventing explanations", () => {
    expect(section("VACANCY_DURATION_RELISTING").description).toContain("continued availability");
    expect(section("VACANCY_DURATION_RELISTING").description).toContain("participant-profile restriction");
    expect(section("VACANCY_DURATION_RELISTING").instructions).toContain("Do not decide which explanation is true");
  });

  it("58. treats workforce footprint and job ads as triangulated signals", () => {
    expect(section("WORKFORCE_FOOTPRINT_AND_JOB_AD_INTELLIGENCE").description).toContain("Behaviour Support Practitioners");
    expect(section("WORKFORCE_FOOTPRINT_AND_JOB_AD_INTELLIGENCE").description).toContain("repeated SIL support-worker recruitment");
    expect(section("WORKFORCE_FOOTPRINT_AND_JOB_AD_INTELLIGENCE").instructions).toContain("not absence of capability");
    expect(section("WORKFORCE_FOOTPRINT_AND_JOB_AD_INTELLIGENCE").instructions).toContain("signals requiring triangulation");
    expect(entry().validationRules?.map((rule) => rule.rule)).toContain("vacancy_workforce_and_job_ad_signals_not_capacity_proof");
  });

  it("59. represents workforce constraints without absorbing workforce planning", () => {
    expect(section("WORKFORCE_CONSTRAINT_ANALYSIS").description).toContain("provider recruitment activity");
    expect(section("WORKFORCE_CONSTRAINT_ANALYSIS").instructions).toContain("DEMAND_EXISTS_BUT_WORKFORCE_CONSTRAINED");
    expect(section("WORKFORCE_CONSTRAINT_ANALYSIS").instructions).toContain("without absorbing workforce planning methodology");
  });

  it("60. adds source weighting, market matrix and graph reasoning without new subsystems", () => {
    expect(section("SOURCE_WEIGHTING").description).toContain("professional-network observations");
    expect(section("SOURCE_WEIGHTING").instructions).toContain("Do not create a universal numerical scoring system");
    expect(section("MARKET_INTELLIGENCE_MATRIX").description).toContain("duplication risk");
    expect(section("MARKET_INTELLIGENCE_MATRIX").instructions).toContain("not a new database");
    expect(section("MARKET_GRAPH_REASONING").description).toContain("participant need");
    expect(section("MARKET_GRAPH_REASONING").instructions).toContain("Do not create a graph database");
  });

  it("61. protects privacy, access controls and outreach boundaries", () => {
    expect(section("PRIVACY_ETHICAL_INTELLIGENCE_BOUNDARY").description).toContain("private groups");
    expect(section("PRIVACY_ETHICAL_INTELLIGENCE_BOUNDARY").instructions).toContain("Do not build personal dossiers");
    expect(section("PRIVACY_ETHICAL_INTELLIGENCE_BOUNDARY").instructions).toContain("bypass authentication");
    expect(section("APPROVAL_AND_EXECUTION_LIMITS").description).toContain("LinkedIn message");
    expect(section("APPROVAL_AND_EXECUTION_LIMITS").instructions).toContain("does not approve service expansion");
    expect(entry().validationRules?.map((rule) => rule.rule)).toContain("market_intelligence_not_outreach_or_scraping");
  });

  it("62. exposes strengthened ecosystem evidence source types and restrictions", () => {
    expect(entry().evidenceContract?.allowedSourceTypes).toEqual(expect.arrayContaining([
      "ndis_provider_finder",
      "ndis_commission_provider_registration",
      "abs_dataset",
      "public_health_directory",
      "provider_vacancy_page",
      "housing_marketplace_listing",
      "job_advertisement",
      "professional_network_profile",
      "support_coordinator_organisation_page",
      "hospital_directory",
      "public_social_group_signal",
      "demand_signal_aggregate",
      "vacancy_duration_record",
      "workforce_footprint_signal",
      "tender_procurement_notice",
      "community_advocacy_source",
    ]));
    expect(entry().evidenceContract?.restrictedSourceTypes).toEqual(expect.arrayContaining([
      "single_social_post_market_demand",
      "private_group",
      "authentication_bypassed_source",
      "personal_dossier",
      "private_contact_information",
      "covert_monitoring_signal",
    ]));
  });

  it("63. keeps accounting unchanged after strengthening", () => {
    expect(BLUEPRINT_REGISTRY).toHaveLength(75);
    expect(methodPendingCodes()).toHaveLength(0);
    expect(compatibilityRoutes()).toHaveLength(1);
    expect(BLUEPRINT_REGISTRY.length - methodPendingCodes().length - compatibilityRoutes().length).toBe(74);
  });
});
