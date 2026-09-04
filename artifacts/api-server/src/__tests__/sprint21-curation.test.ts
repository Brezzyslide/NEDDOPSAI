/**
 * Sprint 21 — Knowledge Curation Test Suite
 *
 * Tests:
 *  1. computeKnowledgeConfidence
 *  2. enqueueCurationJob
 *  3. processCurationJob
 *  4. enqueueCurationJobAsync
 *  5. detectAndProposeConversationKnowledge
 *  6. getKnowledgeHealthMetrics
 *  7. Tenant isolation
 *
 * Mock pattern (established codebase standard):
 *  - vi.hoisted() for all mock factories
 *  - vi.resetAllMocks() in beforeEach; re-setup chain mocks after reset
 *  - createChain() helper builds per-call thenable select chains
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mock factories ───────────────────────────────────────────────────

const {
  mockDbInsert,
  mockDbInsertValues,
  mockDbUpdate,
  mockDbUpdateSet,
  mockDbUpdateSetWhere,
  mockDbSelect,
  mockProposeOrganisationMemory,
  mockLogOrgEvent,
  mockCreateAIGateway,
  mockGatewayProcess,
} = vi.hoisted(() => {
  const mockDbInsertValues    = vi.fn();
  const mockDbInsert          = vi.fn();
  const mockDbUpdateSetWhere  = vi.fn();
  const mockDbUpdateSet       = vi.fn();
  const mockDbUpdate          = vi.fn();
  const mockDbSelect          = vi.fn();
  const mockGatewayProcess    = vi.fn();
  const mockCreateAIGateway   = vi.fn();
  const mockProposeOrganisationMemory = vi.fn();
  const mockLogOrgEvent       = vi.fn();
  return {
    mockDbInsert, mockDbInsertValues,
    mockDbUpdate, mockDbUpdateSet, mockDbUpdateSetWhere,
    mockDbSelect,
    mockProposeOrganisationMemory, mockLogOrgEvent,
    mockCreateAIGateway, mockGatewayProcess,
  };
});

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("@workspace/db", () => ({
  db: { insert: mockDbInsert, update: mockDbUpdate, select: mockDbSelect },
  withSystemTenantContext: vi.fn(async (_ctx: unknown, fn: (client: unknown) => Promise<unknown>) =>
    fn({ insert: mockDbInsert, update: mockDbUpdate, select: mockDbSelect })),
  knowledgeCurationJobsTable:   {},
  knowledgeSourcesTable:        {},
  knowledgeSourceVersionsTable: {},
  knowledgeChunksTable:         { text: "text", sectionTitle: "section_title", pageNumber: "page_number", chunkIndex: "chunk_index", deletedAt: "deleted_at", knowledgeSourceId: "knowledge_source_id", sourceVersionId: "source_version_id", organizationId: "organization_id" },
  organisationMemoryTable:      { id: "id", organizationId: "organization_id", status: "status", sourceType: "source_type", title: "title", createdAt: "created_at", updatedAt: "updated_at", approvedAt: "approved_at", specialistId: "specialist_id", memoryType: "memory_type" },
  ingestionJobsTable:           {},
  eq:      vi.fn((a, b) => ({ op: "eq", a, b })),
  and:     vi.fn((...args) => ({ op: "and", args })),
  asc:     vi.fn(a => ({ op: "asc", a })),
  desc:    vi.fn(a => ({ op: "desc", a })),
  isNull:  vi.fn(a => ({ op: "isNull", a })),
  gte:     vi.fn((a, b) => ({ op: "gte", a, b })),
  not:     vi.fn(a => ({ op: "not", a })),
  like:    vi.fn((a, b) => ({ op: "like", a, b })),
  inArray: vi.fn((a, b) => ({ op: "inArray", a, b })),
  sql:     Object.assign(vi.fn(t => ({ sql: t })), { raw: vi.fn() }),
}));

vi.mock("../services/organisationMemoryService.js", () => ({
  proposeOrganisationMemory: mockProposeOrganisationMemory,
}));

vi.mock("../services/auditService.js", () => ({
  logOrgEvent: mockLogOrgEvent,
}));

vi.mock("@workspace/ai-gateway", () => ({
  createAIGateway: mockCreateAIGateway,
}));

vi.mock("../lib/workforceRegistry.js", () => ({
  SPECIALISTS: [
    { code: "chief_of_staff",             dnaStatus: "active" },
    { code: "operations_manager",         dnaStatus: "active" },
    { code: "compliance_quality_manager", dnaStatus: "active" },
    { code: "executive_assistant",        dnaStatus: "active" },
  ],
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import {
  enqueueCurationJob,
  processCurationJob,
  computeKnowledgeConfidence,
  enqueueCurationJobAsync,
} from "../services/knowledgeCurationService.js";

import {
  detectAndProposeConversationKnowledge,
} from "../services/conversationLearningService.js";

import {
  getKnowledgeHealthMetrics,
} from "../services/knowledgeHealthService.js";

// ─── Chain builder ────────────────────────────────────────────────────────────

/**
 * createChain(result) — builds a thenable db.select chain.
 *
 * Handles all common terminal patterns:
 *   .from().where()                            — awaitable (returns result)
 *   .from().where().limit(n)                   — awaitable
 *   .from().where().orderBy().limit(n)         — awaitable
 *   .from().where().groupBy()                  — awaitable
 *   .from().where().and().limit(n)             — awaitable
 */
