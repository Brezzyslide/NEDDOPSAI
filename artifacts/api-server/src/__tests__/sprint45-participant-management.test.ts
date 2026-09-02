import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const state = vi.hoisted(() => ({
  participants: [] as any[],
  sources: [] as any[],
  scopes: [] as any[],
  taskParticipants: [] as any[],
}));

const tables = vi.hoisted(() => ({
  participantsTable: {
    id: "participants.id",
    organizationId: "participants.organizationId",
    displayName: "participants.displayName",
    preferredName: "participants.preferredName",
    externalParticipantId: "participants.externalParticipantId",
    status: "participants.status",
    deletedAt: "participants.deletedAt",
    updatedAt: "participants.updatedAt",
  },
  knowledgeSourcesTable: {
    id: "sources.id",
    organizationId: "sources.organizationId",
    title: "sources.title",
    originalFileName: "sources.originalFileName",
    sourceType: "sources.sourceType",
    sourceScope: "sources.sourceScope",
    status: "sources.status",
    createdAt: "sources.createdAt",
    deletedAt: "sources.deletedAt",
  },
  knowledgeSourceScopesTable: {
    id: "scopes.id",
    knowledgeSourceId: "scopes.knowledgeSourceId",
    organizationId: "scopes.organizationId",
    scopeType: "scopes.scopeType",
    scopeId: "scopes.scopeId",
  },
  taskParticipantsTable: {
    taskId: "taskParticipants.taskId",
    organizationId: "taskParticipants.organizationId",
    participantId: "taskParticipants.participantId",
    role: "taskParticipants.role",
  },
}));

function tableName(column: unknown): string {
  return String(column).split(".")[0] ?? "";
}

function columnName(column: unknown): string {
  return String(column).split(".")[1] ?? "";
}

function getValue(row: any, column: unknown) {
  return row[columnName(column)];
}

function matches(row: any, expr: any): boolean {
  if (!expr) return true;
  if (expr.op === "and") return expr.args.every((arg: any) => matches(row, arg));
  if (expr.op === "or") return expr.args.some((arg: any) => matches(row, arg));
  if (expr.op === "eq") return getValue(row, expr.args[0]) === expr.args[1];
  if (expr.op === "inArray") return expr.args[1].includes(getValue(row, expr.args[0]));
  if (expr.op === "isNull") return getValue(row, expr.arg) == null;
  if (expr.op === "ilike") {
    const value = String(getValue(row, expr.args[0]) ?? "").toLowerCase();
    const pattern = String(expr.args[1] ?? "").toLowerCase().replaceAll("%", "");
    return value.includes(pattern);
  }
  return true;
}

function rowsFor(table: unknown) {
  const name = tableName(Object.values(table as Record<string, unknown>)[0]);
  if (name === "participants") return state.participants;
  if (name === "sources") return state.sources;
  if (name === "scopes") return state.scopes;
  if (name === "taskParticipants") return state.taskParticipants;
  return [];
}

