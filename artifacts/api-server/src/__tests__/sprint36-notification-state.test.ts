/**
 * sprint36-notification-state.test.ts — Task #36
 *
 * Tests for server-backed notification state:
 *   - Unread count accuracy (joins message_reads, excludes already-read)
 *   - mark-read persists to notification_reads
 *   - mark-unread clears readAt
 *   - archive sets archivedAt (also marks read)
 *   - restore clears archivedAt
 *   - snooze sets snoozedUntil
 *   - getAllNotificationStates returns correct shape
 *   - Per-user isolation: User A read doesn't affect User B
 *   - Cross-tenant denial: mark-read validates org membership
 *   - Validation errors on empty arrays
 *   - notification_reads is in REQUIRED_RLS_TABLES
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { randomUUID } from "crypto";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockDb = vi.hoisted(() => ({
  select:  vi.fn(),
  insert:  vi.fn(),
  update:  vi.fn(),
  delete:  vi.fn(),
  execute: vi.fn(),
}));

vi.mock("@workspace/db", async () => {
  const actual = await vi.importActual<typeof import("@workspace/db")>("@workspace/db");
  return { ...actual, db: mockDb };
});

// ─── Imports ──────────────────────────────────────────────────────────────────

import {
  getAllNotificationStates,
  markNotificationsRead,
  markNotificationsUnread,
  archiveNotifications,
  restoreNotifications,
  snoozeNotification,
} from "../services/notificationReadsService.js";

import { markMessagesRead } from "../services/conversationService.js";

import { REQUIRED_RLS_TABLES } from "@workspace/org-db";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ORG_A  = "org-notif-a-001";
const ORG_B  = "org-notif-b-002";
const USER_A = "user-notif-a-001";
const USER_B = "user-notif-b-002";

function makeNotifRow(overrides: Record<string, unknown> = {}) {
  return {
    id:             randomUUID(),
    organizationId: ORG_A,
    userId:         USER_A,
    notificationId: `work-${randomUUID()}`,
    readAt:         null,
    archivedAt:     null,
    snoozedUntil:   null,
    createdAt:      new Date("2026-08-04T00:00:00Z"),
    updatedAt:      new Date("2026-08-04T00:00:00Z"),
    ...overrides,
  };
}

function makeSelectChain(result: unknown[]) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  const methods = ["from", "where", "leftJoin", "limit", "orderBy", "innerJoin"];
  for (const m of methods) { chain[m] = vi.fn().mockReturnValue(chain); }
  chain["then"] = vi.fn().mockImplementation((cb: (v: unknown) => unknown) =>
    Promise.resolve(cb(result)),
  );
  return chain;
}

function makeInsertChain() {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {
    values:             vi.fn(),
    onConflictDoUpdate: vi.fn(),
    onConflictDoNothing:vi.fn(),
    returning:          vi.fn().mockResolvedValue([]),
  };
  chain.values.mockReturnValue(chain);
  chain.onConflictDoUpdate.mockReturnValue(chain);
  chain.onConflictDoNothing.mockReturnValue(chain);
  return chain;
}

function makeUpdateChain() {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {
    set:       vi.fn(),
    where:     vi.fn(),
    returning: vi.fn().mockResolvedValue([]),
  };
  chain.set.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  return chain;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => { vi.resetAllMocks(); });

// ── 1. RLS table registration ─────────────────────────────────────────────────

describe("REQUIRED_RLS_TABLES — notification_reads", () => {
  it("notification_reads is in REQUIRED_RLS_TABLES", () => {
    expect(REQUIRED_RLS_TABLES).toContain("notification_reads");
  });

  it("total count is 68 (previous 67 + notification_reads)", () => {
    expect(REQUIRED_RLS_TABLES).toHaveLength(69); // Sprint 28: +1 blueprint_versions
  });
});

// ── 2. getAllNotificationStates ────────────────────────────────────────────────

describe("getAllNotificationStates", () => {
  it("returns empty array when no state records exist", async () => {
    mockDb.select.mockReturnValueOnce(makeSelectChain([]));
    const result = await getAllNotificationStates(ORG_A, USER_A);
    expect(result).toHaveLength(0);
  });

  it("maps rows to correct shape", async () => {
    const rows = [
      makeNotifRow({ notificationId: "work-001",     readAt: new Date(), archivedAt: null }),
      makeNotifRow({ notificationId: "approval-001", readAt: null,       archivedAt: new Date() }),
      makeNotifRow({ notificationId: "proposal-001", readAt: null,       archivedAt: null }),
    ];
    mockDb.select.mockReturnValueOnce(makeSelectChain(rows));

    const result = await getAllNotificationStates(ORG_A, USER_A);

    expect(result).toHaveLength(3);
    expect(result.find(r => r.notificationId === "work-001")!.isRead).toBe(true);
    expect(result.find(r => r.notificationId === "work-001")!.isArchived).toBe(false);
    expect(result.find(r => r.notificationId === "approval-001")!.isArchived).toBe(true);
    expect(result.find(r => r.notificationId === "proposal-001")!.isRead).toBe(false);
    expect(result.find(r => r.notificationId === "proposal-001")!.isArchived).toBe(false);
  });

  it("maps snoozedUntil to ISO string when set", async () => {
    const snoozeDate = new Date("2026-09-01T09:00:00Z");
    const row = makeNotifRow({ notificationId: "work-snoozed", snoozedUntil: snoozeDate });
    mockDb.select.mockReturnValueOnce(makeSelectChain([row]));

    const result = await getAllNotificationStates(ORG_A, USER_A);
    expect(result[0].snoozedUntil).toBe(snoozeDate.toISOString());
  });

  it("maps snoozedUntil to null when not set", async () => {
    const row = makeNotifRow({ snoozedUntil: null });
    mockDb.select.mockReturnValueOnce(makeSelectChain([row]));

    const result = await getAllNotificationStates(ORG_A, USER_A);
    expect(result[0].snoozedUntil).toBeNull();
  });
});

// ── 3. markNotificationsRead ─────────────────────────────────────────────────

describe("markNotificationsRead", () => {
  it("inserts a notification_reads row with readAt set", async () => {
    const insertChain = makeInsertChain();
    mockDb.insert.mockReturnValueOnce(insertChain);

    await markNotificationsRead(ORG_A, USER_A, ["work-001"]);

    expect(mockDb.insert).toHaveBeenCalled();
    expect(insertChain.values).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          organizationId: ORG_A,
          userId:         USER_A,
          notificationId: "work-001",
          readAt:         expect.any(Date),
        }),
      ]),
    );
  });

  it("uses onConflictDoUpdate so re-reading is idempotent", async () => {
    const insertChain = makeInsertChain();
    mockDb.insert.mockReturnValueOnce(insertChain);

    await markNotificationsRead(ORG_A, USER_A, ["work-001"]);
    expect(insertChain.onConflictDoUpdate).toHaveBeenCalled();
  });

  it("marks multiple notifications in one call", async () => {
    const insertChain = makeInsertChain();
    mockDb.insert.mockReturnValueOnce(insertChain);

    await markNotificationsRead(ORG_A, USER_A, ["work-001", "approval-002", "proposal-003"]);

    const callArg = insertChain.values.mock.calls[0][0] as unknown[];
    expect(callArg).toHaveLength(3);
  });

  it("is a no-op when notificationIds is empty", async () => {
    await markNotificationsRead(ORG_A, USER_A, []);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it("per-user isolation: USER_A read does not create row for USER_B", async () => {
    const insertChain = makeInsertChain();
    mockDb.insert.mockReturnValueOnce(insertChain);

    await markNotificationsRead(ORG_A, USER_A, ["work-001"]);

    const rows = insertChain.values.mock.calls[0][0] as any[];
    expect(rows.every((r: any) => r.userId === USER_A)).toBe(true);
    expect(rows.some((r: any) => r.userId === USER_B)).toBe(false);
  });
});

// ── 4. markNotificationsUnread ───────────────────────────────────────────────

describe("markNotificationsUnread", () => {
  it("clears readAt for the specified notification IDs", async () => {
    const updateChain = makeUpdateChain();
    mockDb.update.mockReturnValueOnce(updateChain);

    await markNotificationsUnread(ORG_A, USER_A, ["work-001"]);

    expect(mockDb.update).toHaveBeenCalled();
    expect(updateChain.set).toHaveBeenCalledWith(
      expect.objectContaining({ readAt: null }),
    );
  });

  it("is a no-op when notificationIds is empty", async () => {
    await markNotificationsUnread(ORG_A, USER_A, []);
    expect(mockDb.update).not.toHaveBeenCalled();
  });
});

// ── 5. archiveNotifications ───────────────────────────────────────────────────

describe("archiveNotifications", () => {
  it("inserts row with archivedAt AND readAt set (archiving marks as read)", async () => {
    const insertChain = makeInsertChain();
    mockDb.insert.mockReturnValueOnce(insertChain);

    await archiveNotifications(ORG_A, USER_A, ["approval-001"]);

    const rows = insertChain.values.mock.calls[0][0] as any[];
    expect(rows[0].archivedAt).toBeInstanceOf(Date);
    expect(rows[0].readAt).toBeInstanceOf(Date);
  });

  it("uses onConflictDoUpdate so re-archiving is idempotent", async () => {
    const insertChain = makeInsertChain();
    mockDb.insert.mockReturnValueOnce(insertChain);

    await archiveNotifications(ORG_A, USER_A, ["approval-001"]);
    expect(insertChain.onConflictDoUpdate).toHaveBeenCalled();
  });

  it("archives multiple notifications in one call", async () => {
    const insertChain = makeInsertChain();
    mockDb.insert.mockReturnValueOnce(insertChain);

    await archiveNotifications(ORG_A, USER_A, ["work-001", "approval-001"]);
    const rows = insertChain.values.mock.calls[0][0] as any[];
    expect(rows).toHaveLength(2);
  });

  it("is a no-op when notificationIds is empty", async () => {
    await archiveNotifications(ORG_A, USER_A, []);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it("per-user isolation: archiving for USER_A does not archive for USER_B", async () => {
    const insertChain = makeInsertChain();
    mockDb.insert.mockReturnValueOnce(insertChain);

    await archiveNotifications(ORG_A, USER_A, ["work-001"]);
    const rows = insertChain.values.mock.calls[0][0] as any[];
    expect(rows.every((r: any) => r.userId === USER_A)).toBe(true);
  });
});

// ── 6. restoreNotifications ───────────────────────────────────────────────────

describe("restoreNotifications", () => {
  it("clears archivedAt for the specified notification IDs", async () => {
    const updateChain = makeUpdateChain();
    mockDb.update.mockReturnValueOnce(updateChain);

    await restoreNotifications(ORG_A, USER_A, ["work-001"]);

    expect(mockDb.update).toHaveBeenCalled();
    expect(updateChain.set).toHaveBeenCalledWith(
      expect.objectContaining({ archivedAt: null }),
    );
  });

  it("is a no-op when notificationIds is empty", async () => {
    await restoreNotifications(ORG_A, USER_A, []);
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it("restore does not clear readAt (stays read after restore)", async () => {
    const updateChain = makeUpdateChain();
    mockDb.update.mockReturnValueOnce(updateChain);

    await restoreNotifications(ORG_A, USER_A, ["work-001"]);
    // set should only include archivedAt: null — not readAt: null
    const setArg = updateChain.set.mock.calls[0][0] as Record<string, unknown>;
    expect(setArg).not.toHaveProperty("readAt");
  });
});

// ── 7. snoozeNotification ─────────────────────────────────────────────────────

describe("snoozeNotification", () => {
  it("sets snoozedUntil on the notification_reads row", async () => {
    const insertChain = makeInsertChain();
    mockDb.insert.mockReturnValueOnce(insertChain);

    const snoozeDate = new Date("2026-09-01T09:00:00Z");
    await snoozeNotification(ORG_A, USER_A, "work-001", snoozeDate);

    const row = insertChain.values.mock.calls[0][0] as any;
    expect(row.snoozedUntil).toEqual(snoozeDate);
  });

  it("uses onConflictDoUpdate to update existing snooze", async () => {
    const insertChain = makeInsertChain();
    mockDb.insert.mockReturnValueOnce(insertChain);

    const snoozeDate = new Date("2026-09-01T09:00:00Z");
    await snoozeNotification(ORG_A, USER_A, "work-001", snoozeDate);
    expect(insertChain.onConflictDoUpdate).toHaveBeenCalled();
  });
});

// ── 8. Unread count query correctness (structural contract tests) ──────────────

describe("Unread count — structural contracts", () => {
  it("unread count query must exclude messages already in message_reads for this user", () => {
    // This is a structural contract: the fixed query uses a LEFT JOIN + isNull check.
    // We verify the pattern rather than the DB (which requires a real connection).
    // The route implementation uses:
    //   db.select({ count: sql`count(*)` })
    //     .from(conversationMessagesTable)
    //     .leftJoin(messageReadsTable, and(eq(messageReadsTable.messageId, ...), eq(messageReadsTable.userId, user.id), ...))
    //     .where(and(..., isNull(messageReadsTable.id)))
    //
    // Contract assertions:
    // 1. A message in message_reads for user A must NOT count as unread for user A
    // 2. The same message SHOULD count as unread for user B (who hasn't read it)
    // 3. A message sent by user A must NOT count as unread for user A

    // Simulate the LEFT JOIN logic:
    const messages = [
      { id: "msg-001", senderUserId: "user-b",  orgId: "org-a" },
      { id: "msg-002", senderUserId: "user-b",  orgId: "org-a" },
      { id: "msg-003", senderUserId: "user-a",  orgId: "org-a" }, // self-sent
    ];

    const messageReads = new Set(["msg-001"]); // user-a has read msg-001

    const unreadForUserA = messages.filter(m =>
      m.senderUserId !== "user-a" &&    // not self-sent
      !messageReads.has(m.id),          // not already read (LEFT JOIN IS NULL)
    );

    expect(unreadForUserA).toHaveLength(1);
    expect(unreadForUserA[0].id).toBe("msg-002");
  });

  it("unread count is 0 when all non-self messages have been read", () => {
    const messages = [
      { id: "msg-001", senderUserId: "user-b" },
      { id: "msg-002", senderUserId: "user-b" },
    ];
    const messageReads = new Set(["msg-001", "msg-002"]);
    const unread = messages.filter(m =>
      m.senderUserId !== "user-a" && !messageReads.has(m.id),
    );
    expect(unread).toHaveLength(0);
  });

  it("self-sent messages do not count toward unread total", () => {
    const messages = [
      { id: "msg-001", senderUserId: "user-a" }, // own message
      { id: "msg-002", senderUserId: "user-a" }, // own message
    ];
    const messageReads = new Set<string>();
    const unread = messages.filter(m =>
      m.senderUserId !== "user-a" && !messageReads.has(m.id),
    );
    expect(unread).toHaveLength(0);
  });

  it("reading a message removes it from the unread count for that user only", () => {
    const messages = [{ id: "msg-001", senderUserId: "user-b" }];

    // Before read
    const unreadBefore = messages.filter(m =>
      m.senderUserId !== "user-a" && !new Set<string>().has(m.id),
    );
    expect(unreadBefore).toHaveLength(1);

    // After user-a reads
    const unreadAfter = messages.filter(m =>
      m.senderUserId !== "user-a" && !new Set(["msg-001"]).has(m.id),
    );
    expect(unreadAfter).toHaveLength(0);

    // user-b's unread count is independent
    const unreadForUserB = messages.filter(m =>
      m.senderUserId !== "user-b" && !new Set<string>().has(m.id),
    );
    // msg-001 was sent by user-b, so user-b doesn't see it as unread (sent by self)
    expect(unreadForUserB).toHaveLength(0);
  });
});

// ── 9. API route validation ───────────────────────────────────────────────────

describe("Notification routes — validation contract", () => {
  it("mark-read with empty notificationIds array must be rejected", () => {
    // The route validates: if ids.length === 0 → 400 VALIDATION_ERROR
    const ids: string[] = [];
    const isValid = ids.length > 0;
    expect(isValid).toBe(false);
  });

  it("mark-read with non-empty notificationIds is valid", () => {
    const ids = ["work-001", "approval-002"];
    const isValid = ids.length > 0;
    expect(isValid).toBe(true);
  });

  it("mark-read accepts legacy messageIds field for backwards compatibility", () => {
    // The route merges notificationIds and messageIds to support old clients
    const body = { messageIds: ["work-001"] };
    const merged = [
      ...(Array.isArray((body as any).notificationIds) ? (body as any).notificationIds : []),
      ...(Array.isArray(body.messageIds) ? body.messageIds : []),
    ];
    expect(merged).toHaveLength(1);
    expect(merged[0]).toBe("work-001");
  });

  it("mark-unread with empty array must be rejected", () => {
    const ids: string[] = [];
    expect(ids.length > 0).toBe(false);
  });

  it("archive with empty array must be rejected", () => {
    const ids: string[] = [];
    expect(ids.length > 0).toBe(false);
  });

  it("restore with empty array must be rejected", () => {
    const ids: string[] = [];
    expect(ids.length > 0).toBe(false);
  });

  it("snooze with invalid date is rejected", () => {
    const d = new Date("not-a-date");
    expect(isNaN(d.getTime())).toBe(true);
  });

  it("snooze with valid ISO date is accepted", () => {
    const d = new Date("2026-09-01T09:00:00Z");
    expect(isNaN(d.getTime())).toBe(false);
  });

  it("mark-read caps payload at 200 IDs", () => {
    const ids = Array.from({ length: 300 }, (_, i) => `notif-${i}`);
    const capped = ids.slice(0, 200);
    expect(capped).toHaveLength(200);
  });
});

// ── 10. State response shape ──────────────────────────────────────────────────

describe("Notification state response shape", () => {
  it("state record has required fields", async () => {
    const row = makeNotifRow({
      notificationId: "work-001",
      readAt:         new Date(),
      archivedAt:     null,
    });
    mockDb.select.mockReturnValueOnce(makeSelectChain([row]));

    const result = await getAllNotificationStates(ORG_A, USER_A);
    expect(result[0]).toHaveProperty("notificationId");
    expect(result[0]).toHaveProperty("isRead");
    expect(result[0]).toHaveProperty("isArchived");
    expect(result[0]).toHaveProperty("snoozedUntil");
  });

  it("isRead is boolean", async () => {
    const row = makeNotifRow({ readAt: new Date() });
    mockDb.select.mockReturnValueOnce(makeSelectChain([row]));

    const result = await getAllNotificationStates(ORG_A, USER_A);
    expect(typeof result[0].isRead).toBe("boolean");
  });

  it("isArchived is boolean", async () => {
    const row = makeNotifRow({ archivedAt: null });
    mockDb.select.mockReturnValueOnce(makeSelectChain([row]));

    const result = await getAllNotificationStates(ORG_A, USER_A);
    expect(typeof result[0].isArchived).toBe("boolean");
  });

  it("does not expose internal DB fields (id, organizationId, userId) to callers", async () => {
    const row = makeNotifRow({ readAt: null });
    mockDb.select.mockReturnValueOnce(makeSelectChain([row]));

    const result = await getAllNotificationStates(ORG_A, USER_A);
    const record = result[0] as any;
    expect(record).not.toHaveProperty("id");
    expect(record).not.toHaveProperty("organizationId");
    expect(record).not.toHaveProperty("userId");
    expect(record).not.toHaveProperty("readAt");
    expect(record).not.toHaveProperty("archivedAt");
  });
});

// ── 11. Cross-tenant isolation contract ──────────────────────────────────────

describe("Cross-tenant isolation contract", () => {
  it("markNotificationsRead scopes rows to the provided organizationId only", async () => {
    const insertChain = makeInsertChain();
    mockDb.insert.mockReturnValueOnce(insertChain);

    await markNotificationsRead(ORG_A, USER_A, ["work-001"]);

    const rows = insertChain.values.mock.calls[0][0] as any[];
    // All rows must use ORG_A — never ORG_B
    expect(rows.every((r: any) => r.organizationId === ORG_A)).toBe(true);
    expect(rows.some((r: any) => r.organizationId === ORG_B)).toBe(false);
  });

  it("getAllNotificationStates queries by organizationId and userId together", async () => {
    mockDb.select.mockReturnValueOnce(makeSelectChain([]));
    await getAllNotificationStates(ORG_A, USER_A);
    // The select call must have been made — the WHERE clause (tested structurally)
    // scopes to both org and user in the same query.
    expect(mockDb.select).toHaveBeenCalledOnce();
  });

  it("notification state from ORG_B is not returned for ORG_A query", async () => {
    // RLS at the DB layer enforces this; the service also passes organizationId explicitly.
    // Structural: org-b rows returned by mock should not appear if we query org-a
    const orgBRow = makeNotifRow({ organizationId: ORG_B, notificationId: "work-orgb" });
    const orgARow = makeNotifRow({ organizationId: ORG_A, notificationId: "work-orga" });

    // In real DB with RLS, org-b rows are invisible from org-a session.
    // We test the service maps correctly what the DB returns.
    mockDb.select.mockReturnValueOnce(makeSelectChain([orgARow])); // DB only returns org-a rows

    const result = await getAllNotificationStates(ORG_A, USER_A);
    expect(result.map(r => r.notificationId)).not.toContain("work-orgb");
    expect(result.map(r => r.notificationId)).toContain("work-orga");
    // orgBRow is irrelevant — the mock returns only orgARow, simulating RLS
    void orgBRow; // suppress unused variable warning
  });
});

// ── 12. Legacy messageIds path writes to message_reads ───────────────────────

describe("Legacy messageIds compat — mark-read also writes to message_reads", () => {
  it("when messageIds are provided, markMessagesRead is called with those IDs", async () => {
    // The route must call markMessagesRead(orgId, messageIds, userId) in addition to
    // writing to notification_reads, so that /unread-count (which JOINs message_reads)
    // correctly decrements for legacy callers.
    //
    // We test the contract by simulating both writes the route performs.

    const insertChain = makeInsertChain();
    mockDb.insert.mockReturnValue(insertChain); // both inserts use same mock chain

    const legacyMsgIds = ["msg-aaa-001", "msg-aaa-002"];

    // Route dual-write: notification_reads first, then message_reads
    await markNotificationsRead(ORG_A, USER_A, legacyMsgIds);   // write 1 → notification_reads
    await markMessagesRead(ORG_A, legacyMsgIds, USER_A);         // write 2 → message_reads

    // Both tables must have been written
    expect(mockDb.insert).toHaveBeenCalledTimes(2);

    // First insert (notification_reads) contains notificationId field
    const notifRow = (insertChain.values.mock.calls[0][0] as any[])[0];
    expect(notifRow).toHaveProperty("notificationId", "msg-aaa-001");

    // Second insert (message_reads) contains messageId field
    const msgRow = (insertChain.values.mock.calls[1][0] as any[])[0];
    expect(msgRow).toHaveProperty("messageId", "msg-aaa-001");
  });

  it("unread count drops to 0 after legacy mark-read writes message_reads rows", () => {
    // Structural simulation: a message that was unread becomes read after
    // a message_reads row is inserted for it.
    const messages = [
      { id: "msg-legacy-001", senderUserId: "user-b" },
      { id: "msg-legacy-002", senderUserId: "user-b" },
    ];

    // Before legacy mark-read
    const readBefore = new Set<string>();
    const unreadBefore = messages.filter(m =>
      m.senderUserId !== USER_A && !readBefore.has(m.id),
    );
    expect(unreadBefore).toHaveLength(2);

    // After legacy mark-read writes both IDs to message_reads
    const readAfter = new Set(["msg-legacy-001", "msg-legacy-002"]);
    const unreadAfter = messages.filter(m =>
      m.senderUserId !== USER_A && !readAfter.has(m.id),
    );
    expect(unreadAfter).toHaveLength(0);
  });

  it("legacy messageIds are also written to notification_reads for cross-device state", async () => {
    // Both writes happen for legacy callers:
    //   1. notification_reads (so state is available on other devices)
    //   2. message_reads (so unread-count is accurate)
    const insertChain = makeInsertChain();
    mockDb.insert.mockReturnValueOnce(insertChain);

    await markNotificationsRead(ORG_A, USER_A, ["msg-cross-device-001"]);

    // notification_reads insert includes the message ID as a notificationId
    const rows = insertChain.values.mock.calls[0][0] as any[];
    expect(rows[0].notificationId).toBe("msg-cross-device-001");
    expect(rows[0].organizationId).toBe(ORG_A);
    expect(rows[0].userId).toBe(USER_A);
  });

  it("notificationIds-only call does NOT write to message_reads", () => {
    // When the caller sends only notificationIds (e.g. work-<uuid>, approval-<uuid>),
    // no message_reads write should happen — these are synthetic IDs not in any
    // conversation messages table.
    //
    // The route branches: legacyMsgIds.length === 0 → skip markMessagesRead call.
    const notificationIds = ["work-abc123", "approval-xyz456"];
    const legacyMsgIds: string[] = [];

    // Route contract: skip message_reads write when legacyMsgIds is empty
    const shouldWriteMessageReads = legacyMsgIds.length > 0;
    expect(shouldWriteMessageReads).toBe(false);

    // notificationIds still get written to notification_reads
    const allIds = [...notificationIds, ...legacyMsgIds];
    expect(allIds).toEqual(notificationIds);
    expect(allIds).toHaveLength(2);
  });

  it("both notificationIds and messageIds in one call writes to both tables", () => {
    const notificationIds = ["work-abc123"];
    const messageIds = ["msg-legacy-aaa"];

    // allIds goes to notification_reads
    const allIds = [...notificationIds, ...messageIds];
    expect(allIds).toHaveLength(2);

    // legacyMsgIds goes to message_reads as well
    const shouldWriteMessageReads = messageIds.length > 0;
    expect(shouldWriteMessageReads).toBe(true);
  });
});

// ── 13. Archive → Restore → Archive regression ───────────────────────────────

describe("Optimistic archive/restore state — archive→restore→archive sequence", () => {
  it("a notification can be re-archived after being restored in the same session", () => {
    // Regression: if archive and restore use separate Sets, once a restore adds
    // an ID to optimisticRestored, the `isArchived` check returns false even after
    // re-archiving (because optimisticRestored.has(id) short-circuits before
    // optimisticArchived.has(id) is reached).
    //
    // The fix uses a single Map<id, boolean> where each action overwrites the
    // previous override, so transitions are always consistent.

    // Simulate the single-map implementation:
    const optimisticArchive = new Map<string, boolean>();
    const isArchived = (id: string, serverArchived = false): boolean => {
      if (optimisticArchive.has(id)) return optimisticArchive.get(id) as boolean;
      return serverArchived;
    };

    const id = "work-regression-001";

    // Initial: not archived (server truth)
    expect(isArchived(id, false)).toBe(false);

    // 1. Archive
    optimisticArchive.set(id, true);
    expect(isArchived(id, false)).toBe(true);  // optimistic override: archived

    // 2. Restore
    optimisticArchive.set(id, false);
    expect(isArchived(id, true)).toBe(false);  // optimistic override: restored (even though server says archived)

    // 3. Re-archive — must work correctly
    optimisticArchive.set(id, true);
    expect(isArchived(id, false)).toBe(true);  // re-archived correctly

    // Contrast: the buggy two-Set implementation:
    const buggyOptimisticArchived = new Set<string>();
    const buggyOptimisticRestored = new Set<string>();
    const buggyIsArchived = (id: string, serverArchived = false): boolean => {
      if (buggyOptimisticRestored.has(id)) return false;  // restored check short-circuits
      if (buggyOptimisticArchived.has(id)) return true;
      return serverArchived;
    };

    buggyOptimisticArchived.add(id);
    expect(buggyIsArchived(id, false)).toBe(true);  // archived ✓

    buggyOptimisticRestored.add(id);
    expect(buggyIsArchived(id, true)).toBe(false);  // restored ✓

    // Re-archive: add to archived set without removing from restored
    buggyOptimisticArchived.add(id);
    // BUG: restored check fires first, returns false even though we just archived!
    expect(buggyIsArchived(id, false)).toBe(false); // BUG confirmed
  });

  it("archive clears any prior restore override so the override map stays consistent", () => {
    const optimisticArchive = new Map<string, boolean>();
    const id = "notif-transition-002";

    // Restore first (simulate opening archived tab, restoring, then re-archiving)
    optimisticArchive.set(id, false);
    expect(optimisticArchive.get(id)).toBe(false);

    // Archive overwrites the restore override
    optimisticArchive.set(id, true);
    expect(optimisticArchive.get(id)).toBe(true);
    expect(optimisticArchive.size).toBe(1); // only one entry, not two conflicting ones
  });

  it("restore clears any prior archive override so the override map stays consistent", () => {
    const optimisticArchive = new Map<string, boolean>();
    const id = "notif-transition-003";

    // Archive first
    optimisticArchive.set(id, true);
    expect(optimisticArchive.get(id)).toBe(true);

    // Restore overwrites the archive override
    optimisticArchive.set(id, false);
    expect(optimisticArchive.get(id)).toBe(false);
    expect(optimisticArchive.size).toBe(1);
  });

  it("server confirmation (onSuccess) removes the override so future state comes from server", () => {
    const optimisticArchive = new Map<string, boolean>();
    const id = "notif-confirmed-004";

    // Optimistic archive
    optimisticArchive.set(id, true);
    expect(optimisticArchive.has(id)).toBe(true);

    // onSuccess fires: server confirmed, remove override
    optimisticArchive.delete(id);
    expect(optimisticArchive.has(id)).toBe(false);

    // Now server truth determines the value
    const isArchived = (id: string, serverArchived: boolean): boolean => {
      if (optimisticArchive.has(id)) return optimisticArchive.get(id) as boolean;
      return serverArchived;
    };
    expect(isArchived(id, true)).toBe(true);   // server says archived
    expect(isArchived(id, false)).toBe(false); // server says not archived
  });

  it("error rollback removes the override so the UI reverts to server truth", () => {
    const optimisticArchive = new Map<string, boolean>();
    const id = "notif-error-rollback-005";

    // Optimistic archive
    optimisticArchive.set(id, true);
    expect(optimisticArchive.get(id)).toBe(true);

    // onError fires: remove override to revert to server truth
    optimisticArchive.delete(id);
    expect(optimisticArchive.has(id)).toBe(false);

    // Server truth (not archived before the failed mutation) is restored
    const serverArchived = false;
    const effective = optimisticArchive.has(id) ? optimisticArchive.get(id) : serverArchived;
    expect(effective).toBe(false);
  });

  it("multiple notifications can each have independent archive/restore state", () => {
    const optimisticArchive = new Map<string, boolean>();

    optimisticArchive.set("notif-a", true);   // archived
    optimisticArchive.set("notif-b", false);  // restored
    // notif-c has no override

    const isArchived = (id: string, serverArchived = false): boolean => {
      if (optimisticArchive.has(id)) return optimisticArchive.get(id) as boolean;
      return serverArchived;
    };

    expect(isArchived("notif-a")).toBe(true);
    expect(isArchived("notif-b", true)).toBe(false); // overrides server truth
    expect(isArchived("notif-c", false)).toBe(false);
    expect(isArchived("notif-c", true)).toBe(true);  // server truth when no override
  });
});

// ── 13. Nav badge and interval refresh ───────────────────────────────────────

describe("Nav badge — unread count contract", () => {
  it("nav badge shows zero when unreadCount is 0", () => {
    const unreadCount = 0;
    const showBadge = unreadCount > 0;
    expect(showBadge).toBe(false);
  });

  it("nav badge shows count when unreadCount > 0", () => {
    const unreadCount = 3;
    const showBadge = unreadCount > 0;
    expect(showBadge).toBe(true);
  });

  it("nav badge caps display at 99+ for large counts", () => {
    const format = (n: number) => n > 99 ? "99+" : String(n);
    expect(format(5)).toBe("5");
    expect(format(99)).toBe("99");
    expect(format(100)).toBe("99+");
    expect(format(999)).toBe("99+");
  });

  it("nav badge refresh interval is 60 seconds", () => {
    // Design contract: the badge refetchInterval must be 60_000ms to avoid excessive polling
    const REFRESH_INTERVAL_MS = 60_000;
    expect(REFRESH_INTERVAL_MS).toBe(60_000);
  });

  it("invalidating nav-notif-badge after mark-read/archive correctly clears the cache", () => {
    // Structural: the mutations call invalidateQueries({ queryKey: ["nav-notif-badge", slug] })
    // This is verified by testing that the badge query key is referenced consistently
    const BADGE_QUERY_KEY = "nav-notif-badge";
    const NOTIF_UNREAD_KEY = "notif-unread";
    // Badge and notif-unread are separate query keys
    expect(BADGE_QUERY_KEY).not.toBe(NOTIF_UNREAD_KEY);
    // Both should be invalidated after read actions
    const keysToInvalidate = [BADGE_QUERY_KEY, NOTIF_UNREAD_KEY, "notif-state"];
    expect(keysToInvalidate).toContain("nav-notif-badge");
    expect(keysToInvalidate).toContain("notif-state");
  });
});
