/**
 * Work Execution Pipeline Service — Sprint 29B (Thin Adapter)
 *
 * All execution logic has moved to UnifiedExecutionEngine.
 * This file is a backward-compatible adapter that:
 *   1. Re-exports all types defined in the engine (external importers unchanged)
 *   2. Implements executeWork() as a thin delegate to the engine
 *
 * External callers (executionCoordinatorService, routes, tests) continue to use
 * the same function signature and return type — no changes required upstream.
 */

// ─── Re-export engine types for backward compatibility ────────────────────────
// All files that import these from workExecutionPipelineService continue to work.
export {
  FallbackDraftError,
  EXECUTION_STAGE_LABELS,
  createUnifiedExecutionEngine,
  type ExecutionTrigger,
  type ExecutionProgressCallback,
  type ExecutionStage,
  type ExecuteWorkInput,
  type ExecutionOutcome,
  type ExecuteWorkResult,
  type ExecutionCheckpointData,
  type ExecutionRequest,
  type UnifiedExecutionResult,
} from "./unifiedExecutionEngine.js";

import { createUnifiedExecutionEngine, type ExecuteWorkInput, type ExecuteWorkResult } from "./unifiedExecutionEngine.js";

// ─── Thin adapter ─────────────────────────────────────────────────────────────

/**
 * Executes professional work through the Unified Execution Engine.
 *
 * Signature, return type, and behaviour are identical to the previous
 * direct-pipeline implementation. The engine handles blueprint selection,
 * evidence resolution (via ResourceRegistry), validation, AI execution,
 * self-review, and Completed Work creation.
 */
export async function executeWork(input: ExecuteWorkInput): Promise<ExecuteWorkResult> {
  const engine = createUnifiedExecutionEngine();
  const result = await engine.execute({
    trigger: "task",
    organisationId: input.organizationId,
    requesterId: input.requesterId,
    requesterRole: input.requesterRole,
    userRequest: input.userRequest,
    blueprintCode: input.blueprintCode,
    blueprintId: input.blueprintId,
    taskUploadSourceIds: input.taskUploadSourceIds,
    entityKnowledge: input.entityKnowledge,
    title: input.title,
    conversationId: input.conversationId,
    correlationId: input.correlationId,
    onProgress: input.onProgress,
    checkpointData: input.checkpointData,
  });

  if (result.trigger === "conversation") {
    throw new Error("[WorkExecutionPipeline] Unexpected conversation result from task trigger");
  }
  return result.workResult;
}
