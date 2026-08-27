import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({
  db: {},
  approvalsTable: {},
  conversationMessagesTable: {},
  tasksTable: {},
}));

vi.mock("../services/approvalService.js", () => ({
  resolveApproval: vi.fn(),
}));

vi.mock("../services/taskService.js", () => ({
  transitionTaskState: vi.fn(),
}));

vi.mock("../services/auditService.js", () => ({
  logOrgEvent: vi.fn().mockResolvedValue(undefined),
}));

import {
  classifyCanonicalConversationAction,
  isPendingConfirmationActive,
  isLikelyCheckpointAnswer,
  responseRequestsTaskConfirmation,
  resolvePendingConfirmationAnswer,
  resolveConversationReference,
  type PendingConversationConfirmation,
  type ConversationFocus,
  type ConversationTaskSummary,
} from "../services/conversationControlService.js";
import { classifyMessage } from "../services/conversationIntelligenceService.js";
import { planTask } from "../services/chiefOfStaffService.js";
import { buildAuthoritativeTaskProposalPresentation } from "../services/taskProposalWorkforcePresentationService.js";
import { readFileSync } from "fs";
import { resolve } from "path";

const reportTask: ConversationTaskSummary = {
  id: "task-rp-report",
  title: "Restrictive practice incident report",
  currentState: "planning",
};

const rosterTask: ConversationTaskSummary = {
  id: "task-roster",
  title: "Next week roster",
  currentState: "queued",
};

const serviceDeliveryTask: ConversationTaskSummary = {
  id: "task-service-delivery",
  title: "Service Delivery Review for Michael",
  currentState: "awaiting_approval",
};

const rosterReviewTask: ConversationTaskSummary = {
  id: "task-roster-review",
  title: "Roster Review for Michael",
  currentState: "awaiting_approval",
};

const fatigueTask: ConversationTaskSummary = {
  id: "task-fatigue",
  title: "Review Rostering Approach for Fatigue Management",
  currentState: "awaiting_approval",
};

const policyTask: ConversationTaskSummary = {
  id: "task-policy",
  title: "Review and Improve Restrictive Practice Policy",
  currentState: "awaiting_approval",
};

function pendingConfirmation(overrides: Partial<PendingConversationConfirmation> = {}): PendingConversationConfirmation {
  return {
    id: "confirm-1",
    action: "CANCEL_TASK",
    taskId: reportTask.id,
    taskTitle: reportTask.title,
    candidateTasks: [],
    createdAt: new Date("2026-08-14T00:00:00Z").toISOString(),
    status: "pending",
    expectedResponse: "yes_no",
    reason: "test",
    ...overrides,
  };
}

function focus(taskId: string): ConversationFocus {
  return {
    taskId,
    updatedAt: new Date("2026-08-14T00:00:00Z").toISOString(),
    reason: "test focus",
    source: "conversation",
  };
}

