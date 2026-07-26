---
name: NeedsOps Sprint 9.2 Tenant-Aware CoS Memory
description: Memory tables in platform DB, context package architecture, service patterns, and remaining work for 9.3
---

## Memory Table Location
`organisation_memory` and `conversation_memory` are PLATFORM DB tables (public schema), not per-org schemas.
They have an `organization_id` FK column + RLS policies — same pattern as `conversations` and `conversation_messages`.
Accessed via `db` from `@workspace/db` with `eq(table.organizationId, organizationId)` filtering.

**Why:** Platform DB simplifies schema management. Per-org schemas would require every org migration to add these tables. The conversations tables (Sprint 9) already established this pattern.

## Schema Files
- `lib/db/src/schema/organisationMemory.ts` — `organisationMemoryTable`
- `lib/db/src/schema/conversationMemory.ts` — `conversationMemoryTable`
- Both exported from `lib/db/src/schema/index.ts`
- Migration: `lib/db/migrations/sprint92-memory-tables.sql` (applied — tables exist in DB)

## REQUIRED_RLS_TABLES: 28
Added `organisation_memory` and `conversation_memory` — verifier now logs `tablesChecked: 28`.

## Context Package Architecture
`buildChiefOfStaffContext()` in `contextSelectionService.ts`:
- Fetches up to `AI_MAX_HISTORY_MESSAGES` (default 300) messages + org memory + conv memory + tasks + approvals
- All DB reads run in parallel (Promise.all)
- Returns `ChiefOfStaffContextPackage` with 10 context sections
- Deterministic relevance scoring for historical messages (keyword + task + pinned decision matching)
- Token budget enforcement (default 6000 tokens)

## Prompt Layer Order (10 sections)
SYSTEM INSTRUCTIONS → TENANT PROFILE → APPROVED ORG MEMORY → CONVERSATION SUMMARY →
PINNED DECISIONS → UNRESOLVED QUESTIONS → CONTEXT WARNINGS → CURRENT TASK STATE →
RELEVANT HISTORICAL MESSAGES (UNTRUSTED) → RECENT MESSAGES (UNTRUSTED) → CURRENT MESSAGE (UNTRUSTED)

## Services Pattern
All three memory services (`contextSelectionService`, `conversationMemoryService`, `organisationMemoryService`)
use `db` from `@workspace/db` directly. Do NOT use `withOrgContext` for these — withOrgContext is for per-org schema access.

## Env Vars
- `AI_MAX_HISTORY_MESSAGES` (default 300) — max messages fetched per context build
- `AI_RECENT_HISTORY_MESSAGES` (default 30) — messages always in recent window
- `AI_CONTEXT_TOKEN_BUDGET` (default 6000) — token budget for full context package
- `AI_MEMORY_SUMMARY_THRESHOLD` (default 40) — message count triggering summarisation

## Memory Lifecycle
organisation_memory: proposed → approved → superseded/rejected/expired
Only `approved` entries enter AI context. `shouldCreateTask` always forced `false`.

## Test Pattern for Mock DB
Sprint 9.2 tests use `vi.mock("@workspace/db", async (importOriginal) => ({ ...actual, db: mockDb }))`.
Must spread actual exports so table objects are real (Drizzle symbols work).
`from()` uses `Symbol.for("drizzle:Name")` to identify tables in the mock chain.

## What Sprint 9.3 Needs
- Background summarisation trigger in SSE handler (hook after delivering response)
- TaskWorkroomPage memory panel (expandable, shows summary/pins/questions, pin button on bubbles)
- Auto-propose memory from conversation (CoS proposes, admin approves)
- Vector similarity for historical message retrieval
- AppShell Memory nav only visible to org admins (currently always visible)
