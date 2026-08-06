/**
 * Sprint 29C — Canonical Execution Context
 *
 * Tests for the six Sprint 29C architecture objectives:
 *
 *  A. ExecutionContextBuilder assembles SpecialistWorkPackage + SpecialistContext
 *     from raw identifiers (specialistRunId + organisationId), without the
 *     orchestrator needing to know the internal structure of either type.
 *
 *  B. CanonicalExecutionContext is instantiated at the start of both executeTask()
 *     and executeConversation() inside UnifiedExecutionEngine.
 *
 *  C. Conversation executions receive an EvidencePack (via resolveEvidenceForConversation)
 *     with the same evidence quality as task executions.
 *
 *  D. Requester identity (requesterId / requesterRole) is threaded from the caller
 *     through the engine into the AI gateway context.
 *
 *  E. endToEndWorkflowService.ts is marked @deprecated with an architecture note.
 *
 *  F. No service outside UnifiedExecutionEngine may call the AI gateway for specialist
 *     execution; permitted exceptions are orchestration-cognition functions only.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";

// ─── vi.hoisted mocks ─────────────────────────────────────────────────────────

const mockDbSelect            = vi.hoisted(() => vi.fn());
const mockDbUpdate            = vi.hoisted(() => vi.fn());
const mockBuildSpecialistContext = vi.hoisted(() => vi.fn());
const mockBuildWorkPackage       = vi.hoisted(() => vi.fn());
const mockResolveConversationEvidence    = vi.hoisted(() => vi.fn());
const mockResolveEvidenceForConversation = vi.hoisted(() => vi.fn());
const mockResolveEvidenceForTask         = vi.hoisted(() => vi.fn());
const mockCreateAIGateway  = vi.hoisted(() => vi.fn());
const mockAssembleWorkPackage = vi.hoisted(() => vi.fn());
const mockSelectBlueprint  = vi.hoisted(() => vi.fn());
const mockValidateWorkPackage = vi.hoisted(() => vi.fn());

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("../services/specialistContextService.js", () => ({
  buildSpecialistContext: mockBuildSpecialistContext,
}));

vi.mock("../services/specialistWorkPackageService.js", () => ({
  buildWorkPackage:    mockBuildWorkPackage,
  buildSpecialistPlan: vi.fn(),
  getReadySteps:       vi.fn(),
}));

vi.mock("@workspace/db", () => {
  const fakeTable = new Proxy({}, { get: (_, p) => p });

  // default chain: select returns empty []
  mockDbSelect.mockImplementation(() => ({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({
          then: (cb: (r: unknown[]) => unknown) => Promise.resolve(cb([])),
        }),
        orderBy: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({
            then: (cb: (r: unknown[]) => unknown) => Promise.resolve(cb([])),
          }),
        }),
      }),
    }),
  }));

  mockDbUpdate.mockReturnValue({
    set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
  });

  return {
    db: { select: mockDbSelect, update: mockDbUpdate },
    specialistRunsTable: fakeTable,
    tasksTable:          fakeTable,
    specialistRunStatusHistoryTable: fakeTable,
    orgMemoryTable:      fakeTable,
    conversationsTable:  fakeTable,
    messagesTable:       fakeTable,
  };
});

vi.mock("../services/knowledgeResolutionService.js", () => ({
  resolveConversationEvidence: mockResolveConversationEvidence,
  resolveEvidence:             vi.fn(),
  buildEvidenceSection:        vi.fn().mockReturnValue(""),
  buildCitationSummary:        vi.fn().mockReturnValue([]),
}));

vi.mock("../lib/resources/ResourceRegistry.js", () => ({
  createResourceRegistry: vi.fn().mockImplementation(() => ({
    resolveEvidenceForTask:           mockResolveEvidenceForTask,
    resolveEvidenceForConversation:   mockResolveEvidenceForConversation,
  })),
}));

vi.mock("../lib/ai-gateway/index.js", () => ({
  createAIGateway:      mockCreateAIGateway,
  AIGatewayDataError:   class extends Error {},
}));

vi.mock("../services/workPackageAssemblerService.js", () => ({
  assembleWorkPackage: mockAssembleWorkPackage,
}));

vi.mock("../services/workBlueprintService.js", () => ({
  selectBlueprint:  mockSelectBlueprint,
  getBlueprintById: vi.fn(),
}));

vi.mock("../services/workPackageValidationService.js", () => ({
  validateWorkPackage: mockValidateWorkPackage,
}));

vi.mock("../services/executionInspectorService.js", () => ({
  captureSpecialistRunVersions:   vi.fn().mockReturnValue({
    dnaVersion: "1.0.0", workerProfileVersion: "1.0.0", capabilityVersion: "1.0.0",
    reasoningVersion: "1.0.0", outputSchemaVersion: "1.0.0", modelVersion: "gpt-4o",
  }),
  updateManifestObservability:    vi.fn().mockResolvedValue(undefined),
  recordCheckpointSnapshot:       vi.fn().mockResolvedValue(undefined),
  assertSelectFields:             vi.fn(),
}));

vi.mock("../services/auditService.js", () => ({ logOrgEvent: vi.fn() }));

vi.mock("../services/specialistIntelligenceService.js", () => ({
  createSpecialistIntelligenceService: vi.fn().mockReturnValue({
    executeRun:               vi.fn(),
    reviseRun:                vi.fn(),
    resumeAfterClarification: vi.fn(),
  }),
}));

// ─── Helper factories ─────────────────────────────────────────────────────────

function makeSpecialistRun(overrides: Record<string, unknown> = {}) {
  return {
    id:               "run-123",
    organizationId:   "org-abc",
    taskId:           "task-xyz",
    conversationId:   "conv-456",
    workforceRoleCode: "chief_of_staff",
    workerProfileCode: "chief_of_staff",
    status:           "pending",
    ...overrides,
  };
}

function makeWorkPackage(overrides: Record<string, unknown> = {}) {
  return {
    specialistRunId:   "run-123",
    organizationId:    "org-abc",
    conversationId:    "conv-456",
    workforceRoleCode: "chief_of_staff",
    workerProfileCode: "chief_of_staff",
    capabilityCode:    "research.general",
    capabilityLevel:   "professional_analysis",
    objective:         "Assess situation",
    responsibilities:  ["Do work"],
    expectedOutputs:   ["Report"],
    allowedTools:      [],
    prohibitedActions: [],
    approvalRequiredActions: [],
    assumptions:       [],
    organisationLibrarySources: [],
    cosMemories:       [],
    specialistMemories: [],
    taskUploads:       [],
    entityKnowledge:   {},
    modelVersion:      "gpt-4o",
    promptVersion:     "1.0.0",
    assembledAt:       new Date().toISOString(),
    requesterId:       "system",
    createdAt:         new Date().toISOString(),
    ...overrides,
  };
}

function makeContext(overrides: Record<string, unknown> = {}) {
  return {
    taskScope:          "task scope text",
    approvedMemory:     [],
    pinnedDecisions:    [],
    relevantMessages:   [],
    previousOutputs:    [],
    unresolvedQuestions: [],
    ...overrides,
  };
}

function makeEvidencePack(overrides: Record<string, unknown> = {}) {
  return {
    executionId:   "run-123",
    organisationId: "org-abc",
    resolvedAt:    new Date(),
    chunks:        [{
      chunkId: "chunk-1", text: "policy text", confidence: 0.9,
      sourceId: "src-1", sourceTitle: "Policy A", versionLabel: "v1",
      sourceType: "policy", authorityLevel: "mandatory",
      sectionTitle: null, pageNumber: null,
      citation: "Policy A, v1", selectionReason: "org_library",
    }],
    sourceIds:         ["src-1"],
    citationsByType:   { policy: [] },
    totalChunks:       1,
    avgConfidence:     0.9,
    retrievalMetrics:  { queryCount: 1, totalCandidates: 1, selectedChunks: 1, cacheHit: false, retrievalMs: 50 },
    ...overrides,
  };
}

/**
 * Configure the hoisted mockDbSelect to return a run row on the next .select() call.
 * The mock returns the empty-array default implementation for any subsequent calls.
 */
