import { describe, expect, it } from "vitest";
import {
  BLUEPRINT_REGISTRY,
  LEGACY_CODE_MAP,
  getRegistryEntry,
  resolveRegistryCodeForNewWork,
  resolveRegistryProfessionalOwner,
} from "../services/blueprintRegistry.js";
import { resolveIntent } from "../services/blueprintIntentMap.js";

const CANONICAL_CODE = "regulatory_change_impact_assessment";
const LEGACY_CODE = "regulatory_change_impact";

function entry(code = CANONICAL_CODE) {
  const blueprint = getRegistryEntry(code);
  if (!blueprint) throw new Error(`Missing registry entry: ${code}`);
  return blueprint;
}

function sections(code = CANONICAL_CODE) {
  return entry(code).sections ?? [];
}

function sectionCodes(code = CANONICAL_CODE) {
  return sections(code).map((section) => section.sectionCode);
}

function allText(code: string) {
  const blueprint = entry(code);
  return JSON.stringify({
    title: blueprint.title,
    purpose: blueprint.purpose,
    primaryDeliverable: blueprint.primaryDeliverable,
    requiredApprovals: blueprint.requiredApprovals,
    validationRules: blueprint.validationRules,
    successCriteria: blueprint.successCriteria,
    outputTypes: blueprint.outputTypes,
    sections: blueprint.sections,
    evidenceContract: blueprint.evidenceContract,
    deliverableContract: blueprint.deliverableContract,
    supportingSpecialists: blueprint.supportingSpecialists,
  });
}

function methodPendingCodes() {
  return BLUEPRINT_REGISTRY
    .filter((blueprint) => blueprint.requiredApprovals?.human_professional_method_owner)
    .map((blueprint) => blueprint.code);
}

