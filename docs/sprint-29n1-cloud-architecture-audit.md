# Sprint 29N.1 — Cloud Source-of-Truth, Reasoning & Tooling Responsibility Audit

**Date:** 8 August 2026  
**Type:** Investigation Only — NO CODE CHANGES  
**Scope:** NeedsOps Cloud model only. Desktop Connector, OpenClaw local runtime, relay bridge, hybrid execution and device tooling are explicitly excluded.  

**Evidence standard:** L1 (code/source inspection) throughout. All findings are from direct file and line inspection via read-only explorers.

---

## Final Verdict

**CLOUD MODEL CLEAR — OPENAI IS PRIMARY REASONING ENGINE**

The Cloud model is architecturally coherent and does exactly what the hypothesis predicts: NeedsOps selects and governs the source of truth; OpenAI reads and reasons over the evidence; OpenClaw is not needed for knowledge work. The responsibility boundary is clean and largely already enforced by design. The significant qualification is that several post-generation validation steps (claim extraction, semantic support, absence verification) also call OpenAI — these are AI-assisted governance checks, not open-ended reasoning, but they are model-dependent and this has cost/latency implications.

---

## Part A — Current Cloud Architecture Diagram

```
USER MESSAGE
     │
     ▼
ConversationService (find-or-create conversation)
     │
     ▼
ExecutionClassifier
  ├── TRANSIENT → UEE conversation path (SSE response, no Completed Work)
  ├── PROFESSIONAL_WORK → intent → CoS → approval → UEE task path
  └── EVIDENCE_BEARING → same as professional + hard evidence gate
     │
     ▼  [task path]
ExecutionCoordinatorService
  (idempotency, approval, checkpoint, SSE events)
     │
     ▼
UnifiedExecutionEngine.execute() [task trigger]
  ├── checkExecutionReadiness
  │     ├── principal/plan/specialist readiness
  │     ├── entitlement gate (capabilityAccessDecisionService)
  │     └── connector readiness (optional — Cloud works without connector)
  ├── Blueprint selection (keyword/semantic match)
  ├── Work package + manifest assembly
  │     ├── specialistRuntimeManifestService → DNA manifest
  │     └── organisationRuntimeService → ExecutionPackage
  ├── ResourceRegistry.resolveEvidenceForTask()
  │     └── KRS (knowledgeResolutionService)
  │           ├── SQL: approved + is_current + tenant_scope + authority scoring
  │           ├── Retrieval: lexical (production) / vector (available, inactive)
  │           └── Returns: EvidencePack (chunks with text, confidence, citation)
  ├── [Hard evidence gate — blocks if required evidence absent]
  ├── ExecutionSession + CanonicalExecutionContext creation
  ├── executionContextBuilderService (context assembly)
  ├── AI Gateway call → OpenAI gpt-4o
  │     ├── System: specialist manifest + blueprint + output schema
  │     └── User: task description + evidence passages + org context
  │           [JSON response — findings, gaps, recommendations, draft content]
  ├── Output validation + action proposal extraction
  ├── selfReviewService → OpenAI (quality dimensions) [second LLM call]
  ├── Completed Work draft creation (completedWorkService)
  ├── [Async] Claim emission → OpenAI [third LLM call]
  ├── [Async] Claim validation (semantic support) → OpenAI [further LLM calls]
  ├── [Async] Absence verification → KRS + OpenAI [further LLM calls]
  ├── submitForApproval
  ├── Evidence snapshots + provenance chain
  └── Audit (logOrgEvent)
     │
     ▼
Approval workflow (human)
     │
     ▼
completedWorkService.approve()
  (pins approvedVersionId, no content change, no export, no action dispatch)
     │
     ▼
On-demand export
  completedWorkExportService
    ├── normaliseCompletedWorkContent (deterministic formatter, no LLM)
    ├── PDF: pdfkit (real, not stub)
    └── DOCX: docx library (real, not stub)
```

---

## Part B — Source-of-Truth Path

**For "Review our Complaints Management Policy and identify gaps, contradictions and recommendations":**