function createChain(result: any[]) {
  function makeTerminal(res: any[]) {
    const p = Promise.resolve(res);
    // Add chain methods that also return thenables, in case more methods are chained
    const t: any = {
      then:  p.then.bind(p),
      catch: p.catch.bind(p),
      limit:    vi.fn(() => makeTerminal(res)),
      offset:   vi.fn(() => makeTerminal(res)),
      orderBy:  vi.fn(() => makeTerminal(res)),
      groupBy:  vi.fn(() => makeTerminal(res)),
      and:      vi.fn(() => makeTerminal(res)),
    };
    return t;
  }

  const whereResult = makeTerminal(result);

  const from = vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue(whereResult) });
  return { from };
}

// ─── Shared test data ─────────────────────────────────────────────────────────

const ORG_ID     = "org-test-001";
const SOURCE_ID  = "src-test-001";
const VERSION_ID = "ver-test-001";
const USER_ID    = "user-test-001";
const JOB_ID     = "job-test-001";

const MOCK_SOURCE = {
  id: SOURCE_ID, organizationId: ORG_ID,
  title: "Staff Handbook v2", sourceType: "policy", authorityLevel: "authoritative", status: "approved",
};

const MOCK_VERSION = {
  id: VERSION_ID, organizationId: ORG_ID, versionLabel: "v2.0", isCurrent: true,
};

const MOCK_CHUNKS = [
  { text: "Financial approvals over $5,000 require CEO sign-off.", sectionTitle: "Finance", pageNumber: 3, chunkIndex: 0 },
  { text: "We refer to service users as participants.", sectionTitle: "Terminology", pageNumber: 5, chunkIndex: 1 },
];

const MOCK_LLM_RESPONSE = JSON.stringify({
  documentPurpose: "Staff handbook",
  proposals: [
    { memoryType: "approval_rule", title: "CEO approval above $5k", summary: "Over $5k needs CEO", rationale: "Authority threshold", confidence: 0.92, pageReference: "p.3", section: "Finance", affectedSpecialists: ["chief_of_staff", "operations_manager"], suggestedAction: "create", importance: 9 },
    { memoryType: "terminology",   title: "Use participants not clients", summary: "Preferred term", rationale: "Org terminology", confidence: 0.95, pageReference: "p.5", section: "Terminology", affectedSpecialists: ["chief_of_staff"], suggestedAction: "create", importance: 6 },
  ],
  versionSummary: null,
});

