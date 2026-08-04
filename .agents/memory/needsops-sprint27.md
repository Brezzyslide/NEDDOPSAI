---
name: NeedsOps Sprint 27 Intelligent Work Execution
description: Execution loop wiring — intent approval → executeWork → conversation messages. New coordinator service, progress callbacks, audit event types.
---

## What was built

### New service: `executionCoordinatorService.ts`
- `coordinateIntentApproval(intentId, orgId, approvedBy)` — approves intent, resolves conversation from task, fires `executeWork()` in background, posts lifecycle messages. Returns immediately.
- `dispatchWorkExecution(input)` — same background pattern for no-approval-required path.
- Internal `runExecutionInBackground()` / `executeWorkAsync()` — fire-and-forget, all errors caught and posted to conversation.
- Idempotency: status `dispatched` or `completed` → returns `{ dispatched: false, skipReason: "already_dispatched" }`.

### DB call order in `coordinateIntentApproval`
1. intent lookup
2. `resolveConversationForTask` → workroom conversation (2 selects if no workroom: task_workroom then fallback)
3. task lookup
4. `db.update` (approve)
5. `db.update` (mark dispatched)

**Test mocks must follow this order** — tests that got it wrong caused `conversationId` to be populated with task data.

### `workExecutionPipelineService.ts` — `onProgress` callback
Added `onProgress?: ExecutionProgressCallback` to `ExecuteWorkInput`. Emits 7 stages:
`selecting_blueprint` → `assembling_package` → `validating` → `retrieving_examples` → `executing` → `reviewing` → `creating_completed_work`

Errors thrown by `onProgress` are always swallowed — never abort the pipeline.

### `conversationService.ts` — 4 new exports
- `postExecutionStartedToConversation(orgId, convId, taskId, correlationId)`
- `postExecutionProgressToConversation(orgId, convId, taskId, stage, correlationId)`
- `postCompletedWorkCreatedToConversation(orgId, convId, taskId, completedWorkId, title, qualityScore, correlationId)`
- `postExecutionFailedToConversation(orgId, convId, taskId, errorMessage, correlationId)`

All use `senderType: "runtime"`, `messageType: "execution_update"`, with `buildExecutionUpdateCard()` for structured content.

### Route changes
- `executionIntents.ts` approve route → calls `coordinateIntentApproval()` instead of bare `approveIntent()`; response now includes `executionDispatched` and `executionStarted`.
- `conversations.ts` create-task route → if `!plan.requiresApproval`, fires `dispatchWorkExecution()` in background.

### Audit event types added to `lib/shared`
Added to `AUDIT_EVENTS` in both `lib/shared/src/index.ts` and `lib/shared/dist/index.d.ts` (dist must be updated manually — no build script):
- `execution_intent.approved`
- `execution_intent.dispatched`
- `execution_coordinator.dispatch_started`
- `execution_coordinator.completed`
- `execution_coordinator.pipeline_outcome`
- `execution_coordinator.error`

**Why:** `logOrgEvent` enforces `AuditEventType` strictly from the const union in `@workspace/shared`. New event prefixes must be added to both the source AND the compiled dist.

## What remains (genuine gaps not closed in Sprint 27)
- SSE `execution_progress` events during real-time streaming (the conversation SSE stream doesn't yet emit live progress — it only posts to DB via `addMessage()`; UI must poll GET /messages)
- Clarification pause/resume in the `workExecutionPipelineService` pipeline (validation returns `clarificationQuestions` but there is no persistent paused state + resume mechanism)
- Task approval path (separate from intent approval) → still only dispatches specialist runs, not `executeWork()`
- 2603 tests passing after Sprint 27
