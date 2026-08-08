---
name: NeedsOps Sprint 29M Execution Routing
description: Three-lane classifier, ingestion auto-approval, active-executions endpoint, Inbox/Notifications semantic split, memory supersede self-reference guard
---

## Execution Classifier (executionClassifierService.ts)

Three-lane routing gate sitting between CoS classification and UEE:
- **TRANSIENT** — stays in Chat; no Completed Work
- **PROFESSIONAL_WORK** — UEE + durable output; no evidence required
- **EVIDENCE_BEARING** — full UEE + KRS + Sprint 29K claims

**Key rule ordering:**
1. Non-conversation triggers → PROFESSIONAL_WORK minimum (never downgrade)
2. Blueprint `required` → EVIDENCE_BEARING
3a. Brainstorming mode → always TRANSIENT unless evidenceScore > 0 or doc refs
3b. Other transient modes → TRANSIENT if professionalScore=0 + evidenceScore=0 + no doc refs
4. Doc refs + work intent mode + evidenceScore≥1 → EVIDENCE_BEARING
5. evidenceScore≥1 + isWorkIntentMode → EVIDENCE_BEARING
5b. evidenceScore≥1 + hasDocRefs → EVIDENCE_BEARING
5c. transientScore≥1 + not work-intent mode + no proposedTask → TRANSIENT (beats professional keywords)
6. transientScore≥1 + no doc refs + evidenceScore=0 + professionalScore=0 + no proposedTask → TRANSIENT
6b. Same but with proposedTask — checks `isProfessionalProposedTask()` to decide
7. isWorkIntentMode → PROFESSIONAL_WORK (doc refs escalate to EVIDENCE_BEARING)
8. hasDocRefs (non-work-intent) → PROFESSIONAL_WORK with KRS access
9. hasProposedTask → PROFESSIONAL_WORK catch-all
10. TRANSIENT catch-all

**Critical lessons:**
- Do NOT call `extractDocumentSearchTerms` inside the classifier — it picks up document-type words like "procedure" from creation requests ("draft an onboarding procedure" → wrongly extracts "Onboarding Procedure"). Use only the pre-computed `extractedSearchTerms` parameter.
- `"response"` as bare word in TRANSIENT_OUTPUT_PATTERNS causes false positives ("check if our response followed..."). Only keep contextualised forms: "quick response", "brief response", "draft a response".
- Rule 3 split: brainstorming always TRANSIENT (topic vs output); other transient modes check professionalScore.
- Rule 5 threshold is `evidenceScore >= 1` (not >= 2) — single evidence pattern in work-intent context is sufficient.
- Evidence pattern 5 extended to: `review\s+(?:our|the|this)(?:\s+\w+){0,2}\s+(?:policy|...)` to handle adjectives.

**isTransientRequest(result)** — helper exported for use in conversations.ts route layer.

## Ingestion Auto-Approval (ingestionPipelineService.ts Stage 11)

Amendment 3 guard: auto-approve low-risk uploads, but NOT conflicting documents.

Criteria (all must be true):
1. `requiresHumanReview === false` (no injection flags, not scanned)
2. No existing `approved` source with the same `canonicalTitle` in the org

If auto-approvable → status = "approved". Otherwise → "review_required".
Failure in the conflict check must NEVER block the pipeline — fall back to "review_required".
Sprint 29K evidence snapshots are NOT affected (only source status changes).

## Active Executions Endpoint (Part D, Amendment 5)

`GET /v1/organisations/:slug/active-executions`

Returns unified array of in-flight items from:
- `tasksTable` at states: queued, planning, awaiting_approval, executing
- `specialistRunsTable` at statuses: created, claimed, running, waiting_for_runtime
- `executionIntentsTable` at status: dispatched

Service: `artifacts/api-server/src/services/activeExecutionsService.ts`
Route: added to `workforceOps.ts`

`ActiveWorkPage.tsx` now queries this endpoint (not the old completed-work + tasks pair).

## G Defect Fixed During 29M.1 Verification

NotificationCentrePage docstring was updated in Sprint 29M but the rendering
code still emitted awaiting_approval work, pending approvals, and knowledge
proposals (all three actionable types). Fixed in 29M.1 verification gate:
- Removed `approvalsData` and `proposalsData` queries entirely
- Removed all three actionable item loops
- Narrowed NotifType to `"work" | "conversation"` only
- Updated TYPE_META and TYPE_FILTERS to match

Also found defect D1 (NOT fixed — recorded for separate prioritisation):
"What should a good performance review include?" → classifies as PROFESSIONAL_WORK
because `professionalScore` fires on the topic word "performance review". Rule 5c
handles `what is/are/does` but not `what should`. Fix: extend Rule 5c interrogative
pattern to include `what\s+should` and `how\s+(?:should|might|would)` forms.

## Inbox/Notifications Semantic Split (Part E, Amendment 6)

**Inbox (ExecutiveInbox.tsx)** = ACTIONABLE only:
- completed_work with status="awaiting_approval"
- pending approvals
- knowledge proposals (status="proposed")
- Removed: approved/completed work (was duplicate), conversation unread badge

**Notifications (NotificationCentrePage.tsx)** = INFORMATIONAL only:
- completed_work with status="approved" (kept)
- conversation unread count (kept)
- Removed: awaiting_approval work items (duplicate of Inbox)
- Removed: pending approvals (duplicate of Inbox)
- Removed: knowledge proposals (duplicate of Inbox)

## Memory Supersede Self-Reference Guard

`supersedeOrganisationMemory()` now returns `{ ok: true } | { ok: false; error: string }` instead of `boolean`.
Self-reference guard: if `oldId === newId` → returns `{ ok: false, error: "A memory entry cannot supersede itself" }` before any DB access.

**Warning**: Do NOT use `vi.mock()` inside `it()` blocks in a test file alongside pure function tests — Vitest hoists the mock to file scope, corrupting module state for all other tests. The "response" bare word in transient patterns caused A4 to return TRANSIENT; removal fixed it.

## Test Counts

- Sprint 29M test file: 61/61 passing
- Total tests after sprint: 4,724 (baseline 4,635 + 89 new)
- Pre-existing failures: 27 (unchanged)
- REQUIRED_RLS_TABLES: 75 (no new DB tables this sprint)
