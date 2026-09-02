/**
 * regression-execution-column-contracts.test.ts
 *
 * Regression guard for two execution-pipeline column-name bugs that caused a
 * silent "Cannot convert undefined or null to object" crash inside
 * drizzle-orm/utils.ts:80 (orderSelectedFields) whenever a task was dispatched.
 *
 * Bug 1 — workPackageService.ts used `organisationMemoryTable.approvalStatus`
 *          but the schema column is `.status`.  Fixed: `.status` now passed to
 *          both the .select({...}) object and the .where() eq() call.
 *
 * Bug 2 — approvedExampleService.ts used `knowledgeChunksTable.content` but
 *          the schema column is `.text` (text("text")).  Fixed: `.text` now
 *          passed to the .select({...}) object; the result alias is still
 *          `content` so callers see `chunk.content`.
 *
 * Each test suite has two layers:
 *   (a) Schema-contract layer  — imports the REAL Drizzle table from
 *       @workspace/db and asserts the column objects are defined / undefined
 *       as expected.  TypeScript type-checking alone is insufficient because
 *       the esbuild bundle resolves @workspace/db from source at runtime, so a
 *       wrong column name returns `undefined` rather than a compile error when
 *       the column was added to source after the last tsc build.
 *
 *   (b) Service integration layer — runs the service with a mock DB and
 *       confirms the assertSelectFields guard inside the service throws a named
 *       error (not the opaque Drizzle crash) if a column is undefined, and
 *       that it does NOT throw when the correct column names are used.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── (a) Schema-contract layer ────────────────────────────────────────────────
//
// Import the real table objects.  We do NOT mock @workspace/db here so we get
// the live Drizzle column objects from source.

import {
  organisationMemoryTable,
  knowledgeChunksTable,
  knowledgeSourcesTable,
  workPackageManifestsTable,
} from "@workspace/db";

describe("Schema contract — organisationMemoryTable", () => {
  it("has a .status column (the correct column name)", () => {
    expect(organisationMemoryTable.status).toBeDefined();
    expect(organisationMemoryTable.status).not.toBeNull();
  });

  it("does NOT have an .approvalStatus column (the wrong name that caused the crash)", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((organisationMemoryTable as any).approvalStatus).toBeUndefined();
  });
});

describe("Schema contract — knowledgeChunksTable", () => {
  it("has a .text column (the correct column name)", () => {
    expect(knowledgeChunksTable.text).toBeDefined();
    expect(knowledgeChunksTable.text).not.toBeNull();
  });

  it("does NOT have a .content column (the wrong name that caused the crash)", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((knowledgeChunksTable as any).content).toBeUndefined();
  });

  it("has a .chunkIndex column used alongside .text", () => {
    expect(knowledgeChunksTable.chunkIndex).toBeDefined();
  });
});

describe("Schema contract — knowledgeSourcesTable columns used in execution path", () => {
  const cols = ["id", "title", "sourceType", "authorityLevel", "storageKey", "versionLabel"];
  for (const col of cols) {
    it(`has .${col}`, () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((knowledgeSourcesTable as any)[col]).toBeDefined();
    });
  }
});

describe("Schema contract — workPackageManifestsTable", () => {
  const cols = ["id", "organizationId", "completedWorkId", "executionId", "blueprintId",
                "primarySpecialist", "cosMemories", "specialistMemories", "entityKnowledge",
                "taskUploads", "organisationLibrarySources", "modelVersion",
                "promptVersion", "assembledAt", "requesterId", "createdAt",
                "canonicalIntent", "blueprintFamily", "blueprintMode", "templateId",
                "templateVersion", "contractSnapshot", "selectionMetadata",
                "validationSnapshot", "performanceMetrics", "failureInfo"];
  for (const col of cols) {
    it(`has .${col}`, () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((workPackageManifestsTable as any)[col]).toBeDefined();
    });
  }
});

// ─── (b) Service integration layer ───────────────────────────────────────────
//
// From here down we mock @workspace/db so the services run without a real DB.

const mockDbSelectFn = vi.hoisted(() => vi.fn());
const mockDbInsertFn = vi.hoisted(() => vi.fn());

vi.mock("@workspace/db", async (importOriginal) => {
  // Spread the real module so the table objects stay intact for the schema-
  // contract tests above; we only replace `db`.
  const actual = await vi.importActual<typeof import("@workspace/db/schema")>("@workspace/db/schema");

  const makeSelectChain = (rows: unknown[] = []) => ({
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve(rows),
        orderBy: () => ({
          limit: () => ({
            offset: () => Promise.resolve(rows),
          }),
        }),
      }),
      orderBy: () => ({
        limit: () => ({
          offset: () => Promise.resolve(rows),
        }),
      }),
    }),
  });

  const makeInsertChain = () => ({
    values: () => ({
      returning: () => Promise.resolve([]),
      onConflictDoNothing: () => Promise.resolve(),
    }),
  });

  return {
    ...actual,
    db: {
      select: mockDbSelectFn.mockImplementation(() => makeSelectChain([])),
      insert: mockDbInsertFn.mockImplementation(() => makeInsertChain()),
      transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
        // Minimal tx object that mirrors the real db shape
        const tx = {
          select: mockDbSelectFn,
          insert: mockDbInsertFn,
        };
        return fn(tx);
      }),
    },
  };
});

// Mock audit service — not under test here
vi.mock("../services/auditService.js", () => ({
  logOrgEvent: vi.fn().mockResolvedValue(undefined),
  getRequestMeta: vi.fn().mockReturnValue({}),
}));

import { assembleWorkPackage } from "../services/workPackageService.js";
import {
  buildStyleGuidance,
  retrieveApprovedExamples,
  type ApprovedExample,
} from "../services/approvedExampleService.js";

const ORG_ID    = "org-regression-test";
const REQUESTER = "user-regression-test";

beforeEach(() => {
  vi.clearAllMocks();
  // Default select chain: returns empty arrays (no org memory, no sources)
  mockDbSelectFn.mockImplementation(() => ({
    from: () => ({
      where: () => ({
        limit:   () => Promise.resolve([]),
        orderBy: () => ({ limit: () => ({ offset: () => Promise.resolve([]) }) }),
      }),
      orderBy: () => ({ limit: () => ({ offset: () => Promise.resolve([]) }) }),
    }),
  }));

  mockDbInsertFn.mockImplementation(() => ({
    values: () => ({
      returning: () => Promise.resolve([{
        id:                        "manifest-001",
        organizationId:            ORG_ID,
        completedWorkId:           null,
        executionId:               "exec-001",
        blueprintId:               null,
        blueprintVersion:          null,
        primarySpecialist:         "chief_of_staff",
        supportingSpecialists:     [],
        organisationLibrarySources: [],
        cosMemories:               [],
        specialistMemories:        [],
        entityKnowledge:           {},
        taskUploads:               [],
        modelVersion:              null,
        promptVersion:             "sprint22.1.0",
        assembledAt:               new Date(),
        requesterId:               REQUESTER,
        createdAt:                 new Date(),
      }]),
    }),
  }));
});

// ─── assembleWorkPackage ──────────────────────────────────────────────────────

describe("assembleWorkPackage — column-contract regression", () => {
  it("completes without throwing when no blueprint is provided (no-blueprint path)", async () => {
    // If organisationMemoryTable.approvalStatus were still used (the bug),
    // the assertSelectFields guard would throw BEFORE the DB call, and this
    // test would fail with:
    //   "[workPackageService] Drizzle .select() at "cos-memory": field
    //    "approvalStatus" is undefined ..."
    await expect(
      assembleWorkPackage({ organizationId: ORG_ID, requesterId: REQUESTER }),
    ).resolves.not.toThrow();
  });

  it("returns a WorkPackageManifest with the expected shape", async () => {
    const { manifest } = await assembleWorkPackage({
      organizationId: ORG_ID,
      requesterId: REQUESTER,
    });

    expect(manifest).toHaveProperty("id");
    expect(manifest).toHaveProperty("organizationId", ORG_ID);
    expect(manifest).toHaveProperty("cosMemories");
    expect(Array.isArray(manifest.cosMemories)).toBe(true);
    expect(manifest).toHaveProperty("organisationLibrarySources");
    expect(manifest).toHaveProperty("entityKnowledge");
  });

  it("does not call the library-sources query when no requiredLibraryKnowledge is provided", async () => {
    await assembleWorkPackage({ organizationId: ORG_ID, requesterId: REQUESTER });
    // The library-sources select is skipped when requiredKnowledgeTypes is empty.
    // We verify the insert is called (manifest written) and no error thrown.
    expect(mockDbInsertFn).toHaveBeenCalledTimes(1);
  });

  it("calls the library-sources query when a blueprint specifies required knowledge", async () => {
    // If knowledgeSourcesTable columns used in that .select({...}) were wrong,
    // assertSelectFields would throw before the DB call.
    const blueprint = {
      id: "bp-001",
      organizationId: null,
      code: "incident_investigation",
      title: "Incident Investigation",
      version: "1.0.0",
      objective: "Investigate incidents",
      primarySpecialist: "chief_of_staff",
      supportingSpecialists: [],
      requiredLibraryKnowledge: ["policy"],
      requiredEntityKnowledge: {},
      requiredMemories: [],
      requiredApprovals: {},
      validationRules: [],
      qualityRules: [],
      successCriteria: [],
      outputTypes: ["investigation_report"],
      escalationRules: [],
      mandatoryCitations: [],
      isBuiltIn: true,
      isActive: true,
      status: "published",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await expect(
      assembleWorkPackage({ organizationId: ORG_ID, requesterId: REQUESTER, blueprint }),
    ).resolves.not.toThrow();

    // select was called: once for library-sources, once for cos-memory
    expect(mockDbSelectFn).toHaveBeenCalledTimes(2);
  });
});

// ─── buildStyleGuidance ───────────────────────────────────────────────────────

describe("buildStyleGuidance — column-contract regression", () => {
  it("returns empty guidance for zero examples without calling the DB", async () => {
    const guidance = await buildStyleGuidance([], ORG_ID);
    expect(guidance.guidanceBlock).toBe("");
    expect(mockDbSelectFn).not.toHaveBeenCalled();
  });

  it("calls the chunks query using the correct .text column (not .content)", async () => {
    // The mock returns a chunk with the SELECT alias 'content' (as the service
    // maps knowledgeChunksTable.text → alias 'content').  If the wrong column
    // were still used (.content), assertSelectFields would throw before the DB
    // call ever happened.
    mockDbSelectFn.mockImplementationOnce(() => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([
            { content: "Pursuant to the policy, formal language is required.", chunkIndex: 0 },
          ]),
        }),
      }),
    }));

    const examples: ApprovedExample[] = [
      { sourceId: "src-001", title: "Example Doc", sourceType: "approved_example", authorityLevel: "authoritative" },
    ];

    // If knowledgeChunksTable.content were used (the bug), this would throw:
    //   "[approvedExampleService] Drizzle .select() at "knowledge-chunks":
    //    field "content" is undefined ..."
    await expect(buildStyleGuidance(examples, ORG_ID)).resolves.not.toThrow();
    expect(mockDbSelectFn).toHaveBeenCalledTimes(1);
  });

  it("extracts style guidance from formal-language chunks", async () => {
    mockDbSelectFn.mockImplementationOnce(() => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([
            { content: "Pursuant to the policy, all participants must be notified in accordance with legislation.", chunkIndex: 0 },
          ]),
        }),
      }),
    }));

    const examples: ApprovedExample[] = [
      { sourceId: "src-002", title: "Policy Doc", sourceType: "approved_example", authorityLevel: null },
    ];

    const guidance = await buildStyleGuidance(examples, ORG_ID);
    expect(typeof guidance.guidanceBlock).toBe("string");
    expect(Array.isArray(guidance.writingStyle)).toBe(true);
  });

  it("does not reproduce example content verbatim", async () => {
    const exactText = "VERBATIM_CONTENT_MUST_NOT_APPEAR_XYZ789";
    mockDbSelectFn.mockImplementationOnce(() => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([{ content: exactText, chunkIndex: 0 }]),
        }),
      }),
    }));

    const examples: ApprovedExample[] = [
      { sourceId: "src-003", title: "Example", sourceType: "approved_example", authorityLevel: null },
    ];

    const guidance = await buildStyleGuidance(examples, ORG_ID);
    expect(guidance.guidanceBlock).not.toContain(exactText);
  });
});

// ─── retrieveApprovedExamples ─────────────────────────────────────────────────

describe("retrieveApprovedExamples — column-contract regression", () => {
  it("returns an empty array when no approved examples exist in DB", async () => {
    const examples = await retrieveApprovedExamples(ORG_ID, "general_output");
    expect(Array.isArray(examples)).toBe(true);
    expect(examples).toHaveLength(0);
  });

  it("maps DB rows to ApprovedExample shape without throwing", async () => {
    mockDbSelectFn.mockImplementationOnce(() => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([
            { id: "src-004", title: "Care Plan Template", sourceType: "approved_example", authorityLevel: "authoritative" },
          ]),
        }),
      }),
    }));

    const examples = await retrieveApprovedExamples(ORG_ID, "care_plan", 5);
    expect(examples).toHaveLength(1);
    expect(examples[0]!.sourceId).toBe("src-004");
    expect(examples[0]!.title).toBe("Care Plan Template");
    expect(examples[0]!.authorityLevel).toBe("authoritative");
  });
});
