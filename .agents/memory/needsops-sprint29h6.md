---
name: NeedsOps Sprint 29H.6 Capability Intent & Partial-Gate Correction
description: Three code fixes for capability intent misclassification — incident.review not detected, compliance.corrective_actions falsely escalated to execution, EXECUTION_VERBS over-broad — plus live verification evidence.
---

# Sprint 29H.6 — Capability Intent & Partial-Gate Correction

## Three Root-Cause Fixes

### Fix A — EXECUTION_VERBS over-broad (`capabilityIdentificationService.ts`)
Removed "prepare", "create", "generate", "run", "complete" from EXECUTION_VERBS.
These caused `adjustLevelsForIntent` to escalate any matched capability to execution level when the message contained those words — even for intellectual work-product requests like "Prepare an Improvement Plan".
Added "apply" (genuinely external).
Specific execution intent for individual capabilities is now caught only by pattern `executionPhrases`.

### Fix B — LLM prompt level rules clarified (`capabilityIdentificationService.ts`)
Old rule: `execution: user wants action taken (prepare, submit, create, update)` — "Produce/prepare" mapped to execution.
New rule: Explicitly states that producing a PLAN/REPORT/RECOMMENDATION is professional_analysis; execution = external state change. Includes named examples.

### Fix C — Post-LLM intent normalisation (`capabilityIdentificationService.ts`)
After registry-level normalisation (29H.3 Fix 2), a new step:
if LLM returned "execution" for a capability with `executionAllowed=true`, but NO deterministic `executionPhrase` matches the message → downgrade to "professional_analysis".
Guards against LLM conflating "produce a document" with "external action".
Guard variable: `withRegistryNormalisation` → `normalised`.

### Fix D — incident.review keyword patterns (`capabilityRegistry.ts`)
Removed bare "incident", "incidents" (matched document names, not service intent).
Added multi-word keywords: "incident management", "incident review", "incident investigation", "incident response", "incident reporting", "incident procedure".
Added analysisPhrases: "incident management policy", "review incident management", "incident management review", "review our incident".
"incident management policy" appearing in an analysis request scores 4 (keyword) + 4 (analysisPhrase) = 8 → confidence 1.0 → deterministic path taken, LLM bypassed entirely.

### Fix E — compliance.corrective_actions patterns expanded (`capabilityRegistry.ts`)
Added keywords: "improvement plan", "corrective action plan", "action plan", "remediation plan".
Added analysisPhrases: "prepare improvement", "develop improvement", "produce improvement", "prioritised improvement plan", "corrective action plan", "remediation plan", "develop a remediation", "prepare a remediation", "prepare an improvement", "action plan", "recommend corrective", "produce corrective", "prioritise corrective".
Added executionPhrases: "implement corrective", "apply corrective", "execute corrective", "apply the corrective", "implement the corrective", "apply these corrective", "implement these corrective".

## Invariant Rule

The presence of "plan", "action", "recommendation", "improvement" must never alone escalate to execution level.
Execution = external-state change. Creating intellectual deliverables = professional_analysis.

## Test Evidence

29 unit tests in `sprint29h6.test.ts` (all pass, evidence level 1):
- H1–H4: Analytical phrases → professional_analysis (deterministic, no DB, no LLM)
- H5–H7: Execution phrases → execution
- H8a–H8d: Full acceptance message → incident.review + corrective_actions @ professional_analysis
- Architecture invariant: 5 plan/action phrases, all 0 execution caps
- H9–H10: Gate fires for genuine execution; doesn't fire for analytical
- H11: 3 dna_pending specialists all return eligible=false
- H12a–H12d: operations_manager eligible for incident.review; ISS not eligible

## Live Post-Fix Verification (evidence level 3–4)

New conversation `6c2a346d` at `2026-08-07T11:46:55Z` (post-29H.6 restart).

Capability decisions written:
- compliance.corrective_actions @ professional_analysis → allowed (workforce_pack_included)
- incident.review @ professional_analysis → allowed (workforce_pack_included)

No blocked capabilities. No partial capabilities. No "Requires upgrade" card.
No confirmation card shown.

CoS produced message_type=`task_proposal` (not a gate card, not a wrong-specialist dispatch):
> "I understand you want to review your current Incident Management Policy and identify gaps, risks, and weaknesses, along with producing a prioritised Improvement Plan. I found a plausible document titled 'MH&R Policy and Procedure Manual' in your approved Organisation Library, which may contain relevant information for this review. I can prepare a task proposal for the review and improvement plan. Shall I proceed with that?"

This is CORRECT pre-execution behaviour:
- CoS found the relevant document in the library
- Created a task_proposal awaiting user confirmation
- Did NOT dispatch incident_safeguarding_specialist
- Did NOT fire the entitlement gate
- Operations Manager will execute AFTER user confirms the proposal

No completed_work / retrieval audit / specialist_run yet — these happen POST-approval, which is correct.

## Key Numbers

Tests after this sprint: 70 passing (sprint29h6: 29 new + 29h3: 41 existing).
REQUIRED_RLS_TABLES: unchanged.

## compliance_quality_manager Status

validateSpecialistEligibilitySync("compliance_quality_manager", "incident.review") → false.
compliance_quality_manager is listed in incident.review eligibleRoles but its executionStatus is dna_pending → blocked from dispatch. Only operations_manager is eligible and production-ready for incident.review.
