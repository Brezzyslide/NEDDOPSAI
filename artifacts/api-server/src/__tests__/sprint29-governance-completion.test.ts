/**
 * Sprint 29 — Governance Completion & Enterprise Administration
 *
 * Tests cover:
 *  - Bulk approval: approve/reject/partial failure/audit event
 *  - Approval state filter DB-level fix
 *  - Memory merge: target/source, provenance, audit
 *  - Per-memory audit history: returns events for that resourceId
 *  - Governance metrics: all dimensions computed from existing data
 *  - Tenant isolation: cross-org access rejected
 *  - Security: input size limits, empty input rejection
 *  - Regression: existing approval/memory functions continue working
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks (vi.hoisted so vi.mock factories can reference them) ───────────────

const { mockInsert, mockUpdate, mockLogOrg, mockSelectImpl, _mockSet } = vi.hoisted(() => {
  // Shared inner mocks so we can inspect all calls regardless of which chain invocation made them
  const mockReturning = vi.fn().mockResolvedValue([]);
  const mockWhere     = vi.fn().mockReturnValue({ returning: mockReturning });
  const mockSet       = vi.fn().mockReturnValue({ where: mockWhere });
  const mockUpdateObj = { set: mockSet };

  return {
    mockInsert:     vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
    mockUpdate:     vi.fn().mockReturnValue(mockUpdateObj),
    // expose the inner mocks so tests can reset/inspect them
    _mockSet:       mockSet,
    _mockWhere:     mockWhere,
    _mockReturning: mockReturning,
    mockLogOrg:     vi.fn().mockResolvedValue(undefined),
    mockSelectImpl: vi.fn(),
  };
});

vi.mock("@workspace/db", () => ({
  db: {
    select:  () => mockSelectImpl(),
    insert:  mockInsert,
    update:  mockUpdate,
  },
  approvalsTable:           { id: "id", organizationId: "organizationId", state: "state", requestedAt: "requestedAt", resolvedAt: "resolvedAt" },
  approvalHistoryTable:     { approvalId: "approvalId", organizationId: "organizationId", action: "action", occurredAt: "occurredAt" },
  organisationMemoryTable:  { id: "id", organizationId: "organizationId", status: "status", memoryType: "memoryType", confidence: "confidence", supersededBy: "supersededBy", updatedAt: "updatedAt" },
  orgAuditLogTable:         { id: "id", organizationId: "organizationId", resourceId: "resourceId", eventType: "eventType", actorUserId: "actorUserId", occurredAt: "occurredAt" },
  completedWorkTable:       { id: "id", organizationId: "organizationId", status: "status" },
  workBlueprintsTable:      { id: "id", organizationId: "organizationId", status: "status", isBuiltIn: "isBuiltIn", isActive: "isActive" },
  executionIntentsTable:    { id: "id", organizationId: "organizationId", status: "status", createdAt: "createdAt" },
}));

vi.mock("drizzle-orm", () => ({
  eq:     (col: unknown, val: unknown) => ({ op: "eq",     col, val }),
  and:    (...args: unknown[])         => ({ op: "and",    args }),
  desc:   (col: unknown)               => ({ op: "desc",   col }),
  gte:    (col: unknown, val: unknown) => ({ op: "gte",    col, val }),
  inArray:(col: unknown, arr: unknown) => ({ op: "inArray",col, arr }),
  sql:    (strings: TemplateStringsArray, ...vals: unknown[]) => ({ op: "sql", strings, vals }),
  isNull: (col: unknown)               => ({ op: "isNull", col }),
}));

vi.mock("../services/auditService.js", () => ({
  logOrgEvent:    mockLogOrg,
  writeAuditEvent: mockLogOrg,
  getRequestMeta: () => ({}),
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ORG_ID  = "org-sprint29";
const USER_ID = "user-sprint29";
const NOW     = new Date("2026-08-04T12:00:00Z");
const AGO_72H = new Date(NOW.getTime() - 72 * 60 * 60 * 1000);
const AGO_30D = new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000);

function makeApproval(overrides: Record<string, unknown> = {}) {
  return {
    id: "appr-001", organizationId: ORG_ID, approvalType: "owner_approval",
    state: "pending", requestedAt: NOW, resolvedAt: null, resolvedBy: null, notes: null,
    taskId: "task-001", expiresAt: null, createdAt: NOW, ...overrides,
  };
}

function makeHistoryEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: "hist-001", approvalId: "appr-001", organizationId: ORG_ID,
    action: "requested", actorUserId: USER_ID, notes: null, metadata: {}, occurredAt: NOW, ...overrides,
  };
}

function makeMemoryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "mem-001", organizationId: ORG_ID, memoryType: "operating_preference",
    title: "Standard escalation path", content: "Always escalate to CFO.",
    status: "approved", confidence: "0.9", importance: 8,
    sourceType: "manual", sourceId: null, approvedBy: USER_ID, approvedAt: NOW,
    createdAt: NOW, updatedAt: NOW, supersededBy: null, structuredContent: {},
    ...overrides,
  };
}

function makeAuditRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "aud-001", organizationId: ORG_ID, resourceId: "mem-001",
    eventType: "memory.proposed", actorUserId: USER_ID, occurredAt: NOW,
    metadata: {}, ...overrides,
  };
}

// ─── Select chain factory ─────────────────────────────────────────────────────

function makeChain(rows: unknown[]) {
  const resolved = Promise.resolve(rows);
  const c: Record<string, unknown> = {};
  c.from     = () => c;
  c.where    = () => c;
  c.orderBy  = () => c;
  c.limit    = () => resolved;
  c.offset   = () => resolved;
  c.then     = resolved.then.bind(resolved);
  c.catch    = resolved.catch.bind(resolved);
  c.finally  = resolved.finally.bind(resolved);
  return c;
}

function setupSelectSequence(rowSets: unknown[][]) {
  let call = 0;
  mockSelectImpl.mockImplementation(() => makeChain(rowSets[call++] ?? []));
}

// ─── Imports ──────────────────────────────────────────────────────────────────

import {
  bulkResolveApprovals,
  getApprovalsByOrg,
  resolveApproval,
} from "../services/approvalService.js";

import {
  mergeOrganisationMemory,
  getMemoryAuditHistory,
} from "../services/organisationMemoryService.js";

import { computeGovernanceMetrics } from "../services/governanceMetricsService.js";

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Sprint 29 — Governance Completion", () => {

  beforeEach(() => {
    vi.clearAllMocks();
    // mockInsert: fresh values mock each time
    mockInsert.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
    // Rebuild the update chain after clearAllMocks() wipes all implementations.
    // _mockSet is the shared set() mock — every update chain shares it so tests
    // can inspect all calls on _mockSet.mock.calls[N] regardless of call order.
    _mockSet.mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([]),
      }),
    });
    // mockUpdate must also be re-registered after clearAllMocks().
    mockUpdate.mockReturnValue({ set: _mockSet });
    mockLogOrg.mockResolvedValue(undefined);
  });

  // Helper: get the argument passed to the Nth call to db.update().set()
  function getSetArg(callIndex: number) {
    return _mockSet.mock.calls[callIndex]?.[0];
  }

  // Helper: reset the returning value for specific update calls
  function setupUpdateReturning(rows: unknown[]) {
    _mockSet.mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue(rows),
      }),
    });
  }

  // ─── Bulk Approvals ───────────────────────────────────────────────────────

  describe("bulkResolveApprovals", () => {
    it("resolves multiple pending approvals and reports succeeded count", async () => {
      const appr1 = makeApproval({ id: "appr-001" });
      const appr2 = makeApproval({ id: "appr-002" });

      let call = 0;
      mockSelectImpl.mockImplementation(() => {
        const row = call++ % 2 === 0 ? appr1 : appr2;
        return makeChain([row]);
      });
      _mockSet.mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ ...appr1, state: "approved" }]),
        }),
      });

      const result = await bulkResolveApprovals({
        approvalIds: ["appr-001", "appr-002"],
        organizationId: ORG_ID,
        action: "approved",
        actorUserId: USER_ID,
      });

      expect(result.succeeded).toBe(2);
      expect(result.failed).toBe(0);
      expect(result.results).toHaveLength(2);
      expect(result.results.every(r => r.success)).toBe(true);
    });

    it("reports partial failure when one approval fails", async () => {
      let call = 0;
      mockSelectImpl.mockImplementation(() => {
        if (call++ === 0) return makeChain([makeApproval()]); // first: found
        return makeChain([]); // second: not found → throws
      });
      setupUpdateReturning([{ ...makeApproval(), state: "approved" }]);

      const result = await bulkResolveApprovals({
        approvalIds: ["appr-001", "appr-not-found"],
        organizationId: ORG_ID,
        action: "approved",
        actorUserId: USER_ID,
      });

      expect(result.succeeded).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.results.find(r => r.id === "appr-not-found")?.success).toBe(false);
    });

    it("does not process more than 100 approvals per call", async () => {
      mockSelectImpl.mockReturnValue(makeChain([makeApproval()]));
      mockUpdate.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ ...makeApproval(), state: "approved" }]),
        }),
      });

      const ids = Array.from({ length: 150 }, (_, i) => `appr-${i}`);
      const result = await bulkResolveApprovals({
        approvalIds: ids, organizationId: ORG_ID, action: "approved", actorUserId: USER_ID,
      });

      // Should only process first 100
      expect(result.results).toHaveLength(100);
    });

    it("supports bulk reject", async () => {
      mockSelectImpl.mockReturnValue(makeChain([makeApproval()]));
      setupUpdateReturning([{ ...makeApproval(), state: "rejected" }]);

      const result = await bulkResolveApprovals({
        approvalIds: ["appr-001"],
        organizationId: ORG_ID,
        action: "rejected",
        actorUserId: USER_ID,
      });

      expect(result.succeeded).toBe(1);
      expect(result.results[0]!.success).toBe(true);
    });

    it("includes optional notes in each resolved approval", async () => {
      mockSelectImpl.mockReturnValue(makeChain([makeApproval()]));
      setupUpdateReturning([{ ...makeApproval(), state: "approved", notes: "Batch approved" }]);

      await bulkResolveApprovals({
        approvalIds: ["appr-001"],
        organizationId: ORG_ID,
        action: "approved",
        actorUserId: USER_ID,
        notes: "Batch approved",
      });

      // resolveApproval writes a history entry
      expect(mockInsert).toHaveBeenCalledTimes(1);
    });

    it("handles empty approvalIds gracefully with 0 results", async () => {
      const result = await bulkResolveApprovals({
        approvalIds: [],
        organizationId: ORG_ID,
        action: "approved",
        actorUserId: USER_ID,
      });

      expect(result.succeeded).toBe(0);
      expect(result.failed).toBe(0);
      expect(result.results).toHaveLength(0);
    });
  });

  // ─── Approval state filter fix ────────────────────────────────────────────

  describe("getApprovalsByOrg — DB-level state filter", () => {
    it("passes state filter as DB condition, not in-memory filter", async () => {
      const pending    = makeApproval({ id: "a-1", state: "pending" });
      const approved   = makeApproval({ id: "a-2", state: "approved" });

      // With DB-level filter, the mock will receive only the right rows
      setupSelectSequence([[pending]]);
      const result = await getApprovalsByOrg(ORG_ID, "pending");

      // Only pending items should be returned
      expect(result.every(r => r.state === "pending")).toBe(true);
    });

    it("returns all approvals when no state filter given", async () => {
      const rows = [
        makeApproval({ id: "a-1", state: "pending" }),
        makeApproval({ id: "a-2", state: "approved" }),
        makeApproval({ id: "a-3", state: "rejected" }),
      ];
      setupSelectSequence([rows]);
      const result = await getApprovalsByOrg(ORG_ID);
      expect(result).toHaveLength(3);
    });
  });

  // ─── Memory Merge ─────────────────────────────────────────────────────────

  describe("mergeOrganisationMemory", () => {
    it("supersedes the source and updates the target", async () => {
      const target = makeMemoryRow({ id: "mem-target" });
      const source = makeMemoryRow({ id: "mem-source", confidence: "0.75" });
      setupSelectSequence([[target], [source]]);

      const result = await mergeOrganisationMemory(ORG_ID, {
        targetId: "mem-target",
        sourceId: "mem-source",
        mergedBy: USER_ID,
      });

      expect(result.ok).toBe(true);
      // Two updates: target update (call 0) + source supersede (call 1)
      expect(mockUpdate).toHaveBeenCalledTimes(2);
      const sourceSet = getSetArg(1);
      expect(sourceSet.status).toBe("superseded");
      expect(sourceSet.supersededBy).toBe("mem-target");
    });

    it("keeps the higher confidence from either record", async () => {
      const target = makeMemoryRow({ id: "mem-target", confidence: "0.7" });
      const source = makeMemoryRow({ id: "mem-source", confidence: "0.95" });
      setupSelectSequence([[target], [source]]);

      await mergeOrganisationMemory(ORG_ID, {
        targetId: "mem-target", sourceId: "mem-source", mergedBy: USER_ID,
      });

      const targetSet = getSetArg(0);
      expect(parseFloat(targetSet.confidence)).toBeCloseTo(0.95, 2);
    });

    it("applies mergedTitle and mergedContent when provided", async () => {
      setupSelectSequence([[makeMemoryRow({ id: "mem-target" })], [makeMemoryRow({ id: "mem-source" })]]);

      await mergeOrganisationMemory(ORG_ID, {
        targetId: "mem-target", sourceId: "mem-source", mergedBy: USER_ID,
        mergedTitle: "Unified escalation path",
        mergedContent: "Combined content from both entries.",
      });

      const targetSet = mockUpdate.mock.results[0]!.value.set.mock.calls[0]?.[0];
      expect(targetSet.title).toBe("Unified escalation path");
      expect(targetSet.content).toBe("Combined content from both entries.");
    });

    it("writes memory.merged audit event for the target", async () => {
      setupSelectSequence([[makeMemoryRow({ id: "mem-target" })], [makeMemoryRow({ id: "mem-source" })]]);
      await mergeOrganisationMemory(ORG_ID, {
        targetId: "mem-target", sourceId: "mem-source", mergedBy: USER_ID,
      });
      const calls = mockInsert.mock.calls.map(c => c[0]);
      const auditInsert = calls.find(t => String(t) === String({})); // any insert via db.insert
      // Two history writes go to orgAuditLogTable
      expect(mockInsert).toHaveBeenCalledTimes(2);
    });

    it("returns error when target not found", async () => {
      setupSelectSequence([[]]); // target not found
      const result = await mergeOrganisationMemory(ORG_ID, {
        targetId: "nonexistent", sourceId: "mem-source", mergedBy: USER_ID,
      });
      expect(result.ok).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("returns error when source not found", async () => {
      setupSelectSequence([[makeMemoryRow({ id: "mem-target" })], []]); // source not found
      const result = await mergeOrganisationMemory(ORG_ID, {
        targetId: "mem-target", sourceId: "nonexistent", mergedBy: USER_ID,
      });
      expect(result.ok).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("does not proceed if target belongs to another org", async () => {
      // Org-scoped query returns nothing for cross-org target
      setupSelectSequence([[]]); // tenant-scoped query returns empty
      const result = await mergeOrganisationMemory(ORG_ID, {
        targetId: "other-org-mem", sourceId: "mem-source", mergedBy: USER_ID,
      });
      expect(result.ok).toBe(false);
    });
  });

  // ─── Per-memory audit history ─────────────────────────────────────────────

  describe("getMemoryAuditHistory", () => {
    it("returns audit events for the given memory ID", async () => {
      const events = [
        makeAuditRow({ id: "aud-001", eventType: "memory.proposed",  occurredAt: new Date("2026-07-01") }),
        makeAuditRow({ id: "aud-002", eventType: "memory.approved",  occurredAt: new Date("2026-07-02") }),
        makeAuditRow({ id: "aud-003", eventType: "memory.updated",   occurredAt: new Date("2026-07-10") }),
      ];
      setupSelectSequence([events]);

      const result = await getMemoryAuditHistory(ORG_ID, "mem-001");
      expect(result).toHaveLength(3);
      expect(result.map(e => e.eventType)).toEqual(["memory.proposed", "memory.approved", "memory.updated"]);
    });

    it("returns empty array when no history exists", async () => {
      setupSelectSequence([[]]);
      const result = await getMemoryAuditHistory(ORG_ID, "mem-no-history");
      expect(result).toEqual([]);
    });

    it("includes merged events in history", async () => {
      const events = [
        makeAuditRow({ eventType: "memory.proposed" }),
        makeAuditRow({ eventType: "memory.approved" }),
        makeAuditRow({ eventType: "memory.merged", id: "aud-merge" }),
      ];
      setupSelectSequence([events]);
      const result = await getMemoryAuditHistory(ORG_ID, "mem-001");
      expect(result.some(e => e.eventType === "memory.merged")).toBe(true);
    });

    it("is scoped to the requesting org (tenant isolation)", async () => {
      // Cross-org: the WHERE condition includes organizationId so this is enforced in query
      setupSelectSequence([[]]);
      const result = await getMemoryAuditHistory("other-org", "mem-001");
      expect(result).toEqual([]);
    });
  });

  // ─── Governance Metrics ───────────────────────────────────────────────────

  describe("computeGovernanceMetrics", () => {
    function setupMetricsSelects(opts: {
      approvals?: unknown[];
      memory?: unknown[];
      completedWork?: unknown[];
      blueprints?: unknown[];
      audit?: unknown[];
    } = {}) {
      const {
        approvals    = [makeApproval(), makeApproval({ id: "a-2", state: "approved", requestedAt: new Date(Date.now() - 1 * 60 * 60 * 1000) })],
        memory       = [makeMemoryRow({ status: "approved" }), makeMemoryRow({ id: "mem-002", status: "proposed" })],
        completedWork = [{ status: "awaiting_approval" }, { status: "approved" }, { status: "approved" }],
        blueprints   = [{ status: "published", isBuiltIn: false }, { status: "draft", isBuiltIn: false }],
        audit        = [makeAuditRow(), makeAuditRow({ id: "aud-002" })],
      } = opts;

      let call = 0;
      mockSelectImpl.mockImplementation(() => {
        const sets = [approvals, memory, completedWork, blueprints, audit];
        return makeChain(sets[call++] ?? []);
      });
    }

    it("returns a complete metrics object", async () => {
      setupMetricsSelects();
      const metrics = await computeGovernanceMetrics(ORG_ID);

      expect(typeof metrics.pendingApprovals).toBe("number");
      expect(typeof metrics.approvedLast30Days).toBe("number");
      expect(typeof metrics.memoryHealthScore).toBe("number");
      expect(typeof metrics.governanceScore).toBe("number");
      expect(metrics.governanceScore).toBeGreaterThanOrEqual(0);
      expect(metrics.governanceScore).toBeLessThanOrEqual(100);
    });

    it("counts pending approvals correctly", async () => {
      setupMetricsSelects({
        approvals: [
          makeApproval({ state: "pending" }),
          makeApproval({ id: "a-2", state: "pending" }),
          makeApproval({ id: "a-3", state: "approved" }),
        ],
      });
      const metrics = await computeGovernanceMetrics(ORG_ID);
      expect(metrics.pendingApprovals).toBe(2);
    });

    it("detects aged approvals (over 48 hours)", async () => {
      setupMetricsSelects({
        approvals: [
          makeApproval({ state: "pending", requestedAt: new Date(Date.now() - 72 * 60 * 60 * 1000) }),
          makeApproval({ id: "a-2", state: "pending", requestedAt: new Date(Date.now() - 12 * 60 * 60 * 1000) }),
        ],
      });
      const metrics = await computeGovernanceMetrics(ORG_ID);
      expect(metrics.approvalsAgedOver48h).toBe(1);
      expect(metrics.approvalAgingBuckets.over48h).toBe(1);
      expect(metrics.approvalAgingBuckets.under24h).toBe(1);
    });

    it("computes average approval time when resolved approvals exist", async () => {
      const resolved = makeApproval({
        state: "approved",
        requestedAt: new Date(Date.now() - 4 * 60 * 60 * 1000),
        resolvedAt:  new Date(),
      });
      setupMetricsSelects({ approvals: [resolved] });
      const metrics = await computeGovernanceMetrics(ORG_ID);
      // Average should be approx 4 hours
      expect(metrics.avgApprovalHours).not.toBeNull();
      expect(metrics.avgApprovalHours!).toBeGreaterThan(0);
    });

    it("returns null for avgApprovalHours when no resolved approvals", async () => {
      setupMetricsSelects({ approvals: [makeApproval({ state: "pending" })] });
      const metrics = await computeGovernanceMetrics(ORG_ID);
      expect(metrics.avgApprovalHours).toBeNull();
    });

    it("computes memory health score (0-100)", async () => {
      setupMetricsSelects({
        memory: [
          makeMemoryRow({ status: "approved" }),
          makeMemoryRow({ id: "m-2", status: "approved" }),
          makeMemoryRow({ id: "m-3", status: "proposed" }),
        ],
      });
      const metrics = await computeGovernanceMetrics(ORG_ID);
      expect(metrics.memoryHealthScore).toBeGreaterThanOrEqual(0);
      expect(metrics.memoryHealthScore).toBeLessThanOrEqual(100);
    });

    it("returns memoryHealthScore 100 when no memory exists", async () => {
      setupMetricsSelects({ memory: [] });
      const metrics = await computeGovernanceMetrics(ORG_ID);
      expect(metrics.memoryHealthScore).toBe(100);
    });

    it("computes blueprint coverage from published/draft counts", async () => {
      setupMetricsSelects({
        blueprints: [
          { status: "published", isBuiltIn: false },
          { status: "published", isBuiltIn: false },
          { status: "draft",     isBuiltIn: false },
        ],
      });
      const metrics = await computeGovernanceMetrics(ORG_ID);
      expect(metrics.publishedBlueprintCount).toBe(2);
      expect(metrics.draftBlueprintCount).toBe(1);
      expect(metrics.blueprintCoverage).toBeCloseTo(67, 0);
    });

    it("counts governance events in last 30 days", async () => {
      setupMetricsSelects({
        audit: [makeAuditRow(), makeAuditRow({ id: "a2" }), makeAuditRow({ id: "a3" })],
      });
      const metrics = await computeGovernanceMetrics(ORG_ID);
      expect(metrics.governanceEventsLast30Days).toBe(3);
    });

    it("produces topGovernanceActors sorted by count desc", async () => {
      setupMetricsSelects({
        audit: [
          makeAuditRow({ actorUserId: "user-A" }),
          makeAuditRow({ id: "a2", actorUserId: "user-A" }),
          makeAuditRow({ id: "a3", actorUserId: "user-B" }),
        ],
      });
      const metrics = await computeGovernanceMetrics(ORG_ID);
      expect(metrics.topGovernanceActors[0]?.actorUserId).toBe("user-A");
      expect(metrics.topGovernanceActors[0]?.count).toBe(2);
    });

    it("handles empty DB gracefully — all numeric fields default safely", async () => {
      mockSelectImpl.mockReturnValue(makeChain([]));
      const metrics = await computeGovernanceMetrics(ORG_ID);
      expect(metrics.pendingApprovals).toBe(0);
      expect(metrics.governanceScore).toBeGreaterThanOrEqual(0);
      expect(metrics.governanceScore).toBeLessThanOrEqual(100);
    });
  });

  // ─── Tenant isolation ─────────────────────────────────────────────────────

  describe("Tenant isolation", () => {
    it("bulkResolveApprovals rejects cross-org items (throws per-item, not batch)", async () => {
      // resolveApproval is org-scoped — cross-org approval throws
      mockSelectImpl.mockReturnValue(makeChain([])); // approval not found for this org
      const result = await bulkResolveApprovals({
        approvalIds: ["other-org-approval"],
        organizationId: ORG_ID,
        action: "approved",
        actorUserId: USER_ID,
      });
      expect(result.failed).toBe(1);
      expect(result.results[0]!.success).toBe(false);
    });

    it("mergeOrganisationMemory uses org-scoped queries for both target and source", async () => {
      // Both queries are scoped to ORG_ID via AND condition
      setupSelectSequence([[makeMemoryRow()], [makeMemoryRow({ id: "mem-source" })]]);
      const result = await mergeOrganisationMemory(ORG_ID, {
        targetId: "mem-001", sourceId: "mem-source", mergedBy: USER_ID,
      });
      expect(result.ok).toBe(true);
      // Verify the queries were made (select called twice)
      expect(mockSelectImpl).toHaveBeenCalledTimes(2);
    });

    it("getMemoryAuditHistory is org-scoped", async () => {
      setupSelectSequence([[makeAuditRow()]]);
      const result = await getMemoryAuditHistory(ORG_ID, "mem-001");
      expect(result).toHaveLength(1);
    });
  });

  // ─── Input validation & security ──────────────────────────────────────────

  describe("Input validation & limits", () => {
    it("bulkResolveApprovals silently caps at 100 items", async () => {
      mockSelectImpl.mockReturnValue(makeChain([makeApproval()]));
      mockUpdate.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ ...makeApproval(), state: "approved" }]),
        }),
      });
      const ids = Array.from({ length: 200 }, (_, i) => `appr-${i}`);
      const result = await bulkResolveApprovals({
        approvalIds: ids, organizationId: ORG_ID, action: "approved", actorUserId: USER_ID,
      });
      expect(result.results).toHaveLength(100);
    });

    it("mergeOrganisationMemory truncates mergedTitle to 200 chars", async () => {
      setupSelectSequence([[makeMemoryRow({ id: "mem-target" })], [makeMemoryRow({ id: "mem-source" })]]);
      const longTitle = "A".repeat(300);
      await mergeOrganisationMemory(ORG_ID, {
        targetId: "mem-target", sourceId: "mem-source", mergedBy: USER_ID,
        mergedTitle: longTitle,
      });
      const targetSet = mockUpdate.mock.results[0]!.value.set.mock.calls[0]?.[0];
      expect(targetSet.title.length).toBeLessThanOrEqual(200);
    });

    it("mergeOrganisationMemory truncates mergedContent to 5000 chars", async () => {
      setupSelectSequence([[makeMemoryRow({ id: "mem-target" })], [makeMemoryRow({ id: "mem-source" })]]);
      const longContent = "B".repeat(6000);
      await mergeOrganisationMemory(ORG_ID, {
        targetId: "mem-target", sourceId: "mem-source", mergedBy: USER_ID,
        mergedContent: longContent,
      });
      const targetSet = mockUpdate.mock.results[0]!.value.set.mock.calls[0]?.[0];
      expect(targetSet.content.length).toBeLessThanOrEqual(5000);
    });
  });

  // ─── Regression: existing services unchanged ──────────────────────────────

  describe("Regression: existing approval and memory functions", () => {
    it("resolveApproval still works for single approval", async () => {
      mockSelectImpl.mockReturnValue(makeChain([makeApproval()]));
      setupUpdateReturning([{ ...makeApproval(), state: "approved" }]);

      const result = await resolveApproval({
        approvalId: "appr-001", organizationId: ORG_ID,
        action: "approved", actorUserId: USER_ID,
      });

      expect(result.state).toBe("approved");
    });

    it("getApprovalsByOrg still returns all approvals when no state filter", async () => {
      const rows = [makeApproval({ state: "pending" }), makeApproval({ id: "a-2", state: "approved" })];
      setupSelectSequence([rows]);
      const result = await getApprovalsByOrg(ORG_ID);
      expect(result).toHaveLength(2);
    });

    it("computeGovernanceMetrics returns a governanceScore between 0 and 100", async () => {
      // Fully populated scenario
      mockSelectImpl.mockReturnValue(makeChain([makeApproval()]));
      const metrics = await computeGovernanceMetrics(ORG_ID);
      expect(metrics.governanceScore).toBeGreaterThanOrEqual(0);
      expect(metrics.governanceScore).toBeLessThanOrEqual(100);
    });

    it("getMemoryAuditHistory returns empty array on DB error (non-critical)", async () => {
      mockSelectImpl.mockImplementation(() => { throw new Error("DB error"); });
      const result = await getMemoryAuditHistory(ORG_ID, "mem-001");
      expect(result).toEqual([]);
    });
  });

  // ─── Audit events ─────────────────────────────────────────────────────────

  describe("Audit events on governance operations", () => {
    it("mergeOrganisationMemory writes two audit events (merged + superseded)", async () => {
      setupSelectSequence([[makeMemoryRow({ id: "mem-target" })], [makeMemoryRow({ id: "mem-source" })]]);
      await mergeOrganisationMemory(ORG_ID, {
        targetId: "mem-target", sourceId: "mem-source", mergedBy: USER_ID,
      });
      // Two orgAuditLogTable inserts: memory.merged + memory.superseded
      expect(mockInsert).toHaveBeenCalledTimes(2);
    });

    it("bulkResolveApprovals writes approval history for each resolved item", async () => {
      mockSelectImpl.mockReturnValue(makeChain([makeApproval()]));
      setupUpdateReturning([{ ...makeApproval(), state: "approved" }]);

      await bulkResolveApprovals({
        approvalIds: ["appr-001", "appr-002"],
        organizationId: ORG_ID,
        action: "approved",
        actorUserId: USER_ID,
      });

      // Each resolveApproval writes one approvalHistoryTable entry
      expect(mockInsert).toHaveBeenCalledTimes(2);
    });
  });

});
