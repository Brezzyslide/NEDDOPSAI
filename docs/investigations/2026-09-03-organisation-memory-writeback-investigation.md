# Organisation Memory Write-Back Investigation

Date: 2026-09-03
Scope: read-only source inspection plus unauthenticated live endpoint checks against `https://d2y3hd4ltf3qdv.cloudfront.net`.

## Live verification attempted

Observed:

- `GET /api/health` returned `404 Cannot GET /api/health`.
- `GET /v1/organisations/test/memory` returned `401` with `AUTHENTICATION_REQUIRED`.
- `GET /api/v1/organisations/test/memory` returned `404 Cannot GET /api/v1/organisations/test/memory`.
- The local shell environment has no `DATABASE_URL`, `DB_HOST`, `DB_NAME`, `DB_USERNAME`, `PGHOST`, `PGDATABASE`, or `PGUSER` set.

Conclusion: the live `/v1/organisations/:slug/memory` route is present behind authentication, but live row-level verification was not possible from this session without credentials. The findings below are source-observed unless explicitly labelled inferred.

## 1. Every write path into `organisation_memory`

Observed storage contract: `organisation_memory` has `source_type` and `source_id`, but no page/chunk/passage columns. The schema comment says "Only 'approved' records enter AI context" and the lifecycle is "proposed -> approved -> superseded/expired" (`lib/db/src/schema/organisationMemory.ts:1-7`). The actual columns are `sourceType`, `sourceId`, `status`, effective dates, `expiresAt`, and `supersededBy` (`lib/db/src/schema/organisationMemory.ts:12-40`).

All create paths converge on `proposeOrganisationMemory`. The input permits `sourceType: "conversation" | "manual" | "ai_proposed" | "import"` (`artifacts/api-server/src/services/organisationMemoryService.ts:29-42`). The insert writes title/content, structured content, source type/id, confidence, importance, dates, creator, and either `approved` or `proposed` status (`artifacts/api-server/src/services/organisationMemoryService.ts:91-109`).

Auto-approval is implemented. The service says system-originated high-confidence low-risk records are auto-approved (`artifacts/api-server/src/services/organisationMemoryService.ts:50-62`). The code allows auto-adoption for only `ai_proposed` or `import`, confidence >= 0.8, selected memory types, and no detected conflicts (`artifacts/api-server/src/services/organisationMemoryService.ts:64-77`). That means not all records require human approval before retrieval.

### Manual entry

Trigger: authenticated owner/admin POST to `/organisations/:slug/memory` (`artifacts/api-server/src/routes/v1/organisationMemory.ts:64-69`).

Writes: memory type, title, content, structured content, source id, confidence, importance, dates, creator. The public route forcibly sets `sourceType: "manual"` (`artifacts/api-server/src/routes/v1/organisationMemory.ts:80-97`).

Approval before retrieval: yes. The route comment says public callers are always manual and "no auto-adoption" (`artifacts/api-server/src/routes/v1/organisationMemory.ts:80-90`). Because manual is not eligible for auto-adoption, the service writes `status: "proposed"` (`artifacts/api-server/src/services/organisationMemoryService.ts:100-103`).

### Conversation capture

Trigger: after the conversation service stores a Chief of Staff response, it calls `detectAndProposeConversationKnowledge` fire-and-forget (`artifacts/api-server/src/services/conversationService.ts:740-759`).

Writes: detected candidate memory title/summary/type plus structured content with rationale, blank `pageReference`, `affectedSpecialists`, conversation id, and detected pattern. It uses `sourceType: "ai_proposed"` and `sourceId: conversationId` (`artifacts/api-server/src/services/conversationLearningService.ts:149-168`).

Approval before retrieval: sometimes no. The service header says "Memory is NEVER activated automatically" (`artifacts/api-server/src/services/conversationLearningService.ts:7-10`), but the called memory service auto-approves eligible `ai_proposed` records (`artifacts/api-server/src/services/organisationMemoryService.ts:71-77`). This is an observed implementation mismatch.