function mockDbRunReturn(run: Record<string, unknown>) {
  mockDbSelect.mockImplementationOnce(() => ({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({
          then: (cb: (r: unknown[]) => unknown) => Promise.resolve(cb([run])),
        }),
      }),
    }),
  }));
}

// ─── Objective A: ExecutionContextBuilder ─────────────────────────────────────

describe("Objective A — ExecutionContextBuilder (specialistRunId → workPackage + context)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("throws a clear error when the specialist run is not found", async () => {
    // DB mock returns [] by default → run not found
    const { buildExecutionContext } = await import("../services/executionContextBuilderService.js");
    await expect(
      buildExecutionContext({ specialistRunId: "missing-run", organisationId: "org-abc" }),
    ).rejects.toThrow(/not found/i);
  });

  it("assembles workPackage and context when run exists in the DB", async () => {
    const { buildExecutionContext } = await import("../services/executionContextBuilderService.js");
    mockDbRunReturn(makeSpecialistRun());
    mockBuildSpecialistContext.mockResolvedValueOnce(makeContext());
    mockBuildWorkPackage.mockResolvedValueOnce(makeWorkPackage());

    const result = await buildExecutionContext({
      specialistRunId:  "run-123",
      organisationId:   "org-abc",
      requesterId:      "user-999",
      requesterRole:    "administrator",
    });

    expect(result.workPackage).toBeDefined();
    expect(result.context).toBeDefined();
    expect(result.effectiveRequesterId).toBe("user-999");
    expect(result.effectiveRequesterRole).toBe("administrator");
    expect(mockBuildSpecialistContext).toHaveBeenCalledWith(
      expect.objectContaining({ workforceRoleCode: "chief_of_staff" }),
    );
  });

  it("uses 'system' as default requester when none provided", async () => {
    const { buildExecutionContext } = await import("../services/executionContextBuilderService.js");
    mockDbRunReturn(makeSpecialistRun());
    mockBuildSpecialistContext.mockResolvedValueOnce(makeContext());
    mockBuildWorkPackage.mockResolvedValueOnce(makeWorkPackage());

    const result = await buildExecutionContext({
      specialistRunId: "run-123",
      organisationId:  "org-abc",
    });

    expect(result.effectiveRequesterId).toBe("system");
    expect(result.effectiveRequesterRole).toBe("system");
  });

  it("passes workforceRoleCode and workerProfileCode from the run row to buildSpecialistContext", async () => {
    const { buildExecutionContext } = await import("../services/executionContextBuilderService.js");
    mockDbRunReturn(makeSpecialistRun({ workforceRoleCode: "operations_manager", workerProfileCode: "ops_primary" }));
    mockBuildSpecialistContext.mockResolvedValueOnce(makeContext());
    mockBuildWorkPackage.mockResolvedValueOnce(makeWorkPackage({ workforceRoleCode: "operations_manager" }));

    await buildExecutionContext({ specialistRunId: "run-123", organisationId: "org-abc" });

    expect(mockBuildSpecialistContext).toHaveBeenCalledWith(
      expect.objectContaining({
        workforceRoleCode: "operations_manager",
        workerProfileCode: "ops_primary",
      }),
    );
  });

  it("executionContextBuilderService is NOT the Sprint 28.5 conversationContextBuilder (naming invariant)", () => {
    const ecbSrc = fs.readFileSync(
      path.join(process.cwd(), "src/services/executionContextBuilderService.ts"),
      "utf-8",
    );
    const ccbSrc = fs.readFileSync(
      path.join(process.cwd(), "src/services/conversationContextBuilder.ts"),
      "utf-8",
    );
    // ECB is about DB-backed specialist run context assembly
    expect(ecbSrc).toContain("SpecialistWorkPackage");
    expect(ecbSrc).toContain("specialistRunsTable");
    // CCB is about CoS LLM context (memory, workforce, library presence)
    expect(ccbSrc).toContain("ChiefOfStaffContextPackage");
    expect(ccbSrc).toContain("buildChiefOfStaffContext");
    // They must not be identical
    expect(ecbSrc).not.toEqual(ccbSrc);
  });
});

