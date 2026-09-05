/**
 * Sprint 27.4 — Execution Inspector & Runtime Transparency
 *
 * Tests cover:
 *   - getExecutionInspection (RBAC, found, not found, no audit event)
 *   - getInspectionByCompletedWorkId (found, not found)
 *   - updateManifestObservability (selectionMetadata, validationSnapshot, performanceMetrics, failureInfo)
 *   - Evidence Inspector (sources, memory, task uploads, no-evidence reason)
 *   - Blueprint Inspector (keyword selection, semantic selection, validation)
 *   - Specialist runtime counts
 *   - Timeline (with/without conversation)
 *   - Failure diagnostics (awaiting_clarification, failed)
 *   - Performance metrics
 *   - RBAC: org_user restricted to own executions, platform_owner sees all
 *   - No-evidence-found explanatory reason
 *   - Clarification state
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const mockGetConversationTimeline = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    conversationId: "conv-1",
    entries: [
      { id: "e1", timestamp: "2026-08-05T10:00:00Z", kind: "started",   humanLabel: "Execution started." },
      { id: "e2", timestamp: "2026-08-05T10:00:05Z", kind: "progress",  humanLabel: "Selecting work blueprint…" },
      { id: "e3", timestamp: "2026-08-05T10:00:30Z", kind: "completed", humanLabel: "Work completed and ready for review." },
    ],
    isComplete: true,
    hasFailure: false,
  }),
);

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("@workspace/db", () => {
  const db = { select: vi.fn(), update: vi.fn(), insert: vi.fn() };
  return {
    db,
    withSystemTenantContext: vi.fn((_context, fn) => fn(db)),
    workPackageManifestsTable:  { id: "wpm_id", executionId: "wpm_executionId", organizationId: "wpm_orgId", completedWorkId: "wpm_cwId", requesterId: "wpm_requesterId", blueprintId: "wpm_bpId", blueprintVersion: "wpm_bpVer", primarySpecialist: "wpm_ps", supportingSpecialists: "wpm_ss", organisationLibrarySources: "wpm_ols", cosMemories: "wpm_cm", specialistMemories: "wpm_sm", entityKnowledge: "wpm_ek", taskUploads: "wpm_tu", assembledAt: "wpm_asmAt", selectionMetadata: "wpm_selMeta", validationSnapshot: "wpm_valSnap", performanceMetrics: "wpm_perfMeta", failureInfo: "wpm_failInfo" },
    retrievalAuditEventsTable:  { executionId: "rae_execId", organizationId: "rae_orgId", createdAt: "rae_createdAt", sourceIds: "rae_sourceIds", chunkIds: "rae_chunkIds", memoryIds: "rae_memIds", taskUploadIds: "rae_tuIds", scoreMetadata: "rae_scoreMeta", retrievalDurationMs: "rae_retMs" },
    completedWorkTable:         { id: "cw_id", organizationId: "cw_orgId", status: "cw_status", conversationId: "cw_convId" },
    workBlueprintsTable:        { id: "bp_id", title: "bp_title", version: "bp_version" },
    knowledgeChunksTable:       { id: "kc_id", organizationId: "kc_orgId", knowledgeSourceId: "kc_ksId", chunkIndex: "kc_ci", text: "kc_text" },
    knowledgeSourcesTable:      {},
    organisationMemoryTable:    {},
  };
});

vi.mock("../services/executionTimelineService.js", () => ({
  getConversationTimeline: mockGetConversationTimeline,
}));

vi.mock("drizzle-orm", () => ({
  eq:      vi.fn((_c, v) => ({ _eq: v })),
  and:     vi.fn((...a) => ({ _and: a })),
  inArray: vi.fn((_c, v) => ({ _in: v })),
  or:      vi.fn((...a) => ({ _or: a })),
  desc:    vi.fn(c => ({ _desc: c })),
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import {
  getExecutionInspection,
  getInspectionByCompletedWorkId,
} from "../services/executionInspectorService.js";
import { updateManifestObservability } from "../services/workPackageService.js";
import { db } from "@workspace/db";

// ─── Chain helper ─────────────────────────────────────────────────────────────

/**
 * Builds a select chain that cycles through `datasets` in order.
 * Each .limit() call resolves to the next dataset slice.
 * Uses two-step assignment to avoid const-TDZ self-reference.
 */