### Curation from document chunks

Trigger: Organisation Library document events: uploaded, approved, superseded, archived, version_changed (`artifacts/api-server/src/services/knowledgeCurationService.ts:7-16`, `artifacts/api-server/src/services/knowledgeCurationService.ts:46-48`).

Writes: curation reads `knowledge_chunks` text, section title, page number, and chunk index (`artifacts/api-server/src/services/knowledgeCurationService.ts:214-229`), then creates memory proposals with title, summary, rationale, `pageReference`, section, affected specialists, source version id, curation job id, `sourceType: "ai_proposed"`, and `sourceId: knowledgeSourceId` (`artifacts/api-server/src/services/knowledgeCurationService.ts:302-320`).

Approval before retrieval: sometimes no. The curation header says all proposals require human approval before context (`artifacts/api-server/src/services/knowledgeCurationService.ts:18-21`), but these records are `ai_proposed`, so the shared auto-adoption rule can approve eligible records immediately.

### Import

Observed: `import` is part of the service input type and is auto-adoption eligible (`artifacts/api-server/src/services/organisationMemoryService.ts:34`, `artifacts/api-server/src/services/organisationMemoryService.ts:71-77`). I did not find a route or service caller that imports organisation memory directly. This appears to be an internal/service-level capability with no wired API path found in this pass.

### Approval, rejection, supersession, merge, and update

These mutate existing memory records but do not create new ones. Approval changes proposed records to approved (`artifacts/api-server/src/services/organisationMemoryService.ts:122-129`). Rejection sets rejected (`artifacts/api-server/src/services/organisationMemoryService.ts:136-143`). Supersession sets `status: "superseded"` and `supersededBy` (`artifacts/api-server/src/services/organisationMemoryService.ts:150-160`). The routes require owner/admin for approve/reject/supersede (`artifacts/api-server/src/routes/v1/organisationMemory.ts:144-231`).

### Is Completed Work a source of memory records?

No. Observed: the only source callers of `proposeOrganisationMemory` are the manual memory route, conversation learning, and knowledge curation. Completed Work does not call it. Completed Work has a separate promotion path into `knowledge_sources`, not `organisation_memory` (`artifacts/api-server/src/services/completedWorkService.ts:724-795`).

## 2. Measurement log

Observed schema: migration 0044 creates `care_plan_behaviour_strategy_measurements` as append-only records for Behavioural Management strategy classification and APO confirmation/correction events (`lib/db/migrations/0044_care_plan_behaviour_strategy_measurement.sql:1-5`). It stores model folds, APO folds, confirmation status, actor, timestamps, completed work ids, and strategy fingerprint (`lib/db/migrations/0044_care_plan_behaviour_strategy_measurement.sql:5-23`). The Drizzle schema mirrors this (`lib/db/src/schema/carePlanBehaviourStrategyMeasurements.ts:13-38`).

Observed writer helper: `recordCarePlanBehaviourStrategyMeasurement` inserts those fields into the table (`artifacts/api-server/src/services/carePlanBehaviourStrategyService.ts:27-54`).

Observed wiring: I did not find a production caller of `recordCarePlanBehaviourStrategyMeasurement`. Repository search found the schema and writer definition only. Therefore I cannot confirm it is currently being written; source evidence indicates it is not wired into runtime.

Observed feedback: no source hit showed the measurement table or writer feeding prompts, retrieval, or training. Current care-plan runtime validation imports `findUnconfirmedCarePlanProtectiveStrategies`, not the measurement writer. This supports the conclusion that the table feeds back nowhere today.

Inferred future consumer if used: the likely consumers would be care-plan approval/runtime validation, behaviour strategy quality analytics, prompt calibration, or specialist training/evaluation. None is wired in the inspected code.

## 3. Approved examples