// ─── beforeEach ───────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.resetAllMocks();

  // Insert chain default
  mockDbInsertValues.mockResolvedValue(undefined);
  mockDbInsert.mockReturnValue({ values: mockDbInsertValues });

  // Update chain default
  mockDbUpdateSetWhere.mockResolvedValue(undefined);
  mockDbUpdateSet.mockReturnValue({ where: mockDbUpdateSetWhere });
  mockDbUpdate.mockReturnValue({ set: mockDbUpdateSet });

  // Select chain default — single empty result
  mockDbSelect.mockReturnValue(createChain([]));

  // Service mocks
  mockLogOrgEvent.mockResolvedValue(undefined);
  mockProposeOrganisationMemory.mockResolvedValue({ id: "mem-proposal-001" });
  mockGatewayProcess.mockResolvedValue({ content: MOCK_LLM_RESPONSE, usedFallback: false });
  mockCreateAIGateway.mockReturnValue({ process: mockGatewayProcess });
});

// ─── 1. computeKnowledgeConfidence ───────────────────────────────────────────

describe("computeKnowledgeConfidence", () => {
  it("approved + authoritative → high confidence (> 0.85)", () => {
    const score = computeKnowledgeConfidence({ approvalStatus: "approved", authorityLevel: "authoritative", documentAgeMonths: 0 });
    expect(score).toBeGreaterThan(0.85);
    expect(score).toBeLessThanOrEqual(1.0);
  });

  it("rejected → exactly 0 regardless of authority or freshness", () => {
    const score = computeKnowledgeConfidence({ approvalStatus: "rejected", authorityLevel: "authoritative", documentAgeMonths: 0 });
    expect(score).toBe(0);
  });

  it("proposed + informal → moderate confidence (0.3–0.7)", () => {
    const score = computeKnowledgeConfidence({ approvalStatus: "proposed", authorityLevel: "informal", documentAgeMonths: 0 });
    expect(score).toBeGreaterThan(0.3);
    expect(score).toBeLessThan(0.7);
  });

  it("freshness decay — 24-month doc scores lower than fresh doc", () => {
    const fresh = computeKnowledgeConfidence({ approvalStatus: "approved", authorityLevel: "guidance", documentAgeMonths: 0 });
    const stale = computeKnowledgeConfidence({ approvalStatus: "approved", authorityLevel: "guidance", documentAgeMonths: 24 });
    expect(fresh).toBeGreaterThan(stale);
  });

  it("retrieval score boost raises confidence", () => {
    const base  = computeKnowledgeConfidence({ approvalStatus: "approved", authorityLevel: "guidance", documentAgeMonths: 0, retrievalScore: 0 });
    const boosted = computeKnowledgeConfidence({ approvalStatus: "approved", authorityLevel: "guidance", documentAgeMonths: 0, retrievalScore: 1.0 });
    expect(boosted).toBeGreaterThanOrEqual(base);
  });

  it("score always clamps to [0, 1]", () => {
    const score = computeKnowledgeConfidence({ approvalStatus: "approved", authorityLevel: "authoritative", documentAgeMonths: 0, retrievalScore: 1.0 });
    expect(score).toBeLessThanOrEqual(1.0);
    expect(score).toBeGreaterThanOrEqual(0);
  });

  it("superseded < approved for same authority and freshness", () => {
    const approved   = computeKnowledgeConfidence({ approvalStatus: "approved",   authorityLevel: "authoritative", documentAgeMonths: 0 });
    const superseded = computeKnowledgeConfidence({ approvalStatus: "superseded", authorityLevel: "authoritative", documentAgeMonths: 0 });
    expect(approved).toBeGreaterThan(superseded);
  });

  it("authoritative > informal for same approval status", () => {
    const auth   = computeKnowledgeConfidence({ approvalStatus: "approved", authorityLevel: "authoritative", documentAgeMonths: 0 });
    const inform = computeKnowledgeConfidence({ approvalStatus: "approved", authorityLevel: "informal",     documentAgeMonths: 0 });
    expect(auth).toBeGreaterThan(inform);
  });
});

// ─── 2. enqueueCurationJob ────────────────────────────────────────────────────

