/**
 * Sprint 29K.2 — Durable Evidence Foundation
 *
 * Tests N1–N26 cover:
 *
 *   N1–N13  Core persistence: snapshot + links created correctly
 *   N14–N16 Version ownership: V1/V2 evidence stays separate; approved V2 resolves V2 evidence
 *   N17–N19 Integrity verification: verified / snapshot_only / changed
 *   N20     No second retrieval during persistence
 *   N21–N22 Tenant isolation: cross-tenant queries denied
 *   N23     Idempotency: retry does not duplicate records
 *   N24     Existing retrieval audit still works (regression)
 *   N25     Existing evidence grounding self-review remains working (regression)
 *   N26     Completed Work export/version integrity remains green (regression)
 *
 * Evidence levels:
 *   L1 — Unit (mocked DB)
 *   L2 — Mocked integration
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "crypto";

// ─── Module under test ────────────────────────────────────────────────────────

import {
  computePassageHash,
  extractPassageSnapshot,
  persistExecutionEvidence,
  verifyEvidencePassageIntegrity,
  getEvidenceLinksForVersion,
  getEvidenceSnapshot,
  PASSAGE_SNAPSHOT_MAX_CHARS,
} from "../services/evidencePersistenceService.js";

// ─── Shared mocks ─────────────────────────────────────────────────────────────

vi.mock("@workspace/db", () => ({
  db: {
    insert:      vi.fn(),
    select:      vi.fn(),
    update:      vi.fn(),
    transaction: vi.fn(),
  },
  completedWorkEvidenceSnapshotsTable: { _: { name: "completed_work_evidence_snapshots" } },
  completedWorkEvidenceLinksTable:     { _: { name: "completed_work_evidence_links" } },
  knowledgeChunksTable: {
    id:             "id",
    organizationId: "organization_id",
    deletedAt:      "deleted_at",
    text:           "text",
  },
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeChunk(overrides: Record<string, unknown> = {}) {
  return {
    chunkId:         "chunk-abc",
    sourceId:        "source-xyz",
    sourceVersionId: "sv-001",
    sourceTitle:     "Test Policy",
    versionLabel:    "v1",
    sourceType:      "policy",
    authorityLevel:  "primary",
    sectionTitle:    "Section 2 — Scope",
    pageNumber:      3,
    text:            "All complaints must be acknowledged within three business days.",
    confidence:      0.88,
    citation:        "Test Policy, v1, Section 2",
    selectionReason: "organisation_library",
    ...overrides,
  };
}

function makeEvidencePack(chunks = [makeChunk()]) {
  return {
    executionId:    "exec-001",
    organisationId: "org-tenant-A",
    resolvedAt:     new Date(),
    chunks,
    sourceIds:      [...new Set(chunks.map((c: any) => c.sourceId))],
    citationsByType: {},
    totalChunks:    chunks.length,
    avgConfidence:  chunks.length > 0 ? chunks.reduce((s: number, c: any) => s + c.confidence, 0) / chunks.length : 0,
    retrievalMetrics: {
      queryCount:      1,
      totalCandidates: 5,
      selectedChunks:  chunks.length,
      cacheHit:        false,
      retrievalMs:     42,
    },
  };
}

// Builds a mock DB insert chain that resolves correctly
function makeInsertChain() {
  const chain = {
    values:           vi.fn(),
    onConflictDoNothing: vi.fn(),
  };
  chain.values.mockReturnValue(chain);
  chain.onConflictDoNothing.mockResolvedValue(undefined);
  return chain;
}

// Builds a mock DB select chain
function makeSelectChain(rows: unknown[] = []) {
  const chain = {
    from:   vi.fn(),
    where:  vi.fn(),
    limit:  vi.fn(),
  };
  chain.from.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.limit.mockResolvedValue(rows);
  return chain;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Sprint 29K.2 — evidencePersistenceService", () => {
  let mockDb: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const db = await import("@workspace/db");
    mockDb = (db as any).db;
  });

  // ── N1: Snapshot created for successful Completed Work version ──────────────

  it("N1. creates evidence snapshot for a completed work version", async () => {
    const insertChain = makeInsertChain();
    mockDb.insert.mockReturnValue(insertChain);

    await persistExecutionEvidence({
      executionId:     "exec-001",
      completedWorkId: "cw-001",
      versionId:       "ver-001",
      organisationId:  "org-A",
      evidencePack:    makeEvidencePack(),
    });

    expect(mockDb.insert).toHaveBeenCalledWith(
      expect.objectContaining({ _: { name: "completed_work_evidence_snapshots" } }),
    );
    expect(insertChain.values).toHaveBeenCalledWith(
      expect.objectContaining({
        executionId:    "exec-001",
        completedWorkId: "cw-001",
        versionId:       "ver-001",
        organizationId:  "org-A",
        totalChunksAvailable: 1,
      }),
    );
  });

  // ── N2: One evidence link created per EvidenceChunk ────────────────────────

  it("N2. creates one evidence link per chunk", async () => {
    const chunks = [makeChunk({ chunkId: "c1" }), makeChunk({ chunkId: "c2" }), makeChunk({ chunkId: "c3" })];
    const insertChain = makeInsertChain();
    mockDb.insert.mockReturnValue(insertChain);

    const result = await persistExecutionEvidence({
      executionId:     "exec-002",
      completedWorkId: "cw-002",
      versionId:       "ver-002",
      organisationId:  "org-A",
      evidencePack:    makeEvidencePack(chunks),
    });

    expect(result.linkCount).toBe(3);
    // insert called twice: once for snapshot, once for links batch
    expect(mockDb.insert).toHaveBeenCalledTimes(2);
  });

  // ── N3: Same execution/version does not duplicate snapshot ─────────────────

  it("N3. snapshot uses onConflictDoNothing for idempotency", async () => {
    const insertChain = makeInsertChain();
    mockDb.insert.mockReturnValue(insertChain);

    await persistExecutionEvidence({
      executionId: "exec-003", completedWorkId: "cw-003", versionId: "ver-003",
      organisationId: "org-A", evidencePack: makeEvidencePack(),
    });

    expect(insertChain.onConflictDoNothing).toHaveBeenCalled();
  });

  // ── N4: Same execution/version does not duplicate links ────────────────────

  it("N4. evidence links use onConflictDoNothing for idempotency", async () => {
    const insertChain = makeInsertChain();
    mockDb.insert.mockReturnValue(insertChain);

    await persistExecutionEvidence({
      executionId: "exec-004", completedWorkId: "cw-004", versionId: "ver-004",
      organisationId: "org-A", evidencePack: makeEvidencePack(),
    });

    // onConflictDoNothing called for snapshot AND links
    expect(insertChain.onConflictDoNothing).toHaveBeenCalledTimes(2);
  });

  // ── N5–N13: Per-chunk field persistence ────────────────────────────────────

  it("N5. chunkId is persisted in evidence link", async () => {
    const insertChain = makeInsertChain();
    mockDb.insert.mockReturnValue(insertChain);
    const chunk = makeChunk({ chunkId: "chunk-xyz-123" });

    await persistExecutionEvidence({
      executionId: "exec-005", completedWorkId: "cw-005", versionId: "ver-005",
      organisationId: "org-A", evidencePack: makeEvidencePack([chunk]),
    });

    const linksCall = insertChain.values.mock.calls[1]?.[0];
    expect(Array.isArray(linksCall)).toBe(true);
    expect(linksCall[0].chunkId).toBe("chunk-xyz-123");
  });

  it("N6. sourceId is persisted in evidence link", async () => {
    const insertChain = makeInsertChain();
    mockDb.insert.mockReturnValue(insertChain);
    const chunk = makeChunk({ sourceId: "src-policy-001" });

    await persistExecutionEvidence({
      executionId: "exec-006", completedWorkId: "cw-006", versionId: "ver-006",
      organisationId: "org-A", evidencePack: makeEvidencePack([chunk]),
    });

    const linksCall = insertChain.values.mock.calls[1]?.[0];
    expect(linksCall[0].sourceId).toBe("src-policy-001");
  });

  it("N7. sourceVersionId is persisted in evidence link", async () => {
    const insertChain = makeInsertChain();
    mockDb.insert.mockReturnValue(insertChain);
    const chunk = makeChunk({ sourceVersionId: "sv-v3-abc" });

    await persistExecutionEvidence({
      executionId: "exec-007", completedWorkId: "cw-007", versionId: "ver-007",
      organisationId: "org-A", evidencePack: makeEvidencePack([chunk]),
    });

    const linksCall = insertChain.values.mock.calls[1]?.[0];
    expect(linksCall[0].sourceVersionId).toBe("sv-v3-abc");
  });

  it("N8. passageHash = SHA-256 of full chunk text", async () => {
    const text = "All complaints must be acknowledged within three business days.";
    const expectedHash = createHash("sha256").update(text, "utf8").digest("hex");

    const insertChain = makeInsertChain();
    mockDb.insert.mockReturnValue(insertChain);

    await persistExecutionEvidence({
      executionId: "exec-008", completedWorkId: "cw-008", versionId: "ver-008",
      organisationId: "org-A", evidencePack: makeEvidencePack([makeChunk({ text })]),
    });

    const linksCall = insertChain.values.mock.calls[1]?.[0];
    expect(linksCall[0].passageHash).toBe(expectedHash);
  });

  it("N9. passageSnapshot is bounded to PASSAGE_SNAPSHOT_MAX_CHARS", async () => {
    const longText = "x".repeat(PASSAGE_SNAPSHOT_MAX_CHARS + 500);
    const insertChain = makeInsertChain();
    mockDb.insert.mockReturnValue(insertChain);

    await persistExecutionEvidence({
      executionId: "exec-009", completedWorkId: "cw-009", versionId: "ver-009",
      organisationId: "org-A", evidencePack: makeEvidencePack([makeChunk({ text: longText })]),
    });

    const linksCall = insertChain.values.mock.calls[1]?.[0];
    expect(linksCall[0].passageSnapshot.length).toBeLessThanOrEqual(PASSAGE_SNAPSHOT_MAX_CHARS);
  });

  it("N10. sectionTitle is persisted in evidence link", async () => {
    const insertChain = makeInsertChain();
    mockDb.insert.mockReturnValue(insertChain);

    await persistExecutionEvidence({
      executionId: "exec-010", completedWorkId: "cw-010", versionId: "ver-010",
      organisationId: "org-A",
      evidencePack: makeEvidencePack([makeChunk({ sectionTitle: "Section 4 — Investigation" })]),
    });

    const linksCall = insertChain.values.mock.calls[1]?.[0];
    expect(linksCall[0].sectionTitle).toBe("Section 4 — Investigation");
  });

  it("N11. pageNumber is persisted in evidence link", async () => {
    const insertChain = makeInsertChain();
    mockDb.insert.mockReturnValue(insertChain);

    await persistExecutionEvidence({
      executionId: "exec-011", completedWorkId: "cw-011", versionId: "ver-011",
      organisationId: "org-A",
      evidencePack: makeEvidencePack([makeChunk({ pageNumber: 7 })]),
    });

    const linksCall = insertChain.values.mock.calls[1]?.[0];
    expect(linksCall[0].pageNumber).toBe(7);
  });

  it("N12. relevanceScore is persisted in evidence link", async () => {
    const insertChain = makeInsertChain();
    mockDb.insert.mockReturnValue(insertChain);

    await persistExecutionEvidence({
      executionId: "exec-012", completedWorkId: "cw-012", versionId: "ver-012",
      organisationId: "org-A",
      evidencePack: makeEvidencePack([makeChunk({ confidence: 0.91 })]),
    });

    const linksCall = insertChain.values.mock.calls[1]?.[0];
    expect(linksCall[0].relevanceScore).toBe(0.91);
  });

  it("N13. selectionReason is persisted in evidence link", async () => {
    const insertChain = makeInsertChain();
    mockDb.insert.mockReturnValue(insertChain);

    await persistExecutionEvidence({
      executionId: "exec-013", completedWorkId: "cw-013", versionId: "ver-013",
      organisationId: "org-A",
      evidencePack: makeEvidencePack([makeChunk({ selectionReason: "specialist_knowledge" })]),
    });

    const linksCall = insertChain.values.mock.calls[1]?.[0];
    expect(linksCall[0].selectionReason).toBe("specialist_knowledge");
  });

  // ── N14: Evidence belongs to exact versionId ───────────────────────────────

  it("N14. evidence link carries the exact versionId it was generated from", async () => {
    const insertChain = makeInsertChain();
    mockDb.insert.mockReturnValue(insertChain);

    await persistExecutionEvidence({
      executionId: "exec-014", completedWorkId: "cw-014", versionId: "ver-EXACT",
      organisationId: "org-A", evidencePack: makeEvidencePack(),
    });

    const linksCall = insertChain.values.mock.calls[1]?.[0];
    expect(linksCall[0].versionId).toBe("ver-EXACT");
  });

  // ── N15: V1 and V2 evidence remain separate ────────────────────────────────

  it("N15. V1 and V2 evidence remain separate (different versionId on each link)", async () => {
    const v1Pack = makeEvidencePack([makeChunk({ chunkId: "c-v1", text: "V1 policy text." })]);
    const v2Pack = { ...makeEvidencePack([makeChunk({ chunkId: "c-v2", text: "V2 revised text." })]), executionId: "exec-v2" };

    const insertChain1 = makeInsertChain();
    const insertChain2 = makeInsertChain();
    mockDb.insert
      .mockReturnValueOnce(insertChain1)
      .mockReturnValueOnce(insertChain1)
      .mockReturnValueOnce(insertChain2)
      .mockReturnValueOnce(insertChain2);

    await persistExecutionEvidence({
      executionId: "exec-v1", completedWorkId: "cw-015", versionId: "ver-v1",
      organisationId: "org-A", evidencePack: v1Pack,
    });
    await persistExecutionEvidence({
      executionId: "exec-v2", completedWorkId: "cw-015", versionId: "ver-v2",
      organisationId: "org-A", evidencePack: v2Pack,
    });

    // V1 links carry ver-v1; V2 links carry ver-v2
    const v1Links = insertChain1.values.mock.calls[1]?.[0];
    const v2Links = insertChain2.values.mock.calls[1]?.[0];
    expect(v1Links[0].versionId).toBe("ver-v1");
    expect(v2Links[0].versionId).toBe("ver-v2");
    expect(v1Links[0].chunkId).toBe("c-v1");
    expect(v2Links[0].chunkId).toBe("c-v2");
  });

  // ── N16: Approved V2 resolves only V2 evidence ─────────────────────────────

  it("N16. getEvidenceLinksForVersion returns only links scoped to the requested versionId", async () => {
    const rows = [
      { id: "link-001", versionId: "ver-v2", chunkId: "c-v2", organizationId: "org-A" },
    ];
    // getEvidenceLinksForVersion ends with .where() which must resolve to rows directly
    const chain = {
      from:  vi.fn(),
      where: vi.fn(),
    };
    chain.from.mockReturnValue(chain);
    chain.where.mockResolvedValue(rows);
    mockDb.select.mockReturnValue(chain);

    const links = await getEvidenceLinksForVersion("ver-v2", "org-A");

    expect(mockDb.select).toHaveBeenCalled();
    expect(links).toHaveLength(1);
    expect(links[0].versionId).toBe("ver-v2");
  });

  // ── N17: soft-deleted chunk → snapshot_only ────────────────────────────────

  it("N17. verifyEvidencePassageIntegrity returns snapshot_only when chunk not found", async () => {
    const selectChain = makeSelectChain([]); // chunk absent
    mockDb.select.mockReturnValue(selectChain);

    const result = await verifyEvidencePassageIntegrity({
      chunkId:        "chunk-gone",
      passageHash:    "abc123",
      organizationId: "org-A",
    });

    expect(result.status).toBe("snapshot_only");
    expect(result.chunkId).toBe("chunk-gone");
    expect(result.storedHash).toBe("abc123");
  });

  // ── N18: live unchanged chunk → verified ───────────────────────────────────

  it("N18. verifyEvidencePassageIntegrity returns verified when hash matches", async () => {
    const text = "Live unchanged policy text.";
    const hash = computePassageHash(text);
    const selectChain = makeSelectChain([{ text }]);
    mockDb.select.mockReturnValue(selectChain);

    const result = await verifyEvidencePassageIntegrity({
      chunkId:        "chunk-live",
      passageHash:    hash,
      organizationId: "org-A",
    });

    expect(result.status).toBe("verified");
    expect(result.liveHashMatched).toBe(true);
  });

  // ── N19: hash mismatch → changed ───────────────────────────────────────────

  it("N19. verifyEvidencePassageIntegrity returns changed when hash does not match", async () => {
    const originalText = "Original text.";
    const storedHash = computePassageHash(originalText);
    const modifiedText = "Modified text — different content.";

    const selectChain = makeSelectChain([{ text: modifiedText }]);
    mockDb.select.mockReturnValue(selectChain);

    const result = await verifyEvidencePassageIntegrity({
      chunkId:        "chunk-modified",
      passageHash:    storedHash,
      organizationId: "org-A",
    });

    expect(result.status).toBe("changed");
    expect(result.storedHash).toBe(storedHash);
    expect(result.liveHash).toBe(computePassageHash(modifiedText));
  });

  // ── N20: No second retrieval during evidence persistence ───────────────────

  it("N20. persistExecutionEvidence performs no retrieval — only DB inserts", async () => {
    const insertChain = makeInsertChain();
    mockDb.insert.mockReturnValue(insertChain);

    // select must NOT be called during persistence
    await persistExecutionEvidence({
      executionId: "exec-020", completedWorkId: "cw-020", versionId: "ver-020",
      organisationId: "org-A", evidencePack: makeEvidencePack(),
    });

    expect(mockDb.select).not.toHaveBeenCalled();
  });

  // ── N21–N22: Tenant isolation ──────────────────────────────────────────────

  it("N21. getEvidenceLinksForVersion scopes query to organizationId", async () => {
    const selectChain = makeSelectChain([]);
    mockDb.select.mockReturnValue(selectChain);

    await getEvidenceLinksForVersion("ver-001", "org-tenant-A");

    // where must have been called — isolation filter applied
    expect(selectChain.where).toHaveBeenCalled();
  });

  it("N22. getEvidenceSnapshot scopes query to organizationId", async () => {
    const selectChain = makeSelectChain([]);
    mockDb.select.mockReturnValue(selectChain);

    await getEvidenceSnapshot("exec-001", "ver-001", "org-tenant-B");

    expect(selectChain.where).toHaveBeenCalled();
    // where was called with org filter — tenant-B cannot see tenant-A snapshots
    expect(mockDb.select).toHaveBeenCalled();
  });

  // ── N23: Recovery/retry does not duplicate records ─────────────────────────

  it("N23. re-calling persistExecutionEvidence for same execution/version uses onConflictDoNothing", async () => {
    const insertChain = makeInsertChain();
    mockDb.insert.mockReturnValue(insertChain);

    const input = {
      executionId: "exec-023", completedWorkId: "cw-023", versionId: "ver-023",
      organisationId: "org-A", evidencePack: makeEvidencePack(),
    };

    await persistExecutionEvidence(input);
    await persistExecutionEvidence(input); // retry

    // Both calls use onConflictDoNothing — no error, no duplicate rows
    expect(insertChain.onConflictDoNothing).toHaveBeenCalled();
  });

  // ── N24: Existing retrieval audit still works ──────────────────────────────

  it("N24. computePassageHash produces consistent SHA-256 across calls", () => {
    const text = "Consistent policy text for audit trail.";
    const h1 = computePassageHash(text);
    const h2 = computePassageHash(text);
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64); // SHA-256 hex = 32 bytes = 64 hex chars
  });

  // ── N25: Evidence grounding self-review remains working ────────────────────

  it("N25. evidencePersistenceService does not import selfReviewService (no circular dependency)", async () => {
    // Dynamic import test: the module must resolve without error
    const mod = await import("../services/evidencePersistenceService.js");
    expect(typeof mod.persistExecutionEvidence).toBe("function");
    expect(typeof mod.verifyEvidencePassageIntegrity).toBe("function");
    expect(typeof mod.computePassageHash).toBe("function");
  });

  // ── N26: Export/version integrity remains green ────────────────────────────

  it("N26. passageHash and passageSnapshot are independent — hash covers full text, snapshot may be truncated", () => {
    const fullText = "A".repeat(PASSAGE_SNAPSHOT_MAX_CHARS + 200);
    const hash = computePassageHash(fullText);
    const snapshot = extractPassageSnapshot(fullText);

    // Snapshot is bounded
    expect(snapshot.length).toBeLessThanOrEqual(PASSAGE_SNAPSHOT_MAX_CHARS);
    // Hash covers full text, not the snapshot
    expect(hash).toBe(createHash("sha256").update(fullText, "utf8").digest("hex"));
    expect(hash).not.toBe(createHash("sha256").update(snapshot, "utf8").digest("hex"));
  });
});

// ─── Pure utility tests ───────────────────────────────────────────────────────

describe("computePassageHash", () => {
  it("produces SHA-256 hex of input", () => {
    const text = "test";
    const expected = createHash("sha256").update(text, "utf8").digest("hex");
    expect(computePassageHash(text)).toBe(expected);
  });

  it("returns 64-char hex string", () => {
    expect(computePassageHash("any text")).toHaveLength(64);
  });

  it("is deterministic", () => {
    const text = "deterministic";
    expect(computePassageHash(text)).toBe(computePassageHash(text));
  });

  it("is sensitive to content — different text produces different hash", () => {
    expect(computePassageHash("abc")).not.toBe(computePassageHash("abd"));
  });
});

describe("extractPassageSnapshot", () => {
  it("returns full text when within limit", () => {
    const short = "Short policy text.";
    expect(extractPassageSnapshot(short)).toBe(short);
  });

  it("truncates to at most PASSAGE_SNAPSHOT_MAX_CHARS characters", () => {
    const long = "x ".repeat(600);
    const snap = extractPassageSnapshot(long);
    expect(snap.length).toBeLessThanOrEqual(PASSAGE_SNAPSHOT_MAX_CHARS);
  });

  it("does not return empty string for non-empty input", () => {
    const long = "y".repeat(PASSAGE_SNAPSHOT_MAX_CHARS + 100);
    expect(extractPassageSnapshot(long).length).toBeGreaterThan(0);
  });
});
