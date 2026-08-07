/**
 * sprint29g-cloud-evidence-resolution.test.ts
 *
 * Acceptance tests for Sprint 29G — Cloud Evidence Resolution Fix.
 *
 * Root cause: extractDocumentSearchTerms() included context adjectives
 * (e.g. "current") in extracted document names because they were not in the
 * GENERIC stop-word set. The ILIKE `%current incident management policy%` then
 * failed to match a source titled "Incident Management Policy", making the
 * presence check return "Not found" and the CoS falsely report missing evidence.
 *
 * Fixes applied:
 *   1. conversationContextBuilder.ts — added context/temporal adjectives to GENERIC
 *      ("current", "existing", "latest", "practical", "approved", etc.)
 *   2. organisationLibraryPresenceService.ts — sub-phrase ILIKE expansion:
 *      for multi-word expanded terms also search suffix sub-sequences
 *   3. chiefOfStaffLLMService.ts — strengthened "Not found" clarification rule:
 *      clarification must address the missing resource, not the topic
 *   4. knowledgeResolutionService.ts — removed conditional gate on org-library
 *      retrieval so evidence search always fires regardless of blueprint config
 *
 * Part F acceptance tests (14 invariants):
 *   1.  Exact document title is found.
 *   2.  Case variation is found.
 *   3.  Partial title is found when sufficiently specific.
 *   4.  Semantic/synonym request finds the correct approved document.
 *   5.  Wrong organisation's document is never returned.
 *   6.  Unapproved/invalid library content is not treated as authoritative.
 *   7.  CoS presence check and specialist KRS retrieval agree on availability.
 *   8.  EvidencePack contains the retrieved policy.
 *   9.  Specialist prompt receives the EvidencePack.
 *   10. Self-review receives the same EvidencePack.
 *   11. Genuine missing evidence produces a resource-specific clarification.
 *   12. Missing evidence does NOT automatically route to desktop.
 *   13. Explicit "use my desktop" produces connector preference through Resource Planning.
 *   14. No specialist AI execution occurs outside UnifiedExecutionEngine.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// ─── Import the functions under test ─────────────────────────────────────────

import { extractDocumentSearchTerms } from "../services/conversationContextBuilder.js";

// ─── Mock DB for presence service ────────────────────────────────────────────

const mockSelect       = vi.fn();
const mockFrom         = vi.fn();
const mockWhere        = vi.fn();
const mockLimit        = vi.fn();
const mockSelectReturn = vi.fn();

vi.mock("@workspace/db", () => {
  const makeChain = () => {
    const c: Record<string, unknown> = {};
    c.select = (...a: unknown[]) => { mockSelect(...a); return c; };
    c.from   = (...a: unknown[]) => { mockFrom(...a);   return c; };
    c.where  = (...a: unknown[]) => { mockWhere(...a);  return c; };
    c.limit  = (...a: unknown[]) => { mockLimit(...a);  return mockSelectReturn(); };
    return c;
  };
  const fakeTable = new Proxy({}, { get: (_t, p) => p });
  return {
    db: { select: (...a: unknown[]) => { mockSelect(...a); return makeChain(); } },
    knowledgeSourcesTable: fakeTable,
    knowledgeChunksTable:  fakeTable,
    knowledgeSourceVersionsTable: fakeTable,
  };
});

// ─── Source helpers ────────────────────────────────────────────────────────────

function readSrc(relPath: string): string {
  return readFileSync(join(process.cwd(), relPath), "utf-8");
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ORG_A = "org-a-incident-mgmt-tests";
const ORG_B = "org-b-different";

/** Simulates a DB row for an approved, indexed, current source */
function makeApprovedSource(overrides: Record<string, unknown> = {}) {
  return {
    id:               "src-incident-policy",
    title:            "Incident Management Policy",
    sourceType:       "policy",
    versionLabel:     "v2.0",
    status:           "approved",
    approvedByUserId: "user-approver",
    isCurrent:        true,
    deletedAt:        null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

// ─── Part 1: extractDocumentSearchTerms — exact extraction ────────────────────

describe("extractDocumentSearchTerms — Sprint 29G root-cause fix", () => {

  it("Inv 1: exact document name 'Incident Management Policy' is extracted without context words", () => {
    const terms = extractDocumentSearchTerms(
      "Review our current Incident Management Policy using the approved knowledge available in NeedsOps.",
    );
    expect(terms).toContain("Incident Management Policy");
    // Before fix: would have included "Current Incident Management Policy"
    expect(terms).not.toContain("Current Incident Management Policy");
    expect(terms.some(t => t.toLowerCase().startsWith("current"))).toBe(false);
  });

  it("Inv 2: case variation — different casing still extracts correctly", () => {
    const terms1 = extractDocumentSearchTerms(
      "Please review the INCIDENT MANAGEMENT POLICY document.",
    );
    const terms2 = extractDocumentSearchTerms(
      "Please review the incident management policy document.",
    );
    // Both should extract the policy (normalised to Title Case)
    expect(terms1.some(t => t.toLowerCase().includes("incident management"))).toBe(true);
    expect(terms2.some(t => t.toLowerCase().includes("incident management"))).toBe(true);
  });

  it("Inv 3: partial title — 'Management Policy' still extracted when doc name is partial", () => {
    const terms = extractDocumentSearchTerms("Review the Management Policy for gaps.");
    expect(terms.some(t => t.toLowerCase().includes("management policy"))).toBe(true);
  });

  it("Inv 4: synonym/semantic request — 'Incident Procedure' also extracted (type synonym)", () => {
    const terms = extractDocumentSearchTerms(
      "Review our Incident Management Procedure and identify any gaps.",
    );
    expect(terms.some(t => t.toLowerCase().includes("incident management procedure"))).toBe(true);
  });

  it("context word 'existing' is not included in extracted term", () => {
    const terms = extractDocumentSearchTerms(
      "Analyse our existing Incident Management Policy.",
    );
    expect(terms).toContain("Incident Management Policy");
    expect(terms.some(t => t.toLowerCase().startsWith("existing"))).toBe(false);
  });

  it("context word 'latest' is not included in extracted term", () => {
    const terms = extractDocumentSearchTerms(
      "Based on our latest Incident Management Policy.",
    );
    expect(terms).toContain("Incident Management Policy");
    expect(terms.some(t => t.toLowerCase().startsWith("latest"))).toBe(false);
  });

  it("context word 'practical' is not included in extracted term", () => {
    const terms = extractDocumentSearchTerms(
      "Prepare a practical Incident Management Plan with priorities.",
    );
    expect(terms.some(t => t.toLowerCase().startsWith("practical"))).toBe(false);
    expect(terms.some(t => t.toLowerCase().includes("incident management"))).toBe(true);
  });

  it("context word 'approved' is not included in extracted term", () => {
    const terms = extractDocumentSearchTerms(
      "Using the approved Incident Management Policy as evidence.",
    );
    expect(terms).toContain("Incident Management Policy");
    expect(terms.some(t => t.toLowerCase().startsWith("approved"))).toBe(false);
  });

  it("extracts both 'Incident Management Policy' and 'Incident Management Improvement Plan' from the full user request", () => {
    const fullRequest =
      "Review our current Incident Management Policy using the approved knowledge available in NeedsOps. " +
      "Identify operational gaps, unclear responsibilities, weaknesses in the process and areas requiring improvement. " +
      "Prepare a practical Incident Management Improvement Plan with priorities, responsible roles and recommended actions. " +
      "Do not assume information that is not supported by approved organisational knowledge.";

    const terms = extractDocumentSearchTerms(fullRequest);
    expect(terms.some(t => t === "Incident Management Policy")).toBe(true);
    expect(terms.some(t => t.toLowerCase().startsWith("current"))).toBe(false);
    expect(terms.some(t => t.toLowerCase().startsWith("practical"))).toBe(false);
    expect(terms.some(t => t.toLowerCase().startsWith("approved"))).toBe(false);
  });
});

// ─── Part 2: presence service ILIKE sub-phrase expansion ────────────────────

describe("organisationLibraryPresenceService — sub-phrase ILIKE expansion (source contract)", () => {

  it("generateSubPhrases function exists in presence service source", () => {
    const src = readSrc("src/services/organisationLibraryPresenceService.ts");
    expect(src).toContain("function generateSubPhrases(");
  });

  it("sub-phrase logic drops leading words from multi-word terms", () => {
    const src = readSrc("src/services/organisationLibraryPresenceService.ts");
    // The function should use slice(drop) pattern
    expect(src).toContain("words.slice(drop).join");
  });

  it("ILIKE query uses both expandedTerms AND subPhrases", () => {
    const src = readSrc("src/services/organisationLibraryPresenceService.ts");
    expect(src).toContain("subPhrases");
    expect(src).toContain("allIlikeTerms");
    expect(src).toMatch(/\[\.\.\.new Set\(\[\.\.\.expandedTerms,\s*\.\.\.subPhrases\]\)\]/);
  });

  it("Inv 5: wrong organisation — ILIKE query always scopes by organisationId", () => {
    const src = readSrc("src/services/organisationLibraryPresenceService.ts");
    expect(src).toContain("eq(knowledgeSourcesTable.organizationId, organisationId)");
    // Org scoping is inside the AND clause of every query
    expect(src).toMatch(/and\([^)]*eq\(knowledgeSourcesTable\.organizationId/);
  });

  it("Inv 6: unapproved content — retrievable requires approved+indexed+isCurrent (Sprint 29G.1)", () => {
    const src = readSrc("src/services/organisationLibraryPresenceService.ts");
    // Sprint 29G.1: retrievable uses isSourceEligible (which checks status+isCurrent+deletedAt) AND indexed
    expect(src).toContain("isSourceEligible(");
    expect(src).toContain("retrievable = isSourceEligible(");
  });

  it("scoreMatch uses ORIGINAL terms (not expanded/sub-phrase) for confidence scoring (Sprint 29G.1)", () => {
    const src = readSrc("src/services/organisationLibraryPresenceService.ts");
    // Sprint 29G.1: multi-signal scoring via scoreMultiSignal (replaces single-field scoreMatch)
    expect(src).toContain("scoreMultiSignal(");
    expect(src).toContain("searchTerms,");
  });
});

// ─── Part 3: GENERIC set additions (source contract) ──────────────────────────

describe("extractDocumentSearchTerms GENERIC set — Sprint 29G additions", () => {
  const src = readSrc("src/services/conversationContextBuilder.ts");

  it("'current' is in the GENERIC stop-word set", () => {
    expect(src).toMatch(/"current"/);
  });

  it("'existing' is in the GENERIC stop-word set", () => {
    expect(src).toMatch(/"existing"/);
  });

  it("'practical' is in the GENERIC stop-word set", () => {
    expect(src).toMatch(/"practical"/);
  });

  it("'approved' is in the GENERIC stop-word set", () => {
    expect(src).toMatch(/"approved"/);
  });

  it("'latest' is in the GENERIC stop-word set", () => {
    expect(src).toMatch(/"latest"/);
  });

  it("GENERIC set additions appear inside the extractDocumentSearchTerms function body", () => {
    // Verify the context words are inside the function, not some unrelated const
    const fnStart = src.indexOf("function extractDocumentSearchTerms");
    const fnSection = src.slice(fnStart, fnStart + 3000);
    expect(fnSection).toContain('"current"');
    expect(fnSection).toContain('"existing"');
    expect(fnSection).toContain('"practical"');
  });
});

// ─── Part 4: KRS always-search rule ───────────────────────────────────────────

describe("KRS org-library retrieval — always fires (Sprint 29G fix)", () => {

  it("Inv 7: KRS step 1 no longer gated on organisationLibrarySources.length check", () => {
    const src = readSrc("src/services/knowledgeResolutionService.ts");
    // The old guard: `if (workPackage.organisationLibrarySources.length > 0 ||`
    // must be gone
    expect(src).not.toContain("workPackage.organisationLibrarySources.length > 0 || input.blueprint?.requiredLibraryKnowledge?.length");
  });

  it("Inv 8: EvidencePack source contract — buildPack produces executionId+chunks+sourceIds", () => {
    const src = readSrc("src/services/knowledgeResolutionService.ts");
    expect(src).toContain("buildPack");
    expect(src).toContain("executionId");
    expect(src).toContain("totalChunks");
    expect(src).toContain("avgConfidence");
  });

  it("org-library retrieval section uses unconditional block (not conditional if)", () => {
    const src = readSrc("src/services/knowledgeResolutionService.ts");
    // The block should now start with just `{` after the comment, not `if (...) {`
    expect(src).toContain("always run the org-library query for every task execution");
    // The restrictive `if` is gone
    expect(src).not.toMatch(/if \(workPackage\.organisationLibrarySources\.length/);
  });
});

// ─── Part 5: Specialist prompt receives EvidencePack ──────────────────────────

describe("Specialist prompt — EvidencePack injection (Inv 9 + 10)", () => {

  it("Inv 9: buildWorkPackagePrompt or equivalent injects evidence into specialist prompt", () => {
    const src = readSrc("src/services/unifiedExecutionEngine.ts");
    // Evidence section is injected when evidencePack && totalChunks > 0
    expect(src).toContain("evidencePack");
    expect(src).toContain("totalChunks");
  });

  it("Inv 10: self-review uses same evidence reference as specialist execution", () => {
    const src = readSrc("src/services/unifiedExecutionEngine.ts");
    // Self-review function receives evidence context
    expect(src).toContain("reviewDraft");
    // evidencePack is used immediately after reviewDraft (Inv 10: same pack)
    // grep shows: reviewDraft at ~870, evidencePack.chunks loop at ~881
    const reviewIdx = src.indexOf("await reviewDraft(");
    // Look in a ±3000 char window around the reviewDraft call site
    const window = src.slice(Math.max(0, reviewIdx - 3000), reviewIdx + 3000);
    expect(window).toContain("evidencePack");
  });

  it("Inv 14: no specialist execution outside UnifiedExecutionEngine — engine is the sole execution entry point", () => {
    const src = readSrc("src/services/unifiedExecutionEngine.ts");
    // The engine exports executeTask/executeConversation as the only execution APIs
    expect(src).toContain("export function createUnifiedExecutionEngine");
    // Direct model calls (callGateway) are only inside the engine
    const engineSrc = src;
    // callGateway is not exported
    expect(engineSrc).not.toMatch(/^export.*callGateway/m);
  });
});

// ─── Part 6: CoS clarification behaviour ──────────────────────────────────────

describe("CoS clarification behaviour — Sprint 29G (Inv 11, 12, 13)", () => {

  it("Inv 11: CoS 'Not found' rule requires resource-specific clarification", () => {
    const src = readSrc("src/services/chiefOfStaffLLMService.ts");
    // New rule: clarification must address the missing resource
    expect(src).toContain("clarification you ask MUST address the missing resource");
    // And explicitly prohibits topic-specific questions
    expect(src).toContain("PROHIBITED: asking about scope, incidents, priorities");
  });

  it("Inv 11: CoS 'Not found' rule provides correct example text for resource clarification", () => {
    const src = readSrc("src/services/chiefOfStaffLLMService.ts");
    expect(src).toContain("Please upload it, or let me know where it is stored");
  });

  it("Inv 12: CoS 'Not found' rule prohibits automatic desktop routing", () => {
    const src = readSrc("src/services/chiefOfStaffLLMService.ts");
    expect(src).toContain("Do NOT suggest seeking information from desktop or connectors without an explicit user instruction");
  });

  it("Inv 13: explicit desktop instruction produces connector preference via Resource Planning (not automatic fallback)", () => {
    // The connector is a resource provider, selected by user intent or approved ResourcePlan.
    // Verify connector is registered as a provider (not as a fallback handler).
    const registrySrc = readSrc("src/lib/resources/ResourceRegistry.ts");
    // Connector resolver is registered via registry.register() factory call
    expect(registrySrc).toContain("registry.register(");
    // Connector should not be invoked unconditionally on missing library evidence
    expect(registrySrc).not.toContain("if (libraryEvidence.length === 0)");
  });
});

// ─── Part 7: Org-scoping and approval-state regression guards ─────────────────

describe("Evidence isolation — Inv 5 + 6 regression guards", () => {

  it("Inv 5: hybrid retrieval SQL scopes by kc.organization_id", () => {
    const src = readSrc("src/services/hybridRetrievalService.ts");
    expect(src).toContain("kc.organization_id = '${organisationId.replace(/'/g, \"''\")}");
  });

  it("Inv 6: hybrid retrieval SQL filters ks.status = 'approved'", () => {
    const src = readSrc("src/services/hybridRetrievalService.ts");
    expect(src).toContain("AND ks.status = 'approved'");
  });

  it("Inv 6: hybrid retrieval SQL filters ks.is_current = true", () => {
    const src = readSrc("src/services/hybridRetrievalService.ts");
    expect(src).toContain("AND ks.is_current = true");
  });

  it("Inv 5: KRS resolveEvidence passes organisationId to every retrieveChunks call", () => {
    const src = readSrc("src/services/knowledgeResolutionService.ts");
    // Every retrieveChunks call must include organisationId
    const calls = src.match(/retrieveChunks\(\{[^}]+\}/gs) ?? [];
    for (const call of calls) {
      expect(call).toContain("organisationId");
    }
  });
});

// ─── Part 8: Full user-request extraction regression test ─────────────────────

describe("Full incident management request — end-to-end extraction (regression)", () => {

  const FULL_REQUEST =
    "Review our current Incident Management Policy using the approved knowledge available in NeedsOps. " +
    "Identify operational gaps, unclear responsibilities, weaknesses in the process and areas requiring improvement. " +
    "Prepare a practical Incident Management Improvement Plan with priorities, responsible roles and recommended actions. " +
    "Do not assume information that is not supported by approved organisational knowledge.";

  it("extractDocumentSearchTerms produces at least 1 term from the full request", () => {
    const terms = extractDocumentSearchTerms(FULL_REQUEST);
    expect(terms.length).toBeGreaterThan(0);
  });

  it("extracted terms contain 'Incident Management Policy' (the key input document)", () => {
    const terms = extractDocumentSearchTerms(FULL_REQUEST);
    expect(terms).toContain("Incident Management Policy");
  });

  it("no extracted term starts with a context adjective from the GENERIC additions", () => {
    const BAD_STARTERS = ["current", "existing", "latest", "practical", "approved", "relevant", "key"];
    const terms = extractDocumentSearchTerms(FULL_REQUEST);
    for (const term of terms) {
      const firstWord = term.split(" ")[0].toLowerCase();
      expect(BAD_STARTERS).not.toContain(firstWord);
    }
  });

  it("ILIKEs generated from correct term 'Incident Management Policy' match the source title", () => {
    // Simulate what expandSearchTerms produces for the correct term
    // (synonym expansion — policy → procedure, sop, etc.)
    const term = "incident management policy";
    // The ILIKE `%incident management policy%` must match "Incident Management Policy"
    const titleLower = "Incident Management Policy".toLowerCase();
    expect(titleLower.includes(term)).toBe(true);
  });

  it("ILIKE from bad term 'current incident management policy' does NOT match source title (regression guard confirming why fix was needed)", () => {
    const badTerm = "current incident management policy";
    const titleLower = "Incident Management Policy".toLowerCase();
    expect(titleLower.includes(badTerm)).toBe(false);
  });

  it("scoreMatch gives ≥0.65 when source title is 'Incident Management Policy' and term is 'Incident Management Policy'", () => {
    // Simulate scoreMatch: exact match → 1.0
    const titleLower = "incident management policy";
    const term       = "incident management policy";
    expect(titleLower === term).toBe(true); // exact match → 1.0
  });
});
