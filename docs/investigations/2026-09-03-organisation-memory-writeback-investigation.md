# Organisation Memory Write-Back Investigation

Date: 2026-09-03

Scope: read-only investigation of `organisation_memory`, behaviour-strategy measurement logging, approved examples, Completed Work reuse, retrieval, provenance, and supersession.

## Verification Boundaries

Observed:

- Dev edge was reachable: `GET https://d2y3hd4ltf3qdv.cloudfront.net/api/healthz` returned HTTP 200 with `{"status":"ok"}`.
- Source inspection was completed in `/Users/tayephilipajao/Development/NEDDOPSAI`.
- No code, database records, AWS resources, Terraform state, or source files were changed.

Not verified live:

- I could not verify live `organisation_memory` rows or `care_plan_behaviour_strategy_measurements` row counts because this shell did not expose database credentials, and the RDS instance is private. I did not retrieve secrets.

## 1. Every Write Path Into `organisation_memory`

Observed: `organisation_memory` is tenant-scoped. The schema comment says: "Only 'approved' records enter AI context" and "Soft lifecycle: proposed -> approved -> superseded/expired (never hard-deleted)." The stored fields include `sourceType`, `sourceId`, `status`, `effectiveFrom`, `effectiveTo`, `expiresAt`, `specialistId`, `approvedBy`, `approvedAt`, and `supersededBy` (`lib/db/src/schema/organisationMemory.ts:1-40`).

All record creation goes through `proposeOrganisationMemory(...)`. It inserts `organisationMemoryTable` rows, slices title/content, stores `structuredContent`, `sourceType`, `sourceId`, dates, confidence, importance, and `createdBy` (`artifacts/api-server/src/services/organisationMemoryService.ts:81-110`).

Important approval behavior: the service auto-approves `sourceType` `"ai_proposed"` or `"import"` records when confidence is at least `0.8`, the type is one of `operating_preference`, `system_information`, `terminology`, or `organisation_profile`, and no conflict is detected (`organisationMemoryService.ts:50-77`). Otherwise the row is created as `proposed` (`organisationMemoryService.ts:100-103`). This conflicts with older comments in curation/conversation learning that say memory is never activated automatically.

Manual entry:

- Trigger: authenticated owner/admin posts to `POST /organisations/:slug/memory` (`artifacts/api-server/src/routes/v1/organisationMemory.ts:64-69`).
- Write: title, content, memory type, optional structured content, source ID, confidence, importance, dates, and creator. The route forces `sourceType: "manual"` regardless of caller body (`organisationMemory.ts:80-96`).
- Approval before retrieval: yes. Manual rows cannot auto-adopt because auto-adoption excludes `"manual"` (`organisationMemoryService.ts:71-76`).

Curation from knowledge chunks:

- Trigger: Organisation Library document events. The curation service lists `uploaded`, `approved`, `superseded`, `archived`, and `version_changed` events (`artifacts/api-server/src/services/knowledgeCurationService.ts:7-16`). Upload/ingestion completion enqueues `triggerEvent: "uploaded"` (`ingestionPipelineService.ts:484-491`). Source approval enqueues `triggerEvent: "approved"` (`knowledgeSourceService.ts:516-525`). Supersession enqueues `triggerEvent: "superseded"` (`knowledgeSourceService.ts:663-675`).
- Write: curation reads `knowledge_chunks` including `sectionTitle`, `pageNumber`, and `chunkIndex` (`knowledgeCurationService.ts:214-229`), calls an LLM or fallback (`knowledgeCurationService.ts:270-292`), then creates memory rows with proposed memory type/title/content, `structuredContent.rationale`, `pageReference`, `section`, `affectedSpecialists`, `suggestedAction`, `sourceVersionId`, and `curationJobId`; it stores `sourceType: "ai_proposed"` and `sourceId: params.knowledgeSourceId` (`knowledgeCurationService.ts:294-320`).
- Approval before retrieval: usually required by design, but not guaranteed in code because safe high-confidence `ai_proposed` records can auto-approve (`organisationMemoryService.ts:50-77`).

Conversation capture:

