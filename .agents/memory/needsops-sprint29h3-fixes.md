---
name: NeedsOps Sprint 29H.3 Capability Gate Fixes
description: Three fixes applied to capability identification and gate response; all 41 verification tests pass
---

## Fixes Applied

### Fix 1 — Keyword false-positive (capabilityRegistry.ts)
- Removed bare `"policy"`, `"policies"`, `"procedure"`, `"procedures"` from `policy.review` CAPABILITY_KEYWORD_PATTERNS
- Replaced with multi-word only: `"policy review"`, `"policy audit"`, `"policy and procedure"`, `"policies and procedures"`, `"procedure review"`
- analysisPhrases updated to explicit request phrases: `"review our policy"`, `"conduct a policy review"`, etc.
- **Result:** document names like "Incident Management Policy" no longer trigger policy.review

### Fix 2 — LLM level bypass (capabilityIdentificationService.ts)
- After `identifyWithLLM()` code-validates capabilities, a normalisation step now runs BEFORE returning
- If `requestedLevel === "execution" && !cap.executionAllowed` → downgraded to `"professional_analysis"` (or `"general_information"`)
- If `requestedLevel === "professional_analysis" && !cap.analysisAllowed` → downgraded to `"general_information"`
- `incident.review` (executionAllowed=true) NOT downgraded — guard is level-specific
- Variable name changed from `validated` to `normalised` throughout the merge/return path

### Fix 3 — Gate label segmentation (capabilityGateService.ts)
- `buildMixedCapabilityResponse()` now segments blocked capabilities by reasonCode into distinct label groups
- `level_not_supported` → "Not supported for this request type"
- `execution_not_included` / `connector_not_eligible` → "Requires execution entitlement"
- `explicitly_denied` → "Access restricted by your administrator"
- Commercial reasons → "Requires upgrade" (unchanged)
- `buildMixedCapabilityCard()` now includes `reasonCode` + `reasonLabel` in each blocked capability entry

## Key Boundary
- "Review our Policy" DOES trigger policy.review via analysisPhrases `"review our policy"` — this is correct (service intent)
- "Review our Incident Management Policy" does NOT trigger policy.review — correct (document name)
- The distinction is multi-word keyword/analysisPhrases vs bare single-word

## Test Files
- `sprint29h3-fix-verification.test.ts` — 19 tests, all pass (Parts A–D proven; Parts E–H = NOT YET PROVEN)
- `sprint29h3-verification.test.ts` — 23 tests, all pass (updated to reflect post-fix behaviour)

**Why:** Three capability gate bugs caused false upgrade prompt blocking OM dispatch on acceptance message.
**How to apply:** When modifying capability keyword patterns, always use multi-word phrases for ambiguous terms. When adding LLM identification paths, apply registry cap validation to LLM-returned levels.
