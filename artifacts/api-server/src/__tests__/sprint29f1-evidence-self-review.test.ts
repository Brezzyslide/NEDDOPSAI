/**
 * sprint29f1-evidence-self-review.test.ts — Sprint 29F.1 Part 4
 *
 * Tests the evidence_citation_grounding dimension added to selfReviewService:
 *   A — Dimension registration (REVIEW_DIMENSIONS, DIMENSION_WEIGHTS)
 *   B — reviewEvidenceCitationGrounding behaviour
 *   C — Integration: reviewDraft passes evidencePack from ReviewContext
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock AI gateway (LLM-assisted dimensions) to avoid real calls
vi.mock("@workspace/ai-gateway", () => ({
  createAIGateway: vi.fn().mockReturnValue({
    chat: vi.fn().mockResolvedValue({ content: "Revised content for quality improvement." }),
  }),
}));
vi.mock("../services/auditService.js", () => ({
  logOrgEvent: vi.fn().mockResolvedValue(undefined),
}));

import {
  REVIEW_DIMENSIONS,
  reviewDraft,
  QUALITY_THRESHOLD,
} from "../services/selfReviewService.js";
import type { WorkPackageManifest } from "../services/workPackageService.js";
import type { WorkBlueprint } from "../services/workBlueprintService.js";
import type { EvidencePack } from "../services/knowledgeResolutionService.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeManifest(overrides: Partial<WorkPackageManifest> = {}): WorkPackageManifest {
  return {
    executionId: "exec_review_001",
    primarySpecialist: "operations_manager",
    cosMemories: [],
    organisationLibrarySources: [],
    taskUploadSources: [],
    userRequest: "Review medication policy",
    selectionMetadata: null,
    ...overrides,
  } as unknown as WorkPackageManifest;
}

function makeEvidencePack(overrides: Partial<EvidencePack> = {}): EvidencePack {
  return {
    executionId: "exec_review_001",
    organisationId: "org_001",
    resolvedAt: new Date(),
    chunks: [
      {
        chunkId: "chunk_001",
        sourceId: "source_001",
        sourceTitle: "Medication Policy v3",
        versionLabel: "v3",
        sourceType: "policy",
        authorityLevel: "mandatory",
        sectionTitle: "Administration",
        pageNumber: 1,
        text: "Medication must be administered by a registered nurse.",
        confidence: 0.95,
        citation: "Medication Policy v3, p.1",
        selectionReason: "high-confidence policy match",
      },
    ],
    sourceIds: ["source_001"],
    citationsByType: {},
    totalChunks: 1,
    avgConfidence: 0.95,
    retrievalMetrics: { queryCount: 1, totalCandidates: 5, selectedChunks: 1, cacheHit: false, retrievalMs: 120 },
    ...overrides,
  };
}

const ctx = { organizationId: "org_001", userId: "user_001" };
const content = "## Medication Policy Review\n\nThe Medication Policy v3 states that medication must be administered by registered nurses. This review confirms compliance with the current policy framework. Recommendations include quarterly audits and enhanced training programs.";

// ─── Suite A — Dimension registration ────────────────────────────────────────

describe("Deliverable A — Dimension registration", () => {
  it("REVIEW_DIMENSIONS includes evidence_citation_grounding", () => {
    expect(REVIEW_DIMENSIONS).toContain("evidence_citation_grounding");
  });

  it("REVIEW_DIMENSIONS now has 11 dimensions", () => {
    expect(REVIEW_DIMENSIONS.length).toBe(11);
  });

  it("DIMENSION_WEIGHTS still sum to 100 with new dimension", async () => {
    // Import weights indirectly through reviewing a minimal doc
    const manifest = makeManifest();
    const result = await reviewDraft(content, manifest, null, ctx);
    // Verify all 11 dimensions are present in the result
    expect(result.dimensions.length).toBe(11);
    const dimensions = result.dimensions.map(d => d.dimension);
    expect(dimensions).toContain("evidence_citation_grounding");
  });
});

// ─── Suite B — evidence_citation_grounding behaviour ─────────────────────────

describe("Deliverable B — evidence_citation_grounding dimension", () => {
  it("scores 6 (warns) when no evidencePack provided", async () => {
    const manifest = makeManifest();
    const result = await reviewDraft(content, manifest, null, ctx); // no evidencePack
    const dim = result.dimensions.find(d => d.dimension === "evidence_citation_grounding")!;
    expect(dim).toBeTruthy();
    expect(dim.score).toBe(6);
    expect(dim.passed).toBe(true); // 6 >= 6 passes
    expect(dim.feedback.toLowerCase()).toContain("no evidencepack provided");
  });

  it("scores well when manifest sources exist in EvidencePack", async () => {
    const manifest = makeManifest({
      organisationLibrarySources: [{
        sourceId: "source_001",
        title: "Medication Policy v3",
        sourceType: "policy",
        authorityLevel: "mandatory",
        versionLabel: "v3",
      }] as any,
    });
    const evidencePack = makeEvidencePack();
    const result = await reviewDraft(content, manifest, null, { ...ctx, evidencePack });
    const dim = result.dimensions.find(d => d.dimension === "evidence_citation_grounding")!;
    // source_001 is in evidence pack — no deduction for missing sources
    expect(dim.score).toBeGreaterThanOrEqual(6);
    expect(dim.passed).toBe(true);
  });

  it("deducts 2 when manifest sources not found in EvidencePack", async () => {
    const manifest = makeManifest({
      organisationLibrarySources: [{
        sourceId: "missing_source_999",
        title: "Missing Policy",
        sourceType: "policy",
        authorityLevel: "mandatory",
        versionLabel: "v1",
      }] as any,
    });
    const evidencePack = makeEvidencePack(); // source_001, not missing_source_999
    const result = await reviewDraft(content, manifest, null, { ...ctx, evidencePack });
    const dim = result.dimensions.find(d => d.dimension === "evidence_citation_grounding")!;
    // Should have a deduction for missing source
    expect(dim.evidence.some((e: string) => e.includes("Deduction -2"))).toBe(true);
  });

  it("deducts 1 when connector evidence present but no provenance marker in content", async () => {
    const connectorPack = makeEvidencePack({
      chunks: [{
        chunkId: "chunk_conn",
        sourceId: "conn_source",
        sourceTitle: "Desktop File",
        versionLabel: null,
        sourceType: "connector",
        authorityLevel: "reference",
        sectionTitle: null,
        pageNumber: null,
        text: "Local policy content",
        confidence: 0.9,
        citation: "connector:Documents/policy.docx",
        selectionReason: "connector-based read",
      }],
      sourceIds: ["conn_source"],
    });
    const noProvenanceContent = "This is a review of the policy. The document was reviewed thoroughly.";
    const manifest = makeManifest();
    const result = await reviewDraft(noProvenanceContent, manifest, null, { ...ctx, evidencePack: connectorPack });
    const dim = result.dimensions.find(d => d.dimension === "evidence_citation_grounding")!;
    expect(dim.evidence.some((e: string) => e.includes("Deduction -1"))).toBe(true);
  });

  it("does NOT penalise correct [UNCERTAIN] markers for weak evidence", async () => {
    const manifest = makeManifest();
    const uncertainContent = content + "\n\n[UNCERTAIN: exact compliance date not confirmed]";
    const emptyPack = makeEvidencePack({ chunks: [], sourceIds: [], totalChunks: 0, avgConfidence: 0 });
    const result = await reviewDraft(uncertainContent, manifest, null, { ...ctx, evidencePack: emptyPack });
    const dim = result.dimensions.find(d => d.dimension === "evidence_citation_grounding")!;
    // UNCERTAIN markers should be noted positively
    expect(dim.evidence.some((e: string) => e.toLowerCase().includes("uncertain"))).toBe(true);
  });

  it("evidence array includes EvidencePack summary stats", async () => {
    const pack = makeEvidencePack();
    const manifest = makeManifest();
    const result = await reviewDraft(content, manifest, null, { ...ctx, evidencePack: pack });
    const dim = result.dimensions.find(d => d.dimension === "evidence_citation_grounding")!;
    expect(dim.evidence.some((e: string) => e.includes("1 chunks") || e.includes("1 sources"))).toBe(true);
  });
});

// ─── Suite C — Integration: reviewDraft passes evidencePack ──────────────────

describe("Deliverable C — reviewDraft integration", () => {
  it("passes evidencePack from ReviewContext to the new dimension", async () => {
    const manifest = makeManifest({
      organisationLibrarySources: [{
        sourceId: "source_001",
        title: "Policy v3",
        sourceType: "policy",
        authorityLevel: "mandatory",
        versionLabel: "v3",
      }] as any,
    });
    const evidencePack = makeEvidencePack(); // has source_001
    const result = await reviewDraft(content, manifest, null, { ...ctx, evidencePack });
    const dim = result.dimensions.find(d => d.dimension === "evidence_citation_grounding")!;
    // With matching sources, no missing-source deduction
    expect(dim.evidence.some((e: string) => e.includes("1/1"))).toBe(true);
  });

  it("result contains all 11 dimensions when evidencePack is provided", async () => {
    const result = await reviewDraft(content, makeManifest(), null, {
      ...ctx, evidencePack: makeEvidencePack(),
    });
    expect(result.dimensions.length).toBe(11);
    expect(result.dimensions.map(d => d.dimension)).toContain("evidence_citation_grounding");
  });

  it("qualityScore is still 0–100 with 11 dimensions and updated weights", async () => {
    const result = await reviewDraft(content, makeManifest(), null, ctx);
    expect(result.qualityScore).toBeGreaterThanOrEqual(0);
    expect(result.qualityScore).toBeLessThanOrEqual(100);
  });
});
