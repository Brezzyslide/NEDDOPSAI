import { describe, expect, it } from "vitest";
import {
  getRegistryEntry,
  resolveRegistryProfessionalOwner,
} from "../services/blueprintRegistry.js";
import { resolveIntent } from "../services/blueprintIntentMap.js";
import {
  validateBlueprintRuntimeCompletion,
  type BlueprintRuntimeValidationInput,
} from "../services/blueprintRuntimeValidationService.js";
import { enforceEvidenceContract } from "../services/blueprintContractService.js";
import { evaluateWorkerProfileAuthority } from "../services/executionActionService.js";
import { getWorkerProfileByCode } from "../lib/workerProfileRegistry.js";
import type {
  BlueprintExecutionContract,
  BlueprintSection,
  WorkBlueprint,
  WorkTemplate,
} from "../services/workBlueprintService.js";

const NOW = new Date("2026-08-17T00:00:00Z");

function blueprintFromRegistry(code: string): WorkBlueprint {
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

function sectionsFromRegistry(code: string): BlueprintSection[] {
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
  id: "tpl-participant-support",
  organizationId: "org-1",
  ownerType: "organisation_owned",
  code: "participant_support_template",
  title: "Participant Support Template",
  version: "1.0.0",
  status: "published",
  maturityState: "production_ready",
  templateType: "docx",
  sourceFileReference: "org://templates/participant-support.docx",
  mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  mergeFieldSchema: {},
  createdAt: NOW,
  updatedAt: NOW,
};

function contractFor(code: string, templateOverride: WorkTemplate | null = template): BlueprintExecutionContract {
  return {
    blueprint: blueprintFromRegistry(code),
    sections: sectionsFromRegistry(code),
    template: templateOverride,
    mode: "create",
  };
}

function contentFor(code: string): string {
  return sectionsFromRegistry(code)
    .map((section) => `## ${section.sectionCode}\nThis section is materially populated with verified evidence and any gaps are surfaced.`)
    .join("\n\n");
}

function evidencePack(categories: string[]) {
  return {
    executionId: "exec-34c",
    organisationId: "org-34c",
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
      sectionTitle: category,
      pageNumber: null,
      text: `${category} evidence`,
      confidence: 1,
    })),
    entityFacts: {},
    memories: [],
    retrievalMeta: {
      query: "participant support evidence",
      selectedSourceIds: categories,
      selectedChunkIds: categories,
      selectedMemoryIds: [],
      selectedTaskUploadIds: [],
      retrievalMethod: "deterministic",
      ranking: [],
      tokenEstimate: 50,
      durationMs: 1,
    },
  };
}

function validate(code: string, overrides: Partial<BlueprintRuntimeValidationInput> = {}) {
  const contract = contractFor(code);
  return validateBlueprintRuntimeCompletion({
    contract,
    contentMarkdown: contentFor(code),
    rawClaims: [],
    evidencePack: evidencePack(contract.blueprint.evidenceContract?.requiredEvidenceCategories ?? []),
    artifactId: "artifact-34c",
    approvalStates: Object.fromEntries(Object.keys(contract.blueprint.requiredApprovals ?? {}).map(key => [key, true])),
    ...overrides,
  });
}

describe("Sprint 34C ownership and scope", () => {
  it("1. care_plan resolves to Service Delivery Coordinator as professional owner", () => {
    expect(resolveRegistryProfessionalOwner(getRegistryEntry("care_plan")!)).toBe("service_delivery_coordinator");
  });

  it("2. Chief of Staff remains coordinator, not care-plan professional owner", () => {
    expect(blueprintFromRegistry("care_plan").primarySpecialist).not.toBe("chief_of_staff");
  });

  it("3. service_delivery_review resolves to SDC and deterministic intent routing", () => {
    expect(resolveRegistryProfessionalOwner(getRegistryEntry("service_delivery_review")!)).toBe("service_delivery_coordinator");
    expect(resolveIntent("service_delivery.review")).toMatchObject({ code: "service_delivery_review" });
  });

  it("4. Operations Manager remains supporting capacity authority, not care-plan owner", () => {
    const care = blueprintFromRegistry("care_plan");
    expect(care.supportingSpecialists).toContain("operations_manager");
    expect(care.primarySpecialist).toBe("service_delivery_coordinator");
  });

  it("5. KDS does not become professional care/support content owner", () => {
    const care = blueprintFromRegistry("care_plan");
    expect(care.supportingSpecialists).toContain("knowledge_documentation_specialist");
    expect(care.primarySpecialist).not.toBe("knowledge_documentation_specialist");
  });
});

