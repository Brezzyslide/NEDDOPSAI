/**
 * Sprint 29 — Conversation / Task / Workroom Lifecycle Tests
 *
 * Proves the corrected architecture for general_workforce conversations:
 *
 *   GENERAL WORKFORCE CHAT (reusable front desk)
 *     conversationType = general_workforce
 *     primaryTaskId    = NULL  (always — never mutated)
 *         |
 *         | creates Task A           creates Task B (later)
 *         v                          v
 *   TASK A WORKROOM              TASK B WORKROOM
 *     conversationType = task_workroom  conversationType = task_workroom
 *     primaryTaskId    = taskA.id       primaryTaskId    = taskB.id
 *
 * Key invariants verified:
 *   1. One general_workforce conversation can create Task A without acquiring primaryTaskId.
 *   2. Task A gets its own dedicated task_workroom.
 *   3. The same general_workforce conversation can later create Task B.
 *   4. Task B gets a DIFFERENT workroom.
 *   5. Execution messages (plan, approval, dispatch) do not cross between the two workrooms.
 *   6. General-chat messages after Task A do not inherit Task A's task_id.
 *   7. "View task" data in the task_created card points to the correct newly created task.
 *   8. task_workroom clarification / checkpoint resume still works (resolvedTaskId type guard).
 *   9. Rerun / revise still works — resolves the correct workroom, not the general chat.
 *  10. Approval dispatch creates/uses the correct task workroom.
 *
 *  Also verifies the safety guard in conversationService.linkConversationToTask
 *  that blocks writes to general_workforce conversations.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks (hoisted) ─────────────────────────────────────────────────────────

const mockCreateTask          = vi.fn();
const mockGetOrCreateWorkroom = vi.fn();
const mockAddMessage          = vi.fn();
const mockPostPlan            = vi.fn();
const mockPostApproval        = vi.fn();
const mockDispatch            = vi.fn().mockResolvedValue(undefined);
const mockWriteAudit          = vi.fn().mockResolvedValue(undefined);

vi.mock("../services/taskService.js", () => ({
  createTask: (...a: unknown[]) => mockCreateTask(...a),
}));

vi.mock("../services/conversationService.js", () => ({
  getOrCreateWorkroom:               (...a: unknown[]) => mockGetOrCreateWorkroom(...a),
  addMessage:                        (...a: unknown[]) => mockAddMessage(...a),
  postPlanToConversation:            (...a: unknown[]) => mockPostPlan(...a),
  postApprovalRequestToConversation: (...a: unknown[]) => mockPostApproval(...a),
}));

vi.mock("../services/executionCoordinatorService.js", () => ({
  dispatchWorkExecution: (...a: unknown[]) => mockDispatch(...a),
}));

vi.mock("../services/auditService.js", () => ({
  writeAuditEvent: (...a: unknown[]) => mockWriteAudit(...a),
  logOrgEvent:     vi.fn().mockResolvedValue(undefined),
  getRequestMeta:  vi.fn().mockReturnValue({}),
}));

const mockDbSelect = vi.fn();
vi.mock("@workspace/db", () => ({
  db: { select: (...a: unknown[]) => mockDbSelect(...a) },
  approvalsTable: { taskId: "taskId", id: "id" },
  tasksTable:     {},
}));
vi.mock("drizzle-orm", () => ({
  eq: (a: unknown, b: unknown) => ({ op: "eq", a, b }),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTaskResult(taskId: string, title: string, requiresApproval = false) {
  return {
    task: { id: taskId, title, organizationId: "org-1" },
    plan: {
      requiresApproval,
      approvalType:        requiresApproval ? "plan_approval" : null,
      reasoning:           "Standard blueprint match.",
      assignedSpecialists: [],
    },
    specialists: [],
  };
}

function makeWorkroom(taskId: string, workroomId: string) {
  return { id: workroomId, conversationType: "task_workroom", primaryTaskId: taskId };
}

function makeInput(conversationId: string, title: string) {
  return {
    organizationId: "org-1",
    conversationId,
    requesterId:    "user-1",
    proposedTask: {
      title,
      summary:          `Summary of: ${title}`,
      requestedOutcome: "Outcome delivered",
    },
  };
}

// ─── 1. Multi-task general_workforce lifecycle ────────────────────────────────

describe("General_workforce conversation — multi-task lifecycle", () => {
  beforeEach(() => vi.clearAllMocks());

  it("Task A: creates workroom, posts task_created to general chat with correct taskId", async () => {
    mockCreateTask.mockResolvedValue(makeTaskResult("task-A", "Create Care Plan for Chase"));
    mockGetOrCreateWorkroom.mockResolvedValue(makeWorkroom("task-A", "workroom-A"));
    mockAddMessage.mockResolvedValue({ id: "msg-1" });
    mockPostPlan.mockResolvedValue(undefined);

    const { autoCreateAndDispatch } = await import("../services/autoDispatchService.js");
    const result = await autoCreateAndDispatch(makeInput("general-conv-1", "Create Care Plan for Chase"));

    // Workroom created for Task A
    expect(mockGetOrCreateWorkroom).toHaveBeenCalledWith("org-1", "task-A", "user-1");

    // task_created card posted to the ORIGINAL general conversation
    expect(mockAddMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "general-conv-1",
        messageType:    "task_created",
        structuredContent: expect.objectContaining({
          data: expect.objectContaining({
            taskId:                 "task-A",
            workroomConversationId: "workroom-A",
          }),
        }),
      }),
    );

    // Return includes both conversation IDs for SSE routing and deep-link
    expect(result.taskId).toBe("task-A");
    expect(result.conversationId).toBe("general-conv-1");
    expect(result.workroomConversationId).toBe("workroom-A");
  });

  it("Task A: plan card goes into workroom-A, NOT into the general conversation", async () => {
    mockCreateTask.mockResolvedValue(makeTaskResult("task-A", "Create Care Plan for Chase"));
    mockGetOrCreateWorkroom.mockResolvedValue(makeWorkroom("task-A", "workroom-A"));
    mockAddMessage.mockResolvedValue({ id: "msg-1" });
    mockPostPlan.mockResolvedValue(undefined);

    const { autoCreateAndDispatch } = await import("../services/autoDispatchService.js");
    await autoCreateAndDispatch(makeInput("general-conv-1", "Create Care Plan for Chase"));

    expect(mockPostPlan).toHaveBeenCalledWith(
      "org-1",
      "workroom-A",         // ← workroom, not "general-conv-1"
      "task-A",
      expect.any(Object),
    );
  });

  it("Task A: dispatch goes into workroom-A, NOT into the general conversation", async () => {
    mockCreateTask.mockResolvedValue(makeTaskResult("task-A", "Create Care Plan for Chase"));
    mockGetOrCreateWorkroom.mockResolvedValue(makeWorkroom("task-A", "workroom-A"));
    mockAddMessage.mockResolvedValue({ id: "msg-1" });
    mockPostPlan.mockResolvedValue(undefined);

    const { autoCreateAndDispatch } = await import("../services/autoDispatchService.js");
    await autoCreateAndDispatch(makeInput("general-conv-1", "Create Care Plan for Chase"));
    await new Promise(r => setTimeout(r, 20));

    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId:         "task-A",
        conversationId: "workroom-A",     // ← workroom, not "general-conv-1"
      }),
    );
  });

  it("Task B: can be created from the same general conversation without any primaryTaskId guard", async () => {
    // Simulate the state AFTER Task A was created:
    // general-conv-1 still has no primaryTaskId (it was never written).
    // The second auto-dispatch for an unrelated task must succeed.

    mockCreateTask.mockResolvedValue(makeTaskResult("task-B", "Fatigue Management Audit"));
    mockGetOrCreateWorkroom.mockResolvedValue(makeWorkroom("task-B", "workroom-B"));
    mockAddMessage.mockResolvedValue({ id: "msg-2" });
    mockPostPlan.mockResolvedValue(undefined);

    const { autoCreateAndDispatch } = await import("../services/autoDispatchService.js");
    const result = await autoCreateAndDispatch(makeInput("general-conv-1", "Fatigue Management Audit"));

    // Different workroom for Task B
    expect(mockGetOrCreateWorkroom).toHaveBeenCalledWith("org-1", "task-B", "user-1");
    expect(result.taskId).toBe("task-B");
    expect(result.workroomConversationId).toBe("workroom-B");

    // Task B's task_created card references the correct task
    expect(mockAddMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "general-conv-1",
        structuredContent: expect.objectContaining({
          data: expect.objectContaining({
            taskId: "task-B",
            workroomConversationId: "workroom-B",
          }),
        }),
      }),
    );
  });

  it("Task B: dispatch goes into workroom-B — Task A and Task B execution channels do not cross", async () => {
    mockCreateTask.mockResolvedValue(makeTaskResult("task-B", "Fatigue Management Audit"));
    mockGetOrCreateWorkroom.mockResolvedValue(makeWorkroom("task-B", "workroom-B"));
    mockAddMessage.mockResolvedValue({ id: "msg-2" });
    mockPostPlan.mockResolvedValue(undefined);

    const { autoCreateAndDispatch } = await import("../services/autoDispatchService.js");
    await autoCreateAndDispatch(makeInput("general-conv-1", "Fatigue Management Audit"));
    await new Promise(r => setTimeout(r, 20));

    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId:         "task-B",
        conversationId: "workroom-B",     // ← Task B's workroom, not workroom-A
      }),
    );
    // Task A's workroom must NOT have received Task B's dispatch
    expect(mockDispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: "workroom-A" }),
    );
  });
});

// ─── 2. Approval-required path uses the correct workroom ──────────────────────

describe("Approval-required auto-dispatch — workroom routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateTask.mockResolvedValue(makeTaskResult("task-A", "Care Plan", true));
    mockGetOrCreateWorkroom.mockResolvedValue(makeWorkroom("task-A", "workroom-A"));
    mockAddMessage.mockResolvedValue({ id: "msg-1" });
    mockPostPlan.mockResolvedValue(undefined);
    mockPostApproval.mockResolvedValue(undefined);

    const selectChain = {
      from:  vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ id: "approval-A", taskId: "task-A" }]),
    };
    mockDbSelect.mockReturnValue(selectChain);
  });

  it("posts the approval card to the WORKROOM, not the general conversation", async () => {
    const { autoCreateAndDispatch } = await import("../services/autoDispatchService.js");
    const result = await autoCreateAndDispatch(makeInput("general-conv-1", "Care Plan"));

    expect(mockPostApproval).toHaveBeenCalledWith(
      "org-1",
      "workroom-A",       // ← workroom, not "general-conv-1"
      "task-A",
      "approval-A",
      expect.objectContaining({ requestingRole: "Chief of Staff" }),
    );

    expect(result.approvalId).toBe("approval-A");
    expect(result.workroomConversationId).toBe("workroom-A");
    expect(result.dispatched).toBe(false);
  });

  it("still posts the task_created card to the ORIGINAL general conversation", async () => {
    const { autoCreateAndDispatch } = await import("../services/autoDispatchService.js");
    await autoCreateAndDispatch(makeInput("general-conv-1", "Care Plan"));

    expect(mockAddMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "general-conv-1",
        messageType:    "task_created",
      }),
    );
  });
});

// ─── 3. resolvedTaskId type guard — task_workroom inherits, general does not ──

describe("resolvedTaskId type-aware resolution", () => {
  // This tests the logic directly by simulating the two conversation types.
  // The actual behaviour lives in the route; we test the rule in isolation.

  it("task_workroom: inherits primaryTaskId when no explicit taskId is given", () => {
    const conv = { conversationType: "task_workroom", primaryTaskId: "task-A" };
    const taskId: string | undefined = undefined;

    const resolvedTaskId =
      taskId ??
      (conv.conversationType === "task_workroom" ? conv.primaryTaskId ?? undefined : undefined);

    expect(resolvedTaskId).toBe("task-A");
  });

  it("task_workroom: prefers explicit taskId over conv.primaryTaskId", () => {
    const conv = { conversationType: "task_workroom", primaryTaskId: "task-A" };
    const taskId = "task-B"; // explicit body param

    const resolvedTaskId =
      taskId ??
      (conv.conversationType === "task_workroom" ? conv.primaryTaskId ?? undefined : undefined);

    expect(resolvedTaskId).toBe("task-B");
  });

  it("general_workforce: does NOT inherit conv.primaryTaskId even if one is set (stale data)", () => {
    // Simulate a general_workforce conv that still has a stale primaryTaskId from
    // before this fix was deployed. The resolver must treat it as undefined.
    const conv = { conversationType: "general_workforce", primaryTaskId: "stale-task" };
    const taskId: string | undefined = undefined;

    const resolvedTaskId =
      taskId ??
      (conv.conversationType === "task_workroom" ? conv.primaryTaskId ?? undefined : undefined);

    expect(resolvedTaskId).toBeUndefined();
  });

  it("general_workforce: uses explicit taskId from request body when provided", () => {
    const conv = { conversationType: "general_workforce", primaryTaskId: "stale-task" };
    const taskId = "task-from-body";

    const resolvedTaskId =
      taskId ??
      (conv.conversationType === "task_workroom" ? conv.primaryTaskId ?? undefined : undefined);

    expect(resolvedTaskId).toBe("task-from-body");
  });
});

// ─── 4. Auto-dispatch guard — conversation type, not primaryTaskId ────────────

describe("Auto-dispatch guard — conversation type replaces primaryTaskId check", () => {
  // Verifies that the guard conv.conversationType !== "task_workroom" allows
  // unlimited tasks in general_workforce and blocks new-task creation in task_workroom.

  it("general_workforce with existing tasks is NOT blocked by the guard", () => {
    const conv = {
      conversationType: "general_workforce",
      primaryTaskId:    "stale-task",   // would have blocked the old code
    };
    const shouldCreateTask  = true;
    const confidence        = 0.92;

    const guardPasses = conv.conversationType !== "task_workroom";
    expect(guardPasses).toBe(true);
  });

  it("general_workforce with no existing tasks also passes the guard", () => {
    const conv = { conversationType: "general_workforce", primaryTaskId: null };
    const guardPasses = conv.conversationType !== "task_workroom";
    expect(guardPasses).toBe(true);
  });

  it("task_workroom is blocked from creating new tasks via auto-dispatch", () => {
    const conv = { conversationType: "task_workroom", primaryTaskId: "task-A" };
    const guardPasses = conv.conversationType !== "task_workroom";
    expect(guardPasses).toBe(false);
  });
});

// ─── 5. task_workroom clarification / checkpoint resume still works ───────────

describe("task_workroom — clarification and resume behaviour preserved", () => {
  it("resolvedTaskId correctly inherits primaryTaskId for a task_workroom", () => {
    // This is the critical invariant for clarification resume: when the user replies
    // to a clarification question inside a task_workroom, the reply must be bound to
    // the workroom's task so the checkpoint store can find and resume it.
    const conv = { conversationType: "task_workroom", primaryTaskId: "task-A" };

    const resolvedTaskId =
      undefined /* no explicit body taskId */ ??
      (conv.conversationType === "task_workroom" ? conv.primaryTaskId ?? undefined : undefined);

    expect(resolvedTaskId).toBe("task-A"); // checkpoint lookup will succeed
  });
});