### Stage 1 — Document Upload / Ingestion (prior to the request)
1. User uploads PDF/DOCX to Organisation Library
2. `ingestionPipelineService` extracts text (provider-specific extractors for PDF, DOCX, plain text)
3. Text is chunked (size-bounded chunks with section metadata where available)
4. Embeddings generated (embedding model via AI Gateway) and stored in `knowledge_chunks.embedding` (pgVector column)
5. Chunks stored in `knowledge_chunks` table with: `organization_id`, `source_id`, `source_version_id`, `text`, `embedding`, `lexical_search_vector`, `sensitivity`, `section_title`, `page_number`
6. Source version stored with: `status` (`approved` after review), `is_current` (true for active version), `canonical_title`, `search_aliases`, `effective_from`, `effective_to`, `authority_level`

### Stage 2 — Request Arrives

User sends: "Review our Complaints Management Policy and identify gaps, contradictions and recommendations."

1. `ConversationService` stores the message
2. `ExecutionClassifier` routes to `EVIDENCE_BEARING` lane (policy review + gap analysis = professional work requiring evidence)
3. CoS interprets intent, creates an execution intent
4. Human (or auto-dispatch with confidence ≥ 0.85) approves
5. `ExecutionCoordinatorService` claims the intent and dispatches

### Stage 3 — Evidence Selection (NeedsOps-owned)

`UnifiedExecutionEngine` → `ResourceRegistry.resolveEvidenceForTask()` → `knowledgeResolutionService`

KRS applies these filters **before any chunk reaches the model:**

| Filter | Applied where | Effect |
|---|---|---|
| `organization_id = $orgId` | SQL WHERE | Strict tenant scope |
| `kc.status = 'approved'` | SQL WHERE | Unapproved sources excluded |
| `kc.is_current = true` | SQL WHERE | Superseded versions excluded |
| `effective_from <= now()` | SQL WHERE | Not-yet-active sources excluded |
| `effective_to >= now()` | SQL WHERE | Expired sources excluded |
| Sensitivity level | SQL WHERE | Sensitivity gate per user context |
| Confidence score < 0.05 | Post-SQL | Low-relevance chunks dropped |
| Authority level | Scoring bonus | mandatory +0.30, primary +0.20, reference −0.05 |
| Source type priority | Ranking | policy > procedure > guideline > other |
| Deduplication | Post-retrieval | Same-source near-duplicates merged |
| Library limit: 20 chunks | Hard cap | Prevents prompt overflow |
| Upload/task limit: 10 chunks | Hard cap | Same |

**NeedsOps decides what evidence is authorised and authoritative before the model sees anything.** OpenAI has no ability to override or bypass these filters.

### Stage 4 — Evidence Delivered to Model

Chunks are assembled into `EvidencePack` and injected into the prompt via `buildEvidenceSection()`. The model receives: chunk text, source title, version label, section title, page number, confidence score, citation reference, selection reason. It does **not** receive full document text.

**Who owns source-of-truth selection in Cloud?** NeedsOps — entirely. KRS resolves, filters, scores and caps evidence before it touches the model.

---

## Part C — Document Read Path (Three-Layer Separation)

### Layer 1 — File Ingestion
| Responsibility | Service | What it does |
|---|---|---|
| Text extraction | `ingestionPipelineService` (provider extractors) | Extracts raw text from PDF, DOCX, TXT at upload time |
| Chunking | Chunking module inside ingestion pipeline | Splits text into bounded chunks |
| Embedding | AI Gateway (embedding model) | Generates vector for each chunk |
| Storage | `knowledge_chunks` table | Stores text, embedding, metadata per chunk |
| Authority metadata | `knowledge_source_versions` table | Stores approved status, is_current, authority_level, effective dates |

### Layer 2 — Retrieval
| Responsibility | Service | What it does |
|---|---|---|
| Semantic search | `hybridRetrievalService` | pgVector cosine similarity on `knowledge_chunks.embedding` (available; currently inactive in production KRS calls — `queryEmbedding: null` is passed) |
| Lexical search | `hybridRetrievalService` | `ts_rank` on `lexical_search_vector` (this is the active production retrieval method) |
| Authority/currentness pre-filter | SQL in `hybridRetrievalService` | Applied before results are ranked |
| Scoring/ranking | `knowledgeResolutionService` | Confidence score, authority bonus, source type priority |
| EvidencePack assembly | `knowledgeResolutionService` | Produces the typed structure passed to UEE |