describe("Sprint 34C care-plan contract", () => {
  it("6. care plan requires configured professional sections", () => {
    expect(sectionsFromRegistry("care_plan").map(s => s.sectionCode)).toEqual([
      "PARTICIPANT_CONTEXT",
      "PURPOSE_AND_SCOPE",
      "GOALS_AND_PREFERENCES",
      "SUPPORT_REQUIREMENTS",
      "RISKS_SAFEGUARDS_ESCALATION",
      "MONITORING_REVIEW_GAPS",
    ]);
  });

  it("7. missing required section blocks completion", () => {
    const result = validate("care_plan", { contentMarkdown: "## PARTICIPANT_CONTEXT\nOnly one section is present." });
    expect(result.passed).toBe(false);
    expect(result.failures.some(failure => failure.gate === "required_section")).toBe(true);
  });

  it("8. missing material evidence blocks completion", () => {
    const result = validate("care_plan", { evidencePack: evidencePack(["participant_context"]) });
    expect(result.passed).toBe(false);
    expect(result.failures.some(failure => failure.gate === "missing_evidence")).toBe(true);
  });

  it("9. memory alone does not prove current participant evidence", () => {
    const contract = blueprintFromRegistry("care_plan").evidenceContract!;
    const result = enforceEvidenceContract(contract as never, { chunks: [{ sourceType: "memory_only", category: "participant_context" }] });
    expect(result.passed).toBe(false);
    expect(result.violations.some(v => v.code === "RESTRICTED_SOURCE_TYPE_PRESENT")).toBe(true);
  });

  it("10. historical plan does not become current plan", () => {
    expect(blueprintFromRegistry("care_plan").evidenceContract?.freshnessRules).toMatchObject({
      currentnessRequired: true,
      historicalPlansRemainHistorical: true,
    });
  });

  it("11. care-plan artifact requirement is enforced", () => {
    const result = validate("care_plan", { artifactId: null });
    expect(result.passed).toBe(false);
    expect(result.failures.some(failure => failure.gate === "artifact_required")).toBe(true);
  });

  it("12. text-only completion cannot satisfy artifact-required care plan", () => {
    const result = validate("care_plan", { artifactId: null, contentMarkdown: contentFor("care_plan") });
    expect(result.failures.map(f => f.gate)).toContain("artifact_required");
  });

  it("13. required template is enforced where configured", () => {
    const result = validate("care_plan", { contract: contractFor("care_plan", null) });
    expect(result.passed).toBe(false);
    expect(result.failures.some(failure => failure.gate === "template_required")).toBe(true);
  });

  it("14. approved template structure remains authoritative", () => {
    const care = blueprintFromRegistry("care_plan");
    expect(care.templateRequired).toBe(true);
    expect(care.allowedOrgTemplateOverride).toBe(true);
    expect(care.templateVersionPolicy).toBe("pin_at_execution");
  });

  it("15. internal risk reasoning does not automatically emit a separate risk artifact", () => {
    const deliverable = blueprintFromRegistry("care_plan").deliverableContract!;
    expect(deliverable.allowedInternalAnalysis).toContain("risk_context_review");
    expect(deliverable.prohibitedDeliverables).toContain("standalone_risk_assessment");
  });

  it("16. unrequested standalone deliverable is prohibited", () => {
    const result = validate("care_plan", {
      contentMarkdown: `${contentFor("care_plan")}\n\n## standalone risk assessment\nNot requested.`,
    });
    expect(result.passed).toBe(false);
    expect(result.failures.some(failure => failure.gate === "prohibited_deliverable")).toBe(true);
  });
});

