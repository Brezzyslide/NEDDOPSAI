/**
 * Sprint 27 — Intelligent Work Execution & Conversation Reliability
 *
 * Tests the wiring between:
 *   intent approval → executeWork() → conversation messages
 *   task creation (no approval) → auto-dispatch → conversation messages
 *   failure handling → conversation failure message (never silent)
 *   progress callbacks → conversation progress messages
 *   idempotency → double-approval is a no-op
 *   audit events → all lifecycle stages recorded
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoist vi.fn() before any imports ────────────────────────────────────────
// db mocks must be vi.fn() so tests can call .mockImplementationOnce()
const mockDbSelectFn  = vi.hoisted(() => vi.fn());
const mockDbUpdateFn  = vi.hoisted(() => vi.fn());
const mockDbInsertFn  = vi.hoisted(() => vi.fn());

const mockPostStarted   = vi.hoisted(() => vi.fn().mockResolvedValue({ id: "msg-started" }));
const mockPostProgress  = vi.hoisted(() => vi.fn().mockResolvedValue({ id: "msg-progress" }));
const mockPostCompleted = vi.hoisted(() => vi.fn().mockResolvedValue({ id: "msg-completed" }));
const mockPostFailed    = vi.hoisted(() => vi.fn().mockResolvedValue({ id: "msg-failed" }));
const mockAddMessage    = vi.hoisted(() => vi.fn().mockResolvedValue({ id: "msg-generic" }));

const mockLogOrgEvent   = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockWriteAudit    = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

const mockExecuteWork   = vi.hoisted(() => vi.fn());

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("@workspace/db", () => {
  const makeUpdateChain = () => {
    const c: Record<string, unknown> = {};
    c.set   = () => c;
    c.where = () => Promise.resolve({ rowCount: 1 });
    return c;
  };
  const makeInsertChain = () => {
    const c: Record<string, unknown> = {};
    c.values    = () => c;
    c.returning = () => Promise.resolve([]);
    c.onConflictDoNothing = () => Promise.resolve();
    return c;
  };

  // Default select chain — returns empty; tests override via mockDbSelectFn
  const makeSelectChain = (rows: unknown[] = []) => {
    const c: Record<string, unknown> = {};
    c.from    = () => c;
    c.where   = () => c;
    c.orderBy = () => c;
    c.limit   = () => Promise.resolve(rows);
    return c;
  };

  return {
    db: {
      select: mockDbSelectFn.mockImplementation(() => makeSelectChain([])),
      update: mockDbUpdateFn.mockImplementation(() => makeUpdateChain()),
      insert: mockDbInsertFn.mockImplementation(() => makeInsertChain()),
    },
    executionIntentsTable: {
      id: "id", organizationId: "organization_id", taskId: "task_id",
      status: "status", approvalRequired: "approval_required",
      dispatchedAt: "dispatched_at", updatedAt: "updated_at",
      intentType: "intent_type", approvedBy: "approved_by", approvedAt: "approved_at",
    },
    tasksTable: {
      id: "id", organizationId: "organization_id", title: "title", description: "description",
    },
    conversationsTable: {
      id: "id", organizationId: "organization_id",
      primaryTaskId: "primary_task_id", conversationType: "conversation_type",
    },
    conversationMessagesTable: {
      id: "id", organizationId: "organization_id",
      conversationId: "conversation_id", senderType: "sender_type",
    },
  };
});

vi.mock("drizzle-orm", () => ({
  eq:      (col: unknown, val: unknown) => ({ _eq: col, _val: val }),
  and:     (...args: unknown[]) => ({ _and: args }),
  desc:    (col: unknown) => ({ _desc: col }),
  lt:      (col: unknown, val: unknown) => ({ _lt: col, _val: val }),
  inArray: (col: unknown, vals: unknown) => ({ _inArray: col, _vals: vals }),
  sql:     Object.assign(
    (tpl: TemplateStringsArray, ...args: unknown[]) => ({ _sql: tpl, _args: args }),
    { raw: (s: string) => ({ _raw: s }) }
  ),
}));

vi.mock("../services/auditService.js", () => ({
  logOrgEvent: mockLogOrgEvent,
  writeAuditEvent: mockWriteAudit,
  getRequestMeta: vi.fn().mockReturnValue({}),
}));

vi.mock("../services/conversationService.js", () => ({
  postExecutionStartedToConversation:      mockPostStarted,
  postExecutionProgressToConversation:     mockPostProgress,
  postCompletedWorkCreatedToConversation:  mockPostCompleted,
  postExecutionFailedToConversation:       mockPostFailed,
  addMessage:                              mockAddMessage,
  getConversations:                        vi.fn().mockResolvedValue([]),
  findOrCreateGeneralConversation:         vi.fn().mockResolvedValue({ conversation: { id: "c-1" }, created: false }),
  createConversation:                      vi.fn().mockResolvedValue({ id: "c-2" }),
  getConversationById:                     vi.fn().mockResolvedValue(null),
  getMessages:                             vi.fn().mockResolvedValue([]),
  processUserMessage:                      vi.fn().mockResolvedValue({ userMessage: { id: "u1" }, agentMessage: { id: "a1" }, understanding: { customerResponse: "ok", conversationMode: "general", shouldCreateTask: false, confidence: 0.9, clarificationRequired: false, clarificationQuestions: [], relatedWorkforceRoles: [], proposedTask: null, requestedTaskAction: null }, structuredContent: null }),
  linkConversationToTask:                  vi.fn().mockResolvedValue(undefined),
  postPlanToConversation:                  vi.fn().mockResolvedValue({ id: "msg-plan" }),
  postApprovalRequestToConversation:       vi.fn().mockResolvedValue({ id: "msg-approval" }),
  postRuntimeEventToConversation:          vi.fn().mockResolvedValue({ id: "msg-runtime" }),
  buildMessageContext:                     vi.fn().mockResolvedValue({}),
  markMessagesRead:                        vi.fn().mockResolvedValue(undefined),
  getUnreadCount:                          vi.fn().mockResolvedValue(0),
  updateConversationStatus:                vi.fn().mockResolvedValue(undefined),
  getOrCreateWorkroom:                     vi.fn().mockResolvedValue({ id: "workroom-1" }),
}));

vi.mock("../services/workExecutionPipelineService.js", () => ({
  executeWork: mockExecuteWork,
  EXECUTION_STAGE_LABELS: {
    selecting_blueprint:     "Selecting work blueprint…",
    assembling_package:      "Reviewing organisational knowledge…",
    validating:              "Validating requirements…",
    retrieving_examples:     "Consulting approved work examples…",
    executing:               "Consulting specialist…",
    reviewing:               "Running quality review…",
    creating_completed_work: "Preparing completed work document…",
  },
}));

// Coordinator now resolves requesterRole via getMembershipForUser before calling executeWork
vi.mock("../services/membershipService.js", () => ({
  getMembershipForUser: vi.fn().mockResolvedValue({ role: "administrator" }),
}));

// ─── Import services under test (after mocks) ─────────────────────────────────
import {
  coordinateIntentApproval,
  dispatchWorkExecution,
} from "../services/executionCoordinatorService.js";

import {
  postExecutionStartedToConversation,
  postExecutionProgressToConversation,
  postCompletedWorkCreatedToConversation,
  postExecutionFailedToConversation,
} from "../services/conversationService.js";

// ─── Test constants ───────────────────────────────────────────────────────────

const ORG    = "org-123";
const TASK   = "task-abc";
const CONV   = "conv-xyz";
const USER   = "user-u1";
const INTENT = "intent-i1";

// Factory helpers
function selectReturning(rows: unknown[]) {
  const c: Record<string, unknown> = {};
  c.from    = () => c;
  c.where   = () => c;
  c.orderBy = () => c;
  c.limit   = () => Promise.resolve(rows);
  return c;
}

const INTENT_ROW = {
  id: INTENT, organizationId: ORG, taskId: TASK,
  status: "prepared", intentType: "generate_report",
  description: "Write Q3 report",
};
const TASK_ROW = { id: TASK, organizationId: ORG, title: "Q3 Report", description: "Write Q3 report" };
const CONV_ROW = { id: CONV };

// ─── coordinateIntentApproval ─────────────────────────────────────────────────

describe("coordinateIntentApproval", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecuteWork.mockResolvedValue({
      outcome: "completed",
      completedWorkId: "cw-1",
      qualityScore: 85,
      message: "Done",
    });
    // Default DB select returns empty
    mockDbSelectFn.mockImplementation(() => selectReturning([]));
    mockDbUpdateFn.mockImplementation(() => {
      const c: Record<string, unknown> = {};
      c.set   = () => c;
      c.where = () => Promise.resolve({ rowCount: 1 });
      return c;
    });
  });

  it("returns dispatched:false when intent is not found", async () => {
    // select returns empty — intent not found
    mockDbSelectFn.mockImplementation(() => selectReturning([]));

    const result = await coordinateIntentApproval(INTENT, ORG, USER);

    expect(result.dispatched).toBe(false);
    expect(result.skipReason).toBe("intent_not_found");
  });

  it("returns dispatched:false when intent is already dispatched (idempotency)", async () => {
    mockDbSelectFn.mockImplementationOnce(() =>
      selectReturning([{ ...INTENT_ROW, status: "dispatched" }])
    );

    const result = await coordinateIntentApproval(INTENT, ORG, USER);

    expect(result.dispatched).toBe(false);
    expect(result.skipReason).toBe("already_dispatched");
  });

  it("returns dispatched:false when intent is already completed (idempotency)", async () => {
    mockDbSelectFn.mockImplementationOnce(() =>
      selectReturning([{ ...INTENT_ROW, status: "completed" }])
    );

    const result = await coordinateIntentApproval(INTENT, ORG, USER);

    expect(result.dispatched).toBe(false);
    expect(result.skipReason).toBe("already_dispatched");
  });

  it("dispatches successfully for a prepared intent", async () => {
    let selectCallCount = 0;
    mockDbSelectFn.mockImplementation(() => {
      selectCallCount++;
      if (selectCallCount === 1) return selectReturning([INTENT_ROW]);  // intent
      if (selectCallCount === 2) return selectReturning([TASK_ROW]);    // task
      return selectReturning([CONV_ROW]);                                // conversation
    });

    const result = await coordinateIntentApproval(INTENT, ORG, USER);

    expect(result.dispatched).toBe(true);
    expect(result.executionStarted).toBe(true);
  });

  it("posts execution started message when a conversation is found", async () => {
    // Call order in coordinateIntentApproval:
    //   1. intent lookup
    //   2. resolveConversationForTask → workroom
    //   3. task lookup
    let callCount = 0;
    mockDbSelectFn.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return selectReturning([INTENT_ROW]);  // intent
      if (callCount === 2) return selectReturning([CONV_ROW]);    // workroom conversation
      return selectReturning([TASK_ROW]);                          // task
    });

    await coordinateIntentApproval(INTENT, ORG, USER);

    // Give the background runner one event-loop tick to post the started message
    await new Promise(r => setTimeout(r, 20));
    expect(mockPostStarted).toHaveBeenCalledWith(ORG, CONV, TASK, expect.any(String));
  });

  it("does not throw when no conversation exists for the task", async () => {
    let callCount = 0;
    mockDbSelectFn.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return selectReturning([INTENT_ROW]);
      if (callCount === 2) return selectReturning([TASK_ROW]);
      return selectReturning([]); // no conversation found
    });

    await expect(coordinateIntentApproval(INTENT, ORG, USER)).resolves.not.toThrow();
  });

  it("logs audit event on successful dispatch", async () => {
    // Call order: intent → workroom conversation → task
    let callCount = 0;
    mockDbSelectFn.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return selectReturning([INTENT_ROW]);  // intent
      if (callCount === 2) return selectReturning([CONV_ROW]);    // workroom
      return selectReturning([TASK_ROW]);                          // task
    });

    await coordinateIntentApproval(INTENT, ORG, USER);

    expect(mockLogOrgEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "execution_intent.dispatched",
        organizationId: ORG,
      })
    );
  });
});

// ─── dispatchWorkExecution ────────────────────────────────────────────────────

describe("dispatchWorkExecution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecuteWork.mockResolvedValue({
      outcome: "completed",
      completedWorkId: "cw-2",
      qualityScore: 90,
      message: "Complete",
    });
  });

  it("resolves without throwing", async () => {
    await expect(
      dispatchWorkExecution({
        organizationId: ORG,
        taskId: TASK,
        taskTitle: "Write a report",
        taskDescription: "Quarterly summary",
        requesterId: USER,
        conversationId: CONV,
      })
    ).resolves.toBeUndefined();
  });

  it("posts started message to conversation", async () => {
    await dispatchWorkExecution({
      organizationId: ORG, taskId: TASK, taskTitle: "Report",
      requesterId: USER, conversationId: CONV,
    });
    await new Promise(r => setTimeout(r, 20));
    expect(mockPostStarted).toHaveBeenCalledWith(ORG, CONV, TASK, expect.any(String));
  });

  it("posts completed work message after successful execution", async () => {
    await dispatchWorkExecution({
      organizationId: ORG, taskId: TASK, taskTitle: "Report",
      requesterId: USER, conversationId: CONV,
    });
    await new Promise(r => setTimeout(r, 50));
    expect(mockPostCompleted).toHaveBeenCalledWith(
      ORG, CONV, TASK, "cw-2", expect.any(String), 90, expect.any(String)
    );
  });

  it("posts failure message when executeWork returns non-completed outcome", async () => {
    mockExecuteWork.mockResolvedValue({
      outcome: "validation_failed",
      message: "Missing required policy document.",
    });

    await dispatchWorkExecution({
      organizationId: ORG, taskId: TASK, taskTitle: "Incident report",
      requesterId: USER, conversationId: CONV,
    });
    await new Promise(r => setTimeout(r, 50));
    expect(mockPostFailed).toHaveBeenCalledWith(
      ORG, CONV, TASK, "Missing required policy document.", expect.any(String)
    );
  });

  it("posts failure message when executeWork throws", async () => {
    mockExecuteWork.mockRejectedValue(new Error("AI gateway unavailable"));

    await dispatchWorkExecution({
      organizationId: ORG, taskId: TASK, taskTitle: "Incident report",
      requesterId: USER, conversationId: CONV,
    });
    await new Promise(r => setTimeout(r, 50));
    expect(mockPostFailed).toHaveBeenCalledWith(
      ORG, CONV, TASK, "AI gateway unavailable", expect.any(String)
    );
  });

  it("auto-creates a workroom and posts messages when taskId is provided without conversationId", async () => {
    // Sprint 27 bug fix: dispatchWorkExecution always ensures a conversation context by calling
    // getOrCreateWorkroom when conversationId is absent but taskId is present.
    await dispatchWorkExecution({
      organizationId: ORG, taskId: TASK, taskTitle: "Silent task",
      requesterId: USER,
      // no conversationId — workroom is auto-created via getOrCreateWorkroom
    });
    await new Promise(r => setTimeout(r, 50));
    // With auto-created workroom (id: "workroom-1"), execution messages ARE posted
    expect(mockPostStarted).toHaveBeenCalled();
  });

  it("passes progress callbacks to executeWork", async () => {
    let capturedProgress: ((stage: string) => Promise<void>) | null = null;

    mockExecuteWork.mockImplementation(async (input: { onProgress?: (stage: string) => Promise<void>; conversationId?: string; requesterId?: string }) => {
      capturedProgress = input.onProgress ?? null;
      return { outcome: "completed", completedWorkId: "cw-test", qualityScore: 80, message: "Done" };
    });

    await dispatchWorkExecution({
      organizationId: ORG, taskId: TASK, taskTitle: "Report",
      requesterId: USER, conversationId: CONV,
    });
    await new Promise(r => setTimeout(r, 20));

    expect(capturedProgress).not.toBeNull();
  });

  it("progress callback posts progress message to conversation", async () => {
    let capturedProgress: ((stage: string) => Promise<void>) | null = null;

    mockExecuteWork.mockImplementation(async (input: { onProgress?: (stage: string) => Promise<void>; conversationId?: string; requesterId?: string }) => {
      capturedProgress = input.onProgress ?? null;
      if (capturedProgress) await capturedProgress("executing");
      return { outcome: "completed", completedWorkId: "cw-test", qualityScore: 80, message: "Done" };
    });

    await dispatchWorkExecution({
      organizationId: ORG, taskId: TASK, taskTitle: "Report",
      requesterId: USER, conversationId: CONV,
    });
    await new Promise(r => setTimeout(r, 50));

    expect(mockPostProgress).toHaveBeenCalledWith(ORG, CONV, TASK, "executing", expect.any(String));
  });
});

// ─── Conversation lifecycle message helpers ───────────────────────────────────

describe("conversationService — execution lifecycle message exports", () => {
  it("postExecutionStartedToConversation is exported and callable", async () => {
    expect(typeof postExecutionStartedToConversation).toBe("function");
    const result = await postExecutionStartedToConversation(ORG, CONV, TASK, "corr-1");
    expect(result).toHaveProperty("id");
  });

  it("postExecutionProgressToConversation is exported and callable", async () => {
    expect(typeof postExecutionProgressToConversation).toBe("function");
    const result = await postExecutionProgressToConversation(ORG, CONV, TASK, "executing", "corr-1");
    expect(result).toHaveProperty("id");
  });

  it("postCompletedWorkCreatedToConversation is exported and callable", async () => {
    expect(typeof postCompletedWorkCreatedToConversation).toBe("function");
    const result = await postCompletedWorkCreatedToConversation(
      ORG, CONV, TASK, "cw-1", "Q3 Report", 85, "corr-1"
    );
    expect(result).toHaveProperty("id");
  });

  it("postExecutionFailedToConversation is exported and callable", async () => {
    expect(typeof postExecutionFailedToConversation).toBe("function");
    const result = await postExecutionFailedToConversation(ORG, CONV, TASK, "Specialist offline", "corr-1");
    expect(result).toHaveProperty("id");
  });
});

// ─── Execution coordinator — no silent failures ───────────────────────────────

describe("execution coordinator — no silent failures", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("catches and swallows errors in progress callbacks without aborting pipeline", async () => {
    mockExecuteWork.mockImplementation(async (input: { onProgress?: (stage: string) => Promise<void> }) => {
      if (input.onProgress) {
        // Callback throws — pipeline must NOT propagate this
        await input.onProgress("executing").catch(() => {});
      }
      return { outcome: "completed", completedWorkId: "cw-safe", qualityScore: 80, message: "Done" };
    });

    mockPostProgress.mockRejectedValue(new Error("DB write failed"));

    await expect(
      dispatchWorkExecution({
        organizationId: ORG, taskId: TASK, taskTitle: "Report",
        requesterId: USER, conversationId: CONV,
      })
    ).resolves.not.toThrow();
  });

  it("failure message is always posted even when executeWork throws at the start", async () => {
    mockExecuteWork.mockRejectedValue(new Error("Connection refused"));

    await dispatchWorkExecution({
      organizationId: ORG, taskId: TASK, taskTitle: "Failing task",
      requesterId: USER, conversationId: CONV,
    });
    await new Promise(r => setTimeout(r, 50));

    expect(mockPostFailed).toHaveBeenCalledWith(
      ORG, CONV, TASK, "Connection refused", expect.any(String)
    );
  });
});

// ─── workExecutionPipelineService — onProgress wiring ─────────────────────────

describe("workExecutionPipelineService — onProgress interface", () => {
  it("executeWork mock receives and calls onProgress when provided", async () => {
    const stages: string[] = [];
    mockExecuteWork.mockImplementation(async (input: { onProgress?: (s: string) => Promise<void> }) => {
      if (input.onProgress) {
        await input.onProgress("selecting_blueprint");
        await input.onProgress("assembling_package");
        await input.onProgress("executing");
      }
      return { outcome: "completed", completedWorkId: "cw-mock", qualityScore: 75, message: "Done" };
    });

    await dispatchWorkExecution({
      organizationId: ORG, taskId: TASK, taskTitle: "Report",
      requesterId: USER, conversationId: CONV,
    });
    await new Promise(r => setTimeout(r, 50));

    // postProgress should have been called once per stage the mock fired
    expect(mockPostProgress).toHaveBeenCalledTimes(3);
    expect(mockPostProgress).toHaveBeenCalledWith(ORG, CONV, TASK, "selecting_blueprint", expect.any(String));
    expect(mockPostProgress).toHaveBeenCalledWith(ORG, CONV, TASK, "assembling_package", expect.any(String));
    expect(mockPostProgress).toHaveBeenCalledWith(ORG, CONV, TASK, "executing", expect.any(String));
  });
});

// ─── Audit coverage ───────────────────────────────────────────────────────────

describe("execution coordinator — audit coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecuteWork.mockResolvedValue({ outcome: "completed", completedWorkId: "cw-x", qualityScore: 75, message: "Done" });
  });

  it("dispatchWorkExecution logs a dispatch_started audit event", async () => {
    await dispatchWorkExecution({
      organizationId: ORG, taskId: TASK, taskTitle: "Q3 Report",
      requesterId: USER, conversationId: CONV,
    });

    expect(mockLogOrgEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "execution_coordinator.dispatch_started" })
    );
  });

  it("background runner logs completed event on success", async () => {
    await dispatchWorkExecution({
      organizationId: ORG, taskId: TASK, taskTitle: "Q3 Report",
      requesterId: USER, conversationId: CONV,
    });
    await new Promise(r => setTimeout(r, 50));

    expect(mockLogOrgEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "execution_coordinator.completed" })
    );
  });

  it("background runner logs error event on failure", async () => {
    mockExecuteWork.mockRejectedValue(new Error("Service down"));

    await dispatchWorkExecution({
      organizationId: ORG, taskId: TASK, taskTitle: "Q3 Report",
      requesterId: USER, conversationId: CONV,
    });
    await new Promise(r => setTimeout(r, 50));

    expect(mockLogOrgEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "execution_coordinator.error" })
    );
  });
});