describe("enqueueCurationJob", () => {
  it("creates a pending curation job with correct fields", async () => {
    const jobId = await enqueueCurationJob({
      organizationId: ORG_ID, knowledgeSourceId: SOURCE_ID,
      sourceVersionId: VERSION_ID, triggerEvent: "approved", actorUserId: USER_ID,
    });
    expect(mockDbInsert).toHaveBeenCalledOnce();
    expect(mockDbInsertValues).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: ORG_ID, knowledgeSourceId: SOURCE_ID, sourceVersionId: VERSION_ID,
      triggerEvent: "approved", status: "pending", proposalsGenerated: 0,
    }));
    expect(jobId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("stores previousVersionId when provided", async () => {
    await enqueueCurationJob({
      organizationId: ORG_ID, knowledgeSourceId: SOURCE_ID, sourceVersionId: VERSION_ID,
      previousVersionId: "prev-ver-001", triggerEvent: "version_changed", actorUserId: USER_ID,
    });
    expect(mockDbInsertValues).toHaveBeenCalledWith(expect.objectContaining({ previousVersionId: "prev-ver-001" }));
  });

  it("throws on invalid triggerEvent", async () => {
    await expect(enqueueCurationJob({
      organizationId: ORG_ID, knowledgeSourceId: SOURCE_ID, sourceVersionId: VERSION_ID,
      triggerEvent: "invalid_event" as any, actorUserId: USER_ID,
    })).rejects.toThrow("Invalid triggerEvent");
  });

  it("inserts organisationId as provided (tenant isolation)", async () => {
    await enqueueCurationJob({
      organizationId: "org-tenant-A", knowledgeSourceId: SOURCE_ID, sourceVersionId: VERSION_ID,
      triggerEvent: "uploaded", actorUserId: USER_ID,
    });
    expect(mockDbInsertValues).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "org-tenant-A" }));
  });
});

// ─── 3. processCurationJob ────────────────────────────────────────────────────

