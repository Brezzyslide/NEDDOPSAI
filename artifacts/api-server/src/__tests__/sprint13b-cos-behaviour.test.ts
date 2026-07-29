/**
 * Sprint 13b — Chief of Staff Behaviour Correction Tests
 *
 * Tests cover:
 *  1. Employee File decision philosophy has executive ownership rules (8 tests)
 *  2. Employee File communication style has proactive coordination rules (6 tests)
 *  3. Employee File responsibilities include proactive coordination (6 tests)
 *  4. Employee File authority prohibits generic response patterns (7 tests)
 *  5. CoS response validator — prohibited phrase detection (10 tests)
 *  6. System instructions prioritise Employee File (6 tests)
 *  7. Onboarding-specific regression (6 tests)
 *  8. Regression — existing CoS tests unaffected (6 tests)
 *
 * All tests are deterministic. No LLM calls, no DB calls.
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

// ─── Imports ──────────────────────────────────────────────────────────────────

import { COS_DECISION_PHILOSOPHY } from "../../../../lib/workforce-dna/src/employees/chief-of-staff/decision-philosophy.js";
import { COS_COMMUNICATION } from "../../../../lib/workforce-dna/src/employees/chief-of-staff/communication.js";
import { COS_RESPONSIBILITIES } from "../../../../lib/workforce-dna/src/employees/chief-of-staff/responsibilities.js";
import { COS_AUTHORITY } from "../../../../lib/workforce-dna/src/employees/chief-of-staff/authority.js";

import {
  NEEDSOPS_CONSTITUTION,
  CHIEF_OF_STAFF_EMPLOYEE_FILE,
  getEmployeeFile,
  buildSystemInstructionForEmployee,
  buildDNASystemInstruction,
  CHIEF_OF_STAFF_DNA,
  validateEmployeeFile,
} from "@workspace/workforce-dna";

// ─── cosResponseValidatorService import (expected API — will fail until created) ─

// We import with a try/catch pattern so tests can report the service is missing
// rather than blowing up the entire file with an import error.
// The expected interface:
//
//   interface CoSResponseQualityResult {
//     passed: boolean;
//     issues: string[];
//     hasInitialAssessment: boolean;
//     hasRecommendedNextStep: boolean;
//     notGenericAssistantLanguage: boolean;
//     doesNotTransferPlanningToUser: boolean;
//   }
//
//   function validateCoSBroadResponse(
//     response: string,
//     isBroadRequest: boolean,
//   ): CoSResponseQualityResult

import { validateCoSBroadResponse } from "../services/cosResponseValidatorService.js";

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 1: Employee File decision philosophy has executive ownership rules
// ═══════════════════════════════════════════════════════════════════════════════

describe("Group 1: Employee File decision philosophy has executive ownership rules", () => {
  it("whenUncertaintyExists has at least 10 steps", () => {
    expect(COS_DECISION_PHILOSOPHY.whenUncertaintyExists.length).toBeGreaterThanOrEqual(10);
  });

  it("first step mentions 'infer' or 'objective' (does not start with a generic seek-clarification pattern)", () => {
    const firstStep = COS_DECISION_PHILOSOPHY.whenUncertaintyExists[0]!.toLowerCase();
    const hasInferOrObjective = firstStep.includes("infer") || firstStep.includes("objective");
    const isGenericClarification =
      firstStep.startsWith("seek clarification") ||
      firstStep.startsWith("ask the user") ||
      firstStep.startsWith("request clarification");
    expect(hasInferOrObjective).toBe(true);
    expect(isGenericClarification).toBe(false);
  });

  it("has a step about providing 'initial answer' or 'assessment'", () => {
    const steps = COS_DECISION_PHILOSOPHY.whenUncertaintyExists.map(s => s.toLowerCase());
    const hasInitialAnswerOrAssessment = steps.some(
      s => s.includes("initial answer") || s.includes("assessment") || s.includes("initial")
    );
    expect(hasInitialAnswerOrAssessment).toBe(true);
  });

  it("has a step about 'plan' or 'structured'", () => {
    const steps = COS_DECISION_PHILOSOPHY.whenUncertaintyExists.map(s => s.toLowerCase());
    const hasPlanOrStructured = steps.some(
      s => s.includes("plan") || s.includes("structured")
    );
    expect(hasPlanOrStructured).toBe(true);
  });

  it("has a step about 'ownership' or 'coordinate the next step'", () => {
    const steps = COS_DECISION_PHILOSOPHY.whenUncertaintyExists.map(s => s.toLowerCase());
    const hasOwnershipOrCoordinate = steps.some(
      s => s.includes("ownership") || s.includes("coordinate") || s.includes("coordinating")
    );
    expect(hasOwnershipOrCoordinate).toBe(true);
  });

  it("guidingPrinciples includes a statement about 'structure of the work' and 'user owns the final decision'", () => {
    const principles = COS_DECISION_PHILOSOPHY.guidingPrinciples.map(p => p.toLowerCase());
    const hasStructureAndDecision = principles.some(
      p => (p.includes("structure") || p.includes("structure of the work")) &&
           (p.includes("user owns") || p.includes("final decision"))
    );
    expect(hasStructureAndDecision).toBe(true);
  });

  it("guidingPrinciples includes a statement about never answering a broad request with generic guidance", () => {
    const principles = COS_DECISION_PHILOSOPHY.guidingPrinciples.map(p => p.toLowerCase());
    const hasNoBroadGeneric = principles.some(
      p =>
        (p.includes("broad") || p.includes("generic")) &&
        (p.includes("never") || p.includes("not") || p.includes("only generic"))
    );
    expect(hasNoBroadGeneric).toBe(true);
  });

  it("guidingPrinciples includes a rule about clarification quality (clarification must reduce uncertainty)", () => {
    const principles = COS_DECISION_PHILOSOPHY.guidingPrinciples.map(p => p.toLowerCase());
    const hasClarificationQuality = principles.some(
      p =>
        p.includes("clarif") &&
        (p.includes("reduce") || p.includes("uncertainty") || p.includes("defined uncertainty"))
    );
    expect(hasClarificationQuality).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 2: Employee File communication style has proactive coordination rules
// ═══════════════════════════════════════════════════════════════════════════════

describe("Group 2: Employee File communication style has proactive coordination rules", () => {
  it("characteristics includes a value about leading with assessment (not a question)", () => {
    const chars = COS_COMMUNICATION.characteristics.map(c => c.toLowerCase());
    const hasLeadWithAssessment = chars.some(
      c => (c.includes("lead") || c.includes("leads")) &&
           (c.includes("assessment") || c.includes("initial assessment"))
    );
    expect(hasLeadWithAssessment).toBe(true);
  });

  it("characteristics includes a value about structured plans before clarification", () => {
    const chars = COS_COMMUNICATION.characteristics.map(c => c.toLowerCase());
    const hasPlanBeforeClarification = chars.some(
      c => c.includes("plan") && c.includes("clarif")
    );
    expect(hasPlanBeforeClarification).toBe(true);
  });

  it("characteristics includes a value about targeted clarification", () => {
    const chars = COS_COMMUNICATION.characteristics.map(c => c.toLowerCase());
    const hasTargetedClarification = chars.some(
      c => c.includes("targeted") || (c.includes("clarif") && c.includes("specific"))
    );
    expect(hasTargetedClarification).toBe(true);
  });

  it("characteristics includes a value about ownership of work structure", () => {
    const chars = COS_COMMUNICATION.characteristics.map(c => c.toLowerCase());
    const hasOwnershipOfWork = chars.some(
      c => c.includes("ownership") || c.includes("structuring the work") || c.includes("structure")
    );
    expect(hasOwnershipOfWork).toBe(true);
  });

  it("characteristics includes a value about customer organisation language", () => {
    const chars = COS_COMMUNICATION.characteristics.map(c => c.toLowerCase());
    const hasOrgLanguage = chars.some(
      c => (c.includes("organisation") || c.includes("organization")) &&
           (c.includes("your") || c.includes("customer"))
    );
    expect(hasOrgLanguage).toBe(true);
  });

  it("distinguish includes 'targeted clarification vs open-ended offers'", () => {
    const distinguish = COS_COMMUNICATION.distinguish.map(d => d.toLowerCase());
    const hasTargetedVsOpenEnded = distinguish.some(
      d => d.includes("targeted") && (d.includes("open-ended") || d.includes("clarification"))
    );
    expect(hasTargetedVsOpenEnded).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 3: Employee File responsibilities include proactive coordination
// ═══════════════════════════════════════════════════════════════════════════════

describe("Group 3: Employee File responsibilities include proactive coordination", () => {
  it("responsibilities includes an item about inferring objectives from broad requests", () => {
    const items = COS_RESPONSIBILITIES.responsibilities.map(r => r.toLowerCase());
    const hasInferObjective = items.some(
      r => (r.includes("infer") || r.includes("interpret")) &&
           (r.includes("objective") || r.includes("broad"))
    );
    expect(hasInferObjective).toBe(true);
  });

  it("responsibilities includes an item about initial assessment", () => {
    const items = COS_RESPONSIBILITIES.responsibilities.map(r => r.toLowerCase());
    const hasInitialAssessment = items.some(
      r => r.includes("initial") && (r.includes("assessment") || r.includes("answer") || r.includes("useful"))
    );
    expect(hasInitialAssessment).toBe(true);
  });

  it("responsibilities includes an item about structured coordination plan", () => {
    const items = COS_RESPONSIBILITIES.responsibilities.map(r => r.toLowerCase());
    const hasStructuredPlan = items.some(
      r => r.includes("structured") && (r.includes("plan") || r.includes("coordination"))
    );
    expect(hasStructuredPlan).toBe(true);
  });

  it("responsibilities includes an item about assigning AI Employees", () => {
    const items = COS_RESPONSIBILITIES.responsibilities.map(r => r.toLowerCase());
    const hasAssignEmployees = items.some(
      r => r.includes("assign") || r.includes("ai employee") || r.includes("specialist")
    );
    expect(hasAssignEmployees).toBe(true);
  });

  it("responsibilities includes an item about owning the structure of work", () => {
    const items = COS_RESPONSIBILITIES.responsibilities.map(r => r.toLowerCase());
    const hasOwnWork = items.some(
      r => r.includes("own") && (r.includes("structure") || r.includes("work"))
    );
    expect(hasOwnWork).toBe(true);
  });

  it("responsibilities has at least 18 items total", () => {
    expect(COS_RESPONSIBILITIES.responsibilities.length).toBeGreaterThanOrEqual(18);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 4: Employee File authority prohibits generic response patterns
// ═══════════════════════════════════════════════════════════════════════════════

describe("Group 4: Employee File authority prohibits generic response patterns", () => {
  it("mayNot includes an item about broad requests with only generic guidance", () => {
    const items = COS_AUTHORITY.mayNot.map(i => i.toLowerCase());
    const hasBroadGenericProhibition = items.some(
      i => i.includes("broad") && (i.includes("generic") || i.includes("open-ended"))
    );
    expect(hasBroadGenericProhibition).toBe(true);
  });

  it("mayNot includes an item about asking 'what would you like help with'", () => {
    const items = COS_AUTHORITY.mayNot.map(i => i.toLowerCase());
    const hasWhatWouldYouLike = items.some(
      i =>
        (i.includes("what specifically") || i.includes("what would you like") || i.includes("what do you")) &&
        (i.includes("help") || i.includes("like"))
    );
    expect(hasWhatWouldYouLike).toBe(true);
  });

  it("mayNot includes an item about clarification quality (questions that don't reduce uncertainty)", () => {
    const items = COS_AUTHORITY.mayNot.map(i => i.toLowerCase());
    const hasClarificationQuality = items.some(
      i => i.includes("clarif") && (i.includes("reduce") || i.includes("uncertainty") || i.includes("defined uncertainty"))
    );
    expect(hasClarificationQuality).toBe(true);
  });

  it("mayNot includes an item about transferring planning responsibility to the user", () => {
    const items = COS_AUTHORITY.mayNot.map(i => i.toLowerCase());
    const hasTransferProhibition = items.some(
      i => (i.includes("transfer") || i.includes("hand") || i.includes("back to the user")) &&
           (i.includes("structuring") || i.includes("planning") || i.includes("responsibility") || i.includes("work"))
    );
    expect(hasTransferProhibition).toBe(true);
  });

  it("mayNot includes an item about claiming specialist coordination without a delegation plan", () => {
    const items = COS_AUTHORITY.mayNot.map(i => i.toLowerCase());
    const hasCoordinationWithoutPlan = items.some(
      i =>
        (i.includes("specialist") || i.includes("coordinated")) &&
        (i.includes("without") || i.includes("delegation plan") || i.includes("plan"))
    );
    expect(hasCoordinationWithoutPlan).toBe(true);
  });

  it("mayNot includes an item about 'our resources' / 'our policies' language", () => {
    const items = COS_AUTHORITY.mayNot.map(i => i.toLowerCase());
    const hasOurPoliciesProhibition = items.some(
      i => i.includes("our") && (i.includes("resource") || i.includes("polic") || i.includes("procedure"))
    );
    expect(hasOurPoliciesProhibition).toBe(true);
  });

  it("mayNot has at least 12 items total", () => {
    expect(COS_AUTHORITY.mayNot.length).toBeGreaterThanOrEqual(12);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 5: CoS response validator — prohibited phrase detection
// ═══════════════════════════════════════════════════════════════════════════════

describe("Group 5: CoS response validator — prohibited phrase detection", () => {
  it('"Please let me know how I can specifically help you today" fails notGenericAssistantLanguage', () => {
    const result = validateCoSBroadResponse(
      "Please let me know how I can specifically help you today.",
      true,
    );
    expect(result.notGenericAssistantLanguage).toBe(false);
    expect(result.passed).toBe(false);
  });

  it('"If you have specific areas you\'d like to focus on" fails notGenericAssistantLanguage', () => {
    const result = validateCoSBroadResponse(
      "If you have specific areas you'd like to focus on, I'm happy to help.",
      true,
    );
    expect(result.notGenericAssistantLanguage).toBe(false);
    expect(result.passed).toBe(false);
  });

  it('"I can assist you with various aspects" fails notGenericAssistantLanguage', () => {
    const result = validateCoSBroadResponse(
      "I can assist you with various aspects of running your organisation.",
      true,
    );
    expect(result.notGenericAssistantLanguage).toBe(false);
    expect(result.passed).toBe(false);
  });

  it('"What specifically would you like help with?" fails notGenericAssistantLanguage', () => {
    const result = validateCoSBroadResponse(
      "What specifically would you like help with?",
      true,
    );
    expect(result.notGenericAssistantLanguage).toBe(false);
    expect(result.passed).toBe(false);
  });

  it("a response with an initial assessment, recommended next step, and a targeted question passes", () => {
    const goodResponse = [
      "Based on your request, the most likely objective is to establish onboarding processes for new support workers.",
      "My initial assessment: your organisation needs three things — a Welcome Pack, a compliance checklist, and a training schedule.",
      "I recommend we begin with the compliance checklist to ensure NDIS registration requirements are met.",
      "To confirm direction: are you onboarding one worker or setting up a repeatable process for multiple hires?",
    ].join(" ");

    const result = validateCoSBroadResponse(goodResponse, true);
    expect(result.passed).toBe(true);
    expect(result.notGenericAssistantLanguage).toBe(true);
  });

  it("a response with prohibited phrases returns passed: false", () => {
    const result = validateCoSBroadResponse(
      "How can I help you today? Please let me know what you need.",
      true,
    );
    expect(result.passed).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it("a response that transfers planning to the user fails doesNotTransferPlanningToUser", () => {
    // Contains a PLANNING_TRANSFER_SIGNAL ("what areas would you like") —
    // this is a planning transfer, not a prohibited phrase
    const transferResponse =
      "There are many areas of workforce management to consider. " +
      "What areas would you like me to focus on first?";
    const result = validateCoSBroadResponse(transferResponse, true);
    expect(result.doesNotTransferPlanningToUser).toBe(false);
    expect(result.passed).toBe(false);
  });

  it("non-broad requests (short direct answers, isBroadRequest: false) always pass", () => {
    const shortAnswer = "The SCHADS Award pay rate for a Level 2 support worker is $25.41 per hour.";
    const result = validateCoSBroadResponse(shortAnswer, false);
    expect(result.passed).toBe(true);
  });

  it("a response containing both valid content and a prohibited phrase fails", () => {
    const mixedResponse = [
      "Based on your request, the most likely goal is onboarding new support workers.",
      "I recommend starting with the NDIS compliance checklist.",
      "Please let me know how I can help with anything else.",
    ].join(" ");
    const result = validateCoSBroadResponse(mixedResponse, true);
    expect(result.passed).toBe(false);
    expect(result.notGenericAssistantLanguage).toBe(false);
  });

  it("onboarding regression: response to 'What resources do I need?' must not contain prohibited phrases", () => {
    // This validates that a well-formed onboarding response passes
    const onboardingResponse = [
      "Based on your request, the primary objective appears to be establishing a complete onboarding process for new support workers.",
      "Your organisation will need: (1) A Welcome Pack covering your organisation's values, (2) NDIS compliance documentation, (3) a training schedule, and (4) a competency sign-off checklist.",
      "I will coordinate the HR Officer to draft the Welcome Pack and the Compliance Officer to build the documentation checklist.",
      "To confirm scope: are you onboarding individual workers or building a repeatable process for ongoing recruitment?",
    ].join(" ");
    const result = validateCoSBroadResponse(onboardingResponse, true);
    expect(result.passed).toBe(true);
    expect(result.notGenericAssistantLanguage).toBe(true);
    expect(result.issues.filter(i =>
      i.toLowerCase().includes("prohibited") || i.toLowerCase().includes("phrase")
    ).length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 6: System instructions prioritise Employee File
// ═══════════════════════════════════════════════════════════════════════════════

describe("Group 6: System instructions prioritise Employee File", () => {
  it("buildSystemInstructionForEmployee('chief_of_staff') returns a non-empty string", () => {
    const instruction = buildSystemInstructionForEmployee("chief_of_staff");
    expect(typeof instruction).toBe("string");
    expect(instruction.length).toBeGreaterThan(0);
  });

  it("the returned string contains 'Chief of Staff' in the title", () => {
    const instruction = buildSystemInstructionForEmployee("chief_of_staff");
    expect(instruction).toContain("Chief of Staff");
  });

  it("the returned string contains the constitution preamble (check for 'Constitution' or 'NeedsOps')", () => {
    const instruction = buildSystemInstructionForEmployee("chief_of_staff");
    const hasConstitutionReference =
      instruction.includes("Constitution") ||
      instruction.includes("NeedsOps");
    expect(hasConstitutionReference).toBe(true);
  });

  it("the returned string contains mission content", () => {
    const instruction = buildSystemInstructionForEmployee("chief_of_staff");
    // The Employee File instruction builder includes "## MISSION" section
    expect(instruction).toContain("MISSION");
  });

  it("the returned string contains authority section (check for 'MAY NOT' or 'AUTHORITY')", () => {
    const instruction = buildSystemInstructionForEmployee("chief_of_staff");
    const hasAuthority =
      instruction.includes("MAY NOT") ||
      instruction.includes("AUTHORITY");
    expect(hasAuthority).toBe(true);
  });

  it("buildSystemInstructionForEmployee('chief_of_staff') length > buildDNASystemInstruction('chief_of_staff') length (Employee File instruction is richer)", () => {
    const employeeInstruction = buildSystemInstructionForEmployee("chief_of_staff");
    const dnaInstruction = buildDNASystemInstruction("chief_of_staff");
    expect(employeeInstruction.length).toBeGreaterThan(dnaInstruction.length);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 7: Onboarding-specific regression
// ═══════════════════════════════════════════════════════════════════════════════

describe("Group 7: Onboarding-specific regression", () => {
  it("validator rejects: 'You will need policies, procedures and training resources. Let me know what you want help with.'", () => {
    const result = validateCoSBroadResponse(
      "You will need policies, procedures and training resources. Let me know what you want help with.",
      true,
    );
    expect(result.passed).toBe(false);
  });

  it("validator rejects: 'I can assist you with various aspects of your onboarding needs.'", () => {
    const result = validateCoSBroadResponse(
      "I can assist you with various aspects of your onboarding needs.",
      true,
    );
    expect(result.passed).toBe(false);
    expect(result.notGenericAssistantLanguage).toBe(false);
  });

  it("validator accepts response containing 'your organisation' (not 'our organisation')", () => {
    const response = [
      "Your organisation's onboarding process should cover compliance documentation and training.",
      "I recommend starting with the NDIS Practice Standards checklist.",
      "To confirm: is this for a single hire or a scalable onboarding framework?",
    ].join(" ");
    const result = validateCoSBroadResponse(response, true);
    expect(result.passed).toBe(true);
    // Must not contain "our organisation" language (word-boundary safe check)
    // Note: "your organisation" is CORRECT; "our organisation" (standalone) is PROHIBITED
    expect(/\bour organisation\b/.test(response.toLowerCase())).toBe(false);
    expect(/\bour organization\b/.test(response.toLowerCase())).toBe(false);
  });

  it("validator accepts response containing an initial assessment", () => {
    const response = [
      "Initial assessment: your onboarding needs span three areas — compliance, training, and cultural induction.",
      "I will coordinate the HR Officer and Compliance Officer to produce a joint onboarding checklist.",
      "Which employee type are we onboarding first — support worker, team leader, or coordinator?",
    ].join(" ");
    const result = validateCoSBroadResponse(response, true);
    expect(result.passed).toBe(true);
    expect(result.hasInitialAssessment).toBe(true);
  });

  it("validator accepts response that names specific employee coordination", () => {
    const response = [
      "Based on your request, the goal is a complete onboarding kit for new support workers.",
      "I will assign the HR Officer to draft the employment documentation and the Compliance Officer to build the NDIS compliance checklist.",
      "The Operations Officer will review scheduling and shift handover requirements.",
      "To proceed: is the first hire starting within 2 weeks or do we have time for a full framework build?",
    ].join(" ");
    const result = validateCoSBroadResponse(response, true);
    expect(result.passed).toBe(true);
  });

  it("response to onboarding must contain a targeted question about user role (owner/manager/worker)", () => {
    // A valid CoS onboarding response should contain onboard-related content
    // and a targeted role qualifier question
    const validOnboardingResponse = [
      "Based on your query about resources for onboarding, the objective is to build a repeatable onboarding process.",
      "Your organisation will need: documentation templates, NDIS compliance materials, and a training schedule.",
      "I will coordinate the HR Officer and Compliance Officer to produce these.",
      "To confirm scope: are you an owner setting up systems, a manager onboarding a specific worker, or a worker completing self-induction?",
    ].join(" ");

    // Check it contains onboarding and a role qualifier
    const hasOnboard = validOnboardingResponse.toLowerCase().includes("onboard");
    const hasRoleQualifier =
      validOnboardingResponse.toLowerCase().includes("owner") ||
      validOnboardingResponse.toLowerCase().includes("manager") ||
      validOnboardingResponse.toLowerCase().includes("worker");

    expect(hasOnboard).toBe(true);
    expect(hasRoleQualifier).toBe(true);

    // Also validate it passes the validator
    const result = validateCoSBroadResponse(validOnboardingResponse, true);
    expect(result.passed).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 8: Regression — existing CoS tests unaffected
// ═══════════════════════════════════════════════════════════════════════════════

describe("Group 8: Regression — existing CoS tests unaffected", () => {
  it("CHIEF_OF_STAFF_EMPLOYEE_FILE is still intact", () => {
    expect(CHIEF_OF_STAFF_EMPLOYEE_FILE).toBeDefined();
    expect(typeof CHIEF_OF_STAFF_EMPLOYEE_FILE).toBe("object");
    expect(CHIEF_OF_STAFF_EMPLOYEE_FILE.identity.roleCode).toBe("chief_of_staff");
  });

  it("CHIEF_OF_STAFF_DNA.currentVersion.isActive is still true (DNA v1 unchanged)", () => {
    expect(CHIEF_OF_STAFF_DNA.currentVersion.isActive).toBe(true);
    expect(CHIEF_OF_STAFF_DNA.currentVersion.version).toBe("1.0.0");
  });

  it("getEmployeeFile('chief_of_staff') still returns CHIEF_OF_STAFF_EMPLOYEE_FILE", () => {
    const file = getEmployeeFile("chief_of_staff");
    expect(file).not.toBeNull();
    expect(file).toBe(CHIEF_OF_STAFF_EMPLOYEE_FILE);
  });

  it("buildSystemInstructionForEmployee('chief_of_staff') does not throw", () => {
    expect(() => buildSystemInstructionForEmployee("chief_of_staff")).not.toThrow();
  });

  it("validateEmployeeFile(CHIEF_OF_STAFF_EMPLOYEE_FILE) returns no errors", () => {
    const errors = validateEmployeeFile(CHIEF_OF_STAFF_EMPLOYEE_FILE);
    expect(errors).toEqual([]);
  });

  it("NEEDSOPS_CONSTITUTION is still intact (10 principles)", () => {
    expect(NEEDSOPS_CONSTITUTION).toHaveLength(10);
    // All principles must have a number, title, and statement
    for (const principle of NEEDSOPS_CONSTITUTION) {
      expect(typeof principle.number).toBe("number");
      expect(typeof principle.title).toBe("string");
      expect(typeof principle.statement).toBe("string");
      expect(principle.statement.length).toBeGreaterThan(0);
    }
  });
});
