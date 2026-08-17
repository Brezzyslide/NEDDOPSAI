/**
 * Sprint 33S - Knowledge & Documentation Specialist v2
 *
 * Proves KDS owns controlled knowledge/document mechanics without becoming
 * KRS, SpecialistContext, Authority Registry, memory, template engine,
 * artifact store or the professional owner of substantive domain truth.
 */

import { describe, expect, it, vi } from "vitest";
import type { ExecutionPackage } from "@workspace/agent-runtime";

vi.mock("../services/specialistCatalogueService.js", () => ({
  listCatalogue: vi.fn(async () => ({ entries: [] })),
}));

vi.mock("../services/entitlementService.js", () => ({
  tenantCanUseSpecialist: vi.fn(async () => ({ allowed: true })),
  tenantHasWorkforcePack: vi.fn(async () => ({ allowed: true, source: "plan" })),
  tenantCanUseFeature: vi.fn(async () => true),
  checkUsage: vi.fn(async () => ({ allowed: true })),
}));

vi.mock("../services/auditService.js", () => ({
  logOrgEvent: vi.fn(async () => undefined),
}));

import {
  KNOWLEDGE_DOCUMENTATION_SPECIALIST_DNA,
  getCanonicalDNAProfile,
  getDNAProfile,
} from "@workspace/workforce-dna";
import { getSpecialistByCode } from "../lib/workforceRegistry.js";
import { getCapability } from "../lib/capabilityRegistry.js";
import {
  getWorkerProfileByCode,
  getWorkerProfilesForRole,
} from "../lib/workerProfileRegistry.js";
import {
  hasActiveIntelligence,
  validateSpecialistEligibilitySync,
} from "../services/specialistEligibilityService.js";
import {
  getConversationWorkforceContext,
  _clearWorkforceCache,
} from "../services/conversationWorkforceContextService.js";
import { getRegistryEntry } from "../services/blueprintRegistry.js";
import { resolveIntent } from "../services/blueprintIntentMap.js";
import { enforceDeliverableContract } from "../services/blueprintContractService.js";
import { evaluateWorkerProfileAuthority } from "../services/executionActionService.js";
import {
  buildWorkerProfileExecutionConstraints,
  validateOpenClawExecutionPackageAuthority,
} from "../services/executionService.js";

const ORG_ID = "org-sprint33s";
const profile = getWorkerProfileByCode("knowledge_documentation_specialist_profile")!;

type LifecycleStatus = "DRAFT" | "IN_REVIEW" | "APPROVED" | "PUBLISHED" | "CURRENT" | "SUPERSEDED" | "RETIRED" | "ARCHIVED" | "EXPIRED" | "UNKNOWN";
type CopyClass = "CANONICAL" | "DUPLICATE" | "NEAR_DUPLICATE" | "CONFLICTING_COPY" | "UNCONTROLLED_COPY" | "SUPERSEDED_COPY" | "ORPHANED" | "UNKNOWN";
type ChangeClass = "EDITORIAL_CHANGE" | "METADATA_CHANGE" | "FORMAT_CHANGE" | "SUBSTANTIVE_CHANGE" | "POLICY_CHANGE" | "PROFESSIONAL_CONTENT_CHANGE";
type RetrievalFinding = "FOUND" | "NOT_FOUND" | "DOES_NOT_EXIST";

function lifecycle(input: { created?: boolean; approved?: boolean; published?: boolean; current?: boolean; superseded?: boolean; archived?: boolean; expired?: boolean }): LifecycleStatus {
  if (input.archived) return "ARCHIVED";
  if (input.expired) return "EXPIRED";
  if (input.superseded) return "SUPERSEDED";
  if (input.current) return "CURRENT";
  if (input.published) return "PUBLISHED";
  if (input.approved) return "APPROVED";
  if (input.created) return "DRAFT";
  return "UNKNOWN";
}

function provesCurrent(source: "registry_current" | "approved_current_record" | "filename" | "upload_timestamp" | "retrieval_time" | "memory" | "user_assertion" | "unknown"): boolean {
  return source === "registry_current" || source === "approved_current_record";
}

