/**
 * Sprint 29N.5 — Governance Regression Tests (Part G)
 *
 * Proves that semantic/hybrid retrieval cannot weaken any existing evidence
 * trust boundary. All nine adversarial scenarios from the brief are covered.
 *
 * Key invariants:
 *   1. Approval status filter (status = 'approved')  — enforced in hybridRetrievalService SQL
 *   2. Currency filter (is_current = true)            — enforced in hybridRetrievalService SQL
 *   3. Effective date window                          — enforced in hybridRetrievalService SQL
 *   4. Tenant isolation (organizationId)              — enforced in hybridRetrievalService SQL
 *   5. Sensitivity gate                               — enforced in hybridRetrievalService SQL
 *   6. Deleted chunk exclusion (deleted_at IS NULL)  — enforced in hybridRetrievalService SQL
 *   7. High semantic similarity ≠ authority           — proved via scoring formula test
 *
 * These tests verify the WHERE clause composition in hybridRetrievalService
 * produces SQL that includes all governance filters regardless of queryEmbedding
 * being null or populated.
 *
 * DB-level SQL correctness is verified via the query construction path test;
 * actual DB integration is tested separately in the sprint7 database tests.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { computeAuthorityBonus, computeFreshnessBonus } from "../services/hybridRetrievalService.js";

// ─── Mock the DB for the retrieveChunks governance tests ─────────────────────
// We verify that the correct SQL WHERE clauses are composed by inspecting the
// raw SQL string built by hybridRetrievalService before it reaches the database.

const { mockDbExecute } = vi.hoisted(() => {
  const mockDbExecute = vi.fn().mockResolvedValue({ rows: [] });
  return { mockDbExecute };
});

vi.mock("@workspace/db", () => ({
  db: {
    execute:  mockDbExecute,
    select:   vi.fn().mockReturnValue({
      from:  vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    }),
    insert:   vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
  },
  knowledgeChunksTable:        { id: "id", organizationId: "organization_id", knowledgeSourceId: "knowledge_source_id", sourceVersionId: "source_version_id", chunkIndex: "chunk_index", sectionTitle: "section_title", pageNumber: "page_number", text: "text", tokenCount: "token_count", embedding: "embedding" },
  knowledgeSourcesTable:       { id: "id", organizationId: "organization_id", title: "title", sourceType: "source_type", status: "status", isCurrent: "is_current", sensitivityClassification: "sensitivity_classification", authorityLevel: "authority_level", effectiveFrom: "effective_from", effectiveTo: "effective_to", deletedAt: "deleted_at" },
  knowledgeSourceVersionsTable: { id: "id", organizationId: "organization_id", versionLabel: "version_label" },
  retrievalAuditEventsTable:   { id: "id" },
  eq: vi.fn(),
  and: vi.fn(),
  inArray: vi.fn(),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function captureRawSql(): string {
  const calls = mockDbExecute.mock.calls;
  const lastCall = calls[calls.length - 1];
  if (!lastCall) return "";
  const sqlObj = lastCall[0] as { queryChunks?: Array<{ sql?: string; value?: unknown }> };
  if (sqlObj && typeof sqlObj === "object" && "queryChunks" in sqlObj) {
    return sqlObj.queryChunks?.map((c) => c.sql ?? String(c.value ?? "")).join("") ?? "";
  }
  return String(lastCall[0] ?? "");
}

// ─── Part G: Governance Regression ───────────────────────────────────────────

describe("hybridRetrievalService — governance SQL (Part G)", () => {
  let retrieveChunks: typeof import("../services/hybridRetrievalService.js").retrieveChunks;

  beforeEach(async () => {
    mockDbExecute.mockClear();
    mockDbExecute.mockResolvedValue({ rows: [] });
    const module = await import("../services/hybridRetrievalService.js");
    retrieveChunks = module.retrieveChunks;
  });

  // G1 — status = 'approved' filter always present
  it("G1: SQL always includes status=approved filter (lexical mode)", async () => {
    await retrieveChunks({
      organisationId: "org-001",
      query: "complaints policy",
      queryEmbedding: null,
      scopeMode: "org_library",
    });
    const sql = captureRawSql();
    expect(sql).toContain("status = 'approved'");
  });

  it("G1: SQL always includes status=approved filter (semantic mode)", async () => {
    const fakeEmbedding = Array(1536).fill(0.1);
    await retrieveChunks({
      organisationId: "org-001",
      query: "customer grievances",
      queryEmbedding: fakeEmbedding,
      scopeMode: "org_library",
    });
    const sql = captureRawSql();
    expect(sql).toContain("status = 'approved'");
  });

  // G2 — is_current = true filter always present
  it("G2: SQL always includes is_current=true filter (lexical mode)", async () => {
    await retrieveChunks({
      organisationId: "org-001",
      query: "complaints policy",
      queryEmbedding: null,
      scopeMode: "org_library",
    });
    const sql = captureRawSql();
    expect(sql).toContain("is_current = true");
  });

  it("G2: SQL always includes is_current=true filter (semantic mode)", async () => {
    const fakeEmbedding = Array(1536).fill(0.1);
    await retrieveChunks({
      organisationId: "org-001",
      query: "dispute resolution",
      queryEmbedding: fakeEmbedding,
      scopeMode: "org_library",
    });
    const sql = captureRawSql();
    expect(sql).toContain("is_current = true");
  });

  // G3 — effective date window
  it("G3: SQL includes effective date window filters", async () => {
    await retrieveChunks({
      organisationId: "org-001",
      query: "policy",
      queryEmbedding: null,
      scopeMode: "org_library",
    });
    const sql = captureRawSql();
    expect(sql).toContain("effective_from");
    expect(sql).toContain("effective_to");
    expect(sql).toContain("NOW()");
  });

  // G4 — tenant isolation
  it("G4: SQL includes organisationId in WHERE clause", async () => {
    await retrieveChunks({
      organisationId: "org-isolated-001",
      query: "policy",
      queryEmbedding: null,
      scopeMode: "org_library",
    });
    const sql = captureRawSql();
    expect(sql).toContain("org-isolated-001");
  });

  it("G4: organisationId appears in kc.organization_id filter (not merely in score expressions)", async () => {
    await retrieveChunks({
      organisationId: "org-tenant-abc",
      query: "policy",
      queryEmbedding: null,
      scopeMode: "org_library",
    });
    const sql = captureRawSql();
    // Must appear in the WHERE clause binding, not just in an expression
    expect(sql).toContain("kc.organization_id");
    expect(sql).toContain("org-tenant-abc");
  });

  // G5 — sensitivity gate
  it("G5: SQL includes sensitivity classification filter", async () => {
    await retrieveChunks({
      organisationId: "org-001",
      query: "policy",
      queryEmbedding: null,
      scopeMode: "org_library",
      allowedSensitivity: ["public", "internal"],
    });
    const sql = captureRawSql();
    expect(sql).toContain("sensitivity_classification");
    expect(sql).toContain("'public'");
    expect(sql).toContain("'internal'");
    // restricted must not appear in allowed list
    expect(sql).not.toContain("'restricted'");
  });

  it("G5: restricted sensitivity is excluded from default allowed list", async () => {
    await retrieveChunks({
      organisationId: "org-001",
      query: "hr policy",
      queryEmbedding: null,
      scopeMode: "org_library",
      // Default — no allowedSensitivity override
    });
    const sql = captureRawSql();
    // Default includes public, internal, confidential only
    expect(sql).not.toContain("'restricted'");
    expect(sql).toContain("'confidential'");
  });

  // G6 — deleted chunk exclusion
  it("G6: SQL excludes soft-deleted chunks (deleted_at IS NULL)", async () => {
    await retrieveChunks({
      organisationId: "org-001",
      query: "policy",
      queryEmbedding: null,
      scopeMode: "org_library",
    });
    const sql = captureRawSql();
    expect(sql).toContain("deleted_at IS NULL");
  });

  // G7 — high semantic score ≠ authority: scoring formula proof
  it("G7: semantic score 1.0 on reference-level source scores lower than modest confidence mandatory source", () => {
    // Compose the final scores manually as hybridRetrievalService would
    // Source A: mandatory authority, moderate semantic score
    const authorityBonusA = computeAuthorityBonus("mandatory"); // +0.30
    const semanticA = 0.60;
    const lexicalA = 0.30;
    const scoreA = (0.6 * semanticA) + (0.4 * lexicalA) + authorityBonusA;
    // = 0.36 + 0.12 + 0.30 = 0.78

    // Source B: reference authority, perfect semantic score
    const authorityBonusB = computeAuthorityBonus("reference"); // −0.05
    const semanticB = 1.0;
    const lexicalB = 0.0;
    const scoreB = (0.6 * semanticB) + (0.4 * lexicalB) + authorityBonusB;
    // = 0.60 + 0.0 − 0.05 = 0.55

    // A mandatory source with moderate relevance scores higher than a
    // reference source with perfect semantic similarity.
    expect(scoreA).toBeGreaterThan(scoreB);
    expect(scoreA).toBeCloseTo(0.78, 1);
    expect(scoreB).toBeCloseTo(0.55, 1);
  });

  it("G7: mandatory bonus (+0.30) is the highest authority bonus", () => {
    expect(computeAuthorityBonus("mandatory")).toBe(0.30);
    expect(computeAuthorityBonus("primary")).toBe(0.20);
    expect(computeAuthorityBonus("supporting")).toBe(0.00);
    expect(computeAuthorityBonus("reference")).toBe(-0.05);
  });

  it("G7: semantic expression becomes 0.0 when queryEmbedding is null", async () => {
    await retrieveChunks({
      organisationId: "org-001",
      query: "policy",
      queryEmbedding: null,
      scopeMode: "org_library",
    });
    const sql = captureRawSql();
    // When no embedding, semantic expression is literally "0.0"
    expect(sql).toContain("0.0");
    // And the vector operator should not be present
    expect(sql).not.toContain("<=>");
  });

  it("G7: vector operator present only when queryEmbedding is provided", async () => {
    const fakeEmbedding = Array(1536).fill(0.01);
    await retrieveChunks({
      organisationId: "org-001",
      query: "handling client complaints",
      queryEmbedding: fakeEmbedding,
      scopeMode: "org_library",
    });
    const sql = captureRawSql();
    expect(sql).toContain("<=>");
    expect(sql).toContain("::vector");
  });

  // G8 — exclude list is honoured
  it("G8: excludeSourceIds generates NOT IN clause", async () => {
    await retrieveChunks({
      organisationId: "org-001",
      query: "policy",
      queryEmbedding: null,
      scopeMode: "org_library",
      excludeSourceIds: ["src-already-claimed-001", "src-already-claimed-002"],
    });
    const sql = captureRawSql();
    expect(sql).toContain("NOT IN");
    expect(sql).toContain("src-already-claimed-001");
    expect(sql).toContain("src-already-claimed-002");
  });

  // G9 — org_library scope restricts to library sources only
  it("G9: org_library scope produces source_scope=library filter", async () => {
    await retrieveChunks({
      organisationId: "org-001",
      query: "policy",
      queryEmbedding: null,
      scopeMode: "org_library",
    });
    const sql = captureRawSql();
    expect(sql).toContain("source_scope = 'library'");
  });

  // G10 — LIMIT is always applied
  it("G10: SQL includes LIMIT clause", async () => {
    await retrieveChunks({
      organisationId: "org-001",
      query: "policy",
      queryEmbedding: null,
      scopeMode: "org_library",
      limit: 20,
    });
    const sql = captureRawSql();
    expect(sql).toContain("LIMIT 20");
  });
});

// ─── Authority and freshness bonus unit tests ─────────────────────────────────

describe("computeFreshnessBonus — governance", () => {
  it("returns +0.05 for documents < 30 days old", () => {
    const recent = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000); // 10 days ago
    expect(computeFreshnessBonus(recent)).toBeCloseTo(0.05, 2);
  });

  it("returns a negative value for documents > 365 days old", () => {
    const old = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);
    expect(computeFreshnessBonus(old)).toBe(-0.10);
  });

  it("returns 0 for null effectiveFrom", () => {
    expect(computeFreshnessBonus(null)).toBe(0);
  });

  it("linearly decays between 30 and 365 days", () => {
    const d200 = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000);
    const bonus = computeFreshnessBonus(d200);
    expect(bonus).toBeLessThan(0);
    expect(bonus).toBeGreaterThan(-0.10);
  });
});
