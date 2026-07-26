---
name: NeedsOps Sprint 9 Conversational Task Workroom
description: Schema, service, and route decisions for the Sprint 9 Conversational Task Workroom feature
---

## Key decisions

### Database schema
- 5 new tables: `conversations`, `conversation_messages`, `conversation_participants`, `message_attachments`, `message_reads`
- All 5 have `organization_id` on every row, RLS enabled, `tenant_isolation` + `needsops_app_*` policies
- PostgreSQL does NOT support `CREATE TYPE IF NOT EXISTS` — use `DO $$ BEGIN CREATE TYPE ...; EXCEPTION WHEN duplicate_object THEN NULL; END $$;` pattern
- REQUIRED_RLS_TABLES is now 26 (was 21 Sprint 7, 23 Sprint 8); sprint7-rls-safety.test.ts hardcodes this count — update it when tables are added

### Conversation intelligence service
- Rule-based classifier (no LLM), deterministic, `classifyMessage(text, ctx) → ConversationUnderstanding`
- `hasActionVerb()` uses word-boundary regex (`/\bverb\b/i`), NOT `.includes()` — prevents "audits are stressful" matching verb "audit"
- STATUS_PATTERNS must cover "why is", "did it complete?", "what happened" patterns — these are easily missed as status questions
- RETRY_PATTERNS handle "try again" + failed task → `execution_query` / `resume`; not matched by RESUME_PATTERNS (which require active state)
- General path always carries forward `existingTaskId: ctx.currentTaskId` when task context is present
- "add", "remove", "assign", "modify" are ACTION_VERBS (in addition to the original list)

### SSE streaming
- All message-send endpoints stream via `text/event-stream`
- Event types in order: `ack` → repeated `token` → `user_message` → `agent_message` → `done`
- Abort does NOT cancel the running task; task cancellation requires an explicit `commands` POST

### Task workroom flow
- `getOrCreateWorkroom(orgId, taskId)` is idempotent — safe to call on every page load
- Task creation from conversation: checks `primary_task_id` for idempotency, returns `409 DUPLICATE_TASK` if already exists
- Plan and approval cards are posted to the conversation thread immediately after task creation

### Mobile
- `hooks/useAuthenticatedFetch.ts` mirrors web `useAuthFetch` using `@clerk/expo` `getToken()`
- Org slug is read from `(global as any).__needsops_org_slug` — set by the organisations screen selection
- Mobile tasks and approvals screens show a prompt when no org is selected (rather than placeholder data)
- Approval actions from mobile redirect to web portal — inline mobile approval is a follow-up

**Why:** The sprint spec required conversation-first UX without replacing the governed task record. The classifier is deterministic so behaviour is predictable and testable without LLM costs or latency.
