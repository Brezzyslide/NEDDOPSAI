---
name: NeedsOps Sprint 28.6 — Reliable Knowledge Ingestion & Dead-Letter Recovery
description: claimNext snake_case bug, dead-letter error persistence, excluded sources, AI health check, download timeout
---

## The snake_case claim bug (most critical)

`DatabaseIngestionQueue.claimNext` uses `db.execute(sql`UPDATE ... RETURNING *`)`.
PostgreSQL returns snake_case column names (`organization_id`, `knowledge_source_id`, etc.).
The worker accesses `job.organizationId` → `undefined` → `runPipelineForJob` passes `undefined`
as `organizationId` → `getIngestionJob(id, undefined)` returns null → `JOB_NOT_FOUND` on every claim.

**Fix:** `normalizeRawIngestionJob(raw)` helper in `DatabaseIngestionQueue.ts` maps all snake_case
keys to camelCase. Applied to both `claimNext` and `fail` return paths.

**Why:** `db.execute` never auto-maps columns; only `db.select().from(table)` uses Drizzle's ORM mapper.
Any future raw `db.execute` that returns job rows MUST call `normalizeRawIngestionJob`.

## GCS download hangs in Replit

`bucket.file(objectName).download()` has no built-in timeout. In Replit, GCS auth or network can stall
indefinitely. Without a timeout, the job occupies its 120s lease before `recoverStuck` fires.

**Fix:** `fetchFromObjectStorage` wraps the download in a 30s `Promise.race`-style timer that throws
`"GCS download timeout after 30s (STORAGE_TIMEOUT)"`. `STORAGE_TIMEOUT` is in `TRANSIENT_CODES`
so the job gets a backoff retry instead of hanging for the full lease period.

## Dead-letter error persistence (recoverStuck)

Before Sprint 28.6: `recoverStuck` dead-lettered jobs silently — `last_error_code` stayed NULL.
Fix: `recoverStuck` uses raw `db.execute(sql`UPDATE ... SET last_error_code = COALESCE(last_error_code, 'LEASE_EXPIRED') ...`)`.
`LEASE_EXPIRED` now always appears on dead-lettered-by-lease-expiry jobs.

## Error classification

`classifyIngestionError(code, err?)` → `"permanent" | "transient" | "unknown"`.
Permanent codes (document-is-the-problem): dead-letter immediately via `nonRetryable=true`.
Transient codes (infra/network): normal backoff retry.
Unknown: backoff retry with escalating diagnostic logging.
`_persistErrorDiagnostics()` writes to DB via raw SQL before `queue.fail()` — survives transaction failures.

## assembleWorkPackage return type change

Changed from returning `WorkPackageManifest` directly to `{ manifest: WorkPackageManifest, excludedSources: ExcludedSource[] }`.
Single caller in `workExecutionPipelineService.ts` destructures: `const { manifest, excludedSources } = await assembleWorkPackage(...)`.
All test mocks must wrap the manifest in `{ manifest: { ... }, excludedSources: [] }`.

## ExcludedSource (8 reasons)

Stored inside `selectionMetadata.excludedSources` JSONB on `work_package_manifests` — no migration needed.
Reasons: `not_approved`, `awaiting_approval`, `ingestion_pending`, `ingestion_failed`, `no_chunks`,
`wrong_knowledge_type`, `source_inactive`, `blueprint_mismatch`.

## Inspector evidence block

`ExecutionInspection.evidence` now includes `excludedSources: InspectorExcludedSource[]`.
Read from `selectionMetadata.excludedSources` JSONB at inspection time.
`noEvidenceReason` auto-populated when all sources are excluded.

## Dead-letter retry route (ingestion.ts)

`POST /v1/organisations/:slug/knowledge/sources/:id/jobs/:jobId/retry` now accepts `status='dead_lettered'`.
Dead-lettered jobs are reset via raw SQL (not `enqueueIngestionJob` which checks for active jobs).
Failed jobs still create a new job via `enqueueIngestionJob`.

## AI health check

`GET /v1/ai/health` and `GET /v1/platform/ai/health` — safe OpenAI key validation via `models.list`.
Returns: `{ status: "healthy"|"misconfigured"|"auth_failure"|"network_error"|"unknown", errorCategory, model, provider }`.
HTTP 401/403 → `auth_failure`. HTTP 429 → `healthy` (rate-limited but key valid). Timeout → `network_error`.

## DOCX debug route

`GET /v1/platform/debug/docx-extract?storageKey=<key>` — reproduces extraction outside the queue.
Returns buffer size, extracted length, line/word counts, warnings, and first/last preview of text.
Platform staff only.

## Embedding failure root causes (both now fixed)

**Root cause 1: base64 DOCX images**
mammoth.convertToMarkdown inlines embedded images as `![alt](data:image/png;base64,...)`.
Base64 characters tokenise at ~1 char/token, so a 27,000-char image chunk ≈ 27,000 tokens
(well over the 8,192-token limit for text-embedding-3-small → HTTP 400).
**Fix:** `stripBase64DataUris()` in `docxExtractor.ts` replaces data URIs with `[embedded image: alt]`
immediately after `mammoth.convertToMarkdown`, before text enters chunking.

**Root cause 2: very long prose/table chunks**
Even without base64, dense medical/legal text tokenises at ~3 chars/token.
A 27,000-char chunk could be ~9,000 tokens — over the 8,192 limit.
**Fix:** `EMBEDDING_MAX_CHARS = 24_000` in `lib/ai-gateway/src/providers/openai.ts` truncates
each text before the API call as a safety net. Applied per-text inside the batch `.map()`.

## Embedding catch block

The `try/catch` around `provider.generateEmbeddings(...)` in `ingestionPipelineService.ts`
now logs `[ingestion-pipeline] Embedding failed for job <id> (N chunks): <err>` before
silently continuing. Without this log, embedding failures were invisible.

## knowledge_curation purpose restriction (non-fatal)

`callCurationLLM` uses `createAIGateway({ role: "system", purpose: "knowledge_curation" })`.
The gateway's `permittedPurposes` for "system" role doesn't include "knowledge_curation".
This causes every curation call to fail with `PURPOSE_NOT_PERMITTED`, falling back to rule-based.
The fallback is non-fatal — chunking/embedding/review still completes.
**Fix needed:** add "knowledge_curation" to the permitted purposes for the "system" role in the
AI gateway config, OR switch to a role that already includes "knowledge_curation".

## Test count

Sprint 28.6 adds 1 test file: `sprint286-ingestion-recovery.test.ts` (154 tests).
Fixes test mock in `task19-queue-worker.test.ts` (claimNext assertion → toMatchObject).
Total: 3,599 passing, 101 test files, 0 failures.
</content>
</invoke>
<invoke name="Edit">
<parameter name="file_path">.agents/memory/MEMORY.md