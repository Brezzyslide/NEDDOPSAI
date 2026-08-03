---
name: NeedsOps Sprint 25 Completed Work Portal
description: Completed Work Portal + Viewer — 2 new pages, MarkdownRenderer component, 49 new tests. Full document lifecycle UX.
---

## What was built

**New pages:**
- `CompletedWorkPortal.tsx` at `/app/:slug/work` — listing portal with status tabs (All/Draft/Awaiting Approval/Approved/Rejected/Archived/Superseded), search, filters (specialist/outputType), sort (newest/oldest/A-Z/Z-A), pagination (20/page), pin (localStorage), recent viewed (localStorage, 8 items), work cards with status badges/specialist icon/outputType/date.
- `CompletedWorkViewer.tsx` at `/app/:slug/work/:id` — professional document viewer with 5 tabs: Document / Evidence / Execution / Versions / Comments.

**New component:**
- `MarkdownRenderer.tsx` — dependency-free React markdown renderer. Handles h1–h4, bold, italic, inline code, links, unordered/ordered lists, blockquotes, fenced code blocks (with lang header), GFM tables, horizontal rules. Also exports `extractOutline()` for document outline sidebar.

**AppShell nav:**
- Replaced "Approvals" in Operations section with "Completed Work" (→ `/work`). Approvals remains in Governance section.

**App.tsx new routes (before :slug catch-all):**
- `/app/:slug/work/:id` → CompletedWorkViewer (must be before `/work`)
- `/app/:slug/work` → CompletedWorkPortal

## Viewer architecture

**Document tab:** MarkdownRenderer + DocumentOutline sidebar (sticky, xl+ breakpoint only, extracted headings).

**Evidence tab:** AssetRow list grouped by assetType. Each asset: icon/label from ASSET_TYPE_META, citationRef (human-readable only), role, expandable detail. Never exposes embeddings.

**Execution tab:** Specialist card, 4-metric grid (blueprint/outputType/timeTaken/versions), quality self-review dimensions bar chart, related conversation link, transparency notice.

**Versions tab:** Compare control (select A vs B → side-by-side raw view), timeline (latest = current badge, auto-revision badge), per-version: quality bar, changeNote, download MD (client-side blob), restore (POST /version with changeNote "Restored from version N"). PDF/DOCX stubs are disabled buttons.

**Comments tab:** Add comment textarea (⌘↵ submit), comment list with resolve toggle (localStorage), resolved comments collapsible. No backend threading — reply UI is future-ready.

**Approval modal:** approve/reject/request_changes. approve = POST /approve + optional audit comment. reject = POST /reject with reason. request_changes = POST /reject with "Revision requested: <reason>".

**Promote to Library modal:** 6 document types (approved_example/template/policy/procedure/guide/reference). Shows specialist reach ("This document will become available to…"). Confirmation required. POST /promote with `{documentType}`.

**Download:** Markdown blob with `# title\n\ncontent`, filename = title sanitised to `[a-z0-9_]+.md`.

**Print mode:** toggle hides chrome, shows white background, adds print header. PDF/DOCX are stubs.

## Key decisions

**Why no markdown library:** no react-markdown in package.json; built MarkdownRenderer to avoid new dependency.

**Pin = localStorage `needsops-pinned-work-${slug}`:** same pattern as memory governance importance pin. Not server-persisted.

**Recent = localStorage `needsops-recent-work-${slug}`:** max 8, deduped, newest-first. Recorded in `recordRecent()` called on card click before navigation.

**Resolve comments = localStorage `needsops-resolved-comments-${workId}`:** backend has no resolved flag; frontend-only for now.

## Stats
- No new DB tables (REQUIRED_RLS_TABLES remains 67)
- Test files: 45 → 46 (+1 sprint25 suite, 49 new tests)
- Tests: 1948 → 1997 (+49 completed work tests)
