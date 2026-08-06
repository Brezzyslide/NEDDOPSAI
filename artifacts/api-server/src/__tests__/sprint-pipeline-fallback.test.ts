/**
 * Sprint: Completed Work Version Persistence Fix — Pipeline fallback handling
 *
 * Tests the executeWork pipeline behaviour when the AI provider is absent.
 * Covers:
 * 1. configuration_failure when AI_PROVIDER is not set
 * 2. configuration_failure when AI_PROVIDER=internal
 * 3. createDraft is never called when fallback fires
 * 4. configuration_failure when gateway returns usedFallback=true
 * 5. completed when AI_PROVIDER=openai and gateway returns real content
 * 6. Medication-policy regression: library evidence present + AI = completed, version 1 created
 * 7. Medication-policy regression: library evidence present + no AI = configuration_failure, no draft saved
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Hoisted mocks ────────────────────────────────────────────────────────────
const { mockDb } = vi.hoisted(() => {
  const txInsertChain = { values: vi.fn().mockResolvedValue([]) };
  const mockTx = vi.fn().mockImplementation(
    async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ insert: (_t: unknown) => txInsertChain }),
  );
  const insertChain = { values: vi.fn().mockResolvedValue([]) };
  const updateChain = { set: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([]) };
  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    orderBy: vi.fn().mockReturnThis(),
    offset: vi.fn().mockReturnThis(),
  };
  const mockDb = {
    insert: vi.fn().mockReturnValue(insertChain),
    update: vi.fn().mockReturnValue(updateChain),
    select: vi.fn().mockReturnValue(selectChain),
    transaction: mockTx,
  };
  return { mockDb };
});

vi.mock("@workspace/db", () => ({
  db: mockDb,
  completedWorkTable: { $inferSelect: {} },
  completedWorkVersionsTable: {},
  completedWorkCommentsTable: {},
  completedWorkAssetsTable: {},
  workPackageManifestsTable: {},
  knowledgeSourcesTable: {},
  COMPLETED_WORK_STATUSES: ["draft", "awaiting_approval", "approved", "rejected", "archived", "superseded", "reopened"],
  eq: vi.fn((_c: unknown, v: unknown) => v),
  and: vi.fn((...a: unknown[]) => a),
  desc: vi.fn((c: unknown) => c),
}));

vi.mock("../services/auditService.js", () => ({
  logOrgEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@workspace/ai-gateway", () => ({
  createAIGateway: vi.fn(),
}));

vi.mock("../services/workBlueprintService.js", () => ({
  selectBlueprint: vi.fn(),
  getBlueprintById: vi.fn(),
}));

vi.mock("../services/workPackageService.js", () => ({
  assembleWorkPackage: vi.fn(),
  updateManifestObservability: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../services/workValidationService.js", () => ({
  validateWorkPackage: vi.fn(),
}));

vi.mock("../services/approvedExampleService.js", () => ({
  retrieveApprovedExamples: vi.fn().mockResolvedValue([]),
  buildStyleGuidance: vi.fn().mockResolvedValue({ guidanceBlock: "" }),
}));

vi.mock("../services/selfReviewService.js", () => ({
  reviewDraft: vi.fn(),
}));

vi.mock("../services/completedWorkService.js", () => ({
  createDraft: vi.fn(),
}));

vi.mock("../services/knowledgeResolutionService.js", () => ({
  resolveEvidence: vi.fn().mockResolvedValue(null),
  buildEvidenceSection: vi.fn().mockReturnValue(""),
  buildCitationSummary: vi.fn().mockReturnValue(""),
}));

vi.mock("@workspace/workforce-dna", () => ({
  buildSystemInstructionForEmployee: vi.fn().mockReturnValue("You are a specialist."),
}));

// ─── Imports after mocks ──────────────────────────────────────────────────────

import { executeWork, FallbackDraftError } from "../services/workExecutionPipelineService.js";
import { createAIGateway } from "@workspace/ai-gateway";
import { createDraft } from "../services/completedWorkService.js";
import { reviewDraft } from "../services/selfReviewService.js";
import { selectBlueprint } from "../services/workBlueprintService.js";
import { assembleWorkPackage } from "../services/workPackageService.js";
import { validateWorkPackage } from "../services/workValidationService.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ORG_ID = "org-fallback-001";
const USER_ID = "user-fallback-001";

/** BlueprintSelectionResult shape the pipeline actually reads from selectBlueprint */
function blueprintSelection(bp: unknown) {
  return {
    blueprint: bp,
    confidence: 1.0,
    matchedKeywords: ["policy"],
    fallbackUsed: false,
  };
}

function makeBlueprint() {
  return {
    id: "bp-001",
    code: "policy_review",
    title: "Policy Review",
    objective: "Review a policy document through an operational lens",
    outputTypes: ["policy_draft"],
    successCriteria: ["Legal obligations met", "Responsibilities clear", "Review schedule included"],
    requiredLibraryKnowledge: ["policy"],
    requiredMemories: [],
    mandatoryCitations: ["legislation", "standards"],
    requiredApprovals: {},
    qualityRules: [],
  };
}

