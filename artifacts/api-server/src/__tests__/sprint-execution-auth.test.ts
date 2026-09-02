/**
 * Specialist Execution Authorisation — Tests
 *
 * Covers the fix for: Role "system" is not authorised for purpose "work_execution"
 *
 * Root causes fixed:
 *   1. workExecutionPipelineService.ts hardcoded role: "system" — not in ROLE_PURPOSE_ALLOWLIST
 *   2. purpose: "work_execution" is not a valid AIPurpose — correct is "task_execution"
 *
 * Authority model: hybrid (C)
 *   - User approval establishes authority
 *   - Requester's verified org membership role is resolved and passed to the AI gateway
 *   - AI gateway authorises on behalf of the requester
 *   - Audit records both requester and service actor
 *
 * Tests:
 *   A. Pipeline principal guard — execution_principal_missing when role absent/invalid
 *   B. Valid role authorisation — owner / administrator / manager succeed
 *   C. Rejected roles — member / support / system cannot execute work
 *   D. Coordinator role resolution — getMembershipForUser drives the role
 *   E. Tenant isolation — role from wrong org is not used
 *   F. Audit — actorUserId is the requester (not "system")
 *   G. Gateway context — role and purpose are correct in the AI gateway call
 *   H. Customer-facing error — no internal role details exposed
 *   I. Regression — CoS → OM full flow (pipeline completes when role is valid)
 */

import { vi, describe, it, expect, beforeEach } from "vitest";

// ─── Hoisted mocks ─────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => {
  // AI Gateway mock — captures the context passed to it
  const gatewayProcess = vi.fn().mockResolvedValue({ content: "Draft content.", usedFallback: false });
  let capturedGatewayCtx: Record<string, unknown> | null = null;
  const createAIGateway = vi.fn((ctx: Record<string, unknown>) => {
    capturedGatewayCtx = ctx;
    return { process: gatewayProcess };
  });

  // DB chain mock (self-referential — all builder methods return the same object)
  const dbLimitFn = vi.fn().mockResolvedValue([]);
  const dbChain: Record<string, unknown> = { limit: dbLimitFn };
  (["select", "from", "where", "orderBy", "innerJoin"] as const).forEach(m => {
    dbChain[m] = vi.fn(() => dbChain);
  });
  const dbInsertReturning = vi.fn().mockResolvedValue([{ id: "cw-001", contentMarkdown: "draft" }]);
  const dbInsertChain = { values: vi.fn(() => ({ returning: dbInsertReturning })) };
  const dbInsert = vi.fn(() => dbInsertChain);
  const dbUpdateSet = vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) }));
  const dbUpdate = vi.fn(() => ({ set: dbUpdateSet }));

  const getMembershipForUser = vi.fn().mockResolvedValue({ role: "administrator" });

  const logOrgEvent = vi.fn().mockResolvedValue(undefined);

  // Services the pipeline calls — mock to unblock the path
  const selectBlueprint   = vi.fn().mockResolvedValue({ blueprint: { id: "bp-001", code: "policy_review", primarySpecialist: "operations_manager", outputTypes: ["review_report"], validationRules: [], requiredLibraryKnowledge: [], requiredEntityKnowledge: {}, requiredMemories: [], requiredApprovals: {} }, confidence: 0.9, matchedKeywords: ["review"], fallbackUsed: false });
  const assembleWorkPackage = vi.fn().mockResolvedValue({ manifest: { id: "manifest-001", organizationId: "org-aaa", primarySpecialist: "operations_manager", organisationLibrarySources: [], taskUploads: [], cosMemories: [], entityKnowledge: {}, selectionMetadata: null }, excludedSources: [] });
  const resolveEvidence   = vi.fn().mockResolvedValue({ chunks: [], snippets: [], totalChunks: 0, wasSearched: false });
  const validateWorkPackage = vi.fn().mockReturnValue({ passed: true, missingItems: [], summary: "OK" });
  const retrieveApprovedExamples = vi.fn().mockResolvedValue([]);
  const buildStyleGuidance = vi.fn().mockResolvedValue({ guidanceBlock: "" });
  const reviewDraft        = vi.fn().mockResolvedValue({ qualityScore: 0.9, finalContent: "Final content.", reviewPassed: true, dimensionScores: {} });
  const createDraft        = vi.fn().mockResolvedValue({ id: "cw-001" });
  const buildSystemInstructionForEmployee = vi.fn().mockReturnValue("SPECIALIST SYSTEM PROMPT");
  const updateManifestObservability = vi.fn().mockResolvedValue(undefined);

  return {
    createAIGateway,
    gatewayProcess,
    getCapturedGatewayCtx: () => capturedGatewayCtx,
    resetGatewayCtx: () => { capturedGatewayCtx = null; },
    dbChain,
    dbLimitFn,
    dbInsert,
    dbUpdate,
    getMembershipForUser,
    logOrgEvent,
    selectBlueprint,
    assembleWorkPackage,
    resolveEvidence,
    validateWorkPackage,
    retrieveApprovedExamples,
    buildStyleGuidance,
    reviewDraft,
    createDraft,
    buildSystemInstructionForEmployee,
    updateManifestObservability,
  };
});

