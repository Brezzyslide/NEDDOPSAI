/**
 * Sprint 29N.5 — Evidence Sufficiency Gate Tests
 *
 * Covers Parts D, E, F of the sprint brief:
 *   Part D: evidenceSufficiencyService typed result evaluation
 *   Part E: Cross-reference detection — UNRESOLVED_REFERENCE
 *   Part F: External authority detection — EXTERNAL_AUTHORITY_REQUIRED
 *
 * All tests are pure unit tests over deterministic logic.
 * No database or OpenAI calls required.
 */

import { describe, it, expect } from "vitest";
import {
  evaluateEvidenceSufficiency,
  isPackSufficient,
  detectCrossReferences,
  type EvidenceSufficiencyResult,
  type SufficiencyEvaluationInput,
} from "../services/evidenceSufficiencyService.js";
import type { EvidencePack, EvidenceChunk } from "../services/knowledgeResolutionService.js";

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeChunk(overrides: Partial<EvidenceChunk> = {}): EvidenceChunk {
  return {
    chunkId:         "chunk-" + Math.random().toString(36).slice(2, 8),
    sourceId:        "source-001",
    sourceVersionId: "ver-001",
    sourceTitle:     "Complaints Management Policy",
    versionLabel:    "v3",
    sourceType:      "policy",
    authorityLevel:  "primary",
    sectionTitle:    "Section 1",
    pageNumber:      1,
    text:            "This policy governs how we handle customer complaints.",
    confidence:      0.75,
    citation:        "Complaints Management Policy, v3, Section 1",
    selectionReason: "organisation_library",
    ...overrides,
  };
}

function makePack(
  chunks: EvidenceChunk[],
  overrides: Partial<EvidencePack> = {},
): EvidencePack {
  const sourceIds = [...new Set(chunks.map(c => c.sourceId))];
  const avgConfidence = chunks.length > 0
    ? chunks.reduce((s, c) => s + c.confidence, 0) / chunks.length
    : 0;
  const citationsByType: Record<string, EvidenceChunk[]> = {};
  for (const c of chunks) {
    if (!citationsByType[c.sourceType]) citationsByType[c.sourceType] = [];
    citationsByType[c.sourceType].push(c);
  }
  return {
    executionId:      "exec-test-001",
    organisationId:   "org-001",
    resolvedAt:       new Date(),
    chunks,
    sourceIds,
    citationsByType,
    totalChunks:      chunks.length,
    avgConfidence,
    retrievalMetrics: {
      queryCount:     1,
      totalCandidates: chunks.length,
      selectedChunks:  chunks.length,
      cacheHit:        false,
      retrievalMs:     50,
      embeddingUsed:   false,
      embeddingMs:     0,
    },
    ...overrides,
  };
}

function makeInput(
  pack: EvidencePack,
  overrides: Partial<SufficiencyEvaluationInput> = {},
): SufficiencyEvaluationInput {
  return {
    userRequest:    "Review our complaints management process",
    specialistCode: "operations_manager",
    blueprint:      null,
    evidencePack:   pack,
    ...overrides,
  };
}

// ─── Part D: Evidence Sufficiency Gate ───────────────────────────────────────

