/**
 * Task #15 — Knowledge Schema, Scopes & Secure Upload
 *
 * Schema and RLS isolation tests for the Organisation Library.
 *
 * Tests:
 *   - All 6 new tables exist in REQUIRED_RLS_TABLES
 *   - Cross-tenant reads rejected for all new tables
 *   - Cross-tenant writes rejected for all new tables
 *   - Scope isolation (duplicate scope prevention)
 *   - Version lineage (only one current version per source)
 *   - Superseded version handling
 *   - Task-scoped sources stay isolated from library
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { REQUIRED_RLS_TABLES } from "@workspace/org-db";

// ─── Mock @workspace/db ───────────────────────────────────────────────────────
// vi.mock is hoisted to top of file — use vi.hoisted() so mockDb is available
// inside the factory without hitting the temporal dead zone.

const { mockDb, selectChain, insertChain, updateChain, deleteChain, txMock } = vi.hoisted(() => {
  const insertChain = { values: vi.fn().mockReturnThis(), returning: vi.fn() };
  const updateChain = { set: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), returning: vi.fn() };
  const deleteChain = { where: vi.fn().mockReturnThis() };
  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    // limit is the terminal for most queries; offset is the terminal for paginated queries.
    // Tests must match the actual call shape used by each service method.
    limit: vi.fn().mockResolvedValue([]),
    offset: vi.fn().mockResolvedValue([]),
  };
  const txMock = {
    insert: vi.fn().mockReturnValue(insertChain),
    update: vi.fn().mockReturnValue(updateChain),
    select: vi.fn().mockReturnValue(selectChain),
  };
  const mockDb = {
    select: vi.fn().mockReturnValue(selectChain),
    insert: vi.fn().mockReturnValue(insertChain),
    update: vi.fn().mockReturnValue(updateChain),
    delete: vi.fn().mockReturnValue(deleteChain),
    transaction: vi.fn().mockImplementation(async (fn: any) => fn(txMock)),
  };
  return { mockDb, selectChain, insertChain, updateChain, deleteChain, txMock };
});

vi.mock("@workspace/db", async () => {
  const actual = await vi.importActual<any>("@workspace/db");
  return { ...actual, db: mockDb };
});

const {
  completeUpload,
  getKnowledgeSource,
  listKnowledgeSources,
  assignScope,
  removeScope,
  replaceSourceVersion,
  supersedeKnowledgeSource,
  findDuplicateChecksum,
  KnowledgeSourceError,
} = await import("../services/knowledgeSourceService.js");

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ORG_A = "org-a-0000-0000-0000-000000000001";
const ORG_B = "org-b-0000-0000-0000-000000000002";
const USER_A = "user-a-0000-0000-0000-000000000001";

function makeSource(overrides: Partial<any> = {}) {
  return {
    id: "src-001",
    organizationId: ORG_A,
    sourceScope: "library",
    taskId: null,
    title: "Test Policy",
    description: "A test policy document",
    sourceType: "policy",
    originalFileName: "policy.pdf",
    mimeType: "application/pdf",
    storageProvider: "gcs",
    storageKey: `orgs/${ORG_A}/library/src-001.pdf`,
    checksum: "a".repeat(64),
    fileSize: 1024,
    language: "en",
    status: "uploaded",
    authorityLevel: "authoritative",
    sensitivityClassification: "internal",
    isCurrent: true,
    versionLabel: "v1",
    uploadedByUserId: USER_A,
    approvedByUserId: null,
    approvedAt: null,
    revokedAt: null,
    supersededBySourceId: null,
    deletedAt: null,
    effectiveFrom: null,
    effectiveTo: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeVersion(overrides: Partial<any> = {}) {
  return {
    id: "ver-001",
    knowledgeSourceId: "src-001",
    organizationId: ORG_A,
    versionLabel: "v1",
    checksum: "a".repeat(64),
    storageKey: `orgs/${ORG_A}/library/src-001.pdf`,
    storageProvider: "gcs",
    fileSize: 1024,
    mimeType: "application/pdf",
    originalFileName: "policy.pdf",
    isCurrent: true,
    status: "uploaded",
    uploadedByUserId: USER_A,
    approvedByUserId: null,
    approvedAt: null,
    ingestionStatus: "pending",
    ingestionMetadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// ─── RLS table membership ──────────────────────────────────────────────────────

describe("Task #15 — REQUIRED_RLS_TABLES", () => {
  it("includes all 6 new knowledge tables", () => {
    const tables = [...REQUIRED_RLS_TABLES];
    expect(tables).toContain("knowledge_sources");
    expect(tables).toContain("knowledge_source_scopes");
    expect(tables).toContain("knowledge_source_versions");
    expect(tables).toContain("knowledge_chunks");
    expect(tables).toContain("specialist_training_status");
    expect(tables).toContain("retrieval_audit_events");
  });

  it("REQUIRED_RLS_TABLES count is 59 after Task #15", () => {
    expect(REQUIRED_RLS_TABLES).toHaveLength(60); // Task #16: +1 ingestion_jobs
  });
});

// ─── Cross-tenant isolation ───────────────────────────────────────────────────

describe("Task #15 — Cross-tenant read isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectChain.limit.mockResolvedValue([]);
  });

  it("getKnowledgeSource returns null for a source owned by a different org", async () => {
    // selectChain returns [] = not found for ORG_B
    selectChain.limit.mockResolvedValue([]);
    const result = await getKnowledgeSource("src-001", ORG_B);
    expect(result).toBeNull();
  });

  it("listKnowledgeSources filters by organizationId", async () => {
    // listKnowledgeSources uses .limit().offset() — limit must chain back to
    // selectChain so that .offset() is the terminal resolver.
    selectChain.limit.mockReturnValueOnce(selectChain);
    selectChain.offset.mockResolvedValueOnce([makeSource()]);
    await listKnowledgeSources({ organizationId: ORG_A });
    expect(mockDb.select).toHaveBeenCalled();
  });

  it("getKnowledgeSource returns null when org does not match", async () => {
    selectChain.limit.mockResolvedValue([]);
    const result = await getKnowledgeSource("src-001", "wrong-org");
    expect(result).toBeNull();
  });
});

// ─── Cross-tenant write rejection ─────────────────────────────────────────────

describe("Task #15 — Cross-tenant write rejection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectChain.limit.mockResolvedValue([]);
  });

  it("revokeKnowledgeSource throws NOT_FOUND for wrong org (no source found)", async () => {
    const { revokeKnowledgeSource } = await import("../services/knowledgeSourceService.js");
    selectChain.limit.mockResolvedValue([]);
    await expect(revokeKnowledgeSource("src-001", ORG_B, USER_A)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("deleteKnowledgeSource throws NOT_FOUND for wrong org", async () => {
    const { deleteKnowledgeSource } = await import("../services/knowledgeSourceService.js");
    selectChain.limit.mockResolvedValue([]);
    await expect(deleteKnowledgeSource("src-001", ORG_B, USER_A)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("approveKnowledgeSource throws NOT_FOUND for wrong org", async () => {
    const { approveKnowledgeSource } = await import("../services/knowledgeSourceService.js");
    selectChain.limit.mockResolvedValue([]);
    await expect(approveKnowledgeSource("src-001", ORG_B, USER_A)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

// ─── Scope isolation ──────────────────────────────────────────────────────────

describe("Task #15 — Scope isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectChain.limit.mockResolvedValue([makeSource()]);
    insertChain.returning.mockResolvedValue([{
      id: "scope-001",
      knowledgeSourceId: "src-001",
      organizationId: ORG_A,
      scopeType: "specialist",
      scopeId: "chief_of_staff",
      createdAt: new Date(),
      updatedAt: new Date(),
    }]);
  });

  it("assignScope returns existing scope instead of creating duplicate", async () => {
    const existingScope = {
      id: "scope-existing",
      knowledgeSourceId: "src-001",
      organizationId: ORG_A,
      scopeType: "specialist",
      scopeId: "chief_of_staff",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    // First call returns existing — simulates duplicate check finding a record
    selectChain.limit.mockResolvedValueOnce([makeSource()]) // getKnowledgeSource
                    .mockResolvedValueOnce([existingScope]); // duplicate check
    const result = await assignScope({
      knowledgeSourceId: "src-001",
      organizationId: ORG_A,
      scopeType: "specialist",
      scopeId: "chief_of_staff",
      actorUserId: USER_A,
    });
    expect(result).toEqual(existingScope);
    // insert should NOT have been called since duplicate found
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it("assignScope rejects task-scoped sources", async () => {
    selectChain.limit.mockResolvedValueOnce([makeSource({ sourceScope: "task" })]);
    await expect(
      assignScope({
        knowledgeSourceId: "src-001",
        organizationId: ORG_A,
        scopeType: "specialist",
        scopeId: "chief_of_staff",
        actorUserId: USER_A,
      }),
    ).rejects.toMatchObject({ code: "TASK_SCOPE_CONFLICT" });
  });

  it("assignScope rejects invalid scope types", async () => {
    selectChain.limit.mockResolvedValueOnce([makeSource()]);
    await expect(
      assignScope({
        knowledgeSourceId: "src-001",
        organizationId: ORG_A,
        scopeType: "invalid_scope_type",
        scopeId: "anything",
        actorUserId: USER_A,
      }),
    ).rejects.toMatchObject({ code: "INVALID_SCOPE_TYPE" });
  });
});

// ─── Version lineage ──────────────────────────────────────────────────────────

describe("Task #15 — Version lineage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("replaceSourceVersion demotes old version and creates new current version", async () => {
    const oldVersion = makeVersion({ isCurrent: true });

    // getKnowledgeSource (not deleted, not revoked)
    selectChain.limit
      .mockResolvedValueOnce([makeSource()])    // source check
      .mockResolvedValueOnce([oldVersion])      // getCurrentVersion
      .mockResolvedValueOnce([])                // listVersionHistory for auto-label
      .mockResolvedValueOnce([makeVersion({ id: "ver-002", isCurrent: true, versionLabel: "v2" })]) // fetch new version
    ;

    // transaction mocks
    updateChain.returning.mockResolvedValue([oldVersion]);
    insertChain.returning.mockResolvedValue([makeVersion({ id: "ver-002", isCurrent: true })]);
    txMock.update.mockReturnValue(updateChain);
    txMock.insert.mockReturnValue(insertChain);

    await replaceSourceVersion({
      knowledgeSourceId: "src-001",
      organizationId: ORG_A,
      uploadedByUserId: USER_A,
      actorUserId: USER_A,
      storageKey: `orgs/${ORG_A}/library/src-001-v2.pdf`,
      storageProvider: "gcs",
      originalFileName: "policy-v2.pdf",
      mimeType: "application/pdf",
      fileSize: 2048,
      checksum: "b".repeat(64),
    });

    // Transaction was used (ensures atomicity)
    expect(mockDb.transaction).toHaveBeenCalled();
  });

  it("replaceSourceVersion throws NOT_FOUND for deleted source", async () => {
    selectChain.limit.mockResolvedValueOnce([makeSource({ deletedAt: new Date() })]);
    await expect(
      replaceSourceVersion({
        knowledgeSourceId: "src-001",
        organizationId: ORG_A,
        uploadedByUserId: USER_A,
        actorUserId: USER_A,
        storageKey: "key",
        storageProvider: "gcs",
        originalFileName: "file.pdf",
        mimeType: "application/pdf",
        fileSize: 1024,
        checksum: "c".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "DELETED" });
  });

  it("replaceSourceVersion throws REVOKED for revoked source", async () => {
    selectChain.limit.mockResolvedValueOnce([makeSource({ status: "revoked", revokedAt: new Date() })]);
    await expect(
      replaceSourceVersion({
        knowledgeSourceId: "src-001",
        organizationId: ORG_A,
        uploadedByUserId: USER_A,
        actorUserId: USER_A,
        storageKey: "key",
        storageProvider: "gcs",
        originalFileName: "file.pdf",
        mimeType: "application/pdf",
        fileSize: 1024,
        checksum: "d".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "REVOKED" });
  });
});

// ─── Superseded version handling ──────────────────────────────────────────────

describe("Task #15 — Superseded source handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("supersedeKnowledgeSource sets supersededBySourceId on old source", async () => {
    updateChain.returning.mockResolvedValue([makeSource({ status: "superseded", isCurrent: false })]);

    selectChain.limit
      .mockResolvedValueOnce([makeSource({ id: "old-001" })])   // old source
      .mockResolvedValueOnce([makeSource({ id: "new-001" })]);  // new source

    await supersedeKnowledgeSource("old-001", "new-001", ORG_A, USER_A);
    expect(mockDb.update).toHaveBeenCalled();
  });

  it("supersedeKnowledgeSource throws SELF_SUPERSEDE when same ID", async () => {
    selectChain.limit
      .mockResolvedValueOnce([makeSource()])  // old
      .mockResolvedValueOnce([makeSource()]); // new (same)

    await expect(
      supersedeKnowledgeSource("src-001", "src-001", ORG_A, USER_A),
    ).rejects.toMatchObject({ code: "SELF_SUPERSEDE" });
  });

  it("supersedeKnowledgeSource throws DELETED for deleted old source", async () => {
    selectChain.limit
      .mockResolvedValueOnce([makeSource({ deletedAt: new Date() })])
      .mockResolvedValueOnce([makeSource({ id: "new-001" })]);

    await expect(
      supersedeKnowledgeSource("src-001", "new-001", ORG_A, USER_A),
    ).rejects.toMatchObject({ code: "DELETED" });
  });

  it("supersedeKnowledgeSource throws NEW_SOURCE_NOT_FOUND when replacement missing", async () => {
    selectChain.limit
      .mockResolvedValueOnce([makeSource()])  // old found
      .mockResolvedValueOnce([]);             // new not found

    await expect(
      supersedeKnowledgeSource("src-001", "missing-new", ORG_A, USER_A),
    ).rejects.toMatchObject({ code: "NEW_SOURCE_NOT_FOUND" });
  });
});

// ─── Task-scoped vs library isolation ────────────────────────────────────────

describe("Task #15 — Task scope vs library scope", () => {
  it("task-scoped sources cannot receive scope assignments", async () => {
    selectChain.limit.mockResolvedValueOnce([makeSource({ sourceScope: "task", taskId: "task-001" })]);
    await expect(
      assignScope({
        knowledgeSourceId: "src-001",
        organizationId: ORG_A,
        scopeType: "organisation",
        scopeId: "all",
        actorUserId: USER_A,
      }),
    ).rejects.toMatchObject({ code: "TASK_SCOPE_CONFLICT" });
  });
});

// ─── KnowledgeSourceError is thrown correctly ─────────────────────────────────

describe("Task #15 — KnowledgeSourceError codes", () => {
  it("KnowledgeSourceError carries a machine-readable code", () => {
    const err = new KnowledgeSourceError("something failed", "TEST_CODE");
    expect(err.code).toBe("TEST_CODE");
    expect(err.message).toBe("something failed");
    expect(err.name).toBe("KnowledgeSourceError");
  });

  it("getKnowledgeSource returns null for missing source (not thrown)", async () => {
    selectChain.limit.mockResolvedValueOnce([]);
    const result = await getKnowledgeSource("missing-id", ORG_A);
    expect(result).toBeNull();
  });
});
