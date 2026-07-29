/**
 * Sprint 13 — Executive Assistant Employee File Tests
 *
 * Tests cover:
 *  - Employee File structure and required sections
 *  - Constitution inheritance and immutability invariants
 *  - Professional oath content
 *  - Soul and personality traits
 *  - Authority boundaries (may / mayNot)
 *  - DNA is draft only (no active published version)
 *  - Dispatch is blocked (dna_pending)
 *  - Capabilities and Worker Profile
 *  - Runtime Manifest compilation and sensitive section exclusion
 *  - Migration from deprecated calendar_specialist / communication_specialist
 *  - Capability registry entries for executive_assistant
 *  - Existing tests regression (Chief of Staff still intact)
 *
 * All tests are deterministic. No LLM or live DB calls.
 */

import { describe, it, expect, vi } from "vitest";

// ─── Mock @workspace/db ───────────────────────────────────────────────────────

vi.mock("@workspace/db", () => {
  const mockInsert = vi.fn();
  const mockSelect = vi.fn();
  const mockUpdate = vi.fn();
  const mockWhere = vi.fn();
  const mockReturning = vi.fn();
  const mockValues = vi.fn();
  const mockFrom = vi.fn();
  const mockLimit = vi.fn();
  const mockSet = vi.fn();

  const chainable: any = {
    insert: mockInsert,
    select: mockSelect,
    update: mockUpdate,
  };

  mockInsert.mockReturnValue({ values: mockValues });
  mockValues.mockReturnValue({ returning: mockReturning });
  mockReturning.mockResolvedValue([]);

  mockSelect.mockReturnValue({ from: mockFrom });
  mockFrom.mockReturnValue({ where: mockWhere });
  mockWhere.mockReturnValue({ limit: mockLimit });
  mockLimit.mockResolvedValue([]);

  mockUpdate.mockReturnValue({ set: mockSet });
  mockSet.mockReturnValue({ where: mockWhere });
  mockWhere.mockReturnValue({ returning: mockReturning });

  return {
    db: chainable,
    tasksTable: { id: "tasks.id", organizationId: "tasks.organization_id", currentState: "tasks.current_state" },
    specialistRunsTable: { id: "runs.id", organizationId: "runs.organization_id" },
    specialistQueueTable: {
      id: "queue.id",
      organizationId: "queue.organization_id",
      specialistRunId: "queue.specialist_run_id",
      status: "queue.status",
      availableAt: "queue.available_at",
      leaseExpiresAt: "queue.lease_expires_at",
      attempts: "queue.attempts",
      priority: "queue.priority",
    },
    specialistConflictsTable: {},
    taskExecutionPlansTable: {},
    taskSpecialistsTable: {},
    organizationsTable: {},
  };
});

// ─── Mock audit service ───────────────────────────────────────────────────────

vi.mock("../services/auditService.js", () => ({
  logOrgEvent: vi.fn().mockResolvedValue(undefined),
}));

// ─── Mock entitlementService ──────────────────────────────────────────────────

vi.mock("../services/entitlementService.js", () => ({
  tenantHasWorkforcePack: vi.fn().mockResolvedValue({ allowed: true, source: "plan", reasonCode: "included" }),
  tenantCanUseFeature: vi.fn().mockResolvedValue(true),
  checkUsage: vi.fn().mockResolvedValue({ allowed: true }),
}));

// ─── Import Executive Assistant Employee File (created in Sprint 13) ─────────
// NOTE: These imports will fail until the EA Employee File subagent creates the files.
// That is expected. Do not remove or work around these imports.

import {
  EXECUTIVE_ASSISTANT_EMPLOYEE_FILE,
  EXECUTIVE_ASSISTANT_DNA_V1,
  EXECUTIVE_ASSISTANT_RUNTIME_MANIFEST,
  EXECUTIVE_ASSISTANT_PROFESSIONAL_OATH,
} from "../../../../lib/workforce-dna/src/employees/executive-assistant/index.js";

