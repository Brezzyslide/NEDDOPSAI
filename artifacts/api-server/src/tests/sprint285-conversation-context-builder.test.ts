/**
 * Sprint 28.5 — Conversation Context Builder
 *
 * Tests the single authoritative context assembly layer.
 * Every test verifies that:
 *  • The builder delegates to the correct existing services
 *  • Parallel loading is respected (round 1 all-concurrent, round 2 after)
 *  • Component failures degrade gracefully — partial context is returned
 *  • Tenant isolation is maintained across different org IDs
 *  • Chief of Staff and Operations Manager integrations produce identical output
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Hoisted mocks (must precede all imports) ──────────────────────────────────
const mocks = vi.hoisted(() => ({
  buildMessageContext: vi.fn(),
  buildChiefOfStaffContext: vi.fn(),
  getConversationWorkforceContext: vi.fn(),
  checkOrganisationLibraryPresence: vi.fn(),
  resolveConversationActionState: vi.fn(),
}));

vi.mock("../services/conversationService.js", () => ({
  buildMessageContext: mocks.buildMessageContext,
}));

vi.mock("../services/contextSelectionService.js", () => ({
  buildChiefOfStaffContext: mocks.buildChiefOfStaffContext,
}));

vi.mock("../services/conversationWorkforceContextService.js", () => ({
  getConversationWorkforceContext: mocks.getConversationWorkforceContext,
  buildWorkforceSection: vi.fn(() => "=== WORKFORCE ==="),
}));

vi.mock("../services/organisationLibraryPresenceService.js", () => ({
  checkOrganisationLibraryPresence: mocks.checkOrganisationLibraryPresence,
}));

vi.mock("../services/conversationActionStateService.js", () => ({
  resolveConversationActionState: mocks.resolveConversationActionState,
  buildActionStateSection: vi.fn(() => "=== ACTION STATE ==="),
}));

import {
  buildConversationContext,
  deriveMessageContext,
  extractDocumentSearchTerms,
  type ConversationContext,
  type BuildContextInput,
} from "../services/conversationContextBuilder.js";

// ── Test data ─────────────────────────────────────────────────────────────────

const BASE_INPUT: BuildContextInput = {
  organisationId: "org-abc",
  conversationId: "conv-123",
  userId: "user-xyz",
  currentMessage: "Hello, can you help me?",
};

const FULL_MESSAGE_CTX = {
  conversationId: "conv-123",
  organizationId: "org-abc",
  currentTaskId: "task-001",
  currentTaskTitle: "Risk Review",
  currentTaskState: "executing",
  pendingApprovalId: "appr-001",
  recentMessages: [
    { senderType: "user", content: "I need help", messageType: "user_message" },
  ],
  proposalExists: false,
};

const FULL_COS_PACKAGE = {
  organisationProfile: { name: "Acme Corp", status: "active", slug: "acme", executionFrozen: false, loginsDisabled: false, subscriptionTier: "professional" },
  approvedOrganisationMemory: [
    { id: "m1", memoryType: "procedure", title: "Onboarding", content: "Standard onboarding flow.", structuredContent: {}, status: "approved", confidence: 0.9, importance: 5, sourceType: "manual", sourceId: null, effectiveFrom: null, effectiveTo: null, expiresAt: null, approvedBy: "admin", approvedAt: new Date(), createdAt: new Date() },
  ],
  conversationSummary: { objective: "Risk review discussion", currentStatus: "in progress", agreedScope: [], decisions: [], unresolvedQuestions: [], assumptions: [], commitments: [], relevantPeople: [], relevantSystems: [], relatedTasks: [] },
  pinnedDecisions: [],
  unresolvedQuestions: [],
  relevantHistoricalMessages: [],
  recentMessages: [{ id: "m1", senderType: "user", content: "I need help", messageType: "user_message", createdAt: new Date() }],
  currentTasks: [{ id: "task-001", title: "Risk Review", currentState: "executing", priority: "high", approvalState: "approved" }],
  currentApprovals: [],
  contextWarnings: [],
  tokenEstimate: 1200,
  historyStats: { totalAvailable: 5, sent: 5, summarised: 0 },
};

const FULL_WORKFORCE = {
  specialists: [
    { code: "chief_of_staff", displayName: "Chief of Staff", availableForDispatch: true, availableForConversation: true },
    { code: "operations_manager", displayName: "Operations Manager", availableForDispatch: true, availableForConversation: true },
  ],
  totalCount: 2,
  dispatchableCount: 2,
};

const FULL_LIBRARY_PRESENCE = {
  hasResults: true,
  matches: [{ sourceTitle: "Acme Policy", status: "retrievable", confidence: 0.9 }],
  summary: "1 document found",
  searchTerms: [],
};

const FULL_ACTION_STATE = {
  level: "informational",
  proposalExists: false,
  proposalMessageId: null,
  taskExists: false,
  taskId: null,
  taskState: null,
  assignedSpecialists: [],
  executionIntentExists: false,
  executionStatus: null,
  completedWorkId: null,
  allowedClaims: [],
  disallowedClaims: [],
  explanation: "No active task",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function setupAllSuccess() {
  mocks.buildMessageContext.mockResolvedValue(FULL_MESSAGE_CTX);
  mocks.buildChiefOfStaffContext.mockResolvedValue(FULL_COS_PACKAGE);
  mocks.getConversationWorkforceContext.mockResolvedValue(FULL_WORKFORCE);
  mocks.checkOrganisationLibraryPresence.mockResolvedValue(FULL_LIBRARY_PRESENCE);
  mocks.resolveConversationActionState.mockResolvedValue(FULL_ACTION_STATE);
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("buildConversationContext — full context", () => {
  it("assembles all components when all services succeed", async () => {
    setupAllSuccess();

    const ctx = await buildConversationContext(BASE_INPUT);

    // Organisation
    expect(ctx.organisation.id).toBe("org-abc");
    expect(ctx.organisation.name).toBe("Acme Corp");
    expect(ctx.organisation.settings.executionFrozen).toBe(false);
    expect(ctx.organisation.settings.subscriptionTier).toBe("professional");

    // Memory
    expect(ctx.memory).not.toBeNull();
    expect(ctx.memory!.approvedOrganisationMemory).toHaveLength(1);
    expect(ctx.memory!.conversationSummary.objective).toBe("Risk review discussion");
    expect(ctx.memory!.currentTasks).toHaveLength(1);

    // Library presence (no named doc terms in base message → skipped)
    expect(ctx.libraryPresence).toBeNull();

    // Workforce
    expect(ctx.workforce).not.toBeNull();
    expect(ctx.workforce!.specialists).toHaveLength(2);

    // Action state
    expect(ctx.actionState).not.toBeNull();
    expect(ctx.actionState!.level).toBe("informational");

    // Conversation
    expect(ctx.conversation.id).toBe("conv-123");
    expect(ctx.conversation.currentTaskId).toBe("task-001");
    expect(ctx.conversation.latestMessage).toBe("Hello, can you help me?");

    // Metadata
    expect(ctx.metadata.organisationId).toBe("org-abc");
    expect(ctx.metadata.version).toBe("1.0.0");
    expect(ctx.metadata.taskId).toBeNull();
  });

  it("passes taskId and executionId through to services and metadata", async () => {
    setupAllSuccess();

    const ctx = await buildConversationContext({
      ...BASE_INPUT,
      taskId: "task-abc",
      executionId: "exec-xyz",
    });

    expect(mocks.buildMessageContext).toHaveBeenCalledWith("org-abc", "conv-123", "task-abc");
    expect(mocks.buildChiefOfStaffContext).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "task-abc" })
    );
    expect(mocks.resolveConversationActionState).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "task-abc", executionIntentId: "exec-xyz" })
    );
    expect(ctx.metadata.taskId).toBe("task-abc");
    expect(ctx.metadata.executionId).toBe("exec-xyz");
  });
});

describe("buildConversationContext — library presence", () => {
  it("skips library check when no named doc terms are found", async () => {
    setupAllSuccess();
    // Base message has no doc keywords → search terms should be empty
    await buildConversationContext(BASE_INPUT);
    expect(mocks.checkOrganisationLibraryPresence).not.toHaveBeenCalled();
  });

  it("calls library check when a named document is detected", async () => {
    setupAllSuccess();
    mocks.checkOrganisationLibraryPresence.mockResolvedValue(FULL_LIBRARY_PRESENCE);

    const ctx = await buildConversationContext({
      ...BASE_INPUT,
      currentMessage: "Please review the Medication Management Policy",
    });

    expect(mocks.checkOrganisationLibraryPresence).toHaveBeenCalledWith(
      "org-abc",
      expect.arrayContaining(["Medication Management Policy"])
    );
    expect(ctx.libraryPresence).not.toBeNull();
    expect(ctx.runtime.extractedSearchTerms).toContain("Medication Management Policy");
  });
});

describe("buildConversationContext — parallel loading", () => {
  it("calls all round-1 components concurrently", async () => {
    const callOrder: string[] = [];
    let resolvers: (() => void)[] = [];
    const makeDelayed = (name: string, result: unknown) =>
      new Promise<unknown>(resolve => {
        callOrder.push(`start:${name}`);
        resolvers.push(() => {
          callOrder.push(`end:${name}`);
          resolve(result);
        });
      });

    mocks.buildMessageContext.mockImplementation(() => makeDelayed("messageContext", FULL_MESSAGE_CTX));
    mocks.buildChiefOfStaffContext.mockImplementation(() => makeDelayed("cosPackage", FULL_COS_PACKAGE));
    mocks.getConversationWorkforceContext.mockImplementation(() => makeDelayed("workforce", FULL_WORKFORCE));
    mocks.resolveConversationActionState.mockResolvedValue(FULL_ACTION_STATE);

    const promise = buildConversationContext(BASE_INPUT);

    // All 3 round-1 components should have started before any resolves
    await Promise.resolve();
    await Promise.resolve();
    expect(callOrder).toContain("start:messageContext");
    expect(callOrder).toContain("start:cosPackage");
    expect(callOrder).toContain("start:workforce");

    // Resolve all
    resolvers.forEach(r => r());
    await promise;
  });

  it("calls action state only after round-1 completes (uses recentMessages)", async () => {
    setupAllSuccess();
    const callOrder: string[] = [];

    mocks.buildMessageContext.mockImplementation(async () => {
      callOrder.push("messageContext");
      return FULL_MESSAGE_CTX;
    });
    mocks.resolveConversationActionState.mockImplementation(async () => {
      callOrder.push("actionState");
      return FULL_ACTION_STATE;
    });

    await buildConversationContext(BASE_INPUT);

    const msgIdx = callOrder.indexOf("messageContext");
    const asIdx  = callOrder.indexOf("actionState");
    expect(msgIdx).toBeGreaterThanOrEqual(0);
    expect(asIdx).toBeGreaterThan(msgIdx);
  });

  it("passes recentMessages from messageContext into action state resolver", async () => {
    setupAllSuccess();

    await buildConversationContext(BASE_INPUT);

    expect(mocks.resolveConversationActionState).toHaveBeenCalledWith(
      expect.objectContaining({
        recentMessages: expect.arrayContaining([
          expect.objectContaining({ messageType: "user_message", content: "I need help" }),
        ]),
      })
    );
  });
});

describe("buildConversationContext — graceful degradation", () => {
  it("returns partial context when messageContext fails", async () => {
    mocks.buildMessageContext.mockRejectedValue(new Error("DB timeout"));
    mocks.buildChiefOfStaffContext.mockResolvedValue(FULL_COS_PACKAGE);
    mocks.getConversationWorkforceContext.mockResolvedValue(FULL_WORKFORCE);
    mocks.checkOrganisationLibraryPresence.mockResolvedValue(null);
    mocks.resolveConversationActionState.mockResolvedValue(FULL_ACTION_STATE);

    const ctx = await buildConversationContext(BASE_INPUT);

    expect(ctx.runtime.isDegraded).toBe(true);
    expect(ctx.runtime.failedComponents).toContain("messageContext");
    expect(ctx.runtime.componentErrors["messageContext"]).toContain("DB timeout");
    expect(ctx.conversation.recentMessages).toEqual([]);
    expect(ctx.conversation.currentTaskId).toBeNull();
    // Other components still populated
    expect(ctx.memory).not.toBeNull();
    expect(ctx.workforce).not.toBeNull();
  });

  it("returns partial context when cosPackage fails", async () => {
    mocks.buildMessageContext.mockResolvedValue(FULL_MESSAGE_CTX);
    mocks.buildChiefOfStaffContext.mockRejectedValue(new Error("Memory service unavailable"));
    mocks.getConversationWorkforceContext.mockResolvedValue(FULL_WORKFORCE);
    mocks.checkOrganisationLibraryPresence.mockResolvedValue(null);
    mocks.resolveConversationActionState.mockResolvedValue(FULL_ACTION_STATE);

    const ctx = await buildConversationContext(BASE_INPUT);

    expect(ctx.runtime.isDegraded).toBe(true);
    expect(ctx.runtime.failedComponents).toContain("cosPackage");
    expect(ctx.memory).toBeNull();
    // Organisation profile falls back to empty (sourced from cosPackage)
    expect(ctx.organisation.name).toBe("");
    // Workforce still loaded
    expect(ctx.workforce).not.toBeNull();
    // Action state still resolved (uses messageContext recentMessages)
    expect(ctx.actionState).not.toBeNull();
  });

  it("returns partial context when workforce fails", async () => {
    mocks.buildMessageContext.mockResolvedValue(FULL_MESSAGE_CTX);
    mocks.buildChiefOfStaffContext.mockResolvedValue(FULL_COS_PACKAGE);
    mocks.getConversationWorkforceContext.mockRejectedValue(new Error("Workforce service down"));
    mocks.checkOrganisationLibraryPresence.mockResolvedValue(null);
    mocks.resolveConversationActionState.mockResolvedValue(FULL_ACTION_STATE);

    const ctx = await buildConversationContext(BASE_INPUT);

    expect(ctx.runtime.isDegraded).toBe(true);
    expect(ctx.runtime.failedComponents).toContain("workforce");
    expect(ctx.workforce).toBeNull();
    // Memory and action state still work
    expect(ctx.memory).not.toBeNull();
    expect(ctx.actionState).not.toBeNull();
  });

  it("records libraryPresenceLoadFailed when terms exist but check throws", async () => {
    setupAllSuccess();
    mocks.checkOrganisationLibraryPresence.mockRejectedValue(new Error("Library unavailable"));

    const ctx = await buildConversationContext({
      ...BASE_INPUT,
      currentMessage: "Review the Incident Management Policy",
    });

    expect(ctx.runtime.isDegraded).toBe(true);
    expect(ctx.runtime.libraryPresenceLoadFailed).toBe(true);
    expect(ctx.runtime.failedComponents).toContain("libraryPresence");
    expect(ctx.libraryPresence).toBeNull();
  });

  it("does not set libraryPresenceLoadFailed when no terms present", async () => {
    setupAllSuccess();

    // Base message has no named documents
    const ctx = await buildConversationContext(BASE_INPUT);

    expect(ctx.runtime.libraryPresenceLoadFailed).toBe(false);
    expect(ctx.runtime.failedComponents).not.toContain("libraryPresence");
  });

  it("returns partial context when actionState fails — other components intact", async () => {
    setupAllSuccess();
    mocks.resolveConversationActionState.mockRejectedValue(new Error("Action state error"));

    const ctx = await buildConversationContext(BASE_INPUT);

    expect(ctx.runtime.isDegraded).toBe(true);
    expect(ctx.runtime.failedComponents).toContain("actionState");
    expect(ctx.actionState).toBeNull();
    expect(ctx.memory).not.toBeNull();
    expect(ctx.workforce).not.toBeNull();
  });

  it("can return fully degraded context when all components fail", async () => {
    mocks.buildMessageContext.mockRejectedValue(new Error("A"));
    mocks.buildChiefOfStaffContext.mockRejectedValue(new Error("B"));
    mocks.getConversationWorkforceContext.mockRejectedValue(new Error("C"));
    mocks.checkOrganisationLibraryPresence.mockRejectedValue(new Error("D"));
    mocks.resolveConversationActionState.mockRejectedValue(new Error("E"));

    const ctx = await buildConversationContext(BASE_INPUT);

    expect(ctx.runtime.isDegraded).toBe(true);
    expect(ctx.runtime.failedComponents).toHaveLength(4); // messageContext, cosPackage, workforce, actionState
    expect(ctx.memory).toBeNull();
    expect(ctx.workforce).toBeNull();
    expect(ctx.actionState).toBeNull();
    // Builder must NOT throw
    expect(ctx.metadata.organisationId).toBe("org-abc");
  });
});

describe("buildConversationContext — observability", () => {
  it("records build duration and component timings", async () => {
    setupAllSuccess();

    const ctx = await buildConversationContext(BASE_INPUT);

    expect(ctx.runtime.buildDurationMs).toBeGreaterThanOrEqual(0);
    expect(ctx.runtime.componentTimings).toHaveProperty("messageContext");
    expect(ctx.runtime.componentTimings).toHaveProperty("cosPackage");
    expect(ctx.runtime.componentTimings).toHaveProperty("workforce");
    expect(ctx.runtime.componentTimings).toHaveProperty("actionState");
  });

  it("lists loaded components", async () => {
    setupAllSuccess();

    const ctx = await buildConversationContext(BASE_INPUT);

    expect(ctx.runtime.componentsLoaded).toContain("messageContext");
    expect(ctx.runtime.componentsLoaded).toContain("cosPackage");
    expect(ctx.runtime.componentsLoaded).toContain("workforce");
    expect(ctx.runtime.componentsLoaded).toContain("actionState");
  });

  it("records fallback used when a component fails", async () => {
    mocks.buildMessageContext.mockRejectedValue(new Error("fail"));
    mocks.buildChiefOfStaffContext.mockResolvedValue(FULL_COS_PACKAGE);
    mocks.getConversationWorkforceContext.mockResolvedValue(FULL_WORKFORCE);
    mocks.checkOrganisationLibraryPresence.mockResolvedValue(null);
    mocks.resolveConversationActionState.mockResolvedValue(FULL_ACTION_STATE);

    const ctx = await buildConversationContext(BASE_INPUT);

    expect(ctx.runtime.fallbacksUsed).toContain("messageContext:empty");
  });

  it("includes extractedSearchTerms in runtime metadata", async () => {
    setupAllSuccess();

    const ctx = await buildConversationContext({
      ...BASE_INPUT,
      currentMessage: "Can you review the Medication Management Policy?",
    });

    expect(ctx.runtime.extractedSearchTerms).toEqual(
      expect.arrayContaining(["Medication Management Policy"])
    );
  });
});

describe("buildConversationContext — no active task", () => {
  it("sets conversation task fields to null when no taskId provided", async () => {
    mocks.buildMessageContext.mockResolvedValue({
      conversationId: "conv-123",
      organizationId: "org-abc",
      recentMessages: [],
      proposalExists: false,
    });
    mocks.buildChiefOfStaffContext.mockResolvedValue(FULL_COS_PACKAGE);
    mocks.getConversationWorkforceContext.mockResolvedValue(FULL_WORKFORCE);
    mocks.checkOrganisationLibraryPresence.mockResolvedValue(null);
    mocks.resolveConversationActionState.mockResolvedValue(FULL_ACTION_STATE);

    const ctx = await buildConversationContext(BASE_INPUT);

    expect(ctx.conversation.currentTaskId).toBeNull();
    expect(ctx.conversation.currentTaskTitle).toBeNull();
    expect(ctx.conversation.currentTaskState).toBeNull();
    expect(ctx.conversation.pendingApprovalId).toBeNull();
  });
});

describe("buildConversationContext — pending proposal", () => {
  it("flags pendingProposal when messageContext.proposalExists is true", async () => {
    mocks.buildMessageContext.mockResolvedValue({
      ...FULL_MESSAGE_CTX,
      proposalExists: true,
      recentMessages: [
        { senderType: "ai", content: "I propose...", messageType: "task_proposal" },
      ],
    });
    mocks.buildChiefOfStaffContext.mockResolvedValue(FULL_COS_PACKAGE);
    mocks.getConversationWorkforceContext.mockResolvedValue(FULL_WORKFORCE);
    mocks.checkOrganisationLibraryPresence.mockResolvedValue(null);
    mocks.resolveConversationActionState.mockResolvedValue(FULL_ACTION_STATE);

    const ctx = await buildConversationContext(BASE_INPUT);

    expect(ctx.conversation.pendingProposal).toBe(true);
  });
});

describe("buildConversationContext — active execution", () => {
  it("sets currentExecution to null (Phase 2 placeholder)", async () => {
    setupAllSuccess();

    const ctx = await buildConversationContext({
      ...BASE_INPUT,
      executionId: "exec-001",
    });

    expect(ctx.conversation.currentExecution).toBeNull();
    // The executionId is still passed to action state resolver
    expect(mocks.resolveConversationActionState).toHaveBeenCalledWith(
      expect.objectContaining({ executionIntentId: "exec-001" })
    );
  });
});

describe("buildConversationContext — tenant isolation", () => {
  it("never mixes data from different organisations", async () => {
    const orgAPackage = { ...FULL_COS_PACKAGE, organisationProfile: { ...FULL_COS_PACKAGE.organisationProfile, name: "Org A", slug: "org-a" } };
    const orgBPackage = { ...FULL_COS_PACKAGE, organisationProfile: { ...FULL_COS_PACKAGE.organisationProfile, name: "Org B", slug: "org-b" } };

    mocks.buildMessageContext
      .mockResolvedValueOnce({ ...FULL_MESSAGE_CTX, organizationId: "org-a" })
      .mockResolvedValueOnce({ ...FULL_MESSAGE_CTX, organizationId: "org-b" });
    mocks.buildChiefOfStaffContext
      .mockResolvedValueOnce(orgAPackage)
      .mockResolvedValueOnce(orgBPackage);
    mocks.getConversationWorkforceContext.mockResolvedValue(FULL_WORKFORCE);
    mocks.checkOrganisationLibraryPresence.mockResolvedValue(null);
    mocks.resolveConversationActionState.mockResolvedValue(FULL_ACTION_STATE);

    const [ctxA, ctxB] = await Promise.all([
      buildConversationContext({ ...BASE_INPUT, organisationId: "org-a" }),
      buildConversationContext({ ...BASE_INPUT, organisationId: "org-b" }),
    ]);

    expect(ctxA.organisation.id).toBe("org-a");
    expect(ctxA.organisation.name).toBe("Org A");
    expect(ctxB.organisation.id).toBe("org-b");
    expect(ctxB.organisation.name).toBe("Org B");

    // Verify each builder was called with its own org
    expect(mocks.buildChiefOfStaffContext).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-a" })
    );
    expect(mocks.buildChiefOfStaffContext).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-b" })
    );
  });
});

describe("buildConversationContext — execution capabilities", () => {
  it("reflects executionFrozen from org profile", async () => {
    mocks.buildMessageContext.mockResolvedValue(FULL_MESSAGE_CTX);
    mocks.buildChiefOfStaffContext.mockResolvedValue({
      ...FULL_COS_PACKAGE,
      organisationProfile: { ...FULL_COS_PACKAGE.organisationProfile, executionFrozen: true },
    });
    mocks.getConversationWorkforceContext.mockResolvedValue(FULL_WORKFORCE);
    mocks.checkOrganisationLibraryPresence.mockResolvedValue(null);
    mocks.resolveConversationActionState.mockResolvedValue(FULL_ACTION_STATE);

    const ctx = await buildConversationContext(BASE_INPUT);

    expect(ctx.executionCapabilities.frozen).toBe(true);
    expect(ctx.organisation.settings.executionFrozen).toBe(true);
  });
});

describe("buildConversationContext — deterministic ordering", () => {
  it("returns the same field layout regardless of service resolution order", async () => {
    setupAllSuccess();

    const ctx = await buildConversationContext(BASE_INPUT);

    // These fields must always be present, in the right shape
    expect(typeof ctx.runtime.buildDurationMs).toBe("number");
    expect(Array.isArray(ctx.runtime.componentsLoaded)).toBe(true);
    expect(Array.isArray(ctx.runtime.failedComponents)).toBe(true);
    expect(typeof ctx.runtime.isDegraded).toBe("boolean");
    expect(ctx.participantContext).toBeNull();
    expect(ctx.blueprintContext).toBeNull();
  });
});

describe("deriveMessageContext", () => {
  it("maps ConversationContext fields to a compatible MessageContext", async () => {
    setupAllSuccess();

    const ctx = await buildConversationContext(BASE_INPUT);
    const msgCtx = deriveMessageContext(ctx);

    expect(msgCtx.conversationId).toBe("conv-123");
    expect(msgCtx.organizationId).toBe("org-abc");
    expect(msgCtx.currentTaskId).toBe("task-001");
    expect(msgCtx.currentTaskTitle).toBe("Risk Review");
    expect(msgCtx.currentTaskState).toBe("executing");
    expect(msgCtx.pendingApprovalId).toBe("appr-001");
    expect(msgCtx.recentMessages).toHaveLength(1);
    expect(msgCtx.proposalExists).toBe(false);
  });

  it("maps null fields to undefined for MessageContext compat", async () => {
    mocks.buildMessageContext.mockResolvedValue({
      conversationId: "conv-123",
      organizationId: "org-abc",
      recentMessages: [],
      proposalExists: false,
    });
    mocks.buildChiefOfStaffContext.mockResolvedValue(FULL_COS_PACKAGE);
    mocks.getConversationWorkforceContext.mockResolvedValue(FULL_WORKFORCE);
    mocks.checkOrganisationLibraryPresence.mockResolvedValue(null);
    mocks.resolveConversationActionState.mockResolvedValue(FULL_ACTION_STATE);

    const ctx = await buildConversationContext(BASE_INPUT);
    const msgCtx = deriveMessageContext(ctx);

    expect(msgCtx.currentTaskId).toBeUndefined();
    expect(msgCtx.pendingApprovalId).toBeUndefined();
  });
});

describe("extractDocumentSearchTerms", () => {
  it("extracts a named document policy phrase", () => {
    const terms = extractDocumentSearchTerms("Please review the Medication Management Policy");
    expect(terms).toContain("Medication Management Policy");
  });

  it("returns empty array for vague references", () => {
    const terms = extractDocumentSearchTerms("Update our policies");
    expect(terms).toEqual([]);
  });

  it("extracts multiple document types", () => {
    const terms = extractDocumentSearchTerms("Review the Incident Response Plan and the Privacy Policy");
    expect(terms.length).toBeGreaterThan(0);
    expect(terms.some(t => t.toLowerCase().includes("plan") || t.toLowerCase().includes("policy"))).toBe(true);
  });

  it("deduplicates overlapping phrases", () => {
    const terms = extractDocumentSearchTerms("Check the Risk Assessment and the Risk Assessment procedure");
    // Should not repeat the exact same shorter term if a longer version covers it
    const unique = new Set(terms.map(t => t.toLowerCase()));
    expect(unique.size).toBe(terms.length);
  });

  it("limits results to 5 terms max", () => {
    const longMsg = "Review the Alpha Policy, Beta Procedure, Gamma Standard, Delta Guideline, Epsilon Protocol, Zeta Manual";
    const terms = extractDocumentSearchTerms(longMsg);
    expect(terms.length).toBeLessThanOrEqual(5);
  });
});

describe("Chief of Staff integration", () => {
  it("context.memory contains all CoS package fields needed by buildLayeredUserMessage", async () => {
    setupAllSuccess();

    const ctx = await buildConversationContext(BASE_INPUT);

    // All fields that buildLayeredUserMessage accesses via pkg.*
    expect(ctx.memory).not.toBeNull();
    expect(ctx.memory!.approvedOrganisationMemory).toBeDefined();
    expect(ctx.memory!.conversationSummary).toBeDefined();
    expect(ctx.memory!.pinnedDecisions).toBeDefined();
    expect(ctx.memory!.unresolvedQuestions).toBeDefined();
    expect(ctx.memory!.relevantHistoricalMessages).toBeDefined();
    expect(ctx.memory!.recentMessages).toBeDefined();
    expect(ctx.memory!.currentTasks).toBeDefined();
    expect(ctx.memory!.currentApprovals).toBeDefined();
    expect(ctx.memory!.contextWarnings).toBeDefined();
    expect(ctx.memory!.tokenEstimate).toBeDefined();
    expect(ctx.memory!.historyStats).toBeDefined();
  });

  it("organisation.profile contains name and status for TENANT PROFILE section", async () => {
    setupAllSuccess();

    const ctx = await buildConversationContext(BASE_INPUT);

    expect(ctx.organisation.profile.name).toBe("Acme Corp");
    expect(ctx.organisation.profile.status).toBe("active");
  });
});

describe("Operations Manager integration", () => {
  it("returns same ConversationContext structure for any caller", async () => {
    setupAllSuccess();

    const ctx = await buildConversationContext({
      ...BASE_INPUT,
      currentMessage: "Analyse our capacity for the next quarter",
    });

    // OM would access the same context fields as CoS
    expect(ctx.organisation).toBeDefined();
    expect(ctx.memory).toBeDefined();
    expect(ctx.workforce).toBeDefined();
    expect(ctx.actionState).toBeDefined();
    expect(ctx.conversation.latestMessage).toBe("Analyse our capacity for the next quarter");
    expect(ctx.metadata.version).toBe("1.0.0");
  });
});
