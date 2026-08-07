---
name: NeedsOps Sprint 29G.1 Document Identity
description: Multi-signal document presence resolution — canonical_title, aliases, type-fallback, approval fix
---

## Core Fix

The MH&R live failure ("could not locate Incident Management Policy") had ONE root cause:
the `knowledge_sources.title` field was a machine filename (`MH&R_Policy_current_2026`)
with zero lexical overlap to the natural-language query "Incident Management Policy".

Sprint 29G (stop-word fix, sub-phrases) was correct but insufficient alone.
Sprint 29G.1 adds structural document identity so queries find documents by WHAT they ARE.

## Schema Changes

Added to `knowledge_sources`:
- `canonical_title TEXT` — human-readable title derived at ingestion time
- `search_aliases JSONB` — array of alternative search names (type synonyms, cleaned filename variants)

SQL migration applied (both columns exist in DB).

## New Package: documentIdentityService.ts

Five exports used by presence service, ingestion pipeline, and tests:
- `cleanFilenameTitle()` — strips underscores, year, version tags
- `isFilenameLike()` — detects machine-style filenames
- `deriveCanonicalTitle()` — priority-ordered (explicit title → chunks → filename)
- `extractCanonicalTitleFromChunks()` — finds `__HEADING__` / `# heading` patterns in first 5 chunks
- `isSourceEligible()` — shared retrieval predicate (status=approved + isCurrent=true + !deletedAt)
- `scoreMultiSignal()` — scores source across canonical_title, aliases, title, originalFileName
- `deriveSearchAliases()` — type-synonym expansion for aliases
- `extractTypeWordsFromTerms()` — extracts policy/procedure/manual/etc from search terms

**toTitleCase gotchas:**
- Preserve `X&Y` identifiers (MH&R): `/^[A-Z][A-Z&]+[A-Z]$/` + `includes("&")`
- Preserve short acronyms (2-4 chars, not in SKIP_WORDS): `SOP`, `QA`, `HR`, `NDIS`
- Capped at 4 chars — longer all-caps words (POLICY, MANUAL) get title-cased

**Bold-pattern org-identifier exclusion:**
`/ABN|ACN|T\/A|PTY\s+LTD|HOLDINGS|INCORPORATED|INC\.|[0-9]{6,}/i`

## Presence Service Changes (organisationLibraryPresenceService.ts)

### approved vs retrievable separation (critical)
- `approved = src.status === "approved"` (pure approval status, no isCurrent requirement)
- `retrievable = isSourceEligible(…) && indexed` (full eligibility = approved+isCurrent+!deleted AND indexed)
- This matches KRS which checks status+isCurrent, not approvedByUserId

### New PresenceState type
`"found" | "possible_match" | "not_found" | "not_ready"` — added to LibraryPresenceSummary

### Multi-signal ILIKE query
Searches: `title`, `canonical_title`, `original_file_name` (via SQL ILIKE)
Post-query scoring via `scoreMultiSignal()` also checks aliases

### Type-fallback (POSSIBLE_MATCH)
When direct ILIKE returns 0 candidates:
1. Extract type words from search terms (policy/procedure/manual/etc)
2. Map to source_type values (policy → ["policy"], sop → ["procedure","policy"], etc.)
3. Query approved+isCurrent+library sources of those types
4. Return as `possibleMatches` with `confidence=0.20, matchedSignal="type_only"`
→ This is how MH&R_Policy_current_2026 surfaces for "Incident Management Policy" query

### New LibraryPresenceResult fields
- `possibleMatches: LibraryPresenceMatch[]` — type-fallback candidates
- `LibraryPresenceMatch.canonicalTitle` — canonical title
- `LibraryPresenceMatch.matchedSignal` — which field produced the best score
- `LibraryPresenceMatch.isTypeFallback` — true for type-fallback entries

### Reason strings (critical — tests check regexes)
- approved but not indexed: `"approved but ingestion pending"` → matches `/ingestion pending/i`
- not approved + not indexed (uploaded): `"pending ingestion (status: uploaded)"` → matches `/pending ingestion/i`
- isCurrent=false: `"not currently usable (status: superseded)"` (no regex test)

### Cache count change
Type-fallback adds 1 extra DB query when direct sources = empty:
- 3 queries per org with direct match (sources + chunks + versions)
- 2 queries per org with no direct match (sources empty → type-fallback query)
Sprint281 cache-count test updated: 4 → 5 for org1+other-org pattern

## Ingestion Pipeline Changes

Added Stage 5.5 between chunking (5) and injection scan (6):
- Imports `deriveCanonicalTitle`, `deriveSearchAliases` from documentIdentityService
- Extracts canonical title from first 5 chunks
- Updates `knowledge_sources.canonical_title` and `search_aliases` when NOT already set (idempotent)
- Uses `isNull(knowledgeSourcesTable.canonicalTitle)` guard

## CoS Constitution Changes

### buildLibraryPresenceSection (chiefOfStaffLLMService.ts)
- Now emits `State: found/possible_match/not_found/not_ready` field
- POSSIBLE_MATCH (type-fallback only): shows candidate list, "Direct title match: No"
- Backward-compat: infers `state` when absent (old test mocks don't have it)
- Backward-compat: `possibleMatches = result.possibleMatches ?? []`

### Constitution rule 5 (new)
Possible match (State: possible_match) — must surface candidate, must NOT say "Not found",
must NOT say "please upload" when plausible candidate exists

### Constitution rule numbering
Old: 4=Not found, 5=Partial match, 6=Service unavailable
New: 4=Not found, 5=Possible match (NEW), 6=Partial match, 7=Service unavailable

## Backfill

MH&R document (`aab1221b-c489-412e-877d-2061204c12f8`):
```sql
UPDATE knowledge_sources SET
  canonical_title = 'MH&R Policy and Procedure Manual',
  search_aliases  = '["Policy and Procedure Manual", "MH&R Policy Manual", "MH&R Policies", "Policy Manual"]'::jsonb,
  updated_at      = now()
WHERE id = 'aab1221b-c489-412e-877d-2061204c12f8';
```

Note: `approved_by_user_id` for this doc is NOT NULL — earlier forensic investigation was wrong about it being null. The failure was purely title-mismatch.

## Test Counts

Baseline before Sprint 29G.1: 4,078 passing, 14 failing (sprint285 only)
After Sprint 29G.1: 4,098 passing, 14 failing (sprint285 only — pre-existing)
New test file: `sprint29g1-document-identity.test.ts` — 20 tests

Sprint29g source-contract tests (Inv 6, scoreMatch) updated to check for:
- `isSourceEligible(` and `retrievable = isSourceEligible(`
- `scoreMultiSignal(` and `searchTerms,`
