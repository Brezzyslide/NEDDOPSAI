---
name: NeedsOps Sprint 29N.6 — OpenClaw Authority Gate
description: Evidence discovery architecture, Authority Gate, escalation policy, UEE wiring, and candidate evidence contract.
---

## Key decisions

### No Cloud OpenClaw runtime
OpenClaw runs as a spawned binary via Desktop Connector only. `NullDiscoveryAdapter` is the only registered adapter — returns `isAvailable()=false` and 0 candidates. All evidence discovery "fails" honestly to the UEE which then blocks execution with a clear message.

### isResultSufficient vs isPackSufficient
`isPackSufficient(input: SufficiencyEvaluationInput)` re-runs the full evaluation. `isResultSufficient(result: EvidenceSufficiencyResult)` checks an already-evaluated result. The UEE uses `isResultSufficient` — calling `isPackSufficient` on a result crashes because it passes the result as an input arg.

### logOrgEvent signature + mock safety
`logOrgEvent` takes a single object `{ eventType, organizationId, resourceType, ... }` — NOT positional args. Fire-and-forget calls must use `void logOrgEvent({...})?.catch(() => {})` (optional chaining) because test mocks often return undefined, and `.catch()` on undefined crashes.

### EvidencePack field names
Correct fields: `executionId`, `organisationId`, `resolvedAt`, `chunks`, `sourceIds`, `citationsByType`, `totalChunks`, `avgConfidence`, `retrievalMetrics`. No `packId`, no `sourceTitles`. `EvidencePackMetrics` uses: `queryCount`, `totalCandidates`, `selectedChunks`, `cacheHit`, `retrievalMs`, `embeddingUsed`, `embeddingMs`.

### Authority Gate: openClawConfidence is never authoritative
`openClawConfidence` from OpenClaw must never be used to accept/reject candidates. NeedsOps assigns `authorityClass` from the Authority Registry (external) or the KRS `authorityLevel` (internal). A candidate with `openClawConfidence=0.99` from an unknown domain is still rejected.

### Tenant boundary is a hard fail
`candidate.organisationId !== callingOrganisationId` is rejected with `TENANT_BOUNDARY_VIOLATION` before any DB lookup. This is the first check in both internal and external paths.

### EvidencePack V2 assembly
`mergeAcceptedIntoEvidencePack(v1, accepted[], executionId)` sets chunk `confidence = relevanceScore` (not openClawConfidence) and `authorityLevel` from the gate's `authorityClass`. Uses `...v1Pack` spread so all provenance fields carry through.

### UEE evidence gate flow (Sprint 29N.6 upgrade)
The Sprint 29M zero-chunk gate was replaced with the full 7-status sufficiency + escalation flow. The gate is wrapped in `if (request.laneContext?.requiresEvidence)` — TRANSIENT and PROFESSIONAL_WORK lanes skip it entirely. KRS still runs best-effort for all lanes.

### buildEmptyEvidencePack signature
`buildEmptyEvidencePack(executionId, organisationId?)` — organisationId defaults to `""` and can be omitted. Always pass both when available.

### sprint29b: test mock completeness for UEE changes
When adding new top-level imports to `unifiedExecutionEngine.ts`, any test file that imports the UEE class directly (not via vi.mock) must have the new modules available. The sprint29b test uses vi.mock for most things but may not include new service imports. Safe pattern: use `?.catch()` on all new fire-and-forget calls so mock gaps don't crash.

## Test counts
- 56 new tests added (14 escalation policy, 29 authority gate, 13 acceptance)
- Total: 5024 | Passing: 4968 | Pre-existing failures: 56 (sprint285, sprint29h*, sprint-execution-auth, sprint94, sprint29f1-real-connector-acceptance)
- REQUIRED_RLS_TABLES: 75 (no new tables this sprint)

## New files
- `src/types/candidateEvidence.ts` — CandidateEvidence, AcceptedEvidence, RejectedEvidence, 15 rejection codes, EvidenceDiscoveryObservability
- `src/services/evidenceEscalationService.ts` — buildEscalationDecision(), shouldRunDiscovery(), EvidenceDiscoveryScope
- `src/lib/authorityRegistry/index.ts` — 12 registry entries (legislation.gov.uk, fca.org.uk, pra.boe.co.uk, ico.org.uk, hse.gov.uk, gov.uk, acas.org.uk, iso.org, pcisecuritystandards.org, csrc.nist.gov, frc.org.uk, eur-lex.europa.eu)
- `src/services/evidenceAcceptanceService.ts` — validateCandidateEvidence(), validateCandidateBatch(), 10 internal + 10 external checks
- `src/lib/evidenceDiscovery/IEvidenceDiscoveryAdapter.ts` — interface
- `src/lib/evidenceDiscovery/NullDiscoveryAdapter.ts` — Cloud-safe no-op singleton
- `src/lib/evidenceDiscovery/discoveryOrchestrator.ts` — runEvidenceDiscovery(), mergeAcceptedIntoEvidencePack(), buildEmptyEvidencePack(), buildInsufficientEvidenceMessage()

## What remains for live discovery
1. Desktop Connector bridge extension — IGatewayAdapter needs `discoverEvidence(params)` method
2. OpenClaw `--evidence` retrieval mode (protocol extension in relay)
3. Register DesktopConnectorDiscoveryAdapter in orchestrator
4. Blueprint opt-in for external evidence (`evidencePolicy.allowExternalAuthority: boolean`)
5. Canonical version linkage in acceptance service (resolve `canonicalVersionId` from DB)