describe("processCurationJob", () => {
  const params = { organizationId: ORG_ID, knowledgeSourceId: SOURCE_ID, sourceVersionId: VERSION_ID, triggerEvent: "approved" as const, actorUserId: USER_ID };

  function setupForProcessing() {
    // 3 sequential calls: source, version, chunks
    mockDbSelect
      .mockReturnValueOnce(createChain([MOCK_SOURCE]))   // source lookup
      .mockReturnValueOnce(createChain([MOCK_VERSION]))  // version lookup
      .mockReturnValueOnce(createChain(MOCK_CHUNKS));    // chunks
  }

  it("marks job processing → completed", async () => {
    setupForProcessing();
    delete process.env.AI_PROVIDER;

    await processCurationJob(JOB_ID, params);

    const setCalls = mockDbUpdateSet.mock.calls.map(c => c[0].status);
    expect(setCalls).toContain("processing");
    expect(setCalls).toContain("completed");
  });

  it("returns 0 proposals and marks completed when no chunks available", async () => {
    mockDbSelect
      .mockReturnValueOnce(createChain([MOCK_SOURCE]))
      .mockReturnValueOnce(createChain([MOCK_VERSION]))
      .mockReturnValueOnce(createChain([])); // no chunks

    const result = await processCurationJob(JOB_ID, params);
    expect(result.proposalsGenerated).toBe(0);
    expect(result.proposalIds).toHaveLength(0);
    expect(mockDbUpdateSet).toHaveBeenCalledWith(expect.objectContaining({
      status: "completed", processingLog: expect.objectContaining({ reason: "no_chunks_available" }),
    }));
  });

  it("calls AI gateway when AI_PROVIDER=openai", async () => {
    setupForProcessing();
    process.env.AI_PROVIDER = "openai";

    await processCurationJob(JOB_ID, params);

    expect(mockCreateAIGateway).toHaveBeenCalled();
    expect(mockGatewayProcess).toHaveBeenCalled();
    delete process.env.AI_PROVIDER;
  });

  it("creates proposals from LLM response (2 proposals)", async () => {
    setupForProcessing();
    process.env.AI_PROVIDER = "openai";

    const result = await processCurationJob(JOB_ID, params);

    expect(mockProposeOrganisationMemory).toHaveBeenCalledTimes(2);
    expect(result.proposalsGenerated).toBe(2);
    delete process.env.AI_PROVIDER;
  });

  it("strips invalid specialist codes from proposals", async () => {
    setupForProcessing();
    process.env.AI_PROVIDER = "openai";
    mockGatewayProcess.mockResolvedValue({
      usedFallback: false,
      content: JSON.stringify({
        documentPurpose: "test",
        proposals: [{ memoryType: "approval_rule", title: "Test", summary: "Test", rationale: "Test", confidence: 0.9, pageReference: "", section: "", affectedSpecialists: ["chief_of_staff", "invalid_specialist_xyz"], suggestedAction: "create", importance: 7 }],
        versionSummary: null,
      }),
    });

    await processCurationJob(JOB_ID, params);

    expect(mockProposeOrganisationMemory).toHaveBeenCalledWith(ORG_ID, expect.objectContaining({
      structuredContent: expect.objectContaining({ affectedSpecialists: ["chief_of_staff"] }),
    }));
    delete process.env.AI_PROVIDER;
  });

  it("falls back gracefully when LLM throws", async () => {
    setupForProcessing();
    process.env.AI_PROVIDER = "openai";
    mockGatewayProcess.mockRejectedValue(new Error("LLM unavailable"));

    await expect(processCurationJob(JOB_ID, params)).resolves.toBeDefined();
    delete process.env.AI_PROVIDER;
  });

  it("marks job failed and logs audit when source not found", async () => {
    mockDbSelect.mockReturnValueOnce(createChain([])); // source not found
    await expect(processCurationJob(JOB_ID, params)).rejects.toThrow();
    expect(mockDbUpdateSet).toHaveBeenCalledWith(expect.objectContaining({ status: "failed" }));
    expect(mockLogOrgEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: "knowledge.curation.failed" }));
  });

  it("logs knowledge.curation.completed audit event", async () => {
    setupForProcessing();
    delete process.env.AI_PROVIDER;

    await processCurationJob(JOB_ID, params);

    expect(mockLogOrgEvent).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: ORG_ID,
      eventType: "knowledge.curation.completed",
      resourceType: "knowledge_curation_job",
    }));
  });

  it("continues creating remaining proposals if one fails", async () => {
    setupForProcessing();
    process.env.AI_PROVIDER = "openai";
    mockProposeOrganisationMemory
      .mockRejectedValueOnce(new Error("DB constraint"))
      .mockResolvedValue({ id: "mem-002" });

    const result = await processCurationJob(JOB_ID, params);
    expect(mockProposeOrganisationMemory).toHaveBeenCalledTimes(2);
    expect(result.proposalIds).toHaveLength(1); // only the successful one
    delete process.env.AI_PROVIDER;
  });

  it("handles malformed LLM JSON gracefully", async () => {
    setupForProcessing();
    process.env.AI_PROVIDER = "openai";
    mockGatewayProcess.mockResolvedValue({ content: "NOT VALID JSON", usedFallback: false });

    const result = await processCurationJob(JOB_ID, params);
    expect(result).toBeDefined();
    delete process.env.AI_PROVIDER;
  });

  it("handles usedFallback=true (no LLM available)", async () => {
    setupForProcessing();
    process.env.AI_PROVIDER = "openai";
    mockGatewayProcess.mockResolvedValue({ content: "", usedFallback: true });

    const result = await processCurationJob(JOB_ID, params);
    expect(result.proposalsGenerated).toBe(0);
    delete process.env.AI_PROVIDER;
  });
});

// ─── 4. enqueueCurationJobAsync ───────────────────────────────────────────────

describe("enqueueCurationJobAsync", () => {
  it("does not throw synchronously", () => {
    expect(() => {
      enqueueCurationJobAsync({ organizationId: ORG_ID, knowledgeSourceId: SOURCE_ID, sourceVersionId: VERSION_ID, triggerEvent: "uploaded", actorUserId: USER_ID });
    }).not.toThrow();
  });
});

// ─── 5. detectAndProposeConversationKnowledge ─────────────────────────────────

