# Sprint 29N.6 — OpenClaw Authority Gate & Evidence Discovery Architecture
## Part R: Final Audit Report

**Sprint:** 29N.6  
**Date:** August 2026  
**Status:** COMPLETE  
**Scope:** Wire the Evidence Sufficiency Gate into the execution pipeline; define the full OpenClaw evidence discovery architecture; implement the Authority Gate, Authority Registry, escalation policy, and candidate evidence contract.

---

## Q1 — Does a Cloud OpenClaw runtime exist?

**No.** OpenClaw runs exclusively as a spawned binary (`openclaw agent --mode rpc --json`) via the Desktop Connector (`artifacts/desktop-connector/src/broker/gatewayAdapter.ts`). This is a Mac/Windows/Linux native process discovered on-disk by platform adapters. There is no network-accessible Cloud OpenClaw endpoint. `lib/knowledge/providers/FutureProviders.ts` explicitly marks Cloud knowledge providers as `NotImplemented` placeholders.

---

## Q2 — What adapter represents OpenClaw evidence discovery in V1?

`NullDiscoveryAdapter` (`src/lib/evidenceDiscovery/NullDiscoveryAdapter.ts`). This adapter:
- Implements `IEvidenceDiscoveryAdapter`
- Returns `isAvailable() = false`
- Returns 0 candidates on every call
- Logs a clear explanation: "No Cloud OpenClaw runtime available"
- Exports a singleton: `nullDiscoveryAdapter`

This is the only adapter registered in `discoveryOrchestrator.ts`. When the escalation policy triggers discovery, the orchestrator finds no available adapter, logs the reason, and returns an empty result.

---

## Q3 — What is the `IEvidenceDiscoveryAdapter` interface contract?

Defined in `src/lib/evidenceDiscovery/IEvidenceDiscoveryAdapter.ts`:

```typescript
interface IEvidenceDiscoveryAdapter {
  readonly id: string;
  readonly name: string;
  isAvailable(): boolean;
  discover(params: AdapterDiscoveryParams): Promise<AdapterDiscoveryResult>;
}
```

`AdapterDiscoveryParams` carries: `executionId`, `organisationId`, `allowedScope`, `unresolvedReferences`, `externalAuthorityRequired`, `hops`, `timeoutMs`.

`AdapterDiscoveryResult` carries: `candidates: CandidateEvidence[]`, `durationMs`, `adapterName`, `hopsFollowed`, `adapterAvailable`.

---

## Q4 — What is the `CandidateEvidence` type?

Defined in `src/types/candidateEvidence.ts`. Key fields:
- **Identity:** `organisationId`, `executionId`, `discoveryId` (UUID)
- **Source classification:** `sourceType`, `isExternal`, `internalSourceId?`, `sourceUrl?`, `publisherDomain?`
- **Content:** `sourceTitle`, `supportingPassage`, `passageHash` (SHA-256)
- **Provenance:** `retrievalTimestamp`, `retrievalMethod`, `discoveryReason`
- **Scoring (from OpenClaw — not trusted for gating):** `openClawConfidence`, `relevanceScore`
- **Classification:** `contentType`, `jurisdiction?`, `accessLocation`

`openClawConfidence` is explicitly NOT used to override Authority Gate decisions. NeedsOps assigns its own `authorityClass` post-validation.

---

## Q5 — What are the 15 `EvidenceRejectionReason` codes?

