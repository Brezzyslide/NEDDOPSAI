---
name: NeedsOps Sprint 29N.5 KRS Semantic Retrieval
description: KRS hybrid retrieval activation, evidenceSufficiencyService, escalation boundary for OpenClaw
---

## What was done
- Activated hybrid lexical+semantic retrieval in KRS: `generateQueryEmbedding()` added to `knowledgeResolutionService.ts`, wired into all 4 `retrieveChunks` call sites (previously `queryEmbedding: null`)
- `EvidencePackMetrics` gained `embeddingUsed: boolean` and `embeddingMs: number` fields
- Retrieval audit `retrievalMethod` now records "hybrid" or "lexical" depending on whether embedding was used
- Created `evidenceSufficiencyService.ts` — Evidence Sufficiency Gate

## Critical lessons

**@workspace/ai-gateway mock must include isOpenAIConfigured**
Any test that mocks `@workspace/ai-gateway` AND indirectly calls `knowledgeResolutionService.ts` must add `isOpenAIConfigured: vi.fn().mockReturnValue(false)` (plus `callOpenAIEmbeddings` and `getEmbeddingDimensions`) to the mock. Returning false causes `generateQueryEmbedding` to return `null` (lexical-only fallback) — safe for unit tests.

**Why:** `generateQueryEmbedding` calls `_embeddingProvider.isActive()` which calls `isOpenAIConfigured()` from the gateway. If the mock omits it, vitest throws a "No export is defined" error.

**absenceVerificationService stays lexical-only**
The absence verification path deliberately keeps `queryEmbedding: null` for its targeted re-retrieval calls. Reason: absence check makes multiple per-term queries; adding embedding generation per term multiplies API cost without proportional benefit. The stored snapshot text is used for accepted evidence anyway.

**evidenceSufficiencyService design**
- 6 possible statuses: SUFFICIENT, INSUFFICIENT_COVERAGE, UNRESOLVED_REFERENCE, EXTERNAL_AUTHORITY_REQUIRED, SOURCE_NOT_AVAILABLE, LOW_CONFIDENCE, AUTHORITY_GAP
- AUTHORITY_GAP does NOT trigger OpenClaw (governance issue, not discovery gap)
- `isPackSufficient()` returns true for both SUFFICIENT and AUTHORITY_GAP
- Cross-reference regex uses `i` flag (case-insensitive for verbs) but validates captured title starts with uppercase `[A-Z]` — prevents "see the procedure" (lowercase) from matching
- MIN_CHUNKS_ADEQUATE = 2, LOW_CONFIDENCE_THRESHOLD = 0.15

**Architecture verdict**
KRS SUFFICIENT AS PRIMARY RETRIEVER — OPENCLAW ESCALATION STILL REQUIRED
- Hybrid KRS handles synonym/semantic queries (eliminates one planned OpenClaw use case)
- OpenClaw uniquely needed for: (1) multi-hop cross-reference traversal, (2) external regulatory sources

## Test count impact
69 new tests added: sprint29n5-evidence-sufficiency (30), sprint29n5-governance-regression (21), sprint29n5-controlled-corpus (18).
Fixed regression in sprint273-knowledge-resolution.test.ts (missing ai-gateway mock fields).