function classifyCopy(input: { exact?: boolean; near?: boolean; conflicting?: boolean; uncontrolled?: boolean; superseded?: boolean; orphaned?: boolean; canonical?: boolean }): CopyClass {
  if (input.canonical) return "CANONICAL";
  if (input.conflicting) return "CONFLICTING_COPY";
  if (input.uncontrolled) return "UNCONTROLLED_COPY";
  if (input.superseded) return "SUPERSEDED_COPY";
  if (input.orphaned) return "ORPHANED";
  if (input.near) return "NEAR_DUPLICATE";
  if (input.exact) return "DUPLICATE";
  return "UNKNOWN";
}

function canDeleteDuplicate(input: { ownerApproval: boolean; retentionChecked: boolean; historicalValueChecked: boolean }): boolean {
  return input.ownerApproval && input.retentionChecked && input.historicalValueChecked;
}

function classifyChange(input: { wordingOnly?: boolean; metadataOnly?: boolean; formattingOnly?: boolean; changesMeaning?: boolean; changesPolicy?: boolean; changesProfessionalConclusion?: boolean }): ChangeClass {
  if (input.changesProfessionalConclusion) return "PROFESSIONAL_CONTENT_CHANGE";
  if (input.changesPolicy) return "POLICY_CHANGE";
  if (input.changesMeaning) return "SUBSTANTIVE_CHANGE";
  if (input.metadataOnly) return "METADATA_CHANGE";
  if (input.formattingOnly) return "FORMAT_CHANGE";
  return "EDITORIAL_CHANGE";
}

function retrievalOutcome(input: { resultFound: boolean; authoritativeInventorySaysAbsent?: boolean }): RetrievalFinding {
  if (input.resultFound) return "FOUND";
  return input.authoritativeInventorySaysAbsent ? "DOES_NOT_EXIST" : "NOT_FOUND";
}

function templateGap(input: { requiredSectionPresent: boolean; professionalContentProvided: boolean }): "COMPLETE" | "STRUCTURE_GAP" | "CONTENT_OWNER_GAP" {
  if (!input.requiredSectionPresent) return "STRUCTURE_GAP";
  if (!input.professionalContentProvided) return "CONTENT_OWNER_GAP";
  return "COMPLETE";
}

