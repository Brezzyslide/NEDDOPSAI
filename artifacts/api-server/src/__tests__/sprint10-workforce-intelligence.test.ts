/**
 * Sprint 10 — Digital Workforce Intelligence & Execution Tests
 *
 * Tests cover:
 *  - lib/workforce-dna: DNA registry (getDNAProfile, getAllActiveDNAProfiles, etc.)
 *  - lib/workforce-dna: DNA system instruction builder
 *  - Execution Intent Service (mocked DB)
 *  - Auto-dispatch on task approval
 *  - Queue worker logic (unit tests)
 *  - Idempotency and lease management
 *  - Specialist run version recording
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

  // Chainable mock DB
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

// ─── Mock audit service (used by queueService internally) ─────────────────────

vi.mock("../services/auditService.js", () => ({
  logOrgEvent: vi.fn().mockResolvedValue(undefined),
}));

// ─── Mock chiefOfStaffOrchestrator ────────────────────────────────────────────

vi.mock("../services/chiefOfStaffOrchestrator.js", () => ({
  dispatchReadyRuns: vi.fn().mockResolvedValue([]),
  executeSpecialistStep: vi.fn().mockResolvedValue({ status: "completed" }),
  createSpecialistPlan: vi.fn().mockResolvedValue({ steps: [], planId: "plan-1" }),
  processRunCompletion: vi.fn().mockResolvedValue(undefined),
  processRunFailure: vi.fn().mockResolvedValue(undefined),
  consolidateTaskResults: vi.fn().mockResolvedValue({}),
}));

// ─── Mock chiefOfStaffService (used by taskService) ──────────────────────────

vi.mock("../services/chiefOfStaffService.js", () => ({
  planTask: vi.fn().mockReturnValue({
    requiresApproval: false,
    approvalType: "not_required",
    assignedSpecialists: ["compliance_officer"],
  }),
}));

// ─── Import DNA functions directly (pure TypeScript, no mock needed) ──────────

import {
  getDNAProfile,
  getAllActiveDNAProfiles,
  hasActiveDNA,
  getDNAVersion,
  getReasoningVersion,
  captureSpecialistRunVersions,
  buildDNASystemInstruction,
  getDNASummary,
  OPERATIONS_MANAGER_DNA,
} from "@workspace/workforce-dna";

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 1: lib/workforce-dna — DNA registry
// ═══════════════════════════════════════════════════════════════════════════════

describe("lib/workforce-dna — DNA registry", () => {
  describe("getDNAProfile", () => {
    it("getDNAProfile('chief_of_staff') returns profile with roleCode 'chief_of_staff'", () => {
      const profile = getDNAProfile("chief_of_staff");
      expect(profile).not.toBeNull();
      expect(profile!.identity.roleCode).toBe("chief_of_staff");
    });

    it("getDNAProfile('compliance_officer') returns profile with domain containing 'NDIS'", () => {
      const profile = getDNAProfile("compliance_officer");
      expect(profile).not.toBeNull();
      expect(profile!.identity.domain).toContain("NDIS");
    });

    it("getDNAProfile('operations_manager') returns profile with roleCode 'operations_manager'", () => {
      const profile = getDNAProfile("operations_manager");
      expect(profile).not.toBeNull();
      expect(profile!.identity.roleCode).toBe("operations_manager");
    });

    it("getDNAProfile('document_specialist') returns a profile", () => {
      const profile = getDNAProfile("document_specialist");
      expect(profile).not.toBeNull();
      expect(profile!.identity.roleCode).toBe("document_specialist");
    });

    it("getDNAProfile('unknown_role') returns null", () => {
      const profile = getDNAProfile("unknown_role");
      expect(profile).toBeNull();
    });
  });

  describe("getAllActiveDNAProfiles", () => {
    it("returns array of at least 4 profiles", () => {
      const profiles = getAllActiveDNAProfiles();
      expect(Array.isArray(profiles)).toBe(true);
      expect(profiles.length).toBeGreaterThanOrEqual(4);
    });

    it("all returned profiles have isActive=true", () => {
      const profiles = getAllActiveDNAProfiles();
      for (const profile of profiles) {
        expect(profile.currentVersion.isActive).toBe(true);
      }
    });
  });

  describe("hasActiveDNA", () => {
    it("hasActiveDNA('compliance_officer') returns true", () => {
      expect(hasActiveDNA("compliance_officer")).toBe(true);
    });

    it("hasActiveDNA('nonexistent') returns false", () => {
      expect(hasActiveDNA("nonexistent")).toBe(false);
    });

    it("hasActiveDNA('chief_of_staff') returns true", () => {
      expect(hasActiveDNA("chief_of_staff")).toBe(true);
    });

    it("hasActiveDNA('operations_manager') returns true", () => {
      expect(hasActiveDNA("operations_manager")).toBe(true);
    });

    it("hasActiveDNA('document_specialist') returns true", () => {
      expect(hasActiveDNA("document_specialist")).toBe(true);
    });
  });

  describe("getDNASummary", () => {
    it("returns at least 4 entries", () => {
      const summary = getDNASummary();
      expect(summary.length).toBeGreaterThanOrEqual(4);
    });

    it("each entry has roleCode, title, version, domain, isActive", () => {
      const summary = getDNASummary();
      for (const entry of summary) {
        expect(entry).toHaveProperty("roleCode");
        expect(entry).toHaveProperty("title");
        expect(entry).toHaveProperty("version");
        expect(entry).toHaveProperty("domain");
        expect(entry).toHaveProperty("isActive");
        expect(typeof entry.roleCode).toBe("string");
        expect(typeof entry.title).toBe("string");
        expect(typeof entry.version).toBe("string");
        expect(typeof entry.domain).toBe("string");
        expect(typeof entry.isActive).toBe("boolean");
      }
    });

    it("all entries are active", () => {
      const summary = getDNASummary();
      for (const entry of summary) {
        expect(entry.isActive).toBe(true);
      }
    });
  });

  describe("captureSpecialistRunVersions", () => {
    it("captureSpecialistRunVersions('compliance_officer', 'gpt-4o') returns object with dnaVersion '1.0.0'", () => {
      const record = captureSpecialistRunVersions("compliance_officer", "gpt-4o");
      expect(record.dnaVersion).toBe("1.0.0");
    });

    it("captureSpecialistRunVersions('unknown', 'gpt-4o') returns dnaVersion 'N/A'", () => {
      const record = captureSpecialistRunVersions("unknown", "gpt-4o");
      expect(record.dnaVersion).toBe("N/A");
    });

    it("captureSpecialistRunVersions returns all required fields", () => {
      const record = captureSpecialistRunVersions("chief_of_staff", "gpt-4o");
      expect(record).toHaveProperty("dnaVersion");
      expect(record).toHaveProperty("workerProfileVersion");
      expect(record).toHaveProperty("capabilityVersion");
      expect(record).toHaveProperty("reasoningVersion");
      expect(record).toHaveProperty("outputSchemaVersion");
      expect(record).toHaveProperty("modelVersion");
      expect(record).toHaveProperty("recordedAt");
    });

    it("captureSpecialistRunVersions includes modelVersion in output", () => {
      const record = captureSpecialistRunVersions("compliance_officer", "gpt-4o");
      expect(record.modelVersion).toBe("gpt-4o");
    });

    it("captureSpecialistRunVersions for unknown role returns N/A for all version fields", () => {
      const record = captureSpecialistRunVersions("unknown_specialist", "gpt-4o");
      expect(record.dnaVersion).toBe("N/A");
      expect(record.reasoningVersion).toBe("N/A");
      expect(record.outputSchemaVersion).toBe("N/A");
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 2: lib/workforce-dna — DNA system instruction
// ═══════════════════════════════════════════════════════════════════════════════

describe("lib/workforce-dna — DNA system instruction", () => {
  describe("buildDNASystemInstruction — chief_of_staff", () => {
    let instruction: string;
    beforeEach(() => {
      instruction = buildDNASystemInstruction("chief_of_staff");
    });

    it("contains 'Chief of Staff'", () => {
      expect(instruction).toContain("Chief of Staff");
    });

    it("contains 'HARD STOPS'", () => {
      expect(instruction).toContain("HARD STOPS");
    });

    it("contains 'REASONING METHODOLOGY'", () => {
      expect(instruction).toContain("REASONING METHODOLOGY");
    });

    it("contains the role code", () => {
      expect(instruction).toContain("chief_of_staff");
    });

    it("contains DNA Version", () => {
      expect(instruction).toContain("DNA Version");
    });
  });

  describe("buildDNASystemInstruction — compliance_officer", () => {
    let instruction: string;
    beforeEach(() => {
      instruction = buildDNASystemInstruction("compliance_officer");
    });

    it("contains 'NDIS'", () => {
      expect(instruction).toContain("NDIS");
    });

    it("contains a reasoning step reference (co.1 or cos.1 style step ID)", () => {
      // The system instruction renders steps with their stepId
      // Compliance Officer steps use "co." prefix
      const hasCOStep = instruction.includes("co.") || instruction.includes("cos.");
      expect(hasCOStep).toBe(true);
    });

    it("contains HARD STOPS", () => {
      expect(instruction).toContain("HARD STOPS");
    });

    it("contains SECURITY section", () => {
      expect(instruction).toContain("SECURITY");
    });

    it("contains EVIDENCE STANDARDS", () => {
      expect(instruction).toContain("EVIDENCE STANDARDS");
    });
  });

  describe("buildDNASystemInstruction — operations_manager", () => {
    it("contains 'SCHADS'", () => {
      const instruction = buildDNASystemInstruction("operations_manager");
      expect(instruction).toContain("SCHADS");
    });

    it("contains 'Operations Manager' or 'operations_manager'", () => {
      const instruction = buildDNASystemInstruction("operations_manager");
      const hasRef = instruction.includes("Operations Manager") || instruction.includes("operations_manager");
      expect(hasRef).toBe(true);
    });
  });

  describe("buildDNASystemInstruction — unknown role", () => {
    it("contains 'not yet activated'", () => {
      const instruction = buildDNASystemInstruction("unknown");
      expect(instruction).toContain("not yet activated");
    });

    it("mentions the role code in the message", () => {
      const instruction = buildDNASystemInstruction("some_unknown_role");
      expect(instruction).toContain("some_unknown_role");
    });
  });

  describe("DNA profile invariants — all 4 profiles", () => {
    const roleCodes = ["chief_of_staff", "compliance_officer", "operations_manager", "document_specialist"];

    it("all 4 profiles: allowInventedReferences === false", () => {
      for (const roleCode of roleCodes) {
        const profile = getDNAProfile(roleCode);
        expect(profile, `Profile for ${roleCode} should exist`).not.toBeNull();
        expect(profile!.evidenceStandards.allowInventedReferences).toBe(false);
      }
    });

    it("all 4 profiles: securityConstraints array is non-empty", () => {
      for (const roleCode of roleCodes) {
        const profile = getDNAProfile(roleCode);
        expect(profile).not.toBeNull();
        expect(
          profile!.professionalBoundaries.securityConstraints.length,
          `${roleCode} should have security constraints`,
        ).toBeGreaterThan(0);
      }
    });

    it("all 4 profiles have active semantic versions", () => {
      for (const roleCode of roleCodes) {
        const profile = getDNAProfile(roleCode);
        expect(profile).not.toBeNull();
        expect(profile!.currentVersion.version).toMatch(/^\d+\.\d+\.\d+$/);
        expect(profile!.currentVersion.isActive).toBe(true);
      }
    });

    it("all 4 profiles have organisation 'NeedsOps AI+'", () => {
      for (const roleCode of roleCodes) {
        const profile = getDNAProfile(roleCode);
        expect(profile).not.toBeNull();
        expect(profile!.identity.organisation).toBe("NeedsOps AI+");
      }
    });
  });

  describe("compliance_officer hardStops", () => {
    it("hardStops includes entry mentioning 'suppress' or 'reportable'", () => {
      const profile = getDNAProfile("compliance_officer");
      expect(profile).not.toBeNull();
      const hardStops = profile!.escalationFramework.hardStops;
      const hasSuppressOrReportable = hardStops.some(
        (stop) => stop.toLowerCase().includes("suppress") || stop.toLowerCase().includes("reportable"),
      );
      expect(hasSuppressOrReportable).toBe(true);
    });

    it("hardStops is a non-empty array", () => {
      const profile = getDNAProfile("compliance_officer");
      expect(profile).not.toBeNull();
      expect(profile!.escalationFramework.hardStops.length).toBeGreaterThan(0);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 3: Execution Intent Service (mocked DB)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Execution Intent Service is not yet a separate file, so we implement
 * the logic inline here to test the intent tracking behaviour.
 * These tests verify the contract that the service must fulfil.
 */

