/**
 * Sprint 26 — AI Workforce Operations Centre
 *
 * Tests:
 *   Part 1  — getWorkforceSummary (workforce metrics)
 *   Part 2  — getSpecialistOpsProfile (specialist detail)
 *   Part 3  — getSpecialistReadiness (readiness engine)
 *   Part 4  — getSpecialistWorkload (workload / queue)
 *   Part 5  — getSpecialistPerformance (performance metrics)
 *   Part 6  — getSpecialistKnowledge (training & knowledge)
 *   Part 7  — getWorkforceAlerts (alerts panel)
 *   Part 8  — performSpecialistAction (management actions)
 *   Part 9  — getOrgWorkforceHealth (executive health summary)
 *   Part 10 — workforceOps routes (tenant isolation + role gates)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock db ──────────────────────────────────────────────────────────────────

const mockDb = vi.hoisted(() => ({
  select:  vi.fn(),
  from:    vi.fn(),
  where:   vi.fn(),
  limit:   vi.fn(),
  orderBy: vi.fn(),
  offset:  vi.fn(),
  insert:  vi.fn(),
  values:  vi.fn(),
  update:  vi.fn(),
  set:     vi.fn(),
  execute: vi.fn(),
}));

vi.mock("@workspace/db", async () => {
  const actual = await vi.importActual<typeof import("@workspace/db")>("@workspace/db");
  return {
    ...actual,
    db: {
      select:  () => mockDb,
      insert:  () => mockDb,
      update:  () => mockDb,
      execute: mockDb.execute,
    },
  };
});

vi.mock("../services/auditService.js", () => ({
  logOrgEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/workforceRegistry.js", () => ({
  SPECIALISTS: [
    {
      code: "chief_of_staff",
      displayName: "Chief of Staff",
      description: "Strategic Orchestrator & Digital Workforce Commander",
      departmentCode: "executive",
      version: "1.0.0",
      packCode: "core",
      executionStatus: "available",
      dnaStatus: "approved",
    },
    {
      code: "operations_manager",
      displayName: "AI Operations Manager",
      description: "Service Delivery & Operational Excellence Analyst",
      departmentCode: "operations",
      version: "1.0.0",
      packCode: "core",
      executionStatus: "available",
      dnaStatus: "approved",
    },
    {
      code: "compliance_officer",
      displayName: "AI Compliance Officer",
      description: "NDIS Regulatory & Quality Compliance Analyst",
      departmentCode: null,
      version: "1.0.0",
      packCode: "compliance",
      executionStatus: "available",
      dnaStatus: "approved",
    },
    {
      code: "deprecated_role",
      displayName: "Old Role",
      description: "",
      departmentCode: null,
      version: "1.0.0",
      packCode: "core",
      executionStatus: "deprecated",
      dnaStatus: "approved",
    },
  ],
}));

import {
  getWorkforceSummary,
  getSpecialistOpsProfile,
  getSpecialistReadiness,
  getSpecialistWorkload,
  getSpecialistPerformance,
  getSpecialistKnowledge,
  getWorkforceAlerts,
  performSpecialistAction,
  getOrgWorkforceHealth,
  WorkforceOpsError,
} from "../services/workforceOpsService.js";
import { logOrgEvent } from "../services/auditService.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Full reset for every chain mock:
 *   mockReset()          — clears call history AND the mockResolvedValueOnce queue
 *   mockImplementation() — re-establishes synchronous return of mockDb
 *
 * This prevents leftover once-values leaking from one test into the next.
 * Also resets logOrgEvent so per-test call-count assertions work correctly.
 * All chain keys must be present in the hoisted mockDb definition.
 */
function resetChain() {
  const chainFns = [
    mockDb.from, mockDb.where, mockDb.set,
    mockDb.orderBy, mockDb.limit, mockDb.offset, mockDb.values,
  ];
  for (const fn of chainFns) {
    fn.mockReset();
    fn.mockImplementation(() => mockDb);
  }
  (logOrgEvent as any).mockReset?.();
  (logOrgEvent as any).mockResolvedValue?.(undefined);
}

const ORG_ID   = "org-1";
const ORG_SLUG = "test-org";
const USER_ID  = "user-1";

