---
name: NeedsOps Sprint 28.1 Organisation Library Presence Service
description: New lightweight library presence service — what it does, key design decisions, and test patterns
---

## What was built

`artifacts/api-server/src/services/organisationLibraryPresenceService.ts`

A fast (<100ms target), lightweight inspection service that answers:
- Does a document exist in the Organisation Library?
- Can specialists currently use it?

NOT semantic retrieval — no chunks, no embeddings. Pure DB title-match + status checks.

## Public API

```typescript
checkOrganisationLibraryPresence(organisationId, searchTerms) → LibraryPresenceResult
_clearPresenceCache()  // test helper
```

`LibraryPresenceResult.searched` is always `true`.  
`matches[]` is empty when nothing found — never null, never throws.

## Three-query pattern

1. `knowledge_sources` — ILIKE title match, filtered by org + `deletedAt IS NULL`
2. `knowledge_chunks` — sample up to 500 rows to determine which source IDs are indexed (have ≥1 chunk)
3. `knowledge_source_versions` — current version row (`isCurrent = true`) for `ingestionStatus`

When query 1 returns 0 rows, queries 2 and 3 are skipped (early return + cache).

## Computed fields

- `approved`: `status === "approved" && approvedByUserId !== null`
- `indexed`: source has ≥1 live chunk in `knowledge_chunks`
- `retrievable`: `approved && indexed && isCurrent === true`
- `ingestionStatus`: from `knowledge_source_versions.ingestionStatus` (pending/processing/complete/failed/null)

## Caching

In-process `Map` TTL cache — 30 seconds, keyed `${orgId}::${sortedTerms.join("|")}`.  
`wireSelectSequence` in tests calls `mockReset()` which resets selectFn call count — cross-reset call count assertions don't work; assert result content instead.

## Synonym expansion

`expandSearchTerms()` substitutes document-type words (policy ↔ procedure ↔ sop ↔ standard etc.) to broaden ILIKE queries without semantic search.

## Confidence scoring (scoreMatch)

| Score | Condition |
|---|---|
| 1.00 | Exact title match |
| 0.90 | Full phrase contained in title |
| 0.85 | All meaningful words found (any order) |
| 0.65 | ≥60% of words found |
| 0.45 | ≥30% of words found |
| 0.00 | Below MIN_CONFIDENCE (0.30) — discarded |

## Test baseline

3,247 passing (+24 new), 16 pre-existing failures unchanged.  
Test file: `artifacts/api-server/src/__tests__/sprint281-library-presence.test.ts` (24 tests)

## Key test-assertion gotcha

When `sources` query returns `[]`, the service skips chunk and version queries → only 1 DB call for that org, not 3. Don't assert 3 calls per org unconditionally.
