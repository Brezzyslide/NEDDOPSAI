/**
 * Sprint 9.2 test helpers — mock DB for memory service tests.
 * All DB calls are intercepted so tests are fully in-memory.
 * Uses getTableName() from drizzle-orm to identify tables in the mock from() call.
 */

import { vi } from "vitest";
import { randomUUID } from "crypto";

// ─── Types ────────────────────────────────────────────────────────────────────

interface MockMessage {
  id: string;
  senderType: string;
  content: string;
  messageType: string;
  createdAt: Date;
  organizationId: string;
  conversationId: string;
}

interface MockOrgMemory {
  id: string;
  organizationId: string;
  memoryType: string;
  title: string;
  content: string;
  structuredContent: Record<string, unknown>;
  sourceType: string;
  sourceId: string | null;
  status: string;
  confidence: string;
  importance: number;
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
  expiresAt: Date | null;
  createdBy: string;
  approvedBy: string | null;
  approvedAt: Date | null;
  supersededBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface MockConversationMemory {
  pinnedDecisions: unknown[];
  unresolvedQuestions: unknown[];
  assumptions: unknown[];
  summarisedMessageCount: number;
  [key: string]: unknown;
}

// ─── State store ──────────────────────────────────────────────────────────────

let _messages: MockMessage[] = [];
let _orgMemory: MockOrgMemory[] = [];
let _conversationMemory: MockConversationMemory | null = null;
let _tasks: unknown[] = [];
let _inserts: Record<string, unknown[]> = {};
let _queryCallbacks: Array<(table: string, filter: Record<string, string>) => void> = [];

// ─── Factory helpers ──────────────────────────────────────────────────────────

export function makeMockMessage(overrides: Partial<MockMessage> = {}): MockMessage {
  return {
    id: randomUUID(),
    senderType: "user",
    content: "Test message content",
    messageType: "text",
    createdAt: new Date(),
    organizationId: "org-1",
    conversationId: "conv-1",
    ...overrides,
  };
}

export function makeMockOrgMemory(overrides: Partial<MockOrgMemory & { id?: string; status?: string; title?: string; memoryType?: string }> = {}): MockOrgMemory {
  return {
    id: randomUUID(),
    organizationId: "org-1",
    memoryType: "other",
    title: "Test memory",
    content: "Memory content",
    structuredContent: {},
    sourceType: "conversation",
    sourceId: null,
    status: "proposed",
    confidence: "0.80",
    importance: 5,
    effectiveFrom: null,
    effectiveTo: null,
    expiresAt: null,
    createdBy: "user-1",
    approvedBy: null,
    approvedAt: null,
    supersededBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// ─── Reset ────────────────────────────────────────────────────────────────────

export function resetMockDb() {
  _messages = [];
  _orgMemory = [];
  _conversationMemory = null;
  _tasks = [];
  _inserts = {};
  _queryCallbacks = [];
}

// ─── Table name resolver ──────────────────────────────────────────────────────
// Drizzle stores the table name in a well-known symbol key. Access it without
// importing drizzle-orm in the helpers (which would pull in the real DB client).

function resolveTableName(table: unknown): string {
  if (table === null || table === undefined) return "unknown";
  if (typeof table === "string") return table;
  const t = table as Record<string | symbol, unknown>;
  // Drizzle PgTable stores the name in Symbol.for('drizzle:Name')
  const drizzleNameSym = Symbol.for("drizzle:Name");
  if (typeof t[drizzleNameSym] === "string") return t[drizzleNameSym] as string;
  // Fallback: check _.name (internal Drizzle shape)
  const inner = t._ as Record<string, unknown> | undefined;
  if (inner && typeof inner.name === "string") return inner.name;
  return String(table);
}

// ─── Mock DB interface (used by vi.mock) ─────────────────────────────────────

type InsertChain = {
  values: (data: unknown) => { then: (resolve: (v: unknown) => unknown) => Promise<unknown> };
};

type SelectSelf = {
  from:    (table: unknown) => SelectSelf;
  where:   (...args: unknown[]) => SelectSelf;
  orderBy: (...args: unknown[]) => SelectSelf;
  limit:   (n: unknown) => SelectSelf & { then: (r: (v: unknown[]) => unknown) => Promise<unknown> };
  offset:  (...args: unknown[]) => SelectSelf;
  then:    (resolve: (v: unknown[]) => unknown) => Promise<unknown>;
};

function makeSelectChain(): SelectSelf {
  let _resolved: unknown[] = [];

  const self: SelectSelf = {
    from: (table: unknown) => {
      const name = resolveTableName(table);
      _queryCallbacks.forEach(cb => cb(name, {}));
      if (name.includes("conversation_message")) {
        _resolved = _messages;
      } else if (name === "organisation_memory") {
        _resolved = _orgMemory;
      } else if (name === "conversation_memory") {
        _resolved = _conversationMemory ? [_conversationMemory] : [];
      } else if (name === "tasks") {
        _resolved = _tasks;
      } else if (name === "organizations" || name === "organisations") {
        _resolved = [{ id: "org-1", name: "Test Org", slug: "test-org", status: "active" }];
      } else if (name.includes("approval")) {
        _resolved = [];
      } else {
        _resolved = [];
      }
      return self;
    },
    where:   (..._args) => { _queryCallbacks.forEach(cb => cb("", { organizationId: _args[0] as string })); return self; },
    orderBy: (..._args) => self,
    limit:   (n) => {
      const nNum = typeof n === "number" ? n : 999;
      const limited = { ...self, then: (resolve: (v: unknown[]) => unknown) => Promise.resolve(_resolved.slice(0, nNum)).then(resolve) };
      return limited as SelectSelf & { then: (r: (v: unknown[]) => unknown) => Promise<unknown> };
    },
    offset:  (..._args) => self,
    then:    (resolve) => Promise.resolve(_resolved).then(resolve),
  };
  return self;
}

export const mockDb: {
  select: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  _setMessages: (msgs: MockMessage[]) => void;
  _setOrgMemory: (items: MockOrgMemory[]) => void;
  _setOrgMemoryById: (item: Partial<MockOrgMemory>) => void;
  _setConversationMemory: (mem: MockConversationMemory | null) => void;
  _setTasks: (tasks: unknown[]) => void;
  _captureInserts: (table: string) => unknown[];
  _onQuery: (cb: (table: string, filter: Record<string, string>) => void) => void;
} = {
  _setMessages:           (m) => { _messages = m; },
  _setOrgMemory:          (m) => { _orgMemory = m; },
  _setOrgMemoryById:      (m) => {
    // Merges the partial record into _orgMemory for update/approve/reject scenarios.
    // If _orgMemory is empty, treat it as a single-item store.
    if (_orgMemory.length === 0) {
      _orgMemory = [m as MockOrgMemory];
    } else {
      _orgMemory = _orgMemory.map(o => o.id === (m as MockOrgMemory).id ? { ...o, ...m } : o);
      if (!_orgMemory.find(o => o.id === (m as MockOrgMemory).id)) {
        _orgMemory.push(m as MockOrgMemory);
      }
    }
  },
  _setConversationMemory: (m) => { _conversationMemory = m; },
  _setTasks:              (t) => { _tasks = t; },
  _captureInserts:        (table) => { _inserts[table] ??= []; return _inserts[table]!; },
  _onQuery:               (cb) => { _queryCallbacks.push(cb); },

  select: vi.fn().mockImplementation(() => makeSelectChain()),

  insert: vi.fn().mockImplementation((table: unknown) => {
    const name = resolveTableName(table);
    const tableKey = name.includes("conversation_memory") ? "conversation_memory"
      : name === "organisation_memory" ? "organisation_memory"
      : name.includes("audit") ? "audit"
      : name;
    return {
      values: (data: unknown): InsertChain["values"] extends (...args: any) => infer R ? R : never => {
        _inserts[tableKey] ??= [];
        _inserts[tableKey]!.push(data);
        return { then: (resolve: (v: unknown) => unknown) => Promise.resolve({}).then(resolve) } as any;
      },
    };
  }),

  update: vi.fn().mockImplementation(() => ({
    set: (_data: unknown) => ({
      where: (..._args: unknown[]) => Promise.resolve({}),
    }),
  })),

  delete: vi.fn().mockImplementation(() => ({
    where: (..._args: unknown[]) => Promise.resolve({}),
  })),
};