describe("evidenceSufficiencyService — Part D", () => {
  describe("SUFFICIENT result", () => {
    it("returns SUFFICIENT for an adequate pack with good confidence", () => {
      const chunks = [
        makeChunk({ sourceId: "src-1", confidence: 0.80, text: "Complaints are handled within 5 working days." }),
        makeChunk({ sourceId: "src-1", confidence: 0.70, chunkId: "chunk-2", text: "All complaints must be acknowledged within 24 hours." }),
        makeChunk({ sourceId: "src-2", confidence: 0.65, chunkId: "chunk-3", sourceTitle: "Escalation Procedure", text: "Escalated complaints go to the senior manager." }),
      ];
      const result = evaluateEvidenceSufficiency(makeInput(makePack(chunks)));
      expect(result.status).toBe("SUFFICIENT");
      expect(result.isEscalationRecommended).toBe(false);
      expect(result.coverageScore).toBeGreaterThan(0.4);
    });

    it("isPackSufficient returns true for SUFFICIENT result", () => {
      const chunks = [makeChunk(), makeChunk({ chunkId: "c2", confidence: 0.65 })];
      expect(isPackSufficient(makeInput(makePack(chunks)))).toBe(true);
    });

    it("isPackSufficient returns true for AUTHORITY_GAP (does not escalate)", () => {
      const chunks = [
        makeChunk({ authorityLevel: "reference", confidence: 0.6 }),
        makeChunk({ authorityLevel: "reference", confidence: 0.55, chunkId: "c2" }),
      ];
      const result = evaluateEvidenceSufficiency(makeInput(makePack(chunks), {
        minimumRequiredAuthorityLevel: "primary",
      }));
      // Authority gap but escalation not recommended — it's a governance issue
      expect(result.status).toBe("AUTHORITY_GAP");
      expect(result.isEscalationRecommended).toBe(false);
      expect(isPackSufficient(makeInput(makePack(chunks), { minimumRequiredAuthorityLevel: "primary" }))).toBe(true);
    });
  });

  describe("SOURCE_NOT_AVAILABLE", () => {
    it("returns SOURCE_NOT_AVAILABLE for empty pack", () => {
      const result = evaluateEvidenceSufficiency(makeInput(makePack([])));
      expect(result.status).toBe("SOURCE_NOT_AVAILABLE");
      expect(result.coverageScore).toBe(0);
      expect(result.isEscalationRecommended).toBe(true);
      expect(result.reasons).toHaveLength(1);
      expect(result.reasons[0].code).toBe("NO_CHUNKS");
    });
  });

  describe("LOW_CONFIDENCE", () => {
    it("returns LOW_CONFIDENCE when all chunks have very low confidence", () => {
      const chunks = [
        makeChunk({ confidence: 0.05 }),
        makeChunk({ chunkId: "c2", confidence: 0.08 }),
        makeChunk({ chunkId: "c3", confidence: 0.06 }),
      ];
      const result = evaluateEvidenceSufficiency(makeInput(makePack(chunks)));
      expect(result.status).toBe("LOW_CONFIDENCE");
      expect(result.isEscalationRecommended).toBe(true);
      const lowConfReason = result.reasons.find(r => r.code === "LOW_AVERAGE_CONFIDENCE");
      expect(lowConfReason).toBeDefined();
    });
  });

  describe("INSUFFICIENT_COVERAGE", () => {
    it("returns INSUFFICIENT_COVERAGE for single chunk (below MIN_CHUNKS_ADEQUATE=2)", () => {
      const chunks = [makeChunk({ confidence: 0.20 })];
      const result = evaluateEvidenceSufficiency(makeInput(makePack(chunks)));
      // 1 chunk is below MIN_CHUNKS_ADEQUATE (2) → INSUFFICIENT_COVERAGE
      expect(result.status).toBe("INSUFFICIENT_COVERAGE");
      expect(result.isEscalationRecommended).toBe(true);
    });

    it("returns SOURCE_NOT_AVAILABLE for zero chunks (not INSUFFICIENT_COVERAGE)", () => {
      // Zero chunks — hard SOURCE_NOT_AVAILABLE before any other checks
      const result = evaluateEvidenceSufficiency(makeInput(makePack([])));
      expect(result.status).toBe("SOURCE_NOT_AVAILABLE");
    });
  });

  describe("coverage score", () => {
    it("scores higher packs with more sources and higher confidence", () => {
      const smallPack = makePack([makeChunk({ confidence: 0.40 })]);
      const largePack = makePack([
        makeChunk({ confidence: 0.80, sourceId: "s1" }),
        makeChunk({ chunkId: "c2", confidence: 0.75, sourceId: "s2" }),
        makeChunk({ chunkId: "c3", confidence: 0.70, sourceId: "s3" }),
        makeChunk({ chunkId: "c4", confidence: 0.65, sourceId: "s1" }),
      ]);
      const smallResult = evaluateEvidenceSufficiency(makeInput(smallPack));
      const largeResult = evaluateEvidenceSufficiency(makeInput(largePack));
      expect(largeResult.coverageScore).toBeGreaterThan(smallResult.coverageScore);
    });
  });
});

