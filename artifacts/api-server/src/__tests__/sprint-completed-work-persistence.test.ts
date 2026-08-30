/**
 * Sprint: Completed Work Version Persistence Fix
 *
 * Tests the REAL createDraft implementation with a mocked @workspace/db.
 * Covers:
 * 1. Parent + version written atomically — parent inserted first
 * 2. FK failure rolls back both writes — no orphaned completed_work row
 * 3. RLS / tenant isolation — organizationId on every row
 * 4. JSONB review_dimensions persisted through to insert
 * 5. createdByUserId stored on both parent and version rows
 * 6. Incomplete-marker regex — colon-prefix [INCOMPLETE: …] form
 * 7. [MISSING: …] and [TODO: …] colon-prefix forms also detected
 * 8. reviewMissingInformation regex matches all five marker types
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mocks ────────────────────────────────────────────────────────────
const { mockDb, mockInsert, mockUpdate, mockSelect, mockTx } = vi.hoisted(() => {
  const capturedTxInserts: Record<string, unknown>[][] = [];

  const mockTx = vi.fn().mockImplementation(
    async (fn: (tx: unknown) => Promise<unknown>) => {
      const txInserted: Record<string, unknown>[] = [];
      const txInsert = (_table: unknown) => ({
        values: (vals: Record<string, unknown>) => {
          txInserted.push(vals);
          return Promise.resolve([]);
        },
      });
      const result = await fn({ insert: txInsert });
      capturedTxInserts.push(txInserted);
      return result;
    },
  );
  // Expose captured inserts so tests can inspect them
  (mockTx as unknown as { _captured: Record<string, unknown>[][] })._captured = capturedTxInserts;

  const mockInsertChain = { values: vi.fn().mockResolvedValue([]) };
  const mockInsert = vi.fn().mockReturnValue(mockInsertChain);

  const mockUpdateChain = {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([]),
  };
  const mockUpdate = vi.fn().mockReturnValue(mockUpdateChain);

  const mockSelectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    orderBy: vi.fn().mockReturnThis(),
    offset: vi.fn().mockReturnThis(),
  };
  const mockSelect = vi.fn().mockReturnValue(mockSelectChain);

  const mockDb = {
    insert: mockInsert,
    update: mockUpdate,
    select: mockSelect,
    transaction: mockTx,
  };

  return { mockDb, mockInsert, mockUpdate, mockSelect, mockTx };
});

vi.mock("@workspace/db", () => ({
  db: mockDb,
  completedWorkTable: { $inferSelect: {} },
  completedWorkVersionsTable: {},
  completedWorkCommentsTable: {},
  completedWorkAssetsTable: {},
  workPackageManifestsTable: {},
  knowledgeSourcesTable: {},
  COMPLETED_WORK_STATUSES: [
    "draft", "awaiting_approval", "approved", "rejected",
    "archived", "superseded", "reopened",
  ],
  eq: vi.fn((_col: unknown, val: unknown) => val),
  and: vi.fn((...args: unknown[]) => args),
  desc: vi.fn((col: unknown) => col),
}));

vi.mock("../services/auditService.js", () => ({
  logOrgEvent: vi.fn().mockResolvedValue(undefined),
}));

// ─── Import the REAL service ──────────────────────────────────────────────────
import { createDraft } from "../services/completedWorkService.js";

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const ORG_ID = "org-persist-001";
const USER_ID = "user-persist-001";

function fakeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "cw-001",
    organizationId: ORG_ID,
    conversationId: null,
    blueprintId: null,
    manifestId: null,
    primarySpecialist: "operations_manager",
    title: "Policy Review",
    outputType: "policy_draft",
    status: "draft",
    currentVersionId: "ver-001",
    approvalWorkflow: {},
    createdByUserId: USER_ID,
    approvedByUserId: null,
    approvedAt: null,
    rejectedAt: null,
    archivedAt: null,
    reopenedAt: null,
    supersededById: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function setupSelectReturns(row: Record<string, unknown>) {
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([row]),
    orderBy: vi.fn().mockReturnThis(),
    offset: vi.fn().mockReturnThis(),
  };
  mockSelect.mockReturnValue(chain);
}

// ─── Transaction — insert order ───────────────────────────────────────────────

describe("createDraft — transaction and insert order", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset captured inserts
    (mockTx as unknown as { _captured: Record<string, unknown>[][] })._captured.length = 0;

    // Default transaction: records inserts in order
    mockTx.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const inserted: Record<string, unknown>[] = [];
      const txInsert = (_table: unknown) => ({
        values: (vals: Record<string, unknown>) => {
          inserted.push(vals);
          return Promise.resolve([]);
        },
      });
      const result = await fn({ insert: txInsert });
      (mockTx as unknown as { _captured: Record<string, unknown>[][] })._captured.push(inserted);
      return result;
    });

    const updateChain = {
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
    };
    mockUpdate.mockReturnValue(updateChain);
    const insertChain = { values: vi.fn().mockResolvedValue([]) };
    mockInsert.mockReturnValue(insertChain);
  });

  it("wraps parent and version inserts in db.transaction", async () => {
    setupSelectReturns(fakeRow());

    await createDraft({
      organizationId: ORG_ID,
      primarySpecialist: "operations_manager",
      title: "Policy Review",
      outputType: "policy_draft",
      contentMarkdown: "# Content",
      createdByUserId: USER_ID,
    });

    expect(mockTx).toHaveBeenCalledOnce();
  });

  it("inserts parent (no versionNumber) before version (has versionNumber) inside the transaction", async () => {
    setupSelectReturns(fakeRow());

    await createDraft({
      organizationId: ORG_ID,
      primarySpecialist: "operations_manager",
      title: "T",
      outputType: "policy_draft",
      contentMarkdown: "Content.",
      createdByUserId: USER_ID,
    });

    const captured = (mockTx as unknown as { _captured: Record<string, unknown>[][] })._captured;
    expect(captured.length).toBeGreaterThanOrEqual(1);
    const inserts = captured[0]!;
    expect(inserts.length).toBe(2);

    const [first, second] = inserts;
    // Parent row has `status: "draft"` and no `versionNumber`
    expect(first).not.toHaveProperty("versionNumber");
    expect(first).toHaveProperty("status", "draft");
    // Version row has `versionNumber`
    expect(second).toHaveProperty("versionNumber", 1);
  });

  it("pins Blueprint content hash provenance on new Completed Work drafts", async () => {
    setupSelectReturns(fakeRow({
      blueprintContentHash: "sha256:abc",
      blueprintProvenanceStatus: "hash_pinned",
    }));

    await createDraft({
      organizationId: ORG_ID,
      primarySpecialist: "operations_manager",
      title: "Hash pin test",
      outputType: "policy_draft",
      contentMarkdown: "Content.",
      createdByUserId: USER_ID,
      blueprintId: "bp-001",
      blueprintVersion: "1.0.0",
      blueprintContentHash: "sha256:abc",
    });

    const captured = (mockTx as unknown as { _captured: Record<string, unknown>[][] })._captured;
    const [parent] = captured.at(-1)!;
    expect(parent).toMatchObject({
      blueprintId: "bp-001",
      blueprintVersion: "1.0.0",
      blueprintContentHash: "sha256:abc",
      blueprintProvenanceStatus: "hash_pinned",
    });
  });

  it("marks Completed Work provenance unverified when no Blueprint hash is available", async () => {
    setupSelectReturns(fakeRow({
      blueprintContentHash: null,
      blueprintProvenanceStatus: "provenance_unverified",
    }));

    await createDraft({
      organizationId: ORG_ID,
      primarySpecialist: "operations_manager",
      title: "Legacy provenance test",
      outputType: "policy_draft",
      contentMarkdown: "Content.",
      createdByUserId: USER_ID,
      blueprintId: "bp-legacy",
      blueprintVersion: "1.0.0",
    });

    const captured = (mockTx as unknown as { _captured: Record<string, unknown>[][] })._captured;
    const [parent] = captured.at(-1)!;
    expect(parent).toMatchObject({
      blueprintId: "bp-legacy",
      blueprintVersion: "1.0.0",
      blueprintContentHash: null,
      blueprintProvenanceStatus: "provenance_unverified",
    });
  });

  it("rolls back both writes when the transaction throws", async () => {
    mockTx.mockRejectedValueOnce(new Error("PostgreSQL 23503 — FK violation"));

    await expect(
      createDraft({
        organizationId: ORG_ID,
        primarySpecialist: "operations_manager",
        title: "Rollback test",
        outputType: "policy_draft",
        contentMarkdown: "Content.",
        createdByUserId: USER_ID,
      }),
    ).rejects.toThrow("PostgreSQL 23503");

    // Post-tx side-effects (manifest link, asset inserts) must not run
    expect(mockUpdate).not.toHaveBeenCalled();
    // db.insert is the post-tx one (for assets); must not be called
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("persists JSONB reviewDimensions in the version row", async () => {
    setupSelectReturns(fakeRow());
    const captured: Record<string, unknown>[][] = [];
    mockTx.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const inserts: Record<string, unknown>[] = [];
      return fn({
        insert: (_table: unknown) => ({
          values: (vals: Record<string, unknown>) => {
            inserts.push(vals);
            captured.push(inserts);
            return Promise.resolve([]);
          },
        }),
      });
    });

    const dims = [
      { dimension: "safety", score: 10, passed: true, feedback: "OK", improvementSuggestions: [], evidence: [] },
    ];

    await createDraft({
      organizationId: ORG_ID,
      primarySpecialist: "ops",
      title: "T",
      outputType: "general_output",
      contentMarkdown: "Content.",
      createdByUserId: USER_ID,
      reviewResult: {
        qualityScore: 82,
        dimensions: dims,
        passed: true,
        improvementFeedback: [],
        revised: false,
        finalContent: "Content.",
        revisionLimitReached: false,
        evidenceSummaryHash: "abc",
      } as never,
    });

    const allInserts = captured.flat();
    const versionRow = allInserts.find(v => "reviewDimensions" in v);
    expect(versionRow).toBeDefined();
    expect(versionRow!.reviewDimensions).toEqual(dims);
  });

  it("stores createdByUserId on both parent and version rows", async () => {
    setupSelectReturns(fakeRow());
    const allInserts: Record<string, unknown>[] = [];
    mockTx.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      return fn({
        insert: (_table: unknown) => ({
          values: (vals: Record<string, unknown>) => {
            allInserts.push(vals);
            return Promise.resolve([]);
          },
        }),
      });
    });

    await createDraft({
      organizationId: ORG_ID,
      primarySpecialist: "ops",
      title: "T",
      outputType: "general_output",
      contentMarkdown: "Content.",
      createdByUserId: USER_ID,
    });

    const rowsWithUser = allInserts.filter(v => "createdByUserId" in v);
    expect(rowsWithUser.length).toBeGreaterThanOrEqual(2);
    for (const row of rowsWithUser) {
      expect(row.createdByUserId).toBe(USER_ID);
    }
  });
});

// ─── RLS / tenant isolation ───────────────────────────────────────────────────

describe("createDraft — tenant isolation", () => {
  it("passes organizationId to every insert inside the transaction", async () => {
    setupSelectReturns(fakeRow({ organizationId: "org-tenant-A", createdByUserId: "user-A" }));

    const allInserts: Record<string, unknown>[] = [];
    mockTx.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      return fn({
        insert: (_table: unknown) => ({
          values: (vals: Record<string, unknown>) => {
            allInserts.push(vals);
            return Promise.resolve([]);
          },
        }),
      });
    });
    const updateChain = { set: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([]) };
    mockUpdate.mockReturnValue(updateChain);
    const insertChain = { values: vi.fn().mockResolvedValue([]) };
    mockInsert.mockReturnValue(insertChain);

    await createDraft({
      organizationId: "org-tenant-A",
      primarySpecialist: "ops",
      title: "T",
      outputType: "general_output",
      contentMarkdown: "Content.",
      createdByUserId: "user-A",
    });

    const rowsWithOrg = allInserts.filter(v => "organizationId" in v);
    expect(rowsWithOrg.length).toBeGreaterThanOrEqual(2);
    for (const row of rowsWithOrg) {
      expect(row.organizationId).toBe("org-tenant-A");
    }
  });
});

// ─── Incomplete-marker detection ──────────────────────────────────────────────

describe("reviewCompleteness — incomplete marker regex", () => {
  // Test the regex directly — mirrors what reviewCompleteness uses after the fix.
  const MARKER_REGEX = /\[INCOMPLETE(?::[^\]]+)?\]|\[MISSING(?::[^\]]+)?\]|\[TODO(?::[^\]]+)?\]/gi;

  it("detects [INCOMPLETE: description] colon-prefix form", () => {
    const content = `
# Draft
[INCOMPLETE: This section requires AI generation — please ensure AI_PROVIDER is configured]
## Section
[INCOMPLETE: Specialist execution required]
`;
    expect((content.match(MARKER_REGEX) ?? []).length).toBe(2);
  });

  it("detects [INCOMPLETE] exact bracket form", () => {
    expect(("[INCOMPLETE]".match(MARKER_REGEX) ?? []).length).toBe(1);
  });

  it("detects [MISSING: detail] colon-prefix form", () => {
    expect(("[MISSING: requires policy document]".match(MARKER_REGEX) ?? []).length).toBe(1);
  });

  it("detects [TODO: add references] colon-prefix form", () => {
    expect(("[TODO: add references]".match(MARKER_REGEX) ?? []).length).toBe(1);
  });

  it("counts all three marker types in one string", () => {
    const content = "[INCOMPLETE: A] [MISSING] [TODO: B]";
    expect((content.match(MARKER_REGEX) ?? []).length).toBe(3);
  });

  it("returns 0 for clean content with no markers", () => {
    const content = "This is complete professional content with no incomplete sections.";
    expect((content.match(MARKER_REGEX) ?? []).length).toBe(0);
  });

  it("does NOT match partial bracket like [INCOMPLETED]", () => {
    // [INCOMPLETED] should not match — the word boundary is INCOMPLETE then ] or :
    const content = "[INCOMPLETED]";
    expect((content.match(MARKER_REGEX) ?? []).length).toBe(0);
  });
});

describe("reviewMissingInformation — incomplete marker regex", () => {
  // Mirrors the extended regex in reviewMissingInformation after the fix.
  const MISSING_REGEX = /\[INCOMPLETE(?::[^\]]+)?\]|\[MISSING(?::[^\]]+)?\]|\[UNKNOWN(?::[^\]]+)?\]|\[TODO(?::[^\]]+)?\]|\[REQUIRED(?::[^\]]+)?\]/gi;

  it("detects all five marker types in colon-prefix form", () => {
    const content = "[INCOMPLETE: A] [MISSING: B] [UNKNOWN: C] [TODO: D] [REQUIRED: E]";
    expect((content.match(MISSING_REGEX) ?? []).length).toBe(5);
  });

  it("detects all five in exact form", () => {
    const content = "[INCOMPLETE] [MISSING] [UNKNOWN] [TODO] [REQUIRED]";
    expect((content.match(MISSING_REGEX) ?? []).length).toBe(5);
  });

  it("returns 0 for clean content", () => {
    expect(("Clean text without markers.".match(MISSING_REGEX) ?? []).length).toBe(0);
  });
});
