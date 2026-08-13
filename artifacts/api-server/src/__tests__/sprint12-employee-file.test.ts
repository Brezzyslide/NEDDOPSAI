/**
 * Sprint 12 — Employee File Architecture Tests
 *
 * Tests cover:
 *  - Constitution inheritance and immutability
 *  - Chief of Staff Employee File structure and values
 *  - DNA v1 unchanged and v2 draft only
 *  - Runtime Manifest compilation and sensitive section exclusion
 *  - Worker Profile compilation
 *  - Existing orchestration still functions
 *  - Historical run reproducibility
 *  - Dispatch behaviour unchanged
 *  - Capability boundary enforcement
 *  - Employee File structural validation
 *
 * All tests are deterministic. No LLM or live DB calls.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

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

// ─── Mock entitlementService (used by specialistEligibilityService) ───────────

vi.mock("../services/entitlementService.js", () => ({
  tenantHasWorkforcePack: vi.fn().mockResolvedValue({ allowed: true, source: "plan", reasonCode: "included" }),
  tenantCanUseFeature: vi.fn().mockResolvedValue(true),
  checkUsage: vi.fn().mockResolvedValue({ allowed: true }),
}));

// ─── Import Constitution ──────────────────────────────────────────────────────

import {
  NEEDSOPS_CONSTITUTION,
  CONSTITUTION_VERSION,
  buildConstitutionPreamble,
  getConstitutionStatements,
  validateConstitutionInheritance,
} from "../../../../lib/workforce-dna/src/constitution.js";

// ─── Import Employee File Architecture ───────────────────────────────────────

import {
  compileRuntimeManifest,
  validateEmployeeFile,
} from "../../../../lib/workforce-dna/src/employee/index.js";

// ─── Import DNA functions from package ────────────────────────────────────────

import {
  getDNAProfile,
  buildDNASystemInstruction,
  captureSpecialistRunVersions,
  CHIEF_OF_STAFF_DNA,
} from "@workspace/workforce-dna";

// ─── Import Chief of Staff Employee File (created in Sprint 12) ──────────────
// NOTE: This file is created by the CoS Employee File subagent.
// It will exist at: lib/workforce-dna/src/employees/chief-of-staff/index.ts

import {
  CHIEF_OF_STAFF_EMPLOYEE_FILE,
  CHIEF_OF_STAFF_DNA_V2,
} from "../../../../lib/workforce-dna/src/employees/chief-of-staff/index.js";

// ─── Import eligibility service ───────────────────────────────────────────────

import {
  validateSpecialistEligibilitySync,
} from "../services/specialistEligibilityService.js";

// ─── Import workforce registry for dispatch checks ────────────────────────────

import {
  getSpecialistByCode,
} from "../lib/workforceRegistry.js";

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 1: Constitution is inherited
// ═══════════════════════════════════════════════════════════════════════════════

describe("Group 1: Constitution is inherited", () => {
  it("NEEDSOPS_CONSTITUTION has exactly 10 principles", () => {
    expect(NEEDSOPS_CONSTITUTION).toHaveLength(10);
  });

  it("each principle has a unique number (1–10)", () => {
    const numbers = NEEDSOPS_CONSTITUTION.map(p => p.number);
    const uniqueNumbers = new Set(numbers);
    expect(uniqueNumbers.size).toBe(10);
    for (let i = 1; i <= 10; i++) {
      expect(numbers).toContain(i);
    }
  });

  it("buildConstitutionPreamble() returns a string containing all 10 principle statements", () => {
    const preamble = buildConstitutionPreamble();
    expect(typeof preamble).toBe("string");
    for (const principle of NEEDSOPS_CONSTITUTION) {
      expect(preamble).toContain(principle.statement);
    }
  });

  it("getConstitutionStatements() returns exactly 10 items", () => {
    const statements = getConstitutionStatements();
    expect(statements).toHaveLength(10);
  });

  it("CONSTITUTION_VERSION is '1.0.0'", () => {
    expect(CONSTITUTION_VERSION).toBe("1.0.0");
  });

  it("constitutionStatements in the Constitution array are frozen (cannot be mutated)", () => {
    // NEEDSOPS_CONSTITUTION is a ReadonlyArray wrapping Object.freeze(...)
    // At runtime, the array is frozen — pushing should not succeed
    const arr = NEEDSOPS_CONSTITUTION as unknown as ConstitutionalPrincipleAny[];
    const originalLength = arr.length;

    // Attempt to mutate (silently fails in non-strict, throws in strict)
    try {
      (arr as any).push({ number: 11, title: "Extra", statement: "Extra", guidance: "" });
    } catch {
      // Expected in strict mode
    }

    // The length must remain 10 — mutation must have been rejected
    expect(NEEDSOPS_CONSTITUTION.length).toBe(originalLength);
  });
});

// TypeScript helper type for runtime mutation test
interface ConstitutionalPrincipleAny {
  number: number;
  title: string;
  statement: string;
  guidance: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 2: Soul cannot override Constitution
// ═══════════════════════════════════════════════════════════════════════════════

describe("Group 2: Soul cannot override Constitution", () => {
  it("CHIEF_OF_STAFF_EMPLOYEE_FILE.values.constitutionInherited is exactly true", () => {
    expect(CHIEF_OF_STAFF_EMPLOYEE_FILE.values.constitutionInherited).toBe(true);
  });

  it("CHIEF_OF_STAFF_EMPLOYEE_FILE.values.constitutionVersion is '1.0.0'", () => {
    expect(CHIEF_OF_STAFF_EMPLOYEE_FILE.values.constitutionVersion).toBe("1.0.0");
  });

  it("validateConstitutionInheritance('1.0.0', true) returns true", () => {
    expect(validateConstitutionInheritance("1.0.0", true)).toBe(true);
  });

  it("validateConstitutionInheritance('1.0.0', false) returns false", () => {
    expect(validateConstitutionInheritance("1.0.0", false)).toBe(false);
  });

  it("validateConstitutionInheritance('0.9.0', true) returns false (wrong version)", () => {
    expect(validateConstitutionInheritance("0.9.0", true)).toBe(false);
  });

  it("soul traits exist (array of strings, non-empty)", () => {
    const traits = CHIEF_OF_STAFF_EMPLOYEE_FILE.soul.traits;
    expect(Array.isArray(traits)).toBe(true);
    expect(traits.length).toBeGreaterThan(0);
    for (const trait of traits) {
      expect(typeof trait).toBe("string");
    }
  });

  it("soul traits do NOT include any constitutional principle statements verbatim", () => {
    const soulTraits = CHIEF_OF_STAFF_EMPLOYEE_FILE.soul.traits;
    const constitutionStatements = getConstitutionStatements();

    for (const statement of constitutionStatements) {
      expect(soulTraits).not.toContain(statement);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 3: DNA v1 remains unchanged
// ═══════════════════════════════════════════════════════════════════════════════

describe("Group 3: DNA v1 remains unchanged", () => {
  it("CHIEF_OF_STAFF_DNA.currentVersion.version is '1.0.0'", () => {
    expect(CHIEF_OF_STAFF_DNA.currentVersion.version).toBe("1.0.0");
  });

  it("CHIEF_OF_STAFF_DNA.currentVersion.isActive is true", () => {
    expect(CHIEF_OF_STAFF_DNA.currentVersion.isActive).toBe(true);
  });

  it("CHIEF_OF_STAFF_DNA.identity.roleCode is 'chief_of_staff'", () => {
    expect(CHIEF_OF_STAFF_DNA.identity.roleCode).toBe("chief_of_staff");
  });

  it("CHIEF_OF_STAFF_DNA.reasoningMethodology.steps has 9 steps (original)", () => {
    expect(CHIEF_OF_STAFF_DNA.reasoningMethodology.steps).toHaveLength(9);
  });

  it("CHIEF_OF_STAFF_DNA.outputSchema.version is '1.0.0'", () => {
    expect(CHIEF_OF_STAFF_DNA.outputSchema.version).toBe("1.0.0");
  });

  it("CHIEF_OF_STAFF_DNA.evidenceStandards.allowInventedReferences === false (not professionalBoundaries)", () => {
    // professionalBoundaries does NOT have allowInventedReferences
    // the correct place is evidenceStandards.allowInventedReferences
    expect(CHIEF_OF_STAFF_DNA.evidenceStandards.allowInventedReferences).toBe(false);
    expect((CHIEF_OF_STAFF_DNA.professionalBoundaries as any).allowInventedReferences).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 4: DNA v2 is draft only
// ═══════════════════════════════════════════════════════════════════════════════

describe("Group 4: DNA v2 is draft only", () => {
  it("CHIEF_OF_STAFF_DNA_V2.currentVersion.version is '2.0.0'", () => {
    expect(CHIEF_OF_STAFF_DNA_V2.currentVersion.version).toBe("2.0.0");
  });

  it("CHIEF_OF_STAFF_DNA_V2.currentVersion.isActive is false (draft — not active)", () => {
    expect(CHIEF_OF_STAFF_DNA_V2.currentVersion.isActive).toBe(false);
  });

  it("CHIEF_OF_STAFF_DNA_V2.currentVersion.previousVersion is '1.0.0'", () => {
    expect(CHIEF_OF_STAFF_DNA_V2.currentVersion.previousVersion).toBe("1.0.0");
  });

  it("CHIEF_OF_STAFF_DNA_V2.reasoningMethodology.steps.length is 10 (added constitution check step)", () => {
    expect(CHIEF_OF_STAFF_DNA_V2.reasoningMethodology.steps).toHaveLength(10);
  });

  it("CHIEF_OF_STAFF_DNA_V2.outputSchema.version is '2.0.0'", () => {
    expect(CHIEF_OF_STAFF_DNA_V2.outputSchema.version).toBe("2.0.0");
  });

  it("CHIEF_OF_STAFF_DNA_V2 is NOT in the active DNA registry (getDNAProfile still returns v1)", () => {
    const profile = getDNAProfile("chief_of_staff");
    expect(profile).not.toBeNull();
    expect(profile!.currentVersion.version).toBe("1.0.0");
    expect(profile!.currentVersion.isActive).toBe(true);
  });

  it("the last step in v2 reasoning has stepId 'cos.10.constitution_check'", () => {
    const steps = CHIEF_OF_STAFF_DNA_V2.reasoningMethodology.steps;
    const lastStep = steps[steps.length - 1];
    expect(lastStep).toBeDefined();
    expect(lastStep!.stepId).toBe("cos.10.constitution_check");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 5: Runtime Manifest excludes sensitive Employee File sections
// ═══════════════════════════════════════════════════════════════════════════════

describe("Group 5: Runtime Manifest excludes sensitive Employee File sections", () => {
  let manifest: ReturnType<typeof compileRuntimeManifest>;

  beforeEach(() => {
    manifest = compileRuntimeManifest(CHIEF_OF_STAFF_EMPLOYEE_FILE, null);
  });

  it("compileRuntimeManifest returns a RuntimeManifest object", () => {
    expect(manifest).toBeDefined();
    expect(typeof manifest).toBe("object");
  });

  it("RuntimeManifest does NOT have a 'soul' property", () => {
    expect(manifest).not.toHaveProperty("soul");
  });

  it("RuntimeManifest does NOT have a 'personality' property", () => {
    expect(manifest).not.toHaveProperty("personality");
  });

  it("RuntimeManifest does NOT have a 'professionalDNA' property (full profiles)", () => {
    expect(manifest).not.toHaveProperty("professionalDNA");
  });

  it("RuntimeManifest does NOT have a 'fileVersion' property", () => {
    expect(manifest).not.toHaveProperty("fileVersion");
  });

  it("RuntimeManifest does NOT have a 'createdAt' property (file creation date)", () => {
    expect(manifest).not.toHaveProperty("createdAt");
  });

  it("RuntimeManifest does NOT have an 'updatedAt' property (file update date)", () => {
    expect(manifest).not.toHaveProperty("updatedAt");
  });

  it("RuntimeManifest DOES have: employeeId", () => {
    expect(manifest).toHaveProperty("employeeId");
  });

  it("RuntimeManifest DOES have: title", () => {
    expect(manifest).toHaveProperty("title");
  });

  it("RuntimeManifest DOES have: department", () => {
    expect(manifest).toHaveProperty("department");
  });

  it("RuntimeManifest DOES have: dnaVersion", () => {
    expect(manifest).toHaveProperty("dnaVersion");
  });

  it("RuntimeManifest DOES have: activeCapabilities", () => {
    expect(manifest).toHaveProperty("activeCapabilities");
  });

  it("RuntimeManifest DOES have: runtimePermissions", () => {
    expect(manifest).toHaveProperty("runtimePermissions");
  });

  it("RuntimeManifest DOES have: executionBoundaries", () => {
    expect(manifest).toHaveProperty("executionBoundaries");
  });

  it("RuntimeManifest DOES have: securityConstraints", () => {
    expect(manifest).toHaveProperty("securityConstraints");
  });

  it("RuntimeManifest DOES have: constitutionStatements", () => {
    expect(manifest).toHaveProperty("constitutionStatements");
  });

  it("RuntimeManifest.constitutionStatements.length === 10 (all 10 principles included)", () => {
    expect(manifest.constitutionStatements).toHaveLength(10);
  });

  it("RuntimeManifest.employeeId === 'chief_of_staff'", () => {
    expect(manifest.employeeId).toBe("chief_of_staff");
  });

  it("RuntimeManifest.constitutionVersion === '1.0.0'", () => {
    expect(manifest.constitutionVersion).toBe("1.0.0");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 6: Worker Profile compiles correctly
// ═══════════════════════════════════════════════════════════════════════════════

describe("Group 6: Worker Profile compiles correctly", () => {
  it("CHIEF_OF_STAFF_EMPLOYEE_FILE.workerProfile.profileCode === 'chief_of_staff_profile'", () => {
    expect(CHIEF_OF_STAFF_EMPLOYEE_FILE.workerProfile.profileCode).toBe("chief_of_staff_profile");
  });

  it("CHIEF_OF_STAFF_EMPLOYEE_FILE.workerProfile.roleLevel === 'executive'", () => {
    expect(CHIEF_OF_STAFF_EMPLOYEE_FILE.workerProfile.roleLevel).toBe("executive");
  });

  it("CHIEF_OF_STAFF_EMPLOYEE_FILE.workerProfile.authorityLevel === 'executive'", () => {
    expect(CHIEF_OF_STAFF_EMPLOYEE_FILE.workerProfile.authorityLevel).toBe("executive");
  });

  it("workerProfile.availableCapabilities is non-empty", () => {
    expect(CHIEF_OF_STAFF_EMPLOYEE_FILE.workerProfile.availableCapabilities.length).toBeGreaterThan(0);
  });

  it("workerProfile.executionPermissions includes 'dispatch_specialist'", () => {
    expect(CHIEF_OF_STAFF_EMPLOYEE_FILE.workerProfile.executionPermissions).toContain("dispatch_specialist");
  });

  it("workerProfile.delegationPermissions includes at least one permission", () => {
    expect(CHIEF_OF_STAFF_EMPLOYEE_FILE.workerProfile.delegationPermissions.length).toBeGreaterThan(0);
  });

  it("workerProfile.escalationPathways is non-empty", () => {
    expect(CHIEF_OF_STAFF_EMPLOYEE_FILE.workerProfile.escalationPathways.length).toBeGreaterThan(0);
  });

  it("workerProfile.performanceObjectives is non-empty", () => {
    expect(CHIEF_OF_STAFF_EMPLOYEE_FILE.workerProfile.performanceObjectives.length).toBeGreaterThan(0);
  });

  it("the worker profile version is a semver string", () => {
    const version = CHIEF_OF_STAFF_EMPLOYEE_FILE.workerProfile.version;
    expect(typeof version).toBe("string");
    // Semver pattern: x.y.z
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 7: Existing orchestration still functions
// ═══════════════════════════════════════════════════════════════════════════════

describe("Group 7: Existing orchestration still functions", () => {
  it("buildDNASystemInstruction('chief_of_staff') returns a string", () => {
    const instruction = buildDNASystemInstruction("chief_of_staff");
    expect(typeof instruction).toBe("string");
    expect(instruction.length).toBeGreaterThan(0);
  });

  it("buildDNASystemInstruction('operations_manager') returns a string", () => {
    const instruction = buildDNASystemInstruction("operations_manager");
    expect(typeof instruction).toBe("string");
    expect(instruction.length).toBeGreaterThan(0);
  });

  it("buildDNASystemInstruction('chief_of_staff') contains 'Chief of Staff'", () => {
    const instruction = buildDNASystemInstruction("chief_of_staff");
    expect(instruction).toContain("Chief of Staff");
  });

  it("buildDNASystemInstruction('nonexistent_role') returns a string containing 'not yet activated'", () => {
    const instruction = buildDNASystemInstruction("nonexistent_role");
    expect(typeof instruction).toBe("string");
    expect(instruction).toContain("not yet activated");
  });

  it("getDNAProfile('chief_of_staff') returns the v1.0.0 profile", () => {
    const profile = getDNAProfile("chief_of_staff");
    expect(profile).not.toBeNull();
    expect(profile!.currentVersion.version).toBe("1.0.0");
  });

  it("getDNAProfile('chief_of_staff')!.currentVersion.version === '1.0.0'", () => {
    expect(getDNAProfile("chief_of_staff")!.currentVersion.version).toBe("1.0.0");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 8: Historical runs remain reproducible
// ═══════════════════════════════════════════════════════════════════════════════

describe("Group 8: Historical runs remain reproducible", () => {
  it("captureSpecialistRunVersions('chief_of_staff', 'gpt-4o') returns a RunVersionRecord", () => {
    const record = captureSpecialistRunVersions("chief_of_staff", "gpt-4o");
    expect(record).toBeDefined();
    expect(typeof record).toBe("object");
    expect(record).toHaveProperty("dnaVersion");
    expect(record).toHaveProperty("reasoningVersion");
    expect(record).toHaveProperty("recordedAt");
  });

  it("captureSpecialistRunVersions('chief_of_staff', 'gpt-4o').dnaVersion === '1.0.0'", () => {
    const record = captureSpecialistRunVersions("chief_of_staff", "gpt-4o");
    expect(record.dnaVersion).toBe("1.0.0");
  });

  it("captureSpecialistRunVersions('chief_of_staff', 'gpt-4o').reasoningVersion === '1.0.0'", () => {
    const record = captureSpecialistRunVersions("chief_of_staff", "gpt-4o");
    expect(record.reasoningVersion).toBe("1.0.0");
  });

  it("captureSpecialistRunVersions('operations_manager', 'gpt-4o').dnaVersion === '1.0.0'", () => {
    const record = captureSpecialistRunVersions("operations_manager", "gpt-4o");
    expect(record.dnaVersion).toBe("1.0.0");
  });

  it("captureSpecialistRunVersions('nonexistent', 'gpt-4o').dnaVersion === 'N/A'", () => {
    const record = captureSpecialistRunVersions("nonexistent", "gpt-4o");
    expect(record.dnaVersion).toBe("N/A");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 9: Dispatch behaviour is unchanged
// ═══════════════════════════════════════════════════════════════════════════════

describe("Group 9: Dispatch behaviour is unchanged", () => {
  it("the eligibility service still blocks deprecated specialists", () => {
    // compliance_officer is deprecated in the workforce registry
    const result = validateSpecialistEligibilitySync("compliance_officer", "compliance.audit_readiness");
    expect(result).toBe(false);
  });

  it("the eligibility service allows current v2 compliance_quality_manager", () => {
    const result = validateSpecialistEligibilitySync("compliance_quality_manager", "compliance.audit_readiness");
    expect(result).toBe(true);
  });

  it("chief_of_staff is 'available' in the workforce registry", () => {
    const specialist = getSpecialistByCode("chief_of_staff");
    expect(specialist).toBeDefined();
    expect(specialist!.executionStatus).toBe("available");
  });

  it("chief_of_staff has dnaStatus 'approved' in the workforce registry", () => {
    const specialist = getSpecialistByCode("chief_of_staff");
    expect(specialist).toBeDefined();
    expect(specialist!.dnaStatus).toBe("approved");
  });

  it("operations_manager is 'available' in the workforce registry", () => {
    const specialist = getSpecialistByCode("operations_manager");
    expect(specialist).toBeDefined();
    expect(specialist!.executionStatus).toBe("available");
  });

  it("operations_manager has dnaStatus 'approved' in the workforce registry", () => {
    const specialist = getSpecialistByCode("operations_manager");
    expect(specialist).toBeDefined();
    expect(specialist!.dnaStatus).toBe("approved");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 10: Capability boundaries remain enforced
// ═══════════════════════════════════════════════════════════════════════════════

describe("Group 10: Capability boundaries remain enforced", () => {
  it("CHIEF_OF_STAFF_EMPLOYEE_FILE.authority.mayNot includes a payment-related prohibition", () => {
    const mayNot = CHIEF_OF_STAFF_EMPLOYEE_FILE.authority.mayNot;
    const hasPaymentProhibition = mayNot.some(
      item => item.toLowerCase().includes("payment") || item.toLowerCase().includes("pay") || item.toLowerCase().includes("financial transaction") || item.toLowerCase().includes("fund")
    );
    expect(hasPaymentProhibition).toBe(true);
  });

  it("CHIEF_OF_STAFF_EMPLOYEE_FILE.authority.mayNot includes a legislation-related prohibition", () => {
    const mayNot = CHIEF_OF_STAFF_EMPLOYEE_FILE.authority.mayNot;
    const hasLegislationProhibition = mayNot.some(
      item => item.toLowerCase().includes("legislat") || item.toLowerCase().includes("legal advice") || item.toLowerCase().includes("law") || item.toLowerCase().includes("legal")
    );
    expect(hasLegislationProhibition).toBe(true);
  });

  it("CHIEF_OF_STAFF_EMPLOYEE_FILE.authority.mayNot includes an automation-related prohibition", () => {
    const mayNot = CHIEF_OF_STAFF_EMPLOYEE_FILE.authority.mayNot;
    const hasAutomationProhibition = mayNot.some(
      item => item.toLowerCase().includes("automat") || item.toLowerCase().includes("without approval") || item.toLowerCase().includes("autonomously") || item.toLowerCase().includes("unilateral")
    );
    expect(hasAutomationProhibition).toBe(true);
  });

  it("The Runtime Manifest executionBoundaries.cannotDo is non-empty", () => {
    const manifest = compileRuntimeManifest(CHIEF_OF_STAFF_EMPLOYEE_FILE, null);
    expect(manifest.executionBoundaries.cannotDo.length).toBeGreaterThan(0);
  });

  it("The Runtime Manifest executionBoundaries.hardStops is non-empty", () => {
    const manifest = compileRuntimeManifest(CHIEF_OF_STAFF_EMPLOYEE_FILE, null);
    expect(manifest.executionBoundaries.hardStops.length).toBeGreaterThan(0);
  });

  it("validateEmployeeFile(CHIEF_OF_STAFF_EMPLOYEE_FILE) returns an empty array (no errors)", () => {
    const errors = validateEmployeeFile(CHIEF_OF_STAFF_EMPLOYEE_FILE);
    expect(errors).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Additional: Employee File structure validation
// ═══════════════════════════════════════════════════════════════════════════════

describe("Additional: Employee File structure validation", () => {
  it("CHIEF_OF_STAFF_EMPLOYEE_FILE.soul.traits.length >= 8", () => {
    expect(CHIEF_OF_STAFF_EMPLOYEE_FILE.soul.traits.length).toBeGreaterThanOrEqual(8);
  });

  it("CHIEF_OF_STAFF_EMPLOYEE_FILE.soul.traits.length <= 15", () => {
    expect(CHIEF_OF_STAFF_EMPLOYEE_FILE.soul.traits.length).toBeLessThanOrEqual(15);
  });

  it("CHIEF_OF_STAFF_EMPLOYEE_FILE.personality.traits.length >= 5", () => {
    expect(CHIEF_OF_STAFF_EMPLOYEE_FILE.personality.traits.length).toBeGreaterThanOrEqual(5);
  });

  it("CHIEF_OF_STAFF_EMPLOYEE_FILE.personality.avoid.length >= 4", () => {
    expect(CHIEF_OF_STAFF_EMPLOYEE_FILE.personality.avoid.length).toBeGreaterThanOrEqual(4);
  });

  it("CHIEF_OF_STAFF_EMPLOYEE_FILE.responsibilities.responsibilities.length >= 10", () => {
    expect(CHIEF_OF_STAFF_EMPLOYEE_FILE.responsibilities.responsibilities.length).toBeGreaterThanOrEqual(10);
  });

  it("CHIEF_OF_STAFF_EMPLOYEE_FILE.decisionPhilosophy.whenUncertaintyExists has at least 9 steps", () => {
    expect(CHIEF_OF_STAFF_EMPLOYEE_FILE.decisionPhilosophy.whenUncertaintyExists.length).toBeGreaterThanOrEqual(9);
  });

  it("CHIEF_OF_STAFF_EMPLOYEE_FILE.identity.title === 'AI Chief of Staff'", () => {
    expect(CHIEF_OF_STAFF_EMPLOYEE_FILE.identity.title).toBe("AI Chief of Staff");
  });

  it("CHIEF_OF_STAFF_EMPLOYEE_FILE.identity.department === 'Executive'", () => {
    expect(CHIEF_OF_STAFF_EMPLOYEE_FILE.identity.department).toBe("Executive");
  });

  it("CHIEF_OF_STAFF_EMPLOYEE_FILE.identity.reportsTo === 'Organisation Owner'", () => {
    expect(CHIEF_OF_STAFF_EMPLOYEE_FILE.identity.reportsTo).toBe("Organisation Owner");
  });
});