// ─── Part E: Cross-reference detection ───────────────────────────────────────

describe("Cross-reference detection — Part E", () => {
  describe("detectCrossReferences", () => {
    it('detects "see [Document]" pattern', () => {
      const refs = detectCrossReferences(
        "For escalation steps, see the Complaints Escalation Procedure.",
      );
      expect(refs).toContain("Complaints Escalation Procedure");
    });

    it('detects "refer to [Document]" pattern', () => {
      const refs = detectCrossReferences(
        "Staff should refer to the Incident Management Policy for serious complaints.",
      );
      expect(refs.some(r => r.includes("Incident Management Policy"))).toBe(true);
    });

    it('detects "as described in [Document]" pattern', () => {
      const refs = detectCrossReferences(
        "Disciplinary steps are as described in the HR Disciplinary Procedure.",
      );
      expect(refs.some(r => r.includes("HR Disciplinary Procedure"))).toBe(true);
    });

    it('detects "in accordance with [Document]" pattern', () => {
      const refs = detectCrossReferences(
        "All steps must be taken in accordance with the Data Handling Standard.",
      );
      expect(refs.some(r => r.includes("Data Handling Standard"))).toBe(true);
    });

    it("does not detect false positives in normal sentences", () => {
      const refs = detectCrossReferences(
        "We handle all complaints within 5 working days. Our team is dedicated to service excellence.",
      );
      expect(refs).toHaveLength(0);
    });

    it("does not detect short or lower-case words as document references", () => {
      const refs = detectCrossReferences(
        "see the procedure on the wall for guidance.",
      );
      // "procedure" alone without title case title should not be detected
      expect(refs).toHaveLength(0);
    });

    it("detects multiple references in one chunk", () => {
      const text = `
        Staff must refer to the Complaints Management Policy for handling.
        Escalation steps are detailed in the Escalation Procedure.
        For incidents, see the Incident Management Policy.
      `;
      const refs = detectCrossReferences(text);
      expect(refs.length).toBeGreaterThanOrEqual(2);
    });

    it('detects "section N of [Document]" pattern', () => {
      const refs = detectCrossReferences(
        "Refer to section 4 of the Business Continuity Framework for recovery steps.",
      );
      expect(refs.some(r => r.includes("Business Continuity Framework"))).toBe(true);
    });
  });

  describe("UNRESOLVED_REFERENCE status", () => {
    it("returns UNRESOLVED_REFERENCE when a referenced doc is not in the pack", () => {
      const chunks = [
        makeChunk({
          text: "For escalation steps, see the Complaints Escalation Procedure.",
          sourceTitle: "Complaints Management Policy",
          confidence: 0.75,
        }),
        makeChunk({
          chunkId: "c2",
          sourceId: "src-1",
          text: "Complaints must be resolved within 5 working days.",
          confidence: 0.70,
        }),
      ];
      const pack = makePack(chunks);
      const result = evaluateEvidenceSufficiency(makeInput(pack));

      expect(result.status).toBe("UNRESOLVED_REFERENCE");
      expect(result.unresolvedReferences.length).toBeGreaterThanOrEqual(1);
      expect(result.unresolvedReferences[0].referencedTitle).toContain("Complaints Escalation Procedure");
      expect(result.isEscalationRecommended).toBe(true);
    });

    it("does NOT flag UNRESOLVED_REFERENCE when referenced doc is already in the pack", () => {
      const chunks = [
        makeChunk({
          text: "For escalation, see the Escalation Procedure.",
          sourceTitle: "Complaints Management Policy",
          confidence: 0.75,
        }),
        makeChunk({
          chunkId: "c2",
          sourceId: "src-2",
          sourceTitle: "Escalation Procedure",
          text: "Escalated complaints go to the senior manager within 2 working days.",
          confidence: 0.70,
        }),
      ];
      const pack = makePack(chunks);
      const result = evaluateEvidenceSufficiency(makeInput(pack));

      // Reference is resolved because "Escalation Procedure" is in the pack
      expect(result.unresolvedReferences).toHaveLength(0);
      expect(result.status).toBe("SUFFICIENT");
    });

    it("detects multi-hop chain: A → B → C where C is not in pack", () => {
      const chunks = [
        makeChunk({
          sourceTitle: "Complaints Management Policy",
          text: "For escalation, refer to the Complaints Escalation Procedure.",
          confidence: 0.80,
        }),
        makeChunk({
          chunkId: "c2",
          sourceId: "src-2",
          sourceTitle: "Complaints Escalation Procedure",
          text: "For serious incidents, see the Incident Management Policy.",
          confidence: 0.75,
        }),
      ];
      const pack = makePack(chunks);
      const result = evaluateEvidenceSufficiency(makeInput(pack));

      // Escalation Procedure is resolved (it's in the pack)
      // But Incident Management Policy is not → unresolved
      const unresolved = result.unresolvedReferences.map(u => u.referencedTitle);
      expect(unresolved.some(t => t.includes("Incident Management Policy"))).toBe(true);
      expect(result.status).toBe("UNRESOLVED_REFERENCE");
    });

    it("deduplicates the same referenced document across multiple chunks", () => {
      const chunks = [
        makeChunk({
          text: "For escalation, see the Escalation Procedure for further steps.",
          confidence: 0.70,
        }),
        makeChunk({
          chunkId: "c2",
          // Deliberately reference the same doc a second time in a different chunk
          text: "Unresolved complaints must be referred to the Escalation Procedure.",
          confidence: 0.65,
        }),
      ];
      const pack = makePack(chunks);
      const result = evaluateEvidenceSufficiency(makeInput(pack));

      // Same referenced doc appears in two chunks — should only be listed once
      const escalationRefs = result.unresolvedReferences.filter(u =>
        u.referencedTitle.includes("Escalation Procedure"),
      );
      expect(escalationRefs).toHaveLength(1);
    });
  });
});

