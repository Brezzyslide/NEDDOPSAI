/**
 * Sprint 29B — Unified Execution Engine Tests
 *
 * Verifies the architectural refactor:
 *   1. ResourceRegistry routes evidence correctly
 *   2. ExecutionSession lifecycle types
 *   3. UnifiedExecutionEngine task path (all outcomes)
 *   4. UnifiedExecutionEngine conversation path (all outcomes)
 *   5. Backward compat: executeWork() and createSpecialistIntelligenceService() unchanged
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Module mocks ─────────────────────────────────────────────────────────────

const mockSelectBlueprint = vi.hoisted(() => vi.fn());
const mockGetBlueprintById = vi.hoisted(() => vi.fn());
const mockAssembleWorkPackage = vi.hoisted(() => vi.fn());
const mockUpdateManifestObservability = vi.hoisted(() => vi.fn());
const mockResolveEvidence = vi.hoisted(() => vi.fn());
const mockBuildEvidenceSection = vi.hoisted(() => vi.fn());
const mockValidateWorkPackage = vi.hoisted(() => vi.fn());
const mockRetrieveApprovedExamples = vi.hoisted(() => vi.fn());
const mockBuildStyleGuidance = vi.hoisted(() => vi.fn());
const mockReviewDraft = vi.hoisted(() => vi.fn());
const mockCreateDraft = vi.hoisted(() => vi.fn());
const mockLogOrgEvent = vi.hoisted(() => vi.fn());
const mockDbUpdate = vi.hoisted(() => vi.fn());
const mockDbSet = vi.hoisted(() => vi.fn());
const mockDbWhere = vi.hoisted(() => vi.fn());
const mockGatewayProcess = vi.hoisted(() => vi.fn());
const mockCreateAIGateway = vi.hoisted(() => vi.fn());
const mockBuildSystemInstructionForEmployee = vi.hoisted(() => vi.fn());
const mockBuildDNASystemInstruction = vi.hoisted(() => vi.fn());
const mockCaptureSpecialistRunVersions = vi.hoisted(() => vi.fn());

vi.mock("../services/workBlueprintService.js", () => ({
  selectBlueprint: mockSelectBlueprint,
  getBlueprintById: mockGetBlueprintById,
}));

vi.mock("../services/workPackageService.js", () => ({
  assembleWorkPackage: mockAssembleWorkPackage,
  updateManifestObservability: mockUpdateManifestObservability,
}));

vi.mock("../services/knowledgeResolutionService.js", () => ({
  resolveEvidence: mockResolveEvidence,
  buildEvidenceSection: mockBuildEvidenceSection,
  buildCitationSummary: vi.fn().mockReturnValue(""),
}));

vi.mock("../services/workValidationService.js", () => ({
  validateWorkPackage: mockValidateWorkPackage,
}));

vi.mock("../services/approvedExampleService.js", () => ({
  retrieveApprovedExamples: mockRetrieveApprovedExamples,
  buildStyleGuidance: mockBuildStyleGuidance,
}));

vi.mock("../services/selfReviewService.js", () => ({
  reviewDraft: mockReviewDraft,
}));

vi.mock("../services/completedWorkService.js", () => ({
  createDraft: mockCreateDraft,
}));

vi.mock("../services/auditService.js", () => ({
  logOrgEvent: mockLogOrgEvent,
}));

vi.mock("@workspace/db", () => ({
  db: {
    update: mockDbUpdate.mockReturnValue({
      set: mockDbSet.mockReturnValue({ where: mockDbWhere.mockResolvedValue(undefined) }),
    }),
  },
  specialistRunsTable: {},
  eq: vi.fn(),
}));

vi.mock("@workspace/ai-gateway", () => ({
  createAIGateway: mockCreateAIGateway.mockReturnValue({ process: mockGatewayProcess }),
}));

vi.mock("@workspace/workforce-dna", () => ({
  buildSystemInstructionForEmployee: mockBuildSystemInstructionForEmployee.mockReturnValue("System instruction"),
  buildDNASystemInstruction: mockBuildDNASystemInstruction.mockReturnValue("DNA system instruction"),
  captureSpecialistRunVersions: mockCaptureSpecialistRunVersions.mockReturnValue({
    dnaVersion: "1.0.0",
    workerProfileVersion: "1.0.0",
    capabilityVersion: "1.0.0",
    reasoningVersion: "1.0.0",
    outputSchemaVersion: "1.0.0",
    modelVersion: "gpt-4o",
  }),
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import {
  createUnifiedExecutionEngine,
  FallbackDraftError,
  EXECUTION_STAGE_LABELS,
  type ExecutionRequest,
} from "../services/unifiedExecutionEngine.js";
import { ResourceRegistry, createResourceRegistry } from "../lib/resources/ResourceRegistry.js";
import { createExecutionSession } from "../lib/resources/ExecutionSession.js";
import { executeWork } from "../services/workExecutionPipelineService.js";
import { createSpecialistIntelligenceService } from "../services/specialistIntelligenceService.js";

// ─── Test fixtures ────────────────────────────────────────────────────────────

const ORG_ID = "org-test-001";
const REQUESTER_ID = "user-test-001";

const mockBlueprint = {
  id: "bp-001",
  code: "incident_management",
  title: "Incident Management",
  objective: "Review and manage incident reports",
  outputTypes: ["incident_report"],
  successCriteria: ["Clear root cause identified"],
  mandatoryCitations: ["NDIS Practice Standards"],
  requiredLibraryKnowledge: [],
  mandatoryCitationSources: [],
  validationRules: [],
};

const mockManifest = {
  id: "manifest-001",
  organizationId: ORG_ID,
  executionId: "exec-001",
  primarySpecialist: "operations_manager",
  supportingSpecialists: [],
  organisationLibrarySources: [],
  taskUploads: [],
  cosMemories: [],
  entityKnowledge: {},
  taskUploadSourceIds: [],
};

const mockEvidencePack = {
  totalChunks: 3,
  chunks: [
    { sourceId: "src-001", citation: "[Policy, v1]", text: "Policy content", confidence: 0.9, sourceType: "policy" },
  ],
  citationsByType: { policy: ["[Policy, v1]"] },
  resolvedAt: new Date().toISOString(),
};

const mockReviewResult = {
  finalContent: "# Incident Report\n\nContent here.",
  qualityScore: 82,
  revised: false,
  dimensions: [],
};

const mockCompletedWork = { id: "cw-001", title: "Incident Management — test" };

const mockWorkPackage = {
  specialistRunId: "run-001",
  organizationId: ORG_ID,
  taskId: "task-001",
  capabilityCode: "incident_management",
  capabilityLevel: "execution" as const,
  workforceRoleCode: "operations_manager",
  workerProfileCode: "operations_manager",
  objective: "Review incident policy",
  responsibilities: ["Analyse incident report"],
  expectedOutputs: ["Completed incident report"],
  approvedOrganisationMemory: [],
  relevantConversationContext: [],
  taskContext: [],
  previousSpecialistOutputs: [],
  allowedCapabilities: [],
  allowedTools: [],
  allowedConnectorCategories: [],
  allowedExecutionChannels: [],
  prohibitedActions: [],
  approvalRequiredActions: [],
  dependencies: [],
  assumptions: [],
  unresolvedQuestions: [],
  riskLevel: "medium",
  expiresAt: new Date(Date.now() + 3600000).toISOString(),
};

const mockSpecialistContext = {
  taskScope: "Review incident policy",
  approvedMemory: [],
  pinnedDecisions: [],
  unresolvedQuestions: [],
  relevantMessages: [],
  previousOutputs: [],
  evidenceReferences: [],
  approvalState: "approved",
  executionEntitlementState: "entitled",
};

const validSpecialistResponse = JSON.stringify({
  specialistRunId: "run-001",
  workforceRoleCode: "operations_manager",
  capabilityCode: "incident_management",
  status: "completed",
  summary: "Analysis complete.",
  findings: [],
  recommendations: [],
  risks: [],
  assumptions: [],
  unresolvedQuestions: [],
  requestedExternalActions: [],
  expectedOutputs: [],
  confidence: 0.9,
  completedAt: new Date().toISOString(),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function setupTaskMocks() {
  mockSelectBlueprint.mockResolvedValue({
    blueprint: mockBlueprint,
    confidence: 0.95,
    matchedKeywords: ["incident"],
    fallbackUsed: false,
  });
  mockAssembleWorkPackage.mockResolvedValue({ manifest: mockManifest, excludedSources: [] });
  mockResolveEvidence.mockResolvedValue(mockEvidencePack);
  mockBuildEvidenceSection.mockReturnValue("=== AUTHORITATIVE EVIDENCE ===\nPolicy content");
  mockValidateWorkPackage.mockReturnValue({ passed: true, missingItems: [], summary: "OK" });
  mockRetrieveApprovedExamples.mockResolvedValue([]);
  mockBuildStyleGuidance.mockResolvedValue({ guidanceBlock: "" });
  mockGatewayProcess.mockResolvedValue({ content: "Draft content.", usedFallback: false });
  mockReviewDraft.mockResolvedValue(mockReviewResult);
  mockCreateDraft.mockResolvedValue(mockCompletedWork);
  mockUpdateManifestObservability.mockResolvedValue(undefined);
}

// ─── 1. ResourceRegistry ──────────────────────────────────────────────────────

describe("ResourceRegistry", () => {
  beforeEach(() => {
    mockResolveEvidence.mockResolvedValue(mockEvidencePack);
  });

  it("createResourceRegistry returns a ResourceRegistry instance", () => {
    const registry = createResourceRegistry();
    expect(registry).toBeInstanceOf(ResourceRegistry);
  });

  it("resolveEvidenceForTask delegates to knowledgeResolutionService", async () => {
    const registry = createResourceRegistry();
    const result = await registry.resolveEvidenceForTask({
      organisationId: ORG_ID,
      specialistCode: "operations_manager",
      blueprint: mockBlueprint as any,
      workPackage: mockManifest as any,
      userRequest: "Review incident policy",
    });
    expect(mockResolveEvidence).toHaveBeenCalledWith(
      expect.objectContaining({ organisationId: ORG_ID }),
    );
    expect(result).toEqual(mockEvidencePack);
  });

  it("resolveEvidenceForConversation returns null (future sprint placeholder)", async () => {
    const registry = createResourceRegistry();
    const result = await registry.resolveEvidenceForConversation({
      organisationId: ORG_ID,
      specialistRunId: "run-001",
    });
    expect(result).toBeNull();
  });

  it("register and getProvider work correctly", () => {
    const registry = createResourceRegistry();
    const fakeProvider = {
      providerCode: "connector" as const,
      priority: 6,
      isImplemented: false,
      isAvailable: async () => false,
      resolve: async () => [],
    };
    registry.register(fakeProvider);
    expect(registry.getProvider("connector")).toBe(fakeProvider);
  });

  it("getProvider returns undefined for unregistered code", () => {
    const registry = createResourceRegistry();
    expect(registry.getProvider("cloud")).toBeUndefined();
  });
});

// ─── 2. ExecutionSession ──────────────────────────────────────────────────────

describe("ExecutionSession", () => {
  it("createExecutionSession returns a session with idle status", () => {
    const session = createExecutionSession({
      executionId: "exec-001",
      organisationId: ORG_ID,
      allowedChannels: ["connector"],
      maxDurationSeconds: 600,
    });
    expect(session.status).toBe("idle");
    expect(session.executionId).toBe("exec-001");
    expect(session.allowedChannels).toEqual(["connector"]);
    expect(session.sessionId).toBeTruthy();
    expect(session.openedAt).toBeTruthy();
    expect(session.expiresAt).toBeTruthy();
  });

  it("expiresAt is set correctly from maxDurationSeconds", () => {
    const before = Date.now();
    const session = createExecutionSession({
      executionId: "exec-002",
      organisationId: ORG_ID,
      allowedChannels: [],
      maxDurationSeconds: 300,
    });
    const after = Date.now();
    const expiry = new Date(session.expiresAt).getTime();
    expect(expiry).toBeGreaterThanOrEqual(before + 300_000);
    expect(expiry).toBeLessThanOrEqual(after + 300_000);
  });
});

// ─── 3. UnifiedExecutionEngine — task path ────────────────────────────────────

describe("UnifiedExecutionEngine — task execution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AI_PROVIDER = "openai";
    setupTaskMocks();
  });

  it("creates engine instance from factory", () => {
    expect(createUnifiedExecutionEngine()).toBeDefined();
  });

  it("returns completed outcome with completedWorkId", async () => {
    const engine = createUnifiedExecutionEngine();
    const result = await engine.execute({
      trigger: "task",
      organisationId: ORG_ID,
      requesterId: REQUESTER_ID,
      requesterRole: "owner",
      userRequest: "Review our incident policy",
    });
    expect(result.trigger).toBe("task");
    if (result.trigger !== "task") return;
    expect(result.workResult.outcome).toBe("completed");
    expect(result.workResult.completedWorkId).toBe("cw-001");
  });

  it("returns execution_principal_missing when role is absent", async () => {
    const engine = createUnifiedExecutionEngine();
    const result = await engine.execute({
      trigger: "task",
      organisationId: ORG_ID,
      requesterId: REQUESTER_ID,
      userRequest: "Review incident policy",
    });
    if (result.trigger !== "task") return;
    expect(result.workResult.outcome).toBe("execution_principal_missing");
  });

  it("returns execution_principal_missing for disallowed role", async () => {
    const engine = createUnifiedExecutionEngine();
    const result = await engine.execute({
      trigger: "task",
      organisationId: ORG_ID,
      requesterId: REQUESTER_ID,
      requesterRole: "member",
      userRequest: "Review incident policy",
    });
    if (result.trigger !== "task") return;
    expect(result.workResult.outcome).toBe("execution_principal_missing");
  });

  it("returns awaiting_clarification when validation fails", async () => {
    mockValidateWorkPackage.mockReturnValueOnce({
      passed: false,
      missingItems: ["incident_policy"],
      missingEvidenceItems: [{ required: true, displayLabel: "incident_policy", reason: "Missing" }],
      summary: "Missing incident policy",
      clarificationMessage: "Please upload the incident policy.",
    });
    const engine = createUnifiedExecutionEngine();
    const result = await engine.execute({
      trigger: "task",
      organisationId: ORG_ID,
      requesterId: REQUESTER_ID,
      requesterRole: "owner",
      userRequest: "Review incident policy",
    });
    if (result.trigger !== "task") return;
    expect(result.workResult.outcome).toBe("awaiting_clarification");
    expect(result.workResult.clarificationQuestions).toBeDefined();
  });

  it("returns configuration_failure when AI_PROVIDER is not openai", async () => {
    process.env.AI_PROVIDER = "internal";
    const engine = createUnifiedExecutionEngine();
    const result = await engine.execute({
      trigger: "task",
      organisationId: ORG_ID,
      requesterId: REQUESTER_ID,
      requesterRole: "owner",
      userRequest: "Review incident policy",
    });
    if (result.trigger !== "task") return;
    expect(result.workResult.outcome).toBe("configuration_failure");
  });

  it("returns configuration_failure when gateway uses fallback", async () => {
    mockGatewayProcess.mockResolvedValueOnce({ content: null, usedFallback: true });
    const engine = createUnifiedExecutionEngine();
    const result = await engine.execute({
      trigger: "task",
      organisationId: ORG_ID,
      requesterId: REQUESTER_ID,
      requesterRole: "owner",
      userRequest: "Review incident policy",
    });
    if (result.trigger !== "task") return;
    expect(result.workResult.outcome).toBe("configuration_failure");
  });

  it("returns execution_failed when gateway throws non-fallback error", async () => {
    mockGatewayProcess.mockRejectedValueOnce(new Error("Network error"));
    const engine = createUnifiedExecutionEngine();
    const result = await engine.execute({
      trigger: "task",
      organisationId: ORG_ID,
      requesterId: REQUESTER_ID,
      requesterRole: "owner",
      userRequest: "Review incident policy",
    });
    if (result.trigger !== "task") return;
    expect(result.workResult.outcome).toBe("execution_failed");
  });

  it("resolves evidence via ResourceRegistry (calls knowledgeResolutionService)", async () => {
    const engine = createUnifiedExecutionEngine();
    await engine.execute({
      trigger: "task",
      organisationId: ORG_ID,
      requesterId: REQUESTER_ID,
      requesterRole: "owner",
      userRequest: "Review incident policy",
    });
    expect(mockResolveEvidence).toHaveBeenCalledWith(
      expect.objectContaining({ organisationId: ORG_ID }),
    );
  });

  it("uses blueprintId when provided directly", async () => {
    mockGetBlueprintById.mockResolvedValue(mockBlueprint);
    const engine = createUnifiedExecutionEngine();
    await engine.execute({
      trigger: "task",
      organisationId: ORG_ID,
      requesterId: REQUESTER_ID,
      requesterRole: "owner",
      userRequest: "Review incident policy",
      blueprintId: "bp-001",
    });
    expect(mockGetBlueprintById).toHaveBeenCalledWith("bp-001", ORG_ID);
    expect(mockSelectBlueprint).not.toHaveBeenCalled();
  });

  it("skips blueprint selection on checkpoint resume", async () => {
    const engine = createUnifiedExecutionEngine();
    await engine.execute({
      trigger: "task",
      organisationId: ORG_ID,
      requesterId: REQUESTER_ID,
      requesterRole: "owner",
      userRequest: "Review incident policy",
      checkpointData: {
        correlationId: "corr-001",
        blueprint: mockBlueprint as any,
        manifest: mockManifest as any,
        clarificationAnswer: "Here is the policy.",
      },
    });
    expect(mockSelectBlueprint).not.toHaveBeenCalled();
    expect(mockAssembleWorkPackage).not.toHaveBeenCalled();
  });

  it("invokes onProgress callbacks for each stage", async () => {
    const stages: string[] = [];
    const engine = createUnifiedExecutionEngine();
    await engine.execute({
      trigger: "task",
      organisationId: ORG_ID,
      requesterId: REQUESTER_ID,
      requesterRole: "owner",
      userRequest: "Review incident policy",
      onProgress: (stage) => { stages.push(stage); },
    });
    expect(stages).toContain("selecting_blueprint");
    expect(stages).toContain("retrieving_evidence");
    expect(stages).toContain("validating");
    expect(stages).toContain("executing");
    expect(stages).toContain("reviewing");
    expect(stages).toContain("creating_completed_work");
  });

  it("evidence retrieval failure does not abort the pipeline", async () => {
    mockResolveEvidence.mockRejectedValueOnce(new Error("DB timeout"));
    const engine = createUnifiedExecutionEngine();
    const result = await engine.execute({
      trigger: "task",
      organisationId: ORG_ID,
      requesterId: REQUESTER_ID,
      requesterRole: "owner",
      userRequest: "Review incident policy",
    });
    // Validation still runs (with null evidence pack)
    expect(mockValidateWorkPackage).toHaveBeenCalled();
  });

  it("EXECUTION_STAGE_LABELS contains all required stages", () => {
    const requiredStages = [
      "selecting_blueprint",
      "assembling_package",
      "retrieving_evidence",
      "validating",
      "retrieving_examples",
      "executing",
      "reviewing",
      "creating_completed_work",
    ] as const;
    for (const stage of requiredStages) {
      expect(EXECUTION_STAGE_LABELS[stage]).toBeTruthy();
    }
  });
});

// ─── 4. UnifiedExecutionEngine — conversation path ────────────────────────────

describe("UnifiedExecutionEngine — conversation execution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AI_PROVIDER = "openai";
    mockGatewayProcess.mockResolvedValue({ content: validSpecialistResponse, usedFallback: false, usage: { inputTokens: 100, outputTokens: 200 } });
    mockLogOrgEvent.mockResolvedValue(undefined);
    mockDbUpdate.mockReturnValue({ set: mockDbSet.mockReturnValue({ where: mockDbWhere.mockResolvedValue(undefined) }) });
  });

  it("returns conversation trigger and runResult for conversation requests", async () => {
    const engine = createUnifiedExecutionEngine();
    const result = await engine.execute({
      trigger: "conversation",
      organisationId: ORG_ID,
      requesterId: "system",
      requesterRole: "system",
      userRequest: "Review incident policy",
      specialistWorkPackage: mockWorkPackage,
      specialistContext: mockSpecialistContext,
      specialistRunId: "run-001",
    });
    expect(result.trigger).toBe("conversation");
    if (result.trigger !== "conversation") return;
    expect(result.runResult.status).toBe("completed");
    expect(result.runResult.specialistRunId).toBe("run-001");
    expect(result.runResult.workforceRoleCode).toBe("operations_manager");
  });

  it("returns blocked status for inactive specialist", async () => {
    const engine = createUnifiedExecutionEngine();
    const result = await engine.execute({
      trigger: "conversation",
      organisationId: ORG_ID,
      requesterId: "system",
      requesterRole: "system",
      userRequest: "Audit compliance",
      specialistWorkPackage: { ...mockWorkPackage, workforceRoleCode: "compliance_quality_manager" },
      specialistContext: mockSpecialistContext,
      specialistRunId: "run-002",
    });
    if (result.trigger !== "conversation") return;
    expect(result.runResult.status).toBe("blocked");
    // Sprint 29H Part H: UEE architectural guard now intercepts before intelligence check.
    // Previous message was "not yet activated" (from ACTIVE_SPECIALISTS check in eligibility
    // service). Guard now fires first with a clearer "cannot execute production work" message.
    expect(result.runResult.summary).toMatch(/cannot execute production work|not yet activated|blocked/i);
  });

  it("returns deterministic result when AI_PROVIDER is not openai", async () => {
    process.env.AI_PROVIDER = "internal";
    const engine = createUnifiedExecutionEngine();
    const result = await engine.execute({
      trigger: "conversation",
      organisationId: ORG_ID,
      requesterId: "system",
      requesterRole: "system",
      userRequest: "Review incident policy",
      specialistWorkPackage: mockWorkPackage,
      specialistContext: mockSpecialistContext,
      specialistRunId: "run-001",
    });
    if (result.trigger !== "conversation") return;
    expect(result.runResult.status).toBe("completed");
    expect(result.runResult.modelProvider).toBe("internal");
  });

  it("uses additionalInstruction for revise/resume flows", async () => {
    const engine = createUnifiedExecutionEngine();
    await engine.execute({
      trigger: "conversation",
      organisationId: ORG_ID,
      requesterId: "system",
      requesterRole: "system",
      userRequest: "Review incident policy",
      specialistWorkPackage: mockWorkPackage,
      specialistContext: mockSpecialistContext,
      additionalInstruction: "REVISION REQUEST:\nPlease add more detail.",
      specialistRunId: "run-001",
    });
    const callArg = mockGatewayProcess.mock.calls[0][0];
    expect(callArg.userMessage).toContain("REVISION REQUEST:");
  });

  it("returns failed status after gateway errors exhaust retries", async () => {
    mockGatewayProcess.mockRejectedValue(new Error("Provider error"));
    const engine = createUnifiedExecutionEngine();
    const result = await engine.execute({
      trigger: "conversation",
      organisationId: ORG_ID,
      requesterId: "system",
      requesterRole: "system",
      userRequest: "Review incident policy",
      specialistWorkPackage: mockWorkPackage,
      specialistContext: mockSpecialistContext,
      specialistRunId: "run-001",
    });
    if (result.trigger !== "conversation") return;
    expect(result.runResult.status).toBe("failed");
  }, 30000);

  it("uses outputMode=json for conversation execution", async () => {
    const engine = createUnifiedExecutionEngine();
    await engine.execute({
      trigger: "conversation",
      organisationId: ORG_ID,
      requesterId: "system",
      requesterRole: "system",
      userRequest: "Review incident policy",
      specialistWorkPackage: mockWorkPackage,
      specialistContext: mockSpecialistContext,
      specialistRunId: "run-001",
    });
    expect(mockGatewayProcess).toHaveBeenCalledWith(
      expect.objectContaining({ outputMode: "json" }),
    );
  });

  it("uses outputMode=json for task execution (Sprint 29K.3: dual content+claims output)", async () => {
    // Sprint 29K.3: generateTaskDraft now uses outputMode="json" so the specialist
    // returns { content, claims } in a single LLM call — no second LLM pass.
    // The gateway receives json_object mode; parseSpecialistJsonOutput extracts
    // the content string and the claims array from the response.
    vi.clearAllMocks();
    process.env.AI_PROVIDER = "openai";
    setupTaskMocks();
    const engine = createUnifiedExecutionEngine();
    await engine.execute({
      trigger: "task",
      organisationId: ORG_ID,
      requesterId: REQUESTER_ID,
      requesterRole: "owner",
      userRequest: "Review incident policy",
    });
    expect(mockGatewayProcess).toHaveBeenCalledWith(
      expect.objectContaining({ outputMode: "json" }),
    );
  });
});

// ─── 5. Backward compatibility ────────────────────────────────────────────────

describe("Backward compatibility — workExecutionPipelineService.executeWork", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AI_PROVIDER = "openai";
    setupTaskMocks();
  });

  it("executeWork still returns ExecuteWorkResult with completed outcome", async () => {
    const result = await executeWork({
      organizationId: ORG_ID,
      requesterId: REQUESTER_ID,
      requesterRole: "owner",
      userRequest: "Review incident policy",
    });
    expect(result.outcome).toBe("completed");
    expect(result.completedWorkId).toBe("cw-001");
  });

  it("executeWork passes blueprintCode through", async () => {
    await executeWork({
      organizationId: ORG_ID,
      requesterId: REQUESTER_ID,
      requesterRole: "owner",
      userRequest: "Review incident policy",
      blueprintCode: "incident_management",
    });
    expect(mockSelectBlueprint).toHaveBeenCalledWith("incident_management", ORG_ID);
  });

  it("executeWork returns execution_principal_missing for absent role", async () => {
    const result = await executeWork({
      organizationId: ORG_ID,
      requesterId: REQUESTER_ID,
      userRequest: "Review incident policy",
    });
    expect(result.outcome).toBe("execution_principal_missing");
  });

  it("FallbackDraftError is still exported from workExecutionPipelineService", () => {
    expect(FallbackDraftError).toBeDefined();
    const err = new FallbackDraftError("Test");
    expect(err.name).toBe("FallbackDraftError");
    expect(err instanceof FallbackDraftError).toBe(true);
  });
});

describe("Backward compatibility — createSpecialistIntelligenceService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AI_PROVIDER = "openai";
    mockGatewayProcess.mockResolvedValue({ content: validSpecialistResponse, usedFallback: false, usage: {} });
    mockLogOrgEvent.mockResolvedValue(undefined);
    mockDbUpdate.mockReturnValue({ set: mockDbSet.mockReturnValue({ where: mockDbWhere.mockResolvedValue(undefined) }) });
  });

  it("executeRun still returns SpecialistRunResult", async () => {
    const service = createSpecialistIntelligenceService();
    const result = await service.executeRun(mockWorkPackage, mockSpecialistContext);
    expect(result.specialistRunId).toBe("run-001");
    expect(result.status).toBe("completed");
    expect(result.workforceRoleCode).toBe("operations_manager");
  });

  it("reviseRun appends REVISION REQUEST to additional instruction", async () => {
    const service = createSpecialistIntelligenceService();
    await service.reviseRun("run-001", mockWorkPackage, mockSpecialistContext, "Add more detail");
    const callArg = mockGatewayProcess.mock.calls[0][0];
    expect(callArg.userMessage).toContain("REVISION REQUEST:");
    expect(callArg.userMessage).toContain("Add more detail");
  });

  it("resumeAfterClarification appends CLARIFICATION PROVIDED", async () => {
    const service = createSpecialistIntelligenceService();
    await service.resumeAfterClarification(
      "run-001", mockWorkPackage, mockSpecialistContext, "The policy is attached."
    );
    const callArg = mockGatewayProcess.mock.calls[0][0];
    expect(callArg.userMessage).toContain("CLARIFICATION PROVIDED:");
  });

  it("returns blocked for inactive specialist", async () => {
    const service = createSpecialistIntelligenceService();
    const result = await service.executeRun(
      { ...mockWorkPackage, workforceRoleCode: "compliance_quality_manager" },
      mockSpecialistContext,
    );
    expect(result.status).toBe("blocked");
  });
});
