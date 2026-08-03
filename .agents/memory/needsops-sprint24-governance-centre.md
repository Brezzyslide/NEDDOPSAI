---
name: NeedsOps Sprint 24 Governance Centre
description: 6 new/replaced pages, 32 new tests. Governance Centre hub, Unified Approval Centre, Memory Governance, Knowledge Health, Governance Timeline, improved Audit Log.
---

## What was built

**New pages (frontend only — no new backend):**
- `GovernanceCentre.tsx` at `/app/:slug/governance` — hub with Organisation Health composite score, 6 nav cards, recent activity strip. AI recommendations derived from API data (no extra LLM call).
- `KnowledgeHealthPage.tsx` at `/app/:slug/governance/knowledge-health` — all 16 KnowledgeHealthMetrics fields displayed; expandable sections for Issues / Proposals / Specialist Coverage; retraining recommendations.
- `GovernanceTimelinePage.tsx` at `/app/:slug/governance/timeline` — audit events filtered to governance-relevant types; category tabs; search; timeline spine layout; pagination.

**Replaced pages:**
- `ApprovalsPage.tsx` — full replacement, now "Unified Approval Centre". Aggregates 5 sources: knowledge proposals (curation API), memory proposals (org memory, status=proposed), library reviews (sources, status=review_required), completed work (status=awaiting_approval), system approvals (approvals API). Bulk select+approve, inline approve/reject/request-changes with comment modal, category filter tabs with counts, search, sort.
- `OrgMemoryPage.tsx` — full rewrite in dark theme. Adds: pin/unpin (importance=10), edit metadata modal, retire (supersede), full provenance expansion, AI reasoning from structuredContent. Preserves propose new memory functionality.
- `AuditPage.tsx` — improved. Date range filter, expanded event type optgroups by category, row expand for full metadata + IP, link to Governance Timeline for governance events, field normalisation for both snake_case (org schema) and camelCase (legacy).

**AppShell nav changes:**
- New "Governance" section added between Knowledge and Organisation.
- Nav items: Governance (hub) · Approvals · Memory · Knowledge Health · Timeline · Audit Log.
- Removed "Audit" from Organisation section (now under Governance).

**App.tsx new routes:**
- `/app/:slug/governance/knowledge-health` → KnowledgeHealthPage (must be before `:slug/governance` catch-all)
- `/app/:slug/governance/timeline` → GovernanceTimelinePage
- `/app/:slug/governance` → GovernanceCentre

## Key lessons

### Route ordering in Wouter
- More-specific sub-paths (`/governance/knowledge-health`, `/governance/timeline`) must appear **before** the parent catch (`/governance`), otherwise the parent matches first.

### ApprovalsPage unified action dispatch
- Each approval category routes to a different API endpoint:
  - `knowledge` → `/knowledge/curation/proposals/:id/approve|reject`
  - `memory` → `/memory/:id/approve|reject`
  - `library` → `/knowledge/sources/:id/approve|revoke`
  - `work` → `/completed-work/:id/approve|reject`
  - `system` → `/approvals/:id/resolve` with `{ action: "approved"|"rejected" }`
- The `request_changes` action has no backend endpoint — it resolves as a `reject` with the comment as the reason.

### Organisation Health composite score formula
`Math.round(healthScore * 0.4 + specialistCoverage * 0.25 + libPct * 0.2 + Math.max(0, 100 - conflicts * 10) * 0.15)`

### Pin = importance 10
Memory pinning is done by PATCH-ing `importance` to 10. Unpin restores to 8. Frontend toggles based on `item.importance >= 10`.

### Audit field normalisation
- Org schema (withOrgContext) returns snake_case: `event_type`, `occurred_at`, `actor_user_id`, etc.
- Legacy public.org_audit_log returns camelCase: `eventType`, `occurredAt`, `actorUserId`.
- All audit-consuming pages must normalise both forms with `e.event_type ?? e.eventType`.

## Stats
- No new DB tables (REQUIRED_RLS_TABLES remains 67)
- Test files: 44 → 45 (+1 sprint24 suite)
- Tests: 1916 → 1948 (+32 governance tests)
