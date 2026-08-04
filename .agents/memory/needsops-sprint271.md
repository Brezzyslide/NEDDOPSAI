---
name: NeedsOps Sprint 27.1 Intelligent Execution Experience & Recovery
description: Live SSE progress, checkpoint-based clarification resume, unified approvals, execution timeline, orphan recovery. 2650 tests.
---

## What was built

### New foundation files (no DB tables needed)

**`executionEventBus.ts`**
- In-process pub/sub via Node EventEmitter, keyed by `exec:${conversationId}`
- `emitExecutionEvent(conversationId, payload)` — emits + buffers
- `subscribeToExecutionEvents(conversationId, listener)` → unsub fn
- `getBufferedEventsSince(conversationId, lastEventId)` — reconnect catch-up
- 60-second event buffer, 500 max listeners
- EventIds are monotonically increasing across the process lifetime

**`executionCheckpointStore.ts`**
- In-memory Map keyed by conversationId (one checkpoint per conversation)
- 30-minute TTL; cleanup timer every 5 minutes (unref'd so process exits cleanly)
- Stores: correlationId, blueprint, manifest, originalRequest, clarificationQuestions
- API: `saveCheckpoint`, `getCheckpoint`, `clearCheckpoint`, `hasActiveCheckpoint`

**`executionTimelineService.ts`**
- Builds `ExecutionTimeline` from `execution_update` conversation messages
- Zero new DB tables — derives timeline from existing messages
- `getConversationTimeline(orgId, convId)` — by conversation
- `getCompletedWorkTimeline(orgId, completedWorkId)` — via linked conversation
- `getOrgExecutionTimelines(orgId, limit)` — across all org conversations

### Modified services

**`workExecutionPipelineService.ts`**
- New `ExecutionCheckpointData` type: blueprint + manifest + clarificationAnswer
- New `checkpointData?` field on `ExecuteWorkInput`
- When `checkpointData` present: stages 1 (select blueprint) and 2 (assemble package) are SKIPPED
- `validation_failed` outcome renamed to `"awaiting_clarification"` — clarification is a pause, not a failure

**`executionCoordinatorService.ts`** (major additions)
- Emits to `executionEventBus` alongside every DB message write
- `awaiting_clarification` outcome: saves checkpoint + posts clarification message (NOT failure) + emits SSE
- New: `resumeFromCheckpoint(convId, orgId, requesterId, clarificationAnswer)` — loads checkpoint, clears it, re-runs pipeline from step 3 with checkpoint data
- New: `recoverOrphanedExecutions(orgId?)` — scans for `dispatched` intents > 10 min old, re-queues them; returns count

**`conversationService.ts`**
- New: `postClarificationRequestToConversation(orgId, convId, taskId, questions, correlationId)` — human-readable pause message with numbered questions

### Route changes

**`conversations.ts`**
- New: `GET /:conversationId/execution-stream` — SSE endpoint
  - Last-Event-ID header or `?lastEventId=` for reconnect catch-up
  - Sends buffered events immediately on connect
  - Heartbeat every 15 seconds (`: heartbeat\n\n`)
  - Closes after terminal event (completed/failed) or 5-minute idle timeout
  - Strips internal names from event payload (no manifest, pipeline, intent, correlationId exposed)
  - Cleans up subscription + timers on client disconnect
- New: `GET /:conversationId/execution-timeline` — returns timeline entries
- Modified message handler: checks `hasActiveCheckpoint(conversationId)` before processing — if active checkpoint, fires `resumeFromCheckpoint()` in background

**`approvalRoutes.ts`**
- Resolve route: when `action === 'approved'` and `approval.taskId` exists → calls `getTaskById` + `dispatchWorkExecution()` in background
- Covers: Chat approvals, Governance Centre, Executive Dashboard, Mobile approvals (all call POST /approvals/:id/resolve)
- Response now includes `executionDispatched` boolean
- `dispatchWorkExecution` is idempotent so double-dispatch is safe

## Test counts
- sprint271-foundations.test.ts — 27 tests (event bus, checkpoint store, timeline, pipeline resume, UX labels)
- sprint271-execution-experience.test.ts — 20 tests (coordinator clarification, dispatch, resume, recovery, approval)
- Total: **2650 tests passing** (up from 2603)

## Key rules

- `vi.mock` is hoisted file-wide in vitest — if a module is mocked for coordinator tests, it cannot be tested as a real module in the same file. Always split into separate test files for: (a) modules needing real implementation, (b) modules using mocked dependencies.
- Mock chains that end with `.orderBy()` (no `.limit()`) must be awaitable: add `.then/.catch/.finally` bound to `Promise.resolve(rows)`.
- `checkpointData` in pipeline skips stages 1 and 2 only — validation (stage 3) still runs, to ensure the enriched request passes.
- The SSE endpoint deliberately strips `stage`, `correlationId`, and any internal field names before sending to clients.

## What remains
- DB-persisted checkpoints (current: in-memory only, lost on restart)
- Real-time progress within a stage (e.g. streaming LLM token output)
- Startup hook to automatically run `recoverOrphanedExecutions()` on API server boot