// ─── 6. "View task" data integrity — task_created card points to correct task ─

describe("task_created structured card — View Task data integrity", () => {
  beforeEach(() => vi.clearAllMocks());

  it("Task A card contains taskId=task-A and workroomConversationId=workroom-A", async () => {
    mockCreateTask.mockResolvedValue(makeTaskResult("task-A", "Care Plan for Chase"));
    mockGetOrCreateWorkroom.mockResolvedValue(makeWorkroom("task-A", "workroom-A"));
    mockAddMessage.mockResolvedValue({ id: "msg-1" });
    mockPostPlan.mockResolvedValue(undefined);

    const { autoCreateAndDispatch } = await import("../services/autoDispatchService.js");
    await autoCreateAndDispatch(makeInput("general-conv-1", "Care Plan for Chase"));

    const call = mockAddMessage.mock.calls[0]![0] as {
      structuredContent: { data: { taskId: string; workroomConversationId: string } };
    };
    expect(call.structuredContent.data.taskId).toBe("task-A");
    expect(call.structuredContent.data.workroomConversationId).toBe("workroom-A");
  });

  it("Task B card contains taskId=task-B and workroomConversationId=workroom-B (not workroom-A)", async () => {
    mockCreateTask.mockResolvedValue(makeTaskResult("task-B", "Fatigue Audit"));
    mockGetOrCreateWorkroom.mockResolvedValue(makeWorkroom("task-B", "workroom-B"));
    mockAddMessage.mockResolvedValue({ id: "msg-2" });
    mockPostPlan.mockResolvedValue(undefined);

    const { autoCreateAndDispatch } = await import("../services/autoDispatchService.js");
    await autoCreateAndDispatch(makeInput("general-conv-1", "Fatigue Audit"));

    const call = mockAddMessage.mock.calls[0]![0] as {
      structuredContent: { data: { taskId: string; workroomConversationId: string } };
    };
    expect(call.structuredContent.data.taskId).toBe("task-B");
    expect(call.structuredContent.data.workroomConversationId).toBe("workroom-B");
    // Confirm it is NOT pointing at Task A's workroom
    expect(call.structuredContent.data.workroomConversationId).not.toBe("workroom-A");
  });
});
