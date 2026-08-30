import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDb, seededSections } = vi.hoisted(() => {
  const seededSections = new Map<string, Record<string, unknown>>();
  const mockDb = {
    delete: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })),
    select: vi.fn((selection?: Record<string, unknown>) => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => []),
          orderBy: vi.fn(async () => []),
          then: undefined,
        })),
      })),
      then: undefined,
    })),
    insert: vi.fn(() => ({
      values: vi.fn(async (row: Record<string, unknown>) => {
        seededSections.set(String(row.id), row);
        return [];
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn((values: Record<string, unknown>) => ({
        where: vi.fn(async () => {
          const id = String(values.id ?? "");
          if (id && seededSections.has(id)) {
            seededSections.set(id, { ...seededSections.get(id), ...values });
          }
          return [];
        }),
      })),
    })),
  };
  return { mockDb, seededSections };
});

vi.mock("@workspace/db", () => {
  const table = {
    id: "id",
    organizationId: "organization_id",
    code: "code",
    title: "title",
    version: "version",
    blueprintFamily: "blueprint_family",
    supportedModes: "supported_modes",
    maturityState: "maturity_state",
    ownerType: "owner_type",
    purpose: "purpose",
    primaryDeliverable: "primary_deliverable",
    deliverableContract: "deliverable_contract",
    evidenceContract: "evidence_contract",
    permittedOrgOverrides: "permitted_org_overrides",
    defaultTemplateId: "default_template_id",
    templateRequired: "template_required",
    allowedOrgTemplateOverride: "allowed_org_template_override",
    templateVersionPolicy: "template_version_policy",
    status: "status",
    objective: "objective",
    primarySpecialist: "primary_specialist",
    supportingSpecialists: "supporting_specialists",
    requiredLibraryKnowledge: "required_library_knowledge",
    requiredEntityKnowledge: "required_entity_knowledge",
    requiredMemories: "required_memories",
    requiredApprovals: "required_approvals",
    validationRules: "validation_rules",
    qualityRules: "quality_rules",
    successCriteria: "success_criteria",
    outputTypes: "output_types",
    escalationRules: "escalation_rules",
    mandatoryCitations: "mandatory_citations",
    isBuiltIn: "is_built_in",
    isActive: "is_active",
    createdAt: "created_at",
    updatedAt: "updated_at",
  };
  return {
    db: mockDb,
    workBlueprintsTable: table,
    blueprintVersionsTable: table,
    workTemplatesTable: table,
    blueprintIntentMappingsTable: table,
    blueprintSectionsTable: {
      ...table,
      blueprintId: "blueprint_id",
      sectionCode: "section_code",
      sectionRole: "section_role",
      fixedContent: "fixed_content",
      templateFields: "template_fields",
      completionPrompt: "completion_prompt",
      required: "required",
      minimumContentExpectation: "minimum_content_expectation",
      evidenceRequirements: "evidence_requirements",
      allowedSourceTypes: "allowed_source_types",
      prohibitedAssumptions: "prohibited_assumptions",
      qualityCriteria: "quality_criteria",
      sortOrder: "sort_order",
    },
  };
});

vi.mock("../services/auditService.js", () => ({
  logOrgEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@workspace/ai-gateway", () => ({
  createAIGateway: vi.fn(),
}));

import { getRegistryEntry } from "../services/blueprintRegistry.js";
import { seedRegistryBlueprintSections } from "../services/workBlueprintService.js";

describe("Blueprint section registry seed verification", () => {
  beforeEach(() => {
    seededSections.clear();
    mockDb.delete.mockClear();
    mockDb.select.mockClear();
    mockDb.insert.mockClear();
    mockDb.update.mockClear();
  });

  it("seeds care_plan section template columns and verifies persisted values against the registry", async () => {
    const carePlan = getRegistryEntry("care_plan");
    if (!carePlan) throw new Error("missing care_plan registry entry");

    mockDb.select.mockImplementation((selection?: Record<string, unknown>) => {
      const isVerificationRead = Boolean(selection && "sectionRole" in selection);
      return {
        from: vi.fn(() => ({
          where: vi.fn(() => {
            if (isVerificationRead) {
              return Promise.resolve(Array.from(seededSections.values()).map((row) => ({
                id: row.id,
                sectionCode: row.sectionCode,
                sectionRole: row.sectionRole,
                fixedContent: row.fixedContent,
                templateFields: row.templateFields,
                completionPrompt: row.completionPrompt,
              })));
            }
            return {
              limit: vi.fn(async () => []),
            };
          }),
        })),
      };
    });

    await seedRegistryBlueprintSections(carePlan, "blueprint-care-plan", new Date("2026-08-30T00:00:00Z"));

    expect(seededSections.size).toBe(14);
    for (const section of carePlan.sections ?? []) {
      const id = `platform_blueprint_care_plan_section_${section.sectionCode.toLowerCase()}`;
      const row = seededSections.get(id);
      expect(row, section.sectionCode).toBeDefined();
      expect(row).toMatchObject({
        sectionRole: section.sectionRole ?? null,
        fixedContent: section.fixedContent ?? [],
        templateFields: section.fields ?? [],
        completionPrompt: section.completionPrompt ?? null,
      });
      expect(Object.prototype.hasOwnProperty.call(row, "fixedContent")).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(row, "templateFields")).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(row, "completionPrompt")).toBe(true);
    }
  });

  it("fails loudly when a persisted section drops a registry-declared template field", async () => {
    const carePlan = getRegistryEntry("care_plan");
    if (!carePlan) throw new Error("missing care_plan registry entry");

    mockDb.select.mockImplementation((selection?: Record<string, unknown>) => {
      const isVerificationRead = Boolean(selection && "sectionRole" in selection);
      return {
        from: vi.fn(() => ({
          where: vi.fn(() => {
            if (isVerificationRead) {
              return Promise.resolve(Array.from(seededSections.values()).map((row) => ({
                id: row.id,
                sectionCode: row.sectionCode,
                sectionRole: row.sectionRole,
                fixedContent: row.sectionCode === "SUPPORT_PLAN_MEETING" ? [] : row.fixedContent,
                templateFields: row.templateFields,
                completionPrompt: row.completionPrompt,
              })));
            }
            return {
              limit: vi.fn(async () => []),
            };
          }),
        })),
      };
    });

    await expect(seedRegistryBlueprintSections(carePlan, "blueprint-care-plan", new Date("2026-08-30T00:00:00Z")))
      .rejects.toThrow("care_plan.SUPPORT_PLAN_MEETING.fixedContent");
  });
});
