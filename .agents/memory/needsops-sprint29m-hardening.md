---
name: NeedsOps Sprint 29M Hardening
description: Product simplification changes — what was already done, what needed writing, key conventions for next sprint
---

## Already-done on arrival (zero code changes needed)
- `executionClassifierService.ts` — fully implemented with 3-lane classifier
- Classifier wired into `conversationService.ts` at line 506; `isTransientRequest` gate on auto-dispatch at conversations route line 242
- `ActiveWorkPage.tsx` — already fetches `GET /active-executions`
- `/active-executions` endpoint — already exists in workforceOps.ts
- `TeamPage.tsx` — Remove member action already wired
- `AccountSettings.tsx` — `queryClient.invalidateQueries(['me'])` on PATCH success already done
- `ingestionPipelineService.ts` — auto-approval for low-risk uploads already at Stage 11
- `ExecutiveInbox.tsx` — approved/done work already removed (Sprint 29M Part E comment)
- `supersedeOrganisationMemory` — self-reference guard at line 117 already in service

## Changes made this sprint
- **NotificationCentrePage.tsx** — rewrote to show INFORMATIONAL only (approved work, conv-unread). Removed: awaiting_approval work, pending approvals, knowledge proposals (all → Inbox only).
- **AppShell.tsx** — KNOWLEDGE_NAV renamed KNOWLEDGE_ADMIN_NAV and gated behind `isKnowledgeAdmin` (owner/administrator via `/members/me`). Timeline removed from GOVERNANCE_NAV (merged into AuditPage).
- **AuditPage.tsx** — Added "Governance" tab (Timeline view); "All Events" tab is the original view. Sprint 29M Part F confirmed: both read same `org_audit_log` table.
- **OrgMemoryPage.tsx** — `retire` mutation fixed: was calling `/supersede` with self-reference (correctly rejected by server); now calls `/reject` endpoint.
- **OrgLibraryPage.tsx** — Dead `approveSource` mutation removed (POST `/approve`). Auto-approval handled server-side.
- **organisationMemoryService.ts** — Added `canAutoAdoptMemory()` + auto-adoption in `proposeOrganisationMemory()`. Auto-adopt when: `sourceType` ∈ {`ai_proposed`, `import`}, `confidence ≥ 0.8`, `memoryType` ∈ {`operating_preference`, `system_information`, `terminology`, `organisation_profile`}, zero conflicts. Sets `status="approved"`, `approvedBy="system:auto-adopt"`.
- **orgMembers.ts** — Added `GET /members/me` route returning `{ role, userId }` from `tenantContext`. Used by AppShell for nav gating.
- **docs/connector-production-gaps.md** — Written (5 gaps documented; no code changes to relay services).
- **3 new test files** — 82 tests total: sprint29m-classifier (41), sprint29m-routing-acceptance (41 → 34+8 = 34 visible in module + auto-adoption), sprint29m-blueprint-sandbox (7).

## Key conventions for next sprint
- `proposeOrganisationMemory` now returns `{ id, conflicts, autoAdopted }` — callers can destructure subset.
- `GET /v1/organisations/:slug/members/me` returns `{ role, userId }` — use for role-gating in other components.
- `testBlueprintSandbox` is a pure dry-run (no AI call, no DB writes). Returns `{ sandboxOnly: true, validationOutcome, validationIssues, ... }`.
- TRANSIENT bypass in conversations route: `const isTransientRequest = result.executionClassification?.executionClass === "transient"` guards auto-dispatch (line 242 of conversations.ts).

## Test count
- sprint29m test files: 82 new passing tests
- Pre-existing failures: ~52 (sprint285 context builder 14, sprint29h2 DB probe ~10, sprint29f1 connector ~8, sprint4 platform console ~4, other integration probes). All pre-existing, none caused by sprint 29M changes.
