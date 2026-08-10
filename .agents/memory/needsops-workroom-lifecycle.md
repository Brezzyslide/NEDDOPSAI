---
name: NeedsOps General Workforce / Task Workroom Lifecycle
description: Architecture rule — general_workforce conversations must never acquire primaryTaskId; all execution-scoped messages belong in a dedicated task_workroom
---

## Architecture invariant

```
GENERAL WORKFORCE CHAT (reusable front desk)
  conversationType = general_workforce
  primaryTaskId    = NULL  (always — must never be mutated)
      |
      | creates Task A           creates Task B (later)
      v                          v
TASK A WORKROOM              TASK B WORKROOM
  conversationType = task_workroom  conversationType = task_workroom
  primaryTaskId    = taskA.id       primaryTaskId    = taskB.id
```

## What must NOT happen

- `linkConversationToTask()` must never be called with a `general_workforce` conversation.
  The safety guard in `conversationService.ts` will block and warn, but the primary
  enforcement is in the call sites (autoDispatchService, conversations route).
- The message route must not inherit `conv.primaryTaskId` for general_workforce
  conversations — this causes stale task bleed into unrelated messages.
- The auto-dispatch guard must use conversation type, not `conv.primaryTaskId`.

## Message routing rules

| Message type | Destination |
|---|---|
| `task_created` card | Original (general_workforce) conversation |
| Plan card | Task workroom |
| Approval request card | Task workroom |
| Execution dispatch | Task workroom (`conversationId`) |
| Clarification / checkpoint resume | Stays in whichever conversation initiated it |

## resolvedTaskId resolution (conversations.ts message route)

```typescript
const resolvedTaskId =
  taskId ??
  (conv.conversationType === "task_workroom" ? conv.primaryTaskId ?? undefined : undefined);
```

- `task_workroom`: inherits `primaryTaskId` (required for clarification/resume)
- `general_workforce`: never inherits (undefined regardless of stale DB state)

## Auto-dispatch guard (conversations.ts message route)

```typescript
// OLD (broken): !conv.primaryTaskId
// NEW (correct):
conv.conversationType !== "task_workroom"
```

- `general_workforce` may create unlimited independent tasks — never gated
- `task_workroom` is already bound to a task; rerun/revise is the correct path

## Rerun/revise workroom resolution

```typescript
const rerunConvId =
  conv.conversationType === "task_workroom"
    ? conv.id
    : (await conversationService.getOrCreateWorkroom(ctx.tenantId, ad.taskId!, user.id)).id;
```

## Create-task route (POST /:conversationId/create-task)

- 409 only for `task_workroom` with existing `primaryTaskId`
- For `general_workforce`: never rejected on `primaryTaskId` grounds
- No `linkConversationToTask` call — use `getOrCreateWorkroom` instead
- Response includes `workroomConversationId` for frontend deep-link

## AutoDispatchResult shape

```typescript
{
  taskId:                 string;  // newly created task
  title:                  string;
  conversationId:         string;  // ORIGINAL general conversation (for SSE routing back)
  workroomConversationId: string;  // dedicated task_workroom (for deep-link / execution routing)
  dispatched:             boolean;
  requiresApproval:       boolean;
  approvalId?:            string;
}
```

## Migration for stale production data

Any `general_workforce` conversation that has a non-null `primaryTaskId` from before
this fix was deployed needs to be cleaned up:

```sql
-- Step 1: identify stale links
SELECT id, primary_task_id
FROM conversations
WHERE conversation_type = 'general_workforce'
  AND primary_task_id IS NOT NULL;

-- Step 2: ensure a task_workroom exists for each orphaned link
-- (getOrCreateWorkroom handles this automatically on next dispatch — no manual SQL needed)

-- Step 3: clear the stale primaryTaskId
UPDATE conversations
SET primary_task_id = NULL,
    updated_at = NOW()
WHERE conversation_type = 'general_workforce'
  AND primary_task_id IS NOT NULL;
```

Run against dev first. The `linkConversationToTask` safety guard will log a warning if
any old call site accidentally fires before the migration, making it visible in logs.

## Known stale record (2026-08-10)

```
conversation 84c239a1-17b4-4607-96ab-ba75cd92686d
  conversation_type = general_workforce
  primary_task_id   = 365dc0d1-c3b9-47af-b30e-1faa763e6477  (Care Plan for Chase Summerfield)
```

This is the record that triggered the investigation. Run the migration SQL above on prod
after the code fix is deployed to clear it.

## Test files

- `sprint27-auto-dispatch.test.ts` — 14 tests, updated for workroom routing
- `sprint29-workroom-lifecycle.test.ts` — 17 new lifecycle tests