function makeSelectChain(datasets: unknown[][]) {
  let callCount = 0;
  const chain = {
    from:    vi.fn(),
    where:   vi.fn(),
    orderBy: vi.fn(),
    limit:   vi.fn().mockImplementation(() => Promise.resolve(datasets[callCount++] ?? [])),
    then:    (resolve: (v: unknown) => unknown) =>
               Promise.resolve(datasets[callCount++] ?? []).then(resolve),
  };
  chain.from.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.orderBy.mockReturnValue(chain);
  return chain;
}

function wireDb(
  manifestRows: unknown[],
  auditRows: unknown[],
  cwRows: unknown[],
  bpRows: unknown[],
  chunkRows1: unknown[] = [],
  chunkRows2: unknown[] = [],
) {
  const datasets = [manifestRows, auditRows, cwRows, bpRows, chunkRows1, chunkRows2];
  let selectCallCount = 0;
  (db.select as ReturnType<typeof vi.fn>).mockImplementation(() => {
    const idx = selectCallCount++;
    const terminal = datasets[idx] ?? [];
    const chain = {
      from:    vi.fn(),
      where:   vi.fn(),
      orderBy: vi.fn(),
      limit:   vi.fn().mockResolvedValue(terminal),
      then:    (resolve: (v: unknown) => unknown) => Promise.resolve(terminal).then(resolve),
    };
    chain.from.mockReturnValue(chain);
    chain.where.mockReturnValue(chain);
    chain.orderBy.mockReturnValue(chain);
    return chain;
  });

  const updateChain = { set: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue(undefined) };
  (db.update as ReturnType<typeof vi.fn>).mockReturnValue(updateChain);
}

// ─── Fixtures ──────────────────────────────────────────────────────────────────

const ORG_ID      = "org-abc";
const EXEC_ID     = "exec-xyz";
const MANIFEST_ID = "wpm-456";
const CW_ID       = "cw-789";
const ACTOR_ID    = "user-1";
const OTHER_ID    = "user-2";
const BP_ID       = "bp-001";

const baseManifest = {
  id: MANIFEST_ID,
  organizationId: ORG_ID,
  executionId: EXEC_ID,
  completedWorkId: CW_ID,
  requesterId: ACTOR_ID,
  blueprintId: BP_ID,
  blueprintVersion: "v2.1",
  primarySpecialist: "operations_manager",
  supportingSpecialists: ["compliance_quality_manager"],
  organisationLibrarySources: [
    { sourceId: "src-1", title: "Medication Management Policy", sourceType: "policy", authorityLevel: "primary", versionLabel: "4.2" },
    { sourceId: "src-2", title: "NDIS Practice Standards",      sourceType: "legislation", authorityLevel: "primary", versionLabel: "2023" },
  ],
  cosMemories: [
    { memoryId: "mem-1", memoryType: "decision",   title: "Approved medication routes", approvalStatus: "approved" },
    { memoryId: "mem-2", memoryType: "preference", title: "Report format preference",   approvalStatus: "approved" },
  ],
  specialistMemories: [],
  entityKnowledge: { participant: { name: "Jane Doe" } },
  taskUploads: [
    { sourceId: "tu-1", title: "Participant Care Plan", sourceType: "participant_upload" },
  ],
  assembledAt: new Date("2026-08-05T10:00:00Z"),
  selectionMetadata: {
    method: "keyword", confidence: 0.94, matchedKeywords: ["care plan"], fallbackUsed: false,
  },
  validationSnapshot: { passed: true, missingItems: [], summary: "All prerequisites met." },
  performanceMetrics: {
    blueprintSelectionMs: 45, validationMs: 12, retrievalMs: 340,
    llmMs: 4200, reviewMs: 890, totalMs: 5600, evidenceCacheHit: false,
  },
  failureInfo: null,
};

const baseAuditRow = {
  executionId: EXEC_ID,
  organizationId: ORG_ID,
  sourceIds:      ["src-1", "src-2"],
  chunkIds:       ["chunk-a", "chunk-b", "chunk-c"],
  memoryIds:      ["mem-1"],
  taskUploadIds:  ["tu-1"],
  scoreMetadata: {
    "chunk-a": { baseScore: 0.98, sourceId: "src-1" },
    "chunk-b": { baseScore: 0.91, sourceId: "src-2" },
    "chunk-c": { baseScore: 0.88, sourceId: "src-2" },
  },
  retrievalDurationMs: 340,
  createdAt: new Date("2026-08-05T10:00:10Z"),
};