// ─── Part F: External authority requirement ───────────────────────────────────

describe("External authority requirement — Part F", () => {
  describe("EXTERNAL_AUTHORITY_REQUIRED status", () => {
    it("returns EXTERNAL_AUTHORITY_REQUIRED when query mentions legislation and no external source in pack", () => {
      const chunks = [
        makeChunk({ sourceType: "policy", confidence: 0.75 }),
        makeChunk({ chunkId: "c2", sourceType: "procedure", confidence: 0.70 }),
      ];
      const pack = makePack(chunks);
      const result = evaluateEvidenceSufficiency(makeInput(pack, {
        userRequest: "Review our policy against the applicable legislation and statutory requirements.",
      }));

      expect(result.status).toBe("EXTERNAL_AUTHORITY_REQUIRED");
      expect(result.missingAuthorityTypes).toContain("legislation");
      expect(result.isEscalationRecommended).toBe(true);
    });

    it("returns EXTERNAL_AUTHORITY_REQUIRED when query mentions FCA regulation", () => {
      const chunks = [makeChunk({ confidence: 0.75 }), makeChunk({ chunkId: "c2", confidence: 0.70 })];
      const pack = makePack(chunks);
      const result = evaluateEvidenceSufficiency(makeInput(pack, {
        userRequest: "Review our complaints policy against FCA DISP requirements.",
      }));

      expect(result.status).toBe("EXTERNAL_AUTHORITY_REQUIRED");
      expect(result.missingAuthorityTypes).toContain("regulator");
    });

    it("returns EXTERNAL_AUTHORITY_REQUIRED when query mentions GDPR", () => {
      const chunks = [makeChunk(), makeChunk({ chunkId: "c2" })];
      const pack = makePack(chunks);
      const result = evaluateEvidenceSufficiency(makeInput(pack, {
        userRequest: "Assess our data handling process for GDPR compliance.",
      }));

      expect(result.status).toBe("EXTERNAL_AUTHORITY_REQUIRED");
      expect(result.missingAuthorityTypes).toContain("regulation");
    });

    it("returns EXTERNAL_AUTHORITY_REQUIRED when requiredExternalAuthorityTypes is set", () => {
      const chunks = [makeChunk(), makeChunk({ chunkId: "c2" })];
      const pack = makePack(chunks);
      const result = evaluateEvidenceSufficiency(makeInput(pack, {
        userRequest:                    "Review our complaints handling process.",
        requiredExternalAuthorityTypes: ["regulation"],
      }));

      expect(result.status).toBe("EXTERNAL_AUTHORITY_REQUIRED");
    });

    it("does NOT flag EXTERNAL_AUTHORITY_REQUIRED when legislation chunk is in pack", () => {
      const chunks = [
        makeChunk({ sourceType: "legislation", confidence: 0.80, sourceId: "s1" }),
        makeChunk({ chunkId: "c2", sourceType: "policy", confidence: 0.70, sourceId: "s2" }),
      ];
      const pack = makePack(chunks);
      const result = evaluateEvidenceSufficiency(makeInput(pack, {
        userRequest: "Review our policy against the applicable legislation.",
      }));

      expect(result.missingAuthorityTypes).not.toContain("legislation");
      // Status may be SUFFICIENT or UNRESOLVED_REFERENCE depending on chunk text
      expect(result.status).not.toBe("EXTERNAL_AUTHORITY_REQUIRED");
    });

    it("does NOT flag external authority for normal internal policy queries", () => {
      const chunks = [makeChunk(), makeChunk({ chunkId: "c2" })];
      const pack = makePack(chunks);
      const result = evaluateEvidenceSufficiency(makeInput(pack, {
        userRequest: "Review our complaints management process and identify any gaps.",
      }));

      expect(result.missingAuthorityTypes).toHaveLength(0);
    });

    it("detects HSE requirement from query", () => {
      const chunks = [makeChunk(), makeChunk({ chunkId: "c2" })];
      const pack = makePack(chunks);
      const result = evaluateEvidenceSufficiency(makeInput(pack, {
        userRequest: "Review our safety procedures against HSE requirements.",
      }));

      expect(result.missingAuthorityTypes).toContain("government_authority");
    });

    it("detects ISO standard requirement from query", () => {
      const chunks = [makeChunk(), makeChunk({ chunkId: "c2" })];
      const pack = makePack(chunks);
      const result = evaluateEvidenceSufficiency(makeInput(pack, {
        userRequest: "Assess our information security policy for ISO 27001 compliance.",
      }));

      expect(result.missingAuthorityTypes).toContain("standard");
    });
  });
});