- Trigger: after a Chief of Staff response is stored, `processUserMessage` calls `detectAndProposeConversationKnowledge(...)` fire-and-forget with the user's message and conversation ID (`artifacts/api-server/src/services/conversationService.ts:740-759`).
- Write: conversation learning extracts candidate patterns from user text, then writes `memoryType`, title, summary content, `structuredContent` including `"Detected in conversation"`, `conversationId`, and `detectedPattern`; it uses `sourceType: "ai_proposed"` and `sourceId: conversationId` (`artifacts/api-server/src/services/conversationLearningService.ts:124-168`).
- Approval before retrieval: not always. The file comment says "Proposals only. Memory is NEVER activated automatically" (`conversationLearningService.ts:7-10`), but the central memory service can auto-approve safe high-confidence `ai_proposed` records (`organisationMemoryService.ts:50-77`).

Import:

- Observed: the service accepts `sourceType: "import"` in `CreateMemoryInput` and allows auto-adoption for safe high-confidence imports (`organisationMemoryService.ts:29-41`, `organisationMemoryService.ts:50-77`).
- Not observed: I found no application call site that creates imported memory records. This is a supported service capability, not a wired path I could prove from source.

Lifecycle writes:

- Approval changes proposed rows to approved (`organisationMemoryService.ts:122-128`).
- Supersession sets `status: "superseded"` and `supersededBy: newId` (`organisationMemoryService.ts:150-160`).
- Rejection, update, and merge also mutate existing rows; they do not create records.

Completed Work as memory source: no direct path found. Completed Work can be promoted into the Organisation Library, but I found no code path that writes a Completed Work item directly into `organisation_memory`. The Completed Work promotion route calls `promoteToLibrary(...)`, not `proposeOrganisationMemory(...)` (`artifacts/api-server/src/routes/v1/completedWork.ts:276-290`). Inferred caveat: after Completed Work is promoted to the Organisation Library and later approved/ingested, curation can propose memory from its chunks indirectly.

## 2. The Measurement Log

Observed schema: migration 0044 is represented by `care_plan_behaviour_strategy_measurements`, with fields for `strategyText`, `bspSourceQuote`, `modelFolds`, `apoFolds`, `confirmationStatus`, `actorUserId`, timestamps, and metadata (`lib/db/src/schema/carePlanBehaviourStrategyMeasurements.ts:13-38`).

Observed writer exists: `recordCarePlanBehaviourStrategyMeasurement(...)` computes a fingerprint and inserts a row with model folds, APO folds, confirmation status, actor, confirmation/correction timestamps, and metadata (`artifacts/api-server/src/services/carePlanBehaviourStrategyService.ts:27-54`).

Observed application wiring: not confirmed. Source search found the function definition only, and no source call site invoking `recordCarePlanBehaviourStrategyMeasurement`. I therefore cannot honestly confirm production behavior is writing this table.

Observed feedback: no feedback loop found. The only references to `carePlanBehaviourStrategyMeasurementsTable` in source are the schema and the insert function. No prompt builder, retrieval provider, training pipeline, or context service reads the table.

What would consume it if used: a future calibration or quality analytics service comparing `modelFolds` with `apoFolds` by `strategyFingerprint`, organisation, Completed Work, participant, actor, and timestamp. Existing protective-strategy gates read completed markdown for unconfirmed markers; they do not consume the measurement table.

## 3. Approved Examples

Observed: Approved examples are implemented as Organisation Library sources with `sourceType: "approved_example"` and `sourceScope: "library"`. `retrieveApprovedExamples(...)` selects approved library sources of that type (`artifacts/api-server/src/services/approvedExampleService.ts:64-95`).

Observed: Completed Work can be promoted as an approved example. The route accepts `documentType` and documents the allowed values as `approved_example`, `template`, `policy`, or `procedure` (`artifacts/api-server/src/routes/v1/completedWork.ts:285-287`). The service requires the Completed Work status to be `"approved"` (`artifacts/api-server/src/services/completedWorkService.ts:730-736`), then allows those four promotable types (`completedWorkService.ts:739-745`) and creates a `knowledge_sources` row with `sourceType: documentType`, `sourceScope: "library"`, `status: "review_required"`, and `authorityLevel: "authoritative"` (`completedWorkService.ts:757-775`).

Observed style-only path: the approved-example service says examples "teach: writing style, level of detail, preferred terminology, formatting conventions, section ordering, and professional tone" and are "style signals only" (`approvedExampleService.ts:1-13`). It retrieves only a sample of chunks and extracts style signals (`approvedExampleService.ts:98-148`), then emits a prompt block labelled "APPROVED EXAMPLE STYLE GUIDANCE (influence only - never reproduce examples)" (`approvedExampleService.ts:214-219`).

