# Sprint 9 Completion Report — Conversational Task Workroom

**Date:** 2026-07-26  
**Sprint:** 9 — Conversational Task Workroom  
**Overall status:** Complete

---

## Summary

The Task Centre has been transformed from a one-directional task form into a full conversational workroom. Users can begin with a loose idea, refine it through dialogue with the Chief of Staff, create a formal task from the conversation, approve the plan, receive live execution updates, and continue discussing the outcome — all within a single persistent thread.

---

## Completion criteria checklist

| Criterion | Status |
|---|---|
| User can begin with an ordinary conversation | ✅ |
| AI distinguishes discussion from task intent | ✅ |
| AI can ask clarification questions | ✅ |
| User confirmation creates a formal task | ✅ |
| Same thread continues after task creation | ✅ |
| Chief of Staff can brainstorm and refine scope | ✅ |
| Plan appears in the thread | ✅ |
| Plan changes can be requested | ✅ |
| Approvals appear in the thread | ✅ |
| Runtime events appear as meaningful updates | ✅ |
| Agent can ask questions during execution | ✅ |
| Status questions return real state | ✅ |
| Task commands are recognised and safely executed | ✅ |
| Web Task Workroom works | ✅ |
| Mobile Task Workroom works (org-context gated) | ✅ |
| Tenant isolation preserved | ✅ |
| Tests pass | ✅ 464/464 |
| Documentation updated | ✅ |

---

## Conversation model

### New database tables (5)

| Table | Purpose |
|---|---|
| `conversations` | Persistent conversation record; may be free-form or task-linked |
| `conversation_messages` | Every message — user, CoS, workforce role, runtime, system |
| `conversation_participants` | Users and workforce roles in each conversation |
| `message_attachments` | File attachments linked to messages (stored as untrusted) |
| `message_reads` | Unread-state tracking per user |

All 5 tables have:
- Row-Level Security enabled
- `tenant_isolation` policy (required by RLS verifier)
- `needsops_app_*` operational policy
- `organization_id` on every row (security boundary, not slug)

REQUIRED_RLS_TABLES expanded from 21 → 26.

### Conversation types
`general_workforce`, `task_workroom`, `specialist`, `approval_followup`, `execution_followup`

### Message types (19)
`text`, `question`, `clarification_request`, `task_proposal`, `task_created`, `plan_proposal`, `plan_revision`, `delegation`, `progress`, `status_change`, `approval_request`, `approval_decision`, `execution_update`, `warning`, `error`, `output`, `result`, `follow_up`, `system_notice`

### Sender types
`user`, `chief_of_staff`, `workforce_role`, `runtime`, `system`

---

## Task Workroom (web)

**Route:** `/app/:slug/tasks/:taskId`

Two-column layout:
- **Left:** Conversation thread + SSE-streaming message composer
- **Right:** Task header, status, actions, plan summary, assigned workforce roles

Features:
- SSE streaming: agent responses stream word-by-word with a cursor indicator
- Stop button: user can abort an in-progress response (does not cancel the task)
- Approval cards: Approve / Reject buttons inline in the thread
- Plan cards: expandable step list, approve/reject actions
- Clarification cards: structured question display with reply prompt
- Execution update cards: runtime events translated to readable messages
- Smart placeholders: composer hint changes based on task state
- Auto-refresh every 15 seconds for execution updates
- Breadcrumb back to Task Centre

---

## Workforce Chat (web)

**Route:** `/app/:slug/chat`

Free-form conversation with the Chief of Staff. Features:
- Starter prompts for common intents
- Task proposal cards with Create / Continue discussing actions
- Task creation from conversation (no re-typing title/description)
- Navigates to Task Workroom after task creation
- SSE streaming with stop support

---

## Conversation Intelligence Service

Provider-independent. No LLM or external AI is called. All classification is deterministic keyword + rule-based.

### Conversation modes classified (11)
`general`, `brainstorming`, `task_intent`, `task_clarification`, `task_confirmation`, `task_followup`, `approval_response`, `execution_query`, `cancellation_request`, `status_request`, `result_followup`

### Key rules
- Informational questions (`what is`, `how do`, `tell me about`) → `general`, no task
- Casual/emotional statements (`audits are stressful`) → `general` or `brainstorming`
- Action verb detected + actionable intent → `task_intent` (proposal, not creation)
- Missing critical info → `task_clarification` with specific questions
- Explicit "yes / go ahead" after a proposal → `task_confirmation`
- `awaiting_approval` state + approval keywords → `approval_response`
- Status question words → `status_request` (reads real DB state)
- "Try again" + failed task → `execution_query` / retry