const baseCwRow = { id: CW_ID, status: "approved", conversationId: "conv-1" };
const baseBpRow = { name: "Care Plan Review", version: "2.1" };

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("getExecutionInspection", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockGetConversationTimeline.mockResolvedValue({
      conversationId: "conv-1",
      entries: [
        { id: "e1", timestamp: "2026-08-05T10:00:00Z", kind: "started",   humanLabel: "Execution started." },
        { id: "e3", timestamp: "2026-08-05T10:00:30Z", kind: "completed", humanLabel: "Work completed and ready for review." },
      ],
      isComplete: true, hasFailure: false,
    });
    wireDb([baseManifest], [baseAuditRow], [baseCwRow], [baseBpRow]);
  });

  it("returns a full inspection for the requester", async () => {
    const result = await getExecutionInspection(EXEC_ID, ORG_ID, ACTOR_ID, "org_user");
    expect(result).not.toBeNull();
    expect(result!.executionId).toBe(EXEC_ID);
    expect(result!.manifestId).toBe(MANIFEST_ID);
  });

  it("returns null when manifest not found", async () => {
    wireDb([], [], [], []);
    const result = await getExecutionInspection(EXEC_ID, ORG_ID, ACTOR_ID, "org_user");
    expect(result).toBeNull();
  });

  it("RBAC: org_user cannot see another user's execution", async () => {
    const result = await getExecutionInspection(EXEC_ID, ORG_ID, OTHER_ID, "org_user");
    expect(result).toBeNull();
  });

  it("RBAC: platform_owner can see any execution regardless of requesterId", async () => {
    const result = await getExecutionInspection(EXEC_ID, ORG_ID, OTHER_ID, "platform_owner");
    expect(result).not.toBeNull();
  });

  it("populates lead specialist and supporting specialists", async () => {
    const result = await getExecutionInspection(EXEC_ID, ORG_ID, ACTOR_ID, "org_user");
    expect(result!.summary.leadSpecialist).toBe("operations_manager");
    expect(result!.summary.supportingSpecialists).toEqual(["compliance_quality_manager"]);
  });

  it("populates blueprint name and version from blueprint row", async () => {
    const result = await getExecutionInspection(EXEC_ID, ORG_ID, ACTOR_ID, "org_user");
    expect(result!.summary.blueprintName).toBe("Care Plan Review");
    expect(result!.summary.blueprintVersion).toBe("v2.1");
  });

  it("derives selection method from selectionMetadata (keyword)", async () => {
    const result = await getExecutionInspection(EXEC_ID, ORG_ID, ACTOR_ID, "org_user");
    expect(result!.summary.selectionMethod).toBe("keyword");
    expect(result!.summary.selectionConfidence).toBe(0.94);
    expect(result!.blueprint.matchedPhrase).toBe("care plan");
  });

  it("validation passed=true when validationSnapshot.passed=true", async () => {
    const result = await getExecutionInspection(EXEC_ID, ORG_ID, ACTOR_ID, "org_user");
    expect(result!.summary.validationPassed).toBe(true);
    expect(result!.blueprint.validationPassed).toBe(true);
    expect(result!.blueprint.validationMissingItems).toEqual([]);
  });

  it("populates evidence sources from organisationLibrarySources", async () => {
    const result = await getExecutionInspection(EXEC_ID, ORG_ID, ACTOR_ID, "org_user");
    const src1 = result!.evidence.sources.find(s => s.sourceId === "src-1");
    expect(src1).toBeDefined();
    expect(src1!.title).toBe("Medication Management Policy");
    expect(src1!.version).toBe("4.2");
    expect(src1!.retrieved).toBe(true);
  });

  it("includes memory entries count and task upload count in evidence", async () => {
    const result = await getExecutionInspection(EXEC_ID, ORG_ID, ACTOR_ID, "org_user");
    expect(result!.evidence.memoryEntries).toBe(2);
    expect(result!.evidence.taskUploads).toBe(1);
  });

  it("populates specialist runtime counts", async () => {
    const result = await getExecutionInspection(EXEC_ID, ORG_ID, ACTOR_ID, "org_user");
    const sr = result!.specialistRuntime;
    expect(sr.dnaLoaded).toBe(true);
    expect(sr.organisationMemoryEntries).toBe(2);
    expect(sr.evidenceChunks).toBe(3);
    expect(sr.blueprintLoaded).toBe(true);
    expect(sr.expectedDeliverablesLoaded).toBe(true);
  });

  it("populates performance metrics from performanceMetrics column", async () => {
    const result = await getExecutionInspection(EXEC_ID, ORG_ID, ACTOR_ID, "org_user");
    const p = result!.performance;
    expect(p.blueprintSelectionMs).toBe(45);
    expect(p.llmMs).toBe(4200);
    expect(p.totalMs).toBe(5600);
    expect(p.chunkCount).toBe(3);
  });

  it("timeline is complete when conversation has completed entry", async () => {
    const result = await getExecutionInspection(EXEC_ID, ORG_ID, ACTOR_ID, "org_user");
    expect(result!.timeline.isComplete).toBe(true);
    expect(result!.timeline.hasFailure).toBe(false);
    expect(result!.timeline.entries.length).toBe(2);
  });

  it("diagnostics state is completed when completedWork.status=approved", async () => {
    const result = await getExecutionInspection(EXEC_ID, ORG_ID, ACTOR_ID, "org_user");
    expect(result!.diagnostics.state).toBe("completed");
  });

  it("diagnostics state is awaiting_clarification when failureInfo.state matches", async () => {
    const m = {
      ...baseManifest,
      failureInfo: {
        state: "awaiting_clarification",
        clarificationItems: [{ name: "Medication Policy", reason: "Blueprint requires approved policy evidence." }],
        retryAvailable: true,
      },
    };
    wireDb([m], [baseAuditRow], [baseCwRow], [baseBpRow]);
    const result = await getExecutionInspection(EXEC_ID, ORG_ID, ACTOR_ID, "org_user");
    expect(result!.diagnostics.state).toBe("awaiting_clarification");
    expect(result!.diagnostics.clarificationItems).toHaveLength(1);
    expect(result!.diagnostics.clarificationItems[0].name).toBe("Medication Policy");
  });

  it("diagnostics state is failed when failureInfo.state=failed", async () => {
    const m = {
      ...baseManifest,
      failureInfo: {
        state: "failed",
        failedStage: "executing",
        rootCause: "LLM timeout after 30s",
        retryAvailable: false,
      },
    };
    wireDb([m], [baseAuditRow], [baseCwRow], [baseBpRow]);
    const result = await getExecutionInspection(EXEC_ID, ORG_ID, ACTOR_ID, "org_user");
    expect(result!.diagnostics.state).toBe("failed");
    expect(result!.diagnostics.failedStage).toBe("executing");
    expect(result!.diagnostics.rootCause).toBe("LLM timeout after 30s");
    expect(result!.diagnostics.retryAvailable).toBe(false);
  });

  it("no-evidence reason when blueprint has no required knowledge", async () => {
    const m = { ...baseManifest, organisationLibrarySources: [], taskUploads: [], blueprintId: BP_ID };
    wireDb([m], [], [baseCwRow], [baseBpRow]);
    const result = await getExecutionInspection(EXEC_ID, ORG_ID, ACTOR_ID, "org_user");
    expect(result!.evidence.noEvidenceReason).toContain("Blueprint does not require library knowledge");
  });

  it("no-evidence reason when ad-hoc (no blueprint)", async () => {
    const m = { ...baseManifest, organisationLibrarySources: [], taskUploads: [], blueprintId: null };
    wireDb([m], [], [baseCwRow], [baseBpRow]);
    const result = await getExecutionInspection(EXEC_ID, ORG_ID, ACTOR_ID, "org_user");
    expect(result!.evidence.noEvidenceReason).toContain("No blueprint selected");
  });

  it("semantic selection method: semanticReason set, matchedPhrase null", async () => {
    const m = {
      ...baseManifest,
      selectionMetadata: { method: "semantic", confidence: 0.78, matchedKeywords: [], fallbackUsed: false },
    };
    wireDb([m], [baseAuditRow], [baseCwRow], [baseBpRow]);
    const result = await getExecutionInspection(EXEC_ID, ORG_ID, ACTOR_ID, "org_user");
    expect(result!.blueprint.selectionMethod).toBe("semantic");
    expect(result!.blueprint.semanticReason).toContain("LLM semantic analysis");
    expect(result!.blueprint.matchedPhrase).toBeNull();
  });

  it("works when no retrieval audit event exists (cold execution)", async () => {
    wireDb([baseManifest], [], [baseCwRow], [baseBpRow]);
    const result = await getExecutionInspection(EXEC_ID, ORG_ID, ACTOR_ID, "org_user");
    expect(result).not.toBeNull();
    expect(result!.evidence.totalChunks).toBe(0);
  });

  it("conversationId is null when completedWork has no conversation", async () => {
    wireDb([baseManifest], [baseAuditRow], [{ ...baseCwRow, conversationId: null }], [baseBpRow]);
    const result = await getExecutionInspection(EXEC_ID, ORG_ID, ACTOR_ID, "org_user");
    expect(result!.conversationId).toBeNull();
  });

  it("completedWorkId is set from manifest.completedWorkId", async () => {
    const result = await getExecutionInspection(EXEC_ID, ORG_ID, ACTOR_ID, "org_user");
    expect(result!.completedWorkId).toBe(CW_ID);
  });
});

