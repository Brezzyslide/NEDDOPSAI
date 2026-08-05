# Knowledge Execution Architecture

> **Scope:** This document traces a single policy document — a fictional *Medication Administration Policy* — through every stage of the NeedsOps knowledge pipeline, from the moment an admin uploads it to the audit trail entry that confirms a specialist cited it in completed work.
>
> Use this document for debugging, onboarding, and architectural review. File paths are workspace-relative; table names refer to the per-tenant Postgres schema provisioned for each organisation.

---

## Pipeline at a glance

```
 ┌─────────────┐
 │   UPLOAD    │  Admin uploads PDF via web portal
 └──────┬──────┘
        │ knowledge_sources + knowledge_source_versions (status=uploaded)
        ▼
 ┌─────────────┐
 │  APPROVAL   │  Platform admin or org admin approves the source
 └──────┬──────┘
        │ knowledge_sources.status = 'approved'
        ▼
 ┌─────────────┐
 │  INGESTION  │  Background queue claims the job and extracts text
 └──────┬──────┘
        │ ingestion_jobs row transitions: queued → processing → complete
        ▼
 ┌─────────────┐
 │  CHUNKING   │  Extracted text is split into indexed, token-bounded chunks
 └──────┬──────┘
        │ knowledge_chunks rows inserted
        ▼
 ┌─────────────┐
 │  EMBEDDING  │  Each chunk receives a pgvector embedding + tsvector index
 └──────┬──────┘
        │ knowledge_chunks.embedding populated
        ▼
 ┌──────────────────┐
 │ HYBRID RETRIEVAL │  Semantic cosine + BM25-style lexical search at query time
 └────────┬─────────┘
          │ RawChunk[] ordered by base score
          ▼
 ┌───────────────┐
 │ EVIDENCE PACK │  Chunks deduped, confidence-filtered, enriched, cached
 └──────┬────────┘
        │ EvidencePack with citationsByType[]
        ▼
 ┌──────────────────────┐
 │  RUNTIME MANIFEST    │  Immutable snapshot of all inputs bound to this run
 └───────────┬──────────┘
             │ work_package_manifests row
             ▼
 ┌────────────────┐
 │   SPECIALIST   │  LLM call with evidence section + specialist constitution
 └──────┬─────────┘
        │ draft text + self-review
        ▼
 ┌─────────────────┐
 │ COMPLETED WORK  │  Draft stored; submitted → approved lifecycle
 └──────┬──────────┘
        │ completed_work + completed_work_assets (citationRef)
        ▼
 ┌─────────────┐
 │ AUDIT TRAIL │  Every transition recorded; retrieval query persisted
 └─────────────┘
```

---

## Stage 1 — Upload

**What happens:** An org admin visits the Org Library page in the web portal. The browser sends the file directly to object storage (GCS via a signed URL proxy), then calls the completion endpoint to register the source in the database.

**Entry point:** `POST /v1/organisations/:orgSlug/library/sources` → `artifacts/api-server/src/routes/v1/knowledgeSources.ts`

**Core service:** `artifacts/api-server/src/services/knowledgeSourceService.ts`
- `findDuplicateChecksum(checksum, orgId)` — rejects an exact-duplicate file before the source row is created; returns the existing current version idempotently if the same binary is re-submitted.
- `completeUpload(input)` — validates source type, authority level, sensitivity classification, scope (library vs task), and inserts two rows atomically:
  - `knowledge_sources` — parent record; `status = 'uploaded'`; `isCurrent = true`
  - `knowledge_source_versions` — version record; `isCurrent = true`; `ingestionStatus = 'pending'`

**DB tables written:**

| Table | Key columns set |
|---|---|
| `knowledge_sources` | `id`, `organizationId`, `title`, `sourceType`, `authorityLevel`, `sensitivityClassification`, `sourceScope`, `status='uploaded'` |
| `knowledge_source_versions` | `id`, `knowledgeSourceId`, `versionLabel`, `storageKey`, `checksum`, `fileSize`, `mimeType`, `ingestionStatus='pending'` |

