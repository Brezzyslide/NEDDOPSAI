import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockDbSelect,
  mockDbUpdate,
  mockDbInsert,
  mockCreateApproval,
  mockGetPendingApprovalForTask,
  mockSupersedePendingApprovalsForTask,
  mockPlanTask,
  selectRows,
  updateRows,
} = vi.hoisted(() => ({
  mockDbSelect: vi.fn(),
  mockDbUpdate: vi.fn(),
  mockDbInsert: vi.fn(),
  mockCreateApproval: vi.fn(),
  mockGetPendingApprovalForTask: vi.fn(),
  mockSupersedePendingApprovalsForTask: vi.fn(),
  mockPlanTask: vi.fn(),
  selectRows: [] as unknown[][],
  updateRows: [] as unknown[][],
}));

function selectChain() {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockImplementation(() => selectRows.shift() ?? []),
      }),
    }),
  };
}

function updateChain() {
  return {
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockImplementation(() => updateRows.shift() ?? []),
      }),
    }),
  };
}

vi.mock("@workspace/db", () => ({
  db: {
    select: mockDbSelect,
    update: mockDbUpdate,
    insert: mockDbInsert,
  },
  withSystemTenantContext: vi.fn(async (_ctx: unknown, fn: (client: unknown) => Promise<unknown>) => fn({
    select: mockDbSelect,
    update: mockDbUpdate,
    insert: mockDbInsert,
  })),
  tasksTable: {
    id: "tasks.id",
    organizationId: "tasks.organization_id",
    currentState: "tasks.current_state",
    metadata: "tasks.metadata",
    updatedAt: "tasks.updated_at",
  },
  taskCreationIdempotencyTable: {},
  taskSpecialistsTable: {},
  taskExecutionPlansTable: {},
}));

vi.mock("../services/chiefOfStaffService.js", () => ({
  planTask: mockPlanTask,
}));

vi.mock("../services/approvalService.js", () => ({
  createApproval: mockCreateApproval,
  getPendingApprovalForTask: mockGetPendingApprovalForTask,
  supersedePendingApprovalsForTask: mockSupersedePendingApprovalsForTask,
}));

import { cancelTask, recordTaskModification, requestTaskApprovalGate } from "../services/taskService.js";

function makeTask(currentState: string, metadata: Record<string, unknown> = {}) {
  return {
    id: "task-1",
    organizationId: "org-1",
    currentState,
    title: "Cancellation test task",
    metadata,
    updatedAt: new Date("2026-08-31T00:00:00Z"),
  };
}

describe("task cancellation state-machine behaviour", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectRows.length = 0;
    updateRows.length = 0;
    mockDbSelect.mockImplementation(selectChain);
    mockDbUpdate.mockImplementation(updateChain);
    mockDbInsert.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
    mockGetPendingApprovalForTask.mockResolvedValue(null);
    mockCreateApproval.mockResolvedValue({ id: "approval-1" });
    mockSupersedePendingApprovalsForTask.mockResolvedValue(undefined);
    mockPlanTask.mockReturnValue({
      requiresApproval: true,
      approvalType: "human_review",
    });
  });

  it("cancels evidence_required tasks through the canonical transition path", async () => {
    const original = makeTask("evidence_required", { existing: true });
    const transitioned = makeTask("cancelled", { existing: true });
    const updated = makeTask("cancelled", {
      existing: true,
      cancellation: {
        cancelledBy: "user-1",
        source: "test",
        cancelledAt: "2026-08-31T00:00:00Z",
      },
    });
    selectRows.push([original], [original]);
    updateRows.push([transitioned], [updated]);

    const result = await cancelTask("task-1", "org-1", {
      cancelledBy: "user-1",
      source: "test",
    });

    expect(result.status).toBe("cancelled");
    expect(result.task.currentState).toBe("cancelled");
    expect((result.task.metadata as Record<string, unknown>).cancellation).toMatchObject({
      cancelledBy: "user-1",
      source: "test",
    });
    expect(mockDbUpdate).toHaveBeenCalledTimes(2);
  });

  it("does not report completed terminal tasks as cancelled", async () => {
    const completed = makeTask("completed");
    selectRows.push([completed]);

    const result = await cancelTask("task-1", "org-1", {
      cancelledBy: "user-1",
    });

    expect(result.status).toBe("already_completed");
    expect(result.task.currentState).toBe("completed");
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });

  it("does not report success when the state transition updates zero rows", async () => {
    const queued = makeTask("queued");
    selectRows.push([queued], [queued]);
    updateRows.push([]);

    const result = await cancelTask("task-1", "org-1", {
      cancelledBy: "user-1",
    });

    expect(result.status).toBe("not_cancelled");
    expect(result.task.currentState).toBe("queued");
    expect(result.reason).toContain("did not update a row");
    expect(mockDbUpdate).toHaveBeenCalledTimes(1);
  });
});