describe("getInspectionByCompletedWorkId", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockGetConversationTimeline.mockResolvedValue({
      conversationId: "conv-1", entries: [], isComplete: true, hasFailure: false,
    });
    wireDb([baseManifest], [baseAuditRow], [baseCwRow], [baseBpRow]);
  });

  it("returns inspection when manifest linked to completedWorkId", async () => {
    const result = await getInspectionByCompletedWorkId(CW_ID, ORG_ID, ACTOR_ID, "org_user");
    expect(result).not.toBeNull();
    expect(result!.completedWorkId).toBe(CW_ID);
  });

  it("returns null when no manifest found for completedWorkId", async () => {
    wireDb([], [], [], []);
    const result = await getInspectionByCompletedWorkId("cw-unknown", ORG_ID, ACTOR_ID, "org_user");
    expect(result).toBeNull();
  });

  it("RBAC: org_user cannot see another user's work inspection", async () => {
    const result = await getInspectionByCompletedWorkId(CW_ID, ORG_ID, OTHER_ID, "org_user");
    expect(result).toBeNull();
  });

  it("RBAC: platform_owner can inspect any org's work", async () => {
    const result = await getInspectionByCompletedWorkId(CW_ID, ORG_ID, OTHER_ID, "platform_owner");
    expect(result).not.toBeNull();
  });
});