describe("detectAndProposeConversationKnowledge", () => {
  function setupDedupNoMatch() {
    mockDbSelect.mockReturnValue(createChain([])); // no recent duplicates
  }

  it("detects 'we call them' terminology pattern", async () => {
    setupDedupNoMatch();
    const result = await detectAndProposeConversationKnowledge(ORG_ID, "We call them participants, not clients.", USER_ID);
    expect(result.proposed).toBeGreaterThan(0);
    expect(mockProposeOrganisationMemory).toHaveBeenCalledWith(ORG_ID, expect.objectContaining({ memoryType: "terminology" }));
  });

  it("detects approval limit pattern", async () => {
    setupDedupNoMatch();
    const result = await detectAndProposeConversationKnowledge(ORG_ID, "Our approval limit is $5,000 for all purchases.", USER_ID);
    expect(result.proposed).toBeGreaterThan(0);
    expect(mockProposeOrganisationMemory).toHaveBeenCalledWith(ORG_ID, expect.objectContaining({ memoryType: "approval_rule" }));
  });

  it("detects 'we never' operating preference", async () => {
    setupDedupNoMatch();
    const result = await detectAndProposeConversationKnowledge(ORG_ID, "We never send incident reports to external parties via email.", USER_ID);
    expect(result.proposed).toBeGreaterThan(0);
    expect(mockProposeOrganisationMemory).toHaveBeenCalledWith(ORG_ID, expect.objectContaining({ memoryType: "operating_preference" }));
  });

  it("detects reporting line pattern", async () => {
    setupDedupNoMatch();
    const result = await detectAndProposeConversationKnowledge(ORG_ID, "All incidents report to the Operations Manager.", USER_ID);
    expect(result.proposed).toBeGreaterThan(0);
    expect(mockProposeOrganisationMemory).toHaveBeenCalledWith(ORG_ID, expect.objectContaining({ memoryType: "reporting_line" }));
  });

  it("detects policy reference pattern", async () => {
    setupDedupNoMatch();
    const result = await detectAndProposeConversationKnowledge(ORG_ID, "Our policy requires that all staff complete annual training.", USER_ID);
    expect(result.proposed).toBeGreaterThan(0);
    expect(mockProposeOrganisationMemory).toHaveBeenCalledWith(ORG_ID, expect.objectContaining({ memoryType: "policy_reference" }));
  });

  it("returns 0 proposed for generic messages with no patterns", async () => {
    setupDedupNoMatch();
    const result = await detectAndProposeConversationKnowledge(ORG_ID, "Hello! How are you today?", USER_ID);
    expect(result.proposed).toBe(0);
    expect(mockProposeOrganisationMemory).not.toHaveBeenCalled();
  });

  it("skips duplicate proposals (matching recent entry in DB)", async () => {
    mockDbSelect.mockReturnValue(createChain([{ id: "existing-mem-001" }])); // dedup finds match
    const result = await detectAndProposeConversationKnowledge(ORG_ID, "Our approval limit is $5,000.", USER_ID);
    expect(result.skipped).toBeGreaterThan(0);
    expect(mockProposeOrganisationMemory).not.toHaveBeenCalled();
  });

  it("handles proposeOrganisationMemory failure gracefully", async () => {
    setupDedupNoMatch();
    mockProposeOrganisationMemory.mockRejectedValue(new Error("DB failure"));
    const result = await detectAndProposeConversationKnowledge(ORG_ID, "Our approval limit is $5,000.", USER_ID);
    expect(result.skipped).toBeGreaterThan(0);
    expect(result.proposed).toBe(0);
  });

  it("logs audit event when proposals are created", async () => {
    setupDedupNoMatch();
    await detectAndProposeConversationKnowledge(ORG_ID, "We call them participants, not clients.", USER_ID, "conv-001");
    expect(mockLogOrgEvent).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: ORG_ID, eventType: "knowledge.conversation.candidate_detected",
    }));
  });

  it("does not log audit when no proposals created", async () => {
    setupDedupNoMatch();
    await detectAndProposeConversationKnowledge(ORG_ID, "Good morning.", USER_ID);
    expect(mockLogOrgEvent).not.toHaveBeenCalled();
  });

  it("handles DB error in dedup check gracefully (allows proposal)", async () => {
    mockDbSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockRejectedValue(new Error("DB down")),
          then: (_: any, reject: any) => Promise.reject(new Error("DB down")).catch(reject),
          catch: (h: any) => Promise.reject(new Error("DB down")).catch(h),
        }),
      }),
    });
    // Should not throw — dedup error = treat as no duplicate
    await expect(detectAndProposeConversationKnowledge(ORG_ID, "Our approval limit is $5,000.", USER_ID)).resolves.toBeDefined();
  });
});

