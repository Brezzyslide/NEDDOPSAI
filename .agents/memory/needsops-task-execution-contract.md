---
name: NeedsOps task_execution Data-Field Contract
description: Precise field-permission contract for purpose="task_execution" in the AI gateway. Covers naming convention, excluded fields, denial audit, and the 6 data classes.
---

# task_execution Data-Field Contract

## The problem
`workExecutionPipelineService.ts` declared `retrievedFields` as 4 flat snake_case strings:
`["organisation_library_sources", "cos_memories", "entity_knowledge", "task_uploads"]`.
The `PURPOSE_FIELD_ALLOWLIST["task_execution"]` used dotted camelCase paths (`task.id`, etc.).
Exact-string match → all 4 rejected → "Data fields not permitted for purpose 'task_execution'".

## Field naming convention (CRITICAL)
The gateway uses **dotted camelCase** paths: `task.id`, `task.executionPlan`, `specialist.capabilities`.
New fields must follow the same convention: `organisationLibrarySources.sourceId`, NOT `organisation_library_sources.sourceId`.
Validation is exact string equality — no normalisation, no wildcards.

## The 6 data classes now in task_execution allowlist
| Class | Root prefix | Excluded |
|---|---|---|
| task_core | `task.` | — |
| specialist_identity | `specialist.` | `specialist.systemPrompt`, `specialist.internalChainOfThought` |
| approved_organisation_evidence | `organisationLibrarySources.` | `storageKey`, embedding vectors |
| approved_organisation_memory | `cosMemories.` | raw memory content |
| task_scoped_uploads | `taskUploads.` | `storageKey`, `authorityLevel` |
| entity_scoped_knowledge | `entityKnowledge.` | — |

## Purpose separation rule
- `conversation_intelligence` → library presence metadata only; NO `organisationLibrarySources.*` evidence fields
- `task_execution` → evidence chunks permitted (`organisationLibrarySources.relevantChunks.text/confidence`)
- `knowledge_retrieval` → raw `knowledge.*` fields; NOT `organisationLibrarySources.*`
- `report_generation` → aggregates only; NO individual record content

## AIGatewayDataError.deniedFields (new in this sprint)
`AIGatewayDataError` now carries a `deniedFields: string[]` property listing the exact rejected paths.
Constructor signature: `new AIGatewayDataError(message, deniedFields)` — second arg defaults to `[]` (backward-compatible).

## Denial audit event (new in this sprint)
`aiGateway.ts::processRequest` now catches `AIGatewayDataError` from `validateFields`, writes
`ai_gateway.field_access_denied` audit event (with `deniedFieldPaths` and `permittedDataClasses` in metadata),
logs the denied paths internally, then re-throws. Audit event added to `lib/shared/src/index.ts` AUDIT_EVENTS.

**Why:** The previous architecture wrote zero audit events when field validation failed (throw happened before the audit write). Platform operators had no visibility into what fields were being rejected or from which org.

## Rebuild requirement
After any change to `lib/ai-gateway/src/types.ts` or `lib/ai-gateway/src/aiGateway.ts`,
run `cd lib/ai-gateway && npx tsc --project tsconfig.json` before running tests.
After `lib/shared/src/index.ts` AUDIT_EVENTS change, run `cd lib/shared && npx tsc --project tsconfig.json`.

## cosMemories.content — added in follow-up sprint

The pipeline originally only selected memory title/type (ManifestMemoryRef had no content field).
Analysis confirmed the `organisation_memory` table has a `content text not null` column.
The same safeguards already applied at query time: status=approved, org-scoped, relevance-filtered by requiredMemoryTypes.

Decision: add `content` — the specialist needs approved text to produce org-specific output, not just know titles.
Truncated to 800 chars per entry (`MEMORY_CONTENT_MAX_CHARS`) to stay within LLM token budget.

Files changed:
- `lib/db/src/schema/workPackageManifests.ts` — `ManifestMemoryRef.content?: string`
- `artifacts/api-server/src/services/workPackageService.ts` — selects `organisationMemoryTable.content`, truncates
- `artifacts/api-server/src/services/workExecutionPipelineService.ts` — adds `cosMemories.content` to retrievedFields; prompt writes content under header when present
- `lib/ai-gateway/src/types.ts` — `cosMemories.content` added to task_execution allowlist

runtimeContextService and specialistContextService are NOT called by the work execution pipeline — confirmed by code search.

## Full chain (medication-policy flow)
POST /conversations/:id/messages → messageIngressService.handleIncomingMessage → conversationIntelligenceService.detectConversationIntent (action verb "Review" + policy domain → operations_manager) → autoDispatchService.dispatchWorkExecution → executionCoordinatorService.executeWorkAsync (role resolved via getMembershipForUser) → workExecutionPipelineService.executeWork → assembleWorkPackage (approved library sources, org memory with content now included) → knowledgeResolutionService.resolveEvidence (chunk retrieval) → generateDraft (gateway.process, purpose=task_execution, 21 retrievedFields) → selfReviewService.reviewDraft → completedWorkService.createDraft → Execution Inspector reads work_package_manifests + retrieval_audit_events + completed_work.

## Test count
3,529 passing (3,489 previous + 40 new in `sprint-task-execution-contract.test.ts`).