**Guards:**
- Org must be provisioned and the actor must hold the `library:write` permission.
- `sourceType` must be a member of the allowed enum (`policy`, `procedure`, `legislation`, `guidance`, `training`, `template`, …).
- Duplicate checksum within the same org returns a 409 rather than creating a duplicate row.
- Source title is trimmed; empty title is rejected.

**Emits:** `knowledge.source.uploaded` via `logOrgEvent` (best-effort, non-blocking).

---

## Stage 2 — Approval

**What happens:** An authorised reviewer reads the uploaded policy, decides it is fit for use by specialists, and approves it. Only approved, current sources participate in retrieval.

**Entry point:** `POST /v1/organisations/:orgSlug/library/sources/:sourceId/approve` → `knowledgeSources.ts` router

**Core service:** `knowledgeSourceService.ts`
- `approveKnowledgeSource(sourceId, orgId, actorUserId)` — sets `knowledge_sources.status = 'approved'`.
- Complementary operations: `revokeKnowledgeSource` (sets `status = 'revoked'`, records `revokedAt`), `supersedeKnowledgeSource` (links old source to replacement, sets `status = 'superseded'`).
- `replaceSourceVersion` (Sprint 27.3) — uploads a new file for an existing source *without* resetting approval status. The approved document remains visible to the pipeline during re-ingestion of the new version.

**DB tables written:**

| Table | Columns updated |
|---|---|
| `knowledge_sources` | `status = 'approved'` |
| `knowledge_source_versions` | `status = 'approved'` on active version |
| `knowledge_source_scopes` | populated if scope assignment accompanies approval |

**Retrieval gate:** `hybridRetrievalService` hard-filters on `ks.status = 'approved' AND ks.is_current = true AND kc.deleted_at IS NULL`. A document that is not approved is **invisible** to specialists regardless of ingestion state.

**Emits:** `knowledge.source.approved` (or `revoked` / `superseded`) via `logOrgEvent`.

---

## Stage 3 — Ingestion

**What happens:** A background worker picks up the `ingestion_jobs` row for this version, downloads the file from object storage, and extracts structured text from the PDF (or DOCX, TXT, etc.).

**Implementation:** `artifacts/api-server/src/lib/ingestionQueue/DatabaseIngestionQueue.ts`
- Uses PostgreSQL `SELECT … FOR UPDATE SKIP LOCKED` to claim jobs atomically — multiple worker instances cannot double-claim the same job.
- Heartbeat updates prevent stale leases from blocking the queue.
- On failure: increments `attemptCount`; if `attemptCount` ≥ `maxAttempts`, transitions job to `dead_lettered`. Errors must not create partial or searchable chunks.