describe("Sprint 34L.36 regulatory change impact rationalisation", () => {
  it("1. keeps the canonical regulatory change impact assessment professionally complete", () => {
    expect(entry(CANONICAL_CODE).title).toBe("Regulatory Change Impact & Readiness Assessment");
    expect(entry(CANONICAL_CODE).maturityState).toBe("production_ready");
    expect(sectionCodes(CANONICAL_CODE)).toContain("EXECUTIVE_REGULATORY_CHANGE_POSITION");
    expect(sectionCodes(CANONICAL_CODE)).toContain("EFFECTIVENESS_VERIFICATION");
    expect(entry(CANONICAL_CODE).requiredApprovals).not.toHaveProperty("human_professional_method_owner");
    expect(entry(CANONICAL_CODE).sections?.[0]?.sectionCode).not.toBe("USER_DEFINITION_REQUIRED_METHOD");
  });

  it("2. does not change the canonical professional method into a compatibility stub", () => {
    expect(sectionCodes(CANONICAL_CODE)).toContain("CHANGE_SCOPE");
    expect(sectionCodes(CANONICAL_CODE)).toContain("APPLICABILITY");
    expect(sectionCodes(CANONICAL_CODE)).toContain("GAP_ANALYSIS");
    expect(sectionCodes(CANONICAL_CODE)).toContain("REQUIRED_ACTIONS");
    expect(sectionCodes(CANONICAL_CODE)).not.toContain("LEGACY_COMPATIBILITY_ROUTE");
  });

  it("3. identifies regulatory_change_impact as legacy compatibility rather than independent methodology", () => {
    expect(entry(LEGACY_CODE).title).toContain("Legacy Compatibility Route");
    expect(entry(LEGACY_CODE).purpose).toContain(CANONICAL_CODE);
    expect(sectionCodes(LEGACY_CODE)).toEqual(["LEGACY_COMPATIBILITY_ROUTE"]);
    expect(entry(LEGACY_CODE).successCriteria).toEqual(expect.arrayContaining([
      "Legacy identifier remains resolvable",
      "New regulatory-change impact work canonicalises to regulatory_change_impact_assessment",
      "Historical records are not rewritten",
    ]));
  });

  it("4. does not copy the canonical professional method into the legacy duplicate", () => {
    expect(sectionCodes(LEGACY_CODE)).not.toContain("EXECUTIVE_REGULATORY_CHANGE_POSITION");
    expect(sectionCodes(LEGACY_CODE)).not.toContain("CHANGE_SCOPE");
    expect(sectionCodes(LEGACY_CODE)).not.toContain("GAP_ANALYSIS");
    expect(sectionCodes(LEGACY_CODE)).not.toContain("EFFECTIVENESS_VERIFICATION");
    expect(allText(LEGACY_CODE)).toContain("Do not execute, maintain or copy an independent regulatory-change impact methodology here");
  });

  it("5. removes the old method-pending markers from the legacy duplicate", () => {
    expect(sectionCodes(LEGACY_CODE)).not.toContain("USER_DEFINITION_REQUIRED_METHOD");
    expect(entry(LEGACY_CODE).requiredApprovals).not.toHaveProperty("human_professional_method_owner");
    expect(allText(LEGACY_CODE)).not.toContain("USER_DEFINITION_REQUIRED_METHOD");
    expect(methodPendingCodes()).not.toContain(LEGACY_CODE);
  });

  it("6. routes governance and compliance intents to the same canonical Blueprint", () => {
    expect(resolveIntent("governance.regulatory_change_impact")).toMatchObject({
      family: "policy",
      mode: "impact_assessment",
      code: CANONICAL_CODE,
    });
    expect(resolveIntent("compliance.impact_assessment")).toMatchObject({
      family: "policy",
      mode: "impact_assessment",
      code: CANONICAL_CODE,
    });
  });

  it("7. prevents identical new intent-based requests splitting between two methods", () => {
    const routedCodes = [
      resolveIntent("governance.regulatory_change_impact")?.code,
      resolveIntent("compliance.impact_assessment")?.code,
    ];
    expect(new Set(routedCodes)).toEqual(new Set([CANONICAL_CODE]));
  });

  it("8. canonicalises direct new-work resolution of the legacy code", () => {
    expect(LEGACY_CODE_MAP[LEGACY_CODE]).toBe(CANONICAL_CODE);
    expect(resolveRegistryCodeForNewWork(LEGACY_CODE)).toBe(CANONICAL_CODE);
    expect(resolveRegistryCodeForNewWork(CANONICAL_CODE)).toBe(CANONICAL_CODE);
  });

  it("9. keeps the historical legacy identifier resolvable", () => {
    expect(entry(LEGACY_CODE).code).toBe(LEGACY_CODE);
    expect(entry(LEGACY_CODE).blueprintFamily).toBe("compliance");
    expect(entry(LEGACY_CODE).supportedModes).toEqual(["impact_assessment"]);
  });

  it("10. does not introduce historical-data migration behaviour into the registry", () => {
    expect(entry(LEGACY_CODE).purpose).toContain("historical regulatory-change impact references");
    expect(entry(LEGACY_CODE).successCriteria).toContain("Historical records are not rewritten");
    expect(allText(LEGACY_CODE)).not.toContain("migrate historical records");
  });

  it("11. keeps canonical professional ownership with Policy Governance", () => {
    expect(resolveRegistryProfessionalOwner(entry(CANONICAL_CODE))).toBe("policy_governance_specialist");
    expect(entry(CANONICAL_CODE).supportingSpecialists).toEqual(["compliance_quality_manager", "knowledge_documentation_specialist"]);
  });

  it("12. does not preserve Compliance Quality as a second professional owner for the legacy route", () => {
    expect(resolveRegistryProfessionalOwner(entry(LEGACY_CODE))).toBe("policy_governance_specialist");
    expect(entry(LEGACY_CODE).supportingSpecialists).toEqual(["compliance_quality_manager", "knowledge_documentation_specialist"]);
  });

  it("13. keeps the canonical evidence contract authoritative", () => {
    expect(entry(CANONICAL_CODE).evidenceContract?.requiredEvidenceCategories).toEqual([
      "current_regulatory_source",
      "organisational_context",
      "current_practice_evidence",
    ]);
    expect(entry(LEGACY_CODE).evidenceContract).toBeUndefined();
  });

  it("14. keeps the canonical deliverable authoritative for new professional execution", () => {
    expect(entry(CANONICAL_CODE).deliverableContract?.primaryDeliverable).toBe("regulatory_change_impact_assessment");
    expect(entry(LEGACY_CODE).outputTypes).toEqual([CANONICAL_CODE]);
    expect(entry(LEGACY_CODE).deliverableContract?.prohibitedDeliverables).toEqual(expect.arrayContaining([
      "independent_regulatory_change_method",
      "legacy_regulatory_change_deliverable",
    ]));
  });

  it("15. preserves neighbouring regulatory lifecycle boundaries", () => {
    expect(getRegistryEntry("legislation_regulatory_review")?.title).toBe("Legislative & Regulatory Obligations Review");
    expect(getRegistryEntry("compliance_audit_readiness")?.title).toBe("Compliance Audit Readiness & Evidence Assurance Review");
    expect(sectionCodes(CANONICAL_CODE)).toContain("AFFECTED_ORGANISATIONAL_DOMAINS");
    expect(sectionCodes(LEGACY_CODE)).toEqual(["LEGACY_COMPATIBILITY_ROUTE"]);
  });

  it("16. keeps sibling method-pending Blueprints gated", () => {
    expect(methodPendingCodes()).toEqual(expect.arrayContaining([
    ]));
  });

  it("17. removes only the duplicate from genuine method-pending accounting", () => {
    expect(methodPendingCodes()).not.toContain(CANONICAL_CODE);
    expect(methodPendingCodes()).not.toContain(LEGACY_CODE);
    expect(methodPendingCodes()).toHaveLength(0);
  });

  it("18. keeps the registry entry count intact", () => {
    expect(BLUEPRINT_REGISTRY).toHaveLength(75);
    expect(BLUEPRINT_REGISTRY.filter((blueprint) => blueprint.code === LEGACY_CODE)).toHaveLength(1);
    expect(BLUEPRINT_REGISTRY.filter((blueprint) => blueprint.code === CANONICAL_CODE)).toHaveLength(1);
  });

  it("19. represents compatibility/rationalised count separately from canonical professional methods", () => {
    const compatibilityRoutes = BLUEPRINT_REGISTRY.filter((blueprint) =>
      blueprint.validationRules?.some((rule) => rule.rule === "legacy_regulatory_change_impact_routes_to_canonical_assessment"),
    );
    expect(compatibilityRoutes.map((blueprint) => blueprint.code)).toEqual([LEGACY_CODE]);
  });

  it("20. keeps canonical professional count semantics truthful", () => {
    const compatibilityCount = BLUEPRINT_REGISTRY.filter((blueprint) =>
      blueprint.validationRules?.some((rule) => rule.rule === "legacy_regulatory_change_impact_routes_to_canonical_assessment"),
    ).length;
    const genuinelyPendingCount = methodPendingCodes().length;
    expect(BLUEPRINT_REGISTRY.length - genuinelyPendingCount - compatibilityCount).toBe(74);
    expect(compatibilityCount).toBe(1);
  });

  it("21. proves the old duplicate is not represented as a second professional method", () => {
    expect(entry(LEGACY_CODE).validationRules?.map((rule) => rule.rule)).toEqual([
      "legacy_regulatory_change_impact_routes_to_canonical_assessment",
      "no_independent_regulatory_change_impact_method",
    ]);
    expect(entry(LEGACY_CODE).requiredLibraryKnowledge).toEqual(["regulatory_register", "quality_framework", "policy_register"]);
    expect(entry(LEGACY_CODE).mandatoryCitations).toEqual([]);
  });

  it("22. preserves the canonical assessment's duplicate boundary as compatibility, not pending review", () => {
    expect(entry(CANONICAL_CODE).validationRules?.map((rule) => rule.rule)).toContain("regulatory_change_impact_duplicate_boundary_preserved");
    expect(entry(CANONICAL_CODE).escalationRules).toEqual(expect.arrayContaining([
      expect.objectContaining({
        trigger: "legacy_regulatory_change_impact_requested",
        action: "resolve_to_regulatory_change_impact_assessment_without_duplicating_methodology",
      }),
    ]));
  });
});
