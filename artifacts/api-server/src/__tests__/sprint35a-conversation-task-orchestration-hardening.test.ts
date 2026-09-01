import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "..");

function source(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), "utf8");
}

describe("Sprint 35A conversational task-orchestration hardening", () => {
  it("keeps the existing task state machine as the canonical lifecycle", () => {
    const src = source("services/taskService.ts");

    for (const state of ["draft", "queued", "planning", "awaiting_approval", "evidence_required", "approved", "executing", "completed", "cancelled", "failed"]) {
      expect(src).toContain(`${state}:`);
    }
    expect(src).not.toContain('"rejected" as unknown as TaskState');
  });

  it("captures approval requirements at task creation without creating premature pending approvals", () => {
    const src = source("services/taskService.ts");

    const createTaskBody = src.slice(src.indexOf("export async function createTask"), src.indexOf("export async function getTasksByOrg"));
    expect(createTaskBody).toContain("buildApprovalRequirement(plan)");
    expect(createTaskBody).toContain('const approvalState = plan.requiresApproval ? "required" : "not_required"');
    expect(createTaskBody).toContain('const nextState: TaskState = "approved"');
    expect(createTaskBody).not.toContain("await createApproval({");
    expect(createTaskBody).not.toContain('currentState: "awaiting_approval"');
  });

  it("creates a concrete approval request only when execution reaches the approval gate", () => {
    const src = source("services/taskService.ts");

    expect(src).toContain("export async function requestTaskApprovalGate");
    expect(src).toContain("getPendingApprovalForTask");
    expect(src).toContain("await createApproval({");
    expect(src).toContain('transitionTaskState(input.taskId, input.organizationId, "awaiting_approval"');
    expect(src).toContain('approvalState: "pending_approval"');
    expect(src).toContain("approvalType: plan.approvalType");
    expect(src).toContain('status: "not_ready"');
  });

  it("does not dispatch legacy specialist runs directly from taskService", () => {
    const src = source("services/taskService.ts");

    expect(src).not.toContain("dispatchReadyRunsByTask");
  });

  it("claims a task as executing before dispatch and refuses cancelled/completed tasks", () => {
    const src = source("services/taskService.ts");

    expect(src).toContain("export async function claimTaskForExecution");
    expect(src).toContain('if (state === "cancelled")');
    expect(src).toContain('if (state === "completed")');
    expect(src).toContain('currentState: "executing"');
  });

  it("makes task cancellation idempotent and terminal-aware", () => {
    const src = source("services/taskService.ts");

    expect(src).toContain("export async function cancelTask");
    expect(src).toContain('status: "already_cancelled"');
    expect(src).toContain('status: "already_completed"');
    expect(src).toContain('transitionTaskState(taskId, organizationId, "cancelled")');
    expect(src).toContain('status: "not_cancelled"');
  });

  it("reconciles execution success and failure through taskService", () => {
    const src = source("services/taskService.ts");

    expect(src).toContain("export async function reconcileTaskExecutionSuccess");
    expect(src).toContain('currentState: "completed"');
    expect(src).toContain("export async function reconcileTaskExecutionFailure");
    expect(src).toContain('currentState: "failed"');
    expect(src).toContain('if (task.currentState === "cancelled")');
    expect(src).toContain("failureMetadata?: Record<string, unknown>");
    expect(src).toContain("...(input.failureMetadata ?? {})");
  });

  it("dispatchWorkExecution claims the task before emitting execution start", () => {
    const src = source("services/executionCoordinatorService.ts");

    const claimIndex = src.indexOf("claimTaskForExecution");
    const emitIndex = src.indexOf('type: "execution_started"');
    expect(claimIndex).toBeGreaterThan(-1);
    expect(emitIndex).toBeGreaterThan(-1);
    expect(claimIndex).toBeLessThan(emitIndex);
  });

  it("execution coordinator discards late results after cancellation", () => {
    const src = source("services/executionCoordinatorService.ts");

    expect(src).toContain("isTaskCancelled(taskId, organizationId)");
    expect(src).toContain("result_discarded_after_cancel");
    expect(src).toContain("completion_discarded_after_cancel");
  });

  it("successful execution reconciles task completion before posting completed-work chat output", () => {
    const src = source("services/executionCoordinatorService.ts");

    const reconcileIndex = src.indexOf("reconcileTaskExecutionSuccess({");
    const postIndex = src.indexOf("await postCompletedWorkCreatedToConversation");
    expect(reconcileIndex).toBeGreaterThan(-1);
    expect(postIndex).toBeGreaterThan(-1);
    expect(reconcileIndex).toBeLessThan(postIndex);
  });

  it("failed execution reconciles task failure even without conversation output", () => {
    const src = source("services/executionCoordinatorService.ts");

    expect(src).toContain("reconcileTaskExecutionFailure({");
    expect(src).toContain("failureMetadata: result.failureMetadata");
    expect(src).toContain("if (!conversationId) return;");
  });

  it("UEE has a cancellation guard immediately before Completed Work creation", () => {
    const src = source("services/unifiedExecutionEngine.ts");

    const progressIndex = src.indexOf('await progress("creating_completed_work")');
    const guardIndex = src.indexOf("pre_completed_work_cancellation_guard");
    const createIndex = src.indexOf("const completedWork = await createDraft");
    expect(progressIndex).toBeGreaterThan(-1);
    expect(guardIndex).toBeGreaterThan(progressIndex);
    expect(createIndex).toBeGreaterThan(guardIndex);
  });

  it("UEE exposes cancellation as an explicit non-success execution outcome", () => {
    const src = source("services/unifiedExecutionEngine.ts");

    expect(src).toContain('| "cancelled"');
    expect(src).toContain('outcome: "cancelled"');
    expect(src).toContain("No Completed Work was created");
  });

  it("conversation cancellation calls the canonical task cancellation and existing runtime cancel hooks", () => {
    const src = source("services/conversationControlService.ts");

    expect(src).toContain("cancelTask(input.taskId");
    expect(src).toContain("getActiveCheckpointByConversation");
    expect(src).toContain("cancelCheckpoint(checkpoint.id)");
    expect(src).toContain("cancelTaskExecution(input.taskId");
  });

  it("conversation approvals use the same authority-checked service path as route approvals", () => {
    const src = source("services/conversationControlService.ts");

    expect(src).toContain("getMembershipForUser");
    expect(src).toContain("resolveApprovalWithAuthority");
    expect(src).toContain("actorRole: membership.role");
    expect(src).toContain("no_concrete_pending_approval");
  });

  it("approval route accepts one canonical action contract and tolerates legacy decision payloads", () => {
    const src = source("routes/v1/approvalRoutes.ts");

    expect(src).toContain("const requestedAction = action ?? decision");
    expect(src).toContain("resolveApprovalWithAuthority");
    expect(src).toContain("transitionTaskState(approval.taskId");
  });

  it("MODIFY_TASK is handled deterministically instead of falling through to ordinary chat", () => {
    const src = source("services/messageIngressService.ts");

    expect(src).toContain('"MODIFY_TASK"');
    expect(src).toContain("modifyTaskFromConversation");
    expect(src).toContain('action = "revise"');
  });

  it("task modification records change history and invalidates approval-sensitive task states", () => {
    const src = source("services/taskService.ts");

    expect(src).toContain("export async function recordTaskModification");
    expect(src).toContain("modificationRequests");
    expect(src).toContain("approvalInvalidatedByModification");
    expect(src).toContain('currentState: nextState');
  });

  it("open task reference context includes bounded organisation-level candidates", () => {
    const src = source("services/conversationControlService.ts");

    expect(src).toContain("const orgRows = await db");
    expect(src).toContain("orderBy(desc(tasksTable.updatedAt))");
    expect(src).toContain(".limit(20)");
  });

  it("multi-task auto-dispatch emits every persisted task and a batch event", () => {
    const src = source("routes/v1/conversations.ts");

    expect(src).toContain("splitIndependentTaskClauses");
    expect(src).toContain("const createdTasks = []");
    expect(src).toContain('sendEvent({ type: "task_auto_created", ...autoResult })');
    expect(src).toContain('sendEvent({ type: "task_auto_created_batch", tasks: createdTasks })');
  });

  it("auto-dispatch does not turn future approval requirements into pending approval at task creation", () => {
    const src = source("services/autoDispatchService.ts");

    expect(src).toContain("future completion/release requirement");
    expect(src).toContain("not an");
    expect(src).toContain("actionable pending approval");
    expect(src).toContain("dispatchWorkExecution({");
    expect(src).not.toContain("postApprovalRequestToConversation");
    expect(src).not.toContain("approvalsTable");
  });

  it("manual conversation create dispatches work even when future approval is required", () => {
    const src = source("routes/v1/conversations.ts");
    const handler = src.slice(
      src.indexOf('router.post("/:conversationId/create-task"'),
      src.indexOf('router.get("/:conversationId/execution-stream"'),
    );

    expect(handler).toContain("Dispatch work execution immediately in background");
    expect(handler).toContain("plan.requiresApproval");
    expect(handler).toContain("future approval requirements");
    expect(handler).toContain("concrete pending approval row is");
    expect(handler).toContain("dispatchWorkExecution({");
    expect(handler).toContain("conversationId: workroomConversationId");
    expect(handler).not.toContain("postApprovalRequestToConversation");
    expect(handler).not.toContain("approvalsTable");
  });

  it("direct task creation records future approval requirements without blocking dispatch", () => {
    const src = source("routes/v1/tasks.ts");
    const handler = src.slice(src.indexOf('router.post("/",'), src.indexOf('router.get("/:taskId"'));

    expect(handler).toContain('eventType: "approval.requirement_recorded"');
    expect(handler).toContain("concrete pending approvals only at the later actionable/completed-work gate");
    expect(handler).toContain("dispatchWorkExecution({");
    expect(handler).not.toContain('eventType: "approval.requested"');
    expect(handler).not.toContain("postApprovalRequestToConversation");
  });

  it("workroom approve_plan dispatches only when no concrete pending approval exists", () => {
    const src = source("routes/v1/taskWorkroom.ts");
    const handler = src.slice(src.indexOf('case "approve_plan"'), src.indexOf('case "reject_plan"'));
    const dispatchIndex = src.indexOf("if (dispatchAfterCommand)");

    expect(handler).toContain("approvalsTable");
    expect(handler).toContain('eq(approvalsTable.state, "pending")');
    expect(handler).toContain("PENDING_APPROVAL_REQUIRED");
    expect(handler).toContain("Resolve that approval rather than using approve_plan");
    expect(handler).toContain("dispatchAfterCommand = true");
    expect(dispatchIndex).toBeGreaterThan(src.indexOf('case "approve_plan"'));
    expect(src.slice(dispatchIndex)).toContain("dispatchWorkExecution({");
  });

  it("workroom retry re-dispatches the same failed task instead of only queueing it", () => {
    const src = source("routes/v1/taskWorkroom.ts");
    const handler = src.slice(src.indexOf('case "retry"'), src.indexOf('case "status"'));
    const dispatchIndex = src.indexOf("if (dispatchAfterCommand)");

    expect(handler).toContain('["failed", "queued"].includes(task.currentState)');
    expect(handler).toContain('newState = task.currentState === "queued" ? null : "queued"');
    expect(handler).toContain("dispatchAfterCommand = true");
    expect(dispatchIndex).toBeGreaterThan(src.indexOf('case "retry"'));
    expect(src.slice(dispatchIndex)).toContain("dispatchWorkExecution({");
  });

  it("queued retry tasks are claimable for execution", () => {
    const src = source("services/taskService.ts");

    expect(src).toContain('queued: ["planning", "executing", "cancelled"]');
    expect(src).toContain('const DISPATCHABLE_TASK_STATES = ["queued", "approved", "failed"] as const');
  });

  it("evidence gaps pause execution in evidence_required rather than approval or executing", () => {
    const taskService = source("services/taskService.ts");
    const coordinator = source("services/executionCoordinatorService.ts");
    const activeExecutions = source("services/activeExecutionsService.ts");
    const shared = readFileSync(resolve(root, "../../../lib/shared/src/index.ts"), "utf8");
    const dbSchema = readFileSync(resolve(root, "../../../lib/db/src/schema/tasks.ts"), "utf8");
    const migration = readFileSync(resolve(root, "../../../lib/db/migrations/0041_task_evidence_required_state.sql"), "utf8");
    const platformMigrations = source("bootstrap/platformMigrations.ts");

    expect(shared).toContain('"evidence_required"');
    expect(dbSchema).toContain('"evidence_required"');
    expect(taskService).toContain('executing: ["awaiting_approval", "completed", "evidence_required", "failed", "cancelled"]');
    expect(taskService).toContain('evidence_required: ["planning", "queued", "cancelled", "failed"]');
    expect(coordinator).toContain('transitionTaskState(taskId, organizationId, "evidence_required")');
    expect(activeExecutions).toContain('"evidence_required"');
    expect(migration).toContain("ALTER TYPE task_state ADD VALUE IF NOT EXISTS 'evidence_required'");
    expect(platformMigrations).toContain("0041-task-evidence-required-state");
  });

  it("workroom approval UI sends the backend's canonical action payload", () => {
    const src = readFileSync(resolve(root, "../../needsops-web/src/pages/app/TaskWorkroomPage.tsx"), "utf8");

    expect(src).toContain('JSON.stringify({ action: "approved"');
    expect(src).toContain('JSON.stringify({ action: "rejected"');
    expect(src).not.toContain('JSON.stringify({ decision: "approved"');
  });

  it("Task Centre keeps failed separate from cancelled", () => {
    const src = readFileSync(resolve(root, "../../needsops-web/src/pages/app/TaskCentrePage.tsx"), "utf8");

    expect(src).toContain('{ label: "Cancelled", states: ["cancelled"] }');
    expect(src).toContain('{ label: "Failed", states: ["failed"] }');
  });

  it("general chat can show multiple tasks created from one message", () => {
    const src = readFileSync(resolve(root, "../../needsops-web/src/pages/app/WorkforceChatPage.tsx"), "utf8");

    expect(src).toContain("autoCreatedTasks");
    expect(src).toContain("setAutoCreatedTasks");
    expect(src).toContain("autoCreatedTasks.length > 1");
  });

  it("explicit task IDs remain the highest-confidence reference resolver input", () => {
    const src = source("services/conversationControlService.ts");

    expect(src).toContain("resolveConversationReference(input:");
    expect(src).toContain("resolvedTaskId: best.taskId");
  });

  it("task title and description references are supported before recency fallback", () => {
    const src = source("services/conversationControlService.ts");

    expect(src).toContain("titleScore(input.text, task.title)");
    expect(src).toContain('reasons.push("title_match")');
  });

  it("ambiguous consequential task references request clarification", () => {
    const src = source("services/messageIngressService.ts");

    expect(src).toContain("requiresClarification");
    expect(src).toContain("I need you to confirm which task you mean");
  });

  it("cancel targets a resolved task and reports real cancellation status", () => {
    const src = source("services/messageIngressService.ts");

    expect(src).toContain('result.status === "already_cancelled"');
    expect(src).toContain("That task is already complete");
  });

  it("approval target resolution requires a unique pending approval candidate", () => {
    const src = source("services/conversationControlService.ts");

    expect(src).toContain("approvals.length === 1");
    expect(src).toContain("multiple_pending_approvals");
    expect(src).toContain("approvals.length === 0");
  });

  it("conversation approval transitions task state before dispatching execution", () => {
    const src = source("services/conversationControlService.ts");

    const transitionIndex = src.indexOf("transitionTaskState(approval.taskId");
    const dispatchIndex = src.indexOf("dispatchWorkExecution({");
    expect(transitionIndex).toBeGreaterThan(-1);
    expect(dispatchIndex).toBeGreaterThan(transitionIndex);
  });

  it("approval authority checks preserve role and self-approval restrictions", () => {
    const src = source("services/approvalService.ts");

    expect(src).toContain("checkApprovalAuthority");
    expect(src).toContain("APPROVAL_RESOLVER_ROLES");
    expect(src).toContain("SELF_APPROVAL_BLOCKED");
  });

  it("cancelled tasks cannot be approved back into execution through any approval surface", () => {
    const src = source("services/approvalService.ts");

    expect(src).toContain('task?.currentState === "cancelled"');
    expect(src).toContain("TASK_CANCELLED");
    expect(src).toContain("approval can no longer be resolved");
  });

  it("approval route canonicalises legacy decision payloads without creating a second dialect", () => {
    const src = source("routes/v1/approvalRoutes.ts");

    expect(src).toContain("action ?? decision");
    expect(src).toContain('["approved", "rejected"].includes(requestedAction)');
  });

  it("approval rejection moves the task to failed rather than a non-existent rejected task state", () => {
    const src = source("routes/v1/approvalRoutes.ts");

    expect(src).toContain('requestedAction === "approved" ? "approved" : "failed"');
    expect(src).not.toContain('"rejected" as unknown as TaskState');
  });

  it("awaiting approval is backed by approval service creation during the execution gate", () => {
    const src = source("services/taskService.ts");

    const gateIndex = src.indexOf("export async function requestTaskApprovalGate");
    const approvalIndex = src.indexOf("await createApproval({", gateIndex);
    const stateIndex = src.indexOf('transitionTaskState(input.taskId, input.organizationId, "awaiting_approval"', gateIndex);
    expect(gateIndex).toBeGreaterThan(-1);
    expect(approvalIndex).toBeGreaterThan(gateIndex);
    expect(stateIndex).toBeGreaterThan(approvalIndex);
    expect(src.indexOf('status: "not_ready"', gateIndex)).toBeGreaterThan(stateIndex);
  });

  it("approval-required completed work pauses task completion at awaiting approval", () => {
    const src = source("services/taskService.ts");

    expect(src).toContain('input.completedWorkStatus === "awaiting_approval"');
    expect(src).toContain("requestTaskApprovalGate({");
    expect(src).toContain('return { status: "awaiting_approval"');
  });

  it("execution coordinator does not post completed-task output when approval gate is pending", () => {
    const src = source("services/executionCoordinatorService.ts");

    const awaitingIndex = src.indexOf('reconciliation.status === "awaiting_approval"');
    const completedIndex = src.indexOf('type: "execution_completed"', awaitingIndex);
    expect(awaitingIndex).toBeGreaterThan(-1);
    expect(src).toContain('type: "approval_requested"');
    expect(completedIndex).toBeGreaterThan(awaitingIndex);
  });

  it("cancelled tasks cannot be claimed for execution", () => {
    const src = source("services/taskService.ts");

    expect(src).toContain('return { claimed: false, task, reason: "cancelled" }');
  });

  it("completed tasks cannot be claimed for execution", () => {
    const src = source("services/taskService.ts");

    expect(src).toContain('return { claimed: false, task, reason: "completed" }');
  });

  it("dispatch skips cancelled tasks before any execution-start event", () => {
    const src = source("services/executionCoordinatorService.ts");

    const dispatchSource = src.slice(src.indexOf("export async function dispatchWorkExecution"));
    const cancelledIndex = dispatchSource.indexOf('claim.reason === "cancelled"');
    const startedIndex = dispatchSource.indexOf('type: "execution_started"');
    expect(cancelledIndex).toBeGreaterThan(-1);
    expect(startedIndex).toBeGreaterThan(cancelledIndex);
  });

  it("cancelled execution finalisation records discard audit instead of completion", () => {
    const src = source("services/executionCoordinatorService.ts");

    expect(src).toContain("completion_discarded_after_cancel");
    expect(src).toContain("completedWorkId: result.completedWorkId");
  });

  it("execution failure does not overwrite a cancelled task", () => {
    const src = source("services/taskService.ts");

    expect(src).toContain('if (task.currentState === "cancelled") return { status: "cancelled", task };');
  });

  it("UEE cannot create Completed Work after the cancellation finalisation guard", () => {
    const src = source("services/unifiedExecutionEngine.ts");

    const guardIndex = src.indexOf("isTaskCancelledForFinalization");
    const createIndex = src.indexOf("createDraft({");
    expect(guardIndex).toBeGreaterThan(-1);
    expect(createIndex).toBeGreaterThan(guardIndex);
  });

  it("artifact/completed-work failure remains a non-completed execution outcome", () => {
    const src = source("services/executionCoordinatorService.ts");

    expect(src).toContain('} else if (result.outcome !== "completed")');
    expect(src).toContain('type: "execution_failed"');
  });

  it("modifying terminal work returns a revision/new-work requirement instead of rewriting history", () => {
    const src = source("services/taskService.ts");

    expect(src).toContain("needs_revision_task");
    expect(src).toContain("if (TERMINAL_TASK_STATES.has(task.currentState as TaskState))");
  });

  it("material modification invalidates approval-sensitive task state", () => {
    const src = source("services/taskService.ts");

    expect(src).toContain('task.currentState === "awaiting_approval" || task.currentState === "approved"');
    expect(src).toContain("approvalInvalidatedByModification");
    expect(src).toContain("supersedePendingApprovalsForTask");
  });

  it("task modification updates the authoritative task specification and refreshed plan", () => {
    const src = source("services/taskService.ts");

    expect(src).toContain("const updatedSpecification = mergeTaskSpecification");
    expect(src).toContain("const refreshedPlan = planTask(task.title, updatedSpecification)");
    expect(src).toContain("description: updatedSpecification");
    expect(src).toContain("planData: refreshedPlan");
    expect(src).toContain("version: `revision-${modifications.length + 2}`");
  });

  it("date-range modifications change the persisted execution input instead of only adding a note", () => {
    const src = source("services/taskService.ts");

    expect(src).toContain("function extractMonthRange");
    expect(src).toContain("return current.replace(currentRange, nextRange)");
  });

  it("completed and cancelled task modification preserves terminal history", () => {
    const src = source("services/taskService.ts");

    expect(src).toContain("TERMINAL_TASK_STATES.has(task.currentState as TaskState)");
    expect(src).toContain('return { status: "needs_revision_task", task };');
  });

  it("message ingress confirms modification only after canonical mutation succeeds", () => {
    const src = source("services/messageIngressService.ts");

    const modifyIndex = src.indexOf("const result = await modifyTaskFromConversation");
    const responseIndex = src.indexOf('result.status === "modified"');
    expect(modifyIndex).toBeGreaterThan(-1);
    expect(responseIndex).toBeGreaterThan(modifyIndex);
  });

  it("multi-task decomposition preserves a task proposal for each independent clause", () => {
    const src = source("routes/v1/conversations.ts");

    expect(src).toContain("splitClauses.map(clause");
    expect(src).toContain("clauseToTaskProposal");
  });

  it("multi-task decomposition keeps supporting analysis inside the primary professional task", () => {
    const src = source("routes/v1/conversations.ts");

    expect(src).toContain("describesSupportingAnalysis");
    expect(src).toContain("service agreement");
    expect(src).toContain("support item");
    expect(src).toContain("incident");
    expect(src).toContain("evidence");
  });

  it("multi-task decomposition still separates distinct requested deliverables", () => {
    const src = source("routes/v1/conversations.ts");

    expect(src).toContain("requestsSeparateDeliverable");
    expect(src).toContain("letter");
    expect(src).toContain("correspondence");
    expect(src).toContain("response");
  });

  it("multi-task persistence keeps source conversation and workroom metadata for every created task", () => {
    const src = source("routes/v1/conversations.ts");

    expect(src).toContain("conversationId: conv.id");
    expect(src).toContain("workroomConversationId");
  });

  it("multi-task UI exposes every created task rather than only the primary task", () => {
    const src = readFileSync(resolve(root, "../../needsops-web/src/pages/app/WorkforceChatPage.tsx"), "utf8");

    expect(src).toContain(".map(task =>");
    expect(src).toContain("View task");
  });

  it("source-message retry does not multiply UI task cards for the same task", () => {
    const src = readFileSync(resolve(root, "../../needsops-web/src/pages/app/WorkforceChatPage.tsx"), "utf8");

    expect(src).toContain("prev.some(task => task.taskId === auto.taskId)");
  });

  it("evidence continuation stays bound to active checkpoints", () => {
    const src = source("services/messageIngressService.ts");

    expect(src).toContain("getActiveCheckpointByConversation");
    expect(src).toContain("beginResume(conversationId)");
    expect(src).toContain("resumeFromCheckpointById");
  });

  it("duplicate checkpoint answers are protected by atomic beginResume", () => {
    const src = source("services/messageIngressService.ts");

    expect(src).toContain("if (!resumeResult.resumed)");
    expect(src).toContain('reason: resumeResult.reason ?? "already_resuming"');
  });

  it("conversation cancellation cancels any same-task checkpoint before runtime finalisation can resume", () => {
    const src = source("services/conversationControlService.ts");

    const checkpointIndex = src.indexOf("cancelCheckpoint(checkpoint.id)");
    const runtimeIndex = src.indexOf("cancelTaskExecution(input.taskId");
    expect(checkpointIndex).toBeGreaterThan(-1);
    expect(runtimeIndex).toBeGreaterThan(checkpointIndex);
  });

  it("workroom cancellation uses canonical task cancellation rather than raw state mutation", () => {
    const src = source("routes/v1/taskWorkroom.ts");

    expect(src).toContain("taskService.cancelTask(");
    expect(src).toContain("cancelTaskExecution(taskId");
  });

  it("task API cancellation uses canonical cancellation and runtime cancel signal", () => {
    const src = source("routes/v1/tasks.ts");

    expect(src).toContain("taskService.cancelTask");
    expect(src).toContain("cancelTaskExecution(req.params.taskId!");
  });

  it("Task Centre renders completed cancelled and failed from backend canonical states", () => {
    const src = readFileSync(resolve(root, "../../needsops-web/src/pages/app/TaskCentrePage.tsx"), "utf8");

    expect(src).toContain('{ label: "Needs Attention", states: ["awaiting_approval", "evidence_required", "failed"] }');
    expect(src).toContain('completed:         { label: "Completed"');
    expect(src).toContain('cancelled:         { label: "Cancelled"');
    expect(src).toContain('failed:            { label: "Failed"');
    expect(src).toContain("task.metadata?.executionFailure?.errorMessage");
  });

  it("task listing filters by requested states before applying the page limit", () => {
    const src = source("services/taskService.ts");
    const fn = src.slice(src.indexOf("export async function getTasksByOrg"), src.indexOf("export async function getTaskById"));

    expect(fn).toContain("conditions.push(inArray(tasksTable.currentState");
    expect(fn.indexOf("conditions.push(inArray(tasksTable.currentState")).toBeLessThan(fn.indexOf(".limit(limit)"));
  });

  it("workroom approval UI uses the same action schema for approval and rejection", () => {
    const src = readFileSync(resolve(root, "../../needsops-web/src/pages/app/TaskWorkroomPage.tsx"), "utf8");

    expect(src).toContain('action: "approved"');
    expect(src).toContain('action: "rejected"');
  });

  it("workroom metadata cards normalise unknown backend payload values before rendering", () => {
    const src = readFileSync(resolve(root, "../../needsops-web/src/pages/app/TaskWorkroomPage.tsx"), "utf8");

    expect(src).toContain("String(data.requestedAction)");
    expect(src).toContain("String(data.humanMessage ?? \"\")");
  });

  it("execution SSE events still include task correlation and authoritative event type", () => {
    const src = source("services/executionCoordinatorService.ts");

    expect(src).toContain("correlationId");
    expect(src).toContain('type: "execution_completed"');
    expect(src).toContain('type: "execution_failed"');
  });

  it("legacy execution intents without canonical task rows remain dispatchable for compatibility", () => {
    const src = source("services/executionCoordinatorService.ts");

    expect(src).toContain('claim.reason === "not_found"');
    expect(src).toContain("execution_coordinator.dispatch_without_canonical_task");
  });

  it("conversation task context stays bounded instead of sending entire organisation history", () => {
    const src = source("services/conversationControlService.ts");

    expect(src).toContain(".limit(20)");
    expect(src).not.toContain("limit(1000)");
  });

  it("task creation is protected by canonical idempotency and conversation work-intent matching", () => {
    const taskService = source("services/taskService.ts");
    const platformMigrations = source("bootstrap/platformMigrations.ts");
    const dbSchema = readFileSync(resolve(root, "../../../lib/db/src/schema/taskCreationIdempotency.ts"), "utf8");
    const migration = readFileSync(resolve(root, "../../../lib/db/migrations/0040_task_creation_idempotency.sql"), "utf8");
    const taskRoute = source("routes/v1/tasks.ts");
    const conversationRoute = source("routes/v1/conversations.ts");
    const autoDispatch = source("services/autoDispatchService.ts");

    expect(taskService).toContain("findExistingTaskForCreation");
    expect(taskService).toContain("deriveWorkIntentKey");
    expect(taskService).toContain('"ndis_service_agreement"');
    expect(taskService).toContain("idempotency_key");
    expect(taskService).toContain("conversation_work_intent");
    expect(taskService).toContain("allowDuplicate");
    expect(taskService).toContain("if (input.allowDuplicate && !idempotencyKey) return null");
    expect(taskService).toContain("taskCreationIdempotencyTable");
    expect(taskService).toContain("return db.transaction(async (tx) =>");
    expect(taskService).toContain("if (idempotencyKey) {");
    expect(taskService).toContain(".onConflictDoNothing({");
    expect(taskService).toContain("taskCreationIdempotencyTable.organizationId");
    expect(taskService).toContain("taskCreationIdempotencyTable.idempotencyKey");
    expect(platformMigrations).toContain("0040-task-creation-idempotency");
    expect(dbSchema).toContain('pgTable("task_creation_idempotency_keys"');
    expect(dbSchema).toContain("primaryKey({");
    expect(migration).toContain("PRIMARY KEY (organization_id, scope, idempotency_key)");
    expect(migration).toContain("DEFERRABLE INITIALLY DEFERRED");
    expect(migration).toContain("Existing duplicate task rows are preserved");
    expect(migration).toContain("WITH canonical AS");
    expect(migration).toContain("DISTINCT ON");
    expect(migration).toContain("ALTER TABLE task_creation_idempotency_keys ENABLE ROW LEVEL SECURITY");
    expect(taskRoute).toContain('req.header("Idempotency-Key")');
    expect(taskRoute).toContain("reusedExisting");
    expect(conversationRoute).toContain('req.header("Idempotency-Key")');
    expect(conversationRoute).toContain("conversationId: conv.id");
    expect(conversationRoute).toContain("result.userMessage.id");
    expect(conversationRoute).toContain("if (!autoResult.reusedExisting)");
    expect(conversationRoute).toContain("persistConversationFocus");
    expect(conversationRoute).toContain('"manual_create_reused_existing"');
    expect(autoDispatch).toContain("reusedExisting");
    expect(autoDispatch).toContain("idempotencyKey?: string");
    expect(autoDispatch).toContain("input.idempotencyKey ??");
    expect(autoDispatch).toContain("persistConversationFocus");
    expect(autoDispatch).toContain('"task_auto_created"');
    expect(autoDispatch).toContain('"auto_dispatch_reused_existing"');
  });

  it("newly created task focus beats stale same-title duplicates for immediate follow-ups", () => {
    const src = source("services/conversationControlService.ts");

    expect(src).toContain("function hasImmediateTaskReference");
    expect(src).toContain("same service agreement");
    expect(src).toContain("same task");
    expect(src).toContain("newly created");
    expect(src).toContain("score += hasImmediateTaskReference(input.text) ? 140 : 20");
  });

  it("manual create task UX disables retries and sends a stable idempotency key", () => {
    const src = readFileSync(resolve(root, "../../needsops-web/src/pages/app/WorkforceChatPage.tsx"), "utf8");

    expect(src).toContain("buildTaskCreateIdempotencyKey");
    expect(src).toContain("if (!conversationId || !slug || creatingTask) return");
    expect(src).toContain('headers: { "Idempotency-Key": idempotencyKey }');
    expect(src).toContain("body: JSON.stringify({");
    expect(src).toContain("description: summary");
    expect(src).toContain("idempotencyKey");
    expect(src).toContain("subjectParticipantIds: subjectParticipantId ? [subjectParticipantId] : undefined");
  });

  it("UI copy distinguishes queued/readiness from actual execution start and concrete approvals", () => {
    const src = readFileSync(resolve(root, "../../needsops-web/src/pages/app/WorkforceChatPage.tsx"), "utf8");

    expect(src).toContain("Task created — queued for execution");
    expect(src).toContain("Approval requirements are recorded; a concrete approval request appears only at the required gate.");
    expect(src).not.toContain("Task created & execution started");
    expect(src).not.toContain("Review the approval request above to start execution.");
  });

  it("execution submission does not mark broker-pending work as executing before runtime start", () => {
    const src = source("services/executionService.ts");

    const submitBody = src.slice(src.indexOf("export async function submitTaskExecution"), src.indexOf("// ─── Get execution status"));
    expect(submitBody).not.toContain('.set({ currentState: "executing"');
    expect(submitBody).toContain("if (!requiresOpenClawRuntime(pkg))");
    const awsNativeBody = src.slice(src.indexOf("async function startAwsNativeExecution"), src.indexOf("// ─── Submit execution"));
    expect(awsNativeBody).toContain('currentStatus: "running"');
    expect(awsNativeBody).toContain('eventType: "execution.started"');
    expect(awsNativeBody).toContain('currentState: "executing"');
  });

  it("CoS and system-authored plan cards cannot invent operational completion ETAs", () => {
    const cosPrompt = source("services/chiefOfStaffLLMService.ts");
    const conversationService = source("services/conversationService.ts");
    const controlService = source("services/conversationControlService.ts");
    const intelligenceService = source("services/conversationIntelligenceService.ts");
    const ingressService = source("services/messageIngressService.ts");
    const taskWorkroomPage = readFileSync(resolve(root, "../../needsops-web/src/pages/app/TaskWorkroomPage.tsx"), "utf8");

    expect(cosPrompt).toContain("OPERATIONAL FACT GROUNDING");
    expect(cosPrompt).toContain("If the system context does not provide a runtime ETA");
    expect(cosPrompt).toContain("Do NOT invent phrases");
    expect(conversationService).toContain("Runtime completion estimate: not available until execution telemetry provides one.");
    expect(conversationService).not.toContain("Estimated duration: ${plan.estimatedTotalDuration}");
    expect(controlService).toContain("how long");
    expect(controlService).toContain("completion estimate");
    expect(intelligenceService).toContain("how long");
    expect(intelligenceService).toContain("completion estimate");
    expect(ingressService).toContain("I do not have a reliable completion estimate yet.");
    expect(taskWorkroomPage).not.toContain("Estimated: {estimatedTotalDuration}");
    expect(taskWorkroomPage).not.toContain("{plan.estimatedTotalDuration}");
  });

  it("CoS does not push professional methodology scope decisions back to the user", () => {
    const cosPrompt = source("services/chiefOfStaffLLMService.ts");
    const intelligenceService = source("services/conversationIntelligenceService.ts");

    expect(cosPrompt).toContain("CLARIFICATION SUFFICIENCY");
    expect(cosPrompt).toContain("Do not ask the user to perform the specialist's professional methodology");
    expect(cosPrompt).toContain("all relevant NDIS clauses");
    expect(cosPrompt).toContain("Do not ask substantially the same clarification twice");
    expect(intelligenceService).toContain("BROAD_PROFESSIONAL_SCOPE_PATTERNS");
    expect(intelligenceService).toContain("normalizeClarificationForProfessionalScope");
    expect(intelligenceService).toContain("isProfessionalScopeClarification");
  });

  it("conversation approval replies cannot fabricate approval when no concrete approval exists", () => {
    const controlService = source("services/conversationControlService.ts");
    const ingressService = source("services/messageIngressService.ts");

    expect(controlService).toContain("/^(approved|approve|go ahead|proceed)\\b/i");
    expect(ingressService).toContain("There is no concrete pending approval request");
    expect(ingressService).toContain("I have not changed any task state");
  });

  it("assistant confirmation copy creates a bound pending action and suppresses auto-dispatch", () => {
    const ingressService = source("services/messageIngressService.ts");
    const conversationRoute = source("routes/v1/conversations.ts");
    const controlService = source("services/conversationControlService.ts");

    expect(controlService).toContain("responseRequestsTaskConfirmation");
    expect(ingressService).toContain("responseRequestsTaskConfirmation(result.understanding.customerResponse)");
    expect(ingressService).toContain("persistConversationConfirmation({");
    expect(conversationRoute).toContain("const waitsForExplicitConfirmation = responseRequestsTaskConfirmation(result.understanding.customerResponse)");
    expect(conversationRoute).toContain("!waitsForExplicitConfirmation");
  });

  it("new pending confirmations supersede stale conversation actions instead of letting old tasks win", () => {
    const controlService = source("services/conversationControlService.ts");

    expect(controlService).toContain("PENDING_CONFIRMATION_MAX_AGE_MS");
    expect(controlService).toContain("supersedePendingConversationConfirmations");
    expect(controlService).toContain('status: "superseded"');
    expect(controlService).toContain("newer_confirmation_in_same_conversation");
  });

  it("failed tasks are not reusable active work-intent dedupe targets for fresh task creation", () => {
    const taskService = source("services/taskService.ts");
    const creationStates = taskService.slice(
      taskService.indexOf("const ACTIVE_TASK_CREATION_STATES"),
      taskService.indexOf("function normaliseIntentText"),
    );

    expect(creationStates).not.toContain('"failed"');
  });

  it("same-title auto-dispatch dedupe is message/confirmation scoped rather than title-global", () => {
    const autoDispatch = source("services/autoDispatchService.ts");
    const ingressService = source("services/messageIngressService.ts");
    const conversationRoute = source("routes/v1/conversations.ts");

    expect(autoDispatch).toContain("idempotencyKey?: string");
    expect(ingressService).toContain("conversation_confirmation:${input.confirmation.id}");
    expect(conversationRoute).toContain("requestIdempotencyKey ?? result.userMessage.id");
    expect(conversationRoute).not.toContain("idempotencyKey:    `cos_auto_dispatch:${conversationId}:${proposedTask.title.trim().toLowerCase()}`");
  });

  it("conversation work-intent dedupe is a short retry window, not a permanent historical lock", () => {
    const taskService = source("services/taskService.ts");

    expect(taskService).toContain("CONVERSATION_WORK_INTENT_DEDUPE_WINDOW_MS");
    expect(taskService).toContain("creationIsWithinWorkIntentDedupeWindow");
    expect(taskService).toContain("creationIsWithinWorkIntentDedupeWindow(creation)");
  });

  it("action-state grounding queries persisted task state and exposes it to the CoS prompt", () => {
    const actionState = source("services/conversationActionStateService.ts");

    expect(actionState).toContain("tasksTable");
    expect(actionState).toContain("currentState: tasksTable.currentState");
    expect(actionState).toContain('if (s.taskState === "failed"');
    expect(actionState).toContain("Authoritative task state");
  });

  it("read-only task status questions never create pending conversation confirmations", () => {
    const controlService = source("services/conversationControlService.ts");
    const ingressService = source("services/messageIngressService.ts");

    const consequential = controlService.slice(
      controlService.indexOf("export const CONSEQUENTIAL_ACTIONS"),
      controlService.indexOf("const OPEN_TASK_STATES"),
    );
    expect(consequential).not.toContain('"STATUS_QUERY"');
    expect(controlService).toContain('requiresClarification: intent === "STATUS_QUERY" ? false');

    const clarificationBlock = ingressService.slice(
      ingressService.indexOf("if (resolution.requiresClarification)"),
      ingressService.indexOf("switch (resolution.intent)"),
    );
    expect(clarificationBlock).toContain("persistConversationConfirmation");
    expect(controlService).toContain("what task are we working on");
    expect(controlService).toContain("who('s| is)? working on");
  });

  it("current-task references resolve to focused task without asking user to select the same task", () => {
    const controlService = source("services/conversationControlService.ts");

    expect(controlService).toContain("single_status_referent");
    expect(controlService).toContain("conversation_focus");
    expect(controlService).toContain("working on|started|failed|completed");
    expect(controlService).toContain("hasImmediateTaskReference(input.text) ? 140 : 20");
  });

  it("status answers preserve failed task state and execution history over stale plan state", () => {
    const ingressService = source("services/messageIngressService.ts");
    const actionState = source("services/conversationActionStateService.ts");

    expect(ingressService).toContain("formatStatusResponse");
    expect(ingressService).toContain("The authoritative task state is");
    expect(ingressService).toContain("The task \"${task.title}\" is failed");
    expect(actionState).toContain('if (s.taskState === "failed"');
    expect(actionState).toContain("Disallowed claims");
  });

  it("specialist-start questions distinguish started-then-failed from currently executing", () => {
    const ingressService = source("services/messageIngressService.ts");

    expect(ingressService).toContain("hasExecutionStarted");
    expect(ingressService).toContain("but it later failed");
    expect(ingressService).toContain("it is currently executing");
    expect(ingressService).toContain("No confirmed specialist execution has started");
  });
});
