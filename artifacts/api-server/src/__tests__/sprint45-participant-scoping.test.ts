import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  execute: vi.fn().mockResolvedValue({ rows: [] }),
  participants: [] as Array<{
    id: string;
    displayName: string;
    preferredName: string | null;
    externalParticipantId: string | null;
    status?: string;
    deletedAt?: Date | null;
  }>,
  staff: [] as Array<{
    displayName: string | null;
    firstName: string | null;
    lastName: string | null;
    email: string;
  }>,
  sources: [] as Array<Record<string, unknown>>,
  scopes: [] as Array<Record<string, unknown>>,
}));

const tables = vi.hoisted(() => ({
  knowledgeChunksTable: { id: "kc.id" },
  knowledgeSourcesTable: {
    id: "ks.id",
    organizationId: "ks.organization_id",
    sourceScope: "ks.source_scope",
    sourceType: "ks.source_type",
    status: "ks.status",
    deletedAt: "ks.deleted_at",
    createdAt: "ks.created_at",
  },
  knowledgeSourceVersionsTable: { id: "ksv.id" },
  knowledgeSourceScopesTable: {
    id: "kss.id",
    knowledgeSourceId: "kss.knowledge_source_id",
    organizationId: "kss.organization_id",
    scopeType: "kss.scope_type",
    scopeId: "kss.scope_id",
  },
  participantsTable: {
    id: "participants.id",
    organizationId: "participants.organization_id",
    displayName: "participants.display_name",
    preferredName: "participants.preferred_name",
    externalParticipantId: "participants.external_participant_id",
    status: "participants.status",
    deletedAt: "participants.deleted_at",
  },
  taskParticipantsTable: {
    id: "task_participants.id",
    organizationId: "task_participants.organization_id",
    taskId: "task_participants.task_id",
    participantId: "task_participants.participant_id",
    role: "task_participants.role",
  },
  membershipsTable: {
    id: "memberships.id",
    organizationId: "memberships.organization_id",
    userId: "memberships.user_id",
    status: "memberships.status",
  },
  usersTable: {
    id: "users.id",
    displayName: "users.display_name",
    firstName: "users.first_name",
    lastName: "users.last_name",
    email: "users.email",
  },
  retrievalAuditEventsTable: { id: "retrieval_audit_events.id" },
}));

function selectChain() {
  return {
    from(table: unknown) {
      if (table === tables.participantsTable) {
        return {
          where: vi.fn().mockResolvedValue(state.participants),
        };
      }
      if (table === tables.membershipsTable) {
        return {
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(state.staff),
          }),
        };
      }
      if (table === tables.knowledgeSourcesTable) {
        return {
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue(state.sources),
          }),
        };
      }
      if (table === tables.knowledgeSourceScopesTable) {
        return {
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue(state.scopes),
          }),
        };
      }
      return {
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      };
    },
  };
}

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: unknown[]) => ({ op: "eq", args })),
  and: vi.fn((...args: unknown[]) => ({ op: "and", args })),
  desc: vi.fn((value: unknown) => ({ op: "desc", value })),
  isNull: vi.fn((value: unknown) => ({ op: "isNull", value })),
  ne: vi.fn((...args: unknown[]) => ({ op: "ne", args })),
  not: vi.fn((value: unknown) => ({ op: "not", value })),
  inArray: vi.fn((...args: unknown[]) => ({ op: "inArray", args })),
  sql: {
    raw: (value: string) => ({ queryChunks: [{ sql: value }] }),
  },
}));

vi.mock("@workspace/db", () => ({
  db: {
    execute: state.execute,
    select: vi.fn(selectChain),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{
          id: "scope-001",
          knowledgeSourceId: "source-001",
          organizationId: "org-a",
          scopeType: "entity",
          scopeId: "participant-a",
        }]),
      }),
    }),
  },
  KNOWLEDGE_SOURCE_STATUSES: ["uploaded", "processing", "review_required", "approved", "revoked", "superseded", "archived", "failed"],
  KNOWLEDGE_SOURCE_TYPES: ["policy", "procedure", "participant_document"],
  KNOWLEDGE_AUTHORITY_LEVELS: ["mandatory", "authoritative", "primary", "supporting", "reference"],
  KNOWLEDGE_SENSITIVITY_LEVELS: ["public", "internal", "confidential", "restricted"],
  KNOWLEDGE_SOURCE_SCOPES: ["library", "task"],
  KNOWLEDGE_SCOPE_TYPES: ["organisation", "workforce", "specialist", "department", "location", "task_type", "entity"],
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

