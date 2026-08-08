---
name: NeedsOps Sprint 29K.3 Claim Emission
description: Claim taxonomy, evidence binding, provenance status, KRS absence finding limitation, UEE outputMode change, REQUIRED_RLS_TABLES=75, 4509 tests
---

## Key decisions

**generateTaskDraft outputMode change:** Changed from `"text"` to `"json"` in Sprint 29K.3. The specialist now returns `{ content: string, claims: RawClaim[] }` in a single LLM call. `parseSpecialistJsonOutput()` extracts both fields; plain-text fallback supported. No second LLM pass, no second KRS retrieval.

**Absence findings limitation:** KRS performs a single bulk retrieval per execution. There is no per-claim targeted absence search. Therefore `absence_finding` claims are ALWAYS classified as `unverified_absence` in Sprint 29K.3. Sprint 29K.4 will add per-claim targeted retrieval.

**Span verification rule:** When a span fails exact-substring check, `supportingSpan` is set to `null` and `spanRejected = true`. The provenance status check must use `b.spanRejected` (not `b.supportingSpan !== null && !b.spanVerified`) or the check silently misses failed spans.

**Contradiction observations:** `observation` claims with contradiction bindings use `relationship: "contradiction"` not `"direct_support"`. The observation rule must accept both `direct_support` AND `contradiction` as valid supporting relationships.

**provenance_status column:** Added to `completed_work_versions`. Default `not_available_legacy` for all pre-29K rows. New executions go through: `pending` → `complete` | `partial` | `failed`. Legacy ≠ failed — do not conflate.

**Two new tables:** `completed_work_claims`, `completed_work_claim_evidence` — both RLS-enabled with `tenant_isolation` policy.

**REQUIRED_RLS_TABLES:** 75 (was 73 after Sprint 29K.2). Update `toHaveLength(75)` in 6 existing test files.

**Tests updated:** `sprint287-output-mode-architecture.test.ts` and `sprint29b-unified-execution-engine.test.ts` — both expected `outputMode="text"` for task execution; updated to expect `"json"` with Sprint 29K.3 rationale comment.

## What NOT to fabricate in absence proofs
The server must never invent AbsenceEvidenceRecord fields from the single bulk retrieval to make an absence claim appear proven. The `unverified_absence` status is intentional and honest.

## Persistence order (Part I)
1. `persistEvidence()` — Sprint 29K.2
2. `persistClaims()` — Sprint 29K.3  
3. Bind claims → evidence links via `(executionId, versionId, chunkId, organizationId)` lookup
4. `setVersionProvenanceStatus()` → `complete` | `partial` | `failed`

## External authority
Only `legislation`, `regulation`, `standard`, `regulator_guidance`, `external_authority` sourceTypes qualify. Internal org policy documents do NOT qualify even with `authorityLevel: "mandatory"`.