// ─── Objective B: CanonicalExecutionContext instantiation ─────────────────────

describe("Objective B — CanonicalExecutionContext instantiated in both engine paths", () => {
  beforeEach(() => vi.clearAllMocks());

  it("CanonicalExecutionContext interface exists with required fields", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/types/canonicalExecutionContext.ts"),
      "utf-8",
    );
    expect(src).toContain("export interface CanonicalExecutionContext");
    expect(src).toContain("executionId");
    expect(src).toContain("triggerType");
    expect(src).toContain("organisationId");
    expect(src).toContain("requesterId");
    expect(src).toContain("evidence");
    expect(src).toContain("conversationContext");
    expect(src).toContain("organisationMemory");
  });

  it("engine constructs ctx in executeConversation when conversationSpecialistRunId is set", async () => {
    process.env.AI_PROVIDER = "internal"; // deterministic path — no AI call
    const { createUnifiedExecutionEngine } = await import("../services/unifiedExecutionEngine.js");

    mockDbRunReturn(makeSpecialistRun());
    mockBuildSpecialistContext.mockResolvedValueOnce(makeContext());
    mockBuildWorkPackage.mockResolvedValueOnce(makeWorkPackage());
    mockResolveEvidenceForConversation.mockResolvedValueOnce(null);

    const engine = createUnifiedExecutionEngine();
    const result = await engine.execute({
      trigger:                       "conversation",
      conversationSpecialistRunId:   "run-123",
      organisationId:                "org-abc",
      requesterId:                   "user-999",
      requesterRole:                 "administrator",
      userRequest:                   "assess risk",
    });

    expect(result.trigger).toBe("conversation");
    expect(result.runResult).toBeDefined();
    // Builder was called (proves identifier-based path was used)
    expect(mockBuildSpecialistContext).toHaveBeenCalled();
    expect(mockBuildWorkPackage).toHaveBeenCalled();
  });

  it("executeTask also constructs CanonicalExecutionContext (source inspection)", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/services/unifiedExecutionEngine.ts"),
      "utf-8",
    );
    // Both paths must instantiate ctx
    const ctxMatches = src.match(/const ctx: CanonicalExecutionContext/g) ?? [];
    expect(ctxMatches.length).toBeGreaterThanOrEqual(2);
  });
});

