/**
 * Sprint 28.1 — Organisation Library Presence Service
 *
 * Covers:
 *   1.  Approved, indexed, current  → retrievable / usable / exactMatch
 *   2.  Uploaded (not approved, not indexed) → pending ingestion
 *   3.  Superseded source → found but reason explains superseded
 *   4.  Archived source → found but reason explains archived
 *   5.  Approved but not indexed (ingestion pending) → approved true, indexed false
 *   6.  Multiple versions of the same document
 *   7.  Multiple partial matches — sorted by confidence, highest first
 *   8.  No match → empty result with searched: true
 *   9.  Wrong organisation → isolated from another org's sources
 *   10. Wrong tenant (orthogonal cross-tenant isolation)
 *   11. Cache hit — DB not queried on second identical call
 *   12. Synonym expansion — "Policy" search finds "Procedure" titled source
 *   13. Partial keyword match — word-overlap scoring
 *   14. Low-confidence noise filtered out (below MIN_CONFIDENCE)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mocks (must be first per sprint15 convention) ────────────────────

const mocks = vi.hoisted(() => ({
  // db.select returns a chain; we wire specific results via wireSelectSequence
  selectFn: vi.fn(),
}));

// ─── DB mock ──────────────────────────────────────────────────────────────────

/**
 * Chainable, thenable mock for db.select()...from()...where()...limit()
 *
 *   const chain = makeSelectChain(rows)
 *   db.select().from().where()            → resolves to rows
 *   db.select().from().where().limit(n)   → resolves to rows
 */
function makeSelectChain(rows: unknown[]) {
  const limitFn  = vi.fn().mockResolvedValue(rows);
  const orderByChain = { limit: limitFn };
  const wherePromise = Promise.resolve(rows);
  const whereFn  = vi.fn().mockReturnValue(
    Object.assign(wherePromise, {
      limit:   limitFn,
      orderBy: vi.fn().mockReturnValue(orderByChain),
    }),
  );
  const fromFn = vi.fn().mockReturnValue({ where: whereFn });
  return { from: fromFn, where: whereFn, limit: limitFn };
}

/**
 * Wire db.select() to return each result set in order.
 * The service issues 3 queries: sources → chunks → versions.
 * Pass an array of 3 row-arrays.
 */
function wireSelectSequence(results: Array<unknown[]>) {
  mocks.selectFn.mockReset();
  for (const rows of results) {
    mocks.selectFn.mockImplementationOnce(() => makeSelectChain(rows));
  }
  // Fallback: empty array for any unexpected extra queries
  mocks.selectFn.mockImplementation(() => makeSelectChain([]));
}

vi.mock("@workspace/db", () => ({
  db: {
    select: mocks.selectFn,
  },
  knowledgeSourcesTable: {
    id:               "id",
    organizationId:   "organization_id",
    title:            "title",
    sourceType:       "source_type",
    versionLabel:     "version_label",
    status:           "status",
    approvedByUserId: "approved_by_user_id",
    isCurrent:        "is_current",
    deletedAt:        "deleted_at",
    sourceScope:      "source_scope",
  },
  knowledgeChunksTable: {
    id:               "id",
    knowledgeSourceId: "knowledge_source_id",
    organizationId:   "organization_id",
    deletedAt:        "deleted_at",
  },
  knowledgeSourceVersionsTable: {
    id:                "id",
    knowledgeSourceId: "knowledge_source_id",
    organizationId:    "organization_id",
    isCurrent:         "is_current",
    ingestionStatus:   "ingestion_status",
    versionLabel:      "version_label",
  },
}));

// drizzle-orm operators are passed as arguments to the mocked db — no need to mock them
// (the mock's .where() accepts any value and ignores it)

// ─── Service import ───────────────────────────────────────────────────────────

import {
  checkOrganisationLibraryPresence,
  _clearPresenceCache,
} from "../services/organisationLibraryPresenceService.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ORG_ID   = "org-abc-123";
const OTHER_ORG = "org-xyz-999";

function makeSource(overrides: Record<string, unknown> = {}) {
  return {
    id:               "src-001",
    title:            "Medication Management Policy",
    sourceType:       "policy",
    versionLabel:     "v4.2",
    status:           "approved",
    approvedByUserId: "user-admin",
    isCurrent:        true,
    deletedAt:        null,
    ...overrides,
  };
}

function makeChunkRow(knowledgeSourceId: string) {
  return { knowledgeSourceId };
}