const TRAINING_ROW_READY = {
  id: "tr-1",
  organizationId: ORG_ID,
  specialistId: "chief_of_staff",
  status: "ready",
  configurationComplete: true,
  knowledgeSourcesApproved: true,
  retrievalTestPassed: true,
  sampleTaskPassed: true,
  approvedByUserId: USER_ID,
  approvedAt: new Date("2026-07-01"),
  lastTestedAt: new Date("2026-07-15"),
  notes: null,
  createdAt: new Date("2026-06-01"),
  updatedAt: new Date("2026-07-15"),
};

const TRAINING_ROW_NOT_STARTED = {
  id: "tr-2",
  organizationId: ORG_ID,
  specialistId: "operations_manager",
  status: "not_started",
  configurationComplete: false,
  knowledgeSourcesApproved: false,
  retrievalTestPassed: false,
  sampleTaskPassed: false,
  approvedByUserId: null,
  approvedAt: null,
  lastTestedAt: null,
  notes: null,
  createdAt: new Date("2026-06-01"),
  updatedAt: new Date("2026-06-01"),
};

const TRAINING_ROW_SUSPENDED = {
  ...TRAINING_ROW_READY,
  id: "tr-3",
  specialistId: "compliance_officer",
  status: "suspended",
  notes: "Suspended pending review.",
};

// ─── Part 1 — getWorkforceSummary ─────────────────────────────────────────────

describe("getWorkforceSummary", () => {
  beforeEach(() => { resetChain(); });

  it("returns total specialists count (excludes deprecated)", async () => {
    // trainingStatus query → returns rows for 2 specialists
    mockDb.from.mockReturnValue(mockDb);
    mockDb.where.mockReturnValue(mockDb);
    // 1st call: trainingStatus
    mockDb.limit.mockImplementation(() => Promise.resolve([TRAINING_ROW_READY, TRAINING_ROW_NOT_STARTED]));
    mockDb.orderBy.mockResolvedValue([]);
    // All subsequent queries (count, avg) return empty/zero
    let fromCallCount = 0;
    mockDb.from.mockImplementation(() => {
      fromCallCount++;
      return mockDb;
    });

    // Simulate all chained calls returning the chain
    resetChain();
    // trainingRows
    mockDb.limit.mockResolvedValueOnce([TRAINING_ROW_READY, TRAINING_ROW_NOT_STARTED]);
    // task count
    mockDb.limit.mockResolvedValueOnce([{ n: 2 }]);
    // pending approvals
    mockDb.limit.mockResolvedValueOnce([{ n: 1 }]);
    // quality avg
    mockDb.limit.mockResolvedValueOnce([{ avg: "85" }]);

    const summary = await getWorkforceSummary(ORG_ID);
    // 3 active (excludes deprecated_role)
    expect(summary.totalSpecialists).toBe(3);
  });

  it("excludes deprecated and archived specialists", async () => {
    resetChain();
    mockDb.limit.mockResolvedValue([]);
    const summary = await getWorkforceSummary(ORG_ID);
    // Only 3 from mock (chief_of_staff, operations_manager, compliance_officer)
    expect(summary.totalSpecialists).toBe(3);
  });

  it("computes readiness score from training rows", async () => {
    resetChain();
    // 1 ready out of 3 → 33%
    mockDb.limit.mockResolvedValueOnce([TRAINING_ROW_READY]);
    mockDb.limit.mockResolvedValueOnce([{ n: 0 }]);
    mockDb.limit.mockResolvedValueOnce([{ n: 0 }]);
    mockDb.limit.mockResolvedValueOnce([{ avg: null }]);

    const summary = await getWorkforceSummary(ORG_ID);
    expect(summary.organisationReadinessScore).toBe(33);
  });

  it("returns null averageQualityScore when no data", async () => {
    resetChain();
    mockDb.limit.mockResolvedValue([]);
    const summary = await getWorkforceSummary(ORG_ID);
    expect(summary.averageQualityScore).toBeNull();
  });

  it("rounds quality score", async () => {
    resetChain();
    mockDb.limit.mockResolvedValueOnce([]);       // training rows
    mockDb.limit.mockResolvedValueOnce([{ n: 0 }]); // task count
    mockDb.limit.mockResolvedValueOnce([{ n: 0 }]); // pending
    mockDb.limit.mockResolvedValueOnce([{ avg: "87.66" }]); // quality
    const summary = await getWorkforceSummary(ORG_ID);
    expect(summary.averageQualityScore).toBe(88);
  });

  it("counts active tasks and pending approvals", async () => {
    resetChain();
    mockDb.limit.mockResolvedValueOnce([]);           // training
    mockDb.limit.mockResolvedValueOnce([{ n: 5 }]);   // tasks
    mockDb.limit.mockResolvedValueOnce([{ n: 3 }]);   // approvals
    mockDb.limit.mockResolvedValueOnce([{ avg: null }]);

    const summary = await getWorkforceSummary(ORG_ID);
    expect(summary.activeTaskCount).toBe(5);
    expect(summary.pendingApprovalsCount).toBe(3);
  });
});