```
CONFIDENCE_BELOW_FLOOR     — relevanceScore below minimum floor
TENANT_BOUNDARY_VIOLATION  — candidate.organisationId ≠ executing org
SOURCE_NOT_FOUND           — internalSourceId missing or not in DB
WRONG_TENANT               — DB source belongs to different org
SOURCE_NOT_APPROVED        — source.status ≠ "approved"
SOURCE_SUPERSEDED          — isCurrent = false
ACCESS_DENIED              — sensitivityClassification = "restricted"
OUTDATED                   — effectiveTo date is in the past
INTEGRITY_FAILURE          — passageHash does not match SHA-256(supportingPassage)
EXTERNAL_EVIDENCE_NOT_PERMITTED  — allowExternal=false and isExternal=true
AUTHORITY_UNKNOWN          — external domain not in Authority Registry
INVALID_URL                — sourceUrl missing or unparseable
AUTHORITY_INACTIVE         — registry entry exists but status="deprecated"
JURISDICTION_MISMATCH      — candidate jurisdiction ≠ org jurisdiction
PASSAGE_TOO_SHORT          — supportingPassage below minimum length
```

---

## Q6 — What are the 7 EvidenceSufficiencyStatus values?

```
SUFFICIENT                  — pack is adequate; execution may proceed
INSUFFICIENT_COVERAGE       — too few chunks or too low avgConfidence
UNRESOLVED_REFERENCE        — chunks contain cross-references to missing documents
EXTERNAL_AUTHORITY_REQUIRED — task needs regulatory/legislative source not in library
SOURCE_NOT_AVAILABLE        — no chunks returned at all (library empty or not searchable)
LOW_CONFIDENCE              — chunks exist but avg confidence below threshold
AUTHORITY_GAP               — source found but authority level is insufficient
```

`SUFFICIENT` and `AUTHORITY_GAP` are both treated as "execution may proceed" by `isResultSufficient()`. `AUTHORITY_GAP` is a Library governance issue, not a blocking evidence gap.

---

## Q7 — What does the EvidenceEscalationDecision decide?

`buildEscalationDecision()` maps each sufficiency status to an escalation decision:

| Status | shouldEscalate | allowedDiscoveryScope |
|---|---|---|
| SUFFICIENT | false | none |
| AUTHORITY_GAP | false | none — governance issue |
| INSUFFICIENT_COVERAGE (no cross-refs) | false | none |
| LOW_CONFIDENCE (no cross-refs) | false | none |
| UNRESOLVED_REFERENCE | true | internal_references_only |
| EXTERNAL_AUTHORITY_REQUIRED | true | external_authority_only |
| SOURCE_NOT_AVAILABLE | true | internal_references_only |
| INSUFFICIENT_COVERAGE (with cross-refs) | true | internal_references_only |
| LOW_CONFIDENCE (with cross-refs) | true | internal_references_only |

Hard limits on all escalation paths: `maxHops=2`, `maxSources=5`, `maxPassages=3`, `timeoutMs=15_000ms`.

---

## Q8 — What is the full evidence gate flow in the UEE?

```
1. KRS resolves V1 EvidencePack (hybrid retrieval, Sprint 29N.5)
2. [Gate only for EVIDENCE_BEARING tasks: laneContext.requiresEvidence=true]
3. Build empty pack if KRS returned null
4. evaluateEvidenceSufficiency(V1 pack) → EvidenceSufficiencyResult
5. if isResultSufficient(V1) → fast path, skip to execution
6. else:
   a. buildEscalationDecision(V1 result) → EvidenceEscalationDecision
   b. if shouldRunDiscovery → runEvidenceDiscovery (NullAdapter returns 0 candidates)
      - mergeAcceptedIntoEvidencePack(V1, accepted[]) → V2 pack
      - evaluateEvidenceSufficiency(V2 pack) → V2 result
      - if isResultSufficient(V2) → proceed
      - else → fail honestly (message explains what evidence is missing)
   c. if !shouldRunDiscovery → fail honestly (message explains Library gap)
7. logOrgEvent (fire-and-forget observability) for all paths
```

---

## Q9 — Does KRS-sufficient Cloud execution require the `execution.openclaw_runtime` entitlement?

**No.** When KRS finds sufficient evidence (SUFFICIENT or AUTHORITY_GAP), the UEE proceeds to `openExecutionSession()` without checking OpenClaw entitlements. The `execution.openclaw_runtime` entitlement gate is separate and only applies when the Desktop Connector broker is required for task execution. Evidence retrieval from KRS is Cloud-only and does not involve OpenClaw at all. This is the correct behaviour for P9 and P16.