describe("Sprint 33J.1 conversation control resolver", () => {
  it("cancels the single open focused task for free-text 'Cancel that'", () => {
    const intent = classifyCanonicalConversationAction("Cancel that.");
    const resolved = resolveConversationReference({
      text: "Cancel that.",
      intent,
      focus: focus(reportTask.id),
      activeTasks: [reportTask],
    });

    expect(intent).toBe("CANCEL_TASK");
    expect(resolved.resolvedTaskId).toBe(reportTask.id);
    expect(resolved.requiresClarification).toBe(false);
  });

  it("does not guess for 'Cancel that' when two tasks are plausible and no focus exists", () => {
    const resolved = resolveConversationReference({
      text: "Cancel that.",
      intent: "CANCEL_TASK",
      activeTasks: [reportTask, rosterTask],
    });

    expect(resolved.requiresClarification).toBe(true);
    expect(resolved.resolvedTaskId).toBeUndefined();
    expect(resolved.reason).toBe("no_task_reference");
  });

  it("does not consume a pending checkpoint when the user sends a new unrelated request", () => {
    const checkpoint = { clarificationQuestions: ["Which reporting period?"] };
    const text = "Also prepare next week's roster.";

    expect(classifyCanonicalConversationAction(text)).toBe("NEW_TASK");
    expect(isLikelyCheckpointAnswer(text, checkpoint)).toBe(false);
  });

  it("binds a clear reporting-period answer to the active checkpoint", () => {
    const checkpoint = { clarificationQuestions: ["Which reporting period?"] };

    expect(isLikelyCheckpointAnswer("March 2026.", checkpoint)).toBe(true);
  });

  it("modifies the focused report instead of creating a duplicate task", () => {
    const text = "Add the medication issue to that report.";
    const intent = classifyCanonicalConversationAction(text);
    const resolved = resolveConversationReference({
      text,
      intent,
      focus: focus(reportTask.id),
      activeTasks: [reportTask, rosterTask],
    });

    expect(intent).toBe("MODIFY_TASK");
    expect(resolved.resolvedTaskId).toBe(reportTask.id);
    expect(resolved.requiresClarification).toBe(false);
  });

  it("treats a roster request as a new unrelated task while a report remains focused", () => {
    const text = "Prepare next week's roster.";
    const intent = classifyCanonicalConversationAction(text);
    const resolved = resolveConversationReference({
      text,
      intent,
      focus: focus(reportTask.id),
      activeTasks: [reportTask],
    });

    expect(intent).toBe("NEW_TASK");
    expect(resolved.resolvedTaskId).toBeUndefined();
    expect(resolved.requiresClarification).toBe(false);
  });

  it("switches focus to the referenced roster without mutating the report", () => {
    const text = "Back to the roster.";
    const intent = classifyCanonicalConversationAction(text);
    const resolved = resolveConversationReference({
      text,
      intent,
      focus: focus(reportTask.id),
      activeTasks: [reportTask, rosterTask],
    });

    expect(intent).toBe("SWITCH_TASK");
    expect(resolved.resolvedTaskId).toBe(rosterTask.id);
    expect(resolved.requiresClarification).toBe(false);
  });

  it("grounds status queries to the focused task instead of recent-task guessing", () => {
    const resolved = resolveConversationReference({
      text: "Where are we with that?",
      intent: "STATUS_QUERY",
      focus: focus(rosterTask.id),
      activeTasks: [reportTask, rosterTask],
    });

    expect(resolved.resolvedTaskId).toBe(rosterTask.id);
  });

  it("reproduces live failure: service-delivery focus resolves 'Where are we with that?'", () => {
    const resolved = resolveConversationReference({
      text: "Where are we with that?",
      intent: "STATUS_QUERY",
      focus: focus(serviceDeliveryTask.id),
      activeTasks: [serviceDeliveryTask, rosterTask],
    });

    expect(resolved.resolvedTaskId).toBe(serviceDeliveryTask.id);
    expect(resolved.requiresClarification).toBe(false);
  });

  it("reproduces live failure: explicit switch to service delivery resolves and can back the next 'that'", () => {
    const switchResolved = resolveConversationReference({
      text: "Go back to the service delivery review.",
      intent: "SWITCH_TASK",
      activeTasks: [serviceDeliveryTask, rosterReviewTask, fatigueTask, policyTask],
    });

    expect(switchResolved.resolvedTaskId).toBe(serviceDeliveryTask.id);
    expect(switchResolved.requiresClarification).toBe(false);

    const cancelResolved = resolveConversationReference({
      text: "Cancel that one. I don't need the service delivery review anymore.",
      intent: "CANCEL_TASK",
      focus: focus(switchResolved.resolvedTaskId!),
      activeTasks: [serviceDeliveryTask, rosterReviewTask, fatigueTask, policyTask],
    });

    expect(cancelResolved.resolvedTaskId).toBe(serviceDeliveryTask.id);
    expect(cancelResolved.requiresClarification).toBe(false);
  });

  it("makes explicit task disambiguation sticky even with typoed service-delivery wording", () => {
    const answer = resolvePendingConfirmationAnswer(
      "serice delivery task",
      pendingConfirmation({
        action: "STATUS_QUERY",
        taskId: undefined,
        taskTitle: undefined,
        expectedResponse: "task_selection",
        candidateTasks: [
          { taskId: serviceDeliveryTask.id, title: serviceDeliveryTask.title, state: serviceDeliveryTask.currentState, score: 45, reason: "candidate" },
          { taskId: rosterTask.id, title: rosterTask.title, state: rosterTask.currentState, score: 45, reason: "candidate" },
        ],
      }),
    );

    expect(answer.kind).toBe("task_selection");
    if (answer.kind === "task_selection") {
      expect(answer.candidate.taskId).toBe(serviceDeliveryTask.id);
    }
  });

  it("preserves CANCEL_TASK when task-selection clarification is answered with service delivery", () => {
    const confirmation = pendingConfirmation({
      action: "CANCEL_TASK",
      taskId: undefined,
      taskTitle: undefined,
      expectedResponse: "task_selection",
      candidateTasks: [
        { taskId: serviceDeliveryTask.id, title: serviceDeliveryTask.title, state: serviceDeliveryTask.currentState, score: 45, reason: "candidate" },
        { taskId: rosterReviewTask.id, title: rosterReviewTask.title, state: rosterReviewTask.currentState, score: 45, reason: "candidate" },
        { taskId: policyTask.id, title: policyTask.title, state: policyTask.currentState, score: 12, reason: "candidate" },
      ],
    });
    const answer = resolvePendingConfirmationAnswer("service delivery", confirmation);

    expect(confirmation.action).toBe("CANCEL_TASK");
    expect(answer.kind).toBe("task_selection");
    if (answer.kind === "task_selection") {
      expect(answer.candidate.taskId).toBe(serviceDeliveryTask.id);
    }
  });

  it("preserves STATUS_QUERY when task-selection clarification is answered with roster review", () => {
    const confirmation = pendingConfirmation({
      action: "STATUS_QUERY",
      taskId: undefined,
      taskTitle: undefined,
      expectedResponse: "task_selection",
      candidateTasks: [
        { taskId: rosterReviewTask.id, title: rosterReviewTask.title, state: rosterReviewTask.currentState, score: 45, reason: "candidate" },
        { taskId: fatigueTask.id, title: fatigueTask.title, state: fatigueTask.currentState, score: 35, reason: "candidate" },
      ],
    });
    const answer = resolvePendingConfirmationAnswer("roster review", confirmation);

    expect(confirmation.action).toBe("STATUS_QUERY");
    expect(answer.kind).toBe("task_selection");
    if (answer.kind === "task_selection") {
      expect(answer.candidate.taskId).toBe(rosterReviewTask.id);
    }
  });

  it("reproduces live failure: explicit roster-review status query ignores unrelated policy review tasks", () => {
    const resolved = resolveConversationReference({
      text: "What is the status of the roster review?",
      intent: "STATUS_QUERY",
      activeTasks: [serviceDeliveryTask, fatigueTask, policyTask, rosterReviewTask],
    });

    expect(resolved.resolvedTaskId).toBe(rosterReviewTask.id);
    expect(resolved.requiresClarification).toBe(false);
    expect(resolved.candidateTasks.map(t => t.taskId)).not.toContain(policyTask.id);
  });

  it("does not treat unrelated policy review overlap as a plausible roster-review candidate", () => {
    const resolved = resolveConversationReference({
      text: "What is the status of the roster review?",
      intent: "STATUS_QUERY",
      activeTasks: [policyTask],
    });

    expect(resolved.resolvedTaskId).toBeUndefined();
    expect(resolved.candidateTasks).toEqual([]);
  });

  it("binds typoed proceed to a pending task proposal confirmation", () => {
    const answer = resolvePendingConfirmationAnswer(
      "please procceed",
      pendingConfirmation({
        action: "NEW_TASK",
        taskId: undefined,
        taskTitle: undefined,
        expectedResponse: "yes_no",
        proposedTask: {
          title: "Service Delivery Review for Michael",
          summary: "Prepare a service delivery review for Michael for July 2026.",
          priority: "normal",
        },
      }),
    );

    expect(answer.kind).toBe("confirm");
  });

  it("classifies specialist-start questions as status queries requiring authoritative task state", () => {
    expect(classifyCanonicalConversationAction("Has the specialist actually started working on it?")).toBe("STATUS_QUERY");
    expect(classifyCanonicalConversationAction("What is its current status?")).toBe("STATUS_QUERY");
    expect(classifyCanonicalConversationAction("What task are we working on?")).toBe("STATUS_QUERY");
    expect(classifyCanonicalConversationAction("Who is working on it?")).toBe("STATUS_QUERY");
  });

  it("routes update-style follow-ups to authoritative task status instead of proposal creation", () => {
    const updatePhrases = [
      "update",
      "give me an update",
      "what's happening",
      "where are we up to",
      "progress",
      "latest",
      "how is it going",
      "what's the current position",
      "where is this work at",
    ];

    for (const phrase of updatePhrases) {
      const intent = classifyCanonicalConversationAction(phrase);
      const resolved = resolveConversationReference({
        text: phrase,
        intent,
        focus: focus(serviceDeliveryTask.id),
        activeTasks: [serviceDeliveryTask],
      });

      expect(intent).toBe("STATUS_QUERY");
      expect(resolved.resolvedTaskId).toBe(serviceDeliveryTask.id);
      expect(resolved.requiresClarification).toBe(false);
    }
  });

  it("detects assistant confirmation copy as requiring a bound pending action", () => {
    expect(responseRequestsTaskConfirmation("Please confirm to proceed.")).toBe(true);
    expect(responseRequestsTaskConfirmation("Would you like me to create the task and proceed?")).toBe(true);
    expect(responseRequestsTaskConfirmation("Created. I have opened the work plan.")).toBe(false);
  });

  it("expires stale pending confirmations so old forensic tasks cannot consume a new bare confirm", () => {
    const now = Date.parse("2026-08-24T02:34:17Z");
    const fresh = pendingConfirmation({ createdAt: new Date(now - 5 * 60 * 1000).toISOString() });
    const stale = pendingConfirmation({ createdAt: "2026-08-23T23:44:06.677Z" });

    expect(isPendingConfirmationActive(fresh, now)).toBe(true);
    expect(isPendingConfirmationActive(stale, now)).toBe(false);
  });

  it("live regression guard: bare confirm binds to the active service-agreement confirmation, not an older risk proposal", () => {
    const serviceAgreement = pendingConfirmation({
      id: "service-confirm",
      action: "NEW_TASK",
      proposedTask: {
        title: "Draft Compliant NDIS Service Agreement",
        summary: "Develop a standard compliant NDIS service agreement template.",
        priority: "high",
      },
      createdAt: "2026-08-24T02:34:03.510Z",
    });
    const oldRisk = pendingConfirmation({
      id: "risk-confirm",
      action: "NEW_TASK",
      proposedTask: {
        title: "Design Standard Risk Assessment Template",
        summary: "Create a standard risk assessment template.",
        priority: "high",
      },
      createdAt: "2026-08-23T23:44:06.677Z",
    });

    expect(resolvePendingConfirmationAnswer("confirm", serviceAgreement).kind).toBe("confirm");
    expect(isPendingConfirmationActive(serviceAgreement, Date.parse("2026-08-24T02:34:17Z"))).toBe(true);
    expect(isPendingConfirmationActive(oldRisk, Date.parse("2026-08-24T02:34:17Z"))).toBe(false);
  });

  it("binds no to a pending task proposal without creating or approving anything else", () => {
    const answer = resolvePendingConfirmationAnswer(
      "No, don't proceed.",
      pendingConfirmation({
        action: "NEW_TASK",
        taskId: undefined,
        taskTitle: undefined,
        expectedResponse: "yes_no",
        proposedTask: {
          title: "Service Delivery Review for Michael",
          summary: "Prepare a service delivery review for Michael for July 2026.",
          priority: "normal",
        },
      }),
    );

    expect(answer.kind).toBe("decline");
  });

  it("binds yes to pending CONFIRM_CANCEL instead of generic approval resolution", () => {
    const answer = resolvePendingConfirmationAnswer(
      "yes",
      pendingConfirmation({ action: "CANCEL_TASK", taskId: reportTask.id, expectedResponse: "yes_no" }),
    );

    expect(answer.kind).toBe("confirm");
  });

  it("binds no to pending CONFIRM_CANCEL without touching unrelated approvals", () => {
    const answer = resolvePendingConfirmationAnswer(
      "No.",
      pendingConfirmation({ action: "CANCEL_TASK", taskId: reportTask.id, expectedResponse: "yes_no" }),
    );

    expect(answer.kind).toBe("decline");
  });

  it("does not consume an unrelated roster status request as a cancel confirmation answer", () => {
    const answer = resolvePendingConfirmationAnswer(
      "Actually, show me the roster status.",
      pendingConfirmation({ action: "CANCEL_TASK", taskId: reportTask.id, expectedResponse: "yes_no" }),
    );

    expect(answer.kind).toBe("unrelated");
  });

  it("binds free-text approval only when exactly one approval is pending", () => {
    const resolved = resolveConversationReference({
      text: "Approved.",
      intent: "APPROVE_ACTION",
      activeTasks: [reportTask],
      pendingApprovals: [{ id: "approval-1", taskId: reportTask.id, title: reportTask.title }],
    });

    expect(resolved.resolvedApprovalId).toBe("approval-1");
    expect(resolved.resolvedTaskId).toBe(reportTask.id);
    expect(resolved.requiresClarification).toBe(false);
  });

  it("does not guess approval binding when multiple approvals are pending", () => {
    const resolved = resolveConversationReference({
      text: "Send it.",
      intent: "APPROVE_ACTION",
      activeTasks: [reportTask, rosterTask],
      pendingApprovals: [
        { id: "approval-1", taskId: reportTask.id, title: reportTask.title },
        { id: "approval-2", taskId: rosterTask.id, title: rosterTask.title },
      ],
    });

    expect(resolved.requiresClarification).toBe(true);
    expect(resolved.resolvedApprovalId).toBeUndefined();
    expect(resolved.reason).toBe("multiple_pending_approvals");
  });

  it("distinguishes pause and resume from completion or cancellation", () => {
    expect(classifyCanonicalConversationAction("Hold this for now.")).toBe("PAUSE_TASK");
    expect(classifyCanonicalConversationAction("Continue that.")).toBe("RESUME_TASK");
  });

  it("honours focus over recency for wrong-task guard scenarios", () => {
    const resolved = resolveConversationReference({
      text: "Cancel that.",
      intent: "CANCEL_TASK",
      focus: focus(rosterTask.id),
      activeTasks: [reportTask, rosterTask],
    });

    expect(resolved.resolvedTaskId).toBe(rosterTask.id);
  });

  it("routes service_delivery.review task proposals to SDC before OM", () => {
    const plan = planTask(
      "Service Delivery Review for Michael",
      "Prepare a service delivery review for Michael for July 2026. Review whether his supports were delivered as planned and identify any service delivery gaps.",
    );

    expect(plan.intent).toBe("service_delivery.review");
    expect(plan.primarySpecialist).toBe("service_delivery_coordinator");
    expect(plan.assignedSpecialists).toEqual(expect.arrayContaining(["service_delivery_coordinator"]));
  });

  it("routes roster.review task proposals to WRC before OM", () => {
    const plan = planTask(
      "Roster Review for Michael",
      "Prepare a roster review for Michael for next week and identify any coverage gaps.",
    );

    expect(plan.intent).toBe("roster.review");
    expect(plan.primarySpecialist).toBe("workforce_rostering_coordinator");
    expect(plan.assignedSpecialists).toEqual(expect.arrayContaining(["workforce_rostering_coordinator"]));
  });

  it("routes service-delivery live chat fallback proposals to SDC instead of OM", () => {
    const result = classifyMessage(
      "Prepare a service delivery review for Michael for July 2026. Review whether his supports were delivered as planned and identify any service delivery gaps.",
      { conversationId: "conv-1", organizationId: "org-1" },
    );

    expect(result.conversationMode).toBe("task_intent");
    expect(result.relatedWorkforceRoles).toContain("service_delivery_coordinator");
    expect(result.relatedWorkforceRoles).not.toContain("operations_manager");
  });

  it("routes roster-review live chat fallback proposals to WRC instead of OM", () => {
    const result = classifyMessage(
      "Prepare a roster review for Michael for next week, focusing on identifying any coverage gaps.",
      { conversationId: "conv-1", organizationId: "org-1" },
    );

    expect(result.conversationMode).toBe("task_intent");
    expect(result.relatedWorkforceRoles).toContain("workforce_rostering_coordinator");
    expect(result.relatedWorkforceRoles).not.toContain("operations_manager");
  });

  it("production route uses unified message ingress before response streaming", () => {
    const src = readFileSync(resolve(process.cwd(), "src/routes/v1/conversations.ts"), "utf8");
    const ingressIdx = src.indexOf("const ingressResult = await handleIncomingMessage");
    const streamIdx = src.indexOf("const words = result.understanding.customerResponse.split");

    expect(ingressIdx).toBeGreaterThan(0);
    expect(streamIdx).toBeGreaterThan(ingressIdx);
  });

  it("processUserMessage applies authoritative task-plan workforce before building task proposal cards", () => {
    const src = readFileSync(resolve(process.cwd(), "src/services/conversationService.ts"), "utf8");
    const canonicalIdx = src.indexOf("resolveCanonicalConversationRoles");
    const assignIdx = src.indexOf("understanding.relatedWorkforceRoles = canonicalRoles.roles");
    const authoritativeIdx = src.indexOf("buildAuthoritativeTaskProposalPresentation(understanding, text)");
    const cardIdx = src.indexOf("structuredContent = buildTaskProposalCard(understanding)");

    expect(canonicalIdx).toBeGreaterThan(0);
    expect(assignIdx).toBeGreaterThan(canonicalIdx);
    expect(authoritativeIdx).toBeGreaterThan(assignIdx);
    expect(cardIdx).toBeGreaterThan(authoritativeIdx);
  });

  it("grounds service-delivery proposal presentation in SDC primary ownership even if conversation roles said OM", () => {
    const result = buildAuthoritativeTaskProposalPresentation({
      conversationMode: "task_intent",
      confidence: 0.9,
      proposedTask: {
        title: "Service Delivery Review for Michael",
        summary: "Prepare a service delivery review for Michael for July 2026.",
        priority: "high",
        requestedOutcome: "Review whether supports were delivered as planned and identify service delivery gaps.",
        knownConstraints: [],
      },
      clarificationRequired: false,
      clarificationQuestions: [],
      shouldCreateTask: false,
      shouldUpdateTask: false,
      relatedWorkforceRoles: ["operations_manager"],
      customerResponse: "I'll coordinate with the Operations Manager.",
    });

    expect(result).not.toBeNull();
    expect(result!.workforce.primaryProfessionalOwner).toBe("service_delivery_coordinator");
    expect(result!.workforce.supportingSpecialists).toContain("operations_manager");
    expect(result!.response).toContain("Service Delivery Coordinator as the primary specialist");
    expect(result!.structuredContent?.data.primaryProfessionalOwner).toBe("service_delivery_coordinator");
    expect(result!.structuredContent?.data.suggestedRoles).toEqual(
      expect.arrayContaining(["service_delivery_coordinator", "operations_manager"]),
    );
  });

  it("grounds roster proposal presentation in WRC primary ownership even if conversation roles said OM", () => {
    const result = buildAuthoritativeTaskProposalPresentation({
      conversationMode: "task_intent",
      confidence: 0.9,
      proposedTask: {
        title: "Roster Review for Michael",
        summary: "Prepare a roster review for Michael for next week.",
        priority: "high",
        requestedOutcome: "Identify any coverage gaps.",
        knownConstraints: [],
      },
      clarificationRequired: false,
      clarificationQuestions: [],
      shouldCreateTask: false,
      shouldUpdateTask: false,
      relatedWorkforceRoles: ["operations_manager"],
      customerResponse: "I'll coordinate with the Operations Manager.",
    });

    expect(result).not.toBeNull();
    expect(result!.workforce.primaryProfessionalOwner).toBe("workforce_rostering_coordinator");
    expect(result!.workforce.supportingSpecialists).toContain("operations_manager");
    expect(result!.response).toContain("Workforce Rostering Coordinator as the primary specialist");
    expect(result!.structuredContent?.data.primaryProfessionalOwner).toBe("workforce_rostering_coordinator");
  });

  it("does not mention OM when authoritative restrictive-practice plan excludes OM", () => {
    const result = buildAuthoritativeTaskProposalPresentation({
      conversationMode: "task_intent",
      confidence: 0.9,
      proposedTask: {
        title: "Review Michael's restrictive practice arrangements",
        summary: "Review Michael's restrictive practice arrangements and identify any compliance issues.",
        priority: "high",
        requestedOutcome: "Identify compliance issues.",
        knownConstraints: [],
      },
      clarificationRequired: false,
      clarificationQuestions: [],
      shouldCreateTask: false,
      shouldUpdateTask: false,
      relatedWorkforceRoles: ["operations_manager"],
      customerResponse: "I'll coordinate with the Operations Manager.",
    });

    expect(result).not.toBeNull();
    expect(result!.workforce.assignedSpecialists).not.toContain("operations_manager");
    expect(result!.response).not.toContain("Operations Manager");
    expect(result!.structuredContent?.data.suggestedRoles).not.toEqual(
      expect.arrayContaining(["operations_manager"]),
    );
  });

  it("preserves primary, supporting and coordinator distinctions in proposal cards", () => {
    const result = buildAuthoritativeTaskProposalPresentation({
      conversationMode: "task_intent",
      confidence: 0.9,
      proposedTask: {
        title: "Service Delivery Review for Michael",
        summary: "Prepare a service delivery review for Michael for July 2026.",
        priority: "high",
        requestedOutcome: "Review support delivery gaps.",
        knownConstraints: [],
      },
      clarificationRequired: false,
      clarificationQuestions: [],
      shouldCreateTask: false,
      shouldUpdateTask: false,
      relatedWorkforceRoles: ["operations_manager"],
      customerResponse: "Draft response",
    });

    expect(result!.structuredContent?.data.coordinator).toBe("chief_of_staff");
    expect(result!.structuredContent?.data.primaryProfessionalOwner).toBe("service_delivery_coordinator");
    expect(result!.structuredContent?.data.supportingSpecialists).toEqual(
      expect.arrayContaining(["operations_manager"]),
    );
  });
});
