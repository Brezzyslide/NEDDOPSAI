/**
 * Sprint 27.5 — Pipeline Ordering Tests
 *
 * Verifies that resolveEvidence runs BEFORE validateWorkPackage, that validation
 * receives the EvidencePack, and that the retrieving_evidence stage label is
 * correct.
 *
 * These tests live in their own file to prevent vi.mock hoisting from
 * interfering with the unit tests in sprint275-evidence-aware-validation.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockResolveEvidence     = vi.hoisted(() => vi.fn());
const mockValidateWorkPackage = vi.hoisted(() => vi.fn());

vi.mock("../services/knowledgeResolutionService.js", () => ({
  resolveEvidence:         mockResolveEvidence,
  buildEvidenceSection:    vi.fn().mockReturnValue(""),
  buildCitationSummary:    vi.fn().mockReturnValue([]),
  invalidateEvidenceCache: vi.fn(),
  clearEvidenceCache:      vi.fn(),
}));
vi.mock("../services/workValidationService.js", () => ({
  validateWorkPackage:       mockValidateWorkPackage,
  buildClarificationMessage: vi.fn().mockReturnValue(""),
}));
vi.mock("../services/workBlueprintService.js", () => ({
  selectBlueprint:      vi.fn().mockResolvedValue({ blueprint: null, confidence: 0, fallbackUsed: false, matchedKeywords: [] }),
  getBlueprintById:     vi.fn().mockResolvedValue(null),
  getBlueprintSections: vi.fn().mockResolvedValue([]),
}));
vi.mock("../services/workPackageService.js", () => ({
  assembleWorkPackage: vi.fn().mockResolvedValue({
    manifest: {
      id:                         "mfst-1",
      executionId:                "exec-1",
      organizationId:             "org-1",
      primarySpecialist:          "operations_manager",
      supportingSpecialists:      [],
      organisationLibrarySources: [],
      cosMemories:                [],
      specialistMemories:         [],
      taskUploads:                [],
      entityKnowledge:            {},
      assembledAt:                new Date(),
    },
    excludedSources: [],
  }),
  updateManifestObservability: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../services/approvedExampleService.js", () => ({
  retrieveApprovedExamples: vi.fn().mockResolvedValue([]),
  buildStyleGuidance:       vi.fn().mockResolvedValue({ guidanceBlock: "" }),
}));
vi.mock("../services/selfReviewService.js", () => ({
  reviewDraft: vi.fn().mockResolvedValue({ finalContent: "draft", qualityScore: 80, dimensions: [] }),
}));
vi.mock("../services/completedWorkService.js", () => ({
  createDraft: vi.fn().mockResolvedValue({ id: "cw-1" }),
}));
vi.mock("@workspace/workforce-dna", () => ({
  buildSystemInstructionForEmployee: vi.fn().mockReturnValue("system prompt"),
}));
vi.mock("@workspace/ai-gateway", () => ({
  createAIGateway: vi.fn().mockReturnValue({
    createChatCompletion: vi.fn().mockResolvedValue({ text: "Draft output" }),
  }),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function passingValidation() {
  return {
    passed: true, issues: [], missingItems: [], conflictingItems: [],
    recommendedAction: "proceed" as const, summary: "OK",
    missingEvidenceItems: [], evidenceSearched: true, clarificationMessage: "",
  };
}

function mockEvidencePack() {
  return {
    executionId: "exec-1",
    organisationId: "org-1",
    resolvedAt: new Date(),
    chunks: [{
      chunkId: "c1", sourceId: "src-1", sourceTitle: "Policy",
      versionLabel: "v1", sourceType: "policy", authorityLevel: "primary",
      sectionTitle: "S1", pageNumber: 1, text: "...", confidence: 0.9,
      citation: "Policy, v1", selectionReason: "organisation_library",
    }],
    sourceIds: ["src-1"],
    citationsByType: {},
    totalChunks: 1,
    avgConfidence: 0.9,
    retrievalMetrics: { queryCount: 1, totalCandidates: 1, selectedChunks: 1, cacheHit: false, retrievalMs: 50 },
  };
}

// ─── Pipeline ordering ────────────────────────────────────────────────────────

describe("Pipeline ordering — resolveEvidence before validateWorkPackage", () => {
  const callOrder: string[] = [];

  beforeEach(() => {
    callOrder.length = 0;
    mockResolveEvidence.mockClear();
    mockValidateWorkPackage.mockClear();

    mockResolveEvidence.mockImplementation(async () => {
      callOrder.push("resolveEvidence");
      return mockEvidencePack();
    });
    mockValidateWorkPackage.mockImplementation(() => {
      callOrder.push("validateWorkPackage");
      return passingValidation();
    });
  });

  it("resolveEvidence is called before validateWorkPackage", async () => {
    const { executeWork } = await import("../services/workExecutionPipelineService.js");
    await executeWork({ organizationId: "org-1", requesterId: "user-1", requesterRole: "administrator", userRequest: "Review policy" });

    const evidenceIdx  = callOrder.indexOf("resolveEvidence");
    const validateIdx  = callOrder.indexOf("validateWorkPackage");
    expect(evidenceIdx).toBeGreaterThanOrEqual(0);
    expect(validateIdx).toBeGreaterThanOrEqual(0);
    expect(evidenceIdx).toBeLessThan(validateIdx);
  });

  it("validateWorkPackage receives the EvidencePack from resolveEvidence as 3rd argument", async () => {
    const { executeWork } = await import("../services/workExecutionPipelineService.js");
    await executeWork({ organizationId: "org-1", requesterId: "user-1", requesterRole: "administrator", userRequest: "Review policy" });

    expect(mockValidateWorkPackage).toHaveBeenCalled();
    const lastCall = mockValidateWorkPackage.mock.calls.at(-1)!;
    // arg[0]=manifest, arg[1]=blueprint, arg[2]=evidencePack
    const receivedPack = lastCall[2];
    expect(receivedPack).not.toBeNull();
    expect(receivedPack).not.toBeUndefined();
    expect(receivedPack.chunks).toBeDefined();
    expect(Array.isArray(receivedPack.chunks)).toBe(true);
  });

  it("when resolveEvidence throws, pipeline still calls validateWorkPackage (evidencePack=undefined)", async () => {
    callOrder.length = 0;
    mockResolveEvidence.mockImplementationOnce(async () => {
      callOrder.push("resolveEvidence");
      throw new Error("Retrieval failed");
    });
    mockValidateWorkPackage.mockImplementationOnce(() => {
      callOrder.push("validateWorkPackage");
      return passingValidation();
    });

    const { executeWork } = await import("../services/workExecutionPipelineService.js");
    await executeWork({ organizationId: "org-1", requesterId: "user-1", requesterRole: "administrator", userRequest: "Review policy" });

    // resolveEvidence ran first (and failed), then validateWorkPackage ran
    expect(callOrder.indexOf("resolveEvidence")).toBeLessThan(callOrder.indexOf("validateWorkPackage"));
    // evidencePack should be undefined (null from catch → ?? undefined)
    const lastCall = mockValidateWorkPackage.mock.calls.at(-1)!;
    expect(lastCall[2]).toBeUndefined();
  });

  it("validateWorkPackage is called exactly once per pipeline run", async () => {
    const { executeWork } = await import("../services/workExecutionPipelineService.js");
    await executeWork({ organizationId: "org-1", requesterId: "user-1", requesterRole: "administrator", userRequest: "Review policy" });
    expect(mockValidateWorkPackage).toHaveBeenCalledTimes(1);
  });
});

describe("Pipeline clarification message — uses validationResult.clarificationMessage", () => {
  beforeEach(() => {
    mockResolveEvidence.mockClear();
    mockValidateWorkPackage.mockClear();
    mockResolveEvidence.mockResolvedValue(null);
  });

  it("returns awaiting_clarification with structured message when validation fails", async () => {
    mockValidateWorkPackage.mockReturnValueOnce({
      passed: false,
      issues: [{ rule: "policy_present", level: "error", message: "Policy required" }],
      missingItems: ["Organisation Policy"],
      conflictingItems: [],
      recommendedAction: "request_information",
      summary: "1 required item(s) missing.",
      missingEvidenceItems: [{
        canonicalType: "policy",
        displayLabel: "Organisation Policy",
        required: true,
        reason: "Policy required",
        searched: true,
        searchOutcome: "not_found",
        suggestedAction: "upload_document",
      }],
      evidenceSearched: true,
      clarificationMessage: "I searched your approved Organisation Library but could not locate a current Organisation Policy required for this work.",
    });

    const { executeWork } = await import("../services/workExecutionPipelineService.js");
    const result = await executeWork({ organizationId: "org-1", requesterId: "user-1", requesterRole: "administrator", userRequest: "Write policy review" });

    expect(result.outcome).toBe("awaiting_clarification");
    // Message should come from clarificationMessage (evidence-aware), not a generic template
    expect(result.message).toContain("Organisation Library");
    expect(result.message).toContain("Organisation Policy");
    // clarificationQuestions built from display labels
    expect(result.clarificationQuestions).toBeDefined();
    expect(result.clarificationQuestions!.length).toBeGreaterThan(0);
    expect(result.clarificationQuestions![0]).toContain("Organisation Policy");
  });

  it("clarificationQuestions never contain raw type codes", async () => {
    mockValidateWorkPackage.mockReturnValueOnce({
      passed: false,
      issues: [{ rule: "policy_present", level: "error", message: "Policy required" }],
      missingItems: ["Organisation Policy", "Risk Assessment"],
      conflictingItems: [],
      recommendedAction: "request_information",
      summary: "Items missing.",
      missingEvidenceItems: [
        { canonicalType: "policy",          displayLabel: "Organisation Policy", required: true,
          reason: "...", searched: true, searchOutcome: "not_found", suggestedAction: "upload_document" },
        { canonicalType: "risk_assessment", displayLabel: "Risk Assessment",     required: true,
          reason: "...", searched: true, searchOutcome: "not_found", suggestedAction: "upload_document" },
      ],
      evidenceSearched: true,
      clarificationMessage: "Searched but could not find required documents.",
    });

    const { executeWork } = await import("../services/workExecutionPipelineService.js");
    const result = await executeWork({ organizationId: "org-1", requesterId: "user-1", requesterRole: "administrator", userRequest: "Write review" });

    expect(result.outcome).toBe("awaiting_clarification");
    const rawCodes = ["policy", "risk_assessment", "legislation", "standards"];
    for (const q of result.clarificationQuestions ?? []) {
      for (const code of rawCodes) {
        // Should not contain bare snake_case codes
        expect(q).not.toMatch(new RegExp(`\\b${code}\\b`));
      }
    }
  });
});

// ─── Stage label compliance ───────────────────────────────────────────────────

describe("Pipeline stage labels — retrieving_evidence", () => {
  it("EXECUTION_STAGE_LABELS includes retrieving_evidence stage", async () => {
    const { EXECUTION_STAGE_LABELS } = await import("../services/workExecutionPipelineService.js");
    expect("retrieving_evidence" in EXECUTION_STAGE_LABELS).toBe(true);
    const label = (EXECUTION_STAGE_LABELS as Record<string, string>)["retrieving_evidence"];
    expect(label).toBeTruthy();
  });

  it("retrieving_evidence label is human-readable (no internal jargon)", async () => {
    const { EXECUTION_STAGE_LABELS } = await import("../services/workExecutionPipelineService.js");
    const label = (EXECUTION_STAGE_LABELS as Record<string, string>)["retrieving_evidence"]!;
    const forbidden = ["resolve", "evidence_pack", "retrieval_service", "knowledge_resolution"];
    for (const term of forbidden) {
      expect(label.toLowerCase()).not.toContain(term);
    }
  });

  it("all stage labels avoid internal technical terms", async () => {
    const { EXECUTION_STAGE_LABELS } = await import("../services/workExecutionPipelineService.js");
    const forbidden = ["manifest", "pipeline", "intent", "openclaw", "package_version", "executor"];
    for (const [stage, label] of Object.entries(EXECUTION_STAGE_LABELS)) {
      for (const term of forbidden) {
        expect(
          (label as string).toLowerCase(),
          `Stage "${stage}" label "${label}" must not contain "${term}"`,
        ).not.toContain(term);
      }
    }
  });
});
