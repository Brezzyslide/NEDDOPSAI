---
name: NeedsOps Sprint 29G Cloud Evidence Resolution
description: Root cause of presence check returning "not found" for a named document that existed; all four fixes applied
---

## Root Cause: "current" not in GENERIC caused bad ILIKE pattern

`extractDocumentSearchTerms()` in `conversationContextBuilder.ts` scans backward
from a document suffix (e.g. "Policy") to collect the document name. The word
"current" was NOT in the GENERIC stop-word set, so:

  "Review our **current** Incident Management Policy..."
  → extracted: "**Current** Incident Management Policy" (wrong)
  → ILIKE: `%current incident management policy%`
  → 0 DB rows (document title: "Incident Management Policy")
  → presence check returns "Not found"
  → CoS says "couldn't find any documents"

**Fix**: Added temporal/contextual adjectives to GENERIC:
"current", "existing", "latest", "recent", "updated", "proposed",
"practical", "applicable", "relevant", "key", "approved", "actual",
"available", "effective", "required", "specific", "particular"

These words describe a document's state or the user's request context —
they are NEVER part of the document's formal title.

---

## Belt-and-suspenders: sub-phrase ILIKE expansion

`organisationLibraryPresenceService.ts` now also generates suffix sub-phrases
for multi-word expanded terms:
  "current incident management policy" → also: "incident management policy", "management policy"

`generateSubPhrases(terms: string[])` drops 1..N-2 leading words for terms ≥ 3 words.
`scoreMatch` still uses the ORIGINAL (non-expanded, non-sub-phrase) terms for
confidence scoring — the sub-phrases only broaden the ILIKE candidate set.

---

## KRS org-library retrieval: always fires (unconditional)

The old gate:
```ts
if (workPackage.organisationLibrarySources.length > 0 || input.blueprint?.requiredLibraryKnowledge?.length) {
```
...was replaced with an unconditional `{` block in `knowledgeResolutionService.ts`.

**Why**: Blueprints with `requiredLibraryKnowledge: []` silently skipped all
org-library evidence even when the user's request named a specific policy.
The hybrid retrieval already filters approved+current+org-library scope, so
running it unconditionally is safe and returns nothing when nothing matches.

---

## CoS clarification rule for "Not found"

When presence check returns "Not found", the CoS must ask the user to locate or
upload the missing document — NOT ask topic-specific questions.

PROHIBITED: "Could you clarify what incident types or scenarios you want to focus on?"
REQUIRED:   "I couldn't locate the [document name] — please upload it or tell me where it is stored."

Also prohibited: suggesting desktop/connector access without explicit user instruction.
Fixed in `chiefOfStaffLLMService.ts` under the "Not found" rule in the
ORGANISATION LIBRARY PRESENCE section.

---

## Test count after sprint29g

41 new acceptance tests in `sprint29g-cloud-evidence-resolution.test.ts`.
4,078 total passing. 14 pre-existing failures in sprint285 (unrelated).
