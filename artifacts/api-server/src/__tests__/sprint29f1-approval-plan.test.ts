/**
 * sprint29f1-approval-plan.test.ts — Sprint 29F.1 Part 3
 *
 * Tests the ExecutionApprovalPlanService:
 *   A — Plan creation: grouping logic, item classification
 *   B — Plan binding: hash computation, binding fields
 *   C — Plan validation: expiry, mutation, device change
 *   D — Architecture: plan UI contract (required fields)
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  createApprovalPlan,
  validateApprovalPlan,
  isApprovalPlanExpired,
  type ApprovalPlan,
} from "../services/executionApprovalPlanService.js";
import type { ExecutionAction } from "../types/canonicalExecutionContext.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeAction(overrides: Partial<ExecutionAction> = {}): ExecutionAction {
  return {
    actionId:        `act_${Math.random().toString(36).slice(2, 8)}`,
    actionType:      "write_file",
    domain:          "files",
    description:     "Write policy document",
    riskLevel:       "medium",
    requiresApproval: true,
    status:          "approved",
    proposedAt:      new Date().toISOString(),
    resolvedDestination: { displayPath: "Documents/policy.docx" },
    parameters:      {},
    ...overrides,
  } as ExecutionAction;
}

// ─── Suite A — Plan creation ──────────────────────────────────────────────────

describe("Deliverable A — Plan creation and grouping", () => {
  it("creates a plan with required top-level fields", () => {
    const actions = [makeAction()];
    const plan = createApprovalPlan(actions, "exec_001", "operations_manager", "device_001");
    expect(plan.planId).toBeTruthy();
    expect(plan.executionId).toBe("exec_001");
    expect(plan.specialistCode).toBe("operations_manager");
    expect(plan.deviceId).toBe("device_001");
    expect(plan.expiresAt).toBeTruthy();
    expect(plan.status).toBe("pending");
    expect(plan.bindingHash).toBeTruthy();
  });

  it("low/medium-risk write actions are grouped (not separate)", () => {
    const actions = [
      makeAction({ riskLevel: "low" }),
      makeAction({ riskLevel: "medium" }),
    ];
    const plan = createApprovalPlan(actions, "exec_001", "ops_mgr", "dev_001");
    expect(plan.groupedItems.length).toBe(2);
    expect(plan.separateItems.length).toBe(0);
  });

  it("high-risk actions require separate confirmation", () => {
    const actions = [
      makeAction({ riskLevel: "high" }),
      makeAction({ riskLevel: "critical" }),
    ];
    const plan = createApprovalPlan(actions, "exec_001", "ops_mgr", "dev_001");
    expect(plan.separateItems.length).toBe(2);
    expect(plan.groupedItems.length).toBe(0);
  });

  it("mixed risk: low/medium grouped, high separate", () => {
    const actions = [
      makeAction({ riskLevel: "low" }),
      makeAction({ riskLevel: "medium" }),
      makeAction({ riskLevel: "high" }),
    ];
    const plan = createApprovalPlan(actions, "exec_001", "ops_mgr", "dev_001");
    expect(plan.groupedItems.length).toBe(2);
    expect(plan.separateItems.length).toBe(1);
    expect(plan.context.totalActions).toBe(3);
  });

  it("delete_file action type requires separate approval regardless of riskLevel", () => {
    const action = makeAction({ actionType: "delete_file", riskLevel: "low" });
    const plan = createApprovalPlan([action], "exec_001", "ops_mgr", "dev_001");
    expect(plan.separateItems.length).toBe(1);
    expect(plan.groupedItems.length).toBe(0);
  });

  it("plan items include side effect descriptions", () => {
    const action = makeAction({ domain: "email", actionType: "draft_email", riskLevel: "low" });
    const plan = createApprovalPlan([action], "exec_001", "ops_mgr", "dev_001");
    const item = plan.items[0]!;
    expect(item.sideEffects.length).toBeGreaterThan(0);
    expect(item.sideEffects.some(e => e.toLowerCase().includes("draft"))).toBe(true);
  });

  it("all-reversible flag is false when any irreversible action exists", () => {
    const actions = [
      makeAction({ actionType: "write_file" }),   // reversible
      makeAction({ actionType: "move_file" }),    // irreversible
    ];
    const plan = createApprovalPlan(actions, "exec_001", "ops_mgr", "dev_001");
    expect(plan.context.allReversible).toBe(false);
  });

  it("highestRisk reflects the most severe action", () => {
    const actions = [
      makeAction({ riskLevel: "low" }),
      makeAction({ riskLevel: "critical" }),
    ];
    const plan = createApprovalPlan(actions, "exec_001", "ops_mgr", "dev_001");
    expect(plan.context.highestRisk).toBe("critical");
  });
});

// ─── Suite B — Plan binding ───────────────────────────────────────────────────

describe("Deliverable B — Plan binding hash", () => {
  it("same inputs produce the same binding hash", () => {
    const actions = [makeAction({ actionId: "act_fixed" })];
    const plan1 = createApprovalPlan(actions, "exec_001", "ops_mgr", "dev_001");
    const plan2 = createApprovalPlan(actions, "exec_001", "ops_mgr", "dev_001");
    expect(plan1.bindingHash).toBe(plan2.bindingHash);
  });

  it("different executionId produces different binding hash", () => {
    const actions = [makeAction({ actionId: "act_fixed" })];
    const plan1 = createApprovalPlan(actions, "exec_001", "ops_mgr", "dev_001");
    const plan2 = createApprovalPlan(actions, "exec_999", "ops_mgr", "dev_001");
    expect(plan1.bindingHash).not.toBe(plan2.bindingHash);
  });

  it("different deviceId produces different binding hash", () => {
    const actions = [makeAction({ actionId: "act_fixed" })];
    const plan1 = createApprovalPlan(actions, "exec_001", "ops_mgr", "dev_001");
    const plan2 = createApprovalPlan(actions, "exec_001", "ops_mgr", "dev_999");
    expect(plan1.bindingHash).not.toBe(plan2.bindingHash);
  });

  it("different action targets produce different binding hash", () => {
    const act1 = makeAction({ actionId: "act_fixed", resolvedDestination: { displayPath: "Documents/a.docx" } });
    const act2 = makeAction({ actionId: "act_fixed", resolvedDestination: { displayPath: "Desktop/b.docx" } });
    const plan1 = createApprovalPlan([act1], "exec_001", "ops_mgr", "dev_001");
    const plan2 = createApprovalPlan([act2], "exec_001", "ops_mgr", "dev_001");
    expect(plan1.bindingHash).not.toBe(plan2.bindingHash);
  });
});

// ─── Suite C — Plan validation ────────────────────────────────────────────────

describe("Deliverable C — Plan validation", () => {
  it("approved plan with same actions validates successfully", () => {
    const actions = [makeAction({ actionId: "act_fixed" })];
    const plan: ApprovalPlan = {
      ...createApprovalPlan(actions, "exec_001", "ops_mgr", "dev_001"),
      status: "approved",
    };
    const result = validateApprovalPlan(plan, actions, "dev_001");
    expect(result.valid).toBe(true);
  });

  it("pending plan (not yet approved) fails validation", () => {
    const actions = [makeAction({ actionId: "act_fixed" })];
    const plan = createApprovalPlan(actions, "exec_001", "ops_mgr", "dev_001");
    // status is "pending" by default
    const result = validateApprovalPlan(plan, actions, "dev_001");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("status");
  });

  it("expired plan fails validation", () => {
    const actions = [makeAction({ actionId: "act_fixed" })];
    const plan: ApprovalPlan = {
      ...createApprovalPlan(actions, "exec_001", "ops_mgr", "dev_001", 1), // 1ms expiry
      status: "approved",
    };
    // Wait for expiry
    plan.expiresAt = new Date(Date.now() - 1000).toISOString();
    const result = validateApprovalPlan(plan, actions, "dev_001");
    expect(result.valid).toBe(false);
    expect(result.changedFields).toContain("expiresAt");
  });

  it("action set mutation invalidates plan", () => {
    const act1 = makeAction({ actionId: "act_fixed" });
    const plan: ApprovalPlan = {
      ...createApprovalPlan([act1], "exec_001", "ops_mgr", "dev_001"),
      status: "approved",
    };
    // Add an extra action that wasn't in the original approval
    const act2 = makeAction({ actionId: "act_extra" });
    const result = validateApprovalPlan(plan, [act1, act2], "dev_001");
    expect(result.valid).toBe(false);
    expect(result.changedFields).toContain("actions");
  });

  it("isApprovalPlanExpired returns true for past expiry", () => {
    const plan: ApprovalPlan = {
      ...createApprovalPlan([makeAction()], "exec_001", "ops_mgr", "dev_001"),
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    };
    expect(isApprovalPlanExpired(plan)).toBe(true);
  });

  it("isApprovalPlanExpired returns false for future expiry", () => {
    const plan = createApprovalPlan([makeAction()], "exec_001", "ops_mgr", "dev_001");
    expect(isApprovalPlanExpired(plan)).toBe(false);
  });
});

// ─── Suite D — Architecture: approval UI contract ─────────────────────────────

describe("Deliverable D — Approval UI contract", () => {
  it("plan context includes all required UI fields", () => {
    const plan = createApprovalPlan([makeAction()], "exec_001", "ops_mgr", "dev_001");
    expect(plan.context).toHaveProperty("totalActions");
    expect(plan.context).toHaveProperty("totalGrouped");
    expect(plan.context).toHaveProperty("totalSeparate");
    expect(plan.context).toHaveProperty("allReversible");
    expect(plan.context).toHaveProperty("highestRisk");
    expect(plan.context).toHaveProperty("specialist");
    expect(plan.context).toHaveProperty("device");
  });

  it("plan expiry is within the configured window", () => {
    const before = Date.now();
    const plan = createApprovalPlan([makeAction()], "exec_001", "ops_mgr", "dev_001");
    const after = Date.now();
    const expiresMs = new Date(plan.expiresAt).getTime();
    // Default 15-minute window
    expect(expiresMs).toBeGreaterThan(before + 14 * 60 * 1_000);
    expect(expiresMs).toBeLessThan(after + 16 * 60 * 1_000);
  });

  it("plan includes device and specialist for UI attribution", () => {
    const plan = createApprovalPlan([makeAction()], "exec_001", "ops_manager", "device_mac_001");
    expect(plan.deviceId).toBe("device_mac_001");
    expect(plan.specialistCode).toBe("ops_manager");
    expect(plan.context.specialist).toBe("ops_manager");
    expect(plan.context.device).toBe("device_mac_001");
  });

  it("high-risk items have requiresSeparateApproval:true", () => {
    const plan = createApprovalPlan(
      [makeAction({ riskLevel: "high" })],
      "exec_001", "ops_mgr", "dev_001",
    );
    expect(plan.separateItems[0]!.requiresSeparateApproval).toBe(true);
  });
});
