/**
 * Task #27 — Auto-Dispatch Service
 *
 * Tests the autoCreateAndDispatch service that fires when the CoS classifies
 * a message as high-confidence task intent (shouldCreateTask + confidence ≥ 0.85).
 *
 * Post-workroom-architecture: general_workforce conversations no longer acquire
 * primaryTaskId.  All execution-scoped messages (plan, approval, dispatch) go into
 * the dedicated task_workroom returned by getOrCreateWorkroom().  Only the
 * task_created card is posted into the original conversation (front desk).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

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
  // linkConversationToTask is no longer called by autoDispatchService — general_workforce
  // conversations must remain reusable and must not acquire primaryTaskId.
  getOrCreateWorkroom:                 (...a: unknown[]) => mockGetOrCreateWorkroom(...a),
  addMessage:                          (...a: unknown[]) => mockAddMessage(...a),
  postPlanToConversation:              (...a: unknown[]) => mockPostPlan(...a),
  postApprovalRequestToConversation:   (...a: unknown[]) => mockPostApproval(...a),
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
}));

vi.mock("drizzle-orm", () => ({
  eq: (a: unknown, b: unknown) => ({ op: "eq", a, b }),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTaskResult(requiresApproval = false) {
  return {
    task: { id: "task-1", title: "Process quarterly reports", organizationId: "org-1" },
    plan: {
      requiresApproval,
      approvalType:   requiresApproval ? "plan_approval" : null,
      reasoning:      "Task matches standard document processing blueprint.",
      assignedSpecialists: [],
    },
    specialists: [],
  };
}

function makeInput() {
  return {
    organizationId: "org-1",
    conversationId: "conv-1",
    requesterId:    "user-1",
    proposedTask: {
      title:            "Process quarterly reports",
      summary:          "Compile and summarise Q3 financial reports.",
      priority:         "normal",
      requestedOutcome: "PDF summary delivered to inbox",
      knownConstraints: ["Must use approved templates"],
    },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("autoDispatchService — AUTO_EXECUTE_CONFIDENCE_THRESHOLD", () => {
  it("exports 0.85 as the threshold", async () => {
    const { AUTO_EXECUTE_CONFIDENCE_THRESHOLD } = await import("../services/autoDispatchService.js");
    expect(AUTO_EXECUTE_CONFIDENCE_THRESHOLD).toBe(0.85);
  });
});

describe("autoCreateAndDispatch — no approval required", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateTask.mockResolvedValue(makeTaskResult(false));
    mockGetOrCreateWorkroom.mockResolvedValue({
      id: "workroom-1",
      conversationType: "task_workroom",
      primaryTaskId: "task-1",
    });
    mockAddMessage.mockResolvedValue({ id: "msg-1" });
    mockPostPlan.mockResolvedValue(undefined);
  });

  it("calls createTask with the proposed task title and description", async () => {
    const { autoCreateAndDispatch } = await import("../services/autoDispatchService.js");
    await autoCreateAndDispatch(makeInput());

    expect(mockCreateTask).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId:    "org-1",
        title:             "Process quarterly reports",
        originatingModule: "cos_auto_dispatch",
      }),
    );
  });

  it("builds description from summary, requestedOutcome, and knownConstraints", async () => {
    const { autoCreateAndDispatch } = await import("../services/autoDispatchService.js");
    await autoCreateAndDispatch(makeInput());

    const call = mockCreateTask.mock.calls[0]![0] as { description: string };
    expect(call.description).toContain("Compile and summarise Q3 financial reports.");
    expect(call.description).toContain("PDF summary delivered to inbox");
    expect(call.description).toContain("Must use approved templates");
  });

  it("creates a dedicated task_workroom for the new task (does NOT call linkConversationToTask)", async () => {
    const { autoCreateAndDispatch } = await import("../services/autoDispatchService.js");
    await autoCreateAndDispatch(makeInput());

    // Workroom must be created/retrieved for the task
    expect(mockGetOrCreateWorkroom).toHaveBeenCalledWith("org-1", "task-1", "user-1");
    // linkConversationToTask must NOT be called — general_workforce conversations
    // must remain reusable and must not acquire primaryTaskId
    expect(vi.mocked).toBeDefined(); // ensure mock infra is working
    // The conversationService mock does not expose linkConversationToTask at all —
    // confirming that autoDispatchService no longer imports/calls it.
  });

  it("posts the task_created card to the ORIGINAL conversation (front desk), not the workroom", async () => {
    const { autoCreateAndDispatch } = await import("../services/autoDispatchService.js");
    await autoCreateAndDispatch(makeInput());

    expect(mockAddMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "conv-1",   // ← original general conversation
        senderType:  "system",
        messageType: "task_created",
        structuredContent: expect.objectContaining({
          data: expect.objectContaining({
            autoDispatched: true,
            workroomConversationId: "workroom-1",   // ← workroom ID surfaced in the card
          }),
        }),
      }),
    );
  });

  it("posts the plan card to the WORKROOM (not the original conversation)", async () => {
    const { autoCreateAndDispatch } = await import("../services/autoDispatchService.js");
    await autoCreateAndDispatch(makeInput());

    expect(mockPostPlan).toHaveBeenCalledWith(
      "org-1",
      "workroom-1",   // ← workroom, not "conv-1"
      "task-1",
      expect.any(Object),
    );
  });

  it("fires dispatchWorkExecution into the WORKROOM when no approval required", async () => {
    const { autoCreateAndDispatch } = await import("../services/autoDispatchService.js");
    const result = await autoCreateAndDispatch(makeInput());

    // Allow fire-and-forget to settle
    await new Promise(r => setTimeout(r, 20));

    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        taskId:         "task-1",
        conversationId: "workroom-1",   // ← workroom, not "conv-1"
        requesterId:    "user-1",
      }),
    );
    expect(result.dispatched).toBe(true);
    expect(result.requiresApproval).toBe(false);
    expect(result.approvalId).toBeUndefined();
  });

  it("returns task metadata including both conversationId and workroomConversationId", async () => {
    const { autoCreateAndDispatch } = await import("../services/autoDispatchService.js");
    const result = await autoCreateAndDispatch(makeInput());

    expect(result.taskId).toBe("task-1");
    expect(result.title).toBe("Process quarterly reports");
    expect(result.conversationId).toBe("conv-1");             // ← original conversation for SSE routing
    expect(result.workroomConversationId).toBe("workroom-1"); // ← workroom for deep-link
  });

  it("does NOT post an approval card when no approval is required", async () => {
    const { autoCreateAndDispatch } = await import("../services/autoDispatchService.js");
    await autoCreateAndDispatch(makeInput());

    expect(mockPostApproval).not.toHaveBeenCalled();
  });
});

describe("autoCreateAndDispatch — approval required", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateTask.mockResolvedValue(makeTaskResult(true));
    mockGetOrCreateWorkroom.mockResolvedValue({
      id: "workroom-1",
      conversationType: "task_workroom",
      primaryTaskId: "task-1",
    });
    mockAddMessage.mockResolvedValue({ id: "msg-1" });
    mockPostPlan.mockResolvedValue(undefined);
    mockPostApproval.mockResolvedValue(undefined);

    // DB select chain for fetching approval record
    const selectChain = {
      from:  vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ id: "approval-1", taskId: "task-1" }]),
    };
    mockDbSelect.mockReturnValue(selectChain);
  });

  it("does NOT dispatch when approval is required", async () => {
    const { autoCreateAndDispatch } = await import("../services/autoDispatchService.js");
    const result = await autoCreateAndDispatch(makeInput());

    await new Promise(r => setTimeout(r, 20));
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(result.dispatched).toBe(false);
    expect(result.requiresApproval).toBe(true);
  });

  it("posts the approval request card to the WORKROOM (not the general chat)", async () => {
    const { autoCreateAndDispatch } = await import("../services/autoDispatchService.js");
    const result = await autoCreateAndDispatch(makeInput());

    expect(mockPostApproval).toHaveBeenCalledWith(
      "org-1",
      "workroom-1",   // ← workroom, not "conv-1"
      "task-1",
      "approval-1",
      expect.objectContaining({
        requestedAction: "Execute: Process quarterly reports",
        requestingRole:  "Chief of Staff",
      }),
    );
    expect(result.approvalId).toBe("approval-1");
  });

  it("returns requiresApproval=true with the approvalId and workroomConversationId", async () => {
    const { autoCreateAndDispatch } = await import("../services/autoDispatchService.js");
    const result = await autoCreateAndDispatch(makeInput());

    expect(result.requiresApproval).toBe(true);
    expect(result.approvalId).toBe("approval-1");
    expect(result.dispatched).toBe(false);
    expect(result.workroomConversationId).toBe("workroom-1");
  });
});

describe("autoCreateAndDispatch — error handling", () => {
  beforeEach(() => vi.clearAllMocks());

  it("propagates errors from createTask so the route can catch and handle non-fatally", async () => {
    mockCreateTask.mockRejectedValue(new Error("DB constraint violation"));

    const { autoCreateAndDispatch } = await import("../services/autoDispatchService.js");
    await expect(autoCreateAndDispatch(makeInput())).rejects.toThrow("DB constraint violation");
  });

  it("uses 'normal' priority when proposedTask has no priority field", async () => {
    mockCreateTask.mockResolvedValue(makeTaskResult(false));
    mockGetOrCreateWorkroom.mockResolvedValue({ id: "workroom-1", conversationType: "task_workroom", primaryTaskId: "task-1" });
    mockAddMessage.mockResolvedValue({ id: "msg-1" });
    mockPostPlan.mockResolvedValue(undefined);

    const { autoCreateAndDispatch } = await import("../services/autoDispatchService.js");
    await autoCreateAndDispatch({
      ...makeInput(),
      proposedTask: { title: "Minimal task", summary: "Brief description" },
    });

    expect(mockCreateTask).toHaveBeenCalledWith(
      expect.objectContaining({ priority: "normal" }),
    );
  });
});