describe("updateManifestObservability", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    const updateChain = { set: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue(undefined) };
    (db.update as ReturnType<typeof vi.fn>).mockReturnValue(updateChain);
  });

  it("calls db.update with validationSnapshot when provided", async () => {
    await updateManifestObservability(MANIFEST_ID, {
      validationSnapshot: { passed: true, missingItems: [], summary: "OK" },
    }, ORG_ID);
    expect(db.update).toHaveBeenCalledOnce();
  });

  it("calls db.update with performanceMetrics when provided", async () => {
    await updateManifestObservability(MANIFEST_ID, {
      performanceMetrics: {
        blueprintSelectionMs: 50, validationMs: 10, retrievalMs: 300,
        llmMs: 4000, reviewMs: 800, totalMs: 5200, evidenceCacheHit: false,
      },
    }, ORG_ID);
    expect(db.update).toHaveBeenCalledOnce();
  });

  it("calls db.update with failureInfo when provided", async () => {
    await updateManifestObservability(MANIFEST_ID, {
      failureInfo: { state: "failed", failedStage: "executing", rootCause: "Timeout", retryAvailable: false },
    }, ORG_ID);
    expect(db.update).toHaveBeenCalledOnce();
  });

  it("skips db.update when no fields provided", async () => {
    await updateManifestObservability(MANIFEST_ID, {}, ORG_ID);
    expect(db.update).not.toHaveBeenCalled();
  });

  it("handles multiple fields in one call", async () => {
    await updateManifestObservability(MANIFEST_ID, {
      validationSnapshot: { passed: false, missingItems: ["policy"], summary: "Missing policy." },
      failureInfo: { state: "awaiting_clarification", clarificationItems: [{ name: "policy", reason: "Required" }] },
    }, ORG_ID);
    expect(db.update).toHaveBeenCalledOnce();
  });
});

