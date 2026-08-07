---
name: NeedsOps Sprint 29H.3 Capability Gate False-Positive Investigation
description: Root cause of "Requires upgrade: Policy Review" blocking OM dispatch on acceptance message
---

## Rule
Three distinct bugs in the capability identification and gate response pipeline caused a false-positive block. No implementation was done — investigation only.

## Root Cause Chain

1. **Keyword false-positive**: bare `"policy"` in `CAPABILITY_KEYWORD_PATTERNS` for `policy.review` matched the word "Policy" in document name "Incident Management Policy". Score 2/8 = 0.25 → below 0.7 threshold → falls through to LLM.

2. **LLM level bypass**: LLM returns `requestedLevel: "execution"` for `policy.review` (seeing "Review...Policy" as executing a policy review). `adjustLevelsForIntent` guard (`cap.executionAllowed` check) **only runs on deterministic results** — LLM-returned levels bypass it entirely.

3. **`level_not_supported` block**: `policy.review.executionAllowed = false` → `decideCapabilityAccess` step 2 blocks with `level_not_supported`. DB record: `{"decision":"blocked","reason":"level_not_supported","source":"Policy Review does not support execution level"}`.

4. **Misleading label**: `buildMixedCapabilityResponse` shows "Requires upgrade" for ALL blocked capabilities regardless of `reasonCode` — "Requires upgrade" is wrong when the block is `level_not_supported` (org HAS the compliance pack).

## Key DB Facts (mhr-holdings-2)
- Compliance pack: `status="trial"`, `source="onboarding_trial"`, expires 2026-08-20 — entitlement is NOT the issue
- All 4 capabilities (incident.review, compliance.gap_analysis, compliance.evidence_review, policy.review) are `allowed` at `professional_analysis` level
- `policy.review` at `execution` → `blocked`, `level_not_supported`

## Files to Fix (not yet implemented)
- `artifacts/api-server/src/lib/capabilityRegistry.ts` — remove bare `"policy"` keyword from policy.review pattern; use multi-word phrases only
- `artifacts/api-server/src/services/capabilityIdentificationService.ts` — apply `executionAllowed` cap to LLM-returned capability levels before returning
- `artifacts/api-server/src/services/capabilityGateService.ts` — segment "Requires upgrade" vs "Not supported for this request type" by `reasonCode`

## Sprint 29H.2 is unaffected
Action state and decision logic (rerun_existing, shouldDispatchSpecialist=true) is correct. The capability gate fires at step 3b BEFORE the 29H.2 action decision at step 3c. If the gate passes, dispatch would have fired correctly.

**Why:** Investigating why OM was not dispatched after acceptance message; investigation complete, 3 bugs identified.
**How to apply:** Before touching capability identification or gate services, read this file for the exact call sites and failure modes.
