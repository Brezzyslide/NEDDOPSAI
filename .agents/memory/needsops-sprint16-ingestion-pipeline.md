---
name: NeedsOps Task #16 — Document Ingestion & Embedding Pipeline
description: Ingestion pipeline for Organisation Library; pgvector, extractors, chunking, injection check, job queue, routes, 1,649 tests.
---

## Key decisions

### pgvector custom Drizzle type
- `lib/db/src/schema/knowledgeChunks.ts` defines `pgVector` custom type with `dataType`, `toDriver`, `fromDriver`
- `toDriver`: `number[] → "[0.1,0.2,...]"` (pgvector wire format)
- `fromDriver`: `"[0.1,0.2,...]" → number[]`
- Config: `{ dimensions: 1536 }`
- **Why:** Drizzle ORM has no native pgvector type; custom type pattern is the only supported approach.

### objectStorage download in pipeline
- `ObjectStorageService` has NO buffer-download method — only signed URL generation and entity file lookup.
- To download a file buffer in the ingestion pipeline, construct GCS path directly:
  `PRIVATE_OBJECT_DIR + "/" + storageKey` → parse bucket/object → `bucket.file(name).download()`
- **Why:** knowledgeStorageService adapter only exposes upload URLs + signed read URLs; not a streaming/buffer API.
- AWS equivalent: `S3.getObject({ Bucket, Key }) → .Body.transformToByteArray()`

### Worker polling pattern
- `processNextIngestionJob()` in `ingestionPipelineService.ts` claims + processes one job
- Uses PostgreSQL `FOR UPDATE SKIP LOCKED` via raw `db.execute(sql\`...\`)` — safe for concurrent workers
- No daemon is started — callers must poll (e.g. cron, manual trigger, or future persistent worker)
- **Why:** Consistent with specialistQueueService pattern; daemonizing in Express startup was rejected.

### Injection check is DETECTION-ONLY
- `injectionCheckService.ts` scans chunks for 12 patterns at ingestion time
- High-severity flags set `requiresHumanReview: true` → job stays at `review_required`, cannot auto-approve
- Never logs or exposes matched text content — only flag code + severity in audit events
- **Why:** Defence-in-depth; runtime protections come in Task #17.

### Embedding sensitivity gate
- `embeddingProviderRegistry.ts`: `sensitivityClassification === "restricted"` → always NullEmbeddingProvider
- No OPENAI_API_KEY → NullEmbeddingProvider (graceful degradation, lexical-only retrieval)
- **Why:** Restricted docs must never leave the platform; lexical search is the fallback.

### Chunking strategy versioning
- `chunkingStrategy` + `chunkingStrategyVersion` columns on `knowledge_chunks`
- Current: `"heading_aware_v1"` / `"1.0.0"`
- Bump strategy version when chunk boundaries change → triggers re-embedding
- **Why:** Without versioning, stale chunks from old strategies pollute retrieval.

### Regex test pitfall
- `"|"` in regex patterns is OR operator — use `str.split(literal).length - 1` for literal occurrence counting in tests
- Alternatively escape special chars: `literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')`

## REQUIRED_RLS_TABLES
- Now **60** (59 after Task #15, +1 `ingestion_jobs` in Task #16)
- Three test files assert this count: `sprint7-rls-safety.test.ts`, `sprint-knowledge-bridge.test.ts`, `task15-knowledge-schema.test.ts`
- Update all three when adding new tables in Task #17+

## Files added
- `lib/db/src/schema/knowledgeChunks.ts` — updated with pgVector custom type + chunking strategy columns
- `lib/db/src/schema/ingestionJobs.ts` — new table + INGESTION_JOB_STATUSES/TRANSITIONS exports
- `lib/ai-gateway/src/providers/openai.ts` — added `callOpenAIEmbeddings()` + `getEmbeddingDimensions()`
- `lib/ai-gateway/src/index.ts` — exports OpenAIEmbeddingResult + embedding functions
- `artifacts/api-server/src/lib/extractors/` — 4 extractor files (interface, pdf, docx, text, registry)
- `artifacts/api-server/src/lib/embeddings/` — 4 embedding files (interface, null, openai, registry)
- `artifacts/api-server/src/services/normalisationService.ts`
- `artifacts/api-server/src/services/chunkingService.ts`
- `artifacts/api-server/src/services/injectionCheckService.ts`
- `artifacts/api-server/src/services/ingestionJobService.ts`
- `artifacts/api-server/src/services/ingestionPipelineService.ts`
- `artifacts/api-server/src/routes/v1/ingestion.ts` — 10 endpoints
- `lib/db/migrations/task16-ingestion.sql` — applied to live DB

## Test count
- 1,574 pre-existing tests pass
- 75 new tests added in `src/tests/task16-*.test.ts`
- Total: **1,649 tests**
