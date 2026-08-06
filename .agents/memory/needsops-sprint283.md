---
name: NeedsOps Sprint 28.3 Live Workforce Availability
description: Replaces hardcoded CoS workforce list with live org-aware specialist availability; new conversationWorkforceContextService; structural validation on LLM output
---

## What was built

Sprint 28.3 wires live specialist eligibility into the Chief of Staff conversation path.
The CoS now receives a live === AVAILABLE AI WORKFORCE === section and its structured
output fields are validated against the real dispatchable set.

## New service: conversationWorkforceContextService.ts

### Public API
```typescript
getConversationWorkforceContext(organisationId): Promise<ConversationWorkforceContext>
buildWorkforceSection(ctx): string
_clearWorkforceCache()   // test helper
```

### Dispatchability rules (ALL must be true)
1. Not deprecated (v2 catalogue only — v1 legacy codes excluded)
2. Not archived
3. Not comingSoon
4. Not suspended (executionStatus !== "suspended")
5. executionStatus === "available" || "beta"
6. dnaStatus === "approved"
7. Organisation is entitled (tenantCanUseSpecialist passes)
8. In RUNTIME_READY set (currently: chief_of_staff, operations_manager)

### Current dispatchability snapshot
- `operations_manager` — dispatchable
- `chief_of_staff` — dispatchable (conversation coordinator)
- All others — Professional design pending or not entitled

### Caching
30-second in-process Map cache, keyed by organisationId. Separate orgs never share entries.

### Customer-facing status labels (no internal codes)
- dna_pending / pending_design → "Professional design pending"
- dna_draft / draft → "Professional profile in progress"
- isArchived → "Archived"
- comingSoon → "Not yet released"
- suspended → "Temporarily unavailable"
- !entitled → "Not available in your plan"
- !runtimeReady → "Platform setup incomplete"

## Changes to chiefOfStaffLLMService.ts

### Prompt
- Line 81: removed hardcoded list of specialist codes; replaced with reference to AVAILABLE AI WORKFORCE section
- New section added: "## AVAILABLE AI WORKFORCE — MANDATORY RULES" (8 rules, before KNOWLEDGE SOURCE TRANSPARENCY)

### classifyMessageLLM changes
- After presence check: calls `getConversationWorkforceContext(ctx.organizationId)`
- Builds `workforceSection = buildWorkforceSection(workforceCtx)`
- Passes to both `buildLayeredUserMessage` (5th param) and `buildLegacyUserMessage` (4th param)
- Workforce section injected BEFORE presence section, BEFORE user message
- Deterministic fallback: filters `relatedWorkforceRoles` against `dispatchableCodes`
- All `classifyMessage` fallback call sites filter roles

### parseAndValidateLLMResponse changes
- New param: `workforceCtx?: ConversationWorkforceContext`
- `relatedWorkforceRoles` filtered against `conversationCodes` (all non-deprecated v2 specialists)
- `specialistSequence` filtered against `dispatchableCodes` (only truly dispatchable)
- Tracks `removedRoleCodes` and appends a customer-facing disclosure when violation detected
- Returns `workforceViolationDetected?: boolean` flag

## Changes to conversationIntelligenceService.ts

### DOMAIN_ROLE_MAP
Updated from deprecated v1 codes to current v2 catalogue codes:
- compliance/audit → compliance_quality_manager
- policy/procedure → compliance_quality_manager, operations_manager
- incident → incident_safeguarding_specialist, compliance_quality_manager
- roster/operations → operations_manager
- finance → finance_officer
- people/hr → people_culture_manager, workforce_compliance_specialist
- marketing → marketing_communications_manager
- document/knowledge → knowledge_documentation_specialist, chief_of_staff
- sharepoint/system → operations_manager

No more obsolete codes: compliance_officer, quality_officer, policy_officer,
operations_officer, hr_officer, marketing_officer are gone.

## Test baseline

3,331 passing (+42 new), 16 pre-existing failures unchanged.
Test file: `artifacts/api-server/src/__tests__/sprint283-workforce-context.test.ts` (42 tests)

## Key architectural notes

- `workforceViolationDetected` flag is Sprint 28.3's enforcement signal
- Text correction for violation (replacing LLM promises with factual statements) is deferred to Sprint 28.4 (delegation integrity)
- Presence check (28.2) and workforce check (28.3) both run before the provider branch — both LLM and deterministic paths benefit
- Entitlement checks only run for potentially-dispatchable specialists to minimize DB calls
