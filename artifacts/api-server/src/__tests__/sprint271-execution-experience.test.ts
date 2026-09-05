/**
 * Sprint 27.1 — Coordinator, approval dispatch, and integration tests
 *
 * This file tests the wired-together behaviour:
 *   - Coordinator: clarification pause (saves checkpoint, NOT failure message)
 *   - Coordinator: SSE emission alongside DB messages
 *   - Coordinator: resumeFromCheckpoint
 *   - Coordinator: recoverOrphanedExecutions
 *   - Approval route: unified execution dispatch
 *   - Regression: all Sprint 27 exports still intact
 *
 * The event bus, checkpoint store, timeline service, and pipeline checkpoint resume
 * are tested separately in sprint271-foundations.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Shared mock infrastructure ───────────────────────────────────────────────

const mockDbSelectFn = vi.hoisted(() => vi.fn());
const mockDbUpdateFn = vi.hoisted(() => vi.fn());

function makeSelectChain(rows: unknown[]) {
  const c: Record<string, unknown> = {};
  c.from    = () => c;
  c.where   = () => c;
  c.orderBy = () => c;
  c.limit   = () => Promise.resolve(rows);
  return c;
}
function makeCoordinatorSelectChain(input: {
  intentRows?: unknown[];
  conversationRows?: unknown[];
  taskRows?: unknown[];
  fallbackRows?: unknown[];
}) {
  const c: Record<string, unknown> = {};
  let rows = input.fallbackRows ?? [];
  c.from = (table: unknown) => {
    const tableName = (table as { _?: string })._;
    if (tableName === "executionIntents") {
      rows = input.intentRows ?? [];
    } else if (tableName === "conversations") {
      rows = input.conversationRows ?? [];
    } else if (tableName === "tasks") {
      rows = input.taskRows ?? [];
    }
    return c;
  };
  c.where = () => c;
  c.orderBy = () => c;
  c.limit = () => Promise.resolve(rows);
  return c;
}
function makeUpdateChain() {
  const c: Record<string, unknown> = {};
  c.set       = () => c;
  c.where     = () => c;
  c.returning = () => Promise.resolve([{
    id: "task-271",
    organizationId: "org-271",
    currentState: "executing",
    metadata: {},
  }]);
  return c;
}

vi.mock("@workspace/db", () => ({
  db: {
    select: mockDbSelectFn,
    update: mockDbUpdateFn,
    insert: vi.fn(() => ({ values: () => ({ returning: () => Promise.resolve([]) }) })),
  },
  withSystemTenantContext: vi.fn(async (_ctx: unknown, fn: (client: unknown) => Promise<unknown>) => fn({
    select: mockDbSelectFn,
    update: mockDbUpdateFn,
    insert: vi.fn(() => ({ values: () => ({ returning: () => Promise.resolve([]) }) })),
  })),
  executionIntentsTable:     { _: "executionIntents" },
  tasksTable:                { _: "tasks" },
  conversationsTable:        { _: "conversations" },
  conversationMessagesTable: { _: "conversationMessages" },
}));

vi.mock("drizzle-orm", () => ({
  eq:  () => "EQ",
  and: (...a: unknown[]) => a,
  lt:  () => "LT",
  or:  (...a: unknown[]) => a,
  inArray: () => "IN",
  desc: () => "DESC",
}));

const mockPostStarted  = vi.hoisted(() => vi.fn().mockResolvedValue({ id: "msg-started" }));
const mockPostProgress = vi.hoisted(() => vi.fn().mockResolvedValue({ id: "msg-progress" }));
const mockPostCompleted = vi.hoisted(() => vi.fn().mockResolvedValue({ id: "msg-completed" }));
const mockPostFailed   = vi.hoisted(() => vi.fn().mockResolvedValue({ id: "msg-failed" }));
const mockPostClarif   = vi.hoisted(() => vi.fn().mockResolvedValue({ id: "msg-clarif" }));

vi.mock("../services/conversationService.js", () => ({
  postExecutionStartedToConversation:    mockPostStarted,
  postExecutionProgressToConversation:   mockPostProgress,
  postCompletedWorkCreatedToConversation: mockPostCompleted,
  postExecutionFailedToConversation:     mockPostFailed,
  postClarificationRequestToConversation: mockPostClarif,
}));

const mockLogOrgEvent = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("../services/auditService.js", () => ({
  logOrgEvent:     mockLogOrgEvent,
  getRequestMeta:  () => ({}),
  writeAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

const mockEmitEvent = vi.hoisted(() => vi.fn());

vi.mock("../services/executionEventBus.js", () => ({
  emitExecutionEvent:         mockEmitEvent,
  subscribeToExecutionEvents: vi.fn(() => vi.fn()),
  getBufferedEventsSince:     vi.fn(() => []),
}));

const mockSaveCheckpoint  = vi.hoisted(() => vi.fn());
const mockGetCheckpoint   = vi.hoisted(() => vi.fn().mockReturnValue(null));
const mockClearCheckpoint = vi.hoisted(() => vi.fn());
const mockHasCheckpoint   = vi.hoisted(() => vi.fn().mockReturnValue(false));

// executionCheckpointStore was the legacy in-memory store (deleted — superseded by executionCheckpointService)
// The mocks below cover its former role in tests that still reference the coordinator's checkpoint API.

// Sprint 27.2 — durable checkpoint service mocks (replaces in-memory store in coordinator)
const mockCreateDurableCheckpoint    = vi.hoisted(() => vi.fn().mockResolvedValue({ id: "cp-durable-1" }));
const mockGetActiveCheckpointByConv  = vi.hoisted(() => vi.fn().mockResolvedValue(null));
const mockBeginResume271             = vi.hoisted(() => vi.fn().mockResolvedValue({ resumed: false, reason: "no_checkpoint" }));
const mockRecordAnswer271            = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("../services/executionCheckpointService.js", () => ({
  createCheckpoint:                  (...a: unknown[]) => mockCreateDurableCheckpoint(...a),
  getActiveCheckpointByConversation: (...a: unknown[]) => mockGetActiveCheckpointByConv(...a),
  beginResume:                       (...a: unknown[]) => mockBeginResume271(...a),
  recordClarificationAnswer:         (...a: unknown[]) => mockRecordAnswer271(...a),
  hasActiveCheckpoint:               vi.fn().mockResolvedValue(false),
  markResumed:                       vi.fn().mockResolvedValue(undefined),
  markCompleted:                     vi.fn().mockResolvedValue(undefined),
  markFailed:                        vi.fn().mockResolvedValue(undefined),
  cancelCheckpoint:                  vi.fn().mockResolvedValue(undefined),
  expireStaleCheckpoints:            vi.fn().mockResolvedValue(0),
  recoverStuckResumes:               vi.fn().mockResolvedValue(0),
}));

// Default pipeline mock — can be overridden per test
const mockExecuteWork = vi.hoisted(() => vi.fn().mockResolvedValue({
  outcome: "completed",
  completedWorkId: "cw-1",
  qualityScore: 85,
  message: "Completed successfully.",
}));

vi.mock("../services/workExecutionPipelineService.js", () => ({
  executeWork:              mockExecuteWork,
  EXECUTION_STAGE_LABELS:   {
    selecting_blueprint:    "Planning work…",
    assembling_package:     "Reviewing organisational knowledge…",
    validating:             "Validating requirements…",
    retrieving_examples:    "Consulting approved work examples…",
    executing:              "Consulting specialist…",
    reviewing:              "Running quality review…",
    creating_completed_work: "Preparing completed work document…",
  },
}));

// Coordinator now resolves requesterRole via getMembershipForUser before calling executeWork
vi.mock("../services/membershipService.js", () => ({
  getMembershipForUser: vi.fn().mockResolvedValue({ role: "administrator" }),
}));

// ─── Shared test data ─────────────────────────────────────────────────────────

const ORG    = "org-271";
const CONV   = "conv-271";
const TASK   = "task-271";
const INTENT = "intent-271";
const USER   = "user-271";

const INTENT_ROW = {
  id: INTENT, organizationId: ORG, taskId: TASK,
  status: "prepared", intentType: "generate_report",
  description: "Write quarterly report", approvedBy: null,
};
const CONV_ROW  = { id: CONV };
const TASK_ROW  = {
  id: TASK,
  organizationId: ORG,
  title: "Q3 Report",
  description: "Write quarterly report",
  currentState: "queued",
  metadata: {},
};

// ─── 1. Coordinator — clarification pause ─────────────────────────────────────

describe("executionCoordinatorService — clarification pause", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbSelectFn.mockReset();
    mockDbUpdateFn.mockReset();
    mockDbUpdateFn.mockImplementation(makeUpdateChain);
    // Default pipeline returns awaiting_clarification for these tests
    mockExecuteWork.mockResolvedValue({
      outcome: "awaiting_clarification",
      clarificationQuestions: ["What is the incident date?"],
      manifestId: "m1",
      message: "Need more info",
    });
  });

  it("saves checkpoint when pipeline returns awaiting_clarification", async () => {
    // call order: intent → workroom conv → task
    let call = 0;
    mockDbSelectFn.mockImplementation(() => {
      call++;
      if (call === 1) return makeSelectChain([INTENT_ROW]);
      if (call === 2) return makeSelectChain([CONV_ROW]);
      return makeSelectChain([TASK_ROW]);
    });

    const { coordinateIntentApproval } = await import("../services/executionCoordinatorService.js");
    await coordinateIntentApproval(INTENT, ORG, USER);
    await new Promise(r => setTimeout(r, 20));

    // Sprint 27.2: coordinator now calls the durable service (createCheckpoint) instead of in-memory saveCheckpoint
    expect(mockCreateDurableCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: CONV }),
    );
  });

  it("posts clarification message — NOT a failure message", async () => {
    let call = 0;
    mockDbSelectFn.mockImplementation(() => {
      call++;
      if (call === 1) return makeSelectChain([INTENT_ROW]);
      if (call === 2) return makeSelectChain([CONV_ROW]);
      return makeSelectChain([TASK_ROW]);
    });

    const { coordinateIntentApproval } = await import("../services/executionCoordinatorService.js");
    await coordinateIntentApproval(INTENT, ORG, USER);
    await new Promise(r => setTimeout(r, 20));

    expect(mockPostClarif).toHaveBeenCalled();
    expect(mockPostFailed).not.toHaveBeenCalled();
  });

  it("emits execution_clarification_required SSE event", async () => {
    let call = 0;
    mockDbSelectFn.mockImplementation(() => {
      call++;
      if (call === 1) return makeSelectChain([INTENT_ROW]);
      if (call === 2) return makeSelectChain([CONV_ROW]);
      return makeSelectChain([TASK_ROW]);
    });

    const { coordinateIntentApproval } = await import("../services/executionCoordinatorService.js");
    await coordinateIntentApproval(INTENT, ORG, USER);
    await new Promise(r => setTimeout(r, 20));

    const clarEvents = mockEmitEvent.mock.calls.filter(
      ([, payload]) => (payload as { type: string }).type === "execution_clarification_required",
    );
    expect(clarEvents.length).toBeGreaterThan(0);
  });

  it("does NOT save checkpoint when no conversationId is resolvable", async () => {
    let call = 0;
    mockDbSelectFn.mockImplementation(() => {
      call++;
      if (call === 1) return makeSelectChain([INTENT_ROW]);
      // No conversation or task found
      return makeSelectChain([]);
    });

    const { coordinateIntentApproval } = await import("../services/executionCoordinatorService.js");
    await coordinateIntentApproval(INTENT, ORG, USER);
    await new Promise(r => setTimeout(r, 20));

    // Sprint 27.2: durable service must not be called when conversation context is unresolvable
    expect(mockCreateDurableCheckpoint).not.toHaveBeenCalled();
  });
});

// ─── 2. Coordinator — successful dispatch (regression) ────────────────────────

describe("executionCoordinatorService — successful dispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbSelectFn.mockReset();
    mockDbUpdateFn.mockReset();
    mockDbUpdateFn.mockImplementation(makeUpdateChain);
    mockExecuteWork.mockResolvedValue({
      outcome: "completed",
      completedWorkId: "cw-1",
      qualityScore: 85,
      message: "Done",
    });
  });

  it("dispatches successfully and starts execution", async () => {
    let call = 0;
    mockDbSelectFn.mockImplementation(() => {
      call++;
      if (call === 1) return makeSelectChain([INTENT_ROW]);
      if (call === 2) return makeSelectChain([CONV_ROW]);
      return makeSelectChain([TASK_ROW]);
    });

    const { coordinateIntentApproval } = await import("../services/executionCoordinatorService.js");
    const result = await coordinateIntentApproval(INTENT, ORG, USER);

    expect(result.dispatched).toBe(true);
    expect(result.executionStarted).toBe(true);
  });

  it("posts execution started message", async () => {
    mockDbSelectFn.mockImplementation(() => makeCoordinatorSelectChain({
      intentRows: [INTENT_ROW],
      conversationRows: [CONV_ROW],
      taskRows: [TASK_ROW],
    }));

    const { coordinateIntentApproval } = await import("../services/executionCoordinatorService.js");
    await coordinateIntentApproval(INTENT, ORG, USER);
    await new Promise(r => setTimeout(r, 20));

    expect(mockPostStarted).toHaveBeenCalledWith(ORG, CONV, TASK, expect.any(String));
  });

  it("emits execution_started SSE event", async () => {
    let call = 0;
    mockDbSelectFn.mockImplementation(() => {
      call++;
      if (call === 1) return makeSelectChain([INTENT_ROW]);
      if (call === 2) return makeSelectChain([CONV_ROW]);
      return makeSelectChain([TASK_ROW]);
    });

    const { coordinateIntentApproval } = await import("../services/executionCoordinatorService.js");
    await coordinateIntentApproval(INTENT, ORG, USER);
    await new Promise(r => setTimeout(r, 20));

    const startEvents = mockEmitEvent.mock.calls.filter(
      ([, p]) => (p as { type: string }).type === "execution_started",
    );
    expect(startEvents.length).toBeGreaterThan(0);
  });

  it("emits execution_completed SSE event when pipeline succeeds", async () => {
    let call = 0;
    mockDbSelectFn.mockImplementation(() => {
      call++;
      if (call === 1) return makeSelectChain([INTENT_ROW]);
      if (call === 2) return makeSelectChain([CONV_ROW]);
      return makeSelectChain([TASK_ROW]);
    });

    const { coordinateIntentApproval } = await import("../services/executionCoordinatorService.js");
    await coordinateIntentApproval(INTENT, ORG, USER);
    await new Promise(r => setTimeout(r, 80));

    const completedEvents = mockEmitEvent.mock.calls.filter(
      ([, p]) => (p as { type: string }).type === "execution_completed",
    );
    expect(completedEvents.length).toBeGreaterThan(0);
    const completedEvent = completedEvents[0]![1] as { completedWorkId?: string };
    expect(completedEvent.completedWorkId).toBe("cw-1");
  });

  it("emits execution_failed SSE event when pipeline fails", async () => {
    mockExecuteWork.mockResolvedValueOnce({ outcome: "execution_failed", message: "Something broke" });

    let call = 0;
    mockDbSelectFn.mockImplementation(() => {
      call++;
      if (call === 1) return makeSelectChain([INTENT_ROW]);
      if (call === 2) return makeSelectChain([CONV_ROW]);
      return makeSelectChain([TASK_ROW]);
    });

    const { coordinateIntentApproval } = await import("../services/executionCoordinatorService.js");
    await coordinateIntentApproval(INTENT, ORG, USER);
    await new Promise(r => setTimeout(r, 30));

    const failedEvents = mockEmitEvent.mock.calls.filter(
      ([, p]) => (p as { type: string }).type === "execution_failed",
    );
    expect(failedEvents.length).toBeGreaterThan(0);
    expect(mockPostFailed).toHaveBeenCalled();
  });

  it("returns already_dispatched when intent already dispatched", async () => {
    mockDbSelectFn.mockImplementation(() =>
      makeSelectChain([{ ...INTENT_ROW, status: "dispatched" }]),
    );

    const { coordinateIntentApproval } = await import("../services/executionCoordinatorService.js");
    const result = await coordinateIntentApproval(INTENT, ORG, USER);

    expect(result.dispatched).toBe(false);
    expect(result.skipReason).toBe("already_dispatched");
  });

  it("returns intent_not_found for unknown intent", async () => {
    mockDbSelectFn.mockImplementation(() => makeSelectChain([]));

    const { coordinateIntentApproval } = await import("../services/executionCoordinatorService.js");
    const result = await coordinateIntentApproval("unknown-intent", ORG, USER);
    expect(result.skipReason).toBe("intent_not_found");
  });

  it("logs execution_intent.dispatched audit event", async () => {
    let call = 0;
    mockDbSelectFn.mockImplementation(() => {
      call++;
      if (call === 1) return makeSelectChain([INTENT_ROW]);
      if (call === 2) return makeSelectChain([CONV_ROW]);
      return makeSelectChain([TASK_ROW]);
    });

    const { coordinateIntentApproval } = await import("../services/executionCoordinatorService.js");
    await coordinateIntentApproval(INTENT, ORG, USER);

    expect(mockLogOrgEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "execution_intent.dispatched", organizationId: ORG }),
    );
  });
});

// ─── 3. Coordinator — resumeFromCheckpoint ────────────────────────────────────

describe("executionCoordinatorService — resumeFromCheckpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbSelectFn.mockReset();
    mockDbUpdateFn.mockReset();
    mockDbUpdateFn.mockImplementation(makeUpdateChain);
    mockExecuteWork.mockResolvedValue({
      outcome: "completed",
      completedWorkId: "cw-resume",
      qualityScore: 90,
      message: "Done",
    });
  });

  it("claims the durable checkpoint and dispatches pipeline", async () => {
    const durableCheckpoint = {
      id: "cp-resume-1",
      conversationId: "conv-resume",
      organizationId: ORG,
      correlationId: "corr-resume",
      clarificationQuestions: ["What is the date?"],
      clarificationAnswer: null,
      payload: {
        originalRequest: "Write incident report",
        blueprint: null,
        manifest: { manifestId: "m1", organisationLibrarySources: [], taskUploads: [], cosMemories: [] },
      },
      status: "awaiting_clarification" as const,
      expiresAt: new Date(Date.now() + 60000),
    };
    mockGetActiveCheckpointByConv.mockResolvedValue(durableCheckpoint);
    mockBeginResume271.mockResolvedValue({ resumed: true, checkpoint: durableCheckpoint });

    const { resumeFromCheckpoint } = await import("../services/executionCoordinatorService.js");
    await resumeFromCheckpoint({
      conversationId: "conv-resume",
      organizationId: ORG,
      requesterId: USER,
      clarificationAnswer: "Monday 3rd August",
    });

    // Sprint 27.2: uses atomic beginResume (durable DB CAS) instead of in-memory clearCheckpoint
    expect(mockBeginResume271).toHaveBeenCalledWith("conv-resume");
  });

  it("emits execution_recovered SSE event", async () => {
    const durableCheckpoint = {
      id: "cp-resume-2",
      conversationId: "conv-resume-2",
      organizationId: ORG,
      correlationId: "corr-resume-2",
      clarificationQuestions: [],
      clarificationAnswer: null,
      payload: {
        originalRequest: "Write report",
        blueprint: null,
        manifest: { manifestId: "m2", organisationLibrarySources: [], taskUploads: [], cosMemories: [] },
      },
      status: "awaiting_clarification" as const,
      expiresAt: new Date(Date.now() + 60000),
    };
    mockGetActiveCheckpointByConv.mockResolvedValue(durableCheckpoint);
    mockBeginResume271.mockResolvedValue({ resumed: true, checkpoint: durableCheckpoint });

    const { resumeFromCheckpoint } = await import("../services/executionCoordinatorService.js");
    await resumeFromCheckpoint({
      conversationId: "conv-resume-2",
      organizationId: ORG,
      requesterId: USER,
      clarificationAnswer: "answer",
    });

    const recoveredEvents = mockEmitEvent.mock.calls.filter(
      ([, p]) => (p as { type: string }).type === "execution_recovered",
    );
    expect(recoveredEvents.length).toBeGreaterThan(0);
  });

  it("does nothing gracefully if no checkpoint exists", async () => {
    mockGetActiveCheckpointByConv.mockResolvedValue(null);

    const { resumeFromCheckpoint } = await import("../services/executionCoordinatorService.js");
    await expect(
      resumeFromCheckpoint({ conversationId: "conv-none", organizationId: ORG, requesterId: USER, clarificationAnswer: "x" })
    ).resolves.not.toThrow();
    expect(mockBeginResume271).not.toHaveBeenCalled();
  });
});

// ─── 4. Coordinator — orphan recovery ─────────────────────────────────────────

describe("executionCoordinatorService — recoverOrphanedExecutions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbSelectFn.mockReset();
    mockDbUpdateFn.mockReset();
    mockDbUpdateFn.mockImplementation(makeUpdateChain);
    mockExecuteWork.mockResolvedValue({ outcome: "completed", completedWorkId: "cw-rec", message: "Done" });
  });

  it("re-queues stale dispatched intents and returns count", async () => {
    let call = 0;
    mockDbSelectFn.mockImplementation(() => {
      call++;
      if (call === 1) {
        return makeSelectChain([
          { id: "i1", organizationId: "org-1", taskId: "t1", status: "dispatched",
            dispatchedAt: new Date(Date.now() - 20 * 60 * 1000), description: "T1", approvedBy: "u1" },
          { id: "i2", organizationId: "org-2", taskId: "t2", status: "dispatched",
            dispatchedAt: new Date(Date.now() - 20 * 60 * 1000), description: "T2", approvedBy: "u2" },
        ]);
      }
      return makeSelectChain([]); // no conversation / task found (safe fallback)
    });

    const { recoverOrphanedExecutions } = await import("../services/executionCoordinatorService.js");
    const count = await recoverOrphanedExecutions();
    expect(count).toBe(2);
  });

  it("returns 0 when there are no stale intents", async () => {
    mockDbSelectFn.mockImplementation(() => makeSelectChain([]));

    const { recoverOrphanedExecutions } = await import("../services/executionCoordinatorService.js");
    const count = await recoverOrphanedExecutions();
    expect(count).toBe(0);
  });
});

// ─── 5. Approval route — unified dispatch ─────────────────────────────────────

describe("approvalRoutes — unified execution dispatch", () => {
  it("all coordinator exports are present", async () => {
    const coordinator = await import("../services/executionCoordinatorService.js");
    expect(typeof coordinator.coordinateIntentApproval).toBe("function");
    expect(typeof coordinator.dispatchWorkExecution).toBe("function");
    expect(typeof coordinator.resumeFromCheckpoint).toBe("function");
    expect(typeof coordinator.recoverOrphanedExecutions).toBe("function");
  });

  it("dispatchWorkExecution emits execution_started SSE event", async () => {
    mockDbSelectFn.mockImplementation(() => makeSelectChain([]));
    mockDbUpdateFn.mockImplementation(makeUpdateChain);

    const { dispatchWorkExecution } = await import("../services/executionCoordinatorService.js");
    await dispatchWorkExecution({
      organizationId: ORG,
      taskId: TASK,
      taskTitle: "Test Task",
      requesterId: USER,
      conversationId: CONV,
    });

    const startEvents = mockEmitEvent.mock.calls.filter(
      ([, p]) => (p as { type: string }).type === "execution_started",
    );
    expect(startEvents.length).toBeGreaterThan(0);
  });

  it("dispatchWorkExecution logs audit event", async () => {
    mockDbSelectFn.mockImplementation(() => makeSelectChain([]));
    mockDbUpdateFn.mockImplementation(makeUpdateChain);

    const { dispatchWorkExecution } = await import("../services/executionCoordinatorService.js");
    await dispatchWorkExecution({
      organizationId: ORG,
      taskId: TASK,
      taskTitle: "Test Task",
      requesterId: USER,
    });

    expect(mockLogOrgEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "execution_coordinator.dispatch_started" }),
    );
  });
});

// ─── 6. Regression: all Sprint 27 exports still present ───────────────────────

describe("Sprint 27 regression check", () => {
  it("coordinateIntentApproval is exported", async () => {
    const { coordinateIntentApproval } = await import("../services/executionCoordinatorService.js");
    expect(typeof coordinateIntentApproval).toBe("function");
  });

  it("conversationService exports all 4 Sprint 27 lifecycle helpers", async () => {
    const svc = await import("../services/conversationService.js");
    expect(typeof svc.postExecutionStartedToConversation).toBe("function");
    expect(typeof svc.postExecutionProgressToConversation).toBe("function");
    expect(typeof svc.postCompletedWorkCreatedToConversation).toBe("function");
    expect(typeof svc.postExecutionFailedToConversation).toBe("function");
  });

  it("conversationService exports Sprint 27.1 clarification helper", async () => {
    const svc = await import("../services/conversationService.js");
    expect(typeof svc.postClarificationRequestToConversation).toBe("function");
  });

  it("workExecutionPipelineService still exports executeWork and EXECUTION_STAGE_LABELS", async () => {
    const pipeline = await import("../services/workExecutionPipelineService.js");
    expect(typeof pipeline.executeWork).toBe("function");
    expect(typeof pipeline.EXECUTION_STAGE_LABELS).toBe("object");
    expect(Object.keys(pipeline.EXECUTION_STAGE_LABELS)).toHaveLength(7);
  });
});
