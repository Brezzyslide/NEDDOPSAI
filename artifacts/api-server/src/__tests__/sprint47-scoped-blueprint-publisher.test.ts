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
    const firstBlueprintUpdate = publisher.indexOf("await db\n    .update(workBlueprintsTable)");
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
    const artifactPath = "/tmp/needsops-blueprint-reconstruction/care_plan-defa6d1a-verified-rollback-with-metadata.json";
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
    expect(publishPlan.nextContentHash).toBe("sha256:5433caaf541b58606a7f2e5dbfc90d3d6883b3cba36cc7176bfc797d2800bfa3");

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
    expect(restorePlan.nextSections.map((section) => section.id).sort()).toEqual(
      verifiedPreState.sections.map((section) => section.id).sort(),
    );
    for (const restoredSection of restorePlan.nextSections) {
      const originalSection = verifiedPreState.sections.find((section) => section.id === restoredSection.id);
      expect(originalSection).toBeTruthy();
      expect({
        sectionCode: restoredSection.sectionCode,
        title: restoredSection.title,
        description: restoredSection.description,
        instructions: restoredSection.instructions,
        sectionRole: restoredSection.sectionRole,
        fixedContent: restoredSection.fixedContent,
        fields: restoredSection.fields,
        completionPrompt: restoredSection.completionPrompt,
        required: restoredSection.required,
        minimumContentExpectation: restoredSection.minimumContentExpectation,
        evidenceRequirements: restoredSection.evidenceRequirements,
        allowedSourceTypes: restoredSection.allowedSourceTypes,
        prohibitedAssumptions: restoredSection.prohibitedAssumptions,
        validationRules: restoredSection.validationRules,
        qualityCriteria: restoredSection.qualityCriteria,
        sortOrder: restoredSection.sortOrder,
      }).toEqual({
        sectionCode: originalSection!.sectionCode,
        title: originalSection!.title,
        description: originalSection!.description,
        instructions: originalSection!.instructions,
        sectionRole: originalSection!.sectionRole,
        fixedContent: originalSection!.fixedContent,
        fields: originalSection!.fields,
        completionPrompt: originalSection!.completionPrompt,
        required: originalSection!.required,
        minimumContentExpectation: originalSection!.minimumContentExpectation,
        evidenceRequirements: originalSection!.evidenceRequirements,
        allowedSourceTypes: originalSection!.allowedSourceTypes,
        prohibitedAssumptions: originalSection!.prohibitedAssumptions,
        validationRules: originalSection!.validationRules,
        qualityCriteria: originalSection!.qualityCriteria,
        sortOrder: originalSection!.sortOrder,
      });
    }

    const registryCodes = new Set(BLUEPRINT_REGISTRY.map((registryEntry) => registryEntry.code));
    expect(registryCodes.size).toBe(75);
    expect(restorePlan.code).toBe("care_plan");
    expect([...registryCodes].filter((code) => code !== restorePlan.code)).toHaveLength(74);
  });

  it("fails closed for corrupted restore artifacts and wrong blueprint names", async () => {
    process.env.DATABASE_URL ??= "postgres://unit:test@localhost:5432/unit";
    const artifactPath = "/tmp/needsops-blueprint-reconstruction/care_plan-defa6d1a-verified-rollback-with-metadata.json";
    const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
    const {
      buildScopedBlueprintRestorePlan,
      readVerifiedScopedBlueprintRestoreArtifact,
    } = await import("../services/workBlueprintService.js");

    const corrupted = structuredClone(artifact);
    corrupted.rollback.sections[0].title = `${corrupted.rollback.sections[0].title} corrupted`;
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