// ─── Objective C: Conversation EvidencePack ───────────────────────────────────

describe("Objective C — Conversation executions receive EvidencePack", () => {
  beforeEach(() => vi.clearAllMocks());

  it("resolveConversationEvidence is exported from knowledgeResolutionService", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/services/knowledgeResolutionService.ts"),
      "utf-8",
    );
    expect(src).toContain("export async function resolveConversationEvidence");
  });

  it("ResourceRegistry.resolveEvidenceForConversation delegates to resolveConversationEvidence", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/lib/resources/ResourceRegistry.ts"),
      "utf-8",
    );
    expect(src).toContain("resolveConversationEvidence");
    expect(src).toContain("resolveEvidenceForConversation");
    // Must actively delegate (not be a no-op stub)
    expect(src).toContain("await resolveConversationEvidence(");
  });

  it("engine calls resolveEvidenceForConversation in the conversation path", async () => {
    process.env.AI_PROVIDER = "internal";
    const { createUnifiedExecutionEngine } = await import("../services/unifiedExecutionEngine.js");

    mockDbRunReturn(makeSpecialistRun());
    mockBuildSpecialistContext.mockResolvedValueOnce(makeContext());
    mockBuildWorkPackage.mockResolvedValueOnce(makeWorkPackage());
    mockResolveEvidenceForConversation.mockResolvedValueOnce(makeEvidencePack());

    const engine = createUnifiedExecutionEngine();
    await engine.execute({
      trigger:                       "conversation",
      conversationSpecialistRunId:   "run-123",
      organisationId:                "org-abc",
      requesterId:                   "system",
      userRequest:                   "analyse",
    });

    expect(mockResolveEvidenceForConversation).toHaveBeenCalledWith(
      expect.objectContaining({ organisationId: "org-abc", specialistRunId: "run-123" }),
    );
  });

  it("evidence pack is injected into specialist prompt via buildEvidenceSection", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/services/unifiedExecutionEngine.ts"),
      "utf-8",
    );
    const fnMatch = src.match(/function buildSpecialistUserPrompt[\s\S]+?(?=function parseAndValidate)/)?.[0] ?? "";
    expect(fnMatch).toContain("evidencePack");
    expect(fnMatch).toContain("buildEvidenceSection");
    // Evidence must appear before REQUIRED OUTPUT SCHEMA
    const evidenceIdx = fnMatch.indexOf("buildEvidenceSection");
    const schemaIdx   = fnMatch.indexOf("REQUIRED OUTPUT SCHEMA");
    expect(evidenceIdx).toBeGreaterThan(0);
    expect(evidenceIdx).toBeLessThan(schemaIdx);
  });
});

// ─── Objective D: Requester identity threading ────────────────────────────────

