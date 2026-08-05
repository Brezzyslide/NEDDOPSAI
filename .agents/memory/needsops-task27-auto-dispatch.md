---
name: NeedsOps Task #27 CoS Auto-Dispatch
description: autoCreateAndDispatch service wires CoS high-confidence intent detection to automatic task creation and execution dispatch without user clicking "Create Task".
---

## Rule
When `shouldCreateTask=true` AND `confidence >= 0.85` AND `conv.primaryTaskId` is null, the message handler in `conversations.ts` calls `autoCreateAndDispatch` before emitting the `done` SSE event.

**Why:** Previously the CoS only hinted the UI with `understanding.shouldCreateTask`; the user had to manually click "Create Task". Task #27 closes this gap so high-confidence intent immediately creates the task and fires execution.

## How to apply
- Threshold is `AUTO_EXECUTE_CONFIDENCE_THRESHOLD = 0.85` exported from `autoDispatchService.ts`.
- Auto-dispatch fires between `agent_message` and `done` SSE events — do NOT move it after `res.end()`.
- The service is idempotent: it checks `conv.primaryTaskId`; if already set, the route skips auto-dispatch.
- `task_auto_created` SSE event carries `{ taskId, title, conversationId, dispatched, requiresApproval, approvalId? }`.
- Frontend (`WorkforceChatPage`) stores this in `autoCreatedTask` state and renders a dismissable notification card.
- The manual `POST /:conversationId/create-task` route is unchanged for lower-confidence cases.
- Errors from auto-dispatch are caught and logged as non-fatal — the agent response was already delivered.

## Test count
3053 passing (14 new in `sprint27-auto-dispatch.test.ts`), 16 pre-existing failures unchanged.

## Key files
- `artifacts/api-server/src/services/autoDispatchService.ts` — service
- `artifacts/api-server/src/routes/v1/conversations.ts` — wiring (search "Task #27")
- `artifacts/needsops-web/src/pages/app/WorkforceChatPage.tsx` — `task_auto_created` handler + card
- `artifacts/api-server/src/__tests__/sprint27-auto-dispatch.test.ts` — 14 tests
