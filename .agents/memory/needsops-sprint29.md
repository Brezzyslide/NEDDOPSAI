---
name: NeedsOps Sprint 29 — Governance Completion
description: Governance Centre completion — bulk approvals, memory merge, per-memory audit history, governance metrics, approval history drilldown, execution intents + pack requests in approval feed.
---

## What was delivered

### Backend services (artifacts/api-server/src/services/)

- **approvalService.ts** — `getApprovalsByOrg` state filter moved to DB level (was in-memory after limit=50); `bulkResolveApprovals({ approvalIds, organizationId, action, actorUserId, notes? })` — caps at 100 items per call, partial failure support, writes a history entry per item via existing `resolveApproval`.

- **organisationMemoryService.ts** — `mergeOrganisationMemory(tenantId, { targetId, sourceId, mergedBy, mergedTitle?, mergedContent? })` → supersedes source into target, keeps higher confidence, writes two `orgAuditLogTable` inserts (`memory.merged` on target, `memory.superseded` on source); `getMemoryAuditHistory(tenantId, memoryId)` → queries `orgAuditLogTable` by resourceId, returns empty array on DB error (non-critical).

- **governanceMetricsService.ts** — new file; `computeGovernanceMetrics(tenantId)` → 5 DB queries (approvals, memory, completed work, blueprints, audit), computes: pendingApprovals, avgApprovalHours, approvalsAgedOver48h, approvalAgingBuckets (under24h/24to48/over48h), memoryHealthScore, blueprintCoverage, governanceScore (weighted composite 0–100), topGovernanceActors.

### Routes (artifacts/api-server/src/routes/v1/)

- **approvalRoutes.ts** — `POST /bulk` (batch resolve, per-item error handling, dispatch); `GET /metrics` (calls computeGovernanceMetrics, mounted at `/v1/organisations/:slug/approvals/metrics`)

- **organisationMemory.ts** — `POST /:memoryId/merge` (requires sourceId, validates target≠source); `GET /:memoryId/audit`

- **executionIntents.ts** — `GET /organisations/:slug/execution-intents?status=...` (org-level listing for approval feed; defaults to `pending_approval`); added `db`, `executionIntentsTable`, `eq`, `and`, `desc` imports from `@workspace/db` / `drizzle-orm`.

### Frontend (artifacts/needsops-web/src/)

- **components/governance/ApprovalHistoryPanel.tsx** — per-approval history drilldown; fetches `GET /approvals/:id`; renders timeline with action icons/labels.

- **components/governance/MemoryAuditPanel.tsx** — per-memory audit history drilldown; fetches `GET /memory/:id/audit`; renders timeline.

- **pages/app/ApprovalsPage.tsx** — unified approval feed now includes execution intents (category=`intent`) and pack access requests (category=`pack`); bulk approve for system approvals uses `POST /approvals/bulk` (server-batched) instead of serial loop; per-item "History" button for system approvals opens `ApprovalHistoryPanel`.

- **pages/app/OrgMemoryPage.tsx** — MemoryCard gets `onMerge` + `onAudit` props; "🔀 Merge" button on approved entries opens in-page merge modal (select source → calls `POST /:id/merge`); "📋 History" button opens `MemoryAuditPanel`; `mergeOrganisationMemory` mutation wired.

- **pages/app/GovernanceCentre.tsx** — governance metrics panel added above nav grid: governance score (0–100), pending count, avg resolution time, memory health %, blueprint coverage %, approval aging buckets, top governance actor.

## Test file

`src/__tests__/sprint29-governance-completion.test.ts` — 42 tests covering: bulk resolve (success/partial/reject/notes/audit), approval state filter, memory merge (target/source, confidence, title/content, audit events, tenant isolation, error cases), memory audit history, governance metrics (all dimensions, edge cases), tenant isolation, input validation (100-item cap, title/content truncation).

## Key rules & gotchas

**Why `_mockSet` shared mock pattern:** `vi.clearAllMocks()` wipes all mock implementations. After clear, `mockUpdate` returns `undefined`. `beforeEach` must call BOTH `_mockSet.mockReturnValue({ where: vi.fn().mockReturnValue({ returning: vi.fn()... }) })` AND `mockUpdate.mockReturnValue({ set: _mockSet })` to restore the chain.

**Why** `getSetArg(N)`: `mockUpdate` returns the same shared object via `mockReturnValue`. All `db.update().set(...)` calls hit the same `_mockSet` mock. Use `_mockSet.mock.calls[0]?.[0]` for first set call, `[1]?.[0]` for second — NOT `mockUpdate.mock.results[N].value.set.mock.calls[0]` (results always point to same shared object).

**Governance metrics endpoint path:** Metrics are on the approvals router → `/v1/organisations/:slug/approvals/metrics`. Frontend uses `apiFetch(/v1/organisations/${slug}/approvals/metrics)`.

**Memory merge truncation:** `mergedTitle` is silently truncated to 200 chars, `mergedContent` to 5000 chars, even when caller supplies longer strings.

**Execution intents org-level route:** `status` defaults to `pending_approval` if omitted from query string.

## Test count

REQUIRED_RLS_TABLES unchanged (69). Total tests: **2775** (65 files).
