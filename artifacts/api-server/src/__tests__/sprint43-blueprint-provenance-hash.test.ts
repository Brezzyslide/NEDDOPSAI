import { describe, expect, it, vi } from "vitest";
import { BLUEPRINT_REGISTRY, type RegistryEntry } from "../services/blueprintRegistry";
import { computeBlueprintContentHash } from "../services/blueprintContentHashService";
import { reportBlueprintContentHashDrift, type BlueprintSection, type WorkBlueprint } from "../services/workBlueprintService";

function blueprintFromRegistry(entry: RegistryEntry): WorkBlueprint {
  return {
    id: `platform_blueprint_${entry.code}`,
    organizationId: null,
    code: entry.code,
    title: entry.title,
    version: "1.0.0",
    contentHash: null,
    blueprintFamily: entry.blueprintFamily,
    supportedModes: entry.supportedModes,
    maturityState: entry.maturityState,
    ownerType: "platform_owned",
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
    objective: `[PLACEHOLDER] ${entry.purpose}`,
    primarySpecialist: "service_delivery_coordinator",
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
    createdAt: new Date("2026-08-30T00:00:00Z"),
    updatedAt: new Date("2026-08-30T00:00:00Z"),
  };
}

function sectionsFromRegistry(entry: RegistryEntry): BlueprintSection[] {
  return entry.sections.map((section) => ({
    id: `platform_blueprint_${entry.code}_section_${section.sectionCode.toLowerCase()}`,
    blueprintId: `platform_blueprint_${entry.code}`,
    sectionCode: section.sectionCode,
    title: section.title,
    description: section.description,
    instructions: section.instructions,
    sectionRole: section.sectionRole ?? null,
    fixedContent: section.fixedContent ?? [],
    fields: section.fields ?? [],
    completionPrompt: section.completionPrompt ?? null,
    required: section.required,
    minimumContentExpectation: section.minimumContentExpectation,
    evidenceRequirements: section.evidenceRequirements ?? {},
    allowedSourceTypes: section.allowedSourceTypes ?? [],
    prohibitedAssumptions: section.prohibitedAssumptions ?? [],
    validationRules: section.validationRules ?? [],
    qualityCriteria: section.qualityCriteria ?? [],
    sortOrder: section.sortOrder,
    createdAt: new Date("2026-08-30T00:00:00Z"),
    updatedAt: new Date("2026-08-30T00:00:00Z"),
  }));
}

describe("Sprint 43 Blueprint content provenance", () => {
  it("computes a stable content hash independent of section order and object key order", () => {
    const entry = BLUEPRINT_REGISTRY.find((candidate) => candidate.code === "care_plan");
    if (!entry) throw new Error("care_plan registry entry missing");

    const blueprint = blueprintFromRegistry(entry);
    const sections = sectionsFromRegistry(entry);
    const reversedSections = [...sections].reverse();

    expect(computeBlueprintContentHash({ blueprint, sections })).toBe(computeBlueprintContentHash({
      blueprint: {
        ...blueprint,
        requiredEntityKnowledge: { ...blueprint.requiredEntityKnowledge },
      },
      sections: reversedSections,
    }));
  });

  it("can hash every registry Blueprint before bootstrap backfills stored hashes", () => {
    const failures: string[] = [];
    const hashes = new Map<string, string>();

    for (const entry of BLUEPRINT_REGISTRY) {
      try {
        hashes.set(entry.code, computeBlueprintContentHash({
          blueprint: blueprintFromRegistry(entry),
          sections: sectionsFromRegistry(entry),
        }));
      } catch (error) {
        failures.push(`${entry.code}: ${(error as Error).message}`);
      }
    }

    expect(failures).toEqual([]);
    expect(hashes.size).toBe(75);
    expect([...hashes.values()].every((hash) => /^sha256:[a-f0-9]{64}$/.test(hash))).toBe(true);
  });

  it("surfaces stored Blueprint hash drift without blocking execution", () => {
    const entry = BLUEPRINT_REGISTRY.find((candidate) => candidate.code === "care_plan");
    if (!entry) throw new Error("care_plan registry entry missing");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const result = reportBlueprintContentHashDrift(
      { ...blueprintFromRegistry(entry), contentHash: "sha256:0000000000000000000000000000000000000000000000000000000000000000" },
      sectionsFromRegistry(entry),
    );

    expect(result.drifted).toBe(true);
    expect(warn).toHaveBeenCalledWith("[blueprint:content-hash-drift]", expect.objectContaining({
      blueprintCode: "care_plan",
      storedHash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    }));
    warn.mockRestore();
  });
});