Observed pack distinction: `completed_work_assets` has `assetType: "example"` for "an approved example that influenced style" and `role: "style"` for "influenced writing style only" (`lib/db/src/schema/completedWorkAssets.ts:13-56`).

Conclusion: approved Completed Work as an approved example is wired, not just design intent. But the style-only guarantee is local to the approved-example service and asset-role modelling; the broader library retrieval path does not enforce that exclusion.

## 4. Can A Completed Document Become Evidence?

Answer: yes, there is a path. That is a defect candidate.

Observed path:

1. An approved Completed Work item can be promoted to the Organisation Library as `policy` or `procedure`, not just `approved_example` (`completedWorkService.ts:730-745`).
2. Promotion creates a library source with `sourceType: documentType` and `authorityLevel: "authoritative"` (`completedWorkService.ts:757-775`).
3. Once the promoted source becomes approved/current/ingested, `OrganisationLibraryProvider` retrieves approved Organisation Library chunks as knowledge items with the chunk's source title, page number, content, and authority level (`artifacts/api-server/src/lib/knowledge/providers/OrganisationLibraryProvider.ts:27-66`).
4. The underlying hybrid retrieval only requires `ks.status = 'approved'`, current source/version, complete ingestion, freshness, sensitivity, and the scope clause (`artifacts/api-server/src/services/hybridRetrievalService.ts:191-205`). The `org_library` scope clause excludes `participant_document` only; it does not exclude promoted Completed Work, `approved_example`, `policy`, or `procedure` (`hybridRetrievalService.ts:268-282`).

Observed stronger concern: even `approved_example` sources are not excluded by the broad Organisation Library retrieval filter. The approved-example service treats examples as style-only, but `OrganisationLibraryProvider` can still retrieve any approved/current library chunks matching the scope filter unless upstream source typing or scopes prevent it.

Inference: if a completed document is promoted as `policy` or `procedure`, approved, versioned, and ingested, it can become substantive evidence for later deliverables. If an `approved_example` source is approved/current/ingested and has no excluding scope, it may also be retrievable as library evidence through the broad provider. That allows system output to re-enter the evidence chain with clean-looking provenance.

## 5. Retrieval From Memory

Chat: yes. `classifyMessageLLM(...)` builds conversation context before responding (`artifacts/api-server/src/services/chiefOfStaffLLMService.ts:515-525`). The conversation context builder calls `buildChiefOfStaffContext(...)`, whose parallel reads include `fetchApprovedOrgMemory(...)` (`artifacts/api-server/src/services/contextSelectionService.ts:164-170`). The CoS prompt then injects approved organisation memory under `=== APPROVED ORGANISATION MEMORY (authoritative) ===` (`chiefOfStaffLLMService.ts:688-693`).

Document generation: yes. The dedicated `OrgMemoryProvider` retrieves approved memory for knowledge orchestration (`artifacts/api-server/src/lib/knowledge/providers/OrgMemoryProvider.ts:45-72`) and maps it into `KnowledgeItem` records with `authorityLevel: "primary"` (`OrgMemoryProvider.ts:88-115`). Work package/runtime paths also read approved memory into execution context (`artifacts/api-server/src/services/workPackageService.ts:238-256`, `artifacts/api-server/src/services/runtimeContextService.ts:222-243`).

What is needed for "what is our on-call escalation process?" to be answered from memory:

- An approved `organisation_memory` row whose content says the on-call escalation process.
- Its `memoryType` should probably be `reporting_line`, `operating_preference`, `policy_reference`, or a more specific escalation type if added.
- The row must not be expired/superseded and must be effective now in retrieval paths that respect those fields.
- Chat prompt retrieval already injects approved memory, so no document search is required if the fact exists in approved memory. Better answer quality would require passage-level provenance back to the source document or conversation.

## 6. Provenance On Memory Records

Observed stored provenance: first-class columns are `sourceType` and `sourceId` (`lib/db/src/schema/organisationMemory.ts:20-21`). There are no first-class page, passage, chunk, quote, offset, or source-version columns in `organisation_memory` (`organisationMemory.ts:12-40`).

Observed curation provenance: curation stores `pageReference`, `section`, `sourceVersionId`, and `curationJobId` inside `structuredContent`, while the first-class `sourceId` is only the knowledge source ID (`artifacts/api-server/src/services/knowledgeCurationService.ts:302-317`).