describe("Sprint 34C service-delivery, goals and risk reasoning", () => {
  it("17. service-delivery review distinguishes planned from actual", () => {
    expect(sectionsFromRegistry("service_delivery_review").map(s => s.sectionCode)).toEqual([
      "PLANNED_SUPPORT",
      "ACTUAL_DELIVERY",
      "VARIANCE_IMPACT",
      "ACTION_ESCALATION",
    ]);
  });

  it("18. scheduled support does not automatically prove delivered support", () => {
    const review = JSON.stringify(getRegistryEntry("service_delivery_review"));
    expect(review).toContain("Scheduled support is not proof of delivery");
  });

  it("19. missing documentation does not automatically prove non-delivery", () => {
    const review = JSON.stringify(getRegistryEntry("service_delivery_review"));
    expect(review).toContain("delivery_not_evidenced");
    expect(review).toContain("evidence_gap_not_automatic_non_delivery");
  });

  it("20. activity does not automatically prove goal achievement", () => {
    const goals = JSON.stringify(getRegistryEntry("participant_goals_review"));
    expect(goals).toContain("Activity, Participation and Progress");
    expect(goals).toContain("Do not claim achievement from activity alone");
  });

  it("21. participant risk Blueprint preserves professional sub-domain boundaries", () => {
    const risk = getRegistryEntry("participant_risk_assessment")!;
    expect(risk.futureOwnerRoleCode).toBe("service_delivery_coordinator");
    expect(risk.externalAuthorityRequiredFor).toEqual(expect.arrayContaining([
      "clinical risk determination",
      "BSP/RP risk determination",
      "safeguarding determination",
    ]));
  });
});

describe("Sprint 34C clinical/mealtime and completion safety", () => {
  it("22. mealtime Blueprint does not invent clinical recommendation", () => {
    const mealtime = getRegistryEntry("mealtime_management_plan_review")!;
    expect(mealtime.professionalAuthority).toBe("external_or_credentialed");
    expect(mealtime.deliverableContract?.prohibitedDeliverables).toContain("clinical_mealtime_plan");
  });

  it("23. missing credentialed clinical input is surfaced", () => {
    const result = validate("health_support_plan", { evidencePack: evidencePack(["participant_context"]) });
    expect(result.passed).toBe(false);
    expect(result.failures.some(failure => failure.gate === "missing_evidence")).toBe(true);
  });

  it("24. expired or historical clinical evidence is not treated as current", () => {
    const health = blueprintFromRegistry("health_support_plan");
    expect(health.evidenceContract?.freshnessRules).toMatchObject({
      currentnessRequired: true,
      conflictingVersionsRequireResolution: true,
    });
  });

  it("25. approval cannot override prohibited professional action", () => {
    const profile = getWorkerProfileByCode("service_delivery_coordinator_profile")!;
    const decision = evaluateWorkerProfileAuthority({
      specialistCode: "service_delivery_coordinator",
      workerProfile: profile,
      actionIdentifier: "make_clinical_decision",
      actionType: "update_file",
      executionChannel: "internal_api",
      toolCategory: "data_tools",
      approvalGranted: true,
    });
    expect(decision.decision).toBe("PROHIBITED");
  });

  it("26. completion gate blocks premature task completion", () => {
    const result = validate("participant_risk_assessment", {
      contentMarkdown: "## RISK_CONTEXT\nOnly context.",
      evidencePack: evidencePack(["participant_context"]),
      artifactId: null,
      approvalStates: {},
    });
    expect(result.passed).toBe(false);
    expect(result.failures.map(f => f.gate)).toEqual(expect.arrayContaining([
      "required_section",
      "missing_evidence",
      "artifact_required",
      "approval_required",
    ]));
  });

  it("27. Blueprint execution snapshot preserves owner, version and contracts", () => {
    const care = contractFor("care_plan");
    expect(care.blueprint.primarySpecialist).toBe("service_delivery_coordinator");
    expect(care.blueprint.version).toBe("1.0.0");
    expect(care.blueprint.deliverableContract).not.toBeNull();
    expect(care.blueprint.evidenceContract).not.toBeNull();
  });
});
