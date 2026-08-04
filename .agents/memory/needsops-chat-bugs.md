---
name: NeedsOps Chat Interface Bugs
description: Bugs found and fixed in the Workforce Chat (WorkforceChatPage + conversationService)
---

## Bugs fixed (2026-08-04)

### 1. Always-create conversation (root cause of blank chat)
`POST /conversations` was creating a new conversation on every page load. Messages from SSE were getting wiped when Clerk's auth state settled (undefined → true), causing the useEffect to re-run and create a new empty conversation.

**Fix:** `findOrCreateGeneralConversation` added to conversationService — for `general_workforce` type without a primaryTaskId, returns existing active conversation instead of creating new.

### 2. NULLS LAST ordering in findOrCreate
The query `ORDER BY last_message_at DESC` puts NULL first in PostgreSQL. Empty conversations (no messages → NULL last_message_at) were always returned first, showing blank chat even when history existed.

**Fix:** Changed to `ORDER BY last_message_at DESC NULLS LAST, created_at DESC`.

### 3. `userText` undefined reference (conversationService ~line 574)
Function parameter is `text` but `detectAndProposeConversationKnowledge` was called with `userText` (undefined). Caused a synchronous ReferenceError before `.catch()` could intercept — could crash the message route.

**Fix:** Changed `userText` → `text`.

### 4. SSE `error` events silently ignored (frontend)
If the server emitted `{type:"error", message:"..."}`, the frontend while loop just skipped the event with no UI feedback. User saw nothing and input remained blocked.

**Fix:** Added `else if (evt.type === "error")` branch → calls `setError()` and clears `setStreamingText("")`.

### 5. No `res.ok` check before reading SSE body
4xx/5xx responses would flow into `res.body!.getReader()` and produce garbled or empty stream output instead of a clear error message.

**Fix:** Added `if (!res.ok)` guard — reads JSON error body and sets `setError()` before reader is opened.

## Architecture notes

- SSE is simulated word-level streaming (LLM finishes first, then words are drip-fed) — not true incremental token streaming. Latency is dominated by OpenAI call (~5-8s).
- `AI_PROVIDER=openai` env var required for real AI; defaults to deterministic keyword classifier.
- Structured content types beyond task_proposal (clarification, status, capability) are reduced to plain text in the UI — only `task_proposal` renders a card.
- No SSE heartbeat — if the OpenAI call exceeds proxy timeout, client hangs silently (Task #32 covers this).
