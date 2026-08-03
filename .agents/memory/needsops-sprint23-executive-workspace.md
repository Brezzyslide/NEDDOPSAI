---
name: NeedsOps Sprint 23 Executive Workspace
description: Frontend-only sprint. New dashboard, inbox, active work, notification centre, AI briefing endpoint. Redirect from wouter not @clerk/react.
---

## What was built

**Backend (one new route):**
- `executiveBriefing.ts` — `GET /v1/organisations/:slug/executive-briefing`; collects completed-work + knowledge-health in parallel; calls OpenAI if `AI_PROVIDER=openai`, falls back to rule-based summary. Registered via `router.use("/", executiveBriefingRouter)` in `routes/v1/index.ts`.

**Frontend pages (all at `/app/:slug/...`):**
- `ExecutiveDashboard.tsx` — new root landing page replacing `AppDashboard` at `/app/:slug`. BriefingWidget, 4-metric strip, 2-col layout.
- `ExecutiveInbox.tsx` — `/app/:slug/inbox`. Aggregates awaiting-approval work, pending approvals, knowledge proposals, and unread conversation count. Archive/read state in localStorage keyed by org slug.
- `ActiveWorkPage.tsx` — `/app/:slug/active-work`. Combines completed-work + tasks APIs. Status tabs: All / In Progress / Awaiting Approval / Completed / Failed. Per-item type discrimination (`"work"` vs `"task"`) drives correct status badge map.
- `NotificationCentrePage.tsx` — `/app/:slug/notifications`. All/Unread/Archived tabs, type filter select, search. Read/archive state in localStorage. Synthetic unread conversation item from unread-count API.

**AppShell nav restructured** into 4 sections: Workspace · Operations · Knowledge · Organisation.

## Key lessons

### `Redirect` import source
- **Rule:** `<Redirect to="..." />` comes from `"wouter"`, NOT `"@clerk/react"`.
- **Why:** Clerk does not export `Redirect`; the import resolves but throws a runtime "does not provide an export named 'Redirect'" error that breaks the entire page tree.
- **How to apply:** Always import `Show` from `@clerk/react` and `Redirect` from `wouter` separately.

### localStorage state keying
- Inbox archive and notification read/archive states are stored as JSON arrays in localStorage under keys `needsops_inbox_{slug}` and `needsops_notif_read_{slug}` / `needsops_notif_arch_{slug}`. No backend persistence in Sprint 23.

### API shapes consumed
- Completed work list: `{ completedWork: [...] }` — filter by `status === "awaiting_approval"` for inbox/notif items.
- Approvals: `{ approvals: [...] }` from `/v1/organisations/:slug/approvals?state=pending`
- Knowledge proposals: `{ proposals: [...] }` from `.../knowledge/curation/proposals?status=proposed`
- Unread count: `{ unreadCount: number }` from `.../notifications/unread-count`
- Briefing: `{ briefing, generatedAt, usedAI, context }` from `.../executive-briefing`

## Stats
- No new DB tables (REQUIRED_RLS_TABLES remains 67)
- Tests: 1916/1916 (unchanged — frontend-only sprint has no new tests)