describe("Evidence Inspector", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockGetConversationTimeline.mockResolvedValue({
      conversationId: "conv-1", entries: [], isComplete: true, hasFailure: false,
    });
    wireDb([baseManifest], [baseAuditRow], [baseCwRow], [baseBpRow]);
  });

  it("marks sources as retrieved when sourceId is in audit event sourceIds", async () => {
    const result = await getExecutionInspection(EXEC_ID, ORG_ID, ACTOR_ID, "org_user");
    const src1 = result!.evidence.sources.find(s => s.sourceId === "src-1");
    const src2 = result!.evidence.sources.find(s => s.sourceId === "src-2");
    expect(src1!.retrieved).toBe(true);
    expect(src2!.retrieved).toBe(true);
  });

  it("marks sources as not retrieved when sourceId absent from audit event", async () => {
    wireDb([baseManifest], [{ ...baseAuditRow, sourceIds: ["src-1"] }], [baseCwRow], [baseBpRow]);
    const result = await getExecutionInspection(EXEC_ID, ORG_ID, ACTOR_ID, "org_user");
    const src2 = result!.evidence.sources.find(s => s.sourceId === "src-2");
    expect(src2!.retrieved).toBe(false);
  });

  it("includes task uploads in evidence sources", async () => {
    const result = await getExecutionInspection(EXEC_ID, ORG_ID, ACTOR_ID, "org_user");
    const tuSource = result!.evidence.sources.find(s => s.sourceId === "tu-1");
    expect(tuSource).toBeDefined();
    expect(tuSource!.title).toBe("Participant Care Plan");
  });

  it("evidence.totalChunks matches chunkIds length from audit row", async () => {
    const result = await getExecutionInspection(EXEC_ID, ORG_ID, ACTOR_ID, "org_user");
    expect(result!.evidence.totalChunks).toBe(3);
  });

  it("derives per-source confidence from scoreMetadata", async () => {
    const result = await getExecutionInspection(EXEC_ID, ORG_ID, ACTOR_ID, "org_user");
    const src1 = result!.evidence.sources.find(s => s.sourceId === "src-1");
    expect(src1!.confidence).toBeCloseTo(0.98, 2);
  });
});

describe("Blueprint Inspector", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockGetConversationTimeline.mockResolvedValue({
      conversationId: "conv-1", entries: [], isComplete: true, hasFailure: false,
    });
  });

  it("keyword selection: matchedPhrase populated, semanticReason null", async () => {
    wireDb([baseManifest], [baseAuditRow], [baseCwRow], [baseBpRow]);
    const result = await getExecutionInspection(EXEC_ID, ORG_ID, ACTOR_ID, "org_user");
    expect(result!.blueprint.selectionMethod).toBe("keyword");
    expect(result!.blueprint.matchedPhrase).toBeTruthy();
    expect(result!.blueprint.semanticReason).toBeNull();
  });

  it("semantic selection: semanticReason populated, matchedPhrase null", async () => {
    const m = { ...baseManifest, selectionMetadata: { method: "semantic", confidence: 0.82, matchedKeywords: [], fallbackUsed: false } };
    wireDb([m], [baseAuditRow], [baseCwRow], [baseBpRow]);
    const result = await getExecutionInspection(EXEC_ID, ORG_ID, ACTOR_ID, "org_user");
    expect(result!.blueprint.selectionMethod).toBe("semantic");
    expect(result!.blueprint.semanticReason).toBeTruthy();
    expect(result!.blueprint.matchedPhrase).toBeNull();
  });

  it("required knowledge shows retrieved=true for sources in manifest", async () => {
    wireDb([baseManifest], [baseAuditRow], [baseCwRow], [baseBpRow]);
    const result = await getExecutionInspection(EXEC_ID, ORG_ID, ACTOR_ID, "org_user");
    const policy = result!.blueprint.requiredKnowledge.find(k => k.name === "Medication Management Policy");
    expect(policy).toBeDefined();
    expect(policy!.retrieved).toBe(true);
  });

  it("validation missing items shown when validationSnapshot fails", async () => {
    const m = { ...baseManifest, validationSnapshot: { passed: false, missingItems: ["Incident policy"], summary: "Missing." } };
    wireDb([m], [baseAuditRow], [baseCwRow], [baseBpRow]);
    const result = await getExecutionInspection(EXEC_ID, ORG_ID, ACTOR_ID, "org_user");
    expect(result!.blueprint.validationPassed).toBe(false);
    expect(result!.blueprint.validationMissingItems).toEqual(["Incident policy"]);
  });
});