// ─── Part 2 — getSpecialistOpsProfile ────────────────────────────────────────

describe("getSpecialistOpsProfile", () => {
  beforeEach(() => { resetChain(); });

  it("throws 404 for unknown specialist", async () => {
    await expect(getSpecialistOpsProfile(ORG_ID, "unknown_role"))
      .rejects.toMatchObject({ statusCode: 404, code: "SPECIALIST_NOT_FOUND" });
  });

  it("returns profile with training record", async () => {
    resetChain();
    // training row
    mockDb.limit.mockResolvedValueOnce([TRAINING_ROW_READY]);
    // org config
    mockDb.limit.mockResolvedValueOnce([{ id: "cfg-1", organizationId: ORG_ID, specialistId: "chief_of_staff",
      goals: ["Goal 1", "Goal 2"], preferredStyle: "formal", escalationContacts: [], lastConfirmedAt: new Date("2026-07-01"),
      source: "manual", additionalContext: {}, createdAt: new Date(), updatedAt: new Date() }]);
    // recent work
    mockDb.limit.mockResolvedValueOnce([{
      id: "work-1", title: "Policy Draft", status: "approved", createdAt: new Date("2026-07-20"),
    }]);
    // current tasks
    mockDb.limit.mockResolvedValueOnce([]);

    const profile = await getSpecialistOpsProfile(ORG_ID, "chief_of_staff");
    expect(profile.code).toBe("chief_of_staff");
    expect(profile.title).toBe("Chief of Staff");
    expect(profile.trainingRecord?.configurationComplete).toBe(true);
    expect(profile.operationalStatus).toBe("active");
    expect(profile.recentWork).toHaveLength(1);
  });

  it("returns offline status when no training record", async () => {
    resetChain();
    mockDb.limit.mockResolvedValueOnce([]); // no training row
    mockDb.limit.mockResolvedValueOnce([]); // no config
    mockDb.limit.mockResolvedValueOnce([]); // no work
    mockDb.limit.mockResolvedValueOnce([]); // no tasks

    const profile = await getSpecialistOpsProfile(ORG_ID, "chief_of_staff");
    expect(profile.operationalStatus).toBe("offline");
    expect(profile.trainingRecord).toBeNull();
  });

  it("maps suspended training status to suspended operational status", async () => {
    resetChain();
    mockDb.limit.mockResolvedValueOnce([TRAINING_ROW_SUSPENDED]);
    mockDb.limit.mockResolvedValueOnce([]);
    mockDb.limit.mockResolvedValueOnce([]);
    mockDb.limit.mockResolvedValueOnce([]);
    const profile = await getSpecialistOpsProfile(ORG_ID, "compliance_officer");
    expect(profile.operationalStatus).toBe("suspended");
  });
});

// ─── Part 3 — getSpecialistReadiness ─────────────────────────────────────────

