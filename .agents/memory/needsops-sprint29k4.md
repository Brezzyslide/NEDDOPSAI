---
name: NeedsOps Sprint 29K.4 Claim Integrity Hardening
description: Three integrity risks closed — semantic support, claim-type mislabelling, absence-proof; new files, service wiring decisions, test fix rules.
---

# Sprint 29K.4 — Claim Integrity Hardening & Absence Verification

## Three Risks Closed

1. **Semantic support risk** — real span exists but doesn't support the claim
2. **Claim-type risk** — inference masquerading as observation
3. **Absence-proof risk** — "no search result" ≠ proved absence

## Architecture Decisions

### No second LLM
All semantic support validation is deterministic regex-based signal extraction only. `semanticSupportValidator.ts` is a pure function with no network calls.

### Signal extraction — word-form numbers
`extractTimeframes` now parses BOTH digit numerals AND word-form numbers ("five", "three", etc.). This is required because compliance documents commonly use word forms. Without this, timeframe conflict detection misses cross-form mismatches (e.g. claim says "10 days", chunk says "three days").

**Why:** Compliance policy documents write numbers as words ("three business days") while specialist output uses digits. The conflict detector must normalise both forms to compare.

### `detectClaimTypeRisk` — signal priority
When BOTH causal/uncertainty AND absence signals are detected in an observation claim, **prefer `inference_pattern` over `absence_pattern`**.

**Why:** "Lack of X leads to Y" uses "lack" (absence noun) as the SUBJECT of a causal inference. The primary risk is inference masquerading as observation, not a raw absence assertion. `inference_pattern` triggers the more protective downgrade.

### `unsupported_external` status
Sprint 29K.4 renamed the status for `external_requirement` claims with no approved source from `"unsupported"` to `"unsupported_external"`. Any tests that expected `"unsupported"` for `external_requirement` cases must be updated.

**How to apply:** Search for `expect.*"unsupported".*external_requirement` patterns when updating claim validation tests after schema changes.

### `APPROVED_EXTERNAL_SOURCE_TYPES` Set values
The Set must contain BOTH `"standard"` (singular) AND `"standards"` (plural). The knowledge enrichment pipeline uses the plural form. Missing the plural causes valid ISO/standards chunks to fail the approved-source check.

**Why:** The KRS returns `sourceType: "standards"` (plural) from the DB enrichment pipeline, but the original set only had `"standard"` (singular).

### Evidence mode gate
`evidenceModeService.ts` — pure function `classifyEvidenceMode(blueprint)` returns `"required" | "optional" | "none"` based on blueprint `outputTypes`. No DB call needed.

- `"required"`: incident_investigation, risk_assessment, behaviour_support_plan, care_plan, investigation_report
- `"optional"`: performance_review, policy_draft, action_plan, project_plan, business_proposal, operational_procedure  
- `"none"`: customer_response, email, meeting_minutes, and any output type not in above sets
- `null` blueprint → `"optional"` (preserve backward compatibility)

**How to apply:** `shouldRunClaimProvenance("none", pack)` → always `false`. `shouldRunClaimProvenance("required", {totalChunks:0})` → `true` (forces a retrieval attempt even when initial evidence pack is empty). `shouldRunClaimProvenance("optional", {totalChunks:0})` → `false` (optional mode skips when no evidence retrieved).

### Absence verification wiring in UEE
`performAbsenceVerificationBatch` runs BEFORE `persistProvenanceChain` inside the fire-and-forget `runProvenanceChain()` async closure. It mutates `validatedClaims` in-place (only absence_finding claims are affected). The filter `claims.filter(c => c.claimType === "absence_finding")` is the guard to avoid calling the function when not needed.

**Why:** Absence verification requires targeted KRS queries per claim (second retrieval pass). This must complete before claims are persisted so the final `provenanceStatus` reflects verification results.

### `AbsenceEvidenceRecord` extension
New fields on `AbsenceEvidenceRecord` (schema in `completedWorkClaims.ts`):
- `sourceVersionScope`, `scopeLabel`, `sourceCoverage` (SourceCoverageItem[])
- `retrievalMethod`, `contradictoryEvidenceLinkIds`, `verificationStatus`
- `scopeOverreachDetected: boolean`
- `confidenceOfAbsence: number | null` (null when underiable — see below)

### `confidenceOfAbsence` null rules
Must be `null` when ANY of:
- `allSourcesFullyIngested = false`
- `hadRetrievalFailure = true`
- `contradictoryEvidenceFound = true`

This is transparent and honest — confidence cannot be computed when the preconditions for a confidence claim are not met.

### `unsupported_external` for absence org-scope claims
When `hasOrganisationScopeClaim` is true AND only 1 source was searched, the absence claim remains `unverified_absence` with `scopeOverreachDetected: true`. Confidence of absence is null. Single-document search cannot support an organisation-wide absence statement.

## New Files
- `artifacts/api-server/src/services/semanticSupportValidator.ts` — deterministic signal extraction, `classifySpanSupport`, `detectClaimTypeRisk`, `detectScopeOverreach`
- `artifacts/api-server/src/services/absenceVerificationService.ts` — `generateAbsenceSearchTerms`, `checkSourceCoverage`, `performTargetedAbsenceSearch`, `performAbsenceVerificationBatch`, `calculateConfidenceOfAbsence`
- `artifacts/api-server/src/services/evidenceModeService.ts` — `classifyEvidenceMode`, `shouldRunClaimProvenance`
- `artifacts/api-server/src/__tests__/sprint29k4-claim-integrity.test.ts` — 75 tests (L1–L3 evidence levels)

## Modified Files (production)
- `artifacts/api-server/src/services/claimValidationService.ts` — `ValidatedEvidenceBinding` gains `semanticSupport` + `semanticConflicts`; `external_requirement` now uses `unsupported_external`; semantic support + claim-type risk gates added
- `artifacts/api-server/src/services/unifiedExecutionEngine.ts` — imports `performAbsenceVerificationBatch` + `classifyEvidenceMode`/`shouldRunClaimProvenance`; fire-and-forget chain now runs absence verification before persist; evidence mode gate skips provenance entirely for `"none"` mode
- `lib/db/src/schema/completedWorkClaims.ts` — `ClaimProvenanceStatus` expanded to 9 values; `AbsenceEvidenceRecord` extended

## Modified Files (tests only)
- `sprint29k3-claim-emission.test.ts` — 3 assertions updated from `"unsupported"` → `"unsupported_external"` for external_requirement cases + final table allPass function

## Test Baseline
- **Before:** 4,509 passing / 27 pre-existing failures
- **After:** 4,584 passing / 27 pre-existing failures (75 new tests, zero new failures)
- REQUIRED_RLS_TABLES: unchanged at 75

## Key Invariants
- Absence verification is fire-and-forget; it MUST NOT block Completed Work creation
- `confidenceOfAbsence` is null, not 0, when derivation is impossible (honest uncertainty)
- `claimType` is never corrected in the DB — original value is preserved; only `provenanceStatus` is downgraded
- `semanticSupport: null` when no span was provided (cannot classify support without a span)
- `hasOrganisationScopeClaim` detects "the organisation has/does" patterns — distinguishes from "the policy does not"