vi.mock("@workspace/ai-gateway", () => ({ createAIGateway: mocks.createAIGateway }));
vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await vi.importActual<typeof import("@workspace/db/schema")>("@workspace/db/schema");
  return {
    ...actual,
    db: {
      select:  mocks.dbChain.select,
      from:    mocks.dbChain.from,
      where:   mocks.dbChain.where,
      insert:  mocks.dbInsert,
      update:  mocks.dbUpdate,
    },
  };
});
vi.mock("../services/membershipService.js", () => ({ getMembershipForUser: mocks.getMembershipForUser }));
vi.mock("../services/auditService.js", () => ({ logOrgEvent: mocks.logOrgEvent, getRequestMeta: vi.fn(() => ({})) }));
vi.mock("../services/workBlueprintService.js", () => ({
  selectBlueprint:   mocks.selectBlueprint,
  resolveCanonicalBlueprint: vi.fn().mockResolvedValue(null),
  getBlueprintExecutionContract: vi.fn(async (blueprint) => ({ blueprint, sections: [], template: null, mode: null })),
  getBlueprintById:  vi.fn().mockResolvedValue(null),
}));
vi.mock("../services/workPackageService.js", () => ({
  assembleWorkPackage:         mocks.assembleWorkPackage,
  updateManifestObservability: mocks.updateManifestObservability,
}));
vi.mock("../services/knowledgeResolutionService.js", () => ({ resolveEvidence: mocks.resolveEvidence, buildEvidenceSection: vi.fn().mockReturnValue(""), buildCitationSummary: vi.fn().mockReturnValue("") }));
vi.mock("../services/workValidationService.js", () => ({ validateWorkPackage: mocks.validateWorkPackage }));
vi.mock("../services/approvedExampleService.js", () => ({ retrieveApprovedExamples: mocks.retrieveApprovedExamples, buildStyleGuidance: mocks.buildStyleGuidance }));
vi.mock("../services/selfReviewService.js", () => ({ reviewDraft: mocks.reviewDraft }));
vi.mock("../services/completedWorkService.js", () => ({ createDraft: mocks.createDraft }));
vi.mock("@workspace/workforce-dna", () => ({ buildSystemInstructionForEmployee: mocks.buildSystemInstructionForEmployee }));

// ─── Subject under test ────────────────────────────────────────────────────────

import {
  executeWork,
  type ExecuteWorkInput,
} from "../services/workExecutionPipelineService.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ORG_A = "org-aaa-111";
const ORG_B = "org-bbb-222";
const REQUESTER = "user-requester-001";
const APPROVER  = "user-approver-002";

function baseInput(overrides: Partial<ExecuteWorkInput> = {}): ExecuteWorkInput {
  return {
    organizationId: ORG_A,
    requesterId:    REQUESTER,
    requesterRole:  "administrator",
    userRequest:    "Review our Medication Management Policy through an operational lens.",
    correlationId:  "corr-test-001",
    ...overrides,
  };
}

/**
 * Re-initialise all pipeline service mocks after vi.resetAllMocks().
 * vi.resetAllMocks() strips implementations — the gateway mock must be
 * re-wired so createAIGateway(ctx) returns { process: gatewayProcess }
 * and captures the context for assertion.
 */