Observed retrieval provenance: `OrgMemoryProvider` maps memory to a `KnowledgeItem` with `sourceId: row.id`, `versionId: null`, `chunkId: null`, `pageNumber: null`, and provenance identifiers both set to the memory row ID (`artifacts/api-server/src/lib/knowledge/providers/OrgMemoryProvider.ts:88-115`). This loses passage-level traceability at retrieval time.

What passage-level provenance would require:

- First-class source references on memory rows or a child provenance table: `knowledgeSourceId`, `sourceVersionId`, `chunkId`, `pageNumber`, `sectionTitle`, exact quote/passage, and optionally character offsets.
- Support for multiple source passages per memory fact, because one organisational fact may be synthesized from several documents or conversations.
- Retrieval providers and citation builders must project those provenance fields into `KnowledgeItem.provenance` and completed-work assets/citations.
- Manual and conversation-created memories need equivalent provenance: message IDs and exact quoted spans, not only conversation/source IDs.

## 7. Supersession

Observed model: `supersededBy`, effective dates, and expiry dates exist (`lib/db/src/schema/organisationMemory.ts:25-38`). The service can explicitly supersede a row by setting `status: "superseded"` and `supersededBy` (`artifacts/api-server/src/services/organisationMemoryService.ts:150-160`).

Observed use: `OrgMemoryProvider` filters to approved rows, `supersededBy IS NULL`, effective-from is now or earlier, effective-to is future, and expiry is future (`OrgMemoryProvider.ts:45-69`).

Observed gaps:

- `listOrganisationMemory(...)` only filters by status/type and expiry unless callers supply status; it does not exclude superseded rows generally (`organisationMemoryService.ts:193-224`).
- Chief of Staff chat context fetches only `status = "approved"` and filters expiry/effective-to, but it does not filter `supersededBy` or `effectiveFrom` (`artifacts/api-server/src/services/contextSelectionService.ts:253-270`).
- Work package and runtime context paths select `status = "approved"` only, with no supersession/effective-date filtering in the observed queries (`workPackageService.ts:247-256`, `runtimeContextService.ts:225-236`).
- Conflict detection only reports similar approved titles and says to "consider superseding it"; it does not automatically supersede (`organisationMemoryService.ts:232-249`).

Conclusion: when a fact changes today, a new memory row does not automatically supersede the old one. If a human explicitly uses supersede/merge, the old row becomes `status = "superseded"` and most status-approved paths stop seeing it. If no one supersedes it, both facts remain approved and compete. Some retrieval surfaces are stricter than others, so effective dates and supersession are not consistently enforced across all memory consumers.

## Risk Summary

High risk: Completed Work can be promoted into Organisation Library as authoritative `policy`/`procedure`, and broad library retrieval can later use approved/current/ingested library chunks as evidence. This creates a path for model-generated output to become future evidence.

Medium risk: auto-adoption behavior means some `ai_proposed` memory records from curation or conversation capture can enter retrieval without human approval, despite comments saying proposals only.

Medium risk: supersession/effective-date filtering is inconsistent across memory consumers, so stale approved facts may remain available outside the strict `OrgMemoryProvider`.

Low-to-medium risk: measurement logging is modelled and has a writer function, but no source call site was found; if the intent is to record model-vs-APO fold decisions, that implementation appears incomplete or not wired in this source tree.

## Recommendations

1. Block promoted Completed Work from entering evidence by default. Treat `completed_work/*` library sources and `sourceType = approved_example` as style/template-only unless a human explicitly re-attests them as independent organisational policy evidence.
2. Add retrieval filters so `OrganisationLibraryProvider` excludes `approved_example` and any promoted Completed Work sources unless the retrieval mode is explicitly style/template.
3. Separate style references from evidence in source metadata, not only in `completed_work_assets`.
4. Align comments and behavior for memory auto-adoption. Either disable auto-approval for curation/conversation learning or document the safe-type auto-adopt rule plainly.
5. Make supersession/effective-date filtering consistent across CoS chat, work packages, runtime context, and knowledge orchestration.
6. Add first-class passage-level provenance for memory facts before relying on memory as evidence in regulated documents.
7. Wire or remove the behaviour-strategy measurement writer. If it is meant to be deliberately non-feedback analytics, keep it read-only for reporting/calibration and do not inject it into prompts or retrieval.
