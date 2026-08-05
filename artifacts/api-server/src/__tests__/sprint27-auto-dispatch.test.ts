/**
 * Task #27 — Auto-Dispatch Service
 *
 * Tests the autoCreateAndDispatch service that fires when the CoS classifies
 * a message as high-confidence task intent (shouldCreateTask + confidence ≥ 0.85).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockCreateTask     = vi.fn();
const mockLinkConv       = vi.fn();
const mockAddMessage     = vi.fn();
const mockPostPlan       = vi.fn();
const mockPostApproval   = vi.fn();
const mockDispatch       = vi.fn().mockResolvedValue(undefined);
const mockWriteAudit     = vi.fn().mockResolvedValue(undefined);

vi.mock("../services/taskService.js", () => ({
  createTask: (...a: unknown[]) => mockCreateTask(...a),
}));

vi.mock("../services/conversationService.js", () => ({
  linkConversationToTask:              (...a: unknown[]) => mockLinkConv(...a),
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
    mockLinkConv.mockResolvedValue(undefined);
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

  it("links the conversation to the new task", async () => {
    const { autoCreateAndDispatch } = await import("../services/autoDispatchService.js");
    await autoCreateAndDispatch(makeInput());

    expect(mockLinkConv).toHaveBeenCalledWith("org-1", "conv-1", "task-1");
  });

  it("posts a task_created system message with autoDispatched=true", async () => {
    const { autoCreateAndDispatch } = await import("../services/autoDispatchService.js");
    await autoCreateAndDispatch(makeInput());

    expect(mockAddMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        senderType:  "system",
        messageType: "task_created",
        structuredContent: expect.objectContaining({
          data: expect.objectContaining({ autoDispatched: true }),
        }),
      }),
    );
  });

  it("posts the plan card to the conversation", async () => {
    const { autoCreateAndDispatch } = await import("../services/autoDispatchService.js");
    await autoCreateAndDispatch(makeInput());

    expect(mockPostPlan).toHaveBeenCalledWith("org-1", "conv-1", "task-1", expect.any(Object));
  });

  it("fires dispatchWorkExecution in the background when no approval required", async () => {
    const { autoCreateAndDispatch } = await import("../services/autoDispatchService.js");
    const result = await autoCreateAndDispatch(makeInput());

    // Allow fire-and-forget to settle
    await new Promise(r => setTimeout(r, 20));

    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        taskId:         "task-1",
        conversationId: "conv-1",
        requesterId:    "user-1",
      }),
    );
    expect(result.dispatched).toBe(true);
    expect(result.requiresApproval).toBe(false);
    expect(result.approvalId).toBeUndefined();
  });

  it("returns task metadata the route can forward as task_auto_created SSE event", async () => {
    const { autoCreateAndDispatch } = await import("../services/autoDispatchService.js");
    const result = await autoCreateAndDispatch(makeInput());

    expect(result.taskId).toBe("task-1");
    expect(result.title).toBe("Process quarterly reports");
    expect(result.conversationId).toBe("conv-1");
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
    mockLinkConv.mockResolvedValue(undefined);
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

  it("posts an approval request card with the plan reasoning", async () => {
    const { autoCreateAndDispatch } = await import("../services/autoDispatchService.js");
    const result = await autoCreateAndDispatch(makeInput());

    expect(mockPostApproval).toHaveBeenCalledWith(
      "org-1", "conv-1", "task-1", "approval-1",
      expect.objectContaining({
        requestedAction: "Execute: Process quarterly reports",
        requestingRole:  "Chief of Staff",
      }),
    );
    expect(result.approvalId).toBe("approval-1");
  });

  it("returns requiresApproval=true with the approvalId", async () => {
    const { autoCreateAndDispatch } = await import("../services/autoDispatchService.js");
    const result = await autoCreateAndDispatch(makeInput());

    expect(result.requiresApproval).toBe(true);
    expect(result.approvalId).toBe("approval-1");
    expect(result.dispatched).toBe(false);
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
    mockLinkConv.mockResolvedValue(undefined);
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
