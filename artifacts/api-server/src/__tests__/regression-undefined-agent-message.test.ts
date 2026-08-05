/**
 * Regression test — "Cannot read properties of undefined (reading 'id')"
 *
 * Root cause (Sprint 27.2):
 *   conversationService.addMessage used `return msg!` after a Drizzle
 *   INSERT RETURNING.  TypeScript's `!` is compile-time only; at runtime,
 *   when a PostgreSQL RLS WITH CHECK policy silently drops an INSERT,
 *   RETURNING yields [], `msg` is `undefined`, and `msg!` returns `undefined`.
 *
 * Crash chain:
 *   addMessage → returns undefined
 *   processUserMessage → { agentMessage: undefined }
 *   messageIngressService → { type: "normal", result: { agentMessage: undefined } }
 *   route → sendEvent({ type:"agent_message", message: undefined })
 *   JSON.stringify omits the key → client receives evt.message === undefined
 *   Sprint 27.2 idempotent handler:
 *     const msg = evt.message as Message   // undefined
 *     msg.id                               // TypeError: Cannot read properties of undefined
 *
 * Fix:
 *   addMessage now throws explicitly when RETURNING yields no row,
 *   surfacing the error as a proper { type:"error" } SSE event instead of
 *   an undefined value that silently propagates to the frontend.
 *   Routes also coerce agentMessage to null (not undefined) before sending.
 *   Frontend idempotent handlers guard against null/undefined message.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock DB ─────────────────────────────────────────────────────────────────

const mockInsertChain = {
  values: vi.fn().mockReturnThis(),
  returning: vi.fn(),
};
const mockInsert = vi.fn().mockReturnValue(mockInsertChain);

const mockUpdateChain = {
  set: vi.fn().mockReturnThis(),
  where: vi.fn().mockResolvedValue(undefined),
};
const mockUpdate = vi.fn().mockReturnValue(mockUpdateChain);

vi.mock("@workspace/db", async () => {
  const randomUUID = (await import("crypto")).randomUUID;
  return {
    db: {
      insert: (...a: unknown[]) => mockInsert(...a),
      update: (...a: unknown[]) => mockUpdate(...a),
    },
    conversationMessagesTable: { id: "id" },
    conversationsTable: { id: "id" },
  };
});

vi.mock("drizzle-orm", () => ({
  eq: (a: unknown, b: unknown) => ({ op: "eq", a, b }),
  and: (...args: unknown[]) => ({ op: "and", args }),
  desc: (a: unknown) => ({ op: "desc", a }),
  inArray: (a: unknown, b: unknown) => ({ op: "inArray", a, b }),
  lt: (a: unknown, b: unknown) => ({ op: "lt", a, b }),
  or: (...args: unknown[]) => ({ op: "or", args }),
}));

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("addMessage — root cause regression", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInsert.mockReturnValue(mockInsertChain);
    mockInsertChain.values.mockReturnThis();
    mockUpdate.mockReturnValue(mockUpdateChain);
    mockUpdateChain.set.mockReturnThis();
    mockUpdateChain.where.mockResolvedValue(undefined);
  });

  it("REGRESSION: throws when INSERT RETURNING yields no rows (was: silently returned undefined)", async () => {
    // Simulate an RLS WITH CHECK violation — DB returns [] from RETURNING
    mockInsertChain.returning.mockResolvedValue([]);

    const { addMessage } = await import("../services/conversationService.js");

    await expect(
      addMessage({
        organizationId: "org-1",
        conversationId: "conv-1",
        senderType: "chief_of_staff",
        messageType: "text",
        content: "Hello",
      }),
    ).rejects.toThrow("INSERT RETURNING yielded no row");
  });

  it("throws with a message that names the conversation for diagnosing RLS issues", async () => {
    mockInsertChain.returning.mockResolvedValue([]);

    const { addMessage } = await import("../services/conversationService.js");

    await expect(
      addMessage({
        organizationId: "org-1",
        conversationId: "conv-abc-123",
        senderType: "user",
        messageType: "text",
        content: "test",
      }),
    ).rejects.toThrow("conv-abc-123");
  });

  it("returns the message when INSERT RETURNING yields exactly one row", async () => {
    const row = {
      id: "msg-1",
      organizationId: "org-1",
      conversationId: "conv-1",
      senderType: "user",
      content: "Hello",
      createdAt: new Date(),
    };
    mockInsertChain.returning.mockResolvedValue([row]);

    const { addMessage } = await import("../services/conversationService.js");

    const result = await addMessage({
      organizationId: "org-1",
      conversationId: "conv-1",
      senderType: "user",
      messageType: "text",
      content: "Hello",
    });

    expect(result).toBe(row);
    expect(result.id).toBe("msg-1");
  });

  it("the returned message always has a defined id — the field accessed by the idempotent SSE handler", async () => {
    const row = { id: "msg-uuid", conversationId: "conv-1", content: "Hi" };
    mockInsertChain.returning.mockResolvedValue([row]);

    const { addMessage } = await import("../services/conversationService.js");

    const msg = await addMessage({
      organizationId: "org-1",
      conversationId: "conv-1",
      senderType: "chief_of_staff",
      messageType: "text",
      content: "Hi",
    });

    // The Sprint 27.2 idempotent SSE handler accesses msg.id — this must never be undefined
    expect(msg.id).toBeDefined();
    expect(typeof msg.id).toBe("string");
  });
});

describe("Frontend idempotent handler contract — guard against null/undefined message", () => {
  /**
   * These tests document the required behaviour of the agent_message SSE handler
   * in TaskWorkroomPage and WorkforceChatPage.  They do not render React; they
   * validate the guard logic extracted from the handler.
   */

  // Extracted handler logic (reflects the fixed frontend code)
  function idempotentAppend(
    prev: Array<{ id: string }>,
    evtMessage: unknown,
  ): Array<{ id: string }> {
    const msg = evtMessage as { id: string } | null | undefined;
    // Guard: server may send agent_message with null/undefined in edge cases
    if (!msg) return prev;
    if (prev.some(m => m.id === msg.id)) return prev;
    return [...prev, msg];
  }

  it("REGRESSION: does not throw when evt.message is undefined", () => {
    // Before fix: `(undefined as Message).id` crashed immediately
    expect(() => idempotentAppend([], undefined)).not.toThrow();
  });

  it("does not throw when evt.message is null", () => {
    expect(() => idempotentAppend([], null)).not.toThrow();
  });

  it("returns prev unchanged when evt.message is undefined", () => {
    const prev = [{ id: "existing-1" }];
    expect(idempotentAppend(prev, undefined)).toBe(prev);
  });

  it("appends when message is valid and not already in prev", () => {
    const prev = [{ id: "a" }];
    const msg = { id: "b" };
    expect(idempotentAppend(prev, msg)).toEqual([{ id: "a" }, { id: "b" }]);
  });

  it("skips duplicate — idempotent append still works after the guard", () => {
    const msg = { id: "a" };
    const prev = [msg];
    expect(idempotentAppend(prev, msg)).toBe(prev); // same reference, no duplicate
  });
});
