---
name: NeedsOps Task #18 Specialist Training UI
description: Organisation Library rebuild + Specialist Training 6-tab UI — key patterns and constraints
---

## What was built
- `OrgLibraryPage.tsx` — 6-step upload wizard (file→title→category→scope→authority+sensitivity→confirm), rich source cards, search + 7-status tab filter, polling for in-flight uploads, approve/revoke actions inline
- `SourceDetailPage.tsx` — source metadata header, processing pipeline stages in plain language, scanned PDF/injection warnings, extracted sections list, approve-ingestion/reject/revoke/retry/edit-metadata actions
- `SpecialistTrainingPage.tsx` — 6 tabs: Overview, Responsibilities, Language & Style, Knowledge, Test Specialist, Readiness; owner/admin-only approve/suspend
- `specialistTraining.ts` (API) — 4 new route groups: language-profile GET/PUT, config GET/PUT, knowledge GET, test POST; already mounted at `/v1/organisations/:slug/knowledge/training/...`
- `specialistLanguageProfileService.ts` — getOrCreate + upsert
- `specialistConfigService.ts` — getOrCreate + upsert; responsibilities stored inside `additionalContext.responsibilities` JSONB sub-key

## Key service behaviors (test-verified)
- `approveKnowledgeSource` — NO ALREADY_APPROVED guard; re-approve is idempotent; calls 2 db.update calls (source + version)
- `assignScope` — upsert pattern: returns existing scope silently if duplicate (no DUPLICATE_SCOPE error)
- `removeScope` — no existence check; delete is a no-op if scope not found
- `transitionTrainingStatus` — only owner/admin may move to `ready` or `suspended`; all other transitions are member-level; calls logOrgEvent (must be mocked with .mockResolvedValue(undefined) or .catch fails)
- `orchestrateKnowledge` test endpoint — uses writeAudit:false, tokenBudget:2000; format citations with matchLabel (score ≥0.85→"Strong match" etc.); never expose raw scores

## Mock patterns for these tests
- vi.hoisted() required for mockDb AND mockLogOrgEvent
- vi.resetAllMocks() in beforeEach PLUS mockLogOrgEvent.mockResolvedValue(undefined) re-setup (logOrgEvent returns a Promise, its .catch() is called inline)
- makeDeleteChain must include a `then` method to be awaitable

## Routes added to App.tsx
- `/app/:slug/library/:sourceId` → SourceDetailPage (before `/app/:slug/library`)
- `/app/:slug/workforce/:specialistId/training` → SpecialistTrainingPage

## REQUIRED_RLS_TABLES stays at 60 (no new DB tables)
## Test count: 1905 passing (78 new Task #18 tests)