---

## Q10 — What is the Authority Registry?

Defined in `src/lib/authorityRegistry/index.ts`. Contains 12 entries covering:

| ID | Domain | Category | Authority Class |
|---|---|---|---|
| ar-001 | legislation.gov.uk | legislation | mandatory |
| ar-002 | fca.org.uk | regulation | mandatory |
| ar-003 | pra.boe.co.uk | regulation | mandatory |
| ar-004 | ico.org.uk | regulation | mandatory |
| ar-005 | hse.gov.uk | regulation | mandatory |
| ar-006 | gov.uk | guidance | primary |
| ar-007 | acas.org.uk | guidance | primary |
| ar-008 | iso.org | standards | primary |
| ar-009 | pcisecuritystandards.org | standards | primary |
| ar-010 | csrc.nist.gov | standards | primary |
| ar-011 | frc.org.uk | standards | primary |
| ar-012 | eur-lex.europa.eu | legislation | mandatory |

Exports: `lookupAuthorityByDomain()`, `isApprovedExternalSource()`, `normaliseDomain()`, `getRegistryEntryCount()`.

Domain normalisation strips `www.` prefix and protocol before matching.

---

## Q11 — How does the Authority Gate handle openClawConfidence?

`openClawConfidence` (confidence score assigned by OpenClaw) is **never used** to accept, reject, or prioritise a candidate. NeedsOps makes all trust decisions:
- Internal candidates: `authorityClass` is assigned from the KRS-indexed `authorityLevel` of the source
- External candidates: `authorityClass` comes from the Authority Registry entry
- The gate can reject a candidate with `openClawConfidence=0.99` if the source domain is not in the registry

This is proven by P5, P7, and P8 acceptance tests.

---

## Q12 — What happens when openClawConfidence is present but the domain is unknown?

Rejected with `AUTHORITY_UNKNOWN`. The rejection record carries the original `openClawConfidence` value for audit purposes, but the gate decision is entirely domain-registry-driven. No score override is possible.

---

## Q13 — What is `mergeAcceptedIntoEvidencePack` and why does it matter?

`mergeAcceptedIntoEvidencePack(v1Pack, accepted[], executionId)` in `discoveryOrchestrator.ts`:
- Converts each `AcceptedEvidence` into an `EvidenceChunk` using the NeedsOps-assigned `authorityClass` (not OpenClaw scores)
- Sets `confidence` = `relevanceScore` (NeedsOps relevance), never `openClawConfidence`
- Sets `citation` from `sourceTitle` + `sourceUrl`
- Sets `selectionReason` = `discovery:${retrievalMethod}`
- Recomputes `sourceIds`, `citationsByType`, `totalChunks`, `avgConfidence`
- Returns a new V2 `EvidencePack` with all existing fields preserved

V2 passes through the same claim emission, semantic entailment, and provenance tracking as V1 chunks.

---

## Q14 — What is `buildEmptyEvidencePack`?

`buildEmptyEvidencePack(executionId, organisationId)` creates a zero-chunk `EvidencePack` with all fields initialised. Used when KRS returns null (catastrophic retrieval failure) to ensure the sufficiency gate always receives a valid pack instead of crashing on null.

---

## Q15 — What does `EvidenceDiscoveryObservability` record?

```typescript
{
  initialKrsChunks:              number;    // V1 chunk count before escalation
  initialSufficiencyStatus:      string;    // V1 status (e.g. "UNRESOLVED_REFERENCE")
  initialEscalationRecommended:  boolean;
  escalationOccurred:            boolean;
  discoveryAdapterName:          string | null;
  discoveryDurationMs:           number | null;
  hopsFollowed:                  number;
  candidatesReturned:            number;
  candidatesAccepted:            number;
  candidatesRejected:            number;
  rejectionReasons:              string[];
  finalEvidenceChunks:           number;
  finalSufficiencyStatus:        string;
  executionContinued:            boolean;
  blockReason?:                  string;    // set when executionContinued=false
}
```

