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
  isLikelyCheckpointAnswer,
  resolvePendingConfirmationAnswer,
  resolveConversationReference,
  type PendingConversationConfirmation,
  type ConversationFocus,
  type ConversationTaskSummary,
} from "../services/conversationControlService.js";

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
});