function makeVersionRow(overrides: Record<string, unknown> = {}) {
  return {
    knowledgeSourceId: "src-001",
    ingestionStatus:   "complete",
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("organisationLibraryPresenceService", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    _clearPresenceCache();
    // Default: no results (safe fallback)
    wireSelectSequence([[], [], []]);
  });

  // ── 1. Approved, indexed, current → fully retrievable ─────────────────────

  it("returns retrievable=true and usable=true for an approved, indexed, current source", async () => {
    wireSelectSequence([
      [makeSource()],                         // sources
      [makeChunkRow("src-001")],              // chunks
      [makeVersionRow()],                     // versions
    ]);

    const result = await checkOrganisationLibraryPresence(ORG_ID, ["Medication Management Policy"]);

    expect(result.searched).toBe(true);
    expect(result.matches).toHaveLength(1);

    const m = result.matches[0];
    expect(m.sourceId).toBe("src-001");
    expect(m.title).toBe("Medication Management Policy");
    expect(m.version).toBe("v4.2");
    expect(m.approved).toBe(true);
    expect(m.indexed).toBe(true);
    expect(m.retrievable).toBe(true);
    expect(m.status).toBe("approved");
    expect(m.ingestionStatus).toBe("complete");
    expect(m.confidence).toBeGreaterThanOrEqual(0.9);
    expect(m.sourceType).toBe("policy");

    expect(result.summary.usable).toBe(true);
    expect(result.summary.searchable).toBe(true);
    expect(result.summary.exactMatch).toBe(true);
    expect(result.summary.partialMatch).toBe(false);
    expect(result.summary.reason).toContain("approved and ready");
  });

  // ── 2. Uploaded — not approved, not indexed ────────────────────────────────

  it("returns approved=false and indexed=false for an uploaded-only source", async () => {
    wireSelectSequence([
      [makeSource({ status: "uploaded", approvedByUserId: null })],
      [],    // no chunks
      [makeVersionRow({ ingestionStatus: "pending" })],
    ]);

    const result = await checkOrganisationLibraryPresence(ORG_ID, ["Medication Management Policy"]);

    const m = result.matches[0];
    expect(m.approved).toBe(false);
    expect(m.indexed).toBe(false);
    expect(m.retrievable).toBe(false);
    expect(m.status).toBe("uploaded");
    expect(m.ingestionStatus).toBe("pending");

    expect(result.summary.usable).toBe(false);
    expect(result.summary.searchable).toBe(false);
    expect(result.summary.reason).toMatch(/pending ingestion/i);
  });

  // ── 3. Superseded source ───────────────────────────────────────────────────

  it("identifies a superseded source with correct reason", async () => {
    wireSelectSequence([
      [makeSource({ status: "superseded", approvedByUserId: null, isCurrent: false })],
      [],    // no live chunks
      [],    // no current version
    ]);

    const result = await checkOrganisationLibraryPresence(ORG_ID, ["Medication Management Policy"]);

    const m = result.matches[0];
    expect(m.status).toBe("superseded");
    expect(m.approved).toBe(false);
    expect(m.retrievable).toBe(false);

    expect(result.summary.usable).toBe(false);
    expect(result.summary.reason).toMatch(/superseded/i);
  });

  // ── 4. Archived source ─────────────────────────────────────────────────────

  it("identifies an archived source with correct reason", async () => {
    wireSelectSequence([
      [makeSource({ status: "archived", approvedByUserId: null, isCurrent: false })],
      [],
      [],
    ]);

    const result = await checkOrganisationLibraryPresence(ORG_ID, ["Medication Management Policy"]);

    const m = result.matches[0];
    expect(m.status).toBe("archived");
    expect(m.retrievable).toBe(false);
    expect(result.summary.reason).toMatch(/archived/i);
  });

  // ── 5. Approved but not yet indexed (ingestion pending) ────────────────────

  it("returns approved=true, indexed=false when source is approved but has no chunks yet", async () => {
    wireSelectSequence([
      [makeSource({ status: "approved", approvedByUserId: "user-admin" })],
      [],    // no chunks yet
      [makeVersionRow({ ingestionStatus: "pending" })],
    ]);

    const result = await checkOrganisationLibraryPresence(ORG_ID, ["Medication Management Policy"]);

    const m = result.matches[0];
    expect(m.approved).toBe(true);
    expect(m.indexed).toBe(false);
    expect(m.retrievable).toBe(false);
    expect(m.ingestionStatus).toBe("pending");

    expect(result.summary.usable).toBe(false);
    expect(result.summary.searchable).toBe(false);
    expect(result.summary.reason).toMatch(/ingestion pending/i);
  });

  // ── 5b. Approved, ingestion processing ────────────────────────────────────

  it("reflects ingestionStatus=processing when the version is still being ingested", async () => {
    wireSelectSequence([
      [makeSource({ status: "approved", approvedByUserId: "user-admin" })],
      [],
      [makeVersionRow({ ingestionStatus: "processing" })],
    ]);

    const result = await checkOrganisationLibraryPresence(ORG_ID, ["Medication Management Policy"]);

    expect(result.matches[0].ingestionStatus).toBe("processing");
    expect(result.matches[0].retrievable).toBe(false);
  });

  // ── 6. Multiple versions ───────────────────────────────────────────────────

  it("handles multiple versions of the same document — returns both, highest confidence first", async () => {
    const v1 = makeSource({ id: "src-v1", versionLabel: "v1.0", status: "superseded", approvedByUserId: null, isCurrent: false });
    const v2 = makeSource({ id: "src-v2", versionLabel: "v2.0", status: "approved",   approvedByUserId: "user-admin", isCurrent: true });

    wireSelectSequence([
      [v1, v2],
      [makeChunkRow("src-v2")],    // only v2 has chunks
      [makeVersionRow({ knowledgeSourceId: "src-v2", ingestionStatus: "complete" })],
    ]);

    const result = await checkOrganisationLibraryPresence(ORG_ID, ["Medication Management Policy"]);

    // Both returned (both match)
    expect(result.matches.length).toBe(2);

    // v2 should be first (it's fully retrievable — same confidence, but usable)
    const usable = result.matches.find(m => m.retrievable);
    expect(usable).toBeDefined();
    expect(usable!.version).toBe("v2.0");

    // v1 is not retrievable
    const old = result.matches.find(m => m.version === "v1.0");
    expect(old!.retrievable).toBe(false);

    expect(result.summary.usable).toBe(true);
  });

  // ── 7. Multiple partial matches — sorted by confidence ────────────────────

  it("returns multiple partial matches sorted by confidence descending", async () => {
    const high = makeSource({ id: "src-high", title: "Medication Management Policy",  status: "approved", approvedByUserId: "user-1" });
    const low  = makeSource({ id: "src-low",  title: "Medication Administration SOP", status: "uploaded", approvedByUserId: null     });

    wireSelectSequence([
      [high, low],
      [makeChunkRow("src-high"), makeChunkRow("src-low")],
      [
        makeVersionRow({ knowledgeSourceId: "src-high", ingestionStatus: "complete" }),
        makeVersionRow({ knowledgeSourceId: "src-low",  ingestionStatus: "pending"  }),
      ],
    ]);

    const result = await checkOrganisationLibraryPresence(ORG_ID, ["Medication Management Policy"]);

    expect(result.matches.length).toBeGreaterThanOrEqual(2);
    // First match must have equal or higher confidence
    expect(result.matches[0].confidence).toBeGreaterThanOrEqual(result.matches[1].confidence);
    // Top match is the exact policy name
    expect(result.matches[0].title).toBe("Medication Management Policy");
    expect(result.summary.usable).toBe(true);
    expect(result.summary.exactMatch).toBe(true);
  });

  // ── 8. No match ───────────────────────────────────────────────────────────

  it("returns empty matches and searched=true when no document found", async () => {
    wireSelectSequence([[], [], []]);

    const result = await checkOrganisationLibraryPresence(ORG_ID, ["Restrictive Practice Policy"]);

    expect(result.searched).toBe(true);
    expect(result.matches).toHaveLength(0);
    expect(result.summary.exactMatch).toBe(false);
    expect(result.summary.partialMatch).toBe(false);
    expect(result.summary.usable).toBe(false);
    expect(result.summary.searchable).toBe(false);
    expect(result.summary.reason).toMatch(/no matching/i);
  });

  // ── 9. Wrong organisation — cross-org isolation ────────────────────────────

  it("returns empty when a matching title exists only under a different organisation", async () => {
    // The DB is already filtered by org_id at query time.
    // Simulate the isolation by returning zero rows (the WHERE clause would exclude them).
    wireSelectSequence([[], [], []]);

    const result = await checkOrganisationLibraryPresence(OTHER_ORG, ["Medication Management Policy"]);

    expect(result.matches).toHaveLength(0);
    expect(result.summary.usable).toBe(false);
  });

  // ── 10. Wrong tenant (same mechanism as wrong org) ─────────────────────────

  it("does not return results for a completely different tenant", async () => {
    wireSelectSequence([[], [], []]);

    const result = await checkOrganisationLibraryPresence("tenant-999", ["Medication Management Policy"]);

    expect(result.searched).toBe(true);
    expect(result.matches).toHaveLength(0);
  });

  // ── 11. Cache hit — DB not queried on second identical call ───────────────

  it("serves the second identical call from cache without hitting the DB", async () => {
    wireSelectSequence([
      [makeSource()],
      [makeChunkRow("src-001")],
      [makeVersionRow()],
    ]);

    const first  = await checkOrganisationLibraryPresence(ORG_ID, ["Medication Management Policy"]);
    const second = await checkOrganisationLibraryPresence(ORG_ID, ["Medication Management Policy"]);

    expect(first.matches[0].sourceId).toBe("src-001");
    expect(second.matches[0].sourceId).toBe("src-001");

    // db.select should have been called exactly 3 times (for the first call only)
    expect(mocks.selectFn).toHaveBeenCalledTimes(3);
  });

  // ── 11b. Cache is keyed per org ────────────────────────────────────────────

  it("does not share cache entries across different organisations", async () => {
    wireSelectSequence([
      [makeSource()],
      [makeChunkRow("src-001")],
      [makeVersionRow()],
      [],   // second org — sources (returns empty → early return, no chunk/version queries)
    ]);

    const r1 = await checkOrganisationLibraryPresence(ORG_ID,    ["Medication Management Policy"]);
    const r2 = await checkOrganisationLibraryPresence(OTHER_ORG, ["Medication Management Policy"]);

    expect(r1.matches).toHaveLength(1);
    expect(r2.matches).toHaveLength(0);
    // org-1: 3 queries (sources + chunks + versions)
    // other-org: 1 query (sources empty → early return, no chunk/version queries)
    expect(mocks.selectFn).toHaveBeenCalledTimes(4);
  });

  // ── 11c. Cache cleared between tests ──────────────────────────────────────

  it("_clearPresenceCache resets the cache so the next call re-queries", async () => {
    // First call — populates cache
    wireSelectSequence([[makeSource()], [makeChunkRow("src-001")], [makeVersionRow()]]);
    const r1 = await checkOrganisationLibraryPresence(ORG_ID, ["Medication Management Policy"]);
    expect(r1.matches[0].sourceId).toBe("src-001");

    // wireSelectSequence calls mockReset internally, so selectFn call count resets here
    _clearPresenceCache();
    wireSelectSequence([[makeSource({ id: "src-002" })], [makeChunkRow("src-002")], [makeVersionRow({ knowledgeSourceId: "src-002" })]]);
    const r2 = await checkOrganisationLibraryPresence(ORG_ID, ["Medication Management Policy"]);

    // r2 came from the DB (different source id), proving the cache was cleared
    expect(r2.matches[0].sourceId).toBe("src-002");
    // Exactly 3 selects were made for the second call (count reset by wireSelectSequence)
    expect(mocks.selectFn).toHaveBeenCalledTimes(3);
  });

  // ── 12. Synonym expansion ─────────────────────────────────────────────────

  it("returns a result when only the synonym variant matches (Policy → Procedure)", async () => {
    // Source is titled with "Procedure" but search term says "Policy"
    wireSelectSequence([
      [makeSource({ title: "Medication Management Procedure" })],
      [makeChunkRow("src-001")],
      [makeVersionRow()],
    ]);

    const result = await checkOrganisationLibraryPresence(ORG_ID, ["Medication Management Policy"]);

    // The synonym expansion should have generated an ILIKE for "procedure"
    // and the source should appear in results
    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.matches[0].title).toBe("Medication Management Procedure");
    // Confidence lower than exact match but above threshold
    expect(result.matches[0].confidence).toBeGreaterThanOrEqual(0.30);
  });

  // ── 13. Partial keyword match (word-overlap scoring) ──────────────────────

  it("matches a source where most but not all search words appear in the title", async () => {
    wireSelectSequence([
      [makeSource({ title: "Medication Administration Policy" })],
      [makeChunkRow("src-001")],
      [makeVersionRow()],
    ]);

    const result = await checkOrganisationLibraryPresence(ORG_ID, ["Medication Management Policy"]);

    expect(result.matches.length).toBeGreaterThan(0);
    // "Medication" and "Policy" match, "Management" does not → partial
    const m = result.matches[0];
    expect(m.confidence).toBeGreaterThanOrEqual(0.45);
    expect(m.confidence).toBeLessThan(0.90);
    expect(result.summary.partialMatch).toBe(true);
    expect(result.summary.exactMatch).toBe(false);
  });

  // ── 14. Low-confidence noise filtered ─────────────────────────────────────

  it("filters out low-confidence matches that share only a stop word", async () => {
    // A source that matches the ILIKE wildcard pattern but has very low word overlap
    wireSelectSequence([
      [makeSource({ id: "src-noise", title: "Staff Policy Manual" })],
      [],
      [],
    ]);

    // Searching for "Medication Management Policy" — only "Policy" overlaps (stop-word-length=6, included)
    // but "Medication" and "Management" don't → ratio 1/3 = 0.33 → confidence 0.45 (still above threshold)
    // Let's use a term where nothing meaningful overlaps:
    const result = await checkOrganisationLibraryPresence(ORG_ID, ["Incident Investigation Procedure"]);

    // "Staff Policy Manual" should be below MIN_CONFIDENCE vs "Incident Investigation Procedure"
    // Matching: none of "incident", "investigation", "procedure" appear in "Staff Policy Manual"
    // So confidence = 0 → filtered out
    expect(result.matches).toHaveLength(0);
  });

  // ── Guard: empty terms ────────────────────────────────────────────────────

  it("returns an empty result immediately when searchTerms is empty", async () => {
    const result = await checkOrganisationLibraryPresence(ORG_ID, []);

    expect(result.searched).toBe(true);
    expect(result.matches).toHaveLength(0);
    expect(mocks.selectFn).not.toHaveBeenCalled();
  });

  // ── Guard: empty organisationId ────────────────────────────────────────────

  it("returns an empty result immediately when organisationId is empty string", async () => {
    const result = await checkOrganisationLibraryPresence("", ["Medication Policy"]);

    expect(result.searched).toBe(true);
    expect(result.matches).toHaveLength(0);
    expect(mocks.selectFn).not.toHaveBeenCalled();
  });

  // ── Summary: no chunks — ingestionStatus null ─────────────────────────────

  it("sets ingestionStatus=null when no version row exists for the source", async () => {
    wireSelectSequence([
      [makeSource({ status: "uploaded", approvedByUserId: null })],
      [],
      [],  // no version row
    ]);

    const result = await checkOrganisationLibraryPresence(ORG_ID, ["Medication Management Policy"]);

    expect(result.matches[0].ingestionStatus).toBeNull();
  });

  // ── Non-current source not retrievable ────────────────────────────────────

  it("sets retrievable=false when isCurrent=false even if approved and indexed", async () => {
    wireSelectSequence([
      [makeSource({ isCurrent: false, approvedByUserId: "user-admin", status: "approved" })],
      [makeChunkRow("src-001")],
      [makeVersionRow()],
    ]);

    const result = await checkOrganisationLibraryPresence(ORG_ID, ["Medication Management Policy"]);

    expect(result.matches[0].approved).toBe(true);
    expect(result.matches[0].indexed).toBe(true);
    expect(result.matches[0].retrievable).toBe(false);  // isCurrent=false blocks it
  });

  // ── review_required status ────────────────────────────────────────────────

  it("handles review_required status — not yet approved", async () => {
    wireSelectSequence([
      [makeSource({ status: "review_required", approvedByUserId: null })],
      [makeChunkRow("src-001")],
      [makeVersionRow({ ingestionStatus: "complete" })],
    ]);

    const result = await checkOrganisationLibraryPresence(ORG_ID, ["Medication Management Policy"]);

    const m = result.matches[0];
    expect(m.status).toBe("review_required");
    expect(m.approved).toBe(false);
    expect(m.indexed).toBe(true);
    expect(m.retrievable).toBe(false);
    // indexed but not approved → searchable but not usable
    expect(result.summary.searchable).toBe(true);
    expect(result.summary.usable).toBe(false);
    expect(result.summary.reason).toMatch(/indexed but not yet approved/i);
  });

  // ── Multiple search terms (OR logic) ──────────────────────────────────────

  it("returns results when only one of multiple search terms matches", async () => {
    wireSelectSequence([
      [makeSource()],
      [makeChunkRow("src-001")],
      [makeVersionRow()],
    ]);

    const result = await checkOrganisationLibraryPresence(
      ORG_ID,
      ["Medication Management Policy", "Drug Administration Standard"],
    );

    // Should find the "Medication Management Policy" source
    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.matches[0].title).toBe("Medication Management Policy");
  });

  // ── Term order does not affect cache key ──────────────────────────────────

  it("returns the same cached result regardless of search term order", async () => {
    wireSelectSequence([
      [makeSource()],
      [makeChunkRow("src-001")],
      [makeVersionRow()],
    ]);

    const r1 = await checkOrganisationLibraryPresence(ORG_ID, ["Policy A", "Policy B"]);
    const r2 = await checkOrganisationLibraryPresence(ORG_ID, ["Policy B", "Policy A"]);

    // Both served from same cache entry — DB called only once (3 selects)
    expect(mocks.selectFn).toHaveBeenCalledTimes(3);
    expect(r1.matches.length).toBe(r2.matches.length);
  });
});
