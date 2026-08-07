---
name: NeedsOps Sprint 122-123 Completed Work Lifecycle
description: submitForApproval wiring, postCompletedWorkCreatedToConversation signature change, and the vi.mock path alias gotcha
---

## Rule: submitForApproval must be called explicitly after createDraft

`submitForApproval()` from `completedWorkService` is NOT called automatically by
`createDraft()`. The execution engine must call it explicitly after `createDraft()`
succeeds.

**Why:** The functions are intentionally separate — createDraft stores the record,
submitForApproval transitions the lifecycle state. Before this sprint, `executeTask`
called only `createDraft`, leaving all completed work stuck at `status="draft"` and
always showing in Active Work under "In Progress" instead of "Awaiting Approval".

**How to apply:** In `unifiedExecutionEngine.ts`, after `createDraft(...)`:
```ts
const requiresApproval = outputRequiresApproval !== false;
let finalWork = completedWork;
if (requiresApproval) {
  try {
    finalWork = await submitForApproval(completedWork.id, organizationId, requesterId);
  } catch {
    // preserve draft — finalWork remains completedWork
    logger.warn("submitForApproval failed — preserving draft");
  }
}
```
Return `completedWorkStatus: finalWork.status` and `completedWorkTitle: finalWork.title`
so the coordinator can use actual values, not derived/hardcoded ones.

---

## Rule: postCompletedWorkCreatedToConversation has 8 parameters (not 7)

Signature after Sprint 122-123 fix:
```
postCompletedWorkCreatedToConversation(
  orgId, convId, taskId, workId, title, completedWorkStatus, qualityScore, correlationId
)
```
`completedWorkStatus` is the 6th argument. Any test that calls `mockPostCompleted`
with 7 args (the old pre-fix shape) will fail with "called with unexpected args".

**Why:** The status must be threaded through to produce honest message text
(e.g. "saved as a draft" vs "ready for your approval").

**How to apply:** Update any test expectation:
```ts
// OLD (pre-fix)
expect(mockPostCompleted).toHaveBeenCalledWith(ORG, CONV, TASK, workId, title, 90, corrId);
// NEW (post-fix)
expect(mockPostCompleted).toHaveBeenCalledWith(ORG, CONV, TASK, workId, title, "draft", 90, corrId);
```
The status defaults to `result.completedWorkStatus ?? "draft"` in the coordinator,
so a mock that omits `completedWorkStatus` yields `"draft"` as the 6th arg.

---

## Test strategy: avoid end-to-end engine tests for pipeline changes

`createUnifiedExecutionEngine()` has 15+ internal dependencies (AI gateway,
ResourceRegistry, ExecutionSession, blueprint selector, validators, etc.) that
must all be mocked for the engine to reach the createDraft step. Instead:

1. **Simulation tests** — reproduce the specific code block under test verbatim as
   a function that calls the mocked service functions directly. No pipeline needed.
2. **Source contract tests** — `readFileSync` the TS source and assert patterns
   (import names, call sites, interface fields). Catches regressions without mocking.
3. **Signature tests** — import the function and check `.length` for arity changes.

Sprint29c uses `vi.mock("../lib/ai-gateway/index.js", ...)` not
`vi.mock("@workspace/ai-gateway", ...)` — the workspace alias resolves differently
in tests than it does in production, causing silent mock misses if you use the alias.

---

## Pre-existing failures (do not investigate)

- `sprint29f1-real-connector-acceptance.test.ts` — requires live `REAL_CONNECTOR_URL`
- `sprint285-conversation-context-builder.test.ts` — 14 tests, pre-existing shape mismatch in `ConversationContext.runtime.*` and `executionCapabilities.*`
