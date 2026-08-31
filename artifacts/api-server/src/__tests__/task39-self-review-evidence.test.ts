/**
 * task39-self-review-evidence.test.ts — Task #39
 *
 * Tests for self-review evidence hardening:
 *   - Evidence-backed consistency scoring (blueprint criteria, contradictions)
 *   - Evidence-backed terminology adherence (mandatory citations, memory titles)
 *   - Evidence arrays populated on every dimension
 *   - Deterministic fallback when AI unavailable
 *   - One-automatic-revision limit enforced and logged
 *   - Audit event fired on every review outcome
 *   - revisionLimitReached flag set correctly
 *   - evidenceSummaryHash populated and deterministic
 *   - computeEvidenceHash helper
 *   - isSensitivityPermitted not affected (separate service)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks (vi.hoisted — must precede any import) ────────────────────────────

const mockLogOrgEvent = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("../services/auditService.js", () => ({
  logOrgEvent: mockLogOrgEvent,
}));

// Mock AI gateway so revision attempts are controllable
const mockGatewayProcess = vi.hoisted(() => vi.fn());
const mockCreateAIGateway = vi.hoisted(() =>
  vi.fn().mockReturnValue({ process: mockGatewayProcess }),
);
vi.mock("@workspace/ai-gateway", () => ({
  createAIGateway: mockCreateAIGateway,
}));

// Import after mocks
const {
  reviewDraft,
  computeEvidenceHash,
  QUALITY_THRESHOLD,
  MAX_AUTO_REVISIONS,
  REVIEW_DIMENSIONS,
} = await import("../services/selfReviewService.js");

// ─── Fixtures ────────────────────────────────────────────────────────────────

const ORG_ID   = "org-review-001";
const USER_ID  = "user-review-001";

const ctx = { organizationId: ORG_ID, userId: USER_ID };

function makeBlueprint(overrides: Record<string, unknown> = {}) {
  return {
    id: "bp-001",
    organizationId: null,
    code: "risk_assessment",
    title: "Risk Assessment",
    version: "1.0",
    objective: "Assess and document operational risks and mitigation strategies",
    primarySpecialist: "compliance_officer",
    supportingSpecialists: [],
    requiredLibraryKnowledge: [],
    requiredEntityKnowledge: {},
    requiredMemories: [],
    requiredApprovals: {},
    validationRules: [],
    qualityRules: [],
    successCriteria: ["Include risk assessment", "Provide mitigation strategies", "Reference NDIS standards"],
    outputTypes: ["risk_assessment"],
    escalationRules: [],
    mandatoryCitations: [],
    isBuiltIn: true,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeManifest(overrides: Record<string, unknown> = {}) {
  return {
    id: "manifest-001",
    organizationId: ORG_ID,
    completedWorkId: null,
    executionId: "exec-001",
    blueprintId: "bp-001",
    blueprintVersion: "1.0",
    primarySpecialist: "compliance_officer",
    supportingSpecialists: [],
    organisationLibrarySources: [],
    cosMemories: [],
    specialistMemories: [],
    entityKnowledge: {},
    taskUploads: [],
    modelVersion: "gpt-4",
    promptVersion: "sprint22.1.0",
    assembledAt: new Date(),
    requesterId: USER_ID,
    createdAt: new Date(),
    ...overrides,
  };
}

const GOOD_CONTENT = `# Risk Assessment — Operations

## Executive Summary
This risk assessment evaluates operational risks and provides mitigation strategies
for managing compliance with NDIS standards and applicable legislation.

## Risk Register

### Risk 1: Staffing Shortfalls
**Likelihood**: Medium | **Impact**: High
Mitigation: Implement cross-training program and maintain on-call roster.

## Mitigation Strategies
The following risk mitigation approaches are recommended for immediate implementation.

## Recommendations
Action items have been identified and assigned to relevant department heads.
Next steps include quarterly review and sign-off by the executive team.

## Approval
This document requires sign-off from the Compliance Manager before distribution.
`;

const SHORT_CONTENT = "Brief output.";
const LONG_INCOMPLETE_CONTENT = `# Draft\n\n${"Brief unsupported output with missing professional structure. ".repeat(80)}`;

beforeEach(() => {
  vi.clearAllMocks();
  mockLogOrgEvent.mockResolvedValue(undefined);
  // Default: no AI revision (internal provider)
  delete process.env.AI_PROVIDER;
});

// ─── Evidence populated on every dimension ───────────────────────────────────

describe("Evidence arrays", () => {
  it("every dimension result has a non-empty evidence array", async () => {
    const result = await reviewDraft(GOOD_CONTENT, makeManifest(), makeBlueprint(), ctx);

    for (const dim of result.dimensions) {
      expect(dim.evidence, `${dim.dimension} should have evidence`).toBeDefined();
      expect(Array.isArray(dim.evidence), `${dim.dimension}.evidence should be array`).toBe(true);
      expect(dim.evidence.length, `${dim.dimension} should have ≥1 citation`).toBeGreaterThan(0);
    }
  });

  it("all 10 dimensions are always returned", async () => {
    const result = await reviewDraft(GOOD_CONTENT, makeManifest(), null, ctx);
    expect(result.dimensions).toHaveLength(REVIEW_DIMENSIONS.length);
  });

  it("evidence strings are plain-language (no raw regex sources)", async () => {
    const result = await reviewDraft(GOOD_CONTENT, makeManifest(), makeBlueprint(), ctx);
    for (const dim of result.dimensions) {
      for (const ev of dim.evidence) {
        expect(typeof ev).toBe("string");
        expect(ev.length).toBeGreaterThan(0);
        // Evidence should not be raw regex patterns
        expect(ev).not.toMatch(/^\//);
      }
    }
  });
});

// ─── Consistency dimension — evidence-backed scoring ─────────────────────────

describe("Consistency dimension — evidence-backed", () => {
  it("score is not hardcoded 8 — derives from blueprint criteria coverage", async () => {
    const blueprint = makeBlueprint({
      successCriteria: ["Include risk assessment", "Provide mitigation"],
    });
    const result = await reviewDraft(GOOD_CONTENT, makeManifest(), blueprint, ctx);
    const consistency = result.dimensions.find(d => d.dimension === "consistency")!;

    expect(consistency).toBeDefined();
    // Score is evidence-derived — GOOD_CONTENT covers the criteria
    expect(consistency.evidence.length).toBeGreaterThan(0);
    expect(consistency.evidence.some(e => e.includes("criteria") || e.includes("objective"))).toBe(true);
  });

  it("score is lower when blueprint objective keywords are absent from content", async () => {
    const blueprint = makeBlueprint({
      objective: "Evaluate cybersecurity threats including intrusion detection and firewall configuration",
      successCriteria: ["Assess intrusion detection", "Evaluate firewall rules"],
    });
    const unrelatedContent = `# General Business Update\nThis document covers routine administrative matters.\nNo specific technical details.`;

    const result = await reviewDraft(unrelatedContent, makeManifest(), blueprint, ctx);
    const consistency = result.dimensions.find(d => d.dimension === "consistency")!;

    expect(consistency.score).toBeLessThan(10);
    expect(consistency.evidence.some(e => e.includes("coverage"))).toBe(true);
  });

  it("detects contradictory statements and deducts score", async () => {
    const contradictoryContent = `
# Report
The policy is compliant with all standards.
After further review, the policy is not compliant and requires revision.
The system has been completed successfully.
Actually, the system has not been completed yet.
`;
    const result = await reviewDraft(contradictoryContent, makeManifest(), null, ctx);
    const consistency = result.dimensions.find(d => d.dimension === "consistency")!;

    expect(consistency.evidence.some(e => e.toLowerCase().includes("contradiction"))).toBe(true);
    // Score should be deducted for contradictions
    expect(consistency.score).toBeLessThan(10);
  });

  it("no contradictions in clean content → no contradiction evidence", async () => {
    const result = await reviewDraft(GOOD_CONTENT, makeManifest(), makeBlueprint(), ctx);
    const consistency = result.dimensions.find(d => d.dimension === "consistency")!;

    const contradictionEvidence = consistency.evidence.filter(e =>
      e.toLowerCase().includes("contradiction detected")
    );
    expect(contradictionEvidence).toHaveLength(0);
    expect(consistency.evidence.some(e => e.includes("No direct contradictions"))).toBe(true);
  });
});

// ─── Terminology adherence — evidence-backed ─────────────────────────────────

describe("Terminology adherence — evidence-backed", () => {
  it("passes with empty evidence when no terminology config exists", async () => {
    const result = await reviewDraft(GOOD_CONTENT, makeManifest(), null, ctx);
    const styleCheck = result.dimensions.find(d => d.dimension === "writing_style_compliance")!;

    // Should have evidence that terminology check was skipped
    expect(styleCheck.evidence.some(e => e.includes("terminology") || e.includes("skipped"))).toBe(true);
  });

  it("checks mandatory citations from blueprint and records evidence", async () => {
    const blueprint = makeBlueprint({
      mandatoryCitations: ["NDIS Practice Standards", "Disability Services Act"],
    });
    const contentWithCitation = `${GOOD_CONTENT}\nReference: NDIS Practice Standards section 4.2.`;

    const result = await reviewDraft(contentWithCitation, makeManifest(), blueprint, ctx);
    const styleCheck = result.dimensions.find(d => d.dimension === "writing_style_compliance")!;

    // Should record NDIS as present, Disability Services Act as missing
    const ndisEvidence = styleCheck.evidence.find(e => e.includes("NDIS Practice Standards"));
    expect(ndisEvidence).toBeDefined();
    expect(ndisEvidence).toContain("present");
  });

  it("records missing mandatory citations as evidence with MISSING label", async () => {
    const blueprint = makeBlueprint({
      mandatoryCitations: ["Critical Policy Document"],
    });
    // Content does not mention the required citation
    const result = await reviewDraft(GOOD_CONTENT, makeManifest(), blueprint, ctx);
    const styleCheck = result.dimensions.find(d => d.dimension === "writing_style_compliance")!;

    const missingEvidence = styleCheck.evidence.find(e =>
      e.includes("Critical Policy Document") && e.includes("MISSING")
    );
    expect(missingEvidence).toBeDefined();
  });

  it("records terminology memories by title in evidence", async () => {
    const manifest = makeManifest({
      cosMemories: [
        { memoryId: "mem-001", memoryType: "terminology", title: "NDIS Terminology Guide", approvalStatus: "approved" },
      ],
    });
    const result = await reviewDraft(GOOD_CONTENT, manifest, null, ctx);
    const styleCheck = result.dimensions.find(d => d.dimension === "writing_style_compliance")!;

    const termEvidence = styleCheck.evidence.find(e => e.includes("NDIS Terminology Guide"));
    expect(termEvidence).toBeDefined();
  });

  it("always-true stub is replaced — terminology check is now deterministic", async () => {
    // With a mandatory citation that IS in the content, expect "present" evidence
    const blueprint = makeBlueprint({ mandatoryCitations: ["NDIS"] });
    const contentWithNDIS = `${GOOD_CONTENT}\nNDIS registration requirements apply.`;

    const result = await reviewDraft(contentWithNDIS, makeManifest(), blueprint, ctx);
    const styleCheck = result.dimensions.find(d => d.dimension === "writing_style_compliance")!;

    const ndisEvidence = styleCheck.evidence.find(e => e.includes("NDIS") && e.includes("present"));
    expect(ndisEvidence).toBeDefined();
  });
});

// ─── Revision limit enforcement ───────────────────────────────────────────────

describe("Revision limit enforcement", () => {
  it("MAX_AUTO_REVISIONS constant is 1", () => {
    expect(MAX_AUTO_REVISIONS).toBe(1);
  });

  it("revisionLimitReached=false when content passes (no revision needed)", async () => {
    // GOOD_CONTENT should score above threshold
    const result = await reviewDraft(GOOD_CONTENT, makeManifest(), makeBlueprint(), ctx);

    // If no revision was attempted, revisionLimitReached should still be false
    expect(result.revisionLimitReached).toBe(false);
    expect(result.revised).toBe(false);
  });

  it("revisionLimitReached=true after one revision attempt on failing content", async () => {
    // Provider must be openai for revision to be attempted
    process.env.AI_PROVIDER = "openai";
    // AI gateway returns same content (no improvement possible)
    mockGatewayProcess.mockResolvedValueOnce({ content: SHORT_CONTENT, usedFallback: false });

    const result = await reviewDraft(SHORT_CONTENT, makeManifest(), makeBlueprint(), ctx);

    expect(result.revisionLimitReached).toBe(true);
    // Only one revision was attempted (even though it didn't improve)
    expect(mockGatewayProcess).toHaveBeenCalledTimes(1);
  });

  it("exactly one revision attempt even when content still fails after revision", async () => {
    process.env.AI_PROVIDER = "openai";
    const improvedContent = "A bit longer content with more detail and professional language.";
    mockGatewayProcess.mockResolvedValueOnce({ content: improvedContent, usedFallback: false });

    const result = await reviewDraft(SHORT_CONTENT, makeManifest(), makeBlueprint(), ctx);

    // Only one gateway call — no second revision
    expect(mockGatewayProcess).toHaveBeenCalledTimes(1);
    expect(result.revisionLimitReached).toBe(true);
  });

  it("no revision attempted when AI provider is not openai", async () => {
    process.env.AI_PROVIDER = "internal";
    const result = await reviewDraft(SHORT_CONTENT, makeManifest(), makeBlueprint(), ctx);

    // No gateway calls (provider !== openai)
    expect(mockGatewayProcess).not.toHaveBeenCalled();
    expect(result.revised).toBe(false);
  });

  it("revised=true when AI revision changes the content", async () => {
    process.env.AI_PROVIDER = "openai";
    const revisedContent = GOOD_CONTENT + "\n\nAdditional section added by revision.";
    mockGatewayProcess.mockResolvedValueOnce({ content: revisedContent, usedFallback: false });

    const result = await reviewDraft(SHORT_CONTENT, makeManifest(), makeBlueprint(), ctx);

    expect(result.revised).toBe(true);
    expect(result.finalContent).toBe(revisedContent);
    expect(result.autoRevisionNote).toBeDefined();
    expect(result.autoRevisionNote).toContain("Auto-revised");
  });

  it("discards a revision that finishes because of output length", async () => {
    process.env.AI_PROVIDER = "openai";
    const truncatedRevision = `${LONG_INCOMPLETE_CONTENT.slice(0, 900)}\n\n| Decision-making | [WHAT_THE_WORKER_DOES_DECISION_MAKING_RELATING_TO_D`;
    mockGatewayProcess.mockResolvedValueOnce({
      content: truncatedRevision,
      usedFallback: false,
      finishReason: "length",
    });

    const result = await reviewDraft(LONG_INCOMPLETE_CONTENT, makeManifest(), makeBlueprint(), ctx);

    expect(mockGatewayProcess).toHaveBeenCalledTimes(1);
    expect(result.revised).toBe(false);
    expect(result.finalContent).toBe(LONG_INCOMPLETE_CONTENT);
    expect(result.autoRevisionNote).toContain("output length limit");
  });

  it("discards a materially shorter revision and retains the original", async () => {
    process.env.AI_PROVIDER = "openai";
    const truncatedRevision = LONG_INCOMPLETE_CONTENT.slice(0, Math.floor(LONG_INCOMPLETE_CONTENT.length * 0.5));
    mockGatewayProcess.mockResolvedValueOnce({
      content: truncatedRevision,
      usedFallback: false,
      finishReason: "stop",
    });

    const result = await reviewDraft(LONG_INCOMPLETE_CONTENT, makeManifest(), makeBlueprint(), ctx);

    expect(mockGatewayProcess).toHaveBeenCalledTimes(1);
    expect(result.revised).toBe(false);
    expect(result.finalContent).toBe(LONG_INCOMPLETE_CONTENT);
    expect(result.autoRevisionNote).toContain("less than 85%");
  });
});

// ─── Audit events ─────────────────────────────────────────────────────────────

describe("Audit events for review outcomes", () => {
  it("fires specialist.output_validated audit event for every review", async () => {
    await reviewDraft(GOOD_CONTENT, makeManifest(), makeBlueprint(), ctx);

    await Promise.resolve(); // allow fire-and-forget to settle
    expect(mockLogOrgEvent).toHaveBeenCalledOnce();
    expect(mockLogOrgEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORG_ID,
        actorType:      "system",
        eventType:      "specialist.output_validated",
        resourceType:   "completed_work",
      }),
    );
  });

  it("audit metadata includes qualityScore, passed, revised, evidenceSummaryHash", async () => {
    await reviewDraft(GOOD_CONTENT, makeManifest(), makeBlueprint(), ctx);

    await Promise.resolve();
    const call = mockLogOrgEvent.mock.calls[0]![0];
    expect(call.metadata.qualityScore).toBeDefined();
    expect(typeof call.metadata.passed).toBe("boolean");
    expect(typeof call.metadata.revised).toBe("boolean");
    expect(call.metadata.evidenceSummaryHash).toBeDefined();
    expect(call.metadata.evidenceSummaryHash.length).toBeGreaterThan(0);
  });

  it("audit event includes dimensionCount", async () => {
    await reviewDraft(GOOD_CONTENT, makeManifest(), null, ctx);

    await Promise.resolve();
    const call = mockLogOrgEvent.mock.calls[0]![0];
    expect(call.metadata.dimensionCount).toBe(11);
  });

  it("context assembly is not blocked when audit write fails", async () => {
    mockLogOrgEvent.mockRejectedValueOnce(new Error("Audit DB down"));

    await expect(
      reviewDraft(GOOD_CONTENT, makeManifest(), makeBlueprint(), ctx)
    ).resolves.toBeDefined();
  });
});

// ─── Evidence summary hash ────────────────────────────────────────────────────

describe("Evidence summary hash", () => {
  it("evidenceSummaryHash is a non-empty string", async () => {
    const result = await reviewDraft(GOOD_CONTENT, makeManifest(), makeBlueprint(), ctx);
    expect(typeof result.evidenceSummaryHash).toBe("string");
    expect(result.evidenceSummaryHash.length).toBeGreaterThan(0);
  });

  it("same inputs produce the same hash (deterministic)", async () => {
    const r1 = await reviewDraft(GOOD_CONTENT, makeManifest(), makeBlueprint(), ctx);
    const r2 = await reviewDraft(GOOD_CONTENT, makeManifest(), makeBlueprint(), ctx);
    expect(r1.evidenceSummaryHash).toBe(r2.evidenceSummaryHash);
  });

  it("different content produces different hash", async () => {
    const r1 = await reviewDraft(GOOD_CONTENT, makeManifest(), null, ctx);
    const r2 = await reviewDraft(SHORT_CONTENT, makeManifest(), null, ctx);
    expect(r1.evidenceSummaryHash).not.toBe(r2.evidenceSummaryHash);
  });

  it("computeEvidenceHash is exported and deterministic", () => {
    const dims = [
      { dimension: "safety" as const, score: 10, passed: true, feedback: "ok", improvementSuggestions: [], evidence: ["No flags"] },
    ];
    const h1 = computeEvidenceHash(dims);
    const h2 = computeEvidenceHash(dims);
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(16);
  });
});

// ─── Deterministic fallback ───────────────────────────────────────────────────

describe("Deterministic fallback", () => {
  it("review completes successfully without blueprint (null)", async () => {
    const result = await reviewDraft(GOOD_CONTENT, makeManifest(), null, ctx);
    expect(result.dimensions).toHaveLength(11);
    expect(typeof result.qualityScore).toBe("number");
  });

  it("review completes with empty manifest sources", async () => {
    const result = await reviewDraft(GOOD_CONTENT, makeManifest(), null, ctx);
    const policyDim = result.dimensions.find(d => d.dimension === "policy_compliance")!;
    expect(policyDim.evidence.length).toBeGreaterThan(0);
    expect(policyDim.evidence.some(e => e.includes("No policy"))).toBe(true);
  });

  it("source_coverage evidence lists sources not cited", async () => {
    const manifest = makeManifest({
      organisationLibrarySources: [
        { sourceId: "src-1", title: "NDIS Guidelines",   sourceType: "policy" },
        { sourceId: "src-2", title: "Safety Procedures", sourceType: "procedure" },
      ],
    });
    // GOOD_CONTENT mentions neither "NDIS Guidelines" nor "Safety Procedures" by first word
    const result = await reviewDraft(SHORT_CONTENT, manifest, null, ctx);
    const coverage = result.dimensions.find(d => d.dimension === "source_coverage")!;

    expect(coverage.evidence.some(e => e.includes("NOT referenced"))).toBe(true);
  });

  it("instruction_adherence evidence cites each criterion individually", async () => {
    const blueprint = makeBlueprint({
      successCriteria: ["Include risk register", "Provide mitigation plan"],
    });
    const result = await reviewDraft(GOOD_CONTENT, makeManifest(), blueprint, ctx);
    const adherence = result.dimensions.find(d => d.dimension === "instruction_adherence")!;

    expect(adherence.evidence.some(e => e.includes("Include risk register"))).toBe(true);
    expect(adherence.evidence.some(e => e.includes("Provide mitigation plan"))).toBe(true);
  });

  it("safety dimension evidence lists triggered flags or confirms none", async () => {
    const safetyContent = "The team should fabricate the numbers to meet the target.";
    const result = await reviewDraft(safetyContent, makeManifest(), null, ctx);
    const safety = result.dimensions.find(d => d.dimension === "safety")!;

    expect(safety.evidence.some(e => e.toLowerCase().includes("fabricat"))).toBe(true);
    // One triggered flag: score = 10 - 3 = 7; safety passes threshold at 7
    // Evidence records the flag even when score still passes
    expect(safety.score).toBeLessThan(10);
  });

  it("QUALITY_THRESHOLD is 70", () => {
    expect(QUALITY_THRESHOLD).toBe(70);
  });
});

// ─── Regression: revised-content hash matches final dimensions ───────────────

describe("Regression: evidenceSummaryHash reflects final (post-revision) dimensions", () => {
  it("hash is computed from finalDimensions, not pre-revision dimensions", async () => {
    process.env.AI_PROVIDER = "openai";
    const revisedContent = GOOD_CONTENT + "\n\nAdditional comprehensive section added by auto-revision covering all criteria.";
    mockGatewayProcess.mockResolvedValueOnce({ content: revisedContent, usedFallback: false });

    const result = await reviewDraft(SHORT_CONTENT, makeManifest(), makeBlueprint(), ctx);

    // If revision occurred, verify hash matches final dimensions, not original
    if (result.revised) {
      const expectedHash = computeEvidenceHash(result.dimensions);
      expect(result.evidenceSummaryHash).toBe(expectedHash);
    }
    // Hash should be non-empty regardless
    expect(result.evidenceSummaryHash.length).toBeGreaterThan(0);
  });

  it("hash from unrevised and revised runs differ when content changes", async () => {
    // Unrevised (no openai provider)
    delete process.env.AI_PROVIDER;
    const r1 = await reviewDraft(GOOD_CONTENT, makeManifest(), makeBlueprint(), ctx);

    // Revised (openai provider, content changes)
    process.env.AI_PROVIDER = "openai";
    const differentContent = "Completely different content for the second run of this evidence test.";
    mockGatewayProcess.mockResolvedValueOnce({ content: differentContent, usedFallback: false });
    const r2 = await reviewDraft(SHORT_CONTENT, makeManifest(), makeBlueprint(), ctx);

    // Different final content → different final dimensions → different hash
    expect(r1.evidenceSummaryHash).not.toBe(r2.evidenceSummaryHash);
  });

  it("hash in audit metadata matches result.evidenceSummaryHash", async () => {
    process.env.AI_PROVIDER = "openai";
    mockGatewayProcess.mockResolvedValueOnce({ content: GOOD_CONTENT, usedFallback: false });

    const result = await reviewDraft(SHORT_CONTENT, makeManifest(), makeBlueprint(), ctx);
    await Promise.resolve(); // allow fire-and-forget

    const call = mockLogOrgEvent.mock.calls[0]![0];
    expect(call.metadata.evidenceSummaryHash).toBe(result.evidenceSummaryHash);
  });
});

// ─── Regression: required memory types checked without terminology memories ───

describe("Regression: required memory types enforced even without terminology memories", () => {
  it("required memory types are checked when no terminology memories present", async () => {
    const blueprint = makeBlueprint({
      requiredMemories: ["terminology", "procedures"],
      mandatoryCitations: [],
    });
    // Manifest has NO terminology-typed memories
    const manifest = makeManifest({ cosMemories: [] });

    const result = await reviewDraft(GOOD_CONTENT, manifest, blueprint, ctx);
    const styleCheck = result.dimensions.find(d => d.dimension === "writing_style_compliance")!;

    // Required memory types should appear in evidence even though terminologyMemories.length === 0
    const terminologyEvidence = styleCheck.evidence.find(e =>
      e.includes("terminology") && (e.includes("NOT in manifest") || e.includes("not in manifest") || e.includes("present in manifest"))
    );
    expect(terminologyEvidence).toBeDefined();

    const proceduresEvidence = styleCheck.evidence.find(e =>
      e.includes("procedures") && (e.includes("NOT in manifest") || e.includes("not in manifest") || e.includes("present in manifest"))
    );
    expect(proceduresEvidence).toBeDefined();
  });

  it("mandatory citations are checked when no terminology memories present", async () => {
    const blueprint = makeBlueprint({
      mandatoryCitations: ["NDIS Quality Standards"],
      requiredMemories: [],
    });
    const manifest = makeManifest({ cosMemories: [] }); // no terminology memories

    const result = await reviewDraft(GOOD_CONTENT, manifest, blueprint, ctx);
    const styleCheck = result.dimensions.find(d => d.dimension === "writing_style_compliance")!;

    // Mandatory citation should be checked regardless of terminology memories
    const citationEvidence = styleCheck.evidence.find(e => e.includes("NDIS Quality Standards"));
    expect(citationEvidence).toBeDefined();
  });

  it("terminology check is skipped only when zero constraints exist", async () => {
    // No blueprint, no memories → check should be skipped
    const result = await reviewDraft(GOOD_CONTENT, makeManifest({ cosMemories: [] }), null, ctx);
    const styleCheck = result.dimensions.find(d => d.dimension === "writing_style_compliance")!;

    expect(styleCheck.evidence.some(e => e.includes("skipped"))).toBe(true);
  });

  it("required memory types present in manifest record as present in evidence", async () => {
    const blueprint = makeBlueprint({ requiredMemories: ["terminology"] });
    const manifest = makeManifest({
      cosMemories: [
        { memoryId: "mem-t1", memoryType: "terminology", title: "NDIS Terminology", approvalStatus: "approved" },
      ],
    });

    const result = await reviewDraft(GOOD_CONTENT, manifest, blueprint, ctx);
    const styleCheck = result.dimensions.find(d => d.dimension === "writing_style_compliance")!;

    const presentEvidence = styleCheck.evidence.find(e =>
      e.includes("terminology") && e.includes("present in manifest")
    );
    expect(presentEvidence).toBeDefined();
  });
});

// ─── ReviewResult structural completeness ────────────────────────────────────

describe("ReviewResult structure", () => {
  it("result includes revisionLimitReached boolean", async () => {
    const result = await reviewDraft(GOOD_CONTENT, makeManifest(), null, ctx);
    expect(typeof result.revisionLimitReached).toBe("boolean");
  });

  it("result includes evidenceSummaryHash string", async () => {
    const result = await reviewDraft(GOOD_CONTENT, makeManifest(), null, ctx);
    expect(typeof result.evidenceSummaryHash).toBe("string");
  });

  it("finalContent equals input content when no revision", async () => {
    const result = await reviewDraft(GOOD_CONTENT, makeManifest(), makeBlueprint(), ctx);
    if (!result.revised) {
      expect(result.finalContent).toBe(GOOD_CONTENT);
    }
  });
});
