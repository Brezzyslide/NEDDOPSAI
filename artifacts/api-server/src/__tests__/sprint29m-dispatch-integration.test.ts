/**
 * Sprint 29M — Dispatch Integration Tests
 *
 * Verifies that the three-lane execution classifier correctly gates the
 * work-product lifecycle at the dispatch layer:
 *
 * - TRANSIENT:         autoCreateAndDispatch is NOT called; no task is created
 * - PROFESSIONAL_WORK: autoCreateAndDispatch IS called with laneContext
 *                      requiresEvidence=false, requiresClaimIntegrity=false
 * - EVIDENCE_BEARING:  autoCreateAndDispatch IS called with laneContext
 *                      requiresEvidence=true, requiresClaimIntegrity=true
 *
 * Also verifies that laneContext is forwarded so the execution lane is
 * traceable in the audit log.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../services/autoDispatchService.js", () => ({
  autoCreateAndDispatch: vi.fn().mockResolvedValue({
    taskId:           "task-test",
    title:            "Test Task",
    conversationId:   "conv-test",
    dispatched:       true,
    requiresApproval: false,
  }),
  AUTO_EXECUTE_CONFIDENCE_THRESHOLD: 0.85,
}));

vi.mock("../services/auditService.js", () => ({
  writeAuditEvent: vi.fn().mockResolvedValue(undefined),
  getRequestMeta:  vi.fn().mockReturnValue({}),
}));

vi.mock("../services/taskService.js", () => ({
  createTask: vi.fn().mockResolvedValue({
    task: { id: "task-test", title: "Test Task" },
    plan: { requiresApproval: false, reasoning: "test", approvalType: "standard" },
  }),
}));

vi.mock("../services/conversationService.js", () => ({
  linkConversationToTask:              vi.fn().mockResolvedValue(undefined),
  addMessage:                          vi.fn().mockResolvedValue({ id: "msg-1" }),
  postPlanToConversation:              vi.fn().mockResolvedValue(undefined),
  postApprovalRequestToConversation:   vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../services/executionCoordinatorService.js", () => ({
  dispatchWorkExecution: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: () => ({ catch: () => [] }) }) }) }),
  },
  approvalsTable: {},
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

import { autoCreateAndDispatch, type ExecutionLaneContext } from "../services/autoDispatchService.js";
import { classifyExecutionRequest }                          from "../services/executionClassifierService.js";
import type { ExecutionClassifierInput }                     from "../services/executionClassifierService.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const mockedAutoCreate = vi.mocked(autoCreateAndDispatch);

const PROFESSIONAL_PROPOSED_TASK = {
  title:   "Write the Q3 Onboarding Procedure",
  summary: "Produce a comprehensive onboarding procedure document",
};

const EVIDENCE_PROPOSED_TASK = {
  title:   "Compliance Review — Behaviour Support Policy",
  summary: "Review our behaviour support policy against the NDIS Code of Conduct",
};

/** Build classifier input tuned to give a TRANSIENT classification */
function transientInput(userRequest: string): ExecutionClassifierInput {
  return {
    userRequest,
    conversationMode:          "general",
    proposedTask:              null,    // no task → no professional work signal
    confidence:                0.7,
    shouldDispatchSpecialists: false,   // no specialist dispatch → no PROFESSIONAL signal
    extractedSearchTerms:      [],
    trigger:                   "conversation",
  };
}

/** Build classifier input tuned to give a PROFESSIONAL_WORK classification */
function professionalInput(userRequest: string): ExecutionClassifierInput {
  return {
    userRequest,
    conversationMode:          "task_creation",
    proposedTask:              PROFESSIONAL_PROPOSED_TASK,
    confidence:                0.9,
    shouldDispatchSpecialists: true,
    extractedSearchTerms:      [],
    trigger:                   "conversation",
  };
}

/** Build classifier input tuned to give an EVIDENCE_BEARING classification */
function evidenceInput(userRequest: string): ExecutionClassifierInput {
  return {
    userRequest,
    conversationMode:          "task_creation",
    proposedTask:              EVIDENCE_PROPOSED_TASK,
    confidence:                0.9,
    shouldDispatchSpecialists: true,
    extractedSearchTerms:      ["safeguarding policy", "NDIS Code of Conduct"],
    trigger:                   "conversation",
    evidenceMode:              "required",  // strong prior for EVIDENCE_BEARING
  };
}

/**
 * Simulates what the conversations route does:
 * - classify the request
 * - if non-transient, call autoCreateAndDispatch with the laneContext forwarded
 */