describe("Objective D — Requester identity threaded through execution context", () => {
  beforeEach(() => vi.clearAllMocks());

  it("buildExecutionContext propagates requesterId from caller to result", async () => {
    const { buildExecutionContext } = await import("../services/executionContextBuilderService.js");
    mockDbRunReturn(makeSpecialistRun());
    mockBuildSpecialistContext.mockResolvedValueOnce(makeContext());
    mockBuildWorkPackage.mockResolvedValueOnce(makeWorkPackage());

    const result = await buildExecutionContext({
      specialistRunId:  "run-123",
      organisationId:   "org-abc",
      requesterId:      "user-human-007",
      requesterRole:    "owner",
    });

    expect(result.effectiveRequesterId).toBe("user-human-007");
    expect(result.effectiveRequesterRole).toBe("owner");
  });

  it("engine uses ctx.requesterId in gateway context, not a hardcoded string", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/services/unifiedExecutionEngine.ts"),
      "utf-8",
    );
    // Find the gatewayContext block inside executeConversation
    const gatewayBlock = src.match(/const gatewayContext: AIGatewayContext[\s\S]+?requiresHumanApproval:/)?.[0] ?? "";
    expect(gatewayBlock).toContain("ctx.requesterId");
    expect(gatewayBlock).not.toContain('userId: "system"');
  });

  it("executeConversation builder path stores effectiveRequesterId in ctx", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/services/unifiedExecutionEngine.ts"),
      "utf-8",
    );
    // The built object's effectiveRequesterId must be used for ctx.requesterId
    expect(src).toContain("effectiveRequesterId");
    expect(src).toContain("ctx.requesterId");
  });
});

// ─── Objective E: endToEndWorkflowService deprecated ────────────────────────

describe("Objective E — endToEndWorkflowService marked @deprecated", () => {
  it("carries a @deprecated banner with LEGACY marker", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/services/endToEndWorkflowService.ts"),
      "utf-8",
    );
    expect(src).toContain("@deprecated");
    expect(src).toContain("LEGACY");
    expect(src).toContain("UnifiedExecutionEngine");
  });

  it("has no live callers in routes or application services (test files excluded)", () => {
    const { execSync } = require("child_process");
    const result: string = execSync(
      'grep -rl "endToEndWorkflowService" src/ --include="*.ts"',
      { encoding: "utf-8", cwd: process.cwd() },
    ).trim();

    const files = result.split("\n").filter(Boolean);
    // Allow the service file itself and test files — no live production callers
    const liveCallers = files.filter(
      f => !f.endsWith("endToEndWorkflowService.ts") && !f.includes("__tests__"),
    );
    expect(liveCallers).toHaveLength(0);
  });
});

// ─── Objective F: Architecture — single gateway entry point for execution ─────

describe("Objective F — Architecture: UnifiedExecutionEngine is the sole AI gateway entry for specialist execution", () => {
  it("executeConversation has an architecture enforcement comment", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/services/unifiedExecutionEngine.ts"),
      "utf-8",
    );
    expect(src).toContain("Architecture enforcement");
    expect(src).toContain("ONLY permitted entry point for conversation-triggered AI execution");
  });

  it("executionContextBuilderService makes no AI gateway calls (pure DB + context assembly)", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/services/executionContextBuilderService.ts"),
      "utf-8",
    );
    expect(src).not.toContain("createAIGateway");
    expect(src).not.toContain("ai-gateway");
  });

  it("chiefOfStaffOrchestrator.executeSpecialistStep calls engine with conversationSpecialistRunId", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/services/chiefOfStaffOrchestrator.ts"),
      "utf-8",
    );
    expect(src).toContain("createUnifiedExecutionEngine");
    expect(src).toContain("conversationSpecialistRunId");
  });
});

// ─── ConversationContextBuilder (Sprint 28.5) still works ────────────────────

describe("Regression — Sprint 28.5 conversationContextBuilder.ts still exports required symbols", () => {
  it("exports buildConversationContext, deriveMessageContext, extractDocumentSearchTerms, ConversationContext", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/services/conversationContextBuilder.ts"),
      "utf-8",
    );
    expect(src).toContain("export async function buildConversationContext");
    expect(src).toContain("export function deriveMessageContext");
    expect(src).toContain("export function extractDocumentSearchTerms");
    expect(src).toContain("export interface ConversationContext");
  });

  it("ConversationContext has required fields consumed by chiefOfStaffLLMService", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/services/conversationContextBuilder.ts"),
      "utf-8",
    );
    // Fields accessed by buildLayeredUserMessage
    expect(src).toContain("libraryPresence");
    expect(src).toContain("workforce");
    expect(src).toContain("actionState");
    expect(src).toContain("memory");
    expect(src).toContain("runtime");
    expect(src).toContain("conversation");
  });

  it("Sprint 28.5 builder passes recentMessages from buildMessageContext to action state resolver", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/services/conversationContextBuilder.ts"),
      "utf-8",
    );
    // Must use recentMessages from msg context, not an empty array literal
    expect(src).toContain("recentMessagesForActionState");
    expect(src).toContain("resolveConversationActionState");
  });
});
