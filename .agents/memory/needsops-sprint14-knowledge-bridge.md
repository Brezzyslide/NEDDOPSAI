---
name: NeedsOps Sprint Knowledge Bridge (Task #14)
description: Wired org memory, specialist config, and language profiles to all specialists at execution time. Key schema and code decisions.
---

## Rule
`specialistContextService.ts` exports TWO distinct functions with different callers:
- `loadSpecialistContext(orgId, specialistId, budget?)` → `SpecialistContextPackage` — called by `executionService.ts` to build execution instruction packages (Task #14)
- `buildSpecialistContext(params)` → `SpecialistContext` — called by `chiefOfStaffOrchestrator.ts` for conversational runs. Must NOT be removed.

**Why:** The orchestrator was importing `buildSpecialistContext` before Task #14 started. Task #14 rewrote the file and accidentally dropped it, breaking the build. Both functions must coexist.

## How to apply
When editing `specialistContextService.ts`, always verify both exports are present before running build.

---

## Schema decisions

### `organisation_memory.specialist_id` (new nullable column)
- `NULL` = org-wide memory (available to all authorised specialists)
- `'some_role'` = scoped to that specialist only (e.g. "incident_management")
- Existing rows defaulted to NULL — no data loss.

### `specialist_language_profiles` (new table)
- One row per (organizationId, specialistId) pair
- Contains: locale, spellingConvention, tone, formality, preferredTerms (JSONB), prohibitedTerms (JSONB), dateFormat, timeFormat, headingPreferences, sentenceLengthPreference, outputStructure
- RLS: `tenant_isolation` policy on organization_id
- REQUIRED_RLS_TABLES: 52 → 53

---

## assembleRuntimeInstructions signature change
New optional 4th parameter: `organisationContext?: SpecialistOrganisationContext`
- Returns `hasOrganisationContext: boolean` and `injectedMemoryIds: string[]`
- Org sections inserted between "Prohibited behaviours" and "Current task"
- Retrieved memory labelled as EVIDENCE and CONTEXT (prompt injection protection)
- Type exported from `@workspace/agent-runtime` as `SpecialistOrganisationContext`

---

## contextAudit in executionService
`buildExecutionPackage` now returns a `contextAudit: { injectedMemoryIds, hasOrganisationContext, tokenBudgetUsed }` field.
Passed to `buildManifestAuditRecord` as `options.injectedMemoryIds` and `options.hasOrganisationContext`.
`ManifestAuditRecord` updated to include these fields.

---

## Test count
1,475 → 1,498 (23 new tests in sprint-knowledge-bridge.test.ts)
