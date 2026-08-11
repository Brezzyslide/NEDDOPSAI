/**
 * Sprint 29M — UEE Lane Enforcement Integration Tests
 *
 * Tests the ACTUAL UnifiedExecutionEngine behavior for the two Sprint 29M
 * execution-lane overrides. Uses the same mock infrastructure as sprint29i
 * (real UEE constructed with a mock ResourceRegistry).
 *
 * Scenarios:
 *   A — Evidence gate (laneContext.requiresEvidence=true):
 *       A1: evidence retrieval returns null  → execution_failed, createDraft NOT called
 *       A2: evidence pack has 0 chunks        → execution_failed, createDraft NOT called
 *       A3: valid evidence returned           → execution proceeds, createDraft IS called
 *
 *   B — Approval override (laneContext.requiresApproval=true):
 *       B1: outputRequiresApproval=false + laneContext.requiresApproval=true → submitForApproval IS called
 *       B2: no laneContext + outputRequiresApproval=false → submitForApproval NOT called (baseline)
 *       B3: laneContext.requiresApproval=false + outputRequiresApproval=false → submitForApproval NOT called
 *
 *   C — Non-EVIDENCE_BEARING lane is unaffected:
 *       C1: laneContext.requiresEvidence=false + null evidence → execution proceeds (best-effort)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "crypto";

// ─── Hoisted mock functions ───────────────────────────────────────────────────

const {
  mockDbSelect,
  mockDbInsert,
  mockSelectBlueprint,
  mockAssembleWorkPackage,
  mockValidateWorkPackage,
  mockReviewDraft,
  mockCreateDraft,
  mockSubmitForApproval,
  mockLogOrgEvent,
  mockGatewayProcess,
  mockOpenSession,
  mockCloseSession,
  mockMarkSessionError,
  mockRecordProviderState,
  mockBuildSystemInstruction,
  mockCaptureVersions,
  mockResolveEvidenceForTask,
  mockParseExecutionActions,
  mockValidateExecutionActions,
  mockExtractWriteTargets,
  mockGetSpecialistByCode,
} = vi.hoisted(() => {
  const mockDbSelect = vi.fn();
  const mockDbInsert = vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });

  return {
    mockDbSelect,
    mockDbInsert,
    mockSelectBlueprint:           vi.fn(),
    mockAssembleWorkPackage:       vi.fn(),
    mockValidateWorkPackage:       vi.fn(),
    mockReviewDraft:               vi.fn(),
    mockCreateDraft:               vi.fn(),
    mockSubmitForApproval:         vi.fn(),
    mockLogOrgEvent:               vi.fn().mockResolvedValue(undefined),
    mockGatewayProcess:            vi.fn(),
    mockOpenSession:               vi.fn().mockReturnValue({ sessionId: "sess-001" }),
    mockCloseSession:              vi.fn().mockReturnValue({ sessionId: "sess-001" }),
    mockMarkSessionError:          vi.fn().mockReturnValue({ sessionId: "sess-001" }),
    mockRecordProviderState:       vi.fn().mockReturnValue({ sessionId: "sess-001" }),
    mockBuildSystemInstruction:    vi.fn().mockReturnValue("System instruction"),
    mockCaptureVersions:           vi.fn().mockReturnValue({ dnaVersion: "1.0.0", workerProfileVersion: "1.0.0", capabilityVersion: "1.0.0", reasoningVersion: "1.0.0", outputSchemaVersion: "1.0.0", modelVersion: "gpt-4o" }),
    mockResolveEvidenceForTask:    vi.fn(),
    mockParseExecutionActions:     vi.fn().mockReturnValue([]),
    mockValidateExecutionActions:  vi.fn().mockReturnValue({ valid: true, blockedActions: [] }),
    mockExtractWriteTargets:       vi.fn().mockReturnValue([]),
    mockGetSpecialistByCode:       vi.fn(),
  };
});

// ─── Module mocks ─────────────────────────────────────────────────────────────

function makeSelectChain(result: unknown[]) {
  const limitFn  = vi.fn().mockResolvedValue(result);
  const whereFn  = vi.fn().mockReturnValue(
    Object.assign(Promise.resolve(result), { limit: limitFn, orderBy: vi.fn().mockReturnValue({ limit: limitFn }) }),
  );
  return { from: vi.fn().mockReturnValue({ where: whereFn }), where: whereFn };
}

vi.mock("@workspace/db", () => {
  mockDbSelect.mockImplementation(() => makeSelectChain([]));
  return {
    db:                              { select: mockDbSelect, insert: mockDbInsert },
    specialistRunsTable:             { id: "id", organizationId: "organization_id", createdAt: "created_at" },
    taskExecutionPlansTable:         { taskId: "task_id", organizationId: "organization_id", createdAt: "created_at" },
    knowledgeChunksTable:            { id: "id", organizationId: "organization_id" },
    knowledgeSourcesTable:           { id: "id", organizationId: "organization_id" },
    knowledgeSourceVersionsTable:    { id: "id" },
    retrievalAuditEventsTable:       { id: "id" },
    organisationMemoryTable:         { id: "id" },
    workBlueprintsTable:             { id: "id", code: "code" },
  };
});

vi.mock("@workspace/ai-gateway", () => ({
  createAIGateway: () => ({
    process:                 mockGatewayProcess,
    validateRetrievedFields: vi.fn(),
  }),
  AIGatewayDataError: class extends Error {},
}));

vi.mock("@workspace/workforce-dna", () => ({
  buildSystemInstructionForEmployee: mockBuildSystemInstruction,
  buildDNASystemInstruction:         vi.fn().mockReturnValue(""),
  captureSpecialistRunVersions:      mockCaptureVersions,
}));

vi.mock("../lib/workforceRegistry.js", () => ({
  getSpecialistByCode: mockGetSpecialistByCode,
}));

vi.mock("../services/workBlueprintService.js", () => ({
  selectBlueprint:      mockSelectBlueprint,
  getBlueprintById:     vi.fn(),
  getBlueprintSections: vi.fn().mockResolvedValue([]),
}));

vi.mock("../services/workPackageService.js", () => ({
  assembleWorkPackage:         mockAssembleWorkPackage,
  updateManifestObservability: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../services/workValidationService.js", () => ({
  validateWorkPackage: mockValidateWorkPackage,
}));

vi.mock("../services/approvedExampleService.js", () => ({
  retrieveApprovedExamples: vi.fn().mockResolvedValue([]),
  buildStyleGuidance:       vi.fn().mockReturnValue(""),
}));

vi.mock("../services/selfReviewService.js", () => ({
  reviewDraft: mockReviewDraft,
}));

vi.mock("../services/completedWorkService.js", () => ({
  createDraft:       mockCreateDraft,
  submitForApproval: mockSubmitForApproval,
}));

vi.mock("../services/auditService.js", () => ({
  logOrgEvent: mockLogOrgEvent,
}));

vi.mock("../lib/resources/ResourceRegistry.js", () => ({
  createResourceRegistry: vi.fn(),
  ResourceRegistry:       vi.fn(),
}));

vi.mock("../lib/resources/ExecutionSession.js", () => ({
  openExecutionSession:  mockOpenSession,
  closeExecutionSession: mockCloseSession,
  markSessionError:      mockMarkSessionError,
  recordProviderState:   mockRecordProviderState,
}));

vi.mock("../services/executionContextBuilderService.js", () => ({
  buildExecutionContext: vi.fn(),
}));

vi.mock("../services/executionActionService.js", () => ({
  parseExecutionActions:    mockParseExecutionActions,
  validateExecutionActions: mockValidateExecutionActions,
  extractWriteTargets:      mockExtractWriteTargets,
}));

vi.mock("../services/writeTargetResolverService.js", () => ({
  mapConnectorCategoryToChannel: vi.fn(),
  mapExecutionChannelToSession:  vi.fn(),
}));

vi.mock("../services/hybridRetrievalService.js", () => ({
  retrieveChunks:        vi.fn().mockResolvedValue([]),
  computeFreshnessBonus: vi.fn().mockReturnValue(0),
  computeAuthorityBonus: vi.fn().mockReturnValue(0),
}));

vi.mock("../services/knowledgeResolutionService.js", () => ({
  buildEvidenceSection:        vi.fn().mockReturnValue("Evidence section"),
  resolveConversationEvidence: vi.fn().mockResolvedValue(null),
}));

// ─── Import UEE after all mocks ───────────────────────────────────────────────

import { UnifiedExecutionEngine, type ExecutionLaneContext } from "../services/unifiedExecutionEngine.js";

// ─── Test data ────────────────────────────────────────────────────────────────

const ORG_ID   = randomUUID();
const USER_ID  = randomUUID();
const TASK_ID  = randomUUID();
const EXEC_ID  = randomUUID();
const DRAFT_ID = randomUUID();

const EVIDENCE_BEARING_LANE: ExecutionLaneContext = {
  executionClass:         "evidence_bearing",
  requiresCompletedWork:  true,
  requiresEvidence:       true,
  requiresClaimIntegrity: true,
  requiresApproval:       true,
};

const PROFESSIONAL_LANE: ExecutionLaneContext = {
  executionClass:         "professional_work",
  requiresCompletedWork:  true,
  requiresEvidence:       false,
  requiresClaimIntegrity: false,
  requiresApproval:       true,
};

function makePlan(primarySpecialist = "operations_manager") {
  return {
    id:             randomUUID(),
    taskId:         TASK_ID,
    organizationId: ORG_ID,
    version:        "1",
    createdAt:      new Date(),
    planData: {
      primarySpecialist,
      intent:        "review_policy",
      confidence:    0.92,
      blueprintCode: "policy_review",
      steps:         ["Analyse", "Report"],
    },
  };
}

function makeManifest(primarySpecialist = "operations_manager") {
  return {
    id:                         randomUUID(),
    manifestId:                 randomUUID(),
    executionId:                EXEC_ID,
    primarySpecialist,
    workforceRoleCode:          primarySpecialist,
    systemInstruction:          "Review the policy.",
    outputSpec:                 { format: "report" },
    cosMemories:                [],
    organisationLibrarySources: [],
    taskUploads:                [],
    librarySource:              [],
    memories:                   [],
    entityKnowledge:            {},
    title:                      "Policy Review",
    userRequest:                "Review the leave policy for compliance gaps.",
    outputTypes:                ["report"],
    requiredLibraryKnowledge:   [],
    mandatoryCitations:         [],
    successCriteria:            [],
  };
}

function makeEvidencePack(chunks = 2) {
  return {
    executionId:      EXEC_ID,
    organisationId:   ORG_ID,
    totalChunks:      chunks,
    sourceIds:        chunks > 0 ? ["src-1"] : [],
    chunks:           chunks > 0 ? [{ chunkId: "c-1", sourceId: "src-1", confidence: 0.9, text: "Policy body.", citation: "§3.1", selectionReason: "relevant" }] : [],
    evidenceSection:  chunks > 0 ? "AUTHORITATIVE EVIDENCE\n---\nPolicy body." : "",
    retrievalMetrics: { retrievalMs: 42, chunkCount: chunks, tokenCount: 120 },
  };
}

function makeRequest(overrides: Record<string, unknown> = {}) {
  return {
    trigger:        "task" as const,
    organisationId: ORG_ID,
    requesterId:    USER_ID,
    requesterRole:  "administrator",
    userRequest:    "Review our leave policy for compliance gaps.",
    taskId:         TASK_ID,
    correlationId:  randomUUID(),
    ...overrides,
  };
}

function makeEngine() {
  const mockRegistry = {
    resolveEvidenceForTask:         mockResolveEvidenceForTask,
    resolveEvidenceForConversation: vi.fn().mockResolvedValue(null),
    getProvider:                    vi.fn().mockReturnValue(null),
    scanAll:                        vi.fn().mockResolvedValue([]),
    getReadiness:                   vi.fn().mockResolvedValue({ ready: false }),
  };
  return new UnifiedExecutionEngine(mockRegistry as any);
}

function setupHappyPathMocks(blueprintEvidenceMode: "none" | "optional" | "required" = "none") {
  // The plan is present so the specialist readiness check passes
  mockDbSelect.mockImplementationOnce(() =>
    makeSelectChain([makePlan("operations_manager")]),
  );
  mockGetSpecialistByCode.mockReturnValue({ executionStatus: "available", dnaStatus: "active" });

  mockSelectBlueprint.mockResolvedValue({
    blueprint: {
      id:                       randomUUID(),
      code:                     "policy_review",
      title:                    "Policy Review",
      version:                  "1.0",
      objective:                "Review policy for compliance.",
      primarySpecialist:        "operations_manager",
      supportingSpecialists:    [],
      // Sprint 29M: use blueprintEvidenceMode to control the blueprint-level evidence gate
      // "none" → mandatoryCitations=[], outputTypes=['report'] → classifyEvidenceMode → "none"
      // "required" → mandatoryCitations=['NDIS'] → "required"
      outputTypes:              blueprintEvidenceMode === "required" ? ["incident_report"] : ["report"],
      requiredLibraryKnowledge: [],
      mandatoryCitations:       blueprintEvidenceMode === "required" ? ["NDIS Practice Standards"] : [],
      successCriteria:          [],
      status:                   "active" as const,
      organizationId:           null,
      createdAt:                new Date(),
      updatedAt:                new Date(),
    },
    confidence:      0.93,
    matchedKeywords: ["policy"],
    fallbackUsed:    false,
  });

  mockAssembleWorkPackage.mockResolvedValue({ manifest: makeManifest("operations_manager") });
  mockValidateWorkPackage.mockReturnValue({ passed: true, missingItems: [], issues: [], summary: "OK" });
  mockGatewayProcess.mockResolvedValue({
    content: JSON.stringify({
      summary: "Policy reviewed.",
      findings: [],
      recommendations: [],
      risks: [],
      assumptions: [],
      unresolvedQuestions: [],
      requestedExternalActions: [],
      expectedOutputs: [],
      confidence: 0.9,
      completedAt: new Date().toISOString(),
    }),
    promptTokens: 100, completionTokens: 200, totalTokens: 300, modelVersion: "gpt-4o",
  });
  mockReviewDraft.mockResolvedValue({
    passed: true, overallScore: 83, dimensions: [], qualityScore: 83,
    finalContent: "# Policy Review\n\nContent here.",
  });
  mockCreateDraft.mockResolvedValue({
    id: DRAFT_ID,
    version: { id: randomUUID(), versionNumber: 1 },
    currentVersionId: randomUUID(),
  });
  mockSubmitForApproval.mockResolvedValue({ id: DRAFT_ID, status: "awaiting_approval" });
}

// ─── Section A: Evidence gate ─────────────────────────────────────────────────

describe("A — UEE evidence gate (laneContext.requiresEvidence=true)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbInsert.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
    mockDbSelect.mockImplementation(() => makeSelectChain([]));
    // Reset session mocks to return an object (not undefined)
    mockOpenSession.mockReturnValue({ sessionId: "sess-001" });
    mockCloseSession.mockReturnValue({ sessionId: "sess-001" });
    mockMarkSessionError.mockReturnValue({ sessionId: "sess-001" });
    mockRecordProviderState.mockReturnValue({ sessionId: "sess-001" });
  });

  it("A1: evidence retrieval returns null → outcome=execution_failed, createDraft NOT called", async () => {
    setupHappyPathMocks("none"); // blueprint declares no evidence requirement
    mockResolveEvidenceForTask.mockResolvedValue(null); // retrieval fails

    const engine = makeEngine();
    const result = await engine.execute(makeRequest({
      laneContext: EVIDENCE_BEARING_LANE,
    }));

    expect(result.trigger).toBe("task");
    if (result.trigger === "task") {
      expect(result.workResult.outcome).toBe("execution_failed");
      // Message comes from buildInsufficientEvidenceMessage (Sprint 29N.6 upgrade)
      expect(result.workResult.message).toContain("evidence");
      expect(result.workResult.message).toContain("Knowledge Library");
    }
    expect(mockCreateDraft).not.toHaveBeenCalled();
  });

  it("A2: evidence pack has 0 chunks → outcome=execution_failed, createDraft NOT called", async () => {
    setupHappyPathMocks("none");
    mockResolveEvidenceForTask.mockResolvedValue(makeEvidencePack(0)); // 0 chunks

    const engine = makeEngine();
    const result = await engine.execute(makeRequest({
      laneContext: EVIDENCE_BEARING_LANE,
    }));

    expect(result.trigger).toBe("task");
    if (result.trigger === "task") {
      expect(result.workResult.outcome).toBe("execution_failed");
      expect(result.workResult.message).toContain("evidence");
      expect(result.workResult.message).toContain("Knowledge Library");
    }
    expect(mockCreateDraft).not.toHaveBeenCalled();
  });

  it("A3: valid evidence returned → execution proceeds past the gate, createDraft IS called", async () => {
    setupHappyPathMocks("none");
    // Override the evidence mock set by setupHappyPathMocks
    mockResolveEvidenceForTask.mockResolvedValue(makeEvidencePack(2)); // 2 chunks

    const engine = makeEngine();
    const result = await engine.execute(makeRequest({
      laneContext: EVIDENCE_BEARING_LANE,
    }));

    // Should NOT be blocked — should proceed to create a draft
    expect(result.trigger).toBe("task");
    if (result.trigger === "task") {
      expect(result.workResult.outcome).not.toBe("execution_failed");
    }
    expect(mockCreateDraft).toHaveBeenCalledOnce();
  });

  it("A4: laneContext absent, evidence null → execution proceeds (existing best-effort behavior unchanged)", async () => {
    setupHappyPathMocks("none");
    mockResolveEvidenceForTask.mockResolvedValue(null); // null but no laneContext requirement

    const engine = makeEngine();
    const result = await engine.execute(makeRequest({
      // No laneContext — falls back to best-effort evidence
    }));

    // Gate should NOT fire — execution proceeds regardless
    expect(result.trigger).toBe("task");
    if (result.trigger === "task") {
      expect(result.workResult.outcome).not.toBe("execution_failed");
    }
  });
});

// ─── Section B: Approval override ─────────────────────────────────────────────

describe("B — UEE approval override (laneContext.requiresApproval=true blocks opt-out)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbInsert.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
    mockDbSelect.mockImplementation(() => makeSelectChain([]));
    mockOpenSession.mockReturnValue({ sessionId: "sess-001" });
    mockCloseSession.mockReturnValue({ sessionId: "sess-001" });
    mockMarkSessionError.mockReturnValue({ sessionId: "sess-001" });
    mockRecordProviderState.mockReturnValue({ sessionId: "sess-001" });
  });

  it("B1: laneContext.requiresApproval=true, outputRequiresApproval=false → submitForApproval IS called", async () => {
    setupHappyPathMocks("none");
    mockResolveEvidenceForTask.mockResolvedValue(makeEvidencePack(2));

    const engine = makeEngine();
    await engine.execute(makeRequest({
      laneContext:          EVIDENCE_BEARING_LANE, // requiresApproval: true
      outputRequiresApproval: false,               // caller tries to opt out
    }));

    // The lane override must force approval even though caller passed false
    expect(mockSubmitForApproval).toHaveBeenCalledOnce();
  });

  it("B2: no laneContext, outputRequiresApproval=false → submitForApproval NOT called (opt-out honoured)", async () => {
    setupHappyPathMocks("none");
    mockResolveEvidenceForTask.mockResolvedValue(makeEvidencePack(2));

    const engine = makeEngine();
    await engine.execute(makeRequest({
      // No laneContext
      outputRequiresApproval: false, // should be respected
    }));

    expect(mockSubmitForApproval).not.toHaveBeenCalled();
  });

  it("B3: laneContext.requiresApproval=false, outputRequiresApproval=false → submitForApproval NOT called", async () => {
    setupHappyPathMocks("none");
    mockResolveEvidenceForTask.mockResolvedValue(makeEvidencePack(2));

    const engine = makeEngine();
    await engine.execute(makeRequest({
      laneContext: { ...PROFESSIONAL_LANE, requiresApproval: false },
      outputRequiresApproval: false,
    }));

    expect(mockSubmitForApproval).not.toHaveBeenCalled();
  });

  it("B4: laneContext.requiresApproval=true, no outputRequiresApproval → submitForApproval IS called (default=true)", async () => {
    setupHappyPathMocks("none");
    mockResolveEvidenceForTask.mockResolvedValue(makeEvidencePack(2));

    const engine = makeEngine();
    await engine.execute(makeRequest({
      laneContext: EVIDENCE_BEARING_LANE,
      // outputRequiresApproval not set — defaults to true
    }));

    expect(mockSubmitForApproval).toHaveBeenCalledOnce();
  });
});

// ─── Section C: Non-evidence lane unaffected ──────────────────────────────────

describe("C — PROFESSIONAL_WORK lane: evidence gate does not fire (best-effort unchanged)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbInsert.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
    mockDbSelect.mockImplementation(() => makeSelectChain([]));
    mockOpenSession.mockReturnValue({ sessionId: "sess-001" });
    mockCloseSession.mockReturnValue({ sessionId: "sess-001" });
    mockMarkSessionError.mockReturnValue({ sessionId: "sess-001" });
    mockRecordProviderState.mockReturnValue({ sessionId: "sess-001" });
  });

  it("C1: PROFESSIONAL_WORK with null evidence → gate does not fire, execution continues", async () => {
    setupHappyPathMocks("none");
    mockResolveEvidenceForTask.mockResolvedValue(null); // null evidence

    const engine = makeEngine();
    const result = await engine.execute(makeRequest({
      laneContext: PROFESSIONAL_LANE, // requiresEvidence: false
    }));

    // Gate must NOT fire for professional_work even when evidence is null
    expect(result.trigger).toBe("task");
    if (result.trigger === "task") {
      expect(result.workResult.outcome).not.toBe("execution_failed");
    }
  });

  it("C2: no laneContext with null evidence → gate does not fire (backward compatibility)", async () => {
    setupHappyPathMocks("none");
    mockResolveEvidenceForTask.mockResolvedValue(null);

    const engine = makeEngine();
    const result = await engine.execute(makeRequest());

    expect(result.trigger).toBe("task");
    if (result.trigger === "task") {
      expect(result.workResult.outcome).not.toBe("execution_failed");
    }
  });
});