**Production note:** Semantic (pgVector) retrieval exists and is architected correctly but is currently inactive — all KRS calls pass `queryEmbedding: null`, resulting in lexical-only retrieval. This is a significant capability gap: chunk relevance depends on keyword overlap, not semantic meaning. A "Complaints Management Policy" with different terminology than the query would be poorly ranked.

### Layer 3 — Model Reading
| Responsibility | Service | What it does |
|---|---|---|
| Prompt construction | UEE + `buildEvidenceSection()` | Assembles chunk text + citations into the prompt's evidence section |
| Reading / comprehension | OpenAI gpt-4o | Reads the chunk text and reasons over it |
| Findings / gap analysis | OpenAI gpt-4o | Generates the substantive analysis |

**Does KRS perform semantic reasoning over policy meaning?** No. KRS retrieves; it scores by keyword relevance and authority metadata. All semantic reasoning — understanding what the policy means, finding gaps and contradictions, generating recommendations — is performed by OpenAI.

**Does OpenAI choose which source to read?** No. NeedsOps pre-resolves all evidence. OpenAI receives only the pre-filtered, pre-ranked chunks.

---

## Part D — Cloud Execution Definition

| Capability | Cloud Implementation | Actually Executed? | Proposed Only? | Responsible Service |
|---|---|---|---|---|
| **INTELLECTUAL EXECUTION** | | | | |
| Policy review / gap analysis | OpenAI gpt-4o call | ✅ Executed | — | UEE → AI Gateway → OpenAI |
| Contradiction identification | OpenAI gpt-4o call | ✅ Executed | — | UEE → AI Gateway → OpenAI |
| Recommendations generation | OpenAI gpt-4o call | ✅ Executed | — | UEE → AI Gateway → OpenAI |
| Report / document drafting | OpenAI gpt-4o call | ✅ Executed | — | UEE → AI Gateway → OpenAI |
| Findings / risk analysis | OpenAI gpt-4o call | ✅ Executed | — | UEE → AI Gateway → OpenAI |
| Improvement plan drafting | OpenAI gpt-4o call | ✅ Executed | — | UEE → AI Gateway → OpenAI |
| Self-review (10 dimensions) | OpenAI call (selfReviewService) | ✅ Executed | — | selfReviewService → AI Gateway |
| Claim extraction from output | OpenAI call (claimEmissionService) | ✅ Executed | — | claimEmissionService → AI Gateway |
| Claim semantic support check | OpenAI call (claimValidationService) | ✅ Executed | — | claimValidationService → AI Gateway |
| Absence verification | OpenAI + KRS (up to 8 queries/claim) | ✅ Executed | — | absenceVerificationService |
| Quality score | Aggregated from self-review dimensions | ✅ Executed | — | selfReviewService |
| **EXTERNAL ACTION EXECUTION** | | | | |
| Send email | Typed proposal only | ❌ Not executed | ✅ Proposal only | executionActionDispatcherService / execution_actions table |
| Write/create/update file | Typed proposal only | ❌ Not executed | ✅ Proposal only | Same |
| Move file | Typed proposal only | ❌ Not executed | ✅ Proposal only | Same |
| Browser interaction | Typed proposal only | ❌ Not executed | ✅ Proposal only | Same |
| Calendar update | Typed proposal only | ❌ Not executed | ✅ Proposal only | Same |
| Terminal command | Typed proposal only | ❌ Not executed | ✅ Proposal only | Same |
| Update spreadsheet | Typed proposal only | ❌ Not executed | ✅ Proposal only | Same |
| **OUTPUT** | | | | |
| PDF generation | pdfkit (real) | ✅ Executed on demand | — | completedWorkExportService |
| DOCX generation | docx library (real) | ✅ Executed on demand | — | completedWorkExportService |
| Content normalisation | Deterministic formatter | ✅ Executed | — | normaliseCompletedWorkContent |

**Summary:** UEE directly performs intellectual professional knowledge work through OpenAI. It does not execute external actions. All external action types are proposals stored in the DB, dispatched only after explicit human approval and only when a connector is available.

---

## Part E — Cloud Tooling Inventory