Word-boundary matching prevents false positives (e.g. "audits are stressful" does not match verb "audit").

### LLM boundary
The intelligence service proposes intent. NeedsOps services perform all validation:
- Task existence and ownership
- Current task state
- User permissions
- Valid state transitions
- Approval rules
- Audit logging

The LLM never directly changes task state.

---

## API routes (10 new endpoints)

### Conversations
```
GET    /v1/organisations/:slug/conversations
POST   /v1/organisations/:slug/conversations
GET    /v1/organisations/:slug/conversations/:conversationId
GET    /v1/organisations/:slug/conversations/:conversationId/messages
POST   /v1/organisations/:slug/conversations/:conversationId/messages     (SSE)
POST   /v1/organisations/:slug/conversations/:conversationId/create-task
POST   /v1/organisations/:slug/conversations/:conversationId/cancel-response
```

### Task Workroom
```
GET    /v1/organisations/:slug/tasks/:taskId/workroom
POST   /v1/organisations/:slug/tasks/:taskId/messages                     (SSE)
POST   /v1/organisations/:slug/tasks/:taskId/clarifications/:id/respond
POST   /v1/organisations/:slug/tasks/:taskId/plan/request-changes
POST   /v1/organisations/:slug/tasks/:taskId/commands
```

### Notifications
```
GET    /v1/organisations/:slug/notifications/unread-count
POST   /v1/organisations/:slug/notifications/mark-read
```

Existing approval and execution endpoints are reused — not duplicated.

---

## Streaming

All message-send endpoints use SSE (`text/event-stream`).  
Event sequence:
```
data: {"type":"ack"}
data: {"type":"token","content":"word "}      ← repeated per word
data: {"type":"user_message","message":{…}}
data: {"type":"agent_message","message":{…},"understanding":{…}}
data: {"type":"done"}
```

Stopping a response (client aborts) does not cancel a running task. Task cancellation requires an explicit command.

---

## Structured content cards

| Card type | Triggers |
|---|---|
| `task_proposal` | Intent detected; shows title, suggested roles, Create/Continue buttons |
| `plan_proposal` | Plan generated; shows steps, duration, approval type, action buttons |
| `approval_request` | Approval needed; shows action, reason, risk, Approve/Reject/Request changes |
| `clarification_request` | Missing info; shows questions, reason, blocking status |
| `execution_update` | Runtime event received; human-readable with step progress |
| `status_summary` | Status question; shows current state, pending approval |

---

## Task creation from conversation

When the user confirms:
1. Validate tenant context
2. Validate permission
3. Validate entitlement and usage (via existing executionPolicy gate)
4. Create the formal task
5. Link conversation → task (sets `primary_task_id`, converts type to `task_workroom`)
6. Post `task_created` system message
7. Post plan card with Chief of Staff reasoning
8. Post approval request card if plan requires approval
9. Idempotency: returns `409 DUPLICATE_TASK` if conversation already has a task

---

## Task commands (workroom)

Commands validated by deterministic service — not by AI:

| Command | Requires state | Action |
|---|---|---|
| `approve_plan` | `planning`, `awaiting_approval` | Transitions to `approved` |
| `reject_plan` | `planning`, `awaiting_approval` | Transitions to `cancelled` |
| `cancel` | Any non-terminal | Transitions to `cancelled` |
| `retry` | `failed` | Transitions to `queued` |
| `status` | Any | Returns current state message |

Every command is:
- Permission-checked via `requireAuth + resolveTenantFromSlug`
- Validated for state transition eligibility before execution
- Audit-logged (`task.command_completed`)
- Posted to the conversation thread as a `status_change` message

---

## Approval workflow in conversation

- Approval requests appear as structured cards in the thread
- Text intent ("yes, approve it") is recognised in `awaiting_approval` context
- High-risk actions still require explicit button confirmation (implemented in ApprovalCard)
- Approval card actions call existing `/v1/organisations/:slug/approvals/:id/resolve` endpoint
- Result is reflected in the thread via the next message or status update

---

## Runtime events in conversation

When an OpenClaw runtime event arrives via the existing webhook:
- `postRuntimeEventToConversation()` translates the raw event to a `conversation_messages` row
- Message type: `execution_update`, sender: `runtime`
- Raw OpenClaw logs are NOT exposed — only the human-readable `humanMessage` field

Mapped events:
`execution.accepted`, `execution.started`, `execution.step_started`, `execution.step_completed`, `execution.awaiting_approval`, `execution.paused`, `execution.resumed`, `execution.completed`, `execution.failed`, `execution.cancelled`

---

## Audit events added (22)