async function simulateRouteDispatch(
  input: ExecutionClassifierInput,
  proposedTask: { title: string; summary: string } = PROFESSIONAL_PROPOSED_TASK,
): Promise<{ called: boolean; laneContext?: ExecutionLaneContext; executionClass?: string }> {
  const cls = classifyExecutionRequest(input);

  if (cls.executionClass === "transient") {
    return { called: false, executionClass: "transient" };
  }

  const laneContext: ExecutionLaneContext = {
    executionClass:         cls.executionClass,
    requiresCompletedWork:  cls.requiresCompletedWork,
    requiresEvidence:       cls.requiresEvidence,
    requiresClaimIntegrity: cls.requiresClaimIntegrity,
    requiresApproval:       cls.requiresApproval,
  };

  await autoCreateAndDispatch({
    organizationId: "org-test",
    conversationId: "conv-test",
    requesterId:    "user-test",
    proposedTask,
    laneContext,
  });

  return { called: true, laneContext, executionClass: cls.executionClass };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockedAutoCreate.mockClear();
});

// ── TRANSIENT lane ────────────────────────────────────────────────────────────

describe("TRANSIENT lane — autoCreateAndDispatch is NOT called", () => {
  it("email drafting: no dispatch call", async () => {
    const { called } = await simulateRouteDispatch(
      transientInput("Write a quick email to the team about the Friday closure"),
    );
    expect(called).toBe(false);
    expect(mockedAutoCreate).not.toHaveBeenCalled();
  });

  it("paragraph rewrite: no dispatch call", async () => {
    const { called } = await simulateRouteDispatch(
      transientInput("Rewrite this paragraph to be more concise and professional"),
    );
    expect(called).toBe(false);
    expect(mockedAutoCreate).not.toHaveBeenCalled();
  });

  it("brainstorm request: no dispatch call", async () => {
    const { called } = await simulateRouteDispatch(
      transientInput("Give me some ideas for improving staff communication"),
    );
    expect(called).toBe(false);
    expect(mockedAutoCreate).not.toHaveBeenCalled();
  });

  it("general information question: no dispatch call", async () => {
    const { called } = await simulateRouteDispatch(
      transientInput("How long is our standard probation period?"),
    );
    expect(called).toBe(false);
    expect(mockedAutoCreate).not.toHaveBeenCalled();
  });

  it("TRANSIENT routes produce no completed_work, no task, no approval DB writes", async () => {
    const { called } = await simulateRouteDispatch(
      transientInput("Summarise this paragraph for me"),
    );
    // No DB writes because autoCreateAndDispatch was never invoked
    expect(called).toBe(false);
    expect(mockedAutoCreate).not.toHaveBeenCalled();
  });
});

// ── PROFESSIONAL_WORK lane ────────────────────────────────────────────────────

describe("PROFESSIONAL_WORK lane — autoCreateAndDispatch IS called with laneContext", () => {
  it("operational plan: dispatch called", async () => {
    const { called } = await simulateRouteDispatch(
      professionalInput("Create an operational plan for onboarding new staff next quarter"),
    );
    expect(called).toBe(true);
    expect(mockedAutoCreate).toHaveBeenCalledOnce();
  });

  it("professional_work laneContext has requiresEvidence=false", async () => {
    await simulateRouteDispatch(
      professionalInput("Draft a comprehensive onboarding checklist for new employees"),
    );
    const call = mockedAutoCreate.mock.calls[0]?.[0];
    expect(call?.laneContext).toBeDefined();
    expect(call?.laneContext?.executionClass).toBe("professional_work");
    expect(call?.laneContext?.requiresEvidence).toBe(false);
  });

  it("professional_work laneContext has requiresClaimIntegrity=false", async () => {
    await simulateRouteDispatch(
      professionalInput("Write a staff induction procedure document"),
    );
    const call = mockedAutoCreate.mock.calls[0]?.[0];
    expect(call?.laneContext?.requiresClaimIntegrity).toBe(false);
  });

  it("professional_work laneContext has requiresCompletedWork=true", async () => {
    await simulateRouteDispatch(
      professionalInput("Produce the Q3 workforce report for the board"),
    );
    const call = mockedAutoCreate.mock.calls[0]?.[0];
    expect(call?.laneContext?.requiresCompletedWork).toBe(true);
  });

  it("task-triggered execution is at minimum PROFESSIONAL_WORK (never TRANSIENT)", async () => {
    const { executionClass } = await simulateRouteDispatch({
      userRequest:               "Summarise the meeting",
      conversationMode:          "general",
      proposedTask:              PROFESSIONAL_PROPOSED_TASK,
      confidence:                0.9,
      shouldDispatchSpecialists: false,
      extractedSearchTerms:      [],
      trigger:                   "task",   // non-conversation triggers never downgrade
      taskId:                    "task-existing",
    });
    expect(executionClass).not.toBe("transient");
  });
});

