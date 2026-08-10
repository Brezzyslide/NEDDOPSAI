---
name: NeedsOps Workroom Lifecycle Architecture
description: general_workforce / task_workroom invariants, migration SQL for stale primaryTaskId, and verification script
---

## The invariant

- `general_workforce` conversations must NEVER have `primaryTaskId` set.
- Every task gets a dedicated `task_workroom` conversation via `getOrCreateWorkroom()`.
- Only `task_created` cards go to the general conv; plan/approval/execution all go to the workroom.
- `resolvedTaskId` in conversations.ts is type-aware:
  - `task_workroom` → inherits `primaryTaskId` (enables clarification/checkpoint resume)
  - `general_workforce` → always `undefined` unless explicitly passed in the body
- Auto-dispatch guard in conversations.ts uses `conv.conversationType !== "task_workroom"` (not `!conv.primaryTaskId`).

**Why:** Before commit c2ac345, `linkConversationToTask()` wrote `primaryTaskId` onto the general_workforce conversation. All subsequent messages inherited the stale task. A second task could never be created from the same chat. Execution output (plan, approval, progress) went into the general chat instead of a dedicated workroom.

**How to apply:** Never call `linkConversationToTask()` on a general_workforce conversation. Always route plan/exec messages through `getOrCreateWorkroom()`. Check `conversationType` in any code that resolves a `taskId` from a conversation.

## Verification

Runtime integration script: `artifacts/api-server/scripts/verify-workroom-lifecycle.ts`
Run: `cd artifacts/api-server && pnpm tsx scripts/verify-workroom-lifecycle.ts`
Result: 32 PASS / 0 FAIL / 0 UNPROVEN (verified 2026-08-10)

The script:
- Creates isolated test org/user/membership (auto-cleaned)
- Calls real service functions (taskService.createTask, conversationService.getOrCreateWorkroom, addMessage, postPlanToConversation)
- Verifies all DB state via SELECT queries
- Does NOT call autoCreateAndDispatch end-to-end (avoids triggering live execution pipeline for test org)
- Steps 5 (message isolation), 7 (task_created card structuredContent), 9 (idempotency), 10 (checkpoint resume) all verified via live DB reads

## Stale records in live DB (as of 2026-08-10, pre-migration)

5 stale `general_workforce` conversations with non-null `primaryTaskId`:

| Conversation | Task | Workroom exists? |
|---|---|---|
| `84c239a1` (org `e13f274d`) | Create Care Plan for Chase Summerfield | ✅ yes |
| `92f9e4d3` (org `98b132ec`) | Review Incident Management Policy | ✅ yes |
| `c90b36b0` (org `98b132ec`) | Incident Management Policy Review | ❌ **NO** — must create before migration |
| `96b7bcfe` (org `98b132ec`) | Incident Management Policy Review and Improvement Plan | ✅ yes |
| `d41845d7` (org `afe5d567`) | Review and Improve Complaints Management Policy | ✅ yes |

The verification script's Step 11 confirms `NEEDS WORKROOM CREATION` — the `c90b36b0` record has no workroom. Before running the migration, create one via `getOrCreateWorkroom()` for that task.

## Migration SQL

Run in a transaction AFTER deploying the code fix AND creating the missing workroom:

```sql
BEGIN;
-- Verify what will be cleared (should be 5 rows):
SELECT id, primary_task_id FROM conversations
WHERE  conversation_type = 'general_workforce'
  AND  primary_task_id IS NOT NULL;
-- Clear stale links:
UPDATE conversations
SET    primary_task_id = NULL, updated_at = NOW()
WHERE  conversation_type = 'general_workforce'
  AND  primary_task_id IS NOT NULL;
-- Expected: 5 rows affected
COMMIT;
```

Impact:
- Rows cleared: 5
- Messages deleted: 0 (historical plan/exec messages remain in general chat as read-only history)
- Workrooms deleted: 0
- Historical access: unaffected — workrooms are separate rows, "View Workroom" links still work

## The 9 pre-existing failing tests (unrelated to workroom fix)

**sprint-knowledge-ingestion.test.ts (4 failures):** pdf-parse v2.4.5 API mismatch. Old v1 function-call API; v2 is class-based ESM. See needsops-pdf-parse-v2.md. No files in common with workroom fix.

**sprint8-openclaw.test.ts (5 failures):** "not connected" assertions fail because OPENCLAW_RUNTIME_URL is now set as a real secret in the environment (added during Mac connector sprint). Tests expected the engine to return "not connected" when no URL is configured; it now finds a real URL. No files in common with workroom fix.

All 9 existed before commit c2ac345 and remain unchanged after it.