Observed: approved examples are wired for style guidance. The service states they are "style/tone/terminology guidance" and "never copied or reproduced" (`artifacts/api-server/src/services/approvedExampleService.ts:1-13`).

It retrieves only `knowledge_sources` where status is approved, source type is `approved_example`, and scope is library (`artifacts/api-server/src/services/approvedExampleService.ts:64-87`). It then reads at most two chunks per source to extract style signals (`artifacts/api-server/src/services/approvedExampleService.ts:103-148`).

The pack distinguishes style reference from evidence by placing extracted signals in a separate guidance block: `APPROVED EXAMPLE STYLE GUIDANCE` with "influence only" wording (`artifacts/api-server/src/services/approvedExampleService.ts:228-230`). Unified execution passes `styleGuidance.guidanceBlock` separately from the evidence pack into draft generation (`artifacts/api-server/src/services/unifiedExecutionEngine.ts:1613-1629`).

Completed Work can become an approved example only through explicit promotion with `documentType: "approved_example"`, followed by library approval. That is implemented, not just design intent (`artifacts/api-server/src/routes/v1/completedWork.ts:275-291`; `artifacts/api-server/src/services/completedWorkService.ts:739-765`).

## 4. Can a completed document become evidence later?

Yes, with an approval step.

Observed path:

1. Owner/admin calls `/organisations/:slug/completed-work/:id/promote` with a document type (`artifacts/api-server/src/routes/v1/completedWork.ts:275-291`).
2. `promoteToLibrary` allows approved Completed Work only (`artifacts/api-server/src/services/completedWorkService.ts:730-736`).
3. It accepts `approved_example`, `template`, `policy`, or `procedure` (`artifacts/api-server/src/services/completedWorkService.ts:739-744`).
4. It inserts a `knowledge_sources` row with `sourceScope: "library"`, `sourceType: documentType`, `authorityLevel: "authoritative"`, and `isCurrent: true` (`artifacts/api-server/src/services/completedWorkService.ts:757-780`).
5. Initial source status is `review_required`, so it is not immediately retrievable as evidence (`artifacts/api-server/src/services/completedWorkService.ts:773`).
6. The retrieval engine later accepts approved/current library sources: `ks.status = 'approved'`, `ks.is_current = true`, current approved source version, complete ingestion, and `scopeMode: "org_library"` (`artifacts/api-server/src/services/hybridRetrievalService.ts:191-205`; `artifacts/api-server/src/services/hybridRetrievalService.ts:268-283`).
7. The evidence resolver always queries organisation library evidence for task execution (`artifacts/api-server/src/services/knowledgeResolutionService.ts:521-540`) and formats it under `AUTHORITATIVE EVIDENCE` (`artifacts/api-server/src/services/knowledgeResolutionService.ts:883-917`).

Conclusion: a completed document promoted as `policy`, `procedure`, or `template`, then approved and ingested as a current library source, can become evidence for later deliverables. This is not an `organisation_memory` path. It is a `completed_work -> knowledge_sources -> knowledge_chunks -> evidence pack` path.

Risk classification: this matches the defect described in the prompt if the promoted Completed Work is a system-authored deliverable rather than an externally authoritative organisational source. The code has no observed guard that prevents self-authored Completed Work promoted as `policy`, `procedure`, or `template` from being cited as authoritative evidence after library approval.

## 5. Retrieval from memory

Document generation: yes, approved memory is available to generation context. `OrgMemoryProvider` retrieves approved, non-superseded, effective, non-expired records and maps them into knowledge items with `sourceOrigin: "memory"` (`artifacts/api-server/src/lib/knowledge/providers/OrgMemoryProvider.ts:45-69`, `artifacts/api-server/src/lib/knowledge/providers/OrgMemoryProvider.ts:88-127`). The orchestration engine registers this provider (`artifacts/api-server/src/services/knowledgeOrchestrationEngine.ts:75-85`) and allocates a 20% layer budget to `org_memory` (`artifacts/api-server/src/services/knowledgeOrchestrationEngine.ts:180-186`).

