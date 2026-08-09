---
name: NeedsOps Sprint 29N.10 Product Surface Defect Closure
description: 15-part audit closure — execution gate, UI contracts, role-aware controls, error handling, usage field fix, route guard HOC
---

## Key decisions and rules

### Part A — PDF/DOCX export
- Route and implementations were already complete (not stubs). No code fix needed. 26 tests added to verify.

### Part B — Platform org detail contract
- API returns `tasks: { total, note }` and `approvals: { total, pending, note }` (objects, not arrays).
- PlatformOrgDetail.tsx previously had `tasks: any[]` / `approvals: any[]` and called `.length`/`.map()` on them — runtime crash.
- Fix: interface updated to object shape; rendering changed to display numeric counters + note text.

### Part C — Cloud execution entitlement (critical)
- `execution.professional_work` is the new Cloud UEE gate (plan-included for professional/business/enterprise).
- `execution.openclaw_runtime` is the backwards-compat fallback ONLY — checked second if `professional_work` is not explicitly denied or subscription-inactive.
- Both `executionPolicy.ts` and `capabilityAccessDecisionService.ts` use the two-step pattern:
  ```
  check professional_work → if denied (but not explicit/subscription) → try openclaw_runtime
  ```
- Desktop connector preflight STAYS on `openclaw_runtime` — that is correct.
- `seed.ts` has display name "Cloud Professional Work Execution".

### Part D — Dashboard "Recently Completed" routing
- Bug: `setLocation(`/app/${slug}/active-work`)` was on the "Recently Completed → View all" action.
- Fix: changed to `setLocation(`/app/${slug}/work`)` (Completed Work Portal).
- The Active Work section's "View all" still correctly points to `/active-work`.

### Part E — Dashboard pending decisions breadth
- Dashboard now queries 7 sources matching ApprovalsPage's unified queue:
  1. system approvals (`approvals-dashboard`)
  2. awaiting_approval completed work
  3. curation proposals (`proposals-dashboard`)
  4. memory proposals (`memory-dashboard`)
  5. sources under review (`sources-review-dashboard`)
  6. execution intents (`intents-dashboard`)
  7. pack access requests (`pack-requests-dashboard`)
- `totalPendingDecisions` aggregates all 7 and drives the metric card.

### Part F — Role-aware UI controls
- Created `artifacts/needsops-web/src/hooks/useOrgRole.ts` — reuses `["me-orgs"]` query key (same as AppShell).
- Canonical role strings: `owner | administrator | manager | member | viewer | auditor`.
- `canApprove = role === "owner" || role === "administrator"`.
- `isKnowledgeAdmin` same as canApprove (owner/administrator).
- ApprovalsPage ItemCard, CompletedWorkViewer ActionBar (awaiting_approval buttons), OrgMemoryPage MemoryCard (proposed actions + Add Memory button) — all guarded by `canApprove`.
- App.tsx HOC `withKnowledgeAdminGuard` defined at MODULE scope (critical — inside component scope causes remount on every render).
- Blueprint Studio and Memory Governance routes wrapped: `GuardedBlueprintStudioPage`, `GuardedBlueprintEditorPage`, etc., `GuardedOrgMemoryPage`.
- Non-admin users redirected to `/app/${slug}` via `useEffect` in the HOC.

### Part G — Legacy "admin" role
- No occurrences of `=== "admin"` in org-role checks in any production file. Already clean.

### Part H — OrgSettings error handling
- `saveError` state + `setSaveError` in useMutation `onError` + visible error display added.

### Part I — Notification mutation optimistic rollback
- All 4 mutations (markRead, markUnread, archive, restore) now have `onError` handlers.
- Each handler deletes the mutated IDs from the appropriate optimistic set/map to roll back state.
- `variables` parameter in TanStack Query `onError(err, variables, ctx)` gives access to the IDs.

### Part L — Usage page field name
- API returns `{ dimensions: [...] }` not `{ allowances: [...] }`.
- Fix: `usageData?.dimensions ?? usageData?.allowances ?? []` (dual-key for backwards compat).

### Sprint 29N.10 test baseline
- Regression file: `artifacts/api-server/src/__tests__/sprint29n10-product-surface-defects.test.ts` — 26 tests.
- Sprint8 execution policy tests updated: `professional_work` is first checked feature.
- Sprint94 capabilities test updated: both `professional_work` AND `openclaw_runtime` must be denied to block execution.
- Final baseline: **4,985 passing / 0 failures**.

**Why:** Pattern for static-analysis tests: use `title="Recently Completed"` (JSX prop, unique) not "Recently Completed" (appears in JSDoc comment first). Test slice must start from the JSX anchor.
