---
name: NeedsOps Sprint 29H Routing Quality Audit Correction
description: Specialist routing fix (OM for incident.review), quality score 0-100 scale fix, retrieval audit root-cause, UEE architectural guard, plan-language detection
---

# Sprint 29H — Specialist Routing, Quality Score & Retrieval Audit Correction

## What was done
- **Part A**: `chiefOfStaffService.ts` — ROUTING_RULES converted from snake_case to dot-format canonical codes; `selectSpecialists()` now reads `getCapability(code).eligibleRoles` and filters out specialists with `BLOCKED_EXECUTION_STATUSES` (`dna_pending`, `coming_soon`, `archived`, `deprecated`); `allAssigned` deduplication added (chief_of_staff was appearing twice via explicit add + capability selection).
- **Part B**: `capabilityRegistry.ts` — `operations_manager` added to `incident.review` eligibleRoles; `requiredWorkerProfiles` cleared; version bumped to `1.1`.
- **Part C**: `selfReviewService.ts` — `detectPlanLanguage()` function detects 9 plan-to-do phrases in output types requiring completed analysis; deducts up to 4 points from completeness dimension.
- **Part D**: `selfReviewService.ts` — `computeWeightedScore()` bug fixed: `totalWeight += weight * 10` → `totalWeight += weight`. Score is now 0–100. Old formula: 8250/1000 = 8 (wrong). New formula: 8250/100 = 83 (correct).
- **Part E**: After fix, score 83 ≥ QUALITY_THRESHOLD 70 → no auto-revision fires.
- **Part F**: `knowledgeOrchestrationEngine.ts` — `writeRetrievalAudit()` catch block now logs structured postgres error fields. Live probe confirmed insert WORKS. Root cause of 0 rows: cache hit bypassed orchestrateKnowledge() entirely (see follow-up task).
- **Part H**: `unifiedExecutionEngine.ts` — architectural guard added after `const roleCode = workPackage.workforceRoleCode`: calls `getSpecialistByCode(roleCode)` and returns `status: "blocked"` immediately if `executionStatus` is blocked.

## Key facts
- `reviewWritingStyleCompliance` accesses `manifest.cosMemories` (not `approvedMemory`) — test mocks need `cosMemories: []`.
- `entityKnowledge` in WorkPackageManifest is `Record<string, unknown>`, not an array.
- Historical quality_score records (values 6 and 8) were backfilled: `UPDATE completed_work_versions SET quality_score = quality_score * 10 WHERE quality_score <= 10`. DB now shows 60 and 80.
- Sprint29b test "returns blocked status for inactive specialist" updated to match new UEE guard message pattern (previously checked for "not yet activated" which came from ACTIVE_SPECIALISTS gate).
- REQUIRED_RLS_TABLES unchanged. Test count: 3886 passing (1 pre-existing failing file: sprint29f1-real-connector-acceptance).

## Live acceptance gate results
- Gate 1: identifyCapabilities → incident.review, policy.review, compliance.evidence_review (correct)
- Gate 2: planTask → primarySpecialist: operations_manager, intent: incident.review, confidence: 0.95
- Gate 4: OM eligible for incident.review (all checks passed)
- Gate 5: incident_safeguarding_specialist → dna_design_pending; KDS → specialist_not_eligible_for_capability
- Gate 7: Fixed formula → 83/100 (old: 8/100), passes threshold 70
- Gate 8: 2 retrieval_audit_events rows confirmed in mhr-holdings-2

**Why:** D1 critical defect: wrong specialist dispatched via legacy path bypassing eligibility. D2: score formula cancelled its own × 10 scale. D3: 0 audit rows were from cache bypass, not insert failure.