describe("Performance Metrics", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockGetConversationTimeline.mockResolvedValue({
      conversationId: "conv-1", entries: [], isComplete: true, hasFailure: false,
    });
  });

  it("all metric fields populated from performanceMetrics column", async () => {
    wireDb([baseManifest], [baseAuditRow], [baseCwRow], [baseBpRow]);
    const result = await getExecutionInspection(EXEC_ID, ORG_ID, ACTOR_ID, "org_user");
    const p = result!.performance;
    expect(p.blueprintSelectionMs).toBe(45);
    expect(p.validationMs).toBe(12);
    expect(p.retrievalMs).toBe(340);
    expect(p.llmMs).toBe(4200);
    expect(p.reviewMs).toBe(890);
    expect(p.totalMs).toBe(5600);
  });

  it("falls back to audit retrievalDurationMs when no performanceMetrics", async () => {
    const m = { ...baseManifest, performanceMetrics: null };
    wireDb([m], [baseAuditRow], [baseCwRow], [baseBpRow]);
    const result = await getExecutionInspection(EXEC_ID, ORG_ID, ACTOR_ID, "org_user");
    expect(result!.performance.retrievalMs).toBe(340);
  });

  it("evidenceCacheHit is false when performanceMetrics.evidenceCacheHit=false", async () => {
    wireDb([baseManifest], [baseAuditRow], [baseCwRow], [baseBpRow]);
    const result = await getExecutionInspection(EXEC_ID, ORG_ID, ACTOR_ID, "org_user");
    expect(result!.performance.evidenceCacheHit).toBe(false);
  });
});

describe("Runtime status derivation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockGetConversationTimeline.mockResolvedValue({
      conversationId: "conv-1", entries: [], isComplete: false, hasFailure: false,
    });
  });

  it("executing when draft status and no timeline completion and no failure", async () => {
    const m = { ...baseManifest, failureInfo: null };
    wireDb([m], [baseAuditRow], [{ ...baseCwRow, status: "draft" }], [baseBpRow]);
    const result = await getExecutionInspection(EXEC_ID, ORG_ID, ACTOR_ID, "org_user");
    expect(result!.summary.runtimeStatus).toBe("executing");
  });

  it("completed when completedWork.status=approved", async () => {
    mockGetConversationTimeline.mockResolvedValueOnce({
      conversationId: "conv-1", entries: [], isComplete: true, hasFailure: false,
    });
    wireDb([baseManifest], [baseAuditRow], [{ ...baseCwRow, status: "approved" }], [baseBpRow]);
    const result = await getExecutionInspection(EXEC_ID, ORG_ID, ACTOR_ID, "org_user");
    expect(result!.summary.runtimeStatus).toBe("completed");
  });

  it("failed when failureInfo.state=failed", async () => {
    const m = { ...baseManifest, failureInfo: { state: "failed", failedStage: "executing", rootCause: "err", retryAvailable: false } };
    wireDb([m], [baseAuditRow], [baseCwRow], [baseBpRow]);
    const result = await getExecutionInspection(EXEC_ID, ORG_ID, ACTOR_ID, "org_user");
    expect(result!.summary.runtimeStatus).toBe("failed");
  });

  it("awaiting_clarification when failureInfo.state=awaiting_clarification", async () => {
    const m = { ...baseManifest, failureInfo: { state: "awaiting_clarification", clarificationItems: [] } };
    wireDb([m], [baseAuditRow], [baseCwRow], [baseBpRow]);
    const result = await getExecutionInspection(EXEC_ID, ORG_ID, ACTOR_ID, "org_user");
    expect(result!.summary.runtimeStatus).toBe("awaiting_clarification");
  });
});