**Supporting services:**
- `knowledgeStorageService.ts` — downloads the binary from GCS via the object-storage proxy (GCS signed URLs are not available in the Replit sidecar environment; all GCS access goes through the API server's own credentials using `file.save(buffer)`).
- `knowledgeOrchestrationEngine.ts` — coordinates extraction, chunking, embedding, and audit in sequence.

**DB tables written:**

| Table | Columns updated |
|---|---|
| `ingestion_jobs` | `status: queued → processing → complete` (or `failed` / `dead_lettered`) |
| `knowledge_source_versions` | `ingestionStatus`, `ingestionMetadata` (error message, page count, etc.) |

**Auto-enqueue triggers:**
- `completeUpload` enqueues a job automatically when the source is created.
- `replaceSourceVersion` enqueues a job fire-and-forget after the transaction, using the pre-computed `newVersionId` UUID (not `newVersion.id`) to avoid a race with the post-transaction SELECT.
- `supersedeKnowledgeSource` enqueues a job for the new source alongside a curation job for the old.

---

## Stage 4 — Chunking

**What happens:** The extracted plain text is split into overlapping, token-bounded chunks. Each chunk captures its position in the original document (section title, heading path, page number, chunk index).

**Implementation:** Inside the ingestion worker / `knowledgeOrchestrationEngine.ts`; inserts rows into `knowledge_chunks`.

**Chunking strategy:**
- Token budget per chunk is configurable (default ~512 tokens).
- Section headings and page numbers from the PDF parser are preserved as chunk metadata so citations can reference `Section 4, p. 12` rather than a raw byte offset.
- `contentHash` (SHA-256 of chunk text) enables deduplication if the same document is re-ingested.

**DB table written:**

| Table | Key columns |
|---|---|
| `knowledge_chunks` | `id`, `organizationId`, `knowledgeSourceId`, `sourceVersionId`, `chunkIndex`, `sectionTitle`, `headingPath`, `pageNumber`, `text`, `tokenCount`, `contentHash` |

**Guard:** If the parser produces zero chunks (empty document, corrupt PDF), the job transitions to `failed` and the version is marked with an explanatory `ingestionMetadata` error.

---

## Stage 5 — Embedding

**What happens:** Each chunk text is sent to the configured embedding provider (OpenAI `text-embedding-3-small` when `AI_PROVIDER=openai`; a deterministic stub otherwise). The resulting vector and a PostgreSQL `tsvector` for full-text search are stored on the chunk row.

**Implementation:** Inside `knowledgeOrchestrationEngine.ts` / `knowledgeStorageService.ts`.

**DB columns written on `knowledge_chunks`:**

| Column | Type | Purpose |
|---|---|---|
| `embedding` | `vector(1536)` (pgvector) | Cosine-similarity semantic search |
| `embeddingModel` | `text` | Records which model version produced the vector |
| (implicit) | `tsvector` (GIN index) | PostgreSQL full-text search for lexical scoring |

**Failure handling:** An embedding provider failure causes the job to fail and retry. Chunks with no embedding are still stored but receive a semantic score of 0.0 at retrieval time because the current pipeline passes `queryEmbedding: null` (lexical-only mode). Semantic scoring is available but requires a query embedding to be passed into `hybridRetrievalService.retrieveChunks`.

---

## Stage 6 — Hybrid Retrieval

**What happens:** When a specialist is dispatched, the pipeline asks `hybridRetrievalService` for the most relevant chunks across approved sources. Semantic and lexical scores are combined and adjusted by freshness and authority.

**Entry point:** `artifacts/api-server/src/services/hybridRetrievalService.ts` → `retrieveChunks(input)`

**Scoring formula:**

```
baseScore = (semanticScore × 0.6) + (lexicalScore × 0.4)
            + freshnessBonus   (computeFreshnessBonus — recency decay)
            + authorityBonus   (computeAuthorityBonus — primary/mandatory bump)
```

**Hard filters applied inside the SQL query:**

| Filter | Reason |
|---|---|
| `ks.organization_id = $orgId` | Tenant isolation — never crosses org boundary |
| `ks.status = 'approved'` | Only approved sources are searchable |
| `ks.is_current = true` | Superseded versions are excluded |
| `kc.deleted_at IS NULL` | Soft-deleted chunks are excluded |
| Effective date range | `effective_from ≤ today ≤ effective_to` (if set) |
| `kc.sensitivity_classification` | Matched against specialist's clearance level |
| Source scope | `org_library`, specialist-scoped, or `task_upload` depending on context |

**DB tables read:** `knowledge_chunks` (aliased `kc`), `knowledge_sources` (aliased `ks`), `knowledge_source_versions`.

**Writes:** `retrieval_audit_events` — every call writes the query, matched chunk IDs, scores, and selection reasons, providing a permanent record of what the specialist was shown and why.

---

## Stage 7 — Evidence Pack

**What happens:** Raw chunks from hybrid retrieval are assembled into a structured `EvidencePack` that the pipeline injects into the specialist's prompt. Chunks are deduplicated, confidence-filtered, version-label–enriched, and grouped by source type.

**Entry point:** `artifacts/api-server/src/services/knowledgeResolutionService.ts` → `resolveEvidence(input)`

**`EvidencePack` shape:**

```typescript
{
  totalChunks: number;
  chunks: EvidenceChunk[];          // ordered by authority, type, confidence
  citationsByType: {                // grouped: legislation | policy | procedure | …
    [sourceType: string]: EvidenceChunk[];
  };
  sourceIds: string[];
  retrievalMetrics: {
    cacheHit: boolean;
    libraryChunks: number;
    taskUploadChunks: number;
    totalTokens: number;
  };
}
```

**Key behaviours:**

- **Confidence gate** — chunks with `baseScore < 0.05` are discarded before packing.
- **Task-upload path** — for uploads attached to the current task, chunks are fetched via a direct `db.select().from(knowledge_chunks).where(sourceId IN [...]).orderBy(chunkIndex).limit(500)` query (not via hybrid retrieval, because no `taskId` scoping is available in all pipeline contexts).
- **In-process cache** — keyed on `executionId`; a second call for the same execution returns instantly without re-querying. `invalidateEvidenceCache(executionId)` forces fresh retrieval.
- **Enrichment** — batch lookups for version labels (`knowledge_source_versions`) and source types (`knowledge_sources`) use `.limit(500)` and `.limit(200)` safety caps.

**`buildEvidenceSection(pack)`** converts the `EvidencePack` into the `=== AUTHORITATIVE EVIDENCE ===` block injected into the specialist's prompt:

```
=== AUTHORITATIVE EVIDENCE ===

--- Legislation ---
[Disability Services Act 2006, v1, Section 3, p.7]
Every person with disability has the right to receive support services…

--- Organisation Policy ---
[Medication Administration Policy, v3, Section 4, p.12]
All medications must be administered by a qualified registered nurse…
```

**`buildCitationSummary(pack)`** produces a JSON-serialisable array stored in `completed_work_assets` so the citation trail survives the execution.

---

## Stage 8 — Runtime Manifest

**What happens:** Before the LLM is called, the pipeline assembles an immutable snapshot of every input bound to this execution: which specialist, which blueprint, which library sources, which org memory entries, which task uploads. This is the manifest — it is written once and never mutated.

**Entry point:** `artifacts/api-server/src/services/workPackageService.ts` → `assembleWorkPackage(input)`

**Blueprint selection** (called in Step 2 of the pipeline, before the manifest is assembled):
- `workBlueprintService.selectBlueprint(userRequest, orgId)` — two-stage:
  1. **Keyword fast path** — substring match against `BLUEPRINT_KEYWORDS` dictionary; returns instantly with no LLM call.
  2. **LLM semantic fallback** — `classifyBlueprintWithLLM(userRequest, orgId)` — only fires when keyword confidence = 0 AND `AI_PROVIDER=openai`; applies a 0.6 confidence gate to prevent weak guesses from routing to the wrong specialist.
- Org-published blueprints (`status=published`, `organizationId IS NOT NULL`) take precedence over built-in blueprints for the same `code`.

**`WorkPackageManifest` shape (stored in `work_package_manifests`):**

```typescript
{
  id: string;                         // manifest UUID
  executionId: string;                // links to execution audit
  organizationId: string;
  primarySpecialist: string;          // e.g. "operations_manager"
  supportingSpecialists: string[];
  blueprintId: string | null;
  blueprintVersion: string | null;
  organisationLibrarySources: [       // approved library sources
    { sourceId, title, sourceType, authorityLevel, versionLabel, storageKey }
  ];
  taskUploads: [                      // task-scoped uploads
    { sourceId, title, sourceType, storageKey }
  ];
  cosMemories: OrganisationMemory[];  // Chief of Staff memory entries
  specialistMemories: OrganisationMemory[];
  entityKnowledge: Record<string, …>;
  modelVersion: string | null;
  promptVersion: string;
  assembledAt: Date;
}
```

**DB table written:** `work_package_manifests` — append-only; never updated after insertion.

**Validation gate:** `validateWorkPackage` in the pipeline checks that required library knowledge, entity knowledge, and memory entries declared in the blueprint are present. Missing required inputs transition the execution to `awaiting_clarification` and request the missing data from the user rather than running a degraded draft.

---

## Stage 9 — Specialist

**What happens:** The pipeline constructs a system prompt from the specialist's Employee File (constitution, personality, prohibited phrases, output format) and a work-package prompt from the manifest + evidence pack, then calls the AI gateway. A self-review pass scores the draft against quality dimensions before it is stored.

**Entry point:** `artifacts/api-server/src/services/workExecutionPipelineService.ts` → `executeWork(input)`

**Pipeline steps:**

| Step | What happens |
|---|---|
| 1 | Load specialist Employee File and runtime config |
| 2 | Select blueprint (`selectBlueprint`) |
| 3 | Validate work package inputs (clarification gate) |
| 4 | `resolveEvidence` + `retrieveApprovedExamples` (run in parallel) |
| 5 | Assemble manifest (`assembleWorkPackage`) |
| 6 | Build work-package prompt (`buildWorkPackagePrompt`) including `=== AUTHORITATIVE EVIDENCE ===` section |
| 7 | Call AI gateway → draft text |
| 8 | Self-review (`reviewDraft`) — 10 quality dimensions scored 0–10 |
| 9 | `createDraft` → store result in `completed_work` |

**`buildWorkPackagePrompt` structure:**

```
[Specialist System Prompt — from Employee File]

=== WORK REQUEST ===
{userRequest}

=== AUTHORITATIVE EVIDENCE ===
--- Legislation ---
[citation] chunk text…

--- Organisation Policy ---
[citation] chunk text…

=== ORGANISATION CONTEXT ===
{cosMemories + specialistMemories}

=== QUALITY REQUIREMENTS ===
{blueprintValidationRules + successCriteria}
```

**Specialist context loading** — `specialistContextService.ts` (`loadSpecialistContext`, `buildSpecialistContext`) hydrates the specialist's language profile, approved memory, and (if wired) knowledge orchestration results. Context failures degrade gracefully rather than aborting.

**Error handling:**
- Draft generation failure → `execution_failed` status; user is notified via SSE.
- Evidence retrieval failure → non-fatal; pipeline continues with metadata-only fallback and a warning label in the prompt.
- Token budget overrun → memory entries are truncated (most-recent first, oldest dropped).

---

## Stage 10 — Completed Work

**What happens:** The approved draft is stored as a versioned, status-tracked record. Org members can submit it for review, approve it, reject it, add comments, and export it. Each asset references back to its source knowledge via `citationRef`.

**Core service:** `artifacts/api-server/src/services/completedWorkService.ts`

**Lifecycle:**

```
draft → awaiting_approval → approved
                         ↘ rejected → draft (rework)
approved → archived
archived → reopened → draft
```

**DB tables written:**

| Table | Purpose |
|---|---|
| `completed_work` | Parent record; holds current status, specialist, org, manifest ref |
| `completed_work_versions` | Immutable content snapshots; each approval cycle creates a new version |
| `completed_work_assets` | Per-source-chunk citation refs; `citationRef` field stores `"Policy, v3, Section 4, p.12"` |
| `completed_work_comments` | Reviewer comments threaded per version |

**`completed_work_assets` citation trail:**
The pipeline constructs `assetIds` from the evidence pack's chunks — one entry per unique `sourceId` — and sets `citationRef` to the formatted citation string. This means every approved completed work item carries a permanent, human-readable record of which document version and section the specialist drew on.

**Export:** PDF and DOCX export stubs are wired at the route level; the citation assets are available for inclusion in export templates so the evidence trail survives outside the system.

---

## Stage 11 — Audit Trail

**What happens:** Every significant transition — upload, approval, ingestion status change, execution start/end, completed-work status change — is written to the audit log. Retrieval queries are persisted separately with full scoring detail.

**Core service:** `artifacts/api-server/src/services/auditService.ts`
- `logOrgEvent(event)` — writes to the per-tenant `org_audit_log` table via the org's connection pool. Falls back to the public `org_audit_log` if the org schema is not yet provisioned. Swallows fallback-insert failures silently (audit must never abort a business operation).
- `writeAuditEvent` / `log` — lower-level writers used for platform-scoped events that go to `platform_audit_log`.

**Retrieval audit** — `knowledgeOrchestrationEngine.ts` writes one `retrieval_audit_events` row per retrieval call:

| Column | Content |
|---|---|
| `executionId` | Links to the execution that triggered retrieval |
| `queryText` | The user request used as the retrieval query |
| `chunkIds` | Array of chunk UUIDs returned |
| `sourceIds` | Array of source UUIDs cited |
| `scores` | Per-chunk `{ semanticScore, lexicalScore, baseScore, freshnessBonus, authorityBonus }` |
| `selectionReasons` | Why each chunk was included (`library`, `task_upload`, `memory`, etc.) |
| `metrics` | Total tokens, latency, cache hit |

**DB tables written:**

| Table | Scope |
|---|---|
| `org_audit_log` | Per-org events: upload, approve, revoke, supersede, execute, complete, transition |
| `platform_audit_log` | Platform-level events: org provisioning, plan changes, staff actions |
| `retrieval_audit_events` | Per-execution retrieval query detail with full scoring |

---

## End-to-end data lineage for the example policy

```
knowledge_sources.id = "src-medpol-001"
  └─ knowledge_source_versions.id = "ver-medpol-v3"
       └─ ingestion_jobs.id = "job-abc123"   (status=complete)
            └─ knowledge_chunks rows (ids: chunk-001 … chunk-047)
                 └─ retrieval_audit_events row (executionId="exec-xyz")
                      └─ work_package_manifests.id = "wpm-456"
                           └─ completed_work.id = "cw-789"
                                └─ completed_work_assets rows
                                     citationRef = "Medication Administration Policy, v3, Section 4, p.12"
                                          └─ org_audit_log (event=completed_work.approved)
```

---

## Key invariants

| Invariant | Where enforced |
|---|---|
| Only approved, current sources appear in retrieval | `hybridRetrievalService` SQL hard filter |
| Approval status is preserved across version replacements | `replaceSourceVersion` — `status` field is intentionally absent from the `UPDATE SET` |
| Each manifest is immutable | `work_package_manifests` is append-only; no UPDATE path exists |
| Chunks below 0.05 confidence are never sent to the specialist | `resolveEvidence` confidence gate |
| Audit writes never abort business operations | `logOrgEvent` wraps all writes in `.catch(() => {})` |
| Tenant isolation is enforced at every DB query | All service functions include `organizationId` in every query predicate; enforced again by Postgres RLS policies (70 tables verified at startup) |
| LLM semantic blueprint classification only fires when keyword confidence = 0 | `selectBlueprint` two-stage gate in `workBlueprintService.ts` |

---

## File index

| Stage | Primary file |
|---|---|
| Upload | `artifacts/api-server/src/services/knowledgeSourceService.ts` |
| Approval | `artifacts/api-server/src/services/knowledgeSourceService.ts` |
| Ingestion | `artifacts/api-server/src/lib/ingestionQueue/DatabaseIngestionQueue.ts` |
| Chunking | `artifacts/api-server/src/lib/knowledgeOrchestrationEngine.ts` |
| Embedding | `artifacts/api-server/src/lib/knowledgeOrchestrationEngine.ts` + `knowledgeStorageService.ts` |
| Hybrid Retrieval | `artifacts/api-server/src/services/hybridRetrievalService.ts` |
| Evidence Pack | `artifacts/api-server/src/services/knowledgeResolutionService.ts` |
| Runtime Manifest | `artifacts/api-server/src/services/workPackageService.ts` + `workBlueprintService.ts` |
| Specialist | `artifacts/api-server/src/services/workExecutionPipelineService.ts` + `specialistContextService.ts` |
| Completed Work | `artifacts/api-server/src/services/completedWorkService.ts` |
| Audit Trail | `artifacts/api-server/src/services/auditService.ts` + `knowledgeOrchestrationEngine.ts` |

**DB schema files** (`lib/db/src/schema/`): `knowledgeSources.ts`, `knowledgeSourceVersions.ts`, `knowledgeSourceScopes.ts`, `knowledgeChunks.ts`, `ingestionJobs.ts`, `retrievalAuditEvents.ts`, `workPackageManifests.ts`, `completedWork.ts`, `completedWorkVersions.ts`, `completedWorkAssets.ts`, `orgAuditLog.ts`

**RLS table inventory:** `lib/org-db/src/rlsVerifier.ts` → `REQUIRED_RLS_TABLES` (70 tables verified at every server startup)
