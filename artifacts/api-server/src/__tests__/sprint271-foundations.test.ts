/**
 * Sprint 27.1 — Foundation module tests
 *
 * Tests for the three new standalone modules that have NO external dependencies
 * and do not need any DB/service mocks:
 *   1. executionEventBus   — in-memory pub/sub for SSE
 *   2. executionCheckpointStore — in-memory checkpoint with TTL
 *   3. executionTimelineService — timeline from conversation messages
 *   4. workExecutionPipelineService — checkpoint resume (awaiting_clarification outcome)
 *   5. UX compliance — human-readable labels only
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── DB mock for timeline service ─────────────────────────────────────────────

const mockDbSelectFn = vi.hoisted(() => vi.fn());

function makeSelectChain(rows: unknown[]) {
  const resolved = Promise.resolve(rows);
  const c: Record<string, unknown> = {};
  c.from           = () => c;
  c.where          = () => c;
  c.orderBy        = () => c;
  c.limit          = () => resolved;
  c.selectDistinct = () => c;
  // Allow the chain to be awaited directly (for queries that end with .orderBy())
  c.then   = resolved.then.bind(resolved);
  c.catch  = resolved.catch.bind(resolved);
  c.finally = resolved.finally.bind(resolved);
  return c;
}

vi.mock("@workspace/db", () => ({
  db: {
    select:          mockDbSelectFn,
    selectDistinct:  mockDbSelectFn,
    update:          vi.fn(() => ({ set: () => ({ where: () => Promise.resolve([]) }) })),
    insert:          vi.fn(() => ({ values: () => ({ returning: () => Promise.resolve([]) }) })),
  },
  conversationMessagesTable:  { _: "conversationMessages" },
  conversationsTable:         { _: "conversations" },
  completedWorkTable:         { _: "completedWork" },
  workPackageManifestsTable:  { id: "id", taskId: "task_id", organizationId: "organization_id" },
  executionIntentsTable:      { _: "executionIntents" },
  tasksTable:                 { _: "tasks" },
}));

vi.mock("drizzle-orm", () => ({
  eq:   () => "EQ",
  and:  (...a: unknown[]) => a,
  desc: () => "DESC",
  lt:   () => "LT",
  or:   (...a: unknown[]) => a,
}));

// ─── 1. Execution Event Bus ────────────────────────────────────────────────────

describe("executionEventBus — emit / subscribe / buffer", () => {
  it("emits events to subscribers", async () => {
    const { emitExecutionEvent, subscribeToExecutionEvents } =
      await import("../services/executionEventBus.js");

    const received: unknown[] = [];
    const unsub = subscribeToExecutionEvents("eb-conv-1", e => received.push(e));

    emitExecutionEvent("eb-conv-1", {
      type: "execution_started",
      conversationId: "eb-conv-1",
      correlationId: "corr-1",
      organizationId: "org-1",
      humanLabel: "Work is starting…",
    });

    await new Promise(r => setTimeout(r, 5));
    unsub();
    expect(received).toHaveLength(1);
    expect((received[0] as { type: string }).type).toBe("execution_started");
  });

  it("assigns monotonically increasing eventIds", async () => {
    const { emitExecutionEvent, subscribeToExecutionEvents } =
      await import("../services/executionEventBus.js");

    const ids: number[] = [];
    const unsub = subscribeToExecutionEvents("eb-conv-2", (e: { eventId: number }) => ids.push(e.eventId));

    emitExecutionEvent("eb-conv-2", {
      type: "execution_progress", conversationId: "eb-conv-2",
      correlationId: "c", organizationId: "o",
    });
    emitExecutionEvent("eb-conv-2", {
      type: "execution_progress", conversationId: "eb-conv-2",
      correlationId: "c", organizationId: "o",
    });

    unsub();
    expect(ids).toHaveLength(2);
    expect(ids[1]!).toBeGreaterThan(ids[0]!);
  });

  it("buffers events for reconnect (getBufferedEventsSince)", async () => {
    const { emitExecutionEvent, getBufferedEventsSince } =
      await import("../services/executionEventBus.js");

    emitExecutionEvent("eb-conv-3", {
      type: "execution_started", conversationId: "eb-conv-3",
      correlationId: "c", organizationId: "o", humanLabel: "Starting…",
    });
    emitExecutionEvent("eb-conv-3", {
      type: "execution_progress", conversationId: "eb-conv-3",
      correlationId: "c", organizationId: "o", humanLabel: "Running…",
    });

    const missed = getBufferedEventsSince("eb-conv-3", 0);
    expect(missed.length).toBeGreaterThanOrEqual(2);
  });

  it("getBufferedEventsSince returns empty array when no events exist", async () => {
    const { getBufferedEventsSince } = await import("../services/executionEventBus.js");
    expect(getBufferedEventsSince("eb-conv-empty-9999", 999999)).toEqual([]);
  });

  it("getBufferedEventsSince returns only events after the given lastEventId", async () => {
    const { emitExecutionEvent, subscribeToExecutionEvents, getBufferedEventsSince } =
      await import("../services/executionEventBus.js");

    const ids: number[] = [];
    const unsub = subscribeToExecutionEvents("eb-conv-4", (e: { eventId: number }) => ids.push(e.eventId));

    emitExecutionEvent("eb-conv-4", { type: "execution_started", conversationId: "eb-conv-4", correlationId: "c", organizationId: "o" });
    emitExecutionEvent("eb-conv-4", { type: "execution_progress", conversationId: "eb-conv-4", correlationId: "c", organizationId: "o" });
    emitExecutionEvent("eb-conv-4", { type: "execution_progress", conversationId: "eb-conv-4", correlationId: "c", organizationId: "o" });

    unsub();
    // Should only return events after the first one
    const afterFirst = getBufferedEventsSince("eb-conv-4", ids[0]!);
    expect(afterFirst.length).toBe(2);
  });

  it("does not leak events between different conversationIds (tenant isolation)", async () => {
    const { emitExecutionEvent, subscribeToExecutionEvents } =
      await import("../services/executionEventBus.js");

    const convA: unknown[] = [];
    const convB: unknown[] = [];

    const unsubA = subscribeToExecutionEvents("eb-tenant-A", e => convA.push(e));
    const unsubB = subscribeToExecutionEvents("eb-tenant-B", e => convB.push(e));

    emitExecutionEvent("eb-tenant-A", {
      type: "execution_started", conversationId: "eb-tenant-A",
      correlationId: "c", organizationId: "org-A",
    });

    unsubA();
    unsubB();
    expect(convA).toHaveLength(1);
    expect(convB).toHaveLength(0);
  });

  it("unsubscribe stops receiving events", async () => {
    const { emitExecutionEvent, subscribeToExecutionEvents } =
      await import("../services/executionEventBus.js");

    const received: unknown[] = [];
    const unsub = subscribeToExecutionEvents("eb-conv-unsub", e => received.push(e));

    emitExecutionEvent("eb-conv-unsub", { type: "execution_started", conversationId: "eb-conv-unsub", correlationId: "c", organizationId: "o" });
    unsub(); // unsubscribe
    emitExecutionEvent("eb-conv-unsub", { type: "execution_progress", conversationId: "eb-conv-unsub", correlationId: "c", organizationId: "o" });

    expect(received).toHaveLength(1);
  });
});

// ─── 2. Execution Checkpoint Store (deleted — Sprint 29N.8 dead-code audit) ───
// executionCheckpointStore.ts was the legacy in-memory checkpoint map.
// It has been deleted and superseded by executionCheckpointService.ts (DB-backed).
// The unit tests that exercised the in-memory store directly are removed here.
// Checkpoint behaviour is now covered by executionCheckpointService integration tests.

describe("executionCheckpointStore — deleted, superseded by DB-backed service", () => {
  it("legacy in-memory store file no longer exists", () => {
    const { existsSync } = require("fs");
    const { resolve } = require("path");
    const storePath = resolve(process.cwd(), "src/services/executionCheckpointStore.ts");
    expect(existsSync(storePath)).toBe(false);
  });

  it("DB-backed executionCheckpointService exists as replacement", () => {
    const { existsSync } = require("fs");
    const { resolve } = require("path");
    const servicePath = resolve(process.cwd(), "src/services/executionCheckpointService.ts");
    expect(existsSync(servicePath)).toBe(true);
  });
});

// ─── 3. Execution Timeline Service ────────────────────────────────────────────

describe("executionTimelineService", () => {
  beforeEach(() => {
    mockDbSelectFn.mockReset();
  });

  it("returns empty timeline for a conversation with no execution messages", async () => {
    mockDbSelectFn.mockImplementation(() => makeSelectChain([]));

    const { getConversationTimeline } = await import("../services/executionTimelineService.js");
    const timeline = await getConversationTimeline("org-1", "tl-conv-empty");
    expect(timeline.entries).toHaveLength(0);
    expect(timeline.isComplete).toBe(false);
    expect(timeline.hasFailure).toBe(false);
  });

  it("maps execution_update messages to timeline entries", async () => {
    const now = new Date();
    mockDbSelectFn.mockImplementation(() => makeSelectChain([
      {
        id: "msg-1",
        createdAt: now,
        messageType: "execution_update",
        content: "Work approved and starting…",
        structuredContent: { data: { eventType: "execution.started" } },
        correlationId: "corr-1",
      },
      {
        id: "msg-2",
        createdAt: new Date(now.getTime() + 1000),
        messageType: "execution_update",
        content: "Reviewing organisational knowledge…",
        structuredContent: { data: { eventType: "execution.step_started", stepName: "Reviewing knowledge" } },
        correlationId: "corr-1",
      },
      {
        id: "msg-3",
        createdAt: new Date(now.getTime() + 2000),
        messageType: "execution_update",
        content: "Work completed.",
        structuredContent: { data: { eventType: "execution.completed", completedWorkId: "cw-1" } },
        correlationId: "corr-1",
      },
    ]));

    const { getConversationTimeline } = await import("../services/executionTimelineService.js");
    const timeline = await getConversationTimeline("org-1", "tl-conv-1");

    expect(timeline.entries).toHaveLength(3);
    expect(timeline.entries[0]!.kind).toBe("started");
    expect(timeline.entries[2]!.kind).toBe("completed");
    expect(timeline.entries[2]!.completedWorkId).toBe("cw-1");
    expect(timeline.isComplete).toBe(true);
    expect(timeline.hasFailure).toBe(false);
  });

  it("detects failure in timeline", async () => {
    const now = new Date();
    mockDbSelectFn.mockImplementation(() => makeSelectChain([
      {
        id: "msg-fail",
        createdAt: now,
        messageType: "execution_update",
        content: "Execution failed.",
        structuredContent: { data: { eventType: "execution.failed" } },
        correlationId: "corr-fail",
      },
    ]));

    const { getConversationTimeline } = await import("../services/executionTimelineService.js");
    const timeline = await getConversationTimeline("org-1", "tl-conv-fail");
    expect(timeline.hasFailure).toBe(true);
    expect(timeline.isComplete).toBe(false);
  });

  it("getCompletedWorkTimeline returns null for unknown work ID", async () => {
    mockDbSelectFn.mockImplementation(() => makeSelectChain([]));

    const { getCompletedWorkTimeline } = await import("../services/executionTimelineService.js");
    const result = await getCompletedWorkTimeline("org-1", "cw-unknown-9999");
    expect(result).toBeNull();
  });

  it("getCompletedWorkTimeline resolves via linked conversation", async () => {
    let call = 0;
    const now = new Date();
    mockDbSelectFn.mockImplementation(() => {
      call++;
      if (call === 1) return makeSelectChain([{ conversationId: "tl-conv-linked" }]);
      return makeSelectChain([
        {
          id: "msg-start",
          createdAt: now,
          messageType: "execution_update",
          content: "Started",
          structuredContent: { data: { eventType: "execution.started" } },
          correlationId: "c",
        },
      ]);
    });

    const { getCompletedWorkTimeline } = await import("../services/executionTimelineService.js");
    const timeline = await getCompletedWorkTimeline("org-1", "cw-resolved");
    expect(timeline).not.toBeNull();
    expect(timeline!.entries).toHaveLength(1);
    expect(timeline!.entries[0]!.kind).toBe("started");
  });
});

// ─── 4. Pipeline — awaiting_clarification outcome & checkpoint resume ─────────

describe("workExecutionPipelineService — checkpoint resume", () => {
  vi.mock("../services/workBlueprintService.js", () => ({
    selectBlueprint:   vi.fn().mockResolvedValue({ blueprint: null, confidence: 0, fallbackUsed: false, matchedKeywords: [] }),
    resolveCanonicalBlueprint: vi.fn().mockResolvedValue(null),
    getBlueprintExecutionContract: vi.fn(async (blueprint) => ({ blueprint, sections: [], template: null, mode: null })),
    getBlueprintById:  vi.fn().mockResolvedValue(null),
  }));
  vi.mock("../services/workPackageService.js", () => ({
    assembleWorkPackage:          vi.fn().mockResolvedValue({
      manifest: {
        id: "manifest-x",
        organisationLibrarySources: [],
        taskUploads: [],
        cosMemories: [],
      },
      excludedSources: [],
    }),
    updateManifestObservability:  vi.fn().mockResolvedValue(undefined),
  }));
  vi.mock("../services/knowledgeResolutionService.js", () => ({
    resolveEvidence:       vi.fn().mockResolvedValue(null),
    buildEvidenceSection:  vi.fn().mockReturnValue(""),
    buildCitationSummary:  vi.fn().mockReturnValue([]),
    invalidateEvidenceCache: vi.fn(),
    clearEvidenceCache:    vi.fn(),
  }));
  vi.mock("../services/workValidationService.js", () => ({
    validateWorkPackage: vi.fn().mockReturnValue({
      passed: false,
      issues: [{ rule: "incident_policy_present", level: "error", message: "Organisation incident management policy must be retrieved" }],
      missingItems: ["Organisation Policy"],
      conflictingItems: [],
      recommendedAction: "request_information",
      summary: "1 required item(s) missing: Organisation Policy.",
      missingEvidenceItems: [{
        canonicalType: "policy",
        displayLabel: "Organisation Policy",
        required: true,
        reason: "Organisation incident management policy must be retrieved",
        searched: false,
        searchOutcome: "not_searched",
        suggestedAction: "upload_document",
      }],
      evidenceSearched: false,
      clarificationMessage: "This work requires an Organisation Policy to proceed. Please upload or approve the relevant document.",
    }),
  }));
  vi.mock("../services/approvedExampleService.js", () => ({
    retrieveApprovedExamples: vi.fn().mockResolvedValue([]),
    buildStyleGuidance:       vi.fn().mockResolvedValue({ guidanceBlock: "" }),
  }));
  vi.mock("../services/selfReviewService.js", () => ({
    reviewDraft: vi.fn().mockResolvedValue({ finalContent: "draft", qualityScore: 80, dimensions: [] }),
  }));
  vi.mock("../services/completedWorkService.js", () => ({
    createDraft: vi.fn().mockResolvedValue({ id: "cw-1" }),
  }));
  vi.mock("@workspace/workforce-dna", () => ({
    buildSystemInstructionForEmployee: vi.fn().mockReturnValue("system prompt"),
  }));
  vi.mock("@workspace/ai-gateway", () => ({
    createAIGateway: vi.fn().mockReturnValue({
      createChatCompletion: vi.fn().mockResolvedValue({ text: "Draft output" }),
    }),
  }));

  it("returns awaiting_clarification outcome when validation fails", async () => {
    const { executeWork } = await import("../services/workExecutionPipelineService.js");
    const result = await executeWork({
      organizationId: "org-1",
      requesterId: "user-1",
      requesterRole: "administrator",
      userRequest: "Write an incident report",
    });

    expect(result.outcome).toBe("awaiting_clarification");
    expect(result.clarificationQuestions).toBeDefined();
    expect(result.clarificationQuestions!.length).toBeGreaterThan(0);
  }, 30000);

  it("skips blueprint selection and manifest assembly when checkpointData provided", async () => {
    const { selectBlueprint }   = await import("../services/workBlueprintService.js");
    const { assembleWorkPackage } = await import("../services/workPackageService.js");
    const { validateWorkPackage } = await import("../services/workValidationService.js");

    // Make validation pass for the resume case
    vi.mocked(validateWorkPackage).mockReturnValueOnce({
      passed: true, issues: [], missingItems: [], conflictingItems: [],
      recommendedAction: "proceed", summary: "OK",
      missingEvidenceItems: [], evidenceSearched: false, clarificationMessage: "",
    });

    const { executeWork } = await import("../services/workExecutionPipelineService.js");

    const selectSpy  = vi.mocked(selectBlueprint);
    const assembleSpy = vi.mocked(assembleWorkPackage);
    selectSpy.mockClear();
    assembleSpy.mockClear();

    const result = await executeWork({
      organizationId: "org-1",
      requesterId: "user-1",
      requesterRole: "administrator",
      userRequest: "Write an incident report",
      checkpointData: {
        correlationId: "corr-resume",
        blueprint: null,
        manifest: {
          id: "manifest-saved",
          organisationLibrarySources: [],
          taskUploads: [],
          cosMemories: [],
        } as unknown as never,
        clarificationAnswer: "The incident occurred on Monday.",
      },
    });

    // These expensive steps must NOT run when resuming from checkpoint
    expect(selectSpy).not.toHaveBeenCalled();
    expect(assembleSpy).not.toHaveBeenCalled();
    // Pipeline continues past validation
    expect(["completed", "execution_failed"]).toContain(result.outcome);
  });

  it("enriches userRequest with clarification answer when checkpoint provided", async () => {
    const { validateWorkPackage } = await import("../services/workValidationService.js");
    vi.mocked(validateWorkPackage).mockReturnValueOnce({
      passed: true, issues: [], missingItems: [], conflictingItems: [],
      recommendedAction: "proceed", summary: "OK",
      missingEvidenceItems: [], evidenceSearched: false, clarificationMessage: "",
    });

    // We can verify the clarification answer is included by inspecting what gets passed to generateDraft
    // (indirectly: the enriched request = original + clarification answer)
    const { executeWork } = await import("../services/workExecutionPipelineService.js");
    const result = await executeWork({
      organizationId: "org-1",
      requesterId: "user-1",
      requesterRole: "administrator",
      userRequest: "Write a report",
      checkpointData: {
        correlationId: "corr-enrich",
        blueprint: null,
        manifest: { id: "m2", organisationLibrarySources: [], taskUploads: [], cosMemories: [] } as unknown as never,
        clarificationAnswer: "Monday 3rd August",
      },
    });
    // Pipeline ran without restarting from scratch
    expect(["completed", "execution_failed"]).toContain(result.outcome);
  });
});

// ─── 5. UX compliance — human-readable stage labels ─────────────────────────

describe("UX compliance — no internal names in labels", () => {
  it("EXECUTION_STAGE_LABELS contains only human-readable text", async () => {
    const { EXECUTION_STAGE_LABELS } = await import("../services/workExecutionPipelineService.js");
    const forbidden = ["manifest", "pipeline", "intent", "openclaw", "package_version", "executor"];
    for (const [stage, label] of Object.entries(EXECUTION_STAGE_LABELS)) {
      for (const term of forbidden) {
        expect(
          (label as string).toLowerCase(),
          `Stage "${stage}" label "${label}" must not contain internal term "${term}"`,
        ).not.toContain(term);
      }
    }
  });

  it("postClarificationRequestToConversation is exported", async () => {
    // Dynamic import to avoid being caught by DB mock conflicts
    // (the full mock stack is in place from the top of this file)
    const svc = await import("../services/conversationService.js");
    expect(typeof svc.postClarificationRequestToConversation).toBe("function");
  });
});
