---
name: NeedsOps Sprint 28.2 Knowledge-First Chief of Staff
description: Integrates organisationLibraryPresenceService into CoS conversation path — prompt rules, context injection, deterministic fix
---

## What was built

Sprint 28.2 wires the presence service from 28.1 into the Chief of Staff conversation path.
The CoS now checks the Organisation Library before responding to any document-related request.

## Authoritative integration point

`classifyMessageLLM()` in `chiefOfStaffLLMService.ts` — **before the provider check**.
This is the single integration point. It runs for both LLM and deterministic fallback paths.

Flow:
1. `extractDocumentSearchTerms(text)` → named doc terms (or [])
2. If terms found AND ctx.organizationId set → `checkOrganisationLibraryPresence(orgId, terms)`
3. `buildLibraryPresenceSection(result, terms)` → formatted context block
4. If presence service throws → `buildLibraryPresenceFailureSection(terms)` (never ask user for doc)
5. `presenceSection` injected into `buildLayeredUserMessage` and `buildLegacyUserMessage`

## New exported functions

From `chiefOfStaffLLMService.ts`:
- `extractDocumentSearchTerms(text: string): string[]` — lightweight document name extractor
- `buildLibraryPresenceSection(result, searchTerms): string` — context section formatter

## Prompt changes

`buildCoSSystemInstructions()`: replaced stale "KNOWLEDGE SOURCE TRANSPARENCY" rule:
- Old (lines ~173–186): "If the Organisation Library contains relevant documents but their content hasn't been provided to you… say 'Your Organisation Library has documentation on this topic'"
- New: "ORGANISATION LIBRARY PRESENCE — MANDATORY RULES" — 7 rules covering found/usable, found/unavailable, not found, partial match, service failure. Explicitly prohibits "Do you have the latest version?".

## extractDocumentSearchTerms design

- Scans for DOC_TYPE_KEYWORDS (policy, procedure, sop, standard, …)
- Scans backward for up to 5 content words before the keyword
- Stops at DOC_NAME_STOP_WORDS (our, the, review, check, …) and possessives ('s)
- Returns title-cased phrases, deduplicated, longest wins, capped at 5
- Returns [] for vague mentions like "our policies" (no specific noun prefix)

## buildLibraryPresenceSection output format

```
=== ORGANISATION LIBRARY PRESENCE ===
Search: Medication Management Policy
Result: Found and usable          ← or "Found but unavailable" or "Not found"
Match type: exact                 ← or "partial"
Best match: Medication Management Policy
Version: 4.2
Status: approved
Indexed: yes
Retrievable: yes
Ingestion: complete               ← omitted when null
Confidence: 0.96
Reason: …                        ← included when unavailable or not found
```

No sourceId, no storage paths, no document content.

## Deterministic path (conversationIntelligenceService.ts)

`buildClarificationQuestions(text, roles, namedDocTerms?)`:
- New 3rd param: `namedDocTerms?: string[]`
- Also uses `SPECIFIC_DOC_NAME_PATTERN` regex to catch named docs even without the arg
- Skips "Which specific policies or procedures should be included?" when user named a doc

`classifyMessage(text, ctx, namedDocTerms?)`:
- New 3rd param, forwarded to `buildClarificationQuestions`
- All three `classifyMessage` call sites in `classifyMessageLLM` now pass `namedDocTerms`

## buildLayeredUserMessage injection point

Presence section injected **immediately before** the CURRENT USER MESSAGE block (after CONTEXT STATS).
Legacy builder: presence section inserted before "User message:" line.

## Failure handling

If `checkOrganisationLibraryPresence` throws:
- Warning logged with `{ organisationId, conversationId, correlationId, error }`
- Internal error message never forwarded to LLM
- `buildLibraryPresenceFailureSection` injected so LLM says "could not check" (not "upload the doc")

## Test baseline

3,289 passing (+42 new), 16 pre-existing failures unchanged.
Test file: `artifacts/api-server/src/__tests__/sprint282-knowledge-first-cos.test.ts` (42 tests)

## Key test-fixture gotcha

`null ?? "default"` evaluates to `"default"` because null is nullish.
Use `o.field !== undefined ? o.field : default` when explicit null must be preserved in a fixture.