Logged as a fire-and-forget `logOrgEvent` on every gate pass or block.

---

## Q16 — What is the `/v1/execution` route's role?

It manages runtime execution sessions (start/stop/cancel) via `ExecutionSession`. It is **not** a transport for evidence discovery and should not be reused for that purpose. It is a parallel path to evidence discovery — it handles post-evidence runtime operations. Should eventually become an internal adapter for broker session management, but should not be deleted until callers are proven.

---

## Q17 — What are the three discovery scopes and when are they used?

| Scope | Triggered by | What it allows |
|---|---|---|
| `none` | SUFFICIENT, AUTHORITY_GAP, or coverage gap with no cross-refs | No discovery runs |
| `internal_references_only` | UNRESOLVED_REFERENCE, SOURCE_NOT_AVAILABLE, coverage/confidence gap with cross-refs | Internal library document resolution only |
| `external_authority_only` | EXTERNAL_AUTHORITY_REQUIRED | External authority sources only (legislation, regulation, standards) |

The orchestrator enforces scope — an `internal_references_only` decision cannot reach external sources.

---

## Q18 — What TRANSIENT/PROFESSIONAL_WORK lanes are unaffected?

Both `TRANSIENT` and `PROFESSIONAL_WORK` lanes have `laneContext.requiresEvidence = false`. The entire sufficiency gate block in the UEE is wrapped in:
```typescript
if (request.laneContext?.requiresEvidence) {
```
So for these lanes: KRS retrieval still runs (best-effort), but the sufficiency gate, escalation decision, and discovery adapter are all skipped. OpenClaw is never called. This is proven by P11 and P12.

---

## Q19 — What new database tables were added this sprint?

**None.** `REQUIRED_RLS_TABLES` remains at **75**. The evidence discovery architecture is fully in-memory (types, services, adapters). The `EvidenceDiscoveryObservability` data is logged via the existing `logOrgEvent` audit mechanism. No new schema is required until a real discovery adapter is implemented.

---

## Q20 — What remains before a real discovery adapter can be registered?

1. **Desktop Connector bridge extension** — `IGatewayAdapter` must expose an evidence discovery method (separate from task spawn/bridge). The Desktop Connector LiveGatewayAdapter needs a `discoverEvidence(params)` call that routes to OpenClaw's document retrieval mode.
2. **OpenClaw evidence discovery protocol** — OpenClaw must support a `retrieve --evidence` mode (separate from `agent --mode rpc` task execution). Protocol extension needed in the relay.
3. **Adapter registration** — Replace `nullDiscoveryAdapter` in the orchestrator's adapter registry with a `DesktopConnectorDiscoveryAdapter` that checks broker connectivity before returning `isAvailable()=true`.
4. **Blueprint opt-in for external evidence** — `allowExternal` is currently hardcoded `false` in the UEE. Blueprint schema needs an `evidencePolicy.allowExternalAuthority: boolean` field.
5. **Canonical source linkage** — When an accepted candidate has `internalSourceId`, the V2 chunk should reference the canonical `knowledgeSourceVersionId`. Currently uses `canonicalVersionId` from `AcceptedEvidence` — this needs the acceptance service to resolve and return the version ID from the DB lookup.

---

## Verdict

Sprint 29N.6 is **complete**. The full evidence discovery architecture is defined, implemented, and tested. The NullDiscoveryAdapter correctly represents the absence of a Cloud OpenClaw runtime without silent fallbacks. The Authority Gate enforces tenant boundaries and source integrity independently of OpenClaw's own confidence scoring. The UEE is wired end-to-end with observability on every path. The system fails honestly when evidence is insufficient — no evidence-free Completed Work can be created. 56 new tests pass; all pre-existing tests continue to pass.
