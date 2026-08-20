import { describe, expect, it } from "vitest";
import {
  BLUEPRINT_REGISTRY,
  getRegistryEntry,
  resolveRegistryProfessionalOwner,
} from "../services/blueprintRegistry.js";
import { resolveIntent } from "../services/blueprintIntentMap.js";

const CODE = "complaints_review_response";
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

describe("Sprint 34L.47 complaints review response method", () => {
  it("1. removes USER_DEFINITION_REQUIRED_METHOD from complaints response", () => {
    expect(sectionCodes()).not.toContain("USER_DEFINITION_REQUIRED_METHOD");
    expect(sections()[0]?.sectionCode).toBe("COMPLAINT_IDENTITY_AND_INTAKE");
  });

  it("2. removes human_professional_method_owner from complaints response", () => {
    expect(entry().requiredApprovals).not.toHaveProperty("human_professional_method_owner");
    expect(methodPendingCodes()).not.toContain(CODE);
  });

  it("3. uses the approved complaint review resolution response title", () => {
    expect(entry().title).toBe("Complaint Review, Resolution & Response Assessment");
    expect(entry().purpose).toContain("issue-by-issue");
    expect(entry().purpose).toContain("register");
    expect(entry().primaryDeliverable).toBe("Complaint Review, Resolution & Response Assessment");
  });

  it("4. preserves CQM ownership and complaint approval gates", () => {
    expect(resolveRegistryProfessionalOwner(entry())).toBe("compliance_quality_manager");
    expect(entry().supportingSpecialists).toEqual([
      "incident_safeguarding_specialist",
      "executive_assistant",
      "service_delivery_coordinator",
      "knowledge_documentation_specialist",
    ]);
    expect(entry().requiredApprovals).toMatchObject({
      compliance_quality_owner: true,
      send_authority_owner: true,
    });
  });

  it("5. preserves complaints response routing", () => {
    expect(resolveIntent("complaints.response")).toMatchObject({ code: CODE });
  });

  it("6. distinguishes feedback complaint compliment and grievance", () => {
    expect(section("FEEDBACK_COMPLAINT_GRIEVANCE_CLASSIFICATION").description).toContain("Feedback");
    expect(section("FEEDBACK_COMPLAINT_GRIEVANCE_CLASSIFICATION").description).toContain("compliment");
    expect(section("FEEDBACK_COMPLAINT_GRIEVANCE_CLASSIFICATION").description).toContain("grievance");
    expect(section("FEEDBACK_COMPLAINT_GRIEVANCE_CLASSIFICATION").instructions).toContain("not proof");
  });

  it("7. preserves the original complaint separately from professional decomposition", () => {
    expect(section("ORIGINAL_COMPLAINT_PRESERVATION").description).toContain("complainant wording");
    expect(section("ORIGINAL_COMPLAINT_PRESERVATION").description).toContain("requested outcome");
    expect(section("ORIGINAL_COMPLAINT_PRESERVATION").instructions).toContain("management narrative");
  });

  it("8. captures desired outcome without letting it decide findings", () => {
    expect(section("DESIRED_OUTCOME_AND_RESPONSE_SCOPE").description).toContain("apology");
    expect(section("DESIRED_OUTCOME_AND_RESPONSE_SCOPE").description).toContain("disciplinary action");
    expect(section("DESIRED_OUTCOME_AND_RESPONSE_SCOPE").instructions).toContain("does not determine findings");
  });

  it("9. makes the immediate safety gate mandatory before ordinary review", () => {
    expect(section("IMMEDIATE_RISK_AND_SAFETY_GATE").description).toContain("abuse");
    expect(section("IMMEDIATE_RISK_AND_SAFETY_GATE").description).toContain("restrictive practice");
    expect(section("IMMEDIATE_RISK_AND_SAFETY_GATE").instructions).toContain("before ordinary complaint analysis");
    expect(entry().validationRules?.map((rule) => rule.rule)).toContain("immediate_safety_gate_before_ordinary_analysis");
  });

  it("10. prevents complaint from automatically becoming incident", () => {
    expect(section("PARALLEL_PATHWAY_MATRIX").description).toContain("Service dissatisfaction");
    expect(section("PARALLEL_PATHWAY_MATRIX").description).toContain("safeguarding allegation");
    expect(section("PARALLEL_PATHWAY_MATRIX").instructions).toContain("may remain a complaint");
  });

  it("11. prevents complaint from automatically becoming investigation", () => {
    expect(section("PARALLEL_PATHWAY_MATRIX").description).toContain("repeated unresolved concern");
    expect(section("INVESTIGATION_DEPENDENCY_AND_OUTPUT_USE").instructions).toContain("Where a complaint requires formal investigation");
    expect(section("INVESTIGATION_DEPENDENCY_AND_OUTPUT_USE").instructions).toContain("Do not rerun");
  });

  it("12. supports multiple parallel pathways", () => {
    expect(section("PARALLEL_PATHWAY_MATRIX").description).toContain("staff conduct");
    expect(section("PARALLEL_PATHWAY_MATRIX").description).toContain("privacy complaint");
    expect(section("PARALLEL_PATHWAY_MATRIX").description).toContain("financial complaint");
  });

  it("13. reconciles complaint source evidence against complaint register", () => {
    expect(section("COMPLAINT_REGISTER_RECONCILIATION").description).toContain("Feedback and Complaints Register");
    expect(section("COMPLAINT_REGISTER_RECONCILIATION").description).toContain("corrective action");
    expect(section("COMPLAINT_REGISTER_RECONCILIATION").instructions).toContain("COMPLAINT_REGISTER_ENTRY_NOT_EVIDENCED");
    expect(entry().validationRules?.map((rule) => rule.rule)).toContain("complaint_register_reconciliation_required");
  });

  it("14. separates complaint evidence from register evidence", () => {
    expect(section("COMPLAINT_REGISTER_RECONCILIATION").instructions).toContain("Complaint email exists does not equal complaint registered");
    expect(entry().evidenceContract?.freshnessRules).toMatchObject({
      complaintEmailDoesNotProveRegisterEntry: true,
      acknowledgementDoesNotProveRegisterCompletion: true,
    });
  });

  it("15. represents the minimum complaint register dataset", () => {
    expect(section("COMPLAINT_REGISTER_RECONCILIATION").description).toContain("date received");
    expect(section("COMPLAINT_REGISTER_RECONCILIATION").description).toContain("persons involved");
    expect(section("COMPLAINT_REGISTER_RECONCILIATION").description).toContain("responsible officer");
    expect(section("COMPLAINT_REGISTER_RECONCILIATION").description).toContain("closure date");
  });

  it("16. represents timeliness and acknowledgement logic", () => {
    expect(section("TIMELINESS_AND_DELAY_REVIEW").description).toContain("acknowledgement due");
    expect(section("TIMELINESS_AND_DELAY_REVIEW").description).toContain("resolution target");
    expect(section("TIMELINESS_AND_DELAY_REVIEW").instructions).toContain("2 working days");
    expect(section("TIMELINESS_AND_DELAY_REVIEW").instructions).toContain("28 days");
  });

  it("17. represents accessibility advocacy and representation", () => {
    expect(section("ACCESSIBILITY_ADVOCACY_AND_REPRESENTATION").description).toContain("Easy English");
    expect(section("ACCESSIBILITY_ADVOCACY_AND_REPRESENTATION").description).toContain("guardian/nominee");
    expect(section("ACCESSIBILITY_ADVOCACY_AND_REPRESENTATION").instructions).toContain("without appropriate authority");
  });

  it("18. makes issue decomposition mandatory", () => {
    expect(section("ISSUE_DECOMPOSITION_AND_ISSUE_REGISTER").description).toContain("Distinct issue number");
    expect(section("ISSUE_DECOMPOSITION_AND_ISSUE_REGISTER").instructions).toContain("Issue decomposition is mandatory");
  });

  it("19. supports different findings for different issues", () => {
    expect(section("ISSUE_DECOMPOSITION_AND_ISSUE_REGISTER").description).toContain("finding");
    expect(section("ISSUE_DECOMPOSITION_AND_ISSUE_REGISTER").description).toContain("remedy/action");
    expect(section("ISSUE_DECOMPOSITION_AND_ISSUE_REGISTER").instructions).toContain("different outcomes");
  });

  it("20. keeps allegation distinct from fact", () => {
    expect(section("ALLEGATION_EVIDENCE_AND_CONTRADICTIONS").instructions).toContain("Allegation is not fact");
    expect(entry().validationRules?.map((rule) => rule.rule)).toContain("complaint_allegation_not_fact");
  });

  it("21. keeps respondent account distinct", () => {
    expect(section("EVIDENCE_DISCOVERY_AND_ROLES").description).toContain("respondent statements");
    expect(section("EVIDENCE_DISCOVERY_AND_ROLES").instructions).toContain("respondent account");
  });

  it("22. keeps documentary evidence distinct", () => {
    expect(section("EVIDENCE_DISCOVERY_AND_ROLES").description).toContain("case notes");
    expect(section("EVIDENCE_DISCOVERY_AND_ROLES").description).toContain("CCTV");
    expect(section("EVIDENCE_DISCOVERY_AND_ROLES").instructions).toContain("documentary evidence");
  });

  it("23. separates investigation finding from complaint outcome", () => {
    expect(section("EVIDENCE_DISCOVERY_AND_ROLES").instructions).toContain("investigation finding");
    expect(section("EVIDENCE_DISCOVERY_AND_ROLES").instructions).toContain("organisational position");
    expect(section("PROFESSIONAL_CONCLUSION").description).toContain("ISSUE_UNSUBSTANTIATED");
  });

  it("24. consumes investigation output rather than duplicating investigation", () => {
    expect(section("INVESTIGATION_DEPENDENCY_AND_OUTPUT_USE").description).toContain("evidence schedule");
    expect(section("INVESTIGATION_DEPENDENCY_AND_OUTPUT_USE").description).toContain("process gaps");
    expect(entry().validationRules?.map((rule) => rule.rule)).toContain("investigation_outputs_consumed_not_duplicated");
  });

  it("25. allows unsubstantiated allegation and process deficiency to coexist", () => {
    expect(section("SERVICE_PROCESS_DEFICIENCY_REVIEW").instructions).toContain("unsubstantiated");
    expect(section("SERVICE_PROCESS_DEFICIENCY_REVIEW").description).toContain("Documentation deficiency");
    expect(section("PROFESSIONAL_CONCLUSION").description).toContain("PROCESS_DEFICIENCY_IDENTIFIED");
  });

  it("26. prevents process deficiency from proving the allegation", () => {
    expect(section("SERVICE_PROCESS_DEFICIENCY_REVIEW").instructions).toContain("Process deficiency does not prove the allegation");
  });

  it("27. represents missing evidence and contradiction analysis", () => {
    expect(section("ALLEGATION_EVIDENCE_AND_CONTRADICTIONS").description).toContain("missing evidence");
    expect(section("ALLEGATION_EVIDENCE_AND_CONTRADICTIONS").description).toContain("record gaps");
  });

  it("28. represents procedural fairness", () => {
    expect(section("PROCEDURAL_FAIRNESS_AND_INDEPENDENCE").description).toContain("response opportunity");
    expect(section("PROCEDURAL_FAIRNESS_AND_INDEPENDENCE").description).toContain("adverse information");
    expect(entry().validationRules?.map((rule) => rule.rule)).toContain("procedural_fairness_before_adverse_final_finding");
  });

  it("29. urgent safeguarding is not delayed by procedural fairness", () => {
    expect(section("IMMEDIATE_RISK_AND_SAFETY_GATE").instructions).toContain("Procedural fairness does not delay urgent safety action");
  });

  it("30. interim action is not guilt", () => {
    expect(section("IMMEDIATE_RISK_AND_SAFETY_GATE").instructions).toContain("interim protective action is not a guilt");
    expect(section("PARTICIPANT_SAFETY_CHOICE_AND_INTERIM_ACTION").instructions).toContain("INTERIM PROTECTIVE ACTION");
  });

  it("31. represents investigator independence and conflict", () => {
    expect(section("PROCEDURAL_FAIRNESS_AND_INDEPENDENCE").description).toContain("conflict of interest");
    expect(section("PROCEDURAL_FAIRNESS_AND_INDEPENDENCE").instructions).toContain("must not investigate their own complaint");
  });

  it("32. represents participant safety and choice", () => {
    expect(section("PARTICIPANT_SAFETY_CHOICE_AND_INTERIM_ACTION").description).toContain("requested staff removal");
    expect(section("PARTICIPANT_SAFETY_CHOICE_AND_INTERIM_ACTION").description).toContain("choice and control");
    expect(section("PARTICIPANT_SAFETY_CHOICE_AND_INTERIM_ACTION").instructions).toContain("must not force continued contact");
  });

  it("33. represents service and process deficiency analysis", () => {
    expect(section("SERVICE_PROCESS_DEFICIENCY_REVIEW").description).toContain("communication failure");
    expect(section("SERVICE_PROCESS_DEFICIENCY_REVIEW").description).toContain("training need");
  });

  it("34. represents remedy and resolution options", () => {
    expect(section("REMEDY_RESOLUTION_AND_ACTIONS").description).toContain("apology");
    expect(section("REMEDY_RESOLUTION_AND_ACTIONS").description).toContain("mediation");
    expect(section("REMEDY_RESOLUTION_AND_ACTIONS").description).toContain("CAPA route");
  });

  it("35. distinguishes apology from admission", () => {
    expect(section("APOLOGY_ADMISSION_AND_RESPONSE_POSITION").description).toContain("Expression of empathy");
    expect(section("APOLOGY_ADMISSION_AND_RESPONSE_POSITION").description).toContain("formal admission");
    expect(section("APOLOGY_ADMISSION_AND_RESPONSE_POSITION").instructions).toContain("unsupported admissions");
  });

  it("36. makes complaint response issue-specific", () => {
    expect(section("ISSUE_BY_ISSUE_RESPONSE_STRUCTURE").description).toContain("issue-by-issue outcome");
    expect(section("ISSUE_BY_ISSUE_RESPONSE_STRUCTURE").instructions).toContain("Do not say only");
  });

  it("37. represents privacy and confidentiality", () => {
    expect(section("PRIVACY_CONFIDENTIALITY_AND_RECOURSE").description).toContain("worker personal information");
    expect(section("PRIVACY_CONFIDENTIALITY_AND_RECOURSE").instructions).toContain("not automatically every confidential record");
  });

  it("38. represents external recourse pathways with current authority", () => {
    expect(section("PRIVACY_CONFIDENTIALITY_AND_RECOURSE").description).toContain("external complaint pathways");
    expect(section("PRIVACY_CONFIDENTIALITY_AND_RECOURSE").instructions).toContain("External complaint escalation is not failure");
    expect(entry().externalAuthorityRequiredFor).toEqual(expect.arrayContaining(["external complaint pathway details"]));
  });

  it("39. requires complaint closure gate", () => {
    expect(section("CLOSURE_GATE_AND_REGISTER_RECONCILIATION").description).toContain("response approved");
    expect(section("CLOSURE_GATE_AND_REGISTER_RECONCILIATION").description).toContain("closure decision documented");
    expect(entry().validationRules?.map((rule) => rule.rule)).toContain("response_document_does_not_close_complaint");
  });

  it("40. response generation alone cannot close complaint", () => {
    expect(section("CLOSURE_GATE_AND_REGISTER_RECONCILIATION").instructions).toContain("A response document alone cannot close a complaint");
    expect(entry().deliverableContract?.prohibitedDeliverables).toEqual(expect.arrayContaining(["complaint_register_closure"]));
  });

  it("41. reconciles complaint register closure with outcomes and actions", () => {
    expect(section("CLOSURE_GATE_AND_REGISTER_RECONCILIATION").instructions).toContain("Compare response outcome");
    expect(section("CLOSURE_GATE_AND_REGISTER_RECONCILIATION").description).toContain("outstanding actions");
  });

  it("42. allows improvement actions to remain open after communication closure", () => {
    expect(section("REGISTER_INTEGRITY_AND_STATE_SEPARATION").description).toContain("communication closed");
    expect(section("REGISTER_INTEGRITY_AND_STATE_SEPARATION").description).toContain("improvement action open");
    expect(entry().evidenceContract?.freshnessRules).toMatchObject({
      correctiveActionAllocatedDoesNotProveCompleted: true,
    });
  });

  it("43. represents systemic improvement routing", () => {
    expect(section("CONTINUOUS_IMPROVEMENT_AND_BOUNDARIES").description).toContain("Recurring theme");
    expect(section("CONTINUOUS_IMPROVEMENT_AND_BOUNDARIES").description).toContain("systemic operational weakness");
    expect(section("PROFESSIONAL_CONCLUSION").description).toContain("SYSTEMIC_IMPROVEMENT_REQUIRED");
  });

  it("44. preserves CAPA boundary", () => {
    expect(section("CONTINUOUS_IMPROVEMENT_AND_BOUNDARIES").instructions).toContain("does not perform full CAPA");
    expect(entry().escalationRules).toEqual(expect.arrayContaining([
      expect.objectContaining({ trigger: "substantial_systemic_corrective_action_required" }),
    ]));
  });

  it("45. preserves incident investigation boundary", () => {
    expect(section("PROFESSIONAL_BOUNDARIES_AND_HANDOFFS").description).toContain("incident_investigation");
    expect(entry().escalationRules).toEqual(expect.arrayContaining([
      expect.objectContaining({ trigger: "incident_fact_finding_required" }),
    ]));
  });

  it("46. preserves safeguarding boundary", () => {
    expect(section("PROFESSIONAL_BOUNDARIES_AND_HANDOFFS").description).toContain("safeguarding_assessment");
    expect(entry().escalationRules).toEqual(expect.arrayContaining([
      expect.objectContaining({ trigger: "immediate_safeguarding_or_current_safety_risk" }),
    ]));
  });

  it("47. preserves reportable incident assessment boundary", () => {
    expect(section("PROFESSIONAL_BOUNDARIES_AND_HANDOFFS").description).toContain("reportable_incident_assessment");
    expect(entry().escalationRules).toEqual(expect.arrayContaining([
      expect.objectContaining({ trigger: "reportability_threshold_review_required" }),
    ]));
  });

  it("48. preserves workforce and disciplinary boundary", () => {
    expect(section("PROFESSIONAL_BOUNDARIES_AND_HANDOFFS").description).toContain("workforce/disciplinary methods");
    expect(entry().deliverableContract?.prohibitedDeliverables).toEqual(expect.arrayContaining(["disciplinary_decision"]));
  });

  it("49. preserves regulator response boundary", () => {
    expect(section("PROFESSIONAL_BOUNDARIES_AND_HANDOFFS").description).toContain("regulator_response_submission");
    expect(entry().escalationRules).toEqual(expect.arrayContaining([
      expect.objectContaining({ trigger: "regulator_formal_submission_required" }),
    ]));
  });

  it("50. preserves formal stakeholder correspondence boundary", () => {
    expect(section("PROFESSIONAL_BOUNDARIES_AND_HANDOFFS").description).toContain("formal_stakeholder_correspondence");
    expect(entry().escalationRules).toEqual(expect.arrayContaining([
      expect.objectContaining({ trigger: "general_stakeholder_correspondence_required" }),
    ]));
  });

  it("51. leaves no sibling pending Blueprints gated while programme accounting reaches zero", () => {
    expect(methodPendingCodes()).toEqual([]);
    expect(methodPendingCodes()).not.toContain(CODE);
    expect(compatibilityRoutes().map((blueprint) => blueprint.code)).toEqual(["regulatory_change_impact"]);
    expect(compatibilityRoutes()).toHaveLength(1);
    expect(BLUEPRINT_REGISTRY).toHaveLength(75);
    expect(methodPendingCodes()).toHaveLength(0);
    expect(BLUEPRINT_REGISTRY.length - methodPendingCodes().length - compatibilityRoutes().length).toBe(74);
  });
});
