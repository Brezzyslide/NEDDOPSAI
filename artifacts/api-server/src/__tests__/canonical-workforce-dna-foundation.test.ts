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
  getCanonicalDNAProfile,
  getSafeDNADescriptor,
  mapLegacyDNAProfileToWorkforceDNA,
  CHIEF_OF_STAFF_DNA,
  OPERATIONS_MANAGER_DNA,
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
    expect(pending.length).toBeGreaterThanOrEqual(15);
    expect(pending.some(s => s.code === "compliance_quality_manager")).toBe(true);
    expect(getCanonicalDNAProfile("compliance_quality_manager")).toBeNull();
    expect(getSafeDNADescriptor("compliance_quality_manager", "pending")).toBeNull();
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
