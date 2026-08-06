---
name: NeedsOps Sprint 28.7 Gateway Output-Mode Architecture
description: GatewayOutputMode type, conditional response_format in OpenAI provider, system role, 4 new AIPurpose values, InspectorGatewayDiagnostics
---

## Rule
Every `gateway.process()` call MUST declare `outputMode` explicitly. Never omit it — the backward-compat default ("json") emits a console.warn.

**Why:** OpenAI HTTP 400 — "messages must contain the word 'json' to use response_format: json_object". Specialist work execution, self-review, and briefings produce prose and must not send response_format.

## Output mode mapping (frozen)
| Caller | outputMode |
|---|---|
| workExecutionPipelineService — generateDraft | `"text"` |
| selfReviewService — revised prose | `"text"` |
| executiveBriefing route | `"text"` |
| chiefOfStaffLLMService — classification | `"json"` |
| workBlueprintService — blueprint selection | `"json"` |
| knowledgeCurationService — proposals | `"json"` |
| specialistIntelligenceService — SpecialistRunResult | `"json"` |
| chiefOfStaffOrchestrator — conflict decision | `"json"` |
| capabilityIdentificationService | `"json"` |
| conversationMemoryService — summary | `"json"` |

## New AIPurpose values (Sprint 28.7)
- `blueprint_classification` — empty field allowlist
- `executive_briefing` — task.aggregates, task.state only
- `work_self_review_revision` — empty field allowlist
- `knowledge_curation` — knowledge.chunk, knowledge.source

## system role in ROLE_PURPOSE_ALLOWLIST
Added `system` role for internal platform operations (background services, specialist runtimes). Never granted to org users. Permitted purposes: task_execution, workforce_routing, compliance_check, knowledge_retrieval, blueprint_classification, work_self_review_revision, knowledge_curation, conversation_intelligence, internal_tooling.

## AIResponse new fields (Sprint 28.7)
- `outputMode: GatewayOutputMode` — the mode declared by the caller
- `responseFormat: string | null` — "json_object" when json/structured mode, null when text or internal provider

## InspectorGatewayDiagnostics
Added to `InspectorDiagnostics.gateway`. Populated when `failedStage === "executing"` AND rootCause contains "gateway used fallback" or "AI specialist execution did not produce content". Fields: outputMode, provider, model (null), responseFormat (null for text mode), usedFallback, fallbackReason.

## Test patterns
- `vi.mock("openai", ...)` + `vi.mock("@workspace/ai-gateway", ...)` in the SAME file causes all tests in the file to use the gateway mock — never mix them. Keep test files that need the real gateway separate from files that mock it.
- `callOpenAI` is NOT exported from `@workspace/ai-gateway` public index — it's internal to aiGateway.ts.
- `_client` singleton in openai.ts persists across test files. Use source-level checks (readFile) to verify provider conditionals instead of calling callOpenAI directly in test suites that run after the sprint7 real-DB tests.
- PURPOSE_FIELD_ALLOWLIST exhaustive test is in `sprint-task-execution-contract.test.ts` — update it whenever new purposes are added.

## Test count
3,642 passing (was 3,599 before sprint 28.7), 0 failures, 102 files.