// ─── Priority ordering of statuses ───────────────────────────────────────────

describe("Status priority ordering", () => {
  it("EXTERNAL_AUTHORITY_REQUIRED takes precedence over UNRESOLVED_REFERENCE", () => {
    const chunks = [
      makeChunk({
        text: "For escalation, see the Escalation Procedure.",
        confidence: 0.70,
      }),
    ];
    const pack = makePack(chunks);
    const result = evaluateEvidenceSufficiency(makeInput(pack, {
      userRequest: "Review our policy against applicable regulation.",
    }));

    // Both external authority and unresolved reference detected
    // External authority has higher priority
    expect(result.status).toBe("EXTERNAL_AUTHORITY_REQUIRED");
    // Unresolved reference still reported in reasons
    const refReason = result.reasons.find(r => r.code === "UNRESOLVED_CROSS_REFERENCES");
    expect(refReason).toBeDefined();
  });

  it("UNRESOLVED_REFERENCE takes precedence over LOW_CONFIDENCE", () => {
    const chunks = [
      makeChunk({
        text: "For escalation, see the Escalation Procedure.",
        confidence: 0.10, // below LOW_CONFIDENCE_THRESHOLD
      }),
      makeChunk({ chunkId: "c2", confidence: 0.08 }),
    ];
    const pack = makePack(chunks);
    const result = evaluateEvidenceSufficiency(makeInput(pack, {
      userRequest: "Review our complaints process.",
    }));

    // Low confidence detected AND unresolved reference
    // UNRESOLVED_REFERENCE takes precedence
    expect(result.status).toBe("UNRESOLVED_REFERENCE");
  });
});
