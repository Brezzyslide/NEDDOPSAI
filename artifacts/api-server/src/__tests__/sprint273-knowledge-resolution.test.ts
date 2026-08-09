/**
 * Sprint 27.3 — Knowledge Resolution & Evidence Delivery Engine
 *
 * Tests covering:
 *   1. KnowledgeResolutionService — evidence retrieval and EvidencePack assembly
 *   2. buildEvidenceSection — prompt section contains chunk text, not just metadata
 *   3. replaceSourceVersion — approval status preserved, ingestion auto-enqueued
 *   4. supersedeKnowledgeSource — ingestion enqueued after supersede
 *   5. selectBlueprint / classifyBlueprintWithLLM — keyword fast path + LLM semantic fallback
 *   6. buildEvidenceSection — uses AUTHORITATIVE EVIDENCE section
 *   7. Regression: specialist receives evidence content, not document titles
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock declarations (vi.hoisted — must be first per sprint15 convention) ───

const mocks = vi.hoisted(() => ({
  // hybridRetrievalService
  retrieveChunks: vi.fn(),
  // ingestion queue
  ingestionQueueInstance: { enqueue: vi.fn() },
  // AI gateway
  gatewayProcess: vi.fn(),
  // curation
  enqueueCurationJobAsync: vi.fn(),
  // audit
  logOrgEvent: vi.fn(),
  // db transaction
  dbTransaction: vi.fn(),
}));

// ─── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("../services/hybridRetrievalService.js", () => ({
  retrieveChunks: mocks.retrieveChunks,
  computeFreshnessBonus: vi.fn().mockReturnValue(0),
  computeAuthorityBonus: vi.fn().mockReturnValue(0),
}));

vi.mock("../lib/ingestionQueue/index.js", () => ({
  getIngestionQueue: () => mocks.ingestionQueueInstance,
  _resetQueueInstance: vi.fn(),
}));

vi.mock("@workspace/ai-gateway", () => ({
  createAIGateway: () => ({ process: mocks.gatewayProcess }),
  // Sprint 29N.5: generateQueryEmbedding calls isOpenAIConfigured before attempting
  // any embedding API call. Returning false causes a null embedding (lexical-only
  // fallback) — tests remain deterministic and no OpenAI call is made.
  isOpenAIConfigured:    vi.fn().mockReturnValue(false),
  callOpenAIEmbeddings:  vi.fn(),
  getEmbeddingDimensions: vi.fn().mockReturnValue(1536),
}));

vi.mock("../services/knowledgeCurationService.js", () => ({
  enqueueCurationJobAsync: mocks.enqueueCurationJobAsync,
}));

vi.mock("../services/auditService.js", () => ({
  logOrgEvent: mocks.logOrgEvent,
}));

// ─── DB mock factory ───────────────────────────────────────────────────────────
// Creates a fully-chainable, thenable mock for `db.select()...`.
// `.where()` and `.limit()` both resolve — the chain handles both patterns:
//   db.select().from().where()            (resolves via where)
//   db.select().from().where().limit(n)   (resolves via limit)
//
// The factory wires up the chain so that calling `.limit()` overrides what
// `.where()` resolves to, keeping behaviour deterministic in both code paths.

function makeSelectChain(limitResult: unknown[], whereResult?: unknown[]) {
  const limitFn = vi.fn().mockResolvedValue(limitResult);
  const orderByChain = { limit: limitFn };
  // `.where()` resolves to `whereResult ?? limitResult` so that code that
  // awaits `.where()` directly (no .limit()) still gets an array.
  const wherePromise = Promise.resolve(whereResult ?? limitResult);
  const whereFn = vi.fn().mockReturnValue(
    Object.assign(wherePromise, { limit: limitFn, orderBy: vi.fn().mockReturnValue(orderByChain) }),
  );
  const fromFn = vi.fn().mockReturnValue({ where: whereFn });
  return { from: fromFn, where: whereFn, limit: limitFn };
}

vi.mock("@workspace/db", () => {
  const makeDefaultChain = () => makeSelectChain([]);

  const selectFn = vi.fn().mockImplementation(() => makeDefaultChain());

  return {
    db: {
      select: selectFn,
      insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
      update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) }),
      transaction: mocks.dbTransaction,
    },
    knowledgeChunksTable: {
      id: "id", organizationId: "organization_id", knowledgeSourceId: "knowledge_source_id",
      sourceVersionId: "source_version_id", chunkIndex: "chunk_index", sectionTitle: "section_title",
      pageNumber: "page_number", text: "text", tokenCount: "token_count",
    },
    knowledgeSourcesTable: {
      id: "id", organizationId: "organization_id", status: "status", isCurrent: "is_current",
      sourceScope: "source_scope", sourceType: "source_type", versionLabel: "version_label",
      checksum: "checksum", storageKey: "storage_key", fileSize: "file_size", mimeType: "mime_type",
      originalFileName: "original_file_name", supersededBySourceId: "superseded_by_source_id",
      updatedAt: "updated_at", title: "title",
    },
    knowledgeSourceVersionsTable: {
      id: "id", knowledgeSourceId: "knowledge_source_id", organizationId: "organization_id",
      versionLabel: "version_label", isCurrent: "is_current", status: "status",
      supersededById: "superseded_by_id", updatedAt: "updated_at", ingestionStatus: "ingestion_status",
    },
    organisationMemoryTable: { id: "id", organizationId: "organization_id", status: "status", memoryType: "memory_type", title: "title" },
    workBlueprintsTable: {
      id: "id", code: "code", title: "title", objective: "objective",
      primarySpecialist: "primary_specialist", organizationId: "organization_id",
      isActive: "is_active", status: "status",
    },
    ingestionJobsTable: { id: "id", organizationId: "organization_id", sourceVersionId: "source_version_id" },
    INGESTION_JOB_STATUSES: ["queued"],
    INGESTION_JOB_TRANSITIONS: {},
  };
});

// ─── Test helpers ──────────────────────────────────────────────────────────────

type RawChunk = import("../services/hybridRetrievalService.js").RawChunk;
type WorkPackageManifest = import("../services/workPackageService.js").WorkPackageManifest;

function makeRawChunk(overrides: Partial<RawChunk> = {}): RawChunk {
  return {
    id: "chunk-1", knowledgeSourceId: "src-1", sourceVersionId: "ver-1",
    chunkIndex: 0, sectionTitle: "Section 4 — Medication Administration", pageNumber: 4,
    headingPath: null, tokenCount: 150, embeddingModel: null, contentHash: null,
    text: "All medications must be administered by a qualified registered nurse.",
    sourceTitle: "Medication Administration Policy", authorityLevel: "mandatory",
    sensitivityClassification: "internal", sourceScope: "library", taskId: null,
    effectiveFrom: null, effectiveTo: null, isCurrent: true,
    semanticScore: 0.82, lexicalScore: 0.75, baseScore: 0.78,
    ...overrides,
  };
}

function makeManifest(overrides: Partial<WorkPackageManifest> = {}): WorkPackageManifest {
  return {
    id: "manifest-1", executionId: "exec-1", organizationId: "org-1",
    primarySpecialist: "operations_manager", supportingSpecialists: [],
    organisationLibrarySources: [{
      sourceId: "src-1", title: "Medication Administration Policy",
      sourceType: "policy", authorityLevel: "mandatory", storageKey: null, versionLabel: "v3",
    }],
    cosMemories: [], specialistMemories: [], taskUploads: [], entityKnowledge: {},
    blueprintId: null, blueprintVersion: null, modelVersion: null,
    promptVersion: "1.0.0", assembledAt: new Date(),
    ...overrides,
  } as WorkPackageManifest;
}

// Wires db.select() to return specific results for sequential calls.
// Each call to selectFn() returns the next chain in the sequence.
async function wireSelectSequence(results: Array<unknown[]>) {
  const { db } = await import("@workspace/db");
  const selectFn = vi.mocked(db.select);
  // Build each one-time chain
  const chains = results.map(r => makeSelectChain(r));
  selectFn.mockReset();
  for (const chain of chains) {
    selectFn.mockImplementationOnce(() => chain);
  }
  // After all one-time values, fall back to empty array
  selectFn.mockImplementation(() => makeSelectChain([]));
}

// ─── 1. KnowledgeResolutionService ───────────────────────────────────────────

describe("knowledgeResolutionService", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.retrieveChunks.mockResolvedValue([]);
    mocks.ingestionQueueInstance.enqueue.mockResolvedValue({ id: "job-1" });
    mocks.enqueueCurationJobAsync.mockResolvedValue(undefined);
    mocks.logOrgEvent.mockResolvedValue(undefined);
  });

  it("returns an EvidencePack with chunks when hybridRetrieval returns results", async () => {
    const { resolveEvidence, clearEvidenceCache } = await import("../services/knowledgeResolutionService.js");
    clearEvidenceCache();

    mocks.retrieveChunks.mockResolvedValueOnce([makeRawChunk()]).mockResolvedValue([]);
    // version labels query
    await wireSelectSequence([
      [{ id: "ver-1", versionLabel: "v3" }],
      [{ id: "src-1", sourceType: "policy" }],
    ]);

    const pack = await resolveEvidence({
      organisationId: "org-1", specialistCode: "operations_manager",
      blueprint: null, workPackage: makeManifest(), userRequest: "medication administration",
    });

    expect(pack.totalChunks).toBeGreaterThan(0);
    expect(pack.chunks[0].text).toContain("qualified registered nurse");
    expect(pack.chunks[0].sourceTitle).toBe("Medication Administration Policy");
    expect(pack.sourceIds).toContain("src-1");
  });

  it("groups chunks by sourceType in citationsByType", async () => {
    const { resolveEvidence, clearEvidenceCache } = await import("../services/knowledgeResolutionService.js");
    clearEvidenceCache();

    mocks.retrieveChunks.mockResolvedValueOnce([
      makeRawChunk({ id: "c1", knowledgeSourceId: "src-pol", sourceVersionId: "ver-1" }),
      makeRawChunk({ id: "c2", knowledgeSourceId: "src-leg", sourceVersionId: "ver-2", sourceTitle: "Disability Services Act" }),
    ]).mockResolvedValue([]);

    await wireSelectSequence([
      [{ id: "ver-1", versionLabel: "v2" }, { id: "ver-2", versionLabel: "v1" }],
      [{ id: "src-pol", sourceType: "policy" }, { id: "src-leg", sourceType: "legislation" }],
    ]);

    const pack = await resolveEvidence({
      organisationId: "org-1", specialistCode: "operations_manager",
      blueprint: null,
      workPackage: makeManifest({
        executionId: "exec-group",
        organisationLibrarySources: [
          { sourceId: "src-pol", title: "Policy", sourceType: "policy", authorityLevel: "mandatory", storageKey: null, versionLabel: null },
          { sourceId: "src-leg", title: "Legislation", sourceType: "legislation", authorityLevel: "primary", storageKey: null, versionLabel: null },
        ],
      }),
      userRequest: "incident investigation",
    });

    expect(pack.citationsByType).toHaveProperty("policy");
    expect(pack.citationsByType).toHaveProperty("legislation");
  });

  it("excludes chunks below minimum confidence threshold (< 0.05)", async () => {
    const { resolveEvidence, clearEvidenceCache } = await import("../services/knowledgeResolutionService.js");
    clearEvidenceCache();

    mocks.retrieveChunks.mockResolvedValueOnce([makeRawChunk({ baseScore: 0.01 })]).mockResolvedValue([]);
    await wireSelectSequence([[], []]);

    const pack = await resolveEvidence({
      organisationId: "org-1", specialistCode: "ops", blueprint: null,
      workPackage: makeManifest({ executionId: "exec-conf" }), userRequest: "query",
    });

    expect(pack.totalChunks).toBe(0);
  });

  it("returns a cache hit on second call for same executionId", async () => {
    const { resolveEvidence, clearEvidenceCache } = await import("../services/knowledgeResolutionService.js");
    clearEvidenceCache();

    mocks.retrieveChunks.mockResolvedValue([]);
    await wireSelectSequence([[], []]);

    const manifest = makeManifest({ executionId: "exec-cached", organisationLibrarySources: [] });
    await resolveEvidence({ organisationId: "org-1", specialistCode: "ops", blueprint: null, workPackage: manifest, userRequest: "q" });
    const callCount = mocks.retrieveChunks.mock.calls.length;

    const pack2 = await resolveEvidence({ organisationId: "org-1", specialistCode: "ops", blueprint: null, workPackage: manifest, userRequest: "q" });
    expect(mocks.retrieveChunks.mock.calls.length).toBe(callCount);
    expect(pack2.retrievalMetrics.cacheHit).toBe(true);
  });

  it("includes task upload chunks retrieved by source ID", async () => {
    const { resolveEvidence, clearEvidenceCache } = await import("../services/knowledgeResolutionService.js");
    clearEvidenceCache();

    mocks.retrieveChunks.mockResolvedValue([]);

    // Wire the task-upload chunk query (retrieveTaskUploadChunks uses db.select.from.where.orderBy.limit)
    const { db } = await import("@workspace/db");
    const taskChunks = [{ id: "tc-1", knowledgeSourceId: "upload-src-1", sourceVersionId: "uv-1", chunkIndex: 0, sectionTitle: null, pageNumber: null, text: "Participant intake form details", tokenCount: 50 }];

    vi.mocked(db.select).mockReset();
    // First call: task upload chunks query (orderBy.limit pattern)
    vi.mocked(db.select).mockImplementationOnce(() => {
      const limitFn = vi.fn().mockResolvedValue(taskChunks);
      const orderByChain = { limit: limitFn };
      const orderByFn = vi.fn().mockReturnValue(orderByChain);
      const whereFn = vi.fn().mockReturnValue({ orderBy: orderByFn, limit: limitFn });
      return { from: vi.fn().mockReturnValue({ where: whereFn }) };
    });
    // Second call: version labels for upload chunks
    vi.mocked(db.select).mockImplementationOnce(() => makeSelectChain([{ id: "uv-1", versionLabel: "v1" }]));

    const manifest = makeManifest({
      executionId: "exec-upload",
      organisationLibrarySources: [],
      taskUploads: [{ sourceId: "upload-src-1", title: "Participant Intake Form", sourceType: "intake_form", storageKey: null }],
    });

    const pack = await resolveEvidence({
      organisationId: "org-1", specialistCode: "operations_manager",
      blueprint: null, workPackage: manifest, userRequest: "care plan for participant",
    });

    expect(pack.totalChunks).toBeGreaterThan(0);
    expect(pack.chunks.some(c => c.sourceType === "task_upload")).toBe(true);
    expect(pack.chunks.some(c => c.text.includes("Participant intake form details"))).toBe(true);
  });

  it("respects organisation boundary — organisationId always scoped to correct org", async () => {
    const { resolveEvidence, clearEvidenceCache } = await import("../services/knowledgeResolutionService.js");
    clearEvidenceCache();

    mocks.retrieveChunks.mockResolvedValue([]);
    await wireSelectSequence([[], []]);

    await resolveEvidence({
      organisationId: "org-specific", specialistCode: "ops", blueprint: null,
      workPackage: makeManifest({
        executionId: "exec-boundary",
        organizationId: "org-specific",
        organisationLibrarySources: [{
          sourceId: "src-boundary", title: "Boundary Policy", sourceType: "policy",
          authorityLevel: "mandatory", storageKey: null, versionLabel: null,
        }],
      }),
      userRequest: "query",
    });

    expect(mocks.retrieveChunks).toHaveBeenCalledWith(
      expect.objectContaining({ organisationId: "org-specific" })
    );
  });
});

// ─── 2. buildEvidenceSection ──────────────────────────────────────────────────

describe("buildEvidenceSection", () => {
  const makePack = (chunks: ReturnType<typeof makeEvidenceChunk>[]) => {
    const byType: Record<string, unknown[]> = {};
    for (const c of chunks) {
      if (!byType[c.sourceType]) byType[c.sourceType] = [];
      (byType[c.sourceType] as unknown[]).push(c);
    }
    return { totalChunks: chunks.length, chunks, citationsByType: byType };
  };

  const makeEvidenceChunk = (id: string, sourceType: string, text: string, overrides = {}) => ({
    chunkId: id, sourceId: id, sourceTitle: `${sourceType} document`, versionLabel: "v1",
    sourceType, authorityLevel: "mandatory", sectionTitle: "Section 1", pageNumber: 1,
    text, confidence: 0.8, citation: `${sourceType} document, v1, Section 1, p.1`,
    selectionReason: "library", ...overrides,
  });

  it("returns a section containing chunk TEXT, not just document titles", async () => {
    const { buildEvidenceSection } = await import("../services/knowledgeResolutionService.js");

    const chunk = makeEvidenceChunk("c1", "policy", "All medications must be administered by a qualified registered nurse.", {
      sourceTitle: "Medication Policy", versionLabel: "v2",
      sectionTitle: "Section 4", pageNumber: 4,
      citation: "Medication Policy, v2, Section 4, p.4",
    });
    const pack = makePack([chunk]);

    const section = buildEvidenceSection(pack as never);

    expect(section).toContain("=== AUTHORITATIVE EVIDENCE ===");
    expect(section).toContain("--- Organisation Policy ---");
    // Must contain actual chunk text
    expect(section).toContain("All medications must be administered by a qualified registered nurse");
    // Citation tag must be present
    expect(section).toContain("[Medication Policy, v2, Section 4, p.4]");
  });

  it("orders sections: legislation before policy before procedure", async () => {
    const { buildEvidenceSection } = await import("../services/knowledgeResolutionService.js");

    const pack = makePack([
      makeEvidenceChunk("a", "policy", "Policy text"),
      makeEvidenceChunk("b", "legislation", "Legislation text"),
    ]);

    const section = buildEvidenceSection(pack as never);
    const legPos = section.indexOf("--- Legislation ---");
    const polPos = section.indexOf("--- Organisation Policy ---");
    expect(legPos).toBeGreaterThan(-1);
    expect(polPos).toBeGreaterThan(-1);
    expect(legPos).toBeLessThan(polPos); // legislation before policy
  });

  it("returns empty string when pack has no chunks", async () => {
    const { buildEvidenceSection } = await import("../services/knowledgeResolutionService.js");
    const pack = makePack([]);
    expect(buildEvidenceSection(pack as never)).toBe("");
  });

  it("does NOT contain metadata-only fallback title list when evidence pack is used", async () => {
    const { buildEvidenceSection } = await import("../services/knowledgeResolutionService.js");

    const pack = makePack([makeEvidenceChunk("c1", "policy", "Policy text with actual content here.")]);
    const section = buildEvidenceSection(pack as never);

    // Must contain actual text, not the metadata fallback notation
    expect(section).toContain("Policy text with actual content here");
    expect(section).not.toContain("content not yet indexed");
  });
});

// ─── 3. replaceSourceVersion — status preservation & ingestion trigger ────────

describe("knowledgeSourceService.replaceSourceVersion", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.ingestionQueueInstance.enqueue.mockResolvedValue({ id: "job-1" });
    mocks.logOrgEvent.mockResolvedValue(undefined);
    mocks.enqueueCurationJobAsync.mockResolvedValue(undefined);
  });

  const APPROVED_SOURCE = {
    id: "src-1", organizationId: "org-1", status: "approved", isCurrent: true,
    title: "Medication Policy", sourceScope: "library", sourceType: "policy",
    storageKey: "old.pdf", deletedAt: null, version: "v1",
  };

  const REPLACE_INPUT = {
    knowledgeSourceId: "src-1", organizationId: "org-1",
    storageKey: "new.pdf", storageProvider: "gcs" as const, checksum: "abc123",
    fileSize: 1024, mimeType: "application/pdf", originalFileName: "new-policy.pdf",
    uploadedByUserId: "user-1", actorUserId: "user-1",
  };

  it("does NOT reset status to 'uploaded' when current source is approved", async () => {
    const { db } = await import("@workspace/db");

    // Capture the set() call on knowledge_sources update
    let sourceUpdateFields: Record<string, unknown> | null = null;
    let txCallCount = 0;

    vi.mocked(mocks.dbTransaction).mockImplementation(async (fn: (tx: unknown) => Promise<void>) => {
      txCallCount++;
      const updateSetMock = vi.fn().mockImplementation((fields: Record<string, unknown>) => {
        // Capture the SECOND set() call (first is for version, second is for source)
        if (txCallCount > 0) sourceUpdateFields = fields;
        return { where: vi.fn().mockResolvedValue(undefined) };
      });
      const tx = {
        update: vi.fn().mockReturnValue({ set: updateSetMock }),
        insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
      };
      await fn(tx);
    });

    vi.mocked(db.select)
      .mockReset()
      // getKnowledgeSource (source lookup)
      .mockImplementationOnce(() => makeSelectChain([APPROVED_SOURCE]))
      // getCurrentVersion (old version lookup)
      .mockImplementationOnce(() => makeSelectChain([{ id: "ver-old", isCurrent: true, status: "approved" }]))
      // listVersionHistory (for version label generation)
      .mockImplementationOnce(() => makeSelectChain([{ id: "ver-old" }]))
      // new version fetch after transaction
      .mockImplementationOnce(() => makeSelectChain([{ id: "ver-new", versionLabel: "v2" }]));

    const { replaceSourceVersion } = await import("../services/knowledgeSourceService.js");
    await replaceSourceVersion(REPLACE_INPUT);

    // The update to knowledge_sources must NOT include status: "uploaded"
    expect(sourceUpdateFields).not.toBeNull();
    expect(sourceUpdateFields).not.toHaveProperty("status");
  });

  it("automatically enqueues an ingestion job after version replacement", async () => {
    const { db } = await import("@workspace/db");

    vi.mocked(mocks.dbTransaction).mockImplementation(async (fn: (tx: unknown) => Promise<void>) => {
      const tx = {
        update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) }),
        insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
      };
      await fn(tx);
    });

    vi.mocked(db.select)
      .mockReset()
      .mockImplementationOnce(() => makeSelectChain([APPROVED_SOURCE]))
      .mockImplementationOnce(() => makeSelectChain([{ id: "ver-old", isCurrent: true }]))
      .mockImplementationOnce(() => makeSelectChain([{ id: "ver-old" }]))
      .mockImplementationOnce(() => makeSelectChain([{ id: "ver-new-2", versionLabel: "v2" }]));

    const { replaceSourceVersion } = await import("../services/knowledgeSourceService.js");
    await replaceSourceVersion(REPLACE_INPUT);

    // Allow the fire-and-forget to settle
    await new Promise(r => setTimeout(r, 20));

    expect(mocks.ingestionQueueInstance.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        knowledgeSourceId: "src-1",
        actorUserId: "user-1",
      })
    );
  });
});

// ─── 4. supersedeKnowledgeSource — ingestion enqueued ────────────────────────

describe("knowledgeSourceService.supersedeKnowledgeSource", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.ingestionQueueInstance.enqueue.mockResolvedValue({ id: "job-1" });
    mocks.logOrgEvent.mockResolvedValue(undefined);
    mocks.enqueueCurationJobAsync.mockResolvedValue(undefined);
  });

  it("enqueues ingestion for the new source after supersede", async () => {
    const { db } = await import("@workspace/db");

    vi.mocked(db.select)
      .mockReset()
      // First two: getKnowledgeSource calls (old + new)
      .mockImplementationOnce(() => makeSelectChain([{ id: "old-1", organizationId: "org-1", status: "approved", deletedAt: null }]))
      .mockImplementationOnce(() => makeSelectChain([{ id: "new-1", organizationId: "org-1", status: "approved", deletedAt: null }]))
      // update on old source
      ;
    vi.mocked(db.update).mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) } as never);

    // getCurrentVersion calls (new source version + old source version — deferred)
    // These happen inside a .then() chain so we wire them after the fact
    let versionCallCount = 0;
    vi.mocked(db.select).mockImplementation(() => {
      versionCallCount++;
      if (versionCallCount === 1) return makeSelectChain([{ id: "nv-1", versionLabel: "v1" }]);
      if (versionCallCount === 2) return makeSelectChain([{ id: "ov-1", versionLabel: "v1" }]);
      return makeSelectChain([]);
    });

    const { supersedeKnowledgeSource } = await import("../services/knowledgeSourceService.js");
    await supersedeKnowledgeSource("old-1", "new-1", "org-1", "user-1");

    // The deferred promise chain needs a moment to settle
    await new Promise(r => setTimeout(r, 30));

    expect(mocks.ingestionQueueInstance.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        knowledgeSourceId: "new-1",
        actorUserId: "user-1",
      })
    );
  });
});

// ─── 5. selectBlueprint — keyword fast path + LLM semantic fallback ───────────

describe("selectBlueprint / classifyBlueprintWithLLM", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.ingestionQueueInstance.enqueue.mockResolvedValue({ id: "job-1" });
    mocks.logOrgEvent.mockResolvedValue(undefined);
    mocks.gatewayProcess.mockResolvedValue({ content: null, usedFallback: true });
    delete process.env.AI_PROVIDER;
  });

  const FULL_BLUEPRINT = {
    id: "bp-1", code: "care_plan", title: "Care Plan", version: "1.0",
    objective: "Create a comprehensive care plan", primarySpecialist: "operations_manager",
    organizationId: null, isActive: true, status: "published",
    supportingSpecialists: [], requiredLibraryKnowledge: [], requiredEntityKnowledge: {},
    requiredMemories: [], requiredApprovals: {}, validationRules: [], qualityRules: [],
    successCriteria: [], outputTypes: ["care_plan"], escalationRules: [],
    mandatoryCitations: [], isBuiltIn: true, createdAt: new Date(), updatedAt: new Date(),
  };

  it("uses keyword fast path — 'care plan' matches care_plan blueprint, LLM never called", async () => {
    const { db } = await import("@workspace/db");
    vi.mocked(db.select)
      .mockReset()
      .mockImplementationOnce(() => makeSelectChain([]))             // org blueprints → none
      .mockImplementationOnce(() => makeSelectChain([FULL_BLUEPRINT])); // built-in → found

    const { selectBlueprint } = await import("../services/workBlueprintService.js");
    const result = await selectBlueprint("Please create a care plan for the participant", "org-1");

    expect(mocks.gatewayProcess).not.toHaveBeenCalled();
    expect(result.blueprint).not.toBeNull();
    expect(result.blueprint!.code).toBe("care_plan");
    expect(result.blueprint!.primarySpecialist).toBe("operations_manager");
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.fallbackUsed).toBe(false);
  });

  it("uses keyword fast path — 'support plan' matches care_plan blueprint", async () => {
    const { db } = await import("@workspace/db");
    vi.mocked(db.select)
      .mockReset()
      .mockImplementationOnce(() => makeSelectChain([]))
      .mockImplementationOnce(() => makeSelectChain([FULL_BLUEPRINT]));

    const { selectBlueprint } = await import("../services/workBlueprintService.js");
    const result = await selectBlueprint("Create a support plan for Jane Smith", "org-1");

    expect(result.blueprint!.primarySpecialist).toBe("operations_manager");
    expect(mocks.gatewayProcess).not.toHaveBeenCalled();
  });

  it("org-published blueprint takes precedence over built-in for same code", async () => {
    const orgBlueprint = { ...FULL_BLUEPRINT, organizationId: "org-1", id: "bp-org" };
    const { db } = await import("@workspace/db");
    vi.mocked(db.select)
      .mockReset()
      .mockImplementationOnce(() => makeSelectChain([orgBlueprint])); // org blueprint found first

    const { selectBlueprint } = await import("../services/workBlueprintService.js");
    const result = await selectBlueprint("care plan for participant", "org-1");

    expect(result.blueprint!.id).toBe("bp-org");
    expect(mocks.gatewayProcess).not.toHaveBeenCalled();
  });

  it("falls back to LLM classifier when no keyword matches", async () => {
    process.env.AI_PROVIDER = "openai";
    const { db } = await import("@workspace/db");

    vi.mocked(db.select)
      .mockReset()
      // allRows query in classifyBlueprintWithLLM
      .mockImplementationOnce(() => makeSelectChain([FULL_BLUEPRINT]))
      // full blueprint fetch after LLM classification
      .mockImplementationOnce(() => makeSelectChain([FULL_BLUEPRINT]));

    mocks.gatewayProcess.mockResolvedValue({
      content: JSON.stringify({ blueprintCode: "care_plan", confidence: 0.88, reasoning: "matches care plan intent" }),
      usedFallback: false,
    });

    const { selectBlueprint } = await import("../services/workBlueprintService.js");
    const result = await selectBlueprint("I need a comprehensive plan developed for my new participant", "org-1");

    expect(mocks.gatewayProcess).toHaveBeenCalled();
    expect(result.blueprint!.code).toBe("care_plan");
    expect(result.confidence).toBeCloseTo(0.88);
    expect(result.fallbackUsed).toBe(false);

    delete process.env.AI_PROVIDER;
  });

  it("returns null blueprint when LLM confidence is below 0.6 threshold", async () => {
    process.env.AI_PROVIDER = "openai";
    const { db } = await import("@workspace/db");

    vi.mocked(db.select).mockReset()
      .mockImplementation(() => makeSelectChain([FULL_BLUEPRINT]));

    mocks.gatewayProcess.mockResolvedValue({
      content: JSON.stringify({ blueprintCode: "care_plan", confidence: 0.45, reasoning: "Uncertain" }),
      usedFallback: false,
    });

    const { selectBlueprint } = await import("../services/workBlueprintService.js");
    const result = await selectBlueprint("Could you tell me about your services?", "org-1");

    expect(result.blueprint).toBeNull();
    expect(result.fallbackUsed).toBe(true);

    delete process.env.AI_PROVIDER;
  });

  it("skips LLM when AI_PROVIDER is not openai", async () => {
    process.env.AI_PROVIDER = "internal";

    const { selectBlueprint } = await import("../services/workBlueprintService.js");
    const result = await selectBlueprint("This request has absolutely no keyword matches lalala xyz", "org-1");

    expect(mocks.gatewayProcess).not.toHaveBeenCalled();
    expect(result.blueprint).toBeNull();
    expect(result.fallbackUsed).toBe(true);
  });

  it("returns null gracefully when LLM returns invalid JSON", async () => {
    process.env.AI_PROVIDER = "openai";
    const { db } = await import("@workspace/db");

    vi.mocked(db.select).mockReset()
      .mockImplementation(() => makeSelectChain([FULL_BLUEPRINT]));

    mocks.gatewayProcess.mockResolvedValue({ content: "not json at all!", usedFallback: false });

    const { selectBlueprint } = await import("../services/workBlueprintService.js");
    const result = await selectBlueprint("request with absolutely no matching keywords", "org-1");

    expect(result.blueprint).toBeNull();
    expect(result.fallbackUsed).toBe(true);

    delete process.env.AI_PROVIDER;
  });

  it("CoS remains default when request is casual conversation", async () => {
    process.env.AI_PROVIDER = "internal"; // prevent LLM call

    const { selectBlueprint } = await import("../services/workBlueprintService.js");
    const result = await selectBlueprint("Hi, how are you today?", "org-1");

    expect(result.blueprint).toBeNull();
    expect(result.fallbackUsed).toBe(true);
  });

  it("classifyBlueprintWithLLM is exported and callable directly", async () => {
    process.env.AI_PROVIDER = "internal"; // skip real LLM call
    const { classifyBlueprintWithLLM } = await import("../services/workBlueprintService.js");

    const result = await classifyBlueprintWithLLM("any request", "org-1");

    expect(result.blueprint).toBeNull();
    expect(result.fallbackUsed).toBe(true);

    delete process.env.AI_PROVIDER;
  });
});

// ─── 6. buildWorkPackagePrompt — AUTHORITATIVE EVIDENCE section ───────────────

describe("buildEvidenceSection prompt content", () => {
  it("includes AUTHORITATIVE EVIDENCE with chunk text, not metadata titles", async () => {
    const { buildEvidenceSection } = await import("../services/knowledgeResolutionService.js");

    const pack = {
      totalChunks: 1, chunks: [], citationsByType: {
        policy: [{
          chunkId: "c1", sourceId: "s1", sourceTitle: "Safe Medication Policy",
          versionLabel: "v3", sourceType: "policy", authorityLevel: "mandatory",
          sectionTitle: "Section 2", pageNumber: 2,
          text: "Medications must be stored at controlled temperature.",
          confidence: 0.9, citation: "Safe Medication Policy, v3, Section 2, p.2",
          selectionReason: "library",
        }],
      },
    };

    const section = buildEvidenceSection(pack as never);

    expect(section).toContain("=== AUTHORITATIVE EVIDENCE ===");
    expect(section).toContain("Medications must be stored at controlled temperature");
    expect(section).not.toMatch(/^- .+\[policy/m); // NOT a metadata list
  });
});

// ─── 7. Regression tests ─────────────────────────────────────────────────────

describe("regression: knowledge delivery architecture", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.retrieveChunks.mockResolvedValue([]);
    mocks.ingestionQueueInstance.enqueue.mockResolvedValue({ id: "job-1" });
    mocks.enqueueCurationJobAsync.mockResolvedValue(undefined);
    mocks.logOrgEvent.mockResolvedValue(undefined);
  });

  it("buildCitationSummary returns JSON-serialisable citation records", async () => {
    const { buildCitationSummary } = await import("../services/knowledgeResolutionService.js");

    const pack = {
      chunks: [{
        chunkId: "c1", sourceId: "s1", sourceTitle: "Policy", versionLabel: "v1",
        sourceType: "policy", authorityLevel: "mandatory", sectionTitle: "S1",
        pageNumber: 1, text: "...", confidence: 0.9, citation: "Policy, v1, S1, p.1",
        selectionReason: "library",
      }],
    };

    const summary = buildCitationSummary(pack as never);

    expect(Array.isArray(summary)).toBe(true);
    expect(summary[0]).toMatchObject({ chunkId: "c1", sourceId: "s1", confidence: 0.9 });
    expect(() => JSON.stringify(summary)).not.toThrow();
  });

  it("invalidateEvidenceCache forces fresh retrieval on next call", async () => {
    const { resolveEvidence, invalidateEvidenceCache, clearEvidenceCache } = await import("../services/knowledgeResolutionService.js");
    clearEvidenceCache();
    mocks.retrieveChunks.mockResolvedValue([]);
    await wireSelectSequence([[], []]);

    // Manifest must have at least one source so retrieveChunks is actually called
    const manifest = makeManifest({
      executionId: "exec-inval",
      organisationLibrarySources: [{
        sourceId: "src-inval", title: "Inval Policy", sourceType: "policy",
        authorityLevel: "mandatory", storageKey: null, versionLabel: null,
      }],
    });

    await resolveEvidence({ organisationId: "org-1", specialistCode: "ops", blueprint: null, workPackage: manifest, userRequest: "q" });
    const callsAfterFirst = mocks.retrieveChunks.mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0); // retrieval did happen

    // Second call with same executionId — should be served from cache, no extra retrieveChunks calls
    const pack2 = await resolveEvidence({ organisationId: "org-1", specialistCode: "ops", blueprint: null, workPackage: manifest, userRequest: "q" });
    expect(mocks.retrieveChunks.mock.calls.length).toBe(callsAfterFirst); // no new calls
    expect(pack2.retrievalMetrics.cacheHit).toBe(true);

    // Now invalidate and re-run — retrieveChunks should be called again
    invalidateEvidenceCache("exec-inval");
    mocks.retrieveChunks.mockResolvedValue([]);
    await wireSelectSequence([[], []]);

    await resolveEvidence({ organisationId: "org-1", specialistCode: "ops", blueprint: null, workPackage: manifest, userRequest: "q" });
    expect(mocks.retrieveChunks.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });

  it("citationRef is set in assetIds map from evidence pack source IDs", () => {
    // Tests the logic executeWork uses to build assetIds with citationRef
    const evidencePack = {
      chunks: [
        { sourceId: "lib-src-1", citation: "Medication Policy, v3, S4, p.4", confidence: 0.9, sourceTitle: "Medication Policy", versionLabel: "v3", sourceType: "policy" },
        { sourceId: "upload-src-1", citation: "Participant Form", confidence: 0.8, sourceTitle: "Participant Form", versionLabel: null, sourceType: "task_upload" },
      ],
    };

    const citationRefBySourceId = new Map<string, string>();
    for (const chunk of evidencePack.chunks) {
      if (!citationRefBySourceId.has(chunk.sourceId)) {
        citationRefBySourceId.set(chunk.sourceId, chunk.citation);
      }
    }

    expect(citationRefBySourceId.get("lib-src-1")).toBe("Medication Policy, v3, S4, p.4");
    expect(citationRefBySourceId.get("upload-src-1")).toBe("Participant Form");
    expect(citationRefBySourceId.get("unknown-src")).toBeUndefined();
  });
});