// ─── Import Constitution ──────────────────────────────────────────────────────

import {
  NEEDSOPS_CONSTITUTION,
} from "../../../../lib/workforce-dna/src/constitution.js";

// ─── Import Employee File Architecture ───────────────────────────────────────

import {
  compileRuntimeManifest,
  validateEmployeeFile,
} from "../../../../lib/workforce-dna/src/employee/index.js";

// ─── Import DNA registry ──────────────────────────────────────────────────────

import {
  getDNAProfile,
  getEmployeeFile,
} from "../../../../lib/workforce-dna/src/registry.js";

// ─── Import Chief of Staff Employee File (regression check) ──────────────────

import {
  CHIEF_OF_STAFF_EMPLOYEE_FILE,
} from "../../../../lib/workforce-dna/src/employees/chief-of-staff/index.js";

// ─── Import DNA packages ──────────────────────────────────────────────────────

import {
  CHIEF_OF_STAFF_DNA,
} from "@workspace/workforce-dna";

// ─── Import workforce registry ────────────────────────────────────────────────

import {
  getSpecialistByCode,
  resolveAlias,
} from "../lib/workforceRegistry.js";

// ─── Import eligibility service ───────────────────────────────────────────────

import {
  validateSpecialistEligibilitySync,
} from "../services/specialistEligibilityService.js";

// ─── Import capability registry ───────────────────────────────────────────────

import {
  getCapabilitiesForRole,
} from "../lib/capabilityRegistry.js";

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 1: Employee File structure
// ═══════════════════════════════════════════════════════════════════════════════

