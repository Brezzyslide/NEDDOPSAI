import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockDbSelect,
  mockDbUpdate,
  selectRows,
  updateRows,
} = vi.hoisted(() => ({
  mockDbSelect: vi.fn(),
  mockDbUpdate: vi.fn(),
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
  },
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
  planTask: vi.fn(),
}));

vi.mock("../services/approvalService.js", () => ({
  createApproval: vi.fn(),
  getPendingApprovalForTask: vi.fn(),
  supersedePendingApprovalsForTask: vi.fn(),
}));

import { cancelTask } from "../services/taskService.js";

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
