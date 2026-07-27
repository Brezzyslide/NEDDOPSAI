/**
 * Sprint 9.5 — Specialist Runs & Queue Tests
 *
 * Tests state machine, idempotency, and queue operations.
 * Uses mocked DB for unit isolation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  isValidRunTransition,
  type SpecialistRunStatus,
} from "../services/specialistRunService.js";
import {
  buildSpecialistPlan,
  getReadySteps,
  validateWorkPackage,
  buildWorkPackage,
} from "../services/specialistWorkPackageService.js";

// Mock DB for unit tests
vi.mock("@workspace/db", async () => {
  const actual = await vi.importActual("@workspace/db");
  return {
    ...(actual as Record<string, unknown>),
    db: {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
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
          returning: vi.fn().mockResolvedValue([{ id: "mock-run-id" }]),
        }),
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: "mock-run-id", status: "queued" }]),
          }),
        }),
      }),
    },
  };
});

vi.mock("../services/auditService.js", () => ({
  logOrgEvent: vi.fn().mockResolvedValue(undefined),
}));

// ─── State machine tests ──────────────────────────────────────────────────────

describe("Sprint 9.5 — Specialist Run State Machine", () => {
  const validTransitions: [SpecialistRunStatus, SpecialistRunStatus][] = [
    ["created", "queued"],
    ["created", "cancelled"],
    ["queued", "preparing"],
    ["queued", "cancelled"],
    ["preparing", "running"],
    ["preparing", "failed"],
    ["preparing", "cancelled"],
    ["running", "completed"],
    ["running", "failed"],
    ["running", "awaiting_clarification"],
    ["running", "awaiting_approval"],
    ["running", "waiting_for_runtime"],
    ["running", "cancelled"],
    ["awaiting_clarification", "queued"],
    ["awaiting_clarification", "cancelled"],
    ["awaiting_approval", "queued"],
    ["awaiting_approval", "cancelled"],
    ["waiting_for_dependency", "queued"],
    ["waiting_for_dependency", "cancelled"],
    ["waiting_for_runtime", "running"],
    ["waiting_for_runtime", "cancelled"],
    ["failed", "queued"],
  ];

  it.each(validTransitions)(
    "allows transition from %s to %s",
    (from, to) => {
      expect(isValidRunTransition(from, to)).toBe(true);
    },
  );

  const invalidTransitions: [SpecialistRunStatus, SpecialistRunStatus][] = [
    ["completed", "queued"],
    ["completed", "running"],
    ["cancelled", "queued"],
    ["completed", "failed"],
    ["failed", "running"],
    ["running", "created"],
    ["created", "running"],
    ["created", "completed"],
  ];

  it.each(invalidTransitions)(
    "blocks transition from %s to %s",
    (from, to) => {
      expect(isValidRunTransition(from, to)).toBe(false);
    },
  );

  it("does not allow completed runs to be re-queued", () => {
    expect(isValidRunTransition("completed", "queued")).toBe(false);
    expect(isValidRunTransition("completed", "running")).toBe(false);
    expect(isValidRunTransition("completed", "cancelled")).toBe(false);
  });

  it("allows failed runs to retry (failed → queued)", () => {
    expect(isValidRunTransition("failed", "queued")).toBe(true);
  });

  it("does not allow cancelled runs to resume", () => {
    const allStatuses: SpecialistRunStatus[] = [
      "created", "queued", "preparing", "running",
      "awaiting_clarification", "awaiting_approval",
      "waiting_for_dependency", "waiting_for_runtime",
      "completed", "failed", "expired",
    ];
    for (const to of allStatuses) {
      expect(isValidRunTransition("cancelled", to)).toBe(false);
    }
  });
});

// ─── Specialist Plan tests ────────────────────────────────────────────────────

describe("Sprint 9.5 — Specialist Plan", () => {
  it("builds a plan with correct step count", () => {
    const plan = buildSpecialistPlan("task-1", "org-1", [
      { capabilityCode: "compliance.policy_review", workforceRoleCode: "compliance_officer", workerProfileCode: "compliance_auditor" },
      { capabilityCode: "document.create_draft", workforceRoleCode: "document_specialist", workerProfileCode: "document_specialist_profile" },
    ]);

    expect(plan.planId).toBeTruthy();
    expect(plan.taskId).toBe("task-1");
    expect(plan.organizationId).toBe("org-1");
    expect(plan.steps).toHaveLength(2);
  });

  it("assigns step IDs", () => {
    const plan = buildSpecialistPlan("task-1", "org-1", [
      { capabilityCode: "compliance.policy_review", workforceRoleCode: "compliance_officer", workerProfileCode: "compliance_auditor" },
    ]);
    expect(plan.steps[0]!.id).toBeTruthy();
    expect(typeof plan.steps[0]!.id).toBe("string");
  });

  it("marks steps with no dependencies as pending and ready", () => {
    const plan = buildSpecialistPlan("task-1", "org-1", [
      { capabilityCode: "compliance.policy_review", workforceRoleCode: "compliance_officer", workerProfileCode: "compliance_auditor" },
      { capabilityCode: "document.create_draft", workforceRoleCode: "document_specialist", workerProfileCode: "document_specialist_profile" },
    ]);
    const readySteps = getReadySteps(plan);
    expect(readySteps).toHaveLength(2);
  });

  it("sets dependency on dependent steps", () => {
    const plan = buildSpecialistPlan("task-1", "org-1", [
      { capabilityCode: "compliance.policy_review", workforceRoleCode: "compliance_officer", workerProfileCode: "compliance_auditor" },
      {
        capabilityCode: "document.create_draft",
        workforceRoleCode: "document_specialist",
        workerProfileCode: "document_specialist_profile",
        dependsOnCapabilities: ["compliance.policy_review"],
      },
    ]);
    const docStep = plan.steps.find(s => s.capabilityCode === "document.create_draft");
    expect(docStep!.dependsOn).toHaveLength(1);
  });

  it("returns only steps with completed dependencies as ready", () => {
    const plan = buildSpecialistPlan("task-1", "org-1", [
      {
        capabilityCode: "compliance.policy_review",
        workforceRoleCode: "compliance_officer",
        workerProfileCode: "compliance_auditor",
      },
      {
        capabilityCode: "document.create_draft",
        workforceRoleCode: "document_specialist",
        workerProfileCode: "document_specialist_profile",
        dependsOnCapabilities: ["compliance.policy_review"],
      },
    ]);

    // Initially, only the first step is ready
    const initialReady = getReadySteps(plan);
    expect(initialReady).toHaveLength(1);
    expect(initialReady[0]!.capabilityCode).toBe("compliance.policy_review");

    // After marking the first step completed, the second becomes ready
    plan.steps[0]!.status = "completed";
    const afterReady = getReadySteps(plan);
    expect(afterReady).toHaveLength(1);
    expect(afterReady[0]!.capabilityCode).toBe("document.create_draft");
  });

  it("sets parallel group on parallel steps", () => {
    const plan = buildSpecialistPlan("task-1", "org-1", [
      {
        capabilityCode: "compliance.policy_review",
        workforceRoleCode: "compliance_officer",
        workerProfileCode: "compliance_auditor",
        parallelGroup: "group-a",
      },
      {
        capabilityCode: "document.create_draft",
        workforceRoleCode: "document_specialist",
        workerProfileCode: "document_specialist_profile",
        parallelGroup: "group-a",
      },
    ]);
    expect(plan.steps[0]!.parallelGroup).toBe("group-a");
    expect(plan.steps[1]!.parallelGroup).toBe("group-a");
  });
});

// ─── Work package validation ──────────────────────────────────────────────────

describe("Sprint 9.5 — Work Package Validation", () => {
  const makeValidPackage = () => ({
    specialistRunId: "run-1",
    organizationId: "org-1",
    taskId: "task-1",
    capabilityCode: "compliance.policy_review",
    capabilityLevel: "professional_analysis" as const,
    workforceRoleCode: "compliance_officer",
    workerProfileCode: "compliance_auditor",
    objective: "Review policy documents",
    responsibilities: ["Analyse compliance"],
    expectedOutputs: ["Findings report"],
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
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  });

  it("validates a correct work package", async () => {
    const pkg = makeValidPackage();
    const result = await validateWorkPackage(pkg);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("throws for missing specialistRunId", async () => {
    const pkg = { ...makeValidPackage(), specialistRunId: "" };
    await expect(validateWorkPackage(pkg)).rejects.toThrow("specialistRunId is required");
  });

  it("throws for missing organizationId", async () => {
    const pkg = { ...makeValidPackage(), organizationId: "" };
    await expect(validateWorkPackage(pkg)).rejects.toThrow("organizationId is required");
  });

  it("throws for expired work package", async () => {
    const pkg = { ...makeValidPackage(), expiresAt: new Date(Date.now() - 1000).toISOString() };
    await expect(validateWorkPackage(pkg)).rejects.toThrow("already expired");
  });

  it("warns for large memory item count", async () => {
    const pkg = {
      ...makeValidPackage(),
      approvedOrganisationMemory: Array.from({ length: 51 }, (_, i) => ({
        id: `mem-${i}`,
        content: "content",
        category: "compliance",
      })),
    };
    const result = await validateWorkPackage(pkg);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain("50 memory items");
  });
});
