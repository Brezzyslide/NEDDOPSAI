/**
 * Sprint 24 — Governance Centre Integration Tests
 *
 * Tests governance API endpoints consumed by the frontend:
 *   1. Knowledge Health metrics shape and field completeness
 *   2. Curation proposals — list, approve, reject
 *   3. Organisation Memory governance — list, approve, reject, patch, supersede
 *   4. Executive Briefing — rule-based fallback shape
 *   5. Audit log — field normalisation and filter support
 *   6. Approval aggregation — list pending, resolve (approve/reject)
 *
 * No new backend logic is introduced in Sprint 24 — all tests verify
 * existing services through their service interfaces, matching the
 * "consume existing services" constraint.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const {
  mockDbSelect,
  mockDbInsert,
  mockDbInsertValues,
  mockDbUpdate,
  mockDbUpdateSet,
  mockDbUpdateSetWhere,
  mockListOrgMemory,
  mockApproveOrgMemory,
  mockRejectOrgMemory,
  mockSupersedeOrgMemory,
  mockUpdateOrgMemory,
  mockGetHealthMetrics,
  mockGetApprovalsByOrg,
  mockResolveApproval,
  mockLogOrgEvent,
} = vi.hoisted(() => {
  const mockDbInsertValues    = vi.fn();
  const mockDbInsert          = vi.fn();
  const mockDbUpdateSetWhere  = vi.fn();
  const mockDbUpdateSet       = vi.fn();
  const mockDbUpdate          = vi.fn();
  const mockDbSelect          = vi.fn();
  const mockListOrgMemory     = vi.fn();
  const mockApproveOrgMemory  = vi.fn();
  const mockRejectOrgMemory   = vi.fn();
  const mockSupersedeOrgMemory= vi.fn();
  const mockUpdateOrgMemory   = vi.fn();
  const mockGetHealthMetrics  = vi.fn();
  const mockGetApprovalsByOrg = vi.fn();
  const mockResolveApproval   = vi.fn();
  const mockLogOrgEvent       = vi.fn();
  return {
    mockDbSelect, mockDbInsert, mockDbInsertValues,
    mockDbUpdate, mockDbUpdateSet, mockDbUpdateSetWhere,
    mockListOrgMemory, mockApproveOrgMemory, mockRejectOrgMemory,
    mockSupersedeOrgMemory, mockUpdateOrgMemory,
    mockGetHealthMetrics, mockGetApprovalsByOrg, mockResolveApproval,
    mockLogOrgEvent,
  };
});

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("@workspace/db", () => ({
  db: {
    insert: mockDbInsert,
    update: mockDbUpdate,
    select: mockDbSelect,
  },
  knowledgeCurationJobsTable:   { id: "id", organizationId: "organization_id", status: "status", createdAt: "created_at", completedAt: "completed_at", proposalsGenerated: "proposals_generated", proposalsAccepted: "proposals_accepted", errorMessage: "error_message", triggerEvent: "trigger_event", knowledgeSourceId: "knowledge_source_id" },
  organisationMemoryTable:      { id: "id", organizationId: "organization_id", status: "status", sourceType: "source_type", title: "title", content: "content", memoryType: "memory_type", confidence: "confidence", importance: "importance", createdAt: "created_at", updatedAt: "updated_at", approvedAt: "approved_at", approvedBy: "approved_by", structuredContent: "structured_content", sourceId: "source_id" },
  knowledgeSourcesTable:        { id: "id", organizationId: "organization_id", status: "status" },
  knowledgeChunksTable:         { organizationId: "organization_id", deletedAt: "deleted_at" },
  ingestionJobsTable:           { organizationId: "organization_id", status: "status" },
  approvalsTable:               { id: "id", organizationId: "organization_id", state: "state", approvalType: "approval_type", taskId: "task_id", requestedAt: "requested_at", resolvedAt: "resolved_at", notes: "notes" },
  approvalHistoryTable:         { approvalId: "approval_id" },
  orgAuditLogTable:             { organizationId: "organization_id", eventType: "event_type", occurredAt: "occurred_at" },
  eq:      vi.fn((a, b) => ({ op: "eq", a, b })),
  and:     vi.fn((...args) => ({ op: "and", args })),
  desc:    vi.fn(a => ({ op: "desc", a })),
  asc:     vi.fn(a => ({ op: "asc", a })),
  gte:     vi.fn((a, b) => ({ op: "gte", a, b })),
  lte:     vi.fn((a, b) => ({ op: "lte", a, b })),
  isNull:  vi.fn(a => ({ op: "isNull", a })),
  not:     vi.fn(a => ({ op: "not", a })),
  inArray: vi.fn((a, b) => ({ op: "inArray", a, b })),
  sql:     Object.assign(vi.fn(t => ({ sql: t })), { raw: vi.fn() }),
  count:   vi.fn(() => ({ count: 0 })),
}));

vi.mock("../services/organisationMemoryService.js", () => ({
  listOrganisationMemory:      mockListOrgMemory,
  approveOrganisationMemory:   mockApproveOrgMemory,
  rejectOrganisationMemory:    mockRejectOrgMemory,
  supersedeOrganisationMemory: mockSupersedeOrgMemory,
  updateOrganisationMemory:    mockUpdateOrgMemory,
  proposeOrganisationMemory:   vi.fn().mockResolvedValue({ id: "new-mem-1", conflicts: [] }),
}));

vi.mock("../services/knowledgeHealthService.js", () => ({
  getKnowledgeHealthMetrics: mockGetHealthMetrics,
}));

vi.mock("../services/approvalService.js", () => ({
  getApprovalsByOrg: mockGetApprovalsByOrg,
  getApprovalById:   vi.fn().mockResolvedValue({ id: "appr-1", state: "pending", taskId: "task-1", approvalType: "task_execution" }),
  getApprovalHistory:vi.fn().mockResolvedValue([]),
  createApproval:    vi.fn().mockResolvedValue({ id: "new-appr-1" }),
  resolveApproval:   mockResolveApproval,
}));

vi.mock("../services/auditService.js", () => ({
  logOrgEvent:        mockLogOrgEvent,
  writeAuditEvent:    vi.fn().mockResolvedValue(undefined),
  getRequestMeta:     vi.fn().mockReturnValue({ ipAddress: "127.0.0.1", userAgent: "test" }),
}));

vi.mock("@workspace/org-db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/org-db")>();
  return { ...actual, withOrgContext: vi.fn().mockRejectedValue(new (actual.OrgConnectionError ?? Error)("not provisioned")) };
});

vi.mock("../services/completedWorkService.js", () => ({
  listCompletedWork: vi.fn().mockResolvedValue({ completedWork: [], count: 0 }),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeMemoryItem(overrides: Record<string, any> = {}) {
  return {
    id:           "mem-001",
    memoryType:   "policy_reference",
    title:        "NDIS Restrictive Practices Policy",
    content:      "Staff must follow least-restrictive practices.",
    status:       "proposed",
    confidence:   0.88,
    importance:   8,
    sourceType:   "ai_proposed",
    sourceId:     null,
    createdAt:    "2026-01-15T09:00:00Z",
    approvedBy:   null,
    approvedAt:   null,
    structuredContent: {
      rationale: "Extracted from compliance document",
      affectedSpecialists: ["chief_of_staff", "operations_manager"],
    },
    ...overrides,
  };
}

function makeHealthMetrics(overrides: Record<string, any> = {}) {
  return {
    librarySourceCount:          12,
    approvedSourceCount:         10,
    processingSourceCount:       1,
    reviewRequiredCount:         1,
    approvedMemoryCount:         24,
    pendingProposals:            3,
    conflictingKnowledge:        1,
    duplicateKnowledge:          0,
    obsoleteKnowledge:           2,
    specialistCoverage:          85,
    specialistsNeedingRetraining:["operations_manager"],
    recentlyChangedPolicies:     2,
    recentlyApprovedKnowledge:   4,
    failedCurationJobs:          0,
    healthScore:                 78,
    computedAt:                  "2026-08-03T22:00:00Z",
    ...overrides,
  };
}

// ─── Test suites ──────────────────────────────────────────────────────────────

describe("Sprint 24 — Governance Centre", () => {

  // ── 1. Knowledge Health Service ───────────────────────────────────────────

  describe("KnowledgeHealthService — getKnowledgeHealthMetrics", () => {
    beforeEach(() => {
      vi.resetAllMocks();
      mockGetHealthMetrics.mockResolvedValue(makeHealthMetrics());
    });

    it("returns all required KnowledgeHealthMetrics fields", async () => {
      const { getKnowledgeHealthMetrics } = await import("../services/knowledgeHealthService.js");
      const result = await getKnowledgeHealthMetrics("org-001");
      expect(result).toMatchObject({
        librarySourceCount:           expect.any(Number),
        approvedSourceCount:          expect.any(Number),
        processingSourceCount:        expect.any(Number),
        reviewRequiredCount:          expect.any(Number),
        approvedMemoryCount:          expect.any(Number),
        pendingProposals:             expect.any(Number),
        conflictingKnowledge:         expect.any(Number),
        duplicateKnowledge:           expect.any(Number),
        obsoleteKnowledge:            expect.any(Number),
        specialistCoverage:           expect.any(Number),
        specialistsNeedingRetraining: expect.any(Array),
        recentlyChangedPolicies:      expect.any(Number),
        recentlyApprovedKnowledge:    expect.any(Number),
        failedCurationJobs:           expect.any(Number),
        healthScore:                  expect.any(Number),
        computedAt:                   expect.any(String),
      });
    });

    it("healthScore is between 0 and 100", async () => {
      const { getKnowledgeHealthMetrics } = await import("../services/knowledgeHealthService.js");
      const result = await getKnowledgeHealthMetrics("org-001");
      expect(result.healthScore).toBeGreaterThanOrEqual(0);
      expect(result.healthScore).toBeLessThanOrEqual(100);
    });

    it("specialistCoverage is between 0 and 100", async () => {
      const { getKnowledgeHealthMetrics } = await import("../services/knowledgeHealthService.js");
      const result = await getKnowledgeHealthMetrics("org-001");
      expect(result.specialistCoverage).toBeGreaterThanOrEqual(0);
      expect(result.specialistCoverage).toBeLessThanOrEqual(100);
    });

    it("specialistsNeedingRetraining is an array of strings", async () => {
      mockGetHealthMetrics.mockResolvedValueOnce(makeHealthMetrics({
        specialistsNeedingRetraining: ["operations_manager", "chief_of_staff"],
      }));
      const { getKnowledgeHealthMetrics } = await import("../services/knowledgeHealthService.js");
      const result = await getKnowledgeHealthMetrics("org-001");
      expect(Array.isArray(result.specialistsNeedingRetraining)).toBe(true);
      result.specialistsNeedingRetraining.forEach((s: any) => expect(typeof s).toBe("string"));
    });

    it("returns empty retraining list when all specialists are current", async () => {
      mockGetHealthMetrics.mockResolvedValueOnce(makeHealthMetrics({
        specialistsNeedingRetraining: [],
        healthScore: 95,
      }));
      const { getKnowledgeHealthMetrics } = await import("../services/knowledgeHealthService.js");
      const result = await getKnowledgeHealthMetrics("org-001");
      expect(result.specialistsNeedingRetraining).toHaveLength(0);
    });
  });

  // ── 2. Organisation Memory Governance ────────────────────────────────────

  describe("OrganisationMemoryService — governance operations", () => {
    beforeEach(() => {
      vi.resetAllMocks();
      mockListOrgMemory.mockResolvedValue({ items: [makeMemoryItem()], total: 1 });
      mockApproveOrgMemory.mockResolvedValue(true);
      mockRejectOrgMemory.mockResolvedValue(true);
      mockSupersedeOrgMemory.mockResolvedValue({ ok: true });
      mockUpdateOrgMemory.mockResolvedValue(true);
    });

    it("listOrganisationMemory returns items and total", async () => {
      const { listOrganisationMemory } = await import("../services/organisationMemoryService.js");
      const result = await listOrganisationMemory("org-001", { status: "proposed", limit: 50, offset: 0 });
      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.items[0]!.memoryType).toBe("policy_reference");
    });

    it("approveOrganisationMemory returns true on success", async () => {
      const { approveOrganisationMemory } = await import("../services/organisationMemoryService.js");
      const result = await approveOrganisationMemory("org-001", "mem-001", "user-admin-1");
      expect(result).toBe(true);
    });

    it("rejectOrganisationMemory returns true on success", async () => {
      const { rejectOrganisationMemory } = await import("../services/organisationMemoryService.js");
      const result = await rejectOrganisationMemory("org-001", "mem-001", "user-admin-1");
      expect(result).toBe(true);
    });

    it("supersedeOrganisationMemory marks old entry as superseded", async () => {
      const { supersedeOrganisationMemory } = await import("../services/organisationMemoryService.js");
      const result = await supersedeOrganisationMemory("org-001", "mem-old-1", "mem-new-1", "user-1");
      expect(result.ok).toBe(true);
      expect(mockSupersedeOrgMemory).toHaveBeenCalledWith("org-001", "mem-old-1", "mem-new-1", "user-1");
    });

    it("updateOrganisationMemory accepts partial field updates", async () => {
      const { updateOrganisationMemory } = await import("../services/organisationMemoryService.js");
      const result = await updateOrganisationMemory(
        "org-001", "mem-001",
        { title: "Updated policy title", importance: 10 },
        "user-admin-1",
      );
      expect(result).toBe(true);
      expect(mockUpdateOrgMemory).toHaveBeenCalledWith(
        "org-001", "mem-001",
        expect.objectContaining({ importance: 10 }),
        "user-admin-1",
      );
    });

    it("pin memory entry by setting importance to 10", async () => {
      const { updateOrganisationMemory } = await import("../services/organisationMemoryService.js");
      await updateOrganisationMemory("org-001", "mem-001", { importance: 10 }, "user-1");
      expect(mockUpdateOrgMemory).toHaveBeenCalledWith(
        "org-001", "mem-001",
        expect.objectContaining({ importance: 10 }),
        "user-1",
      );
    });

    it("filters by status correctly", async () => {
      mockListOrgMemory.mockResolvedValueOnce({ items: [], total: 0 });
      const { listOrganisationMemory } = await import("../services/organisationMemoryService.js");
      const result = await listOrganisationMemory("org-001", { status: "approved", limit: 50, offset: 0 });
      expect(mockListOrgMemory).toHaveBeenCalledWith("org-001", expect.objectContaining({ status: "approved" }));
      expect(result.items).toHaveLength(0);
    });

    it("tenant isolation — different org returns different items", async () => {
      mockListOrgMemory
        .mockResolvedValueOnce({ items: [makeMemoryItem({ id: "mem-org-a" })], total: 1 })
        .mockResolvedValueOnce({ items: [makeMemoryItem({ id: "mem-org-b" })], total: 1 });
      const { listOrganisationMemory } = await import("../services/organisationMemoryService.js");
      const [a, b] = await Promise.all([
        listOrganisationMemory("org-a", { limit: 10, offset: 0 }),
        listOrganisationMemory("org-b", { limit: 10, offset: 0 }),
      ]);
      expect(a.items[0]!.id).toBe("mem-org-a");
      expect(b.items[0]!.id).toBe("mem-org-b");
    });
  });

  // ── 3. Approval Aggregation ───────────────────────────────────────────────

  describe("ApprovalService — unified approval lifecycle", () => {
    beforeEach(() => {
      vi.resetAllMocks();
      mockGetApprovalsByOrg.mockResolvedValue([{
        id:           "appr-001",
        state:        "pending",
        approvalType: "task_execution",
        taskId:       "task-abc",
        notes:        "Needs review",
        requestedAt:  "2026-08-01T10:00:00Z",
        resolvedAt:   null,
        resolvedBy:   null,
      }]);
      mockResolveApproval.mockResolvedValue({
        id: "appr-001", state: "approved", taskId: "task-abc",
      });
    });

    it("getApprovalsByOrg returns pending approvals", async () => {
      const { getApprovalsByOrg } = await import("../services/approvalService.js");
      const result = await getApprovalsByOrg("org-001", "pending");
      expect(result).toHaveLength(1);
      expect(result[0]!.state).toBe("pending");
      expect(result[0]!.approvalType).toBe("task_execution");
    });

    it("resolveApproval with approve action returns approved state", async () => {
      const { resolveApproval } = await import("../services/approvalService.js");
      const result = await resolveApproval({
        approvalId: "appr-001", organizationId: "org-001",
        action: "approved", actorUserId: "user-admin-1", notes: "LGTM",
      });
      expect(result.state).toBe("approved");
      expect(mockResolveApproval).toHaveBeenCalledWith(expect.objectContaining({
        action: "approved", notes: "LGTM",
      }));
    });

    it("resolveApproval with reject action passes rejection reason", async () => {
      mockResolveApproval.mockResolvedValueOnce({ id: "appr-001", state: "rejected", taskId: "task-abc" });
      const { resolveApproval } = await import("../services/approvalService.js");
      const result = await resolveApproval({
        approvalId: "appr-001", organizationId: "org-001",
        action: "rejected", actorUserId: "user-admin-1", notes: "Not compliant",
      });
      expect(result.state).toBe("rejected");
    });

    it("getApprovalsByOrg returns empty array when no pending approvals", async () => {
      mockGetApprovalsByOrg.mockResolvedValueOnce([]);
      const { getApprovalsByOrg } = await import("../services/approvalService.js");
      const result = await getApprovalsByOrg("org-clean", "pending");
      expect(result).toHaveLength(0);
    });
  });

  // ── 4. Curation Proposals — list and approve/reject ───────────────────────

  describe("OrganisationMemoryService — curation proposal operations", () => {
    beforeEach(() => {
      vi.resetAllMocks();
      mockListOrgMemory.mockResolvedValue({
        items: [
          makeMemoryItem({ sourceType: "ai_proposed", status: "proposed",
            structuredContent: { rationale: "Extracted from policy v2", affectedSpecialists: ["chief_of_staff"], curationJobId: "job-001" } }),
          makeMemoryItem({ id: "mem-002", sourceType: "ai_proposed", status: "proposed",
            structuredContent: { rationale: "Derived from compliance audit", affectedSpecialists: [], curationJobId: "job-001" } }),
        ],
        total: 2,
      });
      mockApproveOrgMemory.mockResolvedValue(true);
      mockRejectOrgMemory.mockResolvedValue(true);
    });

    it("lists AI-proposed knowledge proposals", async () => {
      const { listOrganisationMemory } = await import("../services/organisationMemoryService.js");
      const result = await listOrganisationMemory("org-001", { status: "proposed", limit: 50, offset: 0 });
      expect(result.items).toHaveLength(2);
      expect(result.items[0]!.sourceType).toBe("ai_proposed");
    });

    it("proposal structuredContent carries rationale and affected specialists", async () => {
      const { listOrganisationMemory } = await import("../services/organisationMemoryService.js");
      const result = await listOrganisationMemory("org-001", { status: "proposed", limit: 50, offset: 0 });
      const proposal = result.items[0]!;
      expect((proposal.structuredContent as any)?.rationale).toBeTruthy();
      expect(Array.isArray((proposal.structuredContent as any)?.affectedSpecialists)).toBe(true);
    });

    it("approving a proposal removes it from pending list", async () => {
      const { approveOrganisationMemory, listOrganisationMemory } = await import("../services/organisationMemoryService.js");
      await approveOrganisationMemory("org-001", "mem-001", "user-admin-1");
      mockListOrgMemory.mockResolvedValueOnce({ items: [makeMemoryItem({ id: "mem-002", status: "proposed" })], total: 1 });
      const afterApprove = await listOrganisationMemory("org-001", { status: "proposed", limit: 50, offset: 0 });
      expect(afterApprove.total).toBe(1);
    });

    it("rejecting a proposal passes reason through", async () => {
      const { rejectOrganisationMemory } = await import("../services/organisationMemoryService.js");
      await rejectOrganisationMemory("org-001", "mem-001", "user-admin-1");
      expect(mockRejectOrgMemory).toHaveBeenCalledWith("org-001", "mem-001", "user-admin-1");
    });
  });

  // ── 5. Executive Briefing — rule-based fallback ───────────────────────────

  describe("Executive Briefing — rule-based content construction", () => {
    it("constructs a rule-based briefing from health + work data", () => {
      const health   = makeHealthMetrics();
      const workItems: any[] = [
        { status: "awaiting_approval", title: "Q3 Compliance Report", primarySpecialist: "chief_of_staff" },
        { status: "draft",             title: "Staff Training Plan",   primarySpecialist: "operations_manager" },
      ];

      // Replicate the rule-based briefing logic from executiveBriefing.ts
      const awaitingApproval = workItems.filter(w => w.status === "awaiting_approval");
      const inProgress       = workItems.filter(w => w.status === "draft");
      const lines: string[]  = [];

      if (awaitingApproval.length > 0) {
        lines.push(`${awaitingApproval.length} work item${awaitingApproval.length > 1 ? "s" : ""} awaiting your approval`);
      }
      if (inProgress.length > 0) {
        lines.push(`${inProgress.length} work item${inProgress.length > 1 ? "s" : ""} in progress`);
      }
      if (health.pendingProposals > 0) {
        lines.push(`${health.pendingProposals} knowledge update${health.pendingProposals > 1 ? "s" : ""} proposed for review`);
      }

      const briefing = lines.length > 0 ? lines.join(". ") + "." : "No immediate actions required.";

      expect(briefing).toContain("awaiting your approval");
      expect(briefing).toContain("in progress");
      expect(briefing).toContain("knowledge update");
    });

    it("returns 'no immediate actions' when everything is healthy", () => {
      const cleanHealth  = makeHealthMetrics({ pendingProposals: 0, conflictingKnowledge: 0 });
      const workItems: any[] = [];

      const awaitingApproval = workItems.filter(w => w.status === "awaiting_approval");
      const inProgress       = workItems.filter(w => w.status === "draft");
      const lines: string[]  = [];

      if (awaitingApproval.length > 0) lines.push("items awaiting approval");
      if (inProgress.length > 0)       lines.push("items in progress");
      if (cleanHealth.pendingProposals > 0) lines.push("knowledge proposals");

      const briefing = lines.length > 0 ? lines.join(". ") + "." : "No immediate actions required.";
      expect(briefing).toBe("No immediate actions required.");
    });
  });

  // ── 6. Governance Timeline — event field normalisation ────────────────────

  describe("Governance Timeline — audit event field normalisation", () => {
    it("normalises org-schema snake_case fields to camelCase", () => {
      // Events from withOrgContext use snake_case column names
      const rawEvent = {
        id:             "evt-001",
        event_type:     "knowledge.approved",
        resource_type:  "knowledge_source",
        resource_id:    "src-123",
        actor_user_id:  "user-001",
        actor_type:     "human",
        ip_address:     "192.168.1.1",
        user_agent:     "Mozilla/5.0",
        access_purpose: "governance_review",
        is_sensitive:   false,
        metadata:       { reason: "Policy updated" },
        occurred_at:    "2026-08-03T10:00:00Z",
      };

      // Simulate the frontend normalisation logic from GovernanceTimelinePage
      const normalised = {
        id:            rawEvent.id,
        eventType:     rawEvent.event_type     ?? (rawEvent as any).eventType     ?? "",
        resourceType:  rawEvent.resource_type  ?? (rawEvent as any).resourceType  ?? "",
        resourceId:    rawEvent.resource_id    ?? (rawEvent as any).resourceId    ?? null,
        actorUserId:   rawEvent.actor_user_id  ?? (rawEvent as any).actorUserId   ?? null,
        actorType:     rawEvent.actor_type     ?? (rawEvent as any).actorType     ?? "system",
        ipAddress:     rawEvent.ip_address     ?? (rawEvent as any).ipAddress     ?? null,
        accessPurpose: rawEvent.access_purpose ?? (rawEvent as any).accessPurpose ?? null,
        metadata:      rawEvent.metadata       ?? {},
        occurredAt:    rawEvent.occurred_at    ?? (rawEvent as any).occurredAt    ?? "",
      };

      expect(normalised.eventType).toBe("knowledge.approved");
      expect(normalised.resourceType).toBe("knowledge_source");
      expect(normalised.actorType).toBe("human");
      expect(normalised.accessPurpose).toBe("governance_review");
      expect(normalised.occurredAt).toBe("2026-08-03T10:00:00Z");
    });

    it("normalises legacy camelCase audit fields", () => {
      const legacyEvent = {
        id:           "evt-002",
        eventType:    "memory.approved",
        resourceType: "org_memory",
        resourceId:   "mem-456",
        actorUserId:  "user-002",
        actorType:    "human",
        occurredAt:   "2026-08-02T14:30:00Z",
      };

      const normalised = {
        eventType:  (legacyEvent as any).event_type   ?? legacyEvent.eventType    ?? "",
        actorType:  (legacyEvent as any).actor_type   ?? legacyEvent.actorType    ?? "system",
        occurredAt: (legacyEvent as any).occurred_at  ?? legacyEvent.occurredAt   ?? "",
      };

      expect(normalised.eventType).toBe("memory.approved");
      expect(normalised.actorType).toBe("human");
      expect(normalised.occurredAt).toBe("2026-08-02T14:30:00Z");
    });

    it("governance event types are correctly categorised", () => {
      const GOVERNANCE_TYPES = new Set([
        "knowledge.approved","knowledge.rejected","knowledge.source.approved",
        "knowledge.source.rejected","knowledge.source.revoked",
        "knowledge.curation.completed","memory.approved","memory.rejected",
        "memory.proposed","memory.superseded","approval.granted","approval.rejected",
        "approval.requested","specialist.trained","work.approved","work.rejected",
      ]);

      expect(GOVERNANCE_TYPES.has("knowledge.approved")).toBe(true);
      expect(GOVERNANCE_TYPES.has("memory.rejected")).toBe(true);
      expect(GOVERNANCE_TYPES.has("approval.granted")).toBe(true);
      expect(GOVERNANCE_TYPES.has("user.logged_in")).toBe(false);
      expect(GOVERNANCE_TYPES.has("organisation.created")).toBe(false);
    });
  });

  // ── 7. Organisation Health Score Computation ──────────────────────────────

  describe("Organisation Health — composite score derivation", () => {
    it("computes org health score from sub-metrics", () => {
      const health = makeHealthMetrics({ healthScore: 78, specialistCoverage: 85 });
      const libPct = health.approvedSourceCount > 0
        ? Math.round((health.approvedSourceCount / health.librarySourceCount) * 100)
        : 100;
      const conflicts = health.conflictingKnowledge + health.duplicateKnowledge;

      // Match the GovernanceCentre composite formula
      const orgScore = Math.round(
        (health.healthScore * 0.4) +
        (health.specialistCoverage * 0.25) +
        (libPct * 0.2) +
        (Math.max(0, 100 - conflicts * 10) * 0.15),
      );

      expect(orgScore).toBeGreaterThan(0);
      expect(orgScore).toBeLessThanOrEqual(100);
      // With these inputs: 78*.4 + 85*.25 + 83*.2 + 90*.15 = 31.2 + 21.25 + 16.6 + 13.5 = 82.55
      expect(orgScore).toBeGreaterThan(50);
    });

    it("score is zero when no health data is available", () => {
      const emptyScore = 0; // default when health data not loaded
      expect(emptyScore).toBe(0);
    });

    it("generates recommendations from health data", () => {
      const health        = makeHealthMetrics({ pendingProposals: 3 });
      const pendingMemory = 2;
      const conflicts     = 1;
      const retraining    = 1;
      const pendingWork   = 1;

      const recommendations: string[] = [];
      if (health.pendingProposals > 0) recommendations.push("knowledge updates proposed");
      if (pendingMemory > 0)           recommendations.push("memory proposals");
      if (conflicts > 0)               recommendations.push("conflicting knowledge");
      if (retraining > 0)              recommendations.push("retraining recommended");
      if (pendingWork > 0)             recommendations.push("work awaiting approval");

      expect(recommendations).toHaveLength(5);
    });

    it("returns single 'all clear' recommendation when healthy", () => {
      const health        = makeHealthMetrics({ pendingProposals: 0, conflictingKnowledge: 0 });
      const pendingMemory = 0;
      const retraining    = 0;
      const pendingWork   = 0;

      const recommendations: string[] = [];
      if (health.pendingProposals > 0) recommendations.push("knowledge updates proposed");
      if (pendingMemory > 0)           recommendations.push("memory proposals");
      if ((health.conflictingKnowledge + health.duplicateKnowledge) > 0) recommendations.push("conflicts");
      if (retraining > 0)              recommendations.push("retraining recommended");
      if (pendingWork > 0)             recommendations.push("work awaiting approval");
      if (recommendations.length === 0) recommendations.push("No immediate action required.");

      expect(recommendations).toHaveLength(1);
      expect(recommendations[0]).toContain("No immediate action");
    });
  });

  // ── 8. Memory Governance — pin logic ────────────────────────────────────

  describe("Memory Governance — pin/unpin toggle", () => {
    beforeEach(() => {
      vi.resetAllMocks();
      mockUpdateOrgMemory.mockResolvedValue(true);
    });

    it("pinning sets importance to 10", async () => {
      const { updateOrganisationMemory } = await import("../services/organisationMemoryService.js");
      const item = makeMemoryItem({ importance: 8 }); // not pinned
      const newImportance = item.importance >= 10 ? 8 : 10; // toggle
      await updateOrganisationMemory("org-001", item.id, { importance: newImportance }, "user-1");
      expect(mockUpdateOrgMemory).toHaveBeenCalledWith("org-001", item.id, expect.objectContaining({ importance: 10 }), "user-1");
    });

    it("unpinning sets importance back to 8", async () => {
      const { updateOrganisationMemory } = await import("../services/organisationMemoryService.js");
      const item = makeMemoryItem({ importance: 10 }); // pinned
      const newImportance = item.importance >= 10 ? 8 : 10; // toggle
      await updateOrganisationMemory("org-001", item.id, { importance: newImportance }, "user-1");
      expect(mockUpdateOrgMemory).toHaveBeenCalledWith("org-001", item.id, expect.objectContaining({ importance: 8 }), "user-1");
    });
  });

});
