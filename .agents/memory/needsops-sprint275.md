---
name: NeedsOps Sprint 27.5 Evidence-Aware Validation
description: Pipeline reorder (resolveEvidence before validateWorkPackage), MissingEvidenceItem model, trusted-provider source handling, sourceTypeNormalisation utility, 3239 tests.
---

## What changed

### Pipeline reorder
- `ExecutionStage` now includes `"retrieving_evidence"` (inserted between `assembling_package` and `validating`).
- `resolveEvidence` runs as Step 3; `validateWorkPackage` runs as Step 4 receiving the `EvidencePack`.
- The `Promise.all([examples, evidencePack])` pattern was removed — evidencePack is resolved alone before validation; examples are resolved after validation passes.

### sourceTypeNormalisation utility
- `artifacts/api-server/src/utils/sourceTypeNormalisation.ts` — canonical alias map, display labels, trusted-provider classification.
- `isTrustedProviderSource()` operates on **canonical** types only — raw aliases must be normalised first via `canonicaliseSourceType()`.
- `TRUSTED_PROVIDER_TYPES` contains: `legislation`, `ndis_practice_standards`, `commission_guidance`, `fair_work`, `government_publication`. Does NOT contain `legislation_reference` or `ndis_standards` (aliases must be normalised first).
- `standards` (generic) is NOT a trusted-provider type — it is org-provided.

### workValidationService rewrite (evidence-aware)
- `validateWorkPackage(manifest, blueprint, evidencePack?)` — 3rd param optional.
- `ValidationResult` gains: `missingEvidenceItems: MissingEvidenceItem[]`, `evidenceSearched: boolean`, `clarificationMessage: string`.
- `MissingEvidenceItem`: `{ canonicalType, displayLabel, required, reason, searched, searchOutcome, suggestedAction }`.
- Source types come from evidence chunks (confidence ≥ 0.25) when `evidencePack` provided; falls back to manifest metadata when not.
- Task uploads always satisfy evidence requirements (treated as full confidence).
- Named `validationRules` with `required:true` for trusted-provider types are **downgraded to warnings** (not blockers) — e.g. `legislation_present` required:true never blocks.
- `requiredLibraryKnowledge` entries generate warnings only, never blockers.
- `upsertMissing()` deduplicates by canonical type; named rules take priority over generic categories.
- `missingItems` (backward compat) contains display labels of `required:true` blockers only.
- `buildClarificationMessage()` exported — evidence-aware language when `searched:true`, generic when `searched:false`.

### sprint271-foundations.test.ts update
- Added `knowledgeResolutionService.js` mock (resolves null).
- Updated all `validateWorkPackage` mock return values to include new fields: `issues`, `conflictingItems`, `recommendedAction`, `missingEvidenceItems`, `evidenceSearched`, `clarificationMessage`.

### Test file split (vi.mock hoisting rule)
- `sprint275-evidence-aware-validation.test.ts` — unit tests for normalisation + validation (50 tests, no workValidationService mock).
- `sprint275-pipeline-ordering.test.ts` — pipeline ordering + stage label tests (11 tests, mocks everything including workValidationService).
- **RULE**: Never put `vi.mock(workValidationService)` in the same file as unit tests that call the real `validateWorkPackage`. Vitest hoists all `vi.mock` calls to file top regardless of describe nesting.

## Key invariants

- `isTrustedProviderSource()` returns false for raw aliases — caller normalises first.
- Legislation (and other trusted types) must never appear in `result.missingItems` as a blocker regardless of blueprint `required:true` setting.
- `clarificationMessage` is empty when `passed:true`.
- `evidenceSearched` flag drives the "searched your library" vs "this work requires" language split.
- Confidence threshold for required evidence: 0.25. Chunks below this count in `retrievedAllTypes` (for warnings) but not `retrievedHighConfTypes` (for required rules).

## Test baseline
- Before: 3,178 total, 3,162 passing, 16 pre-existing failures
- After: 3,239 total (+61), 3,223 passing (+61), 16 pre-existing failures (unchanged)
