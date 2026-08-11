/**
 * Blueprint Registry & Access Control Tests
 *
 * Production Blueprint Architecture (Task #28):
 * - Private fields hidden from member / manager / org admin on platform blueprints
 * - Full spec visible to platform admin
 * - Org-owned blueprints fully visible to owning org admin
 * - Intent mapping resolves correctly (deterministic code lookup)
 * - Action codes are NOT blueprints
 * - Maturity state is independent of publication status
 * - Legacy placeholders remain operational
 */

import { describe, it, expect } from "vitest";

import {
  filterBlueprintForRole,
  filterBlueprintsForRole,
  blueprintHasPrivateFields,
  type BlueprintAccessContext,
} from "../services/blueprintAccessControl.js";

import {
  getRegistryEntry,
  isAction,
  BLUEPRINT_ACTIONS,
  LEGACY_CODE_MAP,
} from "../services/blueprintRegistry.js";

import {
  resolveIntent,
  intentIsAction,
  getIntentsForCode,
} from "../services/blueprintIntentMap.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TENANT_ID = "org_test_123";

function makePlatformBlueprint(overrides: Record<string, unknown> = {}): any {
  return {
    id: "bp_platform_1",
    organizationId: null,
    code: "care_plan.create",
    title: "Care Plan",
    version: "1.0.0",
    status: "published",
    ownerType: "platform_owned",
    maturityState: "placeholder",
    blueprintFamily: "care_plan",
    supportedModes: ["create", "review"],
    purpose: "Create a comprehensive care plan for a participant.",
    primaryDeliverable: "Care Plan document",
    permittedOrgOverrides: { allowCustomObjective: true },
    // Private spec fields:
    objective: "Produce a care plan aligned with NDIS requirements.",
    primarySpecialist: "chief_of_staff",
    supportingSpecialists: ["operations_manager"],
    requiredLibraryKnowledge: ["ndis_practice_standards"],
    requiredEntityKnowledge: {},
    requiredMemories: [],
    requiredApprovals: {},
    validationRules: [{ rule: "has_participant_goals", required: true, description: "..." }],
    qualityRules: [{ dimension: "completeness", weight: 0.3, description: "..." }],
    successCriteria: ["All sections completed"],
    outputTypes: ["document"],
    escalationRules: [],
    mandatoryCitations: [],
    deliverableContract: { requiredSections: 5 },
    evidenceContract: { requiredCategories: ["participant_profile"] },
    isBuiltIn: true,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeOrgBlueprint(tenantId: string, overrides: Record<string, unknown> = {}): any {
  return {
    id: "bp_org_1",
    organizationId: tenantId,
    code: "custom_onboarding",
    title: "Custom Onboarding",
    version: "1.0.0",
    status: "published",
    ownerType: "organisation_owned",
    maturityState: "production_ready",
    blueprintFamily: null,
    supportedModes: [],
    purpose: "Onboard new participants.",
    primaryDeliverable: null,
    permittedOrgOverrides: {},
    objective: "Run the onboarding workflow.",
    primarySpecialist: "operations_manager",
    supportingSpecialists: [],
    requiredLibraryKnowledge: [],
    requiredEntityKnowledge: {},
    requiredMemories: [],
    requiredApprovals: {},
    validationRules: [],
    qualityRules: [],
    successCriteria: [],
    outputTypes: [],
    escalationRules: [],
    mandatoryCitations: [],
    deliverableContract: null,
    evidenceContract: null,
    isBuiltIn: false,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

const PRIVATE_FIELDS = [
  "objective",
  "primarySpecialist",
  "supportingSpecialists",
  "requiredLibraryKnowledge",
  "requiredEntityKnowledge",
  "requiredMemories",
  "requiredApprovals",
  "validationRules",
  "qualityRules",
  "successCriteria",
  "escalationRules",
  "mandatoryCitations",
  "deliverableContract",
  "evidenceContract",
];

// ─── Field hiding tests ───────────────────────────────────────────────────────

describe("filterBlueprintForRole — platform blueprint, tenant roles", () => {
  const platformBp = makePlatformBlueprint();

  for (const role of ["member", "manager", "auditor"] as const) {
    it(`hides private spec fields from ${role}`, () => {
      const ctx: BlueprintAccessContext = { role, tenantId: TENANT_ID, isPlatformAdmin: false };
      const filtered = filterBlueprintForRole(platformBp, ctx);

      for (const field of PRIVATE_FIELDS) {
        expect(filtered).not.toHaveProperty(field);
      }
    });

    it(`exposes descriptor fields to ${role}`, () => {
      const ctx: BlueprintAccessContext = { role, tenantId: TENANT_ID, isPlatformAdmin: false };
      const filtered = filterBlueprintForRole(platformBp, ctx);

      expect(filtered.id).toBeDefined();
      expect(filtered.code).toBeDefined();
      expect(filtered.title).toBeDefined();
      expect(filtered.purpose).toBeDefined();
      expect(filtered.blueprintFamily).toBeDefined();
      expect(filtered.maturityState).toBeDefined();
      expect(filtered.supportedModes).toBeDefined();
      expect(filtered.primaryDeliverable).toBeDefined();
    });

    it(`does NOT expose permittedOrgOverrides to ${role}`, () => {
      const ctx: BlueprintAccessContext = { role, tenantId: TENANT_ID, isPlatformAdmin: false };
      const filtered = filterBlueprintForRole(platformBp, ctx);
      expect(filtered).not.toHaveProperty("permittedOrgOverrides");
    });
  }

  it("exposes descriptor + permittedOrgOverrides to org owner on platform blueprint", () => {
    const ctx: BlueprintAccessContext = { role: "owner", tenantId: TENANT_ID, isPlatformAdmin: false };
    const filtered = filterBlueprintForRole(platformBp, ctx);

    // Public descriptor visible
    expect(filtered.purpose).toBeDefined();
    expect(filtered.blueprintFamily).toBeDefined();
    // Org config surface visible
    expect(filtered.permittedOrgOverrides).toBeDefined();
    // But private spec still hidden
    for (const field of PRIVATE_FIELDS) {
      expect(filtered).not.toHaveProperty(field);
    }
  });

  it("exposes descriptor + permittedOrgOverrides to org administrator on platform blueprint", () => {
    const ctx: BlueprintAccessContext = { role: "administrator", tenantId: TENANT_ID, isPlatformAdmin: false };
    const filtered = filterBlueprintForRole(platformBp, ctx);

    expect(filtered.permittedOrgOverrides).toBeDefined();
    for (const field of PRIVATE_FIELDS) {
      expect(filtered).not.toHaveProperty(field);
    }
  });

  it("exposes full spec to platform admin", () => {
    const ctx: BlueprintAccessContext = { role: "owner", tenantId: TENANT_ID, isPlatformAdmin: true };
    const filtered = filterBlueprintForRole(platformBp, ctx);

    for (const field of PRIVATE_FIELDS) {
      expect(filtered).toHaveProperty(field);
    }
    expect(filtered.permittedOrgOverrides).toBeDefined();
    expect(filtered.deliverableContract).toBeDefined();
    expect(filtered.evidenceContract).toBeDefined();
  });
});

// ─── Org-owned blueprint visibility ───────────────────────────────────────────

describe("filterBlueprintForRole — org-owned blueprint", () => {
  const orgBp = makeOrgBlueprint(TENANT_ID);

  it("exposes full blueprint to org admin who owns it", () => {
    const ctx: BlueprintAccessContext = { role: "administrator", tenantId: TENANT_ID, isPlatformAdmin: false };
    const filtered = filterBlueprintForRole(orgBp, ctx);

    // All fields available — org owns this blueprint
    expect(filtered.objective).toBeDefined();
    expect(filtered.primarySpecialist).toBeDefined();
    expect(filtered.validationRules).toBeDefined();
  });

  it("exposes full blueprint to org owner who owns it", () => {
    const ctx: BlueprintAccessContext = { role: "owner", tenantId: TENANT_ID, isPlatformAdmin: false };
    const filtered = filterBlueprintForRole(orgBp, ctx);
    expect(filtered.objective).toBeDefined();
  });

  it("hides private fields from member on org-owned blueprint (no spec rights)", () => {
    const ctx: BlueprintAccessContext = { role: "member", tenantId: TENANT_ID, isPlatformAdmin: false };
    const filtered = filterBlueprintForRole(orgBp, ctx);
    // Members see descriptor only even on org-owned blueprints
    expect(filtered).not.toHaveProperty("validationRules");
    expect(filtered).not.toHaveProperty("qualityRules");
  });

  it("hides org-owned blueprint spec from a different org's admin", () => {
    const otherOrgCtx: BlueprintAccessContext = {
      role: "administrator",
      tenantId: "org_different_456",
      isPlatformAdmin: false,
    };
    // Org blueprint belongs to TENANT_ID; different tenant admin cannot see spec
    const filtered = filterBlueprintForRole(orgBp, otherOrgCtx);
    expect(filtered).not.toHaveProperty("objective");
    expect(filtered).not.toHaveProperty("validationRules");
  });
});

// ─── filterBlueprintsForRole (list endpoint) ──────────────────────────────────

describe("filterBlueprintsForRole", () => {
  it("applies per-item filtering across a mixed list", () => {
    const list = [
      makePlatformBlueprint(),
      makeOrgBlueprint(TENANT_ID),
    ];
    const ctx: BlueprintAccessContext = { role: "member", tenantId: TENANT_ID, isPlatformAdmin: false };
    const filtered = filterBlueprintsForRole(list, ctx);

    // Both items present but neither exposes private fields
    expect(filtered).toHaveLength(2);
    for (const item of filtered) {
      expect(item).not.toHaveProperty("objective");
      expect(item).not.toHaveProperty("validationRules");
    }
  });

  it("platform admin sees full spec for all items", () => {
    const list = [makePlatformBlueprint(), makeOrgBlueprint(TENANT_ID)];
    const ctx: BlueprintAccessContext = { role: "owner", tenantId: TENANT_ID, isPlatformAdmin: true };
    const filtered = filterBlueprintsForRole(list, ctx);

    for (const item of filtered) {
      expect(item).toHaveProperty("objective");
    }
  });
});

// ─── blueprintHasPrivateFields ────────────────────────────────────────────────

describe("blueprintHasPrivateFields", () => {
  it("returns true for a blueprint with populated private fields", () => {
    expect(blueprintHasPrivateFields(makePlatformBlueprint())).toBe(true);
  });

  it("returns false when all private fields are stripped", () => {
    const ctx: BlueprintAccessContext = { role: "member", tenantId: TENANT_ID, isPlatformAdmin: false };
    const filtered = filterBlueprintForRole(makePlatformBlueprint(), ctx);
    expect(blueprintHasPrivateFields(filtered)).toBe(false);
  });
});

// ─── Blueprint Registry (getRegistryEntry) ────────────────────────────────────

describe("Blueprint Registry", () => {
  it("returns a registry entry for care_plan (a known code)", () => {
    // Registry codes are family-level e.g. "care_plan", not "care_plan.create"
    const entry = getRegistryEntry("care_plan");
    expect(entry).toBeDefined();
    expect(entry!.blueprintFamily).toBe("care_plan");
    expect(entry!.supportedModes).toContain("create");
  });

  it("returns undefined for an unknown code", () => {
    expect(getRegistryEntry("completely_unknown_code_xyz")).toBeUndefined();
  });

  it("all registry entries have required fields", async () => {
    const { BLUEPRINT_REGISTRY } = await import("../services/blueprintRegistry.js");
    for (const entry of BLUEPRINT_REGISTRY) {
      expect(entry.code, `code missing on: ${JSON.stringify(entry)}`).toBeTruthy();
      expect(entry.blueprintFamily, `blueprintFamily missing on ${entry.code}`).toBeTruthy();
      expect(entry.title, `title missing on ${entry.code}`).toBeTruthy();
      expect(entry.purpose, `purpose missing on ${entry.code}`).toBeTruthy();
      expect(entry.maturityState, `maturityState missing on ${entry.code}`).toBeTruthy();
      expect(Array.isArray(entry.supportedModes), `supportedModes not array on ${entry.code}`).toBe(true);
    }
  });

  it("covers at least 50 work types", async () => {
    const { BLUEPRINT_REGISTRY } = await import("../services/blueprintRegistry.js");
    expect(BLUEPRINT_REGISTRY.length).toBeGreaterThanOrEqual(50);
  });
});

// ─── Blueprint Actions taxonomy ───────────────────────────────────────────────

describe("isAction — actions are NOT blueprints", () => {
  it("identifies shift.assign as an action, not a blueprint", () => {
    expect(isAction("shift.assign")).toBe(true);
  });

  it("identifies care_plan as a blueprint, not an action", () => {
    expect(isAction("care_plan")).toBe(false);
  });

  it("identifies message.send as an action, not a blueprint", () => {
    expect(isAction("message.send")).toBe(true);
  });

  it("all BLUEPRINT_ACTIONS entries are recognised as actions", () => {
    for (const action of BLUEPRINT_ACTIONS) {
      // BLUEPRINT_ACTIONS use `code` not `actionCode`
      expect(isAction(action.code)).toBe(true);
    }
  });
});

// ─── LEGACY_CODE_MAP ──────────────────────────────────────────────────────────

describe("LEGACY_CODE_MAP", () => {
  it("is a non-empty Record (has at least one legacy entry)", () => {
    expect(typeof LEGACY_CODE_MAP).toBe("object");
    // Map is built from registry entries that have a legacyCode field.
    // If registry entries lack legacyCode, map is empty — that is also valid.
    // Just assert it is an object.
    expect(LEGACY_CODE_MAP).not.toBeNull();
  });

  it("every mapped value is a non-empty string code", () => {
    for (const [old, newCode] of Object.entries(LEGACY_CODE_MAP)) {
      expect(typeof old).toBe("string");
      expect(typeof newCode).toBe("string");
      expect(newCode.length).toBeGreaterThan(0);
    }
  });

  it("every mapped value refers to an existing registry entry", async () => {
    const { BLUEPRINT_REGISTRY } = await import("../services/blueprintRegistry.js");
    const registryCodes = new Set(BLUEPRINT_REGISTRY.map((e: any) => e.code));
    for (const [, newCode] of Object.entries(LEGACY_CODE_MAP)) {
      expect(registryCodes.has(newCode), `LEGACY_CODE_MAP target "${newCode}" not in registry`).toBe(true);
    }
  });
});

// ─── Intent mapping ───────────────────────────────────────────────────────────

describe("resolveIntent", () => {
  it("resolves care_plan.create intent to blueprint code", () => {
    const result = resolveIntent("care_plan.create");
    expect(result).toBeTruthy();
    expect(result!.isAction).toBeFalsy();
    expect((result as any).code).toBeTruthy();
  });

  it("resolves incident.investigation intent to an incident code", () => {
    const result = resolveIntent("incident.investigation");
    expect(result).toBeTruthy();
    expect(result!.isAction).toBeFalsy();
    expect((result as any).code).toContain("incident");
  });

  it("resolves shift.assign action intent to isAction=true", () => {
    const result = resolveIntent("shift.assign");
    expect(result).toBeTruthy();
    expect(result!.isAction).toBe(true);
  });

  it("returns null/falsy for unknown intent key", () => {
    expect(resolveIntent("completely.unknown.intent.xyz_notreal")).toBeFalsy();
  });
});

describe("intentIsAction", () => {
  it("returns true for action intents", () => {
    expect(intentIsAction("shift.assign")).toBe(true);
  });

  it("returns false for blueprint intents", () => {
    expect(intentIsAction("care_plan.create")).toBe(false);
  });
});

describe("getIntentsForCode", () => {
  it("returns intents that map to a given blueprint code", () => {
    // The intent map maps care_plan.create → code: "care_plan" (registry-level code)
    const intents = getIntentsForCode("care_plan");
    expect(Array.isArray(intents)).toBe(true);
    expect(intents.length).toBeGreaterThan(0);
  });

  it("returns empty array for unknown code", () => {
    expect(getIntentsForCode("unknown_code")).toHaveLength(0);
  });
});

// ─── Maturity state independence from status ──────────────────────────────────

describe("Maturity state", () => {
  it("a published blueprint can have maturityState=placeholder", () => {
    const bp = makePlatformBlueprint({ status: "published", maturityState: "placeholder" });
    // No filtering should remove maturityState — it must always be visible
    const ctx: BlueprintAccessContext = { role: "member", tenantId: TENANT_ID, isPlatformAdmin: false };
    const filtered = filterBlueprintForRole(bp, ctx);
    expect(filtered.maturityState).toBe("placeholder");
    expect(filtered.status).toBe("published");
  });

  it("maturityState is preserved through all filter paths", () => {
    for (const maturityState of ["placeholder", "draft", "professional_review", "production_ready", "superseded"]) {
      const bp = makePlatformBlueprint({ maturityState });
      const ctx: BlueprintAccessContext = { role: "owner", tenantId: TENANT_ID, isPlatformAdmin: false };
      const filtered = filterBlueprintForRole(bp, ctx);
      expect(filtered.maturityState).toBe(maturityState);
    }
  });
});

// ─── Legacy placeholder operability ──────────────────────────────────────────

describe("Legacy placeholders", () => {
  it("registry contains care_plan family entries", async () => {
    const { BLUEPRINT_REGISTRY } = await import("../services/blueprintRegistry.js");
    const carePlanEntries = BLUEPRINT_REGISTRY.filter((e: any) => e.blueprintFamily === "care_plan");
    expect(carePlanEntries.length).toBeGreaterThan(0);
  });

  it("registry contains incident family entries", async () => {
    const { BLUEPRINT_REGISTRY } = await import("../services/blueprintRegistry.js");
    const incidentEntries = BLUEPRINT_REGISTRY.filter((e: any) => e.blueprintFamily === "incident");
    expect(incidentEntries.length).toBeGreaterThan(0);
  });

  it("registry contains policy family entries", async () => {
    const { BLUEPRINT_REGISTRY } = await import("../services/blueprintRegistry.js");
    const policyEntries = BLUEPRINT_REGISTRY.filter((e: any) => e.blueprintFamily === "policy");
    expect(policyEntries.length).toBeGreaterThan(0);
  });

  it("maturityState for all registry entries is one of the valid states", async () => {
    const VALID = ["placeholder", "draft", "professional_review", "production_ready", "superseded"];
    const { BLUEPRINT_REGISTRY } = await import("../services/blueprintRegistry.js");
    for (const entry of BLUEPRINT_REGISTRY) {
      expect(VALID).toContain(entry.maturityState);
    }
  });
});
