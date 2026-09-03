/**
 * Sprint 9.5 — Chief of Staff Orchestrator Tests
 *
 * Tests the orchestration layer including plan creation,
 * consolidation, conflict detection, and OpenClaw package generation.
 * Uses actual capability codes from the registry.
 */

import { describe, it, expect, vi, beforeAll } from "vitest";
import {
  createSpecialistPlan,
  consolidateTaskResults,
  generateOpenClawPackage,
} from "../services/chiefOfStaffOrchestrator.js";

// Mock all async dependencies
vi.mock("../services/specialistEligibilityService.js", () => ({
  checkSpecialistEligibility: vi.fn().mockResolvedValue({
    decisionId: "elig-1",
    workforceRoleCode: "compliance_officer",
    capabilityCode: "compliance.audit_readiness",
    requestedLevel: "professional_analysis",
    eligible: true,
    reasonCode: "eligible",
    reasons: ["All checks passed"],
    workerProfileCode: "compliance_auditor",
    approvalRequired: false,
    evaluatedAt: new Date().toISOString(),
  }),
  validateSpecialistEligibilitySync: vi.fn().mockReturnValue(true),
}));

vi.mock("../services/specialistRunService.js", () => ({
  createSpecialistRun: vi.fn().mockResolvedValue({ id: "run-mock-1", status: "created" }),
  transitionRunStatus: vi.fn().mockResolvedValue({ id: "run-mock-1", status: "queued" }),
  getRunsByTask: vi.fn().mockResolvedValue([]),
  saveRunResult: vi.fn().mockResolvedValue({}),
  getSpecialistRunById: vi.fn().mockResolvedValue({
    id: "run-mock-1",
    organizationId: "org-1",
    taskId: "task-1",
    status: "completed",
    workforceRoleCode: "compliance_officer",
    workerProfileCode: "compliance_auditor",
    specialistEligibilityDecisionId: "elig-1",
    capabilityDecisionId: "cap-dec-1",
    resultData: null,
    resultSummary: null,
    confidence: null,
  }),
  isValidRunTransition: vi.fn().mockReturnValue(true),
}));

vi.mock("../services/specialistQueueService.js", () => ({
  enqueue: vi.fn().mockResolvedValue({ id: "queue-1" }),
  markCompleted: vi.fn().mockResolvedValue(undefined),
  markFailed: vi.fn().mockResolvedValue(undefined),
  markRunning: vi.fn().mockResolvedValue(undefined),
  markCancelled: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../services/specialistWorkPackageService.js", async () => {
  const actual = await vi.importActual("../services/specialistWorkPackageService.js");
  return {
    ...(actual as Record<string, unknown>),
    buildWorkPackage: vi.fn().mockResolvedValue({
      specialistRunId: "run-mock-1",
      objective: "Test objective",
    }),
  };
});

vi.mock("../services/specialistContextService.js", () => ({
  buildSpecialistContext: vi.fn().mockResolvedValue({
    taskScope: "Test task",
    approvedMemory: [],
    pinnedDecisions: [],
    unresolvedQuestions: [],
    relevantMessages: [],
    previousOutputs: [],
    evidenceReferences: [],
    approvalState: "not_required",
    executionEntitlementState: "not_checked",
  }),
}));

vi.mock("../services/specialistIntelligenceService.js", () => ({
  createSpecialistIntelligenceService: vi.fn().mockReturnValue({
    executeRun: vi.fn().mockResolvedValue({
      specialistRunId: "run-mock-1",
      workforceRoleCode: "compliance_officer",
      capabilityCode: "compliance.audit_readiness",
      status: "completed",
      summary: "Test run completed",
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
  }),
}));

vi.mock("../services/auditService.js", () => ({
  logOrgEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@workspace/db", () => {
  const mockDb = {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{
            id: "run-mock-1",
            status: "completed",
            workforceRoleCode: "compliance_officer",
            workerProfileCode: "compliance_auditor",
            specialistEligibilityDecisionId: "elig-1",
            capabilityDecisionId: "cap-dec-1",
            taskId: "task-1",
            resultData: null,
            resultSummary: null,
            confidence: null,
            completedAt: new Date(),
          }]),
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
        orderBy: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{
          id: "conflict-1",
          conflictingPositions: [],
          resolutionRequired: true,
        }]),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: "run-mock-1", status: "queued" }]),
        }),
      }),
    }),
  };

  return {
    db: mockDb,
    specialistRunsTable: { id: null, status: null, organizationId: null },
    specialistConflictsTable: {
      id: null, organizationId: null, taskId: null,
      specialistRunIds: null, conflictingPositions: null,
      evidenceReferences: null, risk: null, chiefOfStaffRecommendation: null,
      resolutionRequired: null,
    },
    conversationsTable: {
      id: null,
      organizationId: null,
      primaryTaskId: null,
      conversationType: null,
    },
    taskExecutionPlansTable: {
      id: null,
      taskId: null,
    },
    tasksTable: {
      id: null,
      organizationId: null,
    },
  };
});

