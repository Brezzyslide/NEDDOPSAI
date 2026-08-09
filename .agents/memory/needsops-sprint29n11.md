---
name: NeedsOps Sprint 29N.11 Parallel Evidence Discovery
description: Replaced KRS-first+escalation with KRS+OpenClaw concurrent parallel discovery for EVIDENCE_BEARING work; external web search capability; convergence/deduplication/contradiction detection.
---

## Architectural change

**Before (Sprint 29N.6):** KRS → sufficiency gate → if insufficient → OpenClaw (escalation only)

**After (Sprint 29N.11):** KRS + OpenClaw start concurrently via `Promise.all` for EVIDENCE_BEARING work. Both feed the same NeedsOps Authority Gate. Results converge into one merged EvidencePack.

## Constitutional rule (Part D)
"OpenClaw can find the Source of Truth. It cannot appoint the Source of Truth."
- `openClawConfidence` is ADVISORY ONLY — never used as authorityLevel
- `authorityLevel` on chunks always comes from the NeedsOps Authority Gate
- `confidence` on chunks uses `relevanceScore`, not `openClawConfidence`

## New files
- `artifacts/api-server/src/lib/evidenceDiscovery/parallelDiscoveryOrchestrator.ts`
  - `buildParallelDiscoveryDecision(params)` — builds EvidenceEscalationDecision for parallel mode (escalationStatus="PARALLEL_MODE")
  - `runParallelEvidenceDiscovery(params)` — calls adapter concurrently with KRS (wraps existing runEvidenceDiscovery)
  - `convergeEvidenceResults(krsResult, openClawResult, execId, orgId)` — dedup + contradiction → merged pack

## Key contracts

### EvidenceConvergenceResult.mergedPack type: `EvidencePack | null`
- null = KRS returned null AND OpenClaw had no accepted candidates (evidence retrieval failed with no recovery)
- empty EvidencePack = KRS ran but found nothing (deliberate empty result)
- This preserves `validateWorkPackage(manifest, blueprint, evidencePack ?? undefined)` contract

### Deduplication keys
- Internal: `internalSourceVersionId` (exact version match)
- Internal version conflict: `internalSourceId` (same source, different version → contradiction)
- Content: normalised text hash (same passage regardless of source)
- External: `sourceUrl` would also dedup (via text since URL isn't on EvidenceChunk)

### Contradiction detection (Part I)
Priority: authority → currency → applicability → version → scope
- Same sourceId, different sourceVersionId → `conflicting_versions`
- Same version, different text → `conflicting_content`
- KRS preferred (Library-approved) unless version is unknown → `exposed_to_specialist`

### Graceful degradation (Part K)
- OpenClaw unavailable (NullDiscoveryAdapter): `openClawUnavailable=true`, KRS continues
- KRS null + OpenClaw accepted: OpenClaw builds pack alone (Scenario 11)
- Both null/unavailable: `mergedPack=null` → honest failure

## UEE changes
Removed imports: `buildEscalationDecision`, `shouldRunDiscovery`, `runEvidenceDiscovery`, `mergeAcceptedIntoEvidencePack`
Added imports: `runParallelEvidenceDiscovery`, `convergeEvidenceResults`, `OrchestratorResult`

`ExecutionLaneContext` extended with `allowExternalWebSearch?: boolean`
`let blueprint: WorkBlueprint | null = null` (was `let blueprint: WorkBlueprint | null` — caused TS2454)
`minimumRequiredAuthorityLevel` (not `minimumAuthorityLevel`) in evaluateEvidenceSufficiency call
Observability casts: `as unknown as Record<string, unknown>` (EvidenceDiscoveryObservability is too typed for direct cast)

## EvidenceDiscoveryObservability extended (Sprint 29N.11)
New optional fields: `parallelDiscoveryMode`, `openClawDiscoveryUnavailable`, `openClawAvailable`, `openClawDurationMs`, `openClawAdapterName`, `krsChunkCount`, `openClawCandidatesReturned`, `openClawCandidatesAccepted`, `openClawCandidatesRejected`, `deduplicatedItems`, `contradictionsDetected`, `allowExternalWebSearch`

## Test file
`sprint29n11-parallel-evidence.test.ts` — 24 tests, all 15 sprint scenarios + extras

**Why:** When evaluateEvidenceSufficiency is called in tests, `specialistCode` and `blueprint: null` are required fields (not just evidencePack + userRequest).

## What remains before real MacBook OpenClaw connects (Part N)
1. Implement `CloudOpenClawDiscoveryAdapter` or `HybridOpenClawDiscoveryAdapter` that satisfies `IEvidenceDiscoveryAdapter`
2. Register it in `REGISTERED_ADAPTERS` in `discoveryOrchestrator.ts` (or add parallel adapter registry)
3. The adapter needs to accept `ParallelAdapterDiscoveryParams` — current interface uses `EvidenceEscalationDecision` (which `buildParallelDiscoveryDecision` builds up-front with escalationStatus="PARALLEL_MODE")
4. `allowedDiscoveryScope = "internal_and_external"` when `allowExternalWebSearch=true`
5. Do NOT report parallel OpenClaw as live until real adapter returns CandidateEvidence[]

## Test count
5009 passing / 0 failures (was 4985). +24 new tests.
REQUIRED_RLS_TABLES unchanged.