| Tool / Capability | Type | Cloud Status | Notes |
|---|---|---|---|
| Organisation Library / KRS | READ TOOL | ✅ Real | Lexical retrieval active; vector retrieval inactive (queryEmbedding=null) |
| Organisational memory | REASONING CONTEXT | ✅ Real | Retrieved and injected into specialist prompt |
| Task uploads | READ TOOL | ✅ Real | Separate KRS scope; up to 10 chunks |
| Specialist knowledge | REASONING CONTEXT | ✅ Real | Specialist DNA manifest, objectives, principles injected as system prompt |
| Entity knowledge | REASONING CONTEXT | ✅ Real | Org context section in manifest |
| PDF export | OUTPUT TOOL | ✅ Real (pdfkit) | No LLM at export time |
| DOCX export | OUTPUT TOOL | ✅ Real (docx) | No LLM at export time |
| Document normalisation | OUTPUT TOOL | ✅ Real | Deterministic; no LLM |
| Action proposal capture | PROPOSAL ONLY | ✅ Real (DB storage) | Never dispatched automatically in Cloud |
| Email (draft/send) | PROPOSAL ONLY | Proposal only | dispatch requires connector |
| Calendar | PROPOSAL ONLY | Proposal only | dispatch requires connector |
| Browser | PROPOSAL ONLY | Proposal only | dispatch requires connector |
| External connectors | PROPOSAL ONLY | Proposal only | dispatch requires connector |
| Web / internet search | NOT IMPLEMENTED | — | No web search tool in Cloud path |
| API / tool registry | NOT IMPLEMENTED | — | No tool registry exposed to OpenAI |
| Function calling / tool calling | NOT IMPLEMENTED | — | No `tools:` parameter in OpenAI call |
| Semantic (pgVector) retrieval | READ TOOL | ⚠️ Inactive | Code exists; not activated in production KRS calls |

---

## Part F — OpenAI Tool Access in Cloud

**OpenAI has no direct tool access in the Cloud execution path.**

The AI Gateway call does not include a `tools:` or `functions:` parameter. OpenAI cannot:
- Call the Library or KRS itself
- Search files
- Invoke any API
- Call any connector
- Use function calling

NeedsOps resolves all evidence before calling OpenAI. The model receives a self-contained prompt: system instruction (specialist manifest + blueprint + output schema) and user content (task description + pre-resolved evidence passages + org context). OpenAI returns a JSON-structured response within the schema specified by the blueprint.

This is an intentional architectural decision that preserves NeedsOps's authority/currentness governance. If OpenAI could call KRS directly, it could bypass the evidence pre-filters.

---

## Part G — Source Authority Boundary

**Proved: NeedsOps decides what evidence is authorised and authoritative. OpenAI reasons over that evidence. OpenAI cannot override these decisions.**

| Decision | Where it happens | Can OpenAI override? |
|---|---|---|
| Approved vs unapproved source | SQL filter in `hybridRetrievalService` (before retrieval) | ❌ No |
| Current vs superseded version | SQL filter: `is_current = true` | ❌ No |
| Authority level | Scoring bonus in retrieval; not a hard exclusion among approved sources | ❌ No — it affects ranking only |
| Tenant scope | SQL filter: `organization_id = $orgId` | ❌ No |
| Source type priority | Ranking post-retrieval | ❌ No |
| Evidence relevance | Confidence threshold (< 0.05 dropped) + ranking | ❌ No |
| Sensitivity | SQL filter per sensitivity gate | ❌ No |
| Which chunks enter the prompt | Hard caps (20 library, 10 upload) | ❌ No |

OpenAI sees a curated, filtered, pre-authorised evidence set. It has no mechanism to request additional sources, ask for a full document, or access sources that NeedsOps has excluded.

**One nuance:** the current production path uses lexical retrieval only. If a relevant policy document uses different terminology from the query, it may not be retrieved — meaning OpenAI reasons over an incomplete evidence set without being aware of it. This is not an authority boundary issue; it is a retrieval quality issue (the inactive vector search would address it).

---

## Part H — Claim/Evidence Validation Path

### After OpenAI produces the draft:

| Step | Who performs it | Model used | NeedsOps deterministic? |
|---|---|---|---|
| Claim extraction from output | `claimEmissionService` → OpenAI | gpt-4o (or configured model) | ❌ AI model step |
| Claim type classification | `absenceCandidateClassifier` | Rule-based + LLM fallback | ⚠️ Hybrid |
| Material action extraction | `materialActionExtractor` | LLM | ❌ AI model step |
| Semantic support check (does evidence support claim?) | `claimValidationService` → OpenAI | LLM | ❌ AI model step |
| Absence verification (is claimed absence actually absent?) | `absenceVerificationService` → KRS (up to 8 queries/claim) + OpenAI | LLM | ❌ AI model step |
| Evidence snapshot creation | `evidenceSnapshotService` | None (DB write) | ✅ Deterministic |
| Passage hash storage | `evidenceSnapshotService` | None (hash function) | ✅ Deterministic |
| `provenance_status` assignment | UEE async chain | None | ✅ Deterministic (pending/complete/partial/failed) |
| Self-review (10 dimensions) | `selfReviewService` → OpenAI | LLM | ❌ AI model step |
| Quality score aggregation | `selfReviewService` | None (arithmetic) | ✅ Deterministic |
| Completed Work draft creation | `completedWorkService.createDraft()` | None | ✅ Deterministic |
| Approval | Human (approval workflow) | None | ✅ Deterministic |

**Total LLM calls for one evidence-bearing task (estimate):**
- 1 — specialist draft generation (UEE → AI Gateway)
- 1 — self-review (selfReviewService)
- 1-N — claim extraction (one call, extracts all claims from output)
- 1-N — semantic support check (one call per claim batch or per claim)
- Up to 8 — absence verification KRS retrievals per absence claim (retrieval, not LLM)
- 1-N — absence contradiction LLM check per claim

Conservative estimate for a document review with 5-10 claims: **4-8 LLM calls total.**

**OpenAI responsibility:** draft generation, self-review, claim extraction, semantic support validation, absence verification.  
**NeedsOps deterministic responsibility:** evidence pre-filtering, evidence injection, output schema enforcement, evidence snapshot storage, provenance status assignment, Completed Work lifecycle, approval workflow, audit.

---

## Part I — Completed Work and Export Path

```
OpenAI JSON output
  └── Validated by UEE (schema check, non-empty guard)
        └── normaliseCompletedWorkContent()
              [Deterministic: JSON → Markdown, humanise keys, strip internal IDs]
                    └── completedWorkService.createDraft()
                          [Stores contentMarkdown, versionNumber=1, status=draft]
                                └── selfReviewService (async)
                                      [Stores qualityScore, reviewDimensions]
                                            └── submitForApproval()
                                                  [status: draft → awaiting_approval]
                                                        └── Human approval
                                                              └── approve()
                                                                    [pins approvedVersionId]

On-demand export (user triggered):
  └── completedWorkExportService.exportPdf() / exportDocx()
        ├── Resolves pinned approved version (fail-closed if missing)
        ├── normaliseCompletedWorkContent() [again, deterministic]
        ├── Markdown parse
        └── pdfkit / docx library render
              [No LLM call at export time]
```

**Who actually "makes the report"?**
- **Content:** OpenAI generates the text (findings, gaps, recommendations, draft policy language)
- **Structure:** Blueprint defines the output schema; NeedsOps enforces it
- **Normalisation:** `normaliseCompletedWorkContent` deterministically formats JSON/Markdown — no LLM
- **PDF/DOCX:** `completedWorkExportService` renders with pdfkit/docx — no LLM
- **Record:** `completedWorkService` creates and versions the Completed Work entry — no LLM

OpenAI writes the substance. NeedsOps structures, normalises, stores, versions, pins and renders it.

---

## Part J — Cloud Action Proposals

**All external action types are proposals. None are automatically dispatched in Cloud.**

| Action Type | Cloud Status | Storage | Dispatch Trigger | Dispatch Path |
|---|---|---|---|---|
| `write_file` | Proposal only | `execution_actions` table | Human approval + connector available | `executionActionDispatcherService` → connector relay |
| `create_file` | Proposal only | Same | Same | Same |
| `update_file` | Proposal only | Same | Same | Same |
| `move_file` | Proposal only | Same | Same | Same |
| `draft_email` | Proposal only | Same | Same | Same |
| `send_email` | Proposal only | Same | Same | Same |
| `update_spreadsheet` | Proposal only | Same | Same | Same |
| `browser_interaction` | Proposal only | Same | Same | Same |
| `calendar_update` | Proposal only | Same | Same | Same |
| `terminal_command` | Proposal only | Same | Same | Same |

