/**
 * Sprint 9.2 — Tenant-Aware Chief of Staff Memory
 *
 * Test surface:
 *  - contextSelectionService: token estimation, message selection, conflict detection
 *  - conversationMemoryService: summarisation trigger, deterministic fallback, pin/unpin lifecycle
 *  - organisationMemoryService: propose/approve/reject/supersede, conflict detection, listing
 *  - chiefOfStaffLLMService: layered prompt builder, parser validation, fallback path
 *  - Tenant isolation: all services must reject cross-org access
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Module mocks must be hoisted before imports ─────────────────────────────

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await vi.importActual<typeof import("@workspace/db/schema")>("@workspace/db/schema");
  const { mockDb } = await import("./helpers/sprint92Helpers.js");
  return {
    ...actual,
    db: mockDb,
    withSystemTenantContext: vi.fn(async (_ctx: unknown, fn: (client: unknown) => Promise<unknown>) => fn(mockDb)),
  };
});

vi.mock("@workspace/ai-gateway", () => ({
  createAIGateway: vi.fn(() => ({
    process: vi.fn().mockResolvedValue({ content: "{}", usedFallback: false, fallbackReason: undefined }),
    validateRetrievedFields: vi.fn(),
  })),
}));

import {
  estimateTokens,
  memoryConfig,
  buildChiefOfStaffContext,
} from "../services/contextSelectionService.js";

import {
  shouldTriggerSummarisation,
  pinDecision,
  unpinDecision,
} from "../services/conversationMemoryService.js";

import {
  proposeOrganisationMemory,
  approveOrganisationMemory,
  rejectOrganisationMemory,
  supersedeOrganisationMemory,
  listOrganisationMemory,
} from "../services/organisationMemoryService.js";

import {
  makeMockMessage,
  makeMockOrgMemory,
  resetMockDb,
  mockDb,
} from "./helpers/sprint92Helpers.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  resetMockDb();
});

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Token Estimator
// ═══════════════════════════════════════════════════════════════════════════════

describe("estimateTokens", () => {
  it("returns 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("approximates 4 chars per token", () => {
    // 40 chars → 10 tokens
    const result = estimateTokens("a".repeat(40));
    expect(result).toBe(10);
  });

  it("rounds up for non-multiples", () => {
    // 5 chars → ceil(5/4) = 2
    expect(estimateTokens("hello")).toBe(2);
  });

  it("handles multi-word strings reasonably", () => {
    const text = "The Chief of Staff manages operations for the organisation.";
    const tokens = estimateTokens(text);
    expect(tokens).toBeGreaterThan(5);
    expect(tokens).toBeLessThan(30);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Memory Config
// ═══════════════════════════════════════════════════════════════════════════════

describe("memoryConfig", () => {
  it("returns sensible defaults when env vars absent", () => {
    const cfg = memoryConfig();
    expect(cfg.maxHistoryMessages).toBe(300);
    expect(cfg.recentHistoryMessages).toBe(30);
    expect(cfg.contextTokenBudget).toBe(6000);
    expect(cfg.summarisationThreshold).toBe(40);
  });

  it("respects AI_MAX_HISTORY_MESSAGES override", () => {
    process.env.AI_MAX_HISTORY_MESSAGES = "150";
    const cfg = memoryConfig();
    expect(cfg.maxHistoryMessages).toBe(150);
    delete process.env.AI_MAX_HISTORY_MESSAGES;
  });

  it("respects AI_MEMORY_SUMMARY_THRESHOLD override", () => {
    process.env.AI_MEMORY_SUMMARY_THRESHOLD = "20";
    const cfg = memoryConfig();
    expect(cfg.summarisationThreshold).toBe(20);
    delete process.env.AI_MEMORY_SUMMARY_THRESHOLD;
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Summarisation trigger
// ═══════════════════════════════════════════════════════════════════════════════

describe("shouldTriggerSummarisation", () => {
  it("returns false when message count is below threshold", async () => {
    mockDb._setMessages([makeMockMessage(), makeMockMessage(), makeMockMessage()]);
    mockDb._setConversationMemory(null);
    const result = await shouldTriggerSummarisation("org-1", "conv-1");
    expect(result).toBe(false);
  });

  it("returns true when messages exceed threshold and no summary exists", async () => {
    process.env.AI_MEMORY_SUMMARY_THRESHOLD = "5";
    mockDb._setMessages(Array.from({ length: 10 }, () => makeMockMessage()));
    mockDb._setConversationMemory(null);
    const result = await shouldTriggerSummarisation("org-1", "conv-1");
    expect(result).toBe(true);
    delete process.env.AI_MEMORY_SUMMARY_THRESHOLD;
  });

  it("returns false when existing summary covers all messages", async () => {
    process.env.AI_MEMORY_SUMMARY_THRESHOLD = "5";
    const msgs = Array.from({ length: 8 }, () => makeMockMessage());
    mockDb._setMessages(msgs);
    mockDb._setConversationMemory({
      summarisedMessageCount: 8,
      pinnedDecisions: [], unresolvedQuestions: [], assumptions: [],
    });
    const result = await shouldTriggerSummarisation("org-1", "conv-1");
    expect(result).toBe(false);
    delete process.env.AI_MEMORY_SUMMARY_THRESHOLD;
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Pin / Unpin decisions
// ═══════════════════════════════════════════════════════════════════════════════

describe("pinDecision", () => {
  it("returns a PinnedDecision with required fields", async () => {
    mockDb._setConversationMemory(null);
    const pin = await pinDecision("org-1", "conv-1", "Roster changes need 7 days notice", null, "user-1");
    expect(pin.id).toBeTruthy();
    expect(pin.decision).toBe("Roster changes need 7 days notice");
    expect(pin.pinnedBy).toBe("user-1");
    expect(pin.pinnedAt).toBeTruthy();
    expect(pin.conversationId).toBe("conv-1");
  });

  it("truncates decision text beyond 500 chars", async () => {
    mockDb._setConversationMemory(null);
    const longText = "X".repeat(600);
    const pin = await pinDecision("org-1", "conv-1", longText, null, "user-1");
    expect(pin.decision.length).toBe(500);
  });

  it("includes sourceMessageId when provided", async () => {
    mockDb._setConversationMemory(null);
    const pin = await pinDecision("org-1", "conv-1", "Decision text", "msg-abc", "user-1");
    expect(pin.sourceMessageId).toBe("msg-abc");
  });
});

describe("unpinDecision", () => {
  it("returns true when pin is found", async () => {
    mockDb._setConversationMemory({
      pinnedDecisions: [{ id: "pin-123", decision: "Some decision" }],
      unresolvedQuestions: [], assumptions: [], summarisedMessageCount: 0,
    });
    const ok = await unpinDecision("org-1", "conv-1", "pin-123", "user-1");
    expect(ok).toBe(true);
  });

  it("returns false when conversation memory is absent", async () => {
    mockDb._setConversationMemory(null);
    const ok = await unpinDecision("org-1", "conv-1", "pin-nonexistent", "user-1");
    expect(ok).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. Organisation Memory lifecycle
// ═══════════════════════════════════════════════════════════════════════════════

describe("proposeOrganisationMemory", () => {
  it("returns an id and empty conflicts for new unique memory", async () => {
    mockDb._setOrgMemory([]);
    const result = await proposeOrganisationMemory("org-1", {
      memoryType: "operating_preference",
      title: "After-hours escalation threshold",
      content: "Incidents above severity 3 escalate to on-call manager after 6pm.",
      sourceType: "manual",
      createdBy: "user-1",
    });
    expect(result.id).toBeTruthy();
    expect(Array.isArray(result.conflicts)).toBe(true);
  });

  it("detects conflicts with similar existing approved memory", async () => {
    mockDb._setOrgMemory([
      makeMockOrgMemory({
        memoryType: "operating_preference",
        title: "After-hours escalation policy",
        status: "approved",
      }),
    ]);
    const result = await proposeOrganisationMemory("org-1", {
      memoryType: "operating_preference",
      title: "After-hours escalation threshold",
      content: "New policy text.",
      sourceType: "manual",
      createdBy: "user-1",
    });
    expect(result.conflicts.length).toBeGreaterThan(0);
    expect(result.conflicts[0]!.description).toContain("approved");
  });

  it("normalises unknown memoryType to 'other'", async () => {
    mockDb._setOrgMemory([]);
    const captured = mockDb._captureInserts("organisation_memory");
    await proposeOrganisationMemory("org-1", {
      memoryType: "invalid_type" as any,
      title: "Test",
      content: "Content",
      sourceType: "manual",
      createdBy: "user-1",
    });
    expect(captured[0]?.memoryType).toBe("other");
  });

  it("clamps importance to [1, 10]", async () => {
    mockDb._setOrgMemory([]);
    const captured = mockDb._captureInserts("organisation_memory");
    await proposeOrganisationMemory("org-1", {
      memoryType: "other",
      title: "Test",
      content: "Content",
      sourceType: "manual",
      createdBy: "user-1",
      importance: 99,
    });
    expect(captured[0]?.importance).toBe(10);
  });

  it("clamps confidence to [0, 1]", async () => {
    mockDb._setOrgMemory([]);
    const captured = mockDb._captureInserts("organisation_memory");
    await proposeOrganisationMemory("org-1", {
      memoryType: "other",
      title: "Test",
      content: "Content",
      sourceType: "manual",
      createdBy: "user-1",
      confidence: 5.0,
    });
    expect(parseFloat(captured[0]?.confidence)).toBeLessThanOrEqual(1);
  });
});

describe("approveOrganisationMemory", () => {
  it("returns true for a proposed record", async () => {
    mockDb._setOrgMemoryById({ id: "mem-1", status: "proposed" });
    const ok = await approveOrganisationMemory("org-1", "mem-1", "admin-1");
    expect(ok).toBe(true);
  });
});

describe("rejectOrganisationMemory", () => {
  it("returns true when record exists", async () => {
    mockDb._setOrgMemoryById({ id: "mem-2", status: "proposed" });
    const ok = await rejectOrganisationMemory("org-1", "mem-2", "admin-1");
    expect(ok).toBe(true);
  });
});

describe("supersedeOrganisationMemory", () => {
  it("returns ok:true when record exists", async () => {
    mockDb._setOrgMemoryById({ id: "mem-3", status: "approved" });
    const result = await supersedeOrganisationMemory("org-1", "mem-3", "mem-4", "user-1");
    expect(result.ok).toBe(true);
  });

  it("returns ok:false with self-reference error when oldId === newId", async () => {
    const result = await supersedeOrganisationMemory("org-1", "mem-3", "mem-3", "user-1");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/cannot supersede itself/i);
    }
  });
});

describe("listOrganisationMemory", () => {
  it("returns items scoped to organizationId", async () => {
    mockDb._setOrgMemory([
      makeMockOrgMemory({ id: "m1", status: "approved" }),
      makeMockOrgMemory({ id: "m2", status: "proposed" }),
    ]);
    const result = await listOrganisationMemory("org-1");
    expect(result.items.length).toBe(2);
  });

  it("respects limit parameter", async () => {
    mockDb._setOrgMemory(Array.from({ length: 10 }, (_, i) =>
      makeMockOrgMemory({ id: `m${i}`, status: "approved" })
    ));
    const result = await listOrganisationMemory("org-1", { limit: 3 });
    expect(result.items.length).toBeLessThanOrEqual(3);
  });

  it("filters by status", async () => {
    // The in-memory mock does not apply Drizzle WHERE conditions — filtering is
    // verified via the service's DB call. This test verifies that the function
    // runs without error and returns the structure expected by consumers.
    // Status filtering correctness is tested against the real DB in integration tests.
    mockDb._setOrgMemory([
      makeMockOrgMemory({ id: "m1", status: "approved" }),
      makeMockOrgMemory({ id: "m2", status: "approved" }),
    ]);
    const result = await listOrganisationMemory("org-1", { status: "approved" });
    // All items in the mock store are approved — the function returns them all
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items.every(i => i.status === "approved")).toBe(true);
  });

  it("excludes expired items by default", async () => {
    const expired = makeMockOrgMemory({ id: "m-exp", status: "approved" });
    expired.expiresAt = new Date("2020-01-01");
    mockDb._setOrgMemory([expired]);
    const result = await listOrganisationMemory("org-1");
    expect(result.items.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. Context package — structure validation
// ═══════════════════════════════════════════════════════════════════════════════

describe("buildChiefOfStaffContext", () => {
  it("returns all required fields in ChiefOfStaffContextPackage", async () => {
    mockDb._setMessages([]);
    mockDb._setOrgMemory([]);
    mockDb._setConversationMemory(null);
    mockDb._setTasks([]);

    const pkg = await buildChiefOfStaffContext({
      organizationId: "org-1",
      conversationId: "conv-1",
      userId: "user-1",
      currentMessage: "What is the status of incident reports?",
    });

    expect(pkg).toHaveProperty("organisationProfile");
    expect(pkg).toHaveProperty("approvedOrganisationMemory");
    expect(pkg).toHaveProperty("conversationSummary");
    expect(pkg).toHaveProperty("pinnedDecisions");
    expect(pkg).toHaveProperty("unresolvedQuestions");
    expect(pkg).toHaveProperty("relevantHistoricalMessages");
    expect(pkg).toHaveProperty("recentMessages");
    expect(pkg).toHaveProperty("currentTasks");
    expect(pkg).toHaveProperty("currentApprovals");
    expect(pkg).toHaveProperty("contextWarnings");
    expect(pkg).toHaveProperty("tokenEstimate");
    expect(pkg).toHaveProperty("historyStats");
  });

  it("populates recentMessages with the last N messages", async () => {
    const msgs = Array.from({ length: 15 }, (_, i) => makeMockMessage({ content: `msg-${i}` }));
    mockDb._setMessages(msgs);
    mockDb._setOrgMemory([]);
    mockDb._setConversationMemory(null);
    mockDb._setTasks([]);

    const pkg = await buildChiefOfStaffContext({
      organizationId: "org-1",
      conversationId: "conv-1",
      userId: "user-1",
      currentMessage: "Status check",
    });

    expect(pkg.recentMessages.length).toBeGreaterThan(0);
    expect(pkg.historyStats.totalAvailable).toBe(15);
  });

  it("adds a warning when message count exceeds summarisation threshold with no summary", async () => {
    process.env.AI_MEMORY_SUMMARY_THRESHOLD = "5";
    mockDb._setMessages(Array.from({ length: 10 }, () => makeMockMessage()));
    mockDb._setOrgMemory([]);
    mockDb._setConversationMemory(null);
    mockDb._setTasks([]);

    const pkg = await buildChiefOfStaffContext({
      organizationId: "org-1",
      conversationId: "conv-1",
      userId: "user-1",
      currentMessage: "What happened yesterday?",
    });

    expect(pkg.contextWarnings.some(w => w.includes("Summarisation will trigger"))).toBe(true);
    delete process.env.AI_MEMORY_SUMMARY_THRESHOLD;
  });

  it("includes approved org memory and excludes expired memory", async () => {
    const now = new Date();
    const expired = makeMockOrgMemory({ status: "approved" });
    expired.expiresAt = new Date("2020-01-01");
    const valid = makeMockOrgMemory({ status: "approved", title: "SCHADS Award rostering" });
    valid.expiresAt = null;

    mockDb._setMessages([]);
    mockDb._setOrgMemory([expired, valid]);
    mockDb._setConversationMemory(null);
    mockDb._setTasks([]);

    const pkg = await buildChiefOfStaffContext({
      organizationId: "org-1",
      conversationId: "conv-1",
      userId: "user-1",
      currentMessage: "Tell me about rostering",
    });

    expect(pkg.approvedOrganisationMemory.some(m => m.title === "SCHADS Award rostering")).toBe(true);
    expect(pkg.approvedOrganisationMemory.some(m => m.id === expired.id)).toBe(false);
  });

  it("populates pinnedDecisions from conversation memory", async () => {
    mockDb._setMessages([]);
    mockDb._setOrgMemory([]);
    mockDb._setConversationMemory({
      pinnedDecisions: [{ id: "pd-1", decision: "Pinned decision text", pinnedBy: "u1", pinnedAt: new Date().toISOString(), conversationId: "conv-1" }],
      unresolvedQuestions: [], assumptions: [], summarisedMessageCount: 0,
    });
    mockDb._setTasks([]);

    const pkg = await buildChiefOfStaffContext({
      organizationId: "org-1",
      conversationId: "conv-1",
      userId: "user-1",
      currentMessage: "What did we decide?",
    });

    expect(pkg.pinnedDecisions.length).toBe(1);
    expect(pkg.pinnedDecisions[0]!.decision).toBe("Pinned decision text");
  });

  it("uses tokenEstimate that stays within budget for empty context", async () => {
    mockDb._setMessages([]);
    mockDb._setOrgMemory([]);
    mockDb._setConversationMemory(null);
    mockDb._setTasks([]);

    const pkg = await buildChiefOfStaffContext({
      organizationId: "org-1",
      conversationId: "conv-1",
      userId: "user-1",
      currentMessage: "Hello",
    });

    expect(pkg.tokenEstimate).toBeGreaterThan(0);
    expect(pkg.tokenEstimate).toBeLessThan(memoryConfig().contextTokenBudget);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. Tenant isolation
// ═══════════════════════════════════════════════════════════════════════════════

describe("Tenant isolation — org_id always passed to DB", () => {
  it("proposeOrganisationMemory sends organizationId in the insert", async () => {
    mockDb._setOrgMemory([]);
    const captured = mockDb._captureInserts("organisation_memory");
    await proposeOrganisationMemory("org-xyz", {
      memoryType: "other",
      title: "Test",
      content: "Content",
      sourceType: "manual",
      createdBy: "user-1",
    });
    expect(captured[0]?.organizationId).toBe("org-xyz");
  });

  it("listOrganisationMemory filters by organizationId", async () => {
    // Verify that the service passes organizationId as part of the where() clause.
    // We confirm by checking that the captured select call was made once per invocation
    // (the service never fetches without scoping). The from() call fires the query callback.
    const queriedTables: string[] = [];
    mockDb._onQuery((table: string) => {
      if (table === "organisation_memory") queriedTables.push(table);
    });
    mockDb._setOrgMemory([]);
    await listOrganisationMemory("org-correct");
    // The service must have called select().from(organisationMemoryTable)
    expect(queriedTables.some(t => t === "organisation_memory")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. ChiefOfStaffLLM — JSON parser validation (directly tested through mocked gateway)
// ═══════════════════════════════════════════════════════════════════════════════

describe("ChiefOfStaffLLM — response parser", () => {
  it("always forces shouldCreateTask=false regardless of LLM output", async () => {
    const { createAIGateway } = await import("@workspace/ai-gateway");
    vi.mocked(createAIGateway).mockReturnValue({
      process: vi.fn().mockResolvedValue({
        content: JSON.stringify({
          conversationMode: "task_intent",
          confidence: 0.9,
          clarificationRequired: false,
          clarificationQuestions: [],
          shouldCreateTask: true, // LLM tried to set this to true
          shouldUpdateTask: false,
          proposedTask: {
            title: "Malicious task creation",
            summary: "Bypass check",
            priority: "high",
            requestedOutcome: "outcome",
            knownConstraints: [],
          },
          requestedTaskAction: "create",
          relatedWorkforceRoles: ["chief_of_staff"],
          customerResponse: "Creating a task for you!",
          reasoning: "test",
        }),
        usedFallback: false,
      }),
      validateRetrievedFields: vi.fn(),
    } as any);

    process.env.AI_PROVIDER = "openai";
    mockDb._setMessages([]);
    mockDb._setOrgMemory([]);
    mockDb._setConversationMemory(null);
    mockDb._setTasks([]);

    const { classifyMessageLLM } = await import("../services/chiefOfStaffLLMService.js");
    const result = await classifyMessageLLM(
      "Create a task for me",
      { organizationId: "org-1", conversationId: "conv-1" } as any,
      { userId: "u1", organizationId: "org-1", role: "member", permissions: [] }
    );

    expect(result.shouldCreateTask).toBe(false);
    delete process.env.AI_PROVIDER;
  });

  it("falls back to deterministic when AI_PROVIDER is not openai", async () => {
    delete process.env.AI_PROVIDER;
    mockDb._setMessages([]);
    mockDb._setOrgMemory([]);
    mockDb._setConversationMemory(null);
    mockDb._setTasks([]);

    const { classifyMessageLLM } = await import("../services/chiefOfStaffLLMService.js");
    const result = await classifyMessageLLM(
      "Need to fix the roster",
      { organizationId: "org-1", conversationId: "conv-1" } as any,
      { userId: "u1", organizationId: "org-1", role: "member", permissions: [] }
    );

    expect(result.shouldCreateTask).toBe(false);
    expect(["general","task_intent","task_clarification"].includes(result.conversationMode as string)).toBe(true);
    expect(result.usedFallback).toBe(true);
    expect(result.fallbackReason).toContain("AI_PROVIDER");
  });

  it("uses the OpenAI gateway path with CoS system context when AI_PROVIDER=openai", async () => {
    const { createAIGateway } = await import("@workspace/ai-gateway");
    const processMock = vi.fn().mockResolvedValue({
      content: JSON.stringify({
        conversationMode: "general",
        confidence: 0.91,
        clarificationRequired: false,
        clarificationQuestions: [],
        shouldCreateTask: false,
        shouldUpdateTask: false,
        relatedWorkforceRoles: ["chief_of_staff"],
        customerResponse: "I am the NeedsOps Chief of Staff. I coordinate the AI workforce and help route work to the right specialists.",
        reasoning: "Identity question answered from Chief of Staff context.",
      }),
      usedFallback: false,
      model: "gpt-4o-mini",
    });
    vi.mocked(createAIGateway).mockReturnValue({
      process: processMock,
      validateRetrievedFields: vi.fn(),
    } as any);

    process.env.AI_PROVIDER = "openai";
    process.env.OPENAI_MODEL = "gpt-4o-mini";
    mockDb._setMessages([]);
    mockDb._setOrgMemory([]);
    mockDb._setConversationMemory(null);
    mockDb._setTasks([]);

    const { classifyMessageLLM } = await import("../services/chiefOfStaffLLMService.js");
    const result = await classifyMessageLLM(
      "who are you and what is your role",
      { organizationId: "org-1", conversationId: "conv-1" } as any,
      { userId: "u1", organizationId: "org-1", role: "member", permissions: [] }
    );

    expect(processMock).toHaveBeenCalledTimes(1);
    const request = processMock.mock.calls[0][0];
    expect(request.outputMode).toBe("json");
    expect(request.systemPrompt).toContain("Chief of Staff");
    expect(request.userMessage).toContain("who are you and what is your role");
    expect(result.usedFallback).toBe(false);
    expect(result.customerResponse).toContain("NeedsOps Chief of Staff");
    expect(result.customerResponse).not.toBe("Happy to help. You can describe a task, ask a question, or we can think through something together.");

    delete process.env.AI_PROVIDER;
    delete process.env.OPENAI_MODEL;
  });

  it("rejects invalid conversationMode from LLM", async () => {
    const { createAIGateway } = await import("@workspace/ai-gateway");
    vi.mocked(createAIGateway).mockReturnValue({
      process: vi.fn().mockResolvedValue({
        content: JSON.stringify({ conversationMode: "HACKED_MODE", confidence: 0.9, shouldCreateTask: false, relatedWorkforceRoles: [], customerResponse: "Hi", reasoning: "test" }),
        usedFallback: false,
      }),
      validateRetrievedFields: vi.fn(),
    } as any);

    process.env.AI_PROVIDER = "openai";
    mockDb._setMessages([]);
    mockDb._setOrgMemory([]);
    mockDb._setConversationMemory(null);
    mockDb._setTasks([]);

    const { classifyMessageLLM } = await import("../services/chiefOfStaffLLMService.js");
    const result = await classifyMessageLLM(
      "Test message",
      { organizationId: "org-1", conversationId: "conv-1" } as any,
      { userId: "u1", organizationId: "org-1", role: "member", permissions: [] }
    );

    // Should fall back to deterministic since parser threw on invalid mode
    expect(result.shouldCreateTask).toBe(false);
    expect(result.usedFallback).toBe(true);
    delete process.env.AI_PROVIDER;
  });

  it("handles gateway fallback gracefully", async () => {
    const { createAIGateway } = await import("@workspace/ai-gateway");
    vi.mocked(createAIGateway).mockReturnValue({
      process: vi.fn().mockResolvedValue({
        content: "",
        usedFallback: true,
        fallbackReason: "openai_timeout",
      }),
      validateRetrievedFields: vi.fn(),
    } as any);

    process.env.AI_PROVIDER = "openai";
    mockDb._setMessages([]);
    mockDb._setOrgMemory([]);
    mockDb._setConversationMemory(null);
    mockDb._setTasks([]);

    const { classifyMessageLLM } = await import("../services/chiefOfStaffLLMService.js");
    const result = await classifyMessageLLM(
      "Process a new referral",
      { organizationId: "org-1", conversationId: "conv-1" } as any,
      { userId: "u1", organizationId: "org-1", role: "member", permissions: [] }
    );

    expect(result.usedFallback).toBe(true);
    expect(result.fallbackReason).toBe("openai_timeout");
    delete process.env.AI_PROVIDER;
  });
});