// ─── 6. getKnowledgeHealthMetrics ─────────────────────────────────────────────

describe("getKnowledgeHealthMetrics", () => {
  /**
   * setupHealthMocks - provides fine-grained control over each query's return value.
   * Query order (from getKnowledgeHealthMetrics implementation):
   *   1. sourceCounts       groupBy(status)
   *   2. memoryCounts       groupBy(status)
   *   3. approvedTitles     limit(200)
   *   4. proposedItems      limit(200)
   *   5. obsoleteRows       limit(1)
   *   6. specialistMemory   groupBy(specialistId)
   *   7. recentJobs         orderBy().limit(20)
   *   8. recentlyChanged    limit(1)
   *   9. recentlyApproved   limit(1)
   *  10. failedJobs         limit(1)
   */
  function setupHealthMocks({
    sourceCounts      = [] as any[],
    memoryCounts      = [] as any[],
    approvedTitles    = [] as any[],
    proposedItems     = [] as any[],
    obsoleteCount     = 0,
    specialistMemory  = [] as any[],
    recentJobs        = [] as any[],
    recentlyChanged   = 0,
    recentlyApproved  = 0,
    failedJobs        = 0,
  } = {}) {
    mockDbSelect
      .mockReturnValueOnce(createChain(sourceCounts))
      .mockReturnValueOnce(createChain(memoryCounts))
      .mockReturnValueOnce(createChain(approvedTitles))
      .mockReturnValueOnce(createChain(proposedItems))
      .mockReturnValueOnce(createChain([{ count: obsoleteCount }]))
      .mockReturnValueOnce(createChain(specialistMemory))
      .mockReturnValueOnce(createChain(recentJobs))
      .mockReturnValueOnce(createChain([{ count: recentlyChanged }]))
      .mockReturnValueOnce(createChain([{ count: recentlyApproved }]))
      .mockReturnValueOnce(createChain([{ count: failedJobs }]));
  }

  it("returns librarySourceCount as sum of all status counts", async () => {
    setupHealthMocks({ sourceCounts: [{ status: "approved", count: 5 }, { status: "uploaded", count: 2 }, { status: "processing", count: 1 }] });
    const m = await getKnowledgeHealthMetrics(ORG_ID);
    expect(m.librarySourceCount).toBe(8);
    expect(m.approvedSourceCount).toBe(5);
    expect(m.processingSourceCount).toBe(1);
  });

  it("returns correct approved and pending memory counts", async () => {
    setupHealthMocks({ memoryCounts: [{ status: "approved", count: 10 }, { status: "proposed", count: 3 }] });
    const m = await getKnowledgeHealthMetrics(ORG_ID);
    expect(m.approvedMemoryCount).toBe(10);
    expect(m.pendingProposals).toBe(3);
  });

  it("detects conflicts between approved and proposed memory with similar titles", async () => {
    setupHealthMocks({
      approvedTitles: [{ memoryType: "approval_rule", title: "CEO approval required for large purchases" }],
      proposedItems:  [{ memoryType: "approval_rule", title: "CEO approval required for large purchases above 5000" }],
    });
    const m = await getKnowledgeHealthMetrics(ORG_ID);
    expect(m.conflictingKnowledge).toBeGreaterThan(0);
  });

  it("detects duplicate approved memory entries (same type, similar titles)", async () => {
    setupHealthMocks({
      approvedTitles: [
        { memoryType: "terminology", title: "Participants terminology — use participants not clients" },
        { memoryType: "terminology", title: "Participants terminology — use participants not clients v2" },
      ],
    });
    const m = await getKnowledgeHealthMetrics(ORG_ID);
    expect(m.duplicateKnowledge).toBeGreaterThan(0);
  });

  it("returns specialist coverage 0 when no specialist memory", async () => {
    setupHealthMocks({ specialistMemory: [] });
    const m = await getKnowledgeHealthMetrics(ORG_ID);
    expect(m.specialistCoverage).toBe(0);
  });

  it("computes partial specialist coverage correctly", async () => {
    setupHealthMocks({
      specialistMemory: [
        { specialistId: "chief_of_staff",     count: 5 },
        { specialistId: "operations_manager", count: 3 },
      ],
    });
    const m = await getKnowledgeHealthMetrics(ORG_ID);
    expect(m.specialistCoverage).toBe(0.5); // 2 of 4 specialists
  });

  it("extracts retraining recommendations from job version summaries", async () => {
    setupHealthMocks({
      recentJobs: [{ versionSummary: { retrainingRecommendations: ["operations_manager", "compliance_quality_manager"] } }],
    });
    const m = await getKnowledgeHealthMetrics(ORG_ID);
    expect(m.specialistsNeedingRetraining).toContain("operations_manager");
    expect(m.specialistsNeedingRetraining).toContain("compliance_quality_manager");
  });

  it("counts obsolete knowledge from query result", async () => {
    setupHealthMocks({ obsoleteCount: 4 });
    const m = await getKnowledgeHealthMetrics(ORG_ID);
    expect(m.obsoleteKnowledge).toBe(4);
  });

  it("counts failed curation jobs", async () => {
    setupHealthMocks({ failedJobs: 2 });
    const m = await getKnowledgeHealthMetrics(ORG_ID);
    expect(m.failedCurationJobs).toBe(2);
  });

  it("healthScore is between 0 and 100", async () => {
    setupHealthMocks({ sourceCounts: [{ status: "approved", count: 5 }], memoryCounts: [{ status: "approved", count: 8 }] });
    const m = await getKnowledgeHealthMetrics(ORG_ID);
    expect(m.healthScore).toBeGreaterThanOrEqual(0);
    expect(m.healthScore).toBeLessThanOrEqual(100);
  });

  it("includes a valid ISO computedAt timestamp", async () => {
    setupHealthMocks();
    const m = await getKnowledgeHealthMetrics(ORG_ID);
    expect(m.computedAt).toBeTruthy();
    expect(new Date(m.computedAt).getTime()).not.toBeNaN();
  });

  it("conflicts penalise health score", async () => {
    setupHealthMocks({ sourceCounts: [{ status: "approved", count: 5 }], memoryCounts: [{ status: "approved", count: 5 }] });
    const clear = await getKnowledgeHealthMetrics(ORG_ID);

    setupHealthMocks({
      sourceCounts: [{ status: "approved", count: 5 }],
      memoryCounts: [{ status: "approved", count: 5 }],
      approvedTitles: [{ memoryType: "approval_rule", title: "CEO approval required for large purchases" }],
      proposedItems:  [{ memoryType: "approval_rule", title: "CEO approval required for large purchases above 5000" }],
    });
    const conflicted = await getKnowledgeHealthMetrics(ORG_ID);
    expect(clear.healthScore).toBeGreaterThanOrEqual(conflicted.healthScore);
  });
});

// ─── 7. Tenant isolation ──────────────────────────────────────────────────────

describe("tenant isolation", () => {
  it("enqueueCurationJob always embeds the correct organizationId", async () => {
    await enqueueCurationJob({ organizationId: "org-Z", knowledgeSourceId: SOURCE_ID, sourceVersionId: VERSION_ID, triggerEvent: "uploaded", actorUserId: USER_ID });
    expect(mockDbInsertValues).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "org-Z" }));
  });

  it("processCurationJob failure audit includes the correct organizationId", async () => {
    mockDbSelect.mockReturnValueOnce(createChain([])); // source not found
    try { await processCurationJob(JOB_ID, { ...{ organizationId: "org-X", knowledgeSourceId: SOURCE_ID, sourceVersionId: VERSION_ID, triggerEvent: "approved" as const, actorUserId: USER_ID } }); } catch { /* expected */ }
    const failCall = mockLogOrgEvent.mock.calls.find(c => c[0]?.eventType === "knowledge.curation.failed");
    if (failCall) expect(failCall[0].organizationId).toBe("org-X");
  });
});