function makeManifest(libSources: unknown[] = []) {
  return {
    manifest: {
      id: "manifest-001",
      primarySpecialist: "operations_manager",
      taskId: "task-001",
      organizationId: ORG_ID,
      organisationLibrarySources: libSources,
      taskUploads: [],
      cosMemories: [],
      entityKnowledge: null,
      selectionMetadata: null,
    },
    excludedSources: [],
  };
}

function validationPassed() {
  return {
    passed: true,
    missingItems: [],
    missingEvidenceItems: [],
    summary: "OK",
    clarificationMessage: "",
  };
}

function makeReviewResult(content = "Real AI content.") {
  return {
    qualityScore: 82,
    dimensions: [],
    passed: true,
    improvementFeedback: [],
    revised: false,
    finalContent: content,
    revisionLimitReached: false,
    evidenceSummaryHash: "abc123",
  };
}

function makeCompletedWork(id = "cw-001") {
  return {
    id,
    organizationId: ORG_ID,
    conversationId: null,
    blueprintId: "bp-001",
    manifestId: "manifest-001",
    primarySpecialist: "operations_manager",
    title: "Policy Review — ...",
    outputType: "policy_draft",
    status: "draft",
    currentVersionId: "ver-001",
    createdByUserId: USER_ID,
    approvedByUserId: null,
    approvedAt: null,
    rejectedAt: null,
    archivedAt: null,
    reopenedAt: null,
    supersededById: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

// ─── FallbackDraftError type ──────────────────────────────────────────────────

describe("FallbackDraftError", () => {
  it("is exported from the pipeline service", () => {
    expect(FallbackDraftError).toBeDefined();
    const err = new FallbackDraftError("test");
    expect(err.name).toBe("FallbackDraftError");
    expect(err.message).toBe("test");
    expect(err).toBeInstanceOf(Error);
  });
});

// ─── configuration_failure — AI provider absent ───────────────────────────────

describe("executeWork — configuration_failure when AI provider is absent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.AI_PROVIDER;

    vi.mocked(selectBlueprint).mockResolvedValue(blueprintSelection(makeBlueprint()) as never);
    vi.mocked(assembleWorkPackage).mockResolvedValue(makeManifest() as never);
    vi.mocked(validateWorkPackage).mockReturnValue(validationPassed() as never);
  });

  afterEach(() => {
    delete process.env.AI_PROVIDER;
  });

  it("returns configuration_failure when AI_PROVIDER is not set", async () => {
    const result = await executeWork({
      organizationId: ORG_ID,
      requesterId: USER_ID,
      requesterRole: "administrator",
      userRequest: "Review our Medication Management Policy through an operational lens.",
    });

    expect(result.outcome).toBe("configuration_failure");
    expect(result.message).toContain("AI_PROVIDER");
  });

  it("does NOT call createDraft when AI_PROVIDER is not set", async () => {
    await executeWork({
      organizationId: ORG_ID,
      requesterId: USER_ID,
      requesterRole: "administrator",
      userRequest: "Review Medication Management Policy.",
    });

    expect(vi.mocked(createDraft)).not.toHaveBeenCalled();
  });

  it("returns configuration_failure when AI_PROVIDER=internal", async () => {
    process.env.AI_PROVIDER = "internal";

    const result = await executeWork({
      organizationId: ORG_ID,
      requesterId: USER_ID,
      requesterRole: "administrator",
      userRequest: "Do work.",
    });

    expect(result.outcome).toBe("configuration_failure");
  });

  it("returns configuration_failure when gateway usedFallback=true", async () => {
    process.env.AI_PROVIDER = "openai";
    const mockGateway = { process: vi.fn().mockResolvedValue({ usedFallback: true, content: null }) };
    vi.mocked(createAIGateway).mockReturnValue(mockGateway as never);

    const result = await executeWork({
      organizationId: ORG_ID,
      requesterId: USER_ID,
      requesterRole: "administrator",
      userRequest: "Do work.",
    });

    expect(result.outcome).toBe("configuration_failure");
    expect(vi.mocked(createDraft)).not.toHaveBeenCalled();
  });

  it("returns configuration_failure when gateway returns empty content", async () => {
    process.env.AI_PROVIDER = "openai";
    const mockGateway = { process: vi.fn().mockResolvedValue({ usedFallback: false, content: "" }) };
    vi.mocked(createAIGateway).mockReturnValue(mockGateway as never);

    const result = await executeWork({
      organizationId: ORG_ID,
      requesterId: USER_ID,
      requesterRole: "administrator",
      userRequest: "Do work.",
    });

    expect(result.outcome).toBe("configuration_failure");
    expect(vi.mocked(createDraft)).not.toHaveBeenCalled();
  });

  it("returns completed when AI_PROVIDER=openai and gateway returns real content", async () => {
    process.env.AI_PROVIDER = "openai";
    const mockGateway = {
      process: vi.fn().mockResolvedValue({
        usedFallback: false,
        content: "Real professional AI output about the medication policy.",
      }),
    };
    vi.mocked(createAIGateway).mockReturnValue(mockGateway as never);
    vi.mocked(reviewDraft).mockResolvedValue(makeReviewResult() as never);
    vi.mocked(createDraft).mockResolvedValue(makeCompletedWork() as never);

    const result = await executeWork({
      organizationId: ORG_ID,
      requesterId: USER_ID,
      requesterRole: "administrator",
      userRequest: "Review our Medication Management Policy through an operational lens.",
    });

    expect(result.outcome).toBe("completed");
    expect(result.completedWorkId).toBe("cw-001");
    expect(vi.mocked(createDraft)).toHaveBeenCalledOnce();
  });
});