function capturedSql(): string {
  const call = state.execute.mock.calls.at(-1);
  const query = call?.[0] as { queryChunks?: Array<{ sql?: string }> } | undefined;
  return query?.queryChunks?.map(chunk => chunk.sql ?? "").join("") ?? String(call?.[0] ?? "");
}

describe("participant-scoped knowledge retrieval", () => {
  beforeEach(() => {
    state.execute.mockClear();
    state.execute.mockResolvedValue({ rows: [] });
    state.participants = [];
    state.staff = [];
    state.sources = [];
    state.scopes = [];
  });

  it("a. two participants with documents each: a request for A returns zero chunks belonging to B", async () => {
    const { retrieveChunks } = await import("../services/hybridRetrievalService.js");

    await retrieveChunks({
      organisationId: "org-a",
      query: "care plan evidence",
      queryEmbedding: null,
      scopeMode: "entity_scoped",
      entityIds: ["participant-a"],
    });

    const sql = capturedSql();
    expect(sql).toContain("ks.source_type = 'participant_document'");
    expect(sql).toContain("kss.scope_id IN ('participant-a')");
    expect(sql).not.toContain("participant-b");
  });

  it("b. an unlinked participant document is returned to nobody", async () => {
    const { retrieveChunks } = await import("../services/hybridRetrievalService.js");

    await retrieveChunks({
      organisationId: "org-a",
      query: "care plan evidence",
      queryEmbedding: null,
      scopeMode: "org_library",
    });
    expect(capturedSql()).toContain("ks.source_type <> 'participant_document'");

    await retrieveChunks({
      organisationId: "org-a",
      query: "care plan evidence",
      queryEmbedding: null,
      scopeMode: "entity_scoped",
      entityIds: [],
    });
    expect(capturedSql()).toContain("AND 1=0");
  });

  it("c. a task with a subject and a related participant retrieves only the subject's documents", async () => {
    const { deriveRetrievalEntityIdsFromTaskParticipants } = await import("../services/taskParticipantService.js");

    expect(deriveRetrievalEntityIdsFromTaskParticipants([
      { role: "subject", participantId: "participant-a" },
      { role: "related", participantId: "participant-b" },
      { role: "guardian_context", participantId: "participant-c" },
    ])).toEqual(["participant-a"]);
  });

  it("d. a participant-specific request with no bound participant fails closed", async () => {
    const { resolveSubjectParticipantForTaskRequest } = await import("../services/taskParticipantService.js");

    const result = await resolveSubjectParticipantForTaskRequest({
      organizationId: "org-a",
      title: "Complete a care plan for Michael",
    });

    expect(result.status).toBe("unresolved");
    expect(result.subjectParticipantIds).toEqual([]);
    expect(result.clarifyingQuestion).toContain("Please select the participant");
  });

  it("d2. a single name match still requires picker confirmation and does not auto-bind", async () => {
    state.participants = [{
      id: "participant-a",
      displayName: "Michael Roberts",
      preferredName: "Michael",
      externalParticipantId: null,
    }];

    const { resolveSubjectParticipantForTaskRequest } = await import("../services/taskParticipantService.js");

    const result = await resolveSubjectParticipantForTaskRequest({
      organizationId: "org-a",
      title: "Complete a care plan for Michael",
    });

    expect(result.status).toBe("confirmation_required");
    expect(result.subjectParticipantIds).toEqual([]);
    expect(result.candidates.map(candidate => candidate.id)).toEqual(["participant-a"]);
  });

  it("e. an entity scope pointing at a participant in another org is rejected at assignment", async () => {
    state.sources = [{
      id: "source-001",
      organizationId: "org-a",
      sourceScope: "library",
      sourceType: "participant_document",
      deletedAt: null,
    }];
    state.participants = [];

    const { assignScope } = await import("../services/knowledgeSourceService.js");

    await expect(assignScope({
      knowledgeSourceId: "source-001",
      organizationId: "org-a",
      scopeType: "entity",
      scopeId: "participant-in-org-b",
      actorUserId: "user-001",
    })).rejects.toMatchObject({
      code: "INVALID_PARTICIPANT_SCOPE",
    });
  });
});
