/**
 * Sprint 27.2 — MessageIngressService & Coordinator Checkpoint Wiring
 *
 * Tests:
 *  1. MessageIngressService — checkpoint routing vs normal CoS path
 *  2. Duplicate-resume prevention (checkpoint_duplicate result)
 *  3. Coordinator — durable createCheckpoint called on awaiting_clarification
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── All mocks at the top (hoisted) ──────────────────────────────────────────

const mockGetActiveCheckpoint   = vi.fn();
const mockBeginResume           = vi.fn();
const mockRecordAnswer          = vi.fn();
const mockCreateDurableCheckpoint = vi.fn().mockResolvedValue({
  id: "cp-new", conversationId: "conv-1", status: "awaiting_clarification",
});

vi.mock("../services/executionCheckpointService.js", () => ({
  getActiveCheckpointByConversation: (...a: unknown[]) => mockGetActiveCheckpoint(...a),
  recordClarificationAnswer:         (...a: unknown[]) => mockRecordAnswer(...a),
  beginResume:                       (...a: unknown[]) => mockBeginResume(...a),
  createCheckpoint:                  (...a: unknown[]) => mockCreateDurableCheckpoint(...a),
  hasActiveCheckpoint:               vi.fn().mockResolvedValue(false),
  markResumed:                       vi.fn().mockResolvedValue(undefined),
  markCompleted:                     vi.fn().mockResolvedValue(undefined),
  markFailed:                        vi.fn().mockResolvedValue(undefined),
  cancelCheckpoint:                  vi.fn().mockResolvedValue(undefined),
  expireStaleCheckpoints:            vi.fn().mockResolvedValue(0),
  recoverStuckResumes:               vi.fn().mockResolvedValue(0),
}));

const mockProcessUserMessage   = vi.fn();
const mockAddMessage           = vi.fn();
const mockGetOrCreateWorkroom  = vi.fn();
const mockPostClarification    = vi.fn().mockResolvedValue(undefined);
const mockPostStarted          = vi.fn().mockResolvedValue(undefined);
const mockPostProgress         = vi.fn().mockResolvedValue(undefined);
const mockPostCompleted        = vi.fn().mockResolvedValue(undefined);
const mockPostFailed           = vi.fn().mockResolvedValue(undefined);

vi.mock("../services/conversationService.js", () => ({
  processUserMessage:                      (...a: unknown[]) => mockProcessUserMessage(...a),
  addMessage:                              (...a: unknown[]) => mockAddMessage(...a),
  getOrCreateWorkroom:                     (...a: unknown[]) => mockGetOrCreateWorkroom(...a),
  getOrCreateConversation:                 vi.fn().mockResolvedValue({ id: "conv-1" }),
  postClarificationRequestToConversation:  mockPostClarification,
  postExecutionStartedToConversation:      mockPostStarted,
  postExecutionProgressToConversation:     mockPostProgress,
  postCompletedWorkCreatedToConversation:  mockPostCompleted,
  postExecutionFailedToConversation:       mockPostFailed,
  getConversationById:                     vi.fn(),
  getConversations:                        vi.fn(),
  getMessages:                             vi.fn(),
}));

const mockResumeById        = vi.fn().mockResolvedValue(undefined);
const mockResumeCheckpoint  = vi.fn().mockResolvedValue(undefined);
const mockDispatch          = vi.fn().mockResolvedValue(undefined);
const mockEmitEvent         = vi.fn();
const mockExecuteWork       = vi.fn();
const mockLogOrg            = vi.fn().mockResolvedValue(undefined);
const mockDbSelect          = vi.fn();
const mockAutoCreateAndDispatch = vi.fn();

vi.mock("../services/executionCoordinatorService.js", () => ({
  resumeFromCheckpointById: (...a: unknown[]) => mockResumeById(...a),
  resumeFromCheckpoint:     (...a: unknown[]) => mockResumeCheckpoint(...a),
  dispatchWorkExecution:    (...a: unknown[]) => mockDispatch(...a),
}));

vi.mock("../services/autoDispatchService.js", () => ({
  autoCreateAndDispatch: (...a: unknown[]) => mockAutoCreateAndDispatch(...a),
}));

// executionCheckpointStore was the legacy in-memory store (deleted — superseded by executionCheckpointService)

vi.mock("../services/workExecutionPipelineService.js", () => ({
  executeWork:             (...a: unknown[]) => mockExecuteWork(...a),
  EXECUTION_STAGE_LABELS:  {},
}));

vi.mock("../services/executionEventBus.js", () => ({
  emitExecutionEvent:          (...a: unknown[]) => mockEmitEvent(...a),
  getBufferedEventsSince:      vi.fn().mockReturnValue([]),
  subscribeToExecutionEvents:  vi.fn().mockReturnValue(() => {}),
}));

vi.mock("../services/auditService.js", () => ({
  logOrgEvent:      (...a: unknown[]) => mockLogOrg(...a),
  writeAuditEvent:  vi.fn().mockResolvedValue(undefined),
  getRequestMeta:   vi.fn().mockReturnValue({}),
}));

vi.mock("@workspace/db", () => {
  const updateChain = () => ({
    set:      vi.fn().mockReturnThis(),
    where:    vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([]),
  });
  const insertChain = () => ({
    values:    vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([{ id: "conv-1" }]),
  });
  return {
    db: {
      select: (...a: unknown[]) => mockDbSelect(...a),
      update: vi.fn().mockReturnValue(updateChain()),
      insert: vi.fn().mockReturnValue(insertChain()),
    },
    executionIntentsTable: {},
    tasksTable:            {},
    conversationsTable:    {},
    conversationMessagesTable: {},
    executionCheckpointsTable: {},
    approvalsTable:        {},
    taskExecutionPlansTable: {},
  };
});

function makeSelectChain(rows: unknown[] = []) {
  return {
    from:     vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    where:    vi.fn().mockReturnThis(),
    orderBy:  vi.fn().mockReturnThis(),
    limit:    vi.fn().mockResolvedValue(rows),
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeCheckpoint(overrides: Record<string, unknown> = {}) {
  return {
    id:                     "cp-1",
    conversationId:         "conv-1",
    organizationId:         "org-1",
    taskId:                 null,
    correlationId:          "corr-1",
    status:                 "awaiting_clarification",
    clarificationQuestions: ["What is the budget?"],
    clarificationAnswer:    null,
    payload: {
      originalRequest: "help me",
      blueprint: null,
      manifest: { manifestId: "m1" },
    },
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    ...overrides,
  };
}

function makeProcessResult() {
  return {
    userMessage:  { id: "um-1", content: "hello",    senderType: "user" },
    agentMessage: { id: "am-1", content: "Hi there", senderType: "chief_of_staff" },
    understanding: {
      conversationMode:       "casual_chat",
      confidence:             0.9,
      shouldCreateTask:       false,
      clarificationRequired:  false,
      clarificationQuestions: [],
      requestedTaskAction:    null,
      proposedTask:           null,
      relatedWorkforceRoles:  [],
      customerResponse:       "Hi there",
    },
  };
}

// ─── messageIngressService ────────────────────────────────────────────────────

describe("messageIngressService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbSelect.mockImplementation(() => makeSelectChain());
    mockGetOrCreateWorkroom.mockResolvedValue({ id: "conv-1" });
    mockAutoCreateAndDispatch.mockResolvedValue({
      taskId: "task-created-1",
      title: "Service Delivery Review for Michael",
      conversationId: "conv-1",
      workroomConversationId: "workroom-1",
      dispatched: false,
      requiresApproval: true,
      approvalId: "approval-1",
    });
  });

  it("returns error when conversationId and taskId are both absent", async () => {
    const { handleIncomingMessage } = await import("../services/messageIngressService.js");
    const result = await handleIncomingMessage({
      content: "hello",
      organizationId: "org-1",
      userId: "user-1",
    });
    expect(result.type).toBe("error");
    expect((result as any).message).toMatch(/conversationId/i);
  });

  it("resolves workroom when taskId is supplied without conversationId", async () => {
    mockGetActiveCheckpoint.mockResolvedValue(null);
    mockProcessUserMessage.mockResolvedValue(makeProcessResult());

    const { handleIncomingMessage } = await import("../services/messageIngressService.js");
    const result = await handleIncomingMessage({
      content: "hello",
      organizationId: "org-1",
      taskId: "task-1",
      userId: "user-1",
    });

    expect(mockGetOrCreateWorkroom).toHaveBeenCalledWith("org-1", "task-1", "user-1");
    expect(result.type).toBe("normal");
    expect((result as any).conversationId).toBe("conv-1");
  });

  it("routes to checkpoint path when an active checkpoint is detected", async () => {
    const cp = makeCheckpoint();
    mockGetActiveCheckpoint.mockResolvedValue(cp);
    mockRecordAnswer.mockResolvedValue(undefined);
    mockBeginResume.mockResolvedValue({ resumed: true, checkpoint: cp });
    mockAddMessage
      .mockResolvedValueOnce({ id: "um-1", content: "The budget is $5k", senderType: "user" })
      .mockResolvedValueOnce({ id: "am-1", content: "Received. Continuing…", senderType: "chief_of_staff" });

    const { handleIncomingMessage } = await import("../services/messageIngressService.js");
    const result = await handleIncomingMessage({
      content: "The budget is $5k",
      organizationId: "org-1",
      conversationId: "conv-1",
      userId: "user-1",
    });

    expect(result.type).toBe("checkpoint_resume");
    expect((result as any).checkpointId).toBe("cp-1");
    // processUserMessage must NOT be called — clarification path bypasses CoS
    expect(mockProcessUserMessage).not.toHaveBeenCalled();
    // resumeFromCheckpointById fires in the background; wait for microtasks
    await new Promise(r => setTimeout(r, 20));
    expect(mockResumeById).toHaveBeenCalledWith(
      expect.objectContaining({
        checkpointId:        "cp-1",
        conversationId:      "conv-1",
        organizationId:      "org-1",
        clarificationAnswer: "The budget is $5k",
      }),
    );
  });

  it("returns checkpoint_duplicate when beginResume claims already_resuming", async () => {
    const cp = makeCheckpoint();
    mockGetActiveCheckpoint.mockResolvedValue(cp);
    mockRecordAnswer.mockResolvedValue(undefined);
    mockBeginResume.mockResolvedValue({ resumed: false, reason: "already_resuming" });
    mockAddMessage.mockResolvedValueOnce({ id: "um-1" });

    const { handleIncomingMessage } = await import("../services/messageIngressService.js");
    const result = await handleIncomingMessage({
      content: "The budget is $5k",
      organizationId: "org-1",
      conversationId: "conv-1",
      userId: "user-1",
    });

    expect(result.type).toBe("checkpoint_duplicate");
    expect((result as any).reason).toBe("already_resuming");
    expect(mockProcessUserMessage).not.toHaveBeenCalled();
  });

  it("routes to the normal CoS path when no checkpoint exists", async () => {
    mockGetActiveCheckpoint.mockResolvedValue(null);
    mockProcessUserMessage.mockResolvedValue(makeProcessResult());

    const { handleIncomingMessage } = await import("../services/messageIngressService.js");
    const result = await handleIncomingMessage({
      content: "What is the NDIS?",
      organizationId: "org-1",
      conversationId: "conv-1",
      userId: "user-1",
    });

    expect(result.type).toBe("normal");
    expect((result as any).result.understanding.conversationMode).toBe("casual_chat");
    expect(mockResumeById).not.toHaveBeenCalled();
  });

  it("production path: task proposal creates a bound task confirmation", async () => {
    mockGetActiveCheckpoint.mockResolvedValue(null);
    mockProcessUserMessage.mockResolvedValue({
      userMessage:  { id: "um-1", content: "Prepare a service delivery review", senderType: "user" },
      agentMessage: { id: "am-1", content: "Please confirm to proceed", senderType: "chief_of_staff" },
      understanding: {
        conversationMode:      "task_intent",
        confidence:            0.9,
        shouldCreateTask:      false,
        clarificationRequired: false,
        clarificationQuestions: [],
        requestedTaskAction:   "create",
        proposedTask: {
          title: "Service Delivery Review for Michael",
          summary: "Prepare a service delivery review for Michael for July 2026.",
          priority: "normal",
          requestedOutcome: "Review delivery gaps",
          knownConstraints: [],
        },
        relatedWorkforceRoles: ["service_delivery_coordinator", "chief_of_staff"],
        customerResponse: "Please confirm to proceed.",
      },
    });

    const { handleIncomingMessage } = await import("../services/messageIngressService.js");
    const result = await handleIncomingMessage({
      content: "Prepare a service delivery review for Michael for July 2026.",
      organizationId: "org-1",
      conversationId: "conv-1",
      userId: "user-1",
    });

    expect(result.type).toBe("normal");
    expect(mockProcessUserMessage).toHaveBeenCalledTimes(1);
    expect(((await import("@workspace/db")) as any).db.insert).toHaveBeenCalled();
  });

  it("production path: bound task confirmation consumes typoed proceed without replanning", async () => {
    mockGetActiveCheckpoint.mockResolvedValue(null);
    mockDbSelect.mockImplementation(() => makeSelectChain([{
      id: "notice-1",
      structuredContent: {
        type: "conversation_pending_confirmation",
        data: {
          id: "confirm-create-1",
          action: "NEW_TASK",
          proposedTask: {
            title: "Service Delivery Review for Michael",
            summary: "Prepare a service delivery review for Michael for July 2026.",
            priority: "normal",
            requestedOutcome: "Review delivery gaps",
            knownConstraints: [],
          },
          candidateTasks: [],
          createdAt: new Date("2026-08-16T00:00:00Z").toISOString(),
          status: "pending",
          expectedResponse: "yes_no",
          reason: "task_proposal_confirmation",
        },
      },
    }]));
    mockAddMessage
      .mockResolvedValueOnce({ id: "um-proceed", senderType: "user", content: "please procceed" })
      .mockResolvedValueOnce({ id: "am-created", senderType: "chief_of_staff", content: "Created." });

    const { handleIncomingMessage } = await import("../services/messageIngressService.js");
    const result = await handleIncomingMessage({
      content: "please procceed",
      organizationId: "org-1",
      conversationId: "conv-1",
      userId: "user-1",
    });

    expect(result.type).toBe("normal");
    expect(mockProcessUserMessage).not.toHaveBeenCalled();
    expect(mockAutoCreateAndDispatch).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org-1",
      conversationId: "conv-1",
      requesterId: "user-1",
      proposedTask: expect.objectContaining({ title: "Service Delivery Review for Michael" }),
    }));
    expect((result as any).result.agentMessage.content).toMatch(/Created/);
  });

  it("prevents duplicate network submission when idempotencyKey already exists", async () => {
    mockDbSelect.mockImplementation(() => makeSelectChain([{ id: "message-existing" }]));
    mockGetActiveCheckpoint.mockResolvedValue(null);

    const { handleIncomingMessage } = await import("../services/messageIngressService.js");
    const result = await handleIncomingMessage({
      content: "Cancel that.",
      organizationId: "org-1",
      conversationId: "conv-1",
      userId: "user-1",
      idempotencyKey: "retry-key-1",
    });

    expect(result.type).toBe("checkpoint_duplicate");
    expect((result as any).reason).toBe("duplicate_message");
    expect(mockAddMessage).not.toHaveBeenCalled();
    expect(mockProcessUserMessage).not.toHaveBeenCalled();
  });

  it("returns error type when processUserMessage throws", async () => {
    mockGetActiveCheckpoint.mockResolvedValue(null);
    mockProcessUserMessage.mockRejectedValue(new Error("CoS exploded"));

    const { handleIncomingMessage } = await import("../services/messageIngressService.js");
    const result = await handleIncomingMessage({
      content: "hello",
      organizationId: "org-1",
      conversationId: "conv-1",
      userId: "user-1",
    });

    expect(result.type).toBe("error");
    expect((result as any).message).toMatch(/CoS exploded/);
  });

  it("persists the user message before firing resume (durable first, then async)", async () => {
    const cp = makeCheckpoint();
    mockGetActiveCheckpoint.mockResolvedValue(cp);
    mockRecordAnswer.mockResolvedValue(undefined);
    mockBeginResume.mockResolvedValue({ resumed: true, checkpoint: cp });
    mockAddMessage
      .mockResolvedValueOnce({ id: "um-new" })
      .mockResolvedValueOnce({ id: "am-new" });

    const { handleIncomingMessage } = await import("../services/messageIngressService.js");
    await handleIncomingMessage({
      content: "Answer text",
      organizationId: "org-1",
      conversationId: "conv-1",
      userId: "user-1",
    });

    // addMessage called twice: user message + agent acknowledgment
    expect(mockAddMessage).toHaveBeenCalledTimes(2);
    const firstCall = mockAddMessage.mock.calls[0][0];
    expect(firstCall.senderType).toBe("user");
    expect(firstCall.content).toBe("Answer text");
  });
});

// ─── Coordinator delegation — verified via messageIngressService ──────────────
// The coordinator module is fully mocked in this file (needed so messageIngressService
// tests run without real side effects). Coordinator-internal tests (verifying that
// createDurableCheckpoint is called on awaiting_clarification, etc.) live in a
// dedicated file where the coordinator module is not mocked.
//
// Here we only verify that messageIngressService correctly delegates to the
// coordinator's public API when a checkpoint resume is triggered.

describe("messageIngressService — coordinator delegation contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbSelect.mockImplementation(() => makeSelectChain());
    mockGetOrCreateWorkroom.mockResolvedValue({ id: "conv-1" });
  });

  it("calls resumeFromCheckpointById with the correct checkpoint and clarification answer", async () => {
    const cp = makeCheckpoint();
    mockGetActiveCheckpoint.mockResolvedValue(cp);
    mockRecordAnswer.mockResolvedValue(undefined);
    mockBeginResume.mockResolvedValue({ resumed: true, checkpoint: cp });
    mockAddMessage
      .mockResolvedValueOnce({ id: "um-1" })
      .mockResolvedValueOnce({ id: "am-1" });

    const { handleIncomingMessage } = await import("../services/messageIngressService.js");
    await handleIncomingMessage({
      content:        "The timeline is Q3",
      organizationId: "org-1",
      conversationId: "conv-1",
      userId:         "user-42",
    });

    // Allow the fire-and-forget resume to settle
    await new Promise(r => setTimeout(r, 20));

    expect(mockResumeById).toHaveBeenCalledWith(
      expect.objectContaining({
        checkpointId:        "cp-1",
        conversationId:      "conv-1",
        organizationId:      "org-1",
        requesterId:         "user-42",
        clarificationAnswer: "The timeline is Q3",
      }),
    );
  });

  it("does not call resumeFromCheckpointById when no checkpoint exists", async () => {
    mockGetActiveCheckpoint.mockResolvedValue(null);
    mockProcessUserMessage.mockResolvedValue({
      userMessage:  { id: "um-1" },
      agentMessage: { id: "am-1" },
      understanding: { conversationMode: "casual_chat", customerResponse: "Hi" },
    });

    const { handleIncomingMessage } = await import("../services/messageIngressService.js");
    await handleIncomingMessage({
      content:        "Just chatting",
      organizationId: "org-1",
      conversationId: "conv-1",
      userId:         "user-1",
    });

    await new Promise(r => setTimeout(r, 20));
    expect(mockResumeById).not.toHaveBeenCalled();
  });
});