// ─── Medication-policy regression ─────────────────────────────────────────────

describe("Medication-policy regression — approved indexed evidence", () => {
  const medicationPolicySource = {
    sourceId: "src-med-001",
    title: "Medication Management Policy",
    sourceType: "policy",
    versionLabel: "2.1",
    authorityLevel: "authoritative",
    relevantChunks: [
      { chunkId: "chunk-001", text: "Medication must be administered by a registered nurse.", confidence: 0.92 },
      { chunkId: "chunk-002", text: "All medication errors must be reported within 24 hours.", confidence: 0.88 },
    ],
  };

  const aiContent = `# Medication Management Policy — Operational Review

## Overview

This review examines the Medication Management Policy through an operational lens.

## Legal Obligations

Per the legislation and applicable standards, medication administration must comply with...

## Responsibilities

Staff responsibilities are clearly defined in line with current standards.

## Review Schedule

A quarterly review cycle is recommended.

## Sources Referenced

- Medication Management Policy v2.1 [authoritative]
`;

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(selectBlueprint).mockResolvedValue(
      blueprintSelection(makeBlueprint()) as never,
    );
    vi.mocked(assembleWorkPackage).mockResolvedValue(
      makeManifest([medicationPolicySource]) as never,
    );
    vi.mocked(validateWorkPackage).mockReturnValue(validationPassed() as never);
  });

  afterEach(() => {
    delete process.env.AI_PROVIDER;
  });

  it("creates version 1 successfully when library source has indexed chunks and AI is configured", async () => {
    process.env.AI_PROVIDER = "openai";
    const mockGateway = {
      process: vi.fn().mockResolvedValue({ usedFallback: false, content: aiContent }),
    };
    vi.mocked(createAIGateway).mockReturnValue(mockGateway as never);
    vi.mocked(reviewDraft).mockResolvedValue({ ...makeReviewResult(aiContent), qualityScore: 85 } as never);
    vi.mocked(createDraft).mockResolvedValue(makeCompletedWork("cw-med-001") as never);

    const result = await executeWork({
      organizationId: ORG_ID,
      requesterId: USER_ID,
      requesterRole: "administrator",
      userRequest: "Review our Medication Management Policy through an operational lens. Use the Operations Manager only.",
    });

    expect(result.outcome).toBe("completed");
    expect(result.completedWorkId).toBe("cw-med-001");
    expect(result.qualityScore).toBe(85);

    // Gateway must have been called exactly once (no fallback)
    expect(mockGateway.process).toHaveBeenCalledOnce();

    // createDraft must have been called with correct org and specialist
    const call = vi.mocked(createDraft).mock.calls[0]?.[0];
    expect(call).toBeDefined();
    expect(call!.organizationId).toBe(ORG_ID);
    expect(call!.primarySpecialist).toBe("operations_manager");
  });

  it("does not call createDraft when library source exists but AI_PROVIDER is missing", async () => {
    delete process.env.AI_PROVIDER;

    const result = await executeWork({
      organizationId: ORG_ID,
      requesterId: USER_ID,
      requesterRole: "administrator",
      userRequest: "Review our Medication Management Policy.",
    });

    expect(result.outcome).toBe("configuration_failure");
    expect(vi.mocked(createDraft)).not.toHaveBeenCalled();
    expect(result.message).toMatch(/AI_PROVIDER/);
  });

  it("gateway receives the library source in the work package", async () => {
    process.env.AI_PROVIDER = "openai";
    const mockGateway = {
      process: vi.fn().mockResolvedValue({ usedFallback: false, content: aiContent }),
    };
    vi.mocked(createAIGateway).mockReturnValue(mockGateway as never);
    vi.mocked(reviewDraft).mockResolvedValue(makeReviewResult(aiContent) as never);
    vi.mocked(createDraft).mockResolvedValue(makeCompletedWork() as never);

    await executeWork({
      organizationId: ORG_ID,
      requesterId: USER_ID,
      requesterRole: "administrator",
      userRequest: "Review our Medication Management Policy.",
    });

    // The gateway was called — verify the user message contains the source title
    const gatewayArgs = mockGateway.process.mock.calls[0]?.[0] as { userMessage?: string } | undefined;
    expect(gatewayArgs).toBeDefined();
    expect(gatewayArgs!.userMessage).toContain("Medication Management Policy");
  });
});