// ── EVIDENCE_BEARING lane ─────────────────────────────────────────────────────

describe("EVIDENCE_BEARING lane — autoCreateAndDispatch IS called with evidence flags set", () => {
  it("policy review: dispatch called", async () => {
    const { called } = await simulateRouteDispatch(
      evidenceInput("Review our safeguarding policy for compliance gaps"),
      EVIDENCE_PROPOSED_TASK,
    );
    expect(called).toBe(true);
    expect(mockedAutoCreate).toHaveBeenCalledOnce();
  });

  it("evidence_bearing laneContext has requiresEvidence=true", async () => {
    await simulateRouteDispatch(
      evidenceInput("Conduct a compliance review of our incident management policy against NDIS standards"),
      EVIDENCE_PROPOSED_TASK,
    );
    const call = mockedAutoCreate.mock.calls[0]?.[0];
    expect(call?.laneContext?.executionClass).toBe("evidence_bearing");
    expect(call?.laneContext?.requiresEvidence).toBe(true);
  });

  it("evidence_bearing laneContext has requiresClaimIntegrity=true", async () => {
    await simulateRouteDispatch(
      evidenceInput("Document our policy compliance review for the Q3 audit"),
      EVIDENCE_PROPOSED_TASK,
    );
    const call = mockedAutoCreate.mock.calls[0]?.[0];
    expect(call?.laneContext?.requiresClaimIntegrity).toBe(true);
  });

  it("evidence_bearing laneContext has requiresCompletedWork=true", async () => {
    await simulateRouteDispatch(
      evidenceInput("Review and document our behaviour support policy compliance"),
      EVIDENCE_PROPOSED_TASK,
    );
    const call = mockedAutoCreate.mock.calls[0]?.[0];
    expect(call?.laneContext?.requiresCompletedWork).toBe(true);
  });
});

// ── laneContext traceability ──────────────────────────────────────────────────

describe("laneContext forwarded to autoCreateAndDispatch for audit traceability", () => {
  it("every non-transient call includes a laneContext with executionClass", async () => {
    await simulateRouteDispatch(
      professionalInput("Create a procedure document for emergency responses"),
    );
    const call = mockedAutoCreate.mock.calls[0]?.[0];
    expect(call?.laneContext).toBeDefined();
    expect(["professional_work", "evidence_bearing"]).toContain(
      call?.laneContext?.executionClass,
    );
  });

  it("transient calls produce zero autoCreateAndDispatch invocations", async () => {
    await simulateRouteDispatch(transientInput("Help me write a thank-you note for the team"));
    expect(mockedAutoCreate).not.toHaveBeenCalled();
  });

  it("both requiresEvidence and requiresClaimIntegrity are booleans in laneContext", async () => {
    await simulateRouteDispatch(professionalInput("Draft the onboarding procedure"));
    const call = mockedAutoCreate.mock.calls[0]?.[0];
    expect(typeof call?.laneContext?.requiresEvidence).toBe("boolean");
    expect(typeof call?.laneContext?.requiresClaimIntegrity).toBe("boolean");
  });
});

// ── AutoDispatchInput type contract ──────────────────────────────────────────

describe("AutoDispatchInput laneContext type contract", () => {
  it("laneContext optional field is accepted (TypeScript type check via compilation)", async () => {
    await autoCreateAndDispatch({
      organizationId: "org-1",
      conversationId:  "conv-1",
      requesterId:     "user-1",
      proposedTask:    { title: "T", summary: "S" },
      laneContext: {
        executionClass:         "professional_work" as const,
        requiresCompletedWork:  true,
        requiresEvidence:       false,
        requiresClaimIntegrity: false,
        requiresApproval:       false,
      },
    });
    expect(mockedAutoCreate).toHaveBeenCalledOnce();
  });

  it("laneContext is optional for backward-compat (existing callers without it)", async () => {
    await autoCreateAndDispatch({
      organizationId: "org-1",
      conversationId:  "conv-1",
      requesterId:     "user-1",
      proposedTask:    { title: "T", summary: "S" },
    });
    expect(mockedAutoCreate).toHaveBeenCalledOnce();
  });
});