**Important distinction:** Completed Work approval does not trigger action dispatch. `approve()` pins the version only. Action dispatch requires a separate explicit invocation of `executionActionDispatcherService` after all proposals are individually approved, and requires a connector session to be open.

Cloud-only users (no Desktop Connector) will always see action proposals. They are the actionable output that tells the user what the AI recommends doing. In Cloud-only mode they are never executed — they are a structured recommendation list.

---

## Part K — NeedsOps vs OpenAI Responsibility Matrix

| Responsibility | NeedsOps Cloud Owns | OpenAI Owns | Shared | Not Implemented |
|---|---|---|---|---|
| Source selection | ✅ KRS pre-filters and ranks | — | — | — |
| Source authority | ✅ SQL filters (approved, is_current, dates) | — | — | — |
| Source relevance scoring | ✅ Confidence threshold + authority bonus | — | — | — |
| Retrieval | ✅ Lexical (production) / Vector (inactive) | — | — | — |
| Evidence injection | ✅ buildEvidenceSection() → prompt | — | — | — |
| Reasoning | — | ✅ gpt-4o reads passages | — | — |
| Drafting | — | ✅ gpt-4o generates content | — | — |
| Gap / contradiction identification | — | ✅ gpt-4o | — | — |
| Recommendations | — | ✅ gpt-4o | — | — |
| Self-review | — | ✅ gpt-4o (per dimension) | — | — |
| Claim extraction | — | ✅ LLM | — | — |
| Semantic support validation | — | ✅ LLM | — | — |
| Absence verification | — | — | ✅ KRS retrieves + LLM verifies | — |
| Evidence validation (authority, tenant) | ✅ NeedsOps pre-filters | — | — | — |
| Evidence snapshots | ✅ evidenceSnapshotService | — | — | — |
| Provenance status | ✅ deterministic | — | — | — |
| Approval workflow | ✅ completedWorkService | — | — | — |
| Export (PDF/DOCX) | ✅ pdfkit / docx | — | — | — |
| Content normalisation | ✅ deterministic formatter | — | — | — |
| External actions | — | — | — | ✅ Proposals only; dispatch requires connector |
| Audit log | ✅ logOrgEvent | — | — | — |
| Version pinning | ✅ approve() → approvedVersionId | — | — | — |

---

## Part L — Does Cloud Need OpenClaw for Knowledge Work?

**No. Cloud does not need OpenClaw for any of the following:**

| Task | Cloud capability | Evidence |
|---|---|---|
| Read an uploaded document | ✅ ingestionPipelineService extracts text at upload time | `ingestionPipelineService.ts` |
| Retrieve relevant passages | ✅ KRS lexical (or vector when activated) retrieval | `knowledgeResolutionService.ts`, `hybridRetrievalService.ts` |
| Analyse the policy | ✅ OpenAI gpt-4o call with evidence-enriched prompt | UEE task path |
| Compare against standards | ✅ Multi-source KRS retrieval (multiple docs in same EvidencePack) | `ResourceRegistry.ts:164-247` |
| Identify gaps | ✅ OpenAI generates gap analysis from retrieved passages | UEE AI call |
| Produce recommendations | ✅ OpenAI generates recommendations | Same |
| Generate a report | ✅ OpenAI drafts; NeedsOps normalises and creates Completed Work | UEE + completedWorkService |
| Export to PDF/DOCX | ✅ pdfkit + docx, no LLM, no connector | completedWorkExportService |

**The complete Cloud path for "Review our Complaints Policy":**
1. Policy uploaded → ingested → chunks stored in DB
2. Request → classified → intent created
3. KRS retrieves approved, current chunks relevant to "complaints management" (lexical match)
4. UEE assembles prompt: specialist manifest + blueprint (output schema) + evidence chunks
5. OpenAI reads the chunks, identifies gaps and contradictions, generates recommendations
6. UEE validates output, creates Completed Work draft
7. Self-review, claim extraction, evidence provenance captured
8. Submitted for human approval
9. On approval: export available as PDF or DOCX

OpenClaw is not involved at any point. The Connector is not required. The relay is not used. Cloud delivers this end-to-end.

---

## Part M — Cloud Limitations (What Cloud Cannot Do Without Hybrid/OpenClaw)

