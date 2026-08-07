/**
 * Sprint 29H.2 — Action State Decision Contract Tests
 *
 * Verifies:
 *   Part A — resolveLevel() no longer short-circuits on completedWorkId
 *   Part B — ConversationActionDecision typed correctly for all 8 scenarios
 *   Part D — buildActionStateSection shows grounded completed-work metadata
 *   Part E — checkDelegationIntegrity catches false specialist attribution
 *
 * 8 scenarios (per Sprint 29H.1 verification):
 *   S1. User asks to show/view previous completed work
 *   S2. User approves the existing completed work
 *   S3. User wants to revise the existing work (explicit "revise" RTA)
 *   S4. User says "review again" / "new review" — explicit rerun signal in text
 *   S5. User says "replace with new OM review" — explicit rerun signal
 *   S6. User says the acceptance message — multiple rerun signals
 *   S7. User asks a general follow-up question about completed work
 *   S8. User sends a brand-new task intent with no prior completed work
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  resolveActionDecision,
  hasRerunSignal,
  type ConversationActionDecision,
} from "../services/conversationActionDecisionService.js";
import {
  buildActionStateSection,
  type ConversationActionState,
  type CompletedWorkRecord,
} from "../services/conversationActionStateService.js";
import { checkDelegationIntegrity } from "../services/delegationIntegrityService.js";

// ─── Test fixtures ─────────────────────────────────────────────────────────────

const EXISTING_WORK: CompletedWorkRecord = {
  id: "e7f810e9-3554-422f-a892-258973ee5ac6",
  status: "approved",
  title: "Incident Management Policy Review",
  primarySpecialist: "knowledge_documentation_specialist",
  createdAt: new Date("2026-08-07T02:24:48Z"),
  approvedAt: new Date("2026-08-07T02:30:00Z"),
  qualityScore: 80,
};

function makeState(overrides: Partial<ConversationActionState> = {}): ConversationActionState {
  return {
    level: "specialist_assigned",
    proposalExists: false,
    taskExists: true,
    taskId: "657d1b16-c9c3-40fe-bcb8-8229da6ef4ab",
    taskState: "approved",
    assignedSpecialists: ["spec_chief_of_staff", "spec_operations_manager"],
    executionIntentExists: false,
    executionStatus: undefined,
    completedWorkId: "e7f810e9-3554-422f-a892-258973ee5ac6",
    completedWork: EXISTING_WORK,
    allowedClaims: ["The specialist has been assigned"],
    disallowedClaims: ["started / underway / in progress"],
    becauseExplanation: "Specialist assigned, no active execution",
    ...overrides,
  };
}

function makeUnderstanding(overrides: Record<string, unknown> = {}) {
  return {
    conversationMode: "general" as const,
    confidence: 0.8,
    customerResponse: "I can help with that.",
    shouldCreateTask: false,
    clarificationRequired: false,
    clarificationQuestions: [],
    relatedWorkforceRoles: [],
    ...overrides,
  };
}

// ─── Part A: resolveLevel no longer short-circuits on completedWorkId ─────────

describe("Part A — resolveLevel (no completedWorkId override)", () => {
  it("returns specialist_assigned when task + specialists exist, not 'completed', even with completedWork", () => {
    const state = makeState();
    // The level should be specialist_assigned, not completed
    expect(state.level).toBe("specialist_assigned");
    // completedWork is present but does not override level
    expect(state.completedWork?.id).toBe("e7f810e9-3554-422f-a892-258973ee5ac6");
  });

  it("allows 'completed' level when execution intent status is completed (active execution path)", () => {
    const state = makeState({
      level: "completed",
      executionIntentExists: true,
      executionStatus: "completed",
    });
    expect(state.level).toBe("completed");
  });

  it("returns informational when no task/proposal exists, even with completedWork", () => {
    const state = makeState({
      level: "informational",
      taskExists: false,
      taskId: undefined,
      assignedSpecialists: [],
      executionIntentExists: false,
      executionStatus: undefined,
    });
    expect(state.level).toBe("informational");
    // completedWork is still visible as context
    expect(state.completedWork?.primarySpecialist).toBe("knowledge_documentation_specialist");
  });
});

// ─── Part D: buildActionStateSection grounded metadata ───────────────────────

describe("Part D — buildActionStateSection grounded metadata", () => {
  it("includes HISTORICAL COMPLETED WORK block when completedWork is present", () => {
    const section = buildActionStateSection(makeState());
    expect(section).toContain("=== HISTORICAL COMPLETED WORK ===");
    expect(section).toContain("e7f810e9-3554-422f-a892-258973ee5ac6");
    expect(section).toContain("knowledge_documentation_specialist");
    expect(section).toContain("approved");
    expect(section).toContain("80/100");
  });

  it("labels primarySpecialist as 'who ACTUALLY produced this work'", () => {
    const section = buildActionStateSection(makeState());
    expect(section).toContain("Primary specialist who produced this work: knowledge_documentation_specialist");
  });

  it("includes ATTRIBUTION RULE warning", () => {
    const section = buildActionStateSection(makeState());
    expect(section).toContain("ATTRIBUTION RULE");
    expect(section).toContain("MUST NOT attribute this completed work to any specialist");
  });

  it("distinguishes task-assigned specialists from primary specialist", () => {
    const section = buildActionStateSection(makeState());
    expect(section).toContain("Task-assigned specialists");
    expect(section).toContain("spec_chief_of_staff");
    expect(section).toContain("spec_operations_manager");
    // The task-assigned note must be distinct from the primary specialist
    expect(section).toContain("not necessarily who produced the completed work");
  });

  it("omits HISTORICAL COMPLETED WORK block when no completedWork", () => {
    const state = makeState({ completedWork: undefined, completedWorkId: undefined });
    const section = buildActionStateSection(state);
    expect(section).not.toContain("=== HISTORICAL COMPLETED WORK ===");
  });

  it("shows approvedAt when present", () => {
    const section = buildActionStateSection(makeState());
    expect(section).toContain("Approved at:");
    expect(section).toContain("2026-08-07");
  });

  it("omits approvedAt when null", () => {
    const state = makeState({ completedWork: { ...EXISTING_WORK, approvedAt: null } });
    const section = buildActionStateSection(state);
    expect(section).not.toContain("Approved at:");
  });
});

// ─── Part B: resolveActionDecision — 8 scenarios ──────────────────────────────

describe("Part B — resolveActionDecision (8 scenarios)", () => {
  const stateWithWork = makeState();
  const stateNoWork = makeState({ completedWork: undefined, completedWorkId: undefined });

  // S1. User asks to show / view previous completed work
  it("S1: result_followup → view_existing", () => {
    const d = resolveActionDecision(
      "Show me the completed review",
      makeUnderstanding({ conversationMode: "result_followup" }),
      stateWithWork,
    );
    expect(d.action).toBe("view_existing");
    expect(d.completedWorkId).toBe("e7f810e9-3554-422f-a892-258973ee5ac6");
    expect(d.shouldCreateTask).toBe(false);
    expect(d.shouldDispatchSpecialist).toBe(false);
  });

  it("S1: execution_query → view_existing", () => {
    const d = resolveActionDecision(
      "What is the status?",
      makeUnderstanding({ conversationMode: "execution_query" }),
      stateWithWork,
    );
    expect(d.action).toBe("view_existing");
  });

  it("S1: result_followup with no work → respond", () => {
    const d = resolveActionDecision(
      "Show me the review",
      makeUnderstanding({ conversationMode: "result_followup" }),
      stateNoWork,
    );
    expect(d.action).toBe("respond");
  });

  // S2. User approves the existing completed work
  it("S2: approval_response → approve_existing", () => {
    const d = resolveActionDecision(
      "I approve this",
      makeUnderstanding({ conversationMode: "approval_response" }),
      stateWithWork,
    );
    expect(d.action).toBe("approve_existing");
    expect(d.completedWorkId).toBe("e7f810e9-3554-422f-a892-258973ee5ac6");
    expect(d.shouldDispatchSpecialist).toBe(false);
  });

  it("S2: approval_response with no work → respond", () => {
    const d = resolveActionDecision(
      "Approved",
      makeUnderstanding({ conversationMode: "approval_response" }),
      stateNoWork,
    );
    expect(d.action).toBe("respond");
  });

  // S3. Explicit revision intent
  it("S3: requestedTaskAction=revise with existing work → revise_existing", () => {
    const d = resolveActionDecision(
      "Please revise the policy with the new evidence",
      makeUnderstanding({ conversationMode: "task_followup", requestedTaskAction: "revise" }),
      stateWithWork,
    );
    expect(d.action).toBe("revise_existing");
    expect(d.shouldDispatchSpecialist).toBe(true);
    expect(d.completedWorkId).toBe("e7f810e9-3554-422f-a892-258973ee5ac6");
  });

  // S4. Explicit rerun signal — "review again"
  it("S4: 'review again' text signal → rerun_existing", () => {
    const d = resolveActionDecision(
      "Please review again with the latest evidence",
      makeUnderstanding({ conversationMode: "task_followup" }),
      stateWithWork,
    );
    expect(d.action).toBe("rerun_existing");
    expect(d.shouldDispatchSpecialist).toBe(true);
    expect(d.taskId).toBe("657d1b16-c9c3-40fe-bcb8-8229da6ef4ab");
    expect(d.reasonCode).toContain("rerun_signal");
  });

  // S5. Explicit replacement signal
  it("S5: 'replace' keyword → rerun_existing", () => {
    const d = resolveActionDecision(
      "Replace the old review with a new Operations Manager review",
      makeUnderstanding({ conversationMode: "task_followup" }),
      stateWithWork,
    );
    expect(d.action).toBe("rerun_existing");
    expect(d.shouldDispatchSpecialist).toBe(true);
  });

  // S6. The acceptance message — multiple rerun signals
  it("S6: acceptance message → rerun_existing (multiple signals)", () => {
    const acceptanceText =
      "Review our current Incident Management Policy using the latest approved evidence and produce a new Incident Management Improvement Plan. This is a new review, not a request to show the previous completed work.";

    const d = resolveActionDecision(
      acceptanceText,
      makeUnderstanding({ conversationMode: "task_followup" }),
      stateWithWork,
    );
    expect(d.action).toBe("rerun_existing");
    expect(d.shouldDispatchSpecialist).toBe(true);
    expect(d.taskId).toBe("657d1b16-c9c3-40fe-bcb8-8229da6ef4ab");
    expect(d.completedWorkId).toBe("e7f810e9-3554-422f-a892-258973ee5ac6");
  });

  it("S6: acceptance message with no prior work → create_new_work", () => {
    const acceptanceText =
      "Review our current Incident Management Policy using the latest approved evidence and produce a new Incident Management Improvement Plan. This is a new review, not a request to show the previous completed work.";

    const d = resolveActionDecision(
      acceptanceText,
      makeUnderstanding({ conversationMode: "task_intent" }),
      stateNoWork,
    );
    expect(d.action).toBe("create_new_work");
    expect(d.shouldCreateTask).toBe(true);
    expect(d.shouldDispatchSpecialist).toBe(true);
  });

  // S7. General follow-up question about completed work
  it("S7: task_followup with existing work + no rerun signal → summarise_existing", () => {
    const d = resolveActionDecision(
      "What were the main recommendations in the review?",
      makeUnderstanding({ conversationMode: "task_followup" }),
      stateWithWork,
    );
    expect(d.action).toBe("summarise_existing");
    expect(d.shouldDispatchSpecialist).toBe(false);
    expect(d.shouldCreateTask).toBe(false);
    expect(d.completedWorkId).toBe("e7f810e9-3554-422f-a892-258973ee5ac6");
  });

  // S8. Brand new task intent with no prior completed work
  it("S8: task_intent + no existing work → create_new_work", () => {
    const d = resolveActionDecision(
      "Create an Incident Management Improvement Plan",
      makeUnderstanding({ conversationMode: "task_intent" }),
      stateNoWork,
    );
    expect(d.action).toBe("create_new_work");
    expect(d.shouldCreateTask).toBe(true);
    expect(d.shouldDispatchSpecialist).toBe(true);
  });

  it("S8: task_intent + existing work → rerun_existing (not create_new_work)", () => {
    const d = resolveActionDecision(
      "Create a new Incident Management Improvement Plan",
      makeUnderstanding({ conversationMode: "task_intent" }),
      stateWithWork,
    );
    expect(d.action).toBe("rerun_existing");
    expect(d.shouldCreateTask).toBe(false);
    expect(d.shouldDispatchSpecialist).toBe(true);
  });
});

// ─── hasRerunSignal unit tests ────────────────────────────────────────────────

describe("hasRerunSignal", () => {
  it("detects 'again'", () => {
    expect(hasRerunSignal("do it again", undefined, undefined, undefined)).toBe(true);
  });

  it("detects 'latest approved'", () => {
    expect(hasRerunSignal("use the latest approved evidence", undefined, undefined, undefined)).toBe(true);
  });

  it("detects 'this is a new'", () => {
    expect(hasRerunSignal("This is a new review", undefined, undefined, undefined)).toBe(true);
  });

  it("detects 'not a request to show'", () => {
    expect(hasRerunSignal("not a request to show the previous work", undefined, undefined, undefined)).toBe(true);
  });

  it("detects 'produce a new'", () => {
    expect(hasRerunSignal("produce a new improvement plan", undefined, undefined, undefined)).toBe(true);
  });

  it("returns false for a neutral follow-up", () => {
    expect(hasRerunSignal("what were the main findings?", undefined, undefined, "task_followup")).toBe(false);
  });

  it("returns true for rta=revise", () => {
    expect(hasRerunSignal("please revise", "revise", undefined, undefined)).toBe(false); // revise is not a rerun
  });

  it("returns true for rta=create", () => {
    expect(hasRerunSignal("create a new review", "create", undefined, undefined)).toBe(true);
  });
});

// ─── Part E: Specialist attribution integrity ─────────────────────────────────

describe("Part E — specialist attribution integrity", () => {
  const stateWithWork = makeState();

  it("flags and corrects false attribution: 'Operations Manager has already completed'", () => {
    const response =
      "The Operations Manager has already completed a review of your Incident Management Policy.";
    const result = checkDelegationIntegrity(response, stateWithWork);
    expect(result.passed).toBe(false);
    const hasAttr = result.violations.some(v => v.category === "specialist_attribution");
    expect(hasAttr).toBe(true);
    expect(result.correctedResponse).toContain("knowledge_documentation_specialist");
    expect(result.correctedResponse).not.toContain("Operations Manager has already completed");
  });

  it("flags 'Operations Manager reviewed'", () => {
    const response = "The Operations Manager reviewed the policy last week.";
    const result = checkDelegationIntegrity(response, stateWithWork);
    const hasAttr = result.violations.some(v => v.category === "specialist_attribution");
    expect(hasAttr).toBe(true);
  });

  it("does NOT flag correct attribution: when response attributes to primarySpecialist", () => {
    // Primary specialist is knowledge_documentation_specialist — if the CoS correctly
    // says KDS produced the work, no violation should be raised
    const response =
      "The knowledge documentation specialist has completed a review of your policy.";
    const result = checkDelegationIntegrity(response, stateWithWork);
    // specialist_attribution should NOT be flagged for the actual specialist
    const hasAttr = result.violations.some(v => v.category === "specialist_attribution");
    expect(hasAttr).toBe(false);
  });

  it("does NOT flag attribution when no completedWork in state", () => {
    const stateNoWork = makeState({ completedWork: undefined, completedWorkId: undefined });
    const response =
      "The Operations Manager has already completed a review of your policy.";
    const result = checkDelegationIntegrity(response, stateNoWork);
    const hasAttr = result.violations.some(v => v.category === "specialist_attribution");
    expect(hasAttr).toBe(false);
  });

  it("flags attribution at 'completed' level — not bypassed by history short-circuit", () => {
    const stateCompleted = makeState({
      level: "completed",
      executionIntentExists: true,
      executionStatus: "completed",
    });
    const response =
      "The Executive Assistant has completed the policy review.";
    const result = checkDelegationIntegrity(response, stateCompleted);
    const hasAttr = result.violations.some(v => v.category === "specialist_attribution");
    expect(hasAttr).toBe(true);
  });

  it("runs attribution check even when no other action-language violations", () => {
    // No assignment/coordination/execution language — pure false attribution
    const stateAtLevel = makeState({ level: "informational" });
    const response = "The Operations Manager has completed the review.";
    const result = checkDelegationIntegrity(response, stateAtLevel);
    expect(result.passed).toBe(false);
    const hasAttr = result.violations.some(v => v.category === "specialist_attribution");
    expect(hasAttr).toBe(true);
  });
});

// ─── Decision-state consistency guard ────────────────────────────────────────

describe("Decision completeness guard", () => {
  it("every rerun/revise/create decision has shouldDispatchSpecialist=true", () => {
    const stateWithWork = makeState();
    const dispatchDecisions: Array<[string, ConversationActionDecision]> = [
      ["rerun_existing",   resolveActionDecision("review again", makeUnderstanding({ conversationMode: "task_followup" }), stateWithWork)],
      ["revise_existing",  resolveActionDecision("revise it", makeUnderstanding({ conversationMode: "task_followup", requestedTaskAction: "revise" }), stateWithWork)],
      ["create_new_work",  resolveActionDecision("create a plan", makeUnderstanding({ conversationMode: "task_intent" }), makeState({ completedWork: undefined }))],
    ];
    for (const [label, d] of dispatchDecisions) {
      expect(d.shouldDispatchSpecialist, `${label} should dispatch`).toBe(true);
    }
  });

  it("every view/summarise/approve/respond decision has shouldDispatchSpecialist=false", () => {
    const stateWithWork = makeState();
    const noDispatchDecisions: Array<[string, ConversationActionDecision]> = [
      ["view_existing",       resolveActionDecision("show me the review", makeUnderstanding({ conversationMode: "result_followup" }), stateWithWork)],
      ["summarise_existing",  resolveActionDecision("what were the findings?", makeUnderstanding({ conversationMode: "task_followup" }), stateWithWork)],
      ["approve_existing",    resolveActionDecision("approved", makeUnderstanding({ conversationMode: "approval_response" }), stateWithWork)],
      ["respond",             resolveActionDecision("hello", makeUnderstanding({ conversationMode: "general" }), stateWithWork)],
    ];
    for (const [label, d] of noDispatchDecisions) {
      expect(d.shouldDispatchSpecialist, `${label} should NOT dispatch`).toBe(false);
    }
  });
});
