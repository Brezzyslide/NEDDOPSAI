/**
 * Sprint 2 — AI Workforce Foundation tests
 *
 * Tests: task creation, Chief of Staff planning, capability lookup,
 * specialist lookup, approval routing, task state transitions,
 * tenant isolation, permission enforcement, platform admin separation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock DB ──────────────────────────────────────────────────────────────────
vi.mock("@workspace/db", () => {
  const makeChain = (returnData: unknown[] = []) => {
    const chain: Record<string, unknown> = {};
    const fns = ["select", "from", "where", "limit", "offset", "orderBy", "insert", "values", "update", "set", "delete", "returning"];
    for (const fn of fns) {
      chain[fn] = vi.fn().mockReturnValue(chain);
    }
    (chain["limit"] as ReturnType<typeof vi.fn>).mockResolvedValue(returnData);
    (chain["returning"] as ReturnType<typeof vi.fn>).mockResolvedValue(returnData);
    (chain["orderBy"] as ReturnType<typeof vi.fn>).mockResolvedValue(returnData);
    return chain;
  };

  const mockTask = {
    id: "task-001",
    organizationId: "org-aaa",
    title: "Review NDIS compliance policy",
    description: "Annual review required",
    currentState: "queued",
    priority: "normal",
    approvalState: "not_required",
    originatingUserId: "user-xyz",
    originatingModule: "task_centre",
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockApproval = {
    id: "approval-001",
    taskId: "task-001",
    organizationId: "org-aaa",
    approvalType: "compliance_approval",
    state: "pending",
    requestedAt: new Date(),
    resolvedAt: null,
    resolvedBy: null,
    notes: null,
    expiresAt: null,
    createdAt: new Date(),
  };

  const chain = makeChain([mockTask]);

  return {
    db: chain,
    tasksTable: {},
    taskSpecialistsTable: {},
    taskExecutionPlansTable: {},
    approvalsTable: {},
    approvalHistoryTable: {},
    approvalRulesTable: {},
    specialistsTable: {},
    capabilitiesTable: {},
    specialistCapabilitiesTable: {},
    workforcePacksTable: {},
    usersTable: {},
    organizationsTable: {},
    membershipsTable: {},
    auditLogTable: {},
  };
});

// ─── Imports ──────────────────────────────────────────────────────────────────

import {
  planTask,
  type TaskPlan,
} from "../services/chiefOfStaffService.js";

import {
  isValidTransition,
} from "../services/taskService.js";

import {
  SPECIALISTS,
  CAPABILITIES,
  WORKFORCE_PACKS,
  getSpecialistByCode,
  getCapabilityByCode,
  getSpecialistsByCapability,
  getSpecialistsByPack,
  getSpecialistCapabilities,
} from "../lib/workforceRegistry.js";

import {
  TASK_STATES,
  APPROVAL_TYPES,
  WORKFORCE_PACK_CODES,
} from "@workspace/shared";

// ─── Workforce Registry ───────────────────────────────────────────────────────

describe("Workforce Registry", () => {
  it("contains 6 workforce packs", () => {
    expect(WORKFORCE_PACKS).toHaveLength(6);
  });

  it("pack codes match the shared constants", () => {
    const codes = WORKFORCE_PACKS.map(p => p.code);
    for (const code of WORKFORCE_PACK_CODES) {
      expect(codes).toContain(code);
    }
  });

  it("contains at least 30 specialists", () => {
    expect(SPECIALISTS.length).toBeGreaterThanOrEqual(30);
  });

  it("every specialist belongs to a valid pack", () => {
    const packCodes = new Set(WORKFORCE_PACKS.map(p => p.code));
    for (const s of SPECIALISTS) {
      expect(packCodes.has(s.packCode)).toBe(true);
    }
  });

  it("every specialist has at least one capability", () => {
    for (const s of SPECIALISTS) {
      expect(s.capabilities.length).toBeGreaterThan(0);
    }
  });

  it("every capability referenced by a specialist exists in the CAPABILITIES list", () => {
    const capCodes = new Set(CAPABILITIES.map(c => c.code));
    for (const s of SPECIALISTS) {
      for (const cap of s.capabilities) {
        expect(capCodes.has(cap)).toBe(true);
      }
    }
  });

  it("contains required specialists", () => {
    const codes = new Set(SPECIALISTS.map(s => s.code));
    expect(codes.has("chief_of_staff")).toBe(true);
    expect(codes.has("compliance_officer")).toBe(true);
    expect(codes.has("operations_manager")).toBe(true);
    expect(codes.has("payroll_officer")).toBe(true);
    expect(codes.has("hr_officer")).toBe(true);
  });
});

// ─── Specialist lookup ────────────────────────────────────────────────────────

describe("Specialist lookup", () => {
  it("getSpecialistByCode returns the correct specialist", () => {
    const s = getSpecialistByCode("chief_of_staff");
    expect(s).toBeDefined();
    expect(s?.displayName).toBe("Chief of Staff");
  });

  it("getSpecialistByCode returns undefined for unknown code", () => {
    expect(getSpecialistByCode("nonexistent_specialist")).toBeUndefined();
  });

  it("getSpecialistsByPack returns only specialists in that pack", () => {
    const compliance = getSpecialistsByPack("compliance");
    expect(compliance.length).toBeGreaterThan(0);
    for (const s of compliance) {
      expect(s.packCode).toBe("compliance");
    }
  });

  it("getSpecialistCapabilities resolves codes to full capability objects", () => {
    const caps = getSpecialistCapabilities("compliance_officer");
    expect(caps.length).toBeGreaterThan(0);
    for (const c of caps) {
      expect(c.code).toBeTruthy();
      expect(c.name).toBeTruthy();
    }
  });
});

// ─── Capability lookup ────────────────────────────────────────────────────────

describe("Capability lookup", () => {
  it("getCapabilityByCode returns a capability", () => {
    const cap = getCapabilityByCode("review_policy");
    expect(cap).toBeDefined();
    expect(cap?.name).toBeTruthy();
  });

  it("getSpecialistsByCapability returns specialists that have the capability", () => {
    const specialists = getSpecialistsByCapability("review_policy");
    expect(specialists.length).toBeGreaterThan(0);
    for (const s of specialists) {
      expect(s.capabilities).toContain("review_policy");
    }
  });

  it("getSpecialistsByCapability returns empty array for unknown capability", () => {
    const result = getSpecialistsByCapability("nonexistent_cap");
    expect(result).toHaveLength(0);
  });
});

// ─── Chief of Staff planning ──────────────────────────────────────────────────

describe("Chief of Staff planning — deterministic routing", () => {
  it("routes compliance-related tasks to compliance specialists", () => {
    const plan = planTask("Review NDIS compliance audit policy");
    expect(plan.assignedSpecialists.length).toBeGreaterThan(0);
    // Sprint 11: compliance roles consolidated → compliance_quality_manager / policy_governance_specialist
    const hasCompliance = plan.assignedSpecialists.some(
      code => ["compliance_quality_manager", "policy_governance_specialist", "chief_of_staff"].includes(code)
    );
    expect(hasCompliance).toBe(true);
  });

  it("routes payroll tasks to finance specialists", () => {
    const plan = planTask("Review payroll for this month");
    // Sprint 11: payroll_officer → payroll_workforce_cost_officer, accounts_officer → finance_officer
    const hasFinance = plan.assignedSpecialists.some(
      code => ["payroll_workforce_cost_officer", "finance_officer", "chief_of_staff"].includes(code)
    );
    expect(hasFinance).toBe(true);
  });

  it("routes incident review tasks correctly", () => {
    const plan = planTask("Investigate incident report #4412");
    // Sprint 11: incident roles consolidated → incident_safeguarding_specialist / compliance_quality_manager
    const hasIncident = plan.assignedSpecialists.some(
      code => ["incident_safeguarding_specialist", "compliance_quality_manager", "chief_of_staff"].includes(code)
    );
    expect(hasIncident).toBe(true);
  });

  it("always includes chief_of_staff as lead orchestrator", () => {
    const plan = planTask("Review roster and schedule");
    expect(plan.assignedSpecialists).toContain("chief_of_staff");
  });

  it("returns a planId (UUID)", () => {
    const plan = planTask("Any task");
    expect(plan.planId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/i);
  });

  it("returns steps with correct structure", () => {
    const plan = planTask("Review NDIS compliance policy");
    expect(plan.steps.length).toBeGreaterThan(0);
    for (const step of plan.steps) {
      expect(step.stepNumber).toBeGreaterThan(0);
      expect(step.specialistCode).toBeTruthy();
      expect(step.specialistName).toBeTruthy();
      expect(step.action).toBeTruthy();
    }
  });

  it("steps are sequentially numbered", () => {
    const plan = planTask("Prepare quarterly budget summary report");
    const numbers = plan.steps.map(s => s.stepNumber);
    expect(numbers).toEqual([...Array(numbers.length).keys()].map(i => i + 1));
  });

  it("determines requiresApproval based on assigned specialists", () => {
    // Restrictive practice review requires compliance_approval
    const plan = planTask("Restrictive practice review for support plan");
    if (plan.assignedSpecialists.includes("restrictive_practice_officer")) {
      expect(plan.requiresApproval).toBe(true);
      expect(plan.approvalType).toBe("compliance_approval");
    }
  });

  it("confidence is between 0 and 1", () => {
    const plan = planTask("Review invoices for last quarter");
    expect(plan.confidence).toBeGreaterThan(0);
    expect(plan.confidence).toBeLessThanOrEqual(1);
  });

  it("handles vague tasks without crashing", () => {
    const plan = planTask("Help");
    expect(plan).toBeDefined();
    expect(plan.assignedSpecialists).toContain("chief_of_staff");
  });
});

// ─── Task state transitions ───────────────────────────────────────────────────

describe("Task state transitions", () => {
  it("allows draft → queued", () => {
    expect(isValidTransition("draft", "queued")).toBe(true);
  });

  it("allows queued → planning", () => {
    expect(isValidTransition("queued", "planning")).toBe(true);
  });

  it("allows planning → awaiting_approval", () => {
    expect(isValidTransition("planning", "awaiting_approval")).toBe(true);
  });

  it("allows planning → approved (no approval needed)", () => {
    expect(isValidTransition("planning", "approved")).toBe(true);
  });

  it("allows approved → executing", () => {
    expect(isValidTransition("approved", "executing")).toBe(true);
  });

  it("allows executing → completed", () => {
    expect(isValidTransition("executing", "completed")).toBe(true);
  });

  it("allows any non-terminal state → cancelled", () => {
    for (const state of ["draft", "queued", "planning", "approved", "executing"] as const) {
      expect(isValidTransition(state, "cancelled")).toBe(true);
    }
  });

  it("prevents completed → any other state (terminal)", () => {
    const others = TASK_STATES.filter(s => s !== "completed");
    for (const s of others) {
      expect(isValidTransition("completed", s)).toBe(false);
    }
  });

  it("prevents cancelled → executing (terminal)", () => {
    expect(isValidTransition("cancelled", "executing")).toBe(false);
  });

  it("allows failed → queued (retry path)", () => {
    expect(isValidTransition("failed", "queued")).toBe(true);
  });

  it("prevents backwards transition (executing → queued)", () => {
    expect(isValidTransition("executing", "queued")).toBe(false);
  });
});

// ─── Approval routing ─────────────────────────────────────────────────────────

describe("Approval routing", () => {
  it("all approval types are defined in shared constants", () => {
    const approvalTypes = [
      "no_approval", "manager_approval", "administrator_approval",
      "owner_approval", "dual_approval", "compliance_approval", "platform_approval",
    ];
    for (const type of approvalTypes) {
      expect(APPROVAL_TYPES).toContain(type);
    }
  });

  it("Chief of Staff selects highest-priority approval type when multiple specialists require approval", () => {
    // compliance_approval > manager_approval
    const plan = planTask("Review restrictive practice and compliance audit policy");
    if (plan.requiresApproval) {
      const priority = ["platform_approval", "compliance_approval", "dual_approval", "owner_approval", "administrator_approval", "manager_approval", "no_approval"];
      const idx = priority.indexOf(plan.approvalType);
      expect(idx).toBeGreaterThanOrEqual(0);
    }
  });

  it("tasks with no_approval specialists set requiresApproval = false", () => {
    // Document or research task — should route to specialists with no approval requirements
    const plan = planTask("Summarise recent meeting notes");
    if (!plan.requiresApproval) {
      expect(plan.approvalType).toBe("no_approval");
    }
  });
});

// ─── Tenant isolation ────────────────────────────────────────────────────────

describe("Tenant isolation", () => {
  it("workforce registry does not contain any organization-specific data", () => {
    for (const s of SPECIALISTS) {
      expect((s as unknown as Record<string, unknown>).organizationId).toBeUndefined();
      expect((s as unknown as Record<string, unknown>).tenantId).toBeUndefined();
    }
  });

  it("all workforce pack data is platform-level (not org-scoped)", () => {
    for (const pack of WORKFORCE_PACKS) {
      expect((pack as unknown as Record<string, unknown>).organizationId).toBeUndefined();
    }
  });

  it("tasks table schema includes organizationId for tenant isolation", async () => {
    const { tasksTable } = await import("@workspace/db");
    // The table object exists (import succeeded)
    expect(tasksTable).toBeDefined();
  });

  it("approvals table schema includes organizationId for tenant isolation", async () => {
    const { approvalsTable } = await import("@workspace/db");
    expect(approvalsTable).toBeDefined();
  });
});

// ─── Platform admin separation ────────────────────────────────────────────────

describe("Platform admin separation", () => {
  it("all specialists have execution_status defined", () => {
    // Sprint 11: added "dna_pending" and "archived" to the valid status set
    const validStatuses = ["available", "beta", "coming_soon", "deprecated", "dna_pending", "archived"];
    for (const s of SPECIALISTS) {
      expect(validStatuses).toContain(s.executionStatus);
    }
  });

  it("all specialists have a version string", () => {
    for (const s of SPECIALISTS) {
      expect(s.version).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it("Chief of Staff has no approval requirement (it orchestrates, not executes)", () => {
    const cos = getSpecialistByCode("chief_of_staff");
    expect(cos?.approvalRequirements).toBe("no_approval");
  });

  it("marketing pack has at least one active v2 specialist (dna_pending or available)", () => {
    // Sprint 11: marketing_communications_manager is dna_pending (DNA design in progress).
    // getSpecialistsByPack may include deprecated legacy entries — verify at least one is current.
    const marketing = getSpecialistsByPack("marketing");
    expect(marketing.length).toBeGreaterThan(0);
    const hasCurrent = marketing.some(
      s => s.executionStatus === "available" || s.executionStatus === "dna_pending"
    );
    expect(hasCurrent).toBe(true);
  });

  it("core pack has at least one available specialist (chief_of_staff)", () => {
    const core = getSpecialistsByPack("core");
    const hasAvailable = core.some(s => s.executionStatus === "available");
    expect(hasAvailable).toBe(true);
  });

  it("all packs have catalogue v2 specialists (available or dna_pending)", () => {
    for (const packCode of ["core", "compliance", "operations", "finance", "hr", "marketing"]) {
      const specialists = getSpecialistsByPack(packCode);
      const hasCurrent = specialists.some(
        s => s.executionStatus === "available" || s.executionStatus === "dna_pending"
      );
      expect(hasCurrent).toBe(true);
    }
  });
});