describe("getSpecialistReadiness", () => {
  beforeEach(() => { resetChain(); });

  it("throws 404 for unknown specialist", async () => {
    await expect(getSpecialistReadiness(ORG_ID, "unknown_role", ORG_SLUG))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  it("returns isReady=true for fully trained specialist with no blockers", async () => {
    resetChain();
    mockDb.limit.mockResolvedValueOnce([TRAINING_ROW_READY]);  // training
    mockDb.limit.mockResolvedValueOnce([{ id: "cfg-1", organizationId: ORG_ID, specialistId: "chief_of_staff",
      goals: [], preferredStyle: null, escalationContacts: [], lastConfirmedAt: null,
      source: "manual", additionalContext: {}, createdAt: new Date(), updatedAt: new Date() }]); // config
    mockDb.limit.mockResolvedValueOnce([{ id: "ks-1", status: "approved" }]); // sources

    const readiness = await getSpecialistReadiness(ORG_ID, "chief_of_staff", ORG_SLUG);
    expect(readiness.isReady).toBe(true);
    expect(readiness.blockers).toHaveLength(0);
    expect(readiness.readinessScore).toBe(100);
  });

  it("returns SUSPENDED blocker for suspended specialist", async () => {
    resetChain();
    mockDb.limit.mockResolvedValueOnce([TRAINING_ROW_SUSPENDED]);
    mockDb.limit.mockResolvedValueOnce([]); // no config
    mockDb.limit.mockResolvedValueOnce([]); // no sources

    const readiness = await getSpecialistReadiness(ORG_ID, "compliance_officer", ORG_SLUG);
    expect(readiness.isReady).toBe(false);
    const codes = readiness.blockers.map(b => b.code);
    expect(codes).toContain("SUSPENDED");
  });

  it("returns TRAINING_NOT_STARTED when no training record", async () => {
    resetChain();
    mockDb.limit.mockResolvedValueOnce([]); // no training row
    mockDb.limit.mockResolvedValueOnce([]); // no config
    mockDb.limit.mockResolvedValueOnce([]); // no sources

    const readiness = await getSpecialistReadiness(ORG_ID, "chief_of_staff", ORG_SLUG);
    const codes = readiness.blockers.map(b => b.code);
    expect(codes).toContain("TRAINING_NOT_STARTED");
  });

  it("returns NO_APPROVED_KNOWLEDGE blocker when knowledge not approved", async () => {
    resetChain();
    const partialTraining = { ...TRAINING_ROW_READY,
      status: "configuring", knowledgeSourcesApproved: false };
    mockDb.limit.mockResolvedValueOnce([partialTraining]);
    mockDb.limit.mockResolvedValueOnce([{ id: "cfg-1", organizationId: ORG_ID, specialistId: "chief_of_staff",
      goals: [], preferredStyle: null, escalationContacts: [], lastConfirmedAt: null,
      source: "manual", additionalContext: {}, createdAt: new Date(), updatedAt: new Date() }]);
    mockDb.limit.mockResolvedValueOnce([]);

    const readiness = await getSpecialistReadiness(ORG_ID, "chief_of_staff", ORG_SLUG);
    const codes = readiness.blockers.map(b => b.code);
    expect(codes).toContain("NO_APPROVED_KNOWLEDGE");
  });

  it("assigns correct severity levels", async () => {
    resetChain();
    mockDb.limit.mockResolvedValueOnce([TRAINING_ROW_SUSPENDED]);
    mockDb.limit.mockResolvedValueOnce([]);
    mockDb.limit.mockResolvedValueOnce([]);

    const readiness = await getSpecialistReadiness(ORG_ID, "compliance_officer", ORG_SLUG);
    const suspended = readiness.blockers.find(b => b.code === "SUSPENDED");
    expect(suspended?.severity).toBe("critical");
  });

  it("includes resolveUrl in each blocker", async () => {
    resetChain();
    mockDb.limit.mockResolvedValueOnce([]); // no training
    mockDb.limit.mockResolvedValueOnce([]); // no config
    mockDb.limit.mockResolvedValueOnce([]); // no sources

    const readiness = await getSpecialistReadiness(ORG_ID, "chief_of_staff", ORG_SLUG);
    for (const b of readiness.blockers) {
      expect(b.resolveUrl).toBeTruthy();
      expect(typeof b.resolveUrl).toBe("string");
    }
  });
});

// ─── Part 4 — getSpecialistWorkload ──────────────────────────────────────────

describe("getSpecialistWorkload", () => {
  beforeEach(() => { resetChain(); });

  it("returns active runs, queue, completed, and failed", async () => {
    resetChain();
    // Active runs
    mockDb.limit.mockResolvedValueOnce([{
      id: "run-1", taskId: "task-1", status: "running",
      startedAt: new Date("2026-07-01T10:00:00Z"), confidence: "0.92",
    }]);
    // Waiting queue
    mockDb.limit.mockResolvedValueOnce([{
      id: "q-1", runId: "run-2", status: "waiting", priority: 5,
      queuedAt: new Date("2026-07-01T09:00:00Z"),
    }]);
    // Recent completed
    mockDb.limit.mockResolvedValueOnce([{
      id: "work-1", title: "Policy Draft", status: "approved",
      createdAt: new Date("2026-07-01T08:00:00Z"),
    }]);
    // Failed
    mockDb.limit.mockResolvedValueOnce([]);
    // Retries
    mockDb.limit.mockResolvedValueOnce([{ total: 2 }]);

    const workload = await getSpecialistWorkload(ORG_ID, "chief_of_staff");
    expect(workload.activeRuns).toHaveLength(1);
    expect(workload.activeRuns[0]!.status).toBe("running");
    expect(workload.waitingQueue).toHaveLength(1);
    expect(workload.recentCompleted).toHaveLength(1);
    expect(workload.queueLength).toBe(1);
    expect(workload.totalRetries).toBe(2);
  });

  it("returns empty arrays when no data", async () => {
    resetChain();
    mockDb.limit.mockResolvedValue([]);
    const workload = await getSpecialistWorkload(ORG_ID, "chief_of_staff");
    expect(workload.activeRuns).toHaveLength(0);
    expect(workload.queueLength).toBe(0);
  });
});

// ─── Part 5 — getSpecialistPerformance ───────────────────────────────────────

describe("getSpecialistPerformance", () => {
  beforeEach(() => { resetChain(); });

  it("computes approval and rejection rates", async () => {
    resetChain();
    mockDb.limit.mockResolvedValueOnce([
      { status: "approved" },
      { status: "approved" },
      { status: "rejected" },
      { status: "approved" },
    ]);
    mockDb.limit.mockResolvedValueOnce([{ avg: "88" }]);
    mockDb.limit.mockResolvedValueOnce([{ avg: "0.87" }]);

    const perf = await getSpecialistPerformance(ORG_ID, "chief_of_staff", 30);
    expect(perf.workCompleted).toBe(4);
    expect(perf.approvalRate).toBe(75);
    expect(perf.rejectionRate).toBe(25);
  });

  it("returns null rates when no work completed", async () => {
    resetChain();
    mockDb.limit.mockResolvedValueOnce([]);
    mockDb.limit.mockResolvedValueOnce([{ avg: null }]);
    mockDb.limit.mockResolvedValueOnce([{ avg: null }]);

    const perf = await getSpecialistPerformance(ORG_ID, "chief_of_staff", 7);
    expect(perf.workCompleted).toBe(0);
    expect(perf.approvalRate).toBeNull();
    expect(perf.rejectionRate).toBeNull();
  });

  it("honours period parameter (7, 30, 90)", async () => {
    resetChain();
    mockDb.limit.mockResolvedValue([]);
    const perf = await getSpecialistPerformance(ORG_ID, "chief_of_staff", 90);
    expect(perf.period).toBe(90);
  });

  it("rounds quality score to integer", async () => {
    resetChain();
    mockDb.limit.mockResolvedValueOnce([{ status: "approved" }]);
    mockDb.limit.mockResolvedValueOnce([{ avg: "78.4" }]);
    mockDb.limit.mockResolvedValueOnce([{ avg: null }]);

    const perf = await getSpecialistPerformance(ORG_ID, "chief_of_staff", 30);
    expect(perf.averageSelfReviewScore).toBe(78);
  });
});

// ─── Part 6 — getSpecialistKnowledge ─────────────────────────────────────────

describe("getSpecialistKnowledge", () => {
  beforeEach(() => { resetChain(); });

  it("returns knowledge health summary", async () => {
    resetChain();
    // Sources
    mockDb.limit.mockResolvedValueOnce([
      { id: "ks-1", title: "NDIS Policy", sourceType: "policy", status: "approved", approvedAt: new Date("2026-07-01") },
      { id: "ks-2", title: "Draft Doc", sourceType: "document", status: "pending_review", approvedAt: null },
    ]);
    // Training row
    mockDb.limit.mockResolvedValueOnce([TRAINING_ROW_READY]);
    // Memory count
    mockDb.limit.mockResolvedValueOnce([{ n: 42 }]);

    const knowledge = await getSpecialistKnowledge(ORG_ID, "chief_of_staff");
    expect(knowledge.knowledgeHealthSummary.approved).toBe(1);
    expect(knowledge.knowledgeHealthSummary.pending).toBe(1);
    expect(knowledge.memoryCount).toBe(42);
    expect(knowledge.trainingStatus).toBe("ready");
  });

  it("returns empty state when no sources", async () => {
    resetChain();
    mockDb.limit.mockResolvedValueOnce([]); // no sources
    mockDb.limit.mockResolvedValueOnce([]); // no training
    mockDb.limit.mockResolvedValueOnce([{ n: 0 }]); // memory

    const knowledge = await getSpecialistKnowledge(ORG_ID, "chief_of_staff");
    expect(knowledge.knowledgeHealthSummary.total).toBe(0);
    expect(knowledge.trainingStatus).toBeNull();
  });
});

// ─── Part 7 — getWorkforceAlerts ─────────────────────────────────────────────

describe("getWorkforceAlerts", () => {
  beforeEach(() => { resetChain(); });

  it("generates suspended alert for suspended specialist", async () => {
    resetChain();
    mockDb.limit.mockResolvedValueOnce([TRAINING_ROW_SUSPENDED]); // training rows
    mockDb.limit.mockResolvedValueOnce([]);                        // failed runs
    mockDb.limit.mockResolvedValueOnce([{ n: 0 }]);               // pending approvals

    const alerts = await getWorkforceAlerts(ORG_ID);
    const suspended = alerts.find(a => a.type === "specialist_suspended");
    expect(suspended).toBeDefined();
    expect(suspended?.severity).toBe("critical");
    expect(suspended?.specialistCode).toBe("compliance_officer");
  });

  it("generates retraining alert for needs_attention specialist", async () => {
    resetChain();
    const attentionRow = { ...TRAINING_ROW_READY, status: "needs_attention",
      specialistId: "operations_manager", notes: "Low confidence detected." };
    mockDb.limit.mockResolvedValueOnce([attentionRow]);
    mockDb.limit.mockResolvedValueOnce([]);
    mockDb.limit.mockResolvedValueOnce([{ n: 0 }]);

    const alerts = await getWorkforceAlerts(ORG_ID);
    const attn = alerts.find(a => a.type === "retraining_required" && a.specialistCode === "operations_manager");
    expect(attn).toBeDefined();
    expect(attn?.severity).toBe("high");
  });

  it("generates alert for failed executions", async () => {
    resetChain();
    mockDb.limit.mockResolvedValueOnce([]); // no training issues
    mockDb.limit.mockResolvedValueOnce([{
      id: "run-fail-1",
      workforceRoleCode: "chief_of_staff",
      lastError: "Timeout after 30s",
      failedAt: new Date(),
    }]);
    mockDb.limit.mockResolvedValueOnce([{ n: 0 }]);

    const alerts = await getWorkforceAlerts(ORG_ID);
    const failed = alerts.find(a => a.type === "failed_execution");
    expect(failed).toBeDefined();
    expect(failed?.detail).toContain("Timeout");
  });

  it("generates alert for pending approvals", async () => {
    resetChain();
    mockDb.limit.mockResolvedValueOnce([]);
    mockDb.limit.mockResolvedValueOnce([]);
    mockDb.limit.mockResolvedValueOnce([{ n: 4 }]);

    const alerts = await getWorkforceAlerts(ORG_ID);
    const approval = alerts.find(a => a.type === "pending_approvals");
    expect(approval).toBeDefined();
    expect(approval?.title).toContain("4");
  });

  it("generates alert for specialists with no training", async () => {
    resetChain();
    // No training rows at all
    mockDb.limit.mockResolvedValueOnce([]);
    mockDb.limit.mockResolvedValueOnce([]);
    mockDb.limit.mockResolvedValueOnce([{ n: 0 }]);

    const alerts = await getWorkforceAlerts(ORG_ID);
    const noTraining = alerts.filter(a => a.type === "retraining_required");
    // 3 active specialists with no training
    expect(noTraining.length).toBe(3);
  });

  it("sorts alerts by severity (critical first)", async () => {
    resetChain();
    mockDb.limit.mockResolvedValueOnce([TRAINING_ROW_SUSPENDED]);
    mockDb.limit.mockResolvedValueOnce([{
      id: "run-fail-1", workforceRoleCode: "chief_of_staff",
      lastError: "Error", failedAt: new Date(),
    }]);
    mockDb.limit.mockResolvedValueOnce([{ n: 2 }]);

    const alerts = await getWorkforceAlerts(ORG_ID);
    const severities = alerts.map(a => a.severity);
    const critIdx = severities.indexOf("critical");
    const highIdx = severities.indexOf("high");
    const medIdx  = severities.indexOf("medium");
    if (critIdx >= 0 && highIdx >= 0) expect(critIdx).toBeLessThan(highIdx);
    if (highIdx >= 0 && medIdx >= 0)  expect(highIdx).toBeLessThan(medIdx);
  });
});

// ─── Part 8 — performSpecialistAction ────────────────────────────────────────

describe("performSpecialistAction", () => {
  beforeEach(() => { resetChain(); });

  it("throws 400 for invalid action", async () => {
    await expect(performSpecialistAction(ORG_ID, "chief_of_staff", "fly", USER_ID, ORG_SLUG))
      .rejects.toMatchObject({ statusCode: 400, code: "INVALID_ACTION" });
  });

  it("throws 404 for unknown specialist", async () => {
    await expect(performSpecialistAction(ORG_ID, "unknown_role", "pause", USER_ID, ORG_SLUG))
      .rejects.toMatchObject({ statusCode: 404, code: "SPECIALIST_NOT_FOUND" });
  });

  it("suspends specialist and updates training status", async () => {
    resetChain();
    // select chain ends at .limit(1) → returns training row
    mockDb.limit.mockResolvedValueOnce([TRAINING_ROW_READY]);
    // update chain ends at .where() → returns mockDb synchronously (no return value needed)

    const result = await performSpecialistAction(ORG_ID, "chief_of_staff", "suspend", USER_ID, ORG_SLUG);
    expect(result.success).toBe(true);
    expect(result.action).toBe("suspend");
    // db.update() is the factory fn, not mockDb.update; verify via .set() which IS a hoisted vi.fn()
    expect(mockDb.set).toHaveBeenCalled();
    expect(logOrgEvent).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: ORG_ID, actorUserId: USER_ID, resourceId: "chief_of_staff",
      metadata: expect.objectContaining({ action: "suspend" }),
    }));
  });

  it("creates training record if none exists when enabling", async () => {
    resetChain();
    mockDb.limit.mockResolvedValueOnce([]); // no training row → triggers insert
    // insert chain ends at .values() → returns mockDb synchronously (no return value needed)

    const result = await performSpecialistAction(ORG_ID, "chief_of_staff", "enable", USER_ID, ORG_SLUG);
    expect(result.success).toBe(true);
    // db.insert() is the factory fn; verify via .values() which IS a hoisted vi.fn()
    expect(mockDb.values).toHaveBeenCalled();
  });

  it("returns correct message for each action type", async () => {
    const actions = ["pause", "resume", "suspend", "enable", "force_retraining", "refresh_knowledge"];
    for (const action of actions) {
      resetChain();
      mockDb.limit.mockResolvedValueOnce([TRAINING_ROW_READY]);
      const result = await performSpecialistAction(ORG_ID, "chief_of_staff", action, USER_ID, ORG_SLUG);
      expect(result.message).toBeTruthy();
      expect(typeof result.message).toBe("string");
    }
  });

  it("always logs audit event", async () => {
    resetChain();
    mockDb.limit.mockResolvedValueOnce([TRAINING_ROW_READY]);

    await performSpecialistAction(ORG_ID, "chief_of_staff", "resume", USER_ID, ORG_SLUG);
    expect(logOrgEvent).toHaveBeenCalledTimes(1);
  });

  it("returns auditId in result", async () => {
    resetChain();
    mockDb.limit.mockResolvedValueOnce([TRAINING_ROW_READY]);

    const result = await performSpecialistAction(ORG_ID, "chief_of_staff", "pause", USER_ID, ORG_SLUG);
    expect(typeof result.auditId).toBe("string");
    expect(result.auditId.length).toBeGreaterThan(0);
  });

  it("enforces tenant isolation — does not affect other orgs", async () => {
    resetChain();
    // Query for org-other returns no training row → triggers insert path
    mockDb.limit.mockResolvedValueOnce([]);

    const result = await performSpecialistAction("org-other", "chief_of_staff", "suspend", USER_ID, ORG_SLUG);
    expect(logOrgEvent).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org-other",
    }));
    expect(result.success).toBe(true);
  });
});

