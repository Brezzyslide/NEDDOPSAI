import { describe, expect, it } from "vitest";
import {
  BLUEPRINT_REGISTRY,
  getRegistryEntry,
  resolveRegistryProfessionalOwner,
} from "../services/blueprintRegistry.js";
import { enforceEvidenceContract } from "../services/blueprintContractService.js";
import { evaluateWorkerProfileAuthority } from "../services/executionActionService.js";
import { getWorkerProfileByCode } from "../lib/workerProfileRegistry.js";
import {
  validateBlueprintRuntimeCompletion,
  type BlueprintRuntimeValidationInput,
} from "../services/blueprintRuntimeValidationService.js";
import type {
  BlueprintExecutionContract,
  BlueprintSection,
  WorkBlueprint,
  WorkTemplate,
} from "../services/workBlueprintService.js";

const NOW = new Date("2026-08-19T00:00:00Z");
const COMPLIANCE_CODE = "workforce_compliance_assessment";

function blueprintFromRegistry(code = COMPLIANCE_CODE): WorkBlueprint {
  const entry = getRegistryEntry(code);
  if (!entry) throw new Error(`Missing registry entry: ${code}`);

  return {
    id: `bp-${code}`,
    organizationId: null,
    code: entry.code,
    title: entry.title,
    version: "1.0.0",
    blueprintFamily: entry.blueprintFamily,
    supportedModes: entry.supportedModes,
    maturityState: entry.maturityState,
    ownerType: entry.ownerType,
    purpose: entry.purpose,
    primaryDeliverable: entry.primaryDeliverable,
    deliverableContract: entry.deliverableContract ?? null,
    evidenceContract: entry.evidenceContract ?? null,
    permittedOrgOverrides: entry.permittedOrgOverrides ?? {},
    defaultTemplateId: entry.defaultTemplateId ?? null,
    templateRequired: entry.templateRequired ?? entry.deliverableContract?.templateRequired ?? false,
    allowedOrgTemplateOverride: entry.allowedOrgTemplateOverride ?? false,
    templateVersionPolicy: entry.templateVersionPolicy ?? "pin_at_execution",
    status: "published",
    objective: entry.purpose,
    primarySpecialist: entry.futureOwnerRoleCode ?? "owner_unresolved",
    supportingSpecialists: entry.supportingSpecialists ?? [],
    requiredLibraryKnowledge: entry.requiredLibraryKnowledge ?? [],
    requiredEntityKnowledge: entry.requiredEntityKnowledge ?? {},
    requiredMemories: [],
    requiredApprovals: entry.requiredApprovals ?? {},
    validationRules: entry.validationRules ?? [],
    qualityRules: entry.qualityRules ?? [],
    successCriteria: entry.successCriteria ?? [],
    outputTypes: entry.outputTypes ?? [entry.primaryDeliverable],
    escalationRules: entry.escalationRules ?? [],
    mandatoryCitations: entry.mandatoryCitations ?? [],
    isBuiltIn: true,
    isActive: true,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function sectionsFromRegistry(code = COMPLIANCE_CODE): BlueprintSection[] {
  const entry = getRegistryEntry(code);
  if (!entry?.sections) return [];
  return entry.sections.map((section, index) => ({
    id: `section-${code}-${section.sectionCode}`,
    blueprintId: `bp-${code}`,
    sectionCode: section.sectionCode,
    title: section.title,
    description: section.description,
    instructions: section.instructions,
    required: section.required,
    minimumContentExpectation: section.minimumContentExpectation,
    evidenceRequirements: section.evidenceRequirements ?? {},
    allowedSourceTypes: section.allowedSourceTypes ?? [],
    prohibitedAssumptions: section.prohibitedAssumptions ?? [],
    validationRules: section.validationRules ?? [],
    qualityCriteria: section.qualityCriteria ?? [],
    sortOrder: section.sortOrder ?? index + 1,
    createdAt: NOW,
    updatedAt: NOW,
  }));
}

const template: WorkTemplate = {
  id: "tpl-workforce-compliance",
  organizationId: "org-1",
  ownerType: "organisation_owned",
  code: "worker_compliance_credential_deployment_eligibility_assessment_template",
  title: "Worker Compliance, Credential & Deployment Eligibility Assessment",
  version: "1.0.0",
  status: "published",
  maturityState: "production_ready",
  templateType: "docx",
  sourceFileReference: "org://templates/worker-compliance-credential-deployment-eligibility-assessment.docx",
  mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  mergeFieldSchema: {},
  createdAt: NOW,
  updatedAt: NOW,
};

function contractFor(templateOverride: WorkTemplate | null = template): BlueprintExecutionContract {
  return {
    blueprint: blueprintFromRegistry(),
    sections: sectionsFromRegistry(),
    template: templateOverride,
    mode: "eligibility_review",
  };
}

function contentFor(): string {
  return sectionsFromRegistry()
    .map((section) => `## ${section.sectionCode}
This section is populated with verified worker identity, employment record, credential record, training record, qualification record, NDIS Worker Screening, NDIS Worker Orientation Module, First Aid, CPR, WWCC applicability, service requirement, participant-specific competency, current authority, evidence verification, currentness, expiry, restrictions, conditions, contradictions, compliance gaps, deployment eligibility, roster eligibility, remediation, learning referral, renewal monitoring, approval and unresolved gaps.`)
    .join("\n\n");
}

function evidencePack(categories: string[]) {
  return {
    executionId: "exec-34l19",
    organisationId: "org-34l19",
    resolvedAt: NOW,
    totalChunks: categories.length,
    chunks: categories.map((category, index) => ({
      chunkId: `chunk-${index}`,
      sourceId: `source-${index}`,
      sourceVersionId: `source-version-${index}`,
      versionLabel: "current",
      authorityLevel: "approved",
      sourceTitle: category,
      sourceType: category,
      category,
      sectionTitle: category,
      pageNumber: null,
      text: `${category} evidence`,
      confidence: 1,
    })),
    entityFacts: {},
    memories: [],
    retrievalMeta: {
      query: "workforce compliance credential deployment eligibility evidence",
      selectedSourceIds: categories,
      selectedChunkIds: categories,
      selectedMemoryIds: [],
      selectedTaskUploadIds: [],
      retrievalMethod: "deterministic",
      ranking: [],
      tokenEstimate: 100,
      durationMs: 1,
    },
  };
}

function approvalsFor(approved = true): Record<string, boolean> {
  return Object.fromEntries(
    Object.keys(blueprintFromRegistry().requiredApprovals ?? {}).map((approval) => [approval, approved]),
  );
}

function validate(overrides: Partial<BlueprintRuntimeValidationInput> = {}) {
  const contract = contractFor();
  const evidenceCategories = Array.from(new Set([
    ...(contract.blueprint.evidenceContract?.requiredEvidenceCategories ?? []),
    ...contract.sections.flatMap((section) => section.evidenceRequirements.requiredEvidenceCategories ?? []),
  ]));
  return validateBlueprintRuntimeCompletion({
    contract,
    contentMarkdown: contentFor(),
    rawClaims: [],
    evidencePack: evidencePack(evidenceCategories),
    artifactId: "artifact-34l19",
    approvalStates: approvalsFor(),
    ...overrides,
  });
}

function methodPendingCodes(): string[] {
  return BLUEPRINT_REGISTRY
    .filter((entry) =>
      entry.requiredApprovals?.human_professional_method_owner === true
      || entry.sections?.[0]?.sectionCode === "USER_DEFINITION_REQUIRED_METHOD",
    )
    .map((entry) => entry.code);
}

function sectionByCode(code: string): BlueprintSection {
  const section = sectionsFromRegistry().find((candidate) => candidate.sectionCode === code);
  if (!section) throw new Error(`Missing section: ${code}`);
  return section;
}

function profile(code: string) {
  const workerProfile = getWorkerProfileByCode(code);
  if (!workerProfile) throw new Error(`Missing worker profile: ${code}`);
  return workerProfile;
}

describe("Sprint 34L.19 workforce compliance method gate and ownership", () => {
  it("1. resolves the Product Owner method blocker for workforce compliance only", () => {
    const blueprint = blueprintFromRegistry();
    expect(blueprint.maturityState).toBe("production_ready");
    expect(blueprint.requiredApprovals).not.toHaveProperty("human_professional_method_owner");
    expect(blueprint.requiredApprovals).toHaveProperty("workforce_compliance_owner", true);
    expect(sectionsFromRegistry()[0]?.sectionCode).not.toBe("USER_DEFINITION_REQUIRED_METHOD");
    expect(methodPendingCodes()).not.toContain(COMPLIANCE_CODE);
    expect(methodPendingCodes()).toHaveLength(0);
  });

  it("2. preserves Workforce Compliance Specialist ownership and restrained support roles", () => {
    const blueprint = blueprintFromRegistry();
    expect(resolveRegistryProfessionalOwner(getRegistryEntry(COMPLIANCE_CODE)!)).toBe("workforce_compliance_specialist");
    expect(blueprint.primarySpecialist).toBe("workforce_compliance_specialist");
    expect(blueprint.supportingSpecialists).toEqual(expect.arrayContaining([
      "people_culture_manager",
      "talent_learning_specialist",
      "workforce_rostering_coordinator",
      "service_delivery_coordinator",
      "payroll_workforce_cost_officer",
      "knowledge_documentation_specialist",
    ]));
    expect(blueprint.primarySpecialist).not.toBe("talent_learning_specialist");
  });
});

describe("Sprint 34L.19 approved workforce compliance method representation", () => {
  it("3. binds the Worker Compliance, Credential & Deployment Eligibility sequence", () => {
    expect(sectionsFromRegistry().map((section) => section.sectionCode)).toEqual([
      "DOCUMENT_CONTROL",
      "WORKER_IDENTITY_EMPLOYMENT_AND_ROLE_SCOPE",
      "REQUIRED_WORKFORCE_COMPLIANCE_PROFILE",
      "CURRENT_AUTHORITY_AND_APPLICABILITY",
      "WORKER_EVIDENCE_VERIFICATION",
      "QUALIFICATION_SCREENING_ORIENTATION_AND_CERTIFICATION",
      "ROLE_PARTICIPANT_COMPETENCY_AND_AUTHORITY",
      "CURRENTNESS_EXPIRY_RESTRICTIONS_AND_CONDITIONS",
      "CONFLICTS_GAPS_AND_COMPLIANCE_STATUS",
      "DEPLOYMENT_ELIGIBILITY_AND_ROSTER_INTERFACE",
      "REMEDIATION_REFERRALS_AND_RENEWAL_MONITORING",
      "PROFESSIONAL_CONCLUSION_AND_APPROVAL",
    ]);
  });

  it("4. creates an evidence-derived compliance profile before eligibility", () => {
    expect(sectionByCode("WORKER_IDENTITY_EMPLOYMENT_AND_ROLE_SCOPE").instructions).toContain("Establish identity before credential verification");
    expect(sectionByCode("REQUIRED_WORKFORCE_COMPLIANCE_PROFILE").description).toContain("Organisation baseline");
    expect(sectionByCode("REQUIRED_WORKFORCE_COMPLIANCE_PROFILE").instructions).toContain("Build the evidence-derived compliance profile before deciding eligibility");
    expect(sectionByCode("REQUIRED_WORKFORCE_COMPLIANCE_PROFILE").instructions).toContain("Do not turn tenant policy into universal Australian law");
    expect(blueprintFromRegistry().validationRules).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule: "required_compliance_profile_before_eligibility" }),
    ]));
  });

  it("5. keeps Certificate IV, NDIS Screening, NDIS Orientation, First Aid and CPR distinct", () => {
    const section = sectionByCode("QUALIFICATION_SCREENING_ORIENTATION_AND_CERTIFICATION");
    expect(section.description).toContain("Certificate IV");
    expect(section.description).toContain("NDIS Worker Screening Check");
    expect(section.description).toContain("NDIS Worker Orientation Module");
    expect(section.description).toContain("First Aid");
    expect(section.description).toContain("CPR");
    expect(section.instructions).toContain("NDIS Worker Screening and NDIS Worker Orientation are separate requirements and cannot satisfy each other");
    expect(blueprintFromRegistry().validationRules).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule: "ndis_screening_and_orientation_separate" }),
    ]));
  });

  it("6. preserves current-authority, WWCC applicability and no legal-rules-engine boundary", () => {
    expect(sectionByCode("CURRENT_AUTHORITY_AND_APPLICABILITY").description).toContain("WWCC applicability");
    expect(sectionByCode("CURRENT_AUTHORITY_AND_APPLICABILITY").description).toContain("current-authority retrieval");
    expect(sectionByCode("CURRENT_AUTHORITY_AND_APPLICABILITY").instructions).toContain("Do not hard-code changing laws");
    expect(sectionByCode("CURRENT_AUTHORITY_AND_APPLICABILITY").instructions).toContain("separate legal rules engine");
  });

  it("7. separates verification, currentness, role validity, competence, authority and eligibility", () => {
    expect(sectionByCode("WORKER_EVIDENCE_VERIFICATION").instructions).toContain("document presence");
    expect(sectionByCode("WORKER_EVIDENCE_VERIFICATION").instructions).toContain("evidence verified");
    expect(sectionByCode("CURRENTNESS_EXPIRY_RESTRICTIONS_AND_CONDITIONS").description).toContain("approaching expiry");
    expect(sectionByCode("CURRENTNESS_EXPIRY_RESTRICTIONS_AND_CONDITIONS").instructions).toContain("APPLIED, BOOKED and PENDING");
    expect(sectionByCode("ROLE_PARTICIPANT_COMPETENCY_AND_AUTHORITY").instructions).toContain("Training is not competency");
    expect(sectionByCode("ROLE_PARTICIPANT_COMPETENCY_AND_AUTHORITY").instructions).toContain("general competency is not participant-specific readiness");
  });

  it("8. classifies gaps, deployment eligibility and roster/learning interfaces", () => {
    expect(sectionByCode("CONFLICTS_GAPS_AND_COMPLIANCE_STATUS").description).toContain("orientation/mandatory learning gap");
    expect(sectionByCode("CONFLICTS_GAPS_AND_COMPLIANCE_STATUS").instructions).toContain("lack of verifiable evidence may still block deployment");
    expect(sectionByCode("DEPLOYMENT_ELIGIBILITY_AND_ROSTER_INTERFACE").description).toContain("not eligible due to mandatory NDIS capability gap");
    expect(sectionByCode("DEPLOYMENT_ELIGIBILITY_AND_ROSTER_INTERFACE").instructions).toContain("roster_planning");
    expect(sectionByCode("REMEDIATION_REFERRALS_AND_RENEWAL_MONITORING").instructions).toContain("Talent & Learning designs development");
  });
});

