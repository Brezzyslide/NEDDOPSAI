---
name: NeedsOps Execution Pipeline Bugs
description: Bugs found when wiring POST /tasks to execute work — column name mismatches, null guards, missing dispatch call
---

## Three bugs that blocked the execution pipeline from ever running via Task Centre

### Bug 1 — POST /tasks route never dispatched execution
`artifacts/api-server/src/routes/v1/tasks.ts` created tasks and returned 201 but never called
`dispatchWorkExecution`. Only the conversation-linked `POST /conversations/:id/create-task` route
did. Fix: import `dispatchWorkExecution` from `executionCoordinatorService.js` and call it
fire-and-forget when `!result.plan.requiresApproval`.

### Bug 2 — `entityKnowledge` not guarded against undefined
`Object.keys(manifest.entityKnowledge)` in `workExecutionPipelineService.ts` (1 place) and
`workValidationService.ts` (3 places) crashed when execution was dispatched without entity context
(entityKnowledge was undefined, not {}). All four changed to `manifest.entityKnowledge ?? {}`.

### Bug 3 — Wrong column name on organisationMemoryTable (root crash)
`workPackageService.ts` queried `organisationMemoryTable.approvalStatus` in both the select
projection and the WHERE clause. The schema column is `status` — `approvalStatus` doesn't exist.
In Drizzle v0.45.2, accessing a non-existent table column yields a value that Drizzle's
`orderSelectedFields` tries to recurse into, calling `Object.entries(null/undefined)` and
throwing `TypeError: Cannot convert undefined or null to object`. Fix: change both references to
`organisationMemoryTable.status`.

**Why:** `orderSelectedFields` in Drizzle v0.45.2 treats any non-Column, non-SQL object value as a
nested select object and recurses into it. A `null`/`undefined` column reference will crash with
`Object.entries(null)`. Always verify column names against `lib/db/src/schema/*.ts` before adding
them to a `.select({...})` call.

### How to apply
- Whenever adding a new `.select({...})` call, grep `lib/db/src/schema/<table>.ts` to confirm
  every column name before using it.
- When dispatching execution without conversation context, always default `entityKnowledge` to `{}`.
- For fire-and-forget dispatch from routes, pattern: call `dispatchWorkExecution({...}).catch(...)` 
  without await; the pipeline writes completed_work regardless of conversationId.