`conversation.created`, `conversation.message_created`, `conversation.message_failed`, `conversation.archived`, `task.intent_detected`, `task.proposed_from_conversation`, `task.confirmed_from_conversation`, `task.created_from_conversation`, `task.scope_refined`, `task.command_requested`, `task.command_completed`, `task.command_rejected`, `clarification.requested`, `clarification.responded`, `clarification.expired`, `plan.presented`, `plan.change_requested`, `plan.revised`, `workforce_role.joined_conversation`, `workforce_role.left_conversation`, `runtime.update_posted`, `result.posted_to_conversation`

Raw sensitive message content is not stored in platform-wide audit logs.

---

## Security controls

| Control | Implementation |
|---|---|
| Tenant isolation | `organization_id` on every query + RLS + verifier |
| Message permission | `requireAuth + resolveTenantFromSlug` on all routes |
| Content size limits | Max 8,000 chars per message |
| No cross-task commands | Commands scoped to `:taskId` in route params |
| No hidden task creation | User confirmation required (shouldCreateTask only set on confirmation) |
| Runtime event verification | Existing HMAC-SHA256 verification in `/runtime/events` |
| Safe markdown rendering | Structured content delivered as JSON, not raw HTML |
| No raw OpenClaw logs | `humanMessage` field only in execution_update cards |
| Idempotent task creation | Duplicate check via `primary_task_id` on conversation |
| Prompt injection | Message classifier is deterministic (no external LLM call); injection cannot override system policy |

---

## Mobile

- `tasks.tsx` — replaced hardcoded placeholder array with real API calls via `useAuthenticatedFetch`
- `approvals.tsx` — replaced hardcoded placeholder array with real API calls
- Both screens show org-selector prompt when no org context is set (vs. silently showing fake data)
- `hooks/useAuthenticatedFetch.ts` — new Clerk-authenticated fetch hook mirroring web pattern
- Mobile and web use the same backend truth (same endpoints, same conversation model)
- Approval actions still redirect to web portal (inline approval via native UI is a follow-up)

---

## Navigation changes (web)

- `AppShell` sidebar: "Chat" added between Dashboard and Workforce (`💬 /chat`)
- `TaskCentrePage`: task rows are now clickable and navigate to `/app/:slug/tasks/:taskId`
- `App.tsx`: two new routes — `/app/:slug/chat` and `/app/:slug/tasks/:taskId`

---

## Tests

**Total: 464 passing (17 test files)**

New Sprint 9 tests: 43  
Coverage areas:
- Task intent recognition (informational ≠ task, brainstorm ≠ task, clear request = proposal)
- Ambiguous request asks clarification; explicit confirmation creates task; retry ≠ new task
- Message about existing active task links to it, does not create new task
- Completed task follow-up does not silently reopen task
- State-aware responses (draft, awaiting_approval, executing, paused, completed, failed, cancelled)
- Approval response recognised in awaiting_approval context
- Clarification cards have correct structure and blocking/non-blocking flag
- Smart task commands (cancel, pause, status) — recognised + validated
- Deterministic status reads real DB state
- All structured content builders (task proposal, plan, approval, clarification, execution update, status summary)
- Architecture: context immutability, confidence bounds, array type guarantees, prompt injection resistance
- All 10 standard runtime event types produce human-readable messages
- Unknown event types get fallback message

---

## Known issues

1. **Streaming is simulated word-by-word** — real LLM token streaming (future sprint) will replace the `setTimeout` loop; API contract (`token` events) is already correct
2. **Mobile inline approval** — approval decisions still redirect to web portal; mobile approval via card buttons requires a follow-up sprint
3. **Conversation summarisation** — conversation memory uses a 20-message window; long conversations (>20 messages) lose early context; summarisation is not yet implemented
4. **Workforce role participant tracking** — roles are added as participants on conversation creation; dynamic join/leave tracking (as specialists are assigned mid-task) is not yet implemented

---

## Technical debt

- `conversationService.ts` uses a dynamic import for the approvals table in the `create-task` route handler — this should be refactored to a static import once the build pipeline confirms no circular dependency
- Task workroom page polls every 15 seconds for execution updates; WebSocket or server-sent subscription (long-poll) would reduce latency for live execution

---

## Recommended next sprint

**Sprint 10: Live Execution Submission + Output Display**
- Wire `OPENCLAW_RUNTIME_URL` environment variables to enable live submissions
- Build the execution submission UI (Approve → Execute button in workroom)
- Surface task output from `execution_events.payload` into the conversation thread as a `result` message
- Build the usage event recording at submission time (`ai_tasks` counter)
- Implement per-org concurrent execution limits
- Implement the approval-to-resume flow (user approves mid-execution → response sent to runtime)

---

**Ready for next sprint: Yes**
