import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../../../..");

function source(path: string): string {
  return readFileSync(resolve(ROOT, path), "utf8");
}

function scopedPublisherSource(): string {
  const text = source("artifacts/api-server/src/services/workBlueprintService.ts");
  const start = text.indexOf("export async function publishScopedRegistryBlueprint");
  const end = text.indexOf("/**\n * Seed broad deterministic intent mappings", start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return text.slice(start, end);
}

function dateIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function comparableBlueprint(blueprint: {
  id: string;
  organizationId: string | null;
  code: string;
  title: string;
  version: string;
  contentHash?: string | null;
  blueprintFamily: string | null;
  supportedModes: string[];
  maturityState: string;
  ownerType: string;
  purpose: string | null;
  primaryDeliverable: string | null;
  deliverableContract: unknown;
  evidenceContract: unknown;
  permittedOrgOverrides: unknown;
  defaultTemplateId: string | null;
  templateRequired: boolean;
  allowedOrgTemplateOverride: boolean;
  templateVersionPolicy: string;
  status: string;
  objective: string;
  primarySpecialist: string;
  supportingSpecialists: string[];
  requiredLibraryKnowledge: string[];
  requiredEntityKnowledge: unknown;
  requiredMemories: string[];
  requiredApprovals: unknown;
  validationRules: unknown[];
  qualityRules: unknown[];
  successCriteria: string[];
  outputTypes: string[];
  escalationRules: unknown[];
  mandatoryCitations: string[];
  isBuiltIn: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}): Record<string, unknown> {
  return {
    id: blueprint.id,
    organizationId: blueprint.organizationId,
    code: blueprint.code,
    title: blueprint.title,
    version: blueprint.version,
    contentHash: blueprint.contentHash ?? null,
    blueprintFamily: blueprint.blueprintFamily,
    supportedModes: blueprint.supportedModes,
    maturityState: blueprint.maturityState,
    ownerType: blueprint.ownerType,
    purpose: blueprint.purpose,
    primaryDeliverable: blueprint.primaryDeliverable,
    deliverableContract: blueprint.deliverableContract,
    evidenceContract: blueprint.evidenceContract,
    permittedOrgOverrides: blueprint.permittedOrgOverrides,
    defaultTemplateId: blueprint.defaultTemplateId,
    templateRequired: blueprint.templateRequired,
    allowedOrgTemplateOverride: blueprint.allowedOrgTemplateOverride,
    templateVersionPolicy: blueprint.templateVersionPolicy,
    status: blueprint.status,
    objective: blueprint.objective,
    primarySpecialist: blueprint.primarySpecialist,
    supportingSpecialists: blueprint.supportingSpecialists,
    requiredLibraryKnowledge: blueprint.requiredLibraryKnowledge,
    requiredEntityKnowledge: blueprint.requiredEntityKnowledge,
    requiredMemories: blueprint.requiredMemories,
    requiredApprovals: blueprint.requiredApprovals,
    validationRules: blueprint.validationRules,
    qualityRules: blueprint.qualityRules,
    successCriteria: blueprint.successCriteria,
    outputTypes: blueprint.outputTypes,
    escalationRules: blueprint.escalationRules,
    mandatoryCitations: blueprint.mandatoryCitations,
    isBuiltIn: blueprint.isBuiltIn,
    isActive: blueprint.isActive,
    createdAt: dateIso(blueprint.createdAt),
    updatedAt: dateIso(blueprint.updatedAt),
  };
}

function comparableSection(section: {
  id: string;
  blueprintId: string;
  sectionCode: string;
  title: string;
  description: string | null;
  instructions: string | null;
  sectionRole: string | null;
  fixedContent: string[];
  fields: string[];
  completionPrompt: string | null;
  required: boolean;
  minimumContentExpectation: string | null;
  evidenceRequirements: Record<string, unknown>;
  allowedSourceTypes: string[];
  prohibitedAssumptions: string[];
  validationRules: unknown[];
  qualityCriteria: unknown[];
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}): Record<string, unknown> {
  return {
    id: section.id,
    blueprintId: section.blueprintId,
    sectionCode: section.sectionCode,
    title: section.title,
    description: section.description,
    instructions: section.instructions,
    sectionRole: section.sectionRole,
    fixedContent: section.fixedContent,
    fields: section.fields,
    completionPrompt: section.completionPrompt,
    required: section.required,
    minimumContentExpectation: section.minimumContentExpectation,
    evidenceRequirements: section.evidenceRequirements,
    allowedSourceTypes: section.allowedSourceTypes,
    prohibitedAssumptions: section.prohibitedAssumptions,
    validationRules: section.validationRules,
    qualityCriteria: section.qualityCriteria,
    sortOrder: section.sortOrder,
    createdAt: dateIso(section.createdAt),
    updatedAt: dateIso(section.updatedAt),
  };
}

describe("scoped registry blueprint publisher", () => {
  it("targets exactly one platform blueprint code and updates by row identity", () => {
    const publisher = scopedPublisherSource();

    expect(publisher).toContain("eq(workBlueprintsTable.code, entry.code)");
    expect(publisher).toContain("isNull(workBlueprintsTable.organizationId)");
    expect(publisher).toContain(".where(eq(workBlueprintsTable.id, currentBlueprint.id))");
    expect(publisher).not.toContain("for (const entry of BLUEPRINT_REGISTRY)");
    expect(publisher).not.toContain("seedBuiltInBlueprints(");
    expect(publisher).not.toContain("seedRegistryBlueprints(");
  });

  it("keeps section writes scoped to the selected blueprint row", () => {
    const publisher = scopedPublisherSource();

    expect(publisher).toContain("eq(blueprintSectionsTable.blueprintId, currentBlueprint.id)");
    expect(publisher).toContain("notInArray(blueprintSectionsTable.id, plan.expectedSectionIds)");
    expect(publisher).toContain("sectionToWritableValues(section, currentBlueprint.id, now)");
    expect(publisher).not.toContain("db.delete(workBlueprintsTable)");
  });

  it("dry-run returns the diff before any write path executes", () => {
    const publisher = scopedPublisherSource();
    const dryRunIndex = publisher.indexOf("if (dryRun)");
    const firstBlueprintUpdate = publisher.indexOf(".update(workBlueprintsTable)");
    const firstSectionDelete = publisher.indexOf("await db\n      .delete(blueprintSectionsTable)");

    expect(dryRunIndex).toBeGreaterThanOrEqual(0);
    expect(firstBlueprintUpdate).toBeGreaterThan(dryRunIndex);
    expect(firstSectionDelete).toBeGreaterThan(dryRunIndex);
    expect(publisher.slice(dryRunIndex, firstBlueprintUpdate)).toContain("wrote: false");
    expect(publisher.slice(dryRunIndex, firstBlueprintUpdate)).toContain("diff");
  });

  it("has an isolated CLI entry point that does not import db-bootstrap", () => {
    const script = source("artifacts/api-server/src/scripts/scoped-blueprint-publisher.ts");
    const build = source("artifacts/api-server/build.mjs");

    expect(script).toContain("publishScopedRegistryBlueprint");
    expect(script).toContain("restoreScopedBlueprintFromVerifiedArtifact");
    expect(script).toContain("--dry-run");
    expect(script).toContain("--apply");
    expect(script).toContain("--from-file");
    expect(script).not.toContain("db-bootstrap");
    expect(script).not.toContain("seedBuiltInBlueprints");
    expect(script).not.toContain("seedRegistryBlueprints");
    expect(build).toContain("src/scripts/scoped-blueprint-publisher.ts");
  });

  it("round-trips care_plan publish and verified rollback artifact without touching other registry entries", async () => {
    process.env.DATABASE_URL ??= "postgres://unit:test@localhost:5432/unit";
    const artifactPath = resolve(ROOT, "artifacts/api-server/src/__fixtures__/blueprints/care_plan-live-prestate-2026-10-29.json");
    const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
    const {
      buildScopedBlueprintRestorePlan,
      buildScopedRegistryBlueprintPublishPlan,
      readVerifiedScopedBlueprintRestoreArtifact,
    } = await import("../services/workBlueprintService.js");
    const { BLUEPRINT_REGISTRY, getRegistryEntry } = await import("../services/blueprintRegistry.js");

    const verifiedPreState = readVerifiedScopedBlueprintRestoreArtifact(artifact);
    expect(verifiedPreState.computedHash).toBe("sha256:b825528b9a95744f2bf265108e9aec998e7c3b76bbf4d3bb3522ef3af97dadd2");
    expect(verifiedPreState.sections).toHaveLength(14);

    const entry = getRegistryEntry("care_plan");
    expect(entry).toBeTruthy();
    const publishPlan = buildScopedRegistryBlueprintPublishPlan({
      currentBlueprint: verifiedPreState.blueprint,
      currentSections: verifiedPreState.sections,
      entry: entry!,
      now: new Date("2026-10-28T00:00:00.000Z"),
    });
    expect(publishPlan.nextContentHash).toBe("sha256:f3d4021683e9c0b158647379acaa898c1d642af2b7e606655ed93936f35c0aae");
    expect(Object.keys(publishPlan.diff.blueprint).sort()).toEqual(["contentHash", "deliverableContract", "evidenceContract"]);
    expect(publishPlan.diff.sections.filter((section) => section.action === "update").map((section) => section.sectionCode).sort()).toEqual([
      "ABOUT_ME",
      "CLIENT_ENDORSEMENT",
      "MEALTIME_MANAGEMENT_STRATEGY",
      "RESTRICTIVE_PRACTICES",
      "UNDERTAKING_ADL",
    ]);
    expect(publishPlan.diff.sections.filter((section) => section.action === "delete").map((section) => section.sectionCode)).toEqual(["HISTORY_BACKGROUND"]);
    expect(publishPlan.diff.sections.filter((section) => section.action !== "unchanged")).toHaveLength(6);

    const restorePlan = buildScopedBlueprintRestorePlan({
      currentBlueprint: publishPlan.nextBlueprint,
      currentSections: publishPlan.nextSections,
      artifact,
      code: "care_plan",
      now: new Date("2026-10-28T00:05:00.000Z"),
    });

    expect(restorePlan.nextContentHash).toBe("sha256:b825528b9a95744f2bf265108e9aec998e7c3b76bbf4d3bb3522ef3af97dadd2");
    expect(restorePlan.blueprintId).toBe(verifiedPreState.blueprint.id);
    expect(restorePlan.nextSections).toHaveLength(14);
    expect(comparableBlueprint(restorePlan.nextBlueprint)).toEqual(comparableBlueprint(verifiedPreState.blueprint));
    expect(restorePlan.nextSections.map((section) => section.id).sort()).toEqual(verifiedPreState.sections.map((section) => section.id).sort());
    for (const restoredSection of restorePlan.nextSections) {
      const originalSection = verifiedPreState.sections.find((section) => section.id === restoredSection.id);
      expect(originalSection).toBeTruthy();
      expect(comparableSection(restoredSection)).toEqual(comparableSection(originalSection!));
    }

    const registryCodes = new Set(BLUEPRINT_REGISTRY.map((registryEntry) => registryEntry.code));
    expect(registryCodes.size).toBe(75);
    expect(restorePlan.code).toBe("care_plan");
    expect([...registryCodes].filter((code) => code !== restorePlan.code)).toHaveLength(74);
  });

  it("fails closed for corrupted restore artifacts and wrong blueprint names", async () => {
    process.env.DATABASE_URL ??= "postgres://unit:test@localhost:5432/unit";
    const artifactPath = resolve(ROOT, "artifacts/api-server/src/__fixtures__/blueprints/care_plan-live-prestate-2026-10-29.json");
    const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
    const {
      buildScopedBlueprintRestorePlan,
      readVerifiedScopedBlueprintRestoreArtifact,
    } = await import("../services/workBlueprintService.js");

    const corrupted = structuredClone(artifact);
    corrupted.sections[0].title = `${corrupted.sections[0].title} corrupted`;
    expect(() => readVerifiedScopedBlueprintRestoreArtifact(corrupted)).toThrow(/hash mismatch/i);

    const verifiedPreState = readVerifiedScopedBlueprintRestoreArtifact(artifact);
    expect(() => buildScopedBlueprintRestorePlan({
      currentBlueprint: verifiedPreState.blueprint,
      currentSections: verifiedPreState.sections,
      artifact,
      code: "incident_investigation",
    })).toThrow(/not incident_investigation/i);
  });
});