describe("task approval and modification state-machine behaviour", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectRows.length = 0;
    updateRows.length = 0;
    mockDbSelect.mockImplementation(selectChain);
    mockDbUpdate.mockImplementation(updateChain);
    mockDbInsert.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
    mockGetPendingApprovalForTask.mockResolvedValue(null);
    mockCreateApproval.mockResolvedValue({ id: "approval-1" });
    mockSupersedePendingApprovalsForTask.mockResolvedValue(undefined);
    mockPlanTask.mockReturnValue({
      requiresApproval: true,
      approvalType: "human_review",
    });
  });

  it("moves eligible tasks to awaiting_approval through the canonical transition path", async () => {
    const original = makeTask("executing", {
      approvalRequirement: {
        required: true,
        approvalType: "human_review",
      },
    });
    const updated = makeTask("awaiting_approval", {
      approvalRequirement: {
        required: true,
        approvalType: "human_review",
      },
      approvalGate: {
        approvalId: "approval-1",
      },
    });
    selectRows.push([original], [original]);
    updateRows.push([updated]);

    const result = await requestTaskApprovalGate({
      taskId: "task-1",
      organizationId: "org-1",
      requestedByUserId: "user-1",
      completedWorkId: "completed-work-1",
      completedWorkStatus: "awaiting_approval",
    });

    expect(result.status).toBe("pending_approval");
    expect(result.task?.currentState).toBe("awaiting_approval");
    expect(result.approval?.id).toBe("approval-1");
    expect(mockDbUpdate).toHaveBeenCalledTimes(1);
  });

  it("does not report pending approval when the approval transition updates zero rows", async () => {
    const original = makeTask("executing", {
      approvalRequirement: {
        required: true,
        approvalType: "human_review",
      },
    });
    selectRows.push([original], [original], [original]);
    updateRows.push([]);

    const result = await requestTaskApprovalGate({
      taskId: "task-1",
      organizationId: "org-1",
      requestedByUserId: "user-1",
    });

    expect(result.status).toBe("not_ready");
    expect(result.task?.currentState).toBe("executing");
    expect(result.reason).toContain("did not update a row");
    expect(mockDbUpdate).toHaveBeenCalledTimes(1);
  });

  it("modifies open tasks through the canonical transition path", async () => {
    const original = makeTask("approved", {
      approvalRequirement: {
        required: true,
        approvalType: "human_review",
      },
    });
    const updated = {
      ...makeTask("planning", {
        modificationRequests: [{
          changeRequest: "Add medication issue.",
        }],
      }),
      description: "Updated task specification.",
      approvalState: "required",
    };
    selectRows.push([original], [original]);
    updateRows.push([updated]);

    const result = await recordTaskModification({
      taskId: "task-1",
      organizationId: "org-1",
      actorUserId: "user-1",
      changeRequest: "Add medication issue.",
    });

    expect(result.status).toBe("modified");
    expect(result.task.currentState).toBe("planning");
    expect(mockDbUpdate).toHaveBeenCalledTimes(1);
  });

  it("persists same-state task modifications instead of returning the stale task", async () => {
    const original = makeTask("planning", {
      approvalRequirement: {
        required: true,
        approvalType: "human_review",
      },
    });
    const updated = {
      ...makeTask("planning", {
        modificationRequests: [{
          changeRequest: "Add medication issue.",
        }],
      }),
      description: "Updated task specification.",
      approvalState: "required",
    };
    selectRows.push([original], [original]);
    updateRows.push([updated]);

    const result = await recordTaskModification({
      taskId: "task-1",
      organizationId: "org-1",
      actorUserId: "user-1",
      changeRequest: "Add medication issue.",
    });

    expect(result.status).toBe("modified");
    expect(result.task).toBe(updated);
    expect(mockDbUpdate).toHaveBeenCalledTimes(1);
  });

  it("does not report modification when the modification transition updates zero rows", async () => {
    const original = makeTask("approved", {
      approvalRequirement: {
        required: true,
        approvalType: "human_review",
      },
    });
    selectRows.push([original], [original], [original]);
    updateRows.push([]);

    const result = await recordTaskModification({
      taskId: "task-1",
      organizationId: "org-1",
      actorUserId: "user-1",
      changeRequest: "Add medication issue.",
    });

    expect(result.status).toBe("not_modified");
    expect(result.task.currentState).toBe("approved");
    expect(result.reason).toContain("did not update a row");
    expect(mockDbUpdate).toHaveBeenCalledTimes(1);
  });
});