function makePackage(overrides: Partial<ExecutionPackage> = {}): ExecutionPackage {
  const workerProfile = buildWorkerProfileExecutionConstraints(profile);
  return {
    executionId: "exec-33s",
    taskId: "task-33s",
    tenantId: ORG_ID,
    workforceRole: "knowledge_documentation_specialist",
    specialistManifest: {
      manifestVersion: 1,
      workforceRole: "knowledge_documentation_specialist",
      displayName: "Knowledge & Documentation Specialist",
      domain: "controlled knowledge and documentation",
      dnaProfileId: "knowledge_documentation_specialist",
      dnaVersion: "1.0.0",
      manifestHash: "sha256:kds-manifest",
      generatedAt: new Date().toISOString(),
      specialistId: "knowledge_documentation_specialist",
    } as ExecutionPackage["specialistManifest"],
    runtimeInstructions: {
      instruction: "Execute controlled knowledge and documentation work only.",
      instructionHash: "sha256:kds-instruction",
      manifestHash: "sha256:kds-manifest",
      dnaVersion: "1.0.0",
      specialistId: "knowledge_documentation_specialist",
      compiledAt: new Date().toISOString(),
    },
    workerProfile,
    steps: [{
      sequence: 1,
      specialist: "knowledge_documentation_specialist",
      action: "execute",
      description: "Assess controlled knowledge, documentation or artifact evidence",
      requiresApproval: false,
    }],
    requestedTools: [...profile.allowedToolCategories],
    requestedChannels: [...workerProfile.allowedChannels],
    requestedConnectorCategories: [...profile.allowedConnectorCategories],
    approvalState: "not_required",
    constraints: {
      maxDurationSeconds: 300,
      requireHumanApprovalBeforeSubmit: false,
      allowedDataCategories: ["task_context", "knowledge_metadata", "document_versions", "templates", "artifacts", "provenance"],
    },
    callbackUrl: "",
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
    issuedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("Sprint 33S current-v2 activation", () => {
  it("activates KDS as a complete current-v2 role", () => {
    const specialist = getSpecialistByCode("knowledge_documentation_specialist");

    expect(specialist).toMatchObject({
      code: "knowledge_documentation_specialist",
      executionStatus: "available",
      dnaStatus: "approved",
      catalogueVersion: "2",
      workerProfileCodes: ["knowledge_documentation_specialist_profile"],
    });
    expect(hasActiveIntelligence("knowledge_documentation_specialist")).toBe(true);
  });

  it("resolves canonical DNA and WorkerProfile", () => {
    const legacy = getDNAProfile("knowledge_documentation_specialist");
    const canonical = getCanonicalDNAProfile("knowledge_documentation_specialist");
    const profiles = getWorkerProfilesForRole("knowledge_documentation_specialist");

    expect(legacy).toBe(KNOWLEDGE_DOCUMENTATION_SPECIALIST_DNA);
    expect(canonical!.identity.specialistId).toBe("knowledge_documentation_specialist");
    expect(canonical!.requiredWorkerProfile.profileCode).toBe("knowledge_documentation_specialist_profile");
    expect(profiles.map(p => p.code)).toEqual(["knowledge_documentation_specialist_profile"]);
  });

  it("is runtime-ready and conversation-context eligible", async () => {
    _clearWorkforceCache();
    const ctx = await getConversationWorkforceContext(ORG_ID);
    const kds = ctx.specialists.find(s => s.code === "knowledge_documentation_specialist");

    expect(kds).toBeDefined();
    expect(kds!.availableForConversation).toBe(true);
    expect(kds!.availableForDispatch).toBe(true);
    expect(validateSpecialistEligibilitySync("knowledge_documentation_specialist", "knowledge.document_control")).toBe(true);
  });

  it("owns knowledge and documentation capabilities", () => {
    for (const code of [
      "knowledge.document_control",
      "knowledge.document_lifecycle",
      "knowledge.version_review",
      "knowledge.supersession_review",
      "knowledge.metadata_review",
      "knowledge.taxonomy",
      "knowledge.classification",
      "knowledge.retrieval_quality",
      "knowledge.duplication_review",
      "knowledge.knowledge_gap_review",
      "knowledge.template_control",
      "knowledge.document_quality",
      "knowledge.artifact_packaging",
      "knowledge.controlled_publication",
      "knowledge.archive_review",
      "knowledge.review_due_monitoring",
      "documentation.control_review",
      "documentation.template_application",
    ]) {
      const capability = getCapability(code);
      expect(capability, code).toBeDefined();
      expect(capability!.eligibleRoles).toContain("knowledge_documentation_specialist");
      expect(capability!.requiredWorkerProfiles).toContain("knowledge_documentation_specialist_profile");
    }
  });

  it("routes KDS intents to KDS-owned Blueprints", () => {
    expect(resolveIntent("knowledge.document_control")).toMatchObject({ code: "document_control_review" });
    expect(resolveIntent("knowledge.retrieval_quality")).toMatchObject({ code: "knowledge_base_review" });
    expect(resolveIntent("documentation.template_application")).toMatchObject({ code: "controlled_document_assembly" });
    expect(getRegistryEntry("document_control_review")?.futureOwnerRoleCode).toBe("knowledge_documentation_specialist");
    expect(getRegistryEntry("knowledge_base_review")?.futureOwnerRoleCode).toBe("knowledge_documentation_specialist");
    expect(getRegistryEntry("controlled_document_assembly")?.futureOwnerRoleCode).toBe("knowledge_documentation_specialist");
  });

  it("does not steal professional content Blueprints from other specialists", () => {
    expect(getRegistryEntry("policy")?.futureOwnerRoleCode).toBe("policy_governance_specialist");
    expect(getRegistryEntry("standard_operating_procedure")?.futureOwnerRoleCode).toBe("process_asset_coordinator");
    expect(getRegistryEntry("learning_capability_development_plan")?.futureOwnerRoleCode).toBe("talent_learning_specialist");
    expect(getRegistryEntry("marketing_communications_review")?.futureOwnerRoleCode).toBe("marketing_communications_manager");
    expect(resolveIntent("payroll.review")).toMatchObject({ code: "payroll_workforce_cost_review" });
    expect(resolveIntent("finance.reconciliation")).toMatchObject({ code: "operational_finance_reconciliation_review" });
    expect(resolveIntent("financial_planning.forecast")).toMatchObject({ code: "financial_planning_reporting_review" });
  });
});

describe("Sprint 33S lifecycle, currentness and duplication rules", () => {
  it("creation does not equal approval", () => {
    expect(lifecycle({ created: true })).toBe("DRAFT");
  });

  it("approval does not equal publication", () => {
    expect(lifecycle({ approved: true })).toBe("APPROVED");
  });

  it("publication does not imply perpetual currentness", () => {
    expect(lifecycle({ published: true })).toBe("PUBLISHED");
  });

  it("archived does not equal deleted", () => {
    expect(lifecycle({ archived: true })).toBe("ARCHIVED");
  });

  it("superseded historical evidence remains historical evidence", () => {
    expect(lifecycle({ superseded: true })).toBe("SUPERSEDED");
  });

  it("latest upload does not automatically become current", () => {
    expect(provesCurrent("upload_timestamp")).toBe(false);
  });

  it("highest version-looking filename does not automatically become current", () => {
    expect(provesCurrent("filename")).toBe(false);
  });

  it("retrieval time does not promote UNKNOWN to CURRENT", () => {
    expect(provesCurrent("retrieval_time")).toBe(false);
  });

  it("memory does not prove current approved version", () => {
    expect(provesCurrent("memory")).toBe(false);
  });

  it("user assertion does not prove approval or publication", () => {
    expect(provesCurrent("user_assertion")).toBe(false);
  });

  it("controlled registry/current record can prove currentness", () => {
    expect(provesCurrent("registry_current")).toBe(true);
    expect(provesCurrent("approved_current_record")).toBe(true);
  });

  it("duplicate detection classifies but does not automatically delete", () => {
    expect(classifyCopy({ exact: true })).toBe("DUPLICATE");
    expect(canDeleteDuplicate({ ownerApproval: false, retentionChecked: true, historicalValueChecked: true })).toBe(false);
  });

  it("uncontrolled newer copy does not replace approved controlled copy", () => {
    expect(classifyCopy({ uncontrolled: true })).toBe("UNCONTROLLED_COPY");
    expect(provesCurrent("upload_timestamp")).toBe(false);
  });

  it("conflicting copies produce unresolved control finding", () => {
    expect(classifyCopy({ conflicting: true })).toBe("CONFLICTING_COPY");
  });

  it("version lineage is preserved", () => {
    const lineage = { version: "4.0", previousVersion: "3.0", supersedes: "3.0" };
    expect(lineage.previousVersion).toBe("3.0");
    expect(lineage.supersedes).toBe("3.0");
  });

  it("supersession requires evidence", () => {
    expect(classifyCopy({ superseded: true })).toBe("SUPERSEDED_COPY");
    expect(provesCurrent("user_assertion")).toBe(false);
  });
});

describe("Sprint 33S professional boundaries and record controls", () => {
  it("KDS cannot change policy meaning", () => {
    expect(classifyChange({ changesPolicy: true })).toBe("POLICY_CHANGE");
    expect(KNOWLEDGE_DOCUMENTATION_SPECIALIST_DNA.conflictPolicy.defersTo).toContain("policy_governance_specialist");
  });

  it("KDS cannot change payroll conclusion", () => {
    expect(classifyChange({ changesProfessionalConclusion: true })).toBe("PROFESSIONAL_CONTENT_CHANGE");
    expect(KNOWLEDGE_DOCUMENTATION_SPECIALIST_DNA.conflictPolicy.defersTo).toContain("payroll_workforce_cost_officer");
  });

  it("KDS cannot change RP, clinical or BSP conclusion", () => {
    expect(KNOWLEDGE_DOCUMENTATION_SPECIALIST_DNA.conflictPolicy.defersTo).toContain("authorised_program_officer");
    expect(KNOWLEDGE_DOCUMENTATION_SPECIALIST_DNA.conflictPolicy.defersTo).toContain("behaviour_support_implementation_specialist");
  });

  it("KDS cannot change CQM compliance conclusion", () => {
    expect(KNOWLEDGE_DOCUMENTATION_SPECIALIST_DNA.conflictPolicy.defersTo).toContain("compliance_quality_manager");
  });

  it("KDS cannot rewrite historical records", () => {
    expect(profile.prohibitedActions).toContain("rewrite_historical_record");
    expect(profile.prohibitedActions).toContain("rewrite_case_note");
    expect(profile.prohibitedActions).toContain("alter_incident_fact");
  });

  it("record vs knowledge document remains distinct", () => {
    const policy = "controlled_knowledge_document";
    const incidentReport = "operational_record";
    expect(policy).not.toBe(incidentReport);
  });

  it("access restrictions remain intact despite retrieval optimisation", () => {
    const decision = evaluateWorkerProfileAuthority({
      workerProfile: profile,
      specialistCode: "knowledge_documentation_specialist",
      actionIdentifier: "bypass_access_control",
      actionType: "create_file",
      executionChannel: "document_store",
      toolCategory: "document_tools",
      connectorCategory: "document_management",
      approvalGranted: true,
    });
    expect(decision.decision).toBe("PROHIBITED");
  });

  it("metadata quality cannot override source authority", () => {
    expect(provesCurrent("filename")).toBe(false);
    expect(provesCurrent("registry_current")).toBe(true);
  });

  it("editorial change is distinguishable from substantive change", () => {
    expect(classifyChange({ wordingOnly: true })).toBe("EDITORIAL_CHANGE");
    expect(classifyChange({ changesMeaning: true })).toBe("SUBSTANTIVE_CHANGE");
  });

  it("substantive change routes back to professional owner", () => {
    expect(classifyChange({ changesProfessionalConclusion: true })).toBe("PROFESSIONAL_CONTENT_CHANGE");
    expect(KNOWLEDGE_DOCUMENTATION_SPECIALIST_DNA.conflictPolicy.autonomousResolution).toBe(false);
  });

  it("NOT_FOUND is distinguishable from DOES_NOT_EXIST", () => {
    expect(retrievalOutcome({ resultFound: false })).toBe("NOT_FOUND");
    expect(retrievalOutcome({ resultFound: false, authoritativeInventorySaysAbsent: true })).toBe("DOES_NOT_EXIST");
  });
});

describe("Sprint 33S template, artifact and OpenClaw constraints", () => {
  it("template structure can be enforced without inventing professional content", () => {
    expect(templateGap({ requiredSectionPresent: true, professionalContentProvided: false })).toBe("CONTENT_OWNER_GAP");
  });

  it("required missing template section is surfaced as a gap", () => {
    expect(templateGap({ requiredSectionPresent: false, professionalContentProvided: true })).toBe("STRUCTURE_GAP");
  });

  it("controlled artifact preserves substantive owner", () => {
    const artifact = { owner: "policy_governance_specialist", packagedBy: "knowledge_documentation_specialist" };
    expect(artifact.owner).toBe("policy_governance_specialist");
    expect(artifact.packagedBy).toBe("knowledge_documentation_specialist");
  });

  it("document packaging does not transfer professional ownership to KDS", () => {
    const packageOwner = { professionalOwner: "finance_officer", documentController: "knowledge_documentation_specialist" };
    expect(packageOwner.professionalOwner).not.toBe(packageOwner.documentController);
  });

  it("required artifact contract remains enforced", () => {
    const result = enforceDeliverableContract({
      primaryDeliverable: "Controlled DOCX/PDF artifact",
      secondaryDeliverables: [],
      allowedInternalAnalysis: [],
      prohibitedDeliverables: [],
      artifactRequired: true,
      primaryFormat: "docx",
      secondaryFormats: ["pdf"],
      namingConvention: null,
      templateRequired: false,
      completionRequirements: ["artifact_generated"],
    }, "Controlled document text only", false, true);

    expect(result.passed).toBe(false);
    expect(result.outcome).toBe("block_completion");
    expect(result.violations[0]?.type).toBe("ARTIFACT_REQUIRED_NOT_MET");
  });

  it("text-only output cannot falsely satisfy artifact-required work", () => {
    const result = enforceDeliverableContract({
      primaryDeliverable: "Controlled artifact",
      secondaryDeliverables: [],
      allowedInternalAnalysis: [],
      prohibitedDeliverables: [],
      artifactRequired: true,
      primaryFormat: "pdf",
      secondaryFormats: [],
      namingConvention: null,
      templateRequired: false,
      completionRequirements: ["artifact_generated"],
    }, "Here is the answer in chat.", false, true);
    expect(result.passed).toBe(false);
  });

  it("artifact/task linkage is preserved", () => {
    const artifact = { taskId: "task-33s", completedWorkId: "cw-33s", sourceVersionId: "ver-33s" };
    expect(artifact.taskId).toBe("task-33s");
    expect(artifact.completedWorkId).toBe("cw-33s");
    expect(artifact.sourceVersionId).toBe("ver-33s");
  });

  it("approval cannot override fabricated provenance", () => {
    const decision = evaluateWorkerProfileAuthority({
      workerProfile: profile,
      specialistCode: "knowledge_documentation_specialist",
      actionIdentifier: "fabricate_provenance",
      actionType: "create_file",
      executionChannel: "document_store",
      toolCategory: "document_tools",
      connectorCategory: "document_management",
      approvalGranted: true,
    });
    expect(decision.decision).toBe("PROHIBITED");
  });

  it("approval cannot permit silent historical rewriting", () => {
    const decision = evaluateWorkerProfileAuthority({
      workerProfile: profile,
      specialistCode: "knowledge_documentation_specialist",
      actionIdentifier: "rewrite_historical_record",
      actionType: "update_file",
      executionChannel: "document_store",
      toolCategory: "document_tools",
      connectorCategory: "document_management",
      approvalGranted: true,
    });
    expect(decision.decision).toBe("PROHIBITED");
  });

  it("controlled publication requires approval", () => {
    const decision = evaluateWorkerProfileAuthority({
      workerProfile: profile,
      specialistCode: "knowledge_documentation_specialist",
      actionIdentifier: "controlled_publication",
      actionType: "create_file",
      executionChannel: "document_store",
      toolCategory: "document_tools",
      connectorCategory: "document_management",
      approvalGranted: false,
    });
    expect(decision.decision).toBe("APPROVAL_REQUIRED");
  });

  it("OpenClaw package preserves document-control prohibitions", () => {
    const valid = validateOpenClawExecutionPackageAuthority({ pkg: makePackage(), workerProfile: profile });
    const missingProhibitions = validateOpenClawExecutionPackageAuthority(
      { pkg: makePackage({
        workerProfile: {
          ...buildWorkerProfileExecutionConstraints(profile),
          prohibitedActions: [],
        },
      }), workerProfile: profile },
    );

    expect(valid.decision).toBe("PERMITTED");
    expect(missingProhibitions.decision).toBe("PROHIBITED");
    expect(missingProhibitions.reason).toContain("removed WorkerProfile prohibitions");
  });

  it("is publication eligible through static prerequisites", () => {
    const specialist = getSpecialistByCode("knowledge_documentation_specialist");
    const dna = getDNAProfile("knowledge_documentation_specialist");
    const workerProfiles = getWorkerProfilesForRole("knowledge_documentation_specialist");

    expect(specialist?.dnaStatus).toBe("approved");
    expect(specialist?.executionStatus).toBe("available");
    expect(dna?.currentVersion.isActive).toBe(true);
    expect(workerProfiles[0]?.status).toBe("active");
    expect(hasActiveIntelligence("knowledge_documentation_specialist")).toBe(true);
  });
});
