---
name: NeedsOps Sprint 25 Hardening
description: Comment resolution server-backed, PDF/DOCX export architecture, export audit, DB migration for comment status columns
---

## Rules

### Mock chain must be re-established after every clear/reset
In Vitest, **both** `vi.clearAllMocks()` and `vi.resetAllMocks()` strip `mockReturnValue` implementations from hoisted mocks. The `vi.hoisted()` block's `mockReturnValue(chain)` calls do NOT survive a clear.

**Required pattern:**
```js
function resetChain() {
  for (const k of ["from","where","set","orderBy","limit","offset","values"]) {
    mockDb[k].mockReturnValue(mockDb);
  }
}
beforeEach(() => { vi.clearAllMocks(); resetChain(); });
```
Never rely on `vi.hoisted()` implementations persisting across test runs.

### Export service: validate format before DB access
`completedWorkExportService.ts` validates the format BEFORE calling `getCompletedWork`. This enables tests to check invalid-format rejection without setting up any DB mocks.

### Comment resolution schema (Sprint 25 Hardening)
New columns on `completed_work_comments`:
- `status TEXT NOT NULL DEFAULT 'open'` — check constraint: open|resolved|reopened
- `resolved_by_user_id TEXT`
- `resolved_at TIMESTAMPTZ`
- `reopened_by_user_id TEXT`
- `reopened_at TIMESTAMPTZ`

Migration: `lib/db/migrations/sprint25-hardening.sql` — applied via `psql $DATABASE_URL -f`.

### Export API route
`GET /v1/organisations/:slug/completed-work/:id/export?format=pdf|docx|md`
Returns binary stream with `Content-Disposition: attachment; filename="..."`.

Frontend fetches as `apiFetch(url)` → `.blob()` → `URL.createObjectURL` → trigger download.

### Export intermediate document model
`parseMarkdown(md) → DocumentNode[]` → `IntermediateDocument` → each exporter
- `MarkdownExporter` → UTF-8 Buffer
- `PdfExporter` (pdfkit) → Buffer starting with `%PDF`
- `DocxExporter` (docx package) → Buffer starting with `PK` (ZIP magic bytes)

**Why:** single parser, multiple output formats; no duplication of rendering logic.

### REQUIRED_RLS_TABLES unchanged
Sprint 25 Hardening adds columns to an existing table, not a new table. REQUIRED_RLS_TABLES stays at 67.

### Test count after Sprint 25 Hardening
47 test files, 2060 tests total.