function project(row: any, shape: any) {
  if (!shape) return row;
  const out: Record<string, unknown> = {};
  for (const [key, column] of Object.entries(shape)) out[key] = getValue(row, column);
  return out;
}

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...args: unknown[]) => ({ op: "and", args })),
  asc: vi.fn((value: unknown) => ({ op: "asc", value })),
  desc: vi.fn((value: unknown) => ({ op: "desc", value })),
  eq: vi.fn((...args: unknown[]) => ({ op: "eq", args })),
  ilike: vi.fn((...args: unknown[]) => ({ op: "ilike", args })),
  inArray: vi.fn((...args: unknown[]) => ({ op: "inArray", args })),
  isNull: vi.fn((arg: unknown) => ({ op: "isNull", arg })),
  or: vi.fn((...args: unknown[]) => ({ op: "or", args })),
  sql: vi.fn(() => ({ op: "sql" })),
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn((shape?: any) => ({
      from: (table: unknown) => ({
        where: (expr: any) => ({
          orderBy: () => ({
            limit: (limit: number) => ({
              offset: (offset: number) => Promise.resolve(rowsFor(table).filter(row => matches(row, expr)).slice(offset, offset + limit).map(row => project(row, shape))),
            }),
          }),
          limit: (limit: number) => Promise.resolve(rowsFor(table).filter(row => matches(row, expr)).slice(0, limit).map(row => project(row, shape))),
          then: (resolve: (value: any[]) => void) => resolve(rowsFor(table).filter(row => matches(row, expr)).map(row => project(row, shape))),
        }),
        innerJoin: (_joinTable: unknown) => ({
          where: (expr: any) => {
            const joined = state.scopes
              .map(scope => {
                const source = state.sources.find(s => s.id === scope.knowledgeSourceId);
                return source ? { ...source, ...scope, sourceId: source.id } : null;
              })
              .filter(Boolean);
            return Promise.resolve(joined.filter(row => matches(row, expr)).map(row => project(row, shape)));
          },
        }),
      }),
    })),
    insert: vi.fn((table: unknown) => ({
      values: (value: any) => ({
        returning: () => {
          if (table === tables.participantsTable) {
            const duplicate = value.externalParticipantId && state.participants.some(row =>
              row.organizationId === value.organizationId &&
              row.externalParticipantId === value.externalParticipantId &&
              row.deletedAt == null,
            );
            if (duplicate) {
              const error = Object.assign(new Error("duplicate"), { code: "23505" });
              return Promise.reject(error);
            }
            const row = { ...value, createdAt: new Date(), deletedAt: null };
            state.participants.push(row);
            return Promise.resolve([row]);
          }
          if (table === tables.knowledgeSourceScopesTable) {
            const row = { ...value, createdAt: new Date(), updatedAt: new Date() };
            state.scopes.push(row);
            return Promise.resolve([row]);
          }
          return Promise.resolve([value]);
        },
      }),
    })),
    update: vi.fn((table: unknown) => ({
      set: (patch: any) => ({
        where: (expr: any) => ({
          returning: () => {
            const rows = rowsFor(table).filter(row => matches(row, expr));
            rows.forEach(row => Object.assign(row, patch));
            return Promise.resolve(rows);
          },
        }),
      }),
    })),
    delete: vi.fn((table: unknown) => ({
      where: (expr: any) => {
        if (table === tables.knowledgeSourceScopesTable) {
          state.scopes = state.scopes.filter(row => !matches(row, expr));
        }
        return Promise.resolve();
      },
    })),
  },
  KNOWLEDGE_SCOPE_TYPES: ["organisation", "workforce", "specialist", "department", "location", "task_type", "entity"],
  KNOWLEDGE_SOURCE_STATUSES: ["uploaded", "processing", "review_required", "approved", "revoked", "superseded", "archived", "failed"],
  KNOWLEDGE_SOURCE_TYPES: ["policy", "procedure", "participant_document"],
  KNOWLEDGE_AUTHORITY_LEVELS: ["mandatory", "authoritative", "supporting"],
  KNOWLEDGE_SENSITIVITY_LEVELS: ["public", "internal", "confidential", "restricted"],
  KNOWLEDGE_SOURCE_SCOPES: ["library", "task"],
  knowledgeSourceVersionsTable: {},
  ...tables,
}));

vi.mock("../services/auditService.js", () => ({
  logOrgEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../services/knowledgeCurationService.js", () => ({
  enqueueCurationJobAsync: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/ingestionQueue/index.js", () => ({
  getIngestionQueue: vi.fn().mockReturnValue(null),
}));

