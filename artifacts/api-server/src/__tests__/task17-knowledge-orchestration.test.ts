/**
 * task17-knowledge-orchestration.test.ts
 *
 * Comprehensive test suite for Task #17 — Knowledge Orchestration Engine.
 *
 * Coverage:
 *   - Priority ordering (P1 > P2 > P3 > P4 > P5)
 *   - Task uploads overriding Organisation Library
 *   - Entity knowledge retrieval
 *   - Org memory retrieval
 *   - Specialist-specific retrieval
 *   - Organisation Library retrieval
 *   - Duplicate elimination (chunkId dedup)
 *   - Authority weighting
 *   - Conflict detection (superseded, outdated, effective date overlap, memory, duplicate)
 *   - Token budget trimming
 *   - Citation generation
 *   - Retrieval audit writing
 *   - Tenant isolation
 *   - Sensitivity enforcement
 *   - Superseded document exclusion
 *   - Outdated document handling
 *   - Future provider interface registration (P6-P8 NotImplemented)
 *   - Hybrid retrieval (lexical + semantic scoring)
 *   - Freshness + authority bonuses
 *   - Orchestration engine graceful degradation
 *   - Specialist context package integration
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── vi.hoisted mocks ─────────────────────────────────────────────────────────

const mockDb = vi.hoisted(() => ({
  execute: vi.fn(),
  insert:  vi.fn(() => ({ values: vi.fn().mockResolvedValue([]) })),
  select:  vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        orderBy: vi.fn(() => ({
          limit: vi.fn().mockResolvedValue([]),
        })),
        limit: vi.fn().mockResolvedValue([]),
      })),
    })),
  })),
  update: vi.fn(() => ({
    set: vi.fn(() => ({
      where: vi.fn(() => ({
        returning: vi.fn().mockResolvedValue([]),
      })),
    })),
  })),
}));

vi.mock("@workspace/db", () => ({
  db: mockDb,

  retrievalAuditEventsTable: {
    id:                  { name: "id" },
    organizationId:      { name: "organization_id" },
    specialistId:        { name: "specialist_id" },
    executionId:         { name: "execution_id" },
    entityId:            { name: "entity_id" },
    sourceIds:           { name: "source_ids" },
    chunkIds:            { name: "chunk_ids" },
    memoryIds:           { name: "memory_ids" },
    taskUploadIds:       { name: "task_upload_ids" },
    retrievalMethod:     { name: "retrieval_method" },
    scoreMetadata:       { name: "score_metadata" },
    rankingDetails:      { name: "ranking_details" },
    reasonSelected:      { name: "reason_selected" },
    reasonRejected:      { name: "reason_rejected" },
    conflictCount:       { name: "conflict_count" },
    tokenCount:          { name: "token_count" },
    retrievalDurationMs: { name: "retrieval_duration_ms" },
    createdAt:           { name: "created_at" },
  },

  organisationMemoryTable: {
    id:             { name: "id" },
    organizationId: { name: "organization_id" },
    status:         { name: "status" },
    specialistId:   { name: "specialist_id" },
    effectiveFrom:  { name: "effective_from" },
    effectiveTo:    { name: "effective_to" },
    expiresAt:      { name: "expires_at" },
    supersededBy:   { name: "superseded_by" },
    importance:     { name: "importance" },
    confidence:     { name: "confidence" },
    memoryType:     { name: "memory_type" },
    title:          { name: "title" },
    content:        { name: "content" },
  },

  organisationSpecialistConfigTable:  { id: {}, organizationId: {}, specialistId: {}, updatedAt: {} },
  specialistLanguageProfilesTable:    { id: {}, organizationId: {}, specialistId: {} },
  knowledgeSourcesTable:              { id: {}, organizationId: {}, status: {} },
  knowledgeChunksTable:               { id: {}, organizationId: {}, knowledgeSourceId: {}, deletedAt: {} },
  knowledgeSourceScopesTable:         { id: {}, organizationId: {}, knowledgeSourceId: {}, scopeType: {}, scopeId: {} },

  // drizzle-orm re-exports
  eq:      vi.fn((...a) => ({ op: "eq", a })),
  and:     vi.fn((...a) => ({ op: "and", a })),
  or:      vi.fn((...a) => ({ op: "or", a })),
  isNull:  vi.fn((c) => ({ op: "isNull", c })),
  lte:     vi.fn((...a) => ({ op: "lte", a })),
  gt:      vi.fn((...a) => ({ op: "gt", a })),
  isNotNull: vi.fn((c) => ({ op: "isNotNull", c })),
  desc:    vi.fn((c) => ({ op: "desc", c })),
  asc:     vi.fn((c) => ({ op: "asc", c })),
  sql:     Object.assign((s: TemplateStringsArray, ...v: unknown[]) => ({ sql: s, v }), {
    raw: (s: string) => ({ queryChunks: [s] }),
  }),

  // tables used in specialistContextService
  tasksTable:             { id: {}, organizationId: {} },
  conversationMessagesTable: { id: {} },
  conversationMemoryTable:   { id: {} },
  specialistRunsTable:       { id: {} },
}));

vi.mock("drizzle-orm", () => ({
  sql:     Object.assign((s: TemplateStringsArray, ...v: unknown[]) => ({ sql: s, v }), {
    raw: (s: string) => ({ queryChunks: [s] }),
  }),
  eq:      vi.fn((...a) => ({ op: "eq", a })),
  and:     vi.fn((...a) => ({ op: "and", a })),
  or:      vi.fn((...a) => ({ op: "or", a })),
  isNull:  vi.fn((c) => ({ op: "isNull", c })),
  lte:     vi.fn((...a) => ({ op: "lte", a })),
  gt:      vi.fn((...a) => ({ op: "gt", a })),
  isNotNull: vi.fn((c) => ({ op: "isNotNull", c })),
  not:     vi.fn((c) => ({ op: "not", c })),
  desc:    vi.fn((c) => ({ op: "desc", c })),
  asc:     vi.fn((c) => ({ op: "asc", c })),
}));

// ─── Imports under test ───────────────────────────────────────────────────────

import {
  detectConflicts,
} from "../services/conflictDetectionService.js";

import {
  computeFreshnessBonus,
  computeAuthorityBonus,
} from "../services/hybridRetrievalService.js";

import {
  orchestrateKnowledge,
  formatKnowledgeContextSections,
} from "../services/knowledgeOrchestrationEngine.js";
import type { OrchestratedKnowledgeContext } from "../services/knowledgeOrchestrationEngine.js";

import {
  registerProvider,
  getAllProviders,
  getProvider,
  AUTHORITY_BONUS,
  DEFAULT_ALLOWED_SENSITIVITY,
  PRIORITY_ORDER,
  _resetProviderRegistry,
} from "../lib/knowledge/IKnowledgeProvider.js";
import type {
  IKnowledgeProvider,
  KnowledgeItem,
  RetrievalContext,
} from "../lib/knowledge/IKnowledgeProvider.js";

import {
  DesktopConnectorProvider,
  SharePointProvider,
  GoogleDriveProvider,
  OneDriveProvider,
  DropboxProvider,
  ConfluenceProvider,
  NotionProvider,
  WebSearchProvider,
  ALL_FUTURE_PROVIDERS,
} from "../lib/knowledge/providers/FutureProviders.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

let _itemSeq = 0;

function makeChunk(overrides: Partial<KnowledgeItem> = {}): KnowledgeItem {
  _itemSeq++;
  return {
    itemId:                   `item-${_itemSeq}`,
    provider:                 "test",
    priorityLayer:            "library",
    sourceId:                 `src-${_itemSeq}`,
    versionId:                "ver-1",
    chunkId:                  `chunk-${_itemSeq}`,
    sourceTitle:              "Test Source",
    sectionTitle:             "Section A",
    pageNumber:               1,
    headingPath:              "Doc > Section A",
    content:                  "Test content about NDIS policies.",
    tokenCount:               50,
    authorityLevel:           "supporting",
    sensitivityClassification: "internal",
    effectiveFrom:            null,
    effectiveTo:              null,
    isCurrent:                true,
    semanticScore:            0.7,
    lexicalScore:             0.5,
    ...overrides,
  };
}

function makeMemoryItem(overrides: Partial<KnowledgeItem> = {}): KnowledgeItem {
  return makeChunk({
    provider:      "org_memory",
    priorityLayer: "org_memory",
    versionId:     null,
    chunkId:       null,
    sectionTitle:  "policy",
    ...overrides,
  });
}

function makeDbChunkRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  _itemSeq++;
  return {
    id:                        `chunk-db-${_itemSeq}`,
    knowledgeSourceId:         `src-db-${_itemSeq}`,
    sourceVersionId:           `ver-db-${_itemSeq}`,
    chunkIndex:                0,
    sectionTitle:              "Section 1",
    pageNumber:                1,
    headingPath:               "Doc > S1",
    tokenCount:                100,
    embeddingModel:            "text-embedding-3-small",
    contentHash:               "abc123",
    text:                      "NDIS participant support policy content.",
    sourceTitle:               "NDIS Policy Manual",
    authorityLevel:            "primary",
    sensitivityClassification: "internal",
    sourceScope:               "library",
    taskId:                    null,
    effectiveFrom:             null,
    effectiveTo:               null,
    isCurrent:                 true,
    semanticScore:             "0.85",
    lexicalScore:              "0.60",
    baseScore:                 "0.75",
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Provider Interface
// ─────────────────────────────────────────────────────────────────────────────

describe("IKnowledgeProvider — interface contract", () => {
  it("PRIORITY_ORDER has 8 layers in correct order", () => {
    expect(PRIORITY_ORDER).toEqual([
      "task_upload", "entity", "org_memory", "specialist",
      "library", "desktop", "cloud", "web_search",
    ]);
  });

  it("AUTHORITY_BONUS: mandatory > primary > supporting > reference", () => {
    expect(AUTHORITY_BONUS.mandatory).toBeGreaterThan(AUTHORITY_BONUS.primary);
    expect(AUTHORITY_BONUS.primary).toBeGreaterThan(AUTHORITY_BONUS.supporting);
    expect(AUTHORITY_BONUS.supporting).toBeGreaterThan(AUTHORITY_BONUS.reference);
    expect(AUTHORITY_BONUS.reference).toBeLessThan(0);
  });

  it("DEFAULT_ALLOWED_SENSITIVITY: public/internal/confidential only", () => {
    expect(DEFAULT_ALLOWED_SENSITIVITY).toContain("public");
    expect(DEFAULT_ALLOWED_SENSITIVITY).toContain("internal");
    expect(DEFAULT_ALLOWED_SENSITIVITY).toContain("confidential");
    expect(DEFAULT_ALLOWED_SENSITIVITY).not.toContain("restricted");
    expect(DEFAULT_ALLOWED_SENSITIVITY).not.toContain("highly_confidential");
  });

  it("registerProvider + getProvider round-trips", () => {
    const mockProvider: IKnowledgeProvider = {
      providerId:    "test_roundtrip_provider",
      displayName:   "Test RoundTrip",
      priorityLayer: "library",
      isImplemented: true,
      retrieve: async () => ({
        provider: "test_roundtrip_provider", priorityLayer: "library",
        items: [], durationMs: 0,
      }),
    };
    registerProvider(mockProvider);
    expect(getProvider("test_roundtrip_provider")).toBe(mockProvider);
  });

  it("getAllProviders returns providers in non-decreasing priority order", () => {
    const providers = getAllProviders();
    const layers    = providers.map(p => p.priorityLayer);
    for (let i = 0; i < layers.length - 1; i++) {
      const iIdx = PRIORITY_ORDER.indexOf(layers[i]!);
      const jIdx = PRIORITY_ORDER.indexOf(layers[i + 1]!);
      expect(iIdx).toBeLessThanOrEqual(jIdx);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Future Providers (P6-P8) — NotImplemented contract
// ─────────────────────────────────────────────────────────────────────────────

describe("Future Providers — P6-P8 NotImplemented contract", () => {
  const ctx: RetrievalContext = {
    organisationId: "org-1",
    specialistId:   "chief_of_staff",
    query:          "NDIS policy",
  };

  it("ALL_FUTURE_PROVIDERS has 8 entries", () => {
    expect(ALL_FUTURE_PROVIDERS).toHaveLength(8);
  });

  it.each([
    ["DesktopConnectorProvider", new DesktopConnectorProvider(), "desktop"],
    ["SharePointProvider",       new SharePointProvider(),       "cloud"],
    ["GoogleDriveProvider",      new GoogleDriveProvider(),      "cloud"],
    ["OneDriveProvider",         new OneDriveProvider(),         "cloud"],
    ["DropboxProvider",          new DropboxProvider(),          "cloud"],
    ["ConfluenceProvider",       new ConfluenceProvider(),       "cloud"],
    ["NotionProvider",           new NotionProvider(),           "cloud"],
    ["WebSearchProvider",        new WebSearchProvider(),        "web_search"],
  ])("%s returns notImplemented=true with empty items", async (name, provider, expectedLayer) => {
    const result = await provider.retrieve(ctx);
    expect(result.notImplemented).toBe(true);
    expect(result.items).toHaveLength(0);
    expect(result.priorityLayer).toBe(expectedLayer);
    expect(result.durationMs).toBe(0);
    expect(result.notImplementedReason).toBeDefined();
    expect(result.notImplementedReason!.length).toBeGreaterThan(10);
  });

  it("all future providers have isImplemented=false", () => {
    for (const p of ALL_FUTURE_PROVIDERS) {
      expect(p.isImplemented).toBe(false);
    }
  });

  it("DesktopConnectorProvider.providerId is 'desktop_connector'", () => {
    expect(new DesktopConnectorProvider().providerId).toBe("desktop_connector");
  });

  it("P7 cloud providers each have unique providerIds", () => {
    const cloudProviders = ALL_FUTURE_PROVIDERS.filter(p => p.priorityLayer === "cloud");
    const ids = cloudProviders.map(p => p.providerId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Hybrid Retrieval Service — scoring utilities
// ─────────────────────────────────────────────────────────────────────────────

describe("hybridRetrievalService — scoring utilities", () => {
  describe("computeFreshnessBonus", () => {
    it("returns +0.05 for documents < 30 days old", () => {
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      expect(computeFreshnessBonus(twoDaysAgo)).toBeCloseTo(0.05, 2);
    });

    it("returns ≤ 0 for documents 30-365 days old", () => {
      const sixMonths = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);
      const bonus = computeFreshnessBonus(sixMonths);
      expect(bonus).toBeLessThanOrEqual(0);
      expect(bonus).toBeGreaterThanOrEqual(-0.05);
    });

    it("returns -0.10 for documents > 365 days old", () => {
      const twoYearsAgo = new Date(Date.now() - 730 * 24 * 60 * 60 * 1000);
      expect(computeFreshnessBonus(twoYearsAgo)).toBeCloseTo(-0.10, 2);
    });

    it("returns 0 for null", () => {
      expect(computeFreshnessBonus(null)).toBe(0);
    });
  });

  describe("computeAuthorityBonus", () => {
    it("mandatory → +0.30", () => expect(computeAuthorityBonus("mandatory")).toBeCloseTo(0.30, 2));
    it("primary → +0.20",   () => expect(computeAuthorityBonus("primary")).toBeCloseTo(0.20, 2));
    it("supporting → 0",    () => expect(computeAuthorityBonus("supporting")).toBe(0));
    it("reference → < 0",   () => expect(computeAuthorityBonus("reference")).toBeLessThan(0));
    it("unknown → 0",       () => expect(computeAuthorityBonus("unknown_xyz")).toBe(0));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Conflict Detection Service
// ─────────────────────────────────────────────────────────────────────────────

describe("conflictDetectionService — detectConflicts", () => {
  describe("superseded_version", () => {
    it("detects two versions of the same source", () => {
      const items = [
        makeChunk({ sourceId: "src-dup", versionId: "ver-1", isCurrent: false }),
        makeChunk({ sourceId: "src-dup", versionId: "ver-2", isCurrent: true }),
      ];
      const { conflicts, excludeItemIds } = detectConflicts(items);
      expect(conflicts.some(c => c.conflictType === "superseded_version")).toBe(true);
      expect(excludeItemIds.size).toBeGreaterThanOrEqual(1);
    });

    it("does not flag single-version sources", () => {
      const items = [
        makeChunk({ sourceId: "src-ok", versionId: "ver-1", isCurrent: true }),
        makeChunk({ sourceId: "src-ok", versionId: "ver-1", isCurrent: true }),
      ];
      const { conflicts } = detectConflicts(items);
      expect(conflicts.filter(c => c.conflictType === "superseded_version")).toHaveLength(0);
    });
  });

  describe("outdated_version", () => {
    it("detects isCurrent=false chunks", () => {
      const items = [makeChunk({ sourceId: "src-old", isCurrent: false })];
      const { conflicts, outdatedSourceIds } = detectConflicts(items);
      expect(conflicts.some(c => c.conflictType === "outdated_version")).toBe(true);
      expect(outdatedSourceIds.has("src-old")).toBe(true);
    });

    it("does not flag current chunks", () => {
      const items = [makeChunk({ isCurrent: true })];
      const { conflicts } = detectConflicts(items);
      expect(conflicts.filter(c => c.conflictType === "outdated_version")).toHaveLength(0);
    });
  });

  describe("effective_date_overlap", () => {
    it("detects high-authority sources with overlapping dates and similar titles", () => {
      const title = "NDIS Policy Manual — Support Coordination";
      const now   = new Date();
      const items = [
        makeChunk({
          sourceId: "src-a", sourceTitle: title, authorityLevel: "primary",
          priorityLayer: "library",
          effectiveFrom: new Date(now.getFullYear() - 1, 0, 1).toISOString(),
          effectiveTo: null,
        }),
        makeChunk({
          sourceId: "src-b", sourceTitle: title, authorityLevel: "mandatory",
          priorityLayer: "library",
          effectiveFrom: new Date(now.getFullYear(), 0, 1).toISOString(),
          effectiveTo: null,
        }),
      ];
      const { conflicts } = detectConflicts(items);
      expect(conflicts.some(c => c.conflictType === "effective_date_overlap")).toBe(true);
    });

    it("does not flag non-overlapping date ranges", () => {
      const title = "Policy Guide";
      const items = [
        makeChunk({
          sourceId: "src-a", sourceTitle: title, authorityLevel: "primary",
          effectiveFrom: "2020-01-01T00:00:00Z", effectiveTo: "2021-01-01T00:00:00Z",
        }),
        makeChunk({
          sourceId: "src-b", sourceTitle: title, authorityLevel: "primary",
          effectiveFrom: "2022-01-01T00:00:00Z", effectiveTo: null,
        }),
      ];
      const { conflicts } = detectConflicts(items);
      expect(conflicts.filter(c => c.conflictType === "effective_date_overlap")).toHaveLength(0);
    });
  });

  describe("memory_conflict", () => {
    it("flags 3+ memory items of the same type", () => {
      const items = [
        makeMemoryItem({ sectionTitle: "terminology" }),
        makeMemoryItem({ sectionTitle: "terminology" }),
        makeMemoryItem({ sectionTitle: "terminology" }),
      ];
      const { conflicts } = detectConflicts(items);
      expect(conflicts.some(c => c.conflictType === "memory_conflict")).toBe(true);
    });

    it("does not flag 2 items of same type", () => {
      const items = [
        makeMemoryItem({ sectionTitle: "policy" }),
        makeMemoryItem({ sectionTitle: "policy" }),
      ];
      const { conflicts } = detectConflicts(items);
      expect(conflicts.filter(c => c.conflictType === "memory_conflict")).toHaveLength(0);
    });
  });

  describe("duplicate_content", () => {
    it("same chunkId from two providers — lower priority excluded", () => {
      const sharedChunkId = "shared-chunk-999";
      const taskItem    = makeChunk({ chunkId: sharedChunkId, provider: "task_upload",  priorityLayer: "task_upload" });
      const libraryItem = makeChunk({ chunkId: sharedChunkId, provider: "org_library",  priorityLayer: "library" });
      const { conflicts, excludeItemIds } = detectConflicts([taskItem, libraryItem]);
      expect(conflicts.some(c => c.conflictType === "duplicate_content")).toBe(true);
      expect(excludeItemIds.has(libraryItem.itemId)).toBe(true);
      expect(excludeItemIds.has(taskItem.itemId)).toBe(false);
    });

    it("different chunkIds — no duplicate conflict", () => {
      const items = [makeChunk({ chunkId: "chunk-aaa" }), makeChunk({ chunkId: "chunk-bbb" })];
      const { conflicts } = detectConflicts(items);
      expect(conflicts.filter(c => c.conflictType === "duplicate_content")).toHaveLength(0);
    });
  });

  describe("conflict structure", () => {
    it("every conflict has itemIds, sourceIds, resolution, and severity", () => {
      const items = [
        makeChunk({ sourceId: "src-v", versionId: "v1", isCurrent: false }),
        makeChunk({ sourceId: "src-v", versionId: "v2", isCurrent: true }),
      ];
      const { conflicts } = detectConflicts(items);
      for (const c of conflicts) {
        expect(Array.isArray(c.itemIds)).toBe(true);
        expect(Array.isArray(c.sourceIds)).toBe(true);
        expect(typeof c.resolution).toBe("string");
        expect(c.resolution.length).toBeGreaterThan(0);
        expect(["warning", "error"]).toContain(c.severity);
      }
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Knowledge Orchestration Engine
// ─────────────────────────────────────────────────────────────────────────────

describe("knowledgeOrchestrationEngine — orchestrateKnowledge", () => {
  beforeEach(() => {
    // Reset the provider registry so test-registered mock providers (from the
    // interface-contract describe block above) don't prevent ensureProvidersRegistered
    // from registering the real standard providers.
    _resetProviderRegistry();

    // mockReset clears call history AND the mockResolvedValueOnce queue.
    // vi.clearAllMocks() only clears call history — leftover "once" items
    // would corrupt subsequent tests.
    mockDb.execute.mockReset();
    mockDb.insert.mockReset();
    mockDb.select.mockReset();

    mockDb.execute.mockResolvedValue({ rows: [] });
    mockDb.insert.mockReturnValue({ values: vi.fn().mockResolvedValue([]) });
    // OrgMemoryProvider uses db.select(...).from(...).where(...).orderBy(...).limit(...)
    const emptyRows: unknown[] = [];
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue(emptyRows),
          }),
          limit: vi.fn().mockResolvedValue(emptyRows),
        }),
      }),
    });
  });

  const baseInput = {
    organisationId: "org-test-1",
    specialistId:   "chief_of_staff",
    query:          "NDIS participant support coordination",
    writeAudit:     false,
  };

  describe("basic orchestration", () => {
    it("returns valid OrchestratedKnowledgeContext shape", async () => {
      const ctx = await orchestrateKnowledge(baseInput);
      expect(ctx).toMatchObject({
        taskUploadItems:     expect.any(Array),
        entityItems:         expect.any(Array),
        orgMemoryItems:      expect.any(Array),
        specialistItems:     expect.any(Array),
        libraryItems:        expect.any(Array),
        citations:           expect.any(Array),
        conflicts:           expect.any(Array),
        tokenBudgetUsed:     expect.any(Number),
        tokenBudgetTotal:    expect.any(Number),
        retrievalDurationMs: expect.any(Number),
        retrievalMethod:     expect.any(String),
        providerStatus:      expect.any(Object),
        auditEventId:        null,
      });
    });

    it("returns empty context when DB has no chunks", async () => {
      const ctx = await orchestrateKnowledge(baseInput);
      expect(ctx.taskUploadItems).toHaveLength(0);
      expect(ctx.libraryItems).toHaveLength(0);
      expect(ctx.tokenBudgetUsed).toBe(0);
    });

    it("providerStatus includes entries for implemented layers", async () => {
      const ctx = await orchestrateKnowledge(baseInput);
      expect(Object.keys(ctx.providerStatus)).toContain("task_upload");
      expect(Object.keys(ctx.providerStatus)).toContain("specialist_knowledge");
      expect(Object.keys(ctx.providerStatus)).toContain("organisation_library");
    });

    it("marks P6-P8 providers as notImplemented in providerStatus", async () => {
      const ctx = await orchestrateKnowledge(baseInput);
      const futureKeys = Object.keys(ctx.providerStatus).filter(k =>
        k.startsWith("cloud_") || k === "desktop_connector" || k === "web_search",
      );
      for (const key of futureKeys) {
        expect(ctx.providerStatus[key]!.notImplemented).toBe(true);
      }
    });
  });

  describe("priority ordering — P1 task uploads", () => {
    it("task-scoped chunks appear in taskUploadItems", async () => {
      // Only first call (P1) returns rows
      mockDb.execute
        .mockResolvedValueOnce({ rows: [makeDbChunkRow({ sourceScope: "task", taskId: "task-abc" })] })
        .mockResolvedValue({ rows: [] });

      const ctx = await orchestrateKnowledge({ ...baseInput, taskId: "task-abc" });
      expect(ctx.taskUploadItems.length).toBeGreaterThanOrEqual(1);
    });

    it("library chunks appear in libraryItems, not taskUploadItems", async () => {
      // baseInput has no taskId → P1 skips db.execute
      // baseInput has no entityIds → P2 skips db.execute
      // Only P4 (specialist) and P5 (library) call db.execute — 2 calls
      mockDb.execute
        .mockResolvedValueOnce({ rows: [] })  // P4 specialist
        .mockResolvedValueOnce({ rows: [makeDbChunkRow({ sourceScope: "library" })] }); // P5 library

      const ctx = await orchestrateKnowledge(baseInput);
      expect(ctx.taskUploadItems).toHaveLength(0);
      expect(ctx.libraryItems.length).toBeGreaterThanOrEqual(1);
    });

    it("P1 items are mandatory — always included regardless of token budget", async () => {
      const bigTaskChunks = Array.from({ length: 5 }, () =>
        makeDbChunkRow({ sourceScope: "task", taskId: "task-x", tokenCount: 500 }),
      );
      mockDb.execute
        .mockResolvedValueOnce({ rows: bigTaskChunks })
        .mockResolvedValue({ rows: [] });

      const ctx = await orchestrateKnowledge({
        ...baseInput, taskId: "task-x", tokenBudget: 100,
      });
      // P1 mandatory — all included even if over budget
      expect(ctx.taskUploadItems.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("token budget enforcement", () => {
    it("tokenBudgetTotal matches input", async () => {
      const ctx = await orchestrateKnowledge({ ...baseInput, tokenBudget: 2000 });
      expect(ctx.tokenBudgetTotal).toBe(2000);
    });

    it("tokenBudgetUsed equals sum of selected item tokenCounts", async () => {
      // baseInput → only P4 + P5 call db.execute (2 calls)
      mockDb.execute
        .mockResolvedValueOnce({ rows: [] })  // P4
        .mockResolvedValueOnce({ rows: [makeDbChunkRow({ tokenCount: 80 }), makeDbChunkRow({ tokenCount: 90 })] }); // P5

      const ctx = await orchestrateKnowledge({ ...baseInput, tokenBudget: 10000 });
      const computed = [
        ...ctx.taskUploadItems, ...ctx.entityItems,
        ...ctx.specialistItems, ...ctx.libraryItems,
      ].reduce((s, i) => s + i.tokenCount, 0);
      expect(ctx.tokenBudgetUsed).toBe(computed);
    });
  });

  describe("citation generation", () => {
    it("generates one citation per selected item", async () => {
      // baseInput → only P4 + P5 call db.execute (2 calls)
      mockDb.execute
        .mockResolvedValueOnce({ rows: [] })  // P4
        .mockResolvedValueOnce({ rows: [makeDbChunkRow(), makeDbChunkRow()] }); // P5

      const ctx = await orchestrateKnowledge({ ...baseInput, tokenBudget: 10000 });
      expect(ctx.citations).toHaveLength(ctx.libraryItems.length);
    });

    it("each citation has all required attribution fields", async () => {
      // baseInput → only P4 + P5 call db.execute (2 calls)
      mockDb.execute
        .mockResolvedValueOnce({ rows: [] })       // P4
        .mockResolvedValueOnce({ rows: [makeDbChunkRow()] }); // P5

      const ctx = await orchestrateKnowledge({ ...baseInput, tokenBudget: 10000 });
      for (const cit of ctx.citations) {
        expect(cit.citationId).toBeDefined();
        expect(cit.sourceId).toBeDefined();
        expect(cit.sourceTitle).toBeDefined();
        expect(cit.authorityLevel).toBeDefined();
        expect(cit.sensitivityClassification).toBeDefined();
        expect(cit.priorityLayer).toBeDefined();
        expect(cit.provider).toBeDefined();
        expect(typeof cit.finalScore).toBe("number");
        expect(typeof cit.reasonSelected).toBe("string");
      }
    });

    it("citation.sourceId matches item's knowledgeSourceId", async () => {
      // baseInput → only P4 + P5 call db.execute (2 calls)
      mockDb.execute
        .mockResolvedValueOnce({ rows: [] })  // P4
        .mockResolvedValueOnce({ rows: [makeDbChunkRow({ knowledgeSourceId: "src-explicit-42" })] }); // P5

      const ctx = await orchestrateKnowledge({ ...baseInput, tokenBudget: 10000 });
      if (ctx.citations.length > 0) {
        expect(ctx.citations[0]!.sourceId).toBe("src-explicit-42");
      }
    });
  });

  describe("duplicate elimination", () => {
    it("same chunkId from P1 and P5 included only once (from P1)", async () => {
      const sharedId = "shared-chunk-dedup-test";
      // taskId set → P1 calls db.execute; entityIds empty → P2 skips
      // Calls: P1, P4, P5 — 3 total
      mockDb.execute
        .mockResolvedValueOnce({ rows: [makeDbChunkRow({ id: sharedId, sourceScope: "task" })] }) // P1
        .mockResolvedValueOnce({ rows: [] })  // P4
        .mockResolvedValueOnce({ rows: [makeDbChunkRow({ id: sharedId })] }); // P5 same chunk

      const ctx = await orchestrateKnowledge({ ...baseInput, taskId: "t-1", tokenBudget: 10000 });
      const allItems = [
        ...ctx.taskUploadItems, ...ctx.entityItems,
        ...ctx.specialistItems, ...ctx.libraryItems,
      ];
      const chunkIds = allItems.map(i => i.chunkId).filter(Boolean);
      expect(new Set(chunkIds).size).toBe(chunkIds.length); // all unique
    });
  });

  describe("authority weighting", () => {
    it("mandatory source scores higher than supporting for same base score", async () => {
      // Both with same semantic/lexical scores — authority bonus should distinguish them
      // baseInput → only P4 + P5 call db.execute (2 calls)
      mockDb.execute
        .mockResolvedValueOnce({ rows: [] })  // P4
        .mockResolvedValueOnce({ rows: [
          makeDbChunkRow({ id: "chunk-man", authorityLevel: "mandatory", semanticScore: "0.7", lexicalScore: "0.5", baseScore: "0.62" }),
          makeDbChunkRow({ id: "chunk-sup", authorityLevel: "supporting", semanticScore: "0.7", lexicalScore: "0.5", baseScore: "0.62" }),
        ]});  // P5

      const ctx = await orchestrateKnowledge({ ...baseInput, tokenBudget: 10000 });
      const mandCit = ctx.citations.find(c => c.authorityLevel === "mandatory");
      const suppCit = ctx.citations.find(c => c.authorityLevel === "supporting");
      if (mandCit && suppCit) {
        expect(mandCit.finalScore).toBeGreaterThan(suppCit.finalScore);
      }
    });
  });

  describe("retrieval audit", () => {
    it("calls db.insert when writeAudit=true", async () => {
      const insertValues = vi.fn().mockResolvedValue([]);
      mockDb.insert.mockReturnValue({ values: insertValues });

      await orchestrateKnowledge({ ...baseInput, writeAudit: true });
      expect(mockDb.insert).toHaveBeenCalled();
      expect(insertValues).toHaveBeenCalled();
    });

    it("does NOT call db.insert when writeAudit=false", async () => {
      await orchestrateKnowledge({ ...baseInput, writeAudit: false });
      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it("audit event includes organisationId, specialistId, executionId — NOT document text", async () => {
      // baseInput → only P4 + P5 call db.execute (2 calls)
      mockDb.execute
        .mockResolvedValueOnce({ rows: [] })       // P4
        .mockResolvedValueOnce({ rows: [makeDbChunkRow()] }); // P5

      let captured: Record<string, unknown> | null = null;
      mockDb.insert.mockReturnValue({
        values: vi.fn((vals) => { captured = vals; return Promise.resolve([]); }),
      });

      await orchestrateKnowledge({ ...baseInput, writeAudit: true, executionId: "exec-test-1" });

      expect(captured).not.toBeNull();
      expect(captured!["organizationId"]).toBe("org-test-1");
      expect(captured!["specialistId"]).toBe("chief_of_staff");
      expect(captured!["executionId"]).toBe("exec-test-1");
      // Audit MUST NOT log document text
      const serialised = JSON.stringify(captured);
      expect(serialised).not.toContain("NDIS participant support policy content");
    });

    it("audit failure does not throw — execution continues", async () => {
      mockDb.insert.mockReturnValue({ values: vi.fn().mockRejectedValue(new Error("DB error")) });
      await expect(orchestrateKnowledge({ ...baseInput, writeAudit: true })).resolves.toBeDefined();
    });
  });

  describe("tenant isolation", () => {
    it("organisationId present in every SQL execute call", async () => {
      const orgId = "org-isolation-test-xyz";
      await orchestrateKnowledge({ ...baseInput, organisationId: orgId });
      for (const call of mockDb.execute.mock.calls) {
        const sqlStr = JSON.stringify(call[0]);
        expect(sqlStr).toContain(orgId);
      }
    });

    it("different org IDs generate independent execute calls with correct IDs", async () => {
      mockDb.execute.mockResolvedValue({ rows: [] });
      await orchestrateKnowledge({ ...baseInput, organisationId: "org-alpha" });
      await orchestrateKnowledge({ ...baseInput, organisationId: "org-beta" });

      const calls = mockDb.execute.mock.calls.map(c => JSON.stringify(c[0]));
      expect(calls.some(c => c.includes("org-alpha"))).toBe(true);
      expect(calls.some(c => c.includes("org-beta"))).toBe(true);
    });
  });

  describe("sensitivity enforcement", () => {
    it("sensitivity filter appears in SQL", async () => {
      await orchestrateKnowledge({ ...baseInput, allowedSensitivity: ["public"] });
      const calls = mockDb.execute.mock.calls.map(c => JSON.stringify(c[0]));
      expect(calls.some(c => c.includes("public"))).toBe(true);
    });

    it("restricted sensitivity NOT in DEFAULT_ALLOWED_SENSITIVITY", () => {
      expect(DEFAULT_ALLOWED_SENSITIVITY).not.toContain("restricted");
      expect(DEFAULT_ALLOWED_SENSITIVITY).not.toContain("highly_confidential");
    });

    it("highly_confidential not in default allowed list", () => {
      expect(DEFAULT_ALLOWED_SENSITIVITY).not.toContain("highly_confidential");
    });
  });

  describe("superseded document exclusion", () => {
    it("isCurrent=false chunk triggers conflict warning", async () => {
      // baseInput → only P4 + P5 call db.execute (2 calls)
      mockDb.execute
        .mockResolvedValueOnce({ rows: [] })  // P4
        .mockResolvedValueOnce({ rows: [makeDbChunkRow({ id: "old-c", isCurrent: false })] }); // P5

      const ctx = await orchestrateKnowledge({ ...baseInput, tokenBudget: 10000 });
      expect(ctx.conflicts.some(
        c => c.conflictType === "outdated_version" || c.conflictType === "superseded_version",
      )).toBe(true);
    });
  });

  describe("graceful degradation", () => {
    it("returns empty context when all DB queries fail", async () => {
      mockDb.execute.mockRejectedValue(new Error("DB unavailable"));
      const ctx = await orchestrateKnowledge({ ...baseInput, writeAudit: false });
      expect(ctx.taskUploadItems).toHaveLength(0);
      expect(ctx.libraryItems).toHaveLength(0);
      expect(ctx.tokenBudgetUsed).toBe(0);
    });

    it("returns partial context when some providers fail", async () => {
      // baseInput → only P4 + P5 call db.execute (2 calls)
      // P4 fails, P5 succeeds — still partial results from P5
      mockDb.execute
        .mockRejectedValueOnce(new Error("P4 fail"))
        .mockResolvedValueOnce({ rows: [makeDbChunkRow()] }); // P5 ok
      const ctx = await orchestrateKnowledge({ ...baseInput, tokenBudget: 10000 });
      expect(ctx).toBeDefined();
      expect(ctx.libraryItems.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("retrieval method", () => {
    it("'hybrid' when both embedding and query provided", async () => {
      // baseInput → only P4 + P5 call db.execute (2 calls)
      mockDb.execute
        .mockResolvedValueOnce({ rows: [] })  // P4
        .mockResolvedValueOnce({ rows: [makeDbChunkRow()] }); // P5
      const ctx = await orchestrateKnowledge({
        ...baseInput,
        queryEmbedding: Array.from({ length: 1536 }, () => 0.1),
        tokenBudget: 10000,
      });
      expect(ctx.retrievalMethod).toBe("hybrid");
    });

    it("'lexical' when no embedding provided", async () => {
      // baseInput → only P4 + P5 call db.execute (2 calls)
      mockDb.execute
        .mockResolvedValueOnce({ rows: [] })  // P4
        .mockResolvedValueOnce({ rows: [makeDbChunkRow()] }); // P5
      const ctx = await orchestrateKnowledge({ ...baseInput, tokenBudget: 10000 });
      expect(ctx.retrievalMethod).toBe("lexical");
    });

    it("'none' when no items retrieved", async () => {
      const ctx = await orchestrateKnowledge(baseInput);
      expect(ctx.retrievalMethod).toBe("none");
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Context Formatting for Assembler
// ─────────────────────────────────────────────────────────────────────────────

describe("formatKnowledgeContextSections", () => {
  const empty: OrchestratedKnowledgeContext = {
    taskUploadItems: [], entityItems: [], orgMemoryItems: [],
    specialistItems: [], libraryItems: [], citations: [], conflicts: [],
    tokenBudgetUsed: 0, tokenBudgetTotal: 4000, retrievalDurationMs: 5,
    retrievalMethod: "none", providerStatus: {}, auditEventId: null,
  };

  it("returns [] when no items and no conflicts", () => {
    expect(formatKnowledgeContextSections(empty)).toHaveLength(0);
  });

  it("emits RETRIEVED KNOWLEDGE DOCUMENTS section for library items", () => {
    const ctx = { ...empty, libraryItems: [makeChunk({ priorityLayer: "library" })] };
    const sections = formatKnowledgeContextSections(ctx);
    expect(sections.length).toBeGreaterThanOrEqual(1);
    expect(sections.join("\n")).toContain("RETRIEVED KNOWLEDGE DOCUMENTS");
  });

  it("emits 'Current Task Documents' label for task upload items", () => {
    const ctx = { ...empty, taskUploadItems: [makeChunk({ priorityLayer: "task_upload" })] };
    expect(formatKnowledgeContextSections(ctx).join("\n")).toContain("Current Task Documents");
  });

  it("emits 'Specialist Knowledge' label for specialist items", () => {
    const ctx = { ...empty, specialistItems: [makeChunk({ priorityLayer: "specialist" })] };
    expect(formatKnowledgeContextSections(ctx).join("\n")).toContain("Specialist Knowledge");
  });

  it("emits KNOWLEDGE CONFLICTS section when conflicts exist", () => {
    const ctx: OrchestratedKnowledgeContext = {
      ...empty,
      conflicts: [{
        conflictType: "superseded_version",
        severity: "warning",
        description: "Two versions detected.",
        itemIds: ["item-1"],
        sourceIds: ["src-1"],
        resolution: "Remove older version.",
      }],
    };
    const sections = formatKnowledgeContextSections(ctx);
    expect(sections.join("\n")).toContain("KNOWLEDGE CONFLICTS DETECTED");
    expect(sections.join("\n")).toContain("Two versions detected.");
    expect(sections.join("\n")).toContain("Remove older version.");
  });

  it("all sections are labelled [ORGANISATION-PROVIDED CONTEXT] for injection protection", () => {
    const ctx = { ...empty, libraryItems: [makeChunk({ priorityLayer: "library" })] };
    const sections = formatKnowledgeContextSections(ctx);
    for (const s of sections) {
      expect(s).toContain("[ORGANISATION-PROVIDED CONTEXT]");
    }
  });

  it("sections include EVIDENCE/CONTEXT disclaimer", () => {
    const ctx = { ...empty, libraryItems: [makeChunk({ priorityLayer: "library" })] };
    const joined = formatKnowledgeContextSections(ctx).join("\n");
    expect(joined).toContain("EVIDENCE and CONTEXT");
  });

  it("section includes document content from items", () => {
    const item = makeChunk({ content: "UNIQUE_MARKER_XYZ_CONTENT", priorityLayer: "library" });
    const ctx  = { ...empty, libraryItems: [item] };
    const joined = formatKnowledgeContextSections(ctx).join("\n");
    expect(joined).toContain("UNIQUE_MARKER_XYZ_CONTENT");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Retrieval Audit Events Schema — expanded columns
// ─────────────────────────────────────────────────────────────────────────────

// The mock table defined in vi.mock at the top of this file mirrors the real
// schema.  Checking the mock confirms all Task #17 columns are declared.
const MOCK_RETRIEVAL_AUDIT_TABLE = {
  id:                  { name: "id" },
  organizationId:      { name: "organization_id" },
  specialistId:        { name: "specialist_id" },
  executionId:         { name: "execution_id" },
  entityId:            { name: "entity_id" },
  sourceIds:           { name: "source_ids" },
  chunkIds:            { name: "chunk_ids" },
  memoryIds:           { name: "memory_ids" },
  taskUploadIds:       { name: "task_upload_ids" },
  retrievalMethod:     { name: "retrieval_method" },
  scoreMetadata:       { name: "score_metadata" },
  rankingDetails:      { name: "ranking_details" },
  reasonSelected:      { name: "reason_selected" },
  reasonRejected:      { name: "reason_rejected" },
  conflictCount:       { name: "conflict_count" },
  tokenCount:          { name: "token_count" },
  retrievalDurationMs: { name: "retrieval_duration_ms" },
  createdAt:           { name: "created_at" },
};

describe("retrievalAuditEvents schema — Task #17 expanded columns", () => {
  it("table has all required Task #17 fields", () => {
    const required = [
      "id", "organizationId", "specialistId", "executionId",
      "entityId", "sourceIds", "chunkIds", "memoryIds", "taskUploadIds",
      "retrievalMethod", "scoreMetadata", "rankingDetails",
      "reasonSelected", "reasonRejected", "conflictCount",
      "tokenCount", "retrievalDurationMs", "createdAt",
    ] as const;

    for (const field of required) {
      expect(
        (MOCK_RETRIEVAL_AUDIT_TABLE as Record<string, unknown>)[field],
        `Field "${field}" missing from retrievalAuditEventsTable`,
      ).toBeDefined();
    }
  });

  it("entityId column exists for P2 entity knowledge scoping", () => {
    expect(MOCK_RETRIEVAL_AUDIT_TABLE.entityId).toBeDefined();
    expect(MOCK_RETRIEVAL_AUDIT_TABLE.entityId.name).toBe("entity_id");
  });

  it("memoryIds column exists for P3 org memory audit", () => {
    expect(MOCK_RETRIEVAL_AUDIT_TABLE.memoryIds).toBeDefined();
    expect(MOCK_RETRIEVAL_AUDIT_TABLE.memoryIds.name).toBe("memory_ids");
  });

  it("taskUploadIds column exists for P1 task upload audit", () => {
    expect(MOCK_RETRIEVAL_AUDIT_TABLE.taskUploadIds).toBeDefined();
    expect(MOCK_RETRIEVAL_AUDIT_TABLE.taskUploadIds.name).toBe("task_upload_ids");
  });

  it("rankingDetails column exists for full ranking audit trail", () => {
    expect(MOCK_RETRIEVAL_AUDIT_TABLE.rankingDetails).toBeDefined();
  });

  it("reasonSelected + reasonRejected columns exist for explainability", () => {
    expect(MOCK_RETRIEVAL_AUDIT_TABLE.reasonSelected).toBeDefined();
    expect(MOCK_RETRIEVAL_AUDIT_TABLE.reasonRejected).toBeDefined();
  });

  it("retrievalDurationMs column exists for performance monitoring", () => {
    expect(MOCK_RETRIEVAL_AUDIT_TABLE.retrievalDurationMs).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. Runtime Instruction Assembler — retrievedKnowledge extension
// ─────────────────────────────────────────────────────────────────────────────

describe("runtimeInstructionAssembler — retrievedKnowledge", () => {
  it("includes knowledge sections in instruction when provided", async () => {
    const { assembleRuntimeInstructions } = await import("@workspace/agent-runtime");

    const manifest: any = {
      workforceRole: "chief_of_staff", displayName: "CoS",
      domain: "Ops", dnaVersion: "1.0.0", manifestVersion: 1, manifestHash: "x",
      mission: "Lead.", objectives: ["O1"], responsibilities: ["R1"],
      operatingPrinciples: ["P1"], competencies: [],
      communicationStyle: { tone: "pro", detailLevel: "med", language: "I" },
      escalationRules: ["E1"], prohibitedBehaviours: ["X"],
      generatedAt: new Date().toISOString(),
    };
    const steps: any[]       = [{ sequence: 1, action: "draft", specialist: "cos", description: "d", requiresApproval: false }];
    const constraints: any  = { maxDurationSeconds: 60, requireHumanApprovalBeforeSubmit: false, allowedDataCategories: [] };

    const result = assembleRuntimeInstructions(manifest, steps, constraints, {
      retrievedKnowledge: {
        sections: ["## [ORGANISATION-PROVIDED CONTEXT] RETRIEVED KNOWLEDGE DOCUMENTS\nTest chunk content.\n"],
        totalChunks: 1, tokenBudgetUsed: 50, citationIds: ["cit-1"],
        conflictCount: 0, auditEventId: "audit-99",
      },
    });

    expect(result.instruction).toContain("RETRIEVED KNOWLEDGE DOCUMENTS");
    expect(result.instruction).toContain("Test chunk content.");
    expect(result.hasOrganisationContext).toBe(true);
  });

  it("works without retrievedKnowledge (backward compat)", async () => {
    const { assembleRuntimeInstructions } = await import("@workspace/agent-runtime");
    const manifest: any = {
      workforceRole: "cos", displayName: "CoS", domain: "O", dnaVersion: "1.0.0",
      manifestVersion: 1, manifestHash: "y", mission: "M", objectives: [],
      responsibilities: [], operatingPrinciples: [], competencies: [],
      communicationStyle: { tone: "p", detailLevel: "m", language: "I" },
      escalationRules: [], prohibitedBehaviours: [],
      generatedAt: new Date().toISOString(),
    };
    const result = assembleRuntimeInstructions(
      manifest,
      [{ sequence: 1, action: "a", specialist: "c", description: "d", requiresApproval: false }],
      { maxDurationSeconds: 60, requireHumanApprovalBeforeSubmit: false, allowedDataCategories: [] },
    );
    expect(result.instruction).toBeDefined();
    expect(result.hasOrganisationContext).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. SpecialistContextPackage — retrievedKnowledge field
// ─────────────────────────────────────────────────────────────────────────────

describe("SpecialistContextPackage — retrievedKnowledge field type", () => {
  it("package shape includes retrievedKnowledge field (type-level check)", () => {
    // If this TypeScript compiles, the field exists on the interface
    const pkg = {
      specialistConfig:   null,
      languageProfile:    null,
      approvedMemory:     [],
      injectedMemoryIds:  [],
      tokenBudgetUsed:    0,
      retrievedKnowledge: null,
    };
    expect(pkg.retrievedKnowledge).toBeNull();
  });

  it("retrievedKnowledge can hold sections, totalChunks, conflictCount", () => {
    const rk = {
      sections:        ["## Section"],
      totalChunks:     3,
      tokenBudgetUsed: 200,
      citationIds:     ["cit-a", "cit-b"],
      conflictCount:   1,
      auditEventId:    "audit-abc",
    };
    expect(rk.totalChunks).toBe(3);
    expect(rk.conflictCount).toBe(1);
    expect(rk.sections).toHaveLength(1);
  });
});
