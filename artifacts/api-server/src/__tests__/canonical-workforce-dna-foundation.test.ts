import { describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

const { mockLoadDNAWithStaticFallback, mockLoadOrgSpecialistConfig } = vi.hoisted(() => ({
  mockLoadDNAWithStaticFallback: vi.fn(),
  mockLoadOrgSpecialistConfig: vi.fn(),
}));

vi.mock("../services/dnaStorageService.js", () => ({
  loadDNAFromDatabase: vi.fn().mockResolvedValue(null),
  loadDNAWithStaticFallback: mockLoadDNAWithStaticFallback,
  loadOrgSpecialistConfig: mockLoadOrgSpecialistConfig,
  seedDNAFromStaticRegistry: vi.fn().mockResolvedValue("created"),
}));

import {
  CANONICAL_DNA_PROJECTION_VERSION,
  AUTHORISED_PROGRAM_OFFICER_DNA,
  BEHAVIOUR_SUPPORT_IMPLEMENTATION_SPECIALIST_DNA,
  getCanonicalDNAProfile,
  getSafeDNADescriptor,
  mapLegacyDNAProfileToWorkforceDNA,
  CHIEF_OF_STAFF_DNA,
  COMPLIANCE_QUALITY_MANAGER_DNA,
  EXECUTIVE_ASSISTANT_DNA_V1,
  INCIDENT_SAFEGUARDING_SPECIALIST_DNA,
  OPERATIONS_MANAGER_DNA,
  POLICY_GOVERNANCE_SPECIALIST_DNA,
  SERVICE_DELIVERY_COORDINATOR_DNA,
  WORKFORCE_ROSTERING_COORDINATOR_DNA,
  WORKFORCE_COMPLIANCE_SPECIALIST_DNA,
  type WorkforceDNA,
} from "@workspace/workforce-dna";
import { assembleRuntimeInstructions } from "@workspace/agent-runtime";
import type { SpecialistOrganisationContext } from "@workspace/agent-runtime";
import { SPECIALISTS } from "../lib/workforceRegistry.js";
import { getWorkerProfileByCode } from "../lib/workerProfileRegistry.js";
import {
  compileSpecialistManifest,
  resolveAndCompileManifest,
} from "../services/specialistRuntimeManifestService.js";
import { assembleCanonicalTaskRuntimeInstruction } from "../services/unifiedExecutionEngine.js";
import type { ResolvedDNA, ResolvedOrgContext } from "../services/dnaStorageService.js";
import { validateBlueprintRuntimeCompletion } from "../services/blueprintRuntimeValidationService.js";

function readSprint31Migration(): string {
  const candidates = [
    resolve(process.cwd(), "../../lib/db/migrations/sprint31-canonical-workforce-dna.sql"),
    resolve(process.cwd(), "lib/db/migrations/sprint31-canonical-workforce-dna.sql"),
  ];
  const migrationPath = candidates.find(candidate => existsSync(candidate));
  if (!migrationPath) {
    throw new Error("Sprint 31 migration not found");
  }
  return readFileSync(migrationPath, "utf8");
}

interface SimulatedDnaRow {
  specialist_id: string;
  status: string;
  dna_id?: string | null;
  owner_type?: string | null;
  visibility_tier?: string | null;
  approved_by?: string | null;
  published_by?: string | null;
  change_reason?: string | null;
  change_description?: string | null;
  effective_from?: string | null;
  published_at?: string | null;
  created_at: string;
  immutable_published_snapshot?: boolean | null;
}

function simulateSprint31Backfill(
  rows: SimulatedDnaRow[],
  columns: { publishedBy: boolean; changeDescription: boolean },
): SimulatedDnaRow[] {
  return rows.map(row => {
    const next: SimulatedDnaRow = { ...row };
    next.dna_id = next.dna_id ?? next.specialist_id;
    next.owner_type = next.owner_type && next.owner_type !== "" ? next.owner_type : "platform";
    next.visibility_tier = next.visibility_tier && next.visibility_tier !== ""
      ? next.visibility_tier
      : "platform_private";
    next.effective_from = next.effective_from ?? next.published_at ?? next.created_at;
    next.immutable_published_snapshot = next.status === "published"
      ? true
      : next.immutable_published_snapshot;
    if (columns.publishedBy && next.approved_by == null) {
      next.approved_by = next.published_by ?? null;
    }
    if (columns.changeDescription && next.change_reason == null) {
      next.change_reason = next.change_description ?? null;
    }
    return next;
  });
}

function resolvedFromCanonical(dna: WorkforceDNA): ResolvedDNA {
  return {
    dnaId: dna.versioning.dnaId,
    specialistId: dna.identity.specialistId,
    version: dna.versioning.version,
    versionHash: dna.versioning.versionHash,
    source: "database",
    domain: dna.identity.domainFamily,
    mission: dna.professionalMission.missionStatement,
    objectives: dna.professionalMission.successDefinition,
    responsibilities: dna.professionalMission.responsibilities,
    operatingPrinciples: dna.professionalPractice.practicePrinciples,
    communicationStyle: {
      tone: dna.communicationModel.tone,
      detailLevel: dna.communicationModel.detailLevel,
      language: dna.identity.displayName,
    },
    competencies: dna.domainExpertise.competencies.map(c => ({
      ...c,
      version: dna.versioning.version,
    })),
    escalationRules: dna.boundaryModel.humanReviewTriggers,
    prohibitedBehaviours: dna.boundaryModel.prohibitedBehaviours,
    memoryPolicy: {
      allowedScopes: dna.memoryBehaviour.relevantMemoryCategories,
      prohibitedScopes: dna.memoryBehaviour.memoryUseLimits,
    },
    canonicalProfile: dna,
    runtimeProjection: dna.runtimeProjection,
  };
}

function steps() {
  return [
    {
      sequence: 1,
      specialist: "chief_of_staff",
      action: "execute",
      description: "Coordinate the request.",
      requiresApproval: false,
    },
  ];
}

function constraints() {
  return {
    maxDurationSeconds: 300,
    requireHumanApprovalBeforeSubmit: false,
    allowedDataCategories: ["task_context"],
  };
}

describe("Canonical Workforce DNA Foundation", () => {
  it("maps Chief of Staff into canonical structured DNA without losing orchestration content", () => {
    const dna = getCanonicalDNAProfile("chief_of_staff");
    expect(dna).not.toBeNull();
    expect(dna?.identity.specialistKind).toBe("orchestrator");
    expect(dna?.professionalMission.missionStatement).toContain("Orchestrate");
    expect(dna?.reasoningModel.decisionMethodology.length).toBeGreaterThan(0);
    expect(dna?.evidenceModel.insufficientEvidenceBehaviour.length).toBeGreaterThan(0);
    expect(dna?.boundaryModel.humanReviewTriggers.length).toBeGreaterThan(0);
    expect(dna?.runtimeProjection.projectionVersion).toBe(CANONICAL_DNA_PROJECTION_VERSION);
  });

  it("maps Operations Manager as a normal professional specialist reference implementation", () => {
    const dna = getCanonicalDNAProfile("operations_manager");
    expect(dna).not.toBeNull();
    expect(dna?.identity.specialistKind).toBe("professional_specialist");
    expect(dna?.professionalMission.missionStatement).toContain("service delivery");
    expect(dna?.reasoningModel.decisionMethodology.some(step => step.stepId.startsWith("om."))).toBe(true);
    expect(dna?.requiredWorkerProfile.profileCode).toBe(OPERATIONS_MANAGER_DNA.requiredWorkerProfile.profileCode);
  });

  it("maps Executive Assistant as the current v2 support specialist", () => {
    const dna = getCanonicalDNAProfile("executive_assistant");
    expect(dna).not.toBeNull();
    expect(dna?.identity.specialistKind).toBe("support_specialist");
    expect(dna?.identity.specialistId).toBe("executive_assistant");
    expect(dna?.professionalMission.missionStatement).toContain("executive work is organised");
    expect(dna?.reasoningModel.decisionMethodology.some(step => step.stepId.startsWith("EA."))).toBe(true);
    expect(dna?.requiredWorkerProfile.profileCode).toBe(EXECUTIVE_ASSISTANT_DNA_V1.requiredWorkerProfile.profileCode);
  });

  it("maps Compliance & Quality Manager as the current v2 compliance specialist", () => {
    const dna = getCanonicalDNAProfile("compliance_quality_manager");
    expect(dna).not.toBeNull();
    expect(dna?.identity.specialistId).toBe("compliance_quality_manager");
    expect(dna?.professionalMission.missionStatement).toContain("compliance and quality-management assurance");
    expect(dna?.domainExpertise.competencies.length).toBeGreaterThanOrEqual(7);
    expect(dna?.reasoningModel.decisionMethodology.some(step => step.stepId.startsWith("cqm."))).toBe(true);
    expect(dna?.requiredWorkerProfile.profileCode).toBe(COMPLIANCE_QUALITY_MANAGER_DNA.requiredWorkerProfile.profileCode);
  });

  it("maps Authorised Program Officer as the current v2 restrictive-practice governance specialist", () => {
    const dna = getCanonicalDNAProfile("authorised_program_officer");
    expect(dna).not.toBeNull();
    expect(dna?.identity.specialistId).toBe("authorised_program_officer");
    expect(dna?.professionalMission.missionStatement).toContain("restrictive-practice governance");
    expect(dna?.domainExpertise.competencies.length).toBeGreaterThanOrEqual(9);
    expect(dna?.reasoningModel.decisionMethodology.some(step => step.stepId.startsWith("apo."))).toBe(true);
    expect(dna?.requiredWorkerProfile.profileCode).toBe(AUTHORISED_PROGRAM_OFFICER_DNA.requiredWorkerProfile.profileCode);
  });

  it("preserves Authorised Program Officer authority, evidence and memory discipline", () => {
    const manifest = compileSpecialistManifest("authorised_program_officer");
    const evidence = JSON.stringify(manifest.evidenceModel);
    const memory = [
      manifest.memoryBehaviour?.priorConclusionReliance,
      ...(manifest.memoryBehaviour?.memoryUseLimits ?? []),
      ...(manifest.memoryBehaviour?.reconsiderationTriggers ?? []),
    ].join(" ");
    const risk = manifest.riskAndUncertaintyModel?.highRiskTriggers.join(" ");
    const boundaries = [
      ...(manifest.boundaryModel?.outOfScopeDecisions ?? []),
      ...(manifest.boundaryModel?.prohibitedBehaviours ?? []),
      ...(manifest.boundaryModel?.mustNotRepresentAs ?? []),
    ].join(" ");

    expect(evidence).toContain("BSP presence treated as proof");
    expect(evidence).toContain("Previous monthly report treated as current compliance without revalidation");
    expect(evidence).toContain("RP register count conflicts");
    expect(memory).toContain("previous work packages");
    expect(memory).toContain("Information appears superseded");
    expect(risk).toContain("Possible unauthorised restrictive practice");
    expect(boundaries).toContain("Author or amend a formal Behaviour Support Plan");
    expect(boundaries).toContain("Treat memory, previous reports, BSP presence, samples or user assertions as current authority");
  });

  it("projects Authorised Program Officer runtime without adding technical authority", () => {
    const manifest = compileSpecialistManifest("authorised_program_officer");
    const profile = getWorkerProfileByCode("authorised_program_officer_profile");
    const result = assembleRuntimeInstructions(manifest, steps(), constraints());

    expect(result.instruction).toContain("A BSP entry does not prove each use was authorised");
    expect(result.instruction).toContain("monthly reporting outputs must reconcile evidence sources");
    expect(result.instruction).toContain("Use Blueprint requirements as professional competence or technical authority");
    expect(manifest.workerProfileReference?.profileCode).toBe("authorised_program_officer_profile");
    expect(profile?.allowedExecutionChannels).toEqual(["internal_api", "document_store", "database_query"]);
    expect(profile?.allowedConnectorCategories).toEqual(["document_management"]);
    expect((manifest as unknown as Record<string, unknown>)["allowedExecutionChannels"]).toBeUndefined();
  });

  it("maps Behaviour Support Implementation Specialist as the current v2 BSP implementation specialist", () => {
    const dna = getCanonicalDNAProfile("behaviour_support_implementation_specialist");
    expect(dna).not.toBeNull();
    expect(dna?.identity.specialistId).toBe("behaviour_support_implementation_specialist");
    expect(dna?.professionalMission.missionStatement).toContain("approved behaviour-support requirements");
    expect(dna?.domainExpertise.competencies.length).toBeGreaterThanOrEqual(9);
    expect(dna?.reasoningModel.decisionMethodology.some(step => step.stepId.startsWith("bsi."))).toBe(true);
    expect(dna?.requiredWorkerProfile.profileCode).toBe(BEHAVIOUR_SUPPORT_IMPLEMENTATION_SPECIALIST_DNA.requiredWorkerProfile.profileCode);
  });

  it("preserves Behaviour Support Implementation evidence, fidelity and practitioner-boundary discipline", () => {
    const manifest = compileSpecialistManifest("behaviour_support_implementation_specialist");
    const evidence = JSON.stringify(manifest.evidenceModel);
    const memory = [
      manifest.memoryBehaviour?.priorConclusionReliance,
      ...(manifest.memoryBehaviour?.memoryUseLimits ?? []),
      ...(manifest.memoryBehaviour?.reconsiderationTriggers ?? []),
    ].join(" ");
    const risk = manifest.riskAndUncertaintyModel?.highRiskTriggers.join(" ");
    const collaboration = [
      ...(manifest.collaborationModel?.deferToDomains ?? []),
      ...(manifest.collaborationModel?.cannotOverrideDomains ?? []),
    ].join(" ");
    const boundaries = [
      ...(manifest.boundaryModel?.outOfScopeDecisions ?? []),
      ...(manifest.boundaryModel?.prohibitedBehaviours ?? []),
      ...(manifest.boundaryModel?.mustNotRepresentAs ?? []),
    ].join(" ");

    expect(evidence).toContain("Not documented treated as proven not implemented");
    expect(evidence).toContain("Behaviour pattern treated as causal without evidence");
    expect(evidence).toContain("Strategy ineffectiveness used to rewrite the BSP");
    expect(memory).toContain("previous work packages");
    expect(memory).toContain("Information appears superseded");
    expect(risk).toContain("Implementation variance may increase safeguarding");
    expect(collaboration).toContain("credentialled Behaviour Support Practitioner");
    expect(boundaries).toContain("Author, amend, approve or represent an output as a formal Behaviour Support Plan");
    expect(boundaries).toContain("Treat memory, previous reviews, samples or user assertions as current participant/client evidence");
  });

  it("projects Behaviour Support Implementation runtime without adding practitioner or technical authority", () => {
    const manifest = compileSpecialistManifest("behaviour_support_implementation_specialist");
    const profile = getWorkerProfileByCode("behaviour_support_implementation_specialist_profile");
    const result = assembleRuntimeInstructions(manifest, steps(), constraints());

    expect(result.instruction).toContain("Not documented is not the same as proven not implemented");
    expect(result.instruction).toContain("strategy changes, BSP amendment and practitioner-level decisions must be deferred");
    expect(result.instruction).toContain("Use Blueprint requirements as professional competence or technical authority");
    expect(manifest.workerProfileReference?.profileCode).toBe("behaviour_support_implementation_specialist_profile");
    expect(profile?.allowedExecutionChannels).toEqual(["internal_api", "document_store", "database_query"]);
    expect(profile?.allowedConnectorCategories).toEqual(["document_management"]);
    expect((manifest as unknown as Record<string, unknown>)["allowedExecutionChannels"]).toBeUndefined();
  });

  it("preserves Compliance & Quality Manager evidence, memory and corrective-action discipline", () => {
    const manifest = compileSpecialistManifest("compliance_quality_manager");
    const evidence = JSON.stringify(manifest.evidenceModel);
    const memory = [
      manifest.memoryBehaviour?.priorConclusionReliance,
      ...(manifest.memoryBehaviour?.memoryUseLimits ?? []),
      ...(manifest.memoryBehaviour?.reconsiderationTriggers ?? []),
    ].join(" ");
    const risk = manifest.riskAndUncertaintyModel?.highRiskTriggers.join(" ");
    const boundaries = [
      ...(manifest.boundaryModel?.outOfScopeDecisions ?? []),
      ...(manifest.boundaryModel?.prohibitedBehaviours ?? []),
      ...(manifest.boundaryModel?.mustNotRepresentAs ?? []),
    ].join(" ");

    expect(evidence).toContain("Absence of evidence is not evidence of compliance");
    expect(evidence).toContain("Previous audit/report outcome treated as current without revalidation");
    expect(memory).toContain("Previous task outcomes may be reconsidered when new evidence conflicts");
    expect(memory).toContain("Information appears superseded");
    expect(risk).toContain("Corrective action closed without evidence");
    expect(boundaries).toContain("Make final legal determinations");
    expect(boundaries).toContain("Treat previous compliance conclusions, samples or memory as current truth");
  });

  it("projects Compliance & Quality Manager runtime without adding technical authority", () => {
    const manifest = compileSpecialistManifest("compliance_quality_manager");
    const profile = getWorkerProfileByCode("compliance_quality_manager_profile");
    const result = assembleRuntimeInstructions(manifest, steps(), constraints());

    expect(result.instruction).toContain("compliance and quality-management assurance");
    expect(result.instruction).toContain("Absence of evidence is not evidence of compliance");
    expect(result.instruction).toContain("Corrective action closure lacks effectiveness evidence");
    expect(result.instruction).toContain("Blueprint requirements as professional competence or technical authority");
    expect(manifest.workerProfileReference?.profileCode).toBe("compliance_quality_manager_profile");
    expect(profile?.allowedExecutionChannels).toEqual(["internal_api", "document_store", "database_query"]);
    expect(profile?.allowedConnectorCategories).toEqual(["document_management"]);
    expect((manifest as unknown as Record<string, unknown>)["allowedExecutionChannels"]).toBeUndefined();
  });

  it("maps Incident & Safeguarding Specialist as the current v2 incident specialist", () => {
    const dna = getCanonicalDNAProfile("incident_safeguarding_specialist");
    expect(dna).not.toBeNull();
    expect(dna?.identity.specialistId).toBe("incident_safeguarding_specialist");
    expect(dna?.professionalMission.missionStatement).toContain("incident and safeguarding work");
    expect(dna?.domainExpertise.competencies.length).toBeGreaterThanOrEqual(7);
    expect(dna?.reasoningModel.decisionMethodology.some(step => step.stepId.startsWith("iss."))).toBe(true);
    expect(dna?.requiredWorkerProfile.profileCode).toBe(INCIDENT_SAFEGUARDING_SPECIALIST_DNA.requiredWorkerProfile.profileCode);
  });

  it("preserves Incident & Safeguarding fact, chronology, memory and closure discipline", () => {
    const manifest = compileSpecialistManifest("incident_safeguarding_specialist");
    const evidence = JSON.stringify(manifest.evidenceModel);
    const memory = [
      manifest.memoryBehaviour?.priorConclusionReliance,
      ...(manifest.memoryBehaviour?.memoryUseLimits ?? []),
      ...(manifest.memoryBehaviour?.reconsiderationTriggers ?? []),
    ].join(" ");
    const risk = manifest.riskAndUncertaintyModel?.highRiskTriggers.join(" ");
    const boundaries = [
      ...(manifest.boundaryModel?.outOfScopeDecisions ?? []),
      ...(manifest.boundaryModel?.prohibitedBehaviours ?? []),
      ...(manifest.boundaryModel?.mustNotRepresentAs ?? []),
    ].join(" ");

    expect(evidence).toContain("Allegation treated as established fact");
    expect(evidence).toContain("Observation merged with interpretation");
    expect(evidence).toContain("Chronology lacks source, timestamp or sequence evidence");
    expect(evidence).toContain("Missing evidence used to imply the event did not occur");
    expect(memory).toContain("Previous task outcomes may be reconsidered when new evidence conflicts");
    expect(memory).toContain("Information appears superseded");
    expect(risk).toContain("Potential abuse, neglect, exploitation");
    expect(boundaries).toContain("Make final legal or regulatory reportability determinations");
    expect(boundaries).toContain("Treat allegations, memory, previous incident conclusions or samples as current established truth");
  });

  it("projects Incident & Safeguarding runtime without adding technical authority", () => {
    const manifest = compileSpecialistManifest("incident_safeguarding_specialist");
    const profile = getWorkerProfileByCode("incident_safeguarding_specialist_profile");
    const result = assembleRuntimeInstructions(manifest, steps(), constraints());

    expect(result.instruction).toContain("Immediate safeguarding and safety risk");
    expect(result.instruction).toContain("Allegation treated as established fact");
    expect(result.instruction).toContain("closure-readiness recommendations must preserve unresolved material uncertainty");
    expect(result.instruction).toContain("Blueprint requirements as professional competence or technical authority");
    expect(manifest.workerProfileReference?.profileCode).toBe("incident_safeguarding_specialist_profile");
    expect(profile?.allowedExecutionChannels).toEqual(["internal_api", "document_store", "database_query"]);
    expect(profile?.allowedConnectorCategories).toEqual(["document_management"]);
    expect((manifest as unknown as Record<string, unknown>)["allowedExecutionChannels"]).toBeUndefined();
  });

  it("preserves Executive Assistant evidence, memory, collaboration and Blueprint boundaries", () => {
    const manifest = compileSpecialistManifest("executive_assistant");
    const evidence = JSON.stringify(manifest.evidenceModel?.sourcePreference);
    const memory = [
      manifest.memoryBehaviour?.priorConclusionReliance,
      ...(manifest.memoryBehaviour?.memoryUseLimits ?? []),
      ...(manifest.memoryBehaviour?.reconsiderationTriggers ?? []),
    ].join(" ");
    const collaboration = [
      ...(manifest.collaborationModel?.deferToDomains ?? []),
      ...(manifest.collaborationModel?.challengeConditions ?? []),
      ...(manifest.collaborationModel?.cannotOverrideDomains ?? []),
    ].join(" ");
    const boundaries = [
      ...(manifest.boundaryModel?.outOfScopeDecisions ?? []),
      ...(manifest.boundaryModel?.prohibitedBehaviours ?? []),
      ...(manifest.boundaryModel?.mustNotRepresentAs ?? []),
    ].join(" ");

    expect(evidence).toContain("Approved policies, procedures and templates outrank samples");
    expect(evidence).toContain("Examples, samples and previous work must be labelled as precedent/context");
    expect(memory).toContain("May use previous work packages as context");
    expect(memory).toContain("Current evidence conflicts with historical memory");
    expect(memory).toContain("Information appears superseded");
    expect(collaboration).toContain("domain-owning specialist");
    expect(collaboration).toContain("Conflicting instructions from multiple executives");
    expect(boundaries).toContain("Blueprint requirements as granting professional competence or technical authority");
    expect(boundaries).toContain("Treat previous work products, samples or memory as current authoritative organisational truth");
  });

  it("projects Executive Assistant current-v2 behaviour into runtime instructions without adding technical authority", () => {
    const manifest = compileSpecialistManifest("executive_assistant");
    const profile = getWorkerProfileByCode("executive_assistant_profile");
    const result = assembleRuntimeInstructions(manifest, steps(), constraints());

    expect(result.instruction).toContain("Approved policies, procedures and templates outrank samples");
    expect(result.instruction).toContain("Historical memory may inform administrative judgement");
    expect(result.instruction).toContain("Blueprint requirements as granting professional competence or technical authority");
    expect(result.instruction).toContain("domain-owning specialist");
    expect(manifest.workerProfileReference?.profileCode).toBe("executive_assistant_profile");
    expect(profile?.allowedExecutionChannels).toEqual(["internal_api", "calendar_system", "email_system"]);
    expect(profile?.approvalRequiredActions).toContain("send_email_on_behalf_of_user");
    expect((manifest as unknown as Record<string, unknown>)["allowedExecutionChannels"]).toBeUndefined();
  });

  it("preserves refined Operations Manager collaboration and deference boundaries", () => {
    const manifest = compileSpecialistManifest("operations_manager");
    const deferTo = manifest.collaborationModel?.deferToDomains.join(" ");
    const challenge = manifest.collaborationModel?.challengeConditions.join(" ");
    const cannotOverride = manifest.collaborationModel?.cannotOverrideDomains.join(" ");
    const disagreement = manifest.collaborationModel?.disagreementEscalation.join(" ");

    expect(deferTo).toContain("domain-owning specialist");
    expect(deferTo).toContain("Chief of Staff");
    expect(deferTo).toContain("regulatory interpretation");
    expect(challenge).toContain("unsupported or operationally impractical advice");
    expect(cannotOverride).toContain("domain-owning specialist");
    expect(disagreement).toContain("flag_and_continue");
  });

  it("preserves Operations Manager cross-domain operational impact and risk-based review", () => {
    const manifest = compileSpecialistManifest("operations_manager");
    const highRisk = manifest.riskAndUncertaintyModel?.highRiskTriggers.join(" ");
    const escalation = manifest.riskAndUncertaintyModel?.escalationThresholds.join(" ");
    const boundaries = manifest.boundaryModel?.outOfScopeDecisions.join(" ");

    expect(highRisk).toContain("staffing pressure");
    expect(highRisk).toContain("workload/capacity risk");
    expect(highRisk).toContain("irreversible operational consequence");
    expect(escalation).toContain("valid recommendation from another professional domain");
    expect(escalation).toContain("Independent specialist review is proportionate");
    expect(boundaries).toContain("determinations that belong to another professional domain");
  });

  it("preserves Operations Manager memory freshness and current evidence precedence", () => {
    const manifest = compileSpecialistManifest("operations_manager");
    const categories = manifest.memoryBehaviour?.relevantMemoryCategories.join(" ");
    const reliance = manifest.memoryBehaviour?.priorConclusionReliance;
    const limits = manifest.memoryBehaviour?.memoryUseLimits.join(" ");
    const reconsideration = manifest.memoryBehaviour?.reconsiderationTriggers.join(" ");
    const contradictions = manifest.reasoningModel?.contradictionHandling.join(" ");

    expect(categories).toContain("staffing_availability");
    expect(categories).toContain("previous_operational_plans");
    expect(reliance).toContain("previous work packages as context");
    expect(limits).toContain("historical rosters");
    expect(limits).toContain("current truth without material revalidation");
    expect(reconsideration).toContain("Current evidence conflicts with historical memory");
    expect(contradictions).toContain("Current verified operational evidence takes precedence");
  });

  it("preserves Operations Manager regulatory source discipline without making it legal authority", () => {
    const manifest = compileSpecialistManifest("operations_manager");
    const sourcePreference = manifest.regulatoryAwareness?.authoritativeSourcePreference.join(" ");
    const citationExpectation = manifest.regulatoryAwareness?.citationExpectation;
    const boundaries = manifest.boundaryModel?.outOfScopeDecisions.join(" ");

    expect(manifest.regulatoryAwareness?.currentSourceRequired).toBe(true);
    expect(sourcePreference).toContain("current authoritative SCHADS");
    expect(sourcePreference).toContain("consult or defer");
    expect(citationExpectation).toContain("appropriate specialist");
    expect(boundaries).toContain("Legal determination of SCHADS entitlements");
    expect(boundaries).toContain("payroll");
  });

  it("keeps Operations Manager Blueprint interaction bounded by professional scope", () => {
    const manifest = compileSpecialistManifest("operations_manager");
    const dna = getCanonicalDNAProfile("operations_manager");
    const boundaries = manifest.boundaryModel?.mustNotRepresentAs.join(" ");
    const result = assembleRuntimeInstructions(manifest, steps(), constraints());

    expect(dna?.blueprintInteraction.mustFollowBlueprintContract).toBe(true);
    expect(dna?.blueprintInteraction.workProductBoundaryRespect).toContain("Do not replace Blueprint");
    expect(boundaries).toContain("Blueprint as granting Operations Manager professional competence");
    expect(result.instruction).toContain("### Blueprint behaviour");
    expect(result.instruction).toContain("Blueprint as granting Operations Manager professional competence");
  });

  it("projects refined Operations Manager behaviour into runtime instructions", () => {
    const manifest = compileSpecialistManifest("operations_manager");
    const result = assembleRuntimeInstructions(manifest, steps(), constraints());

    expect(result.instruction).toContain("domain-owning specialist");
    expect(result.instruction).toContain("staffing pressure");
    expect(result.instruction).toContain("current truth without material revalidation");
    expect(result.instruction).toContain("current authoritative SCHADS");
    expect(result.instruction).toContain("Independent specialist review is proportionate");
  });

  it("preserves Chief of Staff boundary and does not add Operations Manager execution authority", () => {
    const manifest = compileSpecialistManifest("operations_manager");
    const profile = getWorkerProfileByCode("operations_manager_profile");

    expect(manifest.collaborationModel?.deferToDomains.join(" ")).toContain("Chief of Staff");
    expect(manifest.professionalMission.nonResponsibilities.join(" ")).toContain("Enterprise strategy");
    expect(profile?.allowedExecutionChannels).toEqual(["internal_api", "database_query"]);
    expect(profile?.allowedToolCategories).toEqual(["data_tools", "reporting_tools"]);
    expect(profile?.allowedConnectorCategories).toEqual([]);
    expect((manifest as unknown as Record<string, unknown>)["allowedExecutionChannels"]).toBeUndefined();
  });

  it("UEE task runtime uses canonical SRM sections for a specialist without requiring an Employee File", async () => {
    mockLoadDNAWithStaticFallback.mockResolvedValueOnce(
      resolvedFromCanonical(mapLegacyDNAProfileToWorkforceDNA(OPERATIONS_MANAGER_DNA)),
    );
    mockLoadOrgSpecialistConfig.mockResolvedValueOnce(null);

    const result = await assembleCanonicalTaskRuntimeInstruction({
      specialistCode: "operations_manager",
      organizationId: "org-1",
      userRequest: "Prepare an operational capacity review.",
      manifest: {
        id: "manifest-1",
        executionId: "exec-1",
        organizationId: "org-1",
        primarySpecialist: "operations_manager",
        supportingSpecialists: [],
        organisationLibrarySources: [],
        cosMemories: [],
        specialistMemories: [],
        taskUploads: [],
        entityKnowledge: {},
        blueprintId: null,
        blueprintVersion: null,
        modelVersion: null,
        promptVersion: "1.0.0",
        assembledAt: new Date(),
      },
      blueprint: null,
      blueprintContract: null,
      evidencePack: null,
    });

    expect(result.systemPrompt).toContain("# SPECIALIST IDENTITY");
    expect(result.systemPrompt).toContain("## PROFESSIONAL PRACTICE");
    expect(result.systemPrompt).toContain("## REASONING");
    expect(result.systemPrompt).toContain("## EVIDENCE");
    expect(result.systemPrompt).toContain("## PROFESSIONAL BOUNDARIES");
    expect(result.systemPrompt).toContain("## RISK AND UNCERTAINTY");
    expect(result.systemPrompt).toContain("## COLLABORATION");
    expect(result.systemPrompt).toContain("### Memory behaviour");
    expect(result.systemPrompt).toContain("### Regulatory awareness");
    expect(result.systemPrompt).toContain("### Organisation context use");
    expect(result.systemPrompt).toContain("### Blueprint behaviour");
    expect(result.systemPrompt).toContain("RUNTIME CONTEXT ORDER AND TRUST BOUNDARIES");
    expect(result.systemPrompt).not.toContain("Employee File");
    expect(result.dnaVersion).toBe(OPERATIONS_MANAGER_DNA.currentVersion.version);
  });

  it("preserves fields previously dropped before SpecialistRuntimeManifest", () => {
    const manifest = compileSpecialistManifest("chief_of_staff");
    expect(manifest.dnaVersionHash).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.runtimeProjectionVersion).toBe(CANONICAL_DNA_PROJECTION_VERSION);
    expect(manifest.reasoningModel?.decisionMethodology.length).toBeGreaterThan(0);
    expect(manifest.evidenceModel?.sourcePreference.length).toBeGreaterThan(0);
    expect(manifest.professionalPractice?.qualityStandards.length).toBeGreaterThan(0);
    expect(manifest.boundaryModel?.prohibitedBehaviours).toEqual(CHIEF_OF_STAFF_DNA.professionalBoundaries.cannotDo);
    expect(manifest.riskAndUncertaintyModel?.highRiskTriggers).toEqual(CHIEF_OF_STAFF_DNA.riskTolerance.escalationFactors);
    expect(manifest.collaborationModel?.challengeConditions.length).toBeGreaterThan(0);
  });

  it("compiles canonical DNA from DB-resolved DNA through the same manifest projection", async () => {
    const canonical = mapLegacyDNAProfileToWorkforceDNA(CHIEF_OF_STAFF_DNA);
    mockLoadDNAWithStaticFallback.mockResolvedValueOnce(resolvedFromCanonical(canonical));
    mockLoadOrgSpecialistConfig.mockResolvedValueOnce(null);

    const manifest = await resolveAndCompileManifest("chief_of_staff");

    expect(manifest.dnaSource).toBe("database");
    expect(manifest.dnaVersionHash).toBe(canonical.versioning.versionHash);
    expect(manifest.reasoningModel?.decisionMethodology[0]?.stepId).toBe("cos.1.intent_analysis");
    expect(manifest.evidenceModel?.factualClaimDiscipline).toContain("Do not invent evidence references.");
  });

  it("assembles canonical runtime instruction sections deliberately", () => {
    const manifest = compileSpecialistManifest("chief_of_staff");
    const result = assembleRuntimeInstructions(manifest, steps(), constraints());
    expect(result.instruction).toContain("## PROFESSIONAL PRACTICE");
    expect(result.instruction).toContain("## REASONING");
    expect(result.instruction).toContain("## EVIDENCE");
    expect(result.instruction).toContain("## PROFESSIONAL BOUNDARIES");
    expect(result.instruction).toContain("## RISK AND UNCERTAINTY");
    expect(result.instruction).toContain("## COLLABORATION");
    expect(result.instruction).toContain("### Blueprint behaviour");
  });

  it("codifies Chief of Staff specialist deference without surrendering evidence challenge", () => {
    const manifest = compileSpecialistManifest("chief_of_staff");
    const deference = manifest.collaborationModel?.deferToDomains.join(" ");
    const challenge = manifest.collaborationModel?.challengeConditions.join(" ");
    const nonOverride = manifest.collaborationModel?.cannotOverrideDomains.join(" ");

    expect(deference).toContain("domain-owning specialist");
    expect(deference).toContain("adequately evidenced");
    expect(challenge).toContain("unsupported");
    expect(challenge).toContain("outside the specialist's authority");
    expect(nonOverride).toContain("Adequately evidenced domain-owning specialist conclusions");
    expect(manifest.boundaryModel?.prohibitedBehaviours).toContain("Treat orchestration authority as domain authority");
  });

  it("preserves and escalates material specialist disagreement rather than manufacturing consensus", () => {
    const manifest = compileSpecialistManifest("chief_of_staff");
    const disagreement = manifest.collaborationModel?.disagreementEscalation.join(" ");
    const risk = manifest.riskAndUncertaintyModel?.escalationThresholds.join(" ");
    const communication = manifest.communicationModel?.structurePreference;

    expect(disagreement).toContain("Preserve genuine unresolved professional disagreement");
    expect(disagreement).toContain("do not manufacture consensus");
    expect(disagreement).toContain("reliable completion");
    expect(risk).toContain("Material specialist disagreement affects safety");
    expect(communication).toContain("preserve the disagreement");
  });

  it("makes specialist consultation and peer review proportionate to domain risk and materiality", () => {
    const manifest = compileSpecialistManifest("chief_of_staff");
    const canConsult = manifest.collaborationModel?.canConsultDomains.join(" ");
    const shouldConsult = manifest.collaborationModel?.shouldConsultDomains.join(" ");
    const peerReview = manifest.collaborationModel?.peerReviewByDomains.join(" ");

    expect(canConsult).toContain("professional knowledge outside orchestration competence");
    expect(shouldConsult).toContain("Multiple professional domains materially intersect");
    expect(peerReview).toContain("high-consequence");
    expect(peerReview).toContain("Do not make peer review automatic");
  });

  it("treats memory as context requiring freshness and supersession discipline", () => {
    const manifest = compileSpecialistManifest("chief_of_staff");
    const reliance = manifest.memoryBehaviour?.priorConclusionReliance;
    const triggers = manifest.memoryBehaviour?.reconsiderationTriggers.join(" ");
    const limits = manifest.memoryBehaviour?.memoryUseLimits.join(" ");

    expect(reliance).toContain("Memory informs current reasoning");
    expect(reliance).toContain("does not automatically establish current truth");
    expect(reliance).toContain("A previous assumption must not become a fact");
    expect(triggers).toContain("Current evidence conflicts with historical memory");
    expect(triggers).toContain("Information appears superseded");
    expect(limits).toContain("Do not silently prefer memory over current authoritative evidence");
  });

  it("clarifies regulatory awareness without turning Chief of Staff into a regulatory specialist", () => {
    const manifest = compileSpecialistManifest("chief_of_staff");
    const dna = getCanonicalDNAProfile("chief_of_staff");
    const sourcePreference = manifest.regulatoryAwareness?.authoritativeSourcePreference.join(" ");
    const citationExpectation = manifest.regulatoryAwareness?.citationExpectation;

    expect(sourcePreference).toContain("Recognise material regulatory implications");
    expect(sourcePreference).toContain("route or defer");
    expect(sourcePreference).toContain("Do not become the regulatory authority");
    expect(citationExpectation).toContain("route or defer to the appropriate specialist");
    expect(dna?.domainExpertise.domains.join(" ")).toContain("executive");
    expect(dna?.domainExpertise.domains.join(" ")).not.toContain("legal");
  });

  it("projects the refined collaboration and memory behaviours into runtime instructions", () => {
    const manifest = compileSpecialistManifest("chief_of_staff");
    const result = assembleRuntimeInstructions(manifest, steps(), constraints());

    expect(result.instruction).toContain("Any active domain-owning specialist");
    expect(result.instruction).toContain("Preserve genuine unresolved professional disagreement");
    expect(result.instruction).toContain("Do not make peer review automatic");
    expect(result.instruction).toContain("Memory informs current reasoning");
    expect(result.instruction).toContain("Do not become the regulatory authority");
  });

  it("keeps organisation context separate from canonical DNA", () => {
    const manifest = compileSpecialistManifest("chief_of_staff");
    const orgContext: SpecialistOrganisationContext = {
      specialistConfig: {
        goals: ["Use MH&R local procedure ABC for this task"],
        preferredStyle: "plain English",
        escalationContacts: [{ name: "Local Manager", role: "Operations" }],
        additionalContext: { businessType: "Disability provider" },
      },
    };
    const result = assembleRuntimeInstructions(manifest, steps(), constraints(), orgContext);

    expect(JSON.stringify(manifest)).not.toContain("MH&R local procedure ABC");
    expect(result.instruction).toContain("[ORGANISATION-PROVIDED CONTEXT]");
    expect(result.instruction).toContain("MH&R local procedure ABC");
  });

  it("does not let DNA grant execution permissions denied by WorkerProfile", () => {
    const manifest = compileSpecialistManifest("chief_of_staff");
    const profile = getWorkerProfileByCode("chief_of_staff_profile");

    expect(manifest.workerProfileReference?.profileCode).toBe(CHIEF_OF_STAFF_DNA.requiredWorkerProfile.profileCode);
    expect(profile?.allowedExecutionChannels).toEqual(["internal_api"]);
    expect(profile?.prohibitedActions).toContain("send_external_communication");
    expect((manifest as unknown as Record<string, unknown>)["allowedExecutionChannels"]).toBeUndefined();
    expect((manifest as unknown as Record<string, unknown>)["allowedConnectorCategories"]).toBeUndefined();
  });

  it("does not let DNA override Blueprint completion gates", () => {
    const canonical = getCanonicalDNAProfile("chief_of_staff");
    expect(canonical?.blueprintInteraction.mustFollowBlueprintContract).toBe(true);

    const result = validateBlueprintRuntimeCompletion({
      contract: {
        blueprint: {
          deliverableContract: {
            artifactRequired: true,
            templateRequired: true,
            primaryDeliverable: "test_document",
          },
          evidenceContract: {
            minimumEvidenceCount: 1,
            missingEvidenceBehaviour: "block_completion",
          },
          templateRequired: true,
        },
        sections: [],
        template: null,
      } as any,
      contentMarkdown: "## Draft\nText-only draft.",
      rawClaims: [],
      evidencePack: null,
      artifactId: null,
    });

    expect(result.failures.some(f => f.gate === "artifact_required")).toBe(true);
    expect(result.failures.some(f => f.gate === "template_required")).toBe(true);
    expect(result.failures.some(f => f.gate === "missing_evidence")).toBe(true);
  });

  it("returns tenant-safe descriptors without private DNA internals", () => {
    const descriptor = getSafeDNADescriptor("chief_of_staff");
    expect(descriptor).toMatchObject({
      specialistId: "chief_of_staff",
      title: "Chief of Staff",
      availability: "available",
    });
    expect((descriptor as unknown as Record<string, unknown>)["reasoningModel"]).toBeUndefined();
    expect((descriptor as unknown as Record<string, unknown>)["evidenceModel"]).toBeUndefined();
    expect((descriptor as unknown as Record<string, unknown>)["collaborationModel"]).toBeUndefined();
    expect((descriptor as unknown as Record<string, unknown>)["compiledInstructions"]).toBeUndefined();
  });

  it("keeps current DNA-pending v2 specialists from silently receiving production DNA", () => {
    const pending = SPECIALISTS.filter(s =>
      s.executionStatus === "dna_pending" || s.dnaStatus === "pending_design",
    );
    expect(pending.length).toBeGreaterThanOrEqual(7);
    expect(pending.some(s => s.code === "compliance_quality_manager")).toBe(false);
    expect(pending.some(s => s.code === "incident_safeguarding_specialist")).toBe(false);
    expect(pending.some(s => s.code === "authorised_program_officer")).toBe(false);
    expect(pending.some(s => s.code === "behaviour_support_implementation_specialist")).toBe(false);
    expect(pending.some(s => s.code === "policy_governance_specialist")).toBe(false);
    expect(pending.some(s => s.code === "service_delivery_coordinator")).toBe(false);
    expect(pending.some(s => s.code === "workforce_rostering_coordinator")).toBe(false);
    expect(pending.some(s => s.code === "workforce_compliance_specialist")).toBe(false);
    expect(pending.some(s => s.code === "payroll_workforce_cost_officer")).toBe(false);
    expect(pending.some(s => s.code === "executive_assistant")).toBe(false);
    expect(getCanonicalDNAProfile("authorised_program_officer")).not.toBeNull();
    expect(getSafeDNADescriptor("authorised_program_officer")).not.toBeNull();
    expect(getCanonicalDNAProfile("behaviour_support_implementation_specialist")).not.toBeNull();
    expect(getSafeDNADescriptor("behaviour_support_implementation_specialist")).not.toBeNull();
    expect(getCanonicalDNAProfile("compliance_quality_manager")).not.toBeNull();
    expect(getSafeDNADescriptor("compliance_quality_manager")).not.toBeNull();
    expect(getCanonicalDNAProfile("policy_governance_specialist")).not.toBeNull();
    expect(getSafeDNADescriptor("policy_governance_specialist")).not.toBeNull();
    expect(getCanonicalDNAProfile("service_delivery_coordinator")).not.toBeNull();
    expect(getSafeDNADescriptor("service_delivery_coordinator")).not.toBeNull();
    expect(getCanonicalDNAProfile("workforce_rostering_coordinator")).not.toBeNull();
    expect(getSafeDNADescriptor("workforce_rostering_coordinator")).not.toBeNull();
    expect(getCanonicalDNAProfile("workforce_compliance_specialist")).not.toBeNull();
    expect(getSafeDNADescriptor("workforce_compliance_specialist")).not.toBeNull();
  });

  it("maps Workforce Rostering Coordinator as the current v2 roster construction specialist", () => {
    const dna = getCanonicalDNAProfile("workforce_rostering_coordinator");
    expect(dna).not.toBeNull();
    expect(dna?.identity.specialistId).toBe("workforce_rostering_coordinator");
    expect(dna?.professionalMission.missionStatement).toContain("verified coverage requirements");
    expect(dna?.domainExpertise.competencies.length).toBeGreaterThanOrEqual(10);
    expect(dna?.requiredWorkerProfile.profileCode).toBe(WORKFORCE_ROSTERING_COORDINATOR_DNA.requiredWorkerProfile.profileCode);
  });

  it("maps Workforce Compliance Specialist as the current v2 worker compliance and eligibility specialist", () => {
    const dna = getCanonicalDNAProfile("workforce_compliance_specialist");
    expect(dna).not.toBeNull();
    expect(dna?.identity.specialistId).toBe("workforce_compliance_specialist");
    expect(dna?.professionalMission.missionStatement).toContain("workforce compliance requirements");
    expect(dna?.domainExpertise.competencies.length).toBeGreaterThanOrEqual(10);
    expect(dna?.requiredWorkerProfile.profileCode).toBe(WORKFORCE_COMPLIANCE_SPECIALIST_DNA.requiredWorkerProfile.profileCode);
  });

  it("maps Service Delivery Coordinator as the current v2 service implementation specialist", () => {
    const dna = getCanonicalDNAProfile("service_delivery_coordinator");
    expect(dna).not.toBeNull();
    expect(dna?.identity.specialistId).toBe("service_delivery_coordinator");
    expect(dna?.professionalMission.missionStatement).toContain("approved service");
    expect(dna?.domainExpertise.competencies.length).toBeGreaterThanOrEqual(9);
    expect(dna?.requiredWorkerProfile.profileCode).toBe(SERVICE_DELIVERY_COORDINATOR_DNA.requiredWorkerProfile.profileCode);
  });

  it("maps Policy & Governance Specialist as the current v2 policy/governance specialist", () => {
    const dna = getCanonicalDNAProfile("policy_governance_specialist");
    expect(dna).not.toBeNull();
    expect(dna?.identity.specialistId).toBe("policy_governance_specialist");
    expect(dna?.professionalMission.missionStatement).toContain("policy architecture");
    expect(dna?.domainExpertise.competencies.length).toBeGreaterThanOrEqual(9);
    expect(dna?.reasoningModel.decisionMethodology.some(step => step.stepId.startsWith("pgs."))).toBe(true);
    expect(dna?.requiredWorkerProfile.profileCode).toBe(POLICY_GOVERNANCE_SPECIALIST_DNA.requiredWorkerProfile.profileCode);
  });

  it("uses deterministic manifest hash for the same canonical DNA version", () => {
    const a = compileSpecialistManifest("chief_of_staff");
    const b = compileSpecialistManifest("chief_of_staff");
    expect(a.dnaVersionHash).toBe(b.dnaVersionHash);
    expect(a.manifestHash).toBe(b.manifestHash);
  });

  it("records canonical lifecycle and immutable published version metadata", () => {
    const dna = getCanonicalDNAProfile("operations_manager");
    expect(dna?.governance.ownerType).toBe("platform");
    expect(dna?.governance.status).toBe("published");
    expect(dna?.versioning.immutablePublishedSnapshot).toBe(true);
    expect(dna?.versioning.versionHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("keeps Sprint 31 migration safe when legacy publisher/change columns are absent", () => {
    const migration = readSprint31Migration();
    const baseUpdate = migration.slice(0, migration.indexOf("DO $$"));
    const conditionalBlock = migration.slice(migration.indexOf("DO $$"));

    expect(baseUpdate).not.toContain("published_by");
    expect(baseUpdate).not.toContain("change_description");
    expect(conditionalBlock).toContain("column_name = 'published_by'");
    expect(conditionalBlock).toContain("column_name = 'change_description'");
    expect(conditionalBlock).toContain("EXECUTE $sql$");
    expect(migration).not.toMatch(/DROP\s+COLUMN/i);
    expect(migration).not.toMatch(/DROP\s+TABLE/i);

    const result = simulateSprint31Backfill([
      {
        specialist_id: "chief_of_staff",
        status: "published",
        created_at: "2026-08-12T00:00:00Z",
      },
    ], { publishedBy: false, changeDescription: false });

    expect(result[0]).toMatchObject({
      dna_id: "chief_of_staff",
      owner_type: "platform",
      visibility_tier: "platform_private",
      effective_from: "2026-08-12T00:00:00Z",
      immutable_published_snapshot: true,
    });
    expect(result[0]?.approved_by).toBeUndefined();
    expect(result[0]?.change_reason).toBeUndefined();
  });

  it("backfills Sprint 31 canonical fields from legacy columns only when they exist", () => {
    const result = simulateSprint31Backfill([
      {
        specialist_id: "operations_manager",
        status: "published",
        created_at: "2026-08-10T00:00:00Z",
        published_at: "2026-08-11T00:00:00Z",
        published_by: "legacy-publisher",
        change_description: "legacy change summary",
      },
    ], { publishedBy: true, changeDescription: true });

    expect(result[0]?.approved_by).toBe("legacy-publisher");
    expect(result[0]?.change_reason).toBe("legacy change summary");
    expect(result[0]?.effective_from).toBe("2026-08-11T00:00:00Z");
  });

  it("does not overwrite existing Sprint 31 canonical approved_by/change_reason values", () => {
    const result = simulateSprint31Backfill([
      {
        specialist_id: "chief_of_staff",
        status: "published",
        created_at: "2026-08-10T00:00:00Z",
        approved_by: "canonical-approver",
        published_by: "legacy-publisher",
        change_reason: "canonical reason",
        change_description: "legacy reason",
      },
    ], { publishedBy: true, changeDescription: true });

    expect(result[0]?.approved_by).toBe("canonical-approver");
    expect(result[0]?.change_reason).toBe("canonical reason");
  });

  it("keeps Sprint 31 migration safe for empty tables, existing canonical columns and reruns", () => {
    expect(simulateSprint31Backfill([], { publishedBy: false, changeDescription: false })).toEqual([]);

    const first = simulateSprint31Backfill([
      {
        specialist_id: "chief_of_staff",
        status: "published",
        dna_id: "custom-dna-id",
        owner_type: "platform",
        visibility_tier: "platform_private",
        approved_by: "approver",
        change_reason: "reason",
        effective_from: "2026-08-12T00:00:00Z",
        created_at: "2026-08-10T00:00:00Z",
        immutable_published_snapshot: true,
      },
    ], { publishedBy: true, changeDescription: true });
    const second = simulateSprint31Backfill(first, { publishedBy: true, changeDescription: true });

    expect(second).toEqual(first);
    expect(second[0]).toMatchObject({
      dna_id: "custom-dna-id",
      approved_by: "approver",
      change_reason: "reason",
      immutable_published_snapshot: true,
    });
  });
});
