---
name: NeedsOps Sprint 27.2 Durable Checkpoint Persistence
description: Hardened clarification/checkpoint flow with DB-backed durable checkpoints, atomic beginResume, unified message ingress, and optimistic chat UI.
---

## Key rules

**New table**: `execution_checkpoints` — status enum: active/awaiting_clarification/resuming/resumed/completed/failed/expired/cancelled. REQUIRED_RLS_TABLES=70.

**createCheckpoint cancels existing active checkpoints first**, then inserts. Always call via `executionCheckpointService.createCheckpoint(...)`.

**beginResume is the atomic gate** — performs a DB compare-and-set: `awaiting_clarification → resuming`. Returns `{ resumed: true, checkpoint }` or `{ resumed: false, reason: "no_checkpoint"|"already_resuming" }`. Never fire resume without calling beginResume first.

**messageIngressService is the single ingress point** — routes must NOT contain inline checkpoint check logic. All conversation message routes (conversations.ts, taskWorkroom.ts) delegate entirely to `handleIncomingMessage`.

**Result types from handleIncomingMessage**: `normal`, `checkpoint_resume`, `checkpoint_duplicate`, `error`.

**Startup recovery**: `recoverStuckResumes()` resets `resuming` → `awaiting_clarification` (5-min threshold); `expireStaleCheckpoints()` marks expired. Both called in `artifacts/api-server/src/index.ts` step 4d.

## Why

In-memory checkpoint store was lost on process restart, causing stuck executions after server restarts. Durable DB-backed store survives restarts. `beginResume` atomic CAS prevents double-resume race condition.

## How to apply

- New checkpoint: `createCheckpoint(input)` — cancels existing active first
- Checkpoint resume: `beginResume(conversationId)` → check `result.resumed` → `resumeFromCheckpointById(input)`
- Lifecycle: `markResumed/Completed/Failed/cancelCheckpoint` for terminal transitions
- Optimistic UI: `_pending?: boolean` / `_failed?: boolean` on Message objects; filter when comparing to server messages

## Test file split rule

**Do NOT put duplicate vi.mock calls for the same module in one test file.** If you need to test the real implementation of module A AND mock module A for tests of module B, they MUST be in separate test files. Duplicate vi.mock is hoisted and only the last declaration wins — causes silent mock conflicts.

- `sprint272-checkpoint-persist.test.ts` — tests the real executionCheckpointService (mocks @workspace/db)
- `sprint272-message-ingress.test.ts` — tests messageIngressService and coordinator delegation (mocks executionCheckpointService)

## Counts

- REQUIRED_RLS_TABLES = 70
- Tests: 3055 total, 3039 passing, 16 pre-existing failures (unchanged)
- New tests: 28 (19 service + 9 ingress)