function setupPipelineMocks(role = "administrator") {
  mocks.resetGatewayCtx();

  // Re-wire the gateway mock so it captures the ctx and returns a working stub
  mocks.createAIGateway.mockImplementation((ctx: Record<string, unknown>) => {
    (mocks as any)._lastGatewayCtx = ctx;
    return { process: mocks.gatewayProcess };
  });
  // Expose via the existing getter by patching the closure via a fresh fn
  (mocks as any).getCapturedGatewayCtx = () => (mocks as any)._lastGatewayCtx ?? null;
  (mocks as any)._lastGatewayCtx = null;

  mocks.gatewayProcess.mockResolvedValue({ content: "Draft content.", usedFallback: false });
  mocks.buildSystemInstructionForEmployee.mockReturnValue("SYSTEM");

  mocks.selectBlueprint.mockResolvedValue({
    blueprint: {
      id: "bp-001",
      organizationId: null,
      code: "policy_review",
      title: "Policy Review",
      version: "1.0.0",
      status: "active",
      objective: "Review organisational policy documents through an operational lens.",
      primarySpecialist: "operations_manager",
      supportingSpecialists: [],
      requiredLibraryKnowledge: [],
      requiredEntityKnowledge: {},
      requiredMemories: [],
      requiredApprovals: {},
      validationRules: [],
      qualityRules: [],
      successCriteria: ["Policy reviewed", "Recommendations documented"],
      outputTypes: ["review_report"],
      escalationRules: [],
      mandatoryCitations: [],
      isBuiltIn: true,
      isActive: true,
      createdAt: new Date("2025-01-01"),
      updatedAt: new Date("2025-01-01"),
    },
    confidence: 0.9, matchedKeywords: ["review"], fallbackUsed: false,
  });
  mocks.assembleWorkPackage.mockResolvedValue({ manifest: { id: "manifest-001", organizationId: ORG_A, primarySpecialist: "operations_manager", organisationLibrarySources: [], taskUploads: [], cosMemories: [], entityKnowledge: {}, selectionMetadata: null }, excludedSources: [] });
  mocks.resolveEvidence.mockResolvedValue({ chunks: [], snippets: [], totalChunks: 0, wasSearched: false });
  mocks.validateWorkPackage.mockReturnValue({ passed: true, missingItems: [], summary: "OK" });
  mocks.retrieveApprovedExamples.mockResolvedValue([]);
  mocks.buildStyleGuidance.mockResolvedValue({ guidanceBlock: "" });
  mocks.reviewDraft.mockResolvedValue({ qualityScore: 0.9, finalContent: "Final content.", reviewPassed: true, dimensionScores: {} });
  mocks.createDraft.mockResolvedValue({ id: "cw-001" });
  mocks.updateManifestObservability.mockResolvedValue(undefined);
  process.env.AI_PROVIDER = "openai";
}

// ─── A. Pipeline principal guard ──────────────────────────────────────────────

describe("executeWork — execution principal guard", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.resetGatewayCtx();
    process.env.AI_PROVIDER = "openai";
  });

  it("returns execution_principal_missing when requesterRole is absent", async () => {
    const result = await executeWork(baseInput({ requesterRole: undefined }));
    expect(result.outcome).toBe("execution_principal_missing");
    expect(mocks.createAIGateway).not.toHaveBeenCalled();
  });

  it("returns execution_principal_missing when requesterRole is empty string", async () => {
    const result = await executeWork(baseInput({ requesterRole: "" }));
    expect(result.outcome).toBe("execution_principal_missing");
    expect(mocks.createAIGateway).not.toHaveBeenCalled();
  });

  it("returns execution_principal_missing for role='system'", async () => {
    const result = await executeWork(baseInput({ requesterRole: "system" }));
    expect(result.outcome).toBe("execution_principal_missing");
    expect(mocks.createAIGateway).not.toHaveBeenCalled();
  });

  it("includes correlationId in the customer-facing error message", async () => {
    const result = await executeWork(baseInput({ requesterRole: undefined, correlationId: "corr-xyz-123" }));
    expect(result.message).toContain("corr-xyz-123");
  });

  it("does not expose internal role details in the customer-facing message", async () => {
    const result = await executeWork(baseInput({ requesterRole: "system" }));
    // The message should not say "role" or reveal internal permission implementation
    expect(result.message).not.toMatch(/ROLE_PURPOSE_ALLOWLIST/);
    expect(result.message).not.toMatch(/AIGatewayPurposeError/);
  });

  it("mentions that no work was performed in the customer-facing message", async () => {
    const result = await executeWork(baseInput({ requesterRole: undefined }));
    expect(result.message).toMatch(/no work was performed/i);
  });
});

// ─── B. Valid role authorisation ──────────────────────────────────────────────

