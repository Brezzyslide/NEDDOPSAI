import { randomUUID } from "crypto";
import { pool } from "@workspace/db";
import {
  claimTaskForExecution,
  createTask,
  getTaskById,
  reconcileTaskExecutionFailure,
  reconcileTaskExecutionSuccess,
} from "../services/taskService.js";
import { executeWork } from "../services/workExecutionPipelineService.js";

const organizationId = requiredEnv("CARE_PLAN_ORG_ID");
const requesterId = requiredEnv("CARE_PLAN_REQUESTER_ID");
const participantId = requiredEnv("CARE_PLAN_PARTICIPANT_ID");
const requesterRole = process.env.CARE_PLAN_REQUESTER_ROLE?.trim() || "owner";
const title = process.env.CARE_PLAN_TITLE?.trim() || "Create participant-specific care plan";
const userRequest = requiredEnv("CARE_PLAN_USER_REQUEST");
const correlationId = process.env.CARE_PLAN_CORRELATION_ID?.trim() || `care-plan-${randomUUID()}`;

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

try {
  const created = await createTask({
    organizationId,
    originatingUserId: requesterId,
    title,
    description: userRequest,
    priority: "normal",
    originatingModule: "production_supervised_care_plan_run",
    idempotencyKey: correlationId,
    allowDuplicate: true,
    sourceUserRequest: userRequest,
    subjectParticipantIds: [participantId],
  });

  console.log(JSON.stringify({
    stage: "task_created",
    taskId: created.task.id,
    state: created.task.currentState,
    plan: {
      intent: created.plan.intent,
      primarySpecialist: created.plan.primarySpecialist,
      assignedSpecialists: created.plan.assignedSpecialists,
      requiresApproval: created.plan.requiresApproval,
    },
  }));

  const claim = await claimTaskForExecution(created.task.id, organizationId, {
    correlationId,
    runner: "run-care-plan-task",
  });

  console.log(JSON.stringify({
    stage: "task_claimed",
    claimed: claim.claimed,
    reason: claim.reason ?? null,
    state: claim.task?.currentState ?? null,
  }));

  if (!claim.claimed) {
    throw new Error(`Task was not dispatchable: ${claim.reason ?? "unknown"}`);
  }

  const result = await executeWork({
    organizationId,
    requesterId,
    requesterRole,
    userRequest,
    canonicalIntent: "care_plan.create",
    blueprintCode: "care_plan",
    title,
    taskId: created.task.id,
    correlationId,
    laneContext: {
      lane: "evidence_bearing",
      requiresEvidence: true,
      requiresApproval: true,
      allowExternalWebSearch: false,
    },
    onProgress: async (stage, detail) => {
      console.log(JSON.stringify({
        stage: "progress",
        progress: stage,
        detail: detail ?? null,
      }));
    },
  });

  console.log(JSON.stringify({
    stage: "execution_result",
    result: {
      outcome: result.outcome,
      message: result.message,
      completedWorkId: result.completedWorkId,
      completedWorkStatus: result.completedWorkStatus,
      qualityScore: result.qualityScore,
      clarificationQuestions: result.clarificationQuestions,
    },
  }));

  const reconciliation = result.outcome === "completed"
    ? await reconcileTaskExecutionSuccess({
        taskId: created.task.id,
        organizationId,
        completedWorkId: result.completedWorkId,
        completedWorkStatus: result.completedWorkStatus,
        correlationId,
        requestedByUserId: requesterId,
      })
    : await reconcileTaskExecutionFailure({
        taskId: created.task.id,
        organizationId,
        errorMessage: result.message ?? result.outcome,
        correlationId,
        failureMetadata: {
          outcome: result.outcome,
          completedWorkId: result.completedWorkId,
          completedWorkStatus: result.completedWorkStatus,
          qualityScore: result.qualityScore,
        },
      });

  const finalTask = await getTaskById(created.task.id, organizationId).catch(() => null);

  console.log(JSON.stringify({
    stage: "reconciled",
    reconciliation,
    finalTask: finalTask
      ? {
          id: finalTask.id,
          state: finalTask.currentState,
          approvalState: finalTask.approvalState,
        }
      : null,
  }));
} catch (error) {
  console.error(JSON.stringify({
    stage: "fatal",
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  }));
  process.exitCode = 1;
} finally {
  await pool.end();
}