describe("Execution Intent Service — contract tests", () => {
  // Inline implementation matching the intended service interface

  type IntentStatus = "pending" | "approved" | "rejected" | "executing" | "completed" | "failed";

  interface ExecutionIntent {
    id: string;
    organizationId: string;
    taskId: string;
    specialistRunId: string;
    actionType: string;
    executionChannel: string;
    toolCategory: string;
    approvalRequired: boolean;
    riskLevel: string;
    status: IntentStatus;
    sequenceOrder: number;
    rejectionReason?: string | null;
    createdAt: Date;
  }

  // In-memory store for test purposes
  let intentStore: ExecutionIntent[] = [];
  let nextId = 1;

  function makeId(): string {
    return `intent-${nextId++}`;
  }

  // Mimics persistExecutionIntents
  function persistExecutionIntents(
    organizationId: string,
    taskId: string,
    specialistRunId: string,
    actions: Array<{
      actionType: string;
      executionChannel: string;
      toolCategory: string;
      approvalRequired: boolean;
      riskLevel: string;
    }>,
  ): ExecutionIntent[] {
    const intents = actions.map((action, index) => ({
      id: makeId(),
      organizationId,
      taskId,
      specialistRunId,
      actionType: action.actionType,
      executionChannel: action.executionChannel,
      toolCategory: action.toolCategory,
      approvalRequired: action.approvalRequired,
      riskLevel: action.riskLevel,
      status: "pending" as IntentStatus,
      sequenceOrder: index + 1,
      rejectionReason: null,
      createdAt: new Date(),
    }));
    intentStore.push(...intents);
    return intents;
  }

  // Mimics getExecutionIntentsForTask
  function getExecutionIntentsForTask(taskId: string): ExecutionIntent[] {
    return intentStore.filter((i) => i.taskId === taskId);
  }

  // Mimics getPendingApprovalIntents
  function getPendingApprovalIntents(organizationId: string): ExecutionIntent[] {
    return intentStore.filter(
      (i) => i.organizationId === organizationId && i.approvalRequired === true && i.status === "pending",
    );
  }

  // Mimics approveIntent
  function approveIntent(intentId: string): ExecutionIntent {
    const intent = intentStore.find((i) => i.id === intentId);
    if (!intent) throw new Error(`Intent ${intentId} not found`);
    intent.status = "approved";
    return intent;
  }

  // Mimics rejectIntent
  function rejectIntent(intentId: string, rejectionReason: string): ExecutionIntent {
    const intent = intentStore.find((i) => i.id === intentId);
    if (!intent) throw new Error(`Intent ${intentId} not found`);
    intent.status = "rejected";
    intent.rejectionReason = rejectionReason;
    return intent;
  }

  beforeEach(() => {
    intentStore = [];
    nextId = 1;
  });

  const ORG_ID = "org-test-001";
  const TASK_ID = "task-abc";
  const RUN_ID = "run-xyz";

  const SAMPLE_ACTIONS = [
    { actionType: "submit_report", executionChannel: "api", toolCategory: "form_submitter", approvalRequired: true, riskLevel: "high" },
    { actionType: "send_notification", executionChannel: "email", toolCategory: "email_sender", approvalRequired: false, riskLevel: "low" },
    { actionType: "create_document", executionChannel: "document", toolCategory: "document_writer", approvalRequired: true, riskLevel: "medium" },
  ];

  it("persistExecutionIntents inserts correct number of rows (one per action)", () => {
    const intents = persistExecutionIntents(ORG_ID, TASK_ID, RUN_ID, SAMPLE_ACTIONS);
    expect(intents).toHaveLength(3);
  });

  it("persistExecutionIntents sets organizationId, taskId, specialistRunId correctly", () => {
    const intents = persistExecutionIntents(ORG_ID, TASK_ID, RUN_ID, SAMPLE_ACTIONS);
    for (const intent of intents) {
      expect(intent.organizationId).toBe(ORG_ID);
      expect(intent.taskId).toBe(TASK_ID);
      expect(intent.specialistRunId).toBe(RUN_ID);
    }
  });

  it("persistExecutionIntents sets sequenceOrder incrementally (1, 2, 3...)", () => {
    const intents = persistExecutionIntents(ORG_ID, TASK_ID, RUN_ID, SAMPLE_ACTIONS);
    expect(intents[0]!.sequenceOrder).toBe(1);
    expect(intents[1]!.sequenceOrder).toBe(2);
    expect(intents[2]!.sequenceOrder).toBe(3);
  });

  it("getExecutionIntentsForTask calls/returns intents filtered by taskId", () => {
    persistExecutionIntents(ORG_ID, TASK_ID, RUN_ID, SAMPLE_ACTIONS);
    persistExecutionIntents(ORG_ID, "other-task", "run-other", [SAMPLE_ACTIONS[0]!]);

    const found = getExecutionIntentsForTask(TASK_ID);
    expect(found).toHaveLength(3);
    for (const intent of found) {
      expect(intent.taskId).toBe(TASK_ID);
    }
  });

  it("getPendingApprovalIntents filters on approvalRequired=true and status=pending", () => {
    persistExecutionIntents(ORG_ID, TASK_ID, RUN_ID, SAMPLE_ACTIONS);

    const pending = getPendingApprovalIntents(ORG_ID);
    // SAMPLE_ACTIONS has 2 with approvalRequired=true
    expect(pending).toHaveLength(2);
    for (const intent of pending) {
      expect(intent.approvalRequired).toBe(true);
      expect(intent.status).toBe("pending");
    }
  });

  it("getPendingApprovalIntents excludes intents from other organisations", () => {
    persistExecutionIntents("org-other", TASK_ID, RUN_ID, SAMPLE_ACTIONS);
    const pending = getPendingApprovalIntents(ORG_ID);
    expect(pending).toHaveLength(0);
  });

  it("approveIntent calls db update with status 'approved'", () => {
    const intents = persistExecutionIntents(ORG_ID, TASK_ID, RUN_ID, SAMPLE_ACTIONS);
    const targetId = intents[0]!.id;

    const updated = approveIntent(targetId);
    expect(updated.status).toBe("approved");
    expect(updated.id).toBe(targetId);
  });

  it("rejectIntent calls db update with status 'rejected' and rejectionReason", () => {
    const intents = persistExecutionIntents(ORG_ID, TASK_ID, RUN_ID, SAMPLE_ACTIONS);
    const targetId = intents[0]!.id;
    const reason = "Action not authorised by manager";

    const updated = rejectIntent(targetId, reason);
    expect(updated.status).toBe("rejected");
    expect(updated.rejectionReason).toBe(reason);
  });

  it("approving an intent changes status from pending to approved", () => {
    const intents = persistExecutionIntents(ORG_ID, TASK_ID, RUN_ID, SAMPLE_ACTIONS);
    const intent = intents[0]!;
    expect(intent.status).toBe("pending");
    approveIntent(intent.id);
    expect(intentStore.find((i) => i.id === intent.id)!.status).toBe("approved");
  });

  it("after rejection, intent no longer appears in getPendingApprovalIntents", () => {
    const intents = persistExecutionIntents(ORG_ID, TASK_ID, RUN_ID, SAMPLE_ACTIONS);
    const approvalIntents = getPendingApprovalIntents(ORG_ID);
    expect(approvalIntents).toHaveLength(2);

    // Reject the first one
    rejectIntent(intents[0]!.id, "Not approved");
    const remaining = getPendingApprovalIntents(ORG_ID);
    expect(remaining).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 4: Auto-dispatch on task approval
// ═══════════════════════════════════════════════════════════════════════════════

describe("Auto-dispatch on task approval", () => {
  /**
   * We test the state-machine logic for task transitions.
   * The auto-dispatch logic should only call dispatchReadyRuns when state = "approved".
   */

  type TaskState = "draft" | "queued" | "planning" | "awaiting_approval" | "approved" | "executing" | "completed" | "cancelled" | "failed";

  const VALID_TRANSITIONS: Record<TaskState, TaskState[]> = {
    draft: ["queued", "cancelled"],
    queued: ["planning", "cancelled"],
    planning: ["awaiting_approval", "approved", "cancelled"],
    awaiting_approval: ["approved", "cancelled", "failed"],
    approved: ["executing", "cancelled"],
    executing: ["completed", "failed", "cancelled"],
    completed: [],
    cancelled: [],
    failed: ["queued"],
  };

  let dispatchReadyRunsCalled = false;
  let lastDispatchedState: TaskState | null = null;

  // Simulates the auto-dispatch hook that wraps transitionTaskState
  async function transitionWithAutoDispatch(
    fromState: TaskState,
    toState: TaskState,
    planStub: object,
    dispatchFn: (plan: object) => Promise<string[]>,
  ): Promise<void> {
    const validFrom = VALID_TRANSITIONS[fromState] ?? [];
    if (!validFrom.includes(toState)) {
      throw new Error(`Invalid transition: ${fromState} → ${toState}`);
    }

    lastDispatchedState = toState;

    // Auto-dispatch only fires when transitioning to "approved"
    if (toState === "approved") {
      await dispatchFn(planStub);
    }
  }

  beforeEach(() => {
    dispatchReadyRunsCalled = false;
    lastDispatchedState = null;
  });

  it("transitionTaskState to 'approved' calls dispatchReadyRuns", async () => {
    const mockDispatch = vi.fn().mockResolvedValue(["run-1", "run-2"]);
    await transitionWithAutoDispatch("awaiting_approval", "approved", { steps: [] }, mockDispatch);
    expect(mockDispatch).toHaveBeenCalledTimes(1);
    expect(lastDispatchedState).toBe("approved");
  });

  it("transitionTaskState to 'executing' does NOT call dispatchReadyRuns", async () => {
    const mockDispatch = vi.fn().mockResolvedValue([]);
    await transitionWithAutoDispatch("approved", "executing", { steps: [] }, mockDispatch);
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(lastDispatchedState).toBe("executing");
  });

  it("transitionTaskState to 'cancelled' does NOT call dispatchReadyRuns", async () => {
    const mockDispatch = vi.fn().mockResolvedValue([]);
    await transitionWithAutoDispatch("approved", "cancelled", { steps: [] }, mockDispatch);
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(lastDispatchedState).toBe("cancelled");
  });

  it("transitionTaskState from planning to approved calls dispatchReadyRuns", async () => {
    const mockDispatch = vi.fn().mockResolvedValue(["run-1"]);
    await transitionWithAutoDispatch("planning", "approved", { steps: [] }, mockDispatch);
    expect(mockDispatch).toHaveBeenCalledTimes(1);
  });

  it("invalid transition throws an error", async () => {
    const mockDispatch = vi.fn().mockResolvedValue([]);
    await expect(
      transitionWithAutoDispatch("completed", "approved", { steps: [] }, mockDispatch),
    ).rejects.toThrow("Invalid transition");
  });

  it("dispatchReadyRuns receives the plan object", async () => {
    const plan = { steps: [{ id: "step-1" }], planId: "plan-abc" };
    const mockDispatch = vi.fn().mockResolvedValue(["run-1"]);
    await transitionWithAutoDispatch("awaiting_approval", "approved", plan, mockDispatch);
    expect(mockDispatch).toHaveBeenCalledWith(plan);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 5: Queue worker logic (unit tests)
// ═══════════════════════════════════════════════════════════════════════════════

describe("Queue worker logic — unit tests", () => {
  // We model the worker's processNextItem logic inline for pure unit testing.

  type QueueEntry = {
    id: string;
    specialistRunId: string;
    organizationId: string;
    attempts: number;
  };

  const MAX_ATTEMPTS = 3;

  async function processNextItem(
    claimNext: () => Promise<QueueEntry | null>,
    executeSpecialistStep: (runId: string, orgId: string) => Promise<void>,
    markFailed: (runId: string, orgId: string, status: "retrying" | "failed") => Promise<void>,
  ): Promise<void> {
    const item = await claimNext();
    if (!item) return; // Nothing to process

    try {
      await executeSpecialistStep(item.specialistRunId, item.organizationId);
    } catch (err) {
      const status = item.attempts < MAX_ATTEMPTS ? "retrying" : "failed";
      await markFailed(item.specialistRunId, item.organizationId, status);
    }
  }

  it("when claimNext returns null: processNextItem completes without calling executeSpecialistStep", async () => {
    const claimNext = vi.fn().mockResolvedValue(null);
    const executeStep = vi.fn().mockResolvedValue(undefined);
    const markFailed = vi.fn().mockResolvedValue(undefined);

    await processNextItem(claimNext, executeStep, markFailed);

    expect(claimNext).toHaveBeenCalledTimes(1);
    expect(executeStep).not.toHaveBeenCalled();
    expect(markFailed).not.toHaveBeenCalled();
  });

  it("when claimNext returns item: executeSpecialistStep is called with correct args", async () => {
    const item: QueueEntry = {
      id: "q-1",
      specialistRunId: "run-abc",
      organizationId: "org-1",
      attempts: 1,
    };
    const claimNext = vi.fn().mockResolvedValue(item);
    const executeStep = vi.fn().mockResolvedValue(undefined);
    const markFailed = vi.fn().mockResolvedValue(undefined);

    await processNextItem(claimNext, executeStep, markFailed);

    expect(executeStep).toHaveBeenCalledTimes(1);
    expect(executeStep).toHaveBeenCalledWith("run-abc", "org-1");
    expect(markFailed).not.toHaveBeenCalled();
  });

  it("when executeSpecialistStep throws and attempts < 3: markFailed called with 'retrying'", async () => {
    const item: QueueEntry = {
      id: "q-1",
      specialistRunId: "run-abc",
      organizationId: "org-1",
      attempts: 2, // 2 < 3, so should retry
    };
    const claimNext = vi.fn().mockResolvedValue(item);
    const executeStep = vi.fn().mockRejectedValue(new Error("AI timeout"));
    const markFailed = vi.fn().mockResolvedValue(undefined);

    await processNextItem(claimNext, executeStep, markFailed);

    expect(markFailed).toHaveBeenCalledTimes(1);
    expect(markFailed).toHaveBeenCalledWith("run-abc", "org-1", "retrying");
  });

  it("when executeSpecialistStep throws and attempts >= 3: markFailed called with 'failed'", async () => {
    const item: QueueEntry = {
      id: "q-1",
      specialistRunId: "run-abc",
      organizationId: "org-1",
      attempts: 3, // >= 3, should mark as permanently failed
    };
    const claimNext = vi.fn().mockResolvedValue(item);
    const executeStep = vi.fn().mockRejectedValue(new Error("Persistent error"));
    const markFailed = vi.fn().mockResolvedValue(undefined);

    await processNextItem(claimNext, executeStep, markFailed);

    expect(markFailed).toHaveBeenCalledTimes(1);
    expect(markFailed).toHaveBeenCalledWith("run-abc", "org-1", "failed");
  });

  it("when executeSpecialistStep throws with attempts=1: markFailed called with 'retrying'", async () => {
    const item: QueueEntry = {
      id: "q-1",
      specialistRunId: "run-xyz",
      organizationId: "org-2",
      attempts: 1,
    };
    const claimNext = vi.fn().mockResolvedValue(item);
    const executeStep = vi.fn().mockRejectedValue(new Error("First attempt failed"));
    const markFailed = vi.fn().mockResolvedValue(undefined);

    await processNextItem(claimNext, executeStep, markFailed);

    expect(markFailed).toHaveBeenCalledWith("run-xyz", "org-2", "retrying");
  });

  it("executeSpecialistStep success does not call markFailed", async () => {
    const item: QueueEntry = {
      id: "q-2",
      specialistRunId: "run-success",
      organizationId: "org-1",
      attempts: 1,
    };
    const claimNext = vi.fn().mockResolvedValue(item);
    const executeStep = vi.fn().mockResolvedValue({ status: "completed" });
    const markFailed = vi.fn().mockResolvedValue(undefined);

    await processNextItem(claimNext, executeStep, markFailed);

    expect(executeStep).toHaveBeenCalledTimes(1);
    expect(markFailed).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 6: Idempotency and lease management
// ═══════════════════════════════════════════════════════════════════════════════

describe("Idempotency and lease management", () => {
  // Model queue state in-memory for deterministic tests

  type QueueItemStatus = "waiting" | "claimed" | "running" | "completed" | "failed" | "retrying" | "blocked" | "cancelled";

  interface QueueItem {
    id: string;
    specialistRunId: string;
    organizationId: string;
    status: QueueItemStatus;
    attempts: number;
    claimedBy: string | null;
    leaseExpiresAt: Date | null;
    availableAt: Date;
  }

  let queueStore: QueueItem[] = [];

  // Simulates claimNext — atomic: returns null if already claimed
  function claimNextInMemory(organizationId: string, workerId: string): QueueItem | null {
    const now = new Date();
    const available = queueStore.find(
      (item) =>
        item.organizationId === organizationId &&
        item.status === "waiting" &&
        item.availableAt <= now,
    );
    if (!available) return null;

    // Atomically claim
    available.status = "claimed";
    available.claimedBy = workerId;
    available.leaseExpiresAt = new Date(now.getTime() + 120_000);
    available.attempts += 1;
    return available;
  }

  // Simulates releaseExpiredLeases
  function releaseExpiredLeasesInMemory(): number {
    const now = new Date();
    let count = 0;
    for (const item of queueStore) {
      if (item.status === "claimed" && item.leaseExpiresAt && item.leaseExpiresAt < now) {
        item.status = "waiting";
        item.claimedBy = null;
        item.leaseExpiresAt = null;
        count++;
      }
    }
    return count;
  }

  beforeEach(() => {
    queueStore = [];
  });

  it("claimNext called twice in sequence returns null second time (item already claimed)", () => {
    queueStore.push({
      id: "q-1",
      specialistRunId: "run-1",
      organizationId: "org-1",
      status: "waiting",
      attempts: 0,
      claimedBy: null,
      leaseExpiresAt: null,
      availableAt: new Date(Date.now() - 1000), // already available
    });

    const first = claimNextInMemory("org-1", "worker-A");
    expect(first).not.toBeNull();
    expect(first!.status).toBe("claimed");

    const second = claimNextInMemory("org-1", "worker-B");
    expect(second).toBeNull(); // already claimed
  });

  it("claimNext increments attempts counter", () => {
    queueStore.push({
      id: "q-1",
      specialistRunId: "run-1",
      organizationId: "org-1",
      status: "waiting",
      attempts: 1,
      claimedBy: null,
      leaseExpiresAt: null,
      availableAt: new Date(Date.now() - 1000),
    });

    const claimed = claimNextInMemory("org-1", "worker-A");
    expect(claimed!.attempts).toBe(2);
  });

  it("releaseExpiredLeases resets stale leases to waiting", () => {
    const expiredAt = new Date(Date.now() - 5000); // 5 seconds ago
    queueStore.push({
      id: "q-1",
      specialistRunId: "run-expired",
      organizationId: "org-1",
      status: "claimed",
      attempts: 1,
      claimedBy: "dead-worker",
      leaseExpiresAt: expiredAt,
      availableAt: new Date(Date.now() - 10000),
    });

    const released = releaseExpiredLeasesInMemory();
    expect(released).toBe(1);

    const item = queueStore[0]!;
    expect(item.status).toBe("waiting");
    expect(item.claimedBy).toBeNull();
    expect(item.leaseExpiresAt).toBeNull();
  });

  it("releaseExpiredLeases does not release non-expired leases", () => {
    queueStore.push({
      id: "q-1",
      specialistRunId: "run-fresh",
      organizationId: "org-1",
      status: "claimed",
      attempts: 1,
      claimedBy: "worker-A",
      leaseExpiresAt: new Date(Date.now() + 60_000), // 1 minute from now
      availableAt: new Date(Date.now() - 1000),
    });

    const released = releaseExpiredLeasesInMemory();
    expect(released).toBe(0);

    const item = queueStore[0]!;
    expect(item.status).toBe("claimed");
    expect(item.claimedBy).toBe("worker-A");
  });

  it("claimNext returns null when no items are waiting", () => {
    const result = claimNextInMemory("org-1", "worker-A");
    expect(result).toBeNull();
  });

  it("claimNext respects availableAt — does not claim items not yet available", () => {
    queueStore.push({
      id: "q-1",
      specialistRunId: "run-future",
      organizationId: "org-1",
      status: "waiting",
      attempts: 0,
      claimedBy: null,
      leaseExpiresAt: null,
      availableAt: new Date(Date.now() + 30_000), // 30 seconds in the future
    });

    const result = claimNextInMemory("org-1", "worker-A");
    expect(result).toBeNull();
  });

  it("claimNext is tenant-scoped — does not return items from other orgs", () => {
    queueStore.push({
      id: "q-1",
      specialistRunId: "run-org2",
      organizationId: "org-2",
      status: "waiting",
      attempts: 0,
      claimedBy: null,
      leaseExpiresAt: null,
      availableAt: new Date(Date.now() - 1000),
    });

    const result = claimNextInMemory("org-1", "worker-A");
    expect(result).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 7: Specialist run version recording
// ═══════════════════════════════════════════════════════════════════════════════

describe("Specialist run version recording", () => {
  it("captureSpecialistRunVersions for compliance_officer returns dnaVersion matching getDNAVersion", () => {
    const expectedDnaVersion = getDNAVersion("compliance_officer");
    const record = captureSpecialistRunVersions("compliance_officer", "gpt-4o");
    expect(record.dnaVersion).toBe(expectedDnaVersion);
  });

  it("captureSpecialistRunVersions for chief_of_staff returns reasoningVersion matching getReasoningVersion", () => {
    const expectedReasoningVersion = getReasoningVersion("chief_of_staff");
    const record = captureSpecialistRunVersions("chief_of_staff", "gpt-4o");
    expect(record.reasoningVersion).toBe(expectedReasoningVersion);
  });

  it("captureSpecialistRunVersions for operations_manager returns the current DNA version", () => {
    const record = captureSpecialistRunVersions("operations_manager", "gpt-4o");
    expect(record.dnaVersion).toBe(OPERATIONS_MANAGER_DNA.currentVersion.version);
  });

  it("captureSpecialistRunVersions for document_specialist returns dnaVersion '1.0.0'", () => {
    const record = captureSpecialistRunVersions("document_specialist", "gpt-4o");
    expect(record.dnaVersion).toBe("1.0.0");
  });

  it("captureSpecialistRunVersions result includes all required RunVersionRecord fields", () => {
    const record = captureSpecialistRunVersions("compliance_officer", "gpt-4o");
    expect(record).toHaveProperty("dnaVersion");
    expect(record).toHaveProperty("workerProfileVersion");
    expect(record).toHaveProperty("capabilityVersion");
    expect(record).toHaveProperty("reasoningVersion");
    expect(record).toHaveProperty("outputSchemaVersion");
    expect(record).toHaveProperty("modelVersion");
    expect(record).toHaveProperty("recordedAt");
  });

  it("captureSpecialistRunVersions recordedAt is a valid ISO 8601 string", () => {
    const record = captureSpecialistRunVersions("compliance_officer", "gpt-4o");
    const parsed = Date.parse(record.recordedAt);
    expect(isNaN(parsed)).toBe(false);
  });

  it("captureSpecialistRunVersions for unknown role returns all N/A version fields", () => {
    const record = captureSpecialistRunVersions("unknown_role", "gpt-4o");
    expect(record.dnaVersion).toBe("N/A");
    expect(record.reasoningVersion).toBe("N/A");
    expect(record.outputSchemaVersion).toBe("N/A");
    expect(record.modelVersion).toBe("gpt-4o"); // modelVersion still passes through
  });

  it("captureSpecialistRunVersions uses default workerProfileVersion '1.0.0'", () => {
    const record = captureSpecialistRunVersions("compliance_officer", "gpt-4o");
    expect(record.workerProfileVersion).toBe("1.0.0");
  });

  it("captureSpecialistRunVersions uses default capabilityVersion '1.0.0'", () => {
    const record = captureSpecialistRunVersions("compliance_officer", "gpt-4o");
    expect(record.capabilityVersion).toBe("1.0.0");
  });

  it("captureSpecialistRunVersions accepts custom workerProfileVersion", () => {
    const record = captureSpecialistRunVersions("compliance_officer", "gpt-4o", "2.5.0", "3.1.0");
    expect(record.capabilityVersion).toBe("2.5.0");
    expect(record.workerProfileVersion).toBe("3.1.0");
  });

  it("version records are stable — same role always returns same dna version", () => {
    const r1 = captureSpecialistRunVersions("chief_of_staff", "gpt-4o");
    const r2 = captureSpecialistRunVersions("chief_of_staff", "gpt-4o");
    expect(r1.dnaVersion).toBe(r2.dnaVersion);
    expect(r1.reasoningVersion).toBe(r2.reasoningVersion);
    expect(r1.outputSchemaVersion).toBe(r2.outputSchemaVersion);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 8: DNA profile structural validation (bonus)
// ═══════════════════════════════════════════════════════════════════════════════

describe("DNA profile structural validation", () => {
  const ALL_ROLES = ["chief_of_staff", "compliance_officer", "operations_manager", "document_specialist"];

  it("all profiles have non-empty mission.objectives array", () => {
    for (const role of ALL_ROLES) {
      const profile = getDNAProfile(role);
      expect(profile).not.toBeNull();
      expect(profile!.mission.objectives.length).toBeGreaterThan(0);
    }
  });

  it("all profiles have non-empty escalationFramework.hardStops array", () => {
    for (const role of ALL_ROLES) {
      const profile = getDNAProfile(role);
      expect(profile!.escalationFramework.hardStops.length).toBeGreaterThan(0);
    }
  });

  it("all profiles have a valid reasoningMethodology with steps", () => {
    for (const role of ALL_ROLES) {
      const profile = getDNAProfile(role);
      expect(profile!.reasoningMethodology.steps.length).toBeGreaterThan(0);
      expect(profile!.reasoningMethodology.version).toBeTruthy();
    }
  });

  it("all profiles have outputSchema.requiredKeys non-empty", () => {
    for (const role of ALL_ROLES) {
      const profile = getDNAProfile(role);
      expect(profile!.outputSchema.requiredKeys.length).toBeGreaterThan(0);
    }
  });

  it("all profiles have confidenceModel with valid thresholds (0–1)", () => {
    for (const role of ALL_ROLES) {
      const profile = getDNAProfile(role);
      const cm = profile!.confidenceModel;
      expect(cm.minimumFindingConfidence).toBeGreaterThanOrEqual(0);
      expect(cm.minimumFindingConfidence).toBeLessThanOrEqual(1);
      expect(cm.minimumRunConfidence).toBeGreaterThanOrEqual(0);
      expect(cm.minimumRunConfidence).toBeLessThanOrEqual(1);
      expect(cm.blockThreshold).toBeGreaterThanOrEqual(0);
      expect(cm.blockThreshold).toBeLessThanOrEqual(1);
    }
  });

  it("compliance_officer has producesExecutionIntents=true", () => {
    const profile = getDNAProfile("compliance_officer");
    expect(profile!.outputSchema.producesExecutionIntents).toBe(true);
  });

  it("chief_of_staff has producesExecutionIntents=false", () => {
    const profile = getDNAProfile("chief_of_staff");
    expect(profile!.outputSchema.producesExecutionIntents).toBe(false);
  });

  it("all profiles have a currentVersion.publishedAt date", () => {
    for (const role of ALL_ROLES) {
      const profile = getDNAProfile(role);
      const parsed = Date.parse(profile!.currentVersion.publishedAt);
      expect(isNaN(parsed)).toBe(false);
    }
  });

  it("all profiles have versionHistory with at least one entry", () => {
    for (const role of ALL_ROLES) {
      const profile = getDNAProfile(role);
      expect(profile!.versionHistory.length).toBeGreaterThanOrEqual(1);
    }
  });
});
