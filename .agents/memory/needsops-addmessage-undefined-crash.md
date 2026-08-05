---
name: NeedsOps addMessage undefined crash
description: Root cause and fix for "Cannot read properties of undefined (reading 'id')" crash introduced by Sprint 27.2 idempotent SSE handler.
---

## Rule
`addMessage` (conversationService.ts) must throw, never return undefined, when the DB INSERT RETURNING yields no rows.

## Root Cause
TypeScript's `!` non-null assertion is compile-time only. `return msg!` where `msg = undefined` (from an empty RETURNING array) silently returns `undefined` at runtime despite the function signature `Promise<ConversationMessage>`.

## Crash Chain
1. `addMessage` → `const [msg] = await db.insert(...).returning()` yields `[]` → `msg = undefined` → `return msg!` → `undefined`
2. `processUserMessage` → `agentMessage = undefined` (not null — JSON.stringify omits undefined keys)
3. Route sends `{ type: "agent_message" }` with NO `message` key
4. Client: `evt.message === undefined`
5. Sprint 27.2 idempotent handler: `const msg = evt.message as Message; msg.id` → **TypeError: Cannot read properties of undefined (reading 'id')**

**Why Sprint 27.2 made it visible:** Before: old handler appended `undefined` to messages array; crash was deferred to React render (different error). After: `msg.id` is checked immediately → same undefined, earlier throw.

## When INSERT RETURNING yields 0 rows without throwing
- PostgreSQL RLS `WITH CHECK` policy can silently drop an INSERT on some connection configurations, returning `[]` from RETURNING instead of raising an error.
- ON CONFLICT DO NOTHING (not present here, but possible in future additions).

## Fix Applied
1. **`conversationService.ts` `addMessage`**: Replace `return msg!` with an explicit throw when `!msg`, surfacing as a proper error that bubbles through `messageIngressService`'s catch → `{ type: "error" }` SSE event.
2. **Routes (`conversations.ts`, `taskWorkroom.ts`)**: Coerce `result.agentMessage ?? null` (never undefined) before sending `agent_message` SSE event — ensures JSON always includes the key.
3. **Frontend handlers (`TaskWorkroomPage.tsx`, `WorkforceChatPage.tsx`)**: Explicit null/undefined guard before accessing `msg.id` — belt-and-suspenders, not optional chaining. Comment explains this is contract enforcement.

## How to Apply
- Any function that does `const [row] = await db.insert(...).returning()` must check `if (!row) throw new Error(...)` before using `row`. Never rely on `!` assertion on a Drizzle RETURNING result.
- SSE routes: always use `value ?? null` (not `value`) for nullable fields sent over the wire — `undefined` causes JSON to omit the key, which the client cannot distinguish from a missing field.

**Why:** Drizzle RETURNING types claim non-undefined results but do not account for RLS-driven silent drops. Runtime is not TypeScript.

## Test Count
3062 passing (up from 3053), 16 pre-existing failures unchanged. 9 new regression tests in `src/__tests__/regression-undefined-agent-message.test.ts`.