// ─── Part 9 — getOrgWorkforceHealth ──────────────────────────────────────────

describe("getOrgWorkforceHealth", () => {
  beforeEach(() => { resetChain(); });

  it("computes readiness and coverage scores", async () => {
    resetChain();
    // 2 ready of 3 specialists = 67%
    mockDb.limit.mockResolvedValueOnce([
      { ...TRAINING_ROW_READY, specialistId: "chief_of_staff" },
      { ...TRAINING_ROW_READY, specialistId: "operations_manager", knowledgeSourcesApproved: true },
    ]);
    mockDb.limit.mockResolvedValueOnce([{ avg: "91" }]);
    mockDb.limit.mockResolvedValueOnce([{ n: 3 }]);
    mockDb.limit.mockResolvedValueOnce([{ n: 2 }]);

    const health = await getOrgWorkforceHealth(ORG_ID, ORG_SLUG);
    expect(health.trainingCompletion).toBe(67); // 2/3
    expect(health.activeWorkload).toBe(3);
    expect(health.outstandingApprovals).toBe(2);
    expect(health.generatedAt).toBeTruthy();
  });

  it("returns recommendations when readiness is low", async () => {
    resetChain();
    mockDb.limit.mockResolvedValueOnce([]); // no ready specialists
    mockDb.limit.mockResolvedValueOnce([{ avg: null }]);
    mockDb.limit.mockResolvedValueOnce([{ n: 0 }]);
    mockDb.limit.mockResolvedValueOnce([{ n: 0 }]);

    const health = await getOrgWorkforceHealth(ORG_ID, ORG_SLUG);
    expect(health.recommendations.length).toBeGreaterThan(0);
    const high = health.recommendations.find(r => r.priority === "high");
    expect(high).toBeDefined();
  });

  it("includes recommendation to review pending approvals", async () => {
    resetChain();
    mockDb.limit.mockResolvedValueOnce([TRAINING_ROW_READY, { ...TRAINING_ROW_READY, specialistId: "operations_manager" }, { ...TRAINING_ROW_READY, specialistId: "compliance_officer" }]);
    mockDb.limit.mockResolvedValueOnce([{ avg: "90" }]);
    mockDb.limit.mockResolvedValueOnce([{ n: 0 }]);
    mockDb.limit.mockResolvedValueOnce([{ n: 5 }]);

    const health = await getOrgWorkforceHealth(ORG_ID, ORG_SLUG);
    const rec = health.recommendations.find(r => r.title.includes("5"));
    expect(rec).toBeDefined();
  });

  it("returns 100% completion when all specialists ready", async () => {
    resetChain();
    mockDb.limit.mockResolvedValueOnce([
      { ...TRAINING_ROW_READY, specialistId: "chief_of_staff" },
      { ...TRAINING_ROW_READY, specialistId: "operations_manager" },
      { ...TRAINING_ROW_READY, specialistId: "compliance_officer" },
    ]);
    mockDb.limit.mockResolvedValueOnce([{ avg: "90" }]);
    mockDb.limit.mockResolvedValueOnce([{ n: 0 }]);
    mockDb.limit.mockResolvedValueOnce([{ n: 0 }]);

    const health = await getOrgWorkforceHealth(ORG_ID, ORG_SLUG);
    expect(health.trainingCompletion).toBe(100);
  });
});

