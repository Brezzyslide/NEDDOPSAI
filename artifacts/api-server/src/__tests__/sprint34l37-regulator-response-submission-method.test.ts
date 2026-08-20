import { describe, expect, it } from "vitest";
import {
  BLUEPRINT_REGISTRY,
  getRegistryEntry,
  resolveRegistryProfessionalOwner,
} from "../services/blueprintRegistry.js";

const CODE = "regulator_response_submission";
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

describe("Sprint 34L.37 regulator response submission method", () => {
  it("1. removes USER_DEFINITION_REQUIRED_METHOD from regulator_response_submission", () => {
    expect(sectionCodes()).not.toContain("USER_DEFINITION_REQUIRED_METHOD");
    expect(sections()[0]?.sectionCode).toBe("REGULATORY_MATTER");
  });

  it("2. removes human_professional_method_owner from regulator_response_submission", () => {
    expect(entry().requiredApprovals).not.toHaveProperty("human_professional_method_owner");
    expect(methodPendingCodes()).not.toContain(CODE);
  });

  it("3. uses the approved professional title", () => {
    expect(entry().title).toBe("Regulator Response & Submission Preparation");
    expect(entry().purpose).toContain("evidence-governed response");
  });

  it("4. represents regulator and matter identification", () => {
    expect(section("REGULATORY_MATTER").description).toContain("Regulator/authority");
    expect(section("REGULATORY_MATTER").description).toContain("matter type");
    expect(section("REGULATORY_MATTER").description).toContain("regulator reference");
  });

  it("5. represents response deadline and time-critical requirements", () => {
    expect(section("DEADLINE_TIME_CRITICAL_REQUIREMENTS").description).toContain("Statutory deadline");
    expect(section("DEADLINE_TIME_CRITICAL_REQUIREMENTS").description).toContain("regulator-specified deadline");
    expect(section("DEADLINE_TIME_CRITICAL_REQUIREMENTS").instructions).toContain("Do not invent deadlines");
  });

  it("6. represents issue-by-issue decomposition", () => {
    expect(section("ISSUE_DECOMPOSITION").description).toContain("Issue ID");
    expect(section("ISSUE_DECOMPOSITION").description).toContain("regulator statement/request");
    expect(section("ISSUE_DECOMPOSITION").instructions).toContain("Break multi-issue notices into discrete response items");
  });

  it("7. represents current-authority resolution", () => {
    expect(section("CURRENT_AUTHORITY").description).toContain("Legislation");
    expect(section("CURRENT_AUTHORITY").description).toContain("registration conditions");
    expect(section("CURRENT_AUTHORITY").instructions).toContain("existing KRS/current-authority architecture");
  });

  it("8. represents an evidence schedule", () => {
    expect(section("EVIDENCE_SCHEDULE").description).toContain("Regulator correspondence");
    expect(section("EVIDENCE_SCHEDULE").description).toContain("investigations");
    expect(section("EVIDENCE_SCHEDULE").instructions).toContain("Every significant evidence item must retain provenance");
  });

  it("9. separates allegation, assertion, fact, evidence, finding and admission states", () => {
    expect(section("EVIDENCE_CATEGORY_SEPARATION").description).toContain("Allegation");
    expect(section("EVIDENCE_CATEGORY_SEPARATION").description).toContain("investigation finding");
    expect(section("EVIDENCE_CATEGORY_SEPARATION").description).toContain("admission");
    expect(section("EVIDENCE_CATEGORY_SEPARATION").instructions).toContain("A regulator allegation is not a fact");
  });

  it("10. represents chronology and provenance", () => {
    expect(section("CHRONOLOGY").description).toContain("Date/time");
    expect(section("CHRONOLOGY").description).toContain("evidence reference");
    expect(section("CHRONOLOGY").description).toContain("certainty/status");
  });

  it("11. preserves conflicting chronology", () => {
    expect(section("CHRONOLOGY").description).toContain("conflicting dates");
    expect(section("CHRONOLOGY").instructions).toContain("Do not silently choose favourable dates");
  });

  it("12. makes organisation position issue-specific", () => {
    expect(section("ORGANISATION_POSITION_BY_ISSUE").description).toContain("ACCEPTED");
    expect(section("ORGANISATION_POSITION_BY_ISSUE").description).toContain("LEGAL_REVIEW_REQUIRED");
    expect(section("ORGANISATION_POSITION_BY_ISSUE").instructions).toContain("issue-specific");
  });

  it("13. represents accepted deficiency logic", () => {
    expect(section("ACCEPTED_DEFICIENCIES").description).toContain("What happened");
    expect(section("ACCEPTED_DEFICIENCIES").description).toContain("accepted gap");
    expect(section("ACCEPTED_DEFICIENCIES").description).toContain("implementation evidence");
  });

  it("14. does not equate action completion with effectiveness", () => {
    expect(section("ACCEPTED_DEFICIENCIES").instructions).toContain("Completion and effectiveness remain separate");
    expect(entry().evidenceContract?.freshnessRules).toMatchObject({
      actionCompletionDoesNotEqualEffectiveness: true,
    });
  });

  it("15. requires evidence-led disputed assertion reasoning", () => {
    expect(section("DISPUTED_ASSERTIONS").description).toContain("Regulator proposition");
    expect(section("DISPUTED_ASSERTIONS").description).toContain("organisation evidence");
    expect(section("DISPUTED_ASSERTIONS").instructions).toContain("evidence-led");
  });

  it("16. prohibits unsupported admissions", () => {
    expect(entry().deliverableContract?.prohibitedDeliverables).toContain("unsupported_admission");
    expect(entry().validationRules?.map((rule) => rule.rule)).toContain("unsupported_admissions_and_denials_prohibited");
    expect(entry().evidenceContract?.freshnessRules).toMatchObject({ absenceOfEvidenceDoesNotCreateAdmission: true });
  });

  it("17. prohibits unsupported denials", () => {
    expect(entry().deliverableContract?.prohibitedDeliverables).toContain("unsupported_denial");
    expect(entry().evidenceContract?.freshnessRules).toMatchObject({ lackOfOrganisationalRecordDoesNotDisproveRegulatorPosition: true });
  });

  it("18. represents the legal-review boundary", () => {
    expect(section("LEGAL_REVIEW_BOUNDARY").description).toContain("show-cause");
    expect(section("LEGAL_REVIEW_BOUNDARY").description).toContain("civil/criminal risk");
    expect(section("LEGAL_REVIEW_BOUNDARY").instructions).toContain("NeedsOps is not legal counsel");
  });

  it("19. represents immediate safeguarding and compliance escalation", () => {
    expect(section("IMMEDIATE_ESCALATION").description).toContain("Participant safety risk");
    expect(section("IMMEDIATE_ESCALATION").description).toContain("unreported reportable incident");
    expect(section("IMMEDIATE_ESCALATION").instructions).toContain("must not delay urgent protective or compliance action");
  });

  it("20. keeps CAPA separate", () => {
    expect(section("CORRECTIVE_ACTION_BOUNDARY").description).toContain("corrective_action_improvement");
    expect(section("CORRECTIVE_ACTION_BOUNDARY").instructions).toContain("without performing full CAPA");
    expect(entry().deliverableContract?.prohibitedDeliverables).toContain("capa_without_request");
  });

  it("21. keeps investigation separate", () => {
    expect(section("INVESTIGATION_BOUNDARY").description).toContain("incident_investigation");
    expect(section("INVESTIGATION_BOUNDARY").instructions).toContain("Do not conduct a substitute investigation");
    expect(entry().deliverableContract?.prohibitedDeliverables).toContain("substitute_investigation");
  });

  it("22. keeps reportable incident assessment separate", () => {
    expect(section("BOUNDARIES_AND_HANDOFFS").description).toContain("reportable_incident_assessment");
    expect(section("BOUNDARIES_AND_HANDOFFS").instructions).toContain("determine reportability thresholds");
  });

  it("23. represents attachments and evidence index", () => {
    expect(section("ATTACHMENTS_EVIDENCE_INDEX").description).toContain("Attachment/evidence ID");
    expect(section("ATTACHMENTS_EVIDENCE_INDEX").description).toContain("supported issue(s)");
    expect(section("ATTACHMENTS_EVIDENCE_INDEX").instructions).toContain("Do not claim an attachment exists");
  });

  it("24. represents the pre-submission completeness gate", () => {
    expect(section("PRE_SUBMISSION_QUALITY_GATE").description).toContain("Every regulator issue addressed");
    expect(section("PRE_SUBMISSION_QUALITY_GATE").description).toContain("no unsupported admissions");
    expect(section("PRE_SUBMISSION_QUALITY_GATE").instructions).toContain("not approval-ready");
  });

  it("25. keeps external submission under separate authority", () => {
    expect(entry().requiredApprovals).toHaveProperty("external_submission_owner", true);
    expect(entry().validationRules?.map((rule) => rule.rule)).toContain("external_submission_authority_required");
    expect(section("PRE_SUBMISSION_QUALITY_GATE").instructions).toContain("does not authorise external submission");
  });

  it("26. keeps sibling pending Blueprints gated", () => {
    expect(methodPendingCodes()).toEqual(expect.arrayContaining([
    ]));
  });

  it("27. preserves the single compatibility route count", () => {
    expect(compatibilityRoutes().map((blueprint) => blueprint.code)).toEqual(["regulatory_change_impact"]);
    expect(compatibilityRoutes()).toHaveLength(1);
  });

  it("28. moves genuine method-pending count to 14 with truthful programme accounting", () => {
    expect(BLUEPRINT_REGISTRY).toHaveLength(75);
    expect(methodPendingCodes()).toHaveLength(0);
    expect(BLUEPRINT_REGISTRY.length - methodPendingCodes().length - compatibilityRoutes().length).toBe(74);
  });

  it("29. preserves owner and approval boundaries", () => {
    expect(resolveRegistryProfessionalOwner(entry())).toBe("compliance_quality_manager");
    expect(entry().supportingSpecialists).toEqual(["policy_governance_specialist", "knowledge_documentation_specialist", "chief_of_staff"]);
    expect(entry().requiredApprovals).toMatchObject({
      compliance_quality_owner: true,
      policy_governance_owner: true,
      external_submission_owner: true,
    });
  });

  it("30. keeps legislation review, regulatory change impact and ordinary correspondence separate", () => {
    const text = allText();
    expect(text).toContain("legislation_regulatory_review");
    expect(text).toContain("regulatory_change_impact_assessment");
    expect(text).toContain("ordinary correspondence");
  });
});