// ─── Plan creation tests ──────────────────────────────────────────────────────

describe("Sprint 9.5 — Chief of Staff Orchestrator", () => {
  describe("createSpecialistPlan", () => {
    it("creates a plan for eligible assignments", async () => {
      const plan = await createSpecialistPlan(
        "task-1",
        "org-1",
        [
          { capabilityCode: "compliance.audit_readiness", workforceRoleCode: "compliance_officer" },
        ],
      );

      expect(plan.taskId).toBe("task-1");
      expect(plan.organizationId).toBe("org-1");
      expect(plan.planId).toBeTruthy();
      expect(plan.createdAt).toBeTruthy();
    });

    it("creates a plan with zero steps when all specialists are blocked", async () => {
      const { checkSpecialistEligibility } = await import("../services/specialistEligibilityService.js");
      vi.mocked(checkSpecialistEligibility).mockResolvedValueOnce({
        decisionId: "elig-blocked",
        workforceRoleCode: "compliance_officer",
        capabilityCode: "compliance.audit_readiness",
        requestedLevel: "professional_analysis",
        eligible: false,
        reasonCode: "workforce_pack_not_included",
        reasons: ["Pack not included"],
        approvalRequired: false,
        evaluatedAt: new Date().toISOString(),
      });

      const plan = await createSpecialistPlan(
        "task-1",
        "org-1",
        [
          { capabilityCode: "compliance.audit_readiness", workforceRoleCode: "compliance_officer" },
        ],
      );
      expect(plan.steps).toHaveLength(0);
    });

    it("returns a plan with steps array", async () => {
      const plan = await createSpecialistPlan(
        "task-1",
        "org-1",
        [
          { capabilityCode: "compliance.audit_readiness", workforceRoleCode: "compliance_officer" },
          { capabilityCode: "documents.draft", workforceRoleCode: "document_specialist" },
        ],
      );
      expect(Array.isArray(plan.steps)).toBe(true);
    });
  });

  describe("consolidateTaskResults", () => {
    it("returns a consolidated result with required fields", async () => {
      const { getRunsByTask } = await import("../services/specialistRunService.js");
      vi.mocked(getRunsByTask).mockResolvedValueOnce([]);

      const result = await consolidateTaskResults("task-1", "org-1");

      expect(result.taskId).toBe("task-1");
      expect(result.organizationId).toBe("org-1");
      expect(Array.isArray(result.combinedFindings)).toBe(true);
      expect(Array.isArray(result.combinedRecommendations)).toBe(true);
      expect(Array.isArray(result.risks)).toBe(true);
      expect(Array.isArray(result.conflicts)).toBe(true);
      expect(Array.isArray(result.unresolvedQuestions)).toBe(true);
      expect(typeof result.nextRecommendedAction).toBe("string");
      expect(typeof result.consolidatedAt).toBe("string");
      expect(["analysis_completed", "execution_pending", "blocked", "partially_complete"]).toContain(result.analysisStatus);
    });

    it("correctly sets status to analysis_completed when no pending runs", async () => {
      const { getRunsByTask } = await import("../services/specialistRunService.js");
      vi.mocked(getRunsByTask).mockResolvedValueOnce([]);

      const result = await consolidateTaskResults("task-1", "org-1");
      expect(result.analysisStatus).toBe("analysis_completed");
    });

    it("includes specialist summaries for completed runs", async () => {
      const { getRunsByTask } = await import("../services/specialistRunService.js");
      vi.mocked(getRunsByTask).mockResolvedValueOnce([{
        id: "run-1",
        status: "completed",
        workforceRoleCode: "compliance_officer",
        resultSummary: "Test summary",
        resultData: JSON.stringify({
          findings: [], recommendations: [], risks: [],
          unresolvedQuestions: [], requestedExternalActions: [],
          confidence: 0.9,
        }),
        confidence: "0.9",
      }] as any);

      const result = await consolidateTaskResults("task-1", "org-1");
      expect(result.specialistSummaries).toHaveLength(1);
      expect(result.specialistSummaries[0]!.workforceRoleCode).toBe("compliance_officer");
    });
  });

  describe("generateOpenClawPackage", () => {
    it("throws for blocking unresolved questions", async () => {
      const result = {
        specialistRunId: "run-mock-1",
        workforceRoleCode: "compliance_officer",
        capabilityCode: "compliance.audit_readiness",
        status: "completed" as const,
        summary: "Test",
        findings: [],
        recommendations: [],
        risks: [],
        assumptions: [],
        unresolvedQuestions: [
          { question: "Missing data", reason: "Cannot proceed", blocking: true },
        ],
        requestedExternalActions: [],
        expectedOutputs: [],
        confidence: 0.9,
        completedAt: new Date().toISOString(),
      };

      await expect(
        generateOpenClawPackage("run-mock-1", "org-1", result),
      ).rejects.toThrow("blocking questions");
    });

    it("generates a package for completed run with no blocking questions", async () => {
      const result = {
        specialistRunId: "run-mock-1",
        workforceRoleCode: "compliance_officer",
        capabilityCode: "compliance.audit_readiness",
        status: "completed" as const,
        summary: "Test",
        findings: [],
        recommendations: [],
        risks: [],
        assumptions: [],
        unresolvedQuestions: [],
        requestedExternalActions: [],
        expectedOutputs: [],
        confidence: 0.9,
        completedAt: new Date().toISOString(),
      };

      const pkg = await generateOpenClawPackage("run-mock-1", "org-1", result);
      expect(pkg.executionId).toBeTruthy();
      expect(pkg.specialistRunId).toBe("run-mock-1");
      expect(pkg.organizationId).toBe("org-1");
      expect(["all_approved", "pending_approval", "not_required"]).toContain(pkg.approvalState);
      expect(pkg.expiresAt).toBeTruthy();
    });
  });
});