describe("participant management", () => {
  beforeEach(() => {
    state.participants = [];
    state.sources = [];
    state.scopes = [];
    state.taskParticipants = [];
  });

  it("a. a participant created in org A is not visible or searchable from org B", async () => {
    const { createParticipant, listParticipants, searchParticipants } = await import("../services/participantService.js");

    await createParticipant("org-a", {
      displayName: "Michael Roberts",
      preferredName: "Michael",
      externalParticipantId: "P-001",
    });

    await expect(listParticipants({ organizationId: "org-b" })).resolves.toMatchObject({ participants: [] });
    await expect(searchParticipants("org-b", "Michael")).resolves.toEqual([]);
    await expect(searchParticipants("org-a", "P-001")).resolves.toHaveLength(1);
  });

  it("b. linking a source to a participant in another org is rejected", async () => {
    state.participants.push({
      id: "participant-b",
      organizationId: "org-b",
      displayName: "Michael",
      status: "active",
      deletedAt: null,
    });
    state.sources.push({
      id: "source-a",
      organizationId: "org-a",
      sourceScope: "library",
      sourceType: "participant_document",
      title: "Client document",
      deletedAt: null,
    });

    const { linkParticipantSource } = await import("../services/participantService.js");

    await expect(linkParticipantSource({
      organizationId: "org-a",
      participantId: "participant-b",
      sourceId: "source-a",
      actorUserId: "user-a",
    })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("c. a soft-deleted participant is excluded from picker search and bound tasks are reported", async () => {
    state.participants.push({
      id: "participant-a",
      organizationId: "org-a",
      displayName: "Michael Roberts",
      status: "active",
      deletedAt: null,
    });
    state.taskParticipants.push({
      taskId: "task-001",
      organizationId: "org-a",
      participantId: "participant-a",
      role: "subject",
    });

    const { searchParticipants, softDeleteParticipant } = await import("../services/participantService.js");
    const deleted = await softDeleteParticipant("org-a", "participant-a");

    expect(deleted.boundTasks).toEqual([{ taskId: "task-001", role: "subject" }]);
    expect(deleted.participant).toMatchObject({ status: "archived", deletedAt: null });
    await expect(searchParticipants("org-a", "Michael")).resolves.toEqual([]);
  });

  it("c1. a newly created participant appears in the default current list", async () => {
    const { createParticipant, listParticipants } = await import("../services/participantService.js");

    const participant = await createParticipant("org-a", { displayName: "Micheal Rocca" });
    const listed = await listParticipants({ organizationId: "org-a" });

    expect(participant).toMatchObject({ displayName: "Micheal Rocca", status: "active" });
    expect(listed.participants.map(row => row.id)).toContain(participant.id);
  });

  it("c2. inactive participants stay in the default current list", async () => {
    const { createParticipant, listParticipants, updateParticipant } = await import("../services/participantService.js");

    const participant = await createParticipant("org-a", { displayName: "Micheal Rocca" });
    const updated = await updateParticipant("org-a", participant.id, { status: "inactive" });
    const listed = await listParticipants({ organizationId: "org-a" });

    expect(updated.status).toBe("inactive");
    expect(listed.participants).toEqual([
      expect.objectContaining({ id: participant.id, status: "inactive" }),
    ]);
  });

  it("c3. archived participants are hidden by default and retrievable with an archived filter", async () => {
    const { createParticipant, listParticipants, softDeleteParticipant } = await import("../services/participantService.js");

    const participant = await createParticipant("org-a", { displayName: "Micheal Rocca" });
    await softDeleteParticipant("org-a", participant.id);

    await expect(listParticipants({ organizationId: "org-a" })).resolves.toMatchObject({ participants: [] });
    await expect(listParticipants({ organizationId: "org-a", status: "archived" })).resolves.toMatchObject({
      participants: [expect.objectContaining({ id: participant.id, status: "archived", deletedAt: null })],
    });
  });

  it("c4. inactive participants appear in picker search results, archived and deleted participants do not", async () => {
    state.participants.push(
      { id: "archived", organizationId: "org-a", displayName: "Micheal Rocca", status: "archived", deletedAt: null },
      { id: "inactive", organizationId: "org-a", displayName: "Micheal Review", status: "inactive", deletedAt: null },
      { id: "deleted", organizationId: "org-a", displayName: "Micheal Deleted", status: "active", deletedAt: new Date() },
    );

    const { searchParticipants } = await import("../services/participantService.js");

    const results = await searchParticipants("org-a", "Micheal");

    expect(results).toHaveLength(1);
    expect(results[0]?.participant).toMatchObject({ id: "inactive", status: "inactive" });
  });

  it("c5. the participants page defaults to current participants instead of active-only", () => {
    const source = readFileSync(
      resolve(process.cwd(), "../needsops-web/src/pages/app/ParticipantsPage.tsx"),
      "utf8",
    );

    expect(source).toContain('const [status, setStatus] = useState<(typeof STATUS_OPTIONS)[number]>("");');
    expect(source).toContain('if (status) params.set("status", status);');
    expect(source).toContain("active + inactive");
  });

  it("d. search returns exact matches before fuzzy and marks fuzzy rows as suggestions", async () => {
    state.participants.push(
      { id: "external", organizationId: "org-a", displayName: "Someone Else", externalParticipantId: "Michael", status: "active", deletedAt: null },
      { id: "display", organizationId: "org-a", displayName: "Michael", externalParticipantId: null, status: "active", deletedAt: null },
      { id: "fuzzy", organizationId: "org-a", displayName: "Michael Roberts", externalParticipantId: null, status: "active", deletedAt: null },
    );

    const { searchParticipants } = await import("../services/participantService.js");
    const results = await searchParticipants("org-a", "Michael");

    expect(results.map(result => result.participant.id)).toEqual(["external", "display", "fuzzy"]);
    expect(results.map(result => result.matchType)).toEqual(["external_id_exact", "display_name_exact", "fuzzy_suggestion"]);
    expect(results.at(-1)?.isSuggestion).toBe(true);
  });

  it("d1. John Deo returns John Doe as a fuzzy suggestion, not an auto-selected match", async () => {
    state.participants.push({ id: "john", organizationId: "org-a", displayName: "John Doe", status: "active", deletedAt: null });

    const { searchParticipants } = await import("../services/participantService.js");
    const results = await searchParticipants("org-a", "John Deo");

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      participant: { id: "john", displayName: "John Doe" },
      matchType: "fuzzy_suggestion",
      isSuggestion: true,
    });
  });

  it("d2. Doe John returns John Doe as a fuzzy suggestion when name order is reversed", async () => {
    state.participants.push({ id: "john", organizationId: "org-a", displayName: "John Doe", status: "active", deletedAt: null });

    const { searchParticipants } = await import("../services/participantService.js");
    const results = await searchParticipants("org-a", "Doe John");

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      participant: { id: "john", displayName: "John Doe" },
      matchType: "fuzzy_suggestion",
      isSuggestion: true,
    });
  });

  it("d3. JOHN DOE returns John Doe as a case-insensitive exact match", async () => {
    state.participants.push({ id: "john", organizationId: "org-a", displayName: "John Doe", status: "active", deletedAt: null });

    const { searchParticipants } = await import("../services/participantService.js");
    const results = await searchParticipants("org-a", "JOHN DOE");

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      participant: { id: "john", displayName: "John Doe" },
      matchType: "display_name_exact",
      isSuggestion: false,
    });
  });

  it("d4. Jon Doe returns John Doe as a fuzzy suggestion when a letter is missing", async () => {
    state.participants.push({ id: "john", organizationId: "org-a", displayName: "John Doe", status: "active", deletedAt: null });

    const { searchParticipants } = await import("../services/participantService.js");
    const results = await searchParticipants("org-a", "Jon Doe");

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      participant: { id: "john", displayName: "John Doe" },
      matchType: "fuzzy_suggestion",
      isSuggestion: true,
    });
  });

  it("d5. a name matching nothing returns zero candidates", async () => {
    state.participants.push({ id: "john", organizationId: "org-a", displayName: "John Doe", status: "active", deletedAt: null });

    const { searchParticipants } = await import("../services/participantService.js");

    await expect(searchParticipants("org-a", "Zachary Unknown")).resolves.toEqual([]);
  });

  it("d6. near-duplicate warnings use a lower threshold than picker suggestions", async () => {
    state.participants.push({ id: "john", organizationId: "org-a", displayName: "John Doe", status: "active", deletedAt: null });

    const { findParticipantDuplicateWarnings } = await import("../services/participantService.js");
    const warnings = await findParticipantDuplicateWarnings("org-a", "John Do");

    expect(warnings).toEqual([
      expect.objectContaining({ participant: expect.objectContaining({ id: "john" }) }),
    ]);
  });

  it("d7. duplicate warnings include inactive records but not archived records", async () => {
    state.participants.push(
      { id: "inactive", organizationId: "org-a", displayName: "John Doe", status: "inactive", deletedAt: null },
      { id: "archived", organizationId: "org-a", displayName: "John Dough", status: "archived", deletedAt: null },
    );

    const { findParticipantDuplicateWarnings } = await import("../services/participantService.js");
    const warnings = await findParticipantDuplicateWarnings("org-a", "John Do");

    expect(warnings.map(warning => warning.participant.id)).toEqual(["inactive"]);
  });

  it("e. duplicate external_participant_id is rejected in the same org and allowed in another org", async () => {
    const { createParticipant } = await import("../services/participantService.js");

    await createParticipant("org-a", { displayName: "Michael A", externalParticipantId: "P-001" });
    await expect(createParticipant("org-a", { displayName: "Michael B", externalParticipantId: "P-001" }))
      .rejects.toMatchObject({ code: "DUPLICATE_EXTERNAL_PARTICIPANT_ID" });
    await expect(createParticipant("org-b", { displayName: "Michael B", externalParticipantId: "P-001" }))
      .resolves.toMatchObject({ organizationId: "org-b", externalParticipantId: "P-001" });
  });
});
