/**
 * Sprint 27.2 — Durable Checkpoint Persistence (Service Tests)
 *
 * Tests the executionCheckpointService using a mocked @workspace/db.
 * messageIngressService and coordinator tests live in sprint272-message-ingress.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "crypto";

// ─── Module mocks ─────────────────────────────────────────────────────────────

const mockUpdate = vi.fn();
const mockInsert = vi.fn();
const mockSelect = vi.fn();
const mockExecute = vi.fn();

vi.mock("@workspace/db", () => ({
  db: {
    insert: (...a: unknown[]) => mockInsert(...a),
    update: (...a: unknown[]) => mockUpdate(...a),
    select: (...a: unknown[]) => mockSelect(...a),
    execute: (...a: unknown[]) => mockExecute(...a),
  },
  withSystemTenantContext: vi.fn((_context: unknown, fn: (client: unknown) => unknown) =>
    fn({
      insert: (...a: unknown[]) => mockInsert(...a),
      update: (...a: unknown[]) => mockUpdate(...a),
      select: (...a: unknown[]) => mockSelect(...a),
    }),
  ),
  executionCheckpointsTable: {
    id:              "id",
    organizationId:  "organizationId",
    conversationId:  "conversationId",
    status:          "status",
    updatedAt:       "updatedAt",
    cancelledAt:     "cancelledAt",
    expiresAt:       "expiresAt",
    resumedAt:       "resumedAt",
    completedAt:     "completedAt",
    clarificationAnswer: "clarificationAnswer",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq:      (...a: unknown[]) => ({ op: "eq", a }),
  and:     (...a: unknown[]) => ({ op: "and", a }),
  lt:      (...a: unknown[]) => ({ op: "lt", a }),
  or:      (...a: unknown[]) => ({ op: "or", a }),
  inArray: (...a: unknown[]) => ({ op: "inArray", a }),
  desc:    (...a: unknown[]) => ({ op: "desc", a }),
  sql:     (strings: TemplateStringsArray, ...values: unknown[]) => ({ sql: strings.join("?"), values }),
}));

vi.mock("../services/auditService.js", () => ({
  logOrgEvent:     vi.fn().mockResolvedValue(undefined),
  writeAuditEvent: vi.fn().mockResolvedValue(undefined),
  getRequestMeta:  vi.fn().mockReturnValue({}),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeUpdateChain(returnVal: unknown[] = []) {
  const chain: Record<string, unknown> = {};
  chain.set       = vi.fn().mockReturnValue(chain);
  chain.where     = vi.fn().mockReturnValue(chain);
  chain.returning = vi.fn().mockResolvedValue(returnVal);
  return chain;
}

function makeInsertChain(returnVal: unknown[]) {
  const chain: Record<string, unknown> = {};
  chain.values    = vi.fn().mockReturnValue(chain);
  chain.returning = vi.fn().mockResolvedValue(returnVal);
  return chain;
}

function makeSelectChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  chain.from  = vi.fn().mockReturnValue(chain);
  chain.where = vi.fn().mockReturnValue(Promise.resolve(rows));
  // limit must terminate the chain
  chain.where = vi.fn().mockReturnValue({
    limit: vi.fn().mockResolvedValue(rows),
  });
  chain.from = vi.fn().mockReturnValue(chain);
  return chain;
}

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id:                     randomUUID(),
    organizationId:         "org-1",
    conversationId:         "conv-1",
    taskId:                 null,
    correlationId:          "corr-1",
    status:                 "awaiting_clarification",
    clarificationQuestions: ["What budget do you have?"],
    clarificationAnswer:    null,
    checkpointPayload:      {
      originalRequest: "help me",
      blueprint: null,
      manifest: { manifestId: "m1" },
    },
    createdAt:   new Date(),
    updatedAt:   new Date(),
    expiresAt:   new Date(Date.now() + 30 * 60 * 1000),
    resumedAt:   null,
    completedAt: null,
    cancelledAt: null,
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("executionCheckpointService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecute.mockReset();
  });

  // ── createCheckpoint ────────────────────────────────────────────────────────

  describe("createCheckpoint", () => {
    it("cancels existing active checkpoints then inserts a new one", async () => {
      const row = makeRow();
      mockUpdate.mockReturnValue(makeUpdateChain([]));
      mockInsert.mockReturnValue(makeInsertChain([row]));

      const { createCheckpoint } = await import("../services/executionCheckpointService.js");
      const result = await createCheckpoint({
        correlationId:          "corr-1",
        conversationId:         "conv-1",
        organizationId:         "org-1",
        requesterId:            "user-1",
        clarificationQuestions: ["What budget?"],
        payload: {
          originalRequest: "help me",
          blueprint: null,
          manifest: { manifestId: "m1" } as any,
        },
      });

      expect(mockUpdate).toHaveBeenCalled();  // cancel existing
      expect(mockInsert).toHaveBeenCalled();  // insert new
      expect(result.conversationId).toBe("conv-1");
      expect(result.correlationId).toBe("corr-1");
    });
  });

  // ── getActiveCheckpointByConversation ───────────────────────────────────────

  describe("getActiveCheckpointByConversation", () => {
    it("returns null when no active checkpoint exists", async () => {
      mockSelect.mockReturnValue(makeSelectChain([]));

      const { getActiveCheckpointByConversation } = await import("../services/executionCheckpointService.js");
      const result = await getActiveCheckpointByConversation("conv-99", "org-1");
      expect(result).toBeNull();
    });

    it("returns the mapped checkpoint when one exists", async () => {
      const row = makeRow({ conversationId: "conv-2" });
      mockSelect.mockReturnValue(makeSelectChain([row]));

      const { getActiveCheckpointByConversation } = await import("../services/executionCheckpointService.js");
      const result = await getActiveCheckpointByConversation("conv-2", "org-1");

      expect(result).not.toBeNull();
      expect(result?.conversationId).toBe("conv-2");
      expect(result?.correlationId).toBe("corr-1");
      expect(result?.payload.originalRequest).toBe("help me");
    });

    it("expires and returns null when checkpoint is past its TTL", async () => {
      const expired = makeRow({ expiresAt: new Date(Date.now() - 1000) });
      mockSelect.mockReturnValue(makeSelectChain([expired]));
      mockUpdate.mockReturnValue(makeUpdateChain([]));

      const { getActiveCheckpointByConversation } = await import("../services/executionCheckpointService.js");
      const result = await getActiveCheckpointByConversation("conv-1", "org-1");

      expect(result).toBeNull();
      // Should have updated the row to expired
      const setCall = (mockUpdate.mock.results[0].value as any).set.mock.calls[0][0];
      expect(setCall.status).toBe("expired");
    });
  });

  // ── hasActiveCheckpoint ─────────────────────────────────────────────────────

  describe("hasActiveCheckpoint", () => {
    it("returns false when no checkpoint", async () => {
      mockSelect.mockReturnValue(makeSelectChain([]));
      const { hasActiveCheckpoint } = await import("../services/executionCheckpointService.js");
      expect(await hasActiveCheckpoint("conv-x", "org-1")).toBe(false);
    });

    it("returns true when a valid checkpoint exists", async () => {
      mockSelect.mockReturnValue(makeSelectChain([makeRow()]));
      const { hasActiveCheckpoint } = await import("../services/executionCheckpointService.js");
      expect(await hasActiveCheckpoint("conv-1", "org-1")).toBe(true);
    });
  });

  // ── beginResume ─────────────────────────────────────────────────────────────

  describe("beginResume", () => {
    it("returns no_checkpoint when nothing found", async () => {
      mockSelect.mockReturnValue(makeSelectChain([]));
      const { beginResume } = await import("../services/executionCheckpointService.js");
      const result = await beginResume("conv-empty", "org-1");
      expect(result.resumed).toBe(false);
      expect(result.reason).toBe("no_checkpoint");
    });

    it("returns already_resuming when checkpoint is already mid-resume", async () => {
      mockSelect.mockReturnValue(makeSelectChain([makeRow({ status: "resuming" })]));
      const { beginResume } = await import("../services/executionCheckpointService.js");
      const result = await beginResume("conv-1", "org-1");
      expect(result.resumed).toBe(false);
      expect(result.reason).toBe("already_resuming");
    });

    it("atomically transitions awaiting_clarification → resuming and returns the checkpoint", async () => {
      const row = makeRow({ status: "awaiting_clarification" });
      mockSelect.mockReturnValue(makeSelectChain([row]));
      const updatedRow = { ...row, status: "resuming" };
      mockUpdate.mockReturnValue(makeUpdateChain([updatedRow]));

      const { beginResume } = await import("../services/executionCheckpointService.js");
      const result = await beginResume("conv-1", "org-1");

      expect(result.resumed).toBe(true);
      expect(result.checkpoint).toBeDefined();
      expect(mockUpdate).toHaveBeenCalled();
    });

    it("returns already_resuming when 0 rows updated (concurrent request won the race)", async () => {
      const row = makeRow({ status: "awaiting_clarification" });
      mockSelect.mockReturnValue(makeSelectChain([row]));
      // 0 rows returned from update → race lost
      mockUpdate.mockReturnValue(makeUpdateChain([]));

      const { beginResume } = await import("../services/executionCheckpointService.js");
      const result = await beginResume("conv-1", "org-1");

      expect(result.resumed).toBe(false);
      expect(result.reason).toBe("already_resuming");
    });
  });

  // ── recordClarificationAnswer ───────────────────────────────────────────────

  describe("recordClarificationAnswer", () => {
    it("persists the answer to the checkpoint row", async () => {
      const updateChain = makeUpdateChain([]);
      mockUpdate.mockReturnValue(updateChain);

      const { recordClarificationAnswer } = await import("../services/executionCheckpointService.js");
      await recordClarificationAnswer("cp-1", "Budget is $5000", "org-1");

      expect(mockUpdate).toHaveBeenCalled();
      const setCall = (updateChain as any).set.mock.calls[0][0];
      expect(setCall.clarificationAnswer).toBe("Budget is $5000");
    });
  });

  // ── Lifecycle transitions ───────────────────────────────────────────────────

  describe("status transitions", () => {
    it.each([
      ["markResumed",      "resumed"],
      ["markCompleted",    "completed"],
      ["markFailed",       "failed"],
      ["cancelCheckpoint", "cancelled"],
    ] as const)("%s sets status to %s", async (fn, expectedStatus) => {
      const updateChain = makeUpdateChain([]);
      mockUpdate.mockReturnValue(updateChain);

      const service = await import("../services/executionCheckpointService.js") as any;
      await service[fn]("cp-abc", "org-1");

      const setCall = (updateChain as any).set.mock.calls[0][0];
      expect(setCall.status).toBe(expectedStatus);
    });
  });

  // ── Batch operations ────────────────────────────────────────────────────────

  describe("expireStaleCheckpoints", () => {
    it("marks past-expiry checkpoints as expired and returns the count", async () => {
      mockExecute.mockResolvedValue({ rows: [{ count: 2 }] });

      const { expireStaleCheckpoints } = await import("../services/executionCheckpointService.js");
      const count = await expireStaleCheckpoints();

      expect(count).toBe(2);
      expect(mockExecute).toHaveBeenCalledTimes(1);
      expect(String(mockExecute.mock.calls[0][0].sql)).toContain("public.expire_stale_execution_checkpoints");
    });

    it("returns 0 when no stale checkpoints exist", async () => {
      mockExecute.mockResolvedValue({ rows: [{ count: 0 }] });
      const { expireStaleCheckpoints } = await import("../services/executionCheckpointService.js");
      expect(await expireStaleCheckpoints()).toBe(0);
    });
  });

  describe("recoverStuckResumes", () => {
    it("restores stuck 'resuming' checkpoints to awaiting_clarification", async () => {
      mockExecute.mockResolvedValue({ rows: [{ count: 1 }] });

      const { recoverStuckResumes } = await import("../services/executionCheckpointService.js");
      const count = await recoverStuckResumes();

      expect(count).toBe(1);
      expect(mockExecute).toHaveBeenCalledTimes(1);
      expect(String(mockExecute.mock.calls[0][0].sql)).toContain("public.recover_stuck_execution_resumes");
    });

    it("returns 0 when nothing is stuck", async () => {
      mockExecute.mockResolvedValue({ rows: [{ count: 0 }] });
      const { recoverStuckResumes } = await import("../services/executionCheckpointService.js");
      expect(await recoverStuckResumes()).toBe(0);
    });
  });
});