describe("Sprint 34L.19 evidence, deliverable and completion gates", () => {
  it("9. requires employment, credential and training evidence", () => {
    expect(blueprintFromRegistry().evidenceContract).toMatchObject({
      requiredEvidenceCategories: ["employment_record", "credential_record", "training_record"],
      optionalEvidenceCategories: expect.arrayContaining([
        "qualification_record",
        "screening_record",
        "certification_record",
        "competency_record",
        "service_requirement",
        "participant_record",
        "behaviour_support_plan",
        "restrictive_practice_authorisation",
        "current_authority",
        "organisation_workforce_standard",
        "roster_schedule",
        "learning_record",
      ]),
      requiredEntityTypes: ["worker"],
      minimumEvidenceCount: 4,
      missingEvidenceBehaviour: "block_completion",
      claimIntegrityRequired: true,
    });
  });

  it("10. keeps memory-only evidence restricted", () => {
    const contract = blueprintFromRegistry().evidenceContract!;
    const result = enforceEvidenceContract(contract as never, { chunks: [{ sourceType: "memory_only", category: "credential_record" }] });
    expect(result.passed).toBe(false);
    expect(result.violations.some((violation) => violation.code === "RESTRICTED_SOURCE_TYPE_PRESENT")).toBe(true);
  });

  it("11. binds the existing DOCX/PDF artifact architecture", () => {
    const blueprint = blueprintFromRegistry();
    expect(blueprint.primaryDeliverable).toBe("Worker Compliance, Credential & Deployment Eligibility Assessment");
    expect(blueprint.templateRequired).toBe(true);
    expect(blueprint.allowedOrgTemplateOverride).toBe(true);
    expect(blueprint.deliverableContract).toMatchObject({
      artifactRequired: true,
      primaryFormat: "docx",
      secondaryFormats: ["pdf"],
      templateRequired: true,
      primaryDeliverable: "worker_compliance_credential_deployment_eligibility_assessment",
      namingConvention: "WORKER_COMPLIANCE_DEPLOYMENT_ELIGIBILITY_{worker}_{date}",
      prohibitedDeliverables: expect.arrayContaining([
        "learning_plan",
        "roster",
        "credential_certification",
        "competency_certification",
        "deployment_approval",
        "roster_publication",
        "legal_memorandum",
      ]),
    });
  });

  it("12. blocks completion when artifact, template or Workforce Compliance approval is missing", () => {
    expect(validate({ artifactId: null }).failures.some((failure) => failure.gate === "artifact_required")).toBe(true);
    expect(validate({
      contract: contractFor(null),
    }).failures.some((failure) => failure.gate === "template_required")).toBe(true);
    expect(validate({ approvalStates: approvalsFor(false) }).failures.some((failure) => failure.gate === "approval_required")).toBe(true);
  });

  it("13. passes runtime validation when required evidence, sections, artifact, template and approval are present", () => {
    const result = validate();
    expect(result.failures, JSON.stringify(result.failures)).toEqual([]);
    expect(result.passed).toBe(true);
  });
});