describe("Group 1: Employee File structure", () => {
  it("EXECUTIVE_ASSISTANT_EMPLOYEE_FILE is defined", () => {
    expect(EXECUTIVE_ASSISTANT_EMPLOYEE_FILE).toBeDefined();
    expect(typeof EXECUTIVE_ASSISTANT_EMPLOYEE_FILE).toBe("object");
  });

  it("has all required sections: identity, soul, mission, values, personality, authority, decisionPhilosophy, communication, responsibilities, professionalDNA, workerProfile", () => {
    expect(EXECUTIVE_ASSISTANT_EMPLOYEE_FILE).toHaveProperty("identity");
    expect(EXECUTIVE_ASSISTANT_EMPLOYEE_FILE).toHaveProperty("soul");
    expect(EXECUTIVE_ASSISTANT_EMPLOYEE_FILE).toHaveProperty("mission");
    expect(EXECUTIVE_ASSISTANT_EMPLOYEE_FILE).toHaveProperty("values");
    expect(EXECUTIVE_ASSISTANT_EMPLOYEE_FILE).toHaveProperty("personality");
    expect(EXECUTIVE_ASSISTANT_EMPLOYEE_FILE).toHaveProperty("authority");
    expect(EXECUTIVE_ASSISTANT_EMPLOYEE_FILE).toHaveProperty("decisionPhilosophy");
    expect(EXECUTIVE_ASSISTANT_EMPLOYEE_FILE).toHaveProperty("communication");
    expect(EXECUTIVE_ASSISTANT_EMPLOYEE_FILE).toHaveProperty("responsibilities");
    expect(EXECUTIVE_ASSISTANT_EMPLOYEE_FILE).toHaveProperty("professionalDNA");
    expect(EXECUTIVE_ASSISTANT_EMPLOYEE_FILE).toHaveProperty("workerProfile");
  });

  it("fileVersion is '1.0.0'", () => {
    expect(EXECUTIVE_ASSISTANT_EMPLOYEE_FILE.fileVersion).toBe("1.0.0");
  });

  it("identity.roleCode is 'executive_assistant'", () => {
    expect(EXECUTIVE_ASSISTANT_EMPLOYEE_FILE.identity.roleCode).toBe("executive_assistant");
  });

  it("identity.title is 'AI Executive Assistant'", () => {
    expect(EXECUTIVE_ASSISTANT_EMPLOYEE_FILE.identity.title).toBe("AI Executive Assistant");
  });

  it("identity.department is 'Executive'", () => {
    expect(EXECUTIVE_ASSISTANT_EMPLOYEE_FILE.identity.department).toBe("Executive");
  });

  it("identity.reportsTo is 'Chief of Staff'", () => {
    expect(EXECUTIVE_ASSISTANT_EMPLOYEE_FILE.identity.reportsTo).toBe("Chief of Staff");
  });

  it("identity.packCode is 'core'", () => {
    expect(EXECUTIVE_ASSISTANT_EMPLOYEE_FILE.identity.packCode).toBe("core");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 2: Constitution inheritance
// ═══════════════════════════════════════════════════════════════════════════════

describe("Group 2: Constitution inheritance", () => {
  it("values.constitutionInherited is true", () => {
    expect(EXECUTIVE_ASSISTANT_EMPLOYEE_FILE.values.constitutionInherited).toBe(true);
  });

  it("values.constitutionVersion is '1.0.0'", () => {
    expect(EXECUTIVE_ASSISTANT_EMPLOYEE_FILE.values.constitutionVersion).toBe("1.0.0");
  });

  it("communication.neverExaggerateCertainty is true", () => {
    expect(EXECUTIVE_ASSISTANT_EMPLOYEE_FILE.communication.neverExaggerateCertainty).toBe(true);
  });

  it("validateEmployeeFile(EXECUTIVE_ASSISTANT_EMPLOYEE_FILE) returns no errors", () => {
    const errors = validateEmployeeFile(EXECUTIVE_ASSISTANT_EMPLOYEE_FILE);
    expect(errors).toEqual([]);
  });

  it("Employee File has at least 10 soul traits", () => {
    expect(EXECUTIVE_ASSISTANT_EMPLOYEE_FILE.soul.traits.length).toBeGreaterThanOrEqual(10);
  });

  it("Employee File has at least 10 role-specific values", () => {
    expect(EXECUTIVE_ASSISTANT_EMPLOYEE_FILE.values.roleSpecificValues.length).toBeGreaterThanOrEqual(10);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 3: Professional oath
// ═══════════════════════════════════════════════════════════════════════════════

describe("Group 3: Professional oath", () => {
  it("professionalDNA.v1.profile or identity includes a professionalOath / oath field", () => {
    // The oath may appear in professionalDNA.v1.notes, identity.purpose, mission.mission,
    // or as a dedicated field on the DNA profile. We check multiple locations.
    const dnaProfile = EXECUTIVE_ASSISTANT_EMPLOYEE_FILE.professionalDNA.v1.profile as any;
    const hasOath =
      (dnaProfile.professionalOath !== undefined) ||
      (dnaProfile.oath !== undefined) ||
      (dnaProfile.identity?.professionalOath !== undefined) ||
      (dnaProfile.mission?.oath !== undefined) ||
      (dnaProfile.philosophy?.oath !== undefined) ||
      (dnaProfile.philosophy?.statement !== undefined);
    expect(hasOath).toBe(true);
  });

  it("professional oath contains references to 'protect' and 'authority'", () => {
    const fullText = EXECUTIVE_ASSISTANT_PROFESSIONAL_OATH.toLowerCase();
    expect(fullText).toContain("protect");
    expect(fullText).toContain("authority");
  });

  it("professional oath contains 'discretion'", () => {
    expect(EXECUTIVE_ASSISTANT_PROFESSIONAL_OATH.toLowerCase()).toContain("discretion");
  });

  it("professional oath contains 'conceal' (as in never conceal)", () => {
    expect(EXECUTIVE_ASSISTANT_PROFESSIONAL_OATH.toLowerCase()).toContain("conceal");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 4: Soul and personality
// ═══════════════════════════════════════════════════════════════════════════════

describe("Group 4: Soul and personality", () => {
  it("soul.traits includes 'dependable'", () => {
    const traits = EXECUTIVE_ASSISTANT_EMPLOYEE_FILE.soul.traits.map(t => t.toLowerCase());
    expect(traits.some(t => t.includes("dependable"))).toBe(true);
  });

  it("soul.traits includes 'discreet'", () => {
    const traits = EXECUTIVE_ASSISTANT_EMPLOYEE_FILE.soul.traits.map(t => t.toLowerCase());
    expect(traits.some(t => t.includes("discreet"))).toBe(true);
  });

  it("soul.traits includes 'anticipatory'", () => {
    const traits = EXECUTIVE_ASSISTANT_EMPLOYEE_FILE.soul.traits.map(t => t.toLowerCase());
    expect(traits.some(t => t.includes("anticipat"))).toBe(true);
  });

  it("personality.traits includes 'calm'", () => {
    const traits = EXECUTIVE_ASSISTANT_EMPLOYEE_FILE.personality.traits.map(t => t.toLowerCase());
    expect(traits.some(t => t.includes("calm"))).toBe(true);
  });

  it("personality.traits includes 'precise'", () => {
    const traits = EXECUTIVE_ASSISTANT_EMPLOYEE_FILE.personality.traits.map(t => t.toLowerCase());
    expect(traits.some(t => t.includes("precise") || t.includes("precision"))).toBe(true);
  });

  it("personality.avoid includes claiming an action was completed when it was only drafted", () => {
    const avoidTexts = EXECUTIVE_ASSISTANT_EMPLOYEE_FILE.personality.avoid.map(t => t.toLowerCase());
    const hasCompletedDraftedItem = avoidTexts.some(
      t => (t.includes("complet") || t.includes("done") || t.includes("sent")) &&
           (t.includes("draft") || t.includes("prepared") || t.includes("only"))
    );
    expect(hasCompletedDraftedItem).toBe(true);
  });

  it("personality.avoid includes speculation", () => {
    const avoidTexts = EXECUTIVE_ASSISTANT_EMPLOYEE_FILE.personality.avoid.map(t => t.toLowerCase());
    const hasSpeculation = avoidTexts.some(
      t => t.includes("speculat") || t.includes("guess") || t.includes("assume")
    );
    expect(hasSpeculation).toBe(true);
  });

  it("personality.avoid does not include empty strings", () => {
    for (const item of EXECUTIVE_ASSISTANT_EMPLOYEE_FILE.personality.avoid) {
      expect(item.trim().length).toBeGreaterThan(0);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 5: Authority boundaries
// ═══════════════════════════════════════════════════════════════════════════════

describe("Group 5: Authority boundaries", () => {
  it("authority.may includes 'draft professional communications'", () => {
    const mayTexts = EXECUTIVE_ASSISTANT_EMPLOYEE_FILE.authority.may.map(t => t.toLowerCase());
    const hasDraftCommunications = mayTexts.some(
      t => t.includes("draft") && (t.includes("communication") || t.includes("email") || t.includes("letter"))
    );
    expect(hasDraftCommunications).toBe(true);
  });

  it("authority.may includes 'coordinate calendars'", () => {
    const mayTexts = EXECUTIVE_ASSISTANT_EMPLOYEE_FILE.authority.may.map(t => t.toLowerCase());
    const hasCalendar = mayTexts.some(
      t => t.includes("calendar") || t.includes("schedule") || t.includes("meeting")
    );
    expect(hasCalendar).toBe(true);
  });

  it("authority.may includes 'escalate conflicting instructions'", () => {
    const mayTexts = EXECUTIVE_ASSISTANT_EMPLOYEE_FILE.authority.may.map(t => t.toLowerCase());
    const hasEscalate = mayTexts.some(
      t => t.includes("escalat") && (t.includes("conflict") || t.includes("instruction") || t.includes("ambig"))
    );
    expect(hasEscalate).toBe(true);
  });

  it("authority.mayNot includes 'make executive decisions'", () => {
    const mayNotTexts = EXECUTIVE_ASSISTANT_EMPLOYEE_FILE.authority.mayNot.map(t => t.toLowerCase());
    const hasExecDecisions = mayNotTexts.some(
      t => (t.includes("executive") || t.includes("final")) && (t.includes("decision") || t.includes("decide"))
    );
    expect(hasExecDecisions).toBe(true);
  });

  it("authority.mayNot includes 'impersonate a person'", () => {
    const mayNotTexts = EXECUTIVE_ASSISTANT_EMPLOYEE_FILE.authority.mayNot.map(t => t.toLowerCase());
    const hasImpersonate = mayNotTexts.some(
      t => t.includes("impersonat") || (t.includes("pretend") && t.includes("person"))
    );
    expect(hasImpersonate).toBe(true);
  });

  it("authority.mayNot includes 'conceal material correspondence'", () => {
    const mayNotTexts = EXECUTIVE_ASSISTANT_EMPLOYEE_FILE.authority.mayNot.map(t => t.toLowerCase());
    const hasConceal = mayNotTexts.some(
      t => t.includes("conceal") || t.includes("hide") || t.includes("suppress")
    );
    expect(hasConceal).toBe(true);
  });

  it("authority.mayNot includes 'bypass approval because a request appears routine'", () => {
    const mayNotTexts = EXECUTIVE_ASSISTANT_EMPLOYEE_FILE.authority.mayNot.map(t => t.toLowerCase());
    const hasBypassApproval = mayNotTexts.some(
      t => (t.includes("bypass") || t.includes("skip") || t.includes("circumvent")) &&
           (t.includes("approval") || t.includes("routine") || t.includes("authoris"))
    );
    expect(hasBypassApproval).toBe(true);
  });

  it("authority.may and mayNot have no overlap", () => {
    const maySet = new Set(
      EXECUTIVE_ASSISTANT_EMPLOYEE_FILE.authority.may.map(t => t.toLowerCase().trim())
    );
    for (const mayNot of EXECUTIVE_ASSISTANT_EMPLOYEE_FILE.authority.mayNot) {
      expect(maySet.has(mayNot.toLowerCase().trim())).toBe(false);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 6: DNA is draft only
// ═══════════════════════════════════════════════════════════════════════════════

describe("Group 6: DNA is draft only", () => {
  it("EXECUTIVE_ASSISTANT_DNA_V1 is defined", () => {
    expect(EXECUTIVE_ASSISTANT_DNA_V1).toBeDefined();
  });

  it("EXECUTIVE_ASSISTANT_DNA_V1.currentVersion.version is '1.0.0'", () => {
    expect(EXECUTIVE_ASSISTANT_DNA_V1.currentVersion.version).toBe("1.0.0");
  });

  it("EXECUTIVE_ASSISTANT_DNA_V1.currentVersion.isActive is false (draft — not yet active)", () => {
    expect(EXECUTIVE_ASSISTANT_DNA_V1.currentVersion.isActive).toBe(false);
  });

  it("professionalDNA.activeVersion is 'none'", () => {
    expect(EXECUTIVE_ASSISTANT_EMPLOYEE_FILE.professionalDNA.activeVersion).toBe("none");
  });

  it("getDNAProfile('executive_assistant') returns null (not in active DNA registry)", () => {
    const profile = getDNAProfile("executive_assistant");
    expect(profile).toBeNull();
  });

  it("getEmployeeFile('executive_assistant') returns the Employee File", () => {
    const file = getEmployeeFile("executive_assistant");
    expect(file).toBeDefined();
    expect(file).not.toBeNull();
    expect(file!.identity.roleCode).toBe("executive_assistant");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 7: Dispatch is blocked
// ═══════════════════════════════════════════════════════════════════════════════

describe("Group 7: Dispatch is blocked", () => {
  it("validateSpecialistEligibilitySync('executive_assistant', 'calendar.management') returns false (dna_pending)", () => {
    // executive_assistant has executionStatus: "dna_pending" in the workforce registry
    const result = validateSpecialistEligibilitySync("executive_assistant", "calendar.management");
    expect(result).toBe(false);
  });

  it("validateSpecialistEligibilitySync('executive_assistant', 'communications.draft') returns false (dna_pending)", () => {
    const result = validateSpecialistEligibilitySync("executive_assistant", "communications.draft");
    expect(result).toBe(false);
  });

  it("executive_assistant has executionStatus 'dna_pending' in the workforce registry", () => {
    const specialist = getSpecialistByCode("executive_assistant");
    expect(specialist).toBeDefined();
    expect(specialist!.executionStatus).toBe("dna_pending");
  });

  it("executive_assistant has dnaStatus 'pending_design' in the workforce registry", () => {
    const specialist = getSpecialistByCode("executive_assistant");
    expect(specialist).toBeDefined();
    expect(specialist!.dnaStatus).toBe("pending_design");
  });

  it("chief_of_staff can still be dispatched (regression check)", () => {
    // chief_of_staff is 'available' — should return true for a capability it supports
    const specialist = getSpecialistByCode("chief_of_staff");
    expect(specialist).toBeDefined();
    expect(specialist!.executionStatus).toBe("available");
  });

  it("operations_manager can still be dispatched (regression check)", () => {
    const specialist = getSpecialistByCode("operations_manager");
    expect(specialist).toBeDefined();
    expect(specialist!.executionStatus).toBe("available");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 8: Capabilities and Worker Profile
// ═══════════════════════════════════════════════════════════════════════════════

describe("Group 8: Capabilities and Worker Profile", () => {
  it("workerProfile.profileCode is 'executive_assistant_profile'", () => {
    expect(EXECUTIVE_ASSISTANT_EMPLOYEE_FILE.workerProfile.profileCode).toBe("executive_assistant_profile");
  });

  it("workerProfile.roleLevel is 'specialist'", () => {
    expect(EXECUTIVE_ASSISTANT_EMPLOYEE_FILE.workerProfile.roleLevel).toBe("specialist");
  });

  it("workerProfile.authorityLevel is 'intermediate'", () => {
    expect(EXECUTIVE_ASSISTANT_EMPLOYEE_FILE.workerProfile.authorityLevel).toBe("intermediate");
  });

  it("workerProfile.availableCapabilities includes 'calendar.management'", () => {
    expect(EXECUTIVE_ASSISTANT_EMPLOYEE_FILE.workerProfile.availableCapabilities).toContain("calendar.management");
  });

  it("workerProfile.availableCapabilities includes 'communications.draft'", () => {
    expect(EXECUTIVE_ASSISTANT_EMPLOYEE_FILE.workerProfile.availableCapabilities).toContain("communications.draft");
  });

  it("workerProfile.availableCapabilities includes 'meeting.prepare_agenda'", () => {
    expect(EXECUTIVE_ASSISTANT_EMPLOYEE_FILE.workerProfile.availableCapabilities).toContain("meeting.prepare_agenda");
  });

  it("workerProfile.connectorPermissions includes 'connector:calendar'", () => {
    expect(EXECUTIVE_ASSISTANT_EMPLOYEE_FILE.workerProfile.connectorPermissions).toContain("connector:calendar");
  });

  it("workerProfile.connectorPermissions does NOT include 'connector:banking'", () => {
    expect(EXECUTIVE_ASSISTANT_EMPLOYEE_FILE.workerProfile.connectorPermissions).not.toContain("connector:banking");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 9: Runtime Manifest
// ═══════════════════════════════════════════════════════════════════════════════

describe("Group 9: Runtime Manifest", () => {
  it("EXECUTIVE_ASSISTANT_RUNTIME_MANIFEST is defined", () => {
    expect(EXECUTIVE_ASSISTANT_RUNTIME_MANIFEST).toBeDefined();
    expect(typeof EXECUTIVE_ASSISTANT_RUNTIME_MANIFEST).toBe("object");
  });

  it("employeeId is 'executive_assistant'", () => {
    expect(EXECUTIVE_ASSISTANT_RUNTIME_MANIFEST.employeeId).toBe("executive_assistant");
  });

  it("constitutionStatements has at least 10 entries", () => {
    expect(EXECUTIVE_ASSISTANT_RUNTIME_MANIFEST.constitutionStatements.length).toBeGreaterThanOrEqual(10);
  });

  it("constitutionVersion is '1.0.0'", () => {
    expect(EXECUTIVE_ASSISTANT_RUNTIME_MANIFEST.constitutionVersion).toBe("1.0.0");
  });

  it("runtimePermissions has execution, connectors, memory, delegation fields", () => {
    const perms = EXECUTIVE_ASSISTANT_RUNTIME_MANIFEST.runtimePermissions;
    expect(perms).toHaveProperty("execution");
    expect(perms).toHaveProperty("connectors");
    expect(perms).toHaveProperty("memory");
    expect(perms).toHaveProperty("delegation");
  });

  it("manifest does NOT have a soul field (sensitive — excluded)", () => {
    expect(EXECUTIVE_ASSISTANT_RUNTIME_MANIFEST).not.toHaveProperty("soul");
  });

  it("manifest does NOT have a personality field (sensitive — excluded)", () => {
    expect(EXECUTIVE_ASSISTANT_RUNTIME_MANIFEST).not.toHaveProperty("personality");
  });

  it("compileRuntimeManifest(EXECUTIVE_ASSISTANT_EMPLOYEE_FILE, null) produces a valid manifest", () => {
    const manifest = compileRuntimeManifest(EXECUTIVE_ASSISTANT_EMPLOYEE_FILE, null);
    expect(manifest).toBeDefined();
    expect(manifest.employeeId).toBe("executive_assistant");
    expect(manifest.constitutionVersion).toBe("1.0.0");
    expect(manifest.constitutionStatements.length).toBeGreaterThanOrEqual(10);
    expect(manifest).not.toHaveProperty("soul");
    expect(manifest).not.toHaveProperty("personality");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 10: Migration from deprecated roles
// ═══════════════════════════════════════════════════════════════════════════════

describe("Group 10: Migration from deprecated roles", () => {
  it("calendar_specialist resolves to executive_assistant (via resolveAlias)", () => {
    const resolved = resolveAlias("calendar_specialist");
    expect(resolved).toBe("executive_assistant");
  });

  it("communication_specialist resolves to executive_assistant (via resolveAlias)", () => {
    const resolved = resolveAlias("communication_specialist");
    expect(resolved).toBe("executive_assistant");
  });

  it("calendar_specialist is marked deprecated in the workforce registry", () => {
    const specialist = getSpecialistByCode("calendar_specialist");
    expect(specialist).toBeDefined();
    expect(specialist!.executionStatus).toBe("deprecated");
  });

  it("communication_specialist is marked deprecated in the workforce registry", () => {
    const specialist = getSpecialistByCode("communication_specialist");
    expect(specialist).toBeDefined();
    expect(specialist!.executionStatus).toBe("deprecated");
  });

  it("getSpecialistByCode('calendar_specialist') shows replacementRoleCode: 'executive_assistant'", () => {
    const specialist = getSpecialistByCode("calendar_specialist");
    expect(specialist).toBeDefined();
    expect(specialist!.replacementRoleCode).toBe("executive_assistant");
  });

  it("getSpecialistByCode('communication_specialist') shows replacementRoleCode: 'executive_assistant'", () => {
    const specialist = getSpecialistByCode("communication_specialist");
    expect(specialist).toBeDefined();
    expect(specialist!.replacementRoleCode).toBe("executive_assistant");
  });

  it("executive_assistant entry has catalogueVersion: '2'", () => {
    const specialist = getSpecialistByCode("executive_assistant");
    expect(specialist).toBeDefined();
    expect(specialist!.catalogueVersion).toBe("2");
  });

  it("executive_assistant entry is not deprecated", () => {
    const specialist = getSpecialistByCode("executive_assistant");
    expect(specialist).toBeDefined();
    expect(specialist!.executionStatus).not.toBe("deprecated");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 11: Capability registry
// ═══════════════════════════════════════════════════════════════════════════════

describe("Group 11: Capability registry", () => {
  it("getCapabilitiesForRole('executive_assistant') returns a non-empty array", () => {
    const caps = getCapabilitiesForRole("executive_assistant");
    expect(Array.isArray(caps)).toBe(true);
    expect(caps.length).toBeGreaterThan(0);
  });

  it("includes a calendar-related capability", () => {
    const caps = getCapabilitiesForRole("executive_assistant");
    const hasCalendar = caps.some(
      c => c.code.includes("calendar") || c.category === "calendar"
    );
    expect(hasCalendar).toBe(true);
  });

  it("includes a communications-related capability", () => {
    const caps = getCapabilitiesForRole("executive_assistant");
    const hasCommunications = caps.some(
      c => c.code.includes("communications") || c.category === "communications"
    );
    expect(hasCommunications).toBe(true);
  });

  it("includes a meeting or administration-related capability", () => {
    const caps = getCapabilitiesForRole("executive_assistant");
    const hasMeetingOrAdmin = caps.some(
      c =>
        c.code.includes("meeting") ||
        c.code.includes("administration") ||
        c.category === "administration"
    );
    expect(hasMeetingOrAdmin).toBe(true);
  });

  it("does not include finance capabilities", () => {
    const caps = getCapabilitiesForRole("executive_assistant");
    const hasFinance = caps.some(
      c => c.category === "finance" || c.category === "accounting" || c.category === "payroll"
    );
    expect(hasFinance).toBe(false);
  });

  it("does not include compliance capabilities that require specialist profile", () => {
    const caps = getCapabilitiesForRole("executive_assistant");
    const hasCompliance = caps.some(c => c.category === "compliance" || c.category === "quality");
    expect(hasCompliance).toBe(false);
  });

  it("does not include payroll capabilities", () => {
    const caps = getCapabilitiesForRole("executive_assistant");
    const hasPayroll = caps.some(c => c.category === "payroll" || c.code.includes("payroll"));
    expect(hasPayroll).toBe(false);
  });

  it("at least 2 capabilities returned", () => {
    const caps = getCapabilitiesForRole("executive_assistant");
    expect(caps.length).toBeGreaterThanOrEqual(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 12: Existing tests regression
// ═══════════════════════════════════════════════════════════════════════════════

describe("Group 12: Existing tests regression", () => {
  it("CHIEF_OF_STAFF_EMPLOYEE_FILE is still intact (identity.roleCode === 'chief_of_staff')", () => {
    expect(CHIEF_OF_STAFF_EMPLOYEE_FILE).toBeDefined();
    expect(CHIEF_OF_STAFF_EMPLOYEE_FILE.identity.roleCode).toBe("chief_of_staff");
  });

  it("CHIEF_OF_STAFF_DNA still has isActive: true", () => {
    expect(CHIEF_OF_STAFF_DNA.currentVersion.isActive).toBe(true);
  });

  it("CHIEF_OF_STAFF_DNA.currentVersion.version is '1.0.0'", () => {
    expect(CHIEF_OF_STAFF_DNA.currentVersion.version).toBe("1.0.0");
  });

  it("getEmployeeFile('chief_of_staff') returns CHIEF_OF_STAFF_EMPLOYEE_FILE", () => {
    const file = getEmployeeFile("chief_of_staff");
    expect(file).toBeDefined();
    expect(file!.identity.roleCode).toBe("chief_of_staff");
    expect(file).toBe(CHIEF_OF_STAFF_EMPLOYEE_FILE);
  });

  it("NEEDSOPS_CONSTITUTION still has exactly 10 principles (unchanged)", () => {
    expect(NEEDSOPS_CONSTITUTION).toHaveLength(10);
  });

  it("getDNAProfile('operations_manager') is still active (regression check)", () => {
    const profile = getDNAProfile("operations_manager");
    expect(profile).not.toBeNull();
    expect(profile!.currentVersion.version).toBe("1.0.0");
  });
});
