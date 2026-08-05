---
name: NeedsOps Execution Pipeline Column Bugs & Clarification Flow Fixes
description: Wrong Drizzle column names + two silent-failure paths in the clarification/checkpoint flow that kept tasks stuck at approved forever.
---

## Context
All bugs caused tasks to silently stall at `approved` state. The column bugs crashed Drizzle; the checkpoint bugs caused the pipeline to return `awaiting_clarification` with nowhere to write or resume.

**Critical architectural note:** `@workspace/db` exports `"." : "./src/index.ts"` and the API server uses an esbuild `workspaceSourcePlugin` that resolves all `@workspace/*` imports to `lib/<pkg>/src/index.ts` at bundle time. The compiled `lib/db/dist/*.d.ts` files are **only for TypeScript type-checking**, not runtime.

---

## Bug 1 — Wrong Drizzle column in `workPackageService.ts` (FIXED)
- **Wrong:** `organisationMemoryTable.approvalStatus` (column does not exist)
- **Correct:** `organisationMemoryTable.status`
- Crash stage: Step 2 of pipeline (Assemble Work Package Manifest)
- Error: `TypeError: Cannot convert undefined or null to object` deep in `drizzle-orm/utils.ts:80 → orderSelectedFields`

## Bug 2 — Wrong Drizzle column in `approvedExampleService.ts` (FIXED)
- **Wrong:** `knowledgeChunksTable.content` (schema defines it as `text("text")` → JS property is `.text`)
- **Correct:** `knowledgeChunksTable.text`
- Crash stage: Step 4 of pipeline (Retrieve Approved Examples / buildStyleGuidance)

## Bug 3 — Workroom messages handler never checked for active checkpoint (FIXED)
- **File:** `artifacts/api-server/src/routes/v1/taskWorkroom.ts` `POST /messages`
- **Problem:** When a user answered clarification questions in the task workroom, the handler processed the reply as a regular conversation message (generating a CoS response) but never called `resumeFromCheckpoint`. Only the standalone `conversations.ts` message handler had the resume check.
- **Fix:** Added `hasActiveCheckpoint(conv.id)` check + `resumeFromCheckpoint(...)` call to the workroom messages handler, mirroring `conversations.ts` lines 172-180.

## Bug 4 — `dispatchWorkExecution` passed `conversationId: undefined` for direct task creation (FIXED)
- **File:** `artifacts/api-server/src/services/executionCoordinatorService.ts`
- **Problem:** Tasks created via `POST /v1/organisations/:slug/tasks` (not through conversation workroom) called `dispatchWorkExecution` with `conversationId: undefined`. When the pipeline returned `awaiting_clarification`, the coordinator silently returned without saving a checkpoint or posting clarification questions — no workroom conversation existed to receive them.
- **Fix:** `dispatchWorkExecution` now calls `getOrCreateWorkroom(organizationId, taskId, requesterId)` when no `conversationId` is provided, ensuring a workroom always exists before background execution starts.

---

## Safeguards Added
1. `assertSelectFields(fields, label)` guard in `workPackageService.ts` and `approvedExampleService.ts` — throws a named error if any field value is `undefined` before the Drizzle call
2. `[pipeline] orgId stage=X` tracing in `workExecutionPipelineService.ts` progress wrapper — server logs show exactly which stage execution reaches
3. Regression test: `src/__tests__/regression-execution-column-contracts.test.ts` (37 tests)

## How to Detect Future Instances
- Silent stall after `stage=validating` with no next stage log → validation returned `awaiting_clarification`; check whether `conversationId` was resolved and checkpoint was saved
- `TypeError: Cannot convert undefined or null to object` in `orderSelectedFields` → a field in an explicit `.select({...})` call doesn't exist on the table; `assertSelectFields` guard will now name it

## Pre-existing Test Failures (not caused by this work)
16 failures in `src/tests/` and `src/services/__tests__/` subdirs:
- `sprint95-specialist-eligibility.test.ts` — tests specialists removed in Sprint 11
- `deviceService.test.ts`, `discoveryService.test.ts`, `paymentBypass`, `INGESTION_JOB_STATUSES` — pre-existing count/mock mismatches

## Test Count
3011 passing (37 new regression tests + 2974 pre-existing passing)