describe("Sprint 34L.19 authority boundaries", () => {
  it("14. KDS cannot rewrite compliance conclusions", () => {
    const decision = evaluateWorkerProfileAuthority({
      specialistCode: "knowledge_documentation_specialist",
      workerProfile: profile("knowledge_documentation_specialist_profile"),
      actionIdentifier: "rewrite_professional_conclusion",
      actionType: "update_file",
      executionChannel: "document_store",
      toolCategory: "document_tools",
      approvalGranted: true,
    });

    expect(decision.decision).toBe("PROHIBITED");
  });

  it("15. Workforce Compliance can draft assessment but cannot override credentials or publish rosters", () => {
    const wcs = profile("workforce_compliance_specialist_profile");
    const draftDecision = evaluateWorkerProfileAuthority({
      specialistCode: "workforce_compliance_specialist",
      workerProfile: wcs,
      actionIdentifier: "draft_worker_compliance_credential_deployment_eligibility_assessment",
      actionType: "create_file",
      executionChannel: "document_store",
      toolCategory: "document_tools",
    });
    const overrideDecision = evaluateWorkerProfileAuthority({
      specialistCode: "workforce_compliance_specialist",
      workerProfile: wcs,
      actionIdentifier: "override_credential_expiry",
      actionType: "update_file",
      executionChannel: "internal_api",
      toolCategory: "form_tools",
      approvalGranted: true,
    });
    const rosterDecision = evaluateWorkerProfileAuthority({
      specialistCode: "workforce_compliance_specialist",
      workerProfile: wcs,
      actionIdentifier: "publish_roster",
      actionType: "update_file",
      executionChannel: "internal_api",
      toolCategory: "form_tools",
      approvalGranted: true,
    });

    expect(draftDecision.decision).toBe("PERMITTED");
    expect(overrideDecision.decision).toBe("PROHIBITED");
    expect(rosterDecision.decision).toBe("PROHIBITED");
  });
});
