---
name: NeedsOps Task #19 Knowledge Queue Worker
description: In-process queue worker for Knowledge Hub ingestion — new columns, statuses, auto-enqueue, cancellation, dead-letter, sweeper.
---

## New ingestion_jobs columns (migration: task19-worker-queue.sql)
- `lease_expires_at TIMESTAMPTZ` — when worker lease expires; sweeper checks this
- `heartbeat_at TIMESTAMPTZ` — last heartbeat from claiming worker
- `next_attempt_at TIMESTAMPTZ` — earliest retry time (exponential backoff)
- `recovery_count INTEGER DEFAULT 0` — incremented by sweeper on each recovery
- `dead_lettered_at TIMESTAMPTZ`
- `last_failed_at TIMESTAMPTZ`

## New statuses added to INGESTION_JOB_STATUSES
- `dead_lettered` — exhausted max_attempts; requires admin action to retry; terminal
- `cancelling` — cancel requested while job is in-flight; worker must finalise to `cancelled`

## Transition rules added
- All processing statuses (`fetching`…`embedding`) can now → `cancelling`
- `cancelling` → `cancelled`
- `failed` → `dead_lettered` (via queue.fail() when nonRetryable or attempts exhausted)

## INGESTION_NON_RETRYABLE_CODES (Set)
`UNSUPPORTED_FILE_TYPE`, `CORRUPTED_DOCUMENT`, `ENCRYPTED_DOCUMENT`, `MISSING_STORAGE_KEY`, `INVALID_STORAGE_KEY`, `SOURCE_REVOKED`, `SOURCE_NOT_FOUND`, `VERSION_NOT_FOUND`, `NO_CHUNKS`, `SENSITIVITY_BLOCKED`
— any of these → immediate dead_letter (no retry).

## Architecture

### Queue abstraction
- `IIngestionQueue` interface at `src/lib/ingestionQueue/IIngestionQueue.ts`
- `DatabaseIngestionQueue` — wraps ingestion_jobs with raw SQL for atomic claim
- `SqsIngestionQueue` — stub; throws unless `SQS_INGESTION_QUEUE_URL` is set
- Factory: `getIngestionQueue()` reads `KNOWLEDGE_QUEUE_PROVIDER` env (default `database`)
- Reset singleton for tests: `_resetQueueInstance()`

### Worker
- `KnowledgeIngestionWorker` class at `src/workers/knowledgeIngestionWorker.ts`
- In-process singleton: `startInProcessWorker()` / `stopInProcessWorker()` / `getInProcessWorker()`
- Started in `index.ts` when `KNOWLEDGE_WORKER_MODE=in-process` (default)
- Sweeper runs every `KNOWLEDGE_WORKER_SWEEP_MS` (default 60s)
- Heartbeat every `KNOWLEDGE_WORKER_HEARTBEAT_MS` (default 15s)
- Poll every `KNOWLEDGE_WORKER_POLL_MS` (default 5s) — polls immediately after each job

### Auto-enqueue trigger
- `knowledgeSources.ts` complete-upload handler calls `triggerIngestionJob()` (fire-and-forget)
- Skipped for duplicates and revoked/deleted sources
- Response now includes `ingestionQueued: boolean`

### Pipeline cancellation
- `ingestionPipelineService.ts` has `checkCancellation(jobId, orgId)` called before each stage
- On `CancellationError`: soft-deletes partial chunks, calls `queue.finaliseCancellation()`, returns normally
- `cancelIngestionJob()` in jobService: queued→`cancelled`; processing statuses→`cancelling`

### Health
- `workerHealthService.ts` — in-memory counters: processed/succeeded/failed/deadLettered, current job, avg duration
- `GET /v1/platform/knowledge-worker/health` — platform_admin only
- `POST /v1/platform/knowledge-worker/recover-stuck` — platform_admin only

## Environment variables
| Var | Default | Purpose |
|-----|---------|---------|
| KNOWLEDGE_QUEUE_PROVIDER | `database` | `database` or `sqs` |
| KNOWLEDGE_WORKER_MODE | `in-process` | `in-process` or `external` |
| KNOWLEDGE_WORKER_HEARTBEAT_MS | 15000 | Heartbeat interval |
| KNOWLEDGE_WORKER_LEASE_MS | 120000 | Lease duration per job |
| KNOWLEDGE_WORKER_POLL_MS | 5000 | Idle poll interval |
| KNOWLEDGE_WORKER_SWEEP_MS | 60000 | Stuck-job sweeper interval |

## Test count
1,606 tests (32 new in task19-queue-worker.test.ts)

## REQUIRED_RLS_TABLES
Still 60 — no new tables, only new columns on existing `ingestion_jobs`.

## Known gotchas
- `vi.mock` path for auditService must be `../services/auditService.js` (not `../../...`) from `src/__tests__/`
- `vi.clearAllMocks()` must be called inside each describe block that shares mockDb.execute across tests
- `logOrgEvent` in `queue.fail()` is fire-and-forget — need `await Promise.resolve()` before asserting it was called
- `cancelIngestionJob` throws `IngestionJobError` with `.code = "CANNOT_CANCEL"` — use `.rejects.toMatchObject({ code: "CANNOT_CANCEL" })` not `.toThrow("CANNOT_CANCEL")`
- `DatabaseIngestionQueue` uses raw `db.execute(sql\`...\`)` for claim/heartbeat/fail (need RETURNING column snake_case)
- The `ingestionPipelineService.ts` is a full rewrite — it now calls `queue.complete()` / `queue.fail()` via `getIngestionQueue()` instead of direct service calls