### Resource Reach Limitations (not reasoning limitations)

| Limitation | Type | Notes |
|---|---|---|
| Access a local file not uploaded to Library | Resource reach | Requires Desktop Connector + file system access |
| Modify a local Word document | Resource reach + action | Requires connector + OpenClaw file/Word skill |
| Send an email from user's Outlook/Gmail | Resource reach + action | Requires connector + email plugin |
| Control browser (web navigation, form fill) | Resource reach + action | Requires connector + browser skill |
| Access private desktop applications | Resource reach | Requires connector |
| Write to an external system (CRM, ERP) | Resource reach + action | Requires connector + plugin |
| Calendar updates | Resource reach + action | Requires connector |
| Access private network shares (SharePoint on-prem) | Resource reach | Requires connector |
| Read a file in real-time without ingesting it | Resource reach | KRS only has ingested/approved documents |

### Reasoning Limitations (Cloud-native, not connector-dependent)

| Limitation | Notes |
|---|---|
| Reasoning over documents not in Library | User must upload first; ad-hoc file access requires connector |
| Real-time web information | No web search; Cloud is evidence-bounded by what's in Library |
| Semantic retrieval quality | Vector search inactive; lexical-only retrieval may miss semantically relevant passages with different terminology |
| Multi-document deep cross-reference | Limited to 20 chunks (library) + 10 (upload); very long policies may be partially retrieved |
| Retrieval recall at scale | Without semantic search, relevance depends on query-document keyword overlap |

**None of the Cloud limitations are reasoning limitations.** OpenAI's reasoning capability is not constrained by the Cloud architecture. The limitations are all about **what evidence reaches the model** (retrieval quality, document ingestion requirement) and **what actions can be taken** (connector-dependent external actions).

---

## Part N — Performance and Complexity

### Major stages for one evidence-bearing Cloud request:

| Stage | Dominant service | Latency driver? | What it does |
|---|---|---|---|
| Classification | ExecutionClassifier + CoS | Minor | Intent detection, lane assignment |
| CoS conversation | UEE conversation path | Minor (SSE) | Intent elaboration (if conversation leg) |
| Readiness checks | capabilityAccessDecisionService | Negligible | DB reads |
| Blueprint selection | workBlueprintService | Negligible | DB query |
| Manifest assembly | specialistRuntimeManifestService | Negligible | DB read + compile |
| KRS retrieval | hybridRetrievalService | Minor (DB) | Lexical SQL + scoring |
| Prompt construction | UEE + buildEvidenceSection | Negligible | String assembly |
| **AI Gateway call (draft)** | OpenAI gpt-4o | **Dominant (~5-10s)** | Professional reasoning |
| Output validation | UEE | Negligible | Schema check |
| **Self-review** | selfReviewService → OpenAI | **Significant (~3-6s)** | 10-dimension quality check |
| Completed Work creation | completedWorkService | Negligible | DB write |
| Submit for approval | completedWorkService | Negligible | DB write |
| **Claim extraction (async)** | claimEmissionService → OpenAI | Significant (async) | Claim identification |
| **Claim validation (async)** | claimValidationService → OpenAI | Significant (async) | Semantic support check |
| **Absence verification (async)** | absenceVerificationService | Significant (async) | Up to 8 KRS queries + LLM |
| Evidence snapshots (async) | evidenceSnapshotService | Minor (async) | DB writes |

**Where latency lives:** The dominant latency is LLM calls. The synchronous path (draft + self-review) takes approximately 8-16 seconds. The async claim pipeline runs after the user receives confirmation and adds further LLM calls in the background.

**What KRS is:** A retrieval and authority-filtering layer. It is not an AI reasoning layer. It does not understand policy meaning. It ranks by keyword frequency and authority metadata. The professional reasoning is entirely OpenAI.

---

## Part O — Explicit Answers to Questions 1–20

**1. What is the source of truth in Cloud?**  
The Organisation Library — approved, versioned documents ingested through the ingestion pipeline and stored as chunks in `knowledge_chunks` with authority, currentness and tenant-scope metadata in `knowledge_source_versions`.

**2. What service chooses the source?**  
`knowledgeResolutionService` (KRS), invoked via `ResourceRegistry.resolveEvidenceForTask()`. The source is chosen by lexical relevance scoring combined with authority-level bonuses and source-type priority ranking. NeedsOps chooses; OpenAI does not.

