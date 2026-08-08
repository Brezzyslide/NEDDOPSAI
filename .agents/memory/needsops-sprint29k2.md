---
name: NeedsOps Sprint 29K.2 Durable Evidence Foundation
description: Two new DB tables for persisting EvidencePack provenance; Hybrid model (references + passageHash + passageSnapshot); REQUIRED_RLS_TABLES=73; 4445 tests passing
---

## What was built

Two new tables implementing the Hybrid evidence persistence model designed in Sprint 29K.1:
- `completed_work_evidence_snapshots` — one row per (executionId, versionId)
- `completed_work_evidence_links` — one row per EvidenceChunk in the pack

## Key architectural decisions

**Fail soft** — `persistExecutionEvidence` is called fire-and-forget after `createDraft()` in `unifiedExecutionEngine.ts`. Failure is logged as a provenance gap but does NOT fail Completed Work creation. Matches the `submitForApproval` soft-failure pattern.

**Same instance** — uses the EvidencePack already in scope at call site. No second retrieval.

**Idempotent** — `ON CONFLICT DO NOTHING` on both tables. Recovery/retry is safe.

**Version ownership** — evidence is bound to `completedWork.currentVersionId` which is set immediately by `createDraft()`. V1 and V2 each retain their own provenance.

**Soft reference for chunkId** — `completed_work_evidence_links.chunk_id` has NO FK constraint. Re-ingestion generates new chunk UUIDs (old rows soft-deleted), so FK would cause cascade loss. `verifyEvidencePassageIntegrity()` handles the "chunk absent" case as `"snapshot_only"`.

**Hash coverage** — `passageHash` = SHA-256 of full `chunk.text`. `passageSnapshot` = first 800 chars (word-boundary trim). Hash always covers full text; snapshot may be truncated.

## Integrity verification states

- `"verified"` — live chunk text SHA-256 matches stored passageHash
- `"snapshot_only"` — chunk not found (re-ingested with new UUID, or hard-deleted by cascade)
- `"changed"` — chunk present but text hash differs (design violation but detectable)

## Call site

`unifiedExecutionEngine.ts` — after `createDraft()`, before the `submitForApproval` lifecycle block. Fire-and-forget with `.catch()` warning. Guard: `evidencePack && evidencePack.totalChunks > 0 && completedWork.currentVersionId`.

## EvidenceChunk interface updated

`knowledgeResolutionService.ts` — `sourceVersionId: string | null` field added to `EvidenceChunk`. Both `mapRawChunk` and the task-upload inline constructor updated to populate it from `raw.sourceVersionId`.

## REQUIRED_RLS_TABLES count

73 (was 71). Updated in all 6 test files that assert the count:
- sprint7-rls-safety.test.ts
- sprint22-work-execution.test.ts
- sprint-knowledge-bridge.test.ts
- sprint-knowledge-retrieval.test.ts
- sprint36-notification-state.test.ts
- task15-knowledge-schema.test.ts

## Test baseline

4445 passing / 27 pre-existing failures (unchanged from Sprint 29J.3). 33 new tests in sprint29k2-durable-evidence.test.ts (N1–N26 + pure utility tests).

## Real DB verification

Tables created, snapshot + 3 links inserted against approved work `35694389-ffe0-4833-ba71-d03cf8346057` (version `d57ddfb1`). Chunk `d319bdf6` is a real chunk from the retrieval audit and shows as `CHUNK_PRESENT`. Simulated chunks show as `CHUNK_ABSENT (soft-ref)` — expected, as they don't exist in the DB.

## What remains (Sprint 29K.3 and beyond)

- Claim-level binding (link evidence to specific sentences in the output)
- Absence evidence model (missing-document findings)
- Contradiction pairing (structured conflict records)
- UI: Quality tab evidence section showing provenance per finding