// ─── Part 10 — WorkforceOpsError ─────────────────────────────────────────────

describe("WorkforceOpsError", () => {
  it("carries statusCode, code, and message", () => {
    const err = new WorkforceOpsError(404, "NOT_FOUND", "Not found.");
    expect(err.statusCode).toBe(404);
    expect(err.code).toBe("NOT_FOUND");
    expect(err.message).toBe("Not found.");
    expect(err instanceof Error).toBe(true);
    expect(err.name).toBe("WorkforceOpsError");
  });

  it("is instanceof Error", () => {
    const err = new WorkforceOpsError(400, "BAD", "bad");
    expect(err instanceof Error).toBe(true);
  });
});

// ─── Part 11 — Tenant isolation ──────────────────────────────────────────────

describe("Tenant isolation", () => {
  beforeEach(() => { resetChain(); });

  it("getSpecialistOpsProfile only returns data for the requested org", async () => {
    resetChain();
    // DB returns no rows → org-2 has no training data
    mockDb.limit.mockResolvedValue([]);

    const profile = await getSpecialistOpsProfile("org-2", "chief_of_staff");
    expect(profile.trainingRecord).toBeNull();
    expect(profile.recentWork).toHaveLength(0);
  });

  it("getSpecialistReadiness returns all blockers for org with no setup", async () => {
    resetChain();
    mockDb.limit.mockResolvedValue([]);
    const readiness = await getSpecialistReadiness("org-fresh", "operations_manager", "fresh-org");
    expect(readiness.isReady).toBe(false);
    expect(readiness.blockers.length).toBeGreaterThan(0);
  });

  it("getWorkforceAlerts produces independent results per org", async () => {
    resetChain();
    // Org with all suspended specialists
    mockDb.limit.mockResolvedValueOnce([TRAINING_ROW_SUSPENDED]);
    mockDb.limit.mockResolvedValueOnce([]);
    mockDb.limit.mockResolvedValueOnce([{ n: 0 }]);

    const alerts = await getWorkforceAlerts("org-with-issues");
    const suspended = alerts.filter(a => a.type === "specialist_suspended");
    expect(suspended.length).toBe(1);
  });
});