// ─── Audit event consistency tests ────────────────────────────────────────────

describe("Sprint 9.5 — Audit events", () => {
  it("audit events include all sprint 9.5 specialist events", async () => {
    const { AUDIT_EVENTS } = await import("@workspace/shared");
    const sprint95Events = [
      "specialist.eligibility_checked",
      "specialist.assignment_allowed",
      "specialist.assignment_blocked",
      "specialist.run_created",
      "specialist.run_queued",
      "specialist.run_started",
      "specialist.run_completed",
      "specialist.run_failed",
      "specialist.run_retried",
      "specialist.run_cancelled",
      "specialist.context_built",
      "specialist.work_package_created",
      "specialist.clarification_requested",
      "specialist.clarification_resolved",
      "specialist.conflict_detected",
      "chief_of_staff.specialists_dispatched",
      "chief_of_staff.consolidation_started",
      "chief_of_staff.consolidation_completed",
      "openclaw.handoff_package_created",
    ];
    for (const event of sprint95Events) {
      expect(AUDIT_EVENTS).toContain(event);
    }
  });

  it("RLS tables count includes sprint 9.5 tables", async () => {
    const { REQUIRED_RLS_TABLES } = await import("@workspace/org-db");
    expect(REQUIRED_RLS_TABLES.length).toBeGreaterThanOrEqual(33);
    const sprint95Tables = [
      "specialist_runs",
      "specialist_queue",
      "specialist_run_memory",
      "specialist_conflicts",
    ];
    for (const table of sprint95Tables) {
      expect(REQUIRED_RLS_TABLES).toContain(table);
    }
  });
});