**3. What service reads/chunks the uploaded document?**  
`ingestionPipelineService` with provider-specific text extractors (PDF, DOCX, plain text). Chunking is performed at ingestion time, not retrieval time.

**4. What service retrieves the relevant passages?**  
`hybridRetrievalService`, called by `knowledgeResolutionService`. Currently lexical-only in production; vector retrieval is implemented but inactive (`queryEmbedding: null`).

**5. Does OpenAI receive those passages?**  
Yes. Chunk text, source title, section title, page number, confidence and citation are injected into the prompt by `buildEvidenceSection()`. The model receives the passage text.

**6. Does OpenAI perform the professional reasoning?**  
Yes. All findings, gap analysis, contradiction identification, recommendations and draft content are generated by OpenAI gpt-4o. KRS retrieves; OpenAI reasons.

**7. Does OpenAI directly search the Library itself?**  
No. NeedsOps pre-resolves all evidence before the OpenAI call. OpenAI has no access to KRS, no search capability and no tool/function calling in the Cloud path.

**8. Does OpenAI have direct Cloud tools/function calling today?**  
No. The AI Gateway call does not include a `tools:` parameter. No function calling is exposed to OpenAI in the current Cloud execution path.

**9. What does UEE actually execute in Cloud?**  
UEE orchestrates: readiness checks, blueprint selection, manifest assembly, evidence retrieval, AI Gateway call (the intellectual execution), output validation, action proposal extraction, self-review invocation, Completed Work creation, provenance chain initiation, audit. It does not itself perform reasoning or access external systems.

**10. Does Cloud execute external actions or only propose them?**  
Only propose them. All 10 action types are stored as proposals in `execution_actions`. Dispatch requires explicit human approval and an active connector session — neither of which happens automatically in Cloud-only mode.

**11. Who generates findings/recommendations?**  
OpenAI gpt-4o, from the evidence-enriched prompt assembled by UEE.

**12. Who validates those findings against evidence?**  
Both: NeedsOps validates that evidence was retrieved and passed (deterministic); OpenAI validates semantic support (claim validation step) and absence correctness (absence verification step) — these are AI-assisted governance checks.

**13. Who creates Completed Work?**  
`completedWorkService.createDraft()` — NeedsOps, deterministically, from the normalised OpenAI output.

**14. Who creates PDF/DOCX?**  
`completedWorkExportService` — NeedsOps, using `pdfkit` (PDF) and `docx` (DOCX) libraries. No LLM involved.

**15. Does PDF/DOCX generation call OpenAI?**  
No. Confirmed by code inspection and explicit test assertion (`sprint29j3-export-quality.test.ts:607`). Export is deterministic rendering of stored Markdown.

**16. Can Cloud review an uploaded policy without OpenClaw?**  
Yes, completely. Upload → ingest → retrieve → reason → draft → review → Completed Work → export. The entire path is Cloud-native. OpenClaw is not involved at any step.

**17. What does OpenClaw add that Cloud cannot currently do?**  
Resource reach: access to local files not in Library, ability to write files, send emails, control browsers, interact with local applications, access private networks. OpenClaw adds *action* and *reach* — not reasoning. Cloud already has the reasoning.

**18. Are any Cloud capabilities unnecessarily dependent on OpenClaw?**  
No. All Cloud-native capabilities (reasoning, drafting, evidence management, Completed Work, export) work without OpenClaw. The connector is required only for external action dispatch, which is appropriately gated.

**19. What responsibilities should permanently remain NeedsOps-native?**  
Source authority decisions (approved/current/tenant-scoped), evidence retrieval and injection, prompt governance (output schema via blueprint), claim integrity pipeline, evidence snapshot storage, Completed Work lifecycle, version pinning, approval workflow, audit log, RBAC, entitlement gate, export rendering.

**20. What is the clean Cloud responsibility model?**  
NeedsOps: select, filter, govern, assemble, validate, store, approve, export, audit.  
OpenAI: read the evidence, reason over it, draft the output, validate claims, check for absences.  
OpenClaw: execute actions beyond the Cloud boundary (files, email, browser, local systems) — not needed for knowledge work.

---

*Report produced: 8 August 2026. Investigation only. No implementation.*
