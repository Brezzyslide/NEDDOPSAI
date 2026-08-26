import type { TaskState } from "@workspace/shared";

export type CompletedWorkApprovalStatus =
  | "draft"
  | "awaiting_approval"
  | "approved"
  | "rejected"
  | "archived"
  | "superseded"
  | "reopened"
  | string;

export type UserFacingWorkStatus =
  | "draft"
  | "queued"
  | "planning"
  | "awaiting_approval"
  | "evidence_required"
  | "approved"
  | "executing"
  | "completed"
  | "completed_output_awaiting_approval"
  | "cancelled"
  | "failed";

export interface WorkStatusProjectionInput {
  taskState: TaskState | string;
  completedWorkStatus?: CompletedWorkApprovalStatus | null;
  executionStatus?: string | null;
}

export interface WorkStatusProjection {
  status: UserFacingWorkStatus;
  taskState: string;
  completedWorkStatus: string | null;
  executionStatus: string | null;
  label: string;
  isTerminalTask: boolean;
  belongsInActiveWork: boolean;
  belongsInApprovalWork: boolean;
}

const TERMINAL_TASK_STATES = new Set(["completed", "failed", "cancelled"]);
const ACTIVE_TASK_STATES = new Set([
  "draft",
  "queued",
  "planning",
  "awaiting_approval",
  "evidence_required",
  "approved",
  "executing",
]);

const LABELS: Record<UserFacingWorkStatus, string> = {
  draft: "Draft",
  queued: "Queued",
  planning: "Planning",
  awaiting_approval: "Awaiting Approval",
  evidence_required: "Evidence Required",
  approved: "Approved",
  executing: "Executing",
  completed: "Completed",
  completed_output_awaiting_approval: "Completed - Output Awaiting Approval",
  cancelled: "Cancelled",
  failed: "Failed",
};

export function projectUserFacingWorkStatus(input: WorkStatusProjectionInput): WorkStatusProjection {
  const taskState = String(input.taskState);
  const completedWorkStatus = input.completedWorkStatus ? String(input.completedWorkStatus) : null;
  const executionStatus = input.executionStatus ? String(input.executionStatus) : null;

  let status: UserFacingWorkStatus;
  if (taskState === "completed" && completedWorkStatus === "awaiting_approval") {
    status = "completed_output_awaiting_approval";
  } else if (taskState === "completed") {
    status = "completed";
  } else if (taskState === "cancelled") {
    status = "cancelled";
  } else if (taskState === "failed") {
    status = "failed";
  } else if (taskState === "evidence_required") {
    status = "evidence_required";
  } else if (taskState === "awaiting_approval") {
    status = "awaiting_approval";
  } else if (taskState === "executing") {
    status = "executing";
  } else if (taskState === "approved") {
    status = "approved";
  } else if (taskState === "planning") {
    status = "planning";
  } else if (taskState === "queued") {
    status = "queued";
  } else {
    status = "draft";
  }

  const isTerminalTask = TERMINAL_TASK_STATES.has(taskState);

  return {
    status,
    taskState,
    completedWorkStatus,
    executionStatus,
    label: LABELS[status],
    isTerminalTask,
    belongsInActiveWork: ACTIVE_TASK_STATES.has(taskState),
    belongsInApprovalWork: status === "awaiting_approval" || status === "completed_output_awaiting_approval",
  };
}

export function isUserFacingActiveWorkStatus(status: string): boolean {
  return status !== "completed"
    && status !== "completed_output_awaiting_approval"
    && status !== "cancelled"
    && status !== "failed";
}