Chat question answering: not consistently wired. The older conversation evidence resolver searches organisation library and specialist-scoped document chunks only; it does not retrieve `organisation_memory` (`artifacts/api-server/src/services/knowledgeResolutionService.ts:933-1032`). The specialist context path can call `orchestrateKnowledge` when `knowledgeOptions.query` is supplied (`artifacts/api-server/src/services/specialistContextService.ts:181-190`), which would include `OrgMemoryProvider`.

Answer to "Can a user ask in chat and get an answer from organisation_memory?": source evidence shows memory can be included in orchestrated specialist context, but the inspected conversation evidence path itself does not query memory. I could not verify live chat behavior without authentication.

Needed for "what is our on-call escalation process?": an approved memory row containing that fact, a chat route/path that calls `orchestrateKnowledge` or `OrgMemoryProvider` for user questions, prompt wiring that includes the returned memory item, and a response/citation format that cites the memory record and any underlying source.

## 6. Provenance on memory records

Observed stored provenance: top-level memory rows store only `sourceType` and `sourceId` as source provenance (`lib/db/src/schema/organisationMemory.ts:20-21`). They also store lifecycle metadata, dates, creator, approver, and supersession pointer (`lib/db/src/schema/organisationMemory.ts:22-40`).

Curation stores additional provenance inside JSON structured content: `pageReference`, `section`, `sourceVersionId`, and `curationJobId` (`artifacts/api-server/src/services/knowledgeCurationService.ts:306-314`). Conversation capture stores blank `pageReference` and a conversation id/pattern (`artifacts/api-server/src/services/conversationLearningService.ts:154-164`). The fallback extractor emits blank page and section fields (`artifacts/api-server/src/services/knowledgeCurationService.ts:596-599`).

Retrieval loses passage-level provenance for memory. `OrgMemoryProvider` maps memory with `sourceId: row.id`, `chunkId: null`, `pageNumber: null`, and provenance identifiers equal to the memory row id (`artifacts/api-server/src/lib/knowledge/providers/OrgMemoryProvider.ts:91-115`).

Passage-level provenance would require first-class fields or a linked provenance table that stores source document id, version id, chunk id, page number, section/heading, excerpt/hash, extraction timestamp, and extraction method. Retrieval would then need to carry those fields through `OrgMemoryProvider` into citations instead of citing only the memory record.

## 7. Supersession

Observed model: `supersededBy`, `effectiveFrom`, `effectiveTo`, and `expiresAt` exist on the memory table (`lib/db/src/schema/organisationMemory.ts:25-38`).

Observed usage in retrieval:

- `OrgMemoryProvider` excludes records with `supersededBy`, future effective dates, past effective end dates, and expiry (`artifacts/api-server/src/lib/knowledge/providers/OrgMemoryProvider.ts:45-69`).
- `specialistContextService.loadApprovedMemory` filters out superseded, expired, not-yet-effective, and past-end-date records in process (`artifacts/api-server/src/services/specialistContextService.ts:300-356`).

Observed management behavior:

- Supersession is manual owner/admin action via `/memory/:memoryId/supersede` (`artifacts/api-server/src/routes/v1/organisationMemory.ts:209-231`).
- New memory conflict detection only reports similar approved records and says to "Consider superseding it"; it does not supersede automatically (`artifacts/api-server/src/services/organisationMemoryService.ts:232-253`).
- The management list route defaults to proposed, approved, rejected, superseded, and expired statuses (`artifacts/api-server/src/routes/v1/organisationMemory.ts:39-58`), and `listOrganisationMemory` filters expiry by date but does not automatically convert expired rows to `status = "expired"` (`artifacts/api-server/src/services/organisationMemoryService.ts:193-227`).

Conclusion: dates and supersession are partially used at retrieval time, but changes do not automatically supersede old facts. If a fact changes and the old record is not manually superseded or date-bounded, both approved records remain eligible and compete by importance/relevance.