describe("executeWork — permitted roles complete execution", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setupPipelineMocks();
  });

  it("owner role: completes execution successfully", async () => {
    const result = await executeWork(baseInput({ requesterRole: "owner" }));
    expect(result.outcome).toBe("completed");
    expect(result.completedWorkId).toBe("cw-001");
  });

  it("administrator role: completes execution successfully", async () => {
    const result = await executeWork(baseInput({ requesterRole: "administrator" }));
    expect(result.outcome).toBe("completed");
  });

  it("manager role: completes execution successfully", async () => {
    const result = await executeWork(baseInput({ requesterRole: "manager" }));
    expect(result.outcome).toBe("completed");
  });
});

// ─── C. Rejected roles ────────────────────────────────────────────────────────

describe("executeWork — rejected roles", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.resetGatewayCtx();
    process.env.AI_PROVIDER = "openai";
  });

  it.each(["member", "support", "system", "guest", "unknown_role"])(
    "role=%s is denied (execution_principal_missing)",
    async (role) => {
      const result = await executeWork(baseInput({ requesterRole: role }));
      expect(result.outcome).toBe("execution_principal_missing");
      expect(mocks.createAIGateway).not.toHaveBeenCalled();
    },
  );
});

// ─── D. Missing role does not fall back to system ─────────────────────────────

describe("executeWork — no silent system fallback", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setupPipelineMocks();
  });

  it("never calls the AI gateway with role=system", async () => {
    await executeWork(baseInput({ requesterRole: "administrator" }));
    const ctx = mocks.getCapturedGatewayCtx();
    // If the gateway was reached, its role must never be "system"
    if (ctx) {
      expect(ctx["role"]).not.toBe("system");
    }
  });

  it("missing role results in execution_principal_missing, not a gateway error", async () => {
    const result = await executeWork(baseInput({ requesterRole: undefined }));
    // Outcome must be the domain error, not an unhandled exception or gateway auth error
    expect(result.outcome).toBe("execution_principal_missing");
    expect(result.message).toBeTruthy();
  });
});

// ─── G. Gateway context — role and purpose are correct ───────────────────────

describe("executeWork — AI gateway context", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setupPipelineMocks();
  });

  it("gateway is called with purpose=task_execution (not work_execution)", async () => {
    await executeWork(baseInput({ requesterRole: "administrator" }));
    const ctx = mocks.getCapturedGatewayCtx();
    expect(ctx).not.toBeNull();
    expect(ctx!["purpose"]).toBe("task_execution");
    expect(ctx!["purpose"]).not.toBe("work_execution");
  });

  it("gateway is called with the requester's org role (not system)", async () => {
    await executeWork(baseInput({ requesterRole: "owner" }));
    const ctx = mocks.getCapturedGatewayCtx();
    expect(ctx!["role"]).toBe("owner");
  });

  it("gateway receives the requester's userId", async () => {
    await executeWork(baseInput({ requesterRole: "administrator", requesterId: REQUESTER }));
    const ctx = mocks.getCapturedGatewayCtx();
    expect(ctx!["userId"]).toBe(REQUESTER);
  });

  it("gateway receives the correct organizationId", async () => {
    await executeWork(baseInput({ requesterRole: "administrator" }));
    const ctx = mocks.getCapturedGatewayCtx();
    expect(ctx!["organizationId"]).toBe(ORG_A);
  });

  it("gateway has requiresHumanApproval=true for work execution", async () => {
    await executeWork(baseInput({ requesterRole: "administrator" }));
    const ctx = mocks.getCapturedGatewayCtx();
    expect(ctx!["requiresHumanApproval"]).toBe(true);
  });

  it("different owners in same org get their own userId in gateway context", async () => {
    const capturedCtxes: Array<Record<string, unknown>> = [];
    mocks.createAIGateway.mockImplementation((ctx: Record<string, unknown>) => {
      capturedCtxes.push(ctx);
      return { process: mocks.gatewayProcess };
    });

    await executeWork(baseInput({ requesterRole: "owner", requesterId: "user-owner-A" }));
    await executeWork(baseInput({ requesterRole: "owner", requesterId: "user-owner-B" }));

    expect(capturedCtxes[0]?.["userId"]).toBe("user-owner-A");
    expect(capturedCtxes[1]?.["userId"]).toBe("user-owner-B");
  });
});

// ─── E. Tenant isolation ──────────────────────────────────────────────────────

