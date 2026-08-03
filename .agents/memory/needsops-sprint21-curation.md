---
name: NeedsOps Sprint 21 Knowledge Curation
description: Chief of Staff as Knowledge Curator — curation jobs, memory proposals, org personality, conversation learning, health dashboard, version intelligence.
---

## Architecture

### New table
- `knowledge_curation_jobs` — one job per document lifecycle event; REQUIRED_RLS_TABLES = 61
- Migration: `lib/db/migrations/sprint21-knowledge-curation.sql` (applied directly; drizzle-kit push requires TTY)

### New services (artifacts/api-server/src/services/)
- `knowledgeCurationService.ts` — core engine; reads chunks from `knowledge_chunks` table; calls AI gateway; creates `organisation_memory` proposals; includes `computeKnowledgeConfidence()` confidence engine
- `conversationLearningService.ts` — fire-and-forget pattern-matching engine; detects terminology/approval/policy patterns in user messages; 24h dedup check
- `knowledgeHealthService.ts` — queries 10 data sources; returns health score 0–100

### New routes
- `artifacts/api-server/src/routes/v1/curation.ts` — 6 endpoints (proposals CRUD, health, version-intelligence, curation jobs)
- Registered in v1/index.ts: `router.use("/", curationRouter)`

### Modified services
- `knowledgeSourceService.ts` — fire-and-forget curation triggers after approve/revoke/supersede (calls `getCurrentVersion` then `enqueueCurationJobAsync`)
- `ingestionPipelineService.ts` — curation trigger after ingestion completes (triggerEvent: "uploaded", actorUserId: "system")
- `conversationService.ts` — conversation learning hook fire-and-forget after agentMessage stored; imports `detectAndProposeConversationKnowledge`
- `chiefOfStaffLLMService.ts` — two enhancements:
  1. `buildLayeredUserMessage`: new `=== ORGANISATIONAL PERSONALITY ===` section from terminology/operating_preference/approval_rule memories
  2. System instructions: `## KNOWLEDGE SOURCE TRANSPARENCY` section (cite org knowledge vs general best practice)

## Key design decisions

**Why:** All proposals require human approval before entering AI context — governance is non-negotiable.

**computeKnowledgeConfidence short-circuit:** `rejected` status always returns 0 regardless of authority/freshness (authority and freshness are irrelevant for rejected knowledge). **How to apply:** Always check return early for rejected status.

**Curation job trigger flow:** ingestion → curation (uploaded); approve → curation (approved); revoke → curation (archived); supersede → version intelligence (superseded) on new source. All are fire-and-forget.

**Chunk limit:** 30 chunks per curation job (token budget). Rule-based fallback when AI_PROVIDER ≠ "openai".

**Test mock pattern:** Use `createChain(result)` helper that returns a fully thenable select chain handling `.where()`, `.where().limit()`, `.where().orderBy().limit()`, `.where().groupBy()` all as terminal awaitable — replaces the per-method mock approach.

## REQUIRED_RLS_TABLES count history
- Task #15: 59 → 60 (6 knowledge tables)
- Task #16: 60 → 61 ingestion_jobs (WAIT — ingestion_jobs was +1, so 59→60 was Task #15)
- Actually: Sprint 21 = 60 → 61 (+1 knowledge_curation_jobs)
- Current: 61