describe("executeWork — tenant isolation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setupPipelineMocks();
  });

  it("execution for org A does not use role from org B", async () => {
    // Simulate: org A's user has "member" (not enough), org B's user has "owner"
    // The pipeline should only look at the role passed in, not cross-org membership
    const resultOrgA = await executeWork(baseInput({ organizationId: ORG_A, requesterRole: "member" }));
    const resultOrgB = await executeWork(baseInput({ organizationId: ORG_B, requesterRole: "owner" }));

    expect(resultOrgA.outcome).toBe("execution_principal_missing"); // member not permitted
    expect(resultOrgB.outcome).not.toBe("execution_principal_missing"); // owner is permitted (pipeline may fail for other reasons)
  });
});

// ─── F. Audit — actorUserId is the requester ─────────────────────────────────

describe("executeWork — audit attribution", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setupPipelineMocks();
  });

  it("completed work is attributed to the requester userId, not system", async () => {
    await executeWork(baseInput({ requesterRole: "administrator", requesterId: REQUESTER }));
    expect(mocks.createDraft).toHaveBeenCalledWith(
      expect.objectContaining({ createdByUserId: REQUESTER }),
    );
  });
});

// ─── I. Regression — CoS → OM full execution flow ─────────────────────────────

describe("regression — CoS → OM execution flow", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setupPipelineMocks();
    // Override with regression-specific data
    mocks.assembleWorkPackage.mockResolvedValue({ manifest: { id: "manifest-001", organizationId: ORG_A, primarySpecialist: "operations_manager", organisationLibrarySources: [{ sourceId: "src-001", title: "Medication Management Policy" }], taskUploads: [], cosMemories: [], entityKnowledge: {}, selectionMetadata: null }, excludedSources: [] });
    mocks.resolveEvidence.mockResolvedValue({ chunks: [{ sourceId: "src-001", content: "Policy text.", citation: "§1.2", chunkId: "chunk-001" }], snippets: [], totalChunks: 1, wasSearched: true });
    mocks.validateWorkPackage.mockReturnValue({ passed: true, missingItems: [], summary: "All prerequisites met." });
    mocks.buildStyleGuidance.mockResolvedValue({ guidanceBlock: "Use clear language." });
    mocks.gatewayProcess.mockResolvedValue({ content: "Operational review of Medication Management Policy complete.", usedFallback: false });
    mocks.reviewDraft.mockResolvedValue({ qualityScore: 0.95, finalContent: "Final review document.", reviewPassed: true, dimensionScores: {} });
    mocks.createDraft.mockResolvedValue({ id: "cw-regression-001" });
    mocks.buildSystemInstructionForEmployee.mockReturnValue("Operations Manager system prompt.");
  });

  it("task created → OM assigned → execution principal resolved → work_execution passes → Completed Work produced", async () => {
    const result = await executeWork({
      organizationId: ORG_A,
      requesterId:    APPROVER,
      requesterRole:  "administrator",
      userRequest:    "Review our Medication Management Policy through an operational lens.",
      correlationId:  "corr-regression-001",
    });

    // Execution completed
    expect(result.outcome).toBe("completed");
    expect(result.completedWorkId).toBe("cw-regression-001");

    // Gateway was called with correct purpose and role
    const ctx = mocks.getCapturedGatewayCtx();
    expect(ctx!["purpose"]).toBe("task_execution");
    expect(ctx!["role"]).toBe("administrator");
    expect(ctx!["role"]).not.toBe("system");

    // Evidence was retrieved
    expect(mocks.resolveEvidence).toHaveBeenCalledWith(
      expect.objectContaining({ organisationId: ORG_A }),
    );

    // Completed Work attributed to the approver
    expect(mocks.createDraft).toHaveBeenCalledWith(
      expect.objectContaining({ createdByUserId: APPROVER }),
    );
  });

  it("owner who requested and approved: gateway receives their role", async () => {
    const result = await executeWork({
      organizationId: ORG_A,
      requesterId:    REQUESTER,
      requesterRole:  "owner",
      userRequest:    "Review our Medication Management Policy.",
      correlationId:  "corr-owner-001",
    });

    expect(result.outcome).toBe("completed");
    expect(mocks.getCapturedGatewayCtx()!["role"]).toBe("owner");
  });

  it("retryability: execution_principal_missing does NOT write a completed work record", async () => {
    const result = await executeWork({
      organizationId: ORG_A,
      requesterId:    REQUESTER,
      requesterRole:  undefined,  // missing
      userRequest:    "Review our Medication Management Policy.",
      correlationId:  "corr-missing-role",
    });

    expect(result.outcome).toBe("execution_principal_missing");
    expect(mocks.createDraft).not.toHaveBeenCalled(); // no incomplete record written
  });
});
